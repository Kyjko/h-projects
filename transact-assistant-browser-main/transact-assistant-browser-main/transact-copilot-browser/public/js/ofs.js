import {
  addOFSMessage,
  clearOFSQueue,
  generateOFSMessage,
  getOFSStatus,
  loadOFSQueue,
  runOFSMessage,
  validateOFSMessage,
} from "./api.js";

const $ = (selector) => document.querySelector(selector);

function node(tag, className = "", text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function isReadMessage(message) {
  const header = String(message || "").split(",")[1] || "";
  return header.split("/")[1]?.trim().toUpperCase() === "S";
}

export function initializeOFS() {
  const generator = $("#ofs-generator-form");
  const editor = $("#ofs-message-editor");
  const queueList = $("#ofs-queue-list");
  const operationStatus = $("#ofs-operation-status");
  const operationResult = $("#ofs-operation-result");
  let queueRows = [];
  let running = false;
  let stopAfterCurrent = false;

  function setStatus(message, isError = false) {
    operationStatus.textContent = message;
    operationStatus.classList.toggle("error", isError);
  }

  function setBusy(busy) {
    running = busy;
    generator.querySelector("button[type=submit]").disabled = busy;
    for (const id of ["ofs-validate", "ofs-add-queue", "ofs-run-manual", "ofs-load-queue", "ofs-run-all", "ofs-clear-queue"]) {
      $(`#${id}`).disabled = busy;
    }
    $("#ofs-run-all").disabled = busy || queueRows.length === 0;
    queueList.querySelectorAll("button").forEach((button) => { button.disabled = busy; });
    $("#ofs-stop-all").hidden = !busy;
    $("#ofs-stop-all").disabled = !busy;
  }

  function showResult(result, title, container = operationResult) {
    container.hidden = false;
    container.replaceChildren();
    container.append(node("strong", "ofs-result-title", title));
    if (result !== undefined) {
      const pre = node("pre", "ofs-result-data");
      pre.textContent = JSON.stringify(result, null, 2);
      container.append(pre);
    }
  }

  async function refreshDatabaseStatus() {
    const state = $("#ofs-database-state");
    const detail = $("#ofs-database-detail");
    state.textContent = "Checking database…";
    state.className = "ofs-database-state";
    try {
      const result = await getOFSStatus();
      state.textContent = result.status === "connected" ? "PostgreSQL connected" : "PostgreSQL unavailable";
      state.classList.add(result.status === "connected" ? "connected" : "failed");
      detail.textContent = result.detail;
      const profile = result.messageProfile;
      if (profile) {
        const company = profile.company || "(default)";
        $("#ofs-message-profile").textContent = `${profile.noOfAuth} / ${company}`;
        if (!profile.passwordConfigured) {
          detail.textContent += " OFS_MESSAGE_PASSWORD is not configured; message generation and execution are disabled.";
        }
      }
    } catch (error) {
      state.textContent = "PostgreSQL unavailable";
      state.classList.add("failed");
      detail.textContent = error.message;
    }
  }

  async function execute(request, label, manageBusy = true, resultHost) {
    if (manageBusy) setBusy(true);
    setStatus(`${label} — validating through Transact…`);
    operationResult.replaceChildren();
    try {
      const response = await runOFSMessage(request);
      const read = response.operation === "S";
      const state = response.result?.state || "unknown";
      setStatus(read ? "Read completed; the Transact record is displayed below." : `Transact returned state: ${state}.`, false);
      showResult(response.result, label, resultHost || operationResult);
      return response;
    } catch (error) {
      setStatus(error.message, true);
      showResult(error.details || { error: error.message }, "OFS execution failed", resultHost || operationResult);
      return null;
    } finally {
      if (manageBusy) setBusy(false);
    }
  }

  function renderQueue(rows) {
    queueRows = rows;
    queueList.replaceChildren();
    $("#ofs-queue-status").textContent = `${rows.length.toLocaleString()} OFS message(s) loaded from F_OFS_MESSAGE_QUEUE. Function I inputs and function S reads are supported.`;
    $("#ofs-run-all").disabled = running || rows.length === 0;
    for (const row of rows) {
      const item = node("article", "ofs-queue-item");
      item.dataset.recid = row.recid;
      const heading = node("div", "ofs-queue-item-heading");
      heading.append(node("strong", "", row.recid));
      const status = node("span", "ofs-queue-item-status", "Ready");
      heading.append(status);
      const message = node("pre", "ofs-queue-message", row.message);
      const actions = node("div", "ofs-queue-item-actions");
      const resultHost = node("div", "ofs-queue-item-result");
      resultHost.hidden = true;
      const run = node("button", "button button-secondary", "Run OFS");
      run.type = "button";
      run.addEventListener("click", async () => {
        const read = isReadMessage(row.message);
        if (!read && !window.confirm(`Submit queue message ${row.recid} as a Transact input? This may create or amend a live record.`)) return;
        status.textContent = "Running…";
        status.className = "ofs-queue-item-status running";
        const outcome = await execute({ recid: row.recid }, `Queue message ${row.recid}`, true, read ? resultHost : undefined);
        const succeeded = Boolean(outcome);
        status.textContent = succeeded ? (read ? "Read" : "Submitted") : "Failed";
        status.className = `ofs-queue-item-status ${succeeded ? "completed" : "failed"}`;
      });
      actions.append(run);
      item.append(heading, message, actions, resultHost);
      queueList.append(item);
    }
  }

  async function loadQueue() {
    $("#ofs-load-queue").disabled = true;
    $("#ofs-queue-status").textContent = "Loading all queue rows…";
    try {
      const result = await loadOFSQueue();
      $("#ofs-queue-status").classList.remove("error");
      renderQueue(result.rows || []);
    } catch (error) {
      $("#ofs-queue-status").textContent = error.message;
      $("#ofs-queue-status").classList.add("error");
      queueList.replaceChildren();
      queueRows = [];
    } finally {
      $("#ofs-load-queue").disabled = running;
    }
  }

  generator.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await generateOFSMessage({
        application: $("#ofs-application").value,
        version: $("#ofs-version").value,
        function: $("#ofs-function").value,
        id: $("#ofs-record-id").value,
        data: $("#ofs-message-data").value,
      });
      editor.value = result.message;
      setStatus("Generated an OFS message. Validate it before adding it to the queue or running it.");
      showResult(undefined, "Message generated");
    } catch (error) {
      setStatus(error.message, true);
    }
  });
  $("#ofs-function").addEventListener("change", () => {
    const read = $("#ofs-function").value === "S";
    const data = $("#ofs-message-data");
    data.disabled = read;
    data.required = !read;
    if (read) data.value = "";
    data.placeholder = read ? "Not used for function S" : "FIELD=VALUE,FIELD:MV=VALUE";
    $("#ofs-version").disabled = read;
    if (read) $("#ofs-version").value = "";
  });

  $("#ofs-validate").addEventListener("click", async () => {
    setBusy(true);
    setStatus("Checking OFS syntax and Transact field validation…");
    operationResult.replaceChildren();
    try {
      const result = await validateOFSMessage(editor.value);
      setStatus(result.operation === "S"
        ? `Valid OFS read: ${result.application} · ${result.id}.`
        : `Valid OFS input: ${result.application} · ${result.id} · ${result.fieldCount} field assignment(s).`);
      showResult(result.result, "Transact validate-only response");
    } catch (error) {
      setStatus(error.message, true);
      showResult(error.details, "OFS validation failed");
    } finally {
      setBusy(false);
    }
  });

  $("#ofs-add-queue").addEventListener("click", async () => {
    setBusy(true);
    setStatus("Validating OFS message before adding it to the queue…");
    operationResult.replaceChildren();
    try {
      const result = await addOFSMessage(editor.value);
      setStatus(`Added to F_OFS_MESSAGE_QUEUE as ${result.recid}.`);
      showResult(result.validation, "Transact validate-only response");
      await loadQueue();
    } catch (error) {
      setStatus(error.message, true);
      showResult(error.details, "Queue insertion failed");
    } finally {
      setBusy(false);
    }
  });

  $("#ofs-run-manual").addEventListener("click", async () => {
    if (!isReadMessage(editor.value)
        && !window.confirm("Submit this OFS input to Transact? The message may create or amend a live record.")) return;
    await execute({ message: editor.value }, "Manual OFS message");
  });

  $("#ofs-load-queue").addEventListener("click", loadQueue);
  $("#ofs-database-refresh").addEventListener("click", refreshDatabaseStatus);
  $("#ofs-stop-all").addEventListener("click", () => {
    stopAfterCurrent = true;
    $("#ofs-stop-all").disabled = true;
    $("#ofs-queue-status").textContent = "Will stop after the current message completes.";
  });

  $("#ofs-run-all").addEventListener("click", async () => {
    if (!queueRows.length || running) return;
    if (!window.confirm(`Run all ${queueRows.length} loaded OFS messages sequentially? Function I messages may create or amend Transact records; function S messages only read records. Queue rows will not be removed.`)) return;
    setBusy(true);
    stopAfterCurrent = false;
    let completed = 0;
    let failed = 0;
    try {
      for (const row of queueRows) {
        if (stopAfterCurrent) break;
        const item = queueList.querySelector(`[data-recid="${CSS.escape(row.recid)}"]`);
        const status = item?.querySelector(".ofs-queue-item-status");
        const read = isReadMessage(row.message);
        const resultHost = item?.querySelector(".ofs-queue-item-result");
        if (status) {
          status.textContent = "Running…";
          status.className = "ofs-queue-item-status running";
        }
        const outcome = await execute({ recid: row.recid }, `Queue message ${row.recid}`, false, read ? resultHost : undefined);
        const succeeded = Boolean(outcome);
        if (succeeded) completed += 1;
        else failed += 1;
        if (status) {
          status.textContent = succeeded ? (read ? "Read" : "Submitted") : "Failed";
          status.className = `ofs-queue-item-status ${succeeded ? "completed" : "failed"}`;
        }
        $("#ofs-queue-status").textContent = `Run all progress: ${completed + failed}/${queueRows.length}; ${completed} completed, ${failed} failed.`;
      }
      if (stopAfterCurrent) {
        $("#ofs-queue-status").textContent += " Stopped after the current message.";
      } else {
        $("#ofs-queue-status").textContent = `Run all complete: ${completed} completed, ${failed} failed. Queue rows were retained.`;
      }
    } finally {
      setBusy(false);
      $("#ofs-run-all").disabled = queueRows.length === 0;
      $("#ofs-stop-all").hidden = true;
    }
  });

  $("#ofs-clear-queue").addEventListener("click", async () => {
    if (running) return;
    const count = queueRows.length;
    if (!window.confirm(`Permanently remove every row from F_OFS_MESSAGE_QUEUE${count ? ` (${count} currently loaded)` : ""}?`)) return;
    setBusy(true);
    try {
      const result = await clearOFSQueue();
      setStatus(`Cleared ${result.deletedCount.toLocaleString()} queue row(s).`);
      await loadQueue();
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      setBusy(false);
    }
  });

  return {
    open() {
      void refreshDatabaseStatus();
    },
  };
}
