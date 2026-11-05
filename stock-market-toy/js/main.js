// ===== UI wiring + main loop. Agents act at random moments inside each window; the market clears at its end. =====
(function () {
  const $ = id => document.getElementById(id);
  const market = new Market(), agents = createAgents(), you = new UserAgent('YOU');
  const whale = agents.find(a => a instanceof Whale);
  let intervalMs = 5000, paused = false, pauseAt = 0, roundStart = performance.now(), sched = [];

  const runAgent = a => a.act(market.view()).forEach(o => market.submit(a, o));
  const newRound = () => { roundStart = performance.now();
    sched = agents.map(a => ({ a, at: Util.rand(0, 0.85), done: false })); };

  // warm-up history (instant, with synthetic timestamps)
  const base = Date.now() - CONFIG.warmupRounds * intervalMs;
  for (let i = 0; i < CONFIG.warmupRounds; i++) { agents.forEach(runAgent); market.clear(base + i * intervalMs); }
  newRound(); $('lprice').value = market.last.toFixed(2);

  const tf = () => +$('tf').value;
  function drawCharts() { Charts.line($('line'), market.ticks); Charts.candles($('candles'), market.ticks, tf()); }

  function renderBook() {
    const b = market.book(), asks = b.asks.slice(0, 8).reverse(), bids = b.bids.slice(0, 8);
    const mx = Math.max(1, ...asks.map(l => l.sell), ...bids.map(l => l.buy));
    const row = (cls, l, q) => `<div class="row ${cls}"><i style="width:${q / mx * 100}%"></i><span>${l.p.toFixed(2)}${l.you ? ' ◀ you' : ''}</span><span>${q}</span></div>`;
    $('book').innerHTML = `<div class="row hd"><span>Price</span><span>Shares</span></div>`
      + asks.map(l => row('ask', l, l.sell)).join('')
      + `<div class="mid">Last ${market.last.toFixed(2)}<br><small>Market orders waiting: ${b.mb} buy · ${b.ms} sell</small></div>`
      + bids.map(l => row('bid', l, l.buy)).join('');
  }
  function renderAgents() {
    $('agents').innerHTML = '<tr><th>Agent</th><th>Type</th><th>Shares</th><th>Cash</th><th>P&amp;L</th><th>Last order</th></tr>'
      + [...agents, you].map(a => `<tr${a === you ? ' class="you"' : ''}><td>${a.name}</td><td>${a.kind}</td>
        <td class="${a.holdings < 0 ? 'neg' : 'pos'}">${a.holdings}${a.holdings < 0 ? ' (short)' : ''}</td>
        <td>${a.cash.toFixed(0)}</td><td class="${a.pnl(market.last) < 0 ? 'neg' : 'pos'}">${a.pnl(market.last).toFixed(0)}</td><td>${a.last}</td></tr>`).join('');
  }
  function renderLog() {
    $('log').innerHTML = '<tr><th>#</th><th>Price</th><th>Traded</th><th>Buy qty</th><th>Sell qty</th></tr>'
      + market.ticks.slice(-8).reverse().map(t => `<tr><td>${t.round}</td><td>${t.price.toFixed(2)}</td><td>${t.volume}</td><td>${t.buyQty}</td><td>${t.sellQty}</td></tr>`).join('');
  }
  function renderHeader() {
    const n = market.ticks.length, p = market.last, d = n > 1 ? p - market.ticks[n - 2].price : 0;
    $('price').textContent = p.toFixed(2);
    $('chg').textContent = (d >= 0 ? '+' : '') + d.toFixed(2); $('chg').className = d >= 0 ? 'pos' : 'neg';
  }
  function afterClear() { drawCharts(); renderHeader(); renderLog(); }

  function step() {
    if (paused) return;
    const el = (performance.now() - roundStart) / intervalMs;
    sched.forEach(s => { if (!s.done && el >= s.at) { s.done = true; runAgent(s.a); } });
    if (el >= 1) { market.clear(Date.now()); newRound(); afterClear(); }
    $('bar').style.width = Math.min(el, 1) * 100 + '%';
    renderBook(); renderAgents();
  }

  const msg = t => $('msg').textContent = t;
  $('send').onclick = () => {
    const side = $('side').value, type = $('otype').value, qty = +$('qty').value, price = +$('lprice').value;
    if (!(qty > 0)) return msg('Enter a quantity above 0.');
    if (type === 'LIMIT' && !(price > 0)) return msg('Enter a limit price above 0.');
    market.submit(you, { side, type, qty, price: type === 'LIMIT' ? Util.round2(price) : null });
    msg(`Queued: ${you.last}. It trades (or rests) at the next clearing.`); renderBook(); renderAgents();
  };
  $('otype').onchange = () => $('lprice').disabled = $('otype').value === 'MARKET';
  $('speed').oninput = e => { intervalMs = +e.target.value * 1000; $('speedv').textContent = e.target.value + 's'; };
  $('pause').onclick = () => { paused = !paused; $('pause').textContent = paused ? 'Resume' : 'Pause';
    if (paused) pauseAt = performance.now(); else roundStart += performance.now() - pauseAt; };
  $('tf').onchange = drawCharts;
  $('wbuy').onclick = () => whale.start('BUY', +$('wrounds').value, +$('wsize').value);
  $('wsell').onclick = () => whale.start('SELL', +$('wrounds').value, +$('wsize').value);
  $('wstop').onclick = () => whale.roundsLeft = 0;
  $('csv1').onclick = () => Charts.exportTicks(market.ticks);
  $('csv2').onclick = () => Charts.exportCandles(market.ticks, tf());
  window.addEventListener('resize', drawCharts);

  afterClear(); renderBook(); renderAgents(); setInterval(step, 100);
})();
