// ===== Canvas charts (line + candlestick) and candle building / CSV export. =====
const Charts = {
  UP: '#3ddc97', DOWN: '#ff6b6b', INK: '#9aa7b8',
  time: t => new Date(t).toLocaleTimeString([], { hour12: false }),

  buildCandles(ticks, tf) { // tf in seconds; open = previous close so candles connect
    const out = []; let prev = CONFIG.startPrice, cur = null;
    for (const t of ticks) {
      const b = Math.floor(t.t / (tf * 1000));
      if (!cur || cur.b !== b) { cur = { b, t: b * tf * 1000, o: prev, h: prev, l: prev, c: t.price, v: 0 }; out.push(cur); }
      cur.h = Math.max(cur.h, t.price); cur.l = Math.min(cur.l, t.price); cur.c = t.price; cur.v += t.volume;
      prev = t.price;
    }
    return out;
  },

  frame(c, min, max, n, labelAt) {
    const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    c.width = r.width * d; c.height = r.height * d;
    const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
    const w = r.width, h = r.height, P = { l: 54, r: 10, t: 10, b: 20 };
    const pad = (max - min || 1) * 0.1; min -= pad; max += pad;
    const y = v => P.t + (max - v) / (max - min) * (h - P.t - P.b);
    const bw = (w - P.l - P.r) / Math.max(n, 1), x = i => P.l + (i + 0.5) * bw;
    g.font = '11px system-ui'; g.fillStyle = this.INK; g.strokeStyle = '#243044'; g.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const v = min + (max - min) * k / 4, yy = y(v);
      g.beginPath(); g.moveTo(P.l, yy); g.lineTo(w - P.r, yy); g.stroke();
      g.textAlign = 'right'; g.fillText(v.toFixed(2), P.l - 6, yy + 4); }
    g.textAlign = 'center';
    [0, Math.floor((n - 1) / 2), n - 1].forEach((i, k) => { if (n > 0) { g.textAlign = k === 0 ? 'left' : k === 2 ? 'right' : 'center';
      g.fillText(labelAt(i), k === 0 ? P.l : k === 2 ? w - P.r : x(i), h - 5); } });
    return { g, x, y, bw, w, h, P };
  },

  lastLine(f, price) {
    const { g, y, w, P } = f, yy = y(price);
    g.setLineDash([4, 4]); g.strokeStyle = '#f5c451'; g.beginPath(); g.moveTo(P.l, yy); g.lineTo(w - P.r, yy); g.stroke();
    g.setLineDash([]); g.fillStyle = '#f5c451'; g.textAlign = 'right'; g.fillText(price.toFixed(2), w - P.r - 2, yy - 4);
  },

  line(c, ticks, N = 150) {
    const d = ticks.slice(-N); if (!d.length) return;
    const ps = d.map(t => t.price), f = this.frame(c, Math.min(...ps), Math.max(...ps), d.length, i => this.time(d[i].t));
    f.g.strokeStyle = '#6aa9ff'; f.g.lineWidth = 2; f.g.beginPath();
    d.forEach((t, i) => i ? f.g.lineTo(f.x(i), f.y(t.price)) : f.g.moveTo(f.x(i), f.y(t.price))); f.g.stroke();
    this.lastLine(f, ps[ps.length - 1]);
  },

  candles(c, ticks, tf, N = 60) {
    const d = this.buildCandles(ticks, tf).slice(-N); if (!d.length) return;
    const f = this.frame(c, Math.min(...d.map(k => k.l)), Math.max(...d.map(k => k.h)), d.length, i => this.time(d[i].t));
    d.forEach((k, i) => {
      const col = k.c >= k.o ? this.UP : this.DOWN, xx = f.x(i), g = f.g;
      g.strokeStyle = g.fillStyle = col; g.lineWidth = 1;
      g.beginPath(); g.moveTo(xx, f.y(k.h)); g.lineTo(xx, f.y(k.l)); g.stroke();
      const top = f.y(Math.max(k.o, k.c)), hh = Math.max(1, Math.abs(f.y(k.o) - f.y(k.c)));
      g.fillRect(xx - f.bw * 0.35, top, f.bw * 0.7, hh);
    });
    this.lastLine(f, d[d.length - 1].c);
  },

  download(name, rows) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    a.download = name; a.click(); URL.revokeObjectURL(a.href);
  },
  exportTicks(ticks) {
    this.download('stock_price_per_clearing.csv', ['round,time_iso,price,volume,total_buy_qty,total_sell_qty',
      ...ticks.map(t => [t.round, new Date(t.t).toISOString(), t.price, t.volume, t.buyQty, t.sellQty].join(','))]);
  },
  exportCandles(ticks, tf) {
    this.download(`stock_candles_${tf}s.csv`, ['time_iso,open,high,low,close,volume',
      ...this.buildCandles(ticks, tf).map(k => [new Date(k.t).toISOString(), k.o, k.h, k.l, k.c, k.v].join(','))]);
  }
};
