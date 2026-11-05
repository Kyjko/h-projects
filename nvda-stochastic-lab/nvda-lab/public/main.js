const $ = id => document.getElementById(id);
const f2 = (x, d = 2) => Number.isFinite(x) ? x.toFixed(d) : '–';
const pc = x => Number.isFinite(x) ? (100 * x).toFixed(1) + '%' : '–';
const GREEN = '#76b900', ORANGE = '#ff9f43', MUTED = '#8b94a1', LINE = '#2a303a';

(function initDates() {
  const e = new Date(), s = new Date(); s.setFullYear(e.getFullYear() - 3);
  $('end').value = e.toISOString().slice(0, 10); $('start').value = s.toISOString().slice(0, 10);
})();

const status = (t, err) => { $('status').textContent = t; $('status').className = err ? 'err' : ''; };

async function loadPrices() {
  const q = new URLSearchParams({ symbol: $('sym').value, start: $('start').value, end: $('end').value });
  const r = await fetch('/api/prices?' + q), j = await r.json();
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}
function demoData() { // synthetic GBM path, useful offline
  const n = Model.normal(Model.rng(7)), d = new Date('2023-01-02'), out = []; let s = 20;
  while (out.length < 750) {
    d.setDate(d.getDate() + 1); if (d.getDay() % 6 === 0) continue;
    s *= Math.exp((0.55 - 0.125) / 252 + 0.5 * Math.sqrt(1 / 252) * n());
    out.push({ date: d.toISOString().slice(0, 10), close: s });
  }
  return out;
}

async function run(getData) {
  try {
    status('Working…');
    const data = await getData(), px = data.map(d => d.close), S0 = px[px.length - 1];
    const H = +$('hor').value, N = +$('npaths').value;
    let levels = $('levels').value.split(',').map(s => parseFloat(s)).filter(Number.isFinite);
    if (!levels.length) { levels = [0.8, 0.9, 1.1, 1.25, 1.5, 2].map(m => Math.round(S0 * m)); $('levels').value = levels.join(', '); }
    const gbm = Model.fitGBM(px), ou = Model.fitOU(px);
    await new Promise(r => setTimeout(r, 20)); // let the UI repaint
    const T = H * Model.DT;
    const A = Model.analyze(Model.simulate(gbm, S0, H, N, 1), N, H, S0, levels);
    const B = Model.analyze(Model.simulate(ou, S0, H, N, 2), N, H, S0, levels);
    $('out').hidden = false;
    renderParams(gbm, ou, data, S0);
    const hist = px.slice(-252);
    fan($('c1'), hist, A.q, H, GREEN); fan($('c2'), hist, B.q, H, ORANGE);
    histogram($('c3'), S0, A.term, B.term);
    renderQuant(A, B);
    renderProbs(levels, A, B, gbm, ou, S0, T);
    status(`Fitted on ${data.length} daily closes (${data[0].date} → ${data[data.length - 1].date}); last price $${f2(S0)}.`);
  } catch (e) { status('Error: ' + e.message + ' — try the synthetic demo data if you are offline.', true); }
}
$('go').onclick = () => run(loadPrices);
$('demo').onclick = () => run(async () => demoData());

function renderParams(g, o, data, S0) {
  $('params').innerHTML = `<table><tr><th>Model</th><th>Parameters (annualised)</th><th>Log-likelihood</th><th>AIC</th></tr>
  <tr><td class="gbm">GBM</td><td>μ = ${pc(g.mu)}, σ = ${pc(g.sigma)} &nbsp;(log-drift ν = μ − σ²/2 = ${pc(g.nu)})</td><td>${f2(g.ll, 1)}</td><td>${f2(g.aic, 1)}</td></tr>
  <tr><td class="ou">OU (log price)</td><td>θ = ${f2(o.theta, 3)}, long-run level = $${f2(o.level)}, σ = ${pc(o.sigma)}, half-life = ${o.meanReverting ? f2(o.halfLifeDays, 0) + ' trading days' : '∞'}</td><td>${f2(o.ll, 1)}</td><td>${f2(o.aic, 1)}</td></tr></table>`;
  const better = g.aic < o.aic ? 'GBM' : 'OU';
  $('notes').innerHTML = `Lower AIC is better: <b>${better}</b> fits the daily transitions better on this window. ` +
    (o.meanReverting ? '' : 'The OU regression found <b>no mean reversion</b> (b ≥ 1), so it degenerated to near-driftless Brownian motion. ') +
    'Stocks like NVDA trend strongly, so an OU long-run level fitted on a short window is fragile — treat OU forecasts as a "what if prices revert" scenario, not a prediction.';
}
function renderQuant(A, B) {
  const row = (n, c, R) => `<tr><td class="${c}">${n}</td>${[.05, .25, .5, .75, .95].map(p => `<td>$${f2(Model.quant(R.term, p))}</td>`).join('')}<td>$${f2(R.mean)}</td></tr>`;
  $('quant').innerHTML = `<table><tr><th>Model</th><th>5%</th><th>25%</th><th>Median</th><th>75%</th><th>95%</th><th>Mean</th></tr>${row('GBM', 'gbm', A)}${row('OU', 'ou', B)}</table>`;
}
function renderProbs(levels, A, B, gbm, ou, S0, T) {
  const rows = levels.map((K, i) => `<tr><td>$${f2(K, 0)} (${K >= S0 ? '+' : ''}${f2((K / S0 - 1) * 100, 0)}%)</td>
    <td class="gbm">${pc(A.probs[i].above)}</td><td class="gbm">${pc(Model.gbmTerminalAbove(gbm, S0, K, T))}</td><td class="gbm">${pc(A.probs[i].touch)}</td><td class="gbm">${pc(Model.gbmTouch(gbm, S0, K, T))}</td>
    <td class="ou">${pc(B.probs[i].above)}</td><td class="ou">${pc(Model.ouTerminalAbove(ou, S0, K, T))}</td><td class="ou">${pc(B.probs[i].touch)}</td></tr>`).join('');
  $('probs').innerHTML = `<div style="overflow-x:auto"><table><tr><th>Level</th><th>GBM ends above (MC)</th><th>(analytic)</th><th>GBM touches (MC)</th><th>(analytic)</th><th>OU ends above (MC)</th><th>(analytic)</th><th>OU touches (MC)</th></tr>${rows}</table></div>`;
}

