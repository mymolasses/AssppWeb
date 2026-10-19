import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../../src/types';

vi.mock('../../src/api/client', () => ({ authHeaders: () => ({ 'X-Access-Token': 'site-access' }) }));
let signatures: typeof import('../../src/apple/kbsync');
const account = {
  email: 'test@example.com', password: 'private', passwordToken: 'private-token',
  directoryServicesIdentifier: '123', deviceIdentifier: 'aabbccddeeff', cookies: [],
} as unknown as Account;

beforeEach(async () => {
  vi.resetModules();
  signatures = await import('../../src/apple/kbsync');
});
afterEach(() => vi.unstubAllGlobals());

describe('browser kbsync generation and cache', () => {
  it('sends only DSID/device identity with site auth and does not cache unvalidated blobs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ kbsync: 'AQID' })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(signatures.generateKBSync(account)).resolves.toBe('AQID');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/apple/kbsync');
    expect(JSON.parse(options.body)).toEqual({ dsid: '123', deviceId: 'aabbccddeeff' });
    expect(options.headers['X-Access-Token']).toBe('site-access');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(signatures.cachedKBSync(account)).toBeUndefined();
  });

  it('shares in-flight generation for the same account/device pair', async () => {
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal('fetch', fetchMock);
    const first = signatures.generateKBSync(account);
    const second = signatures.generateKBSync(account);
    resolve(new Response(JSON.stringify({ kbsync: 'AQID' })));
    await expect(Promise.all([first, second])).resolves.toEqual(['AQID', 'AQID']);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('keeps successful blobs across token refreshes, isolated by DSID and GUID', () => {
    signatures.storeKBSync(account, 'AQID');
    expect(signatures.cachedKBSync({ ...account, passwordToken: 'renewed' })).toBe('AQID');
    expect(signatures.cachedKBSync({ ...account, directoryServicesIdentifier: '456' })).toBeUndefined();
    expect(signatures.cachedKBSync({ ...account, deviceIdentifier: '112233445566' })).toBeUndefined();
    expect(signatures.cachedKBSync({ ...account, deviceIdentifier: 'AABBCCDDEEFF' })).toBe('AQID');
  });

  it('invalidates only the rejected blob and preserves a newer one', () => {
    signatures.storeKBSync(account, 'AQID');
    signatures.storeKBSync(account, 'BAUG');
    signatures.invalidateKBSync(account, 'AQID');
    expect(signatures.cachedKBSync(account)).toBe('BAUG');
    signatures.invalidateKBSync(account, 'BAUG');
    expect(signatures.cachedKBSync(account)).toBeUndefined();
  });

  it.each(['', '%%%'])('rejects invalid generator output %s', async (kbsync) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ kbsync }))));
    await expect(signatures.generateKBSync(account)).rejects.toThrow('invalid');
  });

  it('constructs the same hardware-based serial bytes as ipatool', () => {
    expect(Array.from(atob(signatures.entSerialNumber('aabbccddeeff')), (c) => c.charCodeAt(0)))
      .toEqual([0x54, 0xc8, 0xb0, 0xa9, 0x88, 0xcc, 0xdd, 0xee, 0xff]);
  });
});
