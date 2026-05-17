import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { detectAll, writeShellRc, manualSnippet, type Integration } from "../lib/integrations.js";
import { spawnDaemon, readDaemon } from "../lib/daemon.js";
import { requirePortFree, classifyApiKey, probeUpstream } from "../lib/preflight.js";
import { defaultConfig } from "@curatedmcp/tokenshield-core";
import { c, sym, dim, emit, say, heading, spinner, box } from "../lib/ui.js";

export interface SetupOptions {
  port: number;
  dashboardPort: number;
  bind: string;
  upstream: string;
  retentionDays: number;
  yes: boolean;
}

async function ask(rl: ReturnType<typeof createInterface>, prompt: string, def: "y" | "n"): Promise<boolean> {
  const hint = def === "y" ? "(Y/n)" : "(y/N)";
  const ans = (await rl.question(`${prompt} ${dim(hint)} `)).trim().toLowerCase();
  if (ans === "") return def === "y";
  return ans === "y" || ans === "yes";
}

function recommendedTool(all: Integration[]): Integration | null {
  // Prefer Claude Code if it's installed; otherwise the first detected tool
  const cc = all.find((i) => i.id === "claude-code" && i.status === "detected");
  if (cc) return cc;
  return all.find((i) => i.status === "detected") ?? null;
}

export async function runSetup(opts: SetupOptions): Promise<void> {
  const rl = createInterface({ input, output });
  const baseUrl = `http://${opts.bind}:${opts.port}`;

  try {
    say("");
    say(c.bold("TokenShield setup") + dim("  — about 60 seconds, no signup, no telemetry"));
    say("");

    // Step 1: detect tools
    heading("1) Looking for AI tools to route through TokenShield");
    const all = detectAll();
    for (const i of all) {
      const status = i.status === "detected" ? c.green("found") : c.gray("not found");
      emit(`  ${i.status === "detected" ? sym.check : sym.bullet} ${i.name.padEnd(14)} ${status}  ${dim(i.detail)}`);
    }
    const target = recommendedTool(all);
    say("");
    if (target === null) {
      emit(`${sym.warn} We didn't find a known AI client on this machine.`);
      emit(dim("  Setup will continue, but you'll need to configure your tool manually."));
    } else {
      emit(`${sym.check} Recommended target: ${c.bold(target.name)}`);
    }

    // Step 2: preflight
    say("");
    heading("2) Checking the network");
    const portSpin = spinner(`Checking ports ${opts.port} and ${opts.dashboardPort}…`);
    try {
      await requirePortFree(opts.port, "proxy");
      await requirePortFree(opts.dashboardPort, "dashboard");
      portSpin.succeed(`Ports ${opts.port} and ${opts.dashboardPort} are free.`);
    } catch (err) {
      portSpin.fail("Port conflict.");
      throw err;
    }

    const upSpin = spinner(`Reaching ${opts.upstream}…`);
    const probe = await probeUpstream(opts.upstream);
    if (probe.reachable) {
      upSpin.succeed(`Anthropic reachable ${dim(`(${probe.latencyMs}ms, status ${probe.status})`)}`);
    } else {
      upSpin.fail(`Anthropic unreachable: ${probe.detail ?? "unknown"}`);
      emit(dim("  Setup will continue. You can re-run after fixing your network."));
    }

    // Step 3: API key sanity
    const keyState = classifyApiKey(process.env["ANTHROPIC_API_KEY"]);
    say("");
    heading("3) Checking your Anthropic API key");
    if (keyState.state === "ok") {
      emit(`${sym.check} ANTHROPIC_API_KEY is set in this shell. ${dim("(That's fine; you may also set it in the shell that runs Claude Code.)")}`);
    } else if (keyState.state === "wrong_prefix") {
      emit(`${sym.warn} ${keyState.hint}`);
    } else {
      emit(`${sym.info} ANTHROPIC_API_KEY isn't set in this shell.`);
      emit(dim("  That's expected — set it in the shell where you run Claude Code, not here."));
    }

    // Step 4: configure tool
    say("");
    heading("4) Configure your AI tool");
    let configuredVia: "shell-rc" | "manual-snippet" | null = null;
    if (target !== null && target.configureMethod === "shell-rc") {
      const ok = opts.yes ? true : await ask(rl, `Add ANTHROPIC_BASE_URL=${baseUrl} to your shell rc so ${target.name} uses TokenShield?`, "y");
      if (ok) {
        try {
          const result = writeShellRc({ baseUrl });
          emit(`${sym.check} ${target.name} configured via ${result.rcPath} ${dim(`(${result.action})`)}`);
          emit(dim(`  Reload: source ${result.rcPath}    (or open a new terminal)`));
          configuredVia = "shell-rc";
        } catch (err) {
          emit(`${sym.warn} Couldn't write shell rc: ${(err as Error).message}`);
          emit(dim(`  Add manually: export ANTHROPIC_BASE_URL=${baseUrl}`));
        }
      }
    } else if (target !== null && target.configureMethod === "manual-snippet") {
      emit(dim("  " + target.instructions));
      emit("");
      emit(box(manualSnippet(target.id, baseUrl), { title: `${target.name} config`, color: c.gray, padding: 1 }));
      configuredVia = "manual-snippet";
    } else {
      emit(dim(`  Set ANTHROPIC_BASE_URL=${baseUrl} in your AI tool's settings or shell.`));
    }

    // Step 5: start the proxy as a daemon
    say("");
    heading("5) Starting the proxy");
    const existing = readDaemon();
    if (existing !== null) {
      emit(`${sym.info} TokenShield is already running ${dim(`(pid ${existing.pid})`)}.`);
    } else {
      const proceed = opts.yes ? true : await ask(rl, "Start the proxy in the background now?", "y");
      if (proceed) {
        const spin = spinner("Starting daemon…");
        try {
          const cfg = defaultConfig();
          const info = await spawnDaemon({
            port: opts.port,
            dashboardPort: opts.dashboardPort,
            bind: opts.bind,
            upstream: opts.upstream,
            ledger: cfg.ledgerPath,
            retentionDays: opts.retentionDays,
          });
          spin.succeed(`Proxy live on http://${info.bind}:${info.port}`);
        } catch (err) {
          spin.fail((err as Error).message);
        }
      }
    }

    // Done
    say("");
    say(c.bold(`${sym.check} Setup complete.`));
    say("");
    say("  Dashboard:");
    say(`    ${c.cyan(`http://${opts.bind}:${opts.dashboardPort}`)}`);
    say("");
    say("  Useful commands:");
    say("    tokenshield status        # live spend + uptime");
    say("    tokenshield logs --limit 20");
    say("    tokenshield integrations list");
    say("    tokenshield stop          # stop the daemon");
    if (configuredVia === "shell-rc") {
      say("");
      say(dim("  Don't forget: open a new terminal (or `source` your rc) so ANTHROPIC_BASE_URL takes effect."));
    }
    say("");
  } finally {
    rl.close();
  }
}
