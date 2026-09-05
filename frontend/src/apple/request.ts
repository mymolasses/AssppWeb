import { libcurl, initLibcurl } from './libcurl-init';
import { buildCookieHeader } from './cookies';
import { parsePlist } from './plist';
import { userAgent } from './config';
import type { Cookie } from '../types';

export interface AppleRequestOptions {
  host: string;
  path: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  cookies?: Cookie[];
}

export interface AppleResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  rawHeaders: [string, string][];
  body: string;
}

export async function appleRequest(
  opts: AppleRequestOptions,
): Promise<AppleResponse> {
  await initLibcurl();

  const url = `https://${opts.host}${opts.path}`;
  const headers: Record<string, string> = {
    'User-Agent': userAgent,
    ...opts.headers,
  };

  if (opts.cookies?.length) {
    const cookieHeader = buildCookieHeader(opts.cookies, url);
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }
  }

  const resp = await libcurl.fetch(url, {
    method: opts.method,
    headers,
    body: opts.body,
    redirect: 'manual',
    _libcurl_http_version: 1.1,
  });

  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of resp.raw_headers) {
    responseHeaders[key.toLowerCase()] = value;
  }

  const body = await resp.text();

  // Local development diagnostics: never log credentials, cookies, raw bodies,
  // download URLs, or query strings (which include the device identifier).
  if (import.meta.env.DEV) {
    let result: Record<string, unknown> = {};
    try {
      const parsed = parsePlist(body) as Record<string, unknown>;
      result = {
        failureType: /^-?\d+$/.test(String(parsed?.failureType ?? ''))
          ? String(parsed.failureType)
          : undefined,
        hasCustomerMessage: Boolean(parsed?.customerMessage),
        itemCount: Array.isArray(parsed?.songList)
          ? parsed.songList.length
          : null,
      };
    } catch {
      result = { format: 'non-plist' };
    }
    console.info(
      '[Apple request]',
      JSON.stringify({
        host: opts.host,
        path: opts.path.split('?')[0],
        status: resp.status,
        sentCookieCount: headers.Cookie ? headers.Cookie.split(';').length : 0,
        ...result,
      }),
    );
  }

  return {
    status: resp.status,
    statusText: resp.statusText,
    headers: responseHeaders,
    rawHeaders: resp.raw_headers,
    body,
  };
}
