import { test } from "node:test";
import assert from "node:assert/strict";
import { Pipeline } from "../src/processors/pipeline.js";
import type { Processor, ProcessorResult } from "../src/processors/types.js";
import type { Conversation } from "../src/providers/types.js";

function makeConv(): Conversation {
  return {
    model: "claude-sonnet-4-6",
    system: null,
    messages: [],
    temperature: null,
    raw: {},
  };
}

const sizeOf = (c: Conversation): number => JSON.stringify(c).length;

test("pipeline: skips disabled processors", () => {
  const calls: string[] = [];
  const a: Processor = {
    id: "a", enabledByDefault: true,
    onRequest(c): ProcessorResult { calls.push("a"); return { conversation: c, effects: [] }; },
  };
  const b: Processor = {
    id: "b", enabledByDefault: true,
    onRequest(c): ProcessorResult { calls.push("b"); return { conversation: c, effects: [] }; },
  };
  const p = new Pipeline({ processors: [a, b], enabled: new Set(["b"]) });
  p.run(makeConv(), { providerId: "anthropic", conversationFingerprint: "f", inboundBytes: 0 }, sizeOf);
  assert.deepEqual(calls, ["b"]);
});

test("pipeline: chains processor outputs (composition)", () => {
  const tag: Processor = {
    id: "tag", enabledByDefault: true,
    onRequest(c): ProcessorResult {
      return { conversation: { ...c, model: c.model + "+tag" }, effects: [{ name: "tag", bytesSaved: 1 }] };
    },
  };
  const tag2: Processor = {
    id: "tag2", enabledByDefault: true,
    onRequest(c): ProcessorResult {
      return { conversation: { ...c, model: c.model + "+tag2" }, effects: [{ name: "tag2", bytesSaved: 2 }] };
    },
  };
  const p = new Pipeline({ processors: [tag, tag2], enabled: new Set(["tag", "tag2"]) });
  const result = p.run(makeConv(), { providerId: "anthropic", conversationFingerprint: "f", inboundBytes: 0 }, sizeOf);
  assert.equal(result.conversation.model, "claude-sonnet-4-6+tag+tag2");
  assert.equal(result.effects.length, 2);
});

test("pipeline: fails open when a processor throws", () => {
  const boom: Processor = {
    id: "boom", enabledByDefault: true,
    onRequest(): ProcessorResult { throw new Error("kaboom"); },
  };
  const after: Processor = {
    id: "after", enabledByDefault: true,
    onRequest(c): ProcessorResult { return { conversation: { ...c, model: "untouched" }, effects: [] }; },
  };
  const p = new Pipeline({ processors: [boom, after], enabled: new Set(["boom", "after"]) });
  const result = p.run(makeConv(), { providerId: "anthropic", conversationFingerprint: "f", inboundBytes: 0 }, sizeOf);
  // boom threw → its rewrite was discarded; after still ran
  assert.equal(result.conversation.model, "untouched");
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]!.processor, "boom");
});

test("pipeline: circuit breaker trips after 3 failures, halts further attempts", () => {
  let calls = 0;
  const flaky: Processor = {
    id: "flaky", enabledByDefault: true,
    onRequest(): ProcessorResult { calls++; throw new Error("nope"); },
  };
  const p = new Pipeline({ processors: [flaky], enabled: new Set(["flaky"]) });
  for (let i = 0; i < 6; i++) {
    p.run(makeConv(), { providerId: "anthropic", conversationFingerprint: "f", inboundBytes: 0 }, sizeOf);
  }
  // After 3 failures the breaker opens, so calls should be 3 (not 6)
  assert.equal(calls, 3);
});
