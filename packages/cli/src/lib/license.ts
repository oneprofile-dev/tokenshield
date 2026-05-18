/**
 * License storage + fetch.
 *
 * Pro/Team users authenticate the CLI by storing a `licenseToken` in
 * ~/.tokenshield/license.json. Every `tokenshield up` refreshes the
 * license tier from curatedmcp.com so revoked subscriptions stop
 * unlocking processors within minutes.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const LICENSE_BASE_URL = process.env["TOKENSHIELD_API_BASE"] ?? "https://www.curatedmcp.com";

export interface LicenseFile {
  token: string;
  // Cached server response — refreshed on every `up` and every 5 minutes
  tier: "free" | "pro" | "team";
  status: "active" | "past_due" | "canceled" | "incomplete";
  enabledProcessors: string[];
  email?: string;
  fetchedAt: string; // ISO
}

function licensePath(): string {
  const home = process.env["HOME"] ?? homedir();
  return join(home, ".tokenshield", "license.json");
}

export function readLicense(): LicenseFile | null {
  const p = licensePath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as LicenseFile;
  } catch {
    return null;
  }
}

export function writeLicense(license: LicenseFile): void {
  const p = licensePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(license, null, 2) + "\n", { mode: 0o600 });
}

export function deleteLicense(): boolean {
  const p = licensePath();
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}

export interface RemoteLicense {
  email: string;
  tier: "free" | "pro" | "team";
  status: "active" | "past_due" | "canceled" | "incomplete";
  enabledProcessors: string[];
  currentPeriodEnd: string | null;
  cancelAt: string | null;
}

/**
 * Validate a token against curatedmcp.com. Returns the server's view of the
 * license so the caller can decide whether to persist it.
 */
export async function fetchRemoteLicense(token: string): Promise<RemoteLicense> {
  const url = `${LICENSE_BASE_URL}/api/v1/tokenshield/license`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (res.status === 404) {
      throw new Error("Unknown license token. Check curatedmcp.com/tokenshield/connect for your token.");
    }
    if (res.status === 401) {
      throw new Error("Token rejected by curatedmcp.com — re-fetch from /tokenshield/connect.");
    }
    if (!res.ok) {
      throw new Error(`License lookup failed: HTTP ${res.status}`);
    }
    return (await res.json()) as RemoteLicense;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error("License lookup timed out (network issue). CLI will continue with cached tier.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Convenience: refresh the locally-cached license from the server.
 * Returns the updated LicenseFile or null if no token is stored / fetch failed.
 */
export async function refreshLicense(): Promise<LicenseFile | null> {
  const local = readLicense();
  if (!local?.token) return null;
  try {
    const remote = await fetchRemoteLicense(local.token);
    const updated: LicenseFile = {
      token: local.token,
      tier: remote.tier,
      status: remote.status,
      enabledProcessors: remote.enabledProcessors,
      email: remote.email,
      fetchedAt: new Date().toISOString(),
    };
    writeLicense(updated);
    return updated;
  } catch {
    // Network/auth failure — keep stale cache so the CLI keeps working offline
    return local;
  }
}
