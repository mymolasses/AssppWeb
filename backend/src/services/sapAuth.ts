import { spawn } from 'child_process';
import { config } from '../config.js';

export interface SAPAuthCookie {
  name: string;
  value: string;
  path: string;
  domain?: string;
  expiresAt?: number;
  httpOnly: boolean;
  secure: boolean;
}

export interface SAPAuthRequest {
  nativeState?: string;
  email: string;
  password: string;
  authCode?: string;
  deviceId: string;
  existingCookies?: SAPAuthCookie[];
}

export interface SAPAuthAccount {
  nativeState?: string;
  email: string;
  appleId: string;
  store: string;
  firstName: string;
  lastName: string;
  passwordToken: string;
  directoryServicesIdentifier: string;
  cookies: SAPAuthCookie[];
  deviceIdentifier: string;
  pod?: string;
}

export interface SAPAuthResult {
  nativeState?: string;
  account?: SAPAuthAccount;
  error?: string;
  codeRequired?: boolean;
  cookies?: SAPAuthCookie[];
}

export interface SAPKBSyncRequest {
  deviceId: string;
  dsid: string;
}

export interface SAPKBSyncResult {
  kbsync?: string;
  error?: string;
}

const MAX_HELPER_OUTPUT_BYTES = 1024 * 1024;

export function runSAPAuthentication(input: SAPAuthRequest, signal?: AbortSignal): Promise<SAPAuthResult> {
  return runSAPHelper(input, signal);
}

export function runSAPKBSync(input: SAPKBSyncRequest): Promise<SAPKBSyncResult> {
  return runSAPHelper({ operation: 'kbsync', deviceId: input.deviceId, dsid: input.dsid });
}

export async function prepareIpaForOTA(packagePath: string): Promise<void> {
  const result = await runSAPHelper({ operation: 'prepare-ipa', packagePath });
  if (!result.prepared || result.error) throw new Error('IPA streaming preparation failed');
}

function runSAPChild(
  input:
    | SAPAuthRequest
    | (SAPKBSyncRequest & { operation: 'kbsync' })
    | { operation: 'prepare-ipa'; packagePath: string }
    | Record<string, unknown>,
  signal?: AbortSignal,
): Promise<SAPAuthResult & SAPKBSyncResult & { prepared?: boolean; [key: string]: unknown }> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.sapAuthHelperPath, [], {
      signal,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || `${config.dataDir}/cache`,
      },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };

    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error('SAP authentication helper timed out')));
    }, config.sapAuthTimeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > MAX_HELPER_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(() => reject(new Error('SAP authentication response is too large')));
      }
    });
    child.stderr.on('data', (chunk: string) => {
      if (Buffer.byteLength(stderr) < MAX_HELPER_OUTPUT_BYTES) stderr += chunk;
    });
    child.on('error', (error) => {
      finish(() => reject(error));
    });
    child.on('close', (code) => {
      finish(() => {
        if (!stdout.trim()) {
          reject(
            new Error(
              code === 0 ? 'SAP authentication helper returned no response' : 'Apple helper failed; retry the request',
            ),
          );
          return;
        }
        try {
          resolve(
            JSON.parse(stdout) as SAPAuthResult & SAPKBSyncResult & { prepared?: boolean; [key: string]: unknown },
          );
        } catch {
          reject(new Error('SAP authentication helper returned invalid JSON'));
        }
      });
    });

    child.stdin.end(JSON.stringify(input));
  });
}

let activeHelpers = 0;
const waitingHelpers: Array<() => void> = [];
export async function runSAPHelper(
  input: Parameters<typeof runSAPChild>[0],
  signal?: AbortSignal,
): ReturnType<typeof runSAPChild> {
  if (signal?.aborted) throw new Error('Apple request cancelled');
  if (waitingHelpers.length >= 16) throw new Error('Apple helper is busy; try again shortly');
  await new Promise<void>((resolve) => {
    if (activeHelpers < 2) {
      activeHelpers++;
      resolve();
    } else waitingHelpers.push(resolve);
  });
  try {
    if (signal?.aborted) throw new Error('Apple request cancelled');
    return await runSAPChild(input, signal);
  } finally {
    const next = waitingHelpers.shift();
    if (next) next();
    else activeHelpers--;
  }
}
