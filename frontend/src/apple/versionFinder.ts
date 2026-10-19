import { fetchStoreDownloadProduct } from './storeDownloadProduct';
import type { Account, Software } from '../types';

export async function listVersions(
  account: Account,
  app: Software,
): Promise<{ versions: string[]; updatedCookies: typeof account.cookies }> {
  const { dict, updatedCookies } = await fetchStoreDownloadProduct(account, app);
  if (dict.failureType) {
    throw new Error(dict.customerMessage || `Store error ${dict.failureType}`);
  }
  const songList = dict.songList;
  if (!Array.isArray(songList) || songList.length === 0) {
    throw new Error('No items in response');
  }

  const item = songList[0];
  const metadata = item.metadata as Record<string, any>;
  if (!metadata) {
    throw new Error('Missing version identifiers');
  }

  const identifiers = metadata.softwareVersionExternalIdentifiers as any[];
  if (!Array.isArray(identifiers)) {
    throw new Error('Missing version identifiers');
  }

  const versions = identifiers.map((id) => String(id)).reverse();
  if (versions.length === 0) {
    throw new Error('No versions found');
  }

  return { versions, updatedCookies };
}
