<!-- SPECKIT START -->
Active feature: **009-aa-arr-activity** — a composed Tier-2 tool that
performs any `AA.ARRANGEMENT.ACTIVITY` from functional facts, so an agent
states named conditions and plain field/value pairs while the backend owns
the positional OFS construction. Detail on the caller surface is in the
tool-catalogue section below; what follows is what a future session most
needs and cannot re-derive cheaply.

**The deployment prerequisite is `OFS.SOURCE FIELD.VAL = YES`,** and its
absence is the most dangerous failure this codebase has met: Transact
returns `statusCode 1`, `state: live` and a fully populated record **while
applying nothing**. No field of the envelope distinguishes it. That is why
the tool asserts `CHANGED.FIELDS` on the returned property record instead of
trusting the status code — trusting it produced four confidently wrong
conclusions during the investigation, including a written-up claim that the
mechanism did not work at all. `OFS.SOURCE` is also **cached by the pooled
TAFJ session**: a change is inert over HTTP until WildFly recycles, while a
fresh `tRun tSS <SOURCE>` reads it immediately — which makes a correct config
change look like a refuted hypothesis.

**A cross-cutting fix lives in tier1, not tier2.** `summariseWrite` used to
keep cascade siblings only when they FAILED; successful ones were dropped.
For an AA write that discards the whole property fan-out, leaving the summary
record as the activity itself — which carries no `CHANGED.FIELDS`. The
post-condition could therefore never pass. `domain.Record.Siblings` is tagged
`json:"-"` so the cascade is carried in-process for callers that need to
inspect what a write did, and **no tool's response shape changes**. If you
touch `summariseWrite`, that field is load-bearing for 009.

**The tool does not auto-authorise.** Under dual control an activity lands
`unauthorised`, has applied nothing, and its property record is provisional
and shows PRE-change values (those records vanish if the activity is
deleted). The outcome reports `pendingAuthorisation` rather than guessing,
because that state is otherwise indistinguishable from the `FIELD.VAL` no-op
and blaming the wrong one sends an operator to edit a shared config record. A
pending activity also blocks the next activity on the same arrangement.

**`simulate` is required with no default and is declared in the schema** — a
deliberate departure from 008/FR-009a, allowlisted in
`internal/mcp/hidden_surface_test.go` rather than by relaxing that sweep,
with `TestAAArrActivity_AdvertisesSimulateDeliberately` pinning the departure
in the other direction so it cannot be tidied away.

Ten probe notes carry the evidence, including the corrections: probe-63/64/65
reached a **wrong** negative conclusion that probe-68 overturned, and they are
kept rather than deleted because the reasoning error (reading `validated`, and
later a provisional record, as applied state) is the reusable lesson. Plan +
contracts: `specs/009-aa-arr-activity/`.

Shipped features (all load-bearing):

- **008-simulation-mode** — Transact's per-message simulation
instruction (user-info **position 7**, literal `1`) wired into `ofs-input`
but kept **off the surface the AI agent reads**. It is a generic *in-cache
write switch* (held I/O + savepoint rollback) and has **nothing** to do with
Transact's managed AA simulation family (`$SIM`/`.SIM` tables, capture
records, runners) — do not conflate them. Position 8 is a *reference*, inert
as an enabler. **Only `http` may simulate**: `verifiedSimulationTransports`
holds it alone, leak-checked live 2026-07-31; `direct-fork`/`byteslistener`
reuse one shell across messages, where a leaked switch would silently discard
a later real write, and their gate could not run (prerequisite failure, not a
verdict). G-EMP-008 is closed and the source document was wrong — position 8
wrote nothing. Two traps, both guarded: a write Transact REJECTS returns a
`Record` carrying `Errors`, **not** a Go error, so `err != nil` says nothing;
and `withVerifiedTransport` restores the prior map entry rather than deleting.
The marker `simulationMode` sits **beside** `state`, never in it, and the
`simmode=1` envelope token is **conditional** so ordinary trace lines stay
byte-identical. Plan + contracts: `specs/008-simulation-mode/`.

