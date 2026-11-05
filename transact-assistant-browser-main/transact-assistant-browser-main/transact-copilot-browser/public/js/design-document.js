import {
  editDesignDocument,
  getDesignDocumentProgress,
  getRecentAmendments,
} from "./design-document-api.js";

const $ = (selector) => document.querySelector(selector);
let amendments = [];
let directAmendments = [];
let active = false;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unknown date" : date.toLocaleString();
}

function amendmentLabel(entry) {
  return `${entry.application} > ${entry.recordId}`;
}

function selectedIds() {
  return [...document.querySelectorAll(".amendment-select:checked")].map((checkbox) => checkbox.value);
}

function selectedDocuments() {
  const selected = new Set(selectedIds());
  const directIds = new Set(directAmendments.map((entry) => entry.id));
  return {
    amendmentIds: [...selected].filter((id) => !directIds.has(id)),
    records: directAmendments
      .filter((entry) => selected.has(entry.id))
      .map((entry) => ({ application: entry.application, id: entry.recordId })),
  };
}

function updateButton() {
  const file = $("#design-document-file").files[0];
  const selected = selectedIds();
  const allowedType = !file || file.name.toLowerCase().endsWith(".docx");
  $("#edit-design-document").disabled = !file || !allowedType || !selected.length || selected.length > 5;
  if (file && !allowedType) setStatus("Select a .docx file.", "error");
  else if (file && file.size > 24 * 1024 * 1024) {
    $("#edit-design-document").disabled = true;
    setStatus("The selected document exceeds the 24 MB upload limit.", "error");
  } else if (file && selected.length) {
    setStatus(`${selected.length} amendment${selected.length === 1 ? "" : "s"} selected. Ready to edit.`);
  }
}

function renderAmendments(entries, preserveSelection = true) {
  const previous = new Set(preserveSelection ? selectedIds() : []);
  amendments = entries;
  const combined = [...entries, ...directAmendments];
  const list = $("#recent-amendments");
  list.replaceChildren();
  if (!combined.length) {
    list.append(node("p", "design-document-empty", "No recent record amendments are available yet."));
    updateButton();
    return;
  }

  for (const entry of combined) {
    const label = node("label", "amendment-card");
    const checkbox = node("input", "amendment-select");
    checkbox.type = "checkbox";
    checkbox.value = entry.id;
    checkbox.checked = previous.has(entry.id);
    checkbox.addEventListener("change", updateButton);

    const body = node("span", "amendment-card-body");
    const title = node("strong", "amendment-record", amendmentLabel(entry));
    const metadata = node("span", "amendment-metadata", `${formatDate(entry.occurredAt)} · ${entry.source || "web app"}`);
    const fields = Array.isArray(entry.fields) ? entry.fields : [];
    const preview = fields.slice(0, 4).map((field) => `${field.name}: ${field.value ?? ""}`).join(" · ");
    const detail = node("span", "amendment-preview", preview || (entry.source === "direct selection"
      ? "Current record details will be read when editing."
      : "No field details returned."));
    body.append(title, metadata, detail);

    const state = String(entry.state || "live");
    const badge = node("span", `amendment-state${state === "hold" ? " hold" : ""}`, state.toUpperCase());
    label.append(checkbox, body, badge);
    list.append(label);
  }
  updateButton();
}

function setStatus(message, state = "neutral") {
  const status = $("#design-document-status");
  status.textContent = message;
  status.className = `design-document-status ${state}`;
}

