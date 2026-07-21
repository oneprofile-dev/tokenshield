import { test } from "node:test";
import assert from "node:assert/strict";
import { openai, fromOpenAI } from "../src/providers/openai.js";
import { conversationDedup } from "../src/processors/conversation-dedup.js";
import { dollarsFor } from "../src/pricing.js";

test("openai usage: maps total, cached, and output tokens", () => {
  const usage = fromOpenAI({
    input_tokens: 100,
    output_tokens: 30,
    input_tokens_details: { cached_tokens: 25, cache_write_tokens: 10 },
  });

  assert.equal(usage.inputTokens, 65);
  assert.equal(usage.outputTokens, 30);
  assert.equal(usage.cacheCreationInputTokens, 10);
  assert.equal(usage.cacheReadInputTokens, 25);
});

test("openai streaming: captures Responses API completed usage", () => {
  const acc = openai.createStreamAccumulator();
  acc.observe({
    event: "response.completed",
    data: JSON.stringify({
      response: {
        model: "gpt-5.6-luna",
        usage: {
          input_tokens: 120,
          output_tokens: 7,
          input_tokens_details: { cached_tokens: 20 },
        },
      },
    }),
  });

  const usage = acc.total();
  assert.equal(acc.model(), "gpt-5.6-luna");
  assert.equal(usage.inputTokens, 100);
  assert.equal(usage.outputTokens, 7);
  assert.equal(usage.cacheReadInputTokens, 20);
});

test("openai responses adapter: dedups repeated function_call_output payloads", () => {
  const bigBlob = Array(320).fill("workspace source text").join(" ");
  const body = {
    model: "gpt-5.6-luna",
    temperature: 0,
    input: [
      { role: "user", content: [{ type: "input_text", text: "summarize these files" }] },
      { type: "function_call_output", call_id: "call_a", output: bigBlob },
      { type: "function_call_output", call_id: "call_b", output: bigBlob },
    ],
  };

  const conv = openai.toConversation(body);
  assert.ok(conv);
  const result = conversationDedup.onRequest(conv, {
    providerId: "openai",
    conversationFingerprint: "test",
    inboundBytes: JSON.stringify(body).length,
  });
  const rewritten = openai.applyConversation(body, result.conversation);
  const serialized = JSON.stringify(rewritten);

  assert.equal(result.effects[0]?.name, "conversation-dedup");
  assert.match(serialized, /tokenshield: identical to tool_result call_a/);
  assert.equal((serialized.match(new RegExp(bigBlob, "g")) ?? []).length, 1);
});

test("openai chat adapter: preserves tool messages while replacing duplicate outputs", () => {
  const bigBlob = Array(320).fill("same shell output").join(" ");
  const body = {
    model: "gpt-5.6-luna",
    temperature: 0,
    messages: [
      { role: "user", content: "read twice" },
      { role: "tool", tool_call_id: "tool_a", content: bigBlob },
      { role: "tool", tool_call_id: "tool_b", content: bigBlob },
    ],
  };

  const conv = openai.toConversation(body);
  assert.ok(conv);
  const result = conversationDedup.onRequest(conv, {
    providerId: "openai",
    conversationFingerprint: "test",
    inboundBytes: JSON.stringify(body).length,
  });
  const rewritten = openai.applyConversation(body, result.conversation) as { messages?: unknown[] };
  const serialized = JSON.stringify(rewritten);

  assert.equal(result.effects[0]?.name, "conversation-dedup");
  assert.ok(Array.isArray(rewritten.messages));
  assert.match(serialized, /"role":"tool"/);
  assert.match(serialized, /tokenshield: identical to tool_result tool_a/);
  assert.equal((serialized.match(new RegExp(bigBlob, "g")) ?? []).length, 1);
});

test("openai chat adapter: preserves assistant tool_calls during a later rewrite", () => {
  const bigBlob = Array(320).fill("same shell output").join(" ");
  const toolCallA = [
    {
      id: "tool_a",
      type: "function",
      function: { name: "read_file", arguments: "{\"path\":\"a.ts\"}" },
    },
  ];
  const toolCallB = [
    {
      id: "tool_b",
      type: "function",
      function: { name: "read_file", arguments: "{\"path\":\"a.ts\"}" },
    },
  ];
  const body = {
    model: "gpt-5.6-luna",
    temperature: 0,
    messages: [
      { role: "user", content: "read twice" },
      {
        role: "assistant",
        content: null,
        tool_calls: toolCallA,
      },
      { role: "tool", tool_call_id: "tool_a", content: bigBlob },
      {
        role: "assistant",
        content: null,
        tool_calls: toolCallB,
      },
      { role: "tool", tool_call_id: "tool_b", content: bigBlob },
    ],
  };

  const conv = openai.toConversation(body);
  assert.ok(conv);
  const result = conversationDedup.onRequest(conv, {
    providerId: "openai",
    conversationFingerprint: "test",
    inboundBytes: JSON.stringify(body).length,
  });
  const rewritten = openai.applyConversation(body, result.conversation) as { messages?: Array<Record<string, unknown>> };

  assert.equal(result.effects[0]?.name, "conversation-dedup");
  assert.ok(Array.isArray(rewritten.messages));
  assert.deepEqual(rewritten.messages[1]?.["tool_calls"], toolCallA);
  assert.deepEqual(rewritten.messages[3]?.["tool_calls"], toolCallB);
});

test("openai pricing: gpt-5.6 tiers and cached inputs use current rates", () => {
  const usage = {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheCreationInputTokens: 1_000_000,
    cacheReadInputTokens: 1_000_000,
  };

  assert.equal(dollarsFor("gpt-5.6-sol", usage), 41.75);
  assert.equal(dollarsFor("gpt-5.6-terra", usage), 20.875);
  assert.equal(dollarsFor("gpt-5.6-luna", usage), 8.35);
  assert.equal(dollarsFor("gpt-5.6-luna-20260701", usage), 8.35);
});
