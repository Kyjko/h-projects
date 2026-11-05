import { askCopilot, callTransactTool, getHealth, requestRecordDesign } from "./api.js";
import { renderData, renderError, renderResult } from "./record-view.js";
import { collectDesignerFields, renderDesignerFields } from "./record-designer.js";
import { initializeDesignDocument, isDesignDocumentMode, setDesignDocumentMode } from "./design-document.js";
import { initializeMenus } from "./menus.js";
import {
  initializeAuthorisation,
  setAuthorisationMode,
} from "./authorise-record.js";
import { filterTableRows, recordWildcardEnquiry } from "./search.js";

const $ = (selector) => document.querySelector(selector);
const chatForm = $("#chat-form");
const messageInput = $("#message-input");
const chatFeed = $("#chat-feed");
const applicationInput = $("#application-input");
const recordInput = $("#record-input");
const writeCheckbox = $("#write-confirmed");
const recordView = $("#record-view");
const browserView = $("#record-browser-view");
const designerView = $("#new-record-view");
const explorerView = $("#explorer-view");
const designerApplication = $("#designer-application");
const designerRecordId = $("#designer-record-id");
const designerFields = $("#designer-fields");
const history = [];
let currentRecord = null;
let designerSchema = null;
let designerLoadedApplication = "";
let designerLoadingApplication = "";
let designerSchemaLoadSequence = 0;
let designerMode = false;
let toastTimer;

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2200);
}

function updateContext() {
  const application = applicationInput.value.trim().toUpperCase();
  $("#crumb-app").textContent = application || "APPLICATION";
  updateListButtonLabel();
  if (!designerMode && !isDesignDocumentMode()) {
    $("#assistant-context-label").textContent = application
      ? `${application}${recordInput.value.trim() ? ` · ${recordInput.value.trim()}` : ""}`
      : "No application selected";
  }
}

function updateListButtonLabel() {
  const application = applicationInput.value.trim();
  const recordId = recordInput.value.trim();
  const button = $("#list-records");
  button.textContent = application.includes("...")
    ? "Find applications"
    : recordId.includes("...") ? "Filter records" : "List records";
}

