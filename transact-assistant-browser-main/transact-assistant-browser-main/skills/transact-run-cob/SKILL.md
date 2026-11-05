---
name: transact-run-cob
description: >
  Run the end-of-day Close of Business (COB) batch on a Temenos Transact
  environment via the Transact MCP server. Covers pre-flight sanity checks
  against the DATES record, company selection, idle-service verification on
  TSA.SERVICE, starting the COB service, polling to completion via the
  EB.API.COB.MONITOR.2.1.0 enquiry, and reporting the outcome (optionally
  via a sibling `transact-send-msg` skill for out-of-chat notifications).
  Trigger phrases: "run cob", "transact cob", "start cob batch", "execute cob",
  "close of business", "run end of day".
argument-hint: 'Optional: COMPANY.CODE. If omitted, the skill discovers companies from DATES and asks the user when more than one exists.'
---

# Transact — Run COB

This skill drives a Close-of-Business batch on a Temenos Transact install
through the **Transact MCP** server, using Tier-1 OFS primitives only
(`ofs-enquiry`, `ofs-read`, `ofs-input`, optionally `ofs-authorise`).
It deliberately avoids assuming any Transact-MCP-specific "run_cob" tool
— none exists; COB is started on Transact by toggling the
`SERVICE.CONTROL` field on `TSA.SERVICE/COB` to `START`, and progress is
observed through the `EB.API.COB.MONITOR.2.1.0` enquiry.

**Write-path preference — `RAD` version first.** Most Transact installs
ship a named `VERSION` record called `RAD` that auto-authorises on input
(bypassing the `EB.RTN.SAME.NAME.AUTHORISER/INPUTTER` rule when the MCP
runs under a single OFS credential). This skill probes for
`VERSION TSA.SERVICE,RAD` during pre-flight and, if present, drives the
start as **one** `ofs-input` call with `version: "RAD"` — no separate
`ofs-authorise` step. If RAD is absent, the skill falls back to the
classic two-call flow (`ofs-input` → `ofs-authorise`) and surfaces any
same-name-authoriser override as an operator-triage blocker.

---

## Background — what COB is and how Transact runs it

- **Business stages.** A Transact company cycles through `ONLINE` →
  `APPLICATION` → `SYSTEM WIDE` → `REPORTING` → `START OF DAY` →
  `ONLINE` (next working day). "COB" is the umbrella name for everything
  between the two Online stages. The flag that tells you **which stage a
  company is currently in** is `CO.BATCH.STATUS` on the `DATES` record
  (length-1 code). The value for Online is `O` — safe to start COB;
  anything else means COB is already in progress.
- **DATES record.** One per company; ID is the `COMPANY.CODE`. Key fields
  relevant to this skill: `TODAY`, `NEXT.WORKING.DAY`, `LAST.WORKING.DAY`,
  `CO.BATCH.STATUS`, `CURRENT.DAY`, `PERIOD.END`. A companion record
  `<COMPANY.CODE>-COB` exists and is used during COB bookkeeping — it
  appears alongside the main record in any `%DATES` listing but is not
  the record this skill reads.
- **Starting COB.** There is a **single** `TSA.SERVICE/COB` record.
  Setting its `SERVICE.CONTROL` to `START` causes the Transact Service
  Agent (tSA) to pick up and execute the COB work profile. When COB
  finishes cleanly, tSA resets `SERVICE.CONTROL` back to `STOP` and
  appends a new row to the `STARTED` / `STOPPED` / `ELAPSED` /
  `TRANSACTIONS` multi-value arrays.
- **Monitoring.** The enquiry `EB.API.COB.MONITOR.2.1.0` returns a
  per-stage snapshot (`BATCH.STAGE`, `PERCENTAGE`, `PROCESS.STATUS`) with
  one row per stage plus a leading timestamp row. This is the primary
  progress source for this skill.

---

## MCP tools used

Before invoking any tool, **discover its schema from the connected
Transact MCP server** — list tools via the MCP client and read the
descriptions. Do not rely on a cached or out-of-band specification. The
Transact MCP is versioned independently from this skill and descriptions
are the source of truth.

At the time of writing, this skill uses:

| Role | Tool (Transact MCP) |
|------|---------------------|
| Primer | `transact-context` (optional, zero-arg) |
| Read-only enquiries | `ofs-enquiry` |
| Read-only record fetch | `ofs-read` |
| Mutating record input (gated by `confirm: true`) | `ofs-input` |

Optional sibling skill:

| Role | Skill |
|------|-------|
| Out-of-chat operator notification (best-effort) | `transact-send-msg` — single `message` argument; each site wires the channel (Teams, Slack, webhook, …) or leaves it as a no-op stub |

---

## Harness interaction — how to ask operator-gate questions

Every **operator gate** in this skill — Step 2 company selection,
Step 3 final go/no-go, Step 4b authoriser recovery, and the Step 5
15-poll stall decision — must be posed as a **structured question**
when the driving harness exposes one.

