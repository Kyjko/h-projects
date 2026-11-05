%%%-------------------------------------------------------------------
%%% @doc stock_fetcher
%%%
%%% Talks to the public, key-free financial data sources this example
%%% project uses:
%%%
%%%   - Stooq (https://stooq.com) for historical daily OHLCV bars and
%%%     for a lightweight "current price" quote, both as plain CSV.
%%%   - Yahoo Finance's public quote endpoint for a condensed, mostly
%%%     free-form description of the stock (name, exchange, market
%%%     cap, 52 week range, etc.) as JSON.
%%%
%%% This module only knows how to fetch and parse; it never touches
%%% the database and never builds HTTP responses. That keeps it easy
%%% to re-point at a different data source later (e.g. swap Stooq for
%%% a paid provider) without touching stock_api or stock_db.
%%%
%%% NOTE: both Stooq and Yahoo's endpoints are unofficial/free public
%%% endpoints. They are great for a demo project like this one but
%%% can change shape or rate-limit you; in production you would want
%%% a proper, authenticated data provider and to cache more
%%% aggressively.
%%% @end
%%%-------------------------------------------------------------------
-module(stock_fetcher).

-export([fetch_historical/2, fetch_current_price/1, fetch_description/1]).

%%%===================================================================
%%% API
%%%===================================================================

%% @doc Fetches historical daily bars for Ticker, trimmed to Timeframe.
%% Timeframe is one of: <<"max">>, <<"5y">>, <<"1y">>, <<"6m">>,
%% <<"3m">>, <<"1m">>, <<"5d">>. Unrecognised values default to "max".
-spec fetch_historical(binary(), binary()) -> {ok, [map()]} | {error, term()}.
fetch_historical(Ticker, Timeframe) ->
    case http_get(historical_url(Ticker)) of
        {ok, Body} ->
            Rows = parse_stooq_history_csv(Body),
            {ok, apply_timeframe(Rows, Timeframe)};
        {error, Reason} ->
            {error, Reason}
    end.

%% @doc Fetches the latest traded price/volume for Ticker.
-spec fetch_current_price(binary()) -> {ok, map()} | {error, term()}.
fetch_current_price(Ticker) ->
    case http_get(quote_url(Ticker)) of
        {ok, Body} -> parse_stooq_quote_csv(Body);
        {error, Reason} -> {error, Reason}
    end.

%% @doc Fetches a condensed set of publicly available facts about the
%% stock (name, exchange, market cap, day range, ...). Returns
%% whatever fields the upstream source exposes, as a map, so it can
%% double as the input to a future LLM summarisation step.
-spec fetch_description(binary()) -> {ok, map()} | {error, term()}.
fetch_description(Ticker) ->
    case http_get(description_url(Ticker)) of
        {ok, Body} -> parse_yahoo_quote_json(Ticker, Body);
        {error, Reason} -> {error, Reason}
    end.

%%%===================================================================
%%% URL building
%%%===================================================================

historical_url(Ticker) ->
    Base = stock_config:get([data_source, stooq_historical_url]),
    <<Base/binary, "?s=", (stooq_symbol(Ticker))/binary, "&i=d">>.

quote_url(Ticker) ->
    Base = stock_config:get([data_source, stooq_quote_url]),
    <<Base/binary, "?s=", (stooq_symbol(Ticker))/binary, "&f=sd2t2ohlcv&e=csv">>.

description_url(Ticker) ->
    Base = stock_config:get([data_source, yahoo_quote_url]),
    <<Base/binary, "?symbols=", Ticker/binary>>.

%% Stooq expects lower-case symbols with a market suffix, e.g. "aapl.us".
stooq_symbol(Ticker) ->
    Lower = list_to_binary(string:lowercase(binary_to_list(Ticker))),
    <<Lower/binary, ".us">>.

%%%===================================================================
%%% HTTP
%%%===================================================================

http_get(Url) ->
    Request = {binary_to_list(Url), [{"User-Agent", "Mozilla/5.0 (stock_server example)"}]},
    case httpc:request(get, Request, [{timeout, 10000}], [{body_format, binary}]) of
        {ok, {{_HttpVer, 200, _Reason}, _Headers, Body}} ->
            {ok, Body};
        {ok, {{_HttpVer, Status, _Reason}, _Headers, _Body}} ->
            {error, {http_status, Status}};
        {error, Reason} ->
            {error, Reason}
    end.

%%%===================================================================
%%% Stooq CSV parsing
%%%===================================================================

%% Stooq historical CSV looks like:
%%   Date,Open,High,Low,Close,Volume
%%   2024-01-02,185.34,186.4,184.35,185.64,82488700
%%   ...
parse_stooq_history_csv(Body) ->
    case stock_util:split_lines(Body) of
        [_Header | DataLines] ->
            [parse_history_row(Line) || Line <- DataLines, not is_no_data_row(Line)];
        [] ->
            []
    end.

is_no_data_row(Line) ->
    binary:match(Line, <<"No data">>) =/= nomatch.

parse_history_row(Line) ->
    [Date, Open, High, Low, Close, Volume] = binary:split(Line, <<",">>, [global]),
    #{
        date => Date,
        open => to_number(Open),
        high => to_number(High),
        low => to_number(Low),
        close => to_number(Close),
        volume => to_number(Volume)
    }.

