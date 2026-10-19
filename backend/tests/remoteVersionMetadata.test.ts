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
  it.each(['xml', 'binary'])('reads %s plist release date ahead of ZIP modification date', (format) => {
    const info = { CFBundleShortVersionString: '3.2', releaseDate: '2024-04-02T12:00:00Z' };
    const data = format === 'xml' ? Buffer.from(plist.build(info)) : bplistCreator(info);
    expect(metadataFromPlist(data, modified)).toEqual({ displayVersion: '3.2', date: new Date(info.releaseDate).toISOString(), dateSource: 'info-plist' });
  });
  it('labels file modification fallback separately', () => {
    expect(metadataFromPlist(Buffer.from(plist.build({ CFBundleShortVersionString: '2.1' })), modified))
      .toEqual({ displayVersion: '2.1', date: modified.toISOString(), dateSource: 'file-modified' });
  });
  it('rejects malformed explicit dates instead of hiding them with fallback', () => {
    expect(() => metadataFromPlist(Buffer.from(plist.build({ CFBundleShortVersionString: '1', releaseDate: 'invalid' })), modified)).toThrow();
  });
  it('reads only ranges and selects the main app rather than extension plist', async () => {
    const zip = new AdmZip();
    zip.addFile('Payload/App.app/PlugIns/Ext.appex/Info.plist', Buffer.from(plist.build({ CFBundleShortVersionString: 'wrong' })));
    zip.addFile('Payload/App.app/Info.plist', Buffer.from(plist.build({ CFBundleShortVersionString: '4.0', ReleaseDate: '2025-03-01' })));
    zip.addFile('Payload/App.app/padding', randomBytes(200000));
    const data = zip.toBuffer();
    const fetchMock = vi.fn(async (_url, options) => {
      const match = options.headers.Range.match(/^bytes=(\d+)-(\d+)$/)!;
      const start = Number(match[1]);
      const end = Number(match[2]);
      return new Response(data.subarray(start, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${data.length}` } });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await readRemoteVersionMetadata('https://apps.apple.com/test.ipa')).toEqual({ displayVersion: '4.0', date: '2025-03-01T00:00:00.000Z', dateSource: 'info-plist' });
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
