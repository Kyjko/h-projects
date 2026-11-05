%%%-------------------------------------------------------------------
%%% @doc stock_server
%%%
%%% The module you actually call to boot the whole system by hand
%%% from an `erl' shell:
%%%
%%%   1> stock_server:start().
%%%
%%% This is deliberately NOT wrapped in an OTP `application' resource
%%% file, so that the whole project can be compiled and loaded module
%%% by module (e.g. with c/1 or code:load_file/1) and started with a
%%% single explicit function call, per the project's "keep it simple,
%%% keep it manual" design goal. See the README for the exact steps.
%%% @end
%%%-------------------------------------------------------------------
-module(stock_server).

-export([start/0, start/1, stop/0]).

-define(DEFAULT_CONFIG_PATH, "config/config.json").

%% @doc Starts the server using config/config.json.
-spec start() -> ok.
start() ->
    start(?DEFAULT_CONFIG_PATH).

%% @doc Starts the server using a config file at ConfigPath.
%%
%% Order of operations:
%%   1. start the stdlib applications we depend on (inets/ssl/crypto,
%%      for the outbound HTTPS calls made by stock_fetcher)
%%   2. load config.json
%%   3. start the supervision tree (MySQL connection, updater, HTTP server)
%%   4. make sure the "stocks" table exists
-spec start(file:filename()) -> ok.
start(ConfigPath) ->
    ok = ensure_dependencies_started(),
    _Config = stock_config:load(ConfigPath),
    {ok, _SupPid} = stock_sup:start_link(),
    ok = stock_db:create_tables(),
    Port = stock_config:get([http_port]),
    io:format("stock_server started - REST API listening on http://localhost:~p~n", [Port]),
    ok.

%% @doc Stops the server by shutting down its supervision tree.
-spec stop() -> ok.
stop() ->
    case whereis(stock_sup) of
        undefined -> ok;
        Pid -> exit(Pid, shutdown), ok
    end.

%%%===================================================================
%%% Internal
%%%===================================================================

ensure_dependencies_started() ->
    {ok, _} = application:ensure_all_started(crypto),
    {ok, _} = application:ensure_all_started(ssl),
    {ok, _} = application:ensure_all_started(inets),
    ok.
