%%%-------------------------------------------------------------------
%%% @doc stock_sup
%%%
%%% One-for-one top level supervisor. If the MySQL connection dies it
%%% is restarted on its own; if the HTTP acceptor dies it is restarted
%%% on its own; same for the periodic updater. This is the standard
%%% OTP way of getting resilience "for free" instead of hand-rolling
%%% error recovery in each module.
%%% @end
%%%-------------------------------------------------------------------
-module(stock_sup).
-behaviour(supervisor).

-export([start_link/0, init/1]).

-spec start_link() -> {ok, pid()} | {error, term()}.
start_link() ->
    supervisor:start_link({local, ?MODULE}, ?MODULE, []).

init([]) ->
    SupFlags = #{strategy => one_for_one, intensity => 5, period => 10},
    Children = [
        child(stock_db, stock_db, start_link, []),
        child(stock_updater, stock_updater, start_link, []),
        child(stock_http_server, stock_http_server, start_link, [])
    ],
    {ok, {SupFlags, Children}}.

child(Id, Module, Function, Args) ->
    #{id => Id,
      start => {Module, Function, Args},
      restart => permanent,
      shutdown => 5000,
      type => worker,
      modules => [Module]}.
