import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
export class Ledger {
    db;
    insertStmt;
    summaryStmt;
    recentStmt;
    pruneStmt;
    constructor(path) {
        mkdirSync(dirname(path), { recursive: true });
        this.db = new DatabaseSync(path);
        this.db.exec("PRAGMA journal_mode = WAL");
        this.db.exec("PRAGMA synchronous = NORMAL");
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        model TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        streamed INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        upstream_status INTEGER NOT NULL,
        upstream_error TEXT,
        input_tokens_raw INTEGER NOT NULL,
        input_tokens_sent INTEGER NOT NULL,
        output_tokens_raw INTEGER NOT NULL,
        output_tokens_sent INTEGER NOT NULL,
        cache_create_raw INTEGER NOT NULL,
        cache_read_raw INTEGER NOT NULL,
        dollars_raw REAL NOT NULL,
        dollars_sent REAL NOT NULL,
        dollars_saved REAL NOT NULL,
        processors TEXT NOT NULL
      );
    `);
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_requests_ts ON requests(timestamp)");
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_requests_model ON requests(model)");
        this.insertStmt = this.db.prepare(`
      INSERT INTO requests (
        id, timestamp, model, endpoint, streamed, duration_ms,
        upstream_status, upstream_error,
        input_tokens_raw, input_tokens_sent,
        output_tokens_raw, output_tokens_sent,
        cache_create_raw, cache_read_raw,
        dollars_raw, dollars_sent, dollars_saved, processors
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        this.summaryStmt = this.db.prepare(`
      SELECT model,
             COUNT(*) as requests,
             SUM(input_tokens_raw)  as input_tokens_raw,
             SUM(input_tokens_sent) as input_tokens_sent,
             SUM(output_tokens_raw)  as output_tokens_raw,
             SUM(output_tokens_sent) as output_tokens_sent,
             SUM(dollars_raw)   as dollars_raw,
             SUM(dollars_sent)  as dollars_sent,
             SUM(dollars_saved) as dollars_saved
        FROM requests
       WHERE timestamp >= ?
       GROUP BY model
       ORDER BY dollars_raw DESC
    `);
        this.recentStmt = this.db.prepare(`SELECT * FROM requests ORDER BY timestamp DESC LIMIT ?`);
        this.pruneStmt = this.db.prepare(`DELETE FROM requests WHERE timestamp < ?`);
    }
    record(r) {
        this.insertStmt.run(r.id, r.timestamp, r.model, r.endpoint, r.streamed ? 1 : 0, r.durationMs, r.upstreamStatus, r.upstreamError, r.usageRaw.inputTokens, r.usageSent.inputTokens, r.usageRaw.outputTokens, r.usageSent.outputTokens, r.usageRaw.cacheCreationInputTokens, r.usageRaw.cacheReadInputTokens, r.dollarsRaw, r.dollarsSent, r.dollarsSaved, JSON.stringify(r.processorsApplied));
    }
    summary(sinceMs) {
        const now = Date.now();
        const rows = this.summaryStmt.all(sinceMs);
        let totalIRaw = 0, totalISent = 0, totalORaw = 0, totalOSent = 0, dRaw = 0, dSent = 0, dSaved = 0, reqCount = 0;
        for (const r of rows) {
            reqCount += r.requests;
            totalIRaw += r.input_tokens_raw ?? 0;
            totalISent += r.input_tokens_sent ?? 0;
            totalORaw += r.output_tokens_raw ?? 0;
            totalOSent += r.output_tokens_sent ?? 0;
            dRaw += r.dollars_raw ?? 0;
            dSent += r.dollars_sent ?? 0;
            dSaved += r.dollars_saved ?? 0;
        }
        return {
            windowStart: sinceMs,
            windowEnd: now,
            requestCount: reqCount,
            totalInputTokensRaw: totalIRaw,
            totalInputTokensSent: totalISent,
            totalOutputTokensRaw: totalORaw,
            totalOutputTokensSent: totalOSent,
            dollarsRaw: dRaw,
            dollarsSent: dSent,
            dollarsSaved: dSaved,
            byModel: rows.map((r) => ({
                model: r.model,
                requests: r.requests,
                inputTokens: r.input_tokens_raw ?? 0,
                outputTokens: r.output_tokens_raw ?? 0,
                dollars: r.dollars_raw ?? 0,
            })),
        };
    }
    recent(limit = 50) {
        const rows = this.recentStmt.all(limit);
        return rows.map((r) => ({
            id: r.id,
            timestamp: r.timestamp,
            model: r.model,
            endpoint: r.endpoint,
            streamed: r.streamed === 1,
            durationMs: r.duration_ms,
            upstreamStatus: r.upstream_status,
            upstreamError: r.upstream_error,
            usageRaw: {
                inputTokens: r.input_tokens_raw,
                outputTokens: r.output_tokens_raw,
                cacheCreationInputTokens: r.cache_create_raw,
                cacheReadInputTokens: r.cache_read_raw,
            },
            usageSent: {
                inputTokens: r.input_tokens_sent,
                outputTokens: r.output_tokens_sent,
                cacheCreationInputTokens: r.cache_create_raw,
                cacheReadInputTokens: r.cache_read_raw,
            },
            dollarsRaw: r.dollars_raw,
            dollarsSent: r.dollars_sent,
            dollarsSaved: r.dollars_saved,
            processorsApplied: JSON.parse(r.processors ?? "[]"),
        }));
    }
    prune(olderThanMs) {
        const result = this.pruneStmt.run(olderThanMs);
        return Number(result.changes);
    }
    close() {
        this.db.close();
    }
}
//# sourceMappingURL=ledger.js.map