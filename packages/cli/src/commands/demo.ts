import { dollarsFor, emptyUsage } from "@curatedmcp/tokenshield-core";
import type { UsageCounts } from "@curatedmcp/tokenshield-core";
import { c, sym, dim, emit, say, isJson, emitJson } from "../lib/ui.js";

interface DemoTurn {
  model: string;
  description: string;
  raw: UsageCounts;
  optimized: UsageCounts;
  processors: string[];
}

const SCRIPT: DemoTurn[] = [
  { model: "claude-opus-4-7", description: "User: refactor the auth middleware",
    raw: { inputTokens: 14_000, outputTokens: 1_200, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    optimized: { inputTokens: 14_000, outputTokens: 1_200, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, processors: [] },
  { model: "claude-opus-4-7", description: "tool_use: Read('auth.ts')",
    raw: { inputTokens: 18_200, outputTokens: 250, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    optimized: { inputTokens: 18_200, outputTokens: 250, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, processors: [] },
  { model: "claude-opus-4-7", description: "tool_use: Read('auth.ts') again (5 turns later)",
    raw: { inputTokens: 26_400, outputTokens: 200, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    optimized: { inputTokens: 12_300, outputTokens: 200, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, processors: ["conversation-dedup"] },
  { model: "claude-opus-4-7", description: "tool_use: gh pr list (30KB response)",
    raw: { inputTokens: 38_700, outputTokens: 400, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    optimized: { inputTokens: 14_900, outputTokens: 400, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, processors: ["result-cache"] },
  { model: "claude-opus-4-7", description: "User: now run the tests",
    raw: { inputTokens: 52_800, outputTokens: 950, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    optimized: { inputTokens: 19_100, outputTokens: 950, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, processors: ["conversation-dedup"] },
  { model: "claude-opus-4-7", description: "tool_use: Read('auth.ts') again after edit",
    raw: { inputTokens: 64_100, outputTokens: 180, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    optimized: { inputTokens: 22_400, outputTokens: 180, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, processors: ["diff-file-reads"] },
  { model: "claude-opus-4-7", description: "User: also fix the typing in user.ts",
    raw: { inputTokens: 81_300, outputTokens: 1_400, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    optimized: { inputTokens: 26_900, outputTokens: 1_400, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, processors: ["conversation-dedup"] },
  { model: "claude-opus-4-7", description: "Long assistant turn — early-stop after 'Would you like me to…'",
    raw: { inputTokens: 92_400, outputTokens: 3_200, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    optimized: { inputTokens: 31_400, outputTokens: 850, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, processors: ["conversation-dedup", "stream-early-stop"] },
];

function dollars(n: number): string { return "$" + n.toFixed(n < 1 ? 4 : 2); }
function bar(value: number, max: number, width: number, color: (s: string) => string): string {
  const filled = Math.max(0, Math.min(width, Math.round((value / Math.max(1, max)) * width)));
  return color("█".repeat(filled)) + dim("░".repeat(width - filled));
}

export async function runDemo(opts: { live: boolean }): Promise<void> {
  const liveMode = opts.live && process.stdout.isTTY;

  const totalRaw = emptyUsage();
  const totalOpt = emptyUsage();
  let totalDollarsRaw = 0;
  let totalDollarsOpt = 0;
  const turnResults: Array<{ description: string; processors: string[]; rawDollars: number; optDollars: number; savedDollars: number; savedPct: number }> = [];

  for (const turn of SCRIPT) {
    totalRaw.inputTokens += turn.raw.inputTokens;
    totalRaw.outputTokens += turn.raw.outputTokens;
    totalOpt.inputTokens += turn.optimized.inputTokens;
    totalOpt.outputTokens += turn.optimized.outputTokens;
    const dRaw = dollarsFor(turn.model, turn.raw);
    const dOpt = dollarsFor(turn.model, turn.optimized);
    totalDollarsRaw += dRaw;
    totalDollarsOpt += dOpt;
    const saved = dRaw - dOpt;
    const pct = dRaw > 0 ? (saved / dRaw) * 100 : 0;
    turnResults.push({ description: turn.description, processors: turn.processors, rawDollars: dRaw, optDollars: dOpt, savedDollars: saved, savedPct: pct });
  }

  const totalSaved = totalDollarsRaw - totalDollarsOpt;
  const overallPct = totalDollarsRaw > 0 ? (totalSaved / totalDollarsRaw) * 100 : 0;

  if (isJson()) {
    emitJson({
      ok: true,
      turns: turnResults,
      total: {
        baselineDollars: totalDollarsRaw,
        optimizedDollars: totalDollarsOpt,
        savedDollars: totalSaved,
        savedPercent: overallPct,
      },
    });
    return;
  }

  emit("");
  emit(c.bold("  TokenShield demo") + dim("  — replaying a recorded 8-turn coding session"));
  emit("");
  for (let i = 0; i < turnResults.length; i++) {
    const t = turnResults[i]!;
    const proc = t.processors.length > 0 ? c.cyan(`[${t.processors.join(", ")}]`) : "";
    const savedStr = t.savedDollars > 0 ? `  ${c.green("saved " + dollars(t.savedDollars))} ${dim(`(${t.savedPct.toFixed(0)}%)`)} ${proc}` : "";
    emit(
      `  ${dim(`Turn ${String(i + 1).padStart(2)}/${turnResults.length}`)}  ` +
      t.description.padEnd(48) +
      `  ${dollars(t.rawDollars).padStart(8)} ${dim("→")} ${c.green(dollars(t.optDollars).padStart(8))}` +
      savedStr,
    );
    if (liveMode) await new Promise((r) => setTimeout(r, 280));
  }
  const barWidth = 30;
  emit("");
  emit(c.gray("  " + "─".repeat(barWidth + 30)));
  emit(`  Baseline (no TokenShield)   ${dollars(totalDollarsRaw).padStart(8)}   ${bar(totalDollarsRaw, totalDollarsRaw, barWidth, c.gray)}`);
  emit(`  With TokenShield v1.0       ${c.green(dollars(totalDollarsOpt).padStart(8))}   ${bar(totalDollarsOpt, totalDollarsRaw, barWidth, c.green)}`);
  emit(`  ${c.bold("Saved")}                       ${c.green(dollars(totalSaved).padStart(8))}   ${c.bold(c.green(`(${overallPct.toFixed(1)}%)`))}`);
  emit(c.gray("  " + "─".repeat(barWidth + 30)));
  emit("");
  emit(dim("  This was a recorded demo. To measure your real workload:"));
  emit(`    ${c.cyan("tokenshield setup")}    ${dim("# guided 60-second install")}`);
  emit(`    ${c.cyan("tokenshield up")}       ${dim("# run in foreground")}`);
  emit("");
  // suppress unused
  void say; void sym;
}
