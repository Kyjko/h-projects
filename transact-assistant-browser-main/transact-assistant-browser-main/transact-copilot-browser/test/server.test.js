import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "../src/server.js";

async function withServer(copilot, run, transact, recordInput, recordRead, saveAmendment, recordAuthorise, workspaceRoot, copilotDiagnostics, aaActivity, copilotLogin, database) {
  const server = createServer({
    copilot, transact, recordInput, recordRead, saveAmendment, recordAuthorise, workspaceRoot,
    copilotDiagnostics, aaActivity, copilotLogin,
    database: database || {
      checkConnection: async () => ({ status: "connected", detail: "Connected to test database." }),
      list: async () => [],
      get: async () => null,
      add: async (recid) => recid,
      clear: async () => 0,
    },
    ofsMessageConfig: () => ({ user: "AUTHOR", password: "123456", company: "", noOfAuth: "0" }),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("diagnostics test the web MCP connection, CLI, and Assistant MCP access without exposing config contents", async () => {
  const invocations = [];
  let transactCalls = 0;
  await withServer(async (options) => {
    invocations.push(options);
    if (options.allowedTools?.includes("word-mcp-server(list_available_documents)")) return "WORD_MCP_DIAGNOSTIC_OK";
    if (options.allowedTools?.includes("playwright(browser_tabs)")) return "SCREENSHOT_MCP_DIAGNOSTIC_OK";
    if (options.mcpUrl) return "TRANSACT_ASSISTANT_MCP_DIAGNOSTIC_OK";
    return "TRANSACT_ASSISTANT_DIAGNOSTIC_OK";
  }, async (origin) => {
    const response = await fetch(`${origin}/api/diagnostics/run`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: "{}",
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(result.checks, {
      database: {
        status: "connected",
        detail: "Connected to test database.",
      },
      webToMcp: {
        status: "connected",
        detail: "The web app successfully called the read-only transact-context MCP tool.",
      },
      assistant: {
        status: "connected",
        detail: "Copilot CLI launched, authenticated, and returned the expected diagnostic reply.",
      },
      assistantToMcp: {
        status: "connected",
        detail: "The Assistant successfully invoked transact-context through its request-scoped MCP connection.",
      },
      wordMcp: {
        status: "connected",
        detail: "The Assistant successfully called list_available_documents through the Word MCP server.",
      },
      screenshotMcp: {
        status: "connected",
        detail: "The Assistant successfully called browser_tabs through the Playwright MCP server.",
      },
    });
    assert.equal(transactCalls, 1);
    assert.equal(invocations.length, 4);
    assert.equal(invocations[0].includeTransactMcp, false);
    assert.equal(invocations[0].writeConfirmed, false);
    const transactInvocation = invocations.find(({ allowedTools }) => allowedTools?.includes("transact-browser(transact-context)"));
    assert.match(transactInvocation.prompt, /transact-context/);
    assert.equal(transactInvocation.mcpUrl, `${origin}/api/design-document/transact`);
    const wordInvocation = invocations.find(({ allowedTools }) => allowedTools?.includes("word-mcp-server(list_available_documents)"));
    const screenshotInvocation = invocations.find(({ allowedTools }) => allowedTools?.includes("playwright(browser_tabs)"));
    assert.match(wordInvocation.prompt, /call the registered `list_available_documents` tool/);
    assert.match(screenshotInvocation.prompt, /call the registered `browser_tabs` tool/);
    assert.equal(wordInvocation.includeTransactMcp, false);
    assert.equal(screenshotInvocation.includeTransactMcp, false);
    assert.equal(wordInvocation.cwd, screenshotInvocation.cwd);
    assert.match(result.configuration.transactMcp.endpointSource, /Default|TRANSACT_MCP_URL/);
    assert.equal(JSON.stringify(result).includes("secret-value"), false);
    assert.equal(JSON.stringify(result).includes("123456"), false);
  }, async ({ tool, args }) => {
    transactCalls += 1;
    assert.equal(tool, "transact-context");
    assert.deepEqual(args, {});
    return { context: "Transact" };
  }, undefined, undefined, undefined, undefined, undefined, () => ({
    available: true,
    executable: "copilot",
    configFiles: [
      { path: "C:\\Users\\test\\.copilot\\config.json", exists: true },
      { path: "C:\\Users\\test\\.copilot\\mcp-config.json", exists: true },
    ],
  }));
});

test("diagnostics identify an unauthenticated Copilot CLI without skipping the direct MCP check", async () => {
  let transactCalled = false;
  await withServer(async () => {
    throw new Error("Copilot CLI exited with code 1. You are not authenticated; please login.");
  }, async (origin) => {
    const response = await fetch(`${origin}/api/diagnostics/run`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: "{}",
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.checks.webToMcp.status, "connected");
    assert.equal(result.checks.assistant.status, "unauthenticated");
    assert.match(result.checks.assistant.detail, /copilot login/);
    assert.equal(result.checks.assistantToMcp.status, "not-tested");
    assert.equal(result.checks.wordMcp.status, "not-tested");
    assert.equal(result.checks.screenshotMcp.status, "not-tested");
    assert.equal(transactCalled, true);
  }, async () => {
    transactCalled = true;
    return {};
  }, undefined, undefined, undefined, undefined, undefined, () => ({
    available: false,
    executable: "",
    configFiles: [],
  }));
});

test("diagnostics report Word and screenshot MCP availability independently", async () => {
  await withServer(async (options) => {
    if (options.allowedTools?.includes("word-mcp-server(list_available_documents)")) return "WORD_MCP_DIAGNOSTIC_FAILED";
    if (options.allowedTools?.includes("playwright(browser_tabs)")) return "SCREENSHOT_MCP_DIAGNOSTIC_OK";
    if (options.mcpUrl) return "TRANSACT_ASSISTANT_MCP_DIAGNOSTIC_OK";
    return "TRANSACT_ASSISTANT_DIAGNOSTIC_OK";
  }, async (origin) => {
    const response = await fetch(`${origin}/api/diagnostics/run`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: "{}",
    });
    const result = await response.json();
    assert.equal(result.checks.assistantToMcp.status, "connected");
    assert.equal(result.checks.wordMcp.status, "failed");
    assert.match(result.checks.wordMcp.detail, /Word MCP server/);
    assert.equal(result.checks.screenshotMcp.status, "connected");
  }, async () => ({}));
});

test("OFS diagnostics and queue reads report database health without exposing stored passwords", async () => {
  const message = "CUSTOMER,/I///0,AUTHOR/123456,100,MNEMONIC=TEST";
  await withServer(async () => "unused", async (origin) => {
    const status = await fetch(`${origin}/api/ofs/status`);
    const statusBody = await status.json();
    assert.equal(statusBody.status, "connected");
    assert.equal(statusBody.messageProfile.noOfAuth, "0");
    assert.equal(statusBody.messageProfile.passwordConfigured, true);
    assert.equal(JSON.stringify(statusBody).includes("123456"), false);

    const queue = await fetch(`${origin}/api/ofs/queue`);
    const queueBody = await queue.json();
    assert.equal(queue.status, 200);
    assert.equal(queueBody.rows[0].recid, "T24-1");
    assert.equal(queueBody.rows[0].message.includes("123456"), false);
  }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, {
    checkConnection: async () => ({ status: "connected", detail: "Connected to test database." }),
    list: async () => [{ recid: "T24-1", xmlrecord: message }],
    get: async () => null,
    add: async (recid) => recid,
    clear: async () => 0,
  });
});

test("OFS generation and queue insertion require valid Transact input", async () => {
  const validationCalls = [];
  let inserted;
  await withServer(async () => "unused", async (origin) => {
    const generated = await fetch(`${origin}/api/ofs/generate`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        application: "CUSTOMER",
        function: "I",
        id: "100",
        data: "MNEMONIC=TEST",
      }),
    });
    const generatedBody = await generated.json();
    assert.equal(generated.status, 200);
    assert.equal(generatedBody.message, "CUSTOMER,/I///0,AUTHOR/123456,100,MNEMONIC=TEST");

    const queued = await fetch(`${origin}/api/ofs/queue`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ message: generatedBody.message, confirm: true }),
    });
    const queuedBody = await queued.json();
    assert.equal(queued.status, 201);
    assert.match(queuedBody.recid, /^T24-BROWSER-[A-F0-9-]+$/);
    assert.deepEqual(inserted, { recid: queuedBody.recid, message: generatedBody.message });
  }, undefined, async ({ args }) => {
    validationCalls.push(args);
    return { errors: [] };
  }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, {
    checkConnection: async () => ({ status: "connected", detail: "Connected." }),
    list: async () => [],
    get: async () => null,
    add: async (recid, message) => {
      inserted = { recid, message };
      return recid;
    },
    clear: async () => 0,
  });
  assert.equal(validationCalls.length, 1);
  assert.equal(validationCalls[0].validate_only, true);
  assert.equal(validationCalls[0].application, "CUSTOMER");
});

