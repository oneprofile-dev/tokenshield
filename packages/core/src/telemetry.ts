import { createHash } from "node:crypto";
import { hostname, platform, userInfo } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ENDPOINT = process.env["TOKENSHIELD_TELEMETRY_URL"] ?? "https://curatedmcp.com/api/v1/tokenshield/telemetry";

// Flush every N requests OR every M minutes, whichever first. Keeps the
// network footprint tiny and ensures dev sessions still report at the end.
const FLUSH_EVERY_REQUESTS = 50;
const FLUSH_EVERY_MS = 5 * 60 * 1000;

function telemetryDir(): string {
  const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? ".";
  return join(home, ".tokenshield");
}

function settingsFile(): string {
  return join(telemetryDir(), "settings.json");
}

function licenseFile(): string {
  return join(telemetryDir(), "license.json");
}

/**
 * Returns the Pro/Team license token stored by `tokenshield login`, or null
 * if the user is on the free tier. Tags telemetry batches so the cloud
 * dashboard can show the licensee's own machines.
 *
 * Read on every flush (not cached) so logout/login takes effect immediately
 * without restarting the proxy.
 */
function readLicenseToken(): string | null {
  const file = licenseFile();
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as { token?: unknown };
    return typeof parsed.token === "string" && parsed.token.length > 0 ? parsed.token : null;
  } catch {
    return null;
  }
}

interface Settings {
  telemetry: "on" | "off";
  anonId: string;
  firstRunCompleted: boolean;
}

function loadSettings(): Settings {
  const file = settingsFile();
  if (existsSync(file)) {
    try {
      const raw = readFileSync(file, "utf8");
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return {
        telemetry: parsed.telemetry === "off" ? "off" : "on",
        anonId: parsed.anonId ?? generateAnonId(),
        firstRunCompleted: parsed.firstRunCompleted ?? false,
      };
    } catch {
      // fall through
    }
  }
  return {
    telemetry: "on",
    anonId: generateAnonId(),
    firstRunCompleted: false,
  };
}

function saveSettings(s: Settings): void {
  const dir = telemetryDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(s, null, 2), "utf8");
}

function generateAnonId(): string {
  // Deterministic per-machine: sha256 of hostname + username.
  // Cannot be reversed to a person; cannot be cross-correlated with other
  // CuratedMCP products without explicit account linking.
  const seed = `${hostname()}::${userInfo().username}::tokenshield`;
  return createHash("sha256").update(seed).digest("hex");
}

export function isTelemetryEnabled(): boolean {
  // Hard kill switches — these win over settings file
  if (process.env["TOKENSHIELD_TELEMETRY"] === "0" || process.env["TOKENSHIELD_TELEMETRY"] === "off") return false;
  if (process.env["DO_NOT_TRACK"] === "1") return false;
  if (process.env["CI"] === "true") return false;

  const s = loadSettings();
  return s.telemetry === "on";
}

export function setTelemetryEnabled(on: boolean): void {
  const s = loadSettings();
  s.telemetry = on ? "on" : "off";
  s.firstRunCompleted = true;
  saveSettings(s);
}

export function getAnonId(): string {
  return loadSettings().anonId;
}

export function isFirstRun(): boolean {
  return !loadSettings().firstRunCompleted;
}

export function markFirstRunComplete(): void {
  const s = loadSettings();
  s.firstRunCompleted = true;
  saveSettings(s);
}

export function firstRunBanner(): string {
  return [
    "",
    "  ┌──────────────────────────────────────────────────────────────────┐",
    "  │  TokenShield collects anonymous usage stats by default:          │",
    "  │    • Aggregate token counts and $ saved                          │",
    "  │    • CLI version, Node version, OS                               │",
    "  │    • Provider (anthropic/openai/gemini) + most-used model        │",
    "  │                                                                  │",
    "  │  Never sent: prompts, responses, file contents, API keys,        │",
    "  │  IP address, hostname, username, file paths.                     │",
    "  │                                                                  │",
    "  │  Disable any time:   tokenshield telemetry off                   │",
    "  │  Or via env:         TOKENSHIELD_TELEMETRY=0 (or DO_NOT_TRACK=1) │",
    "  │  Source:             https://github.com/oneprofile-dev/tokenshield │",
    "  └──────────────────────────────────────────────────────────────────┘",
    "",
  ].join("\n");
}