On Claude Code, that is the `AskUserQuestion` tool: up to 4 labelled
options per question, each with a short `label` + longer
`description`, plus an auto-appended free-text `Other` slot. Use it
whenever the harness exposes it. When recommending a specific option,
put it first and append `(Recommended)` to its label.

If the harness does **not** expose a structured-question tool (e.g. a
non-Claude-Code driver, or a bare MCP client), fall back to a
plain-text prompt that explicitly lists the same options plus a
free-text slot, e.g.:

```
Proceed with COB start?
  [1] Yes — start COB now  (Recommended)
  [2] No — abort
  [3] Other (type a reply)
```

Do **not** phrase gate questions as open-ended prose ("What do you
want to do?") or as bare yes/no without listing the alternatives. A
lesser model will interpret an ambiguous reply as consent; the
structured and fallback forms both require an explicit selection, or
a free-text reply the skill interprets literally (and re-asks if
unclear).

**Notify-first for the 15-poll stall gate.** Most gates in this skill
are immediate — the operator is present in chat when they fire, so a
chat question is sufficient. The **Step 5 15-poll stall decision** is
the exception: it fires ≥15 min into COB, potentially after the
operator has stepped away. For that gate **only**, invoke the sibling
`transact-send-msg` skill **before** posing the chat question so the
operator can be pinged back to the session to answer. The sibling
skill is best-effort and is customised per site (Teams, Slack,
webhook, or a no-op stub); if it errors or is absent, surface the
error verbatim and pose the chat question alone. Never block the
chat question on the notification.

---

## Pre-flight

1. **Transact MCP reachable?** A zero-arg call to `transact-context`, or
   a cheap `ofs-enquiry %DATES`, is enough to confirm. If neither
   responds, STOP and tell the user the Transact MCP must be connected.
2. **`transact-send-msg` sibling skill.** Best-effort — the skill is
   on disk if configured, but each site's implementation may be a
   no-op stub. Do not pre-flight it aggressively; it will be invoked
   at the 15-poll stall gate (Step 5) and in Step 6. If it errors or
   is absent, surface verbatim and continue — the batch will still
   run and completion will be reported in chat.

---

## Step 1 — Validate dates and current stage (quick check)

**Goal:** confirm today's date, the next working day, and that the
target company is currently Online. If `CO.BATCH.STATUS` is anything
other than `O`, some form of COB is already mid-flight and starting
another one is wrong.

```
ofs-enquiry { enquiry: "%DATES" }
```

The rows returned are one per company plus `<COMPANY.CODE>-COB`
companions that can be ignored for this check. For the target company,
read the detail:

```
ofs-read { application: "DATES", id: "<COMPANY.CODE>" }
```

Inspect and report to the user in one line. Check:

| Field | What to check |
|-------|---------------|
| `TODAY` | business date about to be closed (YYYYMMDD) |
| `NEXT.WORKING.DAY` | the date the system will roll to |
| `LAST.WORKING.DAY` | previous business day — sanity check |
| `CO.BATCH.STATUS` | **must be `O`** — any other value means COB is already in flight or halted mid-stage |
| `CURRENT.DAY` | usually `NORMAL`; values like `MONTH.END` / `YEAR.END` mean extra work is queued |

**Abort conditions:**
- `CO.BATCH.STATUS` is not `O` → STOP. Tell the user the company is
  currently in stage `<value>`; starting a fresh COB now would collide
  with the in-flight one. Ask them to investigate (likely a previous COB
  halted).
- `TODAY` is not what the user expected to be closing → flag the
  mismatch and pause for explicit confirmation before continuing.

---

## Step 2 — Confirm the target company

**Goal:** be crystal-clear about which company's COB is being kicked off.
Transact installs are almost always multi-company; guessing is unsafe.

- If the user supplied a `COMPANY.CODE` as the skill argument: echo it
  back and proceed.
- Otherwise, from the `%DATES` result in Step 1, enumerate the distinct
  `@ID` values whose ID does **not** end in `-COB`:
  - **Exactly one** → proceed with it; state explicitly: "Single company
    detected: `<id>`."
  - **More than one** → ASK the user which one, via the
    structured-question mechanism described in "Harness interaction".
    On Claude Code, build an `AskUserQuestion` call with up to 3 of
    the discovered `COMPANY.CODE` values as labelled options (each
    `description` = `TODAY=<value>, CO.BATCH.STATUS=<value>`); the
    auto-`Other` slot covers envs with more than 3 companies (the
    operator types the code literally). Do not proceed without an
    explicit selection or a free-text reply that unambiguously names
    one company — re-ask if the reply is ambiguous.
  - **Zero** → STOP; something is wrong with the environment.

**Note on COB scope.** `TSA.SERVICE/COB` is a single record (not
`COB.<COMPANY>`) and tSA runs it against every company configured for
COB. The company argument in this skill selects **which `DATES` record
the skill watches** for progression — COB itself is environment-wide.
If an install uses a bespoke per-company service name, the user must
name it explicitly and the skill reads that record instead of `COB`.

---

## Step 3 — Verify the COB service is idle (read-only)

**Goal:** last look-only step before mutating. Confirm that
`TSA.SERVICE/COB` is not already running or queued.

```
ofs-read { application: "TSA.SERVICE", id: "COB" }
```

Inspect:

| Field | Idle-state expectation |
|-------|------------------------|
| `SERVICE.CONTROL` | `STOP` (fully idle) or `AUTO` (schedule-driven). **Must NOT be `START`.** |
| `STARTED(mv=1)` / `STOPPED(mv=1)` | Both populated, with `STOPPED` ≥ `STARTED`. If `STARTED` is populated and `STOPPED` is blank, a run is in flight. |
| `ELAPSED(mv=1)` / `TRANSACTIONS(mv=1)` | Informational — last run's duration and transaction count; useful baseline for ETA messaging. |

Also fetch a first monitor snapshot — this both confirms the enquiry is
available on the target env and establishes a baseline:

```
ofs-enquiry { enquiry: "EB.API.COB.MONITOR.2.1.0" }
```

Expect every stage row to carry `PROCESS.STATUS = Pending` and
`PERCENTAGE = 0` when COB is idle.

Probe for the `RAD` VERSION record. `VERSION` record IDs use a comma
(e.g. `TSA.SERVICE,RAD`), which the MCP's current `ofs-read` encoder
misframes — use the enquiry path instead:

```
ofs-enquiry {
  enquiry:   "%VERSION",
  selection: [ { field: "@ID", operator: "EQ", value: "TSA.SERVICE,RAD" } ]
}
```

- **One row returned** → RAD exists. Plan the **RAD path** in Step 4
  (single auto-authorising `ofs-input`).
- **Zero rows** → RAD is not configured for `TSA.SERVICE` on this env.
  Plan the **classic path** (two-call input → authorise). Warn the user:
  > "No `TSA.SERVICE,RAD` version on this env — falling back to the
  >  two-call input+authorise flow. Expect a blocker if the MCP
  >  credential is both inputter and authoriser; resolve via operator
  >  triage (Browser-UI authorise, or configure a separate authoriser
  >  credential)."
- **Enquiry error** → surface verbatim and STOP.

**Abort conditions:**
- `SERVICE.CONTROL=START` → COB already running. STOP; tell the user and
  offer to skip ahead to the monitoring loop (Step 5) on the existing
  run.
- `STARTED(mv=1)` populated, `STOPPED(mv=1)` blank → same as above.
- `SERVICE.CONTROL=AUTO` → a schedule is driving COB; a manual start
  would race with the scheduler. STOP and ask the user whether they
  really want a manual start.
- Any monitor-enquiry stage already shows `Running` — STOP; COB is in
  progress despite appearances.

### Capture baseline cursors for the Step 5 completion gate

Before the go/no-go below, pin these pre-run values in working notes —
Step 5's completion gate compares against them **by name**, so the
names matter. These values are immutable inputs to the gate; do not
recompute them mid-run.

| Cursor | Source | Purpose |
|--------|--------|---------|
| `pre_stopped_mv1` | Step-3 read of `TSA.SERVICE/COB.STOPPED(mv=1)` | Anchor for "a newer STOP has been recorded" (gate line `e`). The value here is the **previous** run's stop timestamp; the next successful run pushes a newer value into `mv=1`. |
| `pre_today` | Step-1 read of `DATES/<COMPANY.CODE>.TODAY` | The business date being closed. Used in the Step-6 summary, and as a sanity anchor (the new `TODAY` must differ from this). |
| `expected_new_today` | Step-1 read of `DATES/<COMPANY.CODE>.NEXT.WORKING.DAY` | The date `TODAY` must roll to on success (gate line `g`). |
| `completed_token` | Default: literal `Completed`. On the first Running→terminal monitor transition observed in Step 5, reconcile to whatever literal the enquiry reports and keep it for the run. | Gate lines `a`, `c` check a literal string, not a concept. |

At the end of Step 3, restate the plan explicitly (including which
write path — RAD or classic — was chosen) and ask the user for a
**final go/no-go** via the structured-question mechanism
(see "Harness interaction").

Chat preamble (print before the question so the gate block has
context):

> Ready to start COB:
> - Company: `<COMPANY.CODE>` (today `<TODAY>`, next `<NEXT.WORKING.DAY>`, stage `O`)
> - Service `TSA.SERVICE/COB` is idle (last run `<STOPPED mv=1>`, elapsed `<ELAPSED mv=1>`, txn count `<TRANSACTIONS mv=1>`)
> - Monitor snapshot: all stages `Pending`
> - Write path: **RAD** (single auto-authorising input) — or — **classic** (ofs-input → ofs-authorise)
> - Next step will set `SERVICE.CONTROL = START` on `TSA.SERVICE/COB`.

Structured question — two labelled options plus auto-`Other`:

| Label | Description |
|-------|-------------|
| `Yes, start COB (Recommended)` | Proceed to Step 4 and set `SERVICE.CONTROL = START` on `TSA.SERVICE/COB`. |
| `No, abort` | Stop here; do not mutate `TSA.SERVICE/COB`. Report "COB start cancelled at Step 3 go/no-go" and exit the skill. |
| *(auto-`Other`)* | Operator types a free-text instruction — e.g. "wait 10 min", "switch to classic path", "check <record> first". Interpret literally; if ambiguous, re-ask. |

Only a literal `Yes, start COB` selection, or an unambiguous
free-text equivalent, advances to Step 4. Anything else (including
no reply) holds at Step 3.

---

## Step 4 — Start COB

Take the branch chosen during Step 3 (RAD probe).

### 4a — RAD path (preferred)

Single mutating call. `ofs-input` with `version: "RAD"` routes through
the `TSA.SERVICE,RAD` version record — on a properly-configured env
this auto-authorises the write, so no separate `ofs-authorise` step is
needed.

```
ofs-input {
  application: "TSA.SERVICE",
  id:          "COB",
  version:     "RAD",
  fields:      [ { name: "SERVICE.CONTROL", value: "START" } ],
  confirm:     true
}
```

Expected result: `statusCode: 1`, `state: "live"`, `SERVICE.CONTROL = START`
on the returned record.

`state` is derived from the response body — the MCP's `StateFromResponse`
reports `live` iff the server genuinely committed (AUTHORISER populated
and/or RECORD.STATUS absent / CAU / LIVE). If it reports `state: "unauthorised"`,
the RAD version on this env did **not** auto-authorise — fall through to
4b's `ofs-authorise` step to complete the start. No re-read is needed
before deciding; the state is trustworthy.

### 4b — Classic path (fallback when RAD is absent or non-auto-auth)

Two mutating calls. First stage the write:

```
ofs-input {
  application: "TSA.SERVICE",
  id:          "COB",
  fields:      [ { name: "SERVICE.CONTROL", value: "START" } ],
  confirm:     true
}
```

Expect `state: "unauthorised"`, `RECORD.STATUS = INAU`. Then authorise:

```
ofs-authorise {
  application: "TSA.SERVICE",
  id:          "COB",
  confirm:     true
}
```

Expect `statusCode: 1` and `state: "live"`.

**Same-name-authoriser blocker.** If `ofs-authorise` returns
`statusCode: -1` with `EB.RTN.SAME.NAME.AUTHORISER/INPUTTER`, the MCP
credential is both inputter and authoriser and the site requires the
override to be acknowledged. The current MCP does not expose the
override-accept flow. STOP and surface the situation via the
structured-question mechanism (see "Harness interaction"):

| Label | Description |
|-------|-------------|
| `Browser-UI authorised — resume at Step 5` | A second user has authorised `TSA.SERVICE/COB` in the Transact Browser UI; the skill picks up at Step 5 monitoring on the now-LIVE record. |
| `Abort and configure RAD` | Stop here; operator will add a `TSA.SERVICE,RAD` VERSION record (`AUTO.AUTHORISATION.STATUS = YES`) so future runs take path 4a. Skill exits cleanly. |
| *(auto-`Other`)* | Operator types a site-specific recovery action (e.g. "authorise from a different credential and continue"). Interpret literally; if ambiguous, re-ask. |

Do NOT attempt to roll back the INAU record automatically regardless
of which option the operator picks — the staged record's disposition
is an operator decision.

### Common post-step

Regardless of path, record the wall-clock start time locally — this is
the anchor for duration reporting in the final summary. If either call
in either path returns `overrides[]` entries, surface them verbatim and
pause for explicit operator acknowledgement before moving to Step 5.

---

## Step 5 — Monitor to completion (polling loop)

Poll every **60 seconds** until a success or failure criterion fires. Do
not stop or summarise between polls — one short status line per tick.

### How to poll — background heartbeat + `Monitor`

The driving model **is** the polling loop — there is no separate
scheduler. Use a **background heartbeat streamed via `Monitor`** as
the one pattern. Empirical evidence: every harness tested (Claude
Code at minimum) blocks a standalone `sleep 60` with a message
pointing you at Monitor anyway, so do not waste a turn trying the
foreground-sleep shape.

Start a `Monitor` task, `persistent: true`, running the command:

```
while true; do sleep 60; date -Is; done
```

Each heartbeat line arrives as a notification. On every notification,
fire **one** set of MCP reads (monitor enquiry + TSA read, in
parallel), process them, then return to waiting. The heartbeat is
the clock; do not sleep or poll between notifications.

The **first action of Step 6** must be to call `TaskStop` on this
heartbeat task — do not leave it running after the loop exits.

Do **not** use any of these mechanisms:

- **Foreground `sleep 60` between MCP calls.** Blocked by the
  harness; do not chain shorter sleeps to try to work around the
  block.
- **`ScheduleWakeup` / `CronCreate`.** Those are for `/loop` dynamic
  mode and remote cron triggers; neither applies inside a skill run.
- **Back-to-back MCP calls with no wait.** Hammers the Transact
  server and breaks the 60 s cadence the monitor enquiry is designed
  for.
- **Sub-agent delegation of the loop.** This skill owns the
  operator-confirmation gate from Step 3; a fresh sub-agent context
  would lose it.

The sections below describe **what to do on each poll**.

### When you may stop polling — and only then

There are exactly **three** permitted exits from this loop:

1. The **Completion Gate** below evaluates `true` on every line for
   the SAME poll → proceed to Step 6 success path.
2. A **Failure / halt criterion** below fires → proceed to Step 6
   failure path.
3. The operator explicitly aborts — either (a) by selecting
   `Abort — stop monitoring` at the 15-poll stall gate (see
   "Stall-level reassurance — 15-poll BATCH check"), or (b) by
   typing something unambiguously equivalent to "stop" / "abort" /
   "pause" / "cancel" in chat at any time. Acknowledge, stop polling,
   and route through Step 6 halt path with `Cause: Operator-initiated
   abort` (not a tSA failure). An ambiguous chat message is **not** a
   stop instruction — when in doubt, keep polling and re-ask via the
   structured-question mechanism.

You MAY NOT stop polling because:

- **A single stage reached `Completed`.** COB has 5 monitor stages;
  one of them (or four of them) finishing is not completion. Only
  when every row — including `ONLINE` — is at `completed_token` and
  100% is the monitor-side condition met.
- **Percentages "look high".** 99% on every stage is still not done;
  the gate requires the literal `100` + `completed_token` on every
  row, **plus** the TSA and DATES side-effects captured below.
- **The monitor's timestamp row advanced.** That happens every tick;
  it is not a progress or completion signal.
- **The session feels long / context is growing.** COB routinely runs
  30+ minutes and sometimes exceeds 2 hours; this skill is a foreground
  operation and is expected to dominate the session. Neither elapsed
  wall-clock nor context size is a stop signal.
- **You "believe" COB is done.** If you catch yourself writing
  "COB appears to have completed" or "it looks like COB finished",
  stop — that wording is a hallucination of completion. Re-check the
  gate literally against **this poll's** data; if any line is not
  `true`, COB is not done.

Every tick ends with exactly one of: (a) a single status line +
continue, (b) a gate-evaluation block with at least one non-`true`
row + continue, (c) the 15-poll BATCH stall sub-sequence
(reassurance line → `transact-send-msg` notification → structured ask),
whose outcome is either "continue monitoring" or permitted exit #3,
or (d) permitted exit #1 (Completion Gate passes) or #2 (Failure
criterion fires). No fifth option exists.

