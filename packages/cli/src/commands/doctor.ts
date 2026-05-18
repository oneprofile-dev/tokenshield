import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "@curatedmcp/tokenshield-core";
import { classifyApiKey, probeUpstream, checkPort } from "../lib/preflight.js";
import { readDaemon } from "../lib/daemon.js";
import { c, sym, dim, emit, emitJson, isJson, say, heading } from "../lib/ui.js";

/**
 * Detect Claude Code OAuth credentials from a prior `claude login`.
 * If present, Claude Code prefers OAuth Bearer tokens over ANTHROPIC_API_KEY,
 * which routes broken auth through the proxy and produces 401s upstream.
 *
 * Checks both file-based caches (~/.claude/.credentials.json) AND the macOS
 * Keychain (the actual real-world location on Mac, which is where the
 * silent killer lives for most users).
 */
function detectClaudeOAuth(): { found: boolean; source?: string } {
  // 1. File-based caches (Linux + older Claude Code versions on macOS)
  const home = process.env["HOME"] ?? homedir();
  const candidates = [
    join(home, ".claude", ".credentials.json"),
    join(home, ".claude", "credentials.json"),
    join(home, ".config", "claude", "credentials.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, "utf8");
      if (/access[_-]?token|oauth|refresh[_-]?token|bearer/i.test(raw)) {
        return { found: true, source: p };
      }
    } catch {
      return { found: true, source: p };
    }
  }

  // 2. macOS Keychain — where Claude Code actually stores OAuth on Mac.
  // We DON'T read the secret itself (would prompt for keychain unlock);
  // we just check whether an item exists with the known service name.
  if (platform() === "darwin") {
    try {
      // `security find-generic-password -s "Claude Code"` returns 0 if present.
      // Using -g and discarding stderr to avoid any password prompt side-effects.
      execSync('security find-generic-password -s "Claude Code" 2>/dev/null', {
        stdio: ["ignore", "ignore", "ignore"],
        timeout: 2000,
      });
      return { found: true, source: "macOS Keychain (service=\"Claude Code\")" };
    } catch {
      // Either not found (exit != 0) or `security` missing — both safe to ignore
    }
  }

  return { found: false };
}

interface Check {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  hint?: string;
}

function row(c0: Check): string {
  const symbol = c0.status === "ok" ? sym.check : c0.status === "warn" ? sym.warn : sym.cross;
  const name = c0.name.padEnd(24);
  return `  ${symbol}  ${name}  ${c0.detail}`;
}

