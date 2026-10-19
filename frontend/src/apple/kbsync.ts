import { authHeaders } from '../api/client';
import type { Account } from '../types';

// Successful blobs live only in browser memory and are scoped to DSID + GUID.
// Token refreshes do not replace the key. Rejected blobs are removed explicitly.
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

function cacheKey(account: Account): string {
  return `${account.directoryServicesIdentifier}:${account.deviceIdentifier.toLowerCase()}`;
}

export function cachedKBSync(account: Account): string | undefined {
  return cache.get(cacheKey(account));
}

export function storeKBSync(account: Account, blob: string): void {
  const key = cacheKey(account);
  cache.delete(key);
  cache.set(key, blob);
  if (cache.size > 32) cache.delete(cache.keys().next().value!);
}

export function invalidateKBSync(account: Account, blob: string): void {
  const key = cacheKey(account);
  if (cache.get(key) === blob) cache.delete(key);
}

export async function generateKBSync(account: Account): Promise<string> {
  const key = cacheKey(account);
  const existing = pending.get(key);
  if (existing) return existing;
  const request = (async () => {
    const response = await fetch('/api/apple/kbsync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        deviceId: account.deviceIdentifier,
        dsid: account.directoryServicesIdentifier,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error('Download signature generation failed');
    const result = await response.json();
    if (
      typeof result.kbsync !== 'string' || !result.kbsync.length ||
      result.kbsync.length > 1024 * 1024 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result.kbsync)
    ) {
      throw new Error('Download signature response is invalid');
    }
    return result.kbsync as string;
  })();
  pending.set(key, request);
  try {
    return await request;
  } finally {
    if (pending.get(key) === request) pending.delete(key);
  }
}

export function entSerialNumber(deviceId: string): string {
  if (!/^[a-f0-9]{12}$/i.test(deviceId)) throw new Error('Invalid device identifier');
  const suffix = deviceId.slice(4).match(/../g)!.map((byte) => parseInt(byte, 16));
  return btoa(String.fromCharCode(0x54, 0xc8, 0xb0, 0xa9, 0x88, ...suffix));
}
