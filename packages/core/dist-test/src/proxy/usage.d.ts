import type { SSEEvent, UsageCounts } from "../types.js";
import { addUsage } from "../pricing.js";
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
export declare class StreamUsageAccumulator {
    private current;
    private modelFromEvent;
    observe(event: SSEEvent): void;
    total(): UsageCounts;
    model(): string | null;
}
export declare function usageFromJson(body: unknown): {
    usage: UsageCounts;
    model: string | null;
};
export { addUsage };
