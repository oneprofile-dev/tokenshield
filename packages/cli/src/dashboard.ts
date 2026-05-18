export function dashboardHtml(opts: {
  proxyPort: number;
  bind: string;
  version: string;
  tier?: "free" | "pro" | "team";
  email?: string;
}): string {
  const proxyBase = `http://${opts.bind}:${opts.proxyPort}`;
  const tier = opts.tier ?? "free";
  const isPro = tier === "pro" || tier === "team";
  const modePillLabel = isPro ? `${tier.toUpperCase()} · active` : "Estimate mode";
  const modePillClass = isPro ? "mode-pill mode-pill-pro" : "mode-pill";
  const modePillTitle = isPro
    ? `Licensed as ${opts.email ?? "your account"}. Active processors will engage as they ship.`
    : "Estimate mode measures your spend. Upgrade to Pro to unlock active compression processors as they ship.";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>TokenShield ${opts.version} — live savings</title>
<style>
:root {
  color-scheme: dark light;
  --bg: #0b0d10;
  --panel: #14171c;
  --panel-2: #1a1e25;
  --border: #2a2f38;
  --text: #e7e9ee;
  --muted: #8b94a3;
  --accent: #6dd3a8;
  --warn: #f0b35e;
  --warn-bg: rgba(240,179,94,0.08);
  --warn-border: rgba(240,179,94,0.35);
  --bad: #ef6868;
  --bad-bg: rgba(239,104,104,0.08);
  --bad-border: rgba(239,104,104,0.35);
  --info: #7eb8ff;
  --info-bg: rgba(126,184,255,0.08);
  --info-border: rgba(126,184,255,0.35);
  --link: #7eb8ff;
}
* { box-sizing: border-box }
html, body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.wrap { max-width: 1100px; margin: 0 auto; padding: 24px; }

/* ── header ── */
header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; gap: 12px; flex-wrap: wrap; }
.brand { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.brand-name { font-size: 18px; font-weight: 700; letter-spacing: 0.02em; color: var(--text); text-decoration: none; }
.brand-name:hover { color: var(--accent); }
.brand-by { font-size: 11px; color: var(--muted); font-weight: 400; letter-spacing: 0.02em; }
.brand-by a { color: var(--accent); text-decoration: none; font-weight: 500; }
.brand-by a:hover { text-decoration: underline; }
.brand-ver { font-size: 12px; color: var(--muted); font-weight: 400; }
.mode-pill { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; padding: 2px 7px; border-radius: 999px; background: var(--info-bg); border: 1px solid var(--info-border); color: var(--info); font-weight: 600; cursor: help; }
.mode-pill-pro { background: rgba(109,211,168,0.12); border-color: rgba(109,211,168,0.45); color: var(--accent); }
.status { display: flex; align-items: center; gap: 14px; }
.status-pill { font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 999px; background: var(--accent); flex-shrink: 0; }
.dot.pulse { animation: pulse 2s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:.45 } }

