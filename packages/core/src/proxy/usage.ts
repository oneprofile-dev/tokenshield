import type { SSEEvent, UsageCounts } from "../types.js";
import { emptyUsage, addUsage } from "../pricing.js";

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

function fromAnthropic(u: AnthropicUsage | undefined): UsageCounts {
  if (!u) return emptyUsage();
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
  };
}

/**
 * Accumulates Anthropic usage from a stream of SSE events.
 *
 * Streaming responses emit:
 *   message_start  — has usage with input_tokens + initial output_tokens=1
 *   message_delta  — has usage with cumulative output_tokens
 *   message_stop   — terminal
 *
 * Non-streaming responses come as a single JSON body with `.usage` at the top
 * level — handled by usageFromJson.
 */
export class StreamUsageAccumulator {
  private current: UsageCounts = emptyUsage();
  private modelFromEvent: string | null = null;

  observe(event: SSEEvent): void {
    if (event.event !== "message_start" && event.event !== "message_delta") {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const obj = parsed as Record<string, unknown>;

    if (event.event === "message_start") {
      const message = obj["message"] as Record<string, unknown> | undefined;
      if (message) {
        if (typeof message["model"] === "string") {
          this.modelFromEvent = message["model"] as string;
        }
        const u = fromAnthropic(message["usage"] as AnthropicUsage | undefined);
        this.current = u;
      }
    } else if (event.event === "message_delta") {
      const usage = obj["usage"] as AnthropicUsage | undefined;
      if (usage) {
        // message_delta usage is cumulative for output_tokens; input is fixed
        const u = fromAnthropic(usage);
        this.current = {
          inputTokens: this.current.inputTokens || u.inputTokens,
          outputTokens: u.outputTokens,
          cacheCreationInputTokens:
            this.current.cacheCreationInputTokens ||
            u.cacheCreationInputTokens,
          cacheReadInputTokens:
            this.current.cacheReadInputTokens || u.cacheReadInputTokens,
        };
      }
    }
  }

  total(): UsageCounts {
    return { ...this.current };
  }

  model(): string | null {
    return this.modelFromEvent;
  }
}

export function usageFromJson(body: unknown): {
  usage: UsageCounts;
  model: string | null;
} {
  if (!body || typeof body !== "object") {
    return { usage: emptyUsage(), model: null };
  }
  const obj = body as Record<string, unknown>;
  const usage = fromAnthropic(obj["usage"] as AnthropicUsage | undefined);
  const model = typeof obj["model"] === "string" ? (obj["model"] as string) : null;
  return { usage, model };
}

export { addUsage };
