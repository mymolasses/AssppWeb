const nativeAuthHost = "auth.itunes.apple.com";
const nativeAuthPath = "/auth/v1/native/fast/";
const authEndpointPattern = /https?:\/\/[^\s"'<>]+/g;

export const defaultAuthURL = `https://${nativeAuthHost}${nativeAuthPath}`;

export function normalizeAuthURL(...authURLs: Array<string | undefined>): string {
  for (const rawAuthURL of authURLs) {
    const authURL = rawAuthURL?.trim();
    if (!authURL) continue;

    const nativeAuthURL = normalizeNativeAuthURL(authURL);
    if (nativeAuthURL) return nativeAuthURL;

    return authURL;
  }

  return defaultAuthURL;
}

export function authURLFromText(text: string): string {
  const normalizedText = decodeHtmlEntities(text.replace(/\\\//g, "/"));
  const matches = normalizedText.match(authEndpointPattern) ?? [];

  for (const match of matches) {
    const authURL = normalizeNativeAuthURL(match.replace(/[.,;)]+$/g, ""));
    if (authURL) return authURL;
  }

  return "";
}

function normalizeNativeAuthURL(authURL: string): string {
  let parsed: URL;
  try {
    parsed = new URL(authURL);
  } catch {
    return "";
  }

  if (parsed.hostname !== nativeAuthHost) {
    return "";
  }

  let path = parsed.pathname.replace(/\/+$/g, "");
  if (!path.endsWith("/fast")) {
    path = `${path}/fast`;
  }
  parsed.pathname = `${path}/`;

  return parsed.toString();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