### Primary monitor — `EB.API.COB.MONITOR.2.1.0`

Each tick:

```
ofs-enquiry { enquiry: "EB.API.COB.MONITOR.2.1.0" }
```

The response rows are:
- Row 0: a timestamp header (e.g. `HH:MM:SS DD MON YYYY` in cell 0).
- Rows 1..N: one per stage — `BATCH.STAGE` (stage name), `PERCENTAGE`
  (integer 0..100), `PROCESS.STATUS` (e.g. `Pending`, `Running`,
  `Completed`; exact vocabulary comes from the enquiry itself — do
  not hard-code).

Condense to a single status line per tick. The **active stage** in
the template below is the monitor row whose `PROCESS.STATUS` is
`Running` on this tick. If no row is `Running` (a transient
between-stages window), pick the earliest `Pending` row in
response-row order.

```
[HH:MM] <active stage name> <pct>%  status=<status>  (APPLICATION=<s> SYSTEM=<s> REPORTING=<s> SOD=<s> ONLINE=<s>)
```

**Track state transitions**, not raw values — highlight when a stage
flips from `Pending` → `Running` or `Running` → `Completed`.

Maintain three cursors across polls:

- `pct_poll_index` — the poll at which the **active stage's
  `PERCENTAGE`** was last observed to change.
