import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";

export type IntegrationId =
  | "claude-code"
  | "cursor"
  | "windsurf"
  | "zed"
  | "aider";

export type IntegrationStatus = "detected" | "not-found" | "unknown";

export type ConfigureMethod = "shell-rc" | "manual-snippet";

export interface Integration {
  id: IntegrationId;
  name: string;
  status: IntegrationStatus;
  detail: string;
  /**
   * How TokenShield can configure this tool:
   *  - "shell-rc": write to the user's shell rc file (Claude Code, Aider, etc.)
   *  - "manual-snippet": print a config snippet for the user to paste (Cursor, Windsurf, Zed)
   */
  configureMethod: ConfigureMethod;
  /** A short instruction body shown when configuring this tool. */
  instructions: string;
}

const MARKER_BEGIN = "# >>> tokenshield setup (managed) >>>";
const MARKER_END = "# <<< tokenshield setup (managed) <<<";

function exists(path: string): boolean {
  try { return existsSync(path); } catch { return false; }
}

function commandExists(cmd: string): boolean {
  try {
    execSync(process.platform === "win32" ? `where ${cmd}` : `command -v ${cmd}`, {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function appSupport(): string | null {
  const home = homedir();
  if (platform() === "darwin") return join(home, "Library", "Application Support");
  if (platform() === "linux") return join(home, ".config");
  if (platform() === "win32") return process.env["APPDATA"] ?? null;
  return null;
}

export function detectAll(): Integration[] {
  return [
    detectClaudeCode(),
    detectCursor(),
    detectWindsurf(),
    detectZed(),
    detectAider(),
  ];
}

export function detectClaudeCode(): Integration {
  const onPath = commandExists("claude");
  const dotDir = exists(join(homedir(), ".claude"));
  const status: IntegrationStatus = onPath || dotDir ? "detected" : "not-found";
  return {
    id: "claude-code",
    name: "Claude Code",
    status,
    detail: onPath
      ? "claude found on PATH"
      : dotDir
      ? `config dir at ${join(homedir(), ".claude")}`
      : "not found (install: npm i -g @anthropic-ai/claude-code)",
    configureMethod: "shell-rc",
    instructions:
      "Adds ANTHROPIC_BASE_URL to your shell rc so Claude Code routes through TokenShield. Reload your shell after.",
  };
}

export function detectCursor(): Integration {
  const support = appSupport();
  const cursorDir = support !== null ? join(support, "Cursor") : null;
  const detected =
    cursorDir !== null && (exists(cursorDir) || exists(join(cursorDir, "User", "settings.json")));
  return {
    id: "cursor",
    name: "Cursor",
    status: detected ? "detected" : "not-found",
    detail: detected ? `config at ${cursorDir}` : "not found",
    configureMethod: "manual-snippet",
    instructions:
      "Open Cursor → Settings → Models. Under 'Anthropic API Base URL' (or 'Override OpenAI Base URL' for GPT), paste the snippet below and click Verify.",
  };
}

export function detectWindsurf(): Integration {
  const support = appSupport();
  const dir = support !== null ? join(support, "Windsurf") : null;
  const detected = dir !== null && exists(dir);
  return {
    id: "windsurf",
    name: "Windsurf",
    status: detected ? "detected" : "not-found",
    detail: detected ? `config at ${dir}` : "not found",
    configureMethod: "manual-snippet",
    instructions:
      "Open Windsurf → Settings → Models. Set the custom Anthropic endpoint to the snippet below.",
  };
}

export function detectZed(): Integration {
  const support = appSupport();
  const dir = support !== null ? join(support, "Zed") : null;
  const detected = dir !== null && exists(dir);
  return {
    id: "zed",
    name: "Zed",
    status: detected ? "detected" : "not-found",
    detail: detected ? `config at ${dir}` : "not found",
    configureMethod: "manual-snippet",
    instructions:
      "Edit ~/.config/zed/settings.json and add the assistant.anthropic_api_url key.",
  };
}

export function detectAider(): Integration {
  const onPath = commandExists("aider");
  return {
    id: "aider",
    name: "Aider",
    status: onPath ? "detected" : "not-found",
    detail: onPath ? "aider found on PATH" : "not found",
    configureMethod: "shell-rc",
    instructions:
      "Adds ANTHROPIC_BASE_URL to your shell rc. Aider's Anthropic mode will route through TokenShield automatically.",
  };
}

export interface ShellInfo {
  shell: "bash" | "zsh" | "fish" | "unknown";
  rcPath: string | null;
  exportLine: (key: string, value: string) => string;
}

export function detectShell(): ShellInfo {
  const shellEnv = process.env["SHELL"] ?? "";
  const base = shellEnv.split("/").pop() ?? "";
  const home = homedir();
  if (base === "zsh") {
    return {
      shell: "zsh",
      rcPath: join(home, ".zshrc"),
      exportLine: (k, v) => `export ${k}=${v}`,
    };
  }
  if (base === "bash") {
    // macOS terminals usually read .bash_profile for login shells; linux reads .bashrc
    const rc = platform() === "darwin" ? join(home, ".bash_profile") : join(home, ".bashrc");
    return {
      shell: "bash",
      rcPath: rc,
      exportLine: (k, v) => `export ${k}=${v}`,
    };
  }
  if (base === "fish") {
    return {
      shell: "fish",
      rcPath: join(home, ".config", "fish", "config.fish"),
      exportLine: (k, v) => `set -gx ${k} ${v}`,
    };
  }
  return { shell: "unknown", rcPath: null, exportLine: (k, v) => `export ${k}=${v}` };
}

export interface ConfigureParams {
  baseUrl: string; // e.g. http://127.0.0.1:7777
}

export interface ShellRcResult {
  rcPath: string;
  shell: ShellInfo["shell"];
  action: "added" | "updated" | "unchanged";
  block: string;
}

/** Idempotently writes a managed marker block to the user's shell rc. */
export function writeShellRc(params: ConfigureParams): ShellRcResult {
  const shell = detectShell();
  if (shell.rcPath === null) {
    throw new Error(
      "Unknown shell — set ANTHROPIC_BASE_URL manually in your shell's startup file.",
    );
  }
  const exportLine = shell.exportLine("ANTHROPIC_BASE_URL", params.baseUrl);
  const block = `${MARKER_BEGIN}\n${exportLine}\n${MARKER_END}`;

  if (!exists(shell.rcPath)) {
    mkdirSync(dirname(shell.rcPath), { recursive: true });
    writeFileSync(shell.rcPath, block + "\n", { mode: 0o600 });
    return { rcPath: shell.rcPath, shell: shell.shell, action: "added", block };
  }

  const current = readFileSync(shell.rcPath, "utf8");
  const beginIdx = current.indexOf(MARKER_BEGIN);
  if (beginIdx === -1) {
    const sep = current.endsWith("\n") ? "" : "\n";
    writeFileSync(shell.rcPath, current + sep + "\n" + block + "\n");
    return { rcPath: shell.rcPath, shell: shell.shell, action: "added", block };
  }
  const endIdx = current.indexOf(MARKER_END, beginIdx);
  if (endIdx === -1) {
    throw new Error(
      `${shell.rcPath} contains an unclosed tokenshield marker. Edit manually and remove it.`,
    );
  }
  const before = current.slice(0, beginIdx);
  const after = current.slice(endIdx + MARKER_END.length);
  // Detect no-op rewrite
  const oldBlock = current.slice(beginIdx, endIdx + MARKER_END.length);
  if (oldBlock === block) {
    return { rcPath: shell.rcPath, shell: shell.shell, action: "unchanged", block };
  }
  writeFileSync(shell.rcPath, before + block + after);
  return { rcPath: shell.rcPath, shell: shell.shell, action: "updated", block };
}

export interface ShellRcRemoveResult {
  rcPath: string | null;
  removed: boolean;
}

export function removeShellRc(): ShellRcRemoveResult {
  const shell = detectShell();
  if (shell.rcPath === null || !exists(shell.rcPath)) {
    return { rcPath: shell.rcPath, removed: false };
  }
  const current = readFileSync(shell.rcPath, "utf8");
  const beginIdx = current.indexOf(MARKER_BEGIN);
  if (beginIdx === -1) return { rcPath: shell.rcPath, removed: false };
  const endIdx = current.indexOf(MARKER_END, beginIdx);
  if (endIdx === -1) return { rcPath: shell.rcPath, removed: false };
  // Also strip the leading newline if present
  let cleaned = current.slice(0, beginIdx) + current.slice(endIdx + MARKER_END.length);
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  writeFileSync(shell.rcPath, cleaned);
  return { rcPath: shell.rcPath, removed: true };
}

/** Snippet body for tools we don't auto-configure. */
export function manualSnippet(id: IntegrationId, baseUrl: string): string {
  switch (id) {
    case "cursor":
      return `Anthropic API Base URL: ${baseUrl}\n(Settings → Models → expand Anthropic provider → Override base URL)`;
    case "windsurf":
      return `Anthropic endpoint: ${baseUrl}\n(Settings → Models → Anthropic → Custom endpoint)`;
    case "zed":
      return `Edit ~/.config/zed/settings.json:\n{\n  "assistant": {\n    "provider": "anthropic",\n    "anthropic_api_url": "${baseUrl}"\n  }\n}`;
    default:
      return `Set ANTHROPIC_BASE_URL=${baseUrl} in this app's settings or shell.`;
  }
}
