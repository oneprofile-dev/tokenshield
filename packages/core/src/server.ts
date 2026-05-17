import { createServer, IncomingMessage, ServerResponse, Server } from "node:http";
import type { ProxyConfig, RequestRecord } from "./types.js";
import { handleAnthropicRequest } from "./proxy/anthropic-passthrough.js";
import { Ledger } from "./ledger.js";
import { telemetry } from "./telemetry.js";

export interface ProxyServerHandle {
  proxy: Server;
  dashboard: Server;
  ledger: Ledger;
  close: () => Promise<void>;
}

type DashboardRenderer = (ledger: Ledger) => string;

export interface StartOptions {
  config: ProxyConfig;
  onRecord?: (r: RequestRecord) => void;
  renderDashboard?: DashboardRenderer;
}

export function defaultConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? ".";
  return {
    upstreamBaseUrl: overrides.upstreamBaseUrl ?? "https://api.anthropic.com",
    port: overrides.port ?? 7777,
    bind: overrides.bind ?? "127.0.0.1",
    dashboardPort: overrides.dashboardPort ?? 7778,
    ledgerPath: overrides.ledgerPath ?? `${home}/.tokenshield/ledger.db`,
    enabledProcessors: overrides.enabledProcessors ?? ["token-accounting"],
    retentionDays: overrides.retentionDays ?? 7,
  };
}

async function listenOn(server: Server, port: number, bind: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, bind, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

export async function start(opts: StartOptions): Promise<ProxyServerHandle> {
  const ledger = new Ledger(opts.config.ledgerPath);

  const isTeamDeployment = opts.config.bind === "0.0.0.0";
  const sink = (r: RequestRecord): void => {
    try {
      ledger.record(r);
    } catch {
      // ledger errors must never break the request path
    }
    try {
      // Approximate byte counts from token estimates (industry rule-of-thumb)
      const tokensIn = r.usageRaw.inputTokens + r.usageRaw.cacheReadInputTokens;
      const tokensOut = r.usageSent.inputTokens + r.usageSent.cacheReadInputTokens;
      const TOKEN_TO_BYTE = 3.5;
      const bytesIn = Math.round(tokensIn * TOKEN_TO_BYTE);
      const bytesOut = Math.round(tokensOut * TOKEN_TO_BYTE);
      telemetry.record({
        bytesIn,
        bytesOut,
        bytesSaved: Math.max(0, bytesIn - bytesOut),
        inputTokens: r.usageRaw.inputTokens,
        outputTokens: r.usageRaw.outputTokens,
        dollarsEstimate: r.dollarsRaw,
        dollarsSaved: r.dollarsSaved,
        provider: "anthropic",
        model: r.model,
        client: null,
        teamDeployment: isTeamDeployment,
      });
    } catch {
      // telemetry must never break the request path
    }
    opts.onRecord?.(r);
  };

  const proxy = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/__tokenshield/health") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, version: "0.1.0" }));
      return;
    }
    handleAnthropicRequest(req, res, opts.config, sink).catch((err: unknown) => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            type: "error",
            error: {
              type: "tokenshield_internal_error",
              message: (err as Error)?.message ?? "unknown",
            },
          }),
        );
      } else {
        try {
          res.end();
        } catch {
          // ignore
        }
      }
    });
  });
  proxy.keepAliveTimeout = 65_000;
  proxy.headersTimeout = 70_000;
  proxy.requestTimeout = 0; // streaming responses can be long

  const dashboard = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    if (url === "/api/summary") {
      const since = Date.now() - 24 * 60 * 60 * 1000;
      const summary = ledger.summary(since);
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.setHeader("cache-control", "no-store");
      res.end(JSON.stringify(summary));
      return;
    }
    if (url === "/api/recent") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.setHeader("cache-control", "no-store");
      res.end(JSON.stringify(ledger.recent(50)));
      return;
    }
    if (url === "/health") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    const html = opts.renderDashboard?.(ledger) ?? defaultDashboardHtml();
    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(html);
  });

  await listenOn(proxy, opts.config.port, opts.config.bind);
  await listenOn(dashboard, opts.config.dashboardPort, opts.config.bind);

  const retentionInterval = setInterval(() => {
    const cutoff = Date.now() - opts.config.retentionDays * 24 * 60 * 60 * 1000;
    try {
      ledger.prune(cutoff);
    } catch {
      // ignore
    }
  }, 60 * 60 * 1000);
  retentionInterval.unref();

  return {
    proxy,
    dashboard,
    ledger,
    close: async () => {
      clearInterval(retentionInterval);
      telemetry.stop();
      await Promise.all([closeServer(proxy), closeServer(dashboard)]);
      ledger.close();
    },
  };
}

function defaultDashboardHtml(): string {
  return `<!doctype html><meta charset="utf-8"><title>TokenShield</title>
<body><h1>TokenShield</h1><p>Dashboard renderer not provided.</p></body>`;
}