- `last_batch_signature` — the running-job signature captured the
  last time the 15-poll check below fired; `null` until then.
- `has_run_observed` — `false` at start. Flips to `true` on the
  first poll at which **any** monitor row's `PROCESS.STATUS` is not
  `Pending` (i.e. we have seen tSA make visible progress). Once
  `true`, never flips back. Used by the monitor-reset completion
  path (Path B) below to distinguish "pre-start idle" (all Pending
  because nothing has run yet) from "post-completion idle" (all
  Pending because the run finished and the monitor reset).

### Stall-level reassurance — 15-poll BATCH check

When the active stage's `PERCENTAGE` has not advanced for **15
consecutive polls** (≈15 min), fire a secondary enquiry against the
`BATCH` application to see which job is actually grinding:

```
ofs-enquiry {
  enquiry:   "%BATCH",
  selection: [ { field: "PROCESS.STATUS", operator: "EQ", value: "1" } ]
}
```

`PROCESS.STATUS = 1` is the "Running" code (HELP.TEXT: `0 Ready, 1
Running, 2 Completed, 3 On hold / in error`). Each returned BATCH
carries parallel multi-values `JOB.NAME(mv)` and `JOB.STATUS(mv)` —
the status at position *N* describes the job named at position *N*.
Build a running-job signature with **one entry per running-job
position** (not a concatenation): iterate each returned BATCH, walk
its multi-value positions, and for every position where
`JOB.STATUS(mv=N) == 1` emit one string. A BATCH with three running
jobs contributes three entries; a BATCH with no `JOB.STATUS==1`
positions contributes none.

