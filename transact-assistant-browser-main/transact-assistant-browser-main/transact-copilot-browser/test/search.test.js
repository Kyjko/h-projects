import test from "node:test";
import assert from "node:assert/strict";
import {
  accountOwnerId,
  buildCustomerLoansEnquiry,
  buildPaymentsEnquiry,
  getEnquiryDescription,
  getEnquirySourceTable,
  normalizeRecordId,
  normalizeRecordIds,
  paymentRecordIds,
  paymentFlowAccountIds,
} from "../public/js/menus.js";
import { filterTableRows, recordWildcardEnquiry, rowId, wildcardRegex } from "../public/js/search.js";

test("three-dot wildcard matches prefixes, suffixes, and substrings", () => {
  assert.equal(wildcardRegex("OFS...").test("OFS.SOURCE"), true);
  assert.equal(wildcardRegex("...OFS").test("SOME.OFS"), true);
  assert.equal(wildcardRegex("...OFS...").test("AA.OFS.SOURCE"), true);
  assert.equal(wildcardRegex("AA...SOURCE").test("AA.OFS.SOURCE"), true);
  assert.equal(wildcardRegex("OFS...").test("X.OFS.SOURCE"), false);
  assert.equal(wildcardRegex("FILE.1").test("FILEX1"), false);
});

test("FILE.CONTROL table filtering preserves matching rows and identifies IDs by column", () => {
  const data = {
    enquiry: "%FILE.CONTROL",
    columns: [{ identifier: "APPLICATION" }, { identifier: "@ID" }],
    rows: [
      { cells: ["AA", "OFS.SOURCE"] },
      { cells: ["EB", "EB.API"] },
      { cells: ["XX", "MY.OFS.TABLE"] },
    ],
    truncated: true,
    totalRows: 100,
  };
  assert.equal(rowId(data.rows[0], data.columns), "OFS.SOURCE");
  const result = filterTableRows(data, "...OFS...");
  assert.deepEqual(result.rows, [data.rows[0], data.rows[2]]);
  assert.equal(result.totalRows, 2);
  assert.equal(result.truncated, true);
  assert.equal(result.enquiry, "%FILE.CONTROL");
});

test("record wildcard search delegates LK filtering to Transact", () => {
  assert.deepEqual(recordWildcardEnquiry("VERSION", "AA.ARRANGEMENT..."), {
    enquiry: "%VERSION",
    selection: [{ field: "@ID", operator: "LK", value: "AA.ARRANGEMENT..." }],
    max_rows: 5000,
  });
});

test("product group and product IDs remove only the trailing bank suffix before lookup", () => {
  const result = normalizeRecordIds({
    columns: [{ identifier: "@ID" }, { identifier: "DESCRIPTION" }],
    rows: [
      { cells: ["GROUP.ONE\\BNK", "Group one"] },
      { cells: ["GROUP.TWO", "Group two"] },
    ],
  });
  assert.deepEqual(result.rows.map((row) => row.cells[0]), ["GROUP.ONE", "GROUP.TWO"]);
  const products = normalizeRecordIds({
    columns: [{ identifier: "@ID" }, { identifier: "DESCRIPTION" }],
    rows: [{ cells: ["PRODUCT.ONE\\BNK", "Product one"] }],
  });
  assert.equal(rowId(products.rows[0], products.columns), "PRODUCT.ONE");
  assert.equal(normalizeRecordId("PRODUCT\\BNK.extra"), "PRODUCT\\BNK.extra");
  assert.equal(normalizeRecordId("PRODUCT\\bnk"), "PRODUCT");
});

