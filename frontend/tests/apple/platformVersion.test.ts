import { beforeEach, describe, expect, it, vi } from 'vitest';
import { latestIOSVersionId } from '../../src/apple/platformVersion';
import { appleRequest } from '../../src/apple/request';
import type { Account, Software } from '../../src/types';

vi.mock('../../src/apple/request', () => ({ appleRequest: vi.fn() }));
const account = { store: '143441-1,29' } as Account;
const app = { id: 123, bundleID: 'com.example.app' } as Software;
const response = (data: unknown, status = 200) => ({
  status, statusText: 'OK', headers: {}, rawHeaders: [], body: JSON.stringify(data),
});
const mdm = (offer: unknown) => response({
  results: { 123: { bundleId: app.bundleID, offers: [offer] } },
});
const catalog = (changes: Record<string, unknown> = {}, families = ['iphone']) => response({
  data: [{
    id: '123', type: 'apps', attributes: {
      deviceFamilies: families,
      platformAttributes: { ios: { bundleId: app.bundleID, externalVersionId: '98765', ...changes } },
    },
  }],
});

beforeEach(() => vi.resetAllMocks());

describe('iOS version catalogs', () => {
  it.each([12345, '12345'])('reads enterprise externalId %s without sending credentials', async (externalId) => {
    vi.mocked(appleRequest).mockResolvedValueOnce(mdm({ version: { externalId } }));
    await expect(latestIOSVersionId(account, app)).resolves.toBe('12345');
    const request = vi.mocked(appleRequest).mock.calls[0][0];
    expect(request.host).toBe('uclient-api.itunes.apple.com');
    const query = new URL(`https://${request.host}${request.path}`).searchParams;
    expect(query.get('platform')).toBe('ios');
    expect(query.get('cc')).toBe('us');
    expect(request.cookies).toBeUndefined();
    expect(request.headers).toBeUndefined();
  });

  it('reads buyParams when the version field is absent', async () => {
    vi.mocked(appleRequest).mockResolvedValueOnce(mdm({ buyParams: 'appExtVrsId=98765' }));
    await expect(latestIOSVersionId(account, app)).resolves.toBe('98765');
  });

  it('falls back across ios, iphone, ipad in the same account region', async () => {
    vi.mocked(appleRequest)
      .mockResolvedValueOnce(response({ results: {} }))
      .mockResolvedValueOnce(response({ results: { 123: {} } }))
      .mockResolvedValueOnce(mdm({ version: { externalId: 98765 } }));
    await expect(latestIOSVersionId(account, app)).resolves.toBe('98765');
    const params = vi.mocked(appleRequest).mock.calls.map(([r]) => new URL(`https://${r.host}${r.path}`).searchParams);
    expect(params.map((q) => q.get('platform'))).toEqual(['ios', 'iphone', 'ipad']);
    expect(params.map((q) => q.get('cc'))).toEqual(['us', 'us', 'us']);
  });

  it('resolves Arcade versions through the public catalog after all MDM catalogs are empty', async () => {
    vi.mocked(appleRequest)
      .mockResolvedValueOnce(response({ results: {} }))
      .mockResolvedValueOnce(response({ results: {} }))
      .mockResolvedValueOnce(response({ results: { 123: { offers: [] } } }))
      .mockResolvedValueOnce(catalog());
    await expect(latestIOSVersionId(account, app)).resolves.toBe('98765');
    const request = vi.mocked(appleRequest).mock.calls[3][0];
    expect(request.host).toBe('apps.apple.com');
    expect(request.path).toBe('/api/apps/v1/catalog/us/apps/123?platform=iphone');
    expect(request.cookies).toBeUndefined();
    expect(request.headers).toBeUndefined();
  });

  it('can resolve an iPad-only consumer offer', async () => {
    vi.mocked(appleRequest)
      .mockResolvedValueOnce(response({ results: {} }))
      .mockResolvedValueOnce(response({ results: {} }))
      .mockResolvedValueOnce(response({ results: {} }))
      .mockResolvedValueOnce(catalog({}, ['ipad']))
      .mockResolvedValueOnce(catalog({}, ['ipad']));
    await expect(latestIOSVersionId(account, app)).resolves.toBe('98765');
    expect(vi.mocked(appleRequest).mock.calls[4][0].path).toContain('platform=ipad');
  });

  it.each([
    { bundleId: 'com.other.app' },
    { externalVersionId: 'not-a-number' },
  ])('rejects wrong consumer metadata %j', async (changes) => {
    vi.mocked(appleRequest)
      .mockResolvedValueOnce(response({ results: {} }))
      .mockResolvedValueOnce(response({ results: {} }))
      .mockResolvedValueOnce(response({ results: {} }))
      .mockResolvedValueOnce(catalog(changes));
    await expect(latestIOSVersionId(account, app)).rejects.toThrow();
    expect(appleRequest).toHaveBeenCalledTimes(4);
  });

  it.each([0, 'invalid', 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid MDM version %s', async (externalId) => {
    vi.mocked(appleRequest).mockResolvedValueOnce(mdm({ version: { externalId } }));
    await expect(latestIOSVersionId(account, app)).rejects.toThrow('valid version identifier');
    expect(appleRequest).toHaveBeenCalledOnce();
  });

  it('does not hide transport or HTTP errors with more catalog requests', async () => {
    vi.mocked(appleRequest).mockResolvedValueOnce(response({}, 403));
    await expect(latestIOSVersionId(account, app)).rejects.toThrow('HTTP 403');
    expect(appleRequest).toHaveBeenCalledOnce();
  });

  it('does not request an iOS version for native Mac apps', async () => {
    await expect(latestIOSVersionId(account, { ...app, kind: 'mac-software' })).rejects.toThrow('Mac');
    expect(appleRequest).not.toHaveBeenCalled();
  });
});
