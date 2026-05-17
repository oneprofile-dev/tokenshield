import { existsSync, statSync } from "node:fs";
import { defaultConfig } from "@curatedmcp/tokenshield-core";
import { classifyApiKey, probeUpstream, checkPort } from "../lib/preflight.js";
import { readDaemon } from "../lib/daemon.js";
import { c, sym, dim, emit, emitJson, isJson, say, heading } from "../lib/ui.js";

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
