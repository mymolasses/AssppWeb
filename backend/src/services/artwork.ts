const MAX_ARTWORK_BYTES = 10 * 1024 * 1024;
const ARTWORK_HOST_RE = /(^|\.)(?:apple|mzstatic)\.com$/i;

export function validateArtworkURL(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid artwork URL");
  }

  if (parsed.protocol !== "https:" || !ARTWORK_HOST_RE.test(parsed.hostname)) {
    throw new Error("Artwork URL must use HTTPS on an Apple artwork host");
  }
  return parsed;
}

export async function downloadArtwork(
  value?: string,
  signal?: AbortSignal,
): Promise<Buffer | undefined> {
  if (!value) return undefined;
  validateArtworkURL(value);

  const response = await fetch(value, { redirect: "follow", signal });
  if (!response.ok) {
    throw new Error(`Artwork download failed: HTTP ${response.status}`);
  }
  validateArtworkURL(response.url);

  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_ARTWORK_BYTES) {
    throw new Error("Artwork exceeds the maximum size");
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType && !contentType.toLowerCase().startsWith("image/")) {
    throw new Error("Artwork response is not an image");
  }
  if (!response.body) throw new Error("Artwork response has no body");

  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of response.body) {
    const data = Buffer.from(chunk);
    received += data.length;
    if (received > MAX_ARTWORK_BYTES) {
      throw new Error("Artwork exceeds the maximum size");
    }
    chunks.push(data);
  }
  if (received === 0) throw new Error("Artwork response is empty");
  return Buffer.concat(chunks);
}
