import { storeIdToCountry } from '../apple/config';
import type { DownloadTask } from '../types';

// Saved download provenance takes precedence over a device's current accounts.
export function packageCountry(task: DownloadTask): string | undefined {
  return task.storefrontId ? storeIdToCountry(task.storefrontId) : undefined;
}
