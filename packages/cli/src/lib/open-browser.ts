import { spawn } from "node:child_process";

/**
 * Open a URL in the user's default browser. Cross-platform, best-effort.
 * Errors are swallowed — failing to open a browser must never break the CLI.
 */
export function openBrowser(url: string): void {
  if (process.env["TOKENSHIELD_NO_OPEN"] === "1") return;
  if (process.env["CI"] === "true") return;
  if (!process.stdout.isTTY) return; // headless / piped output

  let command: string;
  let args: string[];

  switch (process.platform) {
    case "darwin":
      command = "open";
      args = [url];
      break;
    case "win32":
      command = "cmd";
      args = ["/c", "start", "", url];
      break;
    default:
      // linux / freebsd / etc. — xdg-open is the de facto standard.
      command = "xdg-open";
      args = [url];
      break;
  }

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {
      // Browser didn't open — not fatal.
    });
    child.unref();
  } catch {
    // Spawn failed — silently move on.
  }
}
