%%%-------------------------------------------------------------------
%%% @doc stock_config
%%%
%%% Loads config.json once at startup and keeps it available to every
%%% other module via `persistent_term', so nobody needs to thread a
%%% Config argument through every function call or re-read the file
%%% on every request.
%%% @end
%%%-------------------------------------------------------------------
-module(stock_config).
-compile({no_auto_import, [get/1]}).

-export([load/0, load/1, current/0, get/1, get/2, tickers/0]).

-define(PERSISTENT_KEY, stock_server_config).
-define(DEFAULT_PATH, "config/config.json").

%% @doc Loads config.json from the default path and caches it.
-spec load() -> map().
load() ->
    load(?DEFAULT_PATH).

%% @doc Loads a config file from a specific path and caches it.
-spec load(file:filename()) -> map().
load(Path) ->
    {ok, Bin} = file:read_file(Path),
    Config = stock_json:decode(Bin),
    persistent_term:put(?PERSISTENT_KEY, Config),
    Config.

%% @doc Returns the currently cached config map.
-spec current() -> map().
current() ->
    persistent_term:get(?PERSISTENT_KEY).

%% @doc Looks up a (possibly nested) key path in the cached config.
%% Example: stock_config:get([mysql, host]).
-spec get([atom() | binary()]) -> term().
get(KeyPath) ->
    get(current(), KeyPath).

-spec get(map(), [atom() | binary()]) -> term().
get(Config, KeyPath) ->
    lists:foldl(fun(Key, Acc) -> maps:get(to_bin(Key), Acc) end, Config, KeyPath).

to_bin(K) when is_binary(K) -> K;
to_bin(K) when is_atom(K) -> atom_to_binary(K, utf8).

%% @doc Reads the ticker list file referenced by the "tickers_file" config
%% entry and returns it as a list of upper-cased ticker binaries.
-spec tickers() -> [binary()].
tickers() ->
    Path = binary_to_list(get([tickers_file])),
    [stock_util:to_upper(Line) || Line <- stock_util:read_lines(Path)].
