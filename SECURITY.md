# Security Policy

## Reporting a vulnerability

Email **sam@curatedmcp.com** with the details (a proof-of-concept helps).
Please don't open a public issue for anything exploitable — give us a chance
to ship a fix first. You'll get an acknowledgement within 2 business days and
a status update at least weekly until it's resolved. We'll credit you in the
release notes unless you'd rather stay anonymous.

## Supported versions

Only the latest published version of `@curatedmcp/tokenshield` on npm
receives security fixes.

## What this software does and doesn't touch

- **Local proxy, local key.** TokenShield sits between Claude Code (or any
  Anthropic SDK client) and the Anthropic API on your own machine. Your
  Anthropic API key never leaves your machine and is never sent to
  CuratedMCP — the proxy forwards your requests directly to
  `api.anthropic.com`.
- **What it does with traffic**: deduplicates repeated tool results and
  caches deterministic responses locally, and computes a savings counter
  from that traffic — all in-process, nothing persisted beyond your local
  dashboard unless you configure otherwise.
- **No account or API key of ours required** to run it.

## Supply chain

- Published from this public repository — what's on npm is built from the
  source you can read here.
- `package-lock.json` is committed.
