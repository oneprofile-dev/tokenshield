import type { Conversation } from "../providers/types.js";
import type { ProviderId } from "../providers/types.js";

export interface ProcessorContext {
  providerId: ProviderId;
  /** Stable fingerprint of the conversation (system + first user message hash). */
  conversationFingerprint: string;
  /** Inbound request raw bytes (read-only). */
  inboundBytes: number;
}

export interface ProcessorEffect {
  /** Stable identifier for accounting (e.g. "conversation-dedup"). */
  name: string;
  /** Bytes saved by this processor's modifications. */
  bytesSaved: number;
  /** Optional structured detail for the dashboard / diff-mode. */
  detail?: Record<string, unknown>;
}

export interface ProcessorResult {
  /** Updated conversation (may be a new object; processors must return one). */
  conversation: Conversation;
  /** Effects applied (zero or one entry per call). */
  effects: ProcessorEffect[];
}

/**
 * A request-side processor inspects + rewrites the conversation BEFORE it goes
 * upstream. It must be:
 *   - deterministic: same input → same output, so prompt caching still hits
 *   - fail-open: any throw is caught by the pipeline; original conversation is preserved
 *   - bounded: never adds unbounded latency (no network calls in v0.2)
 */
export interface Processor {
  readonly id: string;
  readonly enabledByDefault: boolean;

  /**
   * Mutate the conversation if appropriate. MUST return a new conversation
   * (or the same reference if no change). Any throw is treated as a soft
   * failure: the pipeline reverts to the input and trips the breaker.
   */
  onRequest(conversation: Conversation, ctx: ProcessorContext): ProcessorResult;
}

export interface PipelineOptions {
  processors: Processor[];
  enabled: Set<string>;
}

export interface PipelineRunResult {
  conversation: Conversation;
  effects: ProcessorEffect[];
  bytesIn: number;
  bytesOut: number;
  errors: Array<{ processor: string; message: string }>;
}
