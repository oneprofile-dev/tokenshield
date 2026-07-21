import type { SSEEvent, UsageCounts, ProviderId } from "../types.js";

/**
 * A Provider knows how to:
 *  - claim a URL path
 *  - parse usage from streamed SSE events
 *  - parse usage from non-streaming JSON responses
 *  - extract the model + stream flag from a request body
 *
 * Processors operate on the abstract Conversation/Message model the
 * provider produces, so the dedup/cache logic doesn't need to know
 * Anthropic vs OpenAI shapes.
 */
export interface Provider {
  readonly id: ProviderId;

  /** Does this provider handle the given inbound URL path? */
  matches(pathname: string): boolean;

  /** Extract model name from a parsed request body. Returns "unknown" if absent. */
  extractModel(body: unknown): string;

  /** Did the request ask for SSE streaming? */
  isStreaming(body: unknown): boolean;

  /** Parse non-streaming response body (already JSON.parsed). */
  usageFromResponseJson(body: unknown): { usage: UsageCounts; model: string | null };

  /** Streaming usage accumulator factory — one per request. */
  createStreamAccumulator(): StreamAccumulator;

  /** Adapt the inbound body into a normalised Conversation for processors. */
  toConversation(body: unknown): Conversation | null;

  /** Apply processor-modified conversation back into a body shape ready to forward. */
  applyConversation(body: unknown, conversation: Conversation): unknown;
}

export interface StreamAccumulator {
  observe(event: SSEEvent): void;
  total(): UsageCounts;
  model(): string | null;
}

// ─── Normalised model (provider-agnostic) ───────────────────────────────────
//
// Processors operate on this shape. Each Provider knows how to translate to/from
// its native message format. This keeps dedup/cache implementations small.

export interface Conversation {
  model: string;
  /** System prompt text (concatenated if provider supports an array). */
  system: string | null;
  messages: ConvMessage[];
  /** Approximate temperature; null when not specified. Used by cache safety check. */
  temperature: number | null;
  /** Provider-specific extras forwarded untouched. */
  raw: Record<string, unknown>;
}

export interface ConvMessage {
  role: "user" | "assistant";
  blocks: ConvBlock[];
}

export type ConvBlock =
  | { kind: "text"; text: string; raw?: unknown }
  | { kind: "tool_use"; id: string; name: string; input: unknown; raw?: unknown }
  | {
      kind: "tool_result";
      tool_use_id: string;
      /** Original content body (string or structured) — kept intact for first-occurrence. */
      content: unknown;
      /** Stable hash of `content` after canonicalization. */
      contentHash: string;
      /** Approx byte size of original content (for accounting). */
      contentBytes: number;
      /** If set, dedup has replaced the content with a pointer; original is "elided". */
      pointer?: {
        priorMessageIndex: number;
        priorToolUseId: string;
        elidedBytes: number;
      };
      raw?: unknown;
    }
  | { kind: "other"; raw: unknown };