```
signature = sorted set of strings, one per running position, each
            formatted as "<BATCH.@ID>:<JOB.NAME at that position>"
```

Branch on what `%BATCH` returned:

- **Zero rows with `PROCESS.STATUS=1`.** Nothing is running but the
  monitor shows an active stage that has not progressed. This is a
  suspected halt — do **not** emit a reassurance line; let the 30-poll
  hard-halt criterion (below) fire, or escalate now if the situation
  is clearly wrong. Leave `last_batch_signature` unchanged.
- **One or more running jobs, signature is non-empty.** COB is still
  grinding on a long job. Drive the following four-step sub-sequence
  on the same tick, in order:

  1. **Emit the chat reassurance line.**

     > `[HH:MM] COB on <JOB.NAME(s)> in BATCH <BATCH.@ID(s)> for ≥15 min without % advancing. Likely long-running, not a halt.`

     If any returned BATCH row carries `LOCK.RETRY.COUNT > 0`, append
     `LOCK.RETRY.COUNT=<value> on <BATCH.@ID>` verbatim — it is the
     earliest sign of lock contention and the one signal operators
     want to see before the 30-poll halt fires.

  2. **Out-of-chat notification via `transact-send-msg`.** Before
     posing the chat question, invoke the sibling `transact-send-msg`
     skill so the operator sees the stall even if they have stepped
     away from chat. Pass the following multi-line string verbatim
     as the skill's `message` argument:

     ```
     COB stall reassurance — <COMPANY.CODE>
     Job(s): <JOB.NAME(s)> in BATCH <BATCH.@ID(s)>
     Stalled ≥15 min without % advancing on stage <active stage>.
     LOCK.RETRY.COUNT: <value or "0">
     Action required in chat: continue monitoring or abort?
     ```

     The send must **not** block the chat question — fire it, then
     proceed to step 3 on the same tick without waiting for any
     response. If the sibling skill errors or is a no-op stub,
     surface any error verbatim and continue to step 3 anyway. The
     chat question below is the authoritative gate;
     `transact-send-msg` is notification only.

  3. **Pose the continue-or-abort question** via the
     structured-question mechanism (see "Harness interaction"):

     | Label | Description |
     |-------|-------------|
     | `Continue monitoring (Recommended)` | Keep polling; COB is on a known long-running job. The next 15-poll check fires 15 polls from now. |
     | `Abort — stop monitoring` | Operator decides COB is stuck or wants to intervene. Skill exits the loop and routes through Step 6 halt path as an operator-initiated abort (not a tSA failure). The skill does NOT attempt to stop `TSA.SERVICE/COB` — operator owns recovery. |
     | *(auto-`Other`)* | Operator types a free-text instruction (e.g. "wait 30 more min then re-ask", "check <specific record>"). Interpret literally; re-ask if it does not unambiguously mean continue or abort. |

  4. **Branch on the answer:**

     - `Continue monitoring` → store the new `signature` as
       `last_batch_signature`, set `pct_poll_index` to the current
       poll so the next check fires 15 polls later (not on the next
       tick), and resume polling.
     - `Abort — stop monitoring` → permitted exit #3 of "When you may
       stop polling". Exit the loop and route through Step 6 halt
       path; set the Step 6 `Cause:` line to
       `Operator-initiated abort at 15-poll stall gate`. Do not
       emit a tSA failure-criterion label.
     - *Other* → interpret literally; either resume polling with an
       explicit plan ("will re-ask at poll N"), exit via the abort
       branch, or re-pose the question if the reply is ambiguous.

  The sub-sequence runs on every 15-poll fire regardless of whether
  `signature` matches or differs from `last_batch_signature` — a
  match is the "same job for another 15 min" case the operator
  wants re-asked; a differing signature means progress is happening
  below the monitor's %-rounding, and the new job name is still
  informative.