- **007-authorizer-credentials** — an optional second OFS
identity (`[ofs.authorizer]` / `TRANSACT_MCP_AUTHORIZER_*`) that signs
authorisation calls, so a maker-checker cycle can run through the server
where Transact enforces segregation of duties. Scope is deliberately
narrow: **the `/A` verb only** — reverse and delete are mutations, not
approvals, and stay on the inputter. `/A`, `/R` and `/D` share
`runSimpleMutation`, so the switch is gated on the *verb parameter*;
gating at function scope is the one defect that no `/A`-only test would
catch, and `TestReverseDelete_KeepInputterCredsWhileAuthorizerDeclared`
exists for it. Company falls back to `[ofs]`; user and password do not.
Absent block → byte-identical requests, pinned by
`TestAuthorise_BaselineWire_NoAuthorizer`. Observability: the role rides
on the request context (`ofsconn.WithRole`/`RoleFrom`) because the trace
wrapper sees only bytes and cannot tell two identities apart when they
share a user; every envelope line gains an **appended** `creds=` token
(003's schema fixes field order, so nothing is inserted). Plan +
contracts: `specs/007-authorizer-credentials/`.

- **006-aa-exercise-fixes** — fix the eight
live-verified defects from the 2026-07-07 AA product-build exercise
(inventory: `specs/006-aa-exercise-fixes/issues-inventory.md`), in
priority order 3→1→5→4→6→2→7→8. Theme: the OFS parser trusts response
*shape* over *content*. Parser work: no-match-trailer strip (R1),
infra-error content check on success-shaped bodies / TAFJERR-1060
(R2), selective promotion + cascade sibling-error aggregation on
failed writes (R3/R4 — probe-53 showed the real error rides a sibling
cascade child that tier1 discards). Tool work: `id:"@AUTO"` on
ofs-input (empty ID slot, probe-54), `max_rows` cap (default 500),
`%ACCOUNT` fallback for customer-accounts, `*Record omitempty`,
mnemonic chase via header-TxnID (probe-56). Bridge:
respawn-and-retry-once on infra-classified responses (R6).
Probe-first/observed-wins; planning probes probe-51…56 captured
(probe-55 reconstructed — live re-capture task gated on the operator
starting the VM bridge sidecar). Plan + contracts:
`specs/006-aa-exercise-fixes/`.

- **005-config-path-flag** (merged to main via Gittea PR #23) —
  documentation-only: brought README + 001/003 quickstarts to parity
  with the wiki `Configuration.md` and added three worked `--config`
  recipes; the flag already shipped. Probe-backed (observed-wins).
  Plan + contracts: `specs/005-config-path-flag/`.

- **004-ofs-conformance** (merged to main via Gittea PR #22) —
  empirically-gated OFS codec fixes from a six-document review of
  `examples/OFS/`: the live-confirmed C1 read-path comma-split
  corruption fix, encoder escaping (`//`→`^^`, `"`→`|`, literal
  `NULL`→`\NULL`), enquiry header-caption fidelity, HOLD-safe writes
  (distinct `hold` state + pre-flight model validation against the
  GTS.CONTROL silent data-drop), record-amendment directives
  (CLEAR.RECORD / CLEAR.MV / `:-n=` MV-append), the AA write-boundary
  doc, and error-classification housekeeping. Probe-first /
  observed-wins (`internal/ofs/testdata/probe-N/`); feature-local
  empirical gate (G-EMP). Plan + contracts: `specs/004-ofs-conformance/`.

- **003-streamable-http** (merged to main via Gittea PRs) —
  containerised Transact MCP for networked clients (n8n): a
  Streamable HTTP listener peer to the stdio loop, bearer-token
  auth, an OCI image in the team Gittea registry, the tri-valued
  `off`/`envelope`/`full` wire-trace setting (replacing the legacy
  `debug_wire_trace` boolean; envelope is redact-by-default), and a
  serialisation mutex on the direct-fork OFS driver. Plan +
  contracts: `specs/003-streamable-http/`.
- **002-direct-transport** (shipped 2026-04-24) — WildFly-free OFS
  transports (`direct-fork` in-process stdio + `byteslistener` TCP
  sidecar). Adds the `gcs` driver package, the `cmd/transact-bridge`
  sidecar binary, and extends `config.toml` with two transport
  modes. Plan + contracts: `specs/002-direct-transport/`.
- **001-ofs-mcp-server** — canonical reference for the existing
  HTTP, JMS, and Kafka transports, the OFS parser, and the tool
  layer. Later features extend it without modifying that code.
<!-- SPECKIT END -->

## Word Document MCP Guidelines

When interacting with the `word-document-server` MCP tools:

- **Prevent Permission Errors:** Always create a copy of the target document using `copy_document` before attempting any mutation (add, edit, replace, format).
- **Maintain Fidelity:** Follow the existing style, formatting, and indentation of the document strictly.
- **Version Documentation:** It is imperative that any update to the design document is accompanied by an update to the document history (or version history), usually found at the beginning of the document. The update must include all fields present in existing version history entries (e.g., Author, Version, Date, Description) and explicitly detail what was updated in the design document.
- **Contextual Awareness:** Use `get_document_outline` to verify paragraph indices and structure before performing targeted edits to avoid corrupting the document layout.
- **Record Views:** Whenever asked to update the design document with a record view, the default method is to include correctly formatted text. If prompted explicitly, use the "Screenshot/Image" approach: recreate the record view in HTML, render the page, take a screenshot of the webpage, and insert that image into the document. When using the textual approach, create a section (following in-document styles) at the correct level, and write the details of the record (or only the newly amended fields if prompted) in a textual style. Use the pattern: `ApplicationName > RecordID` to clearly define the table and record being referenced (e.g., `HELPTEXT.MENU > VMA.HLX.GROUP.CREDIT`), as seen in `reference_record_view/ticket.txt`.

## Reproducing record view as an HTML document
When asked to produce an HTML document that emulates the appearance of a record viewed through the BrowserWeb servlet:

- **Reference Materials:** Use the `BrowserWeb/` directory for general skinning and ALL references inside the `reference_record_view/` directory (including `reference_record_view_browser.html` and `reference_record_view_general_style.css`) for high-fidelity layout and component patterns.
    - **Visual Fidelity:** Strictly emulate the "field-label on left, value-box on right" layout. Labels should be in monospace, and value boxes (`.disabled_dealbox`) must have a grey background, silver border, and use Calibri font.
    - **Header Alignment:** Ensure the Application and Record ID are presented in a header row with a grey background (`.dealtitle` / `.iddisplay`) and the bank name in italics.
    - **Bottom Alignment:** Emulate the footer area where the bank name and "Implementation" status are placed at opposite ends of the screen.
- **Visual Identity:**
    - **Window Background:** Use `#E0EBEA`.
    - **Record Container:** The record must be inside a `.scroll_contract_screen` div with a white background and silver border.
    - **Header:** Use the `.dealtitle` and `.iddisplay` pattern to present the Application and Record ID.
    - **Fields:** Render read-only values using the `.disabled_dealbox` class (grey background, silver border, Calibri font).
    - **Multi-Values:** Emulate the tabular "tab" layout with greyed labels and distinct value cells.
- **Goal:** The resulting HTML should be visually indistinguishable from a real BrowserWeb record view.
- **Capture Workflow:** `file://` URLs are blocked by screenshot tools. To capture the image, serve the HTML via a local HTTP server (e.g., `python3 -m http.server 8000`), capture the screenshot from `http://localhost:8000/<filename>.html`, and then stop the server. See `.claude/dictionary/local-server.md` for details.
- **Cropping:** Use `capture_selector` with the `.scroll_contract_screen` selector to ensure only the record container is captured, removing unnecessary window background. When asked to screenshot an HTML page, always ensure the crop is tight to the record details, excluding any areas that contain no informative text.
- **Word Integration:** Set the inserted picture's height and width to 100% in Word. Its size relative to the page should typically not exceed 50%, unless the record is exceptionally long.

## Transports

Five OFS transports are implemented in `internal/ofsconn/`. The first three terminate at the same server-side `OFSProcessingBean` and require a running application server (WildFly/JBoss/WebLogic); the last two bypass that server entirely — `direct-fork` drives a local Transact shell over stdio, `byteslistener` does the same but via the `transact-bridge` Go sidecar reached over TCP. All five share the OFS payload builder (`internal/ofs`). Pick via `transport = "..."` in `config.toml`.

| Transport | Package | WildFly needed? | Status on R23ABC test env | Runbook |
|-----------|---------|-----------------|---------------------------|---------|
| HTTP (TAFJRestServices) | `ofshttp` | yes | ✓ default, used through UAT | — |
| Kafka (TemnKafkaRAR) | `kafka` | yes | ✗ no broker running on this env | `specs/001-ofs-mcp-server/kafka-example.md` |
| JMS / STOMP → Artemis (OFSTransactedMDB) | `jms` | yes | ✓ verified 2026-04-19 after enabling a STOMP acceptor | `specs/001-ofs-mcp-server/jms-example.md` |
| Direct-fork (stdio to `tRun` / `tRun.bat`) | `directfork` + shared `gcs` driver | **no** | ✓ gcs driver unit-tested 2026-04-23 against a TAFJEE T000 capture; live integration behind `-tags=integration` | `specs/002-direct-transport/quickstart.md § Scenario A` |
| Byteslistener (TCP → `transact-bridge` sidecar → stdio) | `byteslistener` client + `cmd/transact-bridge` sidecar + shared `gcs` driver | **no** | ✓ mock-shell e2e passes; live sidecar walkthrough pending real-env access | `specs/002-direct-transport/quickstart.md § Scenario B`, `deploy/README.md` |

Design and research: `rework-transport.md`, `research-transport.md`, `jms-transport-plan.md`, `research-tcserver.md`, `direct-transport-plan.md`.

## Optional features

| Feature | Package | Activation | Runbook |
|---------|---------|-----------|---------|
| HELP.TEXT index + two field-documentation tools (`helptext-fields`, `helptext-describe`) | `internal/helptext/` | `[help_text] path = "…"` in `config.toml` or `TRANSACT_MCP_HELP_TEXT_PATH` env | `specs/001-ofs-mcp-server/helptext-example.md` |

Absent config → feature off; standard 17-tool surface unchanged.

## Chapter zero — primer tool

| Tool | Purpose | Source |
|------|---------|--------|
| `transact-context` | Zero-arg read-this-first primer: Transact/OFS vocabulary, application/enquiry/AA model, discovery playbook | `internal/mcp/transact_context.md` (embedded) |

Call once at the start of a Transact-related session.

## Tier-2 AA tool pair

| Tool | Purpose | Runbook |
|------|---------|---------|
| `aa-product-summary` | AA.PRODUCT → AA.PRODUCT.DESIGNER overview; emits `pcPrdPr` pointers for each condition | `tool-reference.md` |
| `aa-condition-detail` | Dereferences one `pcPrdPr` → full AA.PRD.DES.\<CLASS\> record with HELP.TEXT-enriched fields | `specs/001-ofs-mcp-server/aa-condition-example.md` |

Chain: `aa-product-summary` → pick a `pcPrdPr` → `aa-condition-detail`.

## Tier-2 AA activity writer — `aa-arr-activity`

The one **mutating** AA tool. Performs any `AA.ARRANGEMENT.ACTIVITY` (open,
change, roll over, close) from functional facts; the backend owns the
positional OFS construction. Four things about it are non-obvious and all four
were established live (`specs/009-aa-arr-activity/probes/`):

- **`OFS.SOURCE` must have `FIELD.VAL = YES`.** Without it Transact returns
  `statusCode 1`, `state: live`, and a fully populated record **while applying
  nothing** — probe-68, a single-variable pair on the same source. No field of
  the envelope distinguishes it, so the tool asserts `CHANGED.FIELDS` on the
  returned property record and reports `REFUSAL_ACTIVITY_NOT_APPLIED` instead of
  trusting the status code. Trusting it produced four confidently wrong
  conclusions during the investigation.
- **`OFS.SOURCE` is cached per session.** A change is inert over HTTP until the
  pooled TAFJ agents recycle (WildFly restart); a fresh `tRun tSS <SOURCE>`
  reads it immediately. This makes a config change look like a refuted
  hypothesis.
- **`EFFECTIVE` is the FOURTH field of the property group**, alongside
  `PROPERTY` / `FIELD.NAME` / `FIELD.VALUE`. Omitting it was a real defect.
- **Clearing a field is a bare `NULL`** → `IntentClear`, which empties the slot.
  It is NOT "store the text NULL" as the vendor deck implies. `'NULL'` is
  *accepted* and writes six literal characters with a clean `CHANGED.FIELDS` —
  success-shaped corruption (probe-69), which is why no escape spelling appears
  in the caller's vocabulary.

Two more live findings shape the row model (probe-70): **multi-value rows are
dense**, so an `at` beyond the current end is silently compacted to the next
free slot, and **each field compacts independently** — clearing one field of a
correlated group shifts it up while its siblings stay, desynchronising the row
with a clean `CHANGED.FIELDS`. That is the worst failure mode found here, so a
partial row clear is **refused** (`REFUSAL_PARTIAL_ROW_CLEAR`, FR-031).

Probe-71 (live, 2026-08-11) settled the sub-value axis: **nested lists write
sv positions correctly end to end** (AA.ARR.INTEREST margins, the canonical
sv-repeating group), and **`CHANGED.FIELDS` is positionless** — one flat field
name however many mv/sv slots changed — so per-position verification is
impossible and a correlated sv grammar (`subrows`) was deliberately deferred.
Instead the guards close the silent holes (branch 009-sv-value-guards):
FR-031 now also covers **parallel-list clears** (a position cleared in one
list-form field but not its siblings is refused), and **FR-032 /
`REFUSAL_VALUE_FORM`** refuses forms the mapper previously mis-emitted
silently — a list or `{"at"}` inside `rows`, a list nested past sub-values,
`{"at"}` among sub-values.

The tool also does **not** auto-authorise. An activity that lands
`unauthorised` under dual control has applied nothing yet and its property
record is provisional; the outcome reports `pendingAuthorisation` rather than
guessing, because that state is otherwise indistinguishable from the
`FIELD.VAL` no-op and blaming the wrong one sends an operator to edit a shared
config record.

Conditions are keyed by **property NAME** (`COMMITMENT`, `DEPOSITINT`), never
class name (`TERM.AMOUNT`, `INTEREST`) — the likeliest caller error, and the
tool deliberately does **not** report the valid set (FR-030); agents use
`aa-product-summary` + `app-fields`. Repeating values use `rows` or per-field
lists, and every emitted field carries an explicit `:mv:sv` because an
unpositioned repeat is accepted silently and can lose a row (probe-62).

`simulate` is **required with no default** and is **declared** in the schema — a
deliberate departure from 008/FR-009a, allowlisted in
`internal/mcp/hidden_surface_test.go` rather than by relaxing that sweep.
Plan + contracts: `specs/009-aa-arr-activity/`.

## Tier-2 application-schema tool pair

| Tool | Purpose | Runbook |
|------|---------|---------|
| `app-fields` | Lean index of a Transact app's field catalog (name, type, length, multi) sourced from `STANDARD.SELECTION` | `specs/001-ofs-mcp-server/app-schema-example.md` |
| `app-schema` | Full decode of the same catalog: VAL.PROG validation kind + modifiers, display geometry, REL.FILE pointer, HELP.TEXT description when configured | `specs/001-ofs-mcp-server/app-schema-example.md` |

Chain: `app-fields` → narrow by name/type → `app-schema` on the subset.


Set `debug_wire_trace = true` in `config.toml` (or `TRANSACT_MCP_DEBUG_WIRE=true` in the env) to log every OFS request and response to stderr. Request lines show `[ofs-wire] SEND bytes=N …` with the credential password masked as `***`; response lines show `[ofs-wire] RECV bytes=N …` with the body logged verbatim. A one-line WARNING is emitted at boot when tracing is on.

Production default off. Credentials are always masked; customer data in responses is NOT — enable only when debugging a specific transport issue.

### Reading the envelope line

At `wire_trace.level = "envelope"` each round-trip emits two lines whose field order is fixed by 003's schema — new information is appended, never inserted:

```
[ofs-wire] SEND transport=http app=SECTOR op=- txid=- return=- bytes=61 elapsed=- creds=inputter simmode=1
```

`creds=` (007) names the signing identity and rides **every** line. `simmode=1` (008) marks a round-trip that ran in Transact's in-cache simulation mode and was discarded; it is **conditional** — there is deliberately no `simmode=0`, so its **absence means the round-trip was not simulated**. That asymmetry exists because emitting a negative form would change every pre-existing line.

Beware the trap this token exists for: a simulated response is byte-indistinguishable from a committed one — same `txnref//1`, allocated id, incremented `CURR.NO`, inputter stamps — so the trace line is the only place the distinction is visible for a call whose result you no longer have.

## ESON Generation
The `generate-eson` skill allows the agent to create `.eson` record files for Transact based on reference patterns in `reference_eson/`. 
- **Input**: Can be a `.csv` file (patterned after `reference_eson/export_data.csv`) or direct instructions.
- **Output**: Generated files are saved in the `generated_esons/` folder using the naming convention `<CompanyCode>.<Table>!<RecordID>.data.eson`.
- **Capitalization and structure**: Preserve canonical Transact uppercase names for applications/tables, record identifiers, and field/feature names wherever applicable; keep data-value casing as supplied by the source. Use curly braces `{ ... }` for root and contained EObjects, and square brackets `[ ... ]` for many-valued/repeating features, with contained-object braces as required by the model. Keep scalar attributes as direct values and follow the model/reference structure.