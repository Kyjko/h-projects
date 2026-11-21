import { rowId } from "./search.js";

const SEARCH_FIELDS = ["@ID", "EB.ERROR.ID", "ERROR.INFO", "ERROR.MSG", "ERROR.SOL"];

export function buildApplicationErrorEnquiries(application, maxRows = 5000) {
  const searchTerm = String(application || "").trim().toUpperCase();
  if (!searchTerm) throw new Error("Enter an application to search EB.ERROR.");
  return SEARCH_FIELDS.map((field) => ({
    enquiry: "%EB.ERROR",
    selection: [{ field, operator: "LK", value: `...${searchTerm}...` }],
    max_rows: maxRows,
  }));
}

export function applicationErrorIds(results) {
  return [...new Set((results || []).flatMap((result) =>
    (result?.rows || []).map((row) => rowId(row, result.columns || [])).filter(Boolean)))];
}
