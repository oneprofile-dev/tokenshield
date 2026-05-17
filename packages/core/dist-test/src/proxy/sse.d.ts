import type { SSEEvent } from "../types.js";
/**
 * Streaming SSE parser. Accepts raw bytes (UTF-8) progressively and yields
 * complete events. Events are buffered until a blank-line terminator is seen.
 *
 * Anthropic's SSE format emits lines of the form:
 *   event: message_start
 *   data: {"type":"message_start", ...}
 *
 * separated by blank lines. We preserve unrecognized fields and pass raw
 * bytes through unchanged so the downstream client sees a byte-faithful
 * stream — we only parse a copy for accounting.
 */
export declare class SSEParser {
    private buffer;
    private eventName;
    private dataLines;
    push(chunk: string): SSEEvent[];
    flush(): SSEEvent[];
}