function addMessage(role, text, isError = false) {
  const message = document.createElement("div");
  message.className = `chat-message ${role}${isError ? " error" : ""}`;
  const label = document.createElement("span");
  label.className = "message-label";
  label.textContent = role === "user" ? "You" : isError ? "Connection" : "Transact Assistant";
  const content = document.createElement("span");
  content.textContent = text;
  message.append(label, content);
  chatFeed.append(message);
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

function setBusy(busy, { service = "Transact Assistant", detail = "Contacting Transact tools…" } = {}) {
  $("#send-button").disabled = busy;
  $("#send-button").querySelector("span").textContent = busy ? "…" : "↑";
  messageInput.disabled = busy;
  const status = $("#request-status");
  status.hidden = !busy;
  if (busy) {
    $("#request-status").querySelector("strong").textContent = `Waiting for ${service}`;
    $("#request-status-detail").textContent = detail;
    $("#request-elapsed").textContent = "0s";
    $("#record-state").textContent = "WAITING";
    $("#record-state").dataset.state = "waiting";
  }
}

function showThinking() {
  const thinking = document.createElement("div");
  thinking.className = "thinking";
  thinking.id = "thinking";
  const label = document.createElement("span");
  label.className = "thinking-label";
  label.textContent = "Transact Assistant is working";
  thinking.append(label);
  for (let index = 0; index < 3; index += 1) thinking.append(document.createElement("span"));
  chatFeed.append(thinking);
  chatFeed.scrollTop = chatFeed.scrollHeight;
  return thinking;
}

function displayAnswer(answer, { largeResult, largeResultError } = {}) {
  recordView.replaceChildren();
  recordView.classList.remove("empty-record");
  currentRecord = null;
  const result = largeResult !== undefined
    ? renderData(largeResult, recordView)
    : renderResult(answer, recordView);
  if (largeResultError) {
    result.subtitle = "The assistant returned a result-file reference, but the complete result could not be loaded.";
    renderError(largeResultError, recordView);
  }
  $("#record-title").textContent = result.title;
  $("#record-subtitle").textContent = result.subtitle;
  $("#record-state").textContent = "RESULT";
  $("#record-state").removeAttribute("data-state");
  currentRecord = result.raw;
  $("#copy-record").disabled = !currentRecord;
  updateContext();
}

function displayDirectResult(data, title) {
  recordView.replaceChildren();
  recordView.classList.remove("empty-record");
  const result = renderData(data, recordView, { title });
  $("#record-title").textContent = result.title;
  $("#record-subtitle").textContent = result.subtitle;
  $("#record-state").textContent = "RESULT";
  $("#record-state").removeAttribute("data-state");
  currentRecord = result.raw;
  $("#copy-record").disabled = !currentRecord;
  updateContext();
}

async function submitDirectTool(tool, args, title) {
  if ($("#send-button").disabled) return;
  setBusy(true, { service: "Transact", detail: `Calling ${tool}…` });
  const startedAt = Date.now();
  const elapsedTimer = setInterval(() => {
    $("#request-elapsed").textContent = `${Math.floor((Date.now() - startedAt) / 1000)}s`;
  }, 1000);
  try {
    const result = await callTransactTool(tool, args);
    displayDirectResult(result, title);
  } catch (error) {
    recordView.replaceChildren();
    recordView.classList.remove("empty-record");
    renderError(error.message, recordView);
    $("#record-title").textContent = "Transact request could not be completed";
    $("#record-subtitle").textContent = "Check the application, record ID, and local Transact MCP connection.";
    $("#record-state").textContent = "ERROR";
    $("#record-state").dataset.state = "error";
  } finally {
    clearInterval(elapsedTimer);
    setBusy(false);
  }
}

async function findApplications(pattern) {
  setBusy(true, { service: "Transact", detail: "Searching FILE.CONTROL application names…" });
  const startedAt = Date.now();
  const elapsedTimer = setInterval(() => {
    $("#request-elapsed").textContent = `${Math.floor((Date.now() - startedAt) / 1000)}s`;
  }, 1000);
  try {
    const data = await callTransactTool("ofs-enquiry", { enquiry: "%FILE.CONTROL", max_rows: 5000 });
    const filtered = filterTableRows(data, pattern);
    filtered.enquiry = "FILE.CONTROL · matching applications";
    displayDirectResult(filtered, "Matching Transact applications");
  } catch (error) {
    recordView.replaceChildren();
    recordView.classList.remove("empty-record");
    renderError(error.message, recordView);
    $("#record-title").textContent = "Application search could not be completed";
    $("#record-subtitle").textContent = "Check FILE.CONTROL access and the local Transact MCP connection.";
    $("#record-state").textContent = "ERROR";
    $("#record-state").dataset.state = "error";
  } finally {
    clearInterval(elapsedTimer);
    setBusy(false);
  }
}

async function submitRequest(message, { fromChat = true, writeConfirmed = false } = {}) {
  const suggestionMode = designerMode;
  const documentSuggestionMode = isDesignDocumentMode();
  writeConfirmed = writeConfirmed && !suggestionMode && !documentSuggestionMode;
  if (writeConfirmed && !window.confirm(
    "This request will have access to Transact write, authorise, transfer, reverse, and delete tools. Continue only if the request above is correct.",
  )) return;

  if (fromChat) {
    addMessage("user", message);
    history.push({ role: "user", content: message });
    if (history.length > 8) history.shift();
  }
  const thinking = fromChat ? showThinking() : null;
  $("#record-state").textContent = "WORKING";
  $("#record-state").removeAttribute("data-state");
  setBusy(true, { service: "Transact Assistant", detail: "Sending request for interpretation…" });
  const startedAt = Date.now();
  const elapsedTimer = setInterval(() => {
    $("#request-elapsed").textContent = `${Math.floor((Date.now() - startedAt) / 1000)}s`;
  }, 1000);
  try {
    const response = await askCopilot({
      message,
      application: suggestionMode ? designerApplication.value.trim() : applicationInput.value.trim(),
      recordId: suggestionMode ? designerRecordId.value.trim() : recordInput.value.trim(),
      history: fromChat ? history.slice(0, -1) : history.slice(-6),
      writeConfirmed,
      assistantMode: suggestionMode
        ? "record-design-suggestions"
        : documentSuggestionMode
          ? "design-doc-suggestions"
          : "standard",
    });
    const answer = response.answer;
    thinking?.remove();
    if (fromChat) {
      addMessage("assistant", answer);
      history.push({ role: "assistant", content: answer });
      if (history.length > 8) history.shift();
    }
    if (!suggestionMode && !documentSuggestionMode) displayAnswer(answer, response);
  } catch (error) {
    thinking?.remove();
    if (fromChat) addMessage("assistant", error.message, true);
    if (!suggestionMode && !documentSuggestionMode) {
      recordView.replaceChildren();
      recordView.classList.remove("empty-record");
      renderError(error.message, recordView);
      $("#record-title").textContent = "Request could not be completed";
      $("#record-subtitle").textContent = "Check the local assistant and Transact MCP connection.";
      $("#record-state").textContent = "ERROR";
      $("#record-state").dataset.state = "error";
    }
  } finally {
    clearInterval(elapsedTimer);
    if (fromChat) writeCheckbox.checked = false;
    setBusy(false);
    if (fromChat) messageInput.focus();
  }
}

function setDesignerMode(enabled) {
  if (enabled) {
    setDesignDocumentMode(false);
    setAuthorisationMode(false);
    explorerView.hidden = true;
  }
  designerMode = enabled;
  browserView.hidden = enabled;
  designerView.hidden = !enabled;
  $("#toggle-designer").setAttribute("aria-pressed", String(enabled));
  $("#toggle-designer").classList.toggle("is-selected", enabled);
  $("#assistant-design-note").hidden = !enabled;
  if (enabled) $("#assistant-design-note").textContent = "Design assistance is suggestion-only. The assistant will not change this form or submit records.";
  $("#write-confirmed").disabled = enabled;
  if (enabled) writeCheckbox.checked = false;
  $(".write-permission").classList.toggle("is-disabled", enabled);
  $("#assistant-context-label").textContent = enabled
    ? `${designerApplication.value.trim().toUpperCase() || "New record"}${designerRecordId.value.trim() ? ` · ${designerRecordId.value.trim()}` : ""}`
    : applicationInput.value.trim().toUpperCase() || "No application selected";
}

function showDesignerValidation(message, status = "neutral", details = []) {
  const output = $("#designer-validation");
  output.className = `designer-validation ${status}`;
  output.replaceChildren();
  output.append(document.createTextNode(message));
  if (details.length) {
    const list = document.createElement("ul");
    for (const detail of details) {
      const item = document.createElement("li");
      item.textContent = detail;
      list.append(item);
    }
    output.append(list);
  }
}

function responseErrors(response) {
  return Array.isArray(response?.errors)
    ? response.errors.map((error) => typeof error === "string" ? error : error?.message || JSON.stringify(error))
    : [];
}

function designerPayload({ requireId = true } = {}) {
  const application = designerApplication.value.trim().toUpperCase();
  const id = designerRecordId.value.trim();
  if (!application || !/^[A-Z0-9][A-Z0-9.]*$/.test(application)) {
    throw new Error("Enter a valid Transact application name.");
  }
  if (requireId && !id) throw new Error("Enter the ID for the new record.");
  if (application !== designerLoadedApplication) {
    throw new Error("Load the field catalog for the selected application before continuing.");
  }
  return { application, id, fields: collectDesignerFields(designerFields) };
}

async function loadDesignerSchema() {
  const application = designerApplication.value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.]*$/.test(application)) {
    showDesignerValidation("Enter a valid application name, then load its field catalog.", "error");
    designerApplication.focus();
    return;
  }
  if (designerLoadedApplication === application && designerSchema) return;
  if (designerLoadingApplication === application) return;
  const loadSequence = ++designerSchemaLoadSequence;
  designerLoadingApplication = application;
  $("#load-designer-schema").disabled = true;
  $("#designer-schema-state").textContent = `Loading ${application} field catalog…`;
  designerFields.replaceChildren();
  designerSchema = null;
  designerLoadedApplication = "";
  $("#copy-source-record").disabled = true;
  $("#designer-field-search").disabled = true;
  $("#validate-new-record").disabled = true;
  $("#submit-new-record").disabled = true;
  try {
    const schema = await callTransactTool("app-schema", { application, scope: "all" });
    if (loadSequence !== designerSchemaLoadSequence) return;
    designerSchema = schema;
    const count = renderDesignerFields(schema, designerFields);
    designerLoadedApplication = application;
    $("#designer-fields-title").textContent = `${application} · ${count} fields`;
    $("#designer-schema-state").textContent = `${application} field catalog loaded.`;
    $("#copy-source-record").disabled = false;
    $("#designer-field-search").disabled = false;
    $("#validate-new-record").disabled = false;
    $("#submit-new-record").disabled = false;
    showDesignerValidation("Use Validate to check required fields and application rules in Transact.");
  } catch (error) {
    if (loadSequence !== designerSchemaLoadSequence) return;
    $("#designer-schema-state").textContent = "Could not load application fields.";
    designerFields.textContent = error.message;
    showDesignerValidation(error.message, "error");
  } finally {
    if (loadSequence === designerSchemaLoadSequence) {
      designerLoadingApplication = "";
      $("#load-designer-schema").disabled = false;
    }
  }
}

