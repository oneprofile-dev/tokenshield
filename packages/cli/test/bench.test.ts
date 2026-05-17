import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Pipeline,
  conversationDedup,
  anthropic,
} from "@curatedmcp/tokenshield-core";
import type { Conversation } from "@curatedmcp/tokenshield-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist-test/test/bench.test.js → ../../.. = packages/cli, +1 more = packages
const FIXTURES = join(__dirname, "..", "..", "..", "test-fixtures", "sessions");

interface Fixture {
  name: string;
  body: unknown;
}

async function loadAll(): Promise<Fixture[]> {
  const entries = await readdir(FIXTURES);
  const out: Fixture[] = [];
  for (const e of entries.filter((f) => f.endsWith(".json")).sort()) {
    const raw = await readFile(join(FIXTURES, e), "utf8");
    out.push(JSON.parse(raw) as Fixture);
  }
  return out;
}

function bytesOf(json: unknown): number {
  return Buffer.byteLength(JSON.stringify(json ?? null), "utf8");
}

function bench(fixture: Fixture): { name: string; bytesIn: number; bytesOut: number; pct: number } {
  const bytesIn = bytesOf(fixture.body);
  const conv = anthropic.toConversation(fixture.body) as Conversation;
  const pipeline = new Pipeline({
    processors: [conversationDedup],
    enabled: new Set(["conversation-dedup"]),
  });
  const wireSize = (c: Conversation): number => bytesOf(anthropic.applyConversation(fixture.body, c));
  const result = pipeline.run(
    conv,
    { providerId: "anthropic", conversationFingerprint: fixture.name, inboundBytes: bytesIn },
    wireSize,
  );
  let bytesOut = bytesIn;
  if (result.effects.length > 0) {
    const candidate = bytesOf(anthropic.applyConversation(fixture.body, result.conversation));
    if (candidate < bytesIn) bytesOut = candidate;
  }
  return { name: fixture.name, bytesIn, bytesOut, pct: ((bytesIn - bytesOut) / bytesIn) * 100 };
}

test("bench: light fixture leaves bytes unchanged (no dupes to dedup)", async () => {
  const all = await loadAll();
  const light = all.find((f) => f.name === "light");
  assert.ok(light, "light fixture present");
  const r = bench(light);
  assert.equal(r.pct, 0);
});

test("bench: medium fixture saves ≥ 25%", async () => {
  const all = await loadAll();
  const medium = all.find((f) => f.name === "medium");
  assert.ok(medium, "medium fixture present");
  const r = bench(medium);
  assert.ok(r.pct >= 25, `expected ≥25%, got ${r.pct.toFixed(1)}%`);
});

test("bench: heavy fixture saves ≥ 55%", async () => {
  const all = await loadAll();
  const heavy = all.find((f) => f.name === "heavy");
  assert.ok(heavy, "heavy fixture present");
  const r = bench(heavy);
  assert.ok(r.pct >= 55, `expected ≥55%, got ${r.pct.toFixed(1)}%`);
});

test("bench: aggregate across all 3 fixtures saves ≥ 50%", async () => {
  const all = await loadAll();
  const results = all.map(bench);
  const totalIn = results.reduce((s, r) => s + r.bytesIn, 0);
  const totalOut = results.reduce((s, r) => s + r.bytesOut, 0);
  const pct = ((totalIn - totalOut) / totalIn) * 100;
  assert.ok(pct >= 50, `expected ≥50%, got ${pct.toFixed(1)}%`);
});