// ---------- canvas drawing ----------
function setup(c) {
  const dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr; const g = c.getContext('2d'); g.scale(dpr, dpr); g.font = '11px system-ui'; return { g, w, h };
}
function yGrid(g, P, w, h, lo, hi, fmt) {
  g.strokeStyle = LINE; g.fillStyle = MUTED; g.lineWidth = 1; g.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v = lo + (hi - lo) * i / 4, y = P.t + (h - P.t - P.b) * (1 - i / 4);
    g.beginPath(); g.moveTo(P.l, y); g.lineTo(w - P.r, y); g.stroke(); g.fillText(fmt(v), P.l - 6, y + 4);
  }
}
function fan(c, hist, q, H, color) {
  const { g, w, h } = setup(c), P = { l: 50, r: 10, t: 10, b: 10 }, L = hist.length, N = L + H, S0 = hist[L - 1];
  let lo = Infinity, hi = -Infinity;
  hist.forEach(v => { lo = Math.min(lo, v); hi = Math.max(hi, v); });
  for (let k = 0; k < H; k++) { lo = Math.min(lo, q[0][k]); hi = Math.max(hi, q[4][k]); }
  const pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
  const X = i => P.l + (w - P.l - P.r) * i / (N - 1), Y = v => P.t + (h - P.t - P.b) * (1 - (v - lo) / (hi - lo));
  yGrid(g, P, w, h, lo, hi, v => '$' + v.toFixed(0));
  const band = (a, b, alpha) => {
    g.fillStyle = color; g.globalAlpha = alpha; g.beginPath(); g.moveTo(X(L - 1), Y(S0));
    for (let k = 0; k < H; k++) g.lineTo(X(L + k), Y(q[a][k]));
    for (let k = H - 1; k >= 0; k--) g.lineTo(X(L + k), Y(q[b][k]));
    g.closePath(); g.fill(); g.globalAlpha = 1;
  };
  band(0, 4, 0.18); band(1, 3, 0.32);
  g.strokeStyle = '#cfd4da'; g.lineWidth = 1.5; g.beginPath(); hist.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.stroke();
  g.strokeStyle = color; g.lineWidth = 2; g.beginPath(); g.moveTo(X(L - 1), Y(S0));
  for (let k = 0; k < H; k++) g.lineTo(X(L + k), Y(q[2][k])); g.stroke();
  g.fillStyle = MUTED; g.textAlign = 'left'; g.fillText('history ←   → forecast (5–95%, 25–75%, median)', P.l + 6, h - 14);
}
function histogram(c, S0, a, b) {
  const { g, w, h } = setup(c), P = { l: 50, r: 10, t: 10, b: 24 }, B = 60;
  const lo = Math.min(Model.quant(a, .005), Model.quant(b, .005)), hi = Math.max(Model.quant(a, .995), Model.quant(b, .995));
  const bins = arr => { const n = new Array(B).fill(0); arr.forEach(v => { const i = Math.floor((v - lo) / (hi - lo) * B); if (i >= 0 && i < B) n[i]++; }); return n.map(x => x / arr.length); };
  const ha = bins(a), hb = bins(b), top = Math.max(...ha, ...hb) * 1.05;
  const X = v => P.l + (w - P.l - P.r) * (v - lo) / (hi - lo), Y = p => P.t + (h - P.t - P.b) * (1 - p / top);
  yGrid(g, P, w, h, 0, top, v => (v * 100).toFixed(1) + '%');
  const bw = (w - P.l - P.r) / B;
  [[ha, GREEN], [hb, ORANGE]].forEach(([hh, col]) => { g.fillStyle = col; g.globalAlpha = 0.5; hh.forEach((p, i) => g.fillRect(P.l + i * bw, Y(p), bw - 1, Y(0) - Y(p))); g.globalAlpha = 1; });
  g.fillStyle = MUTED; g.textAlign = 'center';
  for (let i = 0; i <= 5; i++) { const v = lo + (hi - lo) * i / 5; g.fillText('$' + v.toFixed(0), X(v), h - 8); }
  if (S0 > lo && S0 < hi) { g.strokeStyle = '#fff'; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(X(S0), P.t); g.lineTo(X(S0), h - P.b); g.stroke(); g.setLineDash([]); }
  g.textAlign = 'left'; g.fillStyle = GREEN; g.fillText('■ GBM', w - 120, P.t + 12); g.fillStyle = ORANGE; g.fillText('■ OU', w - 65, P.t + 12);
}
