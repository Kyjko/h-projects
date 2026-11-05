import test from "node:test";
import assert from "node:assert/strict";
import { buildCopilotArgs, buildPrompt, READ_TOOLS, WRITE_TOOLS } from "../src/copilot.js";

test("read-only requests allow read tools and explicitly deny every mutation", () => {
  const args = buildCopilotArgs({
    prompt: "read",
    mcpUrl: "http://localhost:9189/mcp",
    writeConfirmed: false,
  });
  const allowed = args.filter((arg) => arg.startsWith("--allow-tool="));
  const denied = args.filter((arg) => arg.startsWith("--deny-tool="));
  assert.deepEqual(allowed, READ_TOOLS.map((tool) => `--allow-tool=transact-browser(${tool})`));
  assert.deepEqual(denied, WRITE_TOOLS.map((tool) => `--deny-tool=transact-browser(${tool})`));
  assert.equal(args.includes("--allow-all-tools"), false);
  assert.equal(args.includes("--available-tools"), false);
  assert.equal(args.includes("--disable-mcp-server"), true);
  const config = JSON.parse(args[args.indexOf("--additional-mcp-config") + 1]);
  assert.deepEqual(config.mcpServers["transact-browser"], {
    type: "http",
    url: "http://localhost:9189/mcp",
  });
});

test("write tools are enabled only by request-scoped confirmation", () => {
  const args = buildCopilotArgs({
    prompt: "write",
    mcpUrl: "http://localhost:9189/mcp",
    writeConfirmed: true,
  });
  const allowed = args.filter((arg) => arg.startsWith("--allow-tool="));
  assert.deepEqual(allowed, [...READ_TOOLS, ...WRITE_TOOLS].map((tool) => `--allow-tool=transact-browser(${tool})`));
  assert.equal(args.some((arg) => arg.startsWith("--deny-tool=")), false);
});

test("document jobs allow only the requested Word tools", () => {
  const args = buildCopilotArgs({
    prompt: "edit document",
    mcpUrl: "http://127.0.0.1:4173/api/design-document/transact",
    writeConfirmed: false,
    allowedTools: ["word-mcp-server(copy_document)", "word-mcp-server(add_heading)"],
  });
  assert.ok(args.includes("--allow-tool=word-mcp-server(copy_document)"));
  assert.ok(args.includes("--allow-tool=word-mcp-server(add_heading)"));
  assert.ok(args.includes("--deny-tool=transact-browser(ofs-input)"));
  assert.equal(args.includes("--allow-tool=playwright(browser_navigate)"), false);
  assert.equal(args.includes("--allow-all-tools"), false);
});

test("large document prompts are supplied over stdin, not command-line arguments", () => {
  const prompt = "record details ".repeat(20_000);
  const args = buildCopilotArgs({
    prompt,
    promptViaStdin: true,
    mcpUrl: "http://127.0.0.1:4173/api/design-document/transact",
    writeConfirmed: false,
    allowedTools: ["word-mcp-server(copy_document)"],
  });
  assert.equal(args.includes("--prompt"), false);
  assert.equal(args.includes(prompt), false);
  assert.ok(args.includes("--allow-tool=word-mcp-server(copy_document)"));
  assert.ok(args.length < 100);
});

test("prompt carries application context and read-only policy", () => {
  const prompt = buildPrompt({
    message: "show record",
    application: "CUSTOMER",
    recordId: "123",
    history: [],
    writeConfirmed: false,
  });
  assert.match(prompt, /Current Transact application: CUSTOMER/);
  assert.match(prompt, /Current record ID: 123/);
  assert.match(prompt, /This request is read-only/);
});

test("record designer assistant mode is suggestion-only", () => {
  const prompt = buildPrompt({
    message: "What should I put in MNEMONIC?",
    application: "CUSTOMER",
    recordId: "NEW-CUSTOMER",
    history: [],
    writeConfirmed: false,
    assistantMode: "record-design-suggestions",
  });
  assert.match(prompt, /Give advice and suggestions only/);
  assert.match(prompt, /never submit or validate a record/);
  assert.match(prompt, /Current Transact application: CUSTOMER/);
});
