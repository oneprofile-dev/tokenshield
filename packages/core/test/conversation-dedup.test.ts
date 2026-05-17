import { test } from "node:test";
import assert from "node:assert/strict";
import { anthropic } from "../src/providers/anthropic.js";
import { conversationDedup } from "../src/processors/conversation-dedup.js";

function bigText(seed: string, repeats = 200): string {
  // ~ 200 * seed.length bytes — pushes past dedup's MIN_ELIDE_BYTES threshold
  return Array(repeats).fill(seed).join(" ");
}

function makeBody(toolResults: Array<{ toolUseId: string; content: string }>): unknown {
  // Build an alternating user/assistant conversation: each user turn contains
  // one tool_result, each assistant turn contains a single tool_use.
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [];
  let i = 0;
  for (const tr of toolResults) {
    messages.push({
      role: "assistant",
      content: [{ type: "tool_use", id: `tu_${i}`, name: "Read", input: { path: "x.ts" } }],
    });
    messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: tr.toolUseId, content: tr.content }],
    });
    i++;
  }
  return {
    model: "claude-sonnet-4-6",
    messages,
    max_tokens: 1024,
  };
}

test("dedup: leaves single-occurrence tool_results untouched", () => {
  const body = makeBody([{ toolUseId: "tu_0", content: bigText("alpha") }]);
  const conv = anthropic.toConversation(body)!;
  const result = conversationDedup.onRequest(conv, {
    providerId: "anthropic",
    conversationFingerprint: "f",
    inboundBytes: 0,
  });
  assert.equal(result.effects.length, 0);
  assert.equal(result.conversation, conv); // identity preserved when no change
});

test("dedup: replaces 2nd occurrence with pointer stub referencing the 1st", () => {
  const sameContent = bigText("auth.ts contents");
  const body = makeBody([
    { toolUseId: "tu_first", content: sameContent },
    { toolUseId: "tu_second", content: sameContent },
  ]);
  const conv = anthropic.toConversation(body)!;
  const before = anthropic.applyConversation(body, conv) as Record<string, unknown>;
  const beforeMessages = before["messages"] as Array<{ role: string; content: Array<{ type: string }> }>;
  const beforeBytes = JSON.stringify(beforeMessages).length;

  const result = conversationDedup.onRequest(conv, {
    providerId: "anthropic",
    conversationFingerprint: "f",
    inboundBytes: 0,
  });
  assert.equal(result.effects.length, 1);
  assert.equal(result.effects[0]!.name, "conversation-dedup");
  assert.ok(result.effects[0]!.bytesSaved > 0);

  const applied = anthropic.applyConversation(body, result.conversation) as Record<string, unknown>;
  const msgs = applied["messages"] as Array<{ role: string; content: Array<{ type: string; tool_use_id?: string; content?: unknown }> }>;
  const firstTr = msgs[1]!.content[0]!;
  const secondTr = msgs[3]!.content[0]!;
  assert.equal(firstTr.type, "tool_result");
  assert.equal(firstTr.content, sameContent, "first occurrence preserved verbatim");
  assert.equal(secondTr.type, "tool_result");
  assert.match(String(secondTr.content), /tokenshield: identical to tool_result tu_first at message 1/);

  const afterBytes = JSON.stringify(msgs).length;
  assert.ok(afterBytes < beforeBytes, "serialised payload shrank");
});

test("dedup: handles 3+ occurrences (all but the first replaced)", () => {
  const c = bigText("repeated_blob");
  const body = makeBody([
    { toolUseId: "tu_a", content: c },
    { toolUseId: "tu_b", content: c },
    { toolUseId: "tu_c", content: c },
    { toolUseId: "tu_d", content: c },
  ]);
  const conv = anthropic.toConversation(body)!;
  const result = conversationDedup.onRequest(conv, {
    providerId: "anthropic",
    conversationFingerprint: "f",
    inboundBytes: 0,
  });
  const applied = anthropic.applyConversation(body, result.conversation) as Record<string, unknown>;
  const msgs = applied["messages"] as Array<{ content: Array<{ type: string; content?: unknown }> }>;
  // Indices 1, 3, 5, 7 are user turns with tool_result
  assert.equal(String(msgs[1]!.content[0]!.content), c, "1st verbatim");
  assert.match(String(msgs[3]!.content[0]!.content), /tokenshield/);
  assert.match(String(msgs[5]!.content[0]!.content), /tokenshield/);
  assert.match(String(msgs[7]!.content[0]!.content), /tokenshield/);
  assert.equal((result.effects[0]!.detail as { elidedCount: number }).elidedCount, 3);
});

test("dedup: is idempotent (re-running on its own output is a no-op)", () => {
  const c = bigText("hello");
  const body = makeBody([
    { toolUseId: "tu_1", content: c },
    { toolUseId: "tu_2", content: c },
  ]);
  const conv = anthropic.toConversation(body)!;
  const r1 = conversationDedup.onRequest(conv, {
    providerId: "anthropic",
    conversationFingerprint: "f",
    inboundBytes: 0,
  });
  const r2 = conversationDedup.onRequest(r1.conversation, {
    providerId: "anthropic",
    conversationFingerprint: "f",
    inboundBytes: 0,
  });
  assert.equal(r2.effects.length, 0, "second pass yields no effects");
  assert.equal(r2.conversation, r1.conversation, "second pass returns same conversation");
});

test("dedup: skips tiny duplicates (below MIN_ELIDE_BYTES)", () => {
  // 20-byte content × 2 — too small to elide
  const small = "{\"size\":12345}";
  const body = makeBody([
    { toolUseId: "tu_x", content: small },
    { toolUseId: "tu_y", content: small },
  ]);
  const conv = anthropic.toConversation(body)!;
  const result = conversationDedup.onRequest(conv, {
    providerId: "anthropic",
    conversationFingerprint: "f",
    inboundBytes: 0,
  });
  assert.equal(result.effects.length, 0, "tiny payloads not elided");
});

test("dedup: distinct contents are NOT collapsed", () => {
  const body = makeBody([
    { toolUseId: "tu_1", content: bigText("alpha") },
    { toolUseId: "tu_2", content: bigText("beta") },
  ]);
  const conv = anthropic.toConversation(body)!;
  const result = conversationDedup.onRequest(conv, {
    providerId: "anthropic",
    conversationFingerprint: "f",
    inboundBytes: 0,
  });
  assert.equal(result.effects.length, 0);
});
