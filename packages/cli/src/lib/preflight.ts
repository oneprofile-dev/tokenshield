import { createServer } from "node:net";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { URL } from "node:url";
import { TokenShieldError } from "./errors.js";

export interface PortStatus {
  port: number;
  available: boolean;
  detail?: string;
}

export function checkPort(port: number, host = "127.0.0.1"): Promise<PortStatus> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      resolve({
        port,
        available: false,
        detail: err.code === "EADDRINUSE" ? "address in use" : err.message,
      });
    });
    server.once("listening", () => {
      server.close(() => resolve({ port, available: true }));
    });
    server.listen(port, host);
  });
}

export interface UpstreamProbe {
  url: string;
  reachable: boolean;
  latencyMs?: number;
  status?: number;
  detail?: string;
}

export function probeUpstream(baseUrl: string, timeoutMs = 5000): Promise<UpstreamProbe> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL("/v1/messages", baseUrl);
    } catch (err) {
      resolve({
        url: baseUrl,
        reachable: false,
        detail: `invalid URL: ${(err as Error).message}`,
      });
      return;
    }
    const requester = parsed.protocol === "https:" ? httpsRequest : httpRequest;
    const startedAt = Date.now();
    const req = requester(
      {
        method: "POST",
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname,
        headers: { "content-type": "application/json", "content-length": "2" },
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        const latencyMs = Date.now() - startedAt;
        // Any 4xx/5xx is fine — proves the host is reachable & responding
        resolve({
          url: baseUrl,
          reachable: true,
          latencyMs,
          status: res.statusCode ?? 0,
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ url: baseUrl, reachable: false, detail: `timed out after ${timeoutMs}ms` });
    });
    req.on("error", (err) => {
      resolve({ url: baseUrl, reachable: false, detail: err.message });
    });
    req.write("{}");
    req.end();
  });
}

export function classifyApiKey(value: string | undefined): {
  state: "missing" | "wrong_prefix" | "ok";
  hint?: string;
} {
  if (!value || value.length === 0) {
    return {
      state: "missing",
      hint: "Set ANTHROPIC_API_KEY in the shell that runs Claude Code, NOT where you run tokenshield",
    };
  }
  if (!value.startsWith("sk-ant-")) {
    return {
      state: "wrong_prefix",
      hint: "Anthropic keys start with sk-ant- — make sure you copied the right key",
    };
  }
  return { state: "ok" };
}

/** Throws a structured error if the port is in use. */
export async function requirePortFree(port: number, label: string): Promise<void> {
  const r = await checkPort(port);
  if (!r.available) {
    throw new TokenShieldError({
      code: "PORT_IN_USE",
      message: `Port ${port} (${label}) is already in use`,
      hint: r.detail,
      nextSteps: [
        `lsof -nP -iTCP:${port} -sTCP:LISTEN     # see what's using it`,
        `tokenshield up --port <free-port>       # or pick a different port`,
      ],
    });
  }
}
