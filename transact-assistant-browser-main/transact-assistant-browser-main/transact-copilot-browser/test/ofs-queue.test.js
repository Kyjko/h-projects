import test from "node:test";
import assert from "node:assert/strict";
import { createOFSQueue, getDatabaseConfiguration } from "../src/ofs-queue.js";

test("OFS queue uses the fixed queue table and parameterizes every message value", async () => {
  const calls = [];
  class FakePool {
    constructor(options) { this.options = options; }
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT 1")) return { rows: [{ "?column?": 1 }] };
      if (sql.includes("RETURNING recid")) return { rows: [{ recid: values[0] }] };
      if (sql.startsWith("SELECT recid")) return { rows: [{ recid: "ID-1", xmlrecord: "OFS" }] };
      if (sql.startsWith("DELETE")) return { rowCount: 1 };
      return { rows: [] };
    }
    async end() {}
  }
  const queue = createOFSQueue({
    Pool: FakePool,
    env: { T24_DATABASE_PASSWORD: "test-password" },
  });

  assert.deepEqual(await queue.checkConnection(), {
    status: "connected",
    detail: "Connected to t24 on localhost:5432.",
  });
  assert.deepEqual(await queue.list(), [{ recid: "ID-1", xmlrecord: "OFS" }]);
  assert.deepEqual(await queue.get("ID-1"), { recid: "ID-1", xmlrecord: "OFS" });
  assert.equal(await queue.add("ID-2", "CUSTOMER,/I///0,USER/PASS/,1,NAME=VALUE"), "ID-2");
  assert.equal(await queue.clear(), 1);
  assert.match(calls[3].sql, /INSERT INTO public\."F_OFS_MESSAGE_QUEUE"/);
  assert.deepEqual(calls[3].values, ["ID-2", '"CUSTOMER,/I///0,USER/PASS/,1,NAME=VALUE"']);
  assert.deepEqual(getDatabaseConfiguration({}), {
    host: "localhost",
    port: 5432,
    database: "t24",
    user: "t24",
    table: "F_OFS_MESSAGE_QUEUE",
  });
});

test("OFS queue connection check refuses to proceed without a password", async () => {
  class FakePool {
    constructor() {}
    async query() { assert.fail("Should not connect without a password"); }
    async end() {}
  }
  const queue = createOFSQueue({ Pool: FakePool, env: {} });
  await assert.rejects(queue.checkConnection(), /T24_DATABASE_PASSWORD is not configured/);
});
