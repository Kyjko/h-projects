// Stochastic models: GBM and Ornstein-Uhlenbeck (on log-price). Works in browser and Node.
(function (root) {
  'use strict';
  const DT = 1 / 252; // one trading day in years

  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  function erf(x) { // Abramowitz-Stegun 7.1.26
    const s = Math.sign(x); x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  }
  const Phi = x => 0.5 * (1 + erf(x / Math.SQRT2));

  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function normal(u) { // Box-Muller with cached spare
    let spare = null;
    return () => {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let a = 0; while (a === 0) a = u();
      const r = Math.sqrt(-2 * Math.log(a)), th = 2 * Math.PI * u();
      spare = r * Math.sin(th); return r * Math.cos(th);
    };
  }

  // ---------- Fitting (exact-discretisation maximum likelihood) ----------
  const gaussLL = (ssr, n) => -0.5 * n * (Math.log(2 * Math.PI * ssr / n) + 1); // at MLE variance

  function fitGBM(prices) {
    const X = prices.map(Math.log), d = [];
    for (let i = 1; i < X.length; i++) d.push(X[i] - X[i - 1]);
    const n = d.length, m = mean(d);
    const ssr = d.reduce((s, x) => s + (x - m) ** 2, 0);
    const sigma = Math.sqrt(ssr / n / DT);          // MLE
    const nu = m / DT;                               // drift of log price = mu - sigma^2/2
    const mu = nu + 0.5 * sigma * sigma;
    const ll = gaussLL(ssr, n);
    return { type: 'GBM', mu, sigma, nu, ll, aic: 2 * 3 - 2 * ll, n };
  }

  // dX = theta (m - X) dt + sigma dW  =>  X_{t+1} = a + b X_t + eps,  b = e^{-theta dt}
  function fitOU(prices) {
    const X = prices.map(Math.log), n = X.length - 1;
    const x = X.slice(0, n), y = X.slice(1);
    const mx = mean(x), my = mean(y);
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
    const b = sxy / sxx, a = my - b * mx;
    let ssr = 0; for (let i = 0; i < n; i++) ssr += (y[i] - a - b * x[i]) ** 2;
    const s2 = ssr / n, ll = gaussLL(ssr, n);
    let theta, m, sigma, meanReverting = b > 0 && b < 1;
    if (meanReverting) {
      theta = -Math.log(b) / DT; m = a / (1 - b);
      sigma = Math.sqrt(s2 * 2 * theta / (1 - b * b));
    } else { // no detectable mean reversion: degenerate to (almost) Brownian motion
      theta = 1e-6; m = X[X.length - 1]; sigma = Math.sqrt(s2 / DT);
    }
    return { type: 'OU', theta, m, level: Math.exp(m), sigma, halfLifeDays: Math.LN2 / theta * 252, b, meanReverting, ll, aic: 2 * 3 - 2 * ll, n };
  }

  // ---------- Monte Carlo ----------
  function simulate(fit, S0, H, N, seed) {
    const z = normal(rng(seed)), paths = new Float32Array(N * H), x0 = Math.log(S0);
    let step;
    if (fit.type === 'GBM') {
      const dr = fit.nu * DT, vol = fit.sigma * Math.sqrt(DT);
      step = (X) => X + dr + vol * z();
    } else {
      const e = Math.exp(-fit.theta * DT), vol = fit.sigma * Math.sqrt(-Math.expm1(-2 * fit.theta * DT) / (2 * fit.theta));
      step = (X) => fit.m + (X - fit.m) * e + vol * z();
    }
    for (let i = 0; i < N; i++) { let X = x0; for (let k = 0; k < H; k++) { X = step(X); paths[i * H + k] = Math.exp(X); } }
    return paths;
  }

  const quant = (sorted, p) => { const i = p * (sorted.length - 1), lo = Math.floor(i), f = i - lo; return sorted[lo] * (1 - f) + (sorted[Math.min(lo + 1, sorted.length - 1)]) * f; };

  function analyze(paths, N, H, S0, levels) {
    const qs = [.05, .25, .5, .75, .95], q = qs.map(() => new Float64Array(H)), col = new Float64Array(N);
    const maxs = new Float64Array(N).fill(-Infinity), mins = new Float64Array(N).fill(Infinity);
    for (let k = 0; k < H; k++) {
      for (let i = 0; i < N; i++) { const v = paths[i * H + k]; col[i] = v; if (v > maxs[i]) maxs[i] = v; if (v < mins[i]) mins[i] = v; }
      const s = col.slice().sort(); qs.forEach((p, j) => { q[j][k] = quant(s, p); });
    }
    const term = new Float64Array(N); for (let i = 0; i < N; i++) term[i] = paths[i * H + H - 1]; term.sort();
    const probs = levels.map(K => {
      let above = 0, touch = 0;
      for (let i = 0; i < N; i++) { if (term[i] > K) above++; if (K >= S0 ? maxs[i] >= K : mins[i] <= K) touch++; }
      return { K, above: above / N, touch: touch / N };
    });
    return { q, term, probs, mean: mean(Array.from(term)) };
  }

  // ---------- Closed forms ----------
  function gbmTerminalAbove(f, S0, K, T) { return 1 - Phi((Math.log(K / S0) - f.nu * T) / (f.sigma * Math.sqrt(T))); }
  function gbmTouch(f, S0, K, T) { // continuous monitoring, reflection principle
    const b = Math.log(K / S0), v = f.nu, s = f.sigma, st = s * Math.sqrt(T), c = Math.exp(2 * v * b / (s * s));
    if (b === 0) return 1;
    return b > 0 ? Phi((v * T - b) / st) + c * Phi((-b - v * T) / st) : Phi((b - v * T) / st) + c * Phi((b + v * T) / st);
  }
  function ouTerminalAbove(f, S0, K, T) {
    const mT = f.m + (Math.log(S0) - f.m) * Math.exp(-f.theta * T);
    const vT = f.sigma ** 2 * (-Math.expm1(-2 * f.theta * T)) / (2 * f.theta);
    return 1 - Phi((Math.log(K) - mT) / Math.sqrt(vT));
  }

  const api = { DT, fitGBM, fitOU, simulate, analyze, quant, rng, normal, Phi, gbmTerminalAbove, gbmTouch, ouTerminalAbove };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Model = api;
})(typeof window !== 'undefined' ? window : globalThis);
