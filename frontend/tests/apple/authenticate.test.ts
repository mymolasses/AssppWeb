import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPlist, parsePlist } from "../../src/apple/plist";
import { authenticate } from "../../src/apple/authenticate";
import { appleRequest } from "../../src/apple/request";
import { fetchBag } from "../../src/apple/bag";

vi.mock("../../src/apple/request", () => ({
  appleRequest: vi.fn(),
}));

vi.mock("../../src/apple/bag", () => ({
  fetchBag: vi.fn(),
  defaultAuthURL: "https://auth.itunes.apple.com/auth/v1/native/fast/",
}));

describe("apple/authenticate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockSuccessfulLogin() {
    vi.mocked(appleRequest).mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: {},
      rawHeaders: [],
      body: buildPlist({
        accountInfo: {
          appleId: "test@example.com",
          address: {
            firstName: "Test",
            lastName: "User",
          },
        },
        passwordToken: "token",
        dsPersonId: "123",
      }),
    });
  }

  it("sets guid query exactly once from bag endpoint", async () => {
    vi.mocked(fetchBag).mockResolvedValue({
      authURL:
        "https://buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/authenticate?foo=1&guid=old-value",
    });
    mockSuccessfulLogin();

    await authenticate(
      "test@example.com",
      "password",
      undefined,
      undefined,
      "aabbccddeeff",
    );

    const requestCall = vi.mocked(appleRequest).mock.calls[0][0];
    const endpoint = new URL(`https://${requestCall.host}${requestCall.path}`);

    expect(endpoint.searchParams.get("guid")).toBe("aabbccddeeff");
    expect(endpoint.searchParams.getAll("guid")).toHaveLength(1);
    expect(endpoint.searchParams.get("foo")).toBe("1");
  });

  it("uses native auth endpoint request headers", async () => {
    vi.mocked(fetchBag).mockResolvedValue({
      authURL: "https://auth.itunes.apple.com/auth/v1/native/fast/",
    });
    mockSuccessfulLogin();

    await authenticate(
      "test@example.com",
      "password",
      undefined,
      undefined,
      "aabbccddeeff",
    );

    const requestCall = vi.mocked(appleRequest).mock.calls[0][0];
    const parsedBody = parsePlist(requestCall.body || "") as Record<
      string,
      any
    >;

    expect(requestCall.host).toBe("auth.itunes.apple.com");
    expect(requestCall.path).toBe("/auth/v1/native/fast/?guid=aabbccddeeff");
    expect(requestCall.headers?.["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(parsedBody.attempt).toBe("1");
  });

  it("does not request verification when Apple reports invalid credentials", async () => {
    vi.mocked(fetchBag).mockResolvedValue({
      authURL: "https://auth.itunes.apple.com/auth/v1/native/fast",
    });
    vi.mocked(appleRequest).mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: {},
      rawHeaders: [],
      body: buildPlist({
        failureType: "-5000",
        dialog: {
          explanation: "Your Apple ID or password was entered incorrectly.",
        },
      }),
    });

    await expect(
      authenticate(
        "test@example.com",
        "wrong-password",
        undefined,
        undefined,
        "aabbccddeeff",
      ),
    ).rejects.toMatchObject({
      codeRequired: false,
      message: "Your Apple ID or password was entered incorrectly.",
    });

    expect(appleRequest).toHaveBeenCalledTimes(1);
  });

  it("requests verification when Apple returns OK without a session token before 2FA", async () => {
    vi.mocked(fetchBag).mockResolvedValue({
      authURL: "https://auth.itunes.apple.com/auth/v1/native/fast",
    });
    vi.mocked(appleRequest).mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: {},
      rawHeaders: [],
      body: "",
    });

    await expect(
      authenticate(
        "test@example.com",
        "password",
        undefined,
        undefined,
        "aabbccddeeff",
      ),
    ).rejects.toMatchObject({ codeRequired: true });
  });

  it("reports missing session token when Apple returns OK without a token after 2FA", async () => {
    vi.mocked(fetchBag).mockResolvedValue({
      authURL: "https://auth.itunes.apple.com/auth/v1/native/fast",
    });
    vi.mocked(appleRequest).mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: {},
      rawHeaders: [],
      body: buildPlist({}),
    });

    await expect(
      authenticate(
        "test@example.com",
        "password",
        "123456",
        undefined,
        "aabbccddeeff",
      ),
    ).rejects.toThrow(
      "Login response did not include an App Store session token",
    );
  });

  it("retries with a native auth endpoint discovered in a non-plist response", async () => {
    vi.mocked(fetchBag).mockResolvedValue({
      authURL:
        "https://buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/authenticate",
    });
    vi.mocked(appleRequest)
      .mockResolvedValueOnce({
        status: 200,
        statusText: "OK",
        headers: { "content-type": "text/html" },
        rawHeaders: [],
        body: `{"authenticateAccount":"https:\\/\\/auth.itunes.apple.com\\/auth\\/v1\\/native"}`,
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: "OK",
        headers: {},
        rawHeaders: [],
        body: buildPlist({
          accountInfo: {
            appleId: "test@example.com",
            address: {
              firstName: "Test",
              lastName: "User",
            },
          },
          passwordToken: "token",
          dsPersonId: "123",
        }),
      });

    await authenticate(
      "test@example.com",
      "password",
      undefined,
      undefined,
      "aabbccddeeff",
    );

    const retryCall = vi.mocked(appleRequest).mock.calls[1][0];
    expect(retryCall.host).toBe("auth.itunes.apple.com");
    expect(retryCall.path).toBe("/auth/v1/native/fast/?guid=aabbccddeeff");
  });

  it("follows redirects while advancing attempt", async () => {
    vi.mocked(fetchBag).mockResolvedValue({
      authURL: "https://auth.itunes.apple.com/auth/v1/native/fast",
    });
    vi.mocked(appleRequest)
      .mockResolvedValueOnce({
        status: 302,
        statusText: "Found",
        headers: {
          location: "https://p42-buy.itunes.apple.com/auth-redirect",
        },
        rawHeaders: [],
        body: "",
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: "OK",
        headers: {},
        rawHeaders: [],
        body: buildPlist({
          accountInfo: {
            appleId: "test@example.com",
            address: {
              firstName: "Test",
              lastName: "User",
            },
          },
          passwordToken: "token",
          dsPersonId: "123",
        }),
      });

    await authenticate(
      "test@example.com",
      "password",
      undefined,
      undefined,
      "aabbccddeeff",
    );

    const redirectCall = vi.mocked(appleRequest).mock.calls[1][0];
    const secondBody = redirectCall.body ?? "";

    expect(redirectCall.host).toBe("p42-buy.itunes.apple.com");
    expect(redirectCall.path).toBe("/auth-redirect");
    expect(secondBody).toContain("<string>2</string>");
  });

  it("follows permanent native auth redirects", async () => {
    vi.mocked(fetchBag).mockResolvedValue({
      authURL: "https://auth.itunes.apple.com/auth/v1/native/fast",
    });
    vi.mocked(appleRequest)
      .mockResolvedValueOnce({
        status: 301,
        statusText: "Moved Permanently",
        headers: {
          location: "https://auth.itunes.apple.com/auth/v1/native/fast/",
        },
        rawHeaders: [],
        body: "",
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: "OK",
        headers: {},
        rawHeaders: [],
        body: buildPlist({
          accountInfo: {
            appleId: "test@example.com",
            address: {
              firstName: "Test",
              lastName: "User",
            },
          },
          passwordToken: "token",
          dsPersonId: "123",
        }),
      });

    await authenticate(
      "test@example.com",
      "password",
      undefined,
      undefined,
      "aabbccddeeff",
    );

    expect(appleRequest).toHaveBeenCalledTimes(2);
    expect(vi.mocked(appleRequest).mock.calls[1][0].path).toBe(
      "/auth/v1/native/fast/",
    );
  });

  it("strips spaces from verification code before appending to password", async () => {
    vi.mocked(fetchBag).mockResolvedValue({
      authURL: "https://auth.itunes.apple.com/auth/v1/native/fast",
    });
    mockSuccessfulLogin();

    await authenticate(
      "test@example.com",
      "password",
      "123 456",
      undefined,
      "aabbccddeeff",
    );

    const requestBody = vi.mocked(appleRequest).mock.calls[0][0].body ?? "";

    expect(requestBody).toContain("<string>password123456</string>");
  });

  it("returns a specific error when account is disabled", async () => {
    vi.mocked(fetchBag).mockResolvedValue({
      authURL: "https://auth.itunes.apple.com/auth/v1/native/fast",
    });
    vi.mocked(appleRequest).mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: {},
      rawHeaders: [],
      body: buildPlist({
        failureType: "",
        customerMessage: "Your account is disabled.",
      }),
    });

    await expect(
      authenticate(
        "test@example.com",
        "password",
        undefined,
        undefined,
        "aabbccddeeff",
      ),
    ).rejects.toThrow("Account is disabled");
  });

  it("does not retry when Apple returns rate limit response", async () => {
    vi.mocked(fetchBag).mockResolvedValue({
      authURL: "https://auth.itunes.apple.com/auth/v1/native/fast",
    });
    vi.mocked(appleRequest).mockResolvedValue({
      status: 429,
      statusText: "Too Many Requests",
      headers: { "content-type": "text/html" },
      rawHeaders: [],
      body: "Rate limit has been exceeded for: mzauth|global|all",
    });

    await expect(
      authenticate(
        "test@example.com",
        "password",
        undefined,
        undefined,
        "aabbccddeeff",
      ),
    ).rejects.toThrow("Apple authentication is temporarily rate limited");

    expect(appleRequest).toHaveBeenCalledTimes(1);
  });

  it("reports unexpected non-plist Apple auth responses", async () => {
    vi.mocked(fetchBag).mockResolvedValue({
      authURL: "https://auth.itunes.apple.com/auth/v1/native/fast",
    });
    vi.mocked(appleRequest).mockResolvedValue({
      status: 403,
      statusText: "Forbidden",
      headers: { "content-type": "text/html" },
      rawHeaders: [],
      body: "<html><body>Forbidden</body></html>",
    });

    await expect(
      authenticate(
        "test@example.com",
        "password",
        undefined,
        undefined,
        "aabbccddeeff",
      ),
    ).rejects.toThrow("Unexpected Apple auth response");
  });

  it("uses customerMessage from JSON Apple auth responses", async () => {
    vi.mocked(fetchBag).mockResolvedValue({
      authURL: "https://auth.itunes.apple.com/auth/v1/native/fast",
    });
    vi.mocked(appleRequest).mockResolvedValue({
      status: 403,
      statusText: "Forbidden",
      headers: { "content-type": "application/json" },
      rawHeaders: [],
      body: JSON.stringify({ customerMessage: "Apple JSON auth error" }),
    });

    await expect(
      authenticate(
        "test@example.com",
        "password",
        undefined,
        undefined,
        "aabbccddeeff",
      ),
    ).rejects.toThrow("Apple JSON auth error");
  });
});
