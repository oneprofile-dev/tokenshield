import { start, defaultConfig } from "@curatedmcp/tokenshield-core";
import type { ProxyConfig } from "@curatedmcp/tokenshield-core";
import { dashboardHtml } from "../dashboard.js";
import { VERSION } from "../version.js";
import { c, sym, box, link, say, emit, dim } from "../lib/ui.js";
import { firstRunBanner, isFirstRun, markFirstRunComplete, telemetry } from "@curatedmcp/tokenshield-core";
import { TokenShieldError } from "../lib/errors.js";
import { refreshLicense } from "../lib/license.js";
import { requirePortFree, classifyApiKey } from "../lib/preflight.js";
import { readDaemon, spawnDaemon } from "../lib/daemon.js";
import { logFile } from "../lib/paths.js";
import { openBrowser } from "../lib/open-browser.js";

export interface UpOptions {
  port: number;
  dashboardPort: number;
  bind: string;
  upstream: string;
  openaiUpstream: string;
  ledger?: string;
  retentionDays: number;
  daemon: boolean;
  open?: boolean;
}

function banner(config: ProxyConfig, opts: { daemon: boolean; logPath?: string }): string {
  const proxyUrl = `http://${config.bind}:${config.port}`;
  const dashUrl = `http://${config.bind}:${config.dashboardPort}`;
  const lines: string[] = [];
  lines.push(c.brightGreen("TokenShield is live") + dim(opts.daemon ? "  (daemon mode)" : ""));
  lines.push("");
  lines.push(`${sym.dot} Proxy      ${link(proxyUrl, proxyUrl)}`);
  lines.push(`${sym.dot} Dashboard  ${link(dashUrl, dashUrl)}`);
  lines.push(`${sym.dot} Upstream   ${dim(config.upstreamBaseUrl)}`);
  lines.push(`${sym.dot} OpenAI     ${dim(config.openaiUpstreamBaseUrl)}`);
  lines.push(`${sym.dot} Ledger     ${dim(config.ledgerPath)}`);
  if (opts.logPath) {
    lines.push(`${sym.dot} Log        ${dim(opts.logPath)}`);
  }
  lines.push("");
  lines.push(c.bold("Point Claude Code at the proxy:"));
  lines.push(`  ${c.cyan("export ANTHROPIC_BASE_URL=" + proxyUrl)}`);
  lines.push("");
  lines.push(c.bold("Point Codex/OpenAI at the proxy:"));
  lines.push(`  ${c.cyan(`openai_base_url = "${proxyUrl}"`)} ${dim("in ~/.codex/config.toml")}`);
  lines.push("");
  lines.push(dim("Your API keys never leave this machine."));
  if (!opts.daemon) {
    lines.push(dim("Press Ctrl-C to stop."));
  } else {
    lines.push(dim("Run `tokenshield stop` when you're done."));
  }
  return box(lines.join("\n"), { color: c.gray, padding: 2 });
}

function maybeWarnAboutLocalKey(): void {
  const key = process.env["ANTHROPIC_API_KEY"];
  const cls = classifyApiKey(key);
  if (cls.state === "missing") {
    // Not fatal — the user runs Claude Code in a DIFFERENT shell. Just inform.
    say("");
    say(`${sym.info} ANTHROPIC_API_KEY is not set in this shell.`);
    say(dim("  That's fine — set it in the shell that runs Claude Code, not here."));
  } else if (cls.state === "wrong_prefix") {
    say("");
    say(`${sym.warn} ANTHROPIC_API_KEY in this shell doesn't look like an Anthropic key.`);
    say(dim(`  ${cls.hint}`));
  }
}

