export type ModelId =
  | "claude-opus-4-7"
  | "claude-opus-4-6"
  | "claude-sonnet-4-6"
  | "claude-sonnet-4-5"
  | "claude-haiku-4-5"
  | "claude-haiku-4-5-20251001"
  | string;

export type ProviderId = "anthropic" | "openai" | "gemini";

export interface UsageCounts {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface RequestRecord {
  id: string;
  timestamp: number;
  provider: ProviderId | "unknown";
  model: ModelId;
  endpoint: string;
  streamed: boolean;
  durationMs: number;
  upstreamStatus: number;
  upstreamError: string | null;
  usageRaw: UsageCounts;
  usageSent: UsageCounts;
  dollarsRaw: number;
  dollarsSent: number;
  dollarsSaved: number;
  processorsApplied: string[];
}

export interface ProxyConfig {
  upstreamBaseUrl: string;
  openaiUpstreamBaseUrl: string;
  port: number;
  bind: string;
  dashboardPort: number;
  ledgerPath: string;
  enabledProcessors: string[];
  retentionDays: number;
}

export type SSEEvent = {
  event: string;
  data: string;
};
