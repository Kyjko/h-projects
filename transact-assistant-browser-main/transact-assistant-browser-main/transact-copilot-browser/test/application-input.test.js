import test from "node:test";
import assert from "node:assert/strict";
import { parseApplicationInput } from "../public/js/application-input.js";

test("application input parses a plain application and an application VERSION", () => {
  assert.deepEqual(parseApplicationInput(" tsa.service "), {
    application: "TSA.SERVICE",
    version: "",
    command: "",
    recordId: "",
    needsRecordId: false,
  });
  assert.deepEqual(parseApplicationInput("TSA.SERVICE,MY.VERSION"), {
    application: "TSA.SERVICE",
    version: "MY.VERSION",
    command: "",
    recordId: "",
    needsRecordId: false,
  });
});

test("application input parses supported Transact commands with and without VERSION", () => {
  assert.deepEqual(parseApplicationInput("customer s 100123"), {
    application: "CUSTOMER",
    version: "",
    command: "S",
    recordId: "100123",
    needsRecordId: false,
  });
  assert.deepEqual(parseApplicationInput("TSA.SERVICE,MY.VERSION I REC-1"), {
    application: "TSA.SERVICE",
    version: "MY.VERSION",
    command: "I",
    recordId: "REC-1",
    needsRecordId: false,
  });
  assert.equal(parseApplicationInput("CUSTOMER A").needsRecordId, true);
  assert.equal(parseApplicationInput("CUSTOMER L").command, "L");
  assert.equal(parseApplicationInput("CUSTOMER E").command, "E");
});

test("application input rejects malformed commands and extra operands", () => {
  assert.equal(parseApplicationInput("CUSTOMER X 100123"), null);
  assert.equal(parseApplicationInput("CUSTOMER L extra"), null);
  assert.equal(parseApplicationInput("CUSTOMER, S 100123"), null);
  assert.equal(parseApplicationInput(""), null);
});
