import type { ModelId, UsageCounts } from "./types.js";

interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

const PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-7": {
    inputPerMTok: 15,
    outputPerMTok: 75,
    cacheWritePerMTok: 18.75,
    cacheReadPerMTok: 1.5,
  },
  "claude-opus-4-6": {
    inputPerMTok: 15,
    outputPerMTok: 75,
    cacheWritePerMTok: 18.75,
    cacheReadPerMTok: 1.5,
  },
  "claude-sonnet-4-6": {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheWritePerMTok: 3.75,
    cacheReadPerMTok: 0.3,
  },
  "claude-sonnet-4-5": {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheWritePerMTok: 3.75,
    cacheReadPerMTok: 0.3,
  },
  "claude-haiku-4-5": {
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheWritePerMTok: 1.25,
    cacheReadPerMTok: 0.1,
  },
  "gpt-5.6": {
    inputPerMTok: 5,
    outputPerMTok: 30,
    cacheWritePerMTok: 6.25,
    cacheReadPerMTok: 0.5,
  },
  "gpt-5.6-sol": {
    inputPerMTok: 5,
    outputPerMTok: 30,
    cacheWritePerMTok: 6.25,
    cacheReadPerMTok: 0.5,
  },
  "gpt-5.6-terra": {
    inputPerMTok: 2.5,
    outputPerMTok: 15,
    cacheWritePerMTok: 3.125,
    cacheReadPerMTok: 0.25,
  },
  "gpt-5.6-luna": {
    inputPerMTok: 1,
    outputPerMTok: 6,
    cacheWritePerMTok: 1.25,
    cacheReadPerMTok: 0.1,
  },
  "chat-latest": {
    inputPerMTok: 5,
    outputPerMTok: 30,
    cacheWritePerMTok: 6.25,
    cacheReadPerMTok: 0.5,
  },
};

const DEFAULT_PRICING: ModelPricing = PRICING["claude-sonnet-4-6"]!;

function lookup(model: ModelId): ModelPricing {
  const exact = PRICING[model];
  if (exact) return exact;
  const lower = model.toLowerCase();
  if (lower.startsWith("gpt-5.6-luna")) return PRICING["gpt-5.6-luna"]!;
  if (lower.startsWith("gpt-5.6-terra")) return PRICING["gpt-5.6-terra"]!;
  if (lower.startsWith("gpt-5.6")) return PRICING["gpt-5.6-sol"]!;
  if (lower === "chat-latest" || lower.startsWith("gpt-")) return PRICING["gpt-5.6-sol"]!;
  for (const [key, val] of Object.entries(PRICING)) {
    if (model.startsWith(key)) return val;
  }
  if (lower.includes("opus")) return PRICING["claude-opus-4-7"]!;
  if (lower.includes("haiku")) return PRICING["claude-haiku-4-5"]!;
  if (lower.includes("sonnet")) return PRICING["claude-sonnet-4-6"]!;
  return DEFAULT_PRICING;
}

export function dollarsFor(model: ModelId, u: UsageCounts): number {
  const p = lookup(model);
  return (
    (u.inputTokens * p.inputPerMTok) / 1_000_000 +
    (u.outputTokens * p.outputPerMTok) / 1_000_000 +
    (u.cacheCreationInputTokens * p.cacheWritePerMTok) / 1_000_000 +
    (u.cacheReadInputTokens * p.cacheReadPerMTok) / 1_000_000
  );
}

export function emptyUsage(): UsageCounts {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
}

export function addUsage(a: UsageCounts, b: UsageCounts): UsageCounts {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens:
      a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}

export function isKnownModel(model: ModelId): boolean {
  if (PRICING[model]) return true;
  for (const key of Object.keys(PRICING)) {
    if (model.startsWith(key)) return true;
  }
  return false;
}
