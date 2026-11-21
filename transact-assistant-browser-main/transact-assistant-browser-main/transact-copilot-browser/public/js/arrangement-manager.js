import { authoriseRecord, callTransactTool, runAAActivity } from "./api.js";

const $ = (selector) => document.querySelector(selector);
const MAX_ACTIVITY_HISTORY = 50;
const NON_INPUT_FIELDS = new Set([
  "@ID", "RECORD.STATUS", "CURR.NO", "INPUTTER", "DATE.TIME", "AUTHORISER",
  "CO.CODE", "DEPT.CODE", "AUDITOR.CODE", "AUDIT.DATE.TIME",
]);
let workspace = null;
let pendingActivityCheckFailed = false;
let currentActivity = null;
let simulatedSignature = "";
let loading = false;

function node(tag, className = "", text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function recordFields(record) {
  return record?.record?.fields || record?.fields || [];
}

function fieldValues(record, name) {
  return recordFields(record)
    .filter((field) => field?.name === name && field.value !== undefined && field.value !== null && String(field.value) !== "")
    .sort((left, right) => (left.mv || 1) - (right.mv || 1) || (left.sv || 1) - (right.sv || 1))
    .map((field) => String(field.value));
}

function fieldValue(record, name) {
  return fieldValues(record, name)[0] || "";
}

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

export function collectProductConditions(summary) {
  const found = [];
  const seen = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const property = firstString(value.property, value.name, value.PROPERTY);
    const pointer = firstString(value.pcPrdPr, value.pc_prd_pr, value.pointer, value.PC?.PRD?.PR, value["PC.PRD.PR"]);
    if (property && pointer.includes("*")) {
      const [conditionClass, conditionName] = pointer.split("*", 2);
      const key = `${property}|${pointer}`;
      if (!seen.has(key)) {
        seen.add(key);
        found.push({ property, pointer, conditionClass, conditionName });
      }
    }
    Object.values(value).forEach(visit);
  };
  visit(summary);
  return found;
}

export function enquiryIds(result) {
  const columns = result?.columns || [];
  const idIndex = columns.findIndex((column) =>
    ["@ID", "ID"].includes(String(column?.identifier || column?.name || column?.label || column).toUpperCase()));
  return (result?.rows || []).map((row) => {
    if (typeof row?.id === "string") return row.id;
    if (typeof row?.recordId === "string") return row.recordId;
    if (row && !Array.isArray(row) && !Array.isArray(row.cells)) {
      const idEntry = Object.entries(row).find(([key]) => ["@ID", "ID"].includes(key.toUpperCase()));
      if (idEntry) return String(idEntry[1] ?? "");
    }
    const cells = Array.isArray(row?.cells) ? row.cells : Array.isArray(row) ? row : [];
    return String(cells[idIndex >= 0 ? idIndex : 0] ?? "");
  }).filter(Boolean);
}

function enquiryRowValue(row, columns, names) {
  const wanted = new Set(names.map((name) => name.toUpperCase()));
  if (row && !Array.isArray(row) && !Array.isArray(row.cells)) {
    const entry = Object.entries(row).find(([key]) => wanted.has(key.toUpperCase()));
    if (entry) return String(entry[1] ?? "");
  }
  const columnIndex = columns.findIndex((column) =>
    wanted.has(String(column?.identifier || column?.name || column?.label || column).toUpperCase()));
  const cells = Array.isArray(row?.cells) ? row.cells : Array.isArray(row) ? row : [];
  const fallbackIndex = wanted.has("@ID") || wanted.has("ID") ? 0 : -1;
  return String(cells[columnIndex >= 0 ? columnIndex : fallbackIndex] ?? "");
}

export function userInputClasses(activityClass) {
  const propertyClasses = new Map(recordFields(activityClass)
    .filter((field) => field?.name === "PROPERTY.CLASS")
    .map((field) => [field.mv || 1, String(field.value || "")]));
  const userInputPositions = new Set(recordFields(activityClass)
    .filter((field) => field?.name === "USER.INPUT" && String(field.value).toUpperCase() === "YES")
    .map((field) => field.mv || 1));
  return [...userInputPositions].map((position) => propertyClasses.get(position)).filter(Boolean);
}

export function activityInputFields(catalog) {
  const fields = [...(catalog?.coreFields || []), ...(catalog?.localFields || [])];
  return fields.filter((field) => field?.name && !field.readOnly && field.multi !== true
    && !NON_INPUT_FIELDS.has(field.name));
}

