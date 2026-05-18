import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  Pipeline,
  conversationDedup,
  anthropic,
  dollarsFor,
} from "@curatedmcp/tokenshield-core";
import type { Conversation, Processor } from "@curatedmcp/tokenshield-core";
import { c, sym, dim, emit, emitJson, isJson, heading, table } from "../lib/ui.js";
import { TokenShieldError } from "../lib/errors.js";

interface FixtureFile {
  name: string;
  description: string;
  body: unknown;
}

interface BenchResult {
  fixture: string;
  description: string;
  model: string;
  bytesIn: number;
  bytesOut: number;
  byteSavings: number;
  byteSavingsPct: number;
  estimatedTokensIn: number;
  estimatedTokensOut: number;
  estimatedDollarsIn: number;
  estimatedDollarsOut: number;
  estimatedDollarsSaved: number;
  effects: Array<{ name: string; bytesSaved: number; detail?: Record<string, unknown> }>;
}

const TOKEN_PER_BYTE = 1 / 3.5; // industry rule-of-thumb for English+code

function defaultFixturesDir(): string {
  // packages/cli/dist/commands/bench.js — bundled fixtures at ../../fixtures/sessions
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "fixtures", "sessions");
}

async function listFixtures(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    throw new TokenShieldError({
      code: "NOT_FOUND",
      message: `Fixtures directory not found: ${dir}`,
      hint: (err as Error).message,
      nextSteps: ["node packages/test-fixtures/generate.mjs"],
    });
  }
  return entries.filter((e) => e.endsWith(".json")).map((e) => join(dir, e)).sort();
}

async function loadFixture(path: string): Promise<FixtureFile> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    throw new TokenShieldError({
      code: "NOT_FOUND",
      message: `Cannot read fixture: ${path}`,
      hint: (err as Error).message,
    });
  }
  let parsed: FixtureFile;
  try {
    parsed = JSON.parse(raw) as FixtureFile;
  } catch (err) {
    throw new TokenShieldError({
      code: "BAD_CONFIG",
      message: `Fixture is not valid JSON: ${path}`,
      hint: (err as Error).message,
    });
  }
  if (typeof parsed.body !== "object" || parsed.body === null) {
    throw new TokenShieldError({
      code: "BAD_CONFIG",
      message: `Fixture missing 'body': ${path}`,
    });
  }
  return parsed;
}

function bytesOf(json: unknown): number {
  return Buffer.byteLength(JSON.stringify(json ?? null), "utf8");
}

function runSingle(fixture: FixtureFile, processors: Processor[]): BenchResult {
  const enabled = new Set(processors.map((p) => p.id));
  const pipeline = new Pipeline({ processors, enabled });

  const bytesIn = bytesOf(fixture.body);
  const conv: Conversation | null = anthropic.toConversation(fixture.body);
  if (conv === null) {
    throw new TokenShieldError({
      code: "BAD_CONFIG",
      message: `Fixture body is not a valid Anthropic /v1/messages request: ${fixture.name}`,
    });
  }

  const wireSize = (cn: Conversation): number => bytesOf(anthropic.applyConversation(fixture.body, cn));
  const result = pipeline.run(
    conv,
    { providerId: "anthropic", conversationFingerprint: fixture.name, inboundBytes: bytesIn },
    wireSize,
  );

  // Mirror passthrough: only count the new wire bytes if effects actually fired
  // AND the new payload is strictly smaller. Otherwise no change happens on the wire.
  let bytesOut = bytesIn;
  if (result.effects.length > 0) {
    const outBody = anthropic.applyConversation(fixture.body, result.conversation);
    const candidate = bytesOf(outBody);
    if (candidate < bytesIn) bytesOut = candidate;
  }
  const byteSavings = bytesIn - bytesOut;
  const byteSavingsPct = bytesIn > 0 ? (byteSavings / bytesIn) * 100 : 0;

  const estimatedTokensIn = Math.round(bytesIn * TOKEN_PER_BYTE);
  const estimatedTokensOut = Math.round(bytesOut * TOKEN_PER_BYTE);
  // Estimate completion output at 600 tokens (typical Claude response)
  const ASSUMED_OUTPUT_TOKENS = 600;

  const model = anthropic.extractModel(fixture.body);
  const dIn = dollarsFor(model, {
    inputTokens: estimatedTokensIn,
    outputTokens: ASSUMED_OUTPUT_TOKENS,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  });
  const dOut = dollarsFor(model, {
    inputTokens: estimatedTokensOut,
    outputTokens: ASSUMED_OUTPUT_TOKENS,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  });

  return {
    fixture: fixture.name,
    description: fixture.description,
    model,
    bytesIn,
    bytesOut,
    byteSavings,
    byteSavingsPct,
    estimatedTokensIn,
    estimatedTokensOut,
    estimatedDollarsIn: dIn,
    estimatedDollarsOut: dOut,
    estimatedDollarsSaved: dIn - dOut,
    effects: result.effects,
  };
}

