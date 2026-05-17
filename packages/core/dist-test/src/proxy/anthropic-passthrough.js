import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { URL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { emptyUsage, dollarsFor } from "../pricing.js";
import { SSEParser } from "./sse.js";
import { providerForPath } from "../providers/registry.js";
import { Pipeline } from "../processors/pipeline.js";
import { conversationDedup } from "../processors/conversation-dedup.js";
import { ResponseCache } from "../processors/response-cache.js";
const HOP_BY_HOP = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
]);
function copyHeaders(src) {
    const out = {};
    for (const [name, value] of Object.entries(src)) {
        if (value === undefined)
            continue;
        if (HOP_BY_HOP.has(name.toLowerCase()))
            continue;
        out[name] = Array.isArray(value) ? value.join(", ") : value;
    }
    return out;
}
async function readJsonBody(req, limitBytes = 64 * 1024 * 1024) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        const buf = chunk;
        total += buf.length;
        if (total > limitBytes) {
            throw new Error(`Request body exceeds ${limitBytes} bytes`);
        }
        chunks.push(buf);
    }
    const raw = Buffer.concat(chunks);
    let parsed = null;
    if (raw.length > 0) {
        try {
            parsed = JSON.parse(raw.toString("utf8"));
        }
        catch {
            parsed = null;
        }
    }
    return { raw, parsed };
}
function conversationFingerprint(parsed) {
    if (!parsed || typeof parsed !== "object")
        return "_";
    const obj = parsed;
    const sys = obj["system"];
    const messages = Array.isArray(obj["messages"]) ? obj["messages"] : [];
    const firstUser = messages.find((m) => typeof m === "object" && m !== null && m["role"] === "user");
    return createHash("sha256")
        .update(JSON.stringify({ sys, firstUser }))
        .digest("hex")
        .slice(0, 16);
}
function bodySize(json) {
    return Buffer.byteLength(JSON.stringify(json ?? null), "utf8");
}
/**
 * Singleton pipeline + cache. One process = one set of state.
 * Future: per-license configuration once cloud-tier gating ships.
 */
