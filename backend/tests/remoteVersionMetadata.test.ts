import { afterEach, describe, expect, it, vi } from 'vitest';
import AdmZip from 'adm-zip';
import plist from 'plist';
import bplistCreator from 'bplist-creator';
import { randomBytes } from 'node:crypto';
import { metadataFromPlist, readRemoteVersionMetadata, validateMetadataURL, zipModificationDate } from '../src/services/remoteVersionMetadata.js';

afterEach(() => vi.unstubAllGlobals());
const modified = new Date('2020-01-02T03:04:06Z');

describe('IPA version dates', () => {
  it('prefers the ZIP extended modification timestamp over DOS time like ipatool', () => {
    const data = Buffer.alloc(5);
    data[0] = 1;
    data.writeInt32LE(1700000000, 1);
    expect(zipModificationDate({ getLastMod: () => modified, extraFields: [{ id: 0x5455, data }] }))
      .toEqual(new Date(1700000000000));
  });
  it('keeps DOS timestamps in UTC when no extension is present', () => {
    expect(zipModificationDate({ getLastMod: () => modified, extraFields: [] })).toEqual(modified);
  });
  it('reads extended timestamps after 2038 as unsigned seconds like Go', () => {
    const data = Buffer.alloc(5);
    data[0] = 1;
    data.writeUInt32LE(2200000000, 1);
    expect(zipModificationDate({ getLastMod: () => modified, extraFields: [{ id: 0x5455, data }] }))
      .toEqual(new Date(2200000000000));
  });
  it.each([0x000d, 0x5855])('reads Unix ZIP extra field %i modification time', (id) => {
    const data = Buffer.alloc(8);
    data.writeUInt32LE(1700000000, 4);
    expect(zipModificationDate({ getLastMod: () => modified, extraFields: [{ id, data }] }))
      .toEqual(new Date(1700000000000));
  });
  it('reads NTFS modification time and skips malformed timestamp fields', () => {
    const data = Buffer.alloc(32);
    data.writeUInt16LE(1, 4);
    data.writeUInt16LE(24, 6);
    data.writeBigUInt64LE((1700000000123n + 11644473600000n) * 10000n, 8);
    expect(zipModificationDate({ getLastMod: () => modified, extraFields: [
      { id: 0x000a, data },
      { id: 0x5455, data: Buffer.from([1]) },
      { id: 0x000d, data: Buffer.alloc(4) },
    ] })).toEqual(new Date(1700000000123));
  });
  it.each(['xml', 'binary'])('ignores both release date fields in %s plists', (format) => {
    const info = { CFBundleShortVersionString: '3.2', releaseDate: '2024-04-02T12:00:00Z', ReleaseDate: '2025-01-01' };
    const data = format === 'xml' ? Buffer.from(plist.build(info)) : bplistCreator(info);
    expect(metadataFromPlist(data, modified)).toEqual({ displayVersion: '3.2', date: modified.toISOString(), dateSource: 'file-modified' });
  });
  it('uses the ZIP date when the plist has no release date', () => {
    expect(metadataFromPlist(Buffer.from(plist.build({ CFBundleShortVersionString: '2.1' })), modified))
      .toEqual({ displayVersion: '2.1', date: modified.toISOString(), dateSource: 'file-modified' });
  });
  it.each(['releaseDate', 'ReleaseDate'])('ignores malformed %s fields', (key) => {
    expect(metadataFromPlist(Buffer.from(plist.build({ CFBundleShortVersionString: '1', [key]: 'invalid' })), modified))
      .toEqual({ displayVersion: '1', date: modified.toISOString(), dateSource: 'file-modified' });
  });
  it('rejects invalid ZIP dates without falling back to plist release dates', () => {
    expect(() => metadataFromPlist(Buffer.from(plist.build({ CFBundleShortVersionString: '1', releaseDate: '2025-01-01' })), new Date(NaN)))
      .toThrow('Invalid package ZIP date');
  });
  it.each(['xml', 'binary'])('reads ranges and the main app ZIP timestamp with a %s plist', async (format) => {
    const zip = new AdmZip();
    zip.addFile('Payload/App.app/PlugIns/Ext.appex/Info.plist', Buffer.from(plist.build({ CFBundleShortVersionString: 'wrong' })));
    const info = { CFBundleShortVersionString: '4.0', ReleaseDate: '2025-03-01' };
    zip.addFile('Payload/App.app/Info.plist', format === 'xml' ? Buffer.from(plist.build(info)) : bplistCreator(info));
    zip.getEntry('Payload/App.app/Info.plist')!.header.time = new Date(2020, 0, 2, 3, 4, 6);
    zip.addFile('Payload/App.app/padding', randomBytes(200000));
    const data = zip.toBuffer();
    const fetchMock = vi.fn(async (_url, options) => {
      const match = options.headers.Range.match(/^bytes=(\d+)-(\d+)$/)!;
      const start = Number(match[1]);
      const end = Number(match[2]);
      return new Response(data.subarray(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${data.length}` } });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await readRemoteVersionMetadata('https://apps.apple.com/test.ipa')).toEqual({ displayVersion: '4.0', date: modified.toISOString(), dateSource: 'file-modified' });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    const requestedBytes = fetchMock.mock.calls.reduce((sum, [, options]) => {
      const [, start, end] = options.headers.Range.match(/^bytes=(\d+)-(\d+)$/)!;
      return sum + Number(end) - Number(start) + 1;
    }, 0);
    expect(requestedBytes).toBeLessThan(data.length);
  });
  it('rejects servers which ignore Range', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('whole IPA', { status: 200 })));
    await expect(readRemoteVersionMetadata('https://apps.apple.com/test.ipa')).rejects.toThrow('Range');
  });
  it('rejects redirects outside package hosts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } })));
    await expect(readRemoteVersionMetadata('https://apps.apple.com/test.ipa')).rejects.toThrow('URL');
    expect(() => validateMetadataURL('https://apple.com.evil.example/test')).toThrow();
  });
});