/* ── diagnostic banner ── */
.diag { display: none; margin-bottom: 18px; border-radius: 10px; padding: 14px 16px; font-size: 13px; line-height: 1.55; border: 1px solid; }
.diag.show { display: block; }
.diag.info { background: var(--info-bg); border-color: var(--info-border); color: var(--text); }
.diag.warn { background: var(--warn-bg); border-color: var(--warn-border); color: var(--text); }
.diag.bad { background: var(--bad-bg); border-color: var(--bad-border); color: var(--text); }
.diag-title { font-weight: 600; margin-bottom: 6px; display: flex; align-items: center; gap: 8px; }
.diag-title .icon { display: inline-flex; width: 18px; height: 18px; align-items: center; justify-content: center; border-radius: 999px; font-size: 11px; font-weight: 700; }
.diag.info .diag-title { color: var(--info); }
.diag.info .icon { background: var(--info); color: #0b0d10; }
.diag.warn .diag-title { color: var(--warn); }
.diag.warn .icon { background: var(--warn); color: #0b0d10; }
.diag.bad .diag-title { color: var(--bad); }
.diag.bad .icon { background: var(--bad); color: #0b0d10; }
.diag code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; background: var(--panel-2); padding: 1px 6px; border-radius: 4px; border: 1px solid var(--border); }
.diag a { color: var(--link); }

/* ── tier banner (free → upgrade nudge, pro → confirmation) ── */
.tier-banner { display: none; margin-bottom: 16px; padding: 14px 18px; border-radius: 10px; border: 1px solid; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.tier-banner.show { display: flex; }
.tier-banner.upgrade { background: linear-gradient(90deg, rgba(109,211,168,0.06), rgba(109,211,168,0.02)); border-color: rgba(109,211,168,0.35); }
.tier-banner.pro { background: rgba(109,211,168,0.08); border-color: rgba(109,211,168,0.5); }
.tier-msg { font-size: 13px; color: var(--text); line-height: 1.5; flex: 1 1 60%; }
.tier-msg .highlight { color: var(--accent); font-weight: 600; }
.tier-msg .small { font-size: 11px; color: var(--muted); margin-top: 2px; display: block; }
.tier-cta { background: var(--accent); color: #0b0d10; text-decoration: none; font-size: 13px; font-weight: 600; padding: 8px 14px; border-radius: 6px; white-space: nowrap; transition: opacity 0.15s; }
.tier-cta:hover { opacity: 0.9; text-decoration: none; }
.tier-cta-secondary { font-size: 12px; color: var(--muted); text-decoration: none; }
.tier-cta-secondary:hover { color: var(--accent); }

/* ── metric cards ── */
.grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px; }
.card .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
.card .value { font-size: 22px; font-weight: 600; margin-top: 6px; font-variant-numeric: tabular-nums; }
.card .sub { font-size: 11px; color: var(--muted); margin-top: 4px; }
.card.savings { border-color: rgba(109,211,168,0.25); background: linear-gradient(135deg, var(--panel) 0%, rgba(109,211,168,0.06) 100%); }
.card.savings .value { color: var(--accent); }
.card.savings .label { color: rgba(109,211,168,0.7); }

/* ── tables ── */
.section { margin-top: 24px; }
.section-head { display: flex; justify-content: space-between; align-items: center; margin: 0 0 10px; }
.section h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0; }
.toggle-link { font-size: 11px; color: var(--muted); cursor: pointer; user-select: none; background: none; border: none; padding: 0; font-family: inherit; }
.toggle-link:hover { color: var(--accent); }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 13px; }
th { color: var(--muted); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
tr:last-child td { border-bottom: 0; }
.muted { color: var(--muted); }
.num { text-align: right; }
.pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; border: 1px solid var(--border); }
.pill.ok { color: var(--accent); border-color: rgba(109,211,168,0.35); }
.pill.warn { color: var(--warn); border-color: var(--warn-border); }
.pill.err { color: var(--bad); border-color: var(--bad-border); }
.row-faded td { opacity: 0.55; }

/* ── misc ── */
.cmd { background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; display: inline-block; }
.kbd { font-family: ui-monospace, monospace; background: var(--panel-2); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; font-size: 11px; }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }

