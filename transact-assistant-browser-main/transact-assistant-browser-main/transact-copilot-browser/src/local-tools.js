import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_SKILL_FILES = 2000;
const MAX_SKILL_FILE_BYTES = 1024 * 1024;
const MAX_REFERENCE_RESULTS = 30;
const MAX_REFERENCE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_REFERENCE_EXAMPLE_BYTES = 256 * 1024;
const MAX_ESON_FILE_BYTES = 2 * 1024 * 1024;

function safeWorkspacePath(workspaceRoot, relativePath) {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw Object.assign(new Error("The requested path is outside the local workspace."), { status: 400 });
  }
  return target;
}

function skillRelativePath(value) {
  if (typeof value !== "string" || !value || value.includes("\0") || value.includes("\\")) {
    throw Object.assign(new Error("Choose a valid Markdown skill file."), { status: 400 });
  }
  const pieces = value.split("/");
  if (pieces.some((piece) => !piece || piece === "." || piece === "..")
      || pieces.some((piece) => !/^[A-Za-z0-9._ -]+$/.test(piece))
      || !value.toLowerCase().endsWith(".md")) {
    throw Object.assign(new Error("Skill files must be Markdown files inside a skill folder."), { status: 400 });
  }
  return pieces.join(path.sep);
}

async function assertNoSymlinkComponents(root, target, { createDirectories = false } = {}) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw Object.assign(new Error("The requested skill path is invalid."), { status: 400 });
  }
  const pieces = relative.split(path.sep);
  let current = root;
  for (let index = 0; index < pieces.length; index += 1) {
    current = path.join(current, pieces[index]);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (createDirectories) {
        await mkdir(current);
        info = await lstat(current);
      } else {
        return;
      }
    }
    if (info.isSymbolicLink()) {
      throw Object.assign(new Error("Skill paths cannot traverse symbolic links."), { status: 400 });
    }
    if ((index < pieces.length - 1 || createDirectories) && !info.isDirectory()) {
      throw Object.assign(new Error("A skill path component is not a directory."), { status: 400 });
    }
  }
}

async function walkFiles(root, { extension, maxFiles, maxDepth = 12 } = {}) {
  const found = [];
  async function walk(directory, relativeDirectory, depth) {
    if (depth > maxDepth || found.length >= maxFiles) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (found.length >= maxFiles) break;
      const relative = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        await walk(path.join(directory, entry.name), relative, depth + 1);
      } else if (entry.isFile() && (!extension || path.extname(entry.name).toLowerCase() === extension)) {
        found.push(relative);
      }
    }
  }
  await walk(root, "", 0);
  return found;
}

export async function listSkills(workspaceRoot) {
  const skillsRoot = safeWorkspacePath(workspaceRoot, ".claude/skills");
  await assertNoSymlinkComponents(workspaceRoot, skillsRoot);
  const paths = await walkFiles(skillsRoot, { extension: ".md", maxFiles: MAX_SKILL_FILES });
  const grouped = new Map();
  for (const relativePath of paths) {
    const pieces = relativePath.split(path.sep);
    const name = pieces[0] || path.basename(relativePath, ".md");
    const skill = grouped.get(name) || { name, files: [] };
    skill.files.push({ path: pieces.join("/") });
    grouped.set(name, skill);
  }
  return [...grouped.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function readSkillFile(workspaceRoot, relativePath) {
  const safeRelative = skillRelativePath(relativePath);
  const skillsRoot = safeWorkspacePath(workspaceRoot, ".claude/skills");
  const target = safeWorkspacePath(skillsRoot, safeRelative);
  await assertNoSymlinkComponents(workspaceRoot, target);
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_SKILL_FILE_BYTES) {
    throw Object.assign(new Error("The skill file is unavailable or exceeds the 1 MB limit."), { status: 400 });
  }
  return await readFile(target, "utf8");
}

export async function saveSkillFile(workspaceRoot, relativePath, content, { createOnly = false } = {}) {
  const safeRelative = skillRelativePath(relativePath);
  if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > MAX_SKILL_FILE_BYTES) {
    throw Object.assign(new Error("Skill Markdown must be at most 1 MB."), { status: 413 });
  }
  const root = safeWorkspacePath(workspaceRoot, ".claude/skills");
  const target = safeWorkspacePath(root, safeRelative);
  await assertNoSymlinkComponents(workspaceRoot, root, { createDirectories: true });
  await assertNoSymlinkComponents(workspaceRoot, path.dirname(target), { createDirectories: true });
  if (createOnly) {
    try {
      await lstat(target);
      throw Object.assign(new Error("A skill file already exists at that path."), { status: 409 });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  } else {
    const info = await lstat(target).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info?.isFile() || info.isSymbolicLink()) {
      throw Object.assign(new Error("Only an existing Markdown skill file can be edited."), { status: 404 });
    }
  }
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw Object.assign(new Error("The requested skill path is invalid."), { status: 400 });
  }
  await writeFile(target, content, { encoding: "utf8", mode: 0o600, flag: createOnly ? "wx" : "w" });
}

