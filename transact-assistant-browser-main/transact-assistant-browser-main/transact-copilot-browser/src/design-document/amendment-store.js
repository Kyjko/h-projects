import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_DIR = path.join(ROOT, ".local-data");
const STORE_PATH = path.join(DATA_DIR, "recent-amendments.json");
const MAX_AMENDMENTS = 5;

export function isAppliedRecord(result) {
  if (!result || typeof result !== "object"
      || (Array.isArray(result.errors) && result.errors.length > 0)
      || result.acceptanceFlag === "NO"
      || (typeof result.statusCode === "number" && result.statusCode < 1)
      || ["hold", "unauthorised", "transient"].includes(result.state)) return false;
  return result.state === "live" || result.statusCode === 1;
}

export function createAmendmentStore({
  storePath = STORE_PATH,
  maxEntries = MAX_AMENDMENTS,
} = {}) {
  let writes = Promise.resolve();

  async function readAll() {
    try {
      const data = JSON.parse(await readFile(storePath, "utf8"));
      return Array.isArray(data) ? data.filter((entry) => entry && typeof entry.id === "string").slice(0, maxEntries) : [];
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw new Error(`Could not read recent amendment history: ${error.message}`);
    }
  }

  async function writeAll(entries) {
    await mkdir(path.dirname(storePath), { recursive: true });
    const temporary = `${storePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(entries, null, 2), { encoding: "utf8", mode: 0o600 });
      await rename(temporary, storePath);
    } catch (error) {
      throw new Error(`Could not save recent amendment history: ${error.message}`);
    }
  }

  async function getAmendmentsByIds(ids) {
    const entries = await readAll();
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    return ids.map((id) => {
      const entry = byId.get(id);
      if (!entry) throw Object.assign(new Error("A selected amendment is no longer available. Refresh the recent amendments list."), { status: 400 });
      return entry;
    });
  }

  function recordAmendment(amendment) {
    const operation = writes.then(async () => {
      const entries = await readAll();
      const entry = {
        id: randomUUID(),
        application: amendment.application,
        recordId: amendment.recordId,
        fields: amendment.fields,
        state: amendment.state || "live",
        source: amendment.source,
        occurredAt: amendment.occurredAt || new Date().toISOString(),
      };
      await writeAll([entry, ...entries].slice(0, maxEntries));
      return entry;
    });
    writes = operation.catch(() => {});
    return operation;
  }

  return { listRecentAmendments: readAll, getAmendmentsByIds, recordAmendment };
}

const defaultStore = createAmendmentStore();
export const listRecentAmendments = defaultStore.listRecentAmendments;
export const getAmendmentsByIds = defaultStore.getAmendmentsByIds;
export const recordAmendment = defaultStore.recordAmendment;

export const MAX_RECENT_AMENDMENTS = MAX_AMENDMENTS;
