#!/usr/bin/env node
import { Command, Option } from "commander";
import { runUp, runSupervised } from "./commands/up.js";
import { runDoctor } from "./commands/doctor.js";
import { runDemo } from "./commands/demo.js";
import { runBench } from "./commands/bench.js";
import { runEstimate } from "./commands/estimate.js";
import { runStatus } from "./commands/status.js";
import { runStop } from "./commands/stop.js";
import { runLogs } from "./commands/logs.js";
import { runSetup } from "./commands/setup.js";
import {
  runIntegrationsList,
  runIntegrationsEnable,
  runIntegrationsShow,
  runIntegrationsDisable,
} from "./commands/integrations.js";
import type { IntegrationId } from "./lib/integrations.js";
import { setOutputMode, c, dim, emit, isJson } from "./lib/ui.js";
import { ensureNumber, runCommand, installProcessHandlers } from "./lib/errors.js";

installProcessHandlers();

const VERSION = "0.2.0";

const program = new Command();

program
  .name("tokenshield")
  .description(
    "Local API-layer proxy that cuts your Claude Code bill 40–70%.\n" +
      "Your ANTHROPIC_API_KEY stays on your machine. No signup to start measuring.",
  )
  .version(VERSION, "-v, --version", "show version")
  .helpOption("-h, --help", "show help")
  .addOption(new Option("--debug", "verbose output incl. stack traces").default(false))
  .addOption(new Option("--quiet, -q", "suppress non-essential output").default(false))
  .addOption(new Option("--json", "machine-readable JSON output").default(false))
  .hook("preAction", (cmd) => {
    const opts = cmd.optsWithGlobals() as { debug?: boolean; quiet?: boolean; json?: boolean };
    setOutputMode({
      debug: opts.debug === true,
      quiet: opts.quiet === true,
      json: opts.json === true,
    });
  })
  .addHelpText(
    "after",
    `
${c.bold("Quickstart")}
  ${c.cyan("$ tokenshield setup")}              ${dim("# 60-second guided install")}
  ${c.cyan("$ tokenshield up")}                 ${dim("# start in foreground (Ctrl-C to stop)")}
  ${c.cyan("$ tokenshield up --daemon")}        ${dim("# start in background")}
  ${c.cyan("$ tokenshield status")}             ${dim("# is it running? what did it cost today?")}
  ${c.cyan("$ tokenshield logs --limit 20")}    ${dim("# recent requests")}
  ${c.cyan("$ tokenshield stop")}               ${dim("# stop the daemon")}

${c.bold("First-time setup")}
  ${c.cyan("$ tokenshield doctor")}             ${dim("# verify Node, key, network")}
  ${c.cyan("$ tokenshield integrations list")}  ${dim("# see what we can configure")}
  ${c.cyan("$ tokenshield demo")}               ${dim("# offline savings replay")}

${c.bold("Privacy")}
  TokenShield runs entirely on your machine. Your API key is never read by us,
  and prompt content is never sent anywhere. Localhost binding by default.

${c.bold("Docs")}
  ${c.cyan("https://curatedmcp.com/tokenshield")}
`,
  );

// ── up ────────────────────────────────────────────────────────────────────────
program
  .command("up")
  .description("Start the proxy and the local dashboard")
  .option("--port <port>", "proxy port", "7777")
  .option("--dashboard-port <port>", "dashboard port", "7778")
  .option("--bind <host>", "bind address (default 127.0.0.1)", "127.0.0.1")
  .option("--upstream <url>", "upstream Anthropic base URL", "https://api.anthropic.com")
  .option("--ledger <path>", "SQLite ledger path")
  .option("--retention-days <n>", "ledger retention in days", "7")
  .option("--daemon, -d", "run in background", false)
  .addHelpText(
    "after",
    `\n${c.bold("Examples")}
  ${c.cyan("$ tokenshield up")}                          ${dim("# foreground, default ports")}
  ${c.cyan("$ tokenshield up --daemon")}                 ${dim("# background, stop with `tokenshield stop`")}
  ${c.cyan("$ tokenshield up --port 7780")}              ${dim("# different proxy port")}
  ${c.cyan("$ tokenshield up --bind 0.0.0.0 --port 7777")}  ${dim("# expose to LAN (trusted networks only)")}
`,
  )
  .action((raw: Record<string, unknown>) =>
    runCommand(async () => {
      await runUp({
        port: ensureNumber("port", raw["port"]),
        dashboardPort: ensureNumber("dashboard-port", raw["dashboardPort"]),
        bind: String(raw["bind"]),
        upstream: String(raw["upstream"]),
        ledger: raw["ledger"] ? String(raw["ledger"]) : undefined,
        retentionDays: ensureNumber("retention-days", raw["retentionDays"], 1, 365),
        daemon: raw["daemon"] === true,
      });
    }),
  );