The 15-poll check is a reassurance / early-triage tool. It does **not**
replace the 30-poll halt criterion below — that still fires
independently on continued `PERCENTAGE` stall, regardless of what
`%BATCH` reports.

### Secondary confirm — `TSA.SERVICE/COB` (every tick)

```
ofs-read { application: "TSA.SERVICE", id: "COB" }
```

Used to corroborate start and end transitions (`SERVICE.CONTROL`,
`STARTED` / `STOPPED` MV arrays). The enquiry is authoritative for
progress; this read confirms service-level start/stop state.

### Suspected-completion trigger — when to evaluate the gate

There are **two** signals that warrant evaluating the Completion
Gate below. Either is sufficient; you do **not** need to wait for
both. Record which path fired — the gate's a/b/c lines are
evaluated differently depending on the path.

- **Path A — terminal `ONLINE` snapshot.** On a single poll, the
  `ONLINE` row of `EB.API.COB.MONITOR.2.1.0` reaches **both**
  `PROCESS.STATUS == completed_token` **and** `PERCENTAGE == 100`.
  This is the textbook signal, but on most envs this state persists
  for only a fraction of a second before the monitor resets — so it
  is common **not** to observe it at all. If you do see it, use
  Path A.
- **Path B — monitor reset after an observed run.** On a single
  poll, **every** monitor row reports `PROCESS.STATUS == "Pending"`
  at `PERCENTAGE == 0`, **and** `has_run_observed == true` (we saw
  non-Pending activity earlier in this run), **and** this tick's
  `TSA.SERVICE/COB` read shows `SERVICE.CONTROL ∈ {STOP, AUTO}`.
  This is the monitor's "nothing running" shape — which before the
  run means "not yet started" but after `has_run_observed` means
  "run finished and the monitor reset". The SERVICE.CONTROL check
  rules out a transient mid-run monitor hiccup (where the monitor
  momentarily reports all-Pending while tSA is still `START`).

