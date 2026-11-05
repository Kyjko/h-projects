# stock_server

An example Erlang project that:

- periodically fetches stock **prices and traded volumes** for a list of
  tickers from a public, key-free financial data source, and stores the
  latest values in a local **MySQL** database;
- exposes a small **REST API** (JSON over HTTP) that client software can use
  to query historical prices, the current price, and a condensed
  description of a stock;
- is organised as a handful of small, single-purpose modules, each doing
  one logical thing, so it's easy to read top to bottom and easy to load
  by hand into a running Erlang VM.

It intentionally has exactly **one** third-party dependency
([`mysql-otp`](https://github.com/mysql-otp/mysql-otp), a pure-Erlang MySQL
driver). Everything else - the HTTP server, JSON encoding, concurrency,
periodic scheduling - is written directly on top of the Erlang/OTP
standard library so there is nothing "hidden" for you to dig through.

---

## 1. How it's organised

```
stock_server/
├── config/
│   ├── config.json        # all runtime configuration lives here
│   └── TICKERS.csv         # one ticker symbol per line
├── src/
│   ├── stock_server.erl    # entry point: stock_server:start().
│   ├── stock_sup.erl       # top-level supervisor
│   ├── stock_config.erl    # loads config.json, exposes stock_config:get/1
│   ├── stock_json.erl      # tiny dependency-free JSON encoder/decoder
│   ├── stock_util.erl      # small string/file helpers
│   ├── stock_db.erl        # MySQL connection + queries ("stocks" table)
│   ├── stock_fetcher.erl   # talks to the public data sources over HTTP
│   ├── stock_updater.erl   # gen_server: periodic price/volume refresh
│   ├── stock_http_server.erl # minimal raw-TCP HTTP server
│   └── stock_api.erl       # REST route -> response logic
├── rebar.config             # only used to fetch the mysql-otp dependency
└── README.md
```

Each module has exactly one job:

| Module               | Responsibility |
|----------------------|----------------|
| `stock_server`       | The module you call by hand to boot everything: `stock_server:start().` |
| `stock_sup`           | OTP supervisor. Restarts the DB connection, the updater, or the HTTP server independently if one of them crashes. |
| `stock_config`        | Reads `config.json` once and caches it (via `persistent_term`) so every other module can cheaply read config values without re-reading the file or threading a `Config` argument through every call. |
| `stock_json`          | Encodes Erlang maps/lists/numbers into JSON text and decodes JSON text back into Erlang terms. Used both for our own API responses and for parsing `config.json` and the Yahoo Finance JSON response. |
| `stock_util`          | Generic helpers: trimming/upper-casing binaries, splitting an HTTP path into segments, reading a line-based file (`TICKERS.csv`). |
| `stock_db`            | The **only** module that talks to MySQL. Starts the connection, creates the `stocks` table, and exposes `upsert_stock/3`, `get_stock/1`, `list_stocks/0`. |
| `stock_fetcher`       | The **only** module that talks to the public internet. Fetches and parses historical bars, the current quote, and a stock's public "description" fields. Knows nothing about HTTP responses to *our* clients or about MySQL. |
| `stock_updater`       | A `gen_server` that wakes up every `update_interval_ms` and refreshes every ticker's price/volume in MySQL. Spawns one process per ticker per cycle (see [Concurrency](#4-concurrency) below). |
| `stock_http_server`   | A minimal HTTP/1.1 server built directly on `gen_tcp`. Accepts connections, parses the request line, and hands the path off to `stock_api`. One process per connection. |
| `stock_api`           | Turns a URL path like `/AAPL/historical/1y` into a call to `stock_fetcher`/`stock_db` and a JSON response. This is the only module that knows the API's URL shape. |

This keeps the dependency direction one-way and easy to follow:

```
stock_http_server -> stock_api -> stock_fetcher (internet)
                                -> stock_db      (MySQL)
stock_updater      -> stock_fetcher (internet)
                    -> stock_db      (MySQL)
```

---

## 2. Where the data comes from

This is an example project, so it deliberately uses public endpoints that
need **no API key**, so you can clone it and run it immediately:

- **Historical bars & current quote**: [Stooq](https://stooq.com), which
  publishes free daily OHLCV data and live quotes as plain CSV.
- **Description**: Yahoo Finance's public (unofficial) quote endpoint,
  which returns whatever basic fields it has for a symbol (name,
  exchange, market cap, day/52-week range, etc.) as JSON.

Both are unofficial/free public endpoints - great for a demo, but they can
change shape or start rate-limiting you. `stock_fetcher` is the *only*
module that knows about them, so swapping in a different (e.g. paid,
authenticated) provider later only means editing that one file plus the
`data_source` URLs in `config.json`.

The `description` endpoint returns whatever fields the data source gives
us, as-is. As the code comment in `stock_fetcher.erl` notes, that raw map
is a natural future input to an LLM summarisation step - we just fetch and
pass through the data here.

---

## 3. The `stocks` table

`stock_db:create_tables/0` creates this table automatically on startup if
it doesn't already exist:

```sql
CREATE TABLE IF NOT EXISTS stocks (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  ticker      VARCHAR(45) NOT NULL UNIQUE,
  last_price  DOUBLE NULL,
  last_volume BIGINT NULL,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Every refresh cycle (see below), `stock_updater` calls
`stock_db:upsert_stock/3`, which does an `INSERT ... ON DUPLICATE KEY
UPDATE`, so the table always holds exactly one row per ticker with the
most recently fetched price and volume.

The `/{ticker}/current_price` endpoint reads from this table (fast, no
network round-trip), falling back to a live fetch only if the ticker
isn't in the table yet.

The database itself (e.g. `stocks_db`) is **not** created automatically -
create it once by hand (see setup below). Only the table is managed by
the application.

---

## 4. Concurrency

Two places specifically make use of Erlang's lightweight processes:

- **`stock_updater`**: every refresh cycle, it `spawn`s one short-lived
  process per ticker (`refresh_ticker/1`), each of which independently
  fetches that ticker's quote and writes it to MySQL. A slow or failing
  fetch for one ticker never delays or blocks the others.

- **`stock_http_server`**: the acceptor loop calls `gen_tcp:accept/1` and
  immediately `spawn`s a fresh process to handle that one connection
  before looping back to accept the next one. Every client is therefore
  served independently and concurrently.

---

## 5. REST API

Default port is `8080` (configurable via `config.json`'s `"http_port"`).
All responses are JSON.

### `GET /{ticker}/historical/{timeframe}`

Historical daily prices and traded volume for `{ticker}`.
`{timeframe}` is optional; `GET /{ticker}/historical` uses the
`"default_timeframe"` from `config.json` (defaults to `"max"`).

Supported timeframe values: `max`, `5y`, `1y`, `6m`, `3m`, `1m`, `5d`.

```
$ curl http://localhost:8080/AAPL/historical/1m
{
  "ticker": "AAPL",
  "timeframe": "1m",
  "bars": [
    {"date": "2024-05-15", "open": 187.5, "high": 189.2, "low": 186.9, "close": 188.6, "volume": 51230400},
    ...
  ]
}
```

### `GET /{ticker}/current_price`

The most recently fetched price and volume for `{ticker}`, as stored in
MySQL (falls back to a live fetch - and caches the result - if the ticker
hasn't been seen yet).

```
$ curl http://localhost:8080/AAPL/current_price
{"ticker": "AAPL", "last_price": 212.49, "last_volume": 60214860, "updated_at": "2024-06-14 22:05:11"}
```

### `GET /{ticker}/description`

A condensed set of publicly available facts about the stock (name,
exchange, market cap, and whatever else the data source exposes for that
symbol).

```
$ curl http://localhost:8080/AAPL/description
{"symbol": "AAPL", "shortName": "Apple Inc.", "exchange": "NMS", "marketCap": 3300000000000, ...}
```

Any unrecognised path returns `404` with `{"error": "unknown endpoint"}`.
Upstream failures (data source unreachable, rate-limited, etc.) return
`502` with an `"error"` field describing the failure.

---

## 6. Configuration (`config/config.json`)

```json
{
  "http_port": 8080,
  "mysql": {
    "host": "127.0.0.1",
    "port": 3306,
    "user": "root",
    "password": "password",
    "database": "stocks_db"
  },
  "tickers_file": "config/TICKERS.csv",
  "update_interval_ms": 300000,
  "default_timeframe": "max",
  "data_source": {
    "stooq_historical_url": "https://stooq.com/q/d/l/",
    "stooq_quote_url": "https://stooq.com/q/l/",
    "yahoo_quote_url": "https://query1.finance.yahoo.com/v7/finance/quote"
  }
}
```

Edit the `mysql` block to match your local MySQL instance, and edit
`config/TICKERS.csv` (one ticker per line) to change which stocks are
tracked.

---

## 7. Setup & running it

### 7.1 MySQL

Create the database once (the app creates the `stocks` table itself, but
not the database):

```sql
CREATE DATABASE stocks_db CHARACTER SET utf8mb4;
```

Update `config/config.json`'s `"mysql"` block with a user/password that
can connect to it.

### 7.2 Compiling

This project needs exactly one third-party dependency, the `mysql-otp`
driver, to talk to MySQL. The easiest way to fetch and compile it is
`rebar3`; your own code stays plain `.erl` files you can also compile
by hand with `erlc`.

```bash
# 1. Fetch + compile the mysql-otp dependency
rebar3 compile

# 2. Compile this project's own modules
erlc -o ebin src/*.erl
```

(If you'd rather not use rebar3 at all, clone
https://github.com/mysql-otp/mysql-otp yourself and compile it with
`erlc` into any directory - all that matters is that its `.beam` files
end up on the VM's code path, as shown below.)

### 7.3 Running it

Start an Erlang shell with both this project's `ebin/` and mysql-otp's
`ebin/` on the code path, then start the server by hand:

```bash
erl -pa ebin -pa _build/default/lib/mysql/ebin

1> stock_server:start().
stock_server started - REST API listening on http://localhost:8080
ok
```

That single call:

1. starts the `inets`/`ssl`/`crypto` applications (needed for the
   outbound HTTPS calls to the data sources),
2. loads `config/config.json`,
3. starts the supervision tree (MySQL connection, periodic updater, HTTP
   server),
4. creates the `stocks` table if it doesn't exist yet.

From here the server is live: it immediately does its first price/volume
refresh cycle, repeats every `update_interval_ms`, and its REST API is
reachable at `http://localhost:8080/...`.

To stop it:

```erlang
2> stock_server:stop().
```

Because nothing here is wrapped in an OTP `.app`/release, you're also
free to load and reload individual modules by hand while iterating, e.g.
`c(stock_api).` after editing `stock_api.erl`, followed by trying a
request again - no restart of the whole system required.

---

## 8. Notes & limitations (it's an example project)

- The public data sources used here are free and unauthenticated, which
  is great for getting started but means no uptime/rate-limit
  guarantees. Swap them out in `stock_fetcher.erl` for a paid provider
  for anything beyond a demo.
- There's no HTTPS, authentication, or rate limiting on the REST API
  itself - add a reverse proxy (nginx, etc.) in front of it if you expose
  it beyond localhost.
- Historical bars are fetched live from the data source on every request
  rather than cached in MySQL; only the latest price/volume per ticker is
  persisted, per the "stocks" table spec this project was built around.
- `stock_json` is a small, purpose-built JSON codec, not a
  fully spec-compliant parser - it's deliberately kept simple, matching
  the project's "keep it readable, keep it manual" goal.
