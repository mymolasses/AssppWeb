import { fetchStoreDownloadProduct } from './storeDownloadProduct';
import type { Account, Software, VersionMetadata } from '../types';

export async function getVersionMetadata(
  account: Account,
  app: Software,
  versionId: string,
): Promise<{
  metadata: VersionMetadata;
  updatedCookies: typeof account.cookies;
}> {
  const { dict, updatedCookies } = await fetchStoreDownloadProduct(
    account, app, versionId,
  );
  if (dict.failureType) {
    throw new Error(dict.customerMessage || `Store error ${dict.failureType}`);
  }

  const songList = dict.songList as Record<string, any>[] | undefined;
  if (!songList || songList.length === 0) {
    throw new Error('No items in response');
  }

  const item = songList[0];
  const itemMetadata = item.metadata as Record<string, any>;
  if (!itemMetadata) {
    throw new Error('Missing metadata');
  }

  const bundleShortVersionString =
    itemMetadata.bundleShortVersionString as string;
  if (!bundleShortVersionString) {
    throw new Error('Missing bundleShortVersionString');
  }

  const rawReleaseDate = itemMetadata.releaseDate;
  if (!rawReleaseDate) {
    throw new Error('Missing releaseDate');
  }
  const releaseDate =
    rawReleaseDate instanceof Date
      ? rawReleaseDate.toISOString()
      : String(rawReleaseDate);

  return {
    metadata: {
      displayVersion: bundleShortVersionString,
      releaseDate,
    },
    updatedCookies,
  };
}