export interface BenchOptions {
  fixturesDir?: string;
  fixture?: string;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(2)}MB`;
}
function fmtDollars(n: number): string {
  return "$" + (n < 1 ? n.toFixed(4) : n.toFixed(2));
}

export async function runBench(opts: BenchOptions): Promise<void> {
  const dir = opts.fixturesDir ?? defaultFixturesDir();
  const paths = opts.fixture
    ? [opts.fixture.includes("/") ? opts.fixture : join(dir, `${opts.fixture}.json`)]
    : await listFixtures(dir);

  if (paths.length === 0) {
    throw new TokenShieldError({
      code: "NOT_FOUND",
      message: `No fixtures found in ${dir}`,
      nextSteps: ["node packages/test-fixtures/generate.mjs"],
    });
  }

  const processors: Processor[] = [conversationDedup];
  const results: BenchResult[] = [];
  for (const p of paths) {
    const fx = await loadFixture(p);
    results.push(runSingle(fx, processors));
  }

  if (isJson()) {
    emitJson({ ok: true, results });
    return;
  }

  heading("TokenShield bench — replay against recorded fixtures");
  emit("");
  emit(dim("  No network calls. Pipeline runs against canned request bodies; numbers are wire-byte deltas + projected savings at the listed model's price."));
  emit("");
  emit(
    table(
      results.map((r) => [
        "  " + c.bold(r.fixture),
        r.model,
        fmtBytes(r.bytesIn),
        fmtBytes(r.bytesOut),
        c.green(`-${fmtBytes(r.byteSavings)}`),
        c.green(`${r.byteSavingsPct.toFixed(1)}%`),
        fmtDollars(r.estimatedDollarsIn),
        fmtDollars(r.estimatedDollarsOut),
        c.green(fmtDollars(r.estimatedDollarsSaved)),
      ]),
      { header: ["  Fixture", "Model", "In", "Out", "Δ bytes", "Saved %", "$ in", "$ out", "$ saved"] },
    ),
  );
  emit("");

  for (const r of results) {
    emit("  " + c.bold(r.fixture) + dim("  " + r.description));
    if (r.effects.length === 0) {
      emit(dim("    (no processors triggered)"));
    } else {
      for (const e of r.effects) {
        const detail = e.detail ? dim(" " + JSON.stringify(e.detail)) : "";
        emit(`    ${sym.bullet} ${e.name.padEnd(22)} bytes-saved=${fmtBytes(e.bytesSaved)}${detail}`);
      }
    }
  }

  emit("");
  const totalIn = results.reduce((s, r) => s + r.bytesIn, 0);
  const totalOut = results.reduce((s, r) => s + r.bytesOut, 0);
  const totalSavedPct = totalIn > 0 ? ((totalIn - totalOut) / totalIn) * 100 : 0;
  emit(
    `  ${c.bold("Aggregate:")} ${fmtBytes(totalIn)} → ${fmtBytes(totalOut)} ` +
      `${c.green(`(${totalSavedPct.toFixed(1)}% saved across ${results.length} fixtures)`)}`,
  );
  emit("");
  emit(dim("  Note: these are SINGLE-PROCESSOR numbers (conversation-dedup only)."));
  emit(dim("  Upcoming processors: response-cache · diff-file-reads · stream-early-stop · context-summarizer."));
  emit(dim("  Activated automatically as they ship for Pro subscribers: curatedmcp.com/tokenshield/upgrade"));
  emit("");
}
