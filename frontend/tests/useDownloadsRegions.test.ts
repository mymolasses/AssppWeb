import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDownloads } from '../src/hooks/useDownloads';
import { useDownloadsStore } from '../src/store/downloads';
import { accountHash } from '../src/utils/account';
import type { Account } from '../src/types';

const mocks = vi.hoisted(() => ({ accounts: [{ email: 'test@example.test', directoryServicesIdentifier: '123', store: '143463-2,34' }], backfill: vi.fn(async () => ({ updated: 1 })), fetch: vi.fn(async () => []) }));
vi.mock('../src/hooks/useAccounts', () => ({ useAccounts: () => ({ accounts: mocks.accounts }) }));
vi.mock('../src/api/downloads', () => ({ backfillDownloadRegions: mocks.backfill, fetchDownloads: mocks.fetch }));
afterEach(() => { cleanup();vi.clearAllMocks(); });
it('automatically submits only owner hashes and storefronts without blocking saved packages', async () => {
  useDownloadsStore.setState({ tasks: [], accountHashes: [] });
  renderHook(useDownloads);
  await waitFor(() => expect(mocks.backfill).toHaveBeenCalled());
  expect(mocks.backfill).toHaveBeenCalledWith([{ accountHash: await accountHash(mocks.accounts[0] as Account), storefrontId: '143463-2,34' }]);
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
});
