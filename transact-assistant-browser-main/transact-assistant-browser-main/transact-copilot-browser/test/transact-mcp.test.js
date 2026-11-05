import test from "node:test";
import assert from "node:assert/strict";
import {
  callTransactAuthorise,
  callTransactInput,
  callTransactTool,
  validateAuthoriseRecordArgs,
  validateDirectToolCall,
} from "../src/transact-mcp.js";

test("direct calls accept a supported read-only call and reject mutation tools", () => {
  assert.deepEqual(
    validateDirectToolCall("ofs-read", { application: "CUSTOMER", id: "123" }),
    { application: "CUSTOMER", id: "123" },
  );
  assert.throws(() => validateDirectToolCall("ofs-input", {}), /read-only/);
  assert.throws(() => validateDirectToolCall("ofs-read", { application: "CUSTOMER" }), /"id" is required/);
});

test("direct calls decode JSON-RPC results containing JSON text", async () => {
  let request;
  const result = await callTransactTool({
    url: "http://localhost:9189/mcp",
    tool: "app-fields",
    args: { application: "CUSTOMER" },
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: JSON.stringify({ coreFields: [{ name: "CUSTOMER" }] }) }] },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  assert.equal(request.method, "tools/call");
  assert.equal(request.params.name, "app-fields");
  assert.deepEqual(result, { coreFields: [{ name: "CUSTOMER" }] });
});

test("direct calls decode server-sent event JSON-RPC results", async () => {
  let requestId;
  const result = await callTransactTool({
    url: "http://localhost:9189/mcp",
    tool: "transact-context",
    args: {},
    fetchImpl: async (_url, options) => {
      requestId = JSON.parse(options.body).id;
      return new Response(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: requestId, result: { content: [{ type: "text", text: "Transact context" }] } })}\n\n`,
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  assert.equal(result, "Transact context");
});

test("direct calls ignore trailing null and notification events after the tool response", async () => {
  const result = await callTransactTool({
    url: "http://localhost:9189/mcp",
    tool: "ofs-enquiry",
    args: { enquiry: "%EB.API", max_rows: 500 },
    fetchImpl: async (_url, options) => {
      const requestId = JSON.parse(options.body).id;
      const response = {
        jsonrpc: "2.0",
        id: requestId,
        result: { content: [{ type: "text", text: JSON.stringify({ enquiry: "%EB.API", rows: [{ cells: ["row"] }] }) }] },
      };
      return new Response(
        `event: message\ndata: ${JSON.stringify(response)}\n\nevent: message\ndata: null\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n\n`,
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  assert.equal(result.enquiry, "%EB.API");
  assert.equal(result.rows.length, 1);
});

test("record input validates its dedicated argument shape and sends validate-only requests", async () => {
  let request;
  const result = await callTransactInput({
    url: "http://localhost:9189/mcp",
    args: {
      application: "CUSTOMER",
      id: "NEW-CUSTOMER",
      fields: [{ name: "MNEMONIC", value: "NEWCUST" }],
      confirm: true,
      validate_only: true,
    },
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: JSON.stringify({ statusCode: 1, errors: [] }) }] },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  test("record authorisation is explicit and invokes ofs-authorise", async () => {
    assert.deepEqual(validateAuthoriseRecordArgs({
      application: "OFS.SOURCE",
      id: "SOURCE1",
      confirm: true,
    }), {
      application: "OFS.SOURCE",
      id: "SOURCE1",
      confirm: true,
    });
    assert.throws(() => validateAuthoriseRecordArgs({
      application: "OFS.SOURCE",
      id: "SOURCE1",
      confirm: false,
    }), /explicit confirmation/);
    assert.throws(() => validateDirectToolCall("ofs-authorise", {
      application: "OFS.SOURCE",
      id: "SOURCE1",
      confirm: true,
    }), /read-only/);

    let request;
    const result = await callTransactAuthorise({
      url: "http://localhost:9189/mcp",
      args: { application: "OFS.SOURCE", id: "SOURCE1", confirm: true },
      fetchImpl: async (_url, options) => {
        request = JSON.parse(options.body);
        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: { content: [{ type: "text", text: JSON.stringify({ state: "live" }) }] },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });
    assert.equal(request.params.name, "ofs-authorise");
    assert.deepEqual(request.params.arguments, {
      application: "OFS.SOURCE",
      id: "SOURCE1",
      confirm: true,
    });
    assert.deepEqual(result, { state: "live" });
  });
  assert.equal(request.params.name, "ofs-input");
  assert.equal(request.params.arguments.validate_only, true);
  assert.deepEqual(result, { statusCode: 1, errors: [] });
  await assert.rejects(() => callTransactInput({
    url: "http://localhost:9189/mcp",
    args: { application: "CUSTOMER", id: "x", fields: [{ name: "BAD FIELD", value: "v" }], confirm: true, validate_only: true },
    fetchImpl: async () => assert.fail("Invalid field must not be sent"),
  }), /invalid application, ID, field name, value, or position/);
});
