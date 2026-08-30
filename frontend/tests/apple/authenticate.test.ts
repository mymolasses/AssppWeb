import { beforeEach, describe, expect, it, vi } from "vitest";
import { authenticate } from "../../src/apple/authenticate";

describe("apple/authenticate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends credentials to the SAP backend and restores the local password", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          email: "test@example.com",
          appleId: "test@example.com",
          store: "143441",
          firstName: "Test",
          lastName: "User",
          passwordToken: "token",
          directoryServicesIdentifier: "123",
          cookies: [],
          deviceIdentifier: "aabbccddeeff",
          pod: "42",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const account = await authenticate(
      "test@example.com",
      "password",
      "123 456",
      [],
      "aabbccddeeff",
    );

    expect(account.password).toBe("password");
    expect(account.passwordToken).toBe("token");
    const request = fetchMock.mock.calls[0];
    expect(request[0]).toBe("/api/apple/authenticate");
    expect(JSON.parse(String(request[1]?.body))).toMatchObject({
      email: "test@example.com",
      password: "password",
      authCode: "123456",
      deviceId: "aabbccddeeff",
    });
  });

  it("preserves the backend 2FA requirement", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: "auth code is required", codeRequired: true }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      authenticate(
        "test@example.com",
        "password",
        undefined,
        [],
        "aabbccddeeff",
      ),
    ).rejects.toMatchObject({
      message: "auth code is required",
      codeRequired: true,
    });
  });

  it("sanitizes legacy cookies before sending them to the SAP helper", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ passwordToken: "token", directoryServicesIdentifier: "123" }),
        { status: 200 },
      ),
    );

    await authenticate("test@example.com", "password", undefined, [
      { name: "itspod", value: "pod", path: "/", expiresAt: 1784366249.568, httpOnly: false, secure: true },
    ], "aabbccddeeff");

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).existingCookies).toEqual([
      { name: "itspod", value: "pod", path: "/", expiresAt: 1784366249, httpOnly: false, secure: true },
    ]);
  });

  it("rejects a helper response without an App Store token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          email: "test@example.com",
          cookies: [],
          deviceIdentifier: "aabbccddeeff",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      authenticate(
        "test@example.com",
        "password",
        undefined,
        [],
        "aabbccddeeff",
      ),
    ).rejects.toThrow("Login response did not include an App Store session token");
  });
});
