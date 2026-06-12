import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, Software } from "../../src/types";
import { getDownloadInfo } from "../../src/apple/download";
import { listVersions } from "../../src/apple/versionFinder";
import { getVersionMetadata } from "../../src/apple/versionLookup";
import { appleRequest } from "../../src/apple/request";
import { buildPlist, parsePlist } from "../../src/apple/plist";

vi.mock("../../src/apple/request", () => ({
  appleRequest: vi.fn(),
}));

const account: Account = {
  email: "test@example.com",
  password: "password",
  appleId: "test@example.com",
  store: "143441",
  firstName: "Test",
  lastName: "User",
  passwordToken: "token",
  directoryServicesIdentifier: "123",
  cookies: [],
  deviceIdentifier: "aabbccddeeff",
  pod: "42",
};

const app: Software = {
  id: 123456,
  bundleID: "com.example.app",
  name: "Example",
  version: "1.0",
  artistName: "Example Inc.",
  sellerName: "Example Inc.",
  description: "Example app",
  averageUserRating: 0,
  userRatingCount: 0,
  artworkUrl: "",
  screenshotUrls: [],
  minimumOsVersion: "15.0",
  releaseDate: "2026-06-12T00:00:00Z",
  primaryGenreName: "Utilities",
};

function response(body: Record<string, any>) {
  return {
    status: 200,
    statusText: "OK",
    headers: {},
    rawHeaders: [],
    body: buildPlist(body),
  };
}

function failure5002() {
  return response({ failureType: "5002" });
}

describe("apple store download fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries downloads through redownload and uses appExtVrsId", async () => {
    vi.mocked(appleRequest)
      .mockResolvedValueOnce(failure5002())
      .mockResolvedValueOnce(
        response({
          songList: [
            {
              URL: "https://example.com/app.ipa",
              metadata: {
                bundleShortVersionString: "2.0",
                bundleVersion: "200",
              },
              sinfs: [{ id: 1, sinf: new Uint8Array([1, 2, 3]) }],
            },
          ],
        }),
      );

    const result = await getDownloadInfo(account, app, "98765");

    expect(result.output.downloadURL).toBe("https://example.com/app.ipa");
    expect(appleRequest).toHaveBeenCalledTimes(2);
    expect(vi.mocked(appleRequest).mock.calls[0][0].host).toBe(
      "p42-buy.itunes.apple.com",
    );
    expect(vi.mocked(appleRequest).mock.calls[1][0].host).toBe(
      "downloaddispatch.itunes.apple.com",
    );
    expect(vi.mocked(appleRequest).mock.calls[1][0].path).toBe(
      "/r/redownload?guid=aabbccddeeff",
    );

    const retryPayload = parsePlist(
      vi.mocked(appleRequest).mock.calls[1][0].body ?? "",
    ) as Record<string, any>;
    expect(retryPayload.appExtVrsId).toBe("98765");
    expect(retryPayload.externalVersionId).toBeUndefined();
  });

  it("retries version lists through redownload after 5002", async () => {
    vi.mocked(appleRequest)
      .mockResolvedValueOnce(failure5002())
      .mockResolvedValueOnce(
        response({
          songList: [
            {
              metadata: {
                softwareVersionExternalIdentifiers: [111, 222],
              },
            },
          ],
        }),
      );

    const result = await listVersions(account, app);

    expect(result.versions).toEqual(["222", "111"]);
    expect(vi.mocked(appleRequest).mock.calls[1][0].host).toBe(
      "downloaddispatch.itunes.apple.com",
    );
  });

  it("retries version metadata through redownload and switches version id key", async () => {
    vi.mocked(appleRequest)
      .mockResolvedValueOnce(failure5002())
      .mockResolvedValueOnce(
        response({
          songList: [
            {
              metadata: {
                bundleShortVersionString: "3.0",
                releaseDate: "2026-06-12T00:00:00Z",
              },
            },
          ],
        }),
      );

    const result = await getVersionMetadata(account, app, "55555");

    expect(result.metadata.displayVersion).toBe("3.0");
    const retryPayload = parsePlist(
      vi.mocked(appleRequest).mock.calls[1][0].body ?? "",
    ) as Record<string, any>;
    expect(retryPayload.appExtVrsId).toBe("55555");
    expect(retryPayload.externalVersionId).toBeUndefined();
  });
});
