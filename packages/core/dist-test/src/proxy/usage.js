import { emptyUsage, addUsage } from "../pricing.js";
function fromAnthropic(u) {
    if (!u)
        return emptyUsage();
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
    current = emptyUsage();
    modelFromEvent = null;
    observe(event) {
        if (event.event !== "message_start" && event.event !== "message_delta") {
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(event.data);
        }
        catch {
            return;
        }
        if (!parsed || typeof parsed !== "object")
            return;
        const obj = parsed;
        if (event.event === "message_start") {
            const message = obj["message"];
            if (message) {
                if (typeof message["model"] === "string") {
                    this.modelFromEvent = message["model"];
                }
                const u = fromAnthropic(message["usage"]);
                this.current = u;
            }
        }
        else if (event.event === "message_delta") {
            const usage = obj["usage"];
            if (usage) {
                // message_delta usage is cumulative for output_tokens; input is fixed
                const u = fromAnthropic(usage);
                this.current = {
                    inputTokens: this.current.inputTokens || u.inputTokens,
                    outputTokens: u.outputTokens,
                    cacheCreationInputTokens: this.current.cacheCreationInputTokens ||
                        u.cacheCreationInputTokens,
                    cacheReadInputTokens: this.current.cacheReadInputTokens || u.cacheReadInputTokens,
                };
            }
        }
    }
    total() {
        return { ...this.current };
    }
    model() {
        return this.modelFromEvent;
    }
}
export function usageFromJson(body) {
    if (!body || typeof body !== "object") {
        return { usage: emptyUsage(), model: null };
    }
    const obj = body;
    const usage = fromAnthropic(obj["usage"]);
    const model = typeof obj["model"] === "string" ? obj["model"] : null;
    return { usage, model };
}
export { addUsage };
//# sourceMappingURL=usage.js.map