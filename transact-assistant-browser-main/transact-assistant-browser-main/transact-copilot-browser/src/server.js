import { createServer as createHttpServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrompt, runCopilot } from "./copilot.js";
import {
  buildEsonPrompt,
  findReferenceEson,
  listSkills,
  parseEsonAssistantAnswer,
  readSkillFile,
  saveGeneratedEsonFiles,
  saveSkillFile,
  validateEsonRecords,
} from "./local-tools.js";
import {
  callTransactAuthorise,
  callTransactInput,
  callTransactTool,
  validateAuthoriseRecordArgs,
  validateDirectToolCall,
} from "./transact-mcp.js";
import { isAppliedRecord, recordAmendment } from "./design-document/amendment-store.js";
import { getDesignDocumentProxyUrl, handleDesignDocumentRequest } from "./design-document/routes.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 4173;
const MAX_BODY_BYTES = 32 * 1024;
const MAX_RECORD_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 6000;
const MAX_HISTORY_ITEMS = 8;
const MAX_COPILOT_TOOL_OUTPUT_BYTES = 32 * 1024 * 1024;
const WORKSPACE_ROOT = path.resolve(ROOT, "..");
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
  if (body.action === "submit" && body.confirm !== true) {
    throw Object.assign(new Error("Record submission requires explicit confirmation."), { status: 400 });
  }
  if (!Array.isArray(body.fields) || body.fields.length > 1000) {
    throw Object.assign(new Error("Record fields must be an array of at most 1,000 values."), { status: 400 });
  }
  return { action: body.action, application, id, fields: body.fields };
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
  transact = callTransactTool,
  recordInput = callTransactInput,
  recordRead = callTransactTool,
  recordAuthorise = callTransactAuthorise,
  saveAmendment = recordAmendment,
  listAmendments,
  selectAmendments,
  workspaceRoot = process.env.TRANSACT_BROWSER_WORKSPACE_ROOT || WORKSPACE_ROOT,
} = {}) {
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
        const answer = await copilot({
          prompt: buildEsonPrompt(records, skill),
          mcpUrl: getDesignDocumentProxyUrl(server.address()?.port || PORT),
          writeConfirmed: false,
          cwd: workspaceRoot,
          timeoutMs: 15 * 60 * 1000,
          promptViaStdin: true,
        });
        const spooledOutput = await loadCopilotToolOutput(answer);
        if (spooledOutput?.error) throw new Error(spooledOutput.error);
        const assistantAnswer = spooledOutput?.data === undefined
          ? answer
          : typeof spooledOutput.data === "string" ? spooledOutput.data : JSON.stringify(spooledOutput.data);
        const files = await saveGeneratedEsonFiles(
          workspaceRoot,
          parseEsonAssistantAnswer(assistantAnswer, records),
        );
        console.info(`[eson:${requestId}] Generated ${files.length} ESON file(s) in ${Date.now() - startedAt}ms.`);
        sendJson(response, 200, { files });
      } catch (error) {
        console.error(`[eson:${requestId}] Generation failed after ${Date.now() - startedAt}ms: ${error.message}`);
        sendJson(response, error.status || 502, { error: error.message || "ESON generation failed." });
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
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, HOST, () => {
    console.log(`Transact Assistant Browser listening at http://${HOST}:${PORT}`);
    console.log(`MCP endpoint: ${process.env.TRANSACT_MCP_URL || "http://localhost:9189/mcp"}`);
  });
}
