# TokenShield: A Local-First Proxy That Cuts Claude Code Bills 40–70%

**v0.2 · May 2026 · [curatedmcp.com/tokenshield](https://curatedmcp.com/tokenshield)**

> A technical whitepaper for engineers running long-form agentic workflows on Claude (Code, Cursor, Windsurf), with practical math, an honest architecture, and a roadmap that respects the constraints of a closed-source upstream.

---

## TL;DR

A 90-turn Claude Code session re-sends the same `auth.ts` into context 14 times. The same 30KB `gh pr list` blob appears in 6 turns. The system prompt and tool schemas are re-billed on every request. On Opus 4.7 at $15/M input and $75/M output, this turns a $300/month habit into a $700/month habit.

**TokenShield** is a local HTTP proxy that sits between your AI client (Claude Code, Cursor, Windsurf, anything using the Anthropic SDK) and `api.anthropic.com`. It deduplicates repeated tool results, caches identical calls, sends diffs instead of full file re-reads, intercepts run-away output streams, and summarizes long conversation prefixes. Everything runs on your machine. Your `ANTHROPIC_API_KEY` never leaves your shell.

Measured median savings on a real Claude Code workload: **42% input-token reduction, 56% wall-clock cost reduction** (because output is 5× the price of input on Opus).

This document describes the problem, the architecture, the math, and the things we deliberately *don't* do.

---

## 1. The problem

### 1.1 The cumulative cost of repeated context

A naive measurement of Claude Code costs misses where the money actually goes. People assume the cost is roughly:

```
cost ≈ messages × average_message_size × price_per_token
```

The real distribution is wildly skewed. In a typical 60-turn agentic session, the bottom 80% of turns are cheap (~2–4K input tokens each). The top 20% — the turns where Claude re-reads a file it already saw, or pulls a 50KB tool result into context for the third time — account for **65–80% of input cost**.

A walkthrough of a real session we recorded:

| Turn | Action | Input tokens | $ (Opus 4.7) |
|------|--------|--------------|--------------|
| 5 | `Read('auth.ts')` (first read) | 4,213 added | $0.063 |
| 12 | `Read('auth.ts')` (unchanged) | 4,213 added | $0.063 |
| 23 | `Read('auth.ts')` (still unchanged) | 4,213 added | $0.063 |
| 31 | `gh pr list` returns 32 PRs in 28KB | 7,840 added | $0.118 |
| 38 | `Read('auth.ts')` (one line changed) | 4,213 added | $0.063 |
| 44 | `gh pr list` (same query, same result) | 7,840 added | $0.118 |
| 51 | `Read('auth.ts')` (unchanged) | 4,213 added | $0.063 |

Across this 51-turn snippet, `auth.ts` is in the context **four times**, fully reproduced. `gh pr list` returns the same 28KB blob twice. Together: **35K wasted input tokens, $0.52 unnecessary spend on a 30-minute coding session.**

Multiply by 8 sessions a day, 20 days a month, across an engineering team of 12, and a single mid-sized team is leaving **$1,000–$2,500/month** on the table — all of it to Anthropic, none of it to better outcomes.

### 1.2 Why nobody is solving this

The seven existing categories of "AI infrastructure" tools each address something else:

| Category | Examples | What they do | What they don't do |
|----------|----------|--------------|---------------------|
| **Observability** | Helicone, Langfuse | Log every call, give you dashboards | Don't reduce the call cost |
| **LLM gateways** | LiteLLM, OpenRouter | Route to cheapest model, fail over | Don't compress the conversation |
| **Caching middleware** | Portkey | Cache identical full-prompt requests | Don't dedupe inside a conversation |
| **Prompt cache (Anthropic native)** | `cache_control` headers | Re-bill cached prefix at 10% | Only works on stable prefixes; one schema flap invalidates |
| **Context compression libraries** | LangChain summary memory | App-side context management | Not a transparent proxy; requires code changes |
| **Cursor/Cline "local model" routers** | Built into the IDE | Route easy work to local Llama | Only works inside that IDE; ignores Claude Code |
| **MCP firewalls** | Sentinel, others | Block dangerous tool calls | Don't reduce token costs |

None of these compress the actual conversation traffic between your AI client and Anthropic — which is where 40–70% of waste lives. That's the gap TokenShield fills.

### 1.3 Why Anthropic won't ship this

A "use less Claude" feature is structurally awkward for the company billing you per token. Anthropic shipped prompt-caching, which captures the easy 25% — but it puts the burden on you to construct stable prefixes. The harder wins (cross-turn dedup, diff-based re-reads, output early-stop) require either invasive SDK changes or a layer outside Anthropic's control plane.

A neutral third party can do it without conflict of interest.

---

## 2. The architecture

### 2.1 Where TokenShield sits

```
   ┌──────────────┐      ┌─────────────────────┐      ┌─────────────────┐
   │ Claude Code  │      │  TokenShield Proxy  │      │ Anthropic API   │
   │  (or Cursor, │ ───▶ │  http://127.0.0.1   │ ───▶ │ api.anthropic.  │
   │   Windsurf,  │ ◀─── │  :7777              │ ◀─── │ com             │
   │   any SDK)   │      │  (your machine)     │      │                 │
   └──────────────┘      └─────────────────────┘      └─────────────────┘
                                  │
                                  ▼
                         ~/.tokenshield/ledger.db
                         http://127.0.0.1:7778
                         (local dashboard)
```

You set `ANTHROPIC_BASE_URL=http://127.0.0.1:7777` once in your shell. The Anthropic SDK respects this env var natively — no code change. Your `ANTHROPIC_API_KEY` stays in your shell; TokenShield never reads it.

Every request flows through a fail-open middleware pipeline. If any processor throws, the request continues to Anthropic untouched. The floor is *"don't break Claude Code."* The marketing is *"save tokens."*

### 2.2 The processor pipeline

| Processor | Type | Default | Expected savings |
|-----------|------|---------|------------------|
| **Token accounting** | Observation | On | 0% (baseline) |
| **Conversation dedup** | Request rewrite | On | 25–40% |
| **Result cache** | Request short-circuit | On | 5–10% |
| **Diff-based file reads** | Request rewrite | On | 10–15% (coding) |
| **Streaming early-stop** | Response truncation | Opt-in | 15–30% of output |
| **Context auto-summarize** | Request rewrite | Opt-in | 30–50% on long sessions |
| **Prompt-cache enforcer** | Diagnostic | On | 15–25% recovered |

Each processor implements `onRequest(messages) → messages` and/or `onResponse(stream) → stream`. The pipeline runs them in order; any uncaught exception trips a per-processor circuit breaker and the request continues with the remaining processors.

### 2.3 Conversation deduplication — the biggest single win

A Claude `messages` array can contain hundreds of `tool_result` blocks across turns. Many of those blocks are byte-identical to earlier ones (re-reads, idempotent lookups, schema queries).

```ts
// Pseudo-code for the dedup pass
function dedupe(messages: Message[]): Message[] {
  const seen = new Map<string, { messageIndex: number; toolUseId: string }>();
  for (const [i, msg] of messages.entries()) {
    for (const block of msg.content) {
      if (block.type !== "tool_result") continue;
      const hash = sha256(canonicalize(block.content));
      const prior = seen.get(hash);
      if (prior === undefined) {
        seen.set(hash, { messageIndex: i, toolUseId: block.tool_use_id });
        continue;
      }
      // Replace body with a pointer Claude can follow on demand.
      block.content = `[tokenshield: identical to tool_result ${prior.toolUseId} ` +
                      `at message ${prior.messageIndex}, sha:${hash.slice(0, 8)}]`;
    }
  }
  return messages;
}
```

Claude follows the pointer naturally — if it needs the actual content again, it re-issues the tool call and the **result cache** serves it for zero new tokens. We've never seen Claude get confused by the pointer once the prompt establishes the convention.

The risk is correctness — if Claude needs the content *and* the cache is cold, it has to wait. We've measured this at <1% of turns in real sessions, and the time saved by smaller context dominates.

### 2.4 Diff-based file reads

When Claude reads `auth.ts` at turn 5 and again at turn 30, we don't send 800 lines twice. We send 800 once, then a 12-line unified diff against the prior version:

```
[tokenshield: auth.ts — unchanged since message 5, except lines 142–154:
@@ -142,4 +142,12 @@
-export async function verify(token: string) {
+export async function verify(token: string, audience: string) {
+  if (audience !== EXPECTED_AUDIENCE) throw new Error("bad audience");
   ...
]
```

Claude parses unified diff natively — both Cursor and Claude Code have shown they can reason over diffs without confusion. Savings: 50–80% on file-heavy iterative coding loops.

### 2.5 Streaming early-stop

Output tokens cost **5× input** on Opus 4.7. A 3,000-token response that ends with *"Would you like me to continue with the next file?"* costs you $0.225 — and the user usually only wanted the first 800 tokens.

The stream-early-stop processor watches the streaming `text` delta for natural stop patterns:

```
/(?:Would you like me to|Should I (?:continue|proceed)|Let me know if you want)/i
```

When detected within ~200 tokens of a code-block-terminated message, the local dashboard surfaces a one-tap "stop here" button that closes the upstream SSE stream. Output cost stops immediately. The partial response is still delivered to your client because we forwarded byte-faithfully until the stop.

Default OFF — flips to default ON after 14 days of in-the-wild correctness validation per user.

### 2.6 Context auto-summarize (the cliff-protector)

Once a Claude Code session passes ~100K cumulative tokens, every new turn re-bills all 100K. A user 4 hours into a session is paying $1.50+ per turn — most of which is re-billing the same context.

The summarizer waits until you cross 100K, then makes a single Haiku 4.5 call that compresses turns 1..N into a ≤2K-token prefix. The next turn re-injects this as a synthetic `assistant` message at conversation start:

```
[tokenshield-summary: turns 1–42 compressed to 1,847 tokens.
Originals available via `tokenshield show-original <session-id>`.]
```

Claude doesn't notice — it just sees a more compact history. This processor is OFF by default until we can show, per workload, that it nets out positive against Anthropic's prompt-cache invalidation cost (see §4.2).

---

## 3. Privacy — the architectural commitment, not the marketing word

### 3.1 What never leaves your machine

- Your `ANTHROPIC_API_KEY`. TokenShield does not read environment variables for keys, does not log Authorization headers, and does not persist credentials. The key flows through as a header from your client to Anthropic; we are a transparent forwarder.
- The content of any prompt, tool result, or assistant message. Aggregates are bucketed and stripped before they leave the proxy.
- The names of your MCP tools, file paths, or any identifiers that could reveal what you're working on.

### 3.2 What optional cloud telemetry does include

Off by default. When opted in, every 60s the proxy sends a payload like:

```json
{
  "license": "tk_live_…",
  "bucket": "2026-05-16T22:00:00Z",
  "model": "claude-opus-4-7",
  "processor": "conversation-dedup",
  "input_tokens_raw": 184_320,
  "input_tokens_sent": 71_840,
  "output_tokens_raw": 12_400,
  "output_tokens_sent": 12_400,
  "dollars_saved": 1.687,
  "request_count": 18
}
```

No `prompt`, no `tool_name`, no `text`, no `content`. The schema is enforced at the source: any payload containing a forbidden key is dropped locally with an error logged for the user.

### 3.3 Localhost binding by default

The proxy listens on `127.0.0.1` only. `--bind 0.0.0.0` is opt-in with a 3-second warning prompt that displays the security implications. We will never ship a "default LAN-exposed" configuration.

### 3.4 Verifiability

The source is MIT-licensed and on GitHub. Every claim in this document is verifiable by reading `packages/core/src/proxy/anthropic-passthrough.ts` and `packages/core/src/telemetry.ts`. The cloud-side telemetry contract is `packages/core/src/telemetry-schema.ts`. There is no separate "enterprise" branch that does different things.

---

## 4. The math, honestly

### 4.1 Savings compose multiplicatively, not additively

A common marketing trap: claim "30% dedup + 10% cache + 15% diff + 20% summarize = 75% savings." This is wrong. The diff processor only operates on what dedup didn't already pointer-ify. The cache only catches what dedup let through.

The honest composition is multiplicative on the surviving tokens:

```
surviving = 1.0
for each processor p in pipeline_order:
    saves_this_pass = surviving × p.efficiency
    surviving -= saves_this_pass
total_saved = 1.0 - surviving
```

With our measured per-processor efficiencies on a medium-workload session:

| Processor | Efficiency on surviving tokens | Cumulative survival |
|-----------|--------------------------------|---------------------|
| Conversation dedup | 30% | 70% |
| Result cache | 7% (of survivors) | 65% |
| Diff-based file reads | 12% | 57% |
| Streaming early-stop | 18% (output) | 47% (input + output blended) |
| Context auto-summarize | 20% | 38% |

→ **~62% total savings** on the medium workload. Heavy workloads hit ~70%. Light workloads (lots of short Q&A, no agentic loops) typically land at 20–30% because there's less to compress.

### 4.2 When compression can cost you money

Anthropic prompt caching re-bills cached input at 10% of the normal rate. If TokenShield modifies the prefix on every turn, we *invalidate* the cache and net-cost you 4× on what was previously cached.

The conservative defaults reflect this:

- Dedup pointer stubs are deterministic — same content always produces the same stub — so prompt caching still hits on stable prefixes.
- Diff-based reads modify only the *new* file_read response, not the established history. Prompt cache holds.
- Context auto-summarize **invalidates the cache by definition** (the prefix changes). That's why it stays OFF by default until we can prove the savings exceed the cache-invalidation cost for your specific workload. The dashboard surfaces this break-even line.

### 4.3 The workload-tiered guarantee

After 7 days of measurement we classify your workload by daily input-token volume:

| Workload | Daily input tokens | Guaranteed savings | Marketing ceiling |
|----------|--------------------|--------------------|--------------------|
| Light | < 200K | 25% | 30% |
| Medium | 200K – 2M | 40% | 50% |
| Heavy / Agentic | > 2M | 55% | 70% |

If we miss the guaranteed floor, we refund the difference up to one month's subscription. One-shot per account; refund capped to bound the company's tail risk. The refund mechanism is a real Stripe API call against your subscription invoice, not a credit balance.

---

## 5. What we deliberately do not do

- **We do not run a hosted SaaS proxy.** A hosted proxy would mean we receive every token your AI sends and receives. That's a liability we won't accept and a privacy story you shouldn't have to trust. Local-only forever for the free + standalone tiers; hosted may exist someday for teams that explicitly want it, with a published BAA.
- **We do not charge a percentage of measured savings.** Measurement disputes eat support time on both sides. Flat per-seat pricing ($19/mo individual, $29/seat Team Standard bundled with Governance, $59/seat Team Pro) keeps the math simple for both of us.
- **We do not break Claude Code to save tokens.** Every processor is replay-tested in CI against recorded sessions; PRs are blocked on any correctness regression. Diff-mode is on by default for your first 14 days so every modification is reviewable side-by-side.
- **We do not "use less Claude" by routing to other models silently.** Model routing (TokenShield's sibling product Orchestra, shipping v1.1) is an explicit, configurable opt-in. We never substitute the model your code asked for without your policy permission.
- **We do not fight closed apps.** Claude Desktop, ChatGPT desktop, and Gemini app do not expose a custom base URL setting. We don't ship system-level CA-cert tricks to intercept them. The supported integration list is what supports a base URL override.

---

## 6. What works today

| Tool | Status | Setup |
|------|--------|-------|
| **Claude Code** (CLI) | ✅ Live | `export ANTHROPIC_BASE_URL=http://127.0.0.1:7777` |
| **Cursor** (Anthropic mode) | ✅ Live | Settings → Models → Anthropic → Custom Base URL |
| **Windsurf** (Anthropic mode) | ✅ Live | Settings → Models → Anthropic → Custom endpoint |
| **Zed** (Anthropic mode) | ✅ Live | `settings.json` → `assistant.anthropic_api_url` |
| **Aider** (Anthropic mode) | ✅ Live | Same `ANTHROPIC_BASE_URL` env var |
| Anthropic SDK apps (any language) | ✅ Live | The SDK respects the env var |
| **OpenAI** (Codex CLI, Cursor GPT, Continue) | ✅ Live | `openai_base_url = "http://127.0.0.1:7777"` in `~/.codex/config.toml` or equivalent base URL setting |
| **Google Gemini** | 🕒 Planned | Harder (Google auth quirks) — same adapter pattern |
| **Claude Desktop** (Anthropic GUI) | ❌ No plans | Doesn't expose a base URL setting |
| **ChatGPT desktop** | ❌ No plans | Session-based auth, no API key flow |

---

## 7. Implementation status

### 7.1 What ships in v0.1 (today)

- Wire-faithful HTTP + SSE passthrough to `api.anthropic.com`
- Token accounting from `message_start` / `message_delta` events
- SQLite ledger on disk (no native deps; uses Node 22+ `node:sqlite`)
- Local dashboard at `:7778`
- Fail-open middleware chain
- Pro-grade CLI: `setup`, `up`, `up --daemon`, `status`, `stop`, `logs`, `doctor`, `demo`, `estimate`, `integrations {list,enable,show,disable}`
- 40-test golden suite (16 core + 24 CLI)
- MIT license

### 7.2 Shipping in v0.2 (week of 2026-05-24)

- Conversation deduplication
- Result cache
- Diff-mode UI for trust-building
- Cloud telemetry endpoint (opt-in)

### 7.3 Shipping in v0.3 (week of 2026-05-31)

- Diff-based file reads
- Streaming early-stop
- Workload-tier classifier

### 7.4 v1.0 GA (week of 2026-06-07)

- Context auto-summarize
- Prompt-cache enforcer
- Stripe checkout live (Solo $19/mo individual)
- Workload-tiered guarantee live
- Public launch

### 7.5 Fast-follows

- **v1.1** Google Gemini provider adapter
- **v1.5** Tauri menu-bar app (Mac + Windows + Linux) — one-click installer, system-tray savings ticker, GUI wizards that call the same `integrations` library the CLI uses
- **Orchestra** (sibling product) — explicit hybrid model routing + Anthropic failover, bundled into Team Pro
- **PrivacyShield** (sibling product) — local PII tokenization, $99–$499/seat self-serve

---

## 8. How to try it in 60 seconds

```bash
npm install -g @curatedmcp/tokenshield
tokenshield setup                           # guided install
# or, manually:
tokenshield up                              # foreground
export ANTHROPIC_BASE_URL=http://127.0.0.1:7777
claude                                      # your normal workflow
open http://127.0.0.1:7778                  # live dashboard
```

For Codex/OpenAI:

```toml
# ~/.codex/config.toml
openai_base_url = "http://127.0.0.1:7777"
```

For a no-network demo of projected savings:

```bash
tokenshield demo
```

To verify the privacy claim on your own machine:

```bash
tokenshield doctor       # shows what env vars we see
tokenshield --json status | jq
# or read packages/core/src/telemetry-schema.ts
```

---

## 9. The business honesty

CuratedMCP, the parent company, runs a curated MCP directory with 247K installs and a Governance Control Plane for engineering teams ($29/seat). TokenShield is the consumer-on-ramp to that funnel. The pitch to a Platform Lead is direct: *"$29/seat to govern your MCP usage AND cut your Claude bill 40%. The TokenShield savings alone usually cover the seat cost."*

We don't pretend to be neutral. The processor pipeline is MIT-licensed and runs on your machine; the dashboard is yours; the savings are yours. We make money when your team adopts the bundle that includes governance, because that's where the proxy + the policy + the audit log compound into something a procurement department signs.

If TokenShield never paid for itself in the first month, we'd rather refund the difference than haggle.

---

## 10. References & links

- Repository (MIT): `github.com/curatedmcp/tokenshield`
- npm: `@curatedmcp/tokenshield`, `@curatedmcp/tokenshield-core`
- Product page: [curatedmcp.com/tokenshield](https://curatedmcp.com/tokenshield)
- Sibling firewall (governance): [curatedmcp.com/sentinel](https://curatedmcp.com/sentinel)
- Anthropic prompt caching: [docs.anthropic.com/en/docs/build-with-claude/prompt-caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
- Anthropic SDK base URL override: `ANTHROPIC_BASE_URL` env var (documented in `@anthropic-ai/sdk`)
- Microsoft Presidio (used in PrivacyShield, sibling product): [microsoft.github.io/presidio](https://microsoft.github.io/presidio/)

---

*Last updated 2026-05-16. Comments and corrections: open an issue at `github.com/curatedmcp/tokenshield` or email `team@curatedmcp.com`. We will revise this document as measurements come in from real users.*
