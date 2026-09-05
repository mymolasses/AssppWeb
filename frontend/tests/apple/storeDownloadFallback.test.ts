import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, Software } from '../../src/types';
import {
  getDownloadInfo,
  isDownloadAuthExpired,
} from '../../src/apple/download';
import { purchaseApp } from '../../src/apple/purchase';
import { listVersions } from '../../src/apple/versionFinder';
import { getVersionMetadata } from '../../src/apple/versionLookup';
import { appleRequest } from '../../src/apple/request';
import { buildPlist, parsePlist } from '../../src/apple/plist';
import { shouldUseRedownload } from '../../src/apple/storeDownloadFallback';

vi.mock('../../src/apple/request', () => ({
  appleRequest: vi.fn(),
}));

const account: Account = {
  email: 'test@example.com',
  password: 'password',
  appleId: 'test@example.com',
  store: '143441',
  firstName: 'Test',
  lastName: 'User',
  passwordToken: 'token',
  directoryServicesIdentifier: '123',
  cookies: [],
  deviceIdentifier: 'aabbccddeeff',
  pod: '42',
};

const app: Software = {
  id: 123456,
  bundleID: 'com.example.app',
  name: 'Example',
  version: '1.0',
  artistName: 'Example Inc.',
  sellerName: 'Example Inc.',
  description: 'Example app',
  averageUserRating: 0,
  userRatingCount: 0,
  artworkUrl: '',
  screenshotUrls: [],
  minimumOsVersion: '15.0',
  releaseDate: '2026-06-12T00:00:00Z',
  primaryGenreName: 'Utilities',
};

function response(body: Record<string, any>) {
  return {
    status: 200,
    statusText: 'OK',
    headers: {},
    rawHeaders: [],
    body: buildPlist(body),
  };
}

function failure5002() {
  return response({ failureType: '5002' });
}

describe('apple store download fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retries downloads through redownload and uses appExtVrsId', async () => {
    vi.mocked(appleRequest)
      .mockResolvedValueOnce(failure5002())
      .mockResolvedValueOnce(
        response({
          songList: [
            {
              URL: 'https://example.com/app.ipa',
              metadata: {
                bundleShortVersionString: '2.0',
                bundleVersion: '200',
              },
              sinfs: [{ id: 1, sinf: new Uint8Array([1, 2, 3]) }],
            },
          ],
        }),
      );

    const result = await getDownloadInfo(account, app, '98765');

    expect(result.output.downloadURL).toBe('https://example.com/app.ipa');
    expect(appleRequest).toHaveBeenCalledTimes(2);
    expect(vi.mocked(appleRequest).mock.calls[0][0].host).toBe(
      'p42-buy.itunes.apple.com',
    );
    expect(vi.mocked(appleRequest).mock.calls[1][0].host).toBe(
      'downloaddispatch.itunes.apple.com',
    );
    expect(vi.mocked(appleRequest).mock.calls[1][0].path).toBe(
      '/r/redownload?guid=aabbccddeeff',
    );

    const retryPayload = parsePlist(
      vi.mocked(appleRequest).mock.calls[1][0].body ?? '',
    ) as Record<string, any>;
    expect(retryPayload.appExtVrsId).toBe('98765');
    expect(retryPayload.externalVersionId).toBeUndefined();
  });

  it('retries version lists through redownload after 5002', async () => {
    vi.mocked(appleRequest)
      .mockResolvedValueOnce(failure5002())
      .mockResolvedValueOnce(
        response({
          songList: [
            {
              metadata: {
                softwareVersionExternalIdentifiers: [111, 222],
              },
            },
          ],
        }),
      );

    const result = await listVersions(account, app);

    expect(result.versions).toEqual(['222', '111']);
    expect(vi.mocked(appleRequest).mock.calls[1][0].host).toBe(
      'downloaddispatch.itunes.apple.com',
    );
  });

  it('requests reauthentication only after both download endpoints return 5002', async () => {
    vi.mocked(appleRequest)
      .mockResolvedValueOnce(failure5002())
      .mockResolvedValueOnce(failure5002());

    const error = await getDownloadInfo(account, app).catch((error) => error);

    expect(error).toMatchObject({ code: '5002' });
    expect(isDownloadAuthExpired(error)).toBe(true);
    expect(appleRequest).toHaveBeenCalledTimes(2);
  });

  it('does not classify a missing license as an expired session', async () => {
    vi.mocked(appleRequest).mockResolvedValueOnce(
      response({ failureType: '9610' }),
    );

    const error = await getDownloadInfo(account, app).catch((error) => error);

    expect(error).toMatchObject({ code: '9610' });
    expect(isDownloadAuthExpired(error)).toBe(false);
    expect(appleRequest).toHaveBeenCalledOnce();
  });

  it('does not retry a native Mac purchase with Apple Arcade pricing', async () => {
    vi.mocked(appleRequest).mockResolvedValueOnce(
      response({ failureType: '2059' }),
    );

    await expect(
      purchaseApp(account, { ...app, kind: 'mac-software' }),
    ).rejects.toMatchObject({ code: '2059' });
    expect(appleRequest).toHaveBeenCalledOnce();
  });

  it('retains the Apple Arcade pricing fallback for iOS purchases', async () => {
    vi.mocked(appleRequest)
      .mockResolvedValueOnce(response({ failureType: '2059' }))
      .mockResolvedValueOnce(
        response({ jingleDocType: 'purchaseSuccess', status: 0 }),
      );

    await purchaseApp(account, app);

    const payload = parsePlist(
      vi.mocked(appleRequest).mock.calls[1][0].body!,
    ) as Record<string, unknown>;
    expect(payload.pricingParameters).toBe('GAME');
    expect(appleRequest).toHaveBeenCalledTimes(2);
  });

  it('retries version metadata through redownload and switches version id key', async () => {
    vi.mocked(appleRequest)
      .mockResolvedValueOnce(failure5002())
      .mockResolvedValueOnce(
        response({
          songList: [
            {
              metadata: {
                bundleShortVersionString: '3.0',
                releaseDate: '2026-06-12T00:00:00Z',
              },
            },
          ],
        }),
      );

    const result = await getVersionMetadata(account, app, '55555');

    expect(result.metadata.displayVersion).toBe('3.0');
    const retryPayload = parsePlist(
      vi.mocked(appleRequest).mock.calls[1][0].body ?? '',
    ) as Record<string, any>;
    expect(retryPayload.appExtVrsId).toBe('55555');
    expect(retryPayload.externalVersionId).toBeUndefined();
  });
});

