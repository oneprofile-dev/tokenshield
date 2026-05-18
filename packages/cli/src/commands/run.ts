import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { defaultConfig } from "@curatedmcp/tokenshield-core";
import { c, sym, dim, emit, say } from "../lib/ui.js";
import { TokenShieldError } from "../lib/errors.js";
import { readDaemon } from "../lib/daemon.js";
import { classifyApiKey } from "../lib/preflight.js";

/**
 * Probe whether the proxy port is actually accepting TCP connections.
 * Works for both daemon AND foreground modes — the previous daemon-file
 * check missed foreground proxies and produced false negatives.
 */
async function isProxyAlive(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const t = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(t);
      socket.end();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(t);
      resolve(false);
    });
  });
}

export interface RunOptions {
  /** Forwarded argv after the `--`. First element may be the command name (defaults to `claude`). */
  passthroughArgs: string[];
  /** Override the wrapped command (default: claude). */
  command?: string;
  /** Skip the --bare auto-inject (useful for non-Claude commands). */
  noBare: boolean;
  /** Bypass the daemon check (useful in CI/scripted contexts). */
  force: boolean;
}

/**
 * Wrap a child process so it routes through the TokenShield proxy with
 * strict API-key auth (no Keychain, no OAuth bleed-through).
 *
 * For Claude Code specifically (the default), we inject `--bare` which the
 * binary documents as: "Anthropic auth is strictly ANTHROPIC_API_KEY or
 * apiKeyHelper. OAuth and keychain are never read."
 *
 * This is the canonical fix for the macOS Keychain interference that
 * silently breaks Pro/Max users' first install.
 */
export async function runRun(options: RunOptions): Promise<void> {
  const cfg = defaultConfig();
  const proxyBase = `http://${cfg.bind}:${cfg.port}`;

  // ── 1. Refuse to run if no proxy is live (unless --force) ────────────────
  if (!options.force) {
    // Check by ACTUALLY connecting to the proxy port, not just looking for
    // a daemon pidfile. This way foreground `tokenshield up` in another
    // terminal works too — which is what most users actually do first.
    const daemon = readDaemon();
    const portAlive = await isProxyAlive(cfg.bind, cfg.port);

    if (!portAlive) {
      const hint = daemon
        ? `A daemon record exists at pid ${daemon.pid} but the proxy isn't responding on ${cfg.bind}:${cfg.port}. Try \`tokenshield stop\` then \`tokenshield up --daemon\`.`
        : `Port ${cfg.port} isn't accepting connections.`;
      throw new TokenShieldError({
        code: "DAEMON_NOT_RUNNING",
        message: "No TokenShield proxy is responding. Requests would bypass the proxy entirely.",
        hint,
        nextSteps: [
          "Option A (recommended): in a separate terminal, run `tokenshield up --daemon`",
          "Option B: in another terminal, run `tokenshield up` (foreground) and keep it open",
          "Then re-run: tokenshield run -- <args>",
          "# Or pass --force to send the request directly to Anthropic (no measurement, no savings)",
        ],
      });
    }
  }

  // ── 2. Require ANTHROPIC_API_KEY in THIS shell ───────────────────────────
  // (env vars don't cross shells. If the user set it in the shell where
  // they ran `tokenshield up`, it doesn't help in THIS shell.)
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  const cls = classifyApiKey(apiKey);
  if (cls.state !== "ok") {
    throw new TokenShieldError({
      code: "MISSING_API_KEY",
      message: "ANTHROPIC_API_KEY is not set in THIS shell (env vars don't cross terminal tabs).",
      hint: cls.hint,
      nextSteps: [
        "In this same shell, paste your key:",
        "  export ANTHROPIC_API_KEY=sk-ant-api03-...your-key-from-console.anthropic.com...",
        "Then re-run: tokenshield run -- <your prompt>",
        "",
        "Tip: add the export to your ~/.zshrc so it's permanent across all new terminals.",
      ],
    });
  }

  // ── 3. Resolve the command + argv ────────────────────────────────────────
  const cmd = options.command ?? "claude";
  const args = [...options.passthroughArgs];

  // For `claude`, inject --bare to force strict env-var auth. This is the
  // ONE flag that bypasses Keychain reads on macOS — the #1 silent killer
  // for new TokenShield users on Pro/Max subscriptions.
  if (cmd === "claude" && !options.noBare && !args.includes("--bare")) {
    args.unshift("--bare");
  }

  // ── 4. Build the child env ───────────────────────────────────────────────
  const childEnv = {
    ...process.env,
    ANTHROPIC_BASE_URL: proxyBase,
    ANTHROPIC_API_KEY: apiKey,
    // Belt-and-braces: clear any prior OAuth token env vars some shells
    // export inadvertently after `claude login`.
    CLAUDE_CODE_OAUTH_TOKEN: "",
  };

  // ── 5. Announce and exec ────────────────────────────────────────────────
  say("");
  say(`${sym.arrow} Routing ${c.bold(cmd + (args.length ? " " + args.join(" ") : ""))} through TokenShield`);
  say(`  ${dim("ANTHROPIC_BASE_URL=" + proxyBase)}`);
  say(`  ${dim("ANTHROPIC_API_KEY=…" + (apiKey ?? "").slice(-4) + " (strict — Keychain bypassed)")}`);
  say("");

  const child = spawn(cmd, args, {
    stdio: "inherit",
    env: childEnv,
  });

  await new Promise<void>((resolve, reject) => {
    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new TokenShieldError({
            code: "NOT_FOUND",
            message: `Command not found: ${cmd}`,
            nextSteps: [
              cmd === "claude" ? "npm install -g @anthropic-ai/claude-code" : `install ${cmd} first`,
              "then re-run: tokenshield run -- " + args.join(" "),
            ],
          }),
        );
      } else {
        reject(err);
      }
    });
    child.on("exit", (code, signal) => {
      if (signal !== null) {
        emit(dim(`(child exited via ${signal})`));
        process.exit(128 + (signal === "SIGINT" ? 2 : signal === "SIGTERM" ? 15 : 1));
      }
      process.exit(code ?? 0);
    });
  });
}
