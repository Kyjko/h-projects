import {
  callTransactTool,
  findReferenceEson,
  generateEson,
  listSkills,
  readSkillFile,
  saveSkill,
  uploadSkill,
} from "./api.js";
import { renderData, renderError } from "./record-view.js";
import { rowId } from "./search.js";

const $ = (selector) => document.querySelector(selector);
const MAX_ROWS = 5000;
const ENQUIRY_PAGE_SIZE = 50;
const PAYMENT_OPERATORS = ["EQ", "NE", "GE", "GT", "LE", "LT", "LK", "UL", "NR"];

function buildFilteredEnquiry(enquiry, filters, maxRows = MAX_ROWS) {
  const selection = [];
  for (const filter of filters) {
    const field = String(filter.field || "").trim();
    const value = String(filter.value || "").trim();
    if (!field && !value) continue;
    if (!field || !value) throw new Error("Complete both the field and value for each payment filter.");
    if (!PAYMENT_OPERATORS.includes(filter.operator)) throw new Error("Select a supported operator for each payment filter.");
    selection.push({ field, operator: filter.operator, value });
  }
  if (!Number.isInteger(maxRows) || maxRows < 0 || maxRows > MAX_ROWS) {
    throw new Error(`Maximum rows must be between 0 and ${MAX_ROWS}.`);
  }
  return {
    enquiry,
    ...(selection.length ? { selection } : {}),
    max_rows: maxRows,
  };
}

export function buildPaymentsEnquiry(filters, maxRows = MAX_ROWS) {
  const fields = [
    ["paymentId", "@ID"],
    ["orderingCustomer", "ORDERING.CUSTOMER"],
    ["debitAccount", "DEBIT.ACCT.NO"],
    ["debitCurrency", "DEBIT.CURRENCY"],
    ["creditAccount", "CREDIT.ACCT.NO"],
    ["creditCurrency", "CREDIT.CURRENCY"],
  ];
  const selection = fields
    .map(([key, field]) => ({ field, operator: "EQ", value: String(filters[key] || "").trim() }))
    .filter((filter) => filter.value);
  for (const [key, operator] of [["minimumAmount", "GE"], ["maximumAmount", "LE"]]) {
    const value = String(filters[key] || "").trim();
    if (value) {
      if (!Number.isFinite(Number(value)) || Number(value) < 0) {
        throw new Error("Enter a valid non-negative payment amount.");
      }
      selection.push({ field: "PAYMENT.AMOUNT", operator, value });
    }
  }
  const minimum = String(filters.minimumAmount || "").trim();
  const maximum = String(filters.maximumAmount || "").trim();
  if (minimum && maximum && Number(minimum) > Number(maximum)) {
    throw new Error("Minimum amount cannot exceed maximum amount.");
  }
  if (!Number.isInteger(maxRows) || maxRows < 0 || maxRows > MAX_ROWS) {
    throw new Error(`Maximum rows must be between 0 and ${MAX_ROWS}.`);
  }
  return {
    enquiry: "%PAYMENT.ORDER",
    ...(selection.length ? { selection } : {}),
    max_rows: maxRows,
  };
}

export function buildCustomerLoansEnquiry(filters, maxRows = MAX_ROWS) {
  return buildFilteredEnquiry("AA.API.CUSTLOANS.1.2.0", filters, maxRows);
}

export function getEnquirySourceTable(record) {
  const fields = record?.record?.fields || record?.fields || [];
  for (const name of ["FILE.NAME", "FILE.NAME.1", "ENQUIRY.FILE", "SOURCE.FILE"]) {
    const field = fields.find((item) => item?.name === name && item.value);
    if (field) return String(field.value);
  }
  return "";
}

export function getEnquiryDescription(record) {
  const fields = record?.record?.fields || record?.fields || [];
  for (const name of ["DESCRIPTION", "ENQUIRY.DESCRIPTION", "SHORT.DESC", "TITLE", "HEADER"]) {
    const field = fields.find((item) => item?.name === name && item.value);
    if (field) return String(field.value);
  }
  return "";
}

const PAGES = {
  "find-customer": {
    group: "User menu",
    title: "Find Customer",
    description: "Find a customer by customer number, account number, or arrangement ID, or list CUSTOMER records.",
  },
  "find-account": {
    group: "User menu",
    title: "Find Account",
    description: "Find an account by account number or customer owner, or list ACCOUNT records.",
  },
  "find-arrangement": {
    group: "User menu",
    title: "Find Arrangement",
    description: "Find an arrangement by ID, account reference, or customer number.",
  },
  "locked-records": {
    group: "User menu",
    title: "View Locked Records",
    description: "Run the CRL enquiry to display locked Transact records.",
  },
  "customer-versions": {
    group: "User menu",
    title: "View CUSTOMER Versions",
    description: "List VERSION records whose application is CUSTOMER.",
  },
  "payments-enquiry": {
    group: "User menu",
    title: "Payments Enquiry",
    description: "Search PAYMENT.ORDER records by customer, debit or credit details, and amount.",
  },
  "customer-loans": {
    group: "User menu",
    title: "Find Customer Loans",
    description: "Run the AA.API.CUSTLOANS.1.2.0 enquiry with optional field filters, or list all customer loan records.",
  },
  enquiries: {
    group: "User menu",
    title: "Enquiries",
    description: "Browse saved Transact enquiries, see their source tables, and run an enquiry.",
  },
  "configure-products": {
    group: "Admin menu",
    title: "Configure Products",
    description: "Browse product lines, their product groups, and the products in each group.",
  },
  "manage-tsa-service": {
    group: "Admin menu",
    title: "Manage TSA Service",
    description: "List records from the TSA.SERVICE application.",
  },
  "generate-eson": {
    group: "AI tools",
    title: "Generate ESON",
    description: "Generate downloadable ESON files from live Transact records or inspect matching reference files.",
  },
  "manage-skills": {
    group: "AI tools",
    title: "Manage Skills",
    description: "Browse, upload, and edit local Copilot skills.",
  },
};

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function recordFields(result) {
  return result?.record?.fields || result?.fields || [];
}

function fieldValue(result, fieldName) {
  const field = recordFields(result).find((item) => item?.name === fieldName);
  return field?.value === undefined || field?.value === null ? "" : String(field.value);
}

