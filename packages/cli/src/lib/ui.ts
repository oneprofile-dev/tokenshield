// Lightweight UI primitives. No dependencies — just ANSI escapes.
// Honors NO_COLOR, TERM=dumb, and non-TTY output (CI, pipes).

const RAW_FORCE_COLOR = process.env["FORCE_COLOR"];
const RAW_NO_COLOR = process.env["NO_COLOR"];
const RAW_TERM = process.env["TERM"];

function shouldUseColor(stream: NodeJS.WriteStream): boolean {
  if (RAW_FORCE_COLOR && RAW_FORCE_COLOR !== "0" && RAW_FORCE_COLOR !== "false") return true;
  if (RAW_NO_COLOR !== undefined && RAW_NO_COLOR !== "") return false;
  if (RAW_TERM === "dumb") return false;
  return Boolean(stream.isTTY);
}

const STDOUT_COLOR = shouldUseColor(process.stdout);
const STDERR_COLOR = shouldUseColor(process.stderr);

function wrap(open: string, close: string) {
  return (s: string) => (STDOUT_COLOR ? `\x1b[${open}m${s}\x1b[${close}m` : s);
}

export const c = {
  reset: "\x1b[0m",
  bold: wrap("1", "22"),
  dim: wrap("2", "22"),
  italic: wrap("3", "23"),
  underline: wrap("4", "24"),
  inverse: wrap("7", "27"),
  black: wrap("30", "39"),
  red: wrap("31", "39"),
  green: wrap("32", "39"),
  yellow: wrap("33", "39"),
  blue: wrap("34", "39"),
  magenta: wrap("35", "39"),
  cyan: wrap("36", "39"),
  white: wrap("37", "39"),
  gray: wrap("90", "39"),
  brightGreen: wrap("92", "39"),
  brightYellow: wrap("93", "39"),
  brightCyan: wrap("96", "39"),
};

export function stripAnsi(s: string): string {
  return s.replace(
    // eslint-disable-next-line no-control-regex
    /[][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PRZcf-nqry=><]/g,
    "",
  );
}

// OSC 8 hyperlink — supported by iTerm2, Kitty, modern VSCode terminal, Wezterm, etc.
// Falls back to plain text + the URL in parens for terminals that don't render.
const HYPERLINK_OK =
  STDOUT_COLOR &&
  // crude allow-list; safer to assume unsupported than break the layout
  (process.env["TERM_PROGRAM"] === "iTerm.app" ||
    process.env["TERM_PROGRAM"] === "WezTerm" ||
    process.env["TERM_PROGRAM"] === "vscode" ||
    process.env["KITTY_WINDOW_ID"] !== undefined ||
    process.env["WT_SESSION"] !== undefined);

export function link(text: string, url: string): string {
  if (HYPERLINK_OK) {
    return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
  }
  return text === url ? text : `${text} (${url})`;
}

export const sym = {
  check: STDOUT_COLOR ? c.green("✔") : "ok",
  cross: STDOUT_COLOR ? c.red("✗") : "x",
  warn: STDOUT_COLOR ? c.yellow("⚠") : "!",
  info: STDOUT_COLOR ? c.cyan("ℹ") : "i",
  arrow: STDOUT_COLOR ? c.gray("→") : "->",
  bullet: STDOUT_COLOR ? c.gray("•") : "*",
  dot: STDOUT_COLOR ? c.green("●") : "*",
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
};

export function indent(text: string, n: number): string {
  const pad = " ".repeat(n);
  return text
    .split("\n")
    .map((l) => (l.length > 0 ? pad + l : l))
    .join("\n");
}

export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    if (para === "") {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of para.split(/\s+/)) {
      if (current.length === 0) {
        current = word;
      } else if (current.length + word.length + 1 <= width) {
        current += " " + word;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current.length > 0) lines.push(current);
  }
  return lines;
}

export interface BoxOptions {
  title?: string;
  padding?: number;
  width?: number;
  color?: (s: string) => string;
}