test("queued OFS execution validates before submit and queue clearing requires confirmation", async () => {
  const message = "CUSTOMER,/I///0,AUTHOR/123456,100,MNEMONIC=TEST";
  const inputCalls = [];
  let clearCount = 0;
  await withServer(async () => "unused", async (origin) => {
    const missingConfirmation = await fetch(`${origin}/api/ofs/queue/clear`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: false }),
    });
    assert.equal(missingConfirmation.status, 400);
    assert.equal(clearCount, 0);

    const response = await fetch(`${origin}/api/ofs/run`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ recid: "T24-1", confirm: true }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.state, "live");
    assert.deepEqual(inputCalls.map((args) => args.validate_only), [true, false]);

    const clear = await fetch(`${origin}/api/ofs/queue/clear`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    assert.equal(clear.status, 200);
    assert.equal((await clear.json()).deletedCount, 7);
    assert.equal(clearCount, 1);
  }, undefined, async ({ args }) => {
    inputCalls.push(args);
    return { state: args.validate_only ? "validated" : "live", errors: [] };
  }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, {
    checkConnection: async () => ({ status: "connected", detail: "Connected." }),
    list: async () => [],
    get: async () => ({ recid: "T24-1", xmlrecord: message }),
    add: async (recid) => recid,
    clear: async () => {
      clearCount += 1;
      return 7;
    },
  });
});