export function unsupportedRepeatingFieldCount(catalog) {
  return [...(catalog?.coreFields || []), ...(catalog?.localFields || [])]
    .filter((field) => field?.name && field.multi === true && !field.readOnly
      && !NON_INPUT_FIELDS.has(field.name)).length;
}

export function arrangementFieldPrefill(record, fieldName) {
  const matches = recordFields(record).filter((field) => field?.name === fieldName
    && field.value !== undefined && field.value !== null && String(field.value) !== "");
  return matches.length === 1 && (matches[0].mv === undefined || matches[0].mv === 1)
    && (matches[0].sv === undefined || matches[0].sv === 1)
    ? String(matches[0].value)
    : "";
}

export function formatActivityFeedback(result, conditions, simulate) {
  const lines = [
    `Request: ${simulate ? "simulation (not committed)" : "activity submission"}`,
    "Submitted values:",
  ];
  const submitted = Object.entries(conditions || {}).flatMap(([property, fields]) =>
    Object.entries(fields || {}).map(([field, value]) => `  ${property}.${field} = ${JSON.stringify(value)}`));
  lines.push(...(submitted.length ? submitted : ["  No condition values were submitted."]));
  lines.push("Transact response:");
  if (result?.state) lines.push(`  State: ${result.state}`);
  if (result?.activityId) lines.push(`  Activity ID: ${result.activityId}`);
  if (typeof result?.applied === "boolean") {
    lines.push(`  Applied: ${result.applied ? "yes" : "no"}`);
  } else if (simulate) {
    lines.push("  Applied: no (simulation)");
  }
  if (result?.pendingAuthorisation) lines.push("  Pending authorisation: the arrangement has not changed yet.");
  const changed = Array.isArray(result?.changed) ? result.changed : [];
  lines.push(`  Changes reported: ${changed.length ? changed.map((entry) => typeof entry === "string" ? entry : JSON.stringify(entry)).join(", ") : "none"}`);
  for (const warning of result?.warnings || []) {
    lines.push(`  Warning: ${typeof warning === "string" ? warning : JSON.stringify(warning)}`);
  }
  for (const error of result?.errors || []) {
    lines.push(`  Error: ${typeof error === "string" ? error : error?.message || JSON.stringify(error)}`);
  }
  return lines.join("\n");
}

async function mapLimit(values, limit, callback) {
  const output = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      output[index] = await callback(values[index], index);
    }
  }));
  return output;
}

function setStatus(message, kind = "") {
  const status = $("#arrangement-manager-status");
  status.textContent = message;
  status.className = `arrangement-manager-status${kind ? ` ${kind}` : ""}`;
}

function renderArrangementSummary(arrangement) {
  const summary = $("#arrangement-summary");
  summary.replaceChildren();
  const fields = [
    ["Arrangement", arrangement.id],
    ["Customer", arrangement.customer],
    ["Product", arrangement.product],
    ["Product Line", arrangement.productLine],
    ["Currency", arrangement.currency],
    ["Status", arrangement.status],
  ].filter(([, value]) => value);
  for (const [label, value] of fields) {
    const item = node("div", "arrangement-summary-item");
    item.append(node("span", "", label), node("strong", "", value));
    summary.append(item);
  }
  summary.hidden = false;
}

