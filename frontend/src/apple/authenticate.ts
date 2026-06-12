import type { Account, Cookie } from "../types";
import { appleRequest } from "./request";
import { buildPlist, parsePlist } from "./plist";
import { extractAndMergeCookies } from "./cookies";
import { fetchBag, defaultAuthURL } from "./bag";
import { authURLFromText, normalizeAuthURL } from "./authEndpoint";
import i18n from "../i18n";

const failureTypeInvalidCredentials = "-5000";
const customerMessageBadLogin = "MZFinance.BadLogin.Configurator_message";
const customerMessageAccountDisabled = "Your account is disabled.";
const maxLoginAttempts = 4;

export class AuthenticationError extends Error {
  constructor(
    message: string,
    public readonly codeRequired: boolean = false,
  ) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export async function authenticate(
  email: string,
  password: string,
  code?: string,
  existingCookies?: Cookie[],
  deviceId: string = "",
): Promise<Account> {
  let cookies: Cookie[] = existingCookies ? [...existingCookies] : [];
  let storeFront = "";
  let lastError: Error | null = null;

  const defaultAuthEndpoint = new URL(defaultAuthURL);
  defaultAuthEndpoint.searchParams.set("guid", deviceId);
  let currentAuthBaseURL = normalizeAuthURL(defaultAuthURL);
  let requestHost = defaultAuthEndpoint.hostname;
  let requestPath = `${defaultAuthEndpoint.pathname}${defaultAuthEndpoint.search}`;

  const bag = await fetchBag(deviceId);
  const authEndpoint = new URL(normalizeAuthURL(bag.authURL));
  authEndpoint.searchParams.set("guid", deviceId);
  currentAuthBaseURL = normalizeAuthURL(bag.authURL);
  requestHost = authEndpoint.hostname;
  requestPath = `${authEndpoint.pathname}${authEndpoint.search}`;

  let pod: string | undefined;

  for (
    let currentAttempt = 1;
    currentAttempt <= maxLoginAttempts;
    currentAttempt++
  ) {
    try {
      const body: Record<string, string> = {
        appleId: email,
        attempt: String(currentAttempt),
        guid: deviceId,
        password: code ? `${password}${code.replace(/ /g, "")}` : password,
        rmp: "0",
        why: "signIn",
      };

      const plistBody = buildPlist(body);

      const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
      };

      const response = await appleRequest({
        method: "POST",
        host: requestHost,
        path: requestPath,
        headers,
        body: plistBody,
        cookies,
      });

      cookies = extractAndMergeCookies(
        response.rawHeaders,
        cookies,
        requestHost,
      );

      // Read store front
      const storeHeader = response.headers["x-set-apple-store-front"];
      if (storeHeader) {
        const parts = storeHeader.split("-");
        if (parts[0]) {
          storeFront = parts[0];
        }
      }

      // Read pod
      const podHeader = response.headers["pod"];
      pod = podHeader || undefined;

      // Handle redirect. The native /fast auth host can answer with 301 as
      // well as the usual 302, so follow the full set of redirect statuses.
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers["location"];
        if (!location) {
          throw new Error(i18n.t("errors.auth.redirectLocation"));
        }
        const url = new URL(location);
        requestHost = url.hostname;
        requestPath = url.pathname + url.search;
        continue;
      }

      if (response.status === 429) {
        throw new AuthenticationError(
          i18n.t("errors.auth.rateLimited", {
            defaultValue:
              "Apple authentication is temporarily rate limited. Stop retrying and wait before trying again.",
          }),
        );
      }

      // Handle non-plist responses (e.g. 403 with empty body)
      if (!response.body.trim()) {
        if (response.status === 200) {
          if (!code) {
            throw new AuthenticationError(
              i18n.t("errors.auth.requiresVerification"),
              true,
            );
          }
          throw new AuthenticationError(
            i18n.t("errors.auth.missingSessionToken", {
              defaultValue:
                "Login response did not include an App Store session token",
            }),
          );
        }

        throw new AuthenticationError(
          i18n.t("errors.auth.emptyBody", { status: response.status }),
        );
      }

      const trimmedBody = response.body.trim();
      if (!trimmedBody.startsWith("<")) {
        const discoveredAuthURL = authURLFromText(trimmedBody);
        if (discoveredAuthURL && discoveredAuthURL !== currentAuthBaseURL) {
          const endpoint = new URL(discoveredAuthURL);
          endpoint.searchParams.set("guid", deviceId);
          currentAuthBaseURL = discoveredAuthURL;
          requestHost = endpoint.hostname;
          requestPath = `${endpoint.pathname}${endpoint.search}`;
          continue;
        }

        try {
          const json = JSON.parse(trimmedBody) as Record<string, any>;
          const message =
            (json.customerMessage as string) ||
            (json.error as string) ||
            (json.message as string) ||
            JSON.stringify(json);
          throw new AuthenticationError(message);
        } catch (error) {
          if (error instanceof AuthenticationError) throw error;
          throw new AuthenticationError(
            `Unexpected Apple auth response: HTTP ${response.status}, content-type ${response.headers["content-type"] || "unknown"}, body starts with ${previewResponseBody(response.body)}`,
          );
        }
      }

      let dict: Record<string, any>;
      try {
        dict = parsePlist(response.body) as Record<string, any>;
      } catch (error) {
        const discoveredAuthURL = authURLFromText(response.body);
        if (discoveredAuthURL && discoveredAuthURL !== currentAuthBaseURL) {
          const endpoint = new URL(discoveredAuthURL);
          endpoint.searchParams.set("guid", deviceId);
          currentAuthBaseURL = discoveredAuthURL;
          requestHost = endpoint.hostname;
          requestPath = `${endpoint.pathname}${endpoint.search}`;
          continue;
        }

        throw new AuthenticationError(
          `Unexpected Apple auth response: HTTP ${response.status}, content-type ${response.headers["content-type"] || "unknown"}, body starts with ${previewResponseBody(response.body)}; ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      if (dict.failureType === failureTypeInvalidCredentials) {
        throw new AuthenticationError(invalidCredentialsMessage(dict));
      }

      // Check for 2FA requirement
      if (
        dict.failureType === "" &&
        !code &&
        dict.customerMessage === customerMessageBadLogin
      ) {
        throw new AuthenticationError(
          i18n.t("errors.auth.requiresVerification"),
          true,
        );
      }

      if (
        dict.failureType === "" &&
        dict.customerMessage === customerMessageAccountDisabled
      ) {
        throw new AuthenticationError(
          i18n.t("errors.auth.accountDisabled", {
            defaultValue: "Account is disabled",
          }),
        );
      }

      const failureMessage = authFailureMessage(dict) ?? dict.customerMessage;

      if (dict.failureType) {
        throw new AuthenticationError(
          failureMessage ?? i18n.t("errors.auth.unknownReason"),
        );
      }

      if (response.status !== 200) {
        throw new AuthenticationError(
          failureMessage ?? i18n.t("errors.auth.unknownReason"),
        );
      }

      if (!dict.passwordToken || !dict.dsPersonId) {
        if (!code) {
          throw new AuthenticationError(
            i18n.t("errors.auth.requiresVerification"),
            true,
          );
        }
        throw new AuthenticationError(
          failureMessage ??
            i18n.t("errors.auth.missingSessionToken", {
              defaultValue:
                "Login response did not include an App Store session token",
            }),
        );
      }

      const accountInfo = dict.accountInfo as Record<string, any>;
      if (!accountInfo) {
        throw new AuthenticationError(
          failureMessage ?? i18n.t("errors.auth.missingAccountInfo"),
        );
      }

      const address = accountInfo.address as Record<string, any>;
      if (!address) {
        throw new AuthenticationError(
          failureMessage ?? i18n.t("errors.auth.missingAddress"),
        );
      }

      const account: Account = {
        email,
        password,
        appleId: (accountInfo.appleId as string) ?? "",
        store: storeFront,
        firstName: (address.firstName as string) ?? "",
        lastName: (address.lastName as string) ?? "",
        passwordToken: (dict.passwordToken as string) ?? "",
        directoryServicesIdentifier: String(dict.dsPersonId ?? ""),
        cookies,
        deviceIdentifier: deviceId,
        pod,
      };

      return account;
    } catch (e) {
      if (e instanceof AuthenticationError) throw e;
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }

  throw (
    lastError ??
    new Error(
      i18n.t("errors.auth.tooManyAttempts", {
        defaultValue: "Too many login attempts",
      }),
    )
  );
}

function previewResponseBody(body: string): string {
  const cleaned = body.replace(/\s+/g, " ").trim().slice(0, 120);
  return JSON.stringify(cleaned);
}

function authFailureMessage(dict: Record<string, any>): string | undefined {
  return (dict.dialog as Record<string, any> | undefined)?.explanation;
}

function invalidCredentialsMessage(dict: Record<string, any>): string {
  return (
    authFailureMessage(dict) ||
    i18n.t("errors.auth.invalidCredentials", {
      defaultValue: "Apple ID or password is incorrect",
    })
  );
}
