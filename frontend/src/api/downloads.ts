import { apiGet, apiPost, apiDelete, authHeaders } from "./client";
import type { DownloadTask, Software, Sinf } from "../types";

export async function fetchDownloads(
  accountHashes: string[],
): Promise<DownloadTask[]> {
  if (accountHashes.length === 0) return [];
  const params = new URLSearchParams({
    accountHashes: accountHashes.join(","),
  });
  return apiGet<DownloadTask[]>(`/api/downloads?${params}`);
}

export async function startDownload(data: {
  software: Software;
  accountHash: string;
  downloadURL: string;
  sinfs: Sinf[];
}): Promise<DownloadTask> {
  return apiPost<DownloadTask>("/api/downloads", data);
}

export async function uploadIpa(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<DownloadTask> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/downloads/upload");

    const headers = authHeaders();
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Invalid upload response"));
        }
      } else {
        reject(new Error(xhr.responseText || "Upload failed"));
      }
    };

    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(file);
  });
}

export async function pauseDownload(
  id: string,
  accountHash: string,
): Promise<void> {
  const params = new URLSearchParams({ accountHash });
  await apiPost(`/api/downloads/${id}/pause?${params}`);
}

export async function resumeDownload(
  id: string,
  accountHash: string,
): Promise<void> {
  const params = new URLSearchParams({ accountHash });
  await apiPost(`/api/downloads/${id}/resume?${params}`);
}

export async function deleteDownload(
  id: string,
  accountHash: string,
): Promise<void> {
  const params = new URLSearchParams({ accountHash });
  await apiDelete(`/api/downloads/${id}?${params}`);
}
