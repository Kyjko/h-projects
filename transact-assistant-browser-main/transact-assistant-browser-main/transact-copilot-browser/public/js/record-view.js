const FIELD_LABELS = {
  "CURR.NO": "Current number",
  INPUTTER: "Inputter",
  AUTHORISER: "Authoriser",
  "DATE.TIME": "Date and time",
  "CO.CODE": "Company",
  "DEPT.CODE": "Department",
};

function cellText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function create(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function locateJson(answer) {
  const match = answer.match(/```json\s*([\s\S]*?)```/i);
  const candidate = match ? match[1] : answer.trim();
  try {
    return { data: JSON.parse(candidate), narrative: match ? answer.replace(match[0], "").trim() : "" };
  } catch {
    return null;
  }
}

function showRecord(data, container) {
  if (!data || typeof data !== "object") return false;
  const app = data.application || "Transact";
  const identifier = data.id || data.record?.id || "Record";
  const record = data.record && Array.isArray(data.record.fields) ? data.record : data;
  const fields = Array.isArray(record.fields) ? record.fields : [];
  if (!fields.length) return false;

  const header = create("div", "record-view-header");
  header.append(create("span", "dealtitle", app), create("span", "iddisplay", identifier));
  header.append(create("span", "bank-name", "Local Transact"));
  container.append(header);

  const metadata = create("div", "record-meta");
  if (record.state) metadata.append(create("span", "meta-pill", `STATE · ${record.state}`));
  if (record.status !== undefined) metadata.append(create("span", "meta-pill", `STATUS · ${record.status}`));
  if (record.version) metadata.append(create("span", "meta-pill", `VERSION · ${record.version}`));
  if (metadata.childElementCount) container.append(metadata);

  const table = create("table", "field-table");
  const body = create("tbody");
  for (const field of fields) {
    if (!field || typeof field.name !== "string") continue;
    const row = create("tr", "field-row");
    const label = create("th", "", FIELD_LABELS[field.name] || field.name);
    label.title = field.name;
    const valueCell = create("td");
    const value = create("span", "disabled_dealbox", cellText(field.value));
    const index = field.mv !== undefined && (Number(field.mv) > 1 || Number(field.sv) > 1)
      ? create("span", "mv-index", `${field.mv || 1}:${field.sv || 1}`)
      : null;
    if (index) valueCell.append(index);
    valueCell.append(value);
    row.append(label, valueCell);
    body.append(row);
  }
  table.append(body);
  container.append(table);
  return true;
}

function renderTable(rows, columns, container, headingText) {
  const heading = create("h2", "enquiry-title", headingText);
  container.append(heading);
  const wrap = create("div", "enquiry-wrap");
  const table = create("table", "enquiry-table");
  const head = create("thead");
  const headRow = create("tr");
  const labels = columns.map((col) => col.label || col.identifier || col);
  if (!labels.length && rows.length) {
    const first = rows[0];
    if (Array.isArray(first?.cells)) first.cells.forEach((_, index) => labels.push(`Field ${index + 1}`));
    else if (first && typeof first === "object") labels.push(...Object.keys(first));
  }
  for (const label of labels) headRow.append(create("th", "", cellText(label)));
  head.append(headRow);
  const tbody = create("tbody");
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  let page = 0;
  const pagination = create("div", "table-pagination");
  const summary = create("span", "table-page-summary");
  const previous = create("button", "table-page-button", "Previous");
  previous.type = "button";
  const next = create("button", "table-page-button", "Next");
  next.type = "button";
  function displayPage() {
    const start = page * pageSize;
    const end = Math.min(start + pageSize, rows.length);
    tbody.replaceChildren();
    for (const row of rows.slice(start, end)) {
      const tr = create("tr");
      const cells = Array.isArray(row?.cells)
        ? row.cells
        : Array.isArray(row)
          ? row
          : Object.values(row || {});
      cells.forEach((cell) => tr.append(create("td", "", cellText(cell))));
      tbody.append(tr);
    }
    summary.textContent = rows.length
      ? `Showing ${start + 1}–${end} of ${rows.length.toLocaleString()} · Page ${page + 1} of ${pageCount}`
      : "No records returned";
    previous.disabled = page === 0;
    next.disabled = page + 1 >= pageCount;
  }
  previous.addEventListener("click", () => {
    if (page > 0) {
      page -= 1;
      displayPage();
    }
  });
  next.addEventListener("click", () => {
    if (page + 1 < pageCount) {
      page += 1;
      displayPage();
    }
  });
  pagination.append(previous, summary, next);
  displayPage();
  table.append(head, tbody);
  wrap.append(table);
  container.append(wrap);
  container.append(pagination);
  return true;
}

function showRows(data, container) {
  if (!data || typeof data !== "object") return false;
  if (!Array.isArray(data.rows)) return false;
  renderTable(data.rows, Array.isArray(data.columns) ? data.columns : [], container, data.enquiry || "Enquiry results");
  if (data.truncated) {
    container.append(create("p", "record-subtitle", `Results truncated at ${data.rows.length} rows.`));
  }
  return true;
}

function showGeneric(data, container) {
  if (Array.isArray(data)) {
    if (data.length && data.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      renderTable(data, [], container, "Results");
    } else {
      const table = create("table", "field-table");
      const body = create("tbody");
      data.forEach((item, index) => {
        const row = create("tr", "field-row");
        row.append(create("th", "", String(index + 1)), create("td"));
        row.lastElementChild.append(create("span", "disabled_dealbox", cellText(item)));
        body.append(row);
      });
      table.append(body);
      container.append(table);
    }
    return;
  }
  if (!data || typeof data !== "object") {
    container.append(create("pre", "raw-data", cellText(data)));
    return;
  }

  const arrays = Object.entries(data).filter(([, value]) => Array.isArray(value));
  const scalarEntries = Object.entries(data).filter(([, value]) => !Array.isArray(value) && (value === null || typeof value !== "object"));
  if (scalarEntries.length) {
    const table = create("table", "field-table");
    const body = create("tbody");
    for (const [name, value] of scalarEntries) {
      const row = create("tr", "field-row");
      row.append(create("th", "", name), create("td"));
      row.lastElementChild.append(create("span", "disabled_dealbox", cellText(value)));
      body.append(row);
    }
    table.append(body);
    container.append(table);
  }
  for (const [name, rows] of arrays) {
    if (rows.length && rows.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      renderTable(rows, [], container, name);
    } else {
      const rowData = rows.map((value, index) => ({ index: index + 1, value }));
      renderTable(rowData, [], container, name);
    }
  }
  if (!scalarEntries.length && !arrays.length) {
    container.append(create("pre", "raw-data", JSON.stringify(data, null, 2)));
  }
}

export function renderData(data, container, context = {}) {
  const record = data?.record && Array.isArray(data.record.fields) ? data.record : data;
  let rendered = showRecord(data, container);
  if (!rendered) rendered = showRows(data, container);
  if (!rendered && record !== data) rendered = showRecord({ ...record, application: data.application || context.application, id: data.id || context.recordId }, container);
  if (!rendered) showGeneric(data, container);

  const title = data?.application ? `${data.application}${data.id ? ` · ${data.id}` : ""}`
    : data?.enquiry || context.title || "Transact result";
  const subtitle = data?.state ? `Record returned in ${data.state} state.` : "Result returned by Transact MCP.";
  return { title, subtitle, raw: data };
}

export function renderResult(answer, container) {
  const parsed = locateJson(answer);
  if (!parsed) {
    container.append(create("pre", "raw-data", answer));
    return { title: "Transact Assistant response", subtitle: "Response from your local assistant.", raw: null };
  }
  const result = renderData(parsed.data, container);
  if (parsed.narrative) result.subtitle = parsed.narrative;
  else if (parsed.data?.state) result.subtitle = `Record returned in ${parsed.data.state} state.`;
  return result;
}

export function renderError(message, container) {
  container.append(create("pre", "raw-data", message));
}
