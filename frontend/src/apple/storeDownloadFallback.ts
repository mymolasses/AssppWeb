import { RETRYABLE_FAILURE_TYPE } from './config';

/**
 * Some owned apps return HTTP 200 from volumeStore without songList or error
 * metadata. The redownload endpoint can still serve them (ipatool issue #538,
 * HaughtyEyes/ipatool commit bad372d). Preserve the existing 5002 fallback too.
 * Callers may switch endpoints only once and must retain Apple's real errors.
 */
export function shouldUseRedownload(
  status: number,
  response: Record<string, unknown>,
): boolean {
  if (status !== 200) return false;
  if (String(response.failureType ?? '') === RETRYABLE_FAILURE_TYPE)
    return true;

  const items = response.songList;
  return (
    !response.failureType &&
    !response.customerMessage &&
    (items == null || (Array.isArray(items) && items.length === 0))
  );
}