async function validateDesignedRecord() {
  let payload;
  try {
    payload = designerPayload();
  } catch (error) {
    showDesignerValidation(error.message, "error");
    return false;
  }
  const button = $("#validate-new-record");
  button.disabled = true;
  button.textContent = "Validating…";
  showDesignerValidation("Transact is validating the record; no record will be written.", "pending");
  try {
    const response = await requestRecordDesign("validate", payload);
    const errors = responseErrors(response.validation);
    if (!response.valid || errors.length) {
      showDesignerValidation("Transact found validation errors. Correct them before submitting.", "error", errors);
      return false;
    }
    const operation = response.operation === "amend" ? "AMEND the existing record" : "create a new record";
    showDesignerValidation(`Validation passed. Submitting will ${operation}; no record has been written yet.`, "success");
    return true;
  } catch (error) {
    showDesignerValidation(error.message, "error");
    return false;
  } finally {
    button.disabled = false;
    button.textContent = "Validate";
  }
}

async function submitDesignedRecord() {
  let payload;
  try {
    payload = designerPayload();
  } catch (error) {
    showDesignerValidation(error.message, "error");
    return;
  }
  if (!window.confirm(`Submit ${payload.application} record "${payload.id}" to Transact? An existing ID will be amended (AMEND); a missing ID will create a new record.`)) return;
  const button = $("#submit-new-record");
  button.disabled = true;
  button.textContent = "Submitting…";
  showDesignerValidation("Transact is validating the record before submission.", "pending");
  try {
    const response = await requestRecordDesign("submit", payload);
    const validationErrors = responseErrors(response.validation);
    if (!response.valid) {
      showDesignerValidation("Transact rejected the record during validation. Nothing was submitted.", "error", validationErrors);
      return;
    }
    const errors = responseErrors(response.result);
    if (errors.length) {
      showDesignerValidation("Transact rejected the record.", "error", errors);
      return;
    }
    const state = response.result?.state;
    const action = response.operation === "amend" ? "Amendment" : "Record input";
    const message = state === "unauthorised"
      ? `${action} was accepted and is pending authorisation.`
      : state === "hold"
        ? `Transact placed the ${response.operation === "amend" ? "amendment" : "record"} on hold. Review the returned warnings and read the record back.`
        : response.operation === "amend"
          ? "Amendment was submitted to Transact."
          : "New record was submitted to Transact.";
    const warnings = Array.isArray(response.result?.warnings)
      ? response.result.warnings.map((warning) => typeof warning === "string" ? warning : warning?.message || JSON.stringify(warning))
      : [];
    if (response.historyWarning) warnings.push(response.historyWarning);
    showDesignerValidation(message, state === "hold" ? "error" : "success", warnings);
  } catch (error) {
    showDesignerValidation(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Submit record";
  }
}

async function copySourceRecord() {
  let payload;
  try {
    payload = designerPayload({ requireId: false });
  } catch (error) {
    showDesignerValidation(error.message, "error");
    return;
  }
  const sourceId = $("#designer-copy-id").value.trim();
  if (!sourceId) {
    showDesignerValidation("Enter the existing record ID to copy.", "error");
    return;
  }
  if (payload.id && sourceId === payload.id) {
    showDesignerValidation("Choose a different source ID and new record ID.", "error");
    return;
  }
  const button = $("#copy-source-record");
  button.disabled = true;
  button.textContent = "Reading…";
  try {
    const record = await callTransactTool("ofs-read", { application: payload.application, id: sourceId });
    const source = record?.record && Array.isArray(record.record.fields) ? record.record.fields : record?.fields;
    if (!Array.isArray(source)) throw new Error("The returned record did not contain readable fields.");
    renderDesignerFields(designerSchema, designerFields, source);
    showDesignerValidation(`Copied input values from ${payload.application} · ${sourceId}. Review and validate before submitting.`);
  } catch (error) {
    showDesignerValidation(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Copy record details";
  }
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = messageInput.value.trim();
  if (!message || $("#send-button").disabled) return;
  messageInput.value = "";
  submitRequest(message, { fromChat: true, writeConfirmed: writeCheckbox.checked });
});

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => {
    if ($("#send-button").disabled) return;
    const action = button.dataset.action;
    const navItem = button.closest(".nav-item");
    if (navItem) {
      document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
      navItem.classList.add("active");
    }

    const application = applicationInput.value.trim().toUpperCase();
    const recordId = recordInput.value.trim();
    if (navItem && action === "context") {
      setDesignerMode(false);
      setDesignDocumentMode(false);
      setAuthorisationMode(false);
      explorerView.hidden = true;
      browserView.hidden = false;
    }
    if (["application", "record", "list"].includes(action) && !application) {
      showToast("Enter an application first.");
      applicationInput.focus();
      return;
    }
    if (action === "context") {
      submitDirectTool("transact-context", {}, "Transact orientation");
    } else if (action === "application") {
      submitDirectTool("app-fields", { application }, `${application} fields`);
    } else if (action === "record") {
      if (!recordId) {
        showToast("Enter a record ID first.");
        recordInput.focus();
        return;
      }
      submitDirectTool("ofs-read", { application, id: recordId }, `${application} · ${recordId}`);
    } else if (action === "list") {
      submitDirectTool("ofs-enquiry", { enquiry: `%${application}`, max_rows: 5000 }, `%${application}`);
    } else if (action === "customer") {
      if (!recordId) {
        showToast("Enter a customer ID in the record ID field first.");
        recordInput.focus();
        return;
      }
      submitDirectTool("customer-lookup", { id: recordId }, `Customer · ${recordId}`);
    } else if (action === "aa-product") {
      if (!recordId) {
        showToast("Enter an AA product ID in the record ID field first.");
        recordInput.focus();
        return;
      }
      submitDirectTool("aa-product-summary", { product_id: recordId }, `AA product · ${recordId}`);
    }
  });
});

