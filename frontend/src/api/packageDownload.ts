import { authHeaders } from './client';

export interface PackageDownloadProgress {
  loaded: number;
  total?: number;
}

// XHR reports received bytes on older Safari too; response.blob() alone gives
// no intermediate progress. Headers retain the site's existing password gate.
export function downloadPackage(
  id: string,
  accountHash: string,
  onProgress: (progress: PackageDownloadProgress) => void,
  signal: AbortSignal,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Download cancelled', 'AbortError')); return; }
    const xhr = new XMLHttpRequest();
    const params = new URLSearchParams({ accountHash });
    xhr.open('GET', `/api/packages/${encodeURIComponent(id)}/file?${params}`);
    xhr.responseType = 'blob';
    for (const [name, value] of Object.entries(authHeaders())) xhr.setRequestHeader(name, value);
    const abort = () => xhr.abort();
    const finish = () => signal.removeEventListener('abort', abort);
    xhr.onprogress = event => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress({ loaded: event.loaded, total: event.lengthComputable && event.total > 0 ? event.total : undefined });
      }
    };
    xhr.onload = () => {
      finish();
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response instanceof Blob && xhr.response.size > 0) {
        resolve(xhr.response);
      } else reject(new Error('IPA download failed'));
    };
    xhr.onerror = () => { finish(); reject(new Error('IPA download failed')); };
    xhr.onabort = () => { finish(); reject(new DOMException('Download cancelled', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    xhr.send();
  });
}
