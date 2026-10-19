import { apiPost } from '../api/client';
import { fetchStoreDownloadProduct } from './storeDownloadProduct';
import type { Account, Software, VersionMetadata } from '../types';

export async function getVersionMetadata(
  account: Account,
  app: Software,
  versionId: string,
): Promise<{ metadata: VersionMetadata; updatedCookies: typeof account.cookies }> {
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
