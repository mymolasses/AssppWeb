import { RETRYABLE_FAILURE_TYPE } from './config';

function emptyItems(response: Record<string, unknown>): boolean {
  return response.songList == null ||
    (Array.isArray(response.songList) && response.songList.length === 0);
}

function recoverableEmpty(response: Record<string, unknown>): boolean {
  if (response.failureType || !emptyItems(response)) return false;
  if (!response.customerMessage) return true;
  if (typeof response.customerMessage !== 'string') return false;
  const message = response.customerMessage.trim().toLowerCase();
  return message === 'no longer available' || message.endsWith(' no longer available');
}

export function shouldUseRedownload(status: number, response: Record<string, unknown>): boolean {
  return status === 200 && (
    String(response.failureType ?? '') === RETRYABLE_FAILURE_TYPE ||
    recoverableEmpty(response)
  );
}

export function shouldUseUpdateProduct(
  status: number,
  response: Record<string, unknown>,
  body: string,
): boolean {
  return (status === 500 && body.trim() === '') ||
    (status === 200 && recoverableEmpty(response));
}