Before `has_run_observed` flips to `true`, Path B cannot fire and
the skill will not mistake the pre-start idle baseline for
completion. Until either path fires, keep polling.

When either path fires, on the same poll:

1. Fire one additional read to confirm the date roll:

   ```
   ofs-read { application: "DATES", id: "<COMPANY.CODE>" }
   ```

2. Re-read the service record to pick up the freshly-prepended
   `STOPPED` MV row (skip if the per-tick TSA read already captured
   a fresh `STOPPED(mv=1)`):

   ```
   ofs-read { application: "TSA.SERVICE", id: "COB" }
   ```

3. Evaluate the Completion Gate (below) against this poll's data,
   using the path-specific rule for lines a/b/c. If any gate line
   is `false` or `?`, discard the evaluation and resume polling —
   the trigger fired but the side-effects haven't caught up yet.
   They usually do within one or two more ticks.

### Completion gate — the ONLY permitted reason to exit successfully

On the poll on which the suspected-completion trigger fires, print
the following block verbatim, filling each `___` with the literal
word `true`, `false`, or `?` (use `?` when a field is missing or
unreadable from the response). Do not paraphrase rows; do not skip
rows; do not tick a row `true` because "it obviously is". The
`— triggered via Path <A|B>` tag on the header must name the path
that fired:

```
[completion-gate @ HH:MM  — triggered via Path <A|B>]
 a. monitor.ONLINE row at terminal-success                         : ___
 b. monitor.ONLINE row at 100%                                     : ___
 c. every other monitor row at terminal-success                    : ___
 d. TSA.SERVICE/COB.SERVICE.CONTROL   in {STOP, AUTO}              : ___
 e. TSA.SERVICE/COB.STOPPED(mv=1)     !=  pre_stopped_mv1          : ___
 f. DATES.<CO>.CO.BATCH.STATUS        == "O"                       : ___
 g. DATES.<CO>.TODAY                  == expected_new_today        : ___
```

**How lines a/b/c are filled depends on the path that fired:**

- **Path A fired** (terminal `ONLINE` snapshot observed this tick) —
  evaluate a/b/c literally against this tick's monitor rows:
  - a: `monitor.ONLINE.PROCESS.STATUS == completed_token` → `true`/`false`
  - b: `monitor.ONLINE.PERCENTAGE == 100` → `true`/`false`
  - c: every non-ONLINE monitor row's `PROCESS.STATUS == completed_token` → `true`/`false`
- **Path B fired** (monitor reset to all-Pending@0 after an
  observed run) — the monitor-reset signal itself is the proof that
  every stage reached terminal-success (the monitor cannot be in
  this shape unless tSA finished the cycle and rolled it back). Mark
  **all three** of a/b/c `true` by construction. Do **not** mark
  them `?`: the path's precondition (`has_run_observed == true`
  AND all rows Pending@0 AND `SERVICE.CONTROL ∈ {STOP, AUTO}`)
  already substitutes for observing each stage's terminal tick.

Lines d–g evaluate identically on both paths: literal reads of
this tick's TSA and DATES values.

Then branch:

- **Any row is `false` or `?`** → discard the gate block, emit the
  normal per-tick status line, and resume polling on the next tick.
  Do NOT move to Step 6. A partial gate is not completion.
