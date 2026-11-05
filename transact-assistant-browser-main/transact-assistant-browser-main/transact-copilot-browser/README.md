# Transact Assistant Browser

A small, local BrowserWeb-inspired interface for exploring a Transact environment through Copilot CLI and Transact MCP. The browser talks only to this Node server; the server starts Copilot locally for each request and supplies the local MCP URL as a request-scoped server definition.

## Requirements

- Node.js 20+
- GitHub Copilot CLI installed and authenticated locally (`copilot`)
- Transact MCP listening at `http://localhost:9189/mcp` (or `TRANSACT_MCP_URL`)
- For **Edit design document**, the Word MCP server must be registered in the local Copilot CLI configuration as `word-document-server`. Screenshot insertion additionally requires the configured Playwright MCP tools.

The website has no sign-in page. Copilot CLI still uses its existing local authentication.

## Run

```powershell
cd transact-copilot-browser
npm start
```

Open `http://127.0.0.1:4173`. The server binds to loopback only. To change the MCP endpoint or web port:

```powershell
$env:TRANSACT_MCP_URL = "http://localhost:9189/mcp"
$env:PORT = "4173"
npm start
```

On Windows, the server resolves the installed Copilot CLI npm entry automatically. If that is not found, set `COPILOT_CLI_ENTRY` to the path of `node_modules/@github/copilot/npm-loader.js`. `COPILOT_CLI_PATH` can override the CLI executable on other setups.

## Use

Enter an application and record ID, then choose **Open record**. Use **List records** for the application's auto-enquiry. A `...` wildcard in the application field searches `FILE.CONTROL` and filters application IDs; a `...` wildcard in the record ID field uses Transact's native `LK` enquiry filter and changes the button to **Filter records**. The two wildcard searches are performed separately. The application and record fields are also passed as context to natural-language requests. Conversation history stays in the browser page and is not written to disk by this project.

Choose **Design new record** to load an application's field schema and build a record. Transact-managed fields are read-only; repeating fields can be added as needed. **Validate** runs Transact's no-commit validation. **Submit record** identifies whether the ID exists, validates, then sends `ofs-input` after confirmation: an existing ID is AMENDed and a missing ID is created. The designer does not authorise records. Assistant chat remains available for explicitly requested, suggestion-only help while designing.

Choose **Edit design document** to upload a `.docx`, select recent records created or amended through the designer or Assistant, and/or enter an application and exact record ID directly. Direct records are read from Transact when the document job starts; they do not have to appear in recent history. Enter placement and formatting instructions (for example, a target section) before starting; the Assistant's progress and final summary appear in the inline editing chat, and each attempt is logged by job ID in the server console. Document edits stream their larger prompt to Copilot CLI through stdin to avoid Windows command-line length limits, and allow up to 15 minutes to complete; ordinary Assistant requests retain their shorter default timeout. The latest five successful `ofs-input` changes are kept in `.local-data/recent-amendments.json` (not in a database); uploaded and edited documents stay in a private temporary directory and are removed after download or expiry. Screenshot insertion is optional and off by default. The original upload is never edited.

All standard Transact MCP tools are available to Copilot: `transact-context`, `ofs-enquiry`, `ofs-read`, `app-fields`, `app-schema`, `customer-lookup`, `customer-accounts`, `account-detail`, `arrangement-detail`, `aa-product-summary`, `aa-condition-detail`, `ofs-input`, `ofs-authorise`, `ofs-reverse`, `ofs-delete`, `funds-transfer`, and `aa-arr-activity`.

Each request gets an isolated `transact-browser` MCP definition that points to the local endpoint; the CLI's pre-existing `transact-mcp` entry is disabled for that run to avoid duplicate tools. The request-scoped **Permit write tools** checkbox is off by default. When enabled, the UI asks for confirmation and permits the six write/authorise/transfer/reverse/delete tools only for that Copilot request. The unchecked default explicitly denies those mutation tools and allows only read tools. Review mutations carefully; writes execute against the local Transact environment.

Record responses are displayed in a BrowserWeb-style, read-only record view. Enquiry responses are shown as tables. The JSON result can be copied with the record toolbar button.

The **User menu → Enquiries** view browses saved records in `ENQUIRY`, resolves the source table from each enquiry record, and lets you run each saved enquiry. **Find Customer Loans** filters the named loans enquiry using a dropdown populated from the `AA.ARRANGEMENT` field catalog. Under **AI tools**, **Generate ESON** reads records through Copilot and saves generated files in `generated_esons`; reads always use the company configured on the connected Transact MCP server, while the entered company code is written to `CO.CODE`. **View reference ESON** recursively searches `reference_eson` and shows each match's relative folder. **Manage Skills** lists `.claude/skills`, accepts new Markdown skill files, and provides an in-browser editor for existing Markdown files. These workspace paths are relative to the parent project directory by default and can be changed with `TRANSACT_BROWSER_WORKSPACE_ROOT`.

## Tests

```powershell
npm test
```

No third-party packages are required.
