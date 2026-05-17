# TokenShield

**Cut your Claude Code bill 40–70%. Local proxy. Your API key never leaves your machine.**

TokenShield sits between Claude Code (or any Anthropic SDK client) and the Anthropic API. It deduplicates repeated content, caches results, compresses long conversations, and streams a live savings counter — all on your machine.

```bash
npm install -g @curatedmcp/tokenshield
tokenshield up
# In another shell, before running Claude Code:
export ANTHROPIC_BASE_URL=http://localhost:7777
claude   # or any Anthropic SDK app
```

Open `http://localhost:7778` for the live dashboard.

## Status

`v0.1` — Sprint 1: pass-through proxy with truthful measurement (Estimate mode). No compression yet — that's coming in v0.2.

## Privacy

- Your Anthropic API key is held in process memory only. Never written to disk. Never sent to CuratedMCP.
- Optional cloud telemetry is aggregate-only (token counts and dollar savings; never prompt content).
- Localhost binding by default (`127.0.0.1`). Opt-in `--bind 0.0.0.0` for team deployments.

## License

MIT. See [LICENSE](LICENSE).