function renderArrangementList(result) {
  const container = $("#arrangement-list");
  container.replaceChildren();
  const rows = result?.rows || [];
  if (!rows.length) {
    container.append(node("p", "arrangement-empty", "No arrangements were returned for company AU0010001."));
    container.hidden = false;
    return;
  }
  const columns = result.columns || [];
  const entries = rows.map((row) => ({
    id: enquiryRowValue(row, columns, ["@ID", "ID"]),
    customer: enquiryRowValue(row, columns, ["CUSTOMER"]),
    product: enquiryRowValue(row, columns, ["ACTIVE.PRODUCT", "PRODUCT"]),
    status: enquiryRowValue(row, columns, ["ARR.STATUS", "RECORD.STATUS"]),
  })).filter((row) => row.id);
  if (!entries.length) {
    container.append(node("p", "arrangement-inline-warning", "Transact returned rows, but no arrangement IDs could be identified from the result. Check the enquiry's ID column."));
    container.hidden = false;
    return;
  }
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  let page = 0;
  const table = node("table", "arrangement-history-table arrangement-list-table");
  const head = node("thead");
  const header = node("tr");
  for (const label of ["Arrangement ID", "Customer", "Product", "Status", "Action"]) {
    header.append(node("th", "", label));
  }
  head.append(header);
  const body = node("tbody");
  const pagination = node("div", "arrangement-list-pagination");
  const previous = node("button", "button button-secondary", "Previous");
  previous.type = "button";
  const summary = node("span");
  const next = node("button", "button button-secondary", "Next");
  next.type = "button";
  const displayPage = () => {
    body.replaceChildren();
    const start = page * pageSize;
    for (const entry of entries.slice(start, start + pageSize)) {
      const row = node("tr");
      row.append(
        node("td", "arrangement-activity-id", entry.id),
        node("td", "", entry.customer || "—"),
        node("td", "", entry.product || "—"),
        node("td", "", entry.status || "—"),
      );
      const actionCell = node("td");
      const manage = node("button", "button button-secondary", "Manage arrangement");
      manage.type = "button";
      manage.addEventListener("click", () => {
        $("#arrangement-id-input").value = entry.id;
        container.hidden = true;
        loadArrangement(entry.id);
      });
      actionCell.append(manage);
      row.append(actionCell);
      body.append(row);
    }
    summary.textContent = `Showing ${entries.length ? start + 1 : 0}–${Math.min(start + pageSize, entries.length)} of ${entries.length.toLocaleString()} · Page ${page + 1} of ${pageCount}`;
    previous.disabled = page === 0;
    next.disabled = page + 1 >= pageCount;
  };
  previous.addEventListener("click", () => { if (page > 0) { page -= 1; displayPage(); } });
  next.addEventListener("click", () => { if (page + 1 < pageCount) { page += 1; displayPage(); } });
  pagination.append(previous, summary, next);
  displayPage();
  table.append(head, body);
  container.append(table, pagination);
  if (result.truncated) {
    container.append(node("p", "arrangement-inline-warning", `Transact capped this list at ${rows.length.toLocaleString()} rows. The displayed records are only the first returned arrangements for AU0010001.`));
  }
  container.hidden = false;
}

async function listArrangements(button) {
  const container = $("#arrangement-list");
  button.disabled = true;
  container.replaceChildren(node("p", "arrangement-empty", "Loading arrangements for AU0010001…"));
  container.hidden = false;
  setStatus("Listing arrangements for company AU0010001…");
  try {
    const result = await callTransactTool("ofs-enquiry", {
      enquiry: "%AA.ARRANGEMENT",
      selection: [{ field: "CO.CODE", operator: "EQ", value: "AU0010001" }],
      max_rows: 5000,
    });
    renderArrangementList(result);
    const count = (result?.rows || []).length;
    setStatus(`${count.toLocaleString()} arrangement(s) returned for AU0010001${result?.truncated ? "; results were capped by Transact." : "."}`, result?.truncated ? "warning" : "success");
  } catch (error) {
    container.replaceChildren(node("p", "arrangement-inline-error", error.message));
    setStatus(`Could not list arrangements: ${error.message}`, "error");
  } finally {
    button.disabled = false;
  }
}

function localDateValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function makeArrangement(result, requestedId) {
  const record = result?.record || result;
  return {
    id: firstString(result?.id, record?.id, requestedId),
    product: firstString(
      typeof result?.product === "string" ? result.product : result?.product?.id,
      fieldValue(record, "ACTIVE.PRODUCT"),
      fieldValue(record, "PRODUCT"),
    ),
    productLine: firstString(
      result?.productLine,
      fieldValue(record, "PRODUCT.LINE"),
      fieldValue(record, "EPP.PRODUCT.LINE"),
    ),
    customer: firstString(result?.customerId, fieldValue(record, "CUSTOMER")),
    currency: firstString(result?.currency, fieldValue(record, "CURRENCY")),
    status: firstString(fieldValue(record, "ARR.STATUS"), fieldValue(record, "RECORD.STATUS")),
    record,
  };
}

