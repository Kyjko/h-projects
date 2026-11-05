'use strict';
// ---------- Black-Scholes ----------
const cnd = x => { const k = 1 / (1 + .2316419 * Math.abs(x)), a = [.31938153, -.356563782, 1.781477937, -1.821255978, 1.330274429];
  const p = 1 - Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) * k * (a[0] + k * (a[1] + k * (a[2] + k * (a[3] + k * a[4])))); return x < 0 ? 1 - p : p; };
const pdf = x => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
function price(type, S, K, T, r, v) {
  if (T <= 0) return Math.max(type === 'call' ? S - K : K - S, 0);
  const d1 = (Math.log(S / K) + (r + v * v / 2) * T) / (v * Math.sqrt(T)), d2 = d1 - v * Math.sqrt(T);
  return type === 'call' ? S * cnd(d1) - K * Math.exp(-r * T) * cnd(d2) : K * Math.exp(-r * T) * cnd(-d2) - S * cnd(-d1);
}
function greeks(type, S, K, T, r, v) {
  if (type === 'stock') return { delta: 1, gamma: 0, theta: 0, vega: 0, rho: 0 };
  if (T <= 0) return { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  const sq = Math.sqrt(T), d1 = (Math.log(S / K) + (r + v * v / 2) * T) / (v * sq), d2 = d1 - v * sq, c = type === 'call', e = Math.exp(-r * T);
  return { delta: c ? cnd(d1) : cnd(d1) - 1, gamma: pdf(d1) / (S * v * sq), vega: S * pdf(d1) * sq / 100,
    theta: (-S * pdf(d1) * v / (2 * sq) + (c ? -r * K * e * cnd(d2) : r * K * e * cnd(-d2))) / 365,
    rho: (c ? 1 : -1) * K * T * e * (c ? cnd(d2) : cnd(-d2)) / 100 * (c ? 1 : 1) };
}
// ---------- Data ----------
const TICKERS = { AAPL: [230, 28], MSFT: [420, 25], NVDA: [130, 52], TSLA: [250, 60], SPY: [560, 15] };
const STRATS = {
  'Long call': ['Bullish. Pay a premium for unlimited upside with loss capped at that premium.', [['call', 1, 1]]],
  'Short call': ['Neutral to bearish. Collect premium; risk is unlimited if the stock surges.', [['call', 1, -1]]],
  'Long put': ['Bearish, or insurance against a fall. Loss capped at the premium.', [['put', 1, 1]]],
  'Short put': ['Neutral to bullish. Collect premium; you may be forced to buy shares at the strike.', [['put', 1, -1]]],
  'Covered call': ['Own the stock and sell a call. Earns income, caps the upside.', [['stock', 0, 1], ['call', 1.05, -1]]],
  'Protective put': ['Own the stock and buy a put. Sets a floor under your losses for the cost of the premium.', [['stock', 0, 1], ['put', .95, 1]]],
  'Bull call spread': ['Moderately bullish. Cheaper than a long call, with capped profit.', [['call', .95, 1], ['call', 1.05, -1]]],
  'Bear put spread': ['Moderately bearish. Cheaper than a long put, with capped profit.', [['put', 1.05, 1], ['put', .95, -1]]],
  'Long straddle': ['Expect a big move in either direction. Pays off if the move exceeds the total premium.', [['call', 1, 1], ['put', 1, 1]]],
  'Long strangle': ['Like a straddle with cheaper out-of-the-money options and wider breakevens.', [['put', .95, 1], ['call', 1.05, 1]]],
  'Butterfly (calls)': ['Expect the stock to stay near the middle strike. Small cost, small capped profit.', [['call', .95, 1], ['call', 1, -2], ['call', 1.05, 1]]],
  'Iron condor': ['Expect a quiet stock. Collect premium; profit is highest between the inner strikes.', [['put', .9, 1], ['put', .95, -1], ['call', 1.05, -1], ['call', 1.1, 1]]],
};
const $ = s => document.querySelector(s);
const st = { legs: [], hover: null };
const P = () => ({ S: +$('#spot').value, v: +$('#vol').value / 100, r: +$('#rate').value / 100, D: Math.max(1, +$('#dte').value) });
const fmt = n => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
// ---------- Position math ----------
function legValue(l, S, t, p) { return l.type === 'stock' ? S : price(l.type, S, l.K, t, p.r, p.v); }
function entryCost(l, p) { return l.type === 'stock' ? p.S : price(l.type, p.S, l.K, p.D / 365, p.r, p.v); }
function pl(legs, S, t, p) { return legs.reduce((a, l) => a + l.q * (legValue(l, S, t, p) - entryCost(l, p)), 0); }
// ---------- Chart ----------
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function draw(cv, legs, p, opt) {
  const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const m = opt.mini ? { l: 8, r: 8, t: 8, b: 8 } : { l: 56, r: 16, t: 16, b: 30 };
  const x0 = p.S * .6, x1 = p.S * 1.4, N = 160, xs = [], e = [], n = [];
  const tNow = Math.max(0, (p.D - (opt.elapsed || 0)) / 365);
  for (let i = 0; i <= N; i++) { const S = x0 + (x1 - x0) * i / N; xs.push(S); e.push(pl(legs, S, 0, p)); if (!opt.mini) n.push(pl(legs, S, tNow, p)); }
  let lo = Math.min(0, ...e, ...n), hi = Math.max(0, ...e, ...n); const pad = (hi - lo) * .08 || 1; lo -= pad; hi += pad;
  const X = S => m.l + (S - x0) / (x1 - x0) * (W - m.l - m.r), Y = v => m.t + (hi - v) / (hi - lo) * (H - m.t - m.b), z = Y(0);
  const gain = css('--gain'), loss = css('--loss'), ink = css('--mute'), line = css('--line');
  g.font = '11px sans-serif'; g.fillStyle = ink; g.strokeStyle = line; g.lineWidth = 1;
  if (!opt.mini) {
    for (let i = 0; i <= 5; i++) { const v = lo + (hi - lo) * i / 5, y = Y(v); g.beginPath(); g.moveTo(m.l, y); g.lineTo(W - m.r, y); g.stroke(); g.textAlign = 'right'; g.fillText(v.toFixed(Math.abs(hi - lo) < 10 ? 2 : 0), m.l - 6, y + 4); }
    g.textAlign = 'center'; for (let i = 0; i <= 6; i++) { const S = x0 + (x1 - x0) * i / 6; g.fillText(S.toFixed(0), X(S), H - 10); }
  }
  g.strokeStyle = ink; g.beginPath(); g.moveTo(m.l, z); g.lineTo(W - m.r, z); g.stroke();
  const area = col, clipTop = top => { g.save(); g.beginPath(); g.rect(0, top ? 0 : z, W, top ? z : H); g.clip(); };
  function col() { g.beginPath(); g.moveTo(X(xs[0]), z); xs.forEach((S, i) => g.lineTo(X(S), Y(e[i]))); g.lineTo(X(xs[N]), z); g.closePath(); }
  clipTop(true); area(); g.globalAlpha = .22; g.fillStyle = gain; g.fill(); g.restore();
  clipTop(false); area(); g.globalAlpha = .22; g.fillStyle = loss; g.fill(); g.restore();
  g.lineWidth = 2.5; g.strokeStyle = gain; g.beginPath(); xs.forEach((S, i) => i ? g.lineTo(X(S), Y(e[i])) : g.moveTo(X(S), Y(e[i]))); g.stroke();
  if (!opt.mini && opt.elapsed >= 0) { g.setLineDash([6, 4]); g.strokeStyle = css('--acc'); g.beginPath(); xs.forEach((S, i) => i ? g.lineTo(X(S), Y(n[i])) : g.moveTo(X(S), Y(n[i]))); g.stroke(); g.setLineDash([]); }
  g.setLineDash([3, 4]); g.lineWidth = 1.5; g.strokeStyle = css('--spot'); g.beginPath(); g.moveTo(X(p.S), m.t); g.lineTo(X(p.S), H - m.b); g.stroke(); g.setLineDash([]);
  legs.filter(l => l.type !== 'stock').forEach(l => { if (l.K > x0 && l.K < x1) { g.fillStyle = ink; g.fillRect(X(l.K) - 1, H - m.b - 6, 2, 6); } });
  breakevens(legs, p).forEach(b => { if (b > x0 && b < x1) { g.fillStyle = css('--panel'); g.strokeStyle = ink; g.lineWidth = 2; g.beginPath(); g.arc(X(b), z, 4.5, 0, 7); g.fill(); g.stroke(); } });
  if (opt.mini) return;
  if (st.hover != null) {
    const S = x0 + (st.hover - m.l) / (W - m.l - m.r) * (x1 - x0);
    if (S >= x0 && S <= x1) { const a = pl(legs, S, 0, p), b = pl(legs, S, tNow, p), tx = `Stock ${S.toFixed(2)}  Expiry ${fmt(a)}  Today ${fmt(b)}`;
      g.strokeStyle = ink; g.lineWidth = 1; g.beginPath(); g.moveTo(X(S), m.t); g.lineTo(X(S), H - m.b); g.stroke();
      g.font = '12px sans-serif'; const w = g.measureText(tx).width + 12, bx = Math.min(Math.max(X(S) - w / 2, m.l), W - w - 4);
      g.fillStyle = css('--bg'); g.fillRect(bx, m.t, w, 22); g.fillStyle = css('--ink'); g.textAlign = 'left'; g.fillText(tx, bx + 6, m.t + 15); }
  }
}
function breakevens(legs, p) {
  const out = [], N = 1200, hiS = p.S * 3; let pS = 0, pV = pl(legs, 0, 0, p);
  for (let i = 1; i <= N; i++) { const S = hiS * i / N, v = pl(legs, S, 0, p); if (pV * v < 0 || (v === 0 && pV !== 0)) out.push(pS + (S - pS) * (0 - pV) / (v - pV)); pS = S; pV = v; }
  return out;
}
function summarize(legs, p) {
  const N = 1200, vals = []; for (let i = 0; i <= N; i++) vals.push(pl(legs, p.S * 3 * i / N, 0, p));
  const far = pl(legs, p.S * 10, 0, p) - pl(legs, p.S * 5, 0, p), mx = Math.max(...vals), mn = Math.min(...vals);
  return { maxP: far > 1e-6 ? 'Unlimited' : fmt(mx), maxL: far < -1e-6 ? 'Unlimited' : fmt(mn), be: breakevens(legs, p) };
}
// ---------- UI ----------
function renderLegs() {
  $('#legs').innerHTML = st.legs.map((l, i) => `<div class="leg">
    <select data-i="${i}" data-f="type"><option ${l.type === 'call' ? 'selected' : ''}>call</option><option ${l.type === 'put' ? 'selected' : ''}>put</option><option ${l.type === 'stock' ? 'selected' : ''}>stock</option></select>
    <input data-i="${i}" data-f="q" type="number" step="1" value="${l.q}" title="Quantity: positive = long, negative = short" aria-label="Quantity">
    <input data-i="${i}" data-f="K" type="number" step="0.5" value="${l.K}" ${l.type === 'stock' ? 'disabled' : ''} aria-label="Strike">
    <span data-prem="${i}"></span><button type="button" data-del="${i}" aria-label="Remove leg">×</button></div>`).join('');
}
function update() {
  const p = P(); $('#elapsed').max = p.D; if (+$('#elapsed').value > p.D) $('#elapsed').value = p.D;
  const el = +$('#elapsed').value; $('#elapsedLbl').textContent = `${el} of ${p.D}`;
  const legs = st.legs.filter(l => l.q !== 0 && (l.type === 'stock' || l.K > 0));
  st.legs.forEach((l, i) => { const s = document.querySelector(`[data-prem="${i}"]`); if (s) s.textContent = l.type === 'stock' ? fmt(p.S) : fmt(entryCost(l, p)); });
  draw($('#main'), legs, p, { elapsed: el });
  const s = summarize(legs, p), cost = legs.reduce((a, l) => l.type === 'stock' ? a : a + l.q * entryCost(l, p), 0);
  const G = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  legs.forEach(l => { const g = greeks(l.type, p.S, l.K, p.D / 365, p.r, p.v); for (const k in G) G[k] += l.q * g[k]; });
  const card = (a, b) => `<div><span>${a}</span><b>${b}</b></div>`;
  $('#metrics').innerHTML = card(cost >= 0 ? 'Net debit (options)' : 'Net credit (options)', fmt(Math.abs(cost))) + card('Max profit', s.maxP) + card('Max loss', s.maxL) +
    card('Breakeven at expiry', s.be.length ? s.be.map(b => b.toFixed(2)).join(' / ') : 'None') +
    card('Delta', G.delta.toFixed(3)) + card('Gamma', G.gamma.toFixed(4)) + card('Theta / day', fmt(G.theta)) + card('Vega / 1% vol', fmt(G.vega)) + card('Rho / 1% rate', fmt(G.rho));
}
function loadStrategy(name) {
  const p = P(); $('#stratDesc').textContent = STRATS[name][0];
  st.legs = STRATS[name][1].map(([type, m, q]) => ({ type, K: Math.round(p.S * m), q })); renderLegs(); update();
}
function setTicker(t) { const [s, v] = TICKERS[t]; $('#spot').value = s; $('#vol').value = v; loadStrategy($('#strategy').value); }
function init() {
  $('#ticker').innerHTML = Object.keys(TICKERS).map(t => `<option>${t}</option>`).join('');
  $('#strategy').innerHTML = Object.keys(STRATS).map(t => `<option>${t}</option>`).join('');
  $('#rate').value = 4.5; $('#dte').value = 45; setTicker('AAPL');
  $('#ticker').onchange = e => setTicker(e.target.value);
  $('#strategy').onchange = e => loadStrategy(e.target.value);
  ['spot', 'vol', 'rate', 'dte', 'elapsed'].forEach(id => $('#' + id).addEventListener('input', update));
  $('#spot').addEventListener('change', () => loadStrategy($('#strategy').value));
  $('#addLeg').onclick = () => { st.legs.push({ type: 'call', K: Math.round(P().S), q: 1 }); renderLegs(); update(); };
  $('#legs').addEventListener('input', e => { const { i, f } = e.target.dataset; if (i == null) return; const l = st.legs[i];
    l[f] = f === 'type' ? e.target.value : +e.target.value; if (f === 'type') renderLegs(); update(); });
  $('#legs').addEventListener('click', e => { const d = e.target.dataset.del; if (d != null) { st.legs.splice(d, 1); renderLegs(); update(); } });
  const c = $('#main'); c.addEventListener('mousemove', e => { st.hover = e.clientX - c.getBoundingClientRect().left; update(); });
  c.addEventListener('mouseleave', () => { st.hover = null; update(); });
  addEventListener('resize', () => { update(); blocks(); });
  blocks();
}
function blocks() {
  const defs = [['Long call', 'call', 1, 'Buy the right to buy. Loss limited to the premium, profit unlimited above K + premium.'],
    ['Short call', 'call', -1, 'Sell the right to buy. Keep the premium if the stock stays below K; unlimited loss above breakeven.'],
    ['Long put', 'put', 1, 'Buy the right to sell. Loss limited to the premium, profit grows as the stock falls below K − premium.'],
    ['Short put', 'put', -1, 'Sell the right to sell. Keep the premium if the stock stays above K; loss grows as it falls.']];
  const box = $('#blocks'); if (!box.children.length) box.innerHTML = defs.map(d => `<figure><h3>${d[0]}</h3><canvas></canvas><figcaption>${d[3]}</figcaption></figure>`).join('');
  const p = { S: 100, v: .3, r: .045, D: 30 };
  defs.forEach((d, i) => draw(box.children[i].querySelector('canvas'), [{ type: d[1], K: 100, q: d[2] }], p, { mini: true }));
}
init();
