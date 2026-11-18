import { authHeaders } from '../api/client';
import type { Account, Cookie, Software } from '../types';

export class NativeStoreError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'NativeStoreError';
  }
}
interface StoreResult {
  error?: string;
  errorCode?: string;
  cacheState?: string;
  nativeState?: string;
  cookies?: Cookie[];
  storefront?: string;
  storeCountry?: string;
  plist?: string;
  alreadyOwned?: boolean;
  versions?: string[];
  metadata?: { displayVersion: string; date: string; dateSource: 'package' };
}

export function usesNativeStore(account: Account) {
  return account.authMethod === 'native';
}

const accountQueues = new Map<string, Promise<unknown>>();
const signatureCache = new Map<string, string>();
const cacheEpoch = new Map<string, number>();
export function clearNativeStoreCache(account: Account) {
  const key = account.email.toLowerCase() + ':' + account.deviceIdentifier;
  signatureCache.delete(key);
  cacheEpoch.set(key, (cacheEpoch.get(key) ?? 0) + 1);
}
export function nativeStore(
  operation: string,
  account: Account,
  app: Software,
  versionId?: string,
): Promise<StoreResult> {
  const key = account.email.toLowerCase() + ':' + account.deviceIdentifier;
  const pending = (accountQueues.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(() => sendNativeStore(operation, account, app, versionId));
  accountQueues.set(key, pending);
  const clear = () => {
    if (accountQueues.get(key) === pending) accountQueues.delete(key);
  };
  pending.then(clear, clear);
  return pending;
}

async function sendNativeStore(
  operation: string,
  account: Account,
  app: Software,
  versionId?: string,
): Promise<StoreResult> {
  const cacheKey = account.email.toLowerCase() + ':' + account.deviceIdentifier;
  const epoch = cacheEpoch.get(cacheKey) ?? 0;
  const { useAccountsStore } = await import('../store/accounts');
  const latest = useAccountsStore
    .getState()
    .accounts.find((saved) => saved.email === account.email && saved.deviceIdentifier === account.deviceIdentifier);
  if (latest) {
    if (latest.authMethod === 'browser')
      throw new NativeStoreError('Account sign-in method changed; retry the operation');
    account.nativeState = latest.nativeState;
    account.cookies = latest.cookies;
    account.store = latest.store;
    account.passwordToken = latest.passwordToken;
    account.directoryServicesIdentifier = latest.directoryServicesIdentifier;
  }
  const response = await fetch('/api/apple/store', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operation,
      account: {
        email: account.email,
        passwordToken: account.passwordToken,
        directoryServicesIdentifier: account.directoryServicesIdentifier,
        store: account.store,
        pod: account.pod,
        cookies: account.cookies,
        deviceIdentifier: account.deviceIdentifier,
        nativeState: account.nativeState,
      },
      app,
      versionId,
      cacheState: signatureCache.get(cacheKey),
    }),
    signal: AbortSignal.timeout(290_000),
  });
  const result = (await response.json()) as StoreResult;
  if (epoch !== (cacheEpoch.get(cacheKey) ?? 0))
    throw new NativeStoreError('Account state changed while waiting; the result was discarded');
  if (epoch === (cacheEpoch.get(cacheKey) ?? 0)) {
    if (result.cacheState) signatureCache.set(cacheKey, result.cacheState);
    else signatureCache.delete(cacheKey);
  }
  // Apply rotated state even on structured failures; callers persist the account
  // alongside the returned cookies. Never send a stored login password here.
  if (result.nativeState) account.nativeState = result.nativeState;
  if (result.storefront && result.storefront !== account.store) {
    account.store = result.storefront;
    account.storeCountry = undefined;
  }
  if (result.storeCountry) account.storeCountry = result.storeCountry;
  if (result.cookies) account.cookies = result.cookies;
  if (result.nativeState || result.storefront || result.cookies) {
    const state = useAccountsStore.getState();
    if (
      state.accounts.some(
        (saved) =>
          saved.email === account.email &&
          saved.deviceIdentifier === account.deviceIdentifier &&
          saved.passwordToken === account.passwordToken,
      )
    )
      await state.updateAccount({ ...account });
  }
  if (result.error || !response.ok)
    throw new NativeStoreError(result.error || 'Store operation failed', result.errorCode);
  return result;
}