/* ── footer ── */
.footer { margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; flex-wrap: wrap; }
.footer-privacy { color: var(--muted); font-size: 12px; flex: 1 1 380px; line-height: 1.7; }
.footer-privacy .cmd { margin: 4px 0; }
.footer-links { display: flex; align-items: center; gap: 12px; flex-shrink: 0; flex-wrap: wrap; }
.footer-links a { font-size: 12px; color: var(--muted); text-decoration: none; white-space: nowrap; }
.footer-links a:hover { color: var(--accent); text-decoration: none; }
.footer-links .sep { color: var(--border); user-select: none; }
.upgrade-link { color: var(--accent) !important; font-weight: 500; }
</style>
</head>
<body>
<div class="wrap">

  <header>
    <div class="brand">
      <a class="brand-name" href="https://www.curatedmcp.com/tokenshield" target="_blank" rel="noopener">TokenShield</a>
      <span class="brand-ver">v${opts.version}</span>
      <span class="brand-by">by <a href="https://www.curatedmcp.com" target="_blank" rel="noopener">CuratedMCP</a></span>
      <span class="${modePillClass}" title="${modePillTitle}">${modePillLabel}</span>
    </div>
    <div class="status">
      <div class="status-pill">
        <span class="dot pulse" id="status-dot"></span>
        <span id="status-text">proxy live · ${opts.bind}:${opts.proxyPort}</span>
      </div>
    </div>
  </header>

  <div id="diag" class="diag"></div>

  <!-- Tier banner — renders one of two messages depending on license tier -->
  <div id="tier-banner" class="tier-banner"></div>

  <div class="grid">
    <div class="card savings">
      <div class="label">Spent (24h)</div>
      <div class="value" id="dollars-spent">$0.00</div>
      <div class="sub" id="request-count">0 requests · 0 successful</div>
    </div>
    <div class="card">
      <div class="label">Input tokens (24h)</div>
      <div class="value" id="input-tokens">0</div>
      <div class="sub" id="input-cache">cache: 0 read, 0 write</div>
    </div>
    <div class="card">
      <div class="label">Output tokens (24h)</div>
      <div class="value" id="output-tokens">0</div>
      <div class="sub">most expensive line item on Opus</div>
    </div>
    <div class="card">
      <div class="label">Projected weekly</div>
      <div class="value" id="weekly-projected">$0.00</div>
      <div class="sub">extrapolated from last 24h</div>
    </div>
  </div>

  <div class="section">
    <h2>Spend by model (24h)</h2>
    <table id="by-model">
      <thead>
        <tr>
          <th>Model</th>
          <th class="num">Requests</th>
          <th class="num">Input</th>
          <th class="num">Output</th>
          <th class="num">$</th>
        </tr>
      </thead>
      <tbody><tr><td colspan="5" class="muted">No traffic yet. Run Claude Code with <span class="kbd">ANTHROPIC_BASE_URL=${proxyBase}</span>.</td></tr></tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-head">
      <h2>Recent requests</h2>
      <button class="toggle-link" id="toggle-noise" onclick="toggleNoise()">Show probes</button>
    </div>
    <table id="recent">
      <thead>
        <tr>
          <th>Time</th>
          <th>Model</th>
          <th>Endpoint</th>
          <th class="num">Input</th>
          <th class="num">Output</th>
          <th class="num">Duration</th>
          <th class="num">$</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody><tr><td colspan="8" class="muted">No requests recorded yet.</td></tr></tbody>
    </table>
  </div>

  <div class="footer">
    <div class="footer-privacy">
      Privacy: TokenShield never stores prompt content. Your Anthropic API key stays in process memory.<br>
      Set <span class="cmd">export ANTHROPIC_BASE_URL=${proxyBase}</span> in the shell you run Claude Code from.
    </div>
    <div class="footer-links">
      <a href="https://www.curatedmcp.com/tokenshield" target="_blank" rel="noopener">curatedmcp.com/tokenshield</a>
      <span class="sep">·</span>
      <a href="https://www.curatedmcp.com/docs/tokenshield" target="_blank" rel="noopener">Docs</a>
      <span class="sep">·</span>
      <a href="https://www.curatedmcp.com/tokenshield/upgrade" target="_blank" rel="noopener" class="upgrade-link">Upgrade →</a>
    </div>
  </div>

</div>

<script>
// Server-baked license context — driven by ~/.tokenshield/license.json on boot
const __TIER__ = ${JSON.stringify(tier)};
const __EMAIL__ = ${JSON.stringify(opts.email ?? null)};
// Projected savings if Pro processors were active.
// Conservative estimate: conversation-dedup ≈ 30% + result-cache ≈ 10% = 40% blended on heavy workloads.
// Surfaced as a range to set honest expectations (25%–55%).
const PRO_SAVINGS_LOW = 0.25;
const PRO_SAVINGS_HIGH = 0.55;
const UPGRADE_URL = "https://www.curatedmcp.com/tokenshield/upgrade";
const DASHBOARD_URL = "https://www.curatedmcp.com/tokenshield/dashboard";

const fmtNum = (n) => Number(n || 0).toLocaleString();
const fmtDollars = (d) => '$' + Number(d || 0).toFixed(Math.abs(d) < 1 ? 4 : 2);
const fmtTime = (ms) => new Date(ms).toLocaleTimeString();
const fmtMs = (ms) => ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's';

// Treat /v1/* requests as real Anthropic traffic; everything else (e.g. GET /, probes) is noise.
const isApiCall = (r) => typeof r.endpoint === 'string' && r.endpoint.startsWith('/v1/');

let showNoise = false;
function toggleNoise() {
  showNoise = !showNoise;
  document.getElementById('toggle-noise').textContent = showNoise ? 'Hide probes' : 'Show probes';
  // Re-render on next tick from cached state
  if (window.__lastRec) renderRecent(window.__lastRec);
}

