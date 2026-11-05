// ===== THE MARKET: order collection + batch clearing (call auction). =====
// Orders pile up for one interval. At clearing time we pick the single price that lets the
// MOST shares change hands (ties -> price closest to the last price). Every buyer willing to
// pay >= that price is matched with every seller willing to accept <= it, all at that price.
// Unfilled LIMIT orders rest in the book (until they age out); unfilled MARKET orders expire.
class Market {
  constructor() { this.last = CONFIG.startPrice; this.pending = []; this.resting = [];
    this.ticks = []; this.round = 0; this.nextId = 1; }

  submit(agent, s) {
    if (!(s.qty > 0)) return null;
    const o = { id: this.nextId++, owner: agent, side: s.side, type: s.type, price: s.price,
                qty: s.qty, remaining: s.qty, age: 0 };
    this.pending.push(o);
    agent.last = `${s.side} ${s.qty} ${s.type === 'MARKET' ? '@MKT' : '@' + s.price.toFixed(2)}`;
    return o;
  }

  // what agents are allowed to see
  view() {
    const lim = side => this.resting.filter(o => o.side === side && o.type === 'LIMIT').map(o => o.price);
    return { price: this.last, prices: this.ticks.map(t => t.price),
             bestBid: Math.max(...lim('BUY'), -Infinity), bestAsk: Math.min(...lim('SELL'), Infinity) };
  }

  eff(o) { return o.type === 'MARKET' ? (o.side === 'BUY' ? Infinity : 0) : o.price; } // worst acceptable price

  clear(t = Date.now()) {
    this.round++;
    const all = [...this.resting, ...this.pending]; this.pending = [];
    const bids = all.filter(o => o.side === 'BUY').sort((a, b) => this.eff(b) - this.eff(a) || a.id - b.id);
    const asks = all.filter(o => o.side === 'SELL').sort((a, b) => this.eff(a) - this.eff(b) || a.id - b.id);
    const sum = l => l.reduce((s, o) => s + o.remaining, 0);

    const cands = new Set([this.last]);
    all.forEach(o => o.type === 'LIMIT' && cands.add(o.price));
    let best = null;
    for (const p of cands) {
      const d = sum(bids.filter(o => this.eff(o) >= p)), s = sum(asks.filter(o => this.eff(o) <= p));
      const v = Math.min(d, s);
      if (v > 0 && (!best || v > best.v || (v === best.v && Math.abs(p - this.last) < Math.abs(best.p - this.last))))
        best = { p, v };
    }
    const buyQty = sum(bids), sellQty = sum(asks);
    if (best) {
      const fill = (list, ok) => { let left = best.v;
        for (const o of list) { if (left <= 0 || !ok(o)) break;
          const q = Math.min(o.remaining, left), sg = o.side === 'BUY' ? 1 : -1;
          o.remaining -= q; left -= q; o.owner.holdings += sg * q; o.owner.cash -= sg * q * best.p; } };
      fill(bids, o => this.eff(o) >= best.p); fill(asks, o => this.eff(o) <= best.p);
      this.last = best.p;
    }
    this.ticks.push({ round: this.round, t, price: this.last, volume: best ? best.v : 0, buyQty, sellQty });
    if (this.ticks.length > CONFIG.maxHistory) this.ticks.shift();
    this.resting = all.filter(o => o.remaining > 0 && o.type === 'LIMIT' && ++o.age < CONFIG.maxOrderAge);
  }

  // aggregated order book (resting + currently piling-up orders)
  book() {
    const L = new Map(); let mb = 0, ms = 0;
    [...this.resting, ...this.pending].forEach(o => {
      if (o.type === 'MARKET') { o.side === 'BUY' ? mb += o.remaining : ms += o.remaining; return; }
      const l = L.get(o.price) || { p: o.price, buy: 0, sell: 0, you: false };
      l[o.side === 'BUY' ? 'buy' : 'sell'] += o.remaining;
      if (o.owner instanceof UserAgent) l.you = true;
      L.set(o.price, l);
    });
    const lv = [...L.values()];
    return { bids: lv.filter(l => l.buy).sort((a, b) => b.p - a.p),
             asks: lv.filter(l => l.sell).sort((a, b) => a.p - b.p), mb, ms };
  }
}
