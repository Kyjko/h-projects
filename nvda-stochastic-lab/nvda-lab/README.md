# NVDA Stochastic Lab

Fits **GBM** and an **Ornstein-Uhlenbeck (OU) process on log-price** to historical daily closes
(Yahoo Finance), then Monte-Carlo simulates both to produce forecast fans, terminal price
distributions, and probabilities of ending above / touching price levels.

## Run
```
npm start        # needs Node 18+, no npm install required
```
Open http://localhost:3000, choose a fit window, horizon and price levels, click **Fetch & fit**.
`npm test` checks parameter recovery and Monte-Carlo vs closed-form results.

## Method
- Both models are fitted by exact-discretisation maximum likelihood on daily transitions (Δt = 1/252).
  - GBM: σ = std(log-returns)/√Δt, μ = mean(log-returns)/Δt + σ²/2.
  - OU: AR(1) regression X(t+1) = a + b·X(t) + ε on X = ln S, then θ = −ln(b)/Δt, m = a/(1−b), σ from residual variance.
  - Log-likelihood/AIC are comparable because both are likelihoods of the same transitions.
- Probabilities: Monte-Carlo (daily steps) plus closed forms (terminal probabilities for both;
  continuous barrier-touch probability for GBM).

## Files
`server.js` static server + Yahoo proxy (browsers are blocked by CORS) · `public/model.js` maths ·
`public/main.js` UI & canvas charts · `test.js` sanity tests.

Educational only; not financial advice.