function renderDiagnostic(rec) {
  const diag = document.getElementById('diag');
  const apiCalls = rec.filter(isApiCall);
  const failed = apiCalls.filter((r) => r.upstreamStatus === 401 || r.upstreamStatus === 403);
  const fiveXx = apiCalls.filter((r) => r.upstreamStatus >= 500);
  const ok = apiCalls.filter((r) => r.upstreamStatus >= 200 && r.upstreamStatus < 300);

  let html = '';
  let cls = '';

  if (apiCalls.length === 0) {
    cls = 'info';
    html = '<div class="diag-title"><span class="icon">i</span>Waiting for traffic</div>' +
      'No Anthropic API calls yet. In the shell that runs Claude Code, set:<br>' +
      '<code>export ANTHROPIC_API_KEY=sk-ant-…</code> &nbsp; <code>export ANTHROPIC_BASE_URL=${proxyBase}</code><br>' +
      'Then run <code>claude</code> in that same shell.';
  } else if (failed.length >= apiCalls.length * 0.5 && failed.length > 0) {
    cls = 'bad';
    const pct = Math.round((failed.length / apiCalls.length) * 100);
    html = '<div class="diag-title"><span class="icon">!</span>' + pct + '% of API calls failing with 401/403 — auth not reaching Anthropic</div>' +
      '<strong>#1 cause (Pro/Max users):</strong> Claude Code is using a cached OAuth token from a prior <code>claude login</code>, which overrides <code>ANTHROPIC_API_KEY</code> and breaks through the proxy. Fix:<br>' +
      '&nbsp;&nbsp;1. <code>claude logout</code><br>' +
      '&nbsp;&nbsp;2. In that same shell: <code>export ANTHROPIC_API_KEY=sk-ant-api03-…</code> &nbsp; <code>export ANTHROPIC_BASE_URL=${proxyBase}</code><br>' +
      '&nbsp;&nbsp;3. <code>echo $ANTHROPIC_API_KEY</code> — must print your full key (not empty)<br>' +
      '&nbsp;&nbsp;4. <code>claude</code> in that same shell<br>' +
      '<br><strong>#2 cause:</strong> Env vars set inside a script (<code>./up.sh</code>) won\\'t leak to your <code>claude</code> shell. Either <code>source up.sh</code> or paste the exports directly into the shell where you run <code>claude</code>.<br>' +
      '<br>Run <code>tokenshield doctor</code> to auto-diagnose.';
  } else if (fiveXx.length >= apiCalls.length * 0.3 && fiveXx.length > 0) {
    cls = 'warn';
    html = '<div class="diag-title"><span class="icon">!</span>Upstream errors from Anthropic</div>' +
      fiveXx.length + ' of ' + apiCalls.length + ' recent requests returned 5xx. Check <a href="https://status.anthropic.com" target="_blank" rel="noopener">status.anthropic.com</a>.';
  } else if (ok.length > 0) {
    // Healthy — hide the banner entirely
    diag.className = 'diag';
    diag.innerHTML = '';
    return;
  }

  diag.className = 'diag show ' + cls;
  diag.innerHTML = html;
}

function renderRecent(rec) {
  const recBody = document.querySelector('#recent tbody');
  const filtered = showNoise ? rec : rec.filter(isApiCall);

  if (filtered.length === 0) {
    const msg = rec.length === 0
      ? 'No requests recorded yet.'
      : 'No Anthropic API calls yet (' + rec.length + ' non-API probe' + (rec.length === 1 ? '' : 's') + ' hidden — click "Show probes" to view).';
    recBody.innerHTML = '<tr><td colspan="8" class="muted">' + msg + '</td></tr>';
    return;
  }

  recBody.innerHTML = filtered.map((r) => {
    const status = Number(r.upstreamStatus) || 0;
    const isOk = status >= 200 && status < 300;
    const isAuthFail = status === 401 || status === 403;
    const pillCls = isOk ? 'ok' : (isAuthFail ? 'warn' : 'err');
    const isProbe = !isApiCall(r);
    const modelDisplay = (r.model === 'unknown' && isProbe) ? '<span class="muted">—</span>' : r.model;
    return '<tr class="' + (isProbe ? 'row-faded' : '') + '">' +
      '<td class="muted">' + fmtTime(r.timestamp) + '</td>' +
      '<td>' + modelDisplay + '</td>' +
      '<td class="muted">' + r.endpoint + '</td>' +
      '<td class="num">' + fmtNum(r.usageRaw.inputTokens) + '</td>' +
      '<td class="num">' + fmtNum(r.usageRaw.outputTokens) + '</td>' +
      '<td class="num muted">' + fmtMs(r.durationMs) + '</td>' +
      '<td class="num">' + fmtDollars(r.dollarsRaw) + '</td>' +
      '<td><span class="pill ' + pillCls + '">' + status + '</span></td>' +
      '</tr>';
  }).join('');
}

