import { authoriseRecord, callTransactTool } from "./api.js";
import { renderData, renderError } from "./record-view.js";

const $ = (selector) => document.querySelector(selector);
let active = false;
let currentReview = null;
let reviewSequence = 0;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function recordFields(record) {
  return record?.record?.fields || record?.fields || [];
}

function fieldKey(field) {
  return `${field.name}:${field.mv ?? 1}:${field.sv ?? 1}`;
}

function fieldMap(record) {
  return new Map(recordFields(record).map((field) => [fieldKey(field), String(field.value ?? "")]));
}

export function compareRecordFields(unauthorised, live) {
  const unauthorisedFields = fieldMap(unauthorised);
  const liveFields = fieldMap(live);
  return [...new Set([...unauthorisedFields.keys(), ...liveFields.keys()])]
    .sort()
    .map((key) => {
      const unauthorisedValue = unauthorisedFields.get(key) ?? "";
      const liveValue = liveFields.get(key) ?? "";
      return {
        field: key,
        unauthorised: unauthorisedValue,
        live: liveValue,
        changed: unauthorisedValue !== liveValue,
      };
    });
}

export function assertLiveRecord(record) {
  if (record?.state !== "live") {
    const errors = Array.isArray(record?.errors) ? record.errors : [];
    const details = errors.map((entry) => {
      if (typeof entry === "string") return entry;
      return entry?.message || entry?.description || entry?.code || JSON.stringify(entry);
    }).join("; ");
    throw new Error(
      `The live record could not be confirmed${record?.state ? ` (Transact state: ${record.state})` : ""}.${details ? ` ${details}` : ""}`,
    );
  }
  if (!recordFields(record).length) {
    throw new Error("Transact returned a live-state response without record fields.");
  }
  return record;
}

function showStatus(message, isError = false) {
  const status = $("#authorise-status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function showRecord(data, application, id, container) {
  container.replaceChildren();
  renderData({ ...data, application, id }, container);
}

function renderComparison(unauthorised, live, container) {
  container.replaceChildren();
  if (!live) {
    container.append(node("p", "record-subtitle", "No live version was found; all unauthorised fields are shown as additions."));
  }
  const rows = compareRecordFields(unauthorised, live);
  const table = node("table", "authorise-diff-table");
  const head = node("thead");
  const headRow = node("tr");
  for (const label of ["Field", "Unauthorised", "Live", "Difference"]) {
    headRow.append(node("th", "", label));
  }
  head.append(headRow);
  const body = node("tbody");
  for (const row of rows) {
    const tableRow = node("tr", row.changed ? "is-changed" : "");
    tableRow.append(
      node("th", "", row.field),
      node("td", "", row.unauthorised),
      node("td", "", row.live),
      node("td", row.changed ? "diff-changed" : "diff-same", row.changed ? "Changed" : "Same"),
    );
    body.append(tableRow);
  }
  table.append(head, body);
  container.append(table);
}

export function unauthorisedRowId(row, columns = []) {
  if (typeof row?.id === "string") return row.id;
  if (typeof row?.recordId === "string") return row.recordId;
  if (typeof row?.["@ID"] === "string") return row["@ID"];
  const identifierIndex = columns.findIndex((column) =>
    ["@ID", "ID"].includes(String(column.identifier || column.name || column.label || column).toUpperCase()));
  const cells = Array.isArray(row?.cells) ? row.cells : Array.isArray(row) ? row : [];
  const value = cells[identifierIndex >= 0 ? identifierIndex : 0];
  return value === undefined || value === null ? "" : String(value);
}

async function reviewRecord(application, id) {
  const sequence = ++reviewSequence;
  currentReview = { application, id };
  const review = $("#authorise-review");
  review.hidden = false;
  review.replaceChildren(node("p", "", `Reading ${application} · ${id} in unauthorised state…`));
  $("#authorise-record-button").disabled = true;
  try {
    const record = await callTransactTool("ofs-read", { application, id, state: "unauthorised" });
    if (sequence !== reviewSequence) return;
    const header = node("div", "authorise-review-header");
    header.append(node("h2", "", `${application} · ${id}`));
    const authoriseButton = node("button", "button button-primary", "Authorise");
    authoriseButton.type = "button";
    authoriseButton.addEventListener("click", async () => {
      if (!window.confirm(`Authorise ${application} record "${id}"? This will approve the unauthorised record in Transact.`)) return;
      authoriseButton.disabled = true;
      showStatus(`Authorising ${application} · ${id}…`);
      try {
        const result = await authoriseRecord(application, id);
        if (result?.state !== "live" || (Array.isArray(result.errors) && result.errors.length)) {
          const errors = Array.isArray(result?.errors) ? result.errors.map((entry) => {
            if (typeof entry === "string") return entry;
            return entry?.message || entry?.description || entry?.code || JSON.stringify(entry);
          }).join("; ") : "";
          throw new Error(
            `Transact did not confirm authorisation${result?.state ? ` (state: ${result.state})` : ""}.${errors ? ` ${errors}` : ""}`,
          );
        }
        showStatus(`${application} · ${id} was authorised and is now live.`);
        authoriseButton.textContent = "Authorised";
      } catch (error) {
        showStatus(error.message, true);
        authoriseButton.disabled = false;
      }
    });
    header.append(authoriseButton);
    const compareButton = node("button", "button button-secondary", "Compare With Live");
    compareButton.type = "button";
    const comparison = node("section", "authorise-comparison");
    comparison.hidden = true;
    compareButton.addEventListener("click", async () => {
      if (!comparison.hidden) {
        comparison.hidden = true;
        compareButton.textContent = "Compare With Live";
        return;
      }
      comparison.hidden = false;
      compareButton.textContent = "Hide Comparison";
      comparison.replaceChildren(node("p", "", `Reading live ${application} · ${id}…`));
      try {
        const live = assertLiveRecord(await callTransactTool("ofs-read", { application, id }));
        if (sequence !== reviewSequence) return;
        renderComparison(record, live, comparison);
      } catch (error) {
        if (sequence !== reviewSequence) return;
        comparison.replaceChildren();
        renderError(`Could not compare with the live record: ${error.message}`, comparison);
      }
    });
    const controls = node("div", "authorise-review-controls");
    controls.append(compareButton);
    const recordView = node("div", "authorise-record-view scroll_contract_screen");
    showRecord(record, application, id, recordView);
    review.replaceChildren(header, controls, comparison, recordView);
    showStatus(`Review the unauthorised ${application} record before authorising it.`);
  } catch (error) {
    if (sequence !== reviewSequence) return;
    review.replaceChildren();
    renderError(error.message, review);
    showStatus("The unauthorised record could not be loaded.", true);
  } finally {
    if (sequence === reviewSequence) $("#authorise-record-button").disabled = false;
  }
}

function appendListResult(result, application) {
  const results = $("#authorise-results");
  results.replaceChildren();
  const rows = Array.isArray(result.rows) ? result.rows : [];
  if (!rows.length) {
    results.append(node("p", "record-subtitle", "No unauthorised records were returned."));
    return;
  }
  const columns = result.columns || [];
  const table = node("table", "enquiry-table");
  const head = node("thead");
  const headRow = node("tr");
  for (const column of columns) {
    headRow.append(node("th", "", column.label || column.identifier || column));
  }
  headRow.append(node("th", "", "Action"));
  head.append(headRow);
  const body = node("tbody");
  for (const row of rows) {
    const tableRow = node("tr");
    const cells = Array.isArray(row?.cells) ? row.cells : Array.isArray(row) ? row : Object.values(row || {});
    for (const cell of cells) tableRow.append(node("td", "", cell === null || cell === undefined ? "" : String(cell)));
    const id = unauthorisedRowId(row, columns);
    const action = node("td");
    const reviewButton = node("button", "button button-secondary", "Review & Authorise");
    reviewButton.type = "button";
    reviewButton.disabled = !id;
    reviewButton.addEventListener("click", () => reviewRecord(application, id));
    action.append(reviewButton);
    tableRow.append(action);
    body.append(tableRow);
  }
  table.append(head, body);
  results.append(table);
}

function validateApplication(value) {
  const application = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.]*$/.test(application)) {
    throw new Error("Enter a valid Transact application name.");
  }
  return application;
}

