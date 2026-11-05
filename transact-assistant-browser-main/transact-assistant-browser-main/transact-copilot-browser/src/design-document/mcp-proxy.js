import { Readable } from "node:stream";
import { isAppliedRecord } from "./amendment-store.js";

const MAX_PROXY_REQUEST_BYTES = 32 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_PROXY_REQUEST_BYTES) {
      throw Object.assign(new Error("MCP request exceeds the local proxy size limit."), { status: 413 });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readCapture(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CAPTURE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch {
    return null;
  }
}

function rpcMessages(text, contentType) {
  if (contentType.includes("text/event-stream")) {
    return text.split(/\r?\n\r?\n/).flatMap((event) => {
      const data = event.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) return [];
      try {
        return [JSON.parse(data)];
      } catch {
        return [];
      }
    });
  }
  try {
    return [JSON.parse(text)];
  } catch {
    return [];
  }
}

function decodeResult(result) {
  if (!result || result.isError) return null;
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function rememberSuccessfulInput(requestBody, responseText, contentType, recordAmendment) {
  let rpcRequest;
  try {
    rpcRequest = JSON.parse(requestBody.toString("utf8"));
  } catch {
    return;
  }
  const call = rpcRequest?.method === "tools/call" ? rpcRequest.params : null;
  if (call?.name !== "ofs-input") return;
  const args = call.arguments;
  if (!args || args.confirm !== true || args.validate_only === true
      || typeof args.application !== "string" || typeof args.id !== "string") return;

  const rpcResponse = rpcMessages(responseText, contentType)
    .find((message) => message && String(message.id) === String(rpcRequest.id));
  const result = decodeResult(rpcResponse?.result);
  if (!isAppliedRecord(result)) return;

  const record = result.record && typeof result.record === "object" ? result.record : result;
  const fields = Array.isArray(record.fields) ? record.fields : args.fields;
  try {
    await recordAmendment({
      application: args.application,
      recordId: record.id || result.id || args.id,
      fields,
      state: result.state || "live",
      source: "assistant",
    });
  } catch (error) {
    console.error(`[amendments] Transact input succeeded but recent amendment history could not be saved: ${error.message}`);
  }
}

export async function proxyTransactRequest(request, response, { targetUrl, recordAmendment }) {
  const requestBody = await readRequestBody(request);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value && !HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
  }

  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      ...(request.method === "GET" || request.method === "HEAD" || !requestBody.length ? {} : { body: requestBody }),
      signal: AbortSignal.timeout(Number(process.env.TRANSACT_MCP_TIMEOUT_MS) || 60_000),
    });
  } catch (error) {
    response.writeHead(502, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ error: `Could not reach Transact MCP: ${error.message}` }));
    return;
  }

  const responseHeaders = {};
  upstream.headers.forEach((value, name) => {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) responseHeaders[name] = value;
  });
  response.writeHead(upstream.status, responseHeaders);

  const capturePromise = requestBody.length ? readCapture(upstream.clone()) : Promise.resolve(null);
  if (upstream.body) Readable.fromWeb(upstream.body).pipe(response);
  else response.end();

  const captured = await capturePromise;
  if (captured !== null && requestBody.length) {
    await rememberSuccessfulInput(
      requestBody,
      captured,
      upstream.headers.get("content-type") || "",
      recordAmendment,
    );
  }
}
