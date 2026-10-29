import { open } from 'yauzl-promise';
import bplistParser from 'bplist-parser';
import plist from 'plist';
import { LOCAL_UPLOAD_ACCOUNT_HASH } from '../constants.js';
import { getAllTasks, updateTaskRegion } from './downloadManager.js';

export function normalizeStorefrontId(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return;
  return String(value).trim().match(/^(\d{6})(?:[-,].*)?$/)?.[1];
}

const metadataReads = new Map<string, Promise<string | undefined>>();
export function readPackageStorefront(filePath: string): Promise<string | undefined> {
  const existing = metadataReads.get(filePath);
  if (existing) return existing;
  const result = readMetadataStorefront(filePath);
  metadataReads.set(filePath, result);
  if (metadataReads.size > 512) metadataReads.delete(metadataReads.keys().next().value!);
  return result;
}

async function readMetadataStorefront(filePath: string): Promise<string | undefined> {
  try {
    const zip = await open(filePath);
    try {
      for await (const entry of zip) {
        if (entry.filename !== 'iTunesMetadata.plist') continue;
        if (entry.uncompressedSize > 1024 * 1024) return;
        const stream = await entry.openReadStream();
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > 1024 * 1024) { stream.destroy(); return; }
          chunks.push(Buffer.from(chunk));
        }
        const data = Buffer.concat(chunks);
        const info = (data.subarray(0, 6).toString() === 'bplist'
          ? bplistParser.parseBuffer(data)[0] : plist.parse(data.toString('utf8'))) as Record<string, unknown>;
        if (!info || typeof info !== 'object') return;
        const ids = new Set(Object.entries(info)
          .filter(([key]) => /^(storefront|storefrontid)$/i.test(key))
          .map(([, value]) => normalizeStorefrontId(value)).filter((id): id is string => !!id));
        return ids.size === 1 ? [...ids][0] : undefined;
      }
    } finally { await zip.close(); }
  } catch {
    // Missing or ambiguous package metadata must not be guessed.
  }
}

export async function backfillPackageRegions(accounts = new Map<string, string>()): Promise<number> {
  let updated = 0;
  for (const task of getAllTasks()) {
    if (task.accountHash === LOCAL_UPLOAD_ACCOUNT_HASH || task.status !== 'completed' || !task.filePath || task.storefrontId) continue;
    if (accounts.size && !accounts.has(task.accountHash)) continue;
    const fromPackage = await readPackageStorefront(task.filePath);
    const fromAccount = accounts.get(task.accountHash);
    const id = fromPackage ?? fromAccount;
    if (id && updateTaskRegion(task.id, id, fromPackage ? 'ipa-metadata' : 'account')) updated++;
  }
  return updated;
}
