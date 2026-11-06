import { execFile as execFileCb } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import { open as openZip } from "yauzl-promise";
import type { Readable } from "stream";
import bplistParser from "bplist-parser";
import bplistCreator from "bplist-creator";
import plist from "plist";
import type { Sinf } from "../types/index.js";

const execFile = promisify(execFileCb);

interface IpaMetadata {
  bundleName: string;
  manifest: { sinfPaths: string[] } | null;
  info: { bundleExecutable: string } | null;
}

export async function inject(
  sinfs: Sinf[],
  ipaPath: string,
  iTunesMetadata?: string,
  artwork?: Buffer,
): Promise<void> {
  const filesToInject = await planSinfInjection(sinfs, ipaPath);

  // Inject iTunesMetadata.plist at the archive root if provided
  // Frontend sends base64-encoded XML plist; convert to binary plist
  // to match Apple's native format (PropertyListSerialization .binary)
  if (iTunesMetadata) {
    const xmlBuffer = Buffer.from(iTunesMetadata, "base64");
    const xmlString = xmlBuffer.toString("utf-8");
    let metadataBuffer: Buffer;
    try {
      const parsed = plist.parse(xmlString);
      metadataBuffer = bplistCreator(parsed as Record<string, unknown>);
    } catch {
      metadataBuffer = xmlBuffer;
    }
    filesToInject.push({ entryPath: "iTunesMetadata.plist", data: metadataBuffer });
  }
  if (artwork?.length) filesToInject.push({ entryPath: "iTunesArtwork", data: artwork });
  if (filesToInject.length > 0) {
    await addFilesToZip(ipaPath, filesToInject);
    await verifyInjectedFiles(ipaPath, filesToInject);
  }
}

// Apple/ipatool pair SINF records with SinfPaths by response order, not SINF ID.
export async function planSinfInjection(sinfs: Sinf[], ipaPath: string) {
  if (!Array.isArray(sinfs)) throw new Error("Invalid SINF records");
  if (sinfs.length === 0) return []; // Some device downloads legitimately omit SINF.
  const { bundleName, manifest, info } = await readIpaMetadata(ipaPath);
  const filesToInject: { entryPath: string; data: Buffer }[] = [];
  const data = sinfs.map(record => {
    if (typeof record?.sinf !== 'string') throw new Error("Invalid SINF data");
    const encoded = record.sinf.replace(/\s/g, '');
    if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new Error("Invalid SINF data");
    }
    return Buffer.from(encoded, 'base64');
  });

  if (manifest) {
    if (manifest.sinfPaths.length !== sinfs.length) {
      throw new Error("SINF count does not match the main app manifest");
    }
    if (new Set(manifest.sinfPaths).size !== manifest.sinfPaths.length) {
      throw new Error("Duplicate SINF paths in main app manifest");
    }
    for (let i = 0; i < manifest.sinfPaths.length; i++) {
      const sinfPath = manifest.sinfPaths[i];
      if (typeof sinfPath !== 'string' || !sinfPath.endsWith('.sinf') ||
        sinfPath.split('/').some(part => !part || part === '.' || part === '..') ||
        /[\\:\x00]/.test(sinfPath)) throw new Error("Invalid SINF path in main app manifest");
      const fullPath = `Payload/${bundleName}.app/${sinfPath}`;
      filesToInject.push({
        entryPath: fullPath,
        data: data[i],
      });
    }
  } else if (info) {
    if (sinfs.length !== 1) throw new Error("Multiple SINF records require a main app manifest");
    if (sinfs.length > 0) {
      const sinfPath = `Payload/${bundleName}.app/SC_Info/${info.bundleExecutable}.sinf`;
      filesToInject.push({
        entryPath: sinfPath,
        data: data[0],
      });
    }
  } else {
    throw new Error("Could not read manifest or info plist");
  }

  return filesToInject;
}

