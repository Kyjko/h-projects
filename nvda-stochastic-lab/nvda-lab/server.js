// Zero-dependency static server + Yahoo Finance proxy (browsers can't call Yahoo directly: CORS).
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

async function prices(q, res) {
  const sym = (q.get('symbol') || 'NVDA').toUpperCase().replace(/[^A-Z0-9.\-^=]/g, '');
  const p1 = Math.floor(new Date(q.get('start')).getTime() / 1000);
  const p2 = Math.floor(new Date(q.get('end')).getTime() / 1000) + 86400;
  if (!Number.isFinite(p1) || !Number.isFinite(p2)) return json(res, 400, { error: 'Invalid dates' });
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?period1=${p1}&period2=${p2}&interval=1d&events=history`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error('Yahoo responded HTTP ' + r.status);
    const c = (await r.json()).chart.result[0];
    const adj = (c.indicators.adjclose && c.indicators.adjclose[0].adjclose) || c.indicators.quote[0].close;
    const out = [];
    c.timestamp.forEach((t, i) => { if (adj[i] != null) out.push({ date: new Date(t * 1000).toISOString().slice(0, 10), close: adj[i] }); });
    if (out.length < 30) throw new Error('Not enough data returned for this window');
    json(res, 200, out);
  } catch (e) { json(res, 502, { error: String(e.message || e) }); }
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/prices') return prices(u.searchParams, res);
  const rel = u.pathname === '/' ? 'index.html' : u.pathname;
  const file = path.normalize(path.join(PUB, rel));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`NVDA lab running at http://localhost:${PORT}`));
