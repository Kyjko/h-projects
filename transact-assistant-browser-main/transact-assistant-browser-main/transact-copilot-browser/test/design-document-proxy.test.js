import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "../src/server.js";

test("Assistant MCP proxy forwards requests and records only successful applied inputs", async () => {
  const saved = [];
  const upstreamRequests = [];
  const upstream = createHttpServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body);
    upstreamRequests.push(rpc);
    const result = rpc.params.arguments.id === "GOOD"
      ? { state: "live", statusCode: 1, record: { id: "GOOD", fields: [{ name: "MNEMONIC", value: "GOOD" }] } }
      : { state: "live", statusCode: 1, errors: [{ message: "record rejected" }] };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      jsonrpc: "2.0",
      id: rpc.id,
      result: { content: [{ type: "text", text: JSON.stringify(result) }] },
    }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const previousUrl = process.env.TRANSACT_MCP_URL;
  process.env.TRANSACT_MCP_URL = `http://127.0.0.1:${upstream.address().port}/mcp`;
  const app = createServer({
    saveAmendment: async (amendment) => saved.push(amendment),
  });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${app.address().port}`;

  try {
    for (const id of ["GOOD", "REJECTED"]) {
      const request = {
        jsonrpc: "2.0",
        id: `request-${id}`,
        method: "tools/call",
        params: {
          name: "ofs-input",
          arguments: {
            application: "CUSTOMER",
            id,
            fields: [{ name: "MNEMONIC", value: id }],
            confirm: true,
            validate_only: false,
          },
        },
      };
      const response = await fetch(`${origin}/api/design-document/transact`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).id, `request-${id}`);
    }

    assert.equal(upstreamRequests.length, 2);
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0], {
      application: "CUSTOMER",
      recordId: "GOOD",
      fields: [{ name: "MNEMONIC", value: "GOOD" }],
      state: "live",
      source: "assistant",
    });
  } finally {
    await new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
    await new Promise((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
    if (previousUrl === undefined) delete process.env.TRANSACT_MCP_URL;
    else process.env.TRANSACT_MCP_URL = previousUrl;
  }
});
