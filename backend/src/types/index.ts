export interface Software {
  id: number;
  bundleID: string;
  name: string;
  version: string;
  price?: number;
  artistName: string;
  sellerName: string;
  description: string;
  averageUserRating: number;
  userRatingCount: number;
  artworkUrl: string;
  screenshotUrls: string[];
  minimumOsVersion: string;
  fileSizeBytes?: string;
  releaseDate: string;
  releaseNotes?: string;
  formattedPrice?: string;
  primaryGenreName: string;
}

export interface Sinf {
  id: number;
  sinf: string; // base64 encoded
}

export interface IpaSigningInfo {
  profileType: "enterprise" | "ad-hoc" | "development" | "app-store" | "missing";
  likelyOtaInstallable: boolean;
  hasEmbeddedProvision: boolean;
  hasCodeSignature: boolean;
  profileName?: string;
  teamName?: string;
  teamIdentifiers: string[];
  appIdName?: string;
  provisionedDeviceCount?: number;
  provisionBundleID?: string;
  createdAt?: string;
  expiresAt?: string;
  entitlements: {
    applicationIdentifier?: string;
    teamIdentifier?: string;
    getTaskAllow: boolean;
  };
  certificates: {
    subject: string;
    issuer: string;
    validFrom: string;
    validTo: string;
    fingerprint256: string;
  }[];
  warnings: string[];
}

export interface DownloadTask {
  id: string;
  software: Software;
  accountHash: string;
  downloadURL: string;
  sinfs: Sinf[];
  iTunesMetadata?: string;
  status:
    | "pending"
    | "downloading"
    | "paused"
    | "injecting"
    | "completed"
    | "failed";
  progress: number;
  speed: string;
  error?: string;
  filePath?: string;
  signingInfo?: IpaSigningInfo;
  createdAt: string;
}

export interface PackageInfo {
  id: string;
  software: Software;
  accountHash: string;
  filePath: string;
  fileSize: number;
  createdAt: string;
}
