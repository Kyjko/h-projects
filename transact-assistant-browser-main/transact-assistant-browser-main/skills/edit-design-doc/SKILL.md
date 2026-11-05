---
name: edit-design-doc
description: Edit Word-based Transact design documents while preserving their structure, style, history, and BrowserWeb record-view conventions.
---

# Edit Design Documents

Use this skill when the user asks to update, amend, format, or add record details to a design document, especially a Word document or a document containing Transact record views.

## Before editing

1. Identify the target document and the requested changes. Do not edit unrelated sections.
2. Use `copy_document` to create a working copy before any document mutation. Make changes to the copy so permission errors do not affect the original.
3. Use `get_document_outline` to understand the document structure and verify paragraph indices before targeted edits. Read the relevant paragraphs and surrounding content before changing them.
4. Follow existing heading levels, styles, fonts, formatting, indentation, terminology, and layout. Prefer the document's established patterns over introducing new styles or structure.

## Document history

Every design-document update must also update the document's history/version history, usually near the beginning:

- Preserve every field used by the existing entries, such as Author, Version, Date, and Description.
- Add an entry that accurately identifies the update and the parts of the design document changed.
- Match the existing table or list layout and formatting. Do not omit history updates for small or record-view-only changes.

## Adding a Transact record view

- Default to a textual record view. Add a section at the appropriate existing heading level and follow the document's record-view style.
- Identify each record with `ApplicationName > RecordID`, for example `HELPTEXT.MENU > VMA.HLX.GROUP.CREDIT`.
- Include the complete record details requested by the user, or only the newly amended fields when the request specifies that scope. Preserve field names, values, repeating values, and their order; do not invent missing data.
- For a textual view, verify the section placement and formatting against nearby content before finishing.

## Screenshot/image record views

Use the Screenshot/Image approach only when the user explicitly requests it.

1. Recreate the record view as HTML using `BrowserWeb/` for the general skin and all relevant references in `reference_record_view/`, including `reference_record_view_browser.html` and `reference_record_view_general_style.css`.
2. Match the BrowserWeb layout: labels on the left and values on the right; monospace labels; grey `.disabled_dealbox` values with silver borders and Calibri text; a grey `.dealtitle` / `.iddisplay` header with the application and record ID; an italic bank name; and a footer with the bank name and Implementation status at opposite ends.
3. Use a `#E0EBEA` window background and place the record in a white `.scroll_contract_screen` with a silver border. Represent multi-values with the reference's tabular layout.
4. Serve the HTML over a local HTTP server; screenshot tools do not support `file://` URLs. Use the local-server guidance in `.claude/dictionary/local-server.md` where applicable, and stop the server after capture.
5. Capture tightly around `.scroll_contract_screen` so the image contains the record details without empty page area. Insert the image into the copied Word document, set its height and width to 100%, and keep its size to about 50% of the page or less unless the record is exceptionally long.

## Finish

- Confirm the changes are in the copied document and that the original remains untouched.
- Check that the new or updated history entry is present and that the edited section follows the document's structure and formatting.
- Report the working-copy path and summarize the document sections changed.