function fieldValues(result, fieldName) {
  return recordFields(result)
    .filter((field) => field?.name === fieldName)
    .sort((left, right) => Number(left.mv || 1) - Number(right.mv || 1))
    .map((field) => field.value === undefined || field.value === null ? "" : String(field.value));
}

export function paymentFlowAccountIds(paymentRecord) {
  return {
    debit: fieldValue(paymentRecord, "DEBIT.ACCOUNT"),
    credit: fieldValue(paymentRecord, "CREDIT.ACCOUNT"),
  };
}

export function accountOwnerId(accountRecord) {
  return fieldValue(accountRecord, "CUSTOMER") || fieldValue(accountRecord, "OWNER");
}

function rowValue(row, columns, fieldName, fallbackIndex) {
  if (row && !Array.isArray(row) && !Array.isArray(row.cells)) {
    const match = Object.entries(row).find(([key]) => key.toUpperCase() === fieldName);
    if (match) return String(match[1] ?? "");
  }
  const columnIndex = columns.findIndex((column) =>
    String(column.identifier || column.name || column.label || column).toUpperCase() === fieldName);
  const cells = Array.isArray(row?.cells) ? row.cells : Array.isArray(row) ? row : [];
  return String(cells[columnIndex >= 0 ? columnIndex : fallbackIndex] ?? "");
}

function rowDescription(row, columns) {
  for (const name of ["DESCRIPTION", "SHORT.NAME", "PRODUCT.NAME"]) {
    const value = rowValue(row, columns, name, -1);
    if (value) return value;
  }
  return "";
}

export function normalizeRecordId(id) {
  return String(id).replace(/\\BNK$/i, "");
}

export function paymentRecordIds(data) {
  return (data?.rows || [])
    .map((row) => normalizeRecordId(rowId(row, data.columns || [])))
    .filter(Boolean);
}

export function normalizeRecordIds(result) {
  const columns = result?.columns || [];
  const idIndex = columns.findIndex((column) =>
    ["@ID", "ID"].includes(String(column.identifier || column.name || column.label || column).toUpperCase()));
  return {
    ...result,
    rows: (result?.rows || []).map((row) => {
      if (Array.isArray(row?.cells)) {
        const cells = [...row.cells];
        const index = idIndex >= 0 ? idIndex : 0;
        if (cells[index] !== undefined) cells[index] = normalizeRecordId(cells[index]);
        return {
          ...row,
          ...(typeof row.id === "string" ? { id: normalizeRecordId(row.id) } : {}),
          cells,
        };
      }
      if (Array.isArray(row)) {
        const cells = [...row];
        const index = idIndex >= 0 ? idIndex : 0;
        if (cells[index] !== undefined) cells[index] = normalizeRecordId(cells[index]);
        return cells;
      }
      if (!row || typeof row !== "object") return row;
      const normalized = { ...row };
      for (const key of ["id", "recordId", "@ID", "ID"]) {
        if (typeof normalized[key] === "string") normalized[key] = normalizeRecordId(normalized[key]);
      }
      return normalized;
    }),
  };
}

function clearResults() {
  $("#explorer-results").replaceChildren();
}

function showResult(data, title) {
  const block = node("section", "explorer-result-block");
  if (title) block.append(node("h2", "enquiry-title", title));
  renderData(data, block);
  $("#explorer-results").append(block);
}

function showError(error) {
  clearResults();
  renderError(error.message || String(error), $("#explorer-results"));
  $("#explorer-status").textContent = "The Transact request could not be completed.";
  $("#explorer-status").classList.add("error");
}

async function loadResult(tool, args, title) {
  $("#explorer-status").classList.remove("error");
  $("#explorer-status").textContent = "Contacting Transact…";
  clearResults();
  try {
    const result = await callTransactTool(tool, args);
    showResult(result, title);
    $("#explorer-status").textContent = "Transact response received.";
    return result;
  } catch (error) {
    showError(error);
    throw error;
  }
}

function inputField(labelText, placeholder) {
  const label = node("label", "explorer-field");
  label.append(node("span", "", labelText));
  const input = node("input");
  input.type = "text";
  input.placeholder = placeholder;
  input.autocomplete = "off";
  input.spellcheck = false;
  label.append(input);
  return { label, input };
}

function selectField(labelText, choices) {
  const label = node("label", "explorer-field");
  label.append(node("span", "", labelText));
  const select = node("select");
  for (const choice of choices) {
    const option = node("option", "", choice.label);
    option.value = choice.value;
    select.append(option);
  }
  label.append(select);
  return { label, select };
}

function actionButton(text) {
  const button = node("button", "button button-primary", text);
  button.type = "submit";
  return button;
}

function makeSearchForm({ choices, idLabel, placeholder, onSubmit }) {
  const form = node("form", "explorer-form");
  const mode = selectField("SEARCH BY", choices);
  const value = inputField(idLabel, placeholder);
  const submit = actionButton("Search");

  function updateMode() {
    const listing = mode.select.value === "all";
    value.label.hidden = listing;
    value.input.required = !listing;
    value.input.placeholder = choices.find((choice) => choice.value === mode.select.value)?.placeholder || placeholder;
  }
  mode.select.addEventListener("change", updateMode);
  updateMode();
  form.append(mode.label, value.label, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const searchValue = value.input.value.trim();
    if (mode.select.value !== "all" && !searchValue) {
      value.input.focus();
      return;
    }
    submit.disabled = true;
    $("#explorer-status").classList.remove("error");
    $("#explorer-status").textContent = "Searching Transact…";
    try {
      await onSubmit(mode.select.value, searchValue);
    } catch (error) {
      showError(error);
    } finally {
      submit.disabled = false;
    }
  });
  $("#explorer-controls").replaceChildren(form);
}

async function findCustomer(mode, value) {
  if (mode === "all") {
    await loadResult("ofs-enquiry", { enquiry: "%CUSTOMER", max_rows: MAX_ROWS }, "CUSTOMER records");
    return;
  }
  if (mode === "customer") {
    await loadResult("ofs-read", { application: "CUSTOMER", id: value }, `CUSTOMER · ${value}`);
    return;
  }
  const sourceApplication = mode === "arrangement" ? "AA.ARRANGEMENT" : "ACCOUNT";
  const source = await callTransactTool("ofs-read", { application: sourceApplication, id: value });
  const customerId = fieldValue(source, "CUSTOMER");
  if (!customerId) throw new Error(`${sourceApplication} ${value} did not return a CUSTOMER field.`);
  const customer = await callTransactTool("ofs-read", { application: "CUSTOMER", id: customerId });
  clearResults();
  showResult(customer, `CUSTOMER · ${customerId} (found through ${sourceApplication} · ${value})`);
  $("#explorer-status").textContent = "Transact response received.";
}

