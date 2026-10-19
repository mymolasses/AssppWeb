import { Readable } from 'node:stream';
import { Reader, fromReader } from 'yauzl-promise';
import bplistParser from 'bplist-parser';
import plist from 'plist';

export function validateMetadataURL(value: string): void {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password ||
      (url.port && url.port !== '443') ||
      !/(^|\.)(apple\.com|mzstatic\.com|itunes\.apple\.com|akamaihd\.net|akamaized\.net)$/.test(url.hostname)) {
    throw new Error('Invalid Apple package URL');
  }
}

async function fetchRange(url: string, start: number, length: number) {
  for (let redirects = 0; redirects <= 5; redirects++) {
    validateMetadataURL(url);
    const response = await fetch(url, {
      headers: { Range: `bytes=${start}-${start + length - 1}`, 'Accept-Encoding': 'identity' },
      redirect: 'manual', signal: AbortSignal.timeout(15000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('Missing package redirect');
      url = new URL(location, url).href;
      continue;
    }
    const match = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (response.status !== 206 || !match || Number(match[1]) !== start ||
        Number(match[2]) !== start + length - 1) {
      await response.body?.cancel();
      throw new Error('Invalid package Range response');
    }
    const chunks: Buffer[] = [];
    let received = 0;
    if (!response.body) throw new Error('Empty package response');
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > length) throw new Error('Oversized package response');
      chunks.push(Buffer.from(chunk));
    }
    if (received !== length) throw new Error('Truncated package response');
    return { data: Buffer.concat(chunks), size: Number(match[3]) };
  }
  throw new Error('Too many package redirects');
}

class PackageReader extends Reader {
  private remaining = 16 * 1024 * 1024;
  private requests = 0;
  private deadline = Date.now() + 60000;
  constructor(private url: string, private size: number) { super(); }
  async _read(start: number, length: number): Promise<Buffer> {
    this.remaining -= length;
    if (this.remaining < 0 || ++this.requests > 256 || Date.now() > this.deadline) {
      throw new Error('Package metadata read limit exceeded');
    }
    const result = await fetchRange(this.url, start, length);
    if (result.size !== this.size) throw new Error('Package size changed');
    return result.data;
  }
  _createReadStream(start: number, length: number): Readable {
    const reader = this;
    return Readable.from((async function* () { yield await reader._read(start, length); })());
  }
}

// Go's archive/zip (used by ipatool) prefers extended timestamps over DOS time.
export function zipModificationDate(entry: { getLastMod(): Date; extraFields: Array<{ id: number; data: Buffer }> }): Date {
  let modified = entry.getLastMod();
  for (const { id, data } of entry.extraFields) {
    if (id === 0x5455 && data.length >= 5 && (data[0] & 1)) {
      modified = new Date(data.readInt32LE(1) * 1000);
    } else if (id === 0x000a) {
      for (let offset = 4; offset + 4 <= data.length;) {
        const tag = data.readUInt16LE(offset);
        const size = data.readUInt16LE(offset + 2);
        offset += 4;
        if (offset + size > data.length) break;
        if (tag === 1 && size === 24) {
          modified = new Date(Number(data.readBigUInt64LE(offset) / 10000n) - 11644473600000);
        }
        offset += size;
      }
    }
  }
  return modified;
}

export function metadataFromPlist(data: Buffer, modified: Date) {
  const info = (data.subarray(0, 6).toString() === 'bplist'
    ? bplistParser.parseBuffer(data)[0]
    : plist.parse(data.toString('utf8'))) as Record<string, unknown>;
  const displayVersion = String(info.CFBundleShortVersionString ?? info.bundleShortVersionString ?? '').trim();
  if (!displayVersion) throw new Error('Missing package display version');
  const raw = info.releaseDate ?? info.ReleaseDate;
  const dateSource = raw === undefined ? 'file-modified' : 'info-plist';
  const date = raw === undefined ? modified : raw instanceof Date ? raw
    : typeof raw === 'number' ? new Date(raw * 1000) : new Date(String(raw).trim());
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid package date');
  return { displayVersion, date: date.toISOString(), dateSource };
}

export async function readRemoteVersionMetadata(url: string) {
  const { size } = await fetchRange(url, 0, 1);
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('Invalid package size');
  const zip = await fromReader(new PackageReader(url, size), size);
  try {
    for await (const entry of zip) {
      if (!/^Payload\/[^/]+\.app\/Info\.plist$/.test(entry.filename)) continue;
      if (entry.uncompressedSize > 2 * 1024 * 1024) throw new Error('Info.plist is too large');
      const stream = await entry.openReadStream();
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of stream) {
        length += chunk.length;
        if (length > 2 * 1024 * 1024) { stream.destroy(); throw new Error('Info.plist is too large'); }
        chunks.push(Buffer.from(chunk));
      }
      return metadataFromPlist(Buffer.concat(chunks), zipModificationDate(entry));
    }
    throw new Error('Could not find main app Info.plist');
  } finally { await zip.close(); }
}