test("payments enquiry builds PAYMENT.ORDER filters from intuitive payment fields", () => {
  assert.deepEqual(buildPaymentsEnquiry({
    paymentId: "PO-123",
    orderingCustomer: "1000123",
    debitAccount: "100000001",
    debitCurrency: "AUD",
    creditAccount: "100000002",
    creditCurrency: "NZD",
    minimumAmount: "25",
    maximumAmount: "500",
  }, 1000), {
    enquiry: "%PAYMENT.ORDER",
    selection: [
      { field: "@ID", operator: "EQ", value: "PO-123" },
      { field: "ORDERING.CUSTOMER", operator: "EQ", value: "1000123" },
      { field: "DEBIT.ACCT.NO", operator: "EQ", value: "100000001" },
      { field: "DEBIT.CURRENCY", operator: "EQ", value: "AUD" },
      { field: "CREDIT.ACCT.NO", operator: "EQ", value: "100000002" },
      { field: "CREDIT.CURRENCY", operator: "EQ", value: "NZD" },
      { field: "PAYMENT.AMOUNT", operator: "GE", value: "25" },
      { field: "PAYMENT.AMOUNT", operator: "LE", value: "500" },
    ],
    max_rows: 1000,
  });
  assert.deepEqual(buildPaymentsEnquiry({}), {
    enquiry: "%PAYMENT.ORDER",
    max_rows: 5000,
  });
  assert.throws(() => buildPaymentsEnquiry({ minimumAmount: "invalid" }), /valid non-negative/);
  assert.throws(() => buildPaymentsEnquiry({ minimumAmount: "100", maximumAmount: "10" }), /cannot exceed/);
});

test("payment flow uses PAYMENT.ORDER IDs without a trailing bank suffix", () => {
  const results = {
    columns: [{ identifier: "@ID" }, { identifier: "PAYMENT.AMOUNT" }],
    rows: [
      { cells: ["PO-123\\BNK", "20.00"] },
      { id: "PO-456\\bnk", cells: ["PO-456\\bnk", "40.00"] },
      { cells: ["PO-789", "60.00"] },
    ],
  };
  assert.deepEqual(paymentRecordIds(results), ["PO-123", "PO-456", "PO-789"]);
});

test("payment flow endpoints are accounts and ownership is read from ACCOUNT records", () => {
  const payment = {
    fields: [
      { name: "DEBIT.ACCOUNT", value: "ACC-DEBIT" },
      { name: "CREDIT.ACCOUNT", value: "ACC-CREDIT" },
      { name: "DEBIT.ACCT.NO", value: "MUST-NOT-BE-USED-AS-ENDPOINT" },
      { name: "CREDIT.ACCT.NO", value: "MUST-NOT-BE-USED-AS-ENDPOINT" },
    ],
  };
  assert.deepEqual(paymentFlowAccountIds(payment), {
    debit: "ACC-DEBIT",
    credit: "ACC-CREDIT",
  });
  assert.equal(accountOwnerId({ fields: [{ name: "CUSTOMER", value: "CUST-1" }] }), "CUST-1");
  assert.equal(accountOwnerId({ fields: [{ name: "OWNER", value: "CUST-2" }] }), "CUST-2");
});

test("customer loans enquiry uses the named enquiry with optional filtering and list-all", () => {
  assert.deepEqual(buildCustomerLoansEnquiry([
    { field: "CUSTOMER", operator: "EQ", value: "1000123" },
  ], 1000), {
    enquiry: "AA.API.CUSTLOANS.1.2.0",
    selection: [{ field: "CUSTOMER", operator: "EQ", value: "1000123" }],
    max_rows: 1000,
  });
  assert.deepEqual(buildCustomerLoansEnquiry([]), {
    enquiry: "AA.API.CUSTLOANS.1.2.0",
    max_rows: 5000,
  });
});

test("enquiry source-table indicator reads the ENQUIRY FILE.NAME field", () => {
  const record = {
    fields: [
      { name: "ENQUIRY", value: "AA.API.CUSTLOANS.1.2.0" },
      { name: "FILE.NAME", value: "AA.ARRANGEMENT" },
      { name: "DESCRIPTION", value: "Customer Loan Accounts" },
    ],
  };
  assert.equal(getEnquirySourceTable(record), "AA.ARRANGEMENT");
  assert.equal(getEnquiryDescription(record), "Customer Loan Accounts");
});
