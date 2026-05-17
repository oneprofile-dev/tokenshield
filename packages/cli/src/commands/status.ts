import { request as httpRequest } from "node:http";
import { readDaemon } from "../lib/daemon.js";
import { Ledger, defaultConfig } from "@curatedmcp/tokenshield-core";
import type { SavingsSummary } from "@curatedmcp/tokenshield-core";
import { c, sym, dim, emit, emitJson, isJson, table, heading, say } from "../lib/ui.js";

function fmtDollars(n: number): string {
  if (n === 0) return "$0.00";
  return "$" + n.toFixed(n < 1 ? 4 : 2);
}
function fmtN(n: number): string { return n.toLocaleString(); }
function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

interface HealthOk { ok: true; version?: string }
async function checkProxyHealth(host: string, port: number): Promise<{ ok: boolean; status?: number; detail?: string }> {
  return new Promise((resolve) => {
    const req = httpRequest(
      { host, port, path: "/__tokenshield/health", method: "GET", timeout: 1500 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as HealthOk;
            resolve({ ok: body.ok === true, status: res.statusCode ?? 0 });
          } catch {
            resolve({ ok: false, status: res.statusCode ?? 0, detail: "non-JSON response" });
          }
        });
      },
    );
    req.on("error", (err) => resolve({ ok: false, detail: err.message }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, detail: "timed out" }); });
    req.end();
  });
}

export async function runStatus(): Promise<void> {
  const cfg = defaultConfig();
  const info = readDaemon();
  let summary: SavingsSummary | null = null;
  try {
    const ledger = new Ledger(cfg.ledgerPath);
    summary = ledger.summary(Date.now() - 24 * 60 * 60 * 1000);
    ledger.close();
  } catch {
    summary = null;
  }

  let health: { ok: boolean; detail?: string } | null = null;
  if (info !== null) {
    health = await checkProxyHealth(info.bind, info.port);
  }

  if (isJson()) {
    emitJson({
      ok: true,
      daemon: info,
      health,
      ledger: summary,
    });
    return;
  }

  heading("TokenShield status");
  if (info === null) {
    emit(`  ${sym.dot} Proxy        ${c.gray("not running")}`);
    emit(dim("  Start with: tokenshield up   (or `tokenshield up --daemon` for background)"));
  } else {
    const aliveSym = health?.ok ? sym.check : sym.warn;
    const aliveLabel = health?.ok ? "running" : `running but not responding ${health?.detail ?? ""}`;
    emit(`  ${aliveSym} Proxy        ${aliveLabel}  ${dim(`pid ${info.pid}`)}`);
    emit(`  ${sym.bullet} URL          http://${info.bind}:${info.port}`);
    emit(`  ${sym.bullet} Dashboard    http://${info.bind}:${info.dashboardPort}`);
    emit(`  ${sym.bullet} Uptime       ${fmtUptime(Date.now() - info.startedAt)}`);
  }
  emit("");

  if (summary === null) {
    emit(dim("  (no ledger yet)"));
    return;
  }

  emit(c.bold("  Last 24 hours"));
  emit("");
  emit(`  ${sym.bullet} Requests       ${fmtN(summary.requestCount)}`);
  emit(`  ${sym.bullet} Spent          ${fmtDollars(summary.dollarsRaw)}`);
  emit(`  ${sym.bullet} Input tokens   ${fmtN(summary.totalInputTokensRaw)}`);
  emit(`  ${sym.bullet} Output tokens  ${fmtN(summary.totalOutputTokensRaw)}`);

  if (summary.byModel.length > 0) {
    say("");
    say(table(
      summary.byModel.map((m) => [
        "  " + m.model,
        fmtN(m.requests),
        fmtN(m.inputTokens),
        fmtN(m.outputTokens),
        fmtDollars(m.dollars),
      ]),
      { header: ["  Model", "Reqs", "Input", "Output", "$"] },
    ));
  }
  emit("");
}