- **All 7 rows are `true`** → COB finished cleanly. Proceed to Step
  6 success path.

All seven lines must be evaluated from reads taken **on this tick**
(the monitor enquiry + the DATES and TSA.SERVICE reads fired by the
trigger above) — never mix in values from an earlier poll.

### Failure / halt criteria — ANY of:

- Any row of the monitor enquiry reports a failure / halt status (values
  other than `Pending`, `Running`, `Completed`; surface verbatim).
- The currently-running stage's `PROCESS.STATUS` flips away from
  `Running` without reaching `Completed`.
- `SERVICE.CONTROL` flips to a non-`START` value **without**
  `STOPPED(mv=1)` advancing (halted without a clean close).
- The monitor `PERCENTAGE` for the active stage has not advanced in
  > 30 consecutive polls (≈30 min) — likely stuck on a locked record or
  a hard error.
- Any MCP call returns `statusCode < 0` or `errors[]` three consecutive
  times — treat the connection as broken.

On any failure criterion:

1. STOP polling.
2. Report the last known state verbatim — raw fields from both the
   monitor enquiry and `TSA.SERVICE/COB`. Do not paraphrase.
3. Do NOT attempt to roll back or restart COB automatically. COB
   recovery is site-specific — the operator decides whether to resolve
   the offending record and resume, re-run from a stage, or escalate.
4. Send the failure notification via the `transact-send-msg` skill
   (Step 6).

---

## Step 6 — Report outcome

### On success

Chat summary (keep to one compact block):

```
COB completed for <COMPANY.CODE>
  Date closed:    <original TODAY>
  New TODAY:      <DATES.TODAY after roll>
  Started:        <TSA.COB.STARTED(mv=1)>
  Stopped:        <TSA.COB.STOPPED(mv=1)>
  Elapsed:        <TSA.COB.ELAPSED(mv=1)>
  Transactions:   <TSA.COB.TRANSACTIONS(mv=1)>
  Wall-clock:     <end − start>  (skill start to completion detection)
```

Out-of-chat notification via the sibling `transact-send-msg` skill
(best-effort; if the skill errors or is a no-op stub, surface any
error verbatim and note "out-of-chat notification skipped" in the
chat summary). Pass the following as the `message` argument verbatim:

```
COB Completed — <COMPANY.CODE>
Date closed: <original TODAY> → <new TODAY>
Elapsed (tSA): <ELAPSED mv=1>
Transactions: <TRANSACTIONS mv=1>
```

### On failure / halt

Chat summary:

```
COB HALTED for <COMPANY.CODE>
  Cause:                 <one of: "tSA failure criterion <which>", "Operator-initiated abort at 15-poll stall gate", "Operator-initiated abort via chat">
  Monitor rows (last snapshot):
    <stage>  <pct>%  <status>
    ...
  SERVICE.CONTROL:       <value>
  STARTED(mv=1):         <value>
  STOPPED(mv=1):         <blank or value>
  Detected at:           <HH:MM>
  Next action:           operator triage — no auto-recovery attempted
```

Out-of-chat notification via the sibling `transact-send-msg` skill
(same best-effort semantics as the success path). Pass the following
as the `message` argument verbatim:

```
COB HALTED — <COMPANY.CODE>
Cause: <one of: tSA failure / operator abort at 15-poll gate / operator abort via chat>
Stage: <active stage> <pct>% <status>
Service control: <value>
Detected at: <timestamp>
Operator action required.
```

---

## Output discipline (for the driving model)

- Steps 1–3 are read-only; take them without asking. Asking for
  confirmation at each read is noise.
- Step 3's final go/no-go **is** a hard gate — do not infer consent.
- Inside the monitoring loop (Step 5): one status line per poll. No
  paragraphs, no "still monitoring" unless the 15-poll BATCH-signature
  reassurance trigger fires.
- The ONLY exits from the Step 5 polling loop are (a) the Completion
  Gate evaluates all-`true` on the SAME poll, (b) a Failure criterion
  fires, or (c) the operator explicitly says stop. Do not synthesise a
  fourth exit. If you find yourself narrating "COB appears to have
  completed" without having printed a 7/7-`true` gate block on this
  poll, you are about to stop for an invalid reason — re-poll instead.
- Never silently swallow an `errors[]` entry from any MCP response —
  surface it verbatim.
- If a tool returns `statusCode < 0`, treat the call as failed
  regardless of content, and fall through to the failure path.

---

## Known limitations

- **Single COB service assumed.** If the install uses a non-standard
  service name, pass it explicitly and the skill reads that record
  instead of `COB`.
- **RAD is site-configured.** A `VERSION TSA.SERVICE,RAD` record does
  not guarantee auto-auth — some sites ship `NO.OF.AUTH != 0`. The
  skill detects that via `state: "unauthorised"` on the post-input
  response and falls through to the classic authorise step.
