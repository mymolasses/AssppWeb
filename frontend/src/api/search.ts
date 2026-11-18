import { withOperation } from '../store/operations';
import { apiGet } from "./client";
import type { Software } from "../types";

type SearchInput =
  | { type: "appStoreId"; value: string }
  | { type: "bundleId"; value: string }
  | { type: "term"; value: string };

export function parseSearchInput(input: string): SearchInput {
  const value = input.trim();

  try {
    const url = new URL(value);
    if (url.hostname === "apps.apple.com") {
      const appStoreUrlId = url.pathname.match(
        /(?:^|\/)id(\d+)(?:\/|$)/i,
      )?.[1];
      if (appStoreUrlId) {
        return { type: "appStoreId", value: appStoreUrlId };
      }
    }
  } catch {
    // Not a URL; continue with plain identifier detection below.
  }

  const prefixedId = value.match(/^id(\d+)$/i)?.[1];
  if (prefixedId) {
    return { type: "appStoreId", value: prefixedId };
  }

  if (/^\d+$/.test(value)) {
    return { type: "appStoreId", value };
  }

  if (/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(value)) {
    return { type: "bundleId", value };
  }

  return { type: "term", value };
}

async function searchAppsInternal(
  term: string,
  country: string,
  entity: string,
  limit: number = 25,
): Promise<Software[]> {
  const input = parseSearchInput(term);
  if (input.type !== "term") {
    const app = await lookupAppInternal(input.value, country);
    return app ? [app] : [];
  }

  const params = new URLSearchParams({
    term: input.value,
    country,
    entity:
      entity === "iPad"
        ? "iPadSoftware"
        : entity === "macSoftware"
          ? "macSoftware"
          : "software",
    limit: String(limit),
  });
  return apiGet<Software[]>(`/api/search?${params}`);
}

async function lookupAppInternal(
  appIdentifier: string,
  country: string,
): Promise<Software | null> {
  const input = parseSearchInput(appIdentifier);
  const params = new URLSearchParams({ country });
  if (input.type === "appStoreId") {
    params.set("id", input.value);
  } else {
    params.set("bundleId", input.value);
  }
  return apiGet<Software | null>(`/api/lookup?${params}`);
}

export function searchApps(term: string, country: string, entity: string, limit = 25) {
  return withOperation('search', () => searchAppsInternal(term, country, entity, limit));
}
export function lookupApp(appIdentifier: string, country: string) {
  return withOperation('search', () => lookupAppInternal(appIdentifier, country));
}
