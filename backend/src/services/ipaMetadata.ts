import path from "path";
import { open as openZip } from "yauzl-promise";
import type { Readable } from "stream";
import bplistParser from "bplist-parser";
import plist from "plist";
import type { Software } from "../types/index.js";

interface IpaInfo {
  bundleID: string;
  name: string;
  version: string;
  minimumOsVersion: string;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function parsePlistBuffer(data: Buffer): Record<string, unknown> | null {
  try {
    const parsed = bplistParser.parseBuffer(data);
    if (parsed && parsed.length > 0) {
      return parsed[0] as Record<string, unknown>;
    }
  } catch {
    // Try XML below.
  }

  try {
    const xml = data.toString("utf-8");
    if (xml.includes("<?xml") || xml.includes("<plist")) {
      const parsed = plist.parse(xml);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    }
  } catch {
    // Not a supported plist.
  }

  return null;
}

function stringValue(
  info: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = info[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export async function readIpaInfo(
  ipaPath: string,
  fallbackName: string,
): Promise<IpaInfo> {
  const zip = await openZip(ipaPath);
  try {
    for await (const entry of zip) {
      const filename = entry.filename;
      const isMainInfoPlist =
        /^Payload\/[^/]+\.app\/Info\.plist$/.test(filename) &&
        !filename.includes("/Watch/");
      if (!isMainInfoPlist) continue;

      const stream = await entry.openReadStream();
      const data = await streamToBuffer(stream);
      const info = parsePlistBuffer(data);
      if (!info) break;

      const bundleID = stringValue(info, ["CFBundleIdentifier"]);
      if (!bundleID) {
        throw new Error("IPA Info.plist is missing CFBundleIdentifier");
      }

      const name =
        stringValue(info, ["CFBundleDisplayName", "CFBundleName"]) ||
        fallbackName;
      const version =
        stringValue(info, ["CFBundleShortVersionString", "CFBundleVersion"]) ||
        "1.0";
      const minimumOsVersion =
        stringValue(info, ["MinimumOSVersion", "LSMinimumSystemVersion"]) ||
        "";

      return { bundleID, name, version, minimumOsVersion };
    }
  } finally {
    await zip.close();
  }

  throw new Error("Could not find Payload/*.app/Info.plist in IPA");
}

export function buildUploadedSoftware(
  info: IpaInfo,
  fileName: string,
  fileSizeBytes: number,
): Software {
  const fallbackName = path.basename(fileName, path.extname(fileName));
  const now = new Date().toISOString();

  return {
    id: 0,
    bundleID: info.bundleID,
    name: info.name || fallbackName,
    version: info.version,
    artistName: "Local Upload",
    sellerName: "Local Upload",
    description: "Uploaded signed IPA",
    averageUserRating: 0,
    userRatingCount: 0,
    artworkUrl: "",
    screenshotUrls: [],
    minimumOsVersion: info.minimumOsVersion,
    fileSizeBytes: String(fileSizeBytes),
    releaseDate: now,
    formattedPrice: "Local",
    primaryGenreName: "Local IPA",
  };
}