function setupCustomer() {
  makeSearchForm({
    choices: [
      { value: "customer", label: "Customer number", placeholder: "CUSTOMER record ID" },
      { value: "account", label: "Account number", placeholder: "ACCOUNT record ID" },
      { value: "arrangement", label: "Arrangement ID", placeholder: "AA.ARRANGEMENT record ID" },
      { value: "all", label: "List all CUSTOMER records" },
    ],
    idLabel: "RECORD ID",
    placeholder: "CUSTOMER record ID",
    onSubmit: findCustomer,
  });
}

function setupAccount() {
  makeSearchForm({
    choices: [
      { value: "account", label: "Account number", placeholder: "ACCOUNT record ID" },
      { value: "customer", label: "Customer owner ID", placeholder: "CUSTOMER record ID" },
      { value: "all", label: "List all ACCOUNT records" },
    ],
    idLabel: "ID",
    placeholder: "ACCOUNT or CUSTOMER record ID",
    async onSubmit(mode, value) {
      if (mode === "account") {
        await loadResult("ofs-read", { application: "ACCOUNT", id: value }, `ACCOUNT · ${value}`);
      } else if (mode === "customer") {
        await loadResult("customer-accounts", { customer_id: value }, `Accounts owned by CUSTOMER · ${value}`);
      } else {
        await loadResult("ofs-enquiry", { enquiry: "%ACCOUNT", max_rows: MAX_ROWS }, "ACCOUNT records");
      }
    },
  });
}

async function readArrangementsByAccountReference(reference) {
  $("#explorer-status").classList.remove("error");
  $("#explorer-status").textContent = "Searching AA.ARR.ACCOUNT…";
  clearResults();
  const links = await callTransactTool("ofs-enquiry", {
    enquiry: "%AA.ARR.ACCOUNT",
    selection: [{ field: "ACCOUNT.REFERENCE", operator: "EQ", value: reference }],
    max_rows: MAX_ROWS,
  });
  const identifiers = [...new Set((links.rows || [])
    .map((row) => rowId(row, links.columns || []))
    .filter(Boolean)
    .map((id) => id.split("-", 1)[0]))];
  if (!identifiers.length) {
    showResult(links, `AA.ARR.ACCOUNT links for ${reference}`);
    $("#explorer-status").textContent = "No matching arrangements were returned.";
    return;
  }
  $("#explorer-status").textContent = `Reading ${identifiers.length} matching arrangement record(s)…`;
  const records = [];
  for (let offset = 0; offset < identifiers.length; offset += 10) {
    const batch = identifiers.slice(offset, offset + 10);
    records.push(...await Promise.all(batch.map(async (id) => {
      const record = await callTransactTool("ofs-read", { application: "AA.ARRANGEMENT", id });
      return { ...record, application: "AA.ARRANGEMENT", id };
    })));
  }
  showResult(records, `AA.ARRANGEMENT records linked to ACCOUNT.REFERENCE · ${reference}`);
  $("#explorer-status").textContent = `${records.length} arrangement record(s) found.`;
}

function setupArrangement() {
  makeSearchForm({
    choices: [
      { value: "arrangement", label: "Arrangement ID", placeholder: "AA.ARRANGEMENT record ID" },
      { value: "account-reference", label: "Account reference", placeholder: "ACCOUNT.REFERENCE value" },
      { value: "customer", label: "Customer ID", placeholder: "CUSTOMER record ID" },
    ],
    idLabel: "ID",
    placeholder: "Arrangement, account reference, or customer ID",
    async onSubmit(mode, value) {
      if (mode === "arrangement") {
        await loadResult("ofs-read", { application: "AA.ARRANGEMENT", id: value }, `AA.ARRANGEMENT · ${value}`);
      } else if (mode === "account-reference") {
        await readArrangementsByAccountReference(value);
      } else {
        await loadResult("ofs-enquiry", {
          enquiry: "%AA.ARRANGEMENT",
          selection: [{ field: "CUSTOMER", operator: "EQ", value }],
          max_rows: MAX_ROWS,
        }, `AA.ARRANGEMENT records for CUSTOMER · ${value}`);
      }
    },
  });
}

function setupPaymentsEnquiry() {
  const form = node("form", "payments-enquiry-form");
  const filterList = node("div", "payment-search-fields");
  const filterFields = [
    ["Payment ID", "paymentId", "Exact PAYMENT.ORDER record ID"],
    ["Ordering Customer ID", "orderingCustomer", "Customer number"],
    ["Debit Account", "debitAccount", "Account number"],
    ["Debit Currency", "debitCurrency", "e.g. AUD"],
    ["Credit Account", "creditAccount", "Account number"],
    ["Credit Currency", "creditCurrency", "e.g. AUD"],
    ["Minimum Amount", "minimumAmount", "Amount, inclusive"],
    ["Maximum Amount", "maximumAmount", "Amount, inclusive"],
  ];
  for (const [label, key, placeholder] of filterFields) {
    const field = inputField(label, placeholder);
    field.input.dataset.paymentFilter = key;
    if (key === "minimumAmount" || key === "maximumAmount") {
      field.input.inputMode = "decimal";
    }
    filterList.append(field.label);
  }
  const rowLimit = selectField("MAXIMUM ROWS", [
    { value: "500", label: "500" },
    { value: "1000", label: "1,000" },
    { value: "2500", label: "2,500" },
    { value: "5000", label: "5,000" },
  ]);
  rowLimit.select.value = "5000";
  const submit = actionButton("Search Payments");
  const actions = node("div", "payment-enquiry-actions");
  actions.append(rowLimit.label, submit);
  form.append(filterList, actions);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const filters = Object.fromEntries([...form.querySelectorAll("[data-payment-filter]")]
      .map((input) => [input.dataset.paymentFilter, input.value]));
    let args;
    try {
      args = buildPaymentsEnquiry(filters, Number(rowLimit.select.value));
    } catch (error) {
      $("#explorer-status").textContent = error.message;
      $("#explorer-status").classList.add("error");
      return;
    }
    submit.disabled = true;
    $("#explorer-status").classList.remove("error");
    $("#explorer-status").textContent = "Searching PAYMENT.ORDER…";
    try {
      const results = await callTransactTool("ofs-enquiry", args);
      showPaymentResults(results);
      $("#explorer-status").textContent = `${(results.rows || []).length.toLocaleString()} payment record(s) returned${results.truncated ? " (results truncated)" : ""}.`;
    } catch (error) {
      showError(error);
    } finally {
      submit.disabled = false;
    }
  });
  $("#explorer-controls").replaceChildren(form);
}

