import test from "node:test";
import assert from "node:assert/strict";
import { generateOFSMessage, maskOFSMessage, parseOFSMessage } from "../src/ofs-message.js";

const config = { user: "AUTHOR", password: "123456", company: "", noOfAuth: "0" };

test("OFS message generator uses the configured input profile and parses back to ofs-input arguments", () => {
  const message = generateOFSMessage({
    application: "customer",
    version: "CUST.INPUT",
    function: "I",
    id: "CUST-1001",
    data: "MNEMONIC=TEST,SHORT.NAME=TEST",
  }, config);
  assert.equal(message, "CUSTOMER,CUST.INPUT/I///0,AUTHOR/123456,CUST-1001,MNEMONIC=TEST,SHORT.NAME=TEST");
  assert.deepEqual(parseOFSMessage(message, config), {
    operation: "I",
    application: "CUSTOMER",
    version: "CUST.INPUT",
    id: "CUST-1001",
    confirm: true,
    fields: [
      { name: "MNEMONIC", value: "TEST" },
      { name: "SHORT.NAME", value: "TEST" },
    ],
  });
});

test("OFS parser maps MV/SV positions and NULL clears to structured inputs", () => {
  assert.deepEqual(parseOFSMessage(
    "AA.TEST,/I///0,AUTHOR/123456,RECORD-1,MV.FIELD:2:3=VALUE,CLEAR.FIELD=NULL,LITERAL.FIELD=\\NULL",
    config,
  ), {
    operation: "I",
    application: "AA.TEST",
    id: "RECORD-1",
    confirm: true,
    fields: [
      { name: "MV.FIELD", mv: 2, sv: 3, value: "VALUE" },
      { name: "CLEAR.FIELD", intent: "clear", value: "" },
      { name: "LITERAL.FIELD", value: "NULL" },
    ],
  });
});

test("OFS parser supports read messages and refuses unsupported functions or invalid read data", () => {
  const message = generateOFSMessage({ application: "CUSTOMER", function: "S", id: "100" }, config);
  assert.equal(message, "CUSTOMER,/S///0,AUTHOR/123456,100");
  assert.deepEqual(parseOFSMessage(message, config), {
    operation: "S",
    application: "CUSTOMER",
    id: "100",
    confirm: true,
    fields: [],
  });
  assert.throws(() => parseOFSMessage("CUSTOMER,CUST.VIEW/S///0,AUTHOR/123456,100", config), /does not accept a VERSION/);
  assert.throws(() => parseOFSMessage("CUSTOMER,/S///0,AUTHOR/123456,100,MNEMONIC=TEST", config), /does not accept field assignments/);
  assert.throws(() => parseOFSMessage("CUSTOMER,/A///0,AUTHOR/123456,100", config), /Only OFS functions I and S/);
  assert.throws(() => parseOFSMessage("CUSTOMER,/I///1,AUTHOR/123456,100,MNEMONIC=TEST", config), /NO.OF.AUTH/);
  assert.throws(() => parseOFSMessage("CUSTOMER,/I///0,AUTHOR/123456/AU0010001,100,MNEMONIC=TEST", config), /credentials or company/);
  assert.throws(() => parseOFSMessage("CUSTOMER,/I///0,AUTHOR/123456,100,BAD FIELD=TEST", config), /Invalid OFS field assignment/);
  assert.throws(() => parseOFSMessage("CUSTOMER,/I///0,AUTHOR/123456,100,MNEMONIC=TEST,MNEMONIC=OTHER", config), /duplicate field positions/);
});

test("OFS message masking hides the password in queue displays", () => {
  assert.equal(maskOFSMessage("CUSTOMER,/I///0,AUTHOR/123456,100,MNEMONIC=TEST", config),
    "CUSTOMER,/I///0,AUTHOR/***,100,MNEMONIC=TEST");
});

test("OFS generator includes an explicit company only when configured and encodes record IDs", () => {
  const companyConfig = { ...config, company: "AU0010001" };
  const message = generateOFSMessage({
    application: "TSA.SERVICE",
    function: "I",
    id: "BNK/ID,1",
    data: "DESCRIPTION=TEST",
  }, companyConfig);
  assert.equal(message, "TSA.SERVICE,/I///0,AUTHOR/123456/AU0010001,BNK^ID?1,DESCRIPTION=TEST");
  assert.equal(parseOFSMessage(message, companyConfig).id, "BNK/ID,1");
});
