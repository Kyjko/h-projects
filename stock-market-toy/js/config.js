// ===== Global settings & small helpers. Tweak numbers here. =====
const CONFIG = {
  startPrice: 100,      // initial price of STOCK
  fundamental: 100,     // "fair value" that MeanReverter agents believe in
  maxOrderAge: 6,       // unfilled LIMIT orders are cancelled after this many clearings
  warmupRounds: 60,     // fake history generated at start so the charts aren't empty
  maxHistory: 5000
};
const Util = {
  rand: (a, b) => a + Math.random() * (b - a),
  int: (a, b) => Math.floor(Util.rand(a, b + 1)),
  pick: arr => arr[Math.floor(Math.random() * arr.length)],
  round2: x => Math.round(x * 100) / 100,
  randn() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); } // normal(0,1)
};
