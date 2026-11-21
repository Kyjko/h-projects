import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildL3AssistantPrompt,
  collectProjectAssistantFiles,
  getProjectOverview,
  parseL3EditSuggestion,
  readProjectFile,
  saveProjectFile,
  searchProject,
} from "../src/l3-project.js";

async function withProject(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "transact-l3-project-"));
  try {
    await mkdir(path.join(root, "src", "com", "vma", "fun", "payments", "cardsManagement"), { recursive: true });
    await writeFile(path.join(root, "README.MD"), "Java L3 project");
    await writeFile(
      path.join(root, "src", "com", "vma", "fun", "payments", "cardsManagement", "PaymentHook.java"),
      "package com.vma.fun.payments.cardsManagement;\npublic class PaymentHook { String record = \"EB.API\"; }\n",
    );
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("L3 project overview, file reads, and wildcard source search stay in the project", async () => {
  await withProject(async (root) => {
    const overview = await getProjectOverview(root);
    assert.equal(overview.name, path.basename(root));
    assert.equal(overview.fileCount, 2);
    assert.equal(overview.directoryCount, 6);
    const file = await readProjectFile(root, "src/com/vma/fun/payments/cardsManagement/PaymentHook.java");
    assert.match(file.content, /EB\.API/);
    assert.match(file.hash, /^[a-f0-9]{64}$/);

    const results = await searchProject(root, "package...payments");
    assert.equal(results.results.length, 1);
    assert.equal(results.results[0].line, 1);
    assert.match(results.results[0].path, /PaymentHook\.java$/);
    await assert.rejects(() => readProjectFile(root, "../outside.java"), /outside the Java project/);
  });
});

test("L3 project writes require an unchanged on-disk file and valid text paths", async () => {
  await withProject(async (root) => {
    const relative = "README.MD";
    const initial = await readProjectFile(root, relative);
    const saved = await saveProjectFile(root, relative, "Updated documentation", initial.hash);
    assert.match(saved.hash, /^[a-f0-9]{64}$/);
    await assert.rejects(
      () => saveProjectFile(root, relative, "Overwritten concurrently", initial.hash),
      (error) => error.status === 409,
    );
    await assert.rejects(
      () => saveProjectFile(root, "../outside.txt", "no", saved.hash),
      /outside the Java project/,
    );
  });
});

test("L3 project reads reject symlinked files and folders", async (t) => {
  await withProject(async (root) => {
    const outside = path.join(path.dirname(root), `${path.basename(root)}-outside`);
    await writeFile(outside, "private");
    try {
      try {
        await symlink(outside, path.join(root, "leak.txt"), "file");
      } catch (error) {
        if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
          t.skip("File symlinks are unavailable in this environment.");
          return;
        }
        throw error;
      }
      await assert.rejects(() => readProjectFile(root, "leak.txt"), /symbolic links/);
    } finally {
      await rm(outside, { force: true });
    }
  });
});

test("L3 Assistant uses source scope and returns edit suggestions without applying them", async () => {
  await withProject(async (root) => {
    const documents = await collectProjectAssistantFiles(root, {
      files: ["src/com/vma/fun/payments/cardsManagement/PaymentHook.java"],
    });
    const prompt = buildL3AssistantPrompt({
      mode: "relevance",
      instruction: "Find attached API records",
      documents,
    });
    assert.match(prompt, /EB\.API/);
    assert.match(prompt, /read-only transact-mcp tools/);
    assert.match(prompt, /com\/<project mnemonic>/);

    const suggestion = parseL3EditSuggestion(JSON.stringify({
      summary: "Add a constant.",
      content: "package com.vma.fun.payments.cardsManagement;\nclass PaymentHook { }\n",
    }), documents[0].path);
    assert.equal(suggestion.summary, "Add a constant.");
    assert.match(suggestion.content, /class PaymentHook/);
    assert.throws(
      () => parseL3EditSuggestion("This is not JSON.", documents[0].path),
      /reviewable edit suggestion/,
    );
    const unchanged = await readProjectFile(root, documents[0].path);
    assert.match(unchanged.content, /EB\.API/);
  });
});

test("L3 Assistant refuses folder contexts that exceed its file limit", async () => {
  await withProject(async (root) => {
    const directory = path.join(root, "many");
    await mkdir(directory);
    for (let index = 0; index < 21; index += 1) {
      await writeFile(path.join(directory, `File${index}.java`), `class File${index} {}`);
    }
    await assert.rejects(
      () => collectProjectAssistantFiles(root, { directory: "many" }),
      (error) => error.status === 413,
    );
  });
});
