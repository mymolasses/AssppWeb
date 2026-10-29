import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchStoreDownloadProduct } from '../../src/apple/storeDownloadProduct';
import { appleRequest } from '../../src/apple/request';
import { fetchBag } from '../../src/apple/bag';
import { IOSCatalogAppNotFoundError, latestIOSVersionId } from '../../src/apple/platformVersion';
import { cachedKBSync, generateKBSync, invalidateKBSync, storeKBSync } from '../../src/apple/kbsync';
import { buildPlist, parsePlist } from '../../src/apple/plist';
import type { Account, Software } from '../../src/types';

vi.mock('../../src/apple/request', () => ({ appleRequest: vi.fn() }));
vi.mock('../../src/apple/bag', () => ({ fetchBag: vi.fn() }));
vi.mock('../../src/apple/platformVersion', async (original) => ({
  ...await original<typeof import('../../src/apple/platformVersion')>(), latestIOSVersionId: vi.fn(),
}));
vi.mock('../../src/apple/kbsync', () => ({
  cachedKBSync: vi.fn(), generateKBSync: vi.fn(), invalidateKBSync: vi.fn(),
  storeKBSync: vi.fn(), entSerialNumber: () => 'serial',
}));

const account = {
  email: 'test@example.com', passwordToken: 'private-token', store: '143441-1,29',
  directoryServicesIdentifier: '123', deviceIdentifier: 'aabbccddeeff', cookies: [], pod: '42',
} as unknown as Account;
const app = { id: 123456, bundleID: 'com.example.app' } as Software;
const entURL = 'https://downloaddispatch.itunes.apple.com/WebObjects/DownloadDispatch.woa/wa/ent/download';
const updateURL = 'https://downloaddispatch.itunes.apple.com/up/updateProduct';
const response = (dict: unknown, status = 200) => ({
  status, statusText: 'OK', headers: {}, rawHeaders: [], body: buildPlist(dict),
});
const product = (changes: Record<string, unknown> = {}) => response({
  songList: [{
    URL: 'https://cdn.apple.com/app.ipa',
    metadata: {
      itemId: app.id, softwareVersionBundleId: app.bundleID,
      softwareVersionExternalIdentifier: '98765', 'software-platform': 'ios', ...changes,
    },
  }],
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchBag).mockResolvedValue({ authURL: 'https://auth.itunes.apple.com/', entDownloadURL: entURL, updateProductURL: updateURL });
  vi.mocked(latestIOSVersionId).mockResolvedValue('98765');
  vi.mocked(generateKBSync).mockResolvedValue('AQID');
});

