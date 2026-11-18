import { Router, Request, Response } from 'express';
import {
  runSAPAuthentication,
  runSAPKBSync,
  runSAPHelper,
  type SAPAuthRequest,
  type SAPAuthCookie,
} from '../services/sapAuth.js';

const router = Router();

router.post('/apple/kbsync', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const { deviceId, dsid } = req.body ?? {};
  if (
    typeof deviceId !== 'string' ||
    !/^[a-f0-9]{12}$/i.test(deviceId) ||
    typeof dsid !== 'string' ||
    !/^[1-9]\d{0,19}$/.test(dsid) ||
    BigInt(dsid) > 18446744073709551615n
  ) {
    res.status(400).json({ error: 'Invalid download signature request' });
    return;
  }
  try {
    // Strip all other fields. Store credentials and app URLs are unnecessary
    // for this calculation and must not be passed to the native operation.
    const result = await runSAPKBSync({ deviceId: deviceId.toLowerCase(), dsid });
    if (!result.kbsync) {
      res.status(502).json({ error: 'Download signature generation failed' });
      return;
    }
    res.json({ kbsync: result.kbsync });
  } catch {
    res.status(502).json({ error: 'Download signature generation failed' });
  }
});

function sanitizeCookies(value: unknown): SAPAuthCookie[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((cookie) => {
    if (!cookie || typeof cookie !== 'object') return [];
    const item = cookie as Record<string, unknown>;
    if (typeof item.name !== 'string' || typeof item.value !== 'string') return [];
    const expiresAt =
      typeof item.expiresAt === 'number' && Number.isFinite(item.expiresAt) ? Math.trunc(item.expiresAt) : undefined;
    return [
      {
        name: item.name,
        value: item.value,
        path: typeof item.path === 'string' && item.path ? item.path : '/',
        ...(typeof item.domain === 'string' && item.domain ? { domain: item.domain } : {}),
        ...(expiresAt === undefined ? {} : { expiresAt }),
        httpOnly: item.httpOnly === true,
        secure: item.secure === true,
      },
    ];
  });
}

router.post('/apple/authenticate', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  const input = req.body as Partial<SAPAuthRequest>;
  if (
    typeof input.email !== 'string' ||
    typeof input.password !== 'string' ||
    typeof input.deviceId !== 'string' ||
    !input.email.trim() ||
    !input.password ||
    !/^[a-fA-F0-9]{12}$/.test(input.deviceId)
  ) {
    res.status(400).json({ error: 'Invalid Apple authentication request' });
    return;
  }

  try {
    const result = await runSAPAuthentication(
      {
        email: input.email.trim(),
        password: input.password,
        authCode: typeof input.authCode === 'string' ? input.authCode : undefined,
        deviceId: input.deviceId.toLowerCase(),
        nativeState:
          typeof input.nativeState === 'string' && input.nativeState.length <= 1024 * 1024
            ? input.nativeState
            : undefined,
        existingCookies: sanitizeCookies(input.existingCookies),
      },
      controller.signal,
    );

    if (res.destroyed) return;
    if (!result.account) {
      res.status(401).json({
        error: result.error || 'Apple authentication failed',
        codeRequired: result.codeRequired === true,
        cookies: result.cookies,
        nativeState: result.nativeState,
      });
      return;
    }

    res.json(result.account);
  } catch (error) {
    if (res.destroyed) return;
    const unavailable = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    res.status(unavailable ? 503 : 502).json({
      error: unavailable
        ? 'SAP authentication helper is not installed'
        : error instanceof Error
          ? error.message
          : 'SAP authentication failed',
    });
  }
});

router.post('/apple/store', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const { operation, account, app, versionId, cacheState } = req.body ?? {};
  if (
    !['download-info', 'purchase', 'versions', 'metadata'].includes(operation) ||
    !account ||
    !/^[a-f0-9]{12}$/i.test(account.deviceIdentifier ?? '') ||
    typeof account.passwordToken !== 'string' ||
    !account.passwordToken ||
    typeof account.directoryServicesIdentifier !== 'string' ||
    !/^[1-9]\d{0,19}$/.test(account.directoryServicesIdentifier) ||
    typeof account.email !== 'string' ||
    typeof account.store !== 'string' ||
    !app ||
    !Number.isSafeInteger(app.id) ||
    app.id <= 0 ||
    typeof app.bundleID !== 'string' ||
    (versionId !== undefined && (typeof versionId !== 'string' || !/^[1-9]\d{0,19}$/.test(versionId))) ||
    (account.nativeState !== undefined &&
      (typeof account.nativeState !== 'string' || account.nativeState.length > 1024 * 1024)) ||
    (cacheState !== undefined && (typeof cacheState !== 'string' || cacheState.length > 512 * 1024))
  ) {
    res.status(400).json({ error: 'Invalid Store operation' });
    return;
  }
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    const result = await runSAPHelper(
      {
        operation,
        versionId,
        cacheState,
        platform: app.kind === 'mac-software' ? 'macos' : 'iphone',
        deviceId: account.deviceIdentifier.toLowerCase(),
        existingCookies: sanitizeCookies(account.cookies),
        account: {
          email: account.email,
          store: account.store,
          pod: account.pod,
          passwordToken: account.passwordToken,
          directoryServicesIdentifier: account.directoryServicesIdentifier,
          nativeState: account.nativeState,
        },
        app: {
          trackId: app.id,
          bundleId: app.bundleID,
          trackName: app.name,
          version: app.version,
          price: Number.isFinite(app.price) ? app.price : 0,
        },
      },
      controller.signal,
    );
    if (!res.destroyed) res.json(result);
  } catch {
    if (!res.destroyed) res.status(502).json({ error: 'Store helper unavailable or timed out' });
  }
});

export default router;
