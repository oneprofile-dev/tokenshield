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
    // Friendly landing page for humans who hit the proxy port in a browser.
    // The proxy itself only speaks /v1/messages, /v1/messages/stream, etc.
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(proxyLandingHtml(opts.config));
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

function proxyLandingHtml(config: ProxyConfig): string {
  const dashUrl = `http://${config.bind === "0.0.0.0" ? "127.0.0.1" : config.bind}:${config.dashboardPort}`;
  const exportLine = `export ANTHROPIC_BASE_URL=http://${config.bind === "0.0.0.0" ? "127.0.0.1" : config.bind}:${config.port}`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>TokenShield proxy</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{box-sizing:border-box}
  body{font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0b0d12;color:#e6e7ea;margin:0;padding:40px 20px;display:flex;justify-content:center}
  main{max-width:640px;width:100%}
  .pill{display:inline-flex;align-items:center;gap:6px;background:rgba(34,197,94,.12);color:#4ade80;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600}
  .pill::before{content:'';width:6px;height:6px;border-radius:50%;background:#22c55e;animation:pulse 2s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  h1{font-size:28px;margin:16px 0 8px;font-weight:700}
  .subtitle{color:#9ca3af;margin:0 0 28px}
  .card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:20px 22px;margin:14px 0}
  .card h2{font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:#a5b4fc;margin:0 0 8px}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(255,255,255,.07);padding:2px 6px;border-radius:4px;font-size:13px;color:#fbbf24}
  pre{background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:14px 16px;overflow-x:auto;margin:8px 0 0}
  pre code{background:none;padding:0;color:#86efac}
  a{color:#a5b4fc;text-decoration:none;border-bottom:1px solid rgba(165,180,252,.3)}
  a:hover{border-color:#a5b4fc}
  .footer{margin-top:32px;font-size:12px;color:#6b7280;text-align:center}
  .dash-cta{display:inline-block;background:#22c55e;color:#0b0d12;font-weight:600;padding:10px 20px;border-radius:8px;text-decoration:none;border:0;margin-top:6px}
  .dash-cta:hover{background:#16a34a}
</style>
</head><body><main>
  <span class="pill">TokenShield is running</span>
  <h1>This is the proxy, not the dashboard.</h1>
  <p class="subtitle">You hit port ${config.port} — that's where Claude Code (or Cursor, Windsurf, Aider) sends its API requests. The proxy doesn't serve a UI; it forwards traffic to Anthropic.</p>

  <div class="card">
    <h2>→ Want the dashboard?</h2>
    <p style="margin:0 0 12px">Live spend, requests, savings, and recent traffic:</p>
    <a class="dash-cta" href="${dashUrl}">Open dashboard →</a>
  </div>

  <div class="card">
    <h2>→ Route Claude Code through this proxy</h2>
    <p style="margin:0 0 4px">In the shell where you run <code>claude</code>:</p>
    <pre><code>${exportLine}</code></pre>
    <p style="margin:12px 0 0;font-size:13px;color:#9ca3af">Your <code>ANTHROPIC_API_KEY</code> stays where it is. TokenShield never reads it.</p>
  </div>

  <div class="card">
    <h2>→ Other clients</h2>
    <p style="margin:0;font-size:13px;color:#9ca3af">
      <strong style="color:#e6e7ea">Cursor / Windsurf:</strong> Settings → AI → Custom Base URL = <code>http://${config.bind === "0.0.0.0" ? "127.0.0.1" : config.bind}:${config.port}</code>
      <br><br>
      <strong style="color:#e6e7ea">Anthropic SDK:</strong> set <code>baseURL</code> when instantiating the client.
      <br><br>
      <strong style="color:#e6e7ea">Auto-configure your shell:</strong> <code>tokenshield integrations enable claude-code</code>
    </p>
  </div>

  <p class="footer">
    Docs: <a href="https://curatedmcp.com/tokenshield">curatedmcp.com/tokenshield</a> &nbsp;·&nbsp;
    Source: <a href="https://github.com/oneprofile-dev/tokenshield">github.com/oneprofile-dev/tokenshield</a>
  </p>
</main></body></html>`;
}
