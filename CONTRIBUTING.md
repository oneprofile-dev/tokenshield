# Contributing to TokenShield

Thanks for your interest in contributing! This is a local proxy handling
real API traffic — correctness and "your key never leaves your machine"
are non-negotiable; everything else is open to discussion.

## Getting started

```bash
git clone https://github.com/oneprofile-dev/tokenshield.git
cd tokenshield
npm install
npm run build
npm test
```

This is an npm workspaces monorepo: `packages/core` (the proxy) and
`packages/cli` (the `tokenshield` command).

## Development workflow

```bash
npm run build           # builds both workspaces
npm test                # runs both workspaces' test suites
npm run lint             # typecheck core + cli, no emit
npm run dev:proxy        # run the proxy in watch mode
npm run cli              # run the built CLI
```

## What we accept

- Bug fixes with a clear repro case
- New dedup/caching strategies for the local pipeline, with a
  `tokenshield bench` result showing the effect on the fixture sessions
- Improvements to the live dashboard / savings counter accuracy
- Tests

## What we don't accept (yet)

- Anything that routes API traffic through infrastructure other than
  directly to `api.anthropic.com` — the "your key never leaves your
  machine" guarantee is the whole point of the product
- Savings numbers in docs or CLI output that aren't backed by a real
  `tokenshield bench` run against the fixture sessions

## Pull request checklist

- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] `npm run lint` passes
- [ ] If you touched the dedup/caching logic, ran `tokenshield bench` and
      included the before/after numbers in the PR description
- [ ] Description explains the *why*, not just the what

## License

MIT — your contributions will be released under the same license.
