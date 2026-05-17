#!/usr/bin/env node
// Generates representative Claude Code request fixtures.
// Re-run any time to refresh; outputs to ./sessions/*.json
//
//   node generate.mjs
//
// The fixtures are deterministic (no randomness) so bench numbers are stable.

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "sessions");
mkdirSync(OUT, { recursive: true });

// A realistic-looking Claude Code system prompt fragment (truncated for fixture size).
const SYSTEM_PROMPT = `You are Claude Code, Anthropic's official CLI for Claude. You are an interactive agent that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.

# Tools
You have access to the following tools: Read (read a file), Edit (replace a string in a file), Write (write a new file), Bash (run a shell command), Grep (search files with ripgrep), Glob (file pattern matching), TodoWrite, Agent (delegate to a subagent).

# Style
- Keep responses concise.
- Reference files as path:line.
- Do not write comments unless asked.

# Doing tasks
- Plan before editing for non-trivial changes.
- Always verify your changes with tests.
- Match existing code style.`;

function authTsContent() {
  // A realistic file body (~ 4KB)
  return [
    "import jwt from 'jsonwebtoken';",
    "import { db } from './db';",
    "",
    "export interface Session { id: string; userId: string; expiresAt: Date; }",
    "",
    "export async function createSession(userId: string): Promise<Session> {",
    "  const id = crypto.randomUUID();",
    "  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);",
    "  await db.session.create({ data: { id, userId, expiresAt } });",
    "  return { id, userId, expiresAt };",
    "}",
    "",
    "export async function verifyToken(token: string, audience: string): Promise<Session | null> {",
    "  try {",
    "    const payload = jwt.verify(token, process.env.JWT_SECRET!, { audience }) as { sub: string };",
    "    const session = await db.session.findUnique({ where: { id: payload.sub } });",
    "    if (!session || session.expiresAt < new Date()) return null;",
    "    return session;",
    "  } catch {",
    "    return null;",
    "  }",
    "}",
    "",
    "export async function revokeSession(id: string): Promise<void> {",
    "  await db.session.delete({ where: { id } });",
    "}",
    "",
    "// Plus error handlers, middleware adapters, and tests that bring this file to ~4KB of plausible content.",
    Array(40).fill("// Padding to bring this file to a realistic size for a representative auth.ts file.").join("\n"),
  ].join("\n");
}

function ghPrListResult() {
  // ~5KB of mock PR list JSON
  const prs = Array.from({ length: 18 }, (_, i) => ({
    number: 4000 + i,
    title: `feat(${["api", "ui", "billing", "auth", "infra"][i % 5]}): ${["add", "refactor", "tighten", "improve", "fix"][i % 5]} ${["the X subsystem", "the cache eviction policy", "the cron handler dispatch", "session validation"][i % 4]}`,
    state: i % 7 === 0 ? "MERGED" : "OPEN",
    author: { login: ["alice", "bob", "carol", "dave"][i % 4] },
    createdAt: new Date(2026, 4, 10 + (i % 6)).toISOString(),
    additions: 80 + i * 12,
    deletions: 15 + i * 3,
    labels: i % 3 === 0 ? ["needs-review", "size/M"] : ["size/S"],
    isDraft: i % 5 === 0,
  }));
  return JSON.stringify({ pullRequests: prs }, null, 2);
}

function bashLargeOutput() {
  return Array(120).fill("[INFO] processed batch — duration=42ms rows=1024 latencyP99=18ms").join("\n");
}

function tu(id, name, input) {
  return { type: "tool_use", id, name, input };
}
function tr(toolUseId, content) {
  return { type: "tool_result", tool_use_id: toolUseId, content };
}

// ─── LIGHT: 5-turn Q&A, almost no tool use ──────────────────────────────────
const LIGHT = {
  model: "claude-sonnet-4-6",
  system: SYSTEM_PROMPT,
  max_tokens: 1024,
  messages: [
    { role: "user", content: "What's the difference between `cache_control` and Anthropic's prompt caching?" },
    { role: "assistant", content: "Prompt caching is the feature; cache_control is the header field that activates it. You set { type: 'ephemeral' } on a content block, and the prefix up to that block is cached for 5 minutes." },
    { role: "user", content: "How do I tell if a cached prefix was actually hit?" },
    { role: "assistant", content: "Inspect the response's usage object — cache_read_input_tokens > 0 means a hit; cache_creation_input_tokens > 0 means a miss that wrote." },
    { role: "user", content: "Thanks." },
  ],
};