async function discoverActivities(arrangement, conditions) {
  if (!arrangement.productLine) {
    return { activities: [], note: "The arrangement record does not expose PRODUCT.LINE; Transact activity choices cannot be resolved safely." };
  }
  if (!conditions.length) {
    return { activities: [], note: "The product summary did not return product conditions to match against user-input activity classes." };
  }

  const classCatalog = await callTransactTool("ofs-enquiry", {
    enquiry: "%AA.ACTIVITY.CLASS",
    selection: [
      { field: "PRODUCT.LINE", operator: "EQ", value: arrangement.productLine },
      { field: "ACTIVITY.TYPE", operator: "EQ", value: "USER" },
    ],
    max_rows: 500,
  });
  const classIds = enquiryIds(classCatalog);
  const classRecords = await mapLimit(classIds, 8, async (id) => {
    try {
      return await callTransactTool("ofs-read", { application: "AA.ACTIVITY.CLASS", id });
    } catch (error) {
      return { id, readError: error.message };
    }
  });
  const classReadErrors = classRecords.filter((item) => item?.readError);

  const processConditions = new Map();
  for (const activityClass of classRecords.filter((item) => item?.state === "live")) {
    const process = fieldValue(activityClass, "PROCESS.ID");
    if (!process) continue;
    const acceptedClasses = new Set(userInputClasses(activityClass).map((value) => value.toUpperCase()));
    const eligibleConditions = conditions.filter((condition) => acceptedClasses.has(condition.conditionClass.toUpperCase()));
    if (!eligibleConditions.length) continue;
    const key = `${process.toUpperCase()}`;
    if (!processConditions.has(key)) processConditions.set(key, { process, classes: new Map() });
    const entry = processConditions.get(key);
    const classId = fieldValue(activityClass, "CLASS.ID");
    const description = fieldValues(activityClass, "DESCRIPTION").join(" · ") || fieldValue(activityClass, "FULL.DESC");
    for (const condition of eligibleConditions) {
      const conditionKey = `${condition.property}|${condition.conditionClass}`;
      if (!entry.classes.has(conditionKey)) entry.classes.set(conditionKey, { condition, classId, description });
    }
  }

  const lookups = [];
  for (const { process, classes } of processConditions.values()) {
    for (const mapping of classes.values()) {
      lookups.push({ process, ...mapping });
    }
  }
  const candidateLists = await mapLimit(lookups, 8, async (lookup) => {
    try {
      const result = await callTransactTool("ofs-enquiry", {
        enquiry: "%AA.ACTIVITY",
        selection: [
          { field: "PRODUCT.LINE", operator: "EQ", value: arrangement.productLine },
          { field: "PROCESS.ID", operator: "EQ", value: lookup.process },
          { field: "PROPERTY", operator: "EQ", value: lookup.condition.property },
        ],
        max_rows: 25,
      });
      return { candidates: enquiryIds(result).map((id) => ({ id, ...lookup })) };
    } catch (error) {
      return { candidates: [], error: error.message };
    }
  });
  const candidates = candidateLists.flatMap((item) => item.candidates);
  const activityLookupErrors = candidateLists.filter((item) => item.error);
  const uniqueCandidates = [...new Map(candidates.map((candidate) =>
    [`${candidate.id}|${candidate.condition.property}`, candidate])).values()];
  const activityRecords = await mapLimit(uniqueCandidates, 8, async (candidate) => {
    try {
      const record = await callTransactTool("ofs-read", { application: "AA.ACTIVITY", id: candidate.id });
      if (record?.state !== "live" || fieldValue(record, "SYSTEM.ACTIVITY").toUpperCase() === "YES") return null;
      if (fieldValue(record, "PROPERTY").toUpperCase() !== candidate.condition.property.toUpperCase()) return null;
      return {
        id: candidate.id,
        property: candidate.condition.property,
        process: fieldValue(record, "PROCESS.ID") || candidate.process,
        description: fieldValues(record, "DESCRIPTION").join(" · ")
          || fieldValues(record, "FULL.DESC").join(" · ")
          || candidate.description
          || candidate.id,
        classDescription: candidate.description,
        condition: candidate.condition,
        conditions: [candidate.condition],
        classId: candidate.classId,
      };
    } catch (error) {
      return { id: candidate.id, readError: error.message };
    }
  });
  const activityReadErrors = activityRecords.filter((item) => item?.readError);
  const activities = activityRecords.filter((item) => item && !item.readError);
  const notes = [];
  if (classCatalog?.truncated) {
    notes.push(`Transact returned only the first ${classIds.length} user activity classes; refine the product line catalog if expected activities are missing.`);
  }
  if (classReadErrors.length) {
    notes.push(`${classReadErrors.length} activity class record(s) could not be read; the available list may be incomplete.`);
  }
  if (activityLookupErrors.length) {
    notes.push(`${activityLookupErrors.length} activity enquiry/enquiries failed; the available list may be incomplete.`);
  }
  if (activityReadErrors.length) {
    notes.push(`${activityReadErrors.length} executable activity record(s) could not be read; the available list may be incomplete.`);
  }
  return {
    activities,
    note: [
      activities.length
        ? ""
        : `No user activities were found for ${arrangement.productLine} that accept the conditions configured on ${arrangement.product}.`,
      ...notes,
    ].filter(Boolean).join(" "),
  };
}

