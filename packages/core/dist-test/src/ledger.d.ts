import type { RequestRecord } from "./types.js";
export interface SavingsSummary {
    windowStart: number;
    windowEnd: number;
    requestCount: number;
    totalInputTokensRaw: number;
    totalInputTokensSent: number;
    totalOutputTokensRaw: number;
    totalOutputTokensSent: number;
    dollarsRaw: number;
    dollarsSent: number;
    dollarsSaved: number;
    byModel: Array<{
        model: string;
        requests: number;
        inputTokens: number;
        outputTokens: number;
        dollars: number;
    }>;
}
export declare class Ledger {
    private db;
    private insertStmt;
    private summaryStmt;
    private recentStmt;
    private pruneStmt;
    constructor(path: string);
    record(r: RequestRecord): void;
    summary(sinceMs: number): SavingsSummary;
    recent(limit?: number): RequestRecord[];
    prune(olderThanMs: number): number;
    close(): void;
}