export function box(content: string, opts: BoxOptions = {}): string {
  const pad = opts.padding ?? 1;
  const color = opts.color ?? c.gray;
  const lines = content.split("\n");
  const longest = Math.max(
    opts.title ? stripAnsi(opts.title).length + 2 : 0,
    ...lines.map((l) => stripAnsi(l).length),
  );
  const innerWidth = (opts.width ?? longest) + pad * 2;
  const top = opts.title
    ? color("┌─ ") + c.bold(opts.title) + " " + color("─".repeat(Math.max(0, innerWidth - stripAnsi(opts.title).length - 4))) + color("┐")
    : color("┌" + "─".repeat(innerWidth) + "┐");
  const bottom = color("└" + "─".repeat(innerWidth) + "┘");
  const padded = lines.map((l) => {
    const visibleLen = stripAnsi(l).length;
    const right = " ".repeat(Math.max(0, innerWidth - pad * 2 - visibleLen));
    return color("│") + " ".repeat(pad) + l + right + " ".repeat(pad) + color("│");
  });
  return [top, ...padded, bottom].join("\n");
}

// Tiny live-updating spinner. Use only on TTY; on non-TTY it just prints the label once.
export function spinner(label: string): { tick: (newLabel?: string) => void; succeed: (final?: string) => void; fail: (final?: string) => void; stop: () => void } {
  if (!process.stdout.isTTY) {
    process.stdout.write(label + "\n");
    return { tick: () => {}, succeed: () => {}, fail: () => {}, stop: () => {} };
  }
  let frame = 0;
  let current = label;
  let active = true;
  const draw = () => {
    if (!active) return;
    const ch = sym.spinner[frame % sym.spinner.length];
    process.stdout.write(`\r${c.cyan(ch!)} ${current}   \x1b[K`);
    frame++;
  };
  const interval = setInterval(draw, 80);
  draw();
  return {
    tick: (newLabel?: string) => {
      if (newLabel !== undefined) current = newLabel;
    },
    succeed: (final?: string) => {
      active = false;
      clearInterval(interval);
      process.stdout.write(`\r${sym.check} ${final ?? current}   \x1b[K\n`);
    },
    fail: (final?: string) => {
      active = false;
      clearInterval(interval);
      process.stdout.write(`\r${sym.cross} ${final ?? current}   \x1b[K\n`);
    },
    stop: () => {
      active = false;
      clearInterval(interval);
      process.stdout.write("\r\x1b[K");
    },
  };
}

export function table(rows: string[][], opts: { header?: string[]; pad?: number } = {}): string {
  const all = opts.header ? [opts.header, ...rows] : rows;
  const cols = Math.max(...all.map((r) => r.length));
  const widths: number[] = [];
  for (let i = 0; i < cols; i++) {
    widths.push(Math.max(...all.map((r) => stripAnsi(r[i] ?? "").length)));
  }
  const pad = opts.pad ?? 2;
  const fmt = (r: string[]): string =>
    r
      .map((cell, i) => {
        const w = widths[i] ?? 0;
        const visible = stripAnsi(cell).length;
        return cell + " ".repeat(Math.max(0, w - visible));
      })
      .join(" ".repeat(pad));
  const out: string[] = [];
  if (opts.header) {
    out.push(c.gray(c.bold(fmt(opts.header))));
  }
  for (const r of rows) out.push(fmt(r));
  return out.join("\n");
}

// Output helpers that respect --quiet / --debug
export interface OutputOptions {
  quiet: boolean;
  debug: boolean;
  json: boolean;
}
let opts: OutputOptions = { quiet: false, debug: false, json: false };

export function setOutputMode(next: Partial<OutputOptions>): void {
  opts = { ...opts, ...next };
}
export function isQuiet(): boolean { return opts.quiet; }
export function isDebug(): boolean { return opts.debug; }
export function isJson(): boolean { return opts.json; }

export function say(s: string): void {
  if (opts.json || opts.quiet) return;
  process.stdout.write(s.endsWith("\n") ? s : s + "\n");
}
export function emit(s: string): void {
  // Always print, even in quiet — for command output that user explicitly asked for
  if (opts.json) return;
  process.stdout.write(s.endsWith("\n") ? s : s + "\n");
}
export function emitJson(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}
export function warn(s: string): void {
  if (opts.json) return;
  const line = STDERR_COLOR ? `${sym.warn} ${s}` : `WARN: ${s}`;
  process.stderr.write(line + "\n");
}
export function debug(s: string): void {
  if (!opts.debug || opts.json) return;
  process.stderr.write(c.gray(`[debug] ${s}`) + "\n");
}
export function errorLine(s: string): void {
  const line = STDERR_COLOR ? `${sym.cross} ${c.red(s)}` : `ERROR: ${s}`;
  process.stderr.write(line + "\n");
}

// Convenience headings used by command output
export function heading(s: string): void { say("\n" + c.bold(s) + "\n"); }
export function dim(s: string): string { return c.dim(s); }
