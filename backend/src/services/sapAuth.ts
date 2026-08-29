import { spawn } from "child_process";
import { config } from "../config.js";

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
  email: string;
  password: string;
  authCode?: string;
  deviceId: string;
  existingCookies?: SAPAuthCookie[];
}

export interface SAPAuthAccount {
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
  account?: SAPAuthAccount;
  error?: string;
  codeRequired?: boolean;
}

const MAX_HELPER_OUTPUT_BYTES = 1024 * 1024;

export function runSAPAuthentication(
  input: SAPAuthRequest,
): Promise<SAPAuthResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.sapAuthHelperPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        XDG_CACHE_HOME:
          process.env.XDG_CACHE_HOME || `${config.dataDir}/cache`,
      },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error("SAP authentication helper timed out")));
    }, config.sapAuthTimeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > MAX_HELPER_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(() => reject(new Error("SAP authentication response is too large")));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      if (Buffer.byteLength(stderr) < MAX_HELPER_OUTPUT_BYTES) stderr += chunk;
    });
    child.on("error", (error) => {
      finish(() => reject(error));
    });
    child.on("close", (code) => {
      finish(() => {
        if (!stdout.trim()) {
          reject(
            new Error(
              code === 0
                ? "SAP authentication helper returned no response"
                : `SAP authentication helper failed${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
            ),
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout) as SAPAuthResult);
        } catch {
          reject(new Error("SAP authentication helper returned invalid JSON"));
        }
      });
    });

    child.stdin.end(JSON.stringify(input));
  });
}
