import { withOperation, updateOperation } from '../store/operations';
import { authHeaders } from '../api/client';
import type { Authenticator } from './browserAuthenticate';
import type { Account, Cookie } from '../types';

export class AuthenticationError extends Error {
  constructor(
    message: string,
    public readonly codeRequired: boolean = false,
    public readonly cookies?: Cookie[],
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

interface AuthenticationFailure {
  error?: string;
  codeRequired?: boolean;
  cookies?: Cookie[];
  nativeState?: string;
}

type AuthenticatedAccount = Omit<Account, 'password'>;

function sanitizeExistingCookies(cookies: Cookie[] | undefined): Cookie[] {
  if (!Array.isArray(cookies)) return [];
  return cookies.flatMap((cookie) => {
    if (!cookie || typeof cookie.name !== 'string' || typeof cookie.value !== 'string') {
      return [];
    }
    const expiresAt =
      typeof cookie.expiresAt === 'number' && Number.isFinite(cookie.expiresAt)
        ? Math.trunc(cookie.expiresAt)
        : undefined;
    return [
      {
        name: cookie.name,
        value: cookie.value,
        path: typeof cookie.path === 'string' && cookie.path ? cookie.path : '/',
        ...(typeof cookie.domain === 'string' && cookie.domain ? { domain: cookie.domain } : {}),
        ...(expiresAt === undefined ? {} : { expiresAt }),
        httpOnly: cookie.httpOnly === true,
        secure: cookie.secure === true,
      },
    ];
  });
}

/**
 * Server Anisette uses the pinned native ipatool runtime. Browser SAP is a
 * separate explicit path; never silently POST browser credentials here.
 */
async function serverAuthenticate(
  email: string,
  password: string,
  code?: string,
  existingCookies?: Cookie[],
  deviceId: string = '',
  nativeState?: string,
): Promise<Account> {
  let response: Response;
  try {
    response = await fetch('/api/apple/authenticate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        email,
        password,
        authCode: code?.replace(/\s/g, ''),
        deviceId,
        existingCookies: sanitizeExistingCookies(existingCookies),
        nativeState,
      }),
    });
  } catch (error) {
    throw new AuthenticationError(error instanceof Error ? error.message : String(error));
  }

  if (!response.ok) {
    const failure = (await response.json().catch(() => ({
      error: response.statusText,
    }))) as AuthenticationFailure;
    if (failure.nativeState) pendingNative.set(deviceId, failure.nativeState);
    throw new AuthenticationError(
      failure.error || 'Apple authentication failed',
      failure.codeRequired === true,
      Array.isArray(failure.cookies) ? sanitizeExistingCookies(failure.cookies) : undefined,
    );
  }

  const account = (await response.json()) as AuthenticatedAccount;
  if (!account.passwordToken || !account.directoryServicesIdentifier) {
    throw new AuthenticationError('Login response did not include an App Store session token');
  }

  pendingNative.delete(deviceId);
  return { ...account, email, password, authMethod: 'native' };
}

const pendingNative = new Map<string, string>();
const browserSessions = new Map<string, { authenticator: Authenticator; created: number }>();
export function clearAuthenticationSession(deviceId: string) {
  pendingNative.delete(deviceId);
  for (const key of browserSessions.keys()) if (key.endsWith(':' + deviceId)) browserSessions.delete(key);
}

export async function authenticate(
  email: string,
  password: string,
  code?: string,
  existingCookies?: Cookie[],
  deviceId = '',
  method: 'browser' | 'native' = 'native',
  nativeState?: string,
): Promise<Account> {
  return withOperation(
    'login',
    async () => {
      if (method === 'native') {
        const state = code ? (pendingNative.get(deviceId) ?? nativeState) : nativeState;
        return serverAuthenticate(email, password, code, existingCookies, deviceId, state);
      }
      const { Authenticator, AuthenticationError: BrowserError } = await import('./browserAuthenticate');
      const { default: i18n } = await import('../i18n');
      const key = email.toLowerCase() + ':' + deviceId;
      for (const [id, item] of browserSessions) if (Date.now() - item.created > 600_000) browserSessions.delete(id);
      if (!code || !browserSessions.has(key)) {
        browserSessions.set(key, { authenticator: new Authenticator(deviceId, existingCookies), created: Date.now() });
      }
      try {
        const result = await browserSessions.get(key)!.authenticator.authenticate(email, password, code, (retry) => {
          updateOperation(
            i18n.t('operation.retry', { attempt: retry.attempt, seconds: Math.ceil(retry.delayMs / 1000) }),
          );
        });
        browserSessions.delete(key);
        return { ...result, authMethod: 'browser' };
      } catch (error) {
        if (!(error instanceof BrowserError) || !error.codeRequired) browserSessions.delete(key);
        if (error instanceof BrowserError) throw new AuthenticationError(error.message, error.codeRequired);
        throw error;
      }
    },
    method,
  );
}
