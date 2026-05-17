import { test } from "node:test";
import assert from "node:assert/strict";
import {
  StreamUsageAccumulator,
  usageFromJson,
} from "../src/proxy/usage.js";
import { dollarsFor } from "../src/pricing.js";

test("StreamUsageAccumulator: captures initial input from message_start", () => {
  const acc = new StreamUsageAccumulator();
  acc.observe({
    event: "message_start",
    data: JSON.stringify({
      type: "message_start",
      message: {
        id: "msg_1",
        model: "claude-sonnet-4-6",
        usage: { input_tokens: 250, output_tokens: 1 },
      },
    }),
  });
  const u = acc.total();
  assert.equal(u.inputTokens, 250);
  assert.equal(u.outputTokens, 1);
  assert.equal(acc.model(), "claude-sonnet-4-6");
});

test("StreamUsageAccumulator: updates output cumulatively from message_delta", () => {
  const acc = new StreamUsageAccumulator();
  acc.observe({
    event: "message_start",
    data: JSON.stringify({
      message: {
        model: "claude-opus-4-7",
        usage: { input_tokens: 1000, output_tokens: 1 },
      },
    }),
  });
  acc.observe({
    event: "message_delta",
    data: JSON.stringify({
      usage: { output_tokens: 187 },
    }),
  });
  const u = acc.total();
  assert.equal(u.inputTokens, 1000);
  assert.equal(u.outputTokens, 187);
});

test("StreamUsageAccumulator: tolerates malformed event data", () => {
  const acc = new StreamUsageAccumulator();
  acc.observe({ event: "message_start", data: "not json" });
  acc.observe({ event: "message_delta", data: "{broken" });
  const u = acc.total();
  assert.equal(u.inputTokens, 0);
  assert.equal(u.outputTokens, 0);
});

test("usageFromJson: parses non-streaming response shape", () => {
  const { usage, model } = usageFromJson({
    id: "msg_x",
    model: "claude-haiku-4-5",
    usage: {
      input_tokens: 42,
      output_tokens: 99,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 5,
    },
  });
  assert.equal(model, "claude-haiku-4-5");
  assert.equal(usage.inputTokens, 42);
  assert.equal(usage.outputTokens, 99);
  assert.equal(usage.cacheCreationInputTokens, 10);
  assert.equal(usage.cacheReadInputTokens, 5);
});

test("dollarsFor: Opus 4.7 priced higher than Sonnet, both > 0", () => {
  const u = {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
  const opus = dollarsFor("claude-opus-4-7", u);
  const sonnet = dollarsFor("claude-sonnet-4-6", u);
  const haiku = dollarsFor("claude-haiku-4-5", u);
  assert.ok(opus > sonnet, "opus should cost more than sonnet");
  assert.ok(sonnet > haiku, "sonnet should cost more than haiku");
  assert.equal(opus, 90);
  assert.equal(sonnet, 18);
  assert.equal(haiku, 6);
});

test("dollarsFor: unknown model falls back without throwing", () => {
  const u = {
    inputTokens: 1000,
    outputTokens: 1000,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
  const d = dollarsFor("some-future-model", u);
  assert.ok(d > 0);
  assert.ok(Number.isFinite(d));
});
