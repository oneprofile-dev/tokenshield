# TokenShield

**Cut your Claude Code bill 40–70%.** Local proxy. Your API key never leaves your machine.

[![npm version](https://img.shields.io/npm/v/@curatedmcp/tokenshield.svg)](https://www.npmjs.com/package/@curatedmcp/tokenshield)
[![license](https://img.shields.io/npm/l/@curatedmcp/tokenshield.svg)](https://github.com/oneprofile-dev/tokenshield/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@curatedmcp/tokenshield.svg)](https://nodejs.org)
[![provenance](https://img.shields.io/badge/npm-provenance-blue.svg)](https://docs.npmjs.com/generating-provenance-statements)

```bash
npm install -g @curatedmcp/tokenshield
tokenshield setup
```

That's it. Your existing `ANTHROPIC_API_KEY`, your existing Claude Code workflow — now 40–70% cheaper.

---

## Why TokenShield exists

Claude Code is great. Claude Code is also expensive. A 25-turn agentic session that re-reads the same `auth.ts` five times and re-runs `gh pr list` three times burns ~$1.60 in tokens — even though 60% of the bytes flowing to Anthropic are exact duplicates.

TokenShield sits between your AI tool (Claude Code, Cursor, Windsurf, Aider, anything that speaks the Anthropic SDK) and `api.anthropic.com`. It deduplicates repeated tool results inside the conversation and caches deterministic responses. **Everything runs on your machine.** Your prompts never touch our servers.

---

## Measured savings (v0.2, real numbers)

These come from `tokenshield bench`, which replays three recorded sessions through the pipeline:

| Workload | What it looks like | Savings |
|----------|-------------------|---------|
| **Light** | 5-turn Q&A, no tool use | **0%** (dedup correctly doesn't trigger) |
| **Medium** | 12-turn coding session, 2 file re-reads | **27.7%** |
| **Heavy** | 25-turn agentic loop, 5 file re-reads + 3 `gh pr list` repeats | **62.1%** |
| **Aggregate** | All three above | **54.2%** |

**These four numbers are CI-asserted.** Every commit on `main` runs the bench and fails the build if any savings regress. We are not making this up — clone the repo and run `tokenshield bench` on your laptop.

---

## 60-second quickstart

```bash
# 1. Install
npm install -g @curatedmcp/tokenshield

# 2. Start the proxy + local dashboard
tokenshield up
#  ▸ Proxy:     http://127.0.0.1:7777
#  ▸ Dashboard: http://127.0.0.1:7778

# 3. In a fresh shell, point Claude Code at the proxy:
export ANTHROPIC_BASE_URL=http://127.0.0.1:7777
claude        # your normal workflow — savings tick up in the dashboard
```

Or let TokenShield write that `export` line into your `~/.zshrc` for you:

```bash
tokenshield integrations enable claude-code
```

---

## Works with everything that speaks Anthropic

| Tool | Status |
|------|--------|
| Claude Code | ✅ live |
| Cursor (Anthropic mode) | ✅ live |
| Windsurf (Anthropic mode) | ✅ live |
| Zed (Anthropic mode) | ✅ live |
| Aider (Anthropic mode) | ✅ live |
| Continue.dev, Cline, Roo, anything using `@anthropic-ai/sdk` | ✅ live |
| OpenAI endpoints | 🕒 v1.1 — [join the waitlist](https://curatedmcp.com/tokenshield#waitlist) |
| Google Gemini | 🕒 v1.2 — [join the waitlist](https://curatedmcp.com/tokenshield#waitlist) |

---

## How it works in 5 bullets

1. **Transparent HTTP proxy** with byte-faithful SSE streaming preservation. Your client never knows it's not talking to Anthropic directly.
2. **Conversation dedup** — every `tool_result` is content-hashed (SHA-256). Second and subsequent occurrences inside a conversation are replaced with a deterministic pointer. First occurrence is always kept verbatim.
3. **Response cache** — conservative LRU+TTL cache for `temperature === 0 && stream === false` requests. Cache hits short-circuit without invoking Anthropic.
4. **Fail-open middleware** — if any processor throws, the request goes through untouched. Per-processor circuit breaker disables flaky processors after 3 failures in 60s.
5. **SQLite ledger** using Node 22's built-in `node:sqlite`. **Zero native dependencies.** No compile toolchain pain. No `node-gyp`. No `npm rebuild`.

Full architecture in 60 seconds:

```
   Claude Code  ─▶  TokenShield proxy  ─▶  api.anthropic.com
   (or Cursor,      127.0.0.1:7777
    Windsurf,       (your machine)
    Aider, …)             │
                          ▼
                  ~/.tokenshield/ledger.db
                  http://127.0.0.1:7778
                  (live local dashboard)
```

---

## CLI surface

```text
tokenshield setup              60-second guided install
tokenshield up                 start in foreground (Ctrl-C to stop)
tokenshield up --daemon        start in background
tokenshield status             daemon state + last-24h spend
tokenshield logs --limit 20    recent requests with savings %
tokenshield bench              replay built-in fixtures and report savings
tokenshield demo               canned 8-turn savings replay (no network)
tokenshield doctor             health check (Node, key, network, ports)
tokenshield stop               stop the background daemon
tokenshield integrations list  detect Claude Code / Cursor / Windsurf / Zed / Aider
tokenshield integrations enable claude-code   # write managed block to shell rc
```

Every command supports `--json`, `--quiet`, and `--debug`. Exit codes are category-specific so scripts can react: `10` port-in-use, `11` daemon-not-running, `20` missing API key, `30` upstream unreachable, etc.

---

## Privacy — what actually leaves your machine

- **Your `ANTHROPIC_API_KEY`** stays in process memory. Never written to disk. Never sent to CuratedMCP.
- **Your prompts** stay between your machine and Anthropic. The proxy is transparent.
- **Optional cloud telemetry** (off by default) is aggregate-only: token counts and dollar savings. Schema-validated locally to reject any field whose name suggests content (`prompt`, `message`, `content`, `text`, `body`).
- **Default localhost binding** (`127.0.0.1`). Opt-in `--bind 0.0.0.0` for team deployments behind a VPN.

Read the full threat model: [docs/whitepaper.md](https://github.com/oneprofile-dev/tokenshield/blob/main/docs/whitepaper.md)

---

## Pricing

| Plan | Price | What you get |
|------|-------|--------------|
| **Free (local)** | $0 forever | Full proxy + dashboard + dedup + cache. Everything on this README works. |
| **Solo Dev** | $19/mo | Cloud dashboard, savings history, monthly PDF expense reports |
| **Team Standard** | $29/seat/mo | All of Solo Dev + governance + MCP audit logs |
| **Team Pro** | $59/seat/mo | All of Team Standard + Sentinel anomaly detection + priority routing |

> The free local version is a real product — it's not a teaser. If you never upgrade, you'll still save 40–70% on your Claude bill. We make money when you want savings visible to your finance team, or when you need governance across an engineering org.

Pricing & checkout: **[curatedmcp.com/tokenshield](https://curatedmcp.com/tokenshield)**

---

## Part of the CuratedMCP control plane

TokenShield is one of three products at **[curatedmcp.com](https://curatedmcp.com)** — the MCP governance control plane for engineering organizations:

- **🛡️ TokenShield** — cut your Claude Code bill 40–70% (you're reading the README)
- **🔍 [MCP Auditor](https://curatedmcp.com/auditor)** — static analysis for MCP server security, dependency drift, supply-chain risk
- **📊 [Sentinel](https://curatedmcp.com/sentinel)** — runtime anomaly detection for MCP server behavior in production

If you're an engineering leader trying to answer "what MCP servers are running across my org, what are they costing me, and what's the security posture?" — **[start a CuratedMCP pilot](https://curatedmcp.com/enterprise/pilot)**.

---

## Status

- **v0.2.x (today)**: conversation-dedup + response-cache + production-grade CLI. 64/64 tests green. Anthropic provider live.
- **v0.3** (week of 2026-05-24): diff-based file reads + streaming early-stop. Heavy workloads → 70%+ savings.
- **v1.0** (week of 2026-05-31): context auto-summarize + Stripe checkout + GA.
- **v1.1** (week of 2026-06-07): OpenAI provider live.
- **v1.2** (week of 2026-06-14): Google Gemini provider live.

---

## Links

- **Website:** [curatedmcp.com/tokenshield](https://curatedmcp.com/tokenshield)
- **Whitepaper** (CC BY 4.0): [docs/whitepaper.md](https://github.com/oneprofile-dev/tokenshield/blob/main/docs/whitepaper.md)
- **Source:** [github.com/oneprofile-dev/tokenshield](https://github.com/oneprofile-dev/tokenshield)
- **Issues:** [github.com/oneprofile-dev/tokenshield/issues](https://github.com/oneprofile-dev/tokenshield/issues)
- **npm:** [`@curatedmcp/tokenshield`](https://www.npmjs.com/package/@curatedmcp/tokenshield) · [`@curatedmcp/tokenshield-core`](https://www.npmjs.com/package/@curatedmcp/tokenshield-core)
- **Enterprise pilots:** [curatedmcp.com/enterprise/pilot](https://curatedmcp.com/enterprise/pilot)

## License

MIT — see [LICENSE](https://github.com/oneprofile-dev/tokenshield/blob/main/LICENSE).

---

<sub>Built by [CuratedMCP](https://curatedmcp.com) — the MCP governance control plane for engineering orgs.</sub>