function validateEsonRecord(record) {
  const company = typeof record?.company === "string" ? record.company.trim().toUpperCase() : "";
  const application = typeof record?.application === "string" ? record.application.trim().toUpperCase() : "";
  const id = typeof record?.id === "string" ? record.id.trim() : "";
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(company)
      || !/^[A-Z0-9][A-Z0-9.]*$/.test(application)
      || !id || id.length > 256 || /[\\/:*?"<>|]/.test(id) || id === "." || id === "..") {
    throw Object.assign(new Error("Each record needs a valid company code, application, and record ID."), { status: 400 });
  }
  return { company, application, id };
}

export function validateEsonRecords(records) {
  if (!Array.isArray(records) || records.length < 1 || records.length > 20) {
    throw Object.assign(new Error("Enter between one and 20 records to generate or search."), { status: 400 });
  }
  const normalized = records.map(validateEsonRecord);
  const keys = normalized.map(({ company, application, id }) => `${company}\0${application}\0${id}`);
  if (new Set(keys).size !== keys.length) {
    throw Object.assign(new Error("Remove duplicate company, application, and record combinations."), { status: 400 });
  }
  return normalized;
}

export async function findReferenceEson(workspaceRoot, records) {
  const referenceRoot = safeWorkspacePath(workspaceRoot, "reference_eson");
  await assertNoSymlinkComponents(workspaceRoot, referenceRoot);
  const paths = await walkFiles(referenceRoot, { extension: ".eson", maxFiles: 20000 });
  const wanted = new Map(records.map((record) => [
    `${record.company}.${record.application}!${record.id}`.toUpperCase(),
    record,
  ]));
  const matches = [];
  for (const relativePath of paths) {
    const basename = path.basename(relativePath);
    const withoutExtension = basename.slice(0, -".eson".length).toUpperCase();
    const match = [...wanted.entries()].find(([prefix]) =>
      withoutExtension === prefix || withoutExtension === `${prefix}.DATA`);
    if (!match) continue;
    if (matches.length >= MAX_REFERENCE_RESULTS) break;
    const absolutePath = safeWorkspacePath(referenceRoot, relativePath);
    const info = await lstat(absolutePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_REFERENCE_FILE_BYTES) continue;
    const record = match[1];
    matches.push({
      ...record,
      filename: basename,
      folder: path.dirname(relativePath) === "." ? "." : path.dirname(relativePath).split(path.sep).join("/"),
      content: await readFile(absolutePath, "utf8"),
    });
  }
  return matches;
}

export async function findReferenceEsonExamples(workspaceRoot, records) {
  const referenceRoot = safeWorkspacePath(workspaceRoot, "reference_eson");
  await assertNoSymlinkComponents(workspaceRoot, referenceRoot);
  const applications = [...new Set(records.map(({ application }) => application.toUpperCase()))];
  const paths = await walkFiles(referenceRoot, { extension: ".eson", maxFiles: 20000 });
  const examples = [];
  let totalBytes = 0;
  for (const application of applications) {
    const relativePath = paths.find((candidate) => {
      const key = path.basename(candidate).split("!")[0].toUpperCase();
      return key.endsWith(`.${application}`);
    });
    if (!relativePath) continue;
    const absolutePath = safeWorkspacePath(referenceRoot, relativePath);
    const info = await lstat(absolutePath);
    if (!info.isFile() || info.isSymbolicLink()
        || info.size > MAX_REFERENCE_FILE_BYTES
        || totalBytes + info.size > MAX_REFERENCE_EXAMPLE_BYTES) continue;
    const content = await readFile(absolutePath, "utf8");
    examples.push({
      application,
      filename: path.basename(relativePath),
      content,
    });
    totalBytes += info.size;
  }
  return examples;
}