// ── __supervise (hidden): daemon entrypoint ──────────────────────────────────
program
  .command("__supervise", { hidden: true })
  .option("--port <port>", "proxy port", "7777")
  .option("--dashboard-port <port>", "dashboard port", "7778")
  .option("--bind <host>", "bind address", "127.0.0.1")
  .option("--upstream <url>", "upstream Anthropic base URL", "https://api.anthropic.com")
  .option("--ledger <path>", "SQLite ledger path")
  .option("--retention-days <n>", "ledger retention", "7")
  .action((raw: Record<string, unknown>) =>
    runCommand(async () => {
      await runSupervised({
        port: ensureNumber("port", raw["port"]),
        dashboardPort: ensureNumber("dashboard-port", raw["dashboardPort"]),
        bind: String(raw["bind"]),
        upstream: String(raw["upstream"]),
        ledger: raw["ledger"] ? String(raw["ledger"]) : undefined,
        retentionDays: ensureNumber("retention-days", raw["retentionDays"], 1, 365),
        daemon: false,
      });
    }),
  );

// ── setup ─────────────────────────────────────────────────────────────────────
program
  .command("setup")
  .description("60-second guided install: detect tools, check network, start daemon")
  .option("--port <port>", "proxy port", "7777")
  .option("--dashboard-port <port>", "dashboard port", "7778")
  .option("--bind <host>", "bind address", "127.0.0.1")
  .option("--upstream <url>", "upstream Anthropic base URL", "https://api.anthropic.com")
  .option("--retention-days <n>", "ledger retention", "7")
  .option("--yes, -y", "accept all defaults non-interactively", false)
  .action((raw: Record<string, unknown>) =>
    runCommand(async () => {
      await runSetup({
        port: ensureNumber("port", raw["port"]),
        dashboardPort: ensureNumber("dashboard-port", raw["dashboardPort"]),
        bind: String(raw["bind"]),
        upstream: String(raw["upstream"]),
        retentionDays: ensureNumber("retention-days", raw["retentionDays"], 1, 365),
        yes: raw["yes"] === true,
      });
    }),
  );

// ── status ────────────────────────────────────────────────────────────────────
program
  .command("status")
  .description("Show daemon state + last-24h spend")
  .action(() => runCommand(runStatus));

// ── stop ──────────────────────────────────────────────────────────────────────
program
  .command("stop")
  .description("Stop the background daemon if one is running")
  .action(() => runCommand(runStop));

// ── doctor ────────────────────────────────────────────────────────────────────
program
  .command("doctor")
  .description("Run health checks on your TokenShield setup")
  .action(() => runCommand(runDoctor));

// ── logs ──────────────────────────────────────────────────────────────────────
program
  .command("logs")
  .description("Show recent requests recorded in the local ledger")
  .option("--limit <n>", "max rows to show", "20")
  .option("--model <substring>", "filter by model name (substring match)")
  .option("--errors-only", "only show non-2xx responses", false)
  .action((raw: Record<string, unknown>) =>
    runCommand(async () => {
      await runLogs({
        limit: ensureNumber("limit", raw["limit"], 1, 500),
        ...(raw["model"] ? { modelFilter: String(raw["model"]) } : {}),
        errorsOnly: raw["errorsOnly"] === true,
      });
    }),
  );

// ── estimate ──────────────────────────────────────────────────────────────────
program
  .command("estimate")
  .description("Show measured spend + projected v1.0 savings from the ledger")
  .option("--hours <n>", "lookback window in hours", "24")
  .action((raw: Record<string, unknown>) =>
    runCommand(async () => {
      await runEstimate({ hours: ensureNumber("hours", raw["hours"], 1, 24 * 30) });
    }),
  );

