import {
  isTelemetryEnabled,
  setTelemetryEnabled,
  getAnonId,
  firstRunBanner,
} from "@curatedmcp/tokenshield-core";
import { c, dim, emit, emitJson, isJson } from "../lib/ui.js";

export interface TelemetryOptions {
  action: "on" | "off" | "status" | "show";
}

export async function runTelemetry(opts: TelemetryOptions): Promise<void> {
  switch (opts.action) {
    case "on": {
      setTelemetryEnabled(true);
      if (isJson()) {
        emitJson({ ok: true, telemetry: "on" });
      } else {
        emit(c.green("✓") + " TokenShield telemetry enabled.");
        emit(dim("  Anonymous aggregate counters only — see `tokenshield telemetry show`."));
      }
      return;
    }
    case "off": {
      setTelemetryEnabled(false);
      if (isJson()) {
        emitJson({ ok: true, telemetry: "off" });
      } else {
        emit(c.green("✓") + " TokenShield telemetry disabled.");
        emit(dim("  No data will be sent. Re-enable with `tokenshield telemetry on`."));
      }
      return;
    }
    case "status": {
      const on = isTelemetryEnabled();
      if (isJson()) {
        emitJson({ ok: true, telemetry: on ? "on" : "off", anonId: getAnonId() });
      } else {
        emit(`TokenShield telemetry: ${on ? c.green("on") : c.bold("off")}`);
        emit(dim(`  anonId: ${getAnonId().slice(0, 16)}…`));
        emit(dim(`  endpoint: ${process.env["TOKENSHIELD_TELEMETRY_URL"] ?? "https://curatedmcp.com/api/v1/tokenshield/telemetry"}`));
      }
      return;
    }
    case "show": {
      // Show exactly what gets sent — the privacy contract.
      emit(firstRunBanner());
      return;
    }
  }
}