applicationInput.addEventListener("input", updateContext);
recordInput.addEventListener("input", updateContext);
recordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    $("#open-record").click();
  }
});

$("#open-record").addEventListener("click", () => {
  const application = applicationInput.value.trim();
  const recordId = recordInput.value.trim();
  if (application.includes("...") || recordId.includes("...")) {
    showToast("Use Find applications or Filter records for wildcard searches.");
    return;
  }
  if (!application || !recordId) {
    showToast("Enter both an application and record ID.");
    return;
  }
  submitDirectTool("ofs-read", { application: application.toUpperCase(), id: recordId }, `${application.toUpperCase()} · ${recordId}`);
});

$("#list-records").addEventListener("click", () => {
  const application = applicationInput.value.trim();
  const recordId = recordInput.value.trim();
  if (!application) {
    showToast("Enter an application to list its records.");
    applicationInput.focus();
    return;
  }
  if (application.includes("...") && recordId.includes("...")) {
    showToast("Search application names or filter record IDs, one wildcard field at a time.");
    return;
  }
  if (application.includes("...")) {
    findApplications(application);
    return;
  }
  const enquiry = `%${application.toUpperCase()}`;
  if (recordId.includes("...")) {
    submitDirectTool("ofs-enquiry", recordWildcardEnquiry(application.toUpperCase(), recordId), `${enquiry} · ID filter ${recordId}`);
    return;
  }
  submitDirectTool("ofs-enquiry", { enquiry, max_rows: 5000 }, enquiry);
});