function paymentAccountCard(accountId, account, customer, heading) {
  const card = node("section", "payment-customer-card payment-account-card");
  card.append(node("h3", "", heading));
  card.append(node("span", "payment-customer-id", accountId || "Account not provided"));
  if (!accountId) {
    card.append(node("p", "payment-customer-error", "This payment does not contain an account number."));
    return card;
  }
  if (account?.error) {
    card.append(node("p", "payment-customer-error", `Account details unavailable: ${account.error}`));
    return card;
  }
  card.append(node("span", "payment-account-title", fieldValue(account, "SHORT.TITLE") || fieldValue(account, "ACCOUNT.TITLE")));
  const customerId = accountOwnerId(account);
  if (!customerId) {
    card.append(node("p", "", "The ACCOUNT record did not return a CUSTOMER or OWNER field."));
    return card;
  }
  card.append(node("span", "payment-account-owner", `Owned by customer ${customerId}`));
  if (customer?.error) {
    card.append(node("p", "payment-customer-error", `Customer details unavailable: ${customer.error}`));
    return card;
  }
  const name = fieldValue(customer, "SHORT.NAME") || fieldValue(customer, "NAME") || fieldValue(customer, "MNEMONIC");
  if (name) card.append(node("strong", "payment-customer-name", name));
  for (const nameField of ["SECTOR", "INDUSTRY", "NATIONALITY"]) {
    const value = fieldValue(customer, nameField);
    if (value) card.append(node("span", "payment-customer-detail", `${nameField}: ${value}`));
  }
  return card;
}

function paymentHistory(record) {
  return fieldValues(record, "STATE.HIST").filter(Boolean);
}

async function loadPaymentFlow(paymentId, detailView, isCurrent) {
  detailView.replaceChildren();
  detailView.append(node("p", "payment-flow-loading", `Loading PAYMENT.ORDER ${paymentId}…`));
  try {
    const record = await callTransactTool("ofs-read", { application: "PAYMENT.ORDER", id: paymentId });
    const { debit: debitAccount, credit: creditAccount } = paymentFlowAccountIds(record);
    const accountResults = await Promise.all([debitAccount, creditAccount].map(async (id) => {
      if (!id) return [id, null];
      try {
        return [id, await callTransactTool("ofs-read", { application: "ACCOUNT", id })];
      } catch (error) {
        return [id, { error: error.message }];
      }
    }));
    const accounts = new Map(accountResults);
    const customerIds = [...new Set(accountResults
      .filter(([, account]) => account && !account.error)
      .map(([, account]) => accountOwnerId(account))
      .filter(Boolean))];
    const customerResults = await Promise.all(customerIds.map(async (id) => {
      try {
        return [id, await callTransactTool("ofs-read", { application: "CUSTOMER", id })];
      } catch (error) {
        return [id, { error: error.message }];
      }
    }));
    if (!isCurrent()) return;
    const customers = new Map(customerResults);
    const amount = fieldValue(record, "PAYMENT.AMOUNT");
    const debitCurrency = fieldValue(record, "DEBIT.CURRENCY");
    const creditCurrency = fieldValue(record, "CREDIT.CURRENCY");
    const currency = debitCurrency && debitCurrency === creditCurrency
      ? debitCurrency
      : debitCurrency && creditCurrency
        ? `${debitCurrency} → ${creditCurrency}`
        : debitCurrency || creditCurrency || fieldValue(record, "PAYMENT.CURRENCY");

    detailView.replaceChildren();
    const recordHeading = node("h2", "enquiry-title", `PAYMENT.ORDER · ${paymentId}`);
    const flow = node("div", "payment-flow");
    const debitRecord = accounts.get(debitAccount);
    const creditRecord = accounts.get(creditAccount);
    flow.append(paymentAccountCard(
      debitAccount,
      debitRecord,
      debitRecord && !debitRecord.error ? customers.get(accountOwnerId(debitRecord)) : null,
      "Debit Account",
    ));
    const transfer = node("div", "payment-transfer");
    const arrow = node("div", "payment-transfer-arrow");
    arrow.append(node("span", "payment-transfer-amount", [amount, currency].filter(Boolean).join(" ") || "Payment amount unavailable"));
    transfer.append(
      node("div", "payment-transfer-route", `${debitAccount || "Debit account"} → ${creditAccount || "Credit account"}`),
      arrow,
    );
    flow.append(transfer);
    flow.append(paymentAccountCard(
      creditAccount,
      creditRecord,
      creditRecord && !creditRecord.error ? customers.get(accountOwnerId(creditRecord)) : null,
      "Credit Account",
    ));
    detailView.append(recordHeading, flow);
    const historyValues = paymentHistory(record);
    const historySection = node("section", "payment-history");
    historySection.append(node("h3", "", "Payment State History"));
    if (historyValues.length) {
      const list = node("ol", "payment-history-list");
      for (const state of historyValues) list.append(node("li", "", state));
      historySection.append(list);
    } else {
      historySection.append(node("p", "", "No STATE.HIST entries were returned."));
    }
    detailView.append(historySection);
    const recordDetails = node("details", "payment-record-details");
    recordDetails.append(node("summary", "", "View full payment record"));
    renderData({ ...record, application: "PAYMENT.ORDER", id: paymentId }, recordDetails);
    detailView.append(recordDetails);
  } catch (error) {
    if (!isCurrent()) return;
    detailView.replaceChildren();
    renderError(error.message, detailView);
  }
}

