import { X509Certificate } from "crypto";
import { open as openZip } from "yauzl-promise";
import type { Readable } from "stream";
import bplistParser from "bplist-parser";
import plist from "plist";
import type { IpaSigningInfo } from "../types/index.js";

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

function extractMobileProvisionPlist(data: Buffer): Record<string, unknown> | null {
  const xmlStart = data.indexOf(Buffer.from("<?xml"));
  const plistEnd = data.indexOf(Buffer.from("</plist>"));
  if (xmlStart < 0 || plistEnd < 0 || plistEnd <= xmlStart) return null;

  const xml = data.subarray(xmlStart, plistEnd + "</plist>".length);
  return parsePlistBuffer(xml);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function dateString(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }
  return undefined;
}

function parseEntitlements(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function parseCertificates(value: unknown): IpaSigningInfo["certificates"] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!Buffer.isBuffer(item)) return null;
      try {
        const cert = new X509Certificate(item);
        return {
          subject: cert.subject,
          issuer: cert.issuer,
          validFrom: new Date(cert.validFrom).toISOString(),
          validTo: new Date(cert.validTo).toISOString(),
          fingerprint256: cert.fingerprint256,
        };
      } catch {
        return null;
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

function classifyProfile(
  profile: Record<string, unknown> | null,
  entitlements: Record<string, unknown>,
): IpaSigningInfo["profileType"] {
  if (!profile) return "missing";
  if (profile["ProvisionsAllDevices"] === true) return "enterprise";
  if (Array.isArray(profile["ProvisionedDevices"])) {
    return entitlements["get-task-allow"] === true ? "development" : "ad-hoc";
  }
  return "app-store";
}

function entitlementBundleID(entitlements: Record<string, unknown>): string | undefined {
  const applicationID = stringValue(entitlements["application-identifier"]);
  if (!applicationID) return undefined;
  const dot = applicationID.indexOf(".");
  return dot >= 0 ? applicationID.slice(dot + 1) : undefined;
}

export async function analyzeIpaSigning(
  ipaPath: string,
  bundleID: string,
): Promise<IpaSigningInfo> {
  const zip = await openZip(ipaPath);
  let profileData: Buffer | null = null;
  let hasCodeSignature = false;

  try {
    for await (const entry of zip) {
      const filename = entry.filename;
      if (/^Payload\/[^/]+\.app\/_CodeSignature\/CodeResources$/.test(filename)) {
        hasCodeSignature = true;
      }
      if (/^Payload\/[^/]+\.app\/embedded\.mobileprovision$/.test(filename)) {
        const stream = await entry.openReadStream();
        profileData = await streamToBuffer(stream);
      }
    }
  } finally {
    await zip.close();
  }

  const profile = profileData ? extractMobileProvisionPlist(profileData) : null;
  const entitlements = parseEntitlements(profile?.["Entitlements"]);
  const profileType = classifyProfile(profile, entitlements);
  const teamIdentifiers = stringArray(profile?.["TeamIdentifier"]);
  const provisionedDevices =
    profile && Array.isArray(profile["ProvisionedDevices"])
      ? (profile["ProvisionedDevices"] as unknown[])
      : undefined;
  const provisionBundleID = entitlementBundleID(entitlements);
  const expiresAt = dateString(profile?.["ExpirationDate"]);
  const warnings: string[] = [];
  const now = Date.now();

  if (!hasCodeSignature) {
    warnings.push("missingCodeSignature");
  }
  if (!profile) {
    warnings.push("missingProvisioningProfile");
  }
  if (expiresAt && new Date(expiresAt).getTime() < now) {
    warnings.push("expiredProvisioningProfile");
  }
  if (profileType !== "enterprise") {
    warnings.push("notEnterpriseProfile");
  }
  if (profileType === "development") {
    warnings.push("developmentProfile");
  }
  if (profileType === "ad-hoc") {
    warnings.push("adHocProfileRequiresDevice");
  }
  if (
    provisionBundleID &&
    provisionBundleID !== bundleID &&
    !provisionBundleID.endsWith(".*")
  ) {
    warnings.push("bundleIdMismatch");
  }

  for (const cert of parseCertificates(profile?.["DeveloperCertificates"])) {
    if (new Date(cert.validTo).getTime() < now) {
      warnings.push("expiredCertificate");
      break;
    }
  }

  return {
    profileType,
    likelyOtaInstallable:
      hasCodeSignature &&
      profileType === "enterprise" &&
      !warnings.includes("expiredProvisioningProfile") &&
      !warnings.includes("expiredCertificate") &&
      !warnings.includes("bundleIdMismatch"),
    hasEmbeddedProvision: !!profile,
    hasCodeSignature,
    profileName: stringValue(profile?.["Name"]),
    teamName: stringValue(profile?.["TeamName"]),
    teamIdentifiers,
    appIdName: stringValue(profile?.["AppIDName"]),
    provisionedDeviceCount: provisionedDevices?.length,
    provisionBundleID,
    createdAt: dateString(profile?.["CreationDate"]),
    expiresAt,
    entitlements: {
      applicationIdentifier: stringValue(entitlements["application-identifier"]),
      teamIdentifier: stringValue(entitlements["com.apple.developer.team-identifier"]),
      getTaskAllow: entitlements["get-task-allow"] === true,
    },
    certificates: parseCertificates(profile?.["DeveloperCertificates"]),
    warnings: Array.from(new Set(warnings)),
  };
}
