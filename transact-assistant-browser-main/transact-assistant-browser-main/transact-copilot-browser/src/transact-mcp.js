const DIRECT_READ_TOOLS = new Map([
  ["ofs-read", { required: ["application", "id"], optional: ["state", "history_version"] }],
  ["ofs-enquiry", { required: ["enquiry"], optional: ["selection", "max_rows", "correlation_id"] }],
  ["app-fields", { required: ["application"], optional: ["scope"] }],
  ["app-schema", { required: ["application"], optional: ["scope"] }],
  ["customer-lookup", { required: [], optional: ["id", "name"] }],
  ["customer-accounts", { required: ["customer_id"], optional: [] }],
  ["account-detail", { required: ["account_id"], optional: [] }],
  ["arrangement-detail", { required: ["arrangement_id"], optional: [] }],
  ["aa-product-summary", { required: ["product_id"], optional: [] }],
  ["aa-condition-detail", { required: ["pc_prd_pr"], optional: [] }],
  ["transact-context", { required: [], optional: [] }],
]);

const RECORD_FIELD_NAME = /^[A-Z0-9@._-]+$/;
let requestId = 0;

export function validateDirectToolCall(tool, args) {
  const definition = DIRECT_READ_TOOLS.get(tool);
  if (!definition) throw Object.assign(new Error("Direct access is limited to supported read-only Transact tools."), { status: 400 });
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw Object.assign(new Error("Tool arguments must be a JSON object."), { status: 400 });
  }
  const allowed = new Set([...definition.required, ...definition.optional]);
  for (const key of Object.keys(args)) {
    if (!allowed.has(key)) throw Object.assign(new Error(`Unsupported argument "${key}" for ${tool}.`), { status: 400 });
  }
  for (const key of definition.required) {
    if (typeof args[key] !== "string" || !args[key].trim()) {
      throw Object.assign(new Error(`"${key}" is required for ${tool}.`), { status: 400 });
    }
  }
  for (const key of Object.keys(args)) {
    const value = args[key];
    if (key === "selection") {
      if (!Array.isArray(value) || value.some((entry) => !entry
        || typeof entry.field !== "string"
        || typeof entry.value !== "string"
        || !["EQ", "NE", "GE", "GT", "LE", "LT", "UL", "LK", "NR"].includes(entry.operator))) {
        throw Object.assign(new Error("selection must contain {field, operator, value} filters."), { status: 400 });
      }
    } else if (key === "max_rows") {
      if (!Number.isInteger(value) || value < 0 || value > 5000) {
        throw Object.assign(new Error("max_rows must be an integer between 0 and 5000."), { status: 400 });
      }
    } else if (key === "scope") {
      if (!["all", "core", "local"].includes(value)) {
        throw Object.assign(new Error("scope must be all, core, or local."), { status: 400 });
      }
    } else if (key === "state") {
      if (!["live", "unauthorised", "history"].includes(value)) {
        throw Object.assign(new Error("state must be live, unauthorised, or history."), { status: 400 });
      }
    } else if (key !== "selection" && typeof value !== "string") {
      throw Object.assign(new Error(`"${key}" must be a string.`), { status: 400 });
    }
  }
  if (tool === "customer-lookup" && Boolean(args.id) === Boolean(args.name)) {
    throw Object.assign(new Error("Provide exactly one of id or name for customer-lookup."), { status: 400 });
  }
  return args;
}

function parseRpcResponse(text, contentType, expectedId) {
  if (contentType.includes("text/event-stream")) {
    const messages = [];
    let dataLines = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line) {
        if (dataLines.length) messages.push(dataLines.join("\n"));
        dataLines = [];
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length) messages.push(dataLines.join("\n"));
    for (const message of messages) {
      if (!message || message === "[DONE]") continue;
      try {
        const rpc = JSON.parse(message);
        if (rpc && rpc.jsonrpc === "2.0"
            && String(rpc.id) === String(expectedId)
            && (Object.hasOwn(rpc, "result") || Object.hasOwn(rpc, "error"))) {
          return rpc;
        }
      } catch {
        continue;
      }
    }
    throw new Error(`Transact MCP event stream did not contain a JSON-RPC response for request ${expectedId}.`);
  }
  return JSON.parse(text);
}

