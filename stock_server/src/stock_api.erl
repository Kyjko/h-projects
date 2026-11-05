%%%-------------------------------------------------------------------
%%% @doc stock_api
%%%
%%% Implements the REST API's routing and response-building logic.
%%% stock_http_server hands us a decoded URL path, we return
%%% {StatusCode, JsonBody}. This module is the only place that knows
%%% what the API's URL shape looks like.
%%%
%%% Routes:
%%%
%%%   GET /{ticker}/historical            -> historical bars, default timeframe
%%%   GET /{ticker}/historical/{timeframe} -> historical bars for a timeframe
%%%   GET /{ticker}/current_price          -> last known price/volume
%%%   GET /{ticker}/description            -> condensed public info about the stock
%%% @end
%%%-------------------------------------------------------------------
-module(stock_api).

-export([handle/1]).

%% @doc Entry point called by stock_http_server for every request.
-spec handle(binary()) -> {integer(), binary()}.
handle(PathBin) ->
    route(stock_util:split_path(PathBin)).

route([TickerRaw, <<"historical">>]) ->
    DefaultTimeframe = stock_config:get([default_timeframe]),
    historical_response(TickerRaw, DefaultTimeframe);
route([TickerRaw, <<"historical">>, Timeframe]) ->
    historical_response(TickerRaw, Timeframe);
route([TickerRaw, <<"current_price">>]) ->
    current_price_response(TickerRaw);
route([TickerRaw, <<"description">>]) ->
    description_response(TickerRaw);
route([]) ->
    ok_body(#{<<"service">> => <<"stock_server">>,
              <<"usage">> => [<<"/{ticker}/historical/{timeframe}">>,
                               <<"/{ticker}/current_price">>,
                               <<"/{ticker}/description">>]});
route(_Other) ->
    {404, stock_json:encode(#{<<"error">> => <<"unknown endpoint">>})}.

%%%===================================================================
%%% Route handlers
%%%===================================================================

historical_response(TickerRaw, Timeframe) ->
    Ticker = stock_util:to_upper(TickerRaw),
    case stock_fetcher:fetch_historical(Ticker, Timeframe) of
        {ok, Bars} ->
            ok_body(#{<<"ticker">> => Ticker,
                      <<"timeframe">> => Timeframe,
                      <<"bars">> => Bars});
        {error, Reason} ->
            error_body(502, Reason)
    end.

current_price_response(TickerRaw) ->
    Ticker = stock_util:to_upper(TickerRaw),
    case stock_db:get_stock(Ticker) of
        {ok, Row} ->
            ok_body(Row);
        not_found ->
            %% We haven't cached this ticker yet (e.g. it isn't in
            %% TICKERS.csv) - fetch it live instead of failing, and
            %% opportunistically store it so future requests are fast.
            fetch_and_cache_price(Ticker);
        {error, Reason} ->
            error_body(500, Reason)
    end.

fetch_and_cache_price(Ticker) ->
    case stock_fetcher:fetch_current_price(Ticker) of
        {ok, #{price := Price, volume := Volume}} ->
            stock_db:upsert_stock(Ticker, numeric_or_null(Price), numeric_or_null(Volume)),
            ok_body(#{<<"ticker">> => Ticker,
                      <<"last_price">> => Price,
                      <<"last_volume">> => Volume});
        {error, Reason} ->
            error_body(502, Reason)
    end.

description_response(TickerRaw) ->
    Ticker = stock_util:to_upper(TickerRaw),
    case stock_fetcher:fetch_description(Ticker) of
        {ok, Data} ->
            ok_body(Data);
        {error, Reason} ->
            error_body(502, Reason)
    end.

%%%===================================================================
%%% Response helpers
%%%===================================================================

numeric_or_null(N) when is_number(N) -> N;
numeric_or_null(_) -> null.

ok_body(Map) ->
    {200, stock_json:encode(Map)}.

error_body(Status, Reason) ->
    {Status, stock_json:encode(#{<<"error">> => iolist_to_binary(io_lib:format("~p", [Reason]))})}.
