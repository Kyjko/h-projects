import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "../src/server.js";
import { createAmendmentStore } from "../src/design-document/amendment-store.js";

async function withServer(options, run) {
  const server = createServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(origin);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function submitDocumentJob(origin, {
  filename = "design.docx",
  amendmentIds = [],
  records = [],
  instructions = "",
  screenshot = false,
  bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01]),
  onCreated,
} = {}) {
  const created = await fetch(`${origin}/api/design-document/jobs`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ filename, amendmentIds, records, instructions, screenshot }),
  });
  if (!created.ok) return created;
  const { jobId } = await created.json();
  onCreated?.(jobId);
  return fetch(`${origin}/api/design-document/jobs/${jobId}/upload`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
    body: bytes,
  });
}

test("recent amendment store persists only the newest five records", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "transact-amendments-"));
  const storePath = path.join(directory, "recent-amendments.json");
  try {
    const firstInstance = createAmendmentStore({ storePath });
    for (let index = 1; index <= 6; index += 1) {
      await firstInstance.recordAmendment({
        application: "CUSTOMER",
        recordId: `CUSTOMER-${index}`,
        fields: [{ name: "MNEMONIC", value: `C${index}` }],
        source: "record-designer",
      });
    }

    const restartedInstance = createAmendmentStore({ storePath });
    const amendments = await restartedInstance.listRecentAmendments();
    assert.equal(amendments.length, 5);
    assert.deepEqual(amendments.map(({ recordId }) => recordId), [
      "CUSTOMER-6",
      "CUSTOMER-5",
      "CUSTOMER-4",
      "CUSTOMER-3",
      "CUSTOMER-2",
    ]);
    assert.deepEqual(await readFile(storePath, "utf8").then(JSON.parse), amendments);
    assert.deepEqual(
      (await restartedInstance.getAmendmentsByIds([amendments[1].id])).map(({ recordId }) => recordId),
      ["CUSTOMER-5"],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("document workflow lists amendments and edits a private copy for download", async () => {
  const id = "550e8400-e29b-41d4-a716-446655440000";
  const amendment = {
    id,
    application: "CUSTOMER",
    recordId: "CUSTOMER-123",
    state: "live",
    source: "assistant",
    occurredAt: "2026-08-15T12:00:00.000Z",
    fields: [{ name: "SHORT.NAME", value: "Sample customer" }],
  };
  let copilotRequest;
  let originForProgress;
  let jobIdForProgress;
  let progressDuringCopilot;
  let copilotTimeout;
  const editedBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x2a]);
  await withServer({
    copilot: async (options) => {
      copilotRequest = options;
      copilotTimeout = options.timeoutMs;
      options.onProgress?.("Assistant inspected the outline and is updating section 2.1.");
      const progress = await fetch(`${originForProgress}/api/design-document/jobs/${jobIdForProgress}`, {
        headers: { Origin: originForProgress },
      });
      progressDuringCopilot = await progress.json();
      const outputPath = options.prompt.match(/Output copy to edit and return: ([^\r\n]+)/)?.[1];
      assert.ok(outputPath, "prompt should specify the edited copy path");
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, editedBytes);
      options.onProgress?.("Assistant: I inspected the document outline and am applying the requested section update.");
      return "Updated the document history and added the customer record details.";
    },
    listAmendments: async () => [amendment],
    selectAmendments: async (ids) => ids.map(() => amendment),
  }, async (origin) => {
    originForProgress = origin;
    const listResponse = await fetch(`${origin}/api/design-document/amendments`, {
      headers: { "Sec-Fetch-Site": "same-origin" },
    });
    assert.equal(listResponse.status, 200);
    assert.deepEqual((await listResponse.json()).amendments, [amendment]);

    const response = await submitDocumentJob(origin, {
      filename: "Product-design.docx",
      amendmentIds: [id],
      instructions: "Add these fields to section 2.1, preserving the existing style.",
      onCreated: (jobId) => { jobIdForProgress = jobId; },
    });
    assert.equal(response.status, 200);
    const job = await response.json();
    assert.equal(job.filename, "Product-design-amended.docx");
    assert.match(job.summary, /Updated the document history/);
    assert.match(copilotRequest.prompt, /Follow the edit-design-doc skill/);
    assert.match(copilotRequest.prompt, /"application": "CUSTOMER"/);
    assert.match(copilotRequest.prompt, /"recordId": "CUSTOMER-123"/);
    assert.match(copilotRequest.prompt, /Screenshot insertion is disabled/);
    assert.match(copilotRequest.prompt, /Add these fields to section 2.1/);
    assert.match(copilotRequest.prompt, /copy the original uploaded document/);
    assert.equal(typeof copilotRequest.onProgress, "function");
    assert.equal(copilotTimeout, 15 * 60 * 1000);
    assert.equal(progressDuringCopilot.status, "running");
    assert.match(progressDuringCopilot.summary, /updating section 2\.1/);
    assert.ok(copilotRequest.allowedTools.includes("word-mcp-server(copy_document)"));
    assert.ok(copilotRequest.allowedTools.includes("word-mcp-server(delete_paragraph)"));
    assert.equal(copilotRequest.allowedTools.some((tool) => tool.startsWith("playwright(")), false);
    assert.equal(copilotRequest.writeConfirmed, false);
    assert.equal(copilotRequest.mcpUrl, `${origin}/api/design-document/transact`);
    const progress = await fetch(`${origin}/api/design-document/jobs/${job.jobId}`, {
      headers: { Origin: origin },
    });
    const progressState = await progress.json();
    assert.equal(progressState.status, "completed");
    assert.match(progressState.summary, /Updated the document history/);

    const download = await fetch(`${origin}${job.downloadUrl}`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), editedBytes);

    const expired = await fetch(`${origin}${job.downloadUrl}`);
    assert.equal(expired.status, 404);
  });
});

