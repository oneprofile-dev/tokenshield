import { test } from "node:test";
import assert from "node:assert/strict";
import { ResponseCache } from "../src/processors/response-cache.js";

function bodyWith(over: Record<string, unknown>): unknown {
  return {
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: "hi" }],
    temperature: 0,
    stream: false,
    ...over,
  };
}

function fakeRes(overrides: Partial<{ status: number; bodyText: string; usage: { inputTokens: number; outputTokens: number }; model: string }> = {}) {
  return {
    status: overrides.status ?? 200,
    headers: { "content-type": "application/json" },
    body: Buffer.from(overrides.bodyText ?? '{"id":"msg_1","content":[]}'),
    usage: overrides.usage ?? { inputTokens: 100, outputTokens: 20 },
    model: overrides.model ?? "claude-sonnet-4-6",
  };
}

test("cache: stores + returns identical request as a hit", () => {
  const cache = new ResponseCache();
  const body = bodyWith({});
  assert.equal(cache.lookup(body), null);
  cache.store(body, fakeRes());
  const hit = cache.lookup(body);
  assert.ok(hit);
  assert.equal(hit.status, 200);
  assert.equal(hit.usage.inputTokens, 100);
});

test("cache: does NOT cache temperature > 0", () => {
  const cache = new ResponseCache();
  const body = bodyWith({ temperature: 1 });
  cache.store(body, fakeRes());
  assert.equal(cache.lookup(body), null);
});

test("cache: does NOT cache streaming requests", () => {
  const cache = new ResponseCache();
  const body = bodyWith({ stream: true });
  cache.store(body, fakeRes());
  assert.equal(cache.lookup(body), null);
});

test("cache: does NOT cache non-2xx responses", () => {
  const cache = new ResponseCache();
  const body = bodyWith({});
  cache.store(body, fakeRes({ status: 500 }));
  assert.equal(cache.lookup(body), null);
});

test("cache: respects TTL", async () => {
  const cache = new ResponseCache(1024 * 1024, 50); // 50ms TTL
  const body = bodyWith({});
  cache.store(body, fakeRes());
  assert.ok(cache.lookup(body));
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(cache.lookup(body), null);
});

test("cache: ignores ordering of keys in cache key calculation", () => {
  const cache = new ResponseCache();
  const a = { temperature: 0, stream: false, model: "x", messages: [{ role: "user", content: "hi" }], extra: 1 };
  const b = { extra: 1, messages: [{ role: "user", content: "hi" }], stream: false, model: "x", temperature: 0 };
  cache.store(a, fakeRes());
  const hit = cache.lookup(b);
  assert.ok(hit, "key order should not matter — canonicalize sorts keys");
});

test("cache: different messages → cache miss", () => {
  const cache = new ResponseCache();
  cache.store(bodyWith({ messages: [{ role: "user", content: "one" }] }), fakeRes());
  const hit = cache.lookup(bodyWith({ messages: [{ role: "user", content: "two" }] }));
  assert.equal(hit, null);
});

test("cache: namespaces keys by provider", () => {
  const cache = new ResponseCache();
  const body = bodyWith({});
  cache.store(body, { ...fakeRes(), providerId: "anthropic" });

  assert.equal(cache.lookup(body, "openai"), null);
  assert.ok(cache.lookup(body, "anthropic"));
});

test("cache: stats() reports hits and misses", () => {
  const cache = new ResponseCache();
  const body = bodyWith({});
  cache.lookup(body); // miss
  cache.store(body, fakeRes());
  cache.lookup(body); // hit
  cache.lookup(body); // hit
  const s = cache.stats();
  assert.equal(s.hits, 2);
  assert.equal(s.misses, 1);
  assert.equal(s.entries, 1);
});
