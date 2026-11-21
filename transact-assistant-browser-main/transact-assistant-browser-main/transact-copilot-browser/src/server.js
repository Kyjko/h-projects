import { createServer as createHttpServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { buildPrompt, getCopilotCliDiagnostics, runCopilot, runCopilotLogin } from "./copilot.js";
import {
  buildEsonPrompt,
  findReferenceEson,
  findReferenceEsonExamples,
  listSkills,
  parseEsonAssistantAnswer,
  readSkillFile,
  saveGeneratedEsonFiles,
  saveSkillFile,
  validateEsonRecords,
} from "./local-tools.js";
import {
  buildL3AssistantPrompt,
  collectProjectAssistantFiles,
  getProjectOverview,
  parseL3EditSuggestion,
  projectPathForPrompt,
  readProjectFile,
  saveProjectFile,
  searchProject,
} from "./l3-project.js";
import {
  callAAActivity,
  callTransactAuthorise,
  callTransactInput,
  callTransactTool,
  validateAAActivityArgs,
  validateAuthoriseRecordArgs,
  validateDirectToolCall,
} from "./transact-mcp.js";
import { isAppliedRecord, recordAmendment } from "./design-document/amendment-store.js";
import { getDesignDocumentProxyUrl, handleDesignDocumentRequest } from "./design-document/routes.js";
import { generateOFSMessage, getOFSMessageConfig, maskOFSMessage, parseOFSMessage } from "./ofs-message.js";
import { createOFSQueue, getDatabaseConfiguration } from "./ofs-queue.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 4173;
const MAX_BODY_BYTES = 32 * 1024;
const MAX_RECORD_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 6000;
const MAX_HISTORY_ITEMS = 8;
const MAX_COPILOT_TOOL_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_OFS_MESSAGE_BYTES = 256 * 1024;
const WORKSPACE_ROOT = path.resolve(ROOT, "..");
try {
  loadEnvFile(path.join(ROOT, ".env.local"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function getMcpUrl() {
  const value = process.env.TRANSACT_MCP_URL || "http://localhost:9189/mcp";
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)
      || !["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)) {
    throw new Error("TRANSACT_MCP_URL must point to a localhost HTTP endpoint.");
  }
  return url;
}

function diagnosticConfiguration(
  getCopilotDiagnostics = getCopilotCliDiagnostics,
  getDatabaseConfig = getDatabaseConfiguration,
  getOFSConfig = getOFSMessageConfig,
) {
  let endpoint = "Invalid local MCP URL";
  let endpointSource = "TRANSACT_MCP_URL";
  try {
    const url = getMcpUrl();
    endpoint = `${url.protocol}//${url.host}${url.pathname}`;
    if (!process.env.TRANSACT_MCP_URL) endpointSource = "Default (http://localhost:9189/mcp)";
  } catch {
    endpointSource = "TRANSACT_MCP_URL is invalid";
  }
  const configCandidates = [...new Set([
    path.resolve(process.cwd(), "config.toml"),
    path.join(ROOT, "config.toml"),
    path.join(WORKSPACE_ROOT, "config.toml"),
  ])];
  const copilotDiagnostics = getCopilotDiagnostics();
  return {
    copilot: {
      ...copilotDiagnostics,
      configFiles: copilotDiagnostics.configFiles.map((file) => ({
        ...file,
        purpose: file.path.endsWith("mcp-config.json")
          ? "Persistent MCP registrations, including word-mcp-server and playwright for design-document screenshots. This app injects Transact MCP per request."
          : "Copilot CLI user settings. Authentication is managed by the CLI; file contents are intentionally not exposed.",
      })),
      settings: [
        { name: "COPILOT_CLI_PATH", purpose: "Override the Copilot CLI executable path." },
        { name: "COPILOT_CLI_ENTRY", purpose: "On Windows, override the Copilot CLI npm-loader.js path." },
        { name: "Authentication", purpose: "Run `copilot login` in a terminal if the Assistant check reports unauthenticated." },
      ],
    },
    transactMcp: {
      endpoint,
      endpointSource,
      configFiles: configCandidates.map((filePath) => ({
        path: filePath,
        exists: existsSync(filePath),
        purpose: "Transact MCP server config.toml candidate. The server may be launched from another working directory; this browser cannot infer that process's config path.",
      })),
      settings: [
        { name: "TRANSACT_MCP_URL", value: endpoint, purpose: "HTTP endpoint the browser uses for direct requests and Assistant MCP calls." },
        { name: "config.toml", purpose: "Change the Transact MCP server's transport and OFS connection settings in the config file used when starting that server. Restart it after changes." },
      ],
    },
    database: getDatabaseConfig(),
    ofsMessage: (() => {
      const config = getOFSConfig();
      return {
        user: config.user,
        noOfAuth: config.noOfAuth,
        company: config.company,
        passwordConfigured: Boolean(config.password),
      };
    })(),
  };
}

function ofsInputErrors(result) {
  return Array.isArray(result?.errors)
    ? result.errors.map((error) => typeof error === "string"
      ? error
      : error?.message || error?.description || error?.code || JSON.stringify(error))
    : [];
}

function redactOFSSecret(message) {
  const password = getOFSMessageConfig().password;
  return password ? String(message).replaceAll(password, "***") : String(message);
}

function classifyAssistantFailure(error) {
  const message = String(error?.message || "");
  if (/not authenticated|authentication required|authentication.*failed|please log in|please login|please sign in|sign[ -]?in required|not signed in|not logged in|unauthenticated|unauthorized|no valid.*token|(?:run|use)\s+\/?login\b|login required/i.test(message)) {
    return { status: "unauthenticated", detail: "Copilot CLI is installed but is not authenticated. Run `copilot login`, then retry." };
  }
  if (/cannot locate copilot cli|could not start the transact assistant service|enoent|not recognized as an internal or external command/i.test(message)) {
    return { status: "unavailable", detail: "Copilot CLI could not be launched. Install it or correct COPILOT_CLI_PATH / COPILOT_CLI_ENTRY." };
  }
  return { status: "failed", detail: "Copilot CLI did not complete the diagnostic request. Check its local installation and authentication." };
}

function classifyTransactFailure(error) {
  const message = String(error?.message || "");
  if (/ECONNREFUSED|fetch failed|could not reach|timed out|timeout/i.test(message)) {
    return "Could not connect to the configured endpoint. Confirm the MCP server is running at the displayed URL.";
  }
  if (/HTTP 401|HTTP 403|unauthorized|forbidden/i.test(message)) {
    return "The MCP endpoint rejected the request. Check its local authentication or access-control settings.";
  }
  if (/invalid.*url|TRANSACT_MCP_URL/i.test(message)) {
    return "The configured MCP endpoint is invalid. Set TRANSACT_MCP_URL to a localhost HTTP endpoint.";
  }
  return "The web app could not call transact-context. Check the MCP server process, endpoint, and server-side OFS configuration.";
}

function diagnosticMcpUrl(port) {
  return getDesignDocumentProxyUrl(port);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function decodeCopilotToolOutput(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return text;
  }

  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
        continue;
      } catch {
        return data;
      }
    }
    if (!data || typeof data !== "object") return data;
    if (Object.hasOwn(data, "structuredContent")) {
      data = data.structuredContent;
      continue;
    }
    if (Array.isArray(data.content)) {
      const blocks = data.content.filter((item) => item?.type === "text").map((item) => item.text);
      if (blocks.length === 1) {
        data = blocks[0];
        continue;
      }
      if (blocks.length > 1) return blocks.map((block) => {
        try {
          return JSON.parse(block);
        } catch {
          return block;
        }
      });
    }
    return data;
  }
  return data;
}

