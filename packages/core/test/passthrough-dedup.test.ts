import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { start, defaultConfig } from "../src/server.js";

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

function withTempLedger<T>(fn: (p: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "ts-dedup-"));
  return fn(join(dir, "l.db")).finally(() => rmSync(dir, { recursive: true, force: true }));
}

interface UpstreamCapture {
  body: string | null;
  parsed: unknown;
}

async function mockAnthropic(capture: UpstreamCapture): Promise<{ url: string; close: () => Promise<void> }> {
  const port = await freePort();
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      capture.body = Buffer.concat(chunks).toString("utf8");
      try { capture.parsed = JSON.parse(capture.body); } catch { /* ignore */ }
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "msg_test",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "ok" }],
          usage: { input_tokens: 250, output_tokens: 30 },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => { server.close(() => r()); }),
  };
}

function doRequest(port: number, path: string, body: unknown): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = httpRequest(
      {
        host: "127.0.0.1", port, path, method: "POST",
        headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8"), headers: res.headers }));
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

test("end-to-end: dedup rewrites repeated tool_results in the body that reaches Anthropic", async () => {
  await withTempLedger(async (ledgerPath) => {
    const capture: UpstreamCapture = { body: null, parsed: null };
    const upstream = await mockAnthropic(capture);
    const proxyPort = await freePort();
    const dashboardPort = await freePort();
    const handle = await start({
      config: defaultConfig({
        upstreamBaseUrl: upstream.url, port: proxyPort, dashboardPort, ledgerPath,
      }),
    });
    try {
      const bigBlob = Array(300).fill("auth.ts contents line").join(" ");
      const requestBody = {
        model: "claude-sonnet-4-6",
        messages: [
          { role: "assistant", content: [{ type: "tool_use", id: "tu_a", name: "Read", input: { path: "a" } }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_a", content: bigBlob }] },
          { role: "assistant", content: [{ type: "tool_use", id: "tu_b", name: "Read", input: { path: "a" } }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_b", content: bigBlob }] },
        ],
        max_tokens: 1024,
      };

      const res = await doRequest(proxyPort, "/v1/messages", requestBody);
      assert.equal(res.status, 200);
      assert.equal(res.headers["x-tokenshield-processors"], "conversation-dedup");

      // The body Anthropic actually received must contain the pointer stub
      assert.ok(capture.body !== null);
      assert.match(capture.body!, /tokenshield: identical to tool_result tu_a/);
      assert.equal(
        (capture.body!.match(new RegExp(bigBlob, "g")) ?? []).length,
        1,
        "the big blob should appear only once in what we send upstream",
      );

      // Wait for sink to flush
      await new Promise((r) => setTimeout(r, 50));
      const summary = handle.ledger.summary(0);
      assert.equal(summary.requestCount, 1);
      // dollarsSaved is non-zero because dedup compressed the request
      assert.ok(summary.dollarsSaved > 0, "ledger records a savings dollar amount");
      assert.ok(summary.totalInputTokensRaw > summary.totalInputTokensSent, "raw > sent");
    } finally {
      await handle.close();
      await upstream.close();
    }
  });
});

test("end-to-end: pristine request (no dupes) reaches Anthropic unchanged", async () => {
  await withTempLedger(async (ledgerPath) => {
    const capture: UpstreamCapture = { body: null, parsed: null };
    const upstream = await mockAnthropic(capture);
    const proxyPort = await freePort();
    const dashboardPort = await freePort();
    const handle = await start({
      config: defaultConfig({
        upstreamBaseUrl: upstream.url, port: proxyPort, dashboardPort, ledgerPath,
      }),
    });
    try {
      const body = {
        model: "claude-sonnet-4-6",
        messages: [{ role: "user", content: "hello" }],
        max_tokens: 100,
      };
      const res = await doRequest(proxyPort, "/v1/messages", body);
      assert.equal(res.status, 200);
      assert.equal(res.headers["x-tokenshield-processors"], undefined);
      // Body forwarded byte-identical (after JSON round-trip)
      assert.deepEqual(capture.parsed, body);
    } finally {
      await handle.close();
      await upstream.close();
    }
  });
});
