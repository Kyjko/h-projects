import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "../src/server.js";

async function withServer(copilot, run, transact, recordInput, recordRead, saveAmendment, recordAuthorise, workspaceRoot) {
  const server = createServer({ copilot, transact, recordInput, recordRead, saveAmendment, recordAuthorise, workspaceRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

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

test("ESON generation uses Copilot with read-only Transact tools and returns validated files", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "transact-browser-eson-"));
  try {
    const skillPath = path.join(workspaceRoot, ".claude", "skills", "generate-eson");
    await mkdir(skillPath, { recursive: true });
    await writeFile(path.join(skillPath, "SKILL.md"), "Use ESON references.");
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
      assert.match(copilotOptions.prompt, /Use ESON references/);
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