$("#clear-chat").addEventListener("click", () => {
  history.length = 0;
  chatFeed.replaceChildren();
  const welcome = document.createElement("div");
  welcome.className = "welcome-message";
  const text = document.createElement("p");
  text.textContent = "Enter an enquiry about Transact records, applications, customers, or AA products.";
  welcome.append(text);
  chatFeed.append(welcome);
});

function setChatVisible(visible) {
  const workspace = $(".workspace-shell");
  workspace.classList.toggle("chat-hidden", !visible);
  $("#toggle-chat").setAttribute("aria-expanded", String(visible));
  if (visible) messageInput.focus();
}

$("#toggle-chat").addEventListener("click", () => {
  setChatVisible($(".workspace-shell").classList.contains("chat-hidden"));
});
$("#close-chat").addEventListener("click", () => setChatVisible(false));

initializeDesignDocument({
  onEnter: () => {
    setDesignerMode(false);
    setAuthorisationMode(false);
    explorerView.hidden = true;
  },
});

initializeAuthorisation({
  onEnter: () => {
    setDesignerMode(false);
    setDesignDocumentMode(false);
    explorerView.hidden = true;
    browserView.hidden = true;
  },
  onExit: () => {
    browserView.hidden = false;
  },
});

initializeMenus({
  onOpen: () => {
    setDesignerMode(false);
    setDesignDocumentMode(false);
    setAuthorisationMode(false);
    browserView.hidden = true;
  },
});

