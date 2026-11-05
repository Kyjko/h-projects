%%%-------------------------------------------------------------------
%%% @doc stock_updater
%%%
%%% A gen_server that wakes up on a fixed interval (config.json's
%%% "update_interval_ms") and refreshes the "stocks" table in MySQL
%%% with the latest price/volume for every ticker in TICKERS.csv.
%%%
%%% Concurrency: every refresh cycle spawns one lightweight process
%%% per ticker so that a slow or unresponsive data source for one
%%% stock never delays the others. This is a natural fit for Erlang's
%%% process model - a handful of tickers becomes a handful of cheap,
%%% independent processes that fetch and write in parallel.
%%% @end
%%%-------------------------------------------------------------------
-module(stock_updater).
-behaviour(gen_server).

-export([start_link/0, refresh_now/0]).
-export([init/1, handle_call/3, handle_cast/2, handle_info/2,
         terminate/2, code_change/3]).

%%%===================================================================
%%% API
%%%===================================================================

-spec start_link() -> {ok, pid()} | {error, term()}.
start_link() ->
    gen_server:start_link({local, ?MODULE}, ?MODULE, [], []).

%% @doc Triggers an immediate refresh cycle without waiting for the timer.
-spec refresh_now() -> ok.
refresh_now() ->
    ?MODULE ! refresh,
    ok.

%%%===================================================================
%%% gen_server callbacks
%%%===================================================================

init([]) ->
    %% Kick off the first refresh right away, then let handle_info
    %% reschedule itself every update_interval_ms.
    self() ! refresh,
    {ok, #{}}.

handle_info(refresh, State) ->
    refresh_all(),
    IntervalMs = stock_config:get([update_interval_ms]),
    erlang:send_after(IntervalMs, self(), refresh),
    {noreply, State};
handle_info(_Other, State) ->
    {noreply, State}.

handle_call(_Request, _From, State) ->
    {reply, ok, State}.

handle_cast(_Msg, State) ->
    {noreply, State}.

terminate(_Reason, _State) ->
    ok.

code_change(_OldVsn, State, _Extra) ->
    {ok, State}.

%%%===================================================================
%%% Internal
%%%===================================================================

refresh_all() ->
    Tickers = stock_config:tickers(),
    lists:foreach(fun(Ticker) -> spawn(fun() -> refresh_ticker(Ticker) end) end, Tickers).

refresh_ticker(Ticker) ->
    case stock_fetcher:fetch_current_price(Ticker) of
        {ok, #{price := Price, volume := Volume}} ->
            stock_db:upsert_stock(Ticker, numeric_or_null(Price), numeric_or_null(Volume)),
            log(info, "updated ~s -> price=~p volume=~p", [Ticker, Price, Volume]);
        {error, Reason} ->
            log(warning, "failed to update ~s: ~p", [Ticker, Reason])
    end.

numeric_or_null(N) when is_number(N) -> N;
numeric_or_null(_Other) -> null.

log(info, Fmt, Args) -> error_logger:info_msg("stock_updater: " ++ Fmt ++ "~n", Args);
log(warning, Fmt, Args) -> error_logger:warning_msg("stock_updater: " ++ Fmt ++ "~n", Args).
