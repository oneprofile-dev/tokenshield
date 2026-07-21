import type { SSEEvent, UsageCounts } from "../types.js";
import { emptyUsage } from "../pricing.js";
import type {
  ConvBlock,
  Conversation,
  ConvMessage,
  Provider,
  StreamAccumulator,
} from "./types.js";
import { byteLength, canonicalize, sha256 } from "./common.js";

interface OpenAIUsage {
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens_details?: Record<string, unknown>;
  prompt_tokens_details?: Record<string, unknown>;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function fromOpenAI(u: OpenAIUsage | undefined): UsageCounts {
  if (!u) return emptyUsage();
  const details = u.input_tokens_details ?? u.prompt_tokens_details ?? {};
  const totalInput = num(u.input_tokens ?? u.prompt_tokens);
  const cachedInput = num(details["cached_tokens"]);
  const cacheWrite = num(details["cache_write_tokens"] ?? details["cache_creation_tokens"]);
  return {
    inputTokens: Math.max(0, totalInput - cachedInput - cacheWrite),
    outputTokens: num(u.output_tokens ?? u.completion_tokens),
    cacheCreationInputTokens: cacheWrite,
    cacheReadInputTokens: cachedInput,
  };
}

function toolResult(toolUseId: string, content: unknown, raw?: unknown): ConvBlock {
  const canonical = canonicalize(content);
  return {
    kind: "tool_result",
    tool_use_id: toolUseId,
    content,
    contentHash: sha256(canonical),
    contentBytes: byteLength(content),
    ...(raw !== undefined ? { raw } : {}),
  };
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function cloneRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

class OpenAIStreamAccumulator implements StreamAccumulator {
  private current: UsageCounts = emptyUsage();
  private modelFromEvent: string | null = null;

  observe(event: SSEEvent): void {
    if (event.data === "[DONE]") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const obj = parsed as Record<string, unknown>;

    const response = obj["response"] as Record<string, unknown> | undefined;
    if (response && typeof response["model"] === "string") {
      this.modelFromEvent = response["model"];
    } else if (typeof obj["model"] === "string") {
      this.modelFromEvent = obj["model"];
    }

    const usage = (response?.["usage"] ?? obj["usage"]) as OpenAIUsage | undefined;
    if (usage) {
      this.current = fromOpenAI(usage);
    }
  }

  total(): UsageCounts {
    return { ...this.current };
  }

  model(): string | null {
    return this.modelFromEvent;
  }
}

function blocksFromContent(content: unknown): ConvBlock[] {
  if (typeof content === "string") {
    return [{ kind: "text", text: content }];
  }
  if (!Array.isArray(content)) {
    return [{ kind: "other", raw: content }];
  }
  return content.map((block): ConvBlock => {
    if (!block || typeof block !== "object") return { kind: "other", raw: block };
    const b = block as Record<string, unknown>;
    const type = b["type"];
    const text = b["text"];
    if (
      (type === "text" || type === "input_text" || type === "output_text") &&
      typeof text === "string"
    ) {
      return { kind: "text", text, raw: block };
    }
    return { kind: "other", raw: block };
  });
}

function responseItemToMessage(item: unknown): ConvMessage {
  if (!item || typeof item !== "object") {
    return { role: "user", blocks: [{ kind: "other", raw: item }] };
  }
  const obj = item as Record<string, unknown>;
  const type = obj["type"];

  if (
    typeof type === "string" &&
    type.endsWith("_call_output") &&
    (typeof obj["call_id"] === "string" || typeof obj["id"] === "string")
  ) {
    const toolUseId = typeof obj["call_id"] === "string" ? obj["call_id"] : (obj["id"] as string);
    return {
      role: "user",
      blocks: [toolResult(toolUseId, obj["output"] ?? obj["content"] ?? "", item)],
    };
  }

  if (
    typeof type === "string" &&
    type.endsWith("_call") &&
    !type.endsWith("_call_output") &&
    (typeof obj["call_id"] === "string" || typeof obj["id"] === "string")
  ) {
    const id = typeof obj["call_id"] === "string" ? obj["call_id"] : (obj["id"] as string);
    const name = typeof obj["name"] === "string" ? obj["name"] : type;
    return {
      role: "assistant",
      blocks: [{ kind: "tool_use", id, name, input: parseMaybeJson(obj["arguments"] ?? obj["input"]), raw: item }],
    };
  }

  const roleRaw = obj["role"];
  if (roleRaw !== "user" && roleRaw !== "assistant") {
    return { role: "user", blocks: [{ kind: "other", raw: item }] };
  }
  return {
    role: roleRaw,
    blocks: blocksFromContent(obj["content"]),
  };
}

function blockContent(block: ConvBlock): unknown {
  if (block.kind !== "tool_result" || !block.pointer) return block.kind === "tool_result" ? block.content : null;
  return (
    `[tokenshield: identical to tool_result ${block.pointer.priorToolUseId} ` +
    `at message ${block.pointer.priorMessageIndex}, ` +
    `sha:${block.contentHash.slice(0, 8)} - ${block.pointer.elidedBytes} bytes elided]`
  );
}

function messageToResponseItem(message: ConvMessage): unknown {
  if (message.blocks.length === 1) {
    const block = message.blocks[0]!;
    if (block.kind === "other") return block.raw;
    if (block.kind === "tool_result") {
      const raw = cloneRecord(block.raw);
      raw["type"] = raw["type"] ?? "function_call_output";
      raw["call_id"] = raw["call_id"] ?? block.tool_use_id;
      if ("content" in raw && !("output" in raw)) {
        raw["content"] = blockContent(block);
      } else {
        raw["output"] = blockContent(block);
      }
      return raw;
    }
    if (block.kind === "tool_use") {
      const raw = cloneRecord(block.raw);
      raw["type"] = raw["type"] ?? "function_call";
      raw["call_id"] = raw["call_id"] ?? block.id;
      raw["name"] = raw["name"] ?? block.name;
      raw["arguments"] = raw["arguments"] ?? JSON.stringify(block.input ?? {});
      return raw;
    }
  }

  return {
    role: message.role,
    content: message.blocks.map((block) => {
      if (block.kind === "text") {
        const raw = cloneRecord(block.raw);
        raw["type"] = raw["type"] ?? (message.role === "assistant" ? "output_text" : "input_text");
        raw["text"] = block.text;
        return raw;
      }
      return block.kind === "other" ? block.raw : { type: "input_text", text: String(blockContent(block)) };
    }),
  };
}

function chatMessageToConvMessage(message: unknown): ConvMessage {
  if (!message || typeof message !== "object") {
    return { role: "user", blocks: [{ kind: "other", raw: message }] };
  }
  const obj = message as Record<string, unknown>;
  const role = obj["role"];

  if (role === "tool" && typeof obj["tool_call_id"] === "string") {
    return {
      role: "user",
      blocks: [toolResult(obj["tool_call_id"], obj["content"] ?? "", message)],
    };
  }

  if (role !== "user" && role !== "assistant") {
    return { role: "user", blocks: [{ kind: "other", raw: message }] };
  }

  const blocks = blocksFromContent(obj["content"]);
  const toolCalls = Array.isArray(obj["tool_calls"]) ? obj["tool_calls"] : [];
  for (const call of toolCalls) {
    if (!call || typeof call !== "object") continue;
    const c = call as Record<string, unknown>;
    const fn = c["function"] as Record<string, unknown> | undefined;
    if (typeof c["id"] !== "string") continue;
    blocks.push({
      kind: "tool_use",
      id: c["id"],
      name: typeof fn?.["name"] === "string" ? fn["name"] : "function",
      input: parseMaybeJson(fn?.["arguments"] ?? {}),
      raw: call,
    });
  }
  return { role, blocks };
}

function messageToChatMessage(message: ConvMessage): unknown {
  if (message.blocks.length === 1) {
    const block = message.blocks[0]!;
    if (block.kind === "other") return block.raw;
    if (block.kind === "tool_result") {
      const raw = cloneRecord(block.raw);
      raw["role"] = raw["role"] ?? "tool";
      raw["tool_call_id"] = raw["tool_call_id"] ?? block.tool_use_id;
      raw["content"] = String(blockContent(block));
      return raw;
    }
  }

  const text = message.blocks
    .filter((block): block is Extract<ConvBlock, { kind: "text" }> => block.kind === "text")
    .map((block) => block.text)
    .join("\n");
  const toolCalls = message.blocks.filter(
    (block): block is Extract<ConvBlock, { kind: "tool_use" }> => block.kind === "tool_use",
  );
  const out: Record<string, unknown> = { role: message.role, content: text };
  if (message.role === "assistant" && toolCalls.length > 0) {
    out["content"] = text.length > 0 ? text : null;
    out["tool_calls"] = toolCalls.map((block) => {
      const raw = cloneRecord(block.raw);
      raw["id"] = raw["id"] ?? block.id;
      raw["type"] = raw["type"] ?? "function";
      const fn = cloneRecord(raw["function"]);
      fn["name"] = fn["name"] ?? block.name;
      fn["arguments"] = fn["arguments"] ?? JSON.stringify(block.input ?? {});
      raw["function"] = fn;
      return raw;
    });
  }
  return out;
}

function extractSystemFromChat(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  const texts = messages
    .map((m) => {
      if (!m || typeof m !== "object") return "";
      const obj = m as Record<string, unknown>;
      return obj["role"] === "system" && typeof obj["content"] === "string" ? obj["content"] : "";
    })
    .filter((s) => s.length > 0);
  return texts.length > 0 ? texts.join("\n\n") : null;
}

export const openai: Provider = {
  id: "openai",

  matches(pathname: string): boolean {
    return pathname.startsWith("/v1/responses") || pathname.startsWith("/v1/chat/completions");
  },

  extractModel(body: unknown): string {
    if (!body || typeof body !== "object") return "unknown";
    const m = (body as Record<string, unknown>)["model"];
    return typeof m === "string" ? m : "unknown";
  },

  isStreaming(body: unknown): boolean {
    return !!body && typeof body === "object" && (body as Record<string, unknown>)["stream"] === true;
  },

  usageFromResponseJson(body: unknown): { usage: UsageCounts; model: string | null } {
    if (!body || typeof body !== "object") return { usage: emptyUsage(), model: null };
    const obj = body as Record<string, unknown>;
    return {
      usage: fromOpenAI(obj["usage"] as OpenAIUsage | undefined),
      model: typeof obj["model"] === "string" ? obj["model"] : null,
    };
  },

  createStreamAccumulator(): StreamAccumulator {
    return new OpenAIStreamAccumulator();
  },

  toConversation(body: unknown): Conversation | null {
    if (!body || typeof body !== "object") return null;
    const obj = body as Record<string, unknown>;
    const model = typeof obj["model"] === "string" ? obj["model"] : "unknown";
    const tempRaw = obj["temperature"];
    const temperature = typeof tempRaw === "number" ? tempRaw : null;

    if (pathnameKind(obj) === "responses") {
      const input = obj["input"];
      const messages = typeof input === "string"
        ? [{ role: "user" as const, blocks: [{ kind: "text" as const, text: input }] }]
        : Array.isArray(input)
        ? input.map(responseItemToMessage)
        : [];
      return {
        model,
        system: typeof obj["instructions"] === "string" ? obj["instructions"] : null,
        messages,
        temperature,
        raw: { ...obj, openaiWire: "responses" },
      };
    }

    const rawMessages = obj["messages"];
    if (!Array.isArray(rawMessages)) return null;
    return {
      model,
      system: extractSystemFromChat(rawMessages),
      messages: rawMessages.map(chatMessageToConvMessage),
      temperature,
      raw: { ...obj, openaiWire: "chat" },
    };
  },

  applyConversation(body: unknown, conversation: Conversation): unknown {
    if (!body || typeof body !== "object") return body;
    const obj = { ...(body as Record<string, unknown>) };
    if (conversation.raw["openaiWire"] === "responses") {
      obj["input"] = conversation.messages.map(messageToResponseItem);
    } else {
      obj["messages"] = conversation.messages.map(messageToChatMessage);
    }
    return obj;
  },
};

function pathnameKind(obj: Record<string, unknown>): "responses" | "chat" {
  return "input" in obj ? "responses" : "chat";
}

export { fromOpenAI };
