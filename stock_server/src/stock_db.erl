%%%-------------------------------------------------------------------
%%% @doc stock_db
%%%
%%% Owns the connection to the local MySQL instance and exposes the
%%% handful of queries the rest of the application needs. All access
%%% to MySQL goes through this module - nothing else in the project
%%% talks to `mysql' directly.
%%%
%%% The connection process is started via mysql-otp's mysql:start_link/1
%%% and registered locally under `?CONN', which is what makes it easy
%%% to call mysql:query(?CONN, ...) from anywhere without passing a
%%% Pid around.
%%%
%%% NOTE: this module expects the *database* itself (e.g. "stocks_db")
%%% to already exist on the MySQL server - see the README for the
%%% one-line `CREATE DATABASE' you need to run once. It is happy to
%%% create the *tables* it needs on its own via create_tables/0.
%%% @end
%%%-------------------------------------------------------------------
-module(stock_db).

-export([start_link/0, create_tables/0, upsert_stock/3, get_stock/1, list_stocks/0]).

-define(CONN, stock_db_conn).

%% @doc Starts (and registers) the MySQL connection process, reading
%% connection details from config.json under the "mysql" key.
-spec start_link() -> {ok, pid()} | {error, term()}.
start_link() ->
    Options = [
        {host, binary_to_list(stock_config:get([mysql, host]))},
        {port, stock_config:get([mysql, port])},
        {user, binary_to_list(stock_config:get([mysql, user]))},
        {password, binary_to_list(stock_config:get([mysql, password]))},
        {database, binary_to_list(stock_config:get([mysql, database]))},
        {keep_alive, true}
    ],
    case mysql:start_link(Options) of
        {ok, Pid} ->
            true = erlang:register(?CONN, Pid),
            {ok, Pid};
        {error, Reason} ->
            {error, Reason}
    end.

%% @doc Creates the "stocks" table if it does not already exist.
%%
%% stocks:
%%   id          - primary key, auto increment
%%   ticker      - VARCHAR(45), unique ticker symbol (e.g. "AAPL")
%%   last_price  - last price fetched from the data source
%%   last_volume - last traded volume fetched from the data source
%%   updated_at  - timestamp of the last successful update
-spec create_tables() -> ok.
create_tables() ->
    Sql = <<
        "CREATE TABLE IF NOT EXISTS stocks ("
        "  id INT AUTO_INCREMENT PRIMARY KEY,"
        "  ticker VARCHAR(45) NOT NULL UNIQUE,"
        "  last_price DOUBLE NULL,"
        "  last_volume BIGINT NULL,"
        "  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"
        "    ON UPDATE CURRENT_TIMESTAMP"
        ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    >>,
    ok = mysql:query(?CONN, Sql),
    ok.

%% @doc Inserts a stock row, or updates last_price/last_volume if the
%% ticker already exists. This is what the periodic updater calls.
-spec upsert_stock(binary(), number() | null, number() | null) -> ok.
upsert_stock(Ticker, Price, Volume) ->
    Sql = <<
        "INSERT INTO stocks (ticker, last_price, last_volume) "
        "VALUES (?, ?, ?) "
        "ON DUPLICATE KEY UPDATE "
        "  last_price = VALUES(last_price), "
        "  last_volume = VALUES(last_volume)"
    >>,
    ok = mysql:query(?CONN, Sql, [Ticker, Price, Volume]),
    ok.

%% @doc Fetches the last known price/volume for a single ticker.
-spec get_stock(binary()) -> {ok, map()} | not_found | {error, term()}.
get_stock(Ticker) ->
    Sql = <<"SELECT ticker, last_price, last_volume, updated_at "
            "FROM stocks WHERE ticker = ?">>,
    case mysql:query(?CONN, Sql, [Ticker]) of
        {ok, _Cols, [[T, Price, Volume, UpdatedAt]]} ->
            {ok, #{ticker => T,
                   last_price => Price,
                   last_volume => Volume,
                   updated_at => format_datetime(UpdatedAt)}};
        {ok, _Cols, []} ->
            not_found;
        {error, Reason} ->
            {error, Reason}
    end.

%% @doc Returns every stock currently stored in the database. Handy
%% for debugging / an overview endpoint.
-spec list_stocks() -> {ok, [map()]} | {error, term()}.
list_stocks() ->
    Sql = <<"SELECT ticker, last_price, last_volume, updated_at FROM stocks ORDER BY ticker">>,
    case mysql:query(?CONN, Sql) of
        {ok, _Cols, Rows} ->
            {ok, [#{ticker => T, last_price => P, last_volume => V,
                    updated_at => format_datetime(U)} || [T, P, V, U] <- Rows]};
        {error, Reason} ->
            {error, Reason}
    end.

%% mysql-otp returns DATETIME/TIMESTAMP columns as {{Y,M,D},{H,Mi,S}}.
%% We turn that into a readable binary for JSON responses.
format_datetime(null) ->
    null;
format_datetime({{Y, M, D}, {H, Mi, S}}) ->
    iolist_to_binary(io_lib:format("~4..0B-~2..0B-~2..0B ~2..0B:~2..0B:~2..0B",
                                    [Y, M, D, H, Mi, S])).