// ─── Batched counters ────────────────────────────────────────────────────────

interface Counters {
  requests: number;
  bytesIn: number;
  bytesOut: number;
  bytesSaved: number;
  inputTokens: number;
  outputTokens: number;
  dollarsEstimate: number;
  dollarsSaved: number;
  modelCounts: Map<string, number>;
  provider: string | null;
  client: string | null;
  teamDeployment: boolean;
}

function emptyCounters(): Counters {
  return {
    requests: 0,
    bytesIn: 0,
    bytesOut: 0,
    bytesSaved: 0,
    inputTokens: 0,
    outputTokens: 0,
    dollarsEstimate: 0,
    dollarsSaved: 0,
    modelCounts: new Map(),
    provider: null,
    client: null,
    teamDeployment: false,
  };
}

export interface TelemetryRecord {
  bytesIn: number;
  bytesOut: number;
  bytesSaved: number;
  inputTokens: number;
  outputTokens: number;
  dollarsEstimate: number;
  dollarsSaved: number;
  provider: "anthropic" | "openai" | "gemini" | null;
  model: string | null;
  client: string | null;
  teamDeployment: boolean;
}

export class Telemetry {
  private counters = emptyCounters();
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;

  start(): void {
    if (!isTelemetryEnabled()) return;
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, FLUSH_EVERY_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Best-effort final flush — fire and forget
    void this.flush();
  }

  record(r: TelemetryRecord): void {
    if (!isTelemetryEnabled()) return;

    const c = this.counters;
    c.requests += 1;
    c.bytesIn += r.bytesIn;
    c.bytesOut += r.bytesOut;
    c.bytesSaved += r.bytesSaved;
    c.inputTokens += r.inputTokens;
    c.outputTokens += r.outputTokens;
    c.dollarsEstimate += r.dollarsEstimate;
    c.dollarsSaved += r.dollarsSaved;
    if (r.provider) c.provider = r.provider;
    if (r.client) c.client = r.client;
    if (r.teamDeployment) c.teamDeployment = true;
    if (r.model) c.modelCounts.set(r.model, (c.modelCounts.get(r.model) ?? 0) + 1);

    if (c.requests >= FLUSH_EVERY_REQUESTS) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    if (!isTelemetryEnabled()) return;
    if (this.counters.requests === 0) return;

    this.flushing = true;
    const snap = this.counters;
    this.counters = emptyCounters();

    let topModel: string | null = null;
    let topModelCount = 0;
    for (const [model, count] of snap.modelCounts) {
      if (count > topModelCount) {
        topModel = model;
        topModelCount = count;
      }
    }

    const cliVersion = process.env["npm_package_version"] ?? "unknown";

    const licenseToken = readLicenseToken();

    const payload = {
      anonId: getAnonId(),
      cliVersion,
      nodeVersion: process.version,
      platform: platform(),
      requests: snap.requests,
      bytesIn: snap.bytesIn,
      bytesOut: snap.bytesOut,
      bytesSaved: snap.bytesSaved,
      inputTokens: snap.inputTokens,
      outputTokens: snap.outputTokens,
      dollarsEstimate: Math.round(snap.dollarsEstimate * 1e6) / 1e6,
      dollarsSaved: Math.round(snap.dollarsSaved * 1e6) / 1e6,
      provider: snap.provider ?? undefined,
      topModel: topModel ?? undefined,
      client: snap.client ?? undefined,
      teamDeployment: snap.teamDeployment,
      // Pro/Team association — only present if `tokenshield login` ran
      ...(licenseToken ? { licenseToken } : {}),
    };

    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(t);
    } catch {
      // Telemetry must NEVER affect user experience. Drop the batch silently.
    } finally {
      this.flushing = false;
    }
  }
}

export const telemetry = new Telemetry();
