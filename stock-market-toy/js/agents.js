// ===== AGENTS: edit behaviours here. =====
// Each agent's act(m) is called once per clearing round (at a random moment inside the window).
// It returns a list of orders. m = { price, prices[], bestBid, bestAsk }.
// Order helper: O('BUY', qty)        -> MARKET order (trade at any price)
//               O('SELL', qty, 101)  -> LIMIT order  (trade only at 101 or better)
// Agents have unlimited capital; holdings may go negative = short position.
const O = (side, qty, price = null) => ({
  side, qty, type: price == null ? 'MARKET' : 'LIMIT',
  price: price == null ? null : Util.round2(price)
});

class Agent {
  constructor(name) { this.name = name; this.kind = this.constructor.name.replace(/Trader|Agent/, '');
    this.holdings = 0; this.cash = 0; this.last = '—'; }
  act(m) { return []; }
  pnl(price) { return this.cash + this.holdings * price; }
}

// Random buys/sells of small size, limit prices scattered around the current price.
class NoiseTrader extends Agent {
  act(m) {
    if (Math.random() < 0.4) return [];
    const side = Util.pick(['BUY', 'SELL']), qty = Util.int(1, 10);
    if (Math.random() < 0.3) return [O(side, qty)];
    return [O(side, qty, m.price * (1 + Util.randn() * 0.004))];
  }
}

// Follows the trend: price rising over the last 5 rounds -> buys, falling -> sells.
class MomentumTrader extends Agent {
  act(m) {
    const p = m.prices; if (p.length < 6) return [];
    const trend = p[p.length - 1] / p[p.length - 6] - 1;
    if (Math.abs(trend) < 0.002) return [];
    const up = trend > 0;
    return [O(up ? 'BUY' : 'SELL', Util.int(5, 20), m.price * (1 + (up ? 0.002 : -0.002)))];
  }
}

// Believes in a fair value: sells when price is above it, buys when below.
class MeanReverter extends Agent {
  act(m) {
    const dev = (m.price - CONFIG.fundamental) / CONFIG.fundamental;
    if (Math.abs(dev) < 0.01) return [];
    const side = dev > 0 ? 'SELL' : 'BUY';
    return [O(side, Util.int(3, 3 + Math.round(Math.abs(dev) * 400)), m.price * (side === 'BUY' ? 0.999 : 1.001))];
  }
}

// Provides liquidity: always quotes a bid below and an ask above the price.
class MarketMaker extends Agent {
  act(m) {
    const s = Util.rand(0.003, 0.008);
    return [O('BUY', Util.int(5, 12), m.price * (1 - s)), O('SELL', Util.int(5, 12), m.price * (1 + s))];
  }
}

// Big player, controlled by the buttons in the UI: market-orders a large size each round.
class Whale extends Agent {
  constructor(n) { super(n); this.side = 'BUY'; this.roundsLeft = 0; this.size = 200; }
  start(side, rounds, size) { this.side = side; this.roundsLeft = rounds; this.size = size; }
  act(m) { if (this.roundsLeft <= 0) return []; this.roundsLeft--; return [O(this.side, this.size)]; }
}

class UserAgent extends Agent {} // "YOU" – orders come from the UI form

function createAgents() {
  const a = [];
  for (let i = 1; i <= 6; i++) a.push(new NoiseTrader('Noise-' + i));
  for (let i = 1; i <= 2; i++) a.push(new MomentumTrader('Momentum-' + i));
  for (let i = 1; i <= 2; i++) a.push(new MeanReverter('Reverter-' + i));
  for (let i = 1; i <= 2; i++) a.push(new MarketMaker('Maker-' + i));
  a.push(new Whale('Whale'));
  return a;
}
