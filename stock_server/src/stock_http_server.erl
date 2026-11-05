%%%-------------------------------------------------------------------
%%% @doc stock_http_server
%%%
%%% A deliberately minimal HTTP/1.1 server built directly on gen_tcp,
%%% so the project doesn't need to pull in a web framework just to
%%% answer a handful of GET requests. It only understands what this
%%% API needs: simple GET requests with no body.
%%%
%%% Concurrency: the acceptor process loops on gen_tcp:accept/1 and
%%% spawns a brand-new, short-lived process for every connection that
%%% comes in. Each request is therefore handled independently and a
%%% slow client can never block the others.
%%%
%%% Routing itself (turning "/AAPL/current_price" into a database
%%% lookup) is delegated to stock_api - this module's only job is
%%% speaking HTTP.
%%% @end
%%%-------------------------------------------------------------------
-module(stock_http_server).

-export([start_link/0, loop_acceptor/1, handle_client/1]).

%% @doc Opens the listening socket (port from config.json's
%% "http_port") and spawns the acceptor loop.
-spec start_link() -> {ok, pid()} | {error, term()}.
start_link() ->
    Port = stock_config:get([http_port]),
    ListenOpts = [binary, {packet, http_bin}, {active, false},
                  {reuseaddr, true}, {backlog, 128}],
    case gen_tcp:listen(Port, ListenOpts) of
        {ok, ListenSocket} ->
            Pid = spawn_link(?MODULE, loop_acceptor, [ListenSocket]),
            error_logger:info_msg("stock_http_server: listening on port ~p~n", [Port]),
            {ok, Pid};
        {error, Reason} ->
            {error, Reason}
    end.

%% @doc Accepts connections forever, handing each one off to a fresh
%% process so the acceptor is always immediately ready for the next
%% client.
loop_acceptor(ListenSocket) ->
    case gen_tcp:accept(ListenSocket) of
        {ok, ClientSocket} ->
            spawn(?MODULE, handle_client, [ClientSocket]),
            loop_acceptor(ListenSocket);
        {error, closed} ->
            ok;
        {error, _Reason} ->
            %% Transient accept error - keep serving.
            loop_acceptor(ListenSocket)
    end.

%% @doc Reads a single HTTP request off ClientSocket, dispatches it to
%% stock_api, writes back the response and closes the connection.
handle_client(Socket) ->
    case gen_tcp:recv(Socket, 0, 5000) of
        {ok, {http_request, 'GET', {abs_path, RawPath}, _Version}} ->
            consume_headers(Socket),
            Path = path_only(RawPath),
            {Status, Body} = safe_handle(Path),
            respond(Socket, Status, Body);
        {ok, {http_request, _OtherMethod, _Uri, _Version}} ->
            consume_headers(Socket),
            respond(Socket, 405, stock_json:encode(#{<<"error">> => <<"only GET is supported">>}));
        {ok, _Other} ->
            respond(Socket, 400, stock_json:encode(#{<<"error">> => <<"malformed request">>}));
        {error, _Reason} ->
            ok
    end,
    gen_tcp:close(Socket).

%% Reads and discards HTTP headers until the end-of-headers marker.
consume_headers(Socket) ->
    case gen_tcp:recv(Socket, 0, 5000) of
        {ok, {http_header, _, _Field, _, _Value}} -> consume_headers(Socket);
        {ok, http_eoh} -> ok;
        _Other -> ok
    end.

%% Strips any "?query=string" suffix and normalises to a binary path.
path_only(RawPath) ->
    PathBin = to_bin(RawPath),
    case binary:split(PathBin, <<"?">>) of
        [P, _Query] -> P;
        [P] -> P
    end.

to_bin(B) when is_binary(B) -> B;
to_bin(L) when is_list(L) -> list_to_binary(L).

%% Ensures a bug in a single request handler turns into a 500 response
%% instead of crashing the connection process without answering.
safe_handle(Path) ->
    try
        stock_api:handle(Path)
    catch
        Class:Reason ->
            error_logger:error_msg("stock_http_server: handler crashed: ~p:~p~n", [Class, Reason]),
            {500, stock_json:encode(#{<<"error">> => <<"internal server error">>})}
    end.

respond(Socket, Status, Body) ->
    StatusLine = ["HTTP/1.1 ", integer_to_list(Status), " ", status_text(Status), "\r\n"],
    Headers = ["Content-Type: application/json\r\n",
               "Content-Length: ", integer_to_list(byte_size(Body)), "\r\n",
               "Connection: close\r\n\r\n"],
    gen_tcp:send(Socket, [StatusLine, Headers, Body]).

status_text(200) -> "OK";
status_text(400) -> "Bad Request";
status_text(404) -> "Not Found";
status_text(405) -> "Method Not Allowed";
status_text(500) -> "Internal Server Error";
status_text(502) -> "Bad Gateway";
status_text(_) -> "Unknown".
