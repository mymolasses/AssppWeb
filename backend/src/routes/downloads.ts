import { Router, Request, Response } from "express";
import { config } from "../config.js";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { pipeline } from "stream/promises";
import { MAX_DOWNLOAD_SIZE } from "../config.js";
import { LOCAL_UPLOAD_ACCOUNT_HASH } from "../constants.js";
import {
  createTask,
  createUploadedTask,
  getAllTasks,
  getTask,
  deleteTask,
  pauseTask,
  resumeTask,
  addProgressListener,
  removeProgressListener,
  sanitizeTaskForResponse,
  validateDownloadURL,
} from "../services/downloadManager.js";
import {
  getIdParam,
  requireAccountHash,
  verifyTaskOwnership,
} from "../utils/route.js";
import { buildUploadedSoftware, readIpaInfo } from "../services/ipaMetadata.js";

const router = Router();

const PACKAGES_DIR = path.join(config.dataDir, "packages");

function sanitizeUploadName(value: string): string {
  const base = path.basename(value || "uploaded.ipa");
  return base.replace(/[^\w .()-]/g, "_").slice(0, 200) || "uploaded.ipa";
}

function decodeUploadName(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseContentLength(req: Request): number | null {
  const value = req.headers["content-length"];
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function removeFileIfExists(filePath: string) {
  try {
    await fs.promises.rm(filePath, { force: true });
  } catch {
    // best-effort cleanup
  }
}

async function fetchDownloadSizeBytes(
  downloadURL: string,
): Promise<number | null> {
  const headResponse = await fetch(downloadURL, {
    method: "HEAD",
    redirect: "follow",
  });
  if (!headResponse.ok) {
    throw new Error(`HEAD failed: HTTP ${headResponse.status}`);
  }

  const contentLength = parseInt(
    headResponse.headers.get("content-length") || "0",
    10,
  );
  if (Number.isFinite(contentLength) && contentLength > 0) {
    return contentLength;
  }

  const rangeResponse = await fetch(downloadURL, {
    method: "GET",
    headers: { Range: "bytes=0-0" },
    redirect: "follow",
  });
  try {
    if (rangeResponse.status !== 206 && rangeResponse.status !== 200) {
      throw new Error(`Range probe failed: HTTP ${rangeResponse.status}`);
    }

    const contentRange = rangeResponse.headers.get("content-range") || "";
    const match = contentRange.match(/\/(\d+)\s*$/);
    if (match) {
      const parsed = parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }

    if (rangeResponse.status === 200) {
      const fallbackLength = parseInt(
        rangeResponse.headers.get("content-length") || "0",
        10,
      );
      if (Number.isFinite(fallbackLength) && fallbackLength > 0) {
        return fallbackLength;
      }
    }

    return null;
  } finally {
    try {
      await rangeResponse.body?.cancel();
    } catch {
      // best-effort cleanup
    }
  }
}

// Start a new download
router.post("/downloads", async (req: Request, res: Response) => {
  const { software, accountHash, downloadURL, sinfs, iTunesMetadata } =
    req.body;

  if (!software || !accountHash || !downloadURL || !sinfs) {
    res.status(400).json({
      error:
        "Missing required fields: software, accountHash, downloadURL, sinfs",
    });
    return;
  }

  // Validate download URL before creating task
  try {
    validateDownloadURL(downloadURL);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : "Invalid download URL",
    });
    return;
  }

  if (config.maxDownloadMB > 0) {
    try {
      const fileSizeBytes = await fetchDownloadSizeBytes(downloadURL);
      if (!fileSizeBytes) {
        res.status(400).json({
          error: "Unable to verify file size from Apple",
        });
        return;
      }
      const sizeMB = fileSizeBytes / (1024 * 1024);
      if (sizeMB > config.maxDownloadMB) {
        res.status(413).json({
          error: `File size exceeds the maximum limit of ${config.maxDownloadMB} MB`,
        });
        return;
      }
    } catch (err) {
      console.error(
        "Apple size probe error:",
        err instanceof Error ? err.message : err,
      );
      res.status(502).json({ error: "Failed to verify file size from Apple" });
      return;
    }
  }

  try {
    const task = createTask(
      software,
      accountHash,
      downloadURL,
      sinfs,
      iTunesMetadata,
    );
    res.status(201).json(sanitizeTaskForResponse(task));
  } catch (err) {
    console.error(
      "Create download error:",
      err instanceof Error ? err.message : err,
    );
    res.status(400).json({ error: "Failed to create download" });
  }
});