export function buildEsonPrompt(records, skill = "", referenceExamples = []) {
  return [
    "Generate Transact ESON text for each requested live record using the configured transact-mcp tools.",
    "For each application, call app-schema and ofs-read. An ofs-read field is a {name, mv, sv, value} occurrence, not a standalone ESON property. Use app-schema multi flags, the occurrence positions, and the matching same-application ESON example together to reconstruct each complete repeating group and nested field. Preserve every live field occurrence and exact value; do not flatten, summarize, omit, or invent values. Use examples only for ESON structure, never as a source of record values. The request's company is the CO.CODE value to place in the ESON record; live reads use the company configured on this MCP connection.",
    "Complete the requested ESON conversion rather than returning a status, explanation, or refusal as file content. Before responding, check that the ESON includes the requested application root, all fields from the live record, and properly nested repeating values. If an ESON cannot be produced, return a clear error instead of placing prose in the content field.",
    "Return ONLY one valid JSON object, with no prose or Markdown fences, in this shape: {\"files\":[{\"company\":\"...\",\"application\":\"...\",\"id\":\"...\",\"content\":\"complete ESON source\"}]}. Return exactly one entry per requested record. The content must be a complete ESON file, not a summary.",
    "Do not write to the filesystem or call any mutation tool.",
    `Requested records:\n${JSON.stringify(records, null, 2)}`,
    skill ? `ESON generation guidance:\n${skill}` : "",
    referenceExamples.length
      ? `Same-application ESON references (structure only):\n${referenceExamples.map((example) =>
        `Application: ${example.application}\nFile: ${example.filename}\n${example.content}`).join("\n\n")}`
      : "",
  ].filter(Boolean).join("\n\n");
}

function validateEsonContent(content, application) {
  const escapedApplication = application.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`(?:^|\\n)\\s*${escapedApplication}\\s*\\{`, "i").test(content)) return false;
  const stack = [];
  let quoted = false;
  let escaped = false;
  for (const character of content) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") quoted = false;
      continue;
    }
    if (character === "\"") {
      quoted = true;
    } else if (character === "{" || character === "[") {
      stack.push(character);
    } else if (character === "}" || character === "]") {
      const expected = character === "}" ? "{" : "[";
      if (stack.pop() !== expected) return false;
    }
  }
  return !quoted && stack.length === 0 && content.trimEnd().endsWith("}");
}

export function parseEsonAssistantAnswer(answer, requestedRecords) {
  let parsed;
  try {
    parsed = JSON.parse(answer);
  } catch {
    const block = answer.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (!block) throw Object.assign(new Error("Assistant did not return the required JSON ESON file bundle."), { status: 502 });
    try {
      parsed = JSON.parse(block[1]);
    } catch {
      throw Object.assign(new Error("Assistant returned an invalid ESON file bundle."), { status: 502 });
    }
  }
  if (!Array.isArray(parsed?.files) || parsed.files.length !== requestedRecords.length) {
    throw Object.assign(new Error("Assistant did not return one ESON file for every requested record."), { status: 502 });
  }
  const files = [];
  for (let index = 0; index < requestedRecords.length; index += 1) {
    const expected = requestedRecords[index];
    const source = parsed.files[index];
    if (source?.company?.toUpperCase() !== expected.company
        || source?.application?.toUpperCase() !== expected.application
        || source?.id !== expected.id
        || typeof source?.content !== "string"
        || !source.content.trim()
        || !validateEsonContent(source.content, expected.application)
        || Buffer.byteLength(source.content, "utf8") > MAX_ESON_FILE_BYTES) {
      throw Object.assign(new Error(`Assistant returned invalid or incomplete ESON for ${expected.application} > ${expected.id}.`), { status: 502 });
    }
    files.push({
      filename: `${expected.company}.${expected.application}!${expected.id}.data.eson`,
      company: expected.company,
      application: expected.application,
      id: expected.id,
      content: source.content,
    });
  }
  return files;
}

export async function saveGeneratedEsonFiles(workspaceRoot, files) {
  const outputRoot = safeWorkspacePath(workspaceRoot, "generated_esons");
  await assertNoSymlinkComponents(workspaceRoot, outputRoot, { createDirectories: true });
  for (const file of files) {
    if (!/^[A-Z0-9._-]+![^\\/:*?"<>|]+\.data\.eson$/i.test(file.filename)) {
      throw Object.assign(new Error("Generated ESON filename contains unsupported characters."), { status: 400 });
    }
    const target = safeWorkspacePath(outputRoot, file.filename);
    const info = await lstat(target).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (info && (!info.isFile() || info.isSymbolicLink())) {
      throw Object.assign(new Error(`Cannot safely replace generated ESON file ${file.filename}.`), { status: 400 });
    }
    await writeFile(target, file.content, { encoding: "utf8", mode: 0o600 });
    file.path = path.join("generated_esons", file.filename).split(path.sep).join("/");
  }
  return files;
}
