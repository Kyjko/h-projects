function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function wildcardRegex(pattern) {
  const parts = pattern.split("...");
  let expression = "";
  parts.forEach((part, index) => {
    expression += escapeRegex(part);
    if (index < parts.length - 1) expression += ".*";
  });
  if (!pattern.startsWith("...")) expression = `^${expression}`;
  if (!pattern.endsWith("...")) expression += "$";
  return new RegExp(expression, "i");
}

export function rowId(row, columns = []) {
  if (typeof row?.id === "string") return row.id;
  if (typeof row?.recordId === "string") return row.recordId;
  if (typeof row?.["@ID"] === "string") return row["@ID"];
  if (Array.isArray(row?.cells)) {
    const idIndex = columns.findIndex((column) => {
      const name = typeof column === "string" ? column : column?.identifier || column?.name || column?.label;
      return typeof name === "string" && ["@ID", "ID"].includes(name.toUpperCase());
    });
    const value = row.cells[idIndex >= 0 ? idIndex : 0];
    if (typeof value === "string") return value;
  }
  return "";
}

export function filterTableRows(data, pattern) {
  if (!data || !Array.isArray(data.rows)) return { ...data, rows: [] };
  const matcher = wildcardRegex(pattern);
  const rows = data.rows.filter((row) => matcher.test(rowId(row, data.columns || [])));
  return {
    ...data,
    rows,
    totalRows: rows.length,
  };
}

export function recordWildcardEnquiry(application, pattern) {
  return {
    enquiry: `%${application}`,
    selection: [{ field: "@ID", operator: "LK", value: pattern }],
    max_rows: 5000,
  };
}