function showPaymentResults(data) {
  clearResults();
  const tableView = node("div", "payment-table-view");
  renderData(data, tableView);
  const viewControls = node("div", "payment-view-controls");
  const tableButton = node("button", "button button-secondary is-selected", "Table View");
  const flowButton = node("button", "button button-secondary", "Payment Flow");
  tableButton.type = flowButton.type = "button";
  const paymentSelect = selectField("PAYMENT", []);
  const rows = data.rows || [];
  let flowRequestSequence = 0;
  for (const id of paymentRecordIds(data)) {
    const option = node("option", "", id);
    option.value = id;
    paymentSelect.select.append(option);
  }
  paymentSelect.label.hidden = true;
  const flowView = node("div", "payment-flow-view");
  flowView.hidden = true;
  tableButton.addEventListener("click", () => {
    tableView.hidden = false;
    paymentSelect.label.hidden = true;
    flowView.hidden = true;
    tableButton.classList.add("is-selected");
    flowButton.classList.remove("is-selected");
  });
  flowButton.addEventListener("click", () => {
    tableView.hidden = true;
    paymentSelect.label.hidden = rows.length <= 1;
    flowView.hidden = false;
    tableButton.classList.remove("is-selected");
    flowButton.classList.add("is-selected");
    if (paymentSelect.select.value) {
      const requestSequence = ++flowRequestSequence;
      loadPaymentFlow(paymentSelect.select.value, flowView, () => requestSequence === flowRequestSequence);
    }
    else flowView.replaceChildren(node("p", "", "No payment record IDs were returned to display."));
  });
  paymentSelect.select.addEventListener("change", () => {
    if (paymentSelect.select.value) {
      const requestSequence = ++flowRequestSequence;
      loadPaymentFlow(paymentSelect.select.value, flowView, () => requestSequence === flowRequestSequence);
    }
  });
  viewControls.append(tableButton, flowButton, paymentSelect.label);
  $("#explorer-results").append(viewControls, tableView, flowView);
}

function setupFilteredEnquiry({ enquiry, title, buildArguments, fieldChoices, buttonLabel = "Run enquiry" }) {
  const controls = $("#explorer-controls");
  const form = node("form", "payments-enquiry-form");
  const filters = node("div", "payment-filter-list");
  const addButton = node("button", "button button-secondary", "Add filter");
  addButton.type = "button";
  const rowLimit = selectField("MAXIMUM ROWS", [
    { value: "500", label: "500" },
    { value: "1000", label: "1,000" },
    { value: "2500", label: "2,500" },
    { value: "5000", label: "5,000" },
  ]);
  rowLimit.select.value = "5000";
  const runButton = actionButton(buttonLabel);
  const actions = node("div", "payment-enquiry-actions");
  actions.append(addButton, rowLimit.label, runButton);

  function addFilter() {
    const row = node("div", "payment-filter-row");
    let field;
    if (fieldChoices) {
      field = selectField("FIELD", [
        { value: "", label: "Choose an AA.ARRANGEMENT field…" },
        ...fieldChoices.map((choice) => ({
          value: choice.name,
          label: `${choice.name}${choice.type ? ` — ${choice.type}` : ""}${choice.multi ? " (repeating)" : ""}`,
        })),
      ]);
      field.select.classList.add("payment-filter-name");
    } else {
      field = inputField("FIELD", "e.g. PAYMENT.STATUS");
      field.input.classList.add("payment-filter-name");
    }
    const operator = selectField("OPERATOR", PAYMENT_OPERATORS.map((value) => ({ value, label: value })));
    const value = inputField("VALUE", "Filter value; LK supports ...");
    value.input.classList.add("payment-filter-value");
    const remove = node("button", "payment-filter-remove", "Remove");
    remove.type = "button";
    remove.setAttribute("aria-label", "Remove payment filter");
    remove.addEventListener("click", () => row.remove());
    row.append(field.label, operator.label, value.label, remove);
    filters.append(row);
  }

  addButton.addEventListener("click", addFilter);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    let args;
    try {
      args = buildArguments([...filters.querySelectorAll(".payment-filter-row")].map((row) => {
        const selects = [...row.querySelectorAll("select")];
        const fieldControl = row.querySelector(".payment-filter-name");
        return {
          field: fieldControl.value,
          operator: selects[fieldChoices ? 1 : 0].value,
          value: row.querySelector(".payment-filter-value").value,
        };
      }), Number(rowLimit.select.value));
    } catch (error) {
      $("#explorer-status").textContent = error.message;
      $("#explorer-status").classList.add("error");
      return;
    }

    runButton.disabled = true;
    addButton.disabled = true;
    $("#explorer-status").classList.remove("error");
    try {
      await loadResult("ofs-enquiry", args, `${enquiry} · ${title}`);
    } catch {
      // loadResult has already rendered the request error.
    } finally {
      runButton.disabled = false;
      addButton.disabled = false;
    }
  });
  form.append(filters, actions);
  controls.replaceChildren(form);
  addFilter();
}

