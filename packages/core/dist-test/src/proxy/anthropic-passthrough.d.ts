import { IncomingMessage, ServerResponse } from "node:http";
import type { RequestRecord, ProxyConfig } from "../types.js";
type RecordSink = (record: RequestRecord) => void;
/**
 * Forward an inbound request to the configured upstream Anthropic endpoint.
 * Passes bytes through byte-faithfully while recording usage and dollars
 * out-of-band. Fail-open: any internal exception logs and 502s WITH a
 * plain-text error body so the client can retry.
 */
export declare function handleAnthropicRequest(req: IncomingMessage, res: ServerResponse, config: ProxyConfig, sink: RecordSink): Promise<void>;
export {};