$("#toggle-designer").addEventListener("click", () => setDesignerMode(!designerMode));
$("#load-designer-schema").addEventListener("click", loadDesignerSchema);
designerApplication.addEventListener("change", loadDesignerSchema);
designerApplication.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    loadDesignerSchema();
  }
});
designerApplication.addEventListener("input", () => {
  if (designerApplication.value.trim().toUpperCase() !== designerLoadedApplication) {
    designerSchemaLoadSequence += 1;
    designerLoadingApplication = "";
    $("#load-designer-schema").disabled = false;
    designerLoadedApplication = "";
    designerSchema = null;
    $("#designer-fields").replaceChildren();
    $("#designer-schema-state").textContent = "Application changed. Load its field catalog to continue.";
    $("#copy-source-record").disabled = true;
    $("#designer-field-search").disabled = true;
    $("#validate-new-record").disabled = true;
    $("#submit-new-record").disabled = true;
  }
  if (designerMode) {
    $("#assistant-context-label").textContent = `${designerApplication.value.trim().toUpperCase() || "New record"}${designerRecordId.value.trim() ? ` · ${designerRecordId.value.trim()}` : ""}`;
  }
});
designerRecordId.addEventListener("input", () => {
  if (designerLoadedApplication) {
    showDesignerValidation("The record ID changed. Validate again before submitting.");
  }
  if (designerMode) {
    $("#assistant-context-label").textContent = `${designerApplication.value.trim().toUpperCase() || "New record"}${designerRecordId.value.trim() ? ` · ${designerRecordId.value.trim()}` : ""}`;
  }
});
$("#copy-source-record").addEventListener("click", copySourceRecord);
$("#validate-new-record").addEventListener("click", validateDesignedRecord);
$("#submit-new-record").addEventListener("click", submitDesignedRecord);
$("#designer-field-search").addEventListener("input", (event) => {
  const search = event.target.value.trim().toUpperCase();
  for (const field of designerFields.querySelectorAll(".designer-field")) {
    field.hidden = !field.dataset.fieldName.includes(search);
  }
});
designerFields.addEventListener("input", (event) => {
  if (event.target.matches(".designer-value:not(:disabled)")) {
    showDesignerValidation("The record has changed. Validate it again before submitting.");
  }
});

const themeToggle = $("#toggle-theme");
function setTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  themeToggle.textContent = isDark ? "Light mode" : "Dark mode";
  themeToggle.setAttribute("aria-pressed", String(isDark));
  themeToggle.setAttribute("aria-label", `Switch to ${isDark ? "light" : "dark"} mode`);
  document.querySelector('meta[name="theme-color"]').content = isDark ? "#17232c" : "#536b7d";
  localStorage.setItem("transact-browser-theme", isDark ? "dark" : "light");
}

setTheme(localStorage.getItem("transact-browser-theme") === "dark" ? "dark" : "light");
themeToggle.addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

$("#copy-record").addEventListener("click", async () => {
  if (!currentRecord) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(currentRecord, null, 2));
    showToast("Record data copied.");
  } catch {
    showToast("Clipboard access is unavailable in this browser.");
  }
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

async function updateHealth() {
  try {
    const health = await getHealth();
    const label = $("#connection-label");
    if (health.mcpReachable) {
      label.textContent = "Transact MCP reachable";
      label.title = health.mcpUrl;
    } else {
      label.textContent = "Waiting for Transact MCP";
      label.title = `Expected at ${health.mcpUrl}`;
    }
  } catch {
    $("#connection-label").textContent = "Local service unavailable";
  }
}

updateContext();
updateHealth();