const PROCESSORS = [conversationDedup];
const ENABLED = new Set(PROCESSORS.filter((p) => p.enabledByDefault).map((p) => p.id));
const PIPELINE = new Pipeline({ processors: PROCESSORS, enabled: ENABLED });
const RESPONSE_CACHE = new ResponseCache();
export function setProcessorEnabled(id, enabled) {
    if (enabled)
        ENABLED.add(id);
    else
        ENABLED.delete(id);
}
export function getProcessorEnabledIds() {
    return Array.from(ENABLED);
}
export function getResponseCacheStats() {
    return RESPONSE_CACHE.stats();
}
export async function handleAnthropicRequest(req, res, config, sink) {
    const startedAt = Date.now();
    const requestId = randomUUID();
    let body;
    try {
        body = await readJsonBody(req);
    }
    catch (err) {
        res.statusCode = 413;
        res.setHeader("content-type", "text/plain");
        res.end(`tokenshield: ${err.message}`);
        return;
    }
    const upstream = new URL(req.url ?? "/", config.upstreamBaseUrl);
    const provider = providerForPath(upstream.pathname);
    const isHttps = upstream.protocol === "https:";
    const requester = isHttps ? httpsRequest : httpRequest;
    // ── 1. Determine model + stream flag from raw body (before any rewrite) ──
    let model = "unknown";
    let streamed = false;
    if (provider !== null) {
        model = provider.extractModel(body.parsed);
        streamed = provider.isStreaming(body.parsed);
    }
    // ── 2. Run request-side processors (fail-open) ──────────────────────────
    let outboundParsed = body.parsed;
    let outboundBytes = body.raw;
    const effects = [];
    let bytesRaw = body.raw.length;
    let bytesSent = body.raw.length;
    if (provider !== null && body.parsed !== null) {
        const conv = provider.toConversation(body.parsed);
        if (conv !== null) {
            const ctx = {
                providerId: provider.id,
                conversationFingerprint: conversationFingerprint(body.parsed),
                inboundBytes: body.raw.length,
            };
            // sizeOf measures wire-format (after applyConversation), not in-memory shape
            const wireSize = (c) => bodySize(provider.applyConversation(body.parsed, c));
            const result = PIPELINE.run(conv, ctx, wireSize);
            for (const e of result.effects)
                effects.push(e);
            if (result.effects.length > 0) {
                outboundParsed = provider.applyConversation(body.parsed, result.conversation);
                const serialized = Buffer.from(JSON.stringify(outboundParsed), "utf8");
                if (serialized.length < body.raw.length) {
                    outboundBytes = serialized;
                    bytesSent = serialized.length;
                }
            }
        }
    }
    // ── 3. Response cache: short-circuit if we have a fresh hit ─────────────
    if (provider !== null && body.parsed !== null) {
        const hit = RESPONSE_CACHE.lookup(body.parsed);
        if (hit !== null) {
            res.statusCode = hit.status;
            for (const [k, v] of Object.entries(hit.headers)) {
                if (HOP_BY_HOP.has(k.toLowerCase()))
                    continue;
                res.setHeader(k, v);
            }
            res.setHeader("x-tokenshield-cache", "hit");
            res.setHeader("x-tokenshield-cache-age-ms", String(hit.cachedAgoMs));
            res.end(hit.body);
            const dollarsRaw = dollarsFor(hit.model || model, {
                inputTokens: hit.usage.inputTokens,
                outputTokens: hit.usage.outputTokens,
                cacheCreationInputTokens: 0,
                cacheReadInputTokens: 0,
            });
            try {
                sink({
                    id: requestId,
                    timestamp: startedAt,
                    model: hit.model || model,
                    endpoint: upstream.pathname,
                    streamed: false,
                    durationMs: Date.now() - startedAt,
                    upstreamStatus: hit.status,
                    upstreamError: null,
                    usageRaw: {
                        inputTokens: hit.usage.inputTokens,
                        outputTokens: hit.usage.outputTokens,
                        cacheCreationInputTokens: 0,
                        cacheReadInputTokens: 0,
                    },
                    // Cached: zero new tokens billed
                    usageSent: emptyUsage(),
                    dollarsRaw,
                    dollarsSent: 0,
                    dollarsSaved: dollarsRaw,
                    processorsApplied: ["response-cache:hit", ...effects.map((e) => e.name)],
                });
            }
            catch {
                /* sink errors must never break the request */
            }
            return;
        }
    }
    const headers = copyHeaders(req.headers);
    headers["host"] = upstream.host;
    headers["content-length"] = String(outboundBytes.length);
    let upstreamStatus = 0;
    let upstreamError = null;
    let usage = emptyUsage();
    let modelFromResponse = null;
    const cachedHeaders = {};
    const responseBodyChunks = [];
    const finalize = () => {
        const effectiveModel = modelFromResponse ?? model;
        const dollarsSent = dollarsFor(effectiveModel, usage);
        // Estimate "raw" cost — what the bill would have been without compression.
        // We use actual sent input tokens + the ratio of bytes saved at the
        // request layer. This is honest: it's an estimate, marked as such.
        const totalBytesSavedReq = Math.max(0, bytesRaw - bytesSent);
        const ratio = bytesSent > 0 ? totalBytesSavedReq / bytesSent : 0;
        const estimatedInputTokensRaw = Math.round(usage.inputTokens * (1 + ratio));
        const usageRaw = {
            inputTokens: estimatedInputTokensRaw,
            outputTokens: usage.outputTokens,
            cacheCreationInputTokens: usage.cacheCreationInputTokens,
            cacheReadInputTokens: usage.cacheReadInputTokens,
        };
        const dollarsRaw = dollarsFor(effectiveModel, usageRaw);
        const dollarsSaved = Math.max(0, dollarsRaw - dollarsSent);
        const record = {
            id: requestId,
            timestamp: startedAt,
            model: effectiveModel,
            endpoint: upstream.pathname,
            streamed,
            durationMs: Date.now() - startedAt,
            upstreamStatus,
            upstreamError,
            usageRaw,
            usageSent: usage,
            dollarsRaw,
            dollarsSent,
            dollarsSaved,
            processorsApplied: effects.map((e) => e.name),
        };
        try {
            sink(record);
        }
        catch {
            /* never */
        }
        // Cache the JSON response (no-op if not cacheable)
        if (!streamed && provider !== null && responseBodyChunks.length > 0) {
            const buf = Buffer.concat(responseBodyChunks);
            RESPONSE_CACHE.store(body.parsed, {
                status: upstreamStatus,
                headers: cachedHeaders,
                body: buf,
                usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
                model: effectiveModel,
            });
        }
    };
    await new Promise((resolve) => {
        const upstreamReq = requester({
            method: req.method ?? "POST",
            hostname: upstream.hostname,
            port: upstream.port || (isHttps ? 443 : 80),
            path: upstream.pathname + upstream.search,
            headers,
        }, (upstreamRes) => {
            upstreamStatus = upstreamRes.statusCode ?? 0;
            res.statusCode = upstreamStatus;
            for (const [name, value] of Object.entries(upstreamRes.headers)) {
                if (value === undefined)
                    continue;
                if (HOP_BY_HOP.has(name.toLowerCase()))
                    continue;
                const strVal = Array.isArray(value) ? value.join(", ") : value;
                res.setHeader(name, strVal);
                cachedHeaders[name] = strVal;
            }
            if (effects.length > 0) {
                res.setHeader("x-tokenshield-processors", effects.map((e) => e.name).join(","));
            }
            const contentType = String(upstreamRes.headers["content-type"] ?? "");
            const isSse = contentType.includes("text/event-stream");
            if (isSse) {
                const parser = new SSEParser();
                const accum = provider !== null ? provider.createStreamAccumulator() : null;
                upstreamRes.on("data", (chunk) => {
                    res.write(chunk);
                    if (accum !== null) {
                        try {
                            for (const ev of parser.push(chunk.toString("utf8"))) {
                                accum.observe(ev);
                            }
                        }
                        catch { /* accounting must never break the data path */ }
                    }
                });
                upstreamRes.on("end", () => {
                    if (accum !== null) {
                        try {
                            for (const ev of parser.flush())
                                accum.observe(ev);
                            usage = accum.total();
                            modelFromResponse = accum.model();
                        }
                        catch { /* ignore */ }
                    }
                    res.end();
                    finalize();
                    resolve();
                });
                upstreamRes.on("error", (err) => {
                    upstreamError = err.message;
                    res.end();
                    finalize();
                    resolve();
                });
            }
            else {
                upstreamRes.on("data", (chunk) => {
                    responseBodyChunks.push(chunk);
                    res.write(chunk);
                });
                upstreamRes.on("end", () => {
                    try {
                        const text = Buffer.concat(responseBodyChunks).toString("utf8");
                        if (text.length > 0 && provider !== null) {
                            const parsed = JSON.parse(text);
                            const u = provider.usageFromResponseJson(parsed);
                            usage = u.usage;
                            modelFromResponse = u.model;
                        }
                    }
                    catch { /* non-JSON or parse failure — leave usage at zero */ }
                    res.end();
                    finalize();
                    resolve();
                });
                upstreamRes.on("error", (err) => {
                    upstreamError = err.message;
                    res.end();
                    finalize();
                    resolve();
                });
            }
        });
        upstreamReq.on("error", (err) => {
            upstreamError = err.message;
            if (!res.headersSent) {
                res.statusCode = 502;
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({
                    type: "error",
                    error: {
                        type: "tokenshield_upstream_error",
                        message: `Failed to reach Anthropic: ${err.message}`,
                    },
                }));
            }
            else {
                res.end();
            }
            finalize();
            resolve();
        });
        upstreamReq.write(outboundBytes);
        upstreamReq.end();
    });
}
//# sourceMappingURL=anthropic-passthrough.js.map