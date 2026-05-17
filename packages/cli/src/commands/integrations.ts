import {
  detectAll,
  manualSnippet,
  writeShellRc,
  removeShellRc,
  type Integration,
  type IntegrationId,
} from "../lib/integrations.js";
import { c, sym, dim, emit, emitJson, isJson, table, heading, box } from "../lib/ui.js";
import { TokenShieldError } from "../lib/errors.js";

const KNOWN_IDS: IntegrationId[] = ["claude-code", "cursor", "windsurf", "zed", "aider"];

function statusLabel(s: Integration["status"]): string {
  if (s === "detected") return c.green("detected");
  if (s === "not-found") return c.gray("not found");
  return c.yellow("unknown");
}

export interface IntegrationsListOptions {
  baseUrl: string;
}
export function runIntegrationsList(opts: IntegrationsListOptions): void {
  const all = detectAll();
  if (isJson()) {
    emitJson({ ok: true, baseUrl: opts.baseUrl, integrations: all });
    return;
  }
  heading("AI tools we can route through TokenShield");
  emit("");
  emit(table(
    all.map((i) => [
      "  " + c.bold(i.name),
      statusLabel(i.status),
      i.configureMethod === "shell-rc" ? c.cyan("env via shell rc") : c.cyan("paste snippet"),
      dim(i.detail),
    ]),
    { header: ["  Tool", "Status", "Setup", "Detail"] },
  ));
  emit("");
  emit(dim(`  Configure one:    tokenshield integrations enable <tool>`));
  emit(dim(`  Show all manual:  tokenshield integrations show`));
  emit(dim(`  Remove env:       tokenshield integrations disable shell`));
  emit("");
}

export interface IntegrationsEnableOptions {
  id: IntegrationId;
  baseUrl: string;
}

export function runIntegrationsEnable(opts: IntegrationsEnableOptions): void {
  if (!KNOWN_IDS.includes(opts.id)) {
    throw new TokenShieldError({
      code: "INVALID_ARGUMENT",
      message: `Unknown integration: ${opts.id}`,
      hint: `Pick one of: ${KNOWN_IDS.join(", ")}`,
      nextSteps: ["tokenshield integrations list"],
    });
  }
  const all = detectAll();
  const target = all.find((i) => i.id === opts.id);
  if (target === undefined) {
    throw new TokenShieldError({ code: "INTERNAL", message: "integration definition not found" });
  }
  if (target.configureMethod === "shell-rc") {
    let result;
    try {
      result = writeShellRc({ baseUrl: opts.baseUrl });
    } catch (err) {
      throw new TokenShieldError({
        code: "PERMISSION_DENIED",
        message: `Failed to write to your shell rc: ${(err as Error).message}`,
        nextSteps: [`echo 'export ANTHROPIC_BASE_URL=${opts.baseUrl}' >> ~/.zshrc`],
      });
    }
    if (isJson()) {
      emitJson({ ok: true, integration: target.id, result });
      return;
    }
    emit("");
    emit(`${sym.check} ${c.bold(target.name)} configured.`);
    emit("");
    emit(dim(`  Wrote managed block to:  ${result.rcPath}`));
    emit(dim(`  Shell detected:          ${result.shell}`));
    emit(dim(`  Action:                  ${result.action}`));
    emit("");
    emit(`${sym.warn} Reload your shell so the variable is picked up:`);
    emit(`  ${c.cyan(`source ${result.rcPath}`)}`);
    emit(dim("  …or just open a new terminal."));
    emit("");
    return;
  }
  // manual-snippet path
  const snippet = manualSnippet(opts.id, opts.baseUrl);
  if (isJson()) {
    emitJson({ ok: true, integration: target.id, method: "manual-snippet", snippet });
    return;
  }
  emit("");
  emit(`${sym.info} ${c.bold(target.name)} — manual config required`);
  emit("");
  emit(dim("  " + target.instructions));
  emit("");
  emit(box(snippet, { title: `${target.name} config`, color: c.gray, padding: 1 }));
  emit("");
}

export function runIntegrationsShow(opts: { baseUrl: string }): void {
  const all = detectAll();
  if (isJson()) {
    emitJson({
      ok: true,
      baseUrl: opts.baseUrl,
      snippets: all.map((i) => ({
        id: i.id,
        method: i.configureMethod,
        instructions: i.instructions,
        snippet:
          i.configureMethod === "shell-rc"
            ? `export ANTHROPIC_BASE_URL=${opts.baseUrl}`
            : manualSnippet(i.id, opts.baseUrl),
      })),
    });
    return;
  }
  for (const i of all) {
    emit("");
    emit(c.bold(`■ ${i.name}`) + "   " + statusLabel(i.status));
    emit(dim("  " + i.instructions));
    emit("");
    const snippet =
      i.configureMethod === "shell-rc"
        ? `export ANTHROPIC_BASE_URL=${opts.baseUrl}`
        : manualSnippet(i.id, opts.baseUrl);
    emit(box(snippet, { color: c.gray, padding: 1 }));
  }
  emit("");
}

export function runIntegrationsDisable(target: "shell" | IntegrationId): void {
  if (target !== "shell") {
    throw new TokenShieldError({
      code: "INVALID_ARGUMENT",
      message: `Only 'shell' can be disabled automatically (manual-snippet tools can't be auto-reverted).`,
      hint: "For Cursor / Windsurf, remove the base URL in their settings UI.",
    });
  }
  const result = removeShellRc();
  if (isJson()) {
    emitJson({ ok: true, result });
    return;
  }
  if (!result.removed) {
    emit(`${sym.info} No managed TokenShield block found in ${result.rcPath ?? "your shell rc"}.`);
    return;
  }
  emit(`${sym.check} Removed managed block from ${dim(result.rcPath ?? "")}.`);
  emit(dim("  Reload your shell or open a new terminal."));
}