test("OFS function S calls ofs-read and returns its record without invoking ofs-input", async () => {
  const readCalls = [];
  const inputCalls = [];
  const message = "CUSTOMER,/S///0,AUTHOR/123456,100";
  await withServer(async () => "unused", async (origin) => {
    const response = await fetch(`${origin}/api/ofs/run`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ message, confirm: true }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.operation, "S");
    assert.deepEqual(body.result, { record: { id: "100", shortName: "Sample customer" } });
  }, async ({ tool, args }) => {
    readCalls.push({ tool, args });
    return { record: { id: args.id, shortName: "Sample customer" } };
  }, async ({ args }) => {
    inputCalls.push(args);
    return { errors: [] };
  });
  assert.deepEqual(readCalls, [{ tool: "ofs-read", args: { application: "CUSTOMER", id: "100" } }]);
  assert.deepEqual(inputCalls, []);
});

test("Copilot login endpoint starts local web-flow authentication", async () => {
  let loginOptions;
  await withServer(async () => "unused", async (origin) => {
    const response = await fetch(`${origin}/api/diagnostics/copilot-login`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authenticated: true });
    assert.deepEqual(loginOptions, { timeoutMs: 300_000 });
  }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, async (options) => {
    loginOptions = options;
  });
});

test("Copilot login endpoint rejects cross-origin requests without launching the CLI", async () => {
  let called = false;
  await withServer(async () => "unused", async (origin) => {
    const response = await fetch(`${origin}/api/diagnostics/copilot-login`, {
      method: "POST",
      headers: { Origin: "http://attacker.example", "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 403);
    assert.equal(called, false);
  }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, async () => {
    called = true;
  });
});

test("diagnostics reject cross-origin requests before launching either connection check", async () => {
  let called = false;
  await withServer(async () => {
    called = true;
    return "unused";
  }, async (origin) => {
    const response = await fetch(`${origin}/api/diagnostics/run`, {
      method: "POST",
      headers: { Origin: "http://attacker.example", "Content-Type": "application/json" },
      body: "{}",
    });
    const result = await response.json();
    assert.equal(response.status, 403);
    assert.equal(called, false);
    assert.match(result.error, /same-origin|local interface/i);
  }, async () => {
    called = true;
    return {};
  });
});

test("chat endpoint builds a contextual Copilot request from same-origin calls", async () => {
  let received;
  await withServer(async (options) => {
    received = options;
    return "record result";
  }, async (origin) => {
    const response = await fetch(`${origin}/api/chat`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Read this",
        application: "CUSTOMER",
        recordId: "123",
        history: [{ role: "user", content: "previous question" }],
        writeConfirmed: false,
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { answer: "record result" });
    assert.match(received.prompt, /Current Transact application: CUSTOMER/);
    assert.match(received.prompt, /Current record ID: 123/);
    assert.equal(received.writeConfirmed, false);
    assert.equal(received.mcpUrl, `${origin}/api/design-document/transact`);
  });
});

test("chat endpoint rejects cross-origin requests before starting Copilot", async () => {
  let called = false;
  await withServer(async () => {
    called = true;
    return "should not run";
  }, async (origin) => {
    const response = await fetch(`${origin}/api/chat`, {
      method: "POST",
      headers: { Origin: "http://attacker.example", "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Read CUSTOMER 123" }),
    });
    assert.equal(response.status, 403);
    assert.equal(called, false);
  });
});

test("chat endpoint validates application names", async () => {
  await withServer(async () => "unused", async (origin) => {
    const response = await fetch(`${origin}/api/chat`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Read", application: "CUSTOMER/ACCOUNT" }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Application names/);
  });
});

test("designer assistant requests remain read-only even if the request asks to enable writes", async () => {
  let received;
  await withServer(async (options) => {
    received = options;
    return "Suggestion only.";
  }, async (origin) => {
    const response = await fetch(`${origin}/api/chat`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Suggest values for this record",
        application: "CUSTOMER",
        recordId: "NEW-CUSTOMER",
        assistantMode: "record-design-suggestions",
        writeConfirmed: true,
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(received.writeConfirmed, false);
    assert.match(received.prompt, /suggestions only/);
    assert.match(received.prompt, /never submit or validate a record/);
  });
});

test("record designer validates with Transact without writing", async () => {
  const calls = [];
  await withServer(async () => "unused", async (origin) => {
    const response = await fetch(`${origin}/api/record-design`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "validate",
        application: "CUSTOMER",
        id: "NEW-CUSTOMER",
        fields: [{ name: "MNEMONIC", value: "NEWCUST" }],
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      valid: false,
      submitted: false,
      operation: "create",
      validation: { errors: [{ message: "MISSING SHORT.NAME" }] },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.validate_only, true);
    assert.equal(calls[0].args.confirm, true);
  }, undefined, async (request) => {
    calls.push(request);
    return { errors: [{ message: "MISSING SHORT.NAME" }] };
  }, async () => ({
    state: "transient",
    statusCode: -1,
    acceptanceFlag: "NO",
    fields: null,
    errors: [{ code: "MISSING MNEMONIC.CUSTOMER - RECORD" }],
  }));
});

test("record designer revalidates before submitting and does not auto-authorise", async () => {
  const calls = [];
  await withServer(async () => "unused", async (origin) => {
    const response = await fetch(`${origin}/api/record-design`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "submit",
        confirm: true,
        application: "CUSTOMER",
        id: "NEW-CUSTOMER",
        fields: [
          { name: "MNEMONIC", value: "NEWCUST" },
          { name: "SHORT.NAME", mv: 1, value: "New Customer" },
        ],
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      valid: true,
      submitted: true,
      operation: "create",
      validation: { statusCode: 1, errors: [] },
      result: { state: "unauthorised", statusCode: 1 },
      historyWarning: "The record is awaiting authorisation and has not been added to recent amendments yet.",
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].args.validate_only, true);
    assert.equal(calls[1].args.validate_only, false);
    assert.equal(calls[1].args.confirm, true);
    assert.equal(calls[1].args.application, "CUSTOMER");
  }, undefined, async (request) => {
    calls.push(request);
    return request.args.validate_only
      ? { statusCode: 1, errors: [] }
      : { state: "unauthorised", statusCode: 1 };
  }, async () => ({
    state: "transient",
    statusCode: -1,
    acceptanceFlag: "NO",
    fields: null,
    errors: [{ code: "MISSING MNEMONIC.CUSTOMER - RECORD" }],
  }));
});

test("record designer forwards a selected VERSION to validation and input", async () => {
  const calls = [];
  await withServer(async () => "unused", async (origin) => {
    const response = await fetch(`${origin}/api/record-design`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "submit",
        confirm: true,
        application: "FUNDS.TRANSFER",
        version: "FT.AUTO",
        id: "FT-1",
        fields: [{ name: "DEBIT.ACCT.NO", value: "10000001" }],
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(calls.map(({ args }) => args.version), ["FT.AUTO", "FT.AUTO"]);
  }, undefined, async (request) => {
    calls.push(request);
    return request.args.validate_only
      ? { statusCode: 1, errors: [] }
      : { state: "unauthorised", statusCode: 1 };
  }, async () => ({
    state: "transient",
    acceptanceFlag: "NO",
    errors: [{ code: "MISSING FUNDS.TRANSFER - RECORD" }],
  }));
});

test("record designer stores a successfully applied record in recent amendment history", async () => {
  const saved = [];
  let writeCount = 0;
  await withServer(async () => "unused", async (origin) => {
    const response = await fetch(`${origin}/api/record-design`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "submit",
        confirm: true,
        application: "CUSTOMER",
        id: "NEW-CUSTOMER",
        fields: [{ name: "MNEMONIC", value: "NEWCUST" }],
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.submitted, true);
    assert.equal(body.operation, "create");
    assert.deepEqual(saved, [{
      application: "CUSTOMER",
      recordId: "NEW-CUSTOMER",
      fields: [{ name: "MNEMONIC", value: "NEWCUST" }],
      state: "live",
      source: "record-designer",
    }]);
  }, undefined, async () => {
    writeCount += 1;
    return writeCount === 1
      ? { statusCode: 1, errors: [] }
      : {
        state: "live",
        statusCode: 1,
        record: { id: "NEW-CUSTOMER", fields: [{ name: "MNEMONIC", value: "NEWCUST" }] },
      };
  }, async () => ({
    state: "transient",
    statusCode: -1,
    acceptanceFlag: "NO",
    fields: null,
    errors: [{ code: "MISSING MNEMONIC.CUSTOMER - RECORD" }],
  }), async (amendment) => saved.push(amendment));
});

test("record designer requires same-origin calls and explicit submit confirmation", async () => {
  let called = false;
  await withServer(async () => "unused", async (origin) => {
    const missingConfirmation = await fetch(`${origin}/api/record-design`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "submit",
        application: "CUSTOMER",
        id: "NEW-CUSTOMER",
        fields: [],
      }),
    });
    assert.equal(missingConfirmation.status, 400);

    const crossOrigin = await fetch(`${origin}/api/record-design`, {
      method: "POST",
      headers: { Origin: "http://attacker.example", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "validate", application: "CUSTOMER", id: "NEW-CUSTOMER", fields: [] }),
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(called, false);
  }, undefined, async () => {
    called = true;
    return {};
  }, async () => {
    called = true;
    return {};
  });
});

test("record designer submits an AMEND when the ID already exists", async () => {
  const calls = [];
  await withServer(async () => "unused", async (origin) => {
    const response = await fetch(`${origin}/api/record-design`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "submit",
        confirm: true,
        application: "CUSTOMER",
        id: "EXISTING",
        fields: [{ name: "MNEMONIC", value: "OTHER" }],
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.operation, "amend");
    assert.equal(body.submitted, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].args.id, "EXISTING");
    assert.equal(calls[1].args.validate_only, false);
  }, undefined, async (request) => {
    calls.push(request);
    return { state: "live", statusCode: 1, errors: [] };
  }, async () => ({ fields: [{ name: "MNEMONIC", value: "EXISTING" }] }));
});

test("direct endpoint dispatches validated read calls without invoking Copilot", async () => {
  let received;
  await withServer(async () => assert.fail("Copilot must not be called"), async (origin) => {
    const response = await fetch(`${origin}/api/direct`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "ofs-enquiry",
        arguments: { enquiry: "%CUSTOMER", max_rows: 500 },
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      result: { enquiry: "%CUSTOMER", rows: [{ id: "123" }] },
    });
    assert.deepEqual(received, {
      url: "http://localhost:9189/mcp",
      tool: "ofs-enquiry",
      args: { enquiry: "%CUSTOMER", max_rows: 500 },
    });
  }, async (request) => {
    received = request;
    return { enquiry: "%CUSTOMER", rows: [{ id: "123" }] };
  });
});