// Upload an already-signed local IPA and expose it through the existing install flow.
router.post("/downloads/upload", async (req: Request, res: Response) => {
  const contentLength = parseContentLength(req);
  if (contentLength === null || contentLength <= 0) {
    res.status(400).json({ error: "Missing upload size" });
    return;
  }

  if (contentLength > MAX_DOWNLOAD_SIZE) {
    res.status(413).json({ error: "IPA is too large" });
    return;
  }

  if (config.maxDownloadMB > 0) {
    const sizeMB = contentLength / (1024 * 1024);
    if (sizeMB > config.maxDownloadMB) {
      res.status(413).json({
        error: `File size exceeds the maximum limit of ${config.maxDownloadMB} MB`,
      });
      return;
    }
  }

  const fileName = sanitizeUploadName(
    typeof req.headers["x-file-name"] === "string"
      ? decodeUploadName(req.headers["x-file-name"])
      : "uploaded.ipa",
  );
  if (!fileName.toLowerCase().endsWith(".ipa")) {
    res.status(400).json({ error: "Only .ipa files can be uploaded" });
    return;
  }

  const incomingDir = path.join(
    PACKAGES_DIR,
    LOCAL_UPLOAD_ACCOUNT_HASH,
    "_incoming",
  );
  const packagesBase = path.resolve(PACKAGES_DIR);
  const resolvedIncomingDir = path.resolve(incomingDir);
  if (!resolvedIncomingDir.startsWith(packagesBase + path.sep)) {
    res.status(500).json({ error: "Invalid upload path" });
    return;
  }
  await fs.promises.mkdir(incomingDir, { recursive: true });

  const tempPath = path.join(incomingDir, `${randomUUID()}.ipa`);
  try {
    await pipeline(req, fs.createWriteStream(tempPath, { flags: "wx" }));
    const stats = await fs.promises.stat(tempPath);
    const info = await readIpaInfo(
      tempPath,
      path.basename(fileName, path.extname(fileName)),
    );
    const software = buildUploadedSoftware(info, fileName, stats.size);
    const task = createUploadedTask(
      software,
      LOCAL_UPLOAD_ACCOUNT_HASH,
      tempPath,
    );
    res.status(201).json(sanitizeTaskForResponse(task));
  } catch (err) {
    await removeFileIfExists(tempPath);
    console.error(
      "Upload IPA error:",
      err instanceof Error ? err.message : err,
    );
    res.status(400).json({
      error: err instanceof Error ? err.message : "Failed to upload IPA",
    });
  }
});

// List downloads filtered by account hashes
router.get("/downloads", (req: Request, res: Response) => {
  const hashesParam = req.query.accountHashes;
  if (!hashesParam || typeof hashesParam !== "string") {
    res.json([]);
    return;
  }
  const hashes = new Set(hashesParam.split(",").filter(Boolean));
  if (hashes.size === 0) {
    res.json([]);
    return;
  }
  const filtered = getAllTasks()
    .filter((t) => hashes.has(t.accountHash))
    .map(sanitizeTaskForResponse);
  res.json(filtered);
});

// Get single download (requires accountHash)
router.get("/downloads/:id", (req: Request, res: Response) => {
  const accountHash = requireAccountHash(req, res);
  if (!accountHash) return;

  const id = getIdParam(req);
  const task = getTask(id);
  if (!task) {
    res.status(404).json({ error: "Download not found" });
    return;
  }

  if (!verifyTaskOwnership(task, accountHash, res)) return;

  res.json(sanitizeTaskForResponse(task));
});

// SSE progress stream (requires accountHash)
router.get("/downloads/:id/progress", (req: Request, res: Response) => {
  const accountHash = requireAccountHash(req, res);
  if (!accountHash) return;

  const id = getIdParam(req);
  const task = getTask(id);
  if (!task) {
    res.status(404).json({ error: "Download not found" });
    return;
  }

  if (!verifyTaskOwnership(task, accountHash, res)) return;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // Send current state immediately
  res.write(`data: ${JSON.stringify(sanitizeTaskForResponse(task))}\n\n`);

  const listener = (updatedTask: typeof task) => {
    res.write(
      `data: ${JSON.stringify(sanitizeTaskForResponse(updatedTask))}\n\n`,
    );
  };

  addProgressListener(id, listener);

  req.on("close", () => {
    removeProgressListener(id, listener);
  });
});

// Pause download (requires accountHash)
router.post("/downloads/:id/pause", (req: Request, res: Response) => {
  const accountHash = requireAccountHash(req, res);
  if (!accountHash) return;

  const id = getIdParam(req);
  const task = getTask(id);
  if (!task) {
    res.status(404).json({ error: "Download not found" });
    return;
  }

  if (!verifyTaskOwnership(task, accountHash, res)) return;

  const success = pauseTask(id);
  if (!success) {
    res.status(400).json({ error: "Cannot pause this download" });
    return;
  }
  const updated = getTask(id);
  res.json(updated ? sanitizeTaskForResponse(updated) : { success: true });
});

// Resume download (requires accountHash)
router.post("/downloads/:id/resume", (req: Request, res: Response) => {
  const accountHash = requireAccountHash(req, res);
  if (!accountHash) return;

  const id = getIdParam(req);
  const task = getTask(id);
  if (!task) {
    res.status(404).json({ error: "Download not found" });
    return;
  }

  if (!verifyTaskOwnership(task, accountHash, res)) return;

  const success = resumeTask(id);
  if (!success) {
    res.status(400).json({ error: "Cannot resume this download" });
    return;
  }
  const updated = getTask(id);
  res.json(updated ? sanitizeTaskForResponse(updated) : { success: true });
});

// Delete download (requires accountHash)
router.delete("/downloads/:id", (req: Request, res: Response) => {
  const accountHash = requireAccountHash(req, res);
  if (!accountHash) return;

  const id = getIdParam(req);
  const task = getTask(id);
  if (!task) {
    res.status(404).json({ error: "Download not found" });
    return;
  }

  if (!verifyTaskOwnership(task, accountHash, res)) return;

  const success = deleteTask(id);
  if (!success) {
    res.status(404).json({ error: "Download not found" });
    return;
  }
  res.json({ success: true });
});

export default router;