function addAssistantChatMessage(role, message) {
  const feed = $("#document-assistant-feed");
  feed.querySelector(".document-chat-empty")?.remove();
  const item = node("div", `document-chat-message ${role}`);
  item.append(
    node("strong", "document-chat-role", role === "user" ? "You" : "Transact Assistant"),
    node("p", "document-chat-text", message),
  );
  feed.append(item);
  while (feed.children.length > 20) feed.firstElementChild.remove();
  feed.scrollTop = feed.scrollHeight;
  return item.querySelector(".document-chat-text");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function followEditProgress(jobId, messageNode, isFinished) {
  while (!isFinished()) {
    try {
      const progress = await getDesignDocumentProgress(jobId);
      if (progress.summary) messageNode.textContent = progress.summary;
      if (progress.status === "failed") {
        messageNode.textContent = progress.error || progress.summary || "Document editing failed.";
        return;
      }
      if (progress.status === "completed") return;
    } catch (error) {
      if (!isFinished()) messageNode.textContent = `Unable to read progress: ${error.message}`;
      return;
    }
    await delay(700);
  }
}

async function loadAmendments(preserveSelection = true) {
  const button = $("#refresh-amendments");
  button.disabled = true;
  try {
    renderAmendments(await getRecentAmendments(), preserveSelection);
  } catch (error) {
    $("#recent-amendments").replaceChildren(node("p", "design-document-empty error", error.message));
    setStatus(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function startDocumentEdit() {
  const file = $("#design-document-file").files[0];
  const selection = selectedDocuments();
  const selectedCount = selection.amendmentIds.length + selection.records.length;
  if (!file || !file.name.toLowerCase().endsWith(".docx") || !selectedCount) {
    updateButton();
    return;
  }
  if (file.size > 24 * 1024 * 1024 || selectedCount > 5) {
    setStatus("The selected document exceeds the 24 MB upload limit.", "error");
    return;
  }

  const button = $("#edit-design-document");
  const instructions = $("#document-edit-instructions").value.trim();
  button.disabled = true;
  button.textContent = "Editing document…";
  $("#download-edited-document").hidden = true;
  setStatus("Uploading the document and asking the Assistant to apply selected amendments…", "pending");
  const userMessage = instructions
    ? `Please edit the document as follows:\n${instructions}`
    : "Please incorporate the selected Transact records following the design-document skill.";
  addAssistantChatMessage("user", userMessage);
  const assistantMessage = addAssistantChatMessage("assistant", "Uploading the document and starting the Assistant…");
  let finished = false;
  let progressTask = Promise.resolve();
  try {
    const result = await editDesignDocument({
      file,
      amendmentIds: selection.amendmentIds,
      records: selection.records,
      screenshots: $("#insert-record-screenshots").checked,
      instructions,
      onJobCreated: (jobId) => {
        assistantMessage.textContent = "Job started. Uploading the document and contacting the Assistant…";
        progressTask = followEditProgress(jobId, assistantMessage, () => finished);
      },
    });
    finished = true;
    const download = $("#download-edited-document");
    download.href = result.downloadUrl;
    download.download = result.filename;
    download.textContent = `Download ${result.filename}`;
    download.hidden = false;
    assistantMessage.textContent = result.summary || "The edited copy is ready to download.";
    setStatus(result.summary || "The edited copy is ready to download.", "success");
  } catch (error) {
    finished = true;
    assistantMessage.textContent = error.message;
    setStatus(error.message, "error");
  } finally {
    await progressTask;
    button.textContent = "Edit document with Assistant";
    updateButton();
  }
}

function addDirectRecord() {
  const application = $("#document-record-application").value.trim().toUpperCase();
  const recordId = $("#document-record-id").value.trim();
  if (!/^[A-Z0-9][A-Z0-9.]*$/.test(application)) {
    setStatus("Enter an exact Transact application name.", "error");
    $("#document-record-application").focus();
    return;
  }
  if (!recordId || recordId.length > 256 || recordId.includes("...")) {
    setStatus("Enter an exact record ID (wildcards are not supported here).", "error");
    $("#document-record-id").focus();
    return;
  }
  if (directAmendments.some((entry) => entry.application === application && entry.recordId === recordId)
      || amendments.some((entry) => entry.application === application && entry.recordId === recordId)) {
    setStatus("That record is already in the selection.", "error");
    return;
  }
  if (selectedIds().length >= 5) {
    setStatus("Select no more than five records in total.", "error");
    return;
  }
  const entry = {
    id: crypto.randomUUID(),
    application,
    recordId,
    state: "read on edit",
    source: "direct selection",
    occurredAt: new Date().toISOString(),
    fields: [],
  };
  directAmendments.push(entry);
  renderAmendments(amendments);
  const checkbox = [...document.querySelectorAll(".amendment-select")].find((item) => item.value === entry.id);
  if (checkbox) checkbox.checked = true;
  $("#document-record-id").value = "";
  updateButton();
}

export function isDesignDocumentMode() {
  return active;
}

export function setDesignDocumentMode(enabled) {
  active = enabled;
  $("#design-document-view").hidden = !enabled;
  $("#toggle-design-document").setAttribute("aria-pressed", String(enabled));
  $("#toggle-design-document").classList.toggle("is-selected", enabled);
  $("#assistant-document-note").hidden = !enabled;
  $("#write-confirmed").disabled = enabled;
  if (enabled) $("#write-confirmed").checked = false;
  $(".write-permission").classList.toggle("is-disabled", enabled);
  if (enabled) loadAmendments();
}

export function initializeDesignDocument({ onEnter } = {}) {
  $("#toggle-design-document").addEventListener("click", () => {
    const enabled = !active;
    if (enabled) {
      onEnter?.();
      $("#record-browser-view").hidden = true;
      $("#new-record-view").hidden = true;
    } else {
      $("#record-browser-view").hidden = false;
    }
    setDesignDocumentMode(enabled);
  });
  $("#refresh-amendments").addEventListener("click", () => loadAmendments());
  $("#design-document-file").addEventListener("change", (event) => {
    const file = event.target.files[0];
    $("#design-document-filename").textContent = file
      ? `${file.name} · ${(file.size / (1024 * 1024)).toFixed(2)} MB`
      : "Choose a .docx file";
    updateButton();
  });
  $("#edit-design-document").addEventListener("click", startDocumentEdit);
  $("#add-document-record").addEventListener("click", addDirectRecord);
}
