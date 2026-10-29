import { fetchBag } from './bag';
import { extractAndMergeCookies } from './cookies';
import {
  cachedKBSync,
  entSerialNumber,
  generateKBSync,
  invalidateKBSync,
  storeKBSync,
} from './kbsync';
import { IOSCatalogAppNotFoundError, latestIOSVersionId } from './platformVersion';
import { buildPlist, parsePlist } from './plist';
import { appleRequest } from './request';
import {
  shouldUseRedownload,
  shouldUseUpdateProduct,
} from './storeDownloadFallback';
import {
  dispatchEndpoint,
  redownloadEndpoint,
  updateProductEndpoint,
  volumeStoreEndpoint,
} from './config';
import type { StoreDownloadEndpoint } from './config';
import type { Account, Software } from '../types';

// Shared by package downloads, historical version lists, and version metadata.
// All Store traffic stays inside browser-side TLS through Wisp.
export async function fetchStoreDownloadProduct(
  account: Account,
  app: Software,
  externalVersionId?: string,
): Promise<{ dict: Record<string, any>; updatedCookies: typeof account.cookies }> {
  const deviceId = account.deviceIdentifier;
  let cookies = [...account.cookies];
  const bag = await fetchBag(deviceId);
  let catalogMissing = false;
  async function resolveVersion() {
    if (catalogMissing) throw new IOSCatalogAppNotFoundError();
    try { return await latestIOSVersionId(account, app); }
    catch (error) {
      if (error instanceof IOSCatalogAppNotFoundError) catalogMissing = true;
      throw error;
    }
  }

  async function send(endpoint: StoreDownloadEndpoint, kbsync?: string) {
    let host = endpoint.host;
    let path = endpoint.path;
    for (let attempt = 0; attempt <= 3; attempt++) {
      const payload: Record<string, unknown> = {
        creditDisplay: '',
        guid: deviceId,
        salableAdamId: app.id,
        serialNumber: '0',
      };
      const headers: Record<string, string> = {
        'Content-Type': 'application/x-apple-plist',
        'iCloud-DSID': account.directoryServicesIdentifier,
        'X-Dsid': account.directoryServicesIdentifier,
      };
      if (kbsync) {
        Object.assign(payload, {
          guid: deviceId.toUpperCase(),
          kbsync,
          salableAdamId: String(app.id),
          serialNumber: entSerialNumber(deviceId),
          externalVersionId,
        });
        Object.assign(headers, {
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
          'User-Agent': 'Configurator/2.18 (Macintosh; OS X 15.3.2; 24D81) AppleWebKit/0620.2.4.11.6',
          'X-Apple-Store-Front': account.store,
          'X-Token': account.passwordToken,
        });
      } else if (externalVersionId) {
        payload[endpoint.externalVersionIdKey] = externalVersionId;
      }
      const response = await appleRequest({
        method: 'POST',
        host,
        path,
        headers,
        body: buildPlist(payload),
        cookies,
        signal: AbortSignal.timeout(30_000),
      });
      cookies = extractAndMergeCookies(response.rawHeaders, cookies, host);
      if (response.status >= 300 && response.status < 400) {
        // Never forward the ent/download X-Token to a redirect destination.
        if (kbsync || ![301, 302, 307, 308].includes(response.status)) {
          throw new Error('Unexpected Store redirect');
        }
        const location = response.headers.location;
        if (!location) throw new Error('Missing Store redirect location');
        const url = new URL(location, `https://${host}${path}`);
        if (
          url.protocol !== 'https:' || url.username || url.password ||
          (url.port && url.port !== '443') ||
          !/^(?:buy|p\d+-buy|downloaddispatch)\.itunes\.apple\.com$/.test(url.hostname)
        ) throw new Error('Invalid Store redirect destination');
        host = url.hostname;
        path = url.pathname + url.search;
        continue;
      }
      // Preserve an empty HTTP 500 for updateProduct recovery before parsing.
      let dict: Record<string, any> = {};
      if (response.body.trim()) {
        try {
          const parsed = parsePlist(response.body);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Expected a plist dictionary');
          }
          dict = parsed as Record<string, any>;
        } catch {
          throw new Error(`Invalid Store response (HTTP ${response.status})`);
        }
      } else if (response.status === 200) {
        throw new Error('Empty Store response body');
      }
      return { response, dict };
    }
    throw new Error('Too many Store redirects');
  }

  const preferred = dispatchEndpoint(
    bag.entDownloadURL,
    '/WebObjects/DownloadDispatch.woa/wa/ent/download',
    deviceId.toUpperCase(),
  );
  if (preferred) {
    try {
      externalVersionId ||= await resolveVersion();
      const requestWithBlob = async (blob: string) => {
        const result = await send(preferred, blob);
        if (
          result.response.status !== 200 ||
          result.dict.failureType || result.dict.customerMessage
        ) {
          throw new Error('Preferred download was rejected');
        }
        validateSelection(result.dict, app, externalVersionId, true);
        if (!result.dict.songList[0].URL) throw new Error('Missing package URL');
        storeKBSync(account, blob);
        return { dict: result.dict, updatedCookies: cookies };
      };
      const cached = cachedKBSync(account);
      if (cached) {
        try {
          return await requestWithBlob(cached);
        } catch {
          invalidateKBSync(account, cached);
        }
      }
      return await requestWithBlob(await generateKBSync(account));
    } catch {
      // Asset, generation, catalog, and ent/download failures retain the
      // legacy recovery chain. Do not log signature data or Store responses.
    }
  }

  let result = await send(volumeStoreEndpoint(account.pod, deviceId));
  let usedUpdate = false;
  if (shouldUseRedownload(result.response.status, result.dict)) {
    // Unpinned redownloads can select another platform of a universal app.
    let unpinned = false;
    try { externalVersionId ||= await resolveVersion(); }
    catch (error) {
      if (!(error instanceof IOSCatalogAppNotFoundError) || app.kind === 'mac-software') throw error;
      unpinned = true;
    }
    const endpoint = dispatchEndpoint(bag.redownloadURL, '/r/redownload', deviceId)
      ?? redownloadEndpoint(deviceId);
    result = await send(endpoint);
    if (unpinned) {
      // A confirmed delisting gets one same-account request without a version.
      // Do not hide errors by trying updateProduct or another account/region.
      if (result.response.status !== 200) throw new Error(`Store request failed (HTTP ${result.response.status})`);
      if (result.dict.failureType) return { dict: result.dict, updatedCookies: cookies };
      if (result.dict.customerMessage) throw new Error(String(result.dict.customerMessage));
      validateSelection(result.dict, app, undefined, true);
      if (!result.dict.songList[0].URL) throw new Error('Missing package URL');
      return { dict: result.dict, updatedCookies: cookies };
    }
    if (shouldUseUpdateProduct(
      result.response.status, result.dict, result.response.body,
    )) {
      const update = updateProductEndpoint(bag.updateProductURL, deviceId);
      if (update) {
        usedUpdate = true;
        result = await send(update);
      }
    }
  }
  if (result.response.status !== 200) {
    throw new Error(`Store request failed (HTTP ${result.response.status})`);
  }
  const { dict } = result;
  if (!dict.failureType) {
    if (
      dict.customerMessage &&
      (!Array.isArray(dict.songList) || !dict.songList.length || usedUpdate)
    ) {
      throw new Error(String(dict.customerMessage));
    }
    validateSelection(dict, app, externalVersionId, usedUpdate);
  }
  return { dict, updatedCookies: cookies };
}

function validateSelection(
  dict: Record<string, any>,
  app: Software,
  versionId: string | undefined,
  required: boolean,
): void {
  if (
    required &&
    (!Array.isArray(dict.songList) || dict.songList.length !== 1)
  ) {
    throw new Error('Download response must contain exactly one item');
  }
  const metadata = dict.songList?.[0]?.metadata;
  if (!metadata) {
    if (required) throw new Error('Download response is missing app metadata');
    return;
  }
  const matches = (value: unknown, expected: string | number) =>
    value == null ? !required : String(value) === String(expected);
  if (
    !matches(metadata.itemId, app.id) ||
    !matches(metadata.softwareVersionBundleId, app.bundleID) ||
    (versionId && !matches(metadata.softwareVersionExternalIdentifier, versionId))
  ) throw new Error('Download response does not match the requested app or version');
  if (metadata['software-platform'] && metadata['software-platform'] !== 'ios') {
    throw new Error('Download response is not an iOS package');
  }
}
