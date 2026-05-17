export function dashboardHtml(opts: { proxyPort: number; bind: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>TokenShield — live savings</title>
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
  --bad: #ef6868;
  --link: #7eb8ff;
}
* { box-sizing: border-box }
html, body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.wrap { max-width: 1100px; margin: 0 auto; padding: 24px; }
header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 18px; }
h1 { margin: 0; font-size: 18px; letter-spacing: 0.02em; }
h1 small { color: var(--muted); font-weight: 400; margin-left: 8px; }
.status { font-size: 12px; color: var(--muted); }
.status .dot { display: inline-block; width: 8px; height: 8px; border-radius: 999px; background: var(--accent); margin-right: 6px; vertical-align: middle; }
.grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px; }
.card .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
.card .value { font-size: 22px; font-weight: 600; margin-top: 6px; font-variant-numeric: tabular-nums; }
.card .sub { font-size: 11px; color: var(--muted); margin-top: 4px; }
.section { margin-top: 24px; }
.section h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0 0 10px; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 13px; }
th { color: var(--muted); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
tr:last-child td { border-bottom: 0; }
.muted { color: var(--muted); }
.num { text-align: right; }
.pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; border: 1px solid var(--border); }
.pill.ok { color: var(--accent); border-color: rgba(109,211,168,0.35); }
.pill.err { color: var(--bad); border-color: rgba(239,104,104,0.35); }
.cmd { background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; }
.footer { color: var(--muted); font-size: 12px; margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--border); }
.kbd { font-family: ui-monospace, monospace; background: var(--panel-2); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; font-size: 11px; }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>TokenShield <small>v0.1 — Estimate mode</small></h1>
    <div class="status"><span class="dot"></span><span id="status-text">proxy live on ${opts.bind}:${opts.proxyPort}</span></div>
  </header>

  <div class="grid">
    <div class="card">
      <div class="label">Spent (24h)</div>
      <div class="value" id="dollars-spent">$0.00</div>
      <div class="sub" id="request-count">0 requests</div>
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
      <tbody><tr><td colspan="5" class="muted">No traffic yet. Run Claude Code with <span class="kbd">ANTHROPIC_BASE_URL=http://${opts.bind}:${opts.proxyPort}</span>.</td></tr></tbody>
    </table>
  </div>

  <div class="section">
    <h2>Recent requests</h2>
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
    Privacy: TokenShield never stores prompt content. Your Anthropic API key stays in process memory.
    Set <span class="cmd">export ANTHROPIC_BASE_URL=http://${opts.bind}:${opts.proxyPort}</span> in the shell you run Claude Code from.
  </div>
</div>

<script>
const fmtNum = (n) => Number(n || 0).toLocaleString();
const fmtDollars = (d) => '$' + Number(d || 0).toFixed(Math.abs(d) < 1 ? 4 : 2);
const fmtTime = (ms) => new Date(ms).toLocaleTimeString();
const fmtMs = (ms) => ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's';

async function refresh() {
  try {
    const [sumRes, recRes] = await Promise.all([
      fetch('/api/summary'),
      fetch('/api/recent'),
    ]);
    const sum = await sumRes.json();
    const rec = await recRes.json();

    document.getElementById('dollars-spent').textContent = fmtDollars(sum.dollarsRaw);
    document.getElementById('request-count').textContent = fmtNum(sum.requestCount) + ' requests';
    document.getElementById('input-tokens').textContent = fmtNum(sum.totalInputTokensRaw);
    document.getElementById('output-tokens').textContent = fmtNum(sum.totalOutputTokensRaw);

    const windowMs = Math.max(1, sum.windowEnd - sum.windowStart);
    const weeklyProjection = sum.dollarsRaw / (windowMs / (7 * 24 * 60 * 60 * 1000));
    document.getElementById('weekly-projected').textContent = fmtDollars(weeklyProjection);

    const modelBody = document.querySelector('#by-model tbody');
    if (sum.byModel && sum.byModel.length > 0) {
      modelBody.innerHTML = sum.byModel.map((m) =>
        '<tr><td>' + m.model + '</td>' +
        '<td class="num">' + fmtNum(m.requests) + '</td>' +
        '<td class="num">' + fmtNum(m.inputTokens) + '</td>' +
        '<td class="num">' + fmtNum(m.outputTokens) + '</td>' +
        '<td class="num">' + fmtDollars(m.dollars) + '</td></tr>'
      ).join('');
    }

    const recBody = document.querySelector('#recent tbody');
    if (rec && rec.length > 0) {
      recBody.innerHTML = rec.map((r) => {
        const ok = r.upstreamStatus >= 200 && r.upstreamStatus < 300;
        return '<tr>' +
          '<td class="muted">' + fmtTime(r.timestamp) + '</td>' +
          '<td>' + r.model + '</td>' +
          '<td class="muted">' + r.endpoint + '</td>' +
          '<td class="num">' + fmtNum(r.usageRaw.inputTokens) + '</td>' +
          '<td class="num">' + fmtNum(r.usageRaw.outputTokens) + '</td>' +
          '<td class="num muted">' + fmtMs(r.durationMs) + '</td>' +
          '<td class="num">' + fmtDollars(r.dollarsRaw) + '</td>' +
          '<td><span class="pill ' + (ok ? 'ok' : 'err') + '">' + r.upstreamStatus + '</span></td>' +
          '</tr>';
      }).join('');
    }
  } catch (e) {
    document.getElementById('status-text').textContent = 'dashboard error: ' + e.message;
  }
}

refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;
}
