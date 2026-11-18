import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeStore } from '../../src/apple/nativeStore';
import type { Account, Software } from '../../src/types';

const saved = vi.hoisted(() => ({ accounts: [] as Account[], updateAccount: vi.fn(async () => {}) }));
vi.mock('../../src/api/client', () => ({ authHeaders: () => ({ 'X-Access-Token': 'fixture-site-token' }) }));
vi.mock('../../src/store/accounts', () => ({ useAccountsStore: { getState: () => saved } }));
const app = { id: 123, bundleID: 'fixture.app' } as Software;
describe('native Store boundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    saved.updateAccount.mockClear();
  });
  it('omits the login password and persists rotated state even on an Apple failure', async () => {
    const account = {
      email: 'fixture@example.invalid',
      password: 'never-send-this',
      passwordToken: 'fixture-token',
      directoryServicesIdentifier: '1',
      store: '143441',
      deviceIdentifier: 'aabbccddeeff',
      cookies: [],
      nativeState: 'b2xk',
    } as unknown as Account;
    saved.accounts = [account];
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ error: 'expired', errorCode: '2034', nativeState: 'bmV3' })));
    await expect(nativeStore('purchase', account, app)).rejects.toMatchObject({ code: '2034' });
    const input = JSON.parse(network.mock.calls[0][1]!.body as string);
    expect(input.account).not.toHaveProperty('password');
    expect(JSON.stringify(input)).not.toContain('never-send-this');
    expect(saved.updateAccount).toHaveBeenCalledWith(
      expect.objectContaining({ nativeState: 'bmV3', deviceIdentifier: 'aabbccddeeff' }),
    );
  });
});
