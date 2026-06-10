import { describe, expect, it } from "vitest";
import {
  authURLFromText,
  defaultAuthURL,
  normalizeAuthURL,
} from "../../src/apple/authEndpoint";

describe("apple/authEndpoint", () => {
  it("falls back to the native fast auth endpoint", () => {
    expect(normalizeAuthURL()).toBe(defaultAuthURL);
  });

  it("normalizes native auth endpoints with fast path and trailing slash", () => {
    expect(
      normalizeAuthURL("https://auth.itunes.apple.com/auth/v1/native"),
    ).toBe("https://auth.itunes.apple.com/auth/v1/native/fast/");
    expect(
      normalizeAuthURL("https://auth.itunes.apple.com/auth/v1/native/fast"),
    ).toBe("https://auth.itunes.apple.com/auth/v1/native/fast/");
  });

  it("keeps legacy auth endpoints unchanged", () => {
    const endpoint =
      "https://buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/authenticate";
    expect(normalizeAuthURL(endpoint)).toBe(endpoint);
  });

  it("extracts native auth endpoints from escaped response text", () => {
    const body = `{"authenticateAccount":"https:\\/\\/auth.itunes.apple.com\\/auth\\/v1\\/native"}`;
    expect(authURLFromText(body)).toBe(
      "https://auth.itunes.apple.com/auth/v1/native/fast/",
    );
  });
});
