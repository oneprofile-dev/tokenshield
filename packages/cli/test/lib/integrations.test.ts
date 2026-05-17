import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We can't easily inject the shell rc path; the public API uses ~/.zshrc etc.
// Test via TOKENSHIELD_HOME-style isolation: override HOME to a tmp dir, then
// call writeShellRc which uses os.homedir() under the hood.

async function withTempHome<T>(shell: string, fn: (home: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "ts-int-"));
  const prevHome = process.env["HOME"];
  const prevShell = process.env["SHELL"];
  process.env["HOME"] = dir;
  process.env["SHELL"] = shell;
  try {
    return await fn(dir);
  } finally {
    if (prevHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = prevHome;
    if (prevShell === undefined) delete process.env["SHELL"];
    else process.env["SHELL"] = prevShell;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("detectShell picks zsh + ~/.zshrc when SHELL=/bin/zsh", async () => {
  await withTempHome("/bin/zsh", async (home) => {
    const { detectShell } = await import("../../src/lib/integrations.js");
    const s = detectShell();
    assert.equal(s.shell, "zsh");
    assert.equal(s.rcPath, join(home, ".zshrc"));
    assert.equal(s.exportLine("FOO", "bar"), "export FOO=bar");
  });
});

test("detectShell picks fish + uses set -gx syntax", async () => {
  await withTempHome("/usr/local/bin/fish", async () => {
    const { detectShell } = await import("../../src/lib/integrations.js");
    const s = detectShell();
    assert.equal(s.shell, "fish");
    assert.equal(s.exportLine("FOO", "bar"), "set -gx FOO bar");
  });
});

test("writeShellRc creates rc when missing and adds managed block", async () => {
  await withTempHome("/bin/zsh", async (home) => {
    const { writeShellRc } = await import("../../src/lib/integrations.js");
    const result = writeShellRc({ baseUrl: "http://127.0.0.1:7777" });
    assert.equal(result.action, "added");
    assert.equal(result.shell, "zsh");
    const written = readFileSync(join(home, ".zshrc"), "utf8");
    assert.match(written, /# >>> tokenshield setup \(managed\) >>>/);
    assert.match(written, /export ANTHROPIC_BASE_URL=http:\/\/127\.0\.0\.1:7777/);
    assert.match(written, /# <<< tokenshield setup \(managed\) <<</);
  });
});

test("writeShellRc is idempotent when block matches exactly", async () => {
  await withTempHome("/bin/zsh", async () => {
    const { writeShellRc } = await import("../../src/lib/integrations.js");
    writeShellRc({ baseUrl: "http://127.0.0.1:7777" });
    const second = writeShellRc({ baseUrl: "http://127.0.0.1:7777" });
    assert.equal(second.action, "unchanged");
  });
});

test("writeShellRc updates existing managed block when URL changes", async () => {
  await withTempHome("/bin/zsh", async (home) => {
    const { writeShellRc } = await import("../../src/lib/integrations.js");
    writeShellRc({ baseUrl: "http://127.0.0.1:7777" });
    const updated = writeShellRc({ baseUrl: "http://127.0.0.1:9999" });
    assert.equal(updated.action, "updated");
    const file = readFileSync(join(home, ".zshrc"), "utf8");
    assert.match(file, /ANTHROPIC_BASE_URL=http:\/\/127\.0\.0\.1:9999/);
    assert.equal(file.match(/>>> tokenshield setup/g)?.length, 1, "exactly one marker block");
  });
});

test("writeShellRc preserves surrounding rc content", async () => {
  await withTempHome("/bin/zsh", async (home) => {
    const rc = join(home, ".zshrc");
    writeFileSync(rc, "alias gs='git status'\nexport EDITOR=vim\n");
    const { writeShellRc } = await import("../../src/lib/integrations.js");
    writeShellRc({ baseUrl: "http://127.0.0.1:7777" });
    const after = readFileSync(rc, "utf8");
    assert.match(after, /alias gs='git status'/);
    assert.match(after, /export EDITOR=vim/);
    assert.match(after, /ANTHROPIC_BASE_URL/);
  });
});

test("removeShellRc strips the managed block, leaves other lines", async () => {
  await withTempHome("/bin/zsh", async (home) => {
    const rc = join(home, ".zshrc");
    writeFileSync(rc, "alias gs='git status'\n");
    const { writeShellRc, removeShellRc } = await import("../../src/lib/integrations.js");
    writeShellRc({ baseUrl: "http://127.0.0.1:7777" });
    const result = removeShellRc();
    assert.equal(result.removed, true);
    const after = readFileSync(rc, "utf8");
    assert.match(after, /alias gs='git status'/);
    assert.doesNotMatch(after, /tokenshield/);
  });
});

test("removeShellRc returns removed:false when no block present", async () => {
  await withTempHome("/bin/zsh", async (home) => {
    const rc = join(home, ".zshrc");
    writeFileSync(rc, "alias gs='git status'\n");
    const { removeShellRc } = await import("../../src/lib/integrations.js");
    const result = removeShellRc();
    assert.equal(result.removed, false);
    // verify content unchanged
    assert.match(readFileSync(rc, "utf8"), /alias gs='git status'/);
  });
});

test("manualSnippet returns shell-tool-specific text", async () => {
  const { manualSnippet } = await import("../../src/lib/integrations.js");
  assert.match(manualSnippet("cursor", "http://127.0.0.1:7777"), /Anthropic API Base URL/);
  assert.match(manualSnippet("windsurf", "http://127.0.0.1:7777"), /Custom endpoint/);
  assert.match(manualSnippet("zed", "http://127.0.0.1:7777"), /assistant/);
});

// Suppress unused warnings for helpers test infra needs
void existsSync; void mkdirSync;