function setupCustomerLoansEnquiry() {
  $("#explorer-status").textContent = "Loading AA.ARRANGEMENT field list…";
  callTransactTool("app-fields", { application: "AA.ARRANGEMENT" }).then((result) => {
    const fieldRows = result?.fields || result?.coreFields || [];
    const fields = [...fieldRows, ...(result?.localFields || [])]
      .filter((field) => typeof field?.name === "string")
      .map((field) => ({
        name: field.name,
        type: field.type || "",
        multi: field.multi === true,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    if (!fields.length) throw new Error("Transact returned no AA.ARRANGEMENT fields.");
    $("#explorer-status").textContent = "Choose AA.ARRANGEMENT fields to filter customer loans.";
    setupFilteredEnquiry({
      enquiry: "AA.API.CUSTLOANS.1.2.0",
      title: "Customer Loans",
      buildArguments: buildCustomerLoansEnquiry,
      fieldChoices: fields,
      buttonLabel: "Find Customer Loans",
    });
  }).catch((error) => showError(error));
}

function setupEnquiries() {
  const controls = $("#explorer-controls");
  const search = inputField("FILTER ENQUIRIES", "Search by name, description, or source table");
  const browser = node("section", "enquiry-browser");
  controls.replaceChildren(search.label);
  $("#explorer-status").textContent = "Loading saved ENQUIRY records…";

  callTransactTool("ofs-enquiry", { enquiry: "%ENQUIRY", max_rows: MAX_ROWS }).then((result) => {
    const records = (result?.rows || []).map((row) => {
      const id = normalizeRecordId(rowId(row, result.columns || []));
      return {
        row,
        id,
        description: rowDescription(row, result.columns || []),
        source: rowValue(row, result.columns || [], "FILE.NAME", -1),
      };
    }).filter((record) => record.id);
    const sourceCache = new Map(records.filter((record) => record.source).map((record) => [record.id, record.source]));
    let page = 0;
    let renderSequence = 0;
    const pageStatus = node("span", "enquiry-page-status");
    const previous = node("button", "button button-secondary", "Previous");
    const next = node("button", "button button-secondary", "Next");
    const pageControls = node("div", "enquiry-page-controls");
    const tableContainer = node("div", "enquiry-list-scroll");
    pageControls.append(previous, pageStatus, next);
    browser.append(tableContainer, pageControls);
    $("#explorer-results").replaceChildren(browser);

    function filteredRecords() {
      const query = search.input.value.trim().toLowerCase();
      return records.filter(({ id, description, source }) =>
        !query || `${id} ${description} ${source || sourceCache.get(id) || ""}`.toLowerCase().includes(query));
    }

    async function resolveSources(visible, sequence) {
      const pending = visible.filter((record) => !sourceCache.has(record.id));
      let nextIndex = 0;
      const workers = Array.from({ length: Math.min(5, pending.length) }, async () => {
        while (nextIndex < pending.length) {
          const current = pending[nextIndex++];
          try {
            const result = await callTransactTool("ofs-read", { application: "ENQUIRY", id: current.id });
            sourceCache.set(current.id, getEnquirySourceTable(result) || "Not specified");
            current.description ||= getEnquiryDescription(result);
          } catch {
            sourceCache.set(current.id, "Unavailable");
          }
          if (sequence === renderSequence) renderTable(filteredRecords().slice(page * ENQUIRY_PAGE_SIZE, (page + 1) * ENQUIRY_PAGE_SIZE), sequence);
        }
      });
      await Promise.all(workers);
    }

    function renderTable(visible, sequence) {
      const table = node("table", "enquiry-directory-table");
      const head = node("thead");
      const headRow = node("tr");
      for (const label of ["Enquiry", "Description", "Source table", ""]) headRow.append(node("th", "", label));
      head.append(headRow);
      const body = node("tbody");
      for (const record of visible) {
        const row = node("tr");
        row.append(
          node("th", "enquiry-directory-id", record.id),
          node("td", "", record.description || "—"),
          node("td", "", record.source || sourceCache.get(record.id) || "Loading…"),
        );
        const actionCell = node("td");
        const run = node("button", "button button-primary", "Run Enquiry");
        run.type = "button";
        run.addEventListener("click", async () => {
          run.disabled = true;
          try {
            await loadResult("ofs-enquiry", { enquiry: record.id, max_rows: MAX_ROWS }, record.id);
          } catch {
            // loadResult renders the request error.
          } finally {
            run.disabled = false;
          }
        });
        actionCell.append(run);
        row.append(actionCell);
        body.append(row);
      }
      table.append(head, body);
      tableContainer.replaceChildren(table);
      if (sequence === renderSequence) {
        const count = filteredRecords().length;
        const pages = Math.max(1, Math.ceil(count / ENQUIRY_PAGE_SIZE));
        pageStatus.textContent = `${count.toLocaleString()} enquiries · Page ${page + 1} of ${pages}`;
        previous.disabled = page === 0;
        next.disabled = page + 1 >= pages;
        $("#explorer-status").textContent = `${records.length.toLocaleString()} enquiries loaded${result.truncated ? " (Transact result capped at 5,000)" : ""}.`;
      }
    }

    async function renderPage() {
      const sequence = ++renderSequence;
      const filtered = filteredRecords();
      const pageCount = Math.max(1, Math.ceil(filtered.length / ENQUIRY_PAGE_SIZE));
      page = Math.min(page, pageCount - 1);
      const visible = filtered.slice(page * ENQUIRY_PAGE_SIZE, (page + 1) * ENQUIRY_PAGE_SIZE);
      renderTable(visible, sequence);
      await resolveSources(visible, sequence);
    }

    previous.addEventListener("click", () => {
      page = Math.max(0, page - 1);
      renderPage();
    });
    next.addEventListener("click", () => {
      page += 1;
      renderPage();
    });
    search.input.addEventListener("input", () => {
      page = 0;
      renderPage();
    });
    renderPage();
  }).catch((error) => showError(error));
}

function setupEsonGenerator() {
  const form = node("form", "eson-generator-form");
  const recordList = node("div", "eson-record-list");
  const addButton = node("button", "button button-secondary", "Add record");
  addButton.type = "button";
  const generateButton = node("button", "button button-primary", "Generate ESON from live record");
  generateButton.type = "button";
  const referenceButton = node("button", "button button-secondary", "View reference ESON");
  referenceButton.type = "button";
  const note = node("p", "eson-generator-note",
    "Live reads use the company configured on the connected Transact MCP server. The entered company code is written to CO.CODE in the ESON output.");
  const actions = node("div", "eson-generator-actions");
  actions.append(addButton, referenceButton, generateButton);
  form.append(note, recordList, actions);
  $("#explorer-controls").replaceChildren(form);

  function addRecord(values = {}) {
    const row = node("div", "eson-record-row");
    const company = inputField("COMPANY ID", "e.g. AU0010001");
    const application = inputField("APPLICATION", "e.g. CUSTOMER");
    const id = inputField("RECORD ID", "Exact Transact record ID");
    company.input.value = values.company || "";
    application.input.value = values.application || "";
    id.input.value = values.id || "";
    const remove = node("button", "payment-filter-remove", "Remove");
    remove.type = "button";
    remove.addEventListener("click", () => {
      if (recordList.children.length > 1) row.remove();
      else {
        company.input.value = "";
        application.input.value = "";
        id.input.value = "";
      }
    });
    row.append(company.label, application.label, id.label, remove);
    recordList.append(row);
  }

  function collectRecords() {
    return [...recordList.querySelectorAll(".eson-record-row")].map((row) => ({
      company: row.querySelector(".explorer-field:nth-child(1) input").value.trim(),
      application: row.querySelector(".explorer-field:nth-child(2) input").value.trim(),
      id: row.querySelector(".explorer-field:nth-child(3) input").value.trim(),
    }));
  }

  function renderFiles(files, { references = false } = {}) {
    const results = $("#explorer-results");
    results.replaceChildren();
    if (!files.length) {
      results.append(node("p", "record-subtitle", "No matching reference ESON files were found in reference_eson."));
      return;
    }
    for (const file of files) {
      const card = node("details", "eson-file-card");
      const summary = node("summary", "eson-file-heading", `${file.application} > ${file.id} · ${file.filename}`);
      card.append(summary);
      const folder = node("p", "eson-file-folder", references
        ? `Reference folder: ${file.folder}`
        : `Saved file: ${file.path || `generated_esons/${file.filename}`}`);
      const pre = node("pre", "eson-file-content", file.content);
      card.append(folder, pre);
      if (!references) {
        const download = node("a", "button button-secondary", "Download ESON");
        download.href = URL.createObjectURL(new Blob([file.content], { type: "text/plain;charset=utf-8" }));
        download.download = file.filename;
        download.addEventListener("click", () => setTimeout(() => URL.revokeObjectURL(download.href), 60_000), { once: true });
        card.append(download);
      }
      results.append(card);
    }
  }

  addButton.addEventListener("click", () => addRecord());
  generateButton.addEventListener("click", async () => {
    generateButton.disabled = true;
    referenceButton.disabled = true;
    addButton.disabled = true;
    $("#explorer-status").classList.remove("error");
    $("#explorer-status").textContent = "Assistant is reading Transact records and preparing ESON…";
    try {
      const result = await generateEson(collectRecords());
      renderFiles(result.files || []);
      $("#explorer-status").textContent = `${(result.files || []).length} ESON file(s) generated. Download each file below.`;
    } catch (error) {
      showError(error);
    } finally {
      generateButton.disabled = false;
      referenceButton.disabled = false;
      addButton.disabled = false;
    }
  });
  referenceButton.addEventListener("click", async () => {
    generateButton.disabled = true;
    referenceButton.disabled = true;
    addButton.disabled = true;
    $("#explorer-status").classList.remove("error");
    $("#explorer-status").textContent = "Searching nested reference_eson folders…";
    try {
      const records = collectRecords();
      const files = (await Promise.all(records.map((record) => findReferenceEson(record))))
        .flatMap((result) => result.files || []);
      renderFiles(files, { references: true });
      $("#explorer-status").textContent = `${files.length} matching reference ESON file(s) found.`;
    } catch (error) {
      showError(error);
    } finally {
      generateButton.disabled = false;
      referenceButton.disabled = false;
      addButton.disabled = false;
    }
  });
  form.addEventListener("submit", (event) => event.preventDefault());
  addRecord();
}

async function setupSkillManager() {
  const controls = $("#explorer-controls");
  const uploadForm = node("form", "skill-upload-form");
  const name = inputField("SKILL FOLDER NAME", "e.g. my-transact-skill");
  const fileLabel = node("label", "explorer-field");
  fileLabel.append(node("span", "", "SKILL MARKDOWN FILE"));
  const file = node("input");
  file.type = "file";
  file.accept = ".md,text/markdown,text/plain";
  fileLabel.append(file);
  const upload = actionButton("Upload Skill");
  uploadForm.append(name.label, fileLabel, upload);
  const editor = node("section", "skill-editor");
  editor.hidden = true;
  const editorTitle = node("h2", "enquiry-title", "Skill editor");
  const editorPath = node("p", "record-subtitle");
  const editorText = node("textarea", "skill-editor-text");
  editorText.rows = 18;
  editorText.spellcheck = false;
  const editorActions = node("div", "skill-editor-actions");
  const save = node("button", "button button-primary", "Save changes");
  save.type = "button";
  const cancel = node("button", "button button-secondary", "Close editor");
  cancel.type = "button";
  editorActions.append(save, cancel);
  editor.append(editorTitle, editorPath, editorText, editorActions);
  controls.replaceChildren(uploadForm, editor);
  let editingPath = "";

  async function refreshSkills() {
    const result = await listSkills();
    const root = $("#explorer-results");
    root.replaceChildren();
    if (!result.skills.length) {
      root.append(node("p", "record-subtitle", "No Markdown skills were found under .claude/skills."));
      return;
    }
    for (const skill of result.skills) {
      const section = node("section", "skill-group");
      section.append(node("h2", "enquiry-title", skill.name));
      const list = node("div", "skill-file-list");
      for (const entry of skill.files) {
        const item = node("div", "skill-file-row");
        item.append(node("span", "", entry.path));
        const edit = node("button", "button button-secondary", "Edit in editor");
        edit.type = "button";
        edit.addEventListener("click", async () => {
          edit.disabled = true;
          try {
            const data = await readSkillFile(entry.path);
            editingPath = entry.path;
            editorPath.textContent = entry.path;
            editorText.value = data.content;
            editor.hidden = false;
            editorText.focus();
          } catch (error) {
            showError(error);
          } finally {
            edit.disabled = false;
          }
        });
        item.append(edit);
        list.append(item);
      }
      section.append(list);
      root.append(section);
    }
    $("#explorer-status").textContent = `${result.skills.length} skill folder(s) found under .claude/skills.`;
  }

  uploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const selected = file.files?.[0];
    if (!selected || !selected.name.toLowerCase().endsWith(".md")) {
      showError(new Error("Choose a Markdown (.md) skill file to upload."));
      return;
    }
    upload.disabled = true;
    try {
      await uploadSkill(name.input.value, await selected.text());
      name.input.value = "";
      file.value = "";
      editor.hidden = true;
      await refreshSkills();
      $("#explorer-status").textContent = "Skill uploaded to .claude/skills.";
    } catch (error) {
      showError(error);
    } finally {
      upload.disabled = false;
    }
  });
  save.addEventListener("click", async () => {
    if (!editingPath) return;
    save.disabled = true;
    try {
      await saveSkill(editingPath, editorText.value);
      $("#explorer-status").textContent = `Saved ${editingPath}.`;
    } catch (error) {
      showError(error);
    } finally {
      save.disabled = false;
    }
  });
  cancel.addEventListener("click", () => {
    editor.hidden = true;
    editingPath = "";
  });

  $("#explorer-status").textContent = "Loading local Copilot skills…";
  try {
    await refreshSkills();
  } catch (error) {
    showError(error);
  }
}

async function loadProductHierarchy() {
  const lines = await loadResult("ofs-enquiry", { enquiry: "%AA.PRODUCT.LINE", max_rows: MAX_ROWS }, "Available product lines");
  const lineSelect = selectField("PRODUCT LINE", [{ value: "", label: "Choose a product line…" }]);
  const groupSelect = selectField("PRODUCT GROUP", [{ value: "", label: "Choose a product group…" }]);
  const productSelect = selectField("PRODUCT", [{ value: "", label: "Choose a product…" }]);
  groupSelect.select.disabled = true;
  productSelect.select.disabled = true;
  const viewButton = node("button", "button button-secondary", "View product record");
  viewButton.type = "button";
  viewButton.disabled = true;
  const form = node("div", "explorer-form product-browser");
  form.append(lineSelect.label, groupSelect.label, productSelect.label, viewButton);
  $("#explorer-controls").append(form);

  function fillSelect(select, result, idField) {
    select.replaceChildren(node("option", "", "Choose…"));
    select.firstElementChild.value = "";
    for (const row of result.rows || []) {
      const id = rowId(row, result.columns || []);
      if (!id) continue;
      const description = rowDescription(row, result.columns || []);
      const option = node("option", "", description ? `${id} — ${description}` : id);
      option.value = id;
      select.append(option);
    }
    select.disabled = select.options.length <= 1;
    select.dataset.field = idField;
  }

  fillSelect(lineSelect.select, lines, "@ID");
  lineSelect.select.addEventListener("change", async () => {
    groupSelect.select.replaceChildren(node("option", "", "Choose a product group…"));
    groupSelect.select.disabled = true;
    productSelect.select.replaceChildren(node("option", "", "Choose a product…"));
    productSelect.select.disabled = true;
    viewButton.disabled = true;
    if (!lineSelect.select.value) return;
    try {
      const response = await callTransactTool("ofs-enquiry", {
        enquiry: "%AA.PRODUCT.GROUP",
        selection: [{ field: "PRODUCT.LINE", operator: "EQ", value: lineSelect.select.value }],
        max_rows: MAX_ROWS,
      });
      const groups = normalizeRecordIds(response);
      showResult(groups, `Product groups in line · ${lineSelect.select.value}`);
      fillSelect(groupSelect.select, groups, "@ID");
      $("#explorer-status").textContent = "Choose a product group.";
    } catch (error) {
      showError(error);
    }
  });
  groupSelect.select.addEventListener("change", async () => {
    productSelect.select.replaceChildren(node("option", "", "Choose a product…"));
    productSelect.select.disabled = true;
    viewButton.disabled = true;
    if (!groupSelect.select.value) return;
    try {
      const response = await callTransactTool("ofs-enquiry", {
        enquiry: "%AA.PRODUCT",
        selection: [{ field: "PRODUCT.GROUP", operator: "EQ", value: groupSelect.select.value }],
        max_rows: MAX_ROWS,
      });
      const products = normalizeRecordIds(response);
      showResult(products, `Products in group · ${groupSelect.select.value}`);
      fillSelect(productSelect.select, products, "@ID");
      $("#explorer-status").textContent = "Choose a product to view its record.";
    } catch (error) {
      showError(error);
    }
  });
  productSelect.select.addEventListener("change", () => {
    viewButton.disabled = !productSelect.select.value;
  });
  viewButton.addEventListener("click", async () => {
    if (!productSelect.select.value) return;
    try {
      await loadResult("ofs-read", {
        application: "AA.PRODUCT",
        id: productSelect.select.value,
      }, `AA.PRODUCT · ${productSelect.select.value}`);
    } catch {
      // loadResult has already rendered the request error.
    }
  });
}

function setTitle(page) {
  $("#explorer-crumb").textContent = page.group.toUpperCase();
  $("#explorer-title").textContent = page.title;
  $("#explorer-description").textContent = page.description;
  $("#explorer-status").textContent = "";
  $("#explorer-status").classList.remove("error");
  $("#explorer-controls").replaceChildren();
  clearResults();
}

export function initializeMenus({ onOpen } = {}) {
  document.querySelectorAll("[data-menu-page]").forEach((button) => {
    button.addEventListener("click", async () => {
      const page = PAGES[button.dataset.menuPage];
      if (!page) return;
      onOpen?.();
      document.querySelectorAll(".nav-item.active").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".nav-subitem").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      setTitle(page);
      $("#explorer-view").hidden = false;
      if (button.dataset.menuPage === "find-customer") setupCustomer();
      else if (button.dataset.menuPage === "find-account") setupAccount();
      else if (button.dataset.menuPage === "find-arrangement") setupArrangement();
      else if (button.dataset.menuPage === "payments-enquiry") setupPaymentsEnquiry();
      else if (button.dataset.menuPage === "customer-loans") setupCustomerLoansEnquiry();
      else if (button.dataset.menuPage === "enquiries") setupEnquiries();
      else if (button.dataset.menuPage === "generate-eson") setupEsonGenerator();
      else if (button.dataset.menuPage === "manage-skills") await setupSkillManager();
      else if (button.dataset.menuPage === "configure-products") {
        try {
          await loadProductHierarchy();
        } catch {
          // loadResult has already rendered the request error.
        }
      } else if (button.dataset.menuPage === "customer-versions") {
        try {
          await loadResult("ofs-enquiry", {
            enquiry: "%VERSION",
            selection: [{ field: "APPLICATION", operator: "EQ", value: "CUSTOMER" }],
            max_rows: MAX_ROWS,
          }, "VERSION records for CUSTOMER");
        } catch {
          // loadResult has already rendered the request error.
        }
      } else if (button.dataset.menuPage === "locked-records") {
        try {
          await loadResult("ofs-enquiry", { enquiry: "CRL", max_rows: MAX_ROWS }, "CRL · Locked records");
        } catch {
          // loadResult has already rendered the request error.
        }
      } else if (button.dataset.menuPage === "manage-tsa-service") {
        try {
          await loadResult("ofs-enquiry", { enquiry: "%TSA.SERVICE", max_rows: MAX_ROWS }, "TSA.SERVICE records");
        } catch {
          // loadResult has already rendered the request error.
        }
      }
    });
  });
}