const operations = [
  { name: 'download', run: () => getDownloadInfo(account, app, '98765') },
  { name: 'version list', run: () => listVersions(account, app) },
  {
    name: 'version metadata',
    run: () => getVersionMetadata(account, app, '98765'),
  },
];

function productResponse() {
  return response({
    songList: [
      {
        URL: 'https://example.com/app.ipa',
        metadata: {
          bundleShortVersionString: '2.0',
          bundleVersion: '200',
          softwareVersionExternalIdentifiers: [123, 98765],
          releaseDate: '2026-09-03T00:00:00Z',
        },
        sinfs: [{ id: 1, sinf: new Uint8Array([1, 2, 3]) }],
      },
    ],
  });
}

describe('empty volumeStore response regression (ipatool #538)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  for (const operation of operations) {
    it.each([{ songList: [] }, { failureType: '', customerMessage: '' }])(
      `recovers ${operation.name} through redownload for %j`,
      async (body) => {
        vi.mocked(appleRequest)
          .mockResolvedValueOnce(response(body))
          .mockResolvedValueOnce(productResponse());

        const result = await operation.run();

        expect(result).toBeDefined();
        expect(appleRequest).toHaveBeenCalledTimes(2);
        const fallback = vi.mocked(appleRequest).mock.calls[1][0];
        expect(fallback.host).toBe('downloaddispatch.itunes.apple.com');
        const payload = parsePlist(fallback.body!) as Record<string, unknown>;
        expect(payload.salableAdamId).toBe(app.id);
        expect(payload.serialNumber).toBe('0');
        expect(payload.externalVersionId).toBeUndefined();
        if (operation.name !== 'version list')
          expect(payload.appExtVrsId).toBe('98765');
        if ('versions' in result)
          expect(result.versions).toEqual(['98765', '123']);
        if ('metadata' in result)
          expect(result.metadata.displayVersion).toBe('2.0');
        if ('output' in result)
          expect(result.output.downloadURL).toBe('https://example.com/app.ipa');
      },
    );

    it(`does not loop when redownload also returns no items (${operation.name})`, async () => {
      vi.mocked(appleRequest).mockResolvedValue(response({ songList: [] }));
      await expect(operation.run()).rejects.toBeInstanceOf(Error);
      expect(appleRequest).toHaveBeenCalledTimes(2);
    });

    it.each([
      { status: 403, body: {} },
      { status: 500, body: {} },
      {
        status: 200,
        body: { failureType: '9610', customerMessage: 'License required' },
      },
      { status: 200, body: { customerMessage: 'Accept the updated terms' } },
    ])(
      `does not hide a real failure with an empty-response retry (${operation.name}, %j)`,
      async ({ status, body }) => {
        vi.mocked(appleRequest).mockResolvedValueOnce({
          ...response(body),
          status,
        });
        await expect(operation.run()).rejects.toBeInstanceOf(Error);
        expect(appleRequest).toHaveBeenCalledOnce();
      },
    );
  }

  it('preserves cookies and the selected version across a fallback pod redirect', async () => {
    vi.mocked(appleRequest)
      .mockResolvedValueOnce({
        ...response({ songList: [] }),
        rawHeaders: [
          [
            'set-cookie',
            'store-session=updated; Domain=.itunes.apple.com; Path=/; Secure',
          ],
        ],
      })
      .mockResolvedValueOnce({
        ...response({}),
        status: 302,
        headers: {
          location:
            'https://p42-buy.itunes.apple.com/r/redownload?guid=aabbccddeeff',
        },
      })
      .mockResolvedValueOnce(productResponse());

    await getVersionMetadata(account, app, '98765');

    const final = vi.mocked(appleRequest).mock.calls[2][0];
    expect(final.host).toBe('p42-buy.itunes.apple.com');
    expect(final.cookies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'store-session', value: 'updated' }),
      ]),
    );
    expect(parsePlist(final.body!)).toMatchObject({ appExtVrsId: '98765' });
    expect(appleRequest).toHaveBeenCalledTimes(3);
  });

  it('does not fall back for populated or malformed item lists', () => {
    expect(shouldUseRedownload(200, { songList: [{}] })).toBe(false);
    expect(shouldUseRedownload(200, { songList: 'unexpected' })).toBe(false);
  });
});
