import { Ledger, defaultConfig } from "@curatedmcp/tokenshield-core";
import { c, sym, dim, emit, emitJson, isJson, table } from "../lib/ui.js";

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString();
}
function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
function fmtDollars(n: number): string {
  if (n === 0) return "$0.00";
  return "$" + n.toFixed(n < 0.01 ? 5 : n < 1 ? 4 : 2);
}
function fmtN(n: number): string {
  return n.toLocaleString();
}

export interface LogsOptions {
  limit: number;
  modelFilter?: string;
  errorsOnly: boolean;
}

export async function runLogs(opts: LogsOptions): Promise<void> {
  const cfg = defaultConfig();
  const ledger = new Ledger(cfg.ledgerPath);
  try {
    const recent = ledger.recent(Math.min(Math.max(opts.limit, 1), 500));
    let filtered = recent;
    if (opts.modelFilter) {
      const needle = opts.modelFilter.toLowerCase();
      filtered = filtered.filter((r) => r.model.toLowerCase().includes(needle));
    }
    if (opts.errorsOnly) {
      filtered = filtered.filter((r) => r.upstreamStatus < 200 || r.upstreamStatus >= 300 || r.upstreamError !== null);
    }

    if (isJson()) {
      emitJson({ ok: true, count: filtered.length, records: filtered });
      return;
    }

    if (filtered.length === 0) {
      emit(dim("  No requests match. Run Claude Code through the proxy to populate the ledger."));
      return;
    }

    emit("");
    emit(table(
      filtered.map((r) => {
        const okStatus = r.upstreamStatus >= 200 && r.upstreamStatus < 300;
        const statusStr = r.upstreamError
          ? c.red("ERR")
          : okStatus
          ? c.green(String(r.upstreamStatus))
          : c.yellow(String(r.upstreamStatus));
        return [
          dim(fmtTime(r.timestamp)),
          r.model,
          dim(r.endpoint),
          fmtN(r.usageRaw.inputTokens),
          fmtN(r.usageRaw.outputTokens),
          dim(fmtMs(r.durationMs)),
          fmtDollars(r.dollarsRaw),
          statusStr,
        ];
      }),
      { header: ["Time", "Model", "Endpoint", "Input", "Output", "Dur", "$", "Status"] },
    ));
    emit("");
    emit(dim(`  Showing ${filtered.length} of ${recent.length} recent requests.`));
    // suppress unused warning
    void sym;
  } finally {
    ledger.close();
  }
}