test("direct record enquiry accepts the Transact native ID wildcard selection", async () => {
  let received;
  await withServer(async () => assert.fail("Copilot must not be called"), async (origin) => {
    const response = await fetch(`${origin}/api/direct`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "ofs-enquiry",
        arguments: {
          enquiry: "%VERSION",
          selection: [{ field: "@ID", operator: "LK", value: "AA.ARRANGEMENT..." }],
          max_rows: 5000,
        },
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(received.args.selection, [
      { field: "@ID", operator: "LK", value: "AA.ARRANGEMENT..." },
    ]);
  }, async (request) => {
    received = request;
    return { enquiry: "%VERSION", rows: [] };
  });
});

test("direct endpoint rejects mutations and cross-origin calls", async () => {
  let called = false;
  await withServer(async () => "unused", async (origin) => {
    const forbiddenTool = await fetch(`${origin}/api/direct`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "ofs-input", arguments: { application: "CUSTOMER" } }),
    });
    assert.equal(forbiddenTool.status, 400);

    const crossOrigin = await fetch(`${origin}/api/direct`, {
      method: "POST",
      headers: { Origin: "http://attacker.example", "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "transact-context", arguments: {} }),
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(called, false);
  }, async () => {
    called = true;
    return {};
  });
});

test("authorise endpoint requires explicit confirmation and calls only the authorise tool", async () => {
  let received;
  await withServer(async () => "unused", async (origin) => {
    const response = await fetch(`${origin}/api/authorise-record`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ application: "OFS.SOURCE", id: "SOURCE1", confirm: true }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { result: { state: "live" } });
    assert.deepEqual(received, {
      url: "http://localhost:9189/mcp",
      args: { application: "OFS.SOURCE", id: "SOURCE1", confirm: true },
    });

    const noConfirmation = await fetch(`${origin}/api/authorise-record`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ application: "OFS.SOURCE", id: "SOURCE1", confirm: false }),
    });
    assert.equal(noConfirmation.status, 400);
  }, undefined, undefined, undefined, undefined, async (request) => {
    received = request;
    return { state: "live" };
  });
});

