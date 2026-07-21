import type { SSEEvent, UsageCounts } from "../types.js";
import { emptyUsage } from "../pricing.js";
import type {
  Provider,
  StreamAccumulator,
  Conversation,
  ConvMessage,
  ConvBlock,
} from "./types.js";
import { byteLength, canonicalize, sha256 } from "./common.js";

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

class AnthropicStreamAccumulator implements StreamAccumulator {
  private current: UsageCounts = emptyUsage();
  private modelFromEvent: string | null = null;

  observe(event: SSEEvent): void {
    if (event.event !== "message_start" && event.event !== "message_delta") return;
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
        this.current = fromAnthropic(message["usage"] as AnthropicUsage | undefined);
      }
    } else {
      const usage = obj["usage"] as AnthropicUsage | undefined;
      if (usage) {
        const u = fromAnthropic(usage);
        this.current = {
          inputTokens: this.current.inputTokens || u.inputTokens,
          outputTokens: u.outputTokens,
          cacheCreationInputTokens:
            this.current.cacheCreationInputTokens || u.cacheCreationInputTokens,
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

function blocksFromAnthropic(content: unknown): ConvBlock[] {
  // Anthropic accepts string OR array of blocks for message.content
  if (typeof content === "string") {
    return [{ kind: "text", text: content }];
  }
  if (!Array.isArray(content)) return [{ kind: "other", raw: content }];
  return content.map((block): ConvBlock => {
    if (!block || typeof block !== "object") return { kind: "other", raw: block };
    const b = block as Record<string, unknown>;
    const type = b["type"];
    if (type === "text" && typeof b["text"] === "string") {
      return { kind: "text", text: b["text"] };
    }
    if (type === "tool_use" && typeof b["id"] === "string" && typeof b["name"] === "string") {
      return { kind: "tool_use", id: b["id"], name: b["name"], input: b["input"] };
    }
    if (type === "tool_result" && typeof b["tool_use_id"] === "string") {
      const content = b["content"];
      const hash = sha256(canonicalize(content));
      return {
        kind: "tool_result",
        tool_use_id: b["tool_use_id"],
        content,
        contentHash: hash,
        contentBytes: byteLength(content),
      };
    }
    return { kind: "other", raw: block };
  });
}

function blocksToAnthropic(blocks: ConvBlock[]): unknown {
  // Preserve array-vs-string shape: if it was originally a single text block from a
  // string, we still emit an array. Anthropic accepts both.
  return blocks.map((block) => {
    switch (block.kind) {
      case "text":
        return { type: "text", text: block.text };
      case "tool_use":
        return { type: "tool_use", id: block.id, name: block.name, input: block.input };
      case "tool_result": {
        if (block.pointer) {
          const stub =
            `[tokenshield: identical to tool_result ${block.pointer.priorToolUseId} ` +
            `at message ${block.pointer.priorMessageIndex}, ` +
            `sha:${block.contentHash.slice(0, 8)} — ${block.pointer.elidedBytes} bytes elided]`;
          return { type: "tool_result", tool_use_id: block.tool_use_id, content: stub };
        }
        return { type: "tool_result", tool_use_id: block.tool_use_id, content: block.content };
      }
      case "other":
        return block.raw;
    }
  });
}

function extractSystem(body: Record<string, unknown>): string | null {
  const sys = body["system"];
  if (typeof sys === "string") return sys;
  if (Array.isArray(sys)) {
    return sys
      .map((b) => (typeof b === "object" && b !== null && typeof (b as Record<string, unknown>)["text"] === "string" ? (b as Record<string, unknown>)["text"] : ""))
      .join("\n\n");
  }
  return null;
}

export const anthropic: Provider = {
  id: "anthropic",

  matches(pathname: string): boolean {
    return pathname.startsWith("/v1/messages") || pathname.startsWith("/v1/complete");
  },

  extractModel(body: unknown): string {
    if (!body || typeof body !== "object") return "unknown";
    const m = (body as Record<string, unknown>)["model"];
    return typeof m === "string" ? m : "unknown";
  },

  isStreaming(body: unknown): boolean {
    if (!body || typeof body !== "object") return false;
    return (body as Record<string, unknown>)["stream"] === true;
  },

  usageFromResponseJson(body: unknown): { usage: UsageCounts; model: string | null } {
    if (!body || typeof body !== "object") return { usage: emptyUsage(), model: null };
    const obj = body as Record<string, unknown>;
    return {
      usage: fromAnthropic(obj["usage"] as AnthropicUsage | undefined),
      model: typeof obj["model"] === "string" ? (obj["model"] as string) : null,
    };
  },

  createStreamAccumulator(): StreamAccumulator {
    return new AnthropicStreamAccumulator();
  },

  toConversation(body: unknown): Conversation | null {
    if (!body || typeof body !== "object") return null;
    const obj = body as Record<string, unknown>;
    const rawMessages = obj["messages"];
    if (!Array.isArray(rawMessages)) return null;
    const messages: ConvMessage[] = rawMessages
      .map((m): ConvMessage | null => {
        if (!m || typeof m !== "object") return null;
        const msg = m as Record<string, unknown>;
        const role = msg["role"];
        if (role !== "user" && role !== "assistant") return null;
        return { role, blocks: blocksFromAnthropic(msg["content"]) };
      })
      .filter((m): m is ConvMessage => m !== null);

    const model = typeof obj["model"] === "string" ? (obj["model"] as string) : "unknown";
    const tempRaw = obj["temperature"];
    const temperature = typeof tempRaw === "number" ? tempRaw : null;

    return {
      model,
      system: extractSystem(obj),
      messages,
      temperature,
      raw: obj,
    };
  },

  applyConversation(body: unknown, conversation: Conversation): unknown {
    if (!body || typeof body !== "object") return body;
    const obj = { ...(body as Record<string, unknown>) };
    obj["messages"] = conversation.messages.map((m) => ({
      role: m.role,
      content: blocksToAnthropic(m.blocks),
    }));
    return obj;
  },
};

// helpers exported for tests
export { canonicalize, sha256, byteLength };