async function refresh() {
  try {
    const [sumRes, recRes] = await Promise.all([
      fetch('/api/summary'),
      fetch('/api/recent'),
    ]);
    if (!sumRes.ok || !recRes.ok) {
      throw new Error('proxy returned ' + (sumRes.ok ? recRes.status : sumRes.status));
    }
    const sum = await sumRes.json();
    const rec = await recRes.json();
    window.__lastRec = rec;

    // Successful refresh — clear any stale error and restore the live indicator
    const statusEl = document.getElementById('status-text');
    if (statusEl) statusEl.textContent = 'live · ${opts.bind}:${opts.proxyPort}';

    // Count successful API calls for the spent card
    const apiCalls = rec.filter(isApiCall);
    const okCount = apiCalls.filter((r) => r.upstreamStatus >= 200 && r.upstreamStatus < 300).length;

    document.getElementById('dollars-spent').textContent = fmtDollars(sum.dollarsRaw);
    document.getElementById('request-count').textContent =
      fmtNum(sum.requestCount) + ' total · ' + okCount + ' successful';
    document.getElementById('input-tokens').textContent = fmtNum(sum.totalInputTokensRaw);
    document.getElementById('output-tokens').textContent = fmtNum(sum.totalOutputTokensRaw);

    const windowMs = Math.max(1, sum.windowEnd - sum.windowStart);
    const weeklyProjection = sum.dollarsRaw / (windowMs / (7 * 24 * 60 * 60 * 1000));
    document.getElementById('weekly-projected').textContent = fmtDollars(weeklyProjection);

    const modelBody = document.querySelector('#by-model tbody');
    const realModels = (sum.byModel || []).filter((m) => m.model && m.model !== 'unknown');
    if (realModels.length > 0) {
      modelBody.innerHTML = realModels.map((m) =>
        '<tr><td>' + m.model + '</td>' +
        '<td class="num">' + fmtNum(m.requests) + '</td>' +
        '<td class="num">' + fmtNum(m.inputTokens) + '</td>' +
        '<td class="num">' + fmtNum(m.outputTokens) + '</td>' +
        '<td class="num">' + fmtDollars(m.dollars) + '</td></tr>'
      ).join('');
    } else {
      modelBody.innerHTML = '<tr><td colspan="5" class="muted">No model traffic yet. Run Claude Code with <span class="kbd">ANTHROPIC_BASE_URL=${proxyBase}</span>.</td></tr>';
    }

    renderRecent(rec);
    renderDiagnostic(rec);
    renderTierBanner(sum);
  } catch (e) {
    document.getElementById('status-text').textContent = 'error: ' + e.message;
  }
}

function renderTierBanner(sum) {
  const banner = document.getElementById('tier-banner');
  if (!banner) return;

  const spent = Number(sum.dollarsRaw) || 0;
  const windowMs = Math.max(1, sum.windowEnd - sum.windowStart);
  const monthlyProj = spent / (windowMs / (30 * 24 * 60 * 60 * 1000));

  if (__TIER__ === 'pro' || __TIER__ === 'team') {
    // Pro user — show confirmation + link to cloud dashboard
    banner.className = 'tier-banner show pro';
    banner.innerHTML =
      '<div class="tier-msg">' +
        '<span class="highlight">✓ ' + __TIER__.toUpperCase() + ' · ' + (__EMAIL__ ? __EMAIL__ : 'licensed') + '</span> &mdash; cloud sync active. ' +
        'Active compression processors enable as they ship through Q3.' +
        '<span class="small">View your spend across every machine at curatedmcp.com/tokenshield/dashboard</span>' +
      '</div>' +
      '<a class="tier-cta" href="' + DASHBOARD_URL + '" target="_blank" rel="noopener">Open cloud dashboard →</a>';
    return;
  }

  // Free tier — show projection nudge once spend is meaningful (> $0.50 in window)
  if (spent < 0.50) {
    banner.className = 'tier-banner';
    banner.innerHTML = '';
    return;
  }

  const monthlyLow = monthlyProj * PRO_SAVINGS_LOW;
  const monthlyHigh = monthlyProj * PRO_SAVINGS_HIGH;
  const fmt = (n) => '$' + n.toFixed(n < 10 ? 2 : 0);
  banner.className = 'tier-banner show upgrade';
  banner.innerHTML =
    '<div class="tier-msg">' +
      'At your current rate, Pro processors would save you about <span class="highlight">' + fmt(monthlyLow) + '–' + fmt(monthlyHigh) + '/month</span>. ' +
      '<span class="small">Projected from ' + fmtDollars(spent) + ' measured in the last ' + Math.round(windowMs / (60 * 60 * 1000)) + 'h · 25–55% blended savings from conversation-dedup + result-cache</span>' +
    '</div>' +
    '<a class="tier-cta" href="' + UPGRADE_URL + '" target="_blank" rel="noopener">Upgrade · $19/mo →</a>';
}

refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;
}