test("authorise endpoint reports Transact rejection details instead of treating it as success", async () => {
  await withServer(async () => "unused", async (origin) => {
    const response = await fetch(`${origin}/api/authorise-record`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ application: "OFS.SOURCE", id: "SOURCE1", confirm: true }),
    });
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.match(body.error, /Transact did not confirm authorisation/);
    assert.match(body.error, /same OFS user cannot authorise/);
  }, undefined, undefined, undefined, undefined, async () => ({
    state: "transient",
    errors: [{ code: "AUTHORISATION.REJECTED", message: "same OFS user cannot authorise" }],
  }));
});

test("authorise endpoint rejects cross-origin requests", async () => {
  let called = false;
  await withServer(async () => "unused", async (origin) => {
    const response = await fetch(`${origin}/api/authorise-record`, {
      method: "POST",
      headers: { Origin: "http://attacker.example", "Content-Type": "application/json" },
      body: JSON.stringify({ application: "CUSTOMER", id: "123", confirm: true }),
    });
    assert.equal(response.status, 403);
    assert.equal(called, false);
  }, undefined, undefined, undefined, undefined, async () => {
    called = true;
    return {};
  });
});

test("AA activity endpoint validates explicit simulation and forwards only valid requests", async () => {
  let received;
  await withServer(async () => "unused", async (origin) => {
    const body = {
      activity: "LENDING-CHANGE-PRINCIPALINT",
      arrangement: "AA26001ABCDEF",
      effective_date: "20261111",
      conditions: { PRINCIPALINT: { RATE: "5.25" } },
      simulate: true,
      confirm: true,
    };
    const response = await fetch(`${origin}/api/aa-arr-activity`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { result: { simulationMode: true, applied: false } });
    assert.deepEqual(received, {
      url: "http://localhost:9189/mcp",
      args: body,
    });

    const noSimulationChoice = await fetch(`${origin}/api/aa-arr-activity`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, simulate: undefined }),
    });
    assert.equal(noSimulationChoice.status, 400);
  }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, async (request) => {
    received = request;
    return { simulationMode: true, applied: false };
  });
});