export async function runDoctor(): Promise<void> {
  const cfg = defaultConfig();
  const checks: Check[] = [];

  // Node version
  const major = Number(process.versions.node.split(".")[0]);
  checks.push(
    major >= 22
      ? { name: "Node version", status: "ok", detail: `${process.version} (>= 22)` }
      : { name: "Node version", status: "fail", detail: `${process.version} — requires Node 22+`, hint: "Upgrade: https://nodejs.org/" },
  );

  // API key
  const ks = classifyApiKey(process.env["ANTHROPIC_API_KEY"]);
  if (ks.state === "ok") {
    checks.push({ name: "ANTHROPIC_API_KEY", status: "ok", detail: `set, ends in …${(process.env["ANTHROPIC_API_KEY"] ?? "").slice(-4)}` });
  } else if (ks.state === "wrong_prefix") {
    checks.push({ name: "ANTHROPIC_API_KEY", status: "warn", detail: "set but wrong prefix", hint: ks.hint });
  } else {
    checks.push({ name: "ANTHROPIC_API_KEY", status: "warn", detail: "not set in this shell", hint: ks.hint });
  }

  // Base URL
  const baseUrl = process.env["ANTHROPIC_BASE_URL"];
  if (baseUrl) {
    const local = baseUrl.includes("127.0.0.1") || baseUrl.includes("localhost");
    checks.push(
      local
        ? { name: "ANTHROPIC_BASE_URL", status: "ok", detail: `points at local proxy: ${baseUrl}` }
        : { name: "ANTHROPIC_BASE_URL", status: "warn", detail: `set to ${baseUrl} (not local)` },
    );
  } else {
    checks.push({
      name: "ANTHROPIC_BASE_URL",
      status: "warn",
      detail: "not set in this shell",
      hint: `export ANTHROPIC_BASE_URL=http://${cfg.bind}:${cfg.port}`,
    });
  }

  // Claude Code OAuth credentials — the #1 silent killer for Pro/Max users.
  // If `claude login` ran previously, Claude Code prefers OAuth over the env-var
  // API key. The proxy then forwards an OAuth Bearer token, Anthropic returns 401.
  const oauth = detectClaudeOAuth();
  if (oauth.found) {
    const apiKeyOk = ks.state === "ok";
    if (apiKeyOk) {
      // Worst case — both set. OAuth wins. User thinks it's working.
      checks.push({
        name: "Claude Code auth",
        status: "warn",
        detail: `OAuth + API key both present (OAuth at ${oauth.source}) — Claude Code will silently prefer OAuth and route broken auth through the proxy.`,
        hint: "Fix: use `tokenshield run -- <your prompt>` (auto-injects --bare to force ANTHROPIC_API_KEY). Or remove the OAuth: `security delete-generic-password -s 'Claude Code'` on macOS.",
      });
    } else {
      checks.push({
        name: "Claude Code auth",
        status: "warn",
        detail: `OAuth credentials found at ${oauth.source}`,
        hint: "Set ANTHROPIC_API_KEY in this shell, then use `tokenshield run -- <args>` which forces API-key auth via --bare.",
      });
    }
  } else {
    checks.push({ name: "Claude Code auth", status: "ok", detail: "no OAuth credentials cached (API-key path clear)" });
  }

  // Daemon
  const daemon = readDaemon();
  if (daemon !== null) {
    checks.push({ name: "Daemon", status: "ok", detail: `running, pid ${daemon.pid}, port ${daemon.port}` });
  } else {
    checks.push({ name: "Daemon", status: "warn", detail: "not running (foreground or unstarted)" });
  }

  // Ports
  const proxyPort = await checkPort(cfg.port);
  const dashPort = await checkPort(cfg.dashboardPort);
  // If daemon is running, ports being "in use" is the EXPECTED state.
  const expectInUse = daemon !== null;
  if (expectInUse) {
    checks.push({
      name: `Port ${cfg.port}`,
      status: !proxyPort.available ? "ok" : "warn",
      detail: !proxyPort.available ? "in use by TokenShield (expected)" : "free but daemon claims to be running",
    });
    checks.push({
      name: `Port ${cfg.dashboardPort}`,
      status: !dashPort.available ? "ok" : "warn",
      detail: !dashPort.available ? "in use by TokenShield (expected)" : "free but daemon claims to be running",
    });
  } else {
    checks.push({
      name: `Port ${cfg.port}`,
      status: proxyPort.available ? "ok" : "fail",
      detail: proxyPort.available ? "free" : `in use (${proxyPort.detail ?? "unknown"})`,
      hint: proxyPort.available ? undefined : "tokenshield up --port <other>",
    });
    checks.push({
      name: `Port ${cfg.dashboardPort}`,
      status: dashPort.available ? "ok" : "fail",
      detail: dashPort.available ? "free" : `in use (${dashPort.detail ?? "unknown"})`,
    });
  }

  // Ledger
  if (existsSync(cfg.ledgerPath)) {
    const s = statSync(cfg.ledgerPath);
    checks.push({ name: "Ledger file", status: "ok", detail: `${cfg.ledgerPath} (${s.size} bytes)` });
  } else {
    checks.push({ name: "Ledger file", status: "ok", detail: `will be created at ${cfg.ledgerPath}` });
  }

  // Upstream
  const probe = await probeUpstream(cfg.upstreamBaseUrl);
  checks.push(
    probe.reachable
      ? { name: "Anthropic reachable", status: "ok", detail: `${cfg.upstreamBaseUrl} (${probe.latencyMs}ms, status ${probe.status})` }
      : { name: "Anthropic reachable", status: "fail", detail: `${cfg.upstreamBaseUrl}: ${probe.detail ?? "unknown"}` },
  );

  if (isJson()) {
    emitJson({ ok: checks.every((c) => c.status !== "fail"), checks });
    process.exit(checks.some((c) => c.status === "fail") ? 1 : 0);
  }

  heading("TokenShield doctor");
  emit("");
  for (const ch of checks) {
    emit(row(ch));
    if (ch.hint) emit(`     ${dim(ch.hint)}`);
  }
  emit("");
  const anyFail = checks.some((ch) => ch.status === "fail");
  if (anyFail) {
    emit(`${sym.cross} ${c.bold("Some checks failed.")} Fix the items above, then re-run ${c.cyan("tokenshield doctor")}.`);
  } else {
    emit(`${sym.check} ${c.bold("TokenShield looks healthy.")}`);
  }
  say("");
  process.exit(anyFail ? 1 : 0);
}
