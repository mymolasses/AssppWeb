import { authHeaders } from "../api/client";
import { parsePlist } from "./plist";
import { defaultAuthURL, normalizeAuthURL } from "./authEndpoint";

export { defaultAuthURL, normalizeAuthURL };

export interface BagOutput {
  authURL: string;
}

// Fetches the bag via the backend proxy.
// The backend fetches it using Node.js native HTTPS.
// The bag response is public data (Apple service URLs, no credentials).
export async function fetchBag(deviceId: string): Promise<BagOutput> {
  try {
    const resp = await fetch(`/api/bag?guid=${encodeURIComponent(deviceId)}`, {
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      console.warn(
        `[Bag] Proxy request failed, using default auth endpoint: ${err.error || `HTTP ${resp.status}`}`,
      );
      return { authURL: defaultAuthURL };
    }

    const xml = await resp.text();
    const dict = parsePlist(xml) as Record<string, any>;

    // authenticateAccount used to live inside the urlBag dict; newer bag
    // responses move it to the plist root, so prefer the root and fall back.
    const urlBag = dict.urlBag as Record<string, any> | undefined;
    const authURL =
      (dict.authenticateAccount as string | undefined) ??
      (urlBag?.authenticateAccount as string | undefined);

    if (!authURL) {
      console.warn(
        "[Bag] authenticateAccount URL not found in bag, using default auth endpoint",
      );
      return { authURL: defaultAuthURL };
    }

    return { authURL: normalizeAuthURL(authURL) };
  } catch (error) {
    console.warn(
      `[Bag] Failed to fetch/parse bag, using default auth endpoint: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { authURL: defaultAuthURL };
  }
}
