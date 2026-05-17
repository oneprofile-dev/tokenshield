import { stopDaemon, readDaemon } from "../lib/daemon.js";
import { c, sym, emit, emitJson, isJson, dim } from "../lib/ui.js";
import { TokenShieldError } from "../lib/errors.js";

export async function runStop(): Promise<void> {
  const info = readDaemon();
  if (info === null) {
    if (isJson()) {
      emitJson({ ok: true, stopped: null });
      return;
    }
    throw new TokenShieldError({
      code: "DAEMON_NOT_RUNNING",
      message: "No TokenShield daemon is running.",
      hint: "Nothing to stop. Start one with `tokenshield up --daemon`.",
    });
  }
  const stopped = await stopDaemon();
  if (isJson()) {
    emitJson({ ok: true, stopped });
    return;
  }
  emit(`${sym.check} Stopped TokenShield ${dim(`(pid ${stopped?.pid ?? info.pid})`)}`);
  emit(dim(`  proxy was on port ${stopped?.port ?? info.port}, dashboard ${stopped?.dashboardPort ?? info.dashboardPort}`));
  // Silence unused-symbol lint
  void c;
}
