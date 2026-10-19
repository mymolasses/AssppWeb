import { appleRequest } from './request';
import { storeIdToCountry } from './config';
import type { Account, Software } from '../types';

function versionIdentifier(value: unknown): string | undefined {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return;
  if (typeof value !== 'string' && typeof value !== 'number') return;
  const id = String(value);
  if (/^[1-9]\d*$/.test(id)) return id;
}

// Like ipatool 2.7, keep the account's country across the enterprise and
// consumer catalogs. These public lookups never attach account credentials.
export async function latestIOSVersionId(
  account: Account,
  app: Software,
): Promise<string> {
  if (app.kind === 'mac-software') {
    throw new Error('Native Mac downloads are not supported');
  }
  const country = storeIdToCountry(account.store)?.toLowerCase();
  if (!country) throw new Error('Cannot resolve account storefront');

  for (const platform of ['ios', 'iphone', 'ipad']) {
    const params = new URLSearchParams({
      version: '2',
      id: String(app.id),
      p: 'mdm-lockup',
      caller: 'MDM',
      platform,
      cc: country,
      l: 'en',
    });
    const response = await appleRequest({
      method: 'GET',
      host: 'uclient-api.itunes.apple.com',
      path: `/WebObjects/MZStorePlatform.woa/wa/lookup?${params}`,
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status !== 200) {
      throw new Error(`Version lookup failed (HTTP ${response.status})`);
    }
    const data = JSON.parse(response.body);
    const item = data?.results?.[String(app.id)];
    if (
      !item || item.offers == null ||
      (Array.isArray(item.offers) && item.offers.length === 0)
    ) continue;
    if (item.bundleId && item.bundleId !== app.bundleID) {
      throw new Error('Version lookup returned a different bundle identifier');
    }
    if (!Array.isArray(item.offers)) {
      throw new Error('Version lookup returned invalid offers');
    }
    const offer = item.offers[0];
    const rawId = offer?.version?.externalId;
    const id = versionIdentifier(rawId ?? '') ?? (
      rawId == null || rawId === ''
        ? versionIdentifier(new URLSearchParams(offer?.buyParams ?? '').get('appExtVrsId'))
        : undefined
    );
    if (!id) throw new Error('Version lookup returned no valid version identifier');
    return id;
  }

  // Apple Arcade apps may be absent from every MDM catalog.
  for (const platform of ['iphone', 'ipad']) {
    const response = await appleRequest({
      method: 'GET',
      host: 'apps.apple.com',
      path: `/api/apps/v1/catalog/${country}/apps/${app.id}?platform=${platform}`,
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) continue;
    if (response.status !== 200) {
      throw new Error(`App Store catalog lookup failed (HTTP ${response.status})`);
    }
    const data = JSON.parse(response.body);
    if (!Array.isArray(data?.data) || data.data.length !== 1) {
      throw new Error('App Store catalog must return exactly one app');
    }
    const item = data.data[0];
    if (item?.id !== String(app.id) || item.type !== 'apps') {
      throw new Error('App Store catalog returned a different app');
    }
    const attributes = item.attributes?.platformAttributes?.ios;
    const families = item.attributes?.deviceFamilies;
    if (!attributes || !Array.isArray(families)) {
      throw new Error('App Store catalog returned no iOS metadata');
    }
    if (attributes.bundleId !== app.bundleID) {
      throw new Error('App Store catalog returned a different bundle identifier');
    }
    if (!families.includes(platform)) continue;
    const id = versionIdentifier(attributes.externalVersionId);
    if (!id) throw new Error('App Store catalog returned no valid version identifier');
    return id;
  }
  throw new Error('App Store catalog has no offer for this iOS app');
}