export async function runUp(options: UpOptions): Promise<void> {
  const config: ProxyConfig = defaultConfig({
    port: options.port,
    dashboardPort: options.dashboardPort,
    bind: options.bind,
    upstreamBaseUrl: options.upstream,
    openaiUpstreamBaseUrl: options.openaiUpstream,
    ...(options.ledger ? { ledgerPath: options.ledger } : {}),
    retentionDays: options.retentionDays,
  });

  // Preflight: don't fail mysteriously inside server.listen()
  if (config.bind === "127.0.0.1" || config.bind === "localhost") {
    await requirePortFree(config.port, "proxy");
    await requirePortFree(config.dashboardPort, "dashboard");
  }

  // Bind-other warning
  if (config.bind !== "127.0.0.1" && config.bind !== "localhost") {
    say("");
    say(`${sym.warn} Binding to ${c.bold(config.bind)} — proxy is reachable beyond localhost.`);
    say(dim("  Only do this on a trusted network. Starting in 3 seconds (Ctrl-C to abort)."));
    await new Promise((r) => setTimeout(r, 3000));
  }

  if (options.daemon) {
    const existing = readDaemon();
    if (existing !== null) {
      throw new TokenShieldError({
        code: "DAEMON_ALREADY_RUNNING",
        message: `TokenShield is already running (pid ${existing.pid}, port ${existing.port}).`,
        nextSteps: ["tokenshield status", "tokenshield stop"],
      });
    }
    const info = await spawnDaemon({
      port: config.port,
      dashboardPort: config.dashboardPort,
      bind: config.bind,
      upstream: config.upstreamBaseUrl,
      openaiUpstream: config.openaiUpstreamBaseUrl,
      ledger: config.ledgerPath,
      retentionDays: config.retentionDays,
    });
    emit(banner(config, { daemon: true, logPath: logFile() }));
    say("");
    say(`${sym.check} Started as daemon ${dim(`(pid ${info.pid})`)}.`);
    return;
  }

  // Refresh license before binding ports — best-effort, won't fail boot
  const license = await refreshLicense();
  const tier = license?.tier === "pro" || license?.tier === "team" ? license.tier : "free";

  // Foreground mode
  const handle = await start({
    config,
    renderDashboard: () => dashboardHtml({
      proxyPort: config.port,
      bind: config.bind,
      version: VERSION,
      tier,
      email: license?.email,
    }),
  });

  emit(banner(config, { daemon: false }));
  if (license) {
    say(`${sym.check} Licensed as ${c.bold(license.email ?? "unknown")} · tier: ${c.brightGreen(tier.toUpperCase())}`);
  }
  maybeWarnAboutLocalKey();

  if (isFirstRun()) {
    emit(firstRunBanner());
    markFirstRunComplete();
  }

  telemetry.start();

  // Auto-open dashboard on first run, or whenever --open is set. Skip in
  // daemon mode (handled separately), CI, or when stdout isn't a TTY.
  if (options.open !== false) {
    const dashUrl = `http://${config.bind === "0.0.0.0" ? "127.0.0.1" : config.bind}:${config.dashboardPort}`;
    say("");
    say(`${sym.arrow} Opening dashboard in your browser… ${dim("(disable with --no-open)")}`);
    openBrowser(dashUrl);
  }

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    say("");
    say(`${sym.arrow} Caught ${signal}, shutting down…`);
    handle
      .close()
      .then(() => {
        say(`${sym.check} Stopped cleanly.`);
        process.exit(0);
      })
      .catch((err: unknown) => {
        say(`${sym.cross} shutdown error: ${(err as Error).message}`);
        process.exit(1);
      });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

/**
 * Internal: the entrypoint a detached daemon process invokes.
 * Does NOT print the banner — output goes to ~/.tokenshield/proxy.log.
 */
export async function runSupervised(options: UpOptions): Promise<void> {
  const config: ProxyConfig = defaultConfig({
    port: options.port,
    dashboardPort: options.dashboardPort,
    bind: options.bind,
    upstreamBaseUrl: options.upstream,
    openaiUpstreamBaseUrl: options.openaiUpstream,
    ...(options.ledger ? { ledgerPath: options.ledger } : {}),
    retentionDays: options.retentionDays,
  });
  // Refresh license in daemon too (best-effort)
  const supLicense = await refreshLicense();
  const supTier = supLicense?.tier === "pro" || supLicense?.tier === "team" ? supLicense.tier : "free";
  const handle = await start({
    config,
    renderDashboard: () => dashboardHtml({
      proxyPort: config.port,
      bind: config.bind,
      version: VERSION,
      tier: supTier,
      email: supLicense?.email,
    }),
  });
  const shutdown = async (signal: string): Promise<void> => {
    process.stderr.write(`[tokenshield] caught ${signal}, shutting down\n`);
    await handle.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.on("SIGINT", () => { void shutdown("SIGINT"); });
}