describe('preferred download and bounded recovery', () => {
  it('uses the exact version, account headers and hardware identity on ent/download', async () => {
    vi.mocked(appleRequest).mockResolvedValueOnce(product());
    const result = await fetchStoreDownloadProduct(account, app);
    expect(result.dict.songList[0].URL).toBe('https://cdn.apple.com/app.ipa');
    expect(appleRequest).toHaveBeenCalledOnce();
    const request = vi.mocked(appleRequest).mock.calls[0][0];
    expect(request.host).toBe('downloaddispatch.itunes.apple.com');
    expect(request.path).toBe('/WebObjects/DownloadDispatch.woa/wa/ent/download?guid=AABBCCDDEEFF');
    expect(request.headers).toMatchObject({
      'X-Token': account.passwordToken, 'X-Apple-Store-Front': account.store,
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    });
    expect(parsePlist(request.body!)).toMatchObject({
      guid: 'AABBCCDDEEFF', salableAdamId: String(app.id),
      externalVersionId: '98765', kbsync: 'AQID', serialNumber: 'serial',
    });
    expect(storeKBSync).toHaveBeenCalledWith(account, 'AQID');
  });

  it('does not look up or override a requested historical version', async () => {
    vi.mocked(appleRequest).mockResolvedValueOnce(product({ softwareVersionExternalIdentifier: '111' }));
    await fetchStoreDownloadProduct(account, app, '111');
    expect(latestIOSVersionId).not.toHaveBeenCalled();
    expect(parsePlist(vi.mocked(appleRequest).mock.calls[0][0].body!)).toMatchObject({ externalVersionId: '111' });
  });

  it('reuses a successful cached blob without generation', async () => {
    vi.mocked(cachedKBSync).mockReturnValue('BAUG');
    vi.mocked(appleRequest).mockResolvedValueOnce(product());
    await fetchStoreDownloadProduct(account, app, '98765');
    expect(generateKBSync).not.toHaveBeenCalled();
    expect(storeKBSync).toHaveBeenCalledWith(account, 'BAUG');
  });

  it('replaces a rejected cached blob once with fresh data', async () => {
    vi.mocked(cachedKBSync).mockReturnValue('BAUG');
    vi.mocked(appleRequest)
      .mockResolvedValueOnce(response({ failureType: '5002' }))
      .mockResolvedValueOnce(product());
    await fetchStoreDownloadProduct(account, app, '98765');
    expect(appleRequest).toHaveBeenCalledTimes(2);
    expect(generateKBSync).toHaveBeenCalledOnce();
    expect(invalidateKBSync).toHaveBeenCalledWith(account, 'BAUG');
    expect(storeKBSync).toHaveBeenCalledWith(account, 'AQID');
  });

  it('falls back to volumeStore after cached and fresh signatures both fail', async () => {
    vi.mocked(cachedKBSync).mockReturnValue('BAUG');
    vi.mocked(appleRequest)
      .mockResolvedValueOnce(response({ failureType: '5002' }))
      .mockResolvedValueOnce(response({ failureType: '5002' }))
      .mockResolvedValueOnce(product());
    await fetchStoreDownloadProduct(account, app, '98765');
    expect(appleRequest).toHaveBeenCalledTimes(3);
    expect(generateKBSync).toHaveBeenCalledOnce();
    expect(storeKBSync).not.toHaveBeenCalled();
    const last = vi.mocked(appleRequest).mock.calls[2][0];
    expect(last.host).toBe('p42-buy.itunes.apple.com');
    expect(last.headers?.['X-Token']).toBeUndefined();
    expect(parsePlist(last.body!)).toMatchObject({ externalVersionId: '98765' });
  });

  it('retains legacy operation when native generation is unavailable', async () => {
    vi.mocked(generateKBSync).mockRejectedValue(new Error('unavailable'));
    vi.mocked(appleRequest).mockResolvedValueOnce(product());
    await fetchStoreDownloadProduct(account, app, '98765');
    expect(appleRequest).toHaveBeenCalledOnce();
    expect(vi.mocked(appleRequest).mock.calls[0][0].host).toBe('p42-buy.itunes.apple.com');
  });

  it('never forwards X-Token on an ent/download redirect', async () => {
    vi.mocked(appleRequest)
      .mockResolvedValueOnce({ ...response({}), status: 302, headers: { location: 'https://p43-buy.itunes.apple.com/redirect' } })
      .mockResolvedValueOnce(product());
    await fetchStoreDownloadProduct(account, app, '98765');
    expect(appleRequest).toHaveBeenCalledTimes(2);
    expect(vi.mocked(appleRequest).mock.calls[1][0].headers?.['X-Token']).toBeUndefined();
    expect(vi.mocked(appleRequest).mock.calls[1][0].path).toContain('volumeStoreDownloadProduct');
  });

  it.each([
    { itemId: 1 }, { softwareVersionBundleId: 'com.other.app' },
    { softwareVersionExternalIdentifier: '111' }, { 'software-platform': 'tvos' },
  ])('does not accept or cache a mismatched preferred response %j', async (changes) => {
    vi.mocked(appleRequest).mockResolvedValueOnce(product(changes)).mockResolvedValueOnce(product());
    await fetchStoreDownloadProduct(account, app, '98765');
    expect(storeKBSync).not.toHaveBeenCalled();
    expect(appleRequest).toHaveBeenCalledTimes(2);
  });

  it.each([
    'http://downloaddispatch.itunes.apple.com/WebObjects/DownloadDispatch.woa/wa/ent/download',
    `${entURL}?extra=1`,
    entURL.replace('downloaddispatch.itunes.apple.com', 'attacker.example'),
  ])('does not generate or send a blob to an invalid bag endpoint %s', async (entDownloadURL) => {
    vi.mocked(fetchBag).mockResolvedValue({ authURL: '', entDownloadURL });
    vi.mocked(appleRequest).mockResolvedValueOnce(product());
    await fetchStoreDownloadProduct(account, app, '98765');
    expect(generateKBSync).not.toHaveBeenCalled();
    expect(cachedKBSync).not.toHaveBeenCalled();
  });

  it('recovers through all legacy endpoints with a pinned version and retained cookies', async () => {
    vi.mocked(fetchBag).mockResolvedValue({ authURL: '', updateProductURL: updateURL });
    vi.mocked(appleRequest)
      .mockResolvedValueOnce({ ...response({ songList: [] }), rawHeaders: [['set-cookie', 'session=new; Domain=.itunes.apple.com; Path=/; Secure']] })
      .mockResolvedValueOnce({ ...response({}), status: 500, body: '' })
      .mockResolvedValueOnce(product());
    await fetchStoreDownloadProduct(account, app);
    expect(latestIOSVersionId).toHaveBeenCalledOnce();
    const request = vi.mocked(appleRequest).mock.calls[2][0];
    expect(request.path).toContain('/up/updateProduct');
    expect(parsePlist(request.body!)).toMatchObject({ appExtVrsId: '98765' });
    expect(request.cookies).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'session', value: 'new' })]));
  });

  it.each(['No Longer Available', 'This app is no longer available'])('recovers availability failures: %s', async (customerMessage) => {
    vi.mocked(fetchBag).mockResolvedValue({ authURL: '', updateProductURL: updateURL });
    vi.mocked(appleRequest)
      .mockResolvedValueOnce(response({ customerMessage }))
      .mockResolvedValueOnce(response({ customerMessage }))
      .mockResolvedValueOnce(product());
    await fetchStoreDownloadProduct(account, app, '98765');
    expect(appleRequest).toHaveBeenCalledTimes(3);
  });

  it('rejects a mismatched update response', async () => {
    vi.mocked(fetchBag).mockResolvedValue({ authURL: '', updateProductURL: updateURL });
    vi.mocked(appleRequest)
      .mockResolvedValueOnce(response({ songList: [] }))
      .mockResolvedValueOnce({ ...response({}), status: 500, body: '' })
      .mockResolvedValueOnce(product({ softwareVersionExternalIdentifier: '111' }));
    await expect(fetchStoreDownloadProduct(account, app, '98765')).rejects.toThrow('requested app or version');
  });

  it('retains structured auth failures after exhausting legacy recovery', async () => {
    vi.mocked(fetchBag).mockResolvedValue({ authURL: '', updateProductURL: updateURL });
    vi.mocked(appleRequest)
      .mockResolvedValueOnce(response({ songList: [] }))
      .mockResolvedValueOnce({ ...response({}), status: 500, body: '' })
      .mockResolvedValueOnce(response({ failureType: '2034' }));
    const result = await fetchStoreDownloadProduct(account, app, '98765');
    expect(result.dict.failureType).toBe('2034');
  });

  it('terminates empty responses after one attempt per legacy endpoint', async () => {
    vi.mocked(fetchBag).mockResolvedValue({ authURL: '', updateProductURL: updateURL });
    vi.mocked(appleRequest).mockResolvedValue(response({ songList: [] }));
    await expect(fetchStoreDownloadProduct(account, app, '98765')).rejects.toThrow();
    expect(appleRequest).toHaveBeenCalledTimes(3);
  });
});