%% Stooq quote CSV (f=sd2t2ohlcv) looks like:
%%   Symbol,Date,Time,Open,High,Low,Close,Volume
%%   aapl.us,2024-06-14,22:00:03,210.39,212.7,209.77,212.49,60214860
parse_stooq_quote_csv(Body) ->
    case stock_util:split_lines(Body) of
        [_Header, DataLine | _] ->
            case binary:split(DataLine, <<",">>, [global]) of
                [_Symbol, Date, Time, _Open, _High, _Low, Close, Volume] ->
                    {ok, #{price => to_number(Close),
                           volume => to_number(Volume),
                           date => Date,
                           time => Time}};
                _Other ->
                    {error, unexpected_quote_format}
            end;
        _Other ->
            {error, no_quote_data}
    end.

to_number(Bin) ->
    case stock_util:trim(Bin) of
        <<>> -> null;
        <<"N/A">> -> null;
        Trimmed ->
            try binary_to_float(Trimmed)
            catch _:_ ->
                try binary_to_integer(Trimmed)
                catch _:_ -> Trimmed
                end
            end
    end.

%% Trims a list of historical rows (oldest-first) down to the last N
%% entries implied by Timeframe. "max" (or anything unrecognised)
%% returns every row we got back from the data source.
apply_timeframe(Rows, Timeframe) ->
    case timeframe_to_count(Timeframe) of
        all -> Rows;
        Count -> lists:nthtail(max(0, length(Rows) - Count), Rows)
    end.

timeframe_to_count(<<"max">>) -> all;
timeframe_to_count(<<"5y">>) -> 5 * 252;
timeframe_to_count(<<"1y">>) -> 252;
timeframe_to_count(<<"6m">>) -> 126;
timeframe_to_count(<<"3m">>) -> 63;
timeframe_to_count(<<"1m">>) -> 21;
timeframe_to_count(<<"5d">>) -> 5;
timeframe_to_count(_Other) -> all.

%%%===================================================================
%%% Yahoo Finance JSON parsing
%%%===================================================================

%% Yahoo's quote endpoint returns:
%%   {"quoteResponse": {"result": [ {...fields...} ], "error": null}}
%% We simply hand back the first result object as-is (minus nothing),
%% since its exact set of fields depends on the security type and can
%% change over time - future work (LLM summarisation) can consume
%% this same map as its raw input.
parse_yahoo_quote_json(Ticker, Body) ->
    try
        Decoded = stock_json:decode(Body),
        QuoteResponse = maps:get(<<"quoteResponse">>, Decoded),
        case maps:get(<<"result">>, QuoteResponse) of
            [First | _Rest] -> {ok, First};
            [] -> {ok, #{<<"symbol">> => Ticker,
                         <<"note">> => <<"no description available from data source">>}}
        end
    catch
        _Class:_Reason -> {error, description_parse_failed}
    end.
