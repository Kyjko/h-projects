%%%-------------------------------------------------------------------
%%% @doc stock_json
%%%
%%% A small, dependency-free JSON encoder/decoder.
%%%
%%% We keep our own tiny JSON module instead of pulling in a third
%%% party library so that the only external dependency the whole
%%% project needs is the MySQL driver. It is not a fully spec-compliant
%%% parser, but it is more than enough to:
%%%
%%%   - read config.json
%%%   - decode the JSON responses returned by the public data sources
%%%   - encode our own REST API responses
%%%
%%% Erlang term <-> JSON mapping used by this module:
%%%
%%%   JSON object  <-> Erlang map, e.g. #{<<"a">> => 1}
%%%   JSON array   <-> Erlang list
%%%   JSON string  <-> Erlang binary
%%%   JSON number  <-> Erlang integer or float
%%%   JSON true/false/null <-> Erlang atoms true / false / null
%%% @end
%%%-------------------------------------------------------------------
-module(stock_json).

-export([encode/1, decode/1]).

%%%===================================================================
%%% Encoding
%%%===================================================================

-spec encode(term()) -> binary().
encode(Term) ->
    iolist_to_binary(enc(Term)).

enc(null) -> <<"null">>;
enc(true) -> <<"true">>;
enc(false) -> <<"false">>;
enc(Map) when is_map(Map) ->
    Pairs = [enc_pair(K, V) || {K, V} <- maps:to_list(Map)],
    [${, join_commas(Pairs), $}];
enc(List) when is_list(List) ->
    [$[, join_commas([enc(E) || E <- List]), $]];
enc(Bin) when is_binary(Bin) ->
    enc_string(Bin);
enc(Int) when is_integer(Int) ->
    integer_to_binary(Int);
enc(Float) when is_float(Float) ->
    float_to_binary(Float, [{decimals, 6}, compact]);
enc(Atom) when is_atom(Atom) ->
    enc_string(atom_to_binary(Atom, utf8)).

enc_pair(Key, Value) ->
    [enc_string(key_to_binary(Key)), $:, enc(Value)].

key_to_binary(K) when is_binary(K) -> K;
key_to_binary(K) when is_atom(K) -> atom_to_binary(K, utf8);
key_to_binary(K) when is_list(K) -> list_to_binary(K).

join_commas([]) -> [];
join_commas([H]) -> [H];
join_commas([H | T]) -> [H, $, | join_commas(T)].

enc_string(Bin) ->
    [$", escape(Bin, <<>>), $"].

escape(<<>>, Acc) -> Acc;
escape(<<$", Rest/binary>>, Acc) -> escape(Rest, <<Acc/binary, "\\\"">>);
escape(<<$\\, Rest/binary>>, Acc) -> escape(Rest, <<Acc/binary, "\\\\">>);
escape(<<$\n, Rest/binary>>, Acc) -> escape(Rest, <<Acc/binary, "\\n">>);
escape(<<$\r, Rest/binary>>, Acc) -> escape(Rest, <<Acc/binary, "\\r">>);
escape(<<$\t, Rest/binary>>, Acc) -> escape(Rest, <<Acc/binary, "\\t">>);
escape(<<C, Rest/binary>>, Acc) -> escape(Rest, <<Acc/binary, C>>).

%%%===================================================================
%%% Decoding
%%%===================================================================

-spec decode(binary() | string()) -> term().
decode(Text) when is_list(Text) ->
    decode(list_to_binary(Text));
decode(Bin) when is_binary(Bin) ->
    {Value, _Rest} = parse_value(skip_ws(Bin)),
    Value.

skip_ws(<<C, Rest/binary>>) when C =:= $\s; C =:= $\t; C =:= $\n; C =:= $\r ->
    skip_ws(Rest);
skip_ws(Bin) ->
    Bin.

parse_value(<<"null", Rest/binary>>) -> {null, Rest};
parse_value(<<"true", Rest/binary>>) -> {true, Rest};
parse_value(<<"false", Rest/binary>>) -> {false, Rest};
parse_value(<<${, Rest/binary>>) -> parse_object(skip_ws(Rest), #{});
parse_value(<<$[, Rest/binary>>) -> parse_array(skip_ws(Rest), []);
parse_value(<<$", Rest/binary>>) -> parse_string(Rest, <<>>);
parse_value(Bin) -> parse_number(Bin).

parse_object(<<$}, Rest/binary>>, Map) ->
    {Map, Rest};
parse_object(<<$", Rest0/binary>>, Map) ->
    {Key, Rest1} = parse_string(Rest0, <<>>),
    <<$:, Rest2/binary>> = skip_ws(Rest1),
    {Value, Rest3} = parse_value(skip_ws(Rest2)),
    Map2 = maps:put(Key, Value, Map),
    case skip_ws(Rest3) of
        <<$,, Rest4/binary>> -> parse_object(skip_ws(Rest4), Map2);
        <<$}, Rest4/binary>> -> {Map2, Rest4}
    end.

parse_array(<<$], Rest/binary>>, Acc) ->
    {lists:reverse(Acc), Rest};
parse_array(Bin, Acc) ->
    {Value, Rest1} = parse_value(skip_ws(Bin)),
    case skip_ws(Rest1) of
        <<$,, Rest2/binary>> -> parse_array(skip_ws(Rest2), [Value | Acc]);
        <<$], Rest2/binary>> -> {lists:reverse([Value | Acc]), Rest2}
    end.

parse_string(<<$", Rest/binary>>, Acc) -> {Acc, Rest};
parse_string(<<$\\, $", Rest/binary>>, Acc) -> parse_string(Rest, <<Acc/binary, $\">>);
parse_string(<<$\\, $\\, Rest/binary>>, Acc) -> parse_string(Rest, <<Acc/binary, $\\>>);
parse_string(<<$\\, $/, Rest/binary>>, Acc) -> parse_string(Rest, <<Acc/binary, $/>>);
parse_string(<<$\\, $n, Rest/binary>>, Acc) -> parse_string(Rest, <<Acc/binary, $\n>>);
parse_string(<<$\\, $t, Rest/binary>>, Acc) -> parse_string(Rest, <<Acc/binary, $\t>>);
parse_string(<<$\\, $r, Rest/binary>>, Acc) -> parse_string(Rest, <<Acc/binary, $\r>>);
parse_string(<<C, Rest/binary>>, Acc) -> parse_string(Rest, <<Acc/binary, C>>).

parse_number(Bin) ->
    {NumBin, Rest} = take_number(Bin, <<>>),
    Num = case binary:match(NumBin, [<<".">>, <<"e">>, <<"E">>]) of
              nomatch -> binary_to_integer(NumBin);
              _ -> binary_to_float(NumBin)
          end,
    {Num, Rest}.

take_number(<<C, Rest/binary>>, Acc)
  when (C >= $0 andalso C =< $9)
       orelse C =:= $- orelse C =:= $+
       orelse C =:= $. orelse C =:= $e orelse C =:= $E ->
    take_number(Rest, <<Acc/binary, C>>);
take_number(Rest, Acc) ->
    {Acc, Rest}.