describe('delisted iOS recovery (ipatool 7578671)', () => {
  it('tries exactly one unpinned redownload in the same account after confirmed catalog absence', async () => {
    vi.mocked(latestIOSVersionId).mockRejectedValue(new IOSCatalogAppNotFoundError());
    vi.mocked(appleRequest)
      .mockResolvedValueOnce({ ...response({ songList: [] }), rawHeaders: [['set-cookie', 'session=new; Domain=.itunes.apple.com; Path=/; Secure']] })
      .mockResolvedValueOnce(product());
    const result = await fetchStoreDownloadProduct(account, app);
    expect(result.dict.songList[0].URL).toBeTruthy();
    expect(latestIOSVersionId).toHaveBeenCalledOnce();
    expect(generateKBSync).not.toHaveBeenCalled();
    const calls = vi.mocked(appleRequest).mock.calls;
    expect(calls).toHaveLength(2);
    const req = calls[1][0];
    expect(req.path).toContain('/r/redownload');
    expect(req.headers?.['X-Dsid']).toBe(account.directoryServicesIdentifier);
    expect(req.headers?.['X-Token']).toBeUndefined();
    expect(parsePlist(req.body!)).not.toHaveProperty('appExtVrsId');
    expect(parsePlist(req.body!)).not.toHaveProperty('externalVersionId');
    expect(req.cookies).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'session', value: 'new' })]));
  });

  it.each([new Error('HTTP 500'), new Error('invalid metadata'), new Error('connection reset')])('does not treat other catalog failures as delisting: %s', async (error) => {
    vi.mocked(fetchBag).mockResolvedValue({ authURL: '' });
    vi.mocked(latestIOSVersionId).mockRejectedValue(error);
    vi.mocked(appleRequest).mockResolvedValueOnce(response({ songList: [] }));
    await expect(fetchStoreDownloadProduct(account, app)).rejects.toThrow(error.message);
    expect(appleRequest).toHaveBeenCalledOnce();
  });

  it.each([
    { itemId: 99 }, { softwareVersionBundleId: 'com.other.app' },
    { softwareVersionBundleId: undefined }, { 'software-platform': 'tvos' },
  ])('rejects an unpinned redownload identity/platform mismatch %j', async (changes) => {
    vi.mocked(fetchBag).mockResolvedValue({ authURL: '', updateProductURL: updateURL });
    vi.mocked(latestIOSVersionId).mockRejectedValue(new IOSCatalogAppNotFoundError());
    vi.mocked(appleRequest).mockResolvedValueOnce(response({ songList: [] })).mockResolvedValueOnce(product(changes));
    await expect(fetchStoreDownloadProduct(account, app)).rejects.toThrow();
    expect(appleRequest).toHaveBeenCalledTimes(2);
  });

  it.each(['2034', '2042', '9610'])('keeps auth/license failure %s for existing recovery', async (failureType) => {
    vi.mocked(fetchBag).mockResolvedValue({ authURL: '' });
    vi.mocked(latestIOSVersionId).mockRejectedValue(new IOSCatalogAppNotFoundError());
    vi.mocked(appleRequest).mockResolvedValueOnce(response({ songList: [] })).mockResolvedValueOnce(response({ failureType }));
    expect((await fetchStoreDownloadProduct(account, app)).dict.failureType).toBe(failureType);
    expect(appleRequest).toHaveBeenCalledTimes(2);
  });

  it.each([response({ songList: [] }), response({}, 500), response({ customerMessage: 'App No Longer Available' }), response({ songList: [{ metadata: { itemId: app.id, softwareVersionBundleId: app.bundleID } }] })])('terminates invalid unpinned responses without updateProduct', async (last) => {
    vi.mocked(fetchBag).mockResolvedValue({ authURL: '', updateProductURL: updateURL });
    vi.mocked(latestIOSVersionId).mockRejectedValue(new IOSCatalogAppNotFoundError());
    vi.mocked(appleRequest).mockResolvedValueOnce(response({ songList: [] })).mockResolvedValueOnce(last);
    await expect(fetchStoreDownloadProduct(account, app)).rejects.toThrow();
    expect(appleRequest).toHaveBeenCalledTimes(2);
  });
});
