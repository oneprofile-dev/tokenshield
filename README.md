# TokenShield

**Cut Claude Code and Codex/OpenAI token spend. Local proxy. Your API keys never leave your machine.**

TokenShield sits between agentic AI tools and their API providers. It supports Anthropic clients such as Claude Code plus OpenAI-compatible Codex traffic, deduplicates repeated tool results in the conversation, caches deterministic responses, and streams a live savings counter — all on your machine.

```bash
npm install -g @curatedmcp/tokenshield
tokenshield setup
```

Or manually:

```bash
tokenshield up
# in another shell:
export ANTHROPIC_BASE_URL=http://127.0.0.1:7777
claude   # your normal workflow — open http://127.0.0.1:7778 for the dashboard
```

For Codex/OpenAI, add this to `~/.codex/config.toml`:

```toml
openai_base_url = "http://127.0.0.1:7777"
```

## Measured savings (v0.2.0, conversation-dedup only)

Numbers come from `tokenshield bench`, replaying three fixture sessions through the pipeline:

| Workload | Description | Bytes in | Bytes out | Savings |
|----------|-------------|----------|-----------|---------|
| **light** | 5-turn Q&A, no tool use | 1.4 KB | 1.4 KB | **0%** (dedup correctly doesn't trigger) |
| **medium** | 12-turn coding session, 2 file re-reads | 15.5 KB | 11.2 KB | **27.7%** |
| **heavy** | 25-turn agentic loop, 5 file re-reads + 3 `gh pr list` repeats | 61.7 KB | 23.4 KB | **62.1%** |
| **Aggregate** | All three above | 78.6 KB | 36.0 KB | **54.2%** |

Reproduce on your machine:

```bash
git clone https://github.com/oneprofile-dev/tokenshield
cd tokenshield && npm install && npm run build
node packages/cli/dist/cli.js bench
```

These four numbers are asserted in CI (`packages/cli/test/bench.test.ts`) — any future regression fails the build.

## What's measured

- **conversation-dedup** (v0.2, default ON): every `tool_result` is content-hashed; second and subsequent occurrences within a conversation are replaced with a deterministic pointer that Claude follows on demand. The first occurrence is always kept verbatim.
- **response-cache** (v0.2, default ON, conservative): caches identical requests where `temperature === 0 && stream === false`. Cache hits short-circuit without invoking Anthropic.

Coming v0.3:
- **diff-based file reads** — sends a unified diff against the prior version instead of the full file
- **streaming early-stop** — kills runaway "Would you like me to continue…" output streams

Coming v1.0:
- **context auto-summarize** — Haiku-compresses long conversation prefixes once a session crosses 100K tokens
- **prompt-cache enforcer** — detects when an unstable MCP tool schema is silently invalidating Anthropic's prompt cache

## Architecture in 60 seconds

```
   Claude Code ─┐
   Codex      ──┼▶  TokenShield proxy  ─▶  api.anthropic.com / api.openai.com
   Cursor     ──┘       127.0.0.1:7777
                         (your machine)    │
                          ▼
                  ~/.tokenshield/ledger.db
                  http://127.0.0.1:7778
                  (live local dashboard)
```

- The proxy is a transparent HTTP forwarder with full SSE streaming preserved byte-faithfully.
- Every middleware processor is **fail-open**: if it throws, the request goes through untouched.
- A per-processor **circuit breaker** disables a flaky processor after 3 failures in 60s (5-min cooldown).
- The local SQLite ledger uses Node's built-in `node:sqlite` — zero native deps, zero compile toolchain pain.

## CLI

```text
tokenshield setup              60-second guided install
tokenshield up                 start in foreground (Ctrl-C to stop)
tokenshield up --daemon        start in background
tokenshield status             daemon state + last-24h spend
tokenshield logs --limit 20    recent requests
tokenshield bench              replay built-in fixtures and report savings
tokenshield demo               canned 8-turn savings replay (no network)
tokenshield doctor             health check (Node, key, network, ports)
tokenshield stop               stop the background daemon
tokenshield integrations list  detect Claude Code / Codex / Cursor / Windsurf / Zed / Aider
tokenshield integrations enable claude-code   # write managed block to shell rc
```

Every command supports `--json`, `--quiet`, and `--debug`. Exit codes are category-specific so scripts can react: `10` port-in-use, `11` daemon-not-running, `20` missing API key, `30` upstream unreachable, etc.

## Status

- **today**: conversation-dedup + response-cache + production-grade CLI. Anthropic and OpenAI/Codex providers live; Gemini adapter lands later.
- **planned**: diff-based file reads + streaming early-stop.
- **planned**: context auto-summarize + Stripe checkout + public GA.

## Privacy

- Your provider API keys are held by your AI client and forwarded upstream. Never written by TokenShield. Never sent to CuratedMCP.
- Optional cloud telemetry is aggregate-only (token counts and dollar savings; never prompt content).
- Localhost binding by default (`127.0.0.1`). Opt-in `--bind 0.0.0.0` for team deployments behind a VPN.
- Read the whitepaper: [docs/whitepaper.md](docs/whitepaper.md).

## License

MIT. See [LICENSE](LICENSE).

## Links

- Website: https://curatedmcp.com/tokenshield
- Whitepaper (CC BY 4.0): https://curatedmcp.com/docs/tokenshield/whitepaper
- Source: https://github.com/oneprofile-dev/tokenshield
- npm: [`@curatedmcp/tokenshield`](https://www.npmjs.com/package/@curatedmcp/tokenshield), [`@curatedmcp/tokenshield-core`](https://www.npmjs.com/package/@curatedmcp/tokenshield-core)