async function listUnauthorisedRecords() {
  let application;
  try {
    application = validateApplication($("#authorise-application").value);
  } catch (error) {
    showStatus(error.message, true);
    return;
  }
  const button = $("#list-unauthorised-records");
  button.disabled = true;
  showStatus(`Listing ${application}$NAU records…`);
  $("#authorise-review").hidden = true;
  try {
    const result = await callTransactTool("ofs-enquiry", {
      enquiry: `%${application}$NAU`,
      max_rows: 5000,
    });
    appendListResult(result, application);
    showStatus(`${(result.rows || []).length.toLocaleString()} unauthorised ${application} record(s) returned.`);
  } catch (error) {
    $("#authorise-results").replaceChildren();
    renderError(error.message, $("#authorise-results"));
    showStatus("Could not list unauthorised records.", true);
  } finally {
    button.disabled = false;
  }
}

async function reviewFromInputs() {
  let application;
  try {
    application = validateApplication($("#authorise-application").value);
  } catch (error) {
    showStatus(error.message, true);
    return;
  }
  const id = $("#authorise-record-id").value.trim();
  if (!id) {
    showStatus("Enter a record ID to review.", true);
    $("#authorise-record-id").focus();
    return;
  }
  await reviewRecord(application, id);
}

export function isAuthorisationMode() {
  return active;
}

export function setAuthorisationMode(enabled) {
  active = enabled;
  $("#authorise-record-view").hidden = !enabled;
  $("#toggle-authorise-record").setAttribute("aria-pressed", String(enabled));
  $("#toggle-authorise-record").classList.toggle("is-selected", enabled);
}

export function initializeAuthorisation({ onEnter, onExit } = {}) {
  $("#toggle-authorise-record").addEventListener("click", () => {
    const enabled = !active;
    if (enabled) onEnter?.();
    else onExit?.();
    setAuthorisationMode(enabled);
  });
  $("#list-unauthorised-records").addEventListener("click", listUnauthorisedRecords);
  $("#authorise-record-button").addEventListener("click", reviewFromInputs);
  $("#authorise-record-id").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      reviewFromInputs();
    }
  });
}
