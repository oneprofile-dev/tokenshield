import { Ledger, defaultConfig } from "@curatedmcp/tokenshield-core";
import { c, sym, dim, emit, emitJson, isJson, heading } from "../lib/ui.js";

function dollars(n: number): string {
  return "$" + n.toFixed(n < 1 ? 4 : 2);
}
function fmt(n: number): string {
  return n.toLocaleString();
}

export async function runEstimate(opts: { hours: number }): Promise<void> {
  const hours = opts.hours;
  const cfg = defaultConfig();
  const ledger = new Ledger(cfg.ledgerPath);
  try {
    const since = Date.now() - hours * 60 * 60 * 1000;
    const summary = ledger.summary(since);
    if (summary.requestCount === 0) {
      if (isJson()) {
        emitJson({ ok: true, requestCount: 0, message: "no traffic in window" });
        return;
      }
      emit("");
      emit(`${sym.info} No traffic recorded in the last ${hours}h.`);
      emit(dim("  Run Claude Code through the proxy first:"));
      emit(`    ${c.cyan("tokenshield up")}`);
      emit(`    ${c.cyan(`export ANTHROPIC_BASE_URL=http://${cfg.bind}:${cfg.port}`)}`);
      emit("");
      return;
    }

    const windowMs = Math.max(1, summary.windowEnd - summary.windowStart);
    const weekly = (summary.dollarsRaw / windowMs) * 7 * 24 * 60 * 60 * 1000;
    const monthly = (summary.dollarsRaw / windowMs) * 30 * 24 * 60 * 60 * 1000;

    const targets = [
      { name: "Conversation dedup", pct: 0.30 },
      { name: "Result cache", pct: 0.07 },
      { name: "Diff-based file reads", pct: 0.12 },
      { name: "Streaming early-stop", pct: 0.18 },
      { name: "Context auto-summarize", pct: 0.20 },
    ];
    let surviving = 1;
    const breakdown: Array<{ name: string; saves: number }> = [];
    for (const t of targets) {
      const saves = surviving * t.pct;
      breakdown.push({ name: t.name, saves });
      surviving -= saves;
    }
    const totalSavingsPct = 1 - surviving;
    const projectedMonthlySavings = monthly * totalSavingsPct;

    if (isJson()) {
      emitJson({
        ok: true,
        windowHours: hours,
        requests: summary.requestCount,
        measuredDollars: summary.dollarsRaw,
        projectedWeeklyDollars: weekly,
        projectedMonthlyDollars: monthly,
        projectedMonthlySavingsDollars: projectedMonthlySavings,
        projectedSavingsPercent: totalSavingsPct,
        byModel: summary.byModel,
      });
      return;
    }

    heading(`Estimate (last ${hours}h)`);
    emit("");
    emit(`  ${sym.bullet} Requests:        ${fmt(summary.requestCount)}`);
    emit(`  ${sym.bullet} Measured spend:  ${dollars(summary.dollarsRaw)}`);
    emit(`  ${sym.bullet} Input tokens:    ${fmt(summary.totalInputTokensRaw)}`);
    emit(`  ${sym.bullet} Output tokens:   ${fmt(summary.totalOutputTokensRaw)}`);
    emit("");
    emit(`  ${sym.bullet} Projected weekly:  ${dollars(weekly)}`);
    emit(`  ${sym.bullet} Projected monthly: ${dollars(monthly)}`);
    emit("");
    emit(c.bold("  Forward-looking savings at TokenShield v1.0:"));
    for (const b of breakdown) {
      emit(`    ${sym.bullet} ${b.name.padEnd(30)} ${c.green("saves " + dollars(monthly * b.saves) + "/mo")}`);
    }
    emit("");
    emit(`  ${c.bold("Total projected savings:")}  ${c.green(dollars(projectedMonthlySavings) + "/mo")} ${dim(`(${(totalSavingsPct * 100).toFixed(1)}%)`)}`);
    emit(`  ${dim("TokenShield Individual at $19/mo:")}  ROI = ${c.green((projectedMonthlySavings / 19).toFixed(1) + "×")}`);
    emit("");
    emit(c.bold("  Spend by model:"));
    for (const m of summary.byModel) {
      emit(`    ${m.model.padEnd(28)} ${String(m.requests).padStart(6)} req  ${dollars(m.dollars).padStart(8)}`);
    }
    emit("");
  } finally {
    ledger.close();
  }
}
