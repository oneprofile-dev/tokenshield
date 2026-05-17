import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { URL } from "node:url";
import { randomUUID } from "node:crypto";
import { emptyUsage, dollarsFor } from "../pricing.js";
import { SSEParser } from "./sse.js";
import { StreamUsageAccumulator, usageFromJson } from "./usage.js";
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
function extractModel(parsedBody) {
    if (!parsedBody || typeof parsedBody !== "object")
        return "unknown";
    const obj = parsedBody;
    return typeof obj["model"] === "string" ? obj["model"] : "unknown";
}
function isStream(parsedBody) {
    if (!parsedBody || typeof parsedBody !== "object")
        return false;
    const obj = parsedBody;
    return obj["stream"] === true;
}
/**
 * Forward an inbound request to the configured upstream Anthropic endpoint.
 * Passes bytes through byte-faithfully while recording usage and dollars
 * out-of-band. Fail-open: any internal exception logs and 502s WITH a
 * plain-text error body so the client can retry.
 */
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
    const model = extractModel(body.parsed);
    const streamed = isStream(body.parsed);
    const upstream = new URL(req.url ?? "/", config.upstreamBaseUrl);
    const isHttps = upstream.protocol === "https:";
    const requester = isHttps ? httpsRequest : httpRequest;
    const headers = copyHeaders(req.headers);
    headers["host"] = upstream.host;
    headers["content-length"] = String(body.raw.length);
    let upstreamStatus = 0;
    let upstreamError = null;
    let usage = emptyUsage();
    let modelFromResponse = null;
    const finalize = () => {
        const dollars = dollarsFor(modelFromResponse ?? model, usage);
        const record = {
            id: requestId,
            timestamp: startedAt,
            model: modelFromResponse ?? model,
            endpoint: upstream.pathname,
            streamed,
            durationMs: Date.now() - startedAt,
            upstreamStatus,
            upstreamError,
            usageRaw: usage,
            usageSent: usage,
            dollarsRaw: dollars,
            dollarsSent: dollars,
            dollarsSaved: 0,
            processorsApplied: [],
        };
        try {
            sink(record);
        }
        catch {
            // never let the sink kill the request
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
                res.setHeader(name, value);
            }
            const contentType = String(upstreamRes.headers["content-type"] ?? "");
            const isSse = contentType.includes("text/event-stream");
            if (isSse) {
                const parser = new SSEParser();
                const accum = new StreamUsageAccumulator();
                upstreamRes.on("data", (chunk) => {
                    res.write(chunk);
                    try {
                        for (const ev of parser.push(chunk.toString("utf8"))) {
                            accum.observe(ev);
                        }
                    }
                    catch {
                        // accounting must never break the data path
                    }
                });
                upstreamRes.on("end", () => {
                    try {
                        for (const ev of parser.flush())
                            accum.observe(ev);
                        usage = accum.total();
                        modelFromResponse = accum.model();
                    }
                    catch {
                        // ignore
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
                const chunks = [];
                upstreamRes.on("data", (chunk) => {
                    chunks.push(chunk);
                    res.write(chunk);
                });
                upstreamRes.on("end", () => {
                    try {
                        const text = Buffer.concat(chunks).toString("utf8");
                        if (text.length > 0) {
                            const parsed = JSON.parse(text);
                            const { usage: u, model: m } = usageFromJson(parsed);
                            usage = u;
                            modelFromResponse = m;
                        }
                    }
                    catch {
                        // non-JSON or parse failure — leave usage at zero
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
        upstreamReq.write(body.raw);
        upstreamReq.end();
    });
}
//# sourceMappingURL=anthropic-passthrough.js.map