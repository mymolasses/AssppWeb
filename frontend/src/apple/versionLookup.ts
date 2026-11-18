import { nativeStore, usesNativeStore } from './nativeStore';
import { withOperation } from '../store/operations';
import { apiPost } from '../api/client';
import { fetchStoreDownloadProduct } from './storeDownloadProduct';
import type { Account, Software, VersionMetadata } from '../types';

async function getVersionMetadataInternal(
  account: Account,
  app: Software,
  versionId: string,
): Promise<{ metadata: VersionMetadata; updatedCookies: typeof account.cookies }> {
  if (usesNativeStore(account)) {
    const result = await nativeStore('metadata', account, app, versionId);
    if (!result.metadata) throw new Error('Missing version metadata');
    return { metadata: result.metadata, updatedCookies: result.cookies ?? account.cookies };
  }
  const { dict, updatedCookies } = await fetchStoreDownloadProduct(account, app, versionId);
  if (dict.failureType) {
    throw new Error(dict.customerMessage || `Store error ${dict.failureType}`);
  }
  const songList = dict.songList as Record<string, any>[] | undefined;
  if (!songList?.length) throw new Error('No items in response');
  const item = songList[0];
  if (typeof item.URL !== 'string' || !item.URL) throw new Error('Missing IPA download URL');
  const metadata = await apiPost<VersionMetadata>('/api/apple/version-metadata', {
    downloadURL: item.URL,
  });
  return { metadata, updatedCookies };
}

export function getVersionMetadata(account: Account, app: Software, versionId: string) {
  return withOperation('metadata', () => getVersionMetadataInternal(account, app, versionId));
}