// ── demo ──────────────────────────────────────────────────────────────────────
program
  .command("demo")
  .description("Replay a recorded session and show projected savings (no network)")
  .option("--no-live", "skip the typewriter animation")
  .action((raw: Record<string, unknown>) =>
    runCommand(async () => {
      await runDemo({ live: raw["live"] !== false });
    }),
  );

// ── bench ─────────────────────────────────────────────────────────────────────
program
  .command("bench")
  .description("Run TokenShield against recorded request fixtures and report savings")
  .option("--fixture <name>", "single fixture (light|medium|heavy) or a path to a .json file")
  .option("--fixtures-dir <dir>", "override the fixtures directory")
  .addHelpText("after", `\n${c.bold("Examples")}\n  ${c.cyan("$ tokenshield bench")}                ${dim("# all built-in fixtures")}\n  ${c.cyan("$ tokenshield bench --fixture heavy")}\n  ${c.cyan("$ tokenshield --json bench | jq")}\n`)
  .action((raw: Record<string, unknown>) =>
    runCommand(async () => {
      await runBench({
        ...(raw["fixture"] ? { fixture: String(raw["fixture"]) } : {}),
        ...(raw["fixturesDir"] ? { fixturesDir: String(raw["fixturesDir"]) } : {}),
      });
    }),
  );

// ── integrations ──────────────────────────────────────────────────────────────
const integrations = program
  .command("integrations")
  .alias("int")
  .description("Detect + configure Claude Code, Cursor, Windsurf, Zed, Aider")
  .addHelpText(
    "after",
    `\n${c.bold("Examples")}
  ${c.cyan("$ tokenshield integrations list")}
  ${c.cyan("$ tokenshield integrations enable claude-code")}
  ${c.cyan("$ tokenshield integrations show")}              ${dim("# copy-paste snippets for every tool")}
  ${c.cyan("$ tokenshield integrations disable shell")}     ${dim("# remove our managed block from shell rc")}
`,
  );

integrations
  .command("list")
  .description("List detected AI tools and how each is configured")
  .option("--port <port>", "proxy port (for the snippet URL)", "7777")
  .option("--bind <host>", "bind address", "127.0.0.1")
  .action((raw: Record<string, unknown>) =>
    runCommand(() => {
      const port = ensureNumber("port", raw["port"]);
      runIntegrationsList({ baseUrl: `http://${String(raw["bind"])}:${port}` });
    }),
  );

integrations
  .command("enable <tool>")
  .description("Configure one tool to route through TokenShield")
  .option("--port <port>", "proxy port", "7777")
  .option("--bind <host>", "bind address", "127.0.0.1")
  .action((tool: string, raw: Record<string, unknown>) =>
    runCommand(() => {
      const port = ensureNumber("port", raw["port"]);
      runIntegrationsEnable({
        id: tool as IntegrationId,
        baseUrl: `http://${String(raw["bind"])}:${port}`,
      });
    }),
  );

integrations
  .command("show")
  .description("Print copy-paste snippets for every supported tool")
  .option("--port <port>", "proxy port", "7777")
  .option("--bind <host>", "bind address", "127.0.0.1")
  .action((raw: Record<string, unknown>) =>
    runCommand(() => {
      const port = ensureNumber("port", raw["port"]);
      runIntegrationsShow({ baseUrl: `http://${String(raw["bind"])}:${port}` });
    }),
  );

integrations
  .command("disable <target>")
  .description("Remove TokenShield config (currently: only 'shell')")
  .action((target: string) =>
    runCommand(() => runIntegrationsDisable(target as "shell" | IntegrationId)),
  );

// ── go ────────────────────────────────────────────────────────────────────────
program.parseAsync(process.argv).catch((err: unknown) => {
  // Anything not caught by runCommand wrappers
  if (isJson()) {
    process.stderr.write(JSON.stringify({ ok: false, error: { message: (err as Error)?.message ?? String(err) } }) + "\n");
  } else {
    emit((err as Error)?.message ?? String(err));
  }
  process.exit(1);
});
