import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { start, defaultConfig } from "../src/server.js";
function freePort() {
    return new Promise((resolve, reject) => {
        const s = createServer();
        s.listen(0, "127.0.0.1", () => {
            const addr = s.address();
            if (typeof addr === "object" && addr) {
                const port = addr.port;
                s.close(() => resolve(port));
            }
            else {
                reject(new Error("no addr"));
            }
        });
    });
}
async function mockAnthropic(handler) {
    const port = await freePort();
    const server = createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
            if (req.url === "/v1/messages/stream") {
                res.setHeader("content-type", "text/event-stream");
                res.statusCode = 200;
                const events = [
                    { event: "message_start", data: { message: { model: "claude-sonnet-4-6", usage: { input_tokens: 100, output_tokens: 1 } } } },
                    { event: "content_block_delta", data: { delta: { text: "hi" } } },
                    { event: "message_delta", data: { usage: { output_tokens: 50 } } },
                    { event: "message_stop", data: { type: "message_stop" } },
                ];
                for (const e of events) {
                    res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
                }
                res.end();
                handler(events);
            }
            else {
                res.statusCode = 200;
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({
                    id: "msg_test",
                    model: "claude-sonnet-4-6",
                    content: [{ type: "text", text: "ok" }],
                    usage: { input_tokens: 100, output_tokens: 50 },
                }));
                handler([]);
            }
        });
    });
    await new Promise((r) => server.listen(port, "127.0.0.1", () => r()));
    return {
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
    };
}
async function withTempLedger(fn) {
    const dir = mkdtempSync(join(tmpdir(), "ts-test-"));
    try {
        return await fn(join(dir, "ledger.db"));
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
function doRequest(port, path, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = httpRequest({
            host: "127.0.0.1",
            port,
            path,
            method: "POST",
            headers: {
                "content-type": "application/json",
                "content-length": String(Buffer.byteLength(payload)),
            },
        }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        });
        req.on("error", reject);
        req.write(payload);
        req.end();
    });
}
test("passthrough: non-streaming JSON request records usage to ledger", async () => {
    await withTempLedger(async (ledgerPath) => {
        const upstream = await mockAnthropic(() => { });
        const proxyPort = await freePort();
        const dashboardPort = await freePort();
        const handle = await start({
            config: defaultConfig({
                upstreamBaseUrl: upstream.url,
                port: proxyPort,
                dashboardPort,
                ledgerPath,
            }),
        });
        try {
            const res = await doRequest(proxyPort, "/v1/messages", {
                model: "claude-sonnet-4-6",
                messages: [],
                stream: false,
            });
            assert.equal(res.status, 200);
            const parsed = JSON.parse(res.body);
            assert.equal(parsed.usage?.input_tokens, 100);
            // Give the sink a tick to flush
            await new Promise((r) => setTimeout(r, 50));
            const summary = handle.ledger.summary(0);
            assert.equal(summary.requestCount, 1);
            assert.equal(summary.totalInputTokensRaw, 100);
            assert.equal(summary.totalOutputTokensRaw, 50);
            assert.ok(summary.dollarsRaw > 0);
        }
        finally {
            await handle.close();
            await upstream.close();
        }
    });
});
test("passthrough: streaming SSE preserves events byte-faithfully and records usage", async () => {
    await withTempLedger(async (ledgerPath) => {
        const upstream = await mockAnthropic(() => { });
        const proxyPort = await freePort();
        const dashboardPort = await freePort();
        const handle = await start({
            config: defaultConfig({
                upstreamBaseUrl: upstream.url,
                port: proxyPort,
                dashboardPort,
                ledgerPath,
            }),
        });
        try {
            const res = await doRequest(proxyPort, "/v1/messages/stream", {
                model: "claude-sonnet-4-6",
                messages: [],
                stream: true,
            });
            assert.equal(res.status, 200);
            assert.ok(res.body.includes("event: message_start"));
            assert.ok(res.body.includes("event: content_block_delta"));
            assert.ok(res.body.includes("event: message_delta"));
            assert.ok(res.body.includes("event: message_stop"));
            await new Promise((r) => setTimeout(r, 50));
            const summary = handle.ledger.summary(0);
            assert.equal(summary.requestCount, 1);
            assert.equal(summary.totalInputTokensRaw, 100);
            assert.equal(summary.totalOutputTokensRaw, 50);
        }
        finally {
            await handle.close();
            await upstream.close();
        }
    });
});
test("passthrough: upstream unreachable returns 502 with structured error", async () => {
    await withTempLedger(async (ledgerPath) => {
        const proxyPort = await freePort();
        const dashboardPort = await freePort();
        const handle = await start({
            config: defaultConfig({
                upstreamBaseUrl: "http://127.0.0.1:1", // unreachable
                port: proxyPort,
                dashboardPort,
                ledgerPath,
            }),
        });
        try {
            const res = await doRequest(proxyPort, "/v1/messages", { stream: false });
            assert.equal(res.status, 502);
            const parsed = JSON.parse(res.body);
            assert.equal(parsed.error?.type, "tokenshield_upstream_error");
        }
        finally {
            await handle.close();
        }
    });
});
test("health endpoint returns OK without touching upstream", async () => {
    await withTempLedger(async (ledgerPath) => {
        const proxyPort = await freePort();
        const dashboardPort = await freePort();
        const handle = await start({
            config: defaultConfig({
                upstreamBaseUrl: "http://127.0.0.1:1",
                port: proxyPort,
                dashboardPort,
                ledgerPath,
            }),
        });
        try {
            const res = await new Promise((resolve, reject) => {
                const req = httpRequest({ host: "127.0.0.1", port: proxyPort, path: "/__tokenshield/health", method: "GET" }, (r) => {
                    const chunks = [];
                    r.on("data", (c) => chunks.push(c));
                    r.on("end", () => resolve({ status: r.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
                });
                req.on("error", reject);
                req.end();
            });
            assert.equal(res.status, 200);
            assert.match(res.body, /"ok":true/);
        }
        finally {
            await handle.close();
        }
    });
});
//# sourceMappingURL=passthrough.test.js.map