// ─── MEDIUM: 12-turn coding session with two file re-reads + one gh pr list ─
const MEDIUM = {
  model: "claude-opus-4-7",
  system: SYSTEM_PROMPT,
  max_tokens: 4096,
  messages: [
    { role: "user", content: "Refactor auth.ts so verifyToken takes an audience parameter and rejects when it doesn't match." },
    { role: "assistant", content: [tu("tu_1", "Read", { path: "auth.ts" })] },
    { role: "user", content: [tr("tu_1", authTsContent())] },
    { role: "assistant", content: [{ type: "text", text: "I'll update verifyToken to accept and check the audience." }, tu("tu_2", "Edit", { file_path: "auth.ts", old_string: "verifyToken(token: string)", new_string: "verifyToken(token: string, audience: string)" })] },
    { role: "user", content: [tr("tu_2", "File updated successfully.")] },
    { role: "assistant", content: [tu("tu_3", "Read", { path: "auth.ts" })] },
    { role: "user", content: [tr("tu_3", authTsContent() + "\n// (one line changed, otherwise identical)")] },
    { role: "assistant", content: [tu("tu_4", "Bash", { command: "npm test -- auth" })] },
    { role: "user", content: [tr("tu_4", "PASS  auth.test.ts (3 tests, 250ms)")] },
    { role: "assistant", content: [{ type: "text", text: "Tests pass. Let me also check the tests file." }, tu("tu_5", "Read", { path: "auth.ts" })] },
    { role: "user", content: [tr("tu_5", authTsContent() + "\n// (one line changed, otherwise identical)")] },
    { role: "assistant", content: "Done — verifyToken now requires an audience and rejects on mismatch." },
  ],
};

// ─── HEAVY: 25-turn agentic loop with many repeats ──────────────────────────
function makeHeavy() {
  const messages = [];
  messages.push({ role: "user", content: "Triage the open PRs, identify any that mention auth changes, and check whether they conflict with the audience refactor I'm about to ship." });

  // Initial gh pr list
  messages.push({ role: "assistant", content: [tu("tu_pr1", "Bash", { command: "gh pr list --json number,title,author,labels --limit 50" })] });
  messages.push({ role: "user", content: [tr("tu_pr1", ghPrListResult())] });

  // Read auth.ts (1)
  messages.push({ role: "assistant", content: [tu("tu_a1", "Read", { path: "auth.ts" })] });
  messages.push({ role: "user", content: [tr("tu_a1", authTsContent())] });

  // Check tests
  messages.push({ role: "assistant", content: [tu("tu_b1", "Bash", { command: "npm run test:unit -- --verbose" })] });
  messages.push({ role: "user", content: [tr("tu_b1", bashLargeOutput())] });

  // Re-read auth.ts to confirm something (REPEAT 1)
  messages.push({ role: "assistant", content: [tu("tu_a2", "Read", { path: "auth.ts" })] });
  messages.push({ role: "user", content: [tr("tu_a2", authTsContent())] });

  // gh pr list again (REPEAT)
  messages.push({ role: "assistant", content: [tu("tu_pr2", "Bash", { command: "gh pr list --json number,title,author,labels --limit 50" })] });
  messages.push({ role: "user", content: [tr("tu_pr2", ghPrListResult())] });

  // Bash output again
  messages.push({ role: "assistant", content: [tu("tu_b2", "Bash", { command: "npm run test:unit -- --verbose" })] });
  messages.push({ role: "user", content: [tr("tu_b2", bashLargeOutput())] });

  // Re-read auth.ts AGAIN (REPEAT 2)
  messages.push({ role: "assistant", content: [tu("tu_a3", "Read", { path: "auth.ts" })] });
  messages.push({ role: "user", content: [tr("tu_a3", authTsContent())] });

  // gh pr list AGAIN (REPEAT)
  messages.push({ role: "assistant", content: [tu("tu_pr3", "Bash", { command: "gh pr list --json number,title,author,labels --limit 50" })] });
  messages.push({ role: "user", content: [tr("tu_pr3", ghPrListResult())] });

  // Re-read auth.ts AGAIN (REPEAT 3)
  messages.push({ role: "assistant", content: [tu("tu_a4", "Read", { path: "auth.ts" })] });
  messages.push({ role: "user", content: [tr("tu_a4", authTsContent())] });

  messages.push({ role: "assistant", content: [{ type: "text", text: "I've reviewed the relevant PRs. PR #4002 touches verifyToken's audience handling — that will conflict with your refactor. PR #4007 modifies session middleware in a way that's compatible. The others don't intersect." }] });

  messages.push({ role: "user", content: "OK ship the refactor first, then I'll handle the conflict on #4002. Let me see the final auth.ts one more time." });
  // Read auth.ts AGAIN (REPEAT 4)
  messages.push({ role: "assistant", content: [tu("tu_a5", "Read", { path: "auth.ts" })] });
  messages.push({ role: "user", content: [tr("tu_a5", authTsContent())] });

  messages.push({ role: "assistant", content: "Confirmed. Audience is required and rejected on mismatch. Ready to ship." });

  return {
    model: "claude-opus-4-7",
    system: SYSTEM_PROMPT,
    max_tokens: 4096,
    messages,
  };
}

const HEAVY = makeHeavy();

const fixtures = [
  { name: "light", description: "Q&A session, 5 turns, no tool use", body: LIGHT },
  { name: "medium", description: "Coding session, 12 turns, 2 file re-reads", body: MEDIUM },
  { name: "heavy", description: "Agentic loop, 25 turns, 5 file re-reads + 3 gh pr list repeats", body: HEAVY },
];

for (const fx of fixtures) {
  const path = join(OUT, `${fx.name}.json`);
  writeFileSync(path, JSON.stringify({ name: fx.name, description: fx.description, body: fx.body }, null, 2));
  console.log(`wrote ${path} (${JSON.stringify(fx.body).length} body bytes)`);
}