async function verifyInjectedFiles(ipaPath: string, files: { entryPath: string; data: Buffer }[]) {
  const remaining = new Map(files.map(file => [file.entryPath, file.data]));
  const seen = new Set<string>();
  const zip = await openZip(ipaPath);
  try {
    for await (const entry of zip) {
      const expected = files.find(file => file.entryPath === entry.filename)?.data;
      if (!expected) continue;
      if (seen.has(entry.filename) || entry.uncompressedSize !== expected.length) {
        throw new Error("Injected IPA file verification failed");
      }
      seen.add(entry.filename);
      const actual = await streamToBuffer(await entry.openReadStream());
      if (!actual.equals(expected)) throw new Error("Injected IPA file verification failed");
      remaining.delete(entry.filename);
    }
    if (remaining.size) throw new Error("Injected IPA file is missing");
  } finally { await zip.close(); }
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readIpaMetadata(ipaPath: string): Promise<IpaMetadata> {
  const zip = await openZip(ipaPath);
  try {
    let bundleName: string | null = null;
    let manifestData: Buffer | null = null;
    let infoPlistData: Buffer | null = null;

    // Select the main bundle first, independent of archive order. A Watch or
    // nested app manifest must never supply the main app's SINF destinations.
    const entries = await zip.readEntries();
    const mainInfos = entries.filter(entry => /^Payload\/[^/]+\.app\/Info\.plist$/.test(entry.filename));
    if (mainInfos.length !== 1) throw new Error("IPA must contain one main app Info.plist");
    const mainInfo = mainInfos[0];
    const bundlePath = mainInfo.filename.slice(0, -'/Info.plist'.length);
    bundleName = bundlePath.slice('Payload/'.length, -'.app'.length);
    const manifests = entries.filter(entry => entry.filename === `${bundlePath}/SC_Info/Manifest.plist`);
    if (manifests.length > 1) throw new Error("Duplicate main app manifest");
    if (mainInfo.uncompressedSize > 2 * 1024 * 1024 || manifests.some(entry => entry.uncompressedSize > 2 * 1024 * 1024)) {
      throw new Error("IPA authorization metadata is too large");
    }
    infoPlistData = await streamToBuffer(await mainInfo.openReadStream());
    if (manifests[0]) manifestData = await streamToBuffer(await manifests[0].openReadStream());

    if (!bundleName) {
      throw new Error("Could not read bundle name");
    }

    // Parse manifest
    let manifest: { sinfPaths: string[] } | null = null;
    if (manifestData) {
      const parsed = parsePlistBuffer(manifestData);
      if (parsed) {
        const sinfPaths = parsed["SinfPaths"];
        if (Array.isArray(sinfPaths) && sinfPaths.every(value => typeof value === 'string')) {
          manifest = { sinfPaths: sinfPaths as string[] };
        }
      }
      if (!manifest) throw new Error("Invalid main app SINF manifest");
    }

    // Parse info plist
    let info: { bundleExecutable: string } | null = null;
    if (infoPlistData) {
      const parsed = parsePlistBuffer(infoPlistData);
      if (parsed) {
        const executable = parsed["CFBundleExecutable"];
        if (typeof executable === "string" && executable && !/[\\/:\x00]/.test(executable) && executable !== '.' && executable !== '..') {
          info = { bundleExecutable: executable };
        }
      }
    }

    return { bundleName, manifest, info };
  } finally {
    await zip.close();
  }
}

async function addFilesToZip(
  ipaPath: string,
  files: { entryPath: string; data: Buffer }[],
): Promise<void> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sinf-"));
  const resolvedTmpDir = path.resolve(tmpDir);
  try {
    // Write files to temp dir preserving ZIP path structure
    const relativePaths: string[] = [];
    for (const file of files) {
      // Guard against path traversal from IPA-derived entry paths
      const fullPath = path.resolve(tmpDir, file.entryPath);
      if (!fullPath.startsWith(resolvedTmpDir + path.sep)) {
        throw new Error(`Path traversal detected in entry: ${file.entryPath}`);
      }
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.promises.writeFile(fullPath, file.data);
      relativePaths.push(file.entryPath);
    }

    // Use zip to update the archive in-place
    // -0: store without compression (SINF/plist files are tiny)
    // "--" after archive name prevents file args from being parsed as flags
    await execFile("zip", ["-0", ipaPath, "--", ...relativePaths], {
      cwd: tmpDir,
      maxBuffer: 1024 * 1024,
    });
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}

function parsePlistBuffer(data: Buffer): Record<string, unknown> | null {
  // Try binary plist first
  try {
    const parsed = bplistParser.parseBuffer(data);
    if (parsed && parsed.length > 0) {
      return parsed[0] as Record<string, unknown>;
    }
  } catch {
    // Not binary plist, try XML
  }

  // Try XML plist
  try {
    const xml = data.toString("utf-8");
    if (xml.includes("<?xml") || xml.includes("<plist")) {
      const parsed = plist.parse(xml);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    }
  } catch {
    // Not valid XML plist either
  }

  return null;
}