async function loadCopilotToolOutput(answer) {
  const match = answer.match(/(?:[A-Z]:\\|\/)[^\r\n`"<>]*?\d+-copilot-tool-output-[a-f0-9-]{32,36}\.txt/i);
  if (!match) return null;

  const outputPath = path.resolve(match[0]);
  const tempDirectory = path.resolve(tmpdir());
  const expectedName = /^\d+-copilot-tool-output-[a-f0-9-]{32,36}\.txt$/i;
  if (path.dirname(outputPath).toLowerCase() !== tempDirectory.toLowerCase()
      || !expectedName.test(path.basename(outputPath))) {
    return { error: "The assistant referenced a result file outside its temporary output directory." };
  }

  try {
    const info = await stat(outputPath);
    if (info.size > MAX_COPILOT_TOOL_OUTPUT_BYTES) {
      return { error: `The full assistant result exceeds the ${MAX_COPILOT_TOOL_OUTPUT_BYTES / (1024 * 1024)} MB display limit.` };
    }
    const text = await readFile(outputPath, "utf8");
    return { data: decodeCopilotToolOutput(text) };
  } catch (error) {
    return { error: `Could not load the assistant's full result: ${error.message}` };
  }
}

function isAllowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return request.headers["sec-fetch-site"] === "same-origin";
  try {
    const originUrl = new URL(origin);
    const host = request.headers.host;
    return originUrl.host === host
      && ["localhost", "127.0.0.1"].includes(originUrl.hostname);
  } catch {
    return false;
  }
}

async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw Object.assign(new Error("Request is too large."), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 });
  }
}

function validateRecordDesignBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)
      || !["validate", "submit"].includes(body.action)) {
    throw Object.assign(new Error("Choose whether to validate or submit the record."), { status: 400 });
  }
  const application = typeof body.application === "string" ? body.application.trim().toUpperCase() : "";
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!/^[A-Z0-9][A-Z0-9.]*$/.test(application)) {
    throw Object.assign(new Error("Application names may contain letters, numbers, and periods only."), { status: 400 });
  }
  if (!id || id.length > 256) {
    throw Object.assign(new Error("Enter a record ID between 1 and 256 characters."), { status: 400 });
  }
  const version = typeof body.version === "string" ? body.version.trim().toUpperCase() : "";
  if (version && !/^[A-Z0-9][A-Z0-9._-]{0,127}$/.test(version)) {
    throw Object.assign(new Error("Enter a valid VERSION name."), { status: 400 });
  }
  if (body.action === "submit" && body.confirm !== true) {
    throw Object.assign(new Error("Record submission requires explicit confirmation."), { status: 400 });
  }
  if (!Array.isArray(body.fields) || body.fields.length > 1000) {
    throw Object.assign(new Error("Record fields must be an array of at most 1,000 values."), { status: 400 });
  }
  return { action: body.action, application, id, ...(version ? { version } : {}), fields: body.fields };
}

function isRecordValidationPassed(validation) {
  return validation && typeof validation === "object"
    && (!Array.isArray(validation.errors) || validation.errors.length === 0)
    && validation.acceptanceFlag !== "NO"
    && !(typeof validation.statusCode === "number" && validation.statusCode < 0);
}

function identifyRecordOperation(record) {
  const fields = record?.record?.fields ?? record?.fields;
  if (Array.isArray(fields)) return "amend";
  const errors = Array.isArray(record?.errors) ? record.errors : [];
  const missingRecord = errors.some((error) => {
    const code = typeof error === "string" ? error : error?.code || error?.message;
    return typeof code === "string" && /^MISSING .+ - RECORD$/i.test(code);
  });
  if (missingRecord && record?.acceptanceFlag === "NO") return "create";
  throw Object.assign(new Error("Transact could not determine whether this record ID exists. Refusing to submit an uncertain record operation."), { status: 409 });
}

function validateChatBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("Request body must be a JSON object."), { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    throw Object.assign(new Error(`Enter a request between 1 and ${MAX_MESSAGE_LENGTH} characters.`), { status: 400 });
  }
  const application = typeof body.application === "string" ? body.application.trim().toUpperCase() : "";
  if (application && !/^[A-Z0-9][A-Z0-9.]*$/.test(application)) {
    throw Object.assign(new Error("Application names may contain letters, numbers, and periods only."), { status: 400 });
  }
  const recordId = typeof body.recordId === "string" ? body.recordId.trim() : "";
  if (recordId.length > 256) {
    throw Object.assign(new Error("Record ID is too long."), { status: 400 });
  }
  if (body.assistantMode !== undefined
      && !["standard", "record-design-suggestions", "design-doc-suggestions"].includes(body.assistantMode)) {
    throw Object.assign(new Error("Assistant mode is invalid."), { status: 400 });
  }
  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY_ITEMS) : [];
  const safeHistory = history.map((entry) => {
    if (!entry || !["user", "assistant"].includes(entry.role) || typeof entry.content !== "string") {
      throw Object.assign(new Error("Conversation history is invalid."), { status: 400 });
    }
    return { role: entry.role, content: entry.content.slice(-1200) };
  });
  return {
    message,
    application,
    recordId,
    history: safeHistory,
    assistantMode: body.assistantMode || "standard",
    writeConfirmed: ["record-design-suggestions", "design-doc-suggestions"].includes(body.assistantMode)
      ? false
      : body.writeConfirmed === true,
  };
}