test("document workflow rejects invalid uploads and cross-origin requests", async () => {
  let copilotCalled = false;
  await withServer({
    copilot: async () => {
      copilotCalled = true;
      return "unused";
    },
    selectAmendments: async () => [],
  }, async (origin) => {
    const invalidDocx = await submitDocumentJob(origin, {
      filename: "notes.docx",
      amendmentIds: ["550e8400-e29b-41d4-a716-446655440000"],
      bytes: Buffer.from("not a docx"),
    });
    assert.equal(invalidDocx.status, 400);
    assert.match((await invalidDocx.json()).error, /not a valid DOCX/);

    const crossOrigin = await fetch(`${origin}/api/design-document/amendments`, {
      headers: { Origin: "http://attacker.example" },
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(copilotCalled, false);
  });
});

test("document workflow reads a manually entered record without requiring amendment history", async () => {
  const recordReads = [];
  let prompt;
  const id = "550e8400-e29b-41d4-a716-446655440001";
  await withServer({
    copilot: async (options) => {
      prompt = options.prompt;
      const outputPath = options.prompt.match(/Output copy to edit and return: ([^\r\n]+)/)?.[1];
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      return "Done.";
    },
    recordRead: async (request) => {
      recordReads.push(request);
      return {
        application: request.args.application,
        record: {
          id: request.args.id,
          state: "live",
          fields: [{ name: "SHORT.NAME", value: "Directly selected" }],
        },
      };
    },
  }, async (origin) => {
    const response = await submitDocumentJob(origin, {
      filename: "architecture.docx",
      records: [{ application: "CUSTOMER", id: "DIRECT-1" }],
      bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    });
    assert.equal(response.status, 200);
    const job = await response.json();
    assert.equal(job.summary, "Done.");
    assert.deepEqual(recordReads, [{
      url: "http://localhost:9189/mcp",
      tool: "ofs-read",
      args: { application: "CUSTOMER", id: "DIRECT-1" },
    }]);
    assert.match(prompt, /"recordId": "DIRECT-1"/);
    assert.match(prompt, /"value": "Directly selected"/);
    const download = await fetch(`${origin}${job.downloadUrl}`);
    assert.equal(download.status, 200);
  });
});