test("AA activity endpoint rejects cross-origin mutations before invoking Transact", async () => {
  let called = false;
  await withServer(async () => "unused", async (origin) => {
    const response = await fetch(`${origin}/api/aa-arr-activity`, {
      method: "POST",
      headers: { Origin: "http://attacker.example", "Content-Type": "application/json" },
      body: JSON.stringify({
        activity: "LENDING-CHANGE-PRINCIPALINT",
        arrangement: "AA26001ABCDEF",
        effective_date: "20261111",
        conditions: { PRINCIPALINT: { RATE: "5.25" } },
        simulate: false,
        confirm: true,
      }),
    });
    assert.equal(response.status, 403);
    assert.equal(called, false);
  }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, async () => {
    called = true;
    return {};
  });
});

test("ESON generation uses Copilot with read-only Transact tools and returns validated files", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "transact-browser-eson-"));
  try {
    const skillPath = path.join(workspaceRoot, ".claude", "skills", "generate-eson");
    const referencePath = path.join(workspaceRoot, "reference_eson", "CUSTOMER");
    await mkdir(skillPath, { recursive: true });
    await mkdir(referencePath, { recursive: true });
    await writeFile(path.join(skillPath, "SKILL.md"), "Use ESON references.");
    await writeFile(path.join(referencePath, "AU0010001.CUSTOMER!EXAMPLE.data.eson"), "CUSTOMER { SHORT.NAME: \"Example\" }");
    let copilotOptions;
    await withServer(async (options) => {
      copilotOptions = options;
      return JSON.stringify({
        files: [{
          company: "AU0010001",
          application: "CUSTOMER",
          id: "1001",
          content: "CUSTOMER { CO.CODE: \"AU0010001\" }",
        }],
      });
    }, async (origin) => {
      const response = await fetch(`${origin}/api/generate-eson`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ records: [{ company: "AU0010001", application: "CUSTOMER", id: "1001" }] }),
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.files[0].filename, "AU0010001.CUSTOMER!1001.data.eson");
      assert.equal(copilotOptions.writeConfirmed, false);
      assert.equal(copilotOptions.contextTier, "long_context");
      assert.match(copilotOptions.prompt, /Use ESON references/);
      assert.match(copilotOptions.prompt, /SHORT\.NAME/);
    }, undefined, undefined, undefined, undefined, undefined, workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("ESON generation retries one incomplete Copilot response", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "transact-browser-eson-retry-"));
  try {
    const skillPath = path.join(workspaceRoot, ".claude", "skills", "generate-eson");
    await mkdir(skillPath, { recursive: true });
    await writeFile(path.join(skillPath, "SKILL.md"), "Use ESON references.");
    let attempts = 0;
    await withServer(async () => {
      attempts += 1;
      return JSON.stringify({
        files: [{
          company: "AU0010001",
          application: "CUSTOMER",
          id: "1001",
          content: attempts === 1
            ? "I could not reliably transform the repeated values."
            : "import EB_Customer_s.*\nCUSTOMER { ID: \"1001\" }",
        }],
      });
    }, async (origin) => {
      const response = await fetch(`${origin}/api/generate-eson`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ records: [{ company: "AU0010001", application: "CUSTOMER", id: "1001" }] }),
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(attempts, 2);
      assert.equal(result.files[0].content, "import EB_Customer_s.*\nCUSTOMER { ID: \"1001\" }");
    }, undefined, undefined, undefined, undefined, undefined, workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("L3 project routes browse, search, save, and stage read-only edit suggestions", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "transact-browser-l3-"));
  const projectRoot = path.join(workspaceRoot, "VmaL3JavaP2");
  const sourcePath = path.join(projectRoot, "src", "com", "vma", "fun", "payments", "PaymentHook.java");
  try {
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "package com.vma.fun.payments;\nclass PaymentHook { String table = \"EB.API\"; }\n");
    let copilotOptions;
    await withServer(async (options) => {
      copilotOptions = options;
      return JSON.stringify({
        summary: "Add a constant.",
        content: "package com.vma.fun.payments;\nclass PaymentHook { static final String TABLE = \"EB.API\"; }\n",
      });
    }, async (origin) => {
      const overviewResponse = await fetch(`${origin}/api/l3/project`);
      assert.equal(overviewResponse.status, 200);
      const overview = await overviewResponse.json();
      assert.equal(overview.fileCount, 1);
      assert.equal(overview.path, projectRoot);

      const searchResponse = await fetch(`${origin}/api/l3/search?q=package...payments`);
      assert.equal((await searchResponse.json()).results[0].path, "src/com/vma/fun/payments/PaymentHook.java");

      const fileResponse = await fetch(`${origin}/api/l3/file?path=src%2Fcom%2Fvma%2Ffun%2Fpayments%2FPaymentHook.java`);
      const file = await fileResponse.json();
      assert.equal(fileResponse.status, 200);

      const assistantResponse = await fetch(`${origin}/api/l3/assistant`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "edit",
          instruction: "Add a table constant.",
          files: [file.path],
          openFile: file.path,
        }),
      });
      assert.equal(assistantResponse.status, 200);
      const result = await assistantResponse.json();
      assert.match(result.suggestion.content, /static final String TABLE/);
      assert.equal(copilotOptions.writeConfirmed, false);
      assert.match(copilotOptions.prompt, /Do not execute code or write files/);
      assert.equal((await fetch(`${origin}/api/l3/file?path=src%2Fcom%2Fvma%2Ffun%2Fpayments%2FPaymentHook.java`).then((response) => response.json())).content, file.content);

      const saveResponse = await fetch(`${origin}/api/l3/file`, {
        method: "PUT",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ path: file.path, content: result.suggestion.content, expectedHash: file.hash }),
      });
      assert.equal(saveResponse.status, 200);
      assert.match((await fetch(`${origin}/api/l3/file?path=src%2Fcom%2Fvma%2Ffun%2Fpayments%2FPaymentHook.java`).then((response) => response.json())).content, /static final String TABLE/);
    }, undefined, undefined, undefined, undefined, undefined, workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("reference ESON and skill endpoints use the configured local workspace", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "transact-browser-workspace-"));
  try {
    const referenceDirectory = path.join(workspaceRoot, "reference_eson", "nested", "ENQUIRY");
    const skillDirectory = path.join(workspaceRoot, ".claude", "skills", "generate-eson");
    await mkdir(referenceDirectory, { recursive: true });
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(path.join(referenceDirectory, "AU0010001.ENQUIRY!SAMPLE.data.eson"), "ENQUIRY { FILE.NAME: \"AA.ARRANGEMENT\" }");
    await writeFile(path.join(skillDirectory, "SKILL.md"), "Initial instructions");

    await withServer(async () => "unused", async (origin) => {
      const reference = await fetch(
        `${origin}/api/reference-eson?company=AU0010001&application=ENQUIRY&id=SAMPLE`,
        { headers: { Origin: origin } },
      );
      assert.equal(reference.status, 200);
      const referenceBody = await reference.json();
      assert.equal(referenceBody.files[0].folder, "nested/ENQUIRY");

      const initialFile = await fetch(`${origin}/api/skills/file?path=generate-eson%2FSKILL.md`);
      assert.equal((await initialFile.json()).content, "Initial instructions");
      const upload = await fetch(`${origin}/api/skills`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "new-skill", content: "# New skill" }),
      });
      assert.equal(upload.status, 201);
      const listing = await fetch(`${origin}/api/skills`);
      assert.deepEqual((await listing.json()).skills.map((skill) => skill.name), ["generate-eson", "new-skill"]);
      const update = await fetch(`${origin}/api/skills/file`, {
        method: "PUT",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ path: "generate-eson/SKILL.md", content: "Updated instructions" }),
      });
      assert.equal(update.status, 200);
      assert.equal(await (await fetch(`${origin}/api/skills/file?path=generate-eson%2FSKILL.md`)).json().then((body) => body.content), "Updated instructions");
    }, undefined, undefined, undefined, undefined, undefined, workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("chat endpoint includes the full JSON result when Copilot spools it to a temp file", async () => {
  const outputPath = path.join(
    tmpdir(),
    `${Date.now()}-copilot-tool-output-${randomUUID().replaceAll("-", "")}.txt`,
  );
  await writeFile(outputPath, JSON.stringify({
    content: [{
      type: "text",
      text: JSON.stringify({
        enquiry: "%EB.API",
        columns: [{ identifier: "@ID", label: "@ID" }],
        rows: [{ cells: ["AA.API.ONE"] }, { cells: ["AA.API.TWO"] }],
      }),
    }],
  }));
  try {
    await withServer(async () => `Complete response saved here: \`${outputPath}\``, async (origin) => {
      const response = await fetch(`${origin}/api/chat`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ message: "List EB.API records" }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        answer: `Complete response saved here: \`${outputPath}\``,
        largeResult: {
          enquiry: "%EB.API",
          columns: [{ identifier: "@ID", label: "@ID" }],
          rows: [{ cells: ["AA.API.ONE"] }, { cells: ["AA.API.TWO"] }],
        },
      });
    });
  } finally {
    await unlink(outputPath);
  }
});