function decodeToolResult(result) {
  if (result.isError) {
    const detail = (result.content || []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
    throw new Error(detail || "Transact MCP tool call failed.");
  }
  if (Object.hasOwn(result, "structuredContent")) return result.structuredContent;
  const blocks = (result.content || []).filter((item) => item.type === "text").map((item) => item.text);
  if (blocks.length === 1) {
    try {
      return JSON.parse(blocks[0]);
    } catch {
      return blocks[0];
    }
  }
  if (blocks.length > 1) return blocks.map((text) => {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  });
  return result;
}

function validateRecordInput(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)
      || typeof args.application !== "string" || !args.application.trim()
      || typeof args.id !== "string" || !args.id.trim()
      || args.confirm !== true
      || typeof args.validate_only !== "boolean"
      || !Array.isArray(args.fields) || args.fields.length > 1000) {
    throw Object.assign(new Error("Record input requires an application, record ID, fields, and explicit confirmation."), { status: 400 });
  }
  if (!/^[A-Z0-9][A-Z0-9.]*$/i.test(args.application)
      || args.id.length > 256
      || args.fields.some((field) => !field || typeof field !== "object"
        || Array.isArray(field)
        || typeof field.name !== "string"
        || !RECORD_FIELD_NAME.test(field.name)
        || typeof field.value !== "string"
        || field.value.length > 6000
        || (field.mv !== undefined && (!Number.isInteger(field.mv) || field.mv < 1))
        || (field.sv !== undefined && (!Number.isInteger(field.sv) || field.sv < 1)))) {
    throw Object.assign(new Error("Record input contains an invalid application, ID, field name, value, or position."), { status: 400 });
  }
  const positions = args.fields.map((field) => `${field.name}:${field.mv || 1}:${field.sv || 1}`);
  if (new Set(positions).size !== positions.length) {
    throw Object.assign(new Error("Record input contains duplicate field positions."), { status: 400 });
  }
}

async function requestTool({ url, tool, args, fetchImpl }) {
  const id = ++requestId;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
    signal: AbortSignal.timeout(Number(process.env.TRANSACT_MCP_TIMEOUT_MS) || 60_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Transact MCP returned HTTP ${response.status}${text ? `: ${text.slice(0, 1000)}` : "."}`);
  }
  let rpc;
  try {
    rpc = parseRpcResponse(text, response.headers.get("content-type") || "", id);
  } catch (error) {
    throw new Error(`Could not parse Transact MCP response: ${error.message}`);
  }
  if (rpc.error) throw new Error(rpc.error.message || "Transact MCP returned a JSON-RPC error.");
  if (!Object.hasOwn(rpc, "result") || !rpc.result) {
    throw new Error("Transact MCP response did not contain a tool result.");
  }
  return decodeToolResult(rpc.result);
}

export async function callTransactTool({ url, tool, args, fetchImpl = fetch }) {
  validateDirectToolCall(tool, args);
  return requestTool({ url, tool, args, fetchImpl });
}

export async function callTransactInput({ url, args, fetchImpl = fetch }) {
  validateRecordInput(args);
  return requestTool({ url, tool: "ofs-input", args, fetchImpl });
}

export function validateAuthoriseRecordArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)
      || typeof args.application !== "string"
      || !/^[A-Z0-9][A-Z0-9.]*$/i.test(args.application)
      || typeof args.id !== "string"
      || !args.id.trim()
      || args.id.length > 256
      || args.confirm !== true
      || Object.keys(args).some((key) => !["application", "id", "confirm"].includes(key))) {
    throw Object.assign(new Error("Authorisation requires a valid application, record ID, and explicit confirmation."), { status: 400 });
  }
  return args;
}

export async function callTransactAuthorise({ url, args, fetchImpl = fetch }) {
  validateAuthoriseRecordArgs(args);
  return requestTool({ url, tool: "ofs-authorise", args, fetchImpl });
}