async function tcpReachable(url) {
  return new Promise((resolve) => {
    const port = Number(url.port) || (url.protocol === "https:" ? 443 : 80);
    const socket = createConnection({ host: url.hostname.replace(/^\[|\]$/g, ""), port });
    socket.setTimeout(800);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function serveStatic(pathname, response) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendJson(response, 400, { error: "Invalid URL path." });
    return;
  }
  const relative = decoded === "/" ? "index.html" : decoded.slice(1);
  const target = path.resolve(PUBLIC_DIR, relative);
  if (!target.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    sendJson(response, 403, { error: "Forbidden." });
    return;
  }
  try {
    const contents = await readFile(target);
    const extension = path.extname(target);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    response.end(contents);
  } catch (error) {
    sendJson(response, error.code === "ENOENT" ? 404 : 500, { error: "File not found." });
  }
}

export function createServer({
  copilot = runCopilot,
  copilotLogin = runCopilotLogin,
  copilotDiagnostics = getCopilotCliDiagnostics,
  transact = callTransactTool,
  database = createOFSQueue(),
  ofsMessageConfig = getOFSMessageConfig,
  recordInput = callTransactInput,
  recordRead = callTransactTool,
  recordAuthorise = callTransactAuthorise,
  aaActivity = callAAActivity,
  saveAmendment = recordAmendment,
  listAmendments,
  selectAmendments,
  workspaceRoot = process.env.TRANSACT_BROWSER_WORKSPACE_ROOT || WORKSPACE_ROOT,
  l3ProjectRoot = process.env.VMA_L3_JAVA_PROJECT || path.join(workspaceRoot, "VmaL3JavaP2"),
} = {}) {
  const javaProjectRoot = projectPathForPrompt(l3ProjectRoot);
  async function checkOFSMessage(parsed) {
    const url = getMcpUrl().toString();
    if (parsed.operation === "S") {
      return transact({
        url,
        tool: "ofs-read",
        args: { application: parsed.application, id: parsed.id },
      });
    }
    const { operation, ...args } = parsed;
    return recordInput({ url, args: { ...args, validate_only: true } });
  }
  let server;
  server = createHttpServer(async (request, response) => {
    let url;
    try {
      url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
    } catch {
      sendJson(response, 400, { error: "Invalid request URL." });
      return;
    }

    try {
      const designDocumentHandled = await handleDesignDocumentRequest(request, response, {
        runCopilot: copilot,
        getTransactUrl: () => getMcpUrl().toString(),
        proxyUrl: getDesignDocumentProxyUrl(server.address()?.port || PORT),
        recordAmendment: saveAmendment,
        listRecentAmendments: listAmendments,
        getAmendmentsByIds: selectAmendments,
        readRecord: async (application, id) => recordRead({
          url: getMcpUrl().toString(),
          tool: "ofs-read",
          args: { application, id },
        }),
        isAllowedOrigin,
      });
      if (designDocumentHandled) return;
    } catch (error) {
      sendJson(response, error.status || 502, { error: error.message || "Design document request could not be completed." });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      try {
        const mcpUrl = getMcpUrl();
        sendJson(response, 200, {
          ok: true,
          copilot: "local CLI",
          mcpUrl: mcpUrl.origin + mcpUrl.pathname,
          mcpReachable: await tcpReachable(mcpUrl),
        });
      } catch (error) {
        sendJson(response, 500, { ok: false, error: error.message });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/ofs/status") {
      try {
        const [connection, config] = await Promise.all([
          database.checkConnection(),
          Promise.resolve(ofsMessageConfig()),
        ]);
        sendJson(response, 200, {
          ...connection,
          messageProfile: {
            user: config.user,
            noOfAuth: config.noOfAuth,
            company: config.company,
            passwordConfigured: Boolean(config.password),
          },
        });
      } catch (error) {
        const config = ofsMessageConfig();
        sendJson(response, 200, {
          status: "failed",
          detail: error.message || "PostgreSQL connection failed.",
          messageProfile: {
            user: config.user,
            noOfAuth: config.noOfAuth,
            company: config.company,
            passwordConfigured: Boolean(config.password),
          },
        });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/ofs/queue") {
      try {
        const rows = await database.list();
        const config = ofsMessageConfig();
        sendJson(response, 200, {
          rows: rows.map((row) => {
            const message = typeof row.xmlrecord === "string" ? row.xmlrecord : JSON.stringify(row.xmlrecord ?? "");
            return { recid: row.recid, message: maskOFSMessage(message, config) };
          }),
        });
      } catch (error) {
        sendJson(response, 503, { error: error.message || "OFS message queue could not be loaded." });
      }
      return;
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/ofs/")) {
      if (!isAllowedOrigin(request)) {
        sendJson(response, 403, { error: "Requests must come from this local interface." });
        return;
      }
      const requestId = randomUUID().slice(0, 8);
      try {
        const body = await readJsonBody(request, MAX_OFS_MESSAGE_BYTES + 1024);
        const config = ofsMessageConfig();
        if (url.pathname === "/api/ofs/generate") {
          sendJson(response, 200, { message: generateOFSMessage(body, config) });
          return;
        }
        if (url.pathname === "/api/ofs/validate" || url.pathname === "/api/ofs/queue") {
          if (url.pathname === "/api/ofs/queue" && body?.confirm !== true) {
            throw Object.assign(new Error("Adding an OFS message to the queue requires explicit confirmation."), { status: 400 });
          }
          const parsed = parseOFSMessage(body?.message, config);
          const validation = await checkOFSMessage(parsed);
          const errors = parsed.operation === "I" ? ofsInputErrors(validation) : [];
          if (errors.length) {
            throw Object.assign(new Error(`Transact validation rejected this OFS message: ${errors.join("; ")}`), {
              status: 422,
              result: validation,
            });
          }
          if (url.pathname === "/api/ofs/validate") {
            sendJson(response, 200, {
              valid: true,
              operation: parsed.operation,
              application: parsed.application,
              id: parsed.id,
              ...(parsed.operation === "I" ? { fieldCount: parsed.fields.length } : {}),
              result: validation,
            });
            return;
          }
          const recid = `T24-BROWSER-${randomUUID().toUpperCase()}`;
          const savedId = await database.add(recid, body.message.trim());
          sendJson(response, 201, { recid: savedId, operation: parsed.operation, validation });
          return;
        }
        if (url.pathname === "/api/ofs/run") {
          if (body?.confirm !== true) {
            throw Object.assign(new Error("Running an OFS message requires explicit confirmation."), { status: 400 });
          }
          const hasMessage = typeof body.message === "string";
          const hasRecid = typeof body.recid === "string" && body.recid.trim();
          if (hasMessage === Boolean(hasRecid)) {
            throw Object.assign(new Error("Provide either an OFS message or one queue record ID."), { status: 400 });
          }
          let message = body.message;
          let recid;
          if (hasRecid) {
            recid = body.recid.trim();
            const queued = await database.get(recid);
            if (!queued) throw Object.assign(new Error(`OFS queue record ${recid} was not found.`), { status: 404 });
            message = typeof queued.xmlrecord === "string" ? queued.xmlrecord : JSON.stringify(queued.xmlrecord ?? "");
          }
          const parsed = parseOFSMessage(message, config);
          if (parsed.operation === "S") {
            const result = await transact({
              url: getMcpUrl().toString(),
              tool: "ofs-read",
              args: { application: parsed.application, id: parsed.id },
            });
            console.info(`[ofs:${requestId}] OFS read completed${recid ? ` for queue record ${recid}` : ""}.`);
            sendJson(response, 200, { operation: "S", result, ...(recid ? { recid } : {}) });
            return;
          }
          const { operation, ...args } = parsed;
          const validation = await recordInput({
            url: getMcpUrl().toString(),
            args: { ...args, validate_only: true },
          });
          const validationErrors = ofsInputErrors(validation);
          if (validationErrors.length) {
            throw Object.assign(new Error(`Transact validation rejected this OFS message: ${validationErrors.join("; ")}`), {
              status: 422,
              result: validation,
            });
          }
          const result = await recordInput({
            url: getMcpUrl().toString(),
            args: { ...args, validate_only: false },
          });
          const errors = ofsInputErrors(result);
          if (errors.length) {
            throw Object.assign(new Error(`Transact rejected this OFS message: ${errors.join("; ")}`), {
              status: 422,
              result,
            });
          }
          console.info(`[ofs:${requestId}] OFS input completed${recid ? ` for queue record ${recid}` : ""}; state=${result?.state || "unknown"}.`);
          sendJson(response, 200, { operation, result, ...(recid ? { recid } : {}) });
          return;
        }
        if (url.pathname === "/api/ofs/queue/clear") {
          if (body?.confirm !== true) {
            throw Object.assign(new Error("Clearing the OFS queue requires explicit confirmation."), { status: 400 });
          }
          const deletedCount = await database.clear();
          sendJson(response, 200, { deletedCount });
          return;
        }
        sendJson(response, 404, { error: "Not found." });
      } catch (error) {
        const detail = redactOFSSecret(error.message || "The OFS message request could not be completed.");
        console.error(`[ofs:${requestId}] Request failed: ${detail}`);
        sendJson(response, error.status || 502, {
          error: detail,
          ...(error.result ? { result: error.result } : {}),
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/diagnostics/copilot-login") {
      if (!isAllowedOrigin(request)) {
        sendJson(response, 403, { error: "Requests must come from this local interface." });
        return;
      }
      const requestId = randomUUID().slice(0, 8);
      try {
        await copilotLogin({ timeoutMs: 300_000 });
        console.info(`[copilot-login:${requestId}] Local Copilot sign-in completed.`);
        sendJson(response, 200, { authenticated: true });
      } catch (error) {
        console.error(`[copilot-login:${requestId}] Sign-in failed: ${error.message}`);
        sendJson(response, error.status || 502, {
          error: error.message || "Copilot sign-in did not complete.",
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/diagnostics/run") {
      if (!isAllowedOrigin(request)) {
        sendJson(response, 403, { error: "Requests must come from this local interface." });
        return;
      }

      const mcpUrl = (() => {
        try {
          return getMcpUrl();
        } catch {
          return null;
        }
      })();
      const result = {
        checkedAt: new Date().toISOString(),
        configuration: diagnosticConfiguration(copilotDiagnostics, getDatabaseConfiguration, ofsMessageConfig),
        checks: {
          database: { status: "failed", detail: "PostgreSQL connection check did not complete." },
          webToMcp: { status: "failed", detail: "Transact MCP tool check did not complete." },
          assistant: { status: "unavailable", detail: "Copilot CLI check did not complete." },
          assistantToMcp: { status: "not-tested", detail: "Requires a successful Assistant check." },
          wordMcp: { status: "not-tested", detail: "Requires a successful Assistant check." },
          screenshotMcp: { status: "not-tested", detail: "Requires a successful Assistant check." },
        },
      };

      const [databaseCheck, mcpCheck, assistantCheck] = await Promise.allSettled([
        database.checkConnection(),
        mcpUrl
          ? transact({ url: mcpUrl.toString(), tool: "transact-context", args: {} })
          : Promise.reject(new Error("The configured Transact MCP URL is invalid.")),
        copilot({
          prompt: "Reply with exactly this text and nothing else: TRANSACT_ASSISTANT_DIAGNOSTIC_OK",
          writeConfirmed: false,
          includeTransactMcp: false,
          timeoutMs: 90_000,
        }),
      ]);

      result.checks.database = databaseCheck.status === "fulfilled"
        ? databaseCheck.value
        : { status: "failed", detail: databaseCheck.reason?.message || "Could not connect to the local t24 database." };

      if (mcpCheck.status === "fulfilled") {
        result.checks.webToMcp = { status: "connected", detail: "The web app successfully called the read-only transact-context MCP tool." };
      } else {
        result.checks.webToMcp = {
          status: "failed",
          detail: classifyTransactFailure(mcpCheck.reason),
        };
      }

      if (assistantCheck.status === "fulfilled"
          && assistantCheck.value.trim() === "TRANSACT_ASSISTANT_DIAGNOSTIC_OK") {
        result.checks.assistant = { status: "connected", detail: "Copilot CLI launched, authenticated, and returned the expected diagnostic reply." };
        const [assistantMcpCheck, wordMcpCheck, screenshotMcpCheck] = await Promise.allSettled([
          copilot({
            prompt: "For a read-only connectivity test, call the `transact-context` tool from the `transact-browser` MCP server exactly once. Reply exactly `TRANSACT_ASSISTANT_MCP_DIAGNOSTIC_OK` only if that tool call succeeds; otherwise reply exactly `TRANSACT_ASSISTANT_MCP_DIAGNOSTIC_FAILED`.",
            mcpUrl: diagnosticMcpUrl(server.address()?.port || PORT),
            writeConfirmed: false,
            allowedTools: ["transact-browser(transact-context)"],
            cwd: ROOT,
            timeoutMs: 90_000,
          }),
          copilot({
            prompt: "For a read-only connectivity test, call the registered `list_available_documents` tool on `word-mcp-server` exactly once. Reply exactly `WORD_MCP_DIAGNOSTIC_OK` only if that tool call succeeds; otherwise reply exactly `WORD_MCP_DIAGNOSTIC_FAILED`.",
            includeTransactMcp: false,
            writeConfirmed: false,
            allowedTools: ["word-mcp-server(list_available_documents)"],
            cwd: ROOT,
            timeoutMs: 90_000,
          }),
          copilot({
            prompt: "For a read-only connectivity test, call the registered `browser_tabs` tool on `playwright` exactly once. Reply exactly `SCREENSHOT_MCP_DIAGNOSTIC_OK` only if that tool call succeeds; otherwise reply exactly `SCREENSHOT_MCP_DIAGNOSTIC_FAILED`.",
            includeTransactMcp: false,
            writeConfirmed: false,
            allowedTools: ["playwright(browser_tabs)"],
            cwd: ROOT,
            timeoutMs: 90_000,
          }),
        ]);
        result.checks.assistantToMcp = assistantMcpCheck.status === "fulfilled"
          && assistantMcpCheck.value.trim() === "TRANSACT_ASSISTANT_MCP_DIAGNOSTIC_OK"
          ? { status: "connected", detail: "The Assistant successfully invoked transact-context through its request-scoped MCP connection." }
          : { status: "failed", detail: "The Assistant could not confirm the required Transact MCP tool call. Check the MCP endpoint and Copilot MCP startup output." };
        result.checks.wordMcp = wordMcpCheck.status === "fulfilled"
          && wordMcpCheck.value.trim() === "WORD_MCP_DIAGNOSTIC_OK"
          ? { status: "connected", detail: "The Assistant successfully called list_available_documents through the Word MCP server." }
          : { status: "failed", detail: "The Assistant could not call list_available_documents through the Word MCP server. Check its local MCP registration and server startup." };
        result.checks.screenshotMcp = screenshotMcpCheck.status === "fulfilled"
          && screenshotMcpCheck.value.trim() === "SCREENSHOT_MCP_DIAGNOSTIC_OK"
          ? { status: "connected", detail: "The Assistant successfully called browser_tabs through the Playwright MCP server." }
          : { status: "failed", detail: "The Assistant could not call browser_tabs through the Playwright MCP server. Check its local MCP registration and server startup." };
      } else if (assistantCheck.status === "rejected") {
        result.checks.assistant = classifyAssistantFailure(assistantCheck.reason);
        result.checks.assistantToMcp = { status: "not-tested", detail: "Requires a successful Assistant check." };
      } else {
        result.checks.assistant = { status: "failed", detail: "Copilot CLI replied, but not with the expected diagnostic response." };
        result.checks.assistantToMcp = { status: "not-tested", detail: "Requires a successful Assistant check." };
      }

      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      if (!isAllowedOrigin(request)) {
        sendJson(response, 403, { error: "Requests must come from this local interface." });
        return;
      }
      const requestId = randomUUID().slice(0, 8);
      const startedAt = Date.now();
      try {
        const requestData = validateChatBody(await readJsonBody(request));
        const mcpUrl = getDesignDocumentProxyUrl(server.address()?.port || PORT);
        const prompt = buildPrompt(requestData);
        console.info(`[chat:${requestId}] Starting Transact Assistant request (write tools ${requestData.writeConfirmed ? "enabled" : "denied"}).`);
        const answer = await copilot({
          prompt,
          mcpUrl: mcpUrl.toString(),
          writeConfirmed: requestData.writeConfirmed,
          assistantMode: requestData.assistantMode,
        });
        const largeOutput = await loadCopilotToolOutput(answer);
        console.info(`[chat:${requestId}] Transact Assistant completed in ${Date.now() - startedAt}ms.`);
        sendJson(response, 200, {
          answer,
          ...(largeOutput?.data !== undefined ? { largeResult: largeOutput.data } : {}),
          ...(largeOutput?.error ? { largeResultError: largeOutput.error } : {}),
        });
      } catch (error) {
        console.error(`[chat:${requestId}] Failed after ${Date.now() - startedAt}ms: ${error.message}`);
        sendJson(response, error.status || 502, { error: error.message || "The request could not be completed." });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/direct") {
      if (!isAllowedOrigin(request)) {
        sendJson(response, 403, { error: "Requests must come from this local interface." });
        return;
      }
      const requestId = randomUUID().slice(0, 8);
      const startedAt = Date.now();
      try {
        const body = await readJsonBody(request);
        if (!body || typeof body !== "object" || Array.isArray(body)
            || typeof body.tool !== "string") {
          throw Object.assign(new Error("Provide a Transact tool name and arguments."), { status: 400 });
        }
        const args = validateDirectToolCall(body.tool, body.arguments);
        console.info(`[direct:${requestId}] Calling Transact MCP tool ${body.tool}.`);
        const result = await transact({
          url: getMcpUrl().toString(),
          tool: body.tool,
          args,
        });
        console.info(`[direct:${requestId}] ${body.tool} completed in ${Date.now() - startedAt}ms.`);
        sendJson(response, 200, { result });
      } catch (error) {
        console.error(`[direct:${requestId}] Failed after ${Date.now() - startedAt}ms: ${error.message}`);
        sendJson(response, error.status || 502, { error: error.message || "The Transact request could not be completed." });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/authorise-record") {
      if (!isAllowedOrigin(request)) {
        sendJson(response, 403, { error: "Requests must come from this local interface." });
        return;
      }
      const requestId = randomUUID().slice(0, 8);
      const startedAt = Date.now();
      try {
        const args = validateAuthoriseRecordArgs(await readJsonBody(request));
        const result = await recordAuthorise({ url: getMcpUrl().toString(), args });
        const errors = Array.isArray(result?.errors) ? result.errors : [];
        if (result?.state !== "live" || errors.length) {
          const details = errors.map((entry) => {
            if (typeof entry === "string") return entry;
            return entry?.message || entry?.description || entry?.code || JSON.stringify(entry);
          }).join("; ");
          const state = result?.state ? ` (Transact state: ${result.state})` : "";
          throw Object.assign(new Error(
            `Transact did not confirm authorisation${state}.${details ? ` ${details}` : " Check the Transact response and user permissions."}`,
          ), { status: 502 });
        }
        console.info(`[authorise:${requestId}] Authorisation completed in ${Date.now() - startedAt}ms.`);
        sendJson(response, 200, { result });
      } catch (error) {
        console.error(`[authorise:${requestId}] Failed after ${Date.now() - startedAt}ms: ${error.message}`);
        sendJson(response, error.status || 502, { error: error.message || "Record authorisation could not be completed." });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/aa-arr-activity") {
      if (!isAllowedOrigin(request)) {
        sendJson(response, 403, { error: "Requests must come from this local interface." });
        return;
      }
      const requestId = randomUUID().slice(0, 8);
      const startedAt = Date.now();
      try {
        const args = validateAAActivityArgs(await readJsonBody(request, 96 * 1024));
        console.info(`[aa-activity:${requestId}] ${args.simulate ? "Simulating" : "Submitting"} ${args.activity} for ${args.arrangement}.`);
        const result = await aaActivity({ url: getMcpUrl().toString(), args });
        console.info(`[aa-activity:${requestId}] ${args.simulate ? "Simulation" : "Activity"} completed in ${Date.now() - startedAt}ms; state=${result?.state || "unknown"}.`);
        sendJson(response, 200, { result });
      } catch (error) {
        console.error(`[aa-activity:${requestId}] Failed after ${Date.now() - startedAt}ms: ${error.message}`);
        sendJson(response, error.status || 502, { error: error.message || "AA arrangement activity could not be completed." });
      }
      return;
    }

    if (url.pathname === "/api/generate-eson" && request.method === "POST") {
      if (!isAllowedOrigin(request)) {
        sendJson(response, 403, { error: "Requests must come from this local interface." });
        return;
      }
      const requestId = randomUUID().slice(0, 8);
      const startedAt = Date.now();
      try {
        const body = await readJsonBody(request, 32 * 1024);
        const records = validateEsonRecords(body?.records);
        const skill = await readSkillFile(workspaceRoot, "generate-eson/SKILL.md");
        const referenceExamples = await findReferenceEsonExamples(workspaceRoot, records);
        const prompt = buildEsonPrompt(records, skill, referenceExamples);
        const mcpUrl = getDesignDocumentProxyUrl(server.address()?.port || PORT);
        let files;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const answer = await copilot({
            prompt: attempt === 0
              ? prompt
              : `${prompt}\n\nRetry: the prior response was not a complete ESON bundle. Re-read the live records, follow the application reference structure, and return complete ESON rather than prose.`,
            mcpUrl,
            writeConfirmed: false,
            cwd: workspaceRoot,
            timeoutMs: 15 * 60 * 1000,
            promptViaStdin: true,
            contextTier: "long_context",
          });
          const spooledOutput = await loadCopilotToolOutput(answer);
          if (spooledOutput?.error) throw new Error(spooledOutput.error);
          const assistantAnswer = spooledOutput?.data === undefined
            ? answer
            : typeof spooledOutput.data === "string" ? spooledOutput.data : JSON.stringify(spooledOutput.data);
          try {
            files = parseEsonAssistantAnswer(assistantAnswer, records);
            break;
          } catch (error) {
            if (attempt === 1 || error.status !== 502) throw error;
            console.warn(`[eson:${requestId}] Copilot returned an invalid ESON bundle; retrying once.`);
          }
        }
        if (!files) throw new Error("Copilot did not return an ESON bundle.");
        const savedFiles = await saveGeneratedEsonFiles(workspaceRoot, files);
        console.info(`[eson:${requestId}] Generated ${savedFiles.length} ESON file(s) in ${Date.now() - startedAt}ms.`);
        sendJson(response, 200, { files: savedFiles });
      } catch (error) {
        console.error(`[eson:${requestId}] Generation failed after ${Date.now() - startedAt}ms: ${error.message}`);
        sendJson(response, error.status || 502, { error: error.message || "ESON generation failed." });
      }
      return;
    }

    if (url.pathname === "/api/l3/project" && request.method === "GET") {
      try {
        sendJson(response, 200, await getProjectOverview(javaProjectRoot));
      } catch (error) {
        sendJson(response, error.status || 500, { error: error.message || "Java project could not be loaded." });
      }
      return;
    }

    if (url.pathname === "/api/l3/file" && request.method === "GET") {
      try {
        sendJson(response, 200, await readProjectFile(javaProjectRoot, url.searchParams.get("path")));
      } catch (error) {
        sendJson(response, error.status || (error.code === "ENOENT" ? 404 : 500), {
          error: error.message || "Java project file could not be opened.",
        });
      }
      return;
    }

    if (url.pathname === "/api/l3/search" && request.method === "GET") {
      try {
        const q = url.searchParams.get("q");
        const directory = url.searchParams.get("directory") || "";
        sendJson(response, 200, await searchProject(javaProjectRoot, q, directory));
      } catch (error) {
        sendJson(response, error.status || (error.code === "ENOENT" ? 404 : 500), {
          error: error.message || "Java project search failed.",
        });
      }
      return;
    }

    if (url.pathname === "/api/l3/file" && request.method === "PUT") {
      if (!isAllowedOrigin(request)) {
        sendJson(response, 403, { error: "Requests must come from this local interface." });
        return;
      }
      try {
        const body = await readJsonBody(request, 1024 * 1024 + 16 * 1024);
        const saved = await saveProjectFile(javaProjectRoot, body?.path, body?.content, body?.expectedHash);
        sendJson(response, 200, saved);
      } catch (error) {
        sendJson(response, error.status || 500, { error: error.message || "Java file could not be saved." });
      }
      return;
    }

    if (url.pathname === "/api/l3/assistant" && request.method === "POST") {
      if (!isAllowedOrigin(request)) {
        sendJson(response, 403, { error: "Requests must come from this local interface." });
        return;
      }
      const requestId = randomUUID().slice(0, 8);
      const startedAt = Date.now();
      try {
        const body = await readJsonBody(request, 2 * 1024 * 1024);
        if (!body || !["explain", "edit", "relevance"].includes(body.mode)
            || typeof body.instruction !== "string" || body.instruction.length > 6000
            || !Array.isArray(body.files) || body.files.length > 20
            || (body.directory !== undefined && typeof body.directory !== "string")
            || (body.openFile !== undefined && typeof body.openFile !== "string")
            || (body.selection !== undefined && typeof body.selection !== "string")) {
          throw Object.assign(new Error("Provide a supported Assistant mode, instruction, and project scope."), { status: 400 });
        }
        if (body.mode === "edit" && !body.openFile) {
          throw Object.assign(new Error("Open a project file before requesting an edit."), { status: 400 });
        }
        const documents = await collectProjectAssistantFiles(javaProjectRoot, {
          files: body.mode === "edit" ? [body.openFile] : body.files,
          directory: body.directory || "",
          openFile: body.mode === "edit" ? body.openFile : "",
        });
        const prompt = buildL3AssistantPrompt({
          mode: body.mode,
          instruction: body.instruction,
          documents,
          selection: body.selection || "",
        });
        const answer = await copilot({
          prompt,
          mcpUrl: getDesignDocumentProxyUrl(server.address()?.port || PORT),
          writeConfirmed: false,
          cwd: javaProjectRoot,
          timeoutMs: 5 * 60 * 1000,
          promptViaStdin: true,
          contextTier: "long_context",
        });
        const result = body.mode === "edit"
          ? { suggestion: parseL3EditSuggestion(answer, body.openFile) }
          : { answer };
        console.info(`[l3-assistant:${requestId}] ${body.mode} completed in ${Date.now() - startedAt}ms for ${documents.length} file(s).`);
        sendJson(response, 200, result);
      } catch (error) {
        console.error(`[l3-assistant:${requestId}] Failed after ${Date.now() - startedAt}ms: ${error.message}`);
        sendJson(response, error.status || 502, { error: error.message || "Java project Assistant request failed." });
      }
      return;
    }

    if (url.pathname === "/api/reference-eson" && request.method === "GET") {
      if (!isAllowedOrigin(request)) {
        sendJson(response, 403, { error: "Requests must come from this local interface." });
        return;
      }
      try {
        const records = validateEsonRecords([{
          company: url.searchParams.get("company"),
          application: url.searchParams.get("application"),
          id: url.searchParams.get("id"),
        }]);
        const files = await findReferenceEson(workspaceRoot, records);
        sendJson(response, 200, { files });
      } catch (error) {
        sendJson(response, error.status || 500, { error: error.message || "Reference ESON files could not be searched." });
      }
      return;
    }

    if (url.pathname === "/api/skills" && request.method === "GET") {
      try {
        sendJson(response, 200, { skills: await listSkills(workspaceRoot) });
      } catch (error) {
        sendJson(response, error.status || 500, { error: error.message || "Skills could not be listed." });
      }
      return;
    }

    if (url.pathname === "/api/skills/file" && request.method === "GET") {
      try {
        const content = await readSkillFile(workspaceRoot, url.searchParams.get("path"));
        sendJson(response, 200, { content });
      } catch (error) {
        sendJson(response, error.status || (error.code === "ENOENT" ? 404 : 500), { error: error.message || "Skill file could not be read." });
      }
      return;
    }

    if (url.pathname === "/api/skills" && request.method === "POST") {
      if (!isAllowedOrigin(request)) {
        sendJson(response, 403, { error: "Requests must come from this local interface." });
        return;
      }
      try {
        const body = await readJsonBody(request, 1024 * 1024 + 4096);
        const name = typeof body?.name === "string" ? body.name.trim().toLowerCase() : "";
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)
            || typeof body?.content !== "string"
            || !body.content.trim()) {
          throw Object.assign(new Error("Provide a skill name and non-empty Markdown file."), { status: 400 });
        }
        await saveSkillFile(workspaceRoot, `${name}/SKILL.md`, body.content, { createOnly: true });
        sendJson(response, 201, { path: `${name}/SKILL.md` });
      } catch (error) {
        sendJson(response, error.status || 500, { error: error.message || "Skill upload failed." });
      }
      return;
    }

    if (url.pathname === "/api/skills/file" && request.method === "PUT") {
      if (!isAllowedOrigin(request)) {
        sendJson(response, 403, { error: "Requests must come from this local interface." });
        return;
      }
      try {
        const body = await readJsonBody(request, 1024 * 1024 + 4096);
        if (typeof body?.path !== "string" || typeof body?.content !== "string") {
          throw Object.assign(new Error("Provide a skill file path and Markdown content."), { status: 400 });
        }
        await saveSkillFile(workspaceRoot, body.path, body.content);
        sendJson(response, 200, { path: body.path });
      } catch (error) {
        sendJson(response, error.status || 500, { error: error.message || "Skill edit could not be saved." });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/record-design") {
      if (!isAllowedOrigin(request)) {
        sendJson(response, 403, { error: "Requests must come from this local interface." });
        return;
      }
      const requestId = randomUUID().slice(0, 8);
      const startedAt = Date.now();
      try {
        const requestData = validateRecordDesignBody(await readJsonBody(request, MAX_RECORD_INPUT_BYTES));
        const url = getMcpUrl().toString();
        const existingRecordCheck = await recordRead({
          url,
          tool: "ofs-read",
          args: { application: requestData.application, id: requestData.id },
        });
        const operation = identifyRecordOperation(existingRecordCheck);
        const validation = await recordInput({
          url,
          args: {
            application: requestData.application,
            id: requestData.id,
            ...(requestData.version ? { version: requestData.version } : {}),
            fields: requestData.fields,
            confirm: true,
            validate_only: true,
          },
        });
        const valid = isRecordValidationPassed(validation);
        if (requestData.action === "validate" || !valid) {
          sendJson(response, 200, { valid, submitted: false, operation, validation });
          return;
        }
        const result = await recordInput({
          url,
          args: {
            application: requestData.application,
            id: requestData.id,
            ...(requestData.version ? { version: requestData.version } : {}),
            fields: requestData.fields,
            confirm: true,
            validate_only: false,
          },
        });
        console.info(`[design:${requestId}] Record input completed in ${Date.now() - startedAt}ms.`);
        let historyWarning;
        if (isAppliedRecord(result)) {
          try {
            await saveAmendment({
              application: requestData.application,
              recordId: result?.record?.id || result?.id || requestData.id,
              fields: result?.record?.fields || result?.fields || requestData.fields,
              state: result?.state || "live",
              source: "record-designer",
            });
          } catch (error) {
            historyWarning = `Record input succeeded, but recent amendment history could not be saved: ${error.message}`;
            console.error(`[design:${requestId}] ${historyWarning}`);
          }
        } else if (result?.state === "unauthorised") {
          historyWarning = "The record is awaiting authorisation and has not been added to recent amendments yet.";
        }
        sendJson(response, 200, {
          valid: true,
          submitted: true,
          operation,
          validation,
          result,
          ...(historyWarning ? { historyWarning } : {}),
        });
      } catch (error) {
        console.error(`[design:${requestId}] Failed after ${Date.now() - startedAt}ms: ${error.message}`);
        sendJson(response, error.status || 502, { error: error.message || "Record design request could not be completed." });
      }
      return;
    }

    if (request.method !== "GET" || url.pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "Not found." });
      return;
    }
    await serveStatic(url.pathname, response);
  });
  server.once("close", () => {
    if (typeof database.close === "function") {
      void Promise.resolve(database.close()).catch((error) => console.error(`PostgreSQL pool could not close: ${error.message}`));
    }
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, HOST, () => {
    console.log(`Transact Assistant Browser listening at http://${HOST}:${PORT}`);
    console.log(`MCP endpoint: ${process.env.TRANSACT_MCP_URL || "http://localhost:9189/mcp"}`);
  });
}
