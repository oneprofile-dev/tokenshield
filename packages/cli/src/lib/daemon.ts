import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { pidFile, logFile, tokenshieldHome } from "./paths.js";
import { TokenShieldError } from "./errors.js";

export interface DaemonInfo {
  pid: number;
  startedAt: number;
  port: number;
  dashboardPort: number;
  bind: string;
}

function isAliveSync(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EPERM") return true; // exists but no permission to signal
    return false;
  }
}

export function readDaemon(): DaemonInfo | null {
  const path = pidFile();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const data = JSON.parse(raw) as DaemonInfo;
    if (!isAliveSync(data.pid)) {
      // stale pid file
      try { unlinkSync(path); } catch { /* ignore */ }
      return null;
    }
    return data;
  } catch {
    try { unlinkSync(path); } catch { /* ignore */ }
    return null;
  }
}

export function writeDaemon(info: DaemonInfo): void {
  mkdirSync(dirname(pidFile()), { recursive: true });
  writeFileSync(pidFile(), JSON.stringify(info, null, 2));
}

export function clearDaemon(): void {
  try { unlinkSync(pidFile()); } catch { /* ignore */ }
}

export interface SpawnOptions {
  port: number;
  dashboardPort: number;
  bind: string;
  upstream: string;
  openaiUpstream: string;
  ledger: string;
  retentionDays: number;
}

/** Spawn the proxy as a detached background process and return its DaemonInfo. */
export async function spawnDaemon(opts: SpawnOptions): Promise<DaemonInfo> {
  if (process.platform === "win32") {
    throw new TokenShieldError({
      code: "INVALID_ARGUMENT",
      message: "Daemon mode is not yet supported on Windows",
      hint: "Run `tokenshield up` in a dedicated terminal (use Windows Terminal tabs)",
    });
  }

  const existing = readDaemon();
  if (existing !== null) {
    throw new TokenShieldError({
      code: "DAEMON_ALREADY_RUNNING",
      message: `TokenShield is already running (pid ${existing.pid}, port ${existing.port})`,
      hint: "Stop it first or attach to the existing dashboard.",
      nextSteps: ["tokenshield stop", `open http://${existing.bind}:${existing.dashboardPort}`],
    });
  }

  mkdirSync(tokenshieldHome(), { recursive: true });
  const logFd = openSync(logFile(), "a");

  const args: string[] = [
    process.argv[1]!,
    "__supervise",
    "--port", String(opts.port),
    "--dashboard-port", String(opts.dashboardPort),
    "--bind", opts.bind,
    "--upstream", opts.upstream,
    "--openai-upstream", opts.openaiUpstream,
    "--ledger", opts.ledger,
    "--retention-days", String(opts.retentionDays),
  ];
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, TOKENSHIELD_DAEMON: "1" },
  });
  if (typeof child.pid !== "number") {
    throw new TokenShieldError({ code: "INTERNAL", message: "Failed to start daemon process" });
  }
  child.unref();
  const info: DaemonInfo = {
    pid: child.pid,
    startedAt: Date.now(),
    port: opts.port,
    dashboardPort: opts.dashboardPort,
    bind: opts.bind,
  };
  writeDaemon(info);

  // Wait briefly for the proxy to be reachable so the user gets a real ready signal
  const ok = await waitFor(() => isProxyReady(info), 4000);
  if (!ok) {
    // Daemon spawned but isn't responding — keep the pid file so `stop` works
    throw new TokenShieldError({
      code: "INTERNAL",
      message: `Daemon started (pid ${info.pid}) but proxy isn't responding on port ${info.port}`,
      hint: `Check the log at ${logFile()}`,
      nextSteps: [`tail -n 100 ${logFile()}`, "tokenshield stop"],
    });
  }
  return info;
}

export async function stopDaemon(timeoutMs = 8000): Promise<DaemonInfo | null> {
  const info = readDaemon();
  if (info === null) return null;
  try {
    process.kill(info.pid, "SIGTERM");
  } catch {
    clearDaemon();
    return info;
  }
  const stopped = await waitFor(() => !isAliveSync(info.pid), timeoutMs);
  if (!stopped) {
    try { process.kill(info.pid, "SIGKILL"); } catch { /* ignore */ }
  }
  clearDaemon();
  return info;
}

import { request as httpRequest } from "node:http";
function isProxyReady(info: DaemonInfo): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpRequest(
      {
        host: info.bind,
        port: info.port,
        path: "/__tokenshield/health",
        method: "GET",
        timeout: 1000,
      },
      (res) => {
        res.resume();
        resolve((res.statusCode ?? 0) === 200);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

export { isAliveSync };
