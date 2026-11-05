import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildEsonPrompt,
  findReferenceEson,
  listSkills,
  parseEsonAssistantAnswer,
  readSkillFile,
  saveGeneratedEsonFiles,
  saveSkillFile,
  validateEsonRecords,
} from "../src/local-tools.js";

async function withWorkspace(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "transact-browser-local-tools-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function linkDirectory(target, link) {
  try {
    await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      return false;
    }
    throw error;
  }
  return true;
}

test("skill listing and editing stay inside the local skills directory", async () => {
  await withWorkspace(async (root) => {
    await mkdir(path.join(root, ".claude", "skills", "generate-eson"), { recursive: true });
    await writeFile(path.join(root, ".claude", "skills", "generate-eson", "SKILL.md"), "instructions");
    const skills = await listSkills(root);
    assert.deepEqual(skills, [{ name: "generate-eson", files: [{ path: "generate-eson/SKILL.md" }] }]);
    assert.equal(await readSkillFile(root, "generate-eson/SKILL.md"), "instructions");
    await saveSkillFile(root, "new-skill/SKILL.md", "new instructions", { createOnly: true });
    assert.equal(await readFile(path.join(root, ".claude", "skills", "new-skill", "SKILL.md"), "utf8"), "new instructions");
    await assert.rejects(() => readSkillFile(root, "../outside.md"), /inside a skill folder/);
    await assert.rejects(() => saveSkillFile(root, "new-skill/SKILL.md", "overwrite", { createOnly: true }), /already exists/);
  });
});

test("local file operations reject symlinked workspace roots", async (t) => {
  let symlinksSupported = true;
  await withWorkspace(async (root) => {
    const outside = path.join(root, "outside");
    await mkdir(outside);
    if (!await linkDirectory(outside, path.join(root, ".claude"))) {
      symlinksSupported = false;
      return;
    }
    await assert.rejects(() => listSkills(root), /symbolic links/);
    await assert.rejects(
      () => saveSkillFile(root, "new-skill/SKILL.md", "instructions", { createOnly: true }),
      /symbolic links/,
    );
  });

  await withWorkspace(async (root) => {
    const outside = path.join(root, "outside");
    await mkdir(outside);
    if (!symlinksSupported || !await linkDirectory(outside, path.join(root, "reference_eson"))) {
      symlinksSupported = false;
      return;
    }
    await assert.rejects(
      () => findReferenceEson(root, [{ company: "AU0010001", application: "CUSTOMER", id: "C-1" }]),
      /symbolic links/,
    );
  });

  await withWorkspace(async (root) => {
    const outside = path.join(root, "outside");
    await mkdir(outside);
    if (!symlinksSupported || !await linkDirectory(outside, path.join(root, "generated_esons"))) {
      symlinksSupported = false;
      return;
    }
    await assert.rejects(
      () => saveGeneratedEsonFiles(root, [{
        filename: "AU0010001.CUSTOMER!C-1.data.eson",
        content: "CUSTOMER {}",
      }]),
      /symbolic links/,
    );
    assert.deepEqual(await readdir(outside), []);
  });
  if (!symlinksSupported) t.skip("Directory symlinks are unavailable in this environment.");
});

test("reference ESON discovery searches nested folders and returns the containing folder", async () => {
  await withWorkspace(async (root) => {
    const directory = path.join(root, "reference_eson", "deep", "nested", "ENQUIRY");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "AU0010001.ENQUIRY!VMA.AA.DETAILS.data.eson"), "ENQUIRY { FILE.NAME: \"AA.ARRANGEMENT\" }");
    const result = await findReferenceEson(root, [{
      company: "AU0010001",
      application: "ENQUIRY",
      id: "VMA.AA.DETAILS",
    }]);
    assert.equal(result.length, 1);
    assert.equal(result[0].folder, "deep/nested/ENQUIRY");
    assert.match(result[0].content, /AA\.ARRANGEMENT/);
  });
});

test("ESON generation validates the response bundle and uses the reference skill prompt", async () => {
  const records = validateEsonRecords([{ company: "au0010001", application: "customer", id: "C-1" }]);
  assert.match(buildEsonPrompt(records, "Follow the pattern."), /live reads use the company configured/);
  assert.match(buildEsonPrompt(records, "Follow the pattern."), /Follow the pattern/);
  const files = parseEsonAssistantAnswer(JSON.stringify({
    files: [{ company: "AU0010001", application: "CUSTOMER", id: "C-1", content: "CUSTOMER { CO.CODE: \"AU0010001\" }" }],
  }), records);
  assert.equal(files[0].filename, "AU0010001.CUSTOMER!C-1.data.eson");
  await withWorkspace(async (root) => {
    const saved = await saveGeneratedEsonFiles(root, files);
    assert.equal(saved[0].path, "generated_esons/AU0010001.CUSTOMER!C-1.data.eson");
    assert.match(await readFile(path.join(root, saved[0].path), "utf8"), /CO\.CODE/);
  });
});

test("ESON generation rejects invalid answers and path-like record IDs", () => {
  const records = validateEsonRecords([{ company: "AU0010001", application: "CUSTOMER", id: "C-1" }]);
  assert.throws(() => parseEsonAssistantAnswer("not JSON", records), /required JSON/);
  assert.throws(() => validateEsonRecords([{ company: "AU0010001", application: "CUSTOMER", id: "../etc" }]), /valid company code/);
});