function activityRowId(result) {
  return firstString(result?.id, result?.record?.id, fieldValue(result, "@ID"));
}

function renderHistory(entries, truncated, warnings = []) {
  const container = $("#arrangement-history-list");
  container.replaceChildren();
  if (warnings.length) {
    const warning = node("p", "arrangement-inline-warning", warnings.join(" "));
    container.append(warning);
  }
  if (!entries.length) {
    container.append(node("p", "arrangement-empty", "No activities were found for this arrangement."));
    return;
  }
  const table = node("table", "arrangement-history-table");
  const header = node("thead");
  const headerRow = node("tr");
  for (const label of ["Activity ID", "Activity", "Effective Date", "State"]) headerRow.append(node("th", "", label));
  header.append(headerRow);
  const body = node("tbody");
  for (const entry of entries) {
    const row = node("tr");
    const identifier = activityRowId(entry.record) || entry.id;
    row.append(
      node("td", "arrangement-activity-id", identifier),
      node("td", "", fieldValue(entry.record, "ACTIVITY") || "—"),
      node("td", "", fieldValue(entry.record, "EFFECTIVE.DATE") || "—"),
      node("td", "", entry.pending ? "Unauthorised · pending" : fieldValue(entry.record, "RECORD.STATUS") || entry.record.state || "Live"),
    );
    body.append(row);
  }
  table.append(header, body);
  container.append(table);
  if (truncated) container.append(node("p", "arrangement-inline-warning", `Showing the first ${MAX_ACTIVITY_HISTORY} activity records.`));
}

async function loadActivityHistory(arrangementId) {
  pendingActivityCheckFailed = false;
  const queries = await Promise.allSettled([
    callTransactTool("ofs-enquiry", {
      enquiry: "%AA.ARRANGEMENT.ACTIVITY",
      selection: [{ field: "ARRANGEMENT", operator: "EQ", value: arrangementId }],
      max_rows: MAX_ACTIVITY_HISTORY,
    }),
    callTransactTool("ofs-enquiry", {
      enquiry: "%AA.ARRANGEMENT.ACTIVITY$NAU",
      selection: [{ field: "ARRANGEMENT", operator: "EQ", value: arrangementId }],
      max_rows: MAX_ACTIVITY_HISTORY,
    }),
  ]);
  if (queries[1].status === "rejected") pendingActivityCheckFailed = true;
  const warnings = [];
  for (let index = 0; index < queries.length; index += 1) {
    if (queries[index].status === "rejected") {
      warnings.push(index === 1
        ? `Pending-activity check failed: ${queries[index].reason.message} New activities are disabled until pending status can be confirmed.`
        : `Live activity history could not be loaded: ${queries[index].reason.message}`);
    }
  }
  const liveResult = queries[0].status === "fulfilled" ? queries[0].value : null;
  const pendingResult = queries[1].status === "fulfilled" ? queries[1].value : null;
  const liveIds = liveResult ? enquiryIds(liveResult).slice(0, MAX_ACTIVITY_HISTORY) : [];
  const pendingIds = pendingResult ? enquiryIds(pendingResult).slice(0, MAX_ACTIVITY_HISTORY) : [];
  const [liveRecords, pendingRecords] = await Promise.all([
    mapLimit(liveIds, 8, async (id) => {
      try {
        return { id, record: await callTransactTool("ofs-read", { application: "AA.ARRANGEMENT.ACTIVITY", id }), pending: false };
      } catch {
        return null;
      }
    }),
    mapLimit(pendingIds, 8, async (id) => {
      try {
        return {
          id,
          record: await callTransactTool("ofs-read", { application: "AA.ARRANGEMENT.ACTIVITY", id, state: "unauthorised" }),
          pending: true,
        };
      } catch {
        pendingActivityCheckFailed = true;
        return null;
      }
    }),
  ]);
  const entries = [...pendingRecords.filter(Boolean), ...liveRecords.filter(Boolean)];
  const truncated = Boolean(liveResult?.truncated || pendingResult?.truncated);
  if (truncated) warnings.push("The activity enquiry returned a truncated result.");
  renderHistory(entries, truncated, warnings);
  return { entries, warnings };
}

