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
export class SSEParser {
  private buffer = "";
  private eventName = "";
  private dataLines: string[] = [];

  push(chunk: string): SSEEvent[] {
    this.buffer += chunk;
    const events: SSEEvent[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      if (line === "") {
        if (this.dataLines.length > 0 || this.eventName !== "") {
          events.push({
            event: this.eventName || "message",
            data: this.dataLines.join("\n"),
          });
        }
        this.eventName = "";
        this.dataLines = [];
      } else if (line.startsWith(":")) {
        // comment / keep-alive
      } else if (line.startsWith("event:")) {
        this.eventName = line.slice(6).trimStart();
      } else if (line.startsWith("data:")) {
        this.dataLines.push(line.slice(5).trimStart());
      }
      // ignore other field names (id:, retry:) — not used by Anthropic
    }
    return events;
  }

  flush(): SSEEvent[] {
    if (this.dataLines.length === 0 && this.eventName === "") return [];
    const event = {
      event: this.eventName || "message",
      data: this.dataLines.join("\n"),
    };
    this.eventName = "";
    this.dataLines = [];
    return [event];
  }
}
