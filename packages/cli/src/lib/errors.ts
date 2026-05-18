import { c, errorLine, isDebug, isJson, emitJson, say } from "./ui.js";

export type ErrorCode =
  | "PORT_IN_USE"
  | "DAEMON_NOT_RUNNING"
  | "DAEMON_ALREADY_RUNNING"
  | "MISSING_API_KEY"
  | "BAD_API_KEY"
  | "MISSING_TOKEN"
  | "BAD_TOKEN"
  | "UPSTREAM_UNREACHABLE"
  | "BAD_CONFIG"
  | "INVALID_ARGUMENT"
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "INTERRUPTED"
  | "INTERNAL";

const EXIT_CODES: Record<ErrorCode, number> = {
  PORT_IN_USE: 10,
  DAEMON_NOT_RUNNING: 11,
  DAEMON_ALREADY_RUNNING: 12,
  MISSING_API_KEY: 20,
  BAD_API_KEY: 21,
  MISSING_TOKEN: 22,
  BAD_TOKEN: 23,
  UPSTREAM_UNREACHABLE: 30,
  BAD_CONFIG: 40,
  INVALID_ARGUMENT: 41,
  PERMISSION_DENIED: 50,
  NOT_FOUND: 51,
  INTERRUPTED: 130,
  INTERNAL: 1,
};

export class TokenShieldError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | undefined;
  readonly nextSteps: string[];
  readonly cause?: unknown;
  constructor(opts: {
    code: ErrorCode;
    message: string;
    hint?: string;
    nextSteps?: string[];
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = "TokenShieldError";
    this.code = opts.code;
    this.hint = opts.hint;
    this.nextSteps = opts.nextSteps ?? [];
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

export function exitCodeFor(err: unknown): number {
  if (err instanceof TokenShieldError) return EXIT_CODES[err.code] ?? 1;
  return 1;
}

export function reportAndExit(err: unknown): never {
  if (isJson()) {
    if (err instanceof TokenShieldError) {
      emitJson({
        ok: false,
        error: {
          code: err.code,
          message: err.message,
          hint: err.hint,
          nextSteps: err.nextSteps,
        },
      });
    } else if (err instanceof Error) {
      emitJson({
        ok: false,
        error: { code: "INTERNAL", message: err.message },
      });
    } else {
      emitJson({ ok: false, error: { code: "INTERNAL", message: String(err) } });
    }
    process.exit(exitCodeFor(err));
  }

  if (err instanceof TokenShieldError) {
    errorLine(err.message);
    if (err.hint) {
      process.stderr.write(`  ${c.gray("→")} ${c.gray(err.hint)}\n`);
    }
    if (err.nextSteps.length > 0) {
      process.stderr.write("\n  " + c.bold("Try:") + "\n");
      for (const step of err.nextSteps) {
        process.stderr.write(`    ${c.gray("$")} ${c.cyan(step)}\n`);
      }
      process.stderr.write("\n");
    }
    if (isDebug() && err.cause) {
      process.stderr.write(c.gray("[debug] cause:\n"));
      process.stderr.write(c.gray(String(err.cause)) + "\n");
    }
  } else if (err instanceof Error) {
    errorLine(err.message);
    if (isDebug() && err.stack) {
      process.stderr.write(c.gray(err.stack) + "\n");
    } else {
      process.stderr.write(c.gray("  → run with --debug for stack trace\n"));
    }
  } else {
    errorLine(String(err));
  }
  process.exit(exitCodeFor(err));
}

/**
 * Wrap an async command body so any thrown error is reported uniformly.
 * Always exits with the correct code; never returns.
 */
export async function runCommand<T>(fn: () => Promise<T> | T): Promise<void> {
  try {
    await fn();
  } catch (err) {
    reportAndExit(err);
  }
}

export function ensureNumber(name: string, raw: unknown, min = 1, max = 65535): number {
  const n = typeof raw === "string" ? parseInt(raw, 10) : (raw as number);
  if (!Number.isFinite(n) || Number.isNaN(n) || n < min || n > max) {
    throw new TokenShieldError({
      code: "INVALID_ARGUMENT",
      message: `Invalid value for ${name}: expected an integer between ${min} and ${max}, got ${String(raw)}`,
      hint: `Pass --${name} <number>`,
    });
  }
  return n;
}

// Install handlers for unhandled rejections / uncaught exceptions
let installed = false;
export function installProcessHandlers(): void {
  if (installed) return;
  installed = true;
  process.on("uncaughtException", (err) => {
    reportAndExit(err);
  });
  process.on("unhandledRejection", (err) => {
    reportAndExit(err);
  });
  process.on("SIGINT", () => {
    say("");
    process.exit(EXIT_CODES.INTERRUPTED);
  });
}
