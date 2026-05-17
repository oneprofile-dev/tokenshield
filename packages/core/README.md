# @curatedmcp/tokenshield-core

**The proxy engine behind [TokenShield](https://www.npmjs.com/package/@curatedmcp/tokenshield).** Anthropic API-layer middleware with token accounting, conversation dedup, and response cache.

[![npm version](https://img.shields.io/npm/v/@curatedmcp/tokenshield-core.svg)](https://www.npmjs.com/package/@curatedmcp/tokenshield-core)
[![license](https://img.shields.io/npm/l/@curatedmcp/tokenshield-core.svg)](https://github.com/oneprofile-dev/tokenshield/blob/main/LICENSE)

> **You probably want [`@curatedmcp/tokenshield`](https://www.npmjs.com/package/@curatedmcp/tokenshield) instead.** That's the CLI. This package is the embeddable engine — use it if you're integrating TokenShield directly into another Node server.

---

## Install

```bash
npm install @curatedmcp/tokenshield-core
```

## What's in the box

- **`Pipeline`** — middleware runner with fail-open semantics and per-processor circuit breakers
- **`conversationDedup`** — content-hash `tool_result` blocks; replace 2nd+ with deterministic pointer stubs
- **`responseCache`** — LRU+TTL cache for `temperature === 0 && stream === false` requests
- **`anthropic`** — provider adapter (URL matching, SSE usage parsing, message conversion)
- **`Ledger`** — SQLite-backed request log using Node 22's built-in `node:sqlite` (zero native deps)
- **`dollarsFor()`** — accurate pricing math across all Anthropic models (Opus 4.7, Sonnet 4.6, Haiku 4.5, …)

## Minimal example

```ts
import { Pipeline, conversationDedup, anthropic } from "@curatedmcp/tokenshield-core";

const pipeline = new Pipeline({
  processors: [conversationDedup],
  enabled: new Set(["conversation-dedup"]),
});

const conv = anthropic.toConversation(anthropicMessagesRequest);
const result = pipeline.run(conv, {
  providerId: "anthropic",
  conversationFingerprint: "...",
  inboundBytes: 12_345,
});

const compressedRequest = anthropic.applyConversation(anthropicMessagesRequest, result.conversation);
// → send compressedRequest to api.anthropic.com
```

## Provider adapter interface

If you want to add OpenAI, Gemini, or a custom provider, implement:

```ts
interface Provider {
  id: "anthropic" | "openai" | "gemini" | string;
  matches(url: URL, headers: Record<string, string>): boolean;
  parseUsageFromJson(body: unknown): { usage: UsageCounts; model: string | null };
  parseUsageFromSSE(event: SSEEvent, acc: UsageAccumulator): void;
  extractModel(requestBody: unknown): string;
  toConversation(requestBody: unknown): Conversation | null;
  applyConversation(requestBody: unknown, conv: Conversation): unknown;
}
```

OpenAI lands in v1.1, Gemini in v1.2 — or send a PR.

## Privacy guarantees

- All work happens in-process. Nothing leaves the host that calls this library.
- No network I/O except the upstream provider call you make yourself.
- The optional ledger writes to a SQLite file you control (`~/.tokenshield/ledger.db` by default).

## Architecture & full docs

This is the engine. For the full CLI, dashboard, integrations, and end-user docs, see:

- **CLI:** [`@curatedmcp/tokenshield`](https://www.npmjs.com/package/@curatedmcp/tokenshield)
- **Source:** [github.com/oneprofile-dev/tokenshield](https://github.com/oneprofile-dev/tokenshield)
- **Whitepaper:** [docs/whitepaper.md](https://github.com/oneprofile-dev/tokenshield/blob/main/docs/whitepaper.md)
- **Website:** [curatedmcp.com/tokenshield](https://curatedmcp.com/tokenshield)

## Part of the CuratedMCP control plane

TokenShield is one of three products at **[curatedmcp.com](https://curatedmcp.com)** — the MCP governance control plane for engineering organizations:

- 🛡️ **TokenShield** — cut your Claude Code bill 40–70%
- 🔍 **[MCP Auditor](https://curatedmcp.com/auditor)** — static analysis for MCP server security
- 📊 **[Sentinel](https://curatedmcp.com/sentinel)** — runtime anomaly detection

[Start an enterprise pilot →](https://curatedmcp.com/enterprise/pilot)

## License

MIT — see [LICENSE](https://github.com/oneprofile-dev/tokenshield/blob/main/LICENSE).
