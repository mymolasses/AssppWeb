import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookupApp, parseSearchInput, searchApps } from "../../src/api/search";

const software = {
  id: 6761453559,
  bundleID: "com.whiten.app",
  name: "Whiten",
};

describe("api/search", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("parseSearchInput", () => {
    it("recognizes App Store URLs", () => {
      expect(
        parseSearchInput(
          "https://apps.apple.com/us/app/whiten/id6761453559?l=zh-Hans-CN",
        ),
      ).toEqual({ type: "appStoreId", value: "6761453559" });
    });

    it("recognizes prefixed and plain App Store IDs", () => {
      expect(parseSearchInput("id6761453559")).toEqual({
        type: "appStoreId",
        value: "6761453559",
      });
      expect(parseSearchInput("6761453559")).toEqual({
        type: "appStoreId",
        value: "6761453559",
      });
    });

    it("recognizes bundle IDs and ordinary search terms", () => {
      expect(parseSearchInput("com.whiten.app")).toEqual({
        type: "bundleId",
        value: "com.whiten.app",
      });
      expect(parseSearchInput("whiten")).toEqual({
        type: "term",
        value: "whiten",
      });
    });

    it("does not treat non-Apple URLs as App Store IDs", () => {
      const input = "https://example.com/app/id6761453559";
      expect(parseSearchInput(input)).toEqual({ type: "term", value: input });
    });
  });

  it("uses lookup for exact identifiers from the search box", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(software),
    } as Response);

    const result = await searchApps("id6761453559", "US", "iPhone");

    expect(result).toEqual([software]);
    expect(fetch).toHaveBeenCalledWith("/api/lookup?country=US&id=6761453559", {
      headers: {},
    });
  });

  it("uses keyword search for ordinary search terms", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([software]),
    } as Response);

    const result = await searchApps("whiten", "US", "iPhone", 10);

    expect(result).toEqual([software]);
    expect(fetch).toHaveBeenCalledWith(
      "/api/search?term=whiten&country=US&entity=software&limit=10",
      { headers: {} },
    );
  });

  it("uses macSoftware entity for Mac searches", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([software]),
    } as Response);

    const result = await searchApps("whiten", "US", "macSoftware", 10);

    expect(result).toEqual([software]);
    expect(fetch).toHaveBeenCalledWith(
      "/api/search?term=whiten&country=US&entity=macSoftware&limit=10",
      { headers: {} },
    );
  });

  it("looks up numeric App Store IDs with the id parameter", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(software),
    } as Response);

    const result = await lookupApp("6761453559", "US");

    expect(result).toEqual(software);
    expect(fetch).toHaveBeenCalledWith("/api/lookup?country=US&id=6761453559", {
      headers: {},
    });
  });

  it("looks up bundle IDs with the bundleId parameter", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(software),
    } as Response);

    const result = await lookupApp("com.whiten.app", "US");

    expect(result).toEqual(software);
    expect(fetch).toHaveBeenCalledWith(
      "/api/lookup?country=US&bundleId=com.whiten.app",
      { headers: {} },
    );
  });
});
