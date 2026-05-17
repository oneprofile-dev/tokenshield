import { IncomingMessage, ServerResponse } from "node:http";
import type { RequestRecord, ProxyConfig } from "../types.js";
type RecordSink = (record: RequestRecord) => void;
export declare function setProcessorEnabled(id: string, enabled: boolean): void;
export declare function getProcessorEnabledIds(): string[];
export declare function getResponseCacheStats(): {
    hits: number;
    misses: number;
    entries: number;
    bytes: number;
};
export declare function handleAnthropicRequest(req: IncomingMessage, res: ServerResponse, config: ProxyConfig, sink: RecordSink): Promise<void>;
export {};
