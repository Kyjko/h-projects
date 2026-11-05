// Sanity test: simulate known GBM / OU, then check the fitters recover the parameters.
const M = require('./public/model.js'), assert = require('assert');
const z = M.normal(M.rng(42)), dt = M.DT, N = 20000;
let s = 100, g = [s]; for (let i = 0; i < N; i++) { s *= Math.exp((0.3 - 0.5 * 0.4 ** 2) * dt + 0.4 * Math.sqrt(dt) * z()); g.push(s); }
const fg = M.fitGBM(g); console.log('GBM fit', fg.mu.toFixed(3), fg.sigma.toFixed(3));
assert(Math.abs(fg.sigma - 0.4) < 0.02);
const th = 4, m = Math.log(100), sg = 0.5, e = Math.exp(-th * dt), v = sg * Math.sqrt((1 - e * e) / (2 * th));
let x = m, o = [Math.exp(x)]; for (let i = 0; i < N; i++) { x = m + (x - m) * e + v * z(); o.push(Math.exp(x)); }
const fo = M.fitOU(o); console.log('OU fit theta', fo.theta.toFixed(2), 'level', fo.level.toFixed(1), 'sigma', fo.sigma.toFixed(3));
assert(Math.abs(fo.sigma - sg) < 0.03 && Math.abs(fo.theta - th) < 1.5 && Math.abs(fo.level - 100) < 5);
// MC vs analytic
const S0 = 100, H = 126, K = 120, T = H * dt, gm = { type: 'GBM', nu: 0.1, sigma: 0.4 };
const A = M.analyze(M.simulate(gm, S0, H, 40000, 3), 40000, H, S0, [K]).probs[0];
console.log('GBM above MC', A.above.toFixed(3), 'analytic', M.gbmTerminalAbove(gm, S0, K, T).toFixed(3));
assert(Math.abs(A.above - M.gbmTerminalAbove(gm, S0, K, T)) < 0.01);
const om = { type: 'OU', theta: 3, m: Math.log(110), sigma: 0.4 };
const B = M.analyze(M.simulate(om, S0, H, 40000, 4), 40000, H, S0, [K]).probs[0];
console.log('OU above MC', B.above.toFixed(3), 'analytic', M.ouTerminalAbove(om, S0, K, T).toFixed(3));
assert(Math.abs(B.above - M.ouTerminalAbove(om, S0, K, T)) < 0.01);
console.log('All tests passed');
