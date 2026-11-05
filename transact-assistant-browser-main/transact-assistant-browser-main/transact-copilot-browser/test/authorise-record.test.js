import test from "node:test";
import assert from "node:assert/strict";
import { assertLiveRecord, compareRecordFields, unauthorisedRowId } from "../public/js/authorise-record.js";

test("unauthorised record comparison identifies added, changed, and unchanged fields", () => {
  const unauthorised = {
    fields: [
      { name: "DESCRIPTION", value: "New text" },
      { name: "LIMIT", value: "100", mv: 1 },
      { name: "EXTRA", value: "Added" },
    ],
  };
  const live = {
    fields: [
      { name: "DESCRIPTION", value: "Old text" },
      { name: "LIMIT", value: "100", mv: 1 },
    ],
  };
  assert.deepEqual(compareRecordFields(unauthorised, live), [
    { field: "DESCRIPTION:1:1", unauthorised: "New text", live: "Old text", changed: true },
    { field: "EXTRA:1:1", unauthorised: "Added", live: "", changed: true },
    { field: "LIMIT:1:1", unauthorised: "100", live: "100", changed: false },
  ]);
});

test("comparison refuses to label an unconfirmed live read as a valid diff", () => {
  assert.throws(() => assertLiveRecord({
    state: "unauthorised",
    errors: [{ message: "No live version exists." }],
    fields: [{ name: "DESCRIPTION", value: "Pending" }],
  }), /No live version exists/);
  assert.deepEqual(assertLiveRecord({
    state: "live",
    fields: [{ name: "DESCRIPTION", value: "Approved" }],
  }), {
    state: "live",
    fields: [{ name: "DESCRIPTION", value: "Approved" }],
  });
});

test("unauthorised record list resolves IDs from a labeled ID column", () => {
  assert.equal(unauthorisedRowId(
    { cells: ["Pending", "SOURCE1"] },
    [{ identifier: "STATUS" }, { identifier: "@ID" }],
  ), "SOURCE1");
});
