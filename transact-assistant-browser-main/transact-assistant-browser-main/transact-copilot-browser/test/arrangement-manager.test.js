import test from "node:test";
import assert from "node:assert/strict";
import {
  activityInputFields,
  arrangementFieldPrefill,
  collectProductConditions,
  enquiryIds,
  formatActivityFeedback,
  unsupportedRepeatingFieldCount,
  userInputClasses,
} from "../public/js/arrangement-manager.js";

test("product condition discovery preserves the named property and condition class", () => {
  const conditions = collectProductConditions({
    ownConditions: [
      { property: "COMMITMENT", pcPrdPr: "TERM.AMOUNT*COMMITMENT" },
      { property: "DEPOSITINT", pcPrdPr: "INTEREST*TD.INT" },
    ],
    inheritedConditions: [
      { property: "DEPOSITINT", pcPrdPr: "INTEREST*TD.INT" },
    ],
  });
  assert.deepEqual(conditions, [
    { property: "COMMITMENT", pointer: "TERM.AMOUNT*COMMITMENT", conditionClass: "TERM.AMOUNT", conditionName: "COMMITMENT" },
    { property: "DEPOSITINT", pointer: "INTEREST*TD.INT", conditionClass: "INTEREST", conditionName: "TD.INT" },
  ]);
});

test("activity class user-input properties stay paired to their MV positions", () => {
  assert.deepEqual(userInputClasses({
    fields: [
      { name: "PROPERTY.CLASS", mv: 1, value: "PAYMENT.SCHEDULE" },
      { name: "PROPERTY.CLASS", mv: 2, value: "SETTLEMENT" },
      { name: "PROPERTY.CLASS", mv: 3, value: "INTEREST" },
      { name: "USER.INPUT", mv: 1, value: "YES" },
      { name: "USER.INPUT", mv: 2, value: "NO" },
      { name: "USER.INPUT", mv: 3, value: "YES" },
    ],
  }), ["PAYMENT.SCHEDULE", "INTEREST"]);
});

test("activity editor excludes repeating fields when their MV/SV axis is unknown", () => {
  const catalog = {
    coreFields: [
      { name: "RATE", multi: false },
      { name: "PAYMENT.TYPE", multi: true },
      { name: "RECORD.STATUS", multi: false },
      { name: "READ.ONLY", multi: false, readOnly: true },
    ],
    localFields: [{ name: "USR.NOTE", multi: false }],
  };
  assert.deepEqual(activityInputFields(catalog).map((field) => field.name), ["RATE", "USR.NOTE"]);
  assert.equal(unsupportedRepeatingFieldCount(catalog), 1);
});

test("activity form prefills only a single top-level arrangement value", () => {
  const record = { record: { fields: [
    { name: "RATE", value: "4.25" },
    { name: "TERM", mv: 1, value: "12M" },
    { name: "TERM", mv: 2, value: "24M" },
    { name: "SCHEDULE", mv: 1, sv: 2, value: "MONTHLY" },
  ] } };
  assert.equal(arrangementFieldPrefill(record, "RATE"), "4.25");
  assert.equal(arrangementFieldPrefill(record, "TERM"), "");
  assert.equal(arrangementFieldPrefill(record, "SCHEDULE"), "");
});

test("simulation feedback shows submitted values and the actual Transact outcome", () => {
  const feedback = formatActivityFeedback({
    simulationMode: true,
    state: "live",
    applied: false,
    activityId: "AAACT123",
    changed: ["PRINCIPALINT.RATE"],
    warnings: ["No schedule recalculation required"],
    errors: [],
  }, { PRINCIPALINT: { RATE: "5.25" } }, true);
  assert.match(feedback, /simulation \(not committed\)/);
  assert.match(feedback, /PRINCIPALINT\.RATE = "5.25"/);
  assert.match(feedback, /AAACT123/);
  assert.match(feedback, /PRINCIPALINT\.RATE/);
  assert.match(feedback, /No schedule recalculation required/);
});

test("arrangement enquiry results resolve IDs from an explicitly labeled column", () => {
  assert.deepEqual(enquiryIds({
    columns: [{ identifier: "ARRANGEMENT" }, { identifier: "@ID" }],
    rows: [{ cells: ["AA123", "AAACT1"] }, { cells: ["AA123", "AAACT2"] }],
  }), ["AAACT1", "AAACT2"]);
  assert.deepEqual(enquiryIds({
    columns: [{ identifier: "ID" }],
    rows: [{ cells: ["AA1001"] }],
  }), ["AA1001"]);
});
