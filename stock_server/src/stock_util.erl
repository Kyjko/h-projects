%%%-------------------------------------------------------------------
%%% @doc stock_util
%%%
%%% Small, generic helper functions (string trimming, splitting,
%%% reading line-based files, ...) shared by the rest of the project.
%%% Keeping them in one place avoids duplicating trivial binary
%%% string-munging code in every module that needs it.
%%% @end
%%%-------------------------------------------------------------------
-module(stock_util).

-export([trim/1, to_upper/1, split_lines/1, read_lines/1, split_path/1]).

%% @doc Trims leading/trailing whitespace from a binary.
-spec trim(binary()) -> binary().
trim(Bin) when is_binary(Bin) ->
    list_to_binary(string:trim(binary_to_list(Bin))).

%% @doc Upper-cases a binary (used to normalise ticker symbols).
-spec to_upper(binary()) -> binary().
to_upper(Bin) when is_binary(Bin) ->
    list_to_binary(string:uppercase(binary_to_list(Bin))).

%% @doc Splits a binary blob into a list of non-empty, trimmed lines.
-spec split_lines(binary()) -> [binary()].
split_lines(Bin) when is_binary(Bin) ->
    Parts = binary:split(Bin, [<<"\r\n">>, <<"\n">>], [global]),
    [T || P <- Parts, (T = trim(P)) =/= <<>>].

%% @doc Reads a text file and returns its non-empty, trimmed lines.
%% Used to read TICKERS.csv (one ticker per line).
-spec read_lines(file:filename()) -> [binary()].
read_lines(FilePath) ->
    {ok, Bin} = file:read_file(FilePath),
    split_lines(Bin).

%% @doc Splits an HTTP request path such as `<<"/AAPL/historical/1y">>'
%% into its non-empty segments: `[<<"AAPL">>, <<"historical">>, <<"1y">>]'.
-spec split_path(binary()) -> [binary()].
split_path(PathBin) when is_binary(PathBin) ->
    Parts = binary:split(PathBin, <<"/">>, [global]),
    [P || P <- Parts, P =/= <<>>].
