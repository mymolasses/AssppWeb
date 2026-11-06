import { beforeEach, expect, it, vi } from 'vitest';
import { getDownloadInfo } from '../../src/apple/download';
import type { Account, Software } from '../../src/types';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../../src/apple/storeDownloadProduct', () => ({ fetchStoreDownloadProduct: mocks.fetch }));
beforeEach(() => { vi.resetAllMocks(); });
const account = { email: 'test@example.com' } as Account;
const app = {} as Software;
function response(sinfs: unknown) {
  mocks.fetch.mockResolvedValue({ updatedCookies: [], dict: { songList: [{
    URL: 'https://iosapps.itunes.apple.com/test.ipa', metadata: { bundleShortVersionString: '7.52.0', bundleVersion: '2' }, sinfs,
  }] } });
}
it('preserves SINF byte data and Apple record order, including omitted IDs', async () => {
  response([{ id: 9, sinf: new Uint8Array([0, 128, 255]) }, { sinf: 'YQ==' }]);
  const { output } = await getDownloadInfo(account, app);
  expect(output.sinfs).toEqual([{ id: 9, sinf: 'AID/' }, { id: 0, sinf: 'YQ==' }]);
});
it.each([{}, [null], [{ id: 1 }], [{ id: 2, sinf: '%%%' }], [{ id: -1, sinf: 'YQ==' }]])('rejects malformed SINF instead of silently dropping it: %j', async value => {
  response(value);
  await expect(getDownloadInfo(account, app)).rejects.toThrow();
});
it.each([undefined, []])('permits device responses without SINF', async value => {
  response(value);
  expect((await getDownloadInfo(account, app)).output.sinfs).toEqual([]);
});
