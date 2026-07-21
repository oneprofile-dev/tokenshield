# TokenShield — End-User Production Test Approach

Tests run against the **published npm packages** (`@curatedmcp/tokenshield` + `@curatedmcp/tokenshield-core`) on a clean machine with no local repo on `PATH`. Each step is atomic and verifiable.

---

## Environment setup

| Item | Requirement |
|------|-------------|
| Node | 22+ (`node --version`) |
| npm | 10+ (`npm --version`) |
| `ANTHROPIC_API_KEY` | Set in current shell |
| Ports | 7777, 7778 free |
| `ANTHROPIC_BASE_URL` | **NOT** set at test start |

---

## T-1 · Install from public registry

```bash
npm install -g @curatedmcp/tokenshield
```

**Pass criteria:**
- Exit 0 with no errors
- `tokenshield --version` prints `0.2.0`
- `which tokenshield` resolves to the global bin (not a local `node_modules`)

---

## T-2 · Doctor (cold state)

```bash
tokenshield doctor
```

**Pass criteria:**
- Node version: ✅ (≥22)
- API key: ✅ (key detected in env)
- Ports 7777/7778: ✅ (free)
- `ANTHROPIC_BASE_URL`: ⚠ warning — "not yet set, run `tokenshield up` first"
- Upstream reachable: ✅ (can reach api.anthropic.com)
- Exit 0

---

## T-3 · Start the proxy

In shell A:
```bash
tokenshield up
```

**Pass criteria:**
- Prints: `Proxy listening on http://127.0.0.1:7777`
- Prints: `Dashboard at http://127.0.0.1:7778`
- Prints the `export ANTHROPIC_BASE_URL=...` line for copy-paste
- Dashboard URL opens in browser and shows $0.00 savings, zero requests
- No crash within 5 seconds

---

## T-4 · Proxy routes a real API call

In shell B:
```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:7777
curl -s -X POST http://127.0.0.1:7777/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":32,"messages":[{"role":"user","content":"Say hi"}]}'
```

**Pass criteria:**
- Response is valid Anthropic JSON with `content[0].text` containing a greeting
- `x-tokenshield-*` response headers present
- Shell A shows a request log line
- Dashboard shows 1 request, ~$0.00001 spend ticked up

---

## T-5 · Conversation dedup fires

Replay a canned conversation that re-reads the same file twice (simulates Claude Code behavior):

```bash
tokenshield demo
```

**Pass criteria:**
- Prints 8-turn session replay
- Line shows: `[tokenshield: identical to tool_result ... N bytes elided]` for the repeated read
- Final summary shows savings ≥ 25%
- No upstream calls (demo is canned — zero network cost)

---

## T-6 · Bench — measured savings meet CI floors

```bash
tokenshield bench
```

**Pass criteria (exact thresholds asserted in CI):**

| Workload | Expected savings |
|----------|-----------------|
| light    | 0% (dedup correctly doesn't fire) |
| medium   | ≥ 25% |
| heavy    | ≥ 55% |
| aggregate | ≥ 50% |

- Exit 0
- All 4 rows print "PASS"

---

## T-7 · Status when running

```bash
tokenshield status
```

**Pass criteria:**
- Shows daemon state: running
- Shows proxy port: 7777
- Shows dashboard port: 7778
- Shows last-24h spend (may be $0.00 if T-4 was the only call)

---

## T-8 · Logs

```bash
tokenshield logs --limit 5
```

**Pass criteria:**
- Shows the request from T-4 (model, tokens in/out, savings %)
- `--json` flag emits valid JSON array

---

## T-9 · Integrations — detect Claude Code

```bash
tokenshield integrations list
```

**Pass criteria:**
- If Claude Code is installed: shows `claude-code ✅ detected`
- `tokenshield integrations enable claude-code` writes the managed block to `~/.zshrc` (or `~/.bashrc` on Linux)
- Block contains `export ANTHROPIC_BASE_URL=http://127.0.0.1:7777`
- Re-running `enable` is idempotent (block not duplicated)

---

## T-10 · Stop the daemon

```bash
tokenshield stop
tokenshield status
```

**Pass criteria:**
- `stop` exits 0
- `status` reports: daemon not running (exit code 11)
- Port 7777 is free again (`lsof -i :7777` returns empty)

---

## T-11 · Doctor after stop

```bash
tokenshield doctor
```

**Pass criteria:**
- Daemon state: not running (expected)
- All other checks still pass
- Recommends `tokenshield up` to start

---

## T-12 · Daemon mode

```bash
tokenshield up --daemon
tokenshield status
tokenshield stop
```

**Pass criteria:**
- `up --daemon` exits immediately (background process)
- `status` shows running with a PID
- `stop` cleanly terminates

---

## T-13 · Claude Code end-to-end (golden path)

Prerequisites: T-3 complete (proxy running), Claude Code installed.

```bash
# Shell B
export ANTHROPIC_BASE_URL=http://127.0.0.1:7777
claude
```

Run a 5-turn coding session that reads the same file twice (e.g. ask Claude to summarize a file, then ask it to modify it — it will re-read).

**Pass criteria:**
- Claude Code works identically to without the proxy (no errors, no latency felt)
- Dashboard shows dedup savings on the second read
- No "401 Unauthorized" errors (proxy is transparent with key)
- No dropped SSE tokens (streaming works correctly)

---

## T-14 · Uninstall clean

```bash
npm uninstall -g @curatedmcp/tokenshield
which tokenshield
```

**Pass criteria:**
- `which tokenshield` returns nothing / exits 1
- `~/.tokenshield/` ledger db remains (user data preserved)
- Shell rc managed block is NOT removed (user must opt-out intentionally via `integrations disable`)

---

## Summary table

| # | Test | Automated in CI? |
|---|------|-----------------|
| T-1 | Install from public registry | Manual (requires live npm) |
| T-2 | Doctor cold state | `tokenshield doctor` |
| T-3 | Start proxy | Integration test |
| T-4 | Real API call through proxy | Integration test |
| T-5 | Demo replay | `tokenshield demo` |
| T-6 | Bench savings floors | `tokenshield bench` ← **CI-gated** |
| T-7 | Status | Integration test |
| T-8 | Logs | Integration test |
| T-9 | Integrations detect + enable | Unit test (temp home) |
| T-10 | Stop | Integration test |
| T-11 | Doctor after stop | Integration test |
| T-12 | Daemon mode | Integration test |
| T-13 | Claude Code golden path | **Manual only** |
| T-14 | Uninstall clean | Manual |
| T-15 | OpenAI/Codex API passthrough | Integration test |

T-6 is the benchmark gate in CI. T-13 requires a real Claude Code session and human judgment on latency feel.

---

## Known issues / not tested

- **Windows / PowerShell**: shell-rc integration writes bash syntax; needs a separate `tokenshield integrations enable --shell powershell` path (v0.3 backlog)
- **Gemini endpoints**: not implemented yet
- **Rate-limit handling**: proxy passes 429s through transparently; no retry logic yet