function renderActivityOptions(activities, note) {
  const list = $("#arrangement-activity-list");
  list.replaceChildren();
  if (!activities.length) {
    list.append(node("p", "arrangement-empty", note || "No new activities are available for this arrangement."));
    return;
  }
  for (const activity of activities) {
    const card = node("article", "arrangement-activity-card");
    const details = node("div", "arrangement-activity-copy");
    details.append(
      node("strong", "", activity.description),
      node("span", "", `${activity.id} · ${activity.condition.property} (${activity.condition.conditionClass})`),
      ...(activity.classDescription && activity.classDescription !== activity.description
        ? [node("small", "", activity.classDescription)]
        : []),
    );
    const button = node("button", "button button-secondary", "New Activity");
    button.type = "button";
    button.disabled = pendingActivityCheckFailed || loading;
    button.addEventListener("click", () => openActivityEditor(activity));
    card.append(details, button);
    list.append(card);
  }
  if (note) list.append(node("p", "arrangement-inline-warning", note));
}

async function openActivityEditor(activity) {
  const editor = $("#arrangement-activity-editor");
  currentActivity = activity;
  simulatedSignature = "";
  editor.replaceChildren();
  const heading = node("div", "arrangement-editor-heading");
  const title = node("div");
  title.append(node("p", "eyebrow", "NEW ARRANGEMENT ACTIVITY"), node("h2", "", activity.description), node("p", "record-subtitle", `${activity.id} · ${workspace.arrangement.id}`));
  const close = node("button", "button button-secondary", "Cancel");
  close.type = "button";
  close.addEventListener("click", () => { editor.hidden = true; });
  heading.append(title, close);
  editor.append(heading);

  const effective = node("label", "arrangement-effective-date");
  effective.append(node("span", "", "EFFECTIVE DATE"));
  const date = node("input");
  date.type = "date";
  date.required = true;
  date.value = localDateValue();
  date.dataset.role = "effective-date";
  effective.append(date);
  editor.append(effective);

  editor.append(node("p", "arrangement-editor-guidance",
    "The effective date starts as your browser's local date; confirm it matches the Transact banking date. Scalar fields found on the arrangement are prefilled; review every value before simulating. Repeating fields are omitted because their row/sub-value axis cannot be inferred safely."));

  const schemaCache = new Map();
  for (const condition of activity.conditions) {
    let schema = schemaCache.get(condition.conditionClass);
    if (!schema) {
      try {
        const catalog = await callTransactTool("app-fields", { application: `AA.ARR.${condition.conditionClass}` });
        schema = {
          fields: activityInputFields(catalog),
          unsupportedRepeatingFields: unsupportedRepeatingFieldCount(catalog),
        };
        schemaCache.set(condition.conditionClass, schema);
      } catch (error) {
        editor.append(node("p", "arrangement-inline-error", `Could not load fields for ${condition.property}: ${error.message}`));
        continue;
      }
    }
    const section = node("fieldset", "arrangement-condition");
    section.append(node("legend", "", `${condition.property} · ${condition.conditionClass}`));
    const conditionDetails = node("p", "arrangement-condition-help", "Enter values using the field names below. Leave fields blank to omit them from this activity.");
    if (schema.unsupportedRepeatingFields) {
      conditionDetails.textContent += ` ${schema.unsupportedRepeatingFields} repeating field(s) are not offered because the field catalog does not identify whether they repeat by row or sub-value; this editor will not guess their axis.`;
    }
    section.append(conditionDetails);
    for (const field of schema.fields) {
      const fieldBlock = node("div", "arrangement-field");
      const label = node("label");
      label.append(node("span", "", field.name));
      const input = node("input");
      input.type = "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.dataset.condition = condition.property;
      input.dataset.fieldName = field.name;
      input.value = arrangementFieldPrefill(workspace.arrangement.record, field.name);
      label.append(input);
      fieldBlock.append(label);
      section.append(fieldBlock);
    }
    editor.append(section);
  }

  const result = node("section", "arrangement-activity-result");
  result.dataset.role = "result";
  result.hidden = true;
  editor.append(result);

  const actions = node("div", "arrangement-editor-actions");
  const simulate = node("button", "button button-primary", "Simulate Activity");
  simulate.type = "button";
  const commit = node("button", "button button-danger", "Commit Activity");
  commit.type = "button";
  commit.disabled = true;
  simulate.addEventListener("click", () => executeActivity(true, simulate, commit));
  commit.addEventListener("click", () => executeActivity(false, simulate, commit));
  actions.append(simulate, commit);
  editor.append(actions);
  editor.hidden = false;
  editor.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearSimulation() {
  simulatedSignature = "";
  const editor = $("#arrangement-activity-editor");
  const commit = editor.querySelector(".arrangement-editor-actions .button-danger");
  const result = editor.querySelector('[data-role="result"]');
  if (commit) commit.disabled = true;
  if (result) result.hidden = true;
}

function collectConditions(editor) {
  const conditions = {};
  const inputs = editor.querySelectorAll("input[data-condition]");
  for (const input of inputs) {
    const value = input.value.trim();
    if (!value) continue;
    const property = input.dataset.condition;
    const name = input.dataset.fieldName;
    if (!conditions[property]) conditions[property] = {};
    if (input.dataset.multi === "true") {
      if (!Array.isArray(conditions[property][name])) conditions[property][name] = [];
      conditions[property][name].push(value);
    } else {
      conditions[property][name] = value;
    }
  }
  return conditions;
}

async function executeActivity(simulate, simulateButton, commitButton) {
  if (!workspace || !currentActivity) return;
  const editor = $("#arrangement-activity-editor");
  const resultBox = editor.querySelector('[data-role="result"]');
  const dateValue = editor.querySelector('[data-role="effective-date"]').value;
  if (!dateValue) {
    setStatus("Choose the Transact effective date for this activity.", "error");
    editor.querySelector('[data-role="effective-date"]').focus();
    return;
  }
  const conditions = collectConditions(editor);
  if (!Object.keys(conditions).length) {
    setStatus("Enter at least one condition field to change.", "error");
    return;
  }
  const effectiveDate = dateValue.replaceAll("-", "");
  const signature = JSON.stringify({ activity: currentActivity.id, arrangement: workspace.arrangement.id, effectiveDate, conditions });
  if (!simulate && (simulatedSignature !== signature || commitButton.disabled)) {
    setStatus("Run a fresh simulation before committing this activity.", "error");
    return;
  }
  if (!simulate && !window.confirm(`Commit ${currentActivity.id} for arrangement ${workspace.arrangement.id} with effective date ${dateValue}? This creates a Transact activity. It may require separate authorisation before any change is applied.`)) return;

  simulateButton.disabled = true;
  commitButton.disabled = true;
  setStatus(simulate ? "Simulating the activity in Transact…" : "Submitting the activity to Transact…");
  resultBox.hidden = true;
  try {
    const result = await runAAActivity({
      activity: currentActivity.id,
      arrangement: workspace.arrangement.id,
      effective_date: effectiveDate,
      conditions,
      simulate,
    });
    const feedback = node("pre", "", formatActivityFeedback(result, conditions, simulate));
    const rawResponse = node("details", "arrangement-raw-response");
    rawResponse.append(node("summary", "", "Full Transact response"));
    rawResponse.append(node("pre", "", JSON.stringify(result, null, 2)));
    resultBox.replaceChildren(feedback, rawResponse);
    if (simulate) {
      if (result?.simulationMode !== true || (result?.errors || []).length) {
        simulatedSignature = "";
        resultBox.classList.add("error");
        setStatus("Simulation failed or was not verified. Review the Transact response; committing is disabled.", "error");
      } else {
        simulatedSignature = signature;
        resultBox.classList.remove("error");
        commitButton.disabled = false;
        const changes = Array.isArray(result.changed) ? result.changed.length : 0;
        setStatus(`Simulation completed and verified; Transact reported ${changes} changed field(s). Review the submitted values and response before committing.`, "success");
      }
    } else if (result?.pendingAuthorisation === true || result?.state === "unauthorised") {
      resultBox.classList.add("pending");
      if (result?.activityId) {
        const authorise = node("button", "button button-secondary", `Authorise ${result.activityId}`);
        authorise.type = "button";
        authorise.addEventListener("click", () => authorisePendingActivity(result.activityId, authorise));
        resultBox.append(authorise);
      }
      setStatus("Activity is pending authorisation; the arrangement has not changed. Authorise it before starting another activity.", "error");
      await loadArrangement(workspace.arrangement.id);
    } else if (result?.applied === true && !result?.errors?.length) {
      resultBox.classList.remove("error", "pending");
      setStatus("Activity applied successfully.", "success");
      await loadArrangement(workspace.arrangement.id);
    } else {
      resultBox.classList.add("error");
      setStatus(resultText(result) || "Transact did not confirm that the activity was applied.", "error");
    }
    resultBox.hidden = false;
  } catch (error) {
    resultBox.replaceChildren(node("pre", "", `The activity request failed before a confirmed response was received.\n${error.message}`));
    resultBox.classList.add("error");
    resultBox.hidden = false;
    setStatus(error.message, "error");
  } finally {
    simulateButton.disabled = false;
    commitButton.disabled = !simulate || simulatedSignature !== signature;
  }
}

async function authorisePendingActivity(activityId, button) {
  if (!window.confirm(`Authorise AA.ARRANGEMENT.ACTIVITY > ${activityId}? This may apply the activity changes to the arrangement.`)) return;
  button.disabled = true;
  setStatus(`Authorising activity ${activityId}…`);
  try {
    await authoriseRecord("AA.ARRANGEMENT.ACTIVITY", activityId);
    setStatus(`Activity ${activityId} was authorised. Refreshing arrangement activities…`, "success");
    await loadArrangement(workspace.arrangement.id);
  } catch (error) {
    setStatus(error.message, "error");
    button.disabled = false;
  }
}

async function loadArrangement(arrangementId) {
  if (loading) return;
  loading = true;
  workspace = null;
  currentActivity = null;
  simulatedSignature = "";
  $("#arrangement-list").hidden = true;
  $("#arrangement-activity-editor").hidden = true;
  $("#arrangement-summary").hidden = true;
  $("#arrangement-activity-history").hidden = false;
  $("#arrangement-activity-types").hidden = false;
  $("#arrangement-history-list").replaceChildren(node("p", "arrangement-empty", "Loading arrangement activity history…"));
  $("#arrangement-activity-list").replaceChildren(node("p", "arrangement-empty", "Loading product activity configuration…"));
  $("#arrangement-lookup-button").disabled = true;
  try {
    setStatus(`Reading arrangement ${arrangementId}…`);
    const record = await callTransactTool("arrangement-detail", { arrangement_id: arrangementId });
    const arrangement = makeArrangement(record, arrangementId);
    if (!arrangement.product) throw new Error("The arrangement response did not include its product ID.");
    renderArrangementSummary(arrangement);
    workspace = { arrangement, conditions: [], activities: [] };
    setStatus(`Reading product configuration for ${arrangement.product}…`);
    const product = await callTransactTool("aa-product-summary", { product_id: arrangement.product });
    const conditions = collectProductConditions(product);
    workspace.conditions = conditions;
    setStatus(`Finding user-configured activities for ${arrangement.productLine || "its product line"}…`);
    const [activityResult, historyResult] = await Promise.all([
      discoverActivities(arrangement, conditions),
      loadActivityHistory(arrangement.id),
    ]);
    workspace.activities = activityResult.activities;
    workspace.activityNote = activityResult.note;
    renderActivityOptions(activityResult.activities, activityResult.note);
    const pending = historyResult.entries.some((entry) => entry.pending);
    if (pending) {
      pendingActivityCheckFailed = true;
      setStatus("An unauthorised activity exists. Authorise or remove it before starting another activity.", "error");
      $("#arrangement-activity-list").querySelectorAll("button").forEach((button) => { button.disabled = true; });
    } else if (pendingActivityCheckFailed) {
      setStatus("Could not confirm pending activity status. New activities are disabled for safety.", "error");
      $("#arrangement-activity-list").querySelectorAll("button").forEach((button) => { button.disabled = true; });
    } else {
      setStatus(activityResult.note || "Arrangement and product activity configuration loaded.", activityResult.activities.length ? "success" : "");
    }
  } catch (error) {
    workspace = null;
    setStatus(error.message, "error");
    $("#arrangement-activity-list").replaceChildren(node("p", "arrangement-inline-error", error.message));
  } finally {
    loading = false;
    $("#arrangement-lookup-button").disabled = false;
    if (workspace) renderActivityOptions(workspace.activities, workspace.activityNote);
  }
}

export function initializeArrangementManager({ onOpen } = {}) {
  $("#arrangement-activity-editor").addEventListener("input", clearSimulation);
  $("#list-arrangements").addEventListener("click", (event) => {
    listArrangements(event.currentTarget);
  });
  $("#arrangement-lookup-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const id = $("#arrangement-id-input").value.trim();
    if (!id) return;
    loadArrangement(id);
  });
  $("#refresh-arrangement").addEventListener("click", () => {
    if (workspace) loadArrangement(workspace.arrangement.id);
  });
  return () => {
    $("#arrangement-manager-view").hidden = false;
    onOpen?.();
    if (!workspace) $("#arrangement-id-input").focus();
  };
}
