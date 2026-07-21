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
  const dir = mkdtempSync(join(tmpdir(), "ts-openai-"));
  return fn(join(dir, "ledger.db")).finally(() => rmSync(dir, { recursive: true, force: true }));
}

interface Capture {
  path: string | null;
  body: string | null;
  parsed: unknown;
}

async function mockOpenAI(capture: Capture): Promise<{ url: string; close: () => Promise<void> }> {
  const port = await freePort();
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      capture.path = req.url ?? null;
      capture.body = Buffer.concat(chunks).toString("utf8");
      try { capture.parsed = JSON.parse(capture.body); } catch { /* ignore */ }

      if (req.url === "/v1/responses" && (capture.parsed as { stream?: boolean })?.stream === true) {
        res.statusCode = 200;
        res.setHeader("content-type", "text/event-stream");
        res.write(
          `event: response.completed\ndata: ${JSON.stringify({
            response: {
              id: "resp_stream",
              model: "gpt-5.6-luna",
              usage: {
                input_tokens: 120,
                output_tokens: 7,
                input_tokens_details: { cached_tokens: 20 },
              },
            },
          })}\n\n`,
        );
        res.end();
        return;
      }

      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/chat/completions") {
        res.end(
          JSON.stringify({
            id: "chatcmpl_test",
            model: "gpt-5.6-luna",
            choices: [],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              prompt_tokens_details: { cached_tokens: 2 },
            },
          }),
        );
        return;
      }

      res.end(
        JSON.stringify({
          id: "resp_test",
          model: "gpt-5.6-luna",
          output: [],
          usage: {
            input_tokens: 1000,
            output_tokens: 50,
            input_tokens_details: { cached_tokens: 200 },
          },
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
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(payload)),
        },
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

test("openai passthrough: Responses API routes to OpenAI upstream and dedups repeated tool outputs", async () => {
  await withTempLedger(async (ledgerPath) => {
    const capture: Capture = { path: null, body: null, parsed: null };
    const upstream = await mockOpenAI(capture);
    const proxyPort = await freePort();
    const dashboardPort = await freePort();
    const handle = await start({
      config: defaultConfig({
        upstreamBaseUrl: "http://127.0.0.1:1",
        openaiUpstreamBaseUrl: upstream.url,
        port: proxyPort,
        dashboardPort,
        ledgerPath,
      }),
    });
    try {
      const bigBlob = Array(340).fill("tool output from codex workspace").join(" ");
      const res = await doRequest(proxyPort, "/v1/responses", {
        model: "gpt-5.6-luna",
        temperature: 0,
        stream: false,
        input: [
          { role: "user", content: [{ type: "input_text", text: "compare both outputs" }] },
          { type: "function_call_output", call_id: "call_a", output: bigBlob },
          { type: "function_call_output", call_id: "call_b", output: bigBlob },
        ],
      });

      assert.equal(res.status, 200);
      assert.equal(capture.path, "/v1/responses");
      assert.equal(res.headers["x-tokenshield-processors"], "conversation-dedup");
      assert.ok(capture.body !== null);
      assert.match(capture.body!, /tokenshield: identical to tool_result call_a/);
      assert.equal((capture.body!.match(new RegExp(bigBlob, "g")) ?? []).length, 1);

      await new Promise((r) => setTimeout(r, 50));
      const recent = handle.ledger.recent(1)[0];
      assert.ok(recent);
      assert.equal(recent.provider, "openai");
      assert.equal(recent.endpoint, "/v1/responses");
      assert.equal(recent.model, "gpt-5.6-luna");
      assert.ok(recent.usageRaw.inputTokens > recent.usageSent.inputTokens);
      assert.ok(recent.dollarsSaved > 0);
    } finally {
      await handle.close();
      await upstream.close();
    }
  });
});

test("openai passthrough: Chat Completions routes to OpenAI upstream and records cached input", async () => {
  await withTempLedger(async (ledgerPath) => {
    const capture: Capture = { path: null, body: null, parsed: null };
    const upstream = await mockOpenAI(capture);
    const proxyPort = await freePort();
    const dashboardPort = await freePort();
    const handle = await start({
      config: defaultConfig({
        upstreamBaseUrl: "http://127.0.0.1:1",
        openaiUpstreamBaseUrl: upstream.url,
        port: proxyPort,
        dashboardPort,
        ledgerPath,
      }),
    });
    try {
      const res = await doRequest(proxyPort, "/v1/chat/completions", {
        model: "gpt-5.6-luna",
        temperature: 0,
        stream: false,
        messages: [{ role: "user", content: "hi" }],
      });

      assert.equal(res.status, 200);
      assert.equal(capture.path, "/v1/chat/completions");
      assert.deepEqual(capture.parsed, {
        model: "gpt-5.6-luna",
        temperature: 0,
        stream: false,
        messages: [{ role: "user", content: "hi" }],
      });

      await new Promise((r) => setTimeout(r, 50));
      const recent = handle.ledger.recent(1)[0];
      assert.ok(recent);
      assert.equal(recent.provider, "openai");
      assert.equal(recent.usageSent.inputTokens, 8);
      assert.equal(recent.usageSent.cacheReadInputTokens, 2);
      assert.equal(recent.usageSent.outputTokens, 5);
    } finally {
      await handle.close();
      await upstream.close();
    }
  });
});

test("openai passthrough: streaming Responses SSE stays byte-faithful and records usage", async () => {
  await withTempLedger(async (ledgerPath) => {
    const capture: Capture = { path: null, body: null, parsed: null };
    const upstream = await mockOpenAI(capture);
    const proxyPort = await freePort();
    const dashboardPort = await freePort();
    const handle = await start({
      config: defaultConfig({
        upstreamBaseUrl: "http://127.0.0.1:1",
        openaiUpstreamBaseUrl: upstream.url,
        port: proxyPort,
        dashboardPort,
        ledgerPath,
      }),
    });
    try {
      const res = await doRequest(proxyPort, "/v1/responses", {
        model: "gpt-5.6-luna",
        stream: true,
        input: "hello",
      });

      assert.equal(res.status, 200);
      assert.equal(capture.path, "/v1/responses");
      assert.match(res.body, /event: response.completed/);

      await new Promise((r) => setTimeout(r, 50));
      const recent = handle.ledger.recent(1)[0];
      assert.ok(recent);
      assert.equal(recent.provider, "openai");
      assert.equal(recent.streamed, true);
      assert.equal(recent.usageSent.inputTokens, 100);
      assert.equal(recent.usageSent.cacheReadInputTokens, 20);
      assert.equal(recent.usageSent.outputTokens, 7);
    } finally {
      await handle.close();
      await upstream.close();
    }
  });
});
