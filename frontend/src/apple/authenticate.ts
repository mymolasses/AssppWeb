import type { Account, Cookie } from "../types";
import { authHeaders } from "../api/client";

export class AuthenticationError extends Error {
  constructor(
    message: string,
    public readonly codeRequired: boolean = false,
  ) {
    super(message);
    this.name = "AuthenticationError";
  }
}

interface AuthenticationFailure {
  error?: string;
  codeRequired?: boolean;
}

type AuthenticatedAccount = Omit<Account, "password">;

function sanitizeExistingCookies(cookies: Cookie[] | undefined): Cookie[] {
  if (!Array.isArray(cookies)) return [];
  return cookies.flatMap((cookie) => {
    if (!cookie || typeof cookie.name !== "string" || typeof cookie.value !== "string") {
      return [];
    }
    const expiresAt =
      typeof cookie.expiresAt === "number" && Number.isFinite(cookie.expiresAt)
        ? cookie.expiresAt
        : undefined;
    return [{
      name: cookie.name,
      value: cookie.value,
      path: typeof cookie.path === "string" && cookie.path ? cookie.path : "/",
      ...(typeof cookie.domain === "string" && cookie.domain
        ? { domain: cookie.domain }
        : {}),
      ...(expiresAt === undefined ? {} : { expiresAt }),
      httpOnly: cookie.httpOnly === true,
      secure: cookie.secure === true,
    }];
  });
}

/**
 * Authenticate through the server-side ipatool v2.4 SAP helper. Apple now
 * requires X-Apple-ActionSignature on the login plist; the signer executes
 * Apple's SAP code and therefore cannot run in the browser-only TLS client.
 */
export async function authenticate(
  email: string,
  password: string,
  code?: string,
  existingCookies?: Cookie[],
  deviceId: string = "",
): Promise<Account> {
  let response: Response;
  try {
    response = await fetch("/api/apple/authenticate", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        email,
        password,
        authCode: code?.replace(/ /g, ""),
        deviceId,
        existingCookies: sanitizeExistingCookies(existingCookies),
      }),
    });
  } catch (error) {
    throw new AuthenticationError(
      error instanceof Error ? error.message : String(error),
    );
  }

  if (!response.ok) {
    const failure = (await response.json().catch(() => ({
      error: response.statusText,
    }))) as AuthenticationFailure;
    throw new AuthenticationError(
      failure.error || "Apple authentication failed",
      failure.codeRequired === true,
    );
  }

  const account = (await response.json()) as AuthenticatedAccount;
  if (!account.passwordToken || !account.directoryServicesIdentifier) {
    throw new AuthenticationError(
      "Login response did not include an App Store session token",
    );
  }

  return { ...account, email, password };
}
