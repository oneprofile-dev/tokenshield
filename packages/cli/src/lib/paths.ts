import { homedir } from "node:os";
import { join } from "node:path";

export function tokenshieldHome(): string {
  return process.env["TOKENSHIELD_HOME"] ?? join(homedir(), ".tokenshield");
}
export function pidFile(): string {
  return join(tokenshieldHome(), "proxy.pid");
}
export function logFile(): string {
  return join(tokenshieldHome(), "proxy.log");
}
export function ledgerPath(): string {
  return join(tokenshieldHome(), "ledger.db");
}
export function configFile(): string {
  return join(tokenshieldHome(), "config.json");
}
