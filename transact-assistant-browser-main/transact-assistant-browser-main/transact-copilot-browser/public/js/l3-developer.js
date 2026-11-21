import {
  askL3Assistant,
  getL3File,
  getL3Project,
  saveL3File,
  searchL3Project,
} from "./api.js";

const $ = (selector) => document.querySelector(selector);
const MAX_HISTORY = 100;
let project = null;
let openFile = "";
let originalHash = "";
let selectedPaths = new Set();
let expandedDirectories = new Set();
let treeInitialized = false;
let undoHistory = [];
let redoHistory = [];
let loadingFile = false;
let assistantBusy = false;

function element(tag, className = "", text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function setStatus(message, kind = "") {
  const status = $("#l3-assistant-status");
  status.textContent = message;
  status.classList.toggle("error", kind === "error");
  status.classList.toggle("success", kind === "success");
}

function editorDirty() {
  return Boolean(openFile) && $("#l3-code-editor").value !== $("#l3-code-editor").dataset.savedContent;
}

function updateEditorButtons() {
  const dirty = editorDirty();
  $("#l3-save").disabled = assistantBusy || !dirty;
  $("#l3-undo").disabled = assistantBusy || undoHistory.length === 0;
  $("#l3-redo").disabled = assistantBusy || redoHistory.length === 0;
  $("#l3-explain-file").disabled = assistantBusy || !openFile;
  $("#l3-explain-selection").disabled = assistantBusy || !openFile || $("#l3-code-editor").selectionStart === $("#l3-code-editor").selectionEnd;
  $("#l3-explain-selected").disabled = assistantBusy || selectedPaths.size === 0;
  $("#l3-propose-edit").disabled = assistantBusy || !openFile;
  $("#l3-find-transact").disabled = assistantBusy || selectedPaths.size === 0 && !openFile;
  $("#l3-explain-folder").disabled = assistantBusy || !$("#l3-explain-folder").dataset.directory;
  document.querySelectorAll(".l3-folder-explain").forEach((button) => { button.disabled = assistantBusy; });
  $("#l3-file-status").textContent = dirty ? "Unsaved changes" : openFile ? "Saved" : "Select a file in the project explorer.";
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function appendInline(parent, text) {
  const tokenPattern = /(`[^`\n]+`|\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_)/g;
  let position = 0;
  for (const match of text.matchAll(tokenPattern)) {
    parent.append(document.createTextNode(text.slice(position, match.index)));
    const token = match[0];
    let node;
    if (token.startsWith("`")) {
      node = element("code", "", token.slice(1, -1));
    } else if (token.startsWith("[")) {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      node = element("a", "", link[1]);
      node.href = link[2];
      node.target = "_blank";
      node.rel = "noopener noreferrer";
    } else if (token.startsWith("**") || token.startsWith("__")) {
      node = element("strong", "", token.slice(2, -2));
    } else if (token.startsWith("~~")) {
      node = element("del", "", token.slice(2, -2));
    } else if (token.startsWith("*") || token.startsWith("_")) {
      node = element("em", "", token.slice(1, -1));
    }
    parent.append(node);
    position = match.index + token.length;
  }
  parent.append(document.createTextNode(text.slice(position)));
}

function markdownCells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function isMarkdownTable(lines, index) {
  if (index + 1 >= lines.length || !lines[index].includes("|")) return false;
  const separators = markdownCells(lines[index + 1]);
  return separators.length > 0 && separators.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isMarkdownBlockStart(lines, index) {
  const line = lines[index];
  return /^ {0,3}(?:#{1,6}\s|```|>|[-*+]\s+|\d+\.\s+|(?:-{3,}|_{3,}|\*{3,})\s*$)/.test(line)
    || isMarkdownTable(lines, index);
}

export function renderMarkdown(container, markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  container.replaceChildren();

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^ {0,3}```\s*([\w+-]*)/);
    if (fence) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^ {0,3}```\s*$/.test(lines[index])) codeLines.push(lines[index++]);
      if (index < lines.length) index += 1;
      const pre = element("pre");
      pre.append(element("code", fence[1] ? `language-${fence[1]}` : "", codeLines.join("\n")));
      container.append(pre);
      continue;
    }

    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const title = element(`h${heading[1].length}`);
      appendInline(title, heading[2]);
      container.append(title);
      index += 1;
      continue;
    }

    if (/^ {0,3}(?:-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
      container.append(element("hr"));
      index += 1;
      continue;
    }

    if (isMarkdownTable(lines, index)) {
      const headers = markdownCells(line);
      const alignments = markdownCells(lines[index + 1]).map((cell) =>
        cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : "");
      const table = element("table", "l3-answer-table");
      const head = element("thead");
      const headerRow = element("tr");
      headers.forEach((value, cellIndex) => {
        const cell = element("th");
        if (alignments[cellIndex]) cell.style.textAlign = alignments[cellIndex];
        appendInline(cell, value);
        headerRow.append(cell);
      });
      head.append(headerRow);
      table.append(head);
      const body = element("tbody");
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        const row = element("tr");
        markdownCells(lines[index]).forEach((value, cellIndex) => {
          const cell = element("td");
          if (alignments[cellIndex]) cell.style.textAlign = alignments[cellIndex];
          appendInline(cell, value);
          row.append(cell);
        });
        body.append(row);
        index += 1;
      }
      table.append(body);
      container.append(table);
      continue;
    }

    const quote = line.match(/^ {0,3}>\s?(.*)$/);
    if (quote) {
      const blockquote = element("blockquote");
      const paragraph = element("p");
      appendInline(paragraph, quote[1]);
      blockquote.append(paragraph);
      container.append(blockquote);
      index += 1;
      continue;
    }

    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[2]);
      const list = element(ordered ? "ol" : "ul");
      while (index < lines.length) {
        const itemMatch = lines[index].match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
        if (!itemMatch || /^\d/.test(itemMatch[2]) !== ordered) break;
        const item = element("li");
        appendInline(item, itemMatch[3]);
        list.append(item);
        index += 1;
      }
      container.append(list);
      continue;
    }

    const paragraph = element("p");
    const paragraphLines = [];
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines, index)) {
      paragraphLines.push(lines[index++].trim());
    }
    paragraphLines.forEach((paragraphLine, lineIndex) => {
      if (lineIndex) paragraph.append(document.createElement("br"));
      appendInline(paragraph, paragraphLine);
    });
    container.append(paragraph);
  }
}

const JAVA_TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|@[A-Za-z_$][\w$]*|\b(?:abstract|assert|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|extends|final|finally|float|for|if|implements|import|instanceof|int|interface|long|native|new|package|private|protected|public|return|short|static|strictfp|super|switch|synchronized|this|throw|throws|transient|try|void|volatile|while|var|record|sealed|permits|yield|true|false|null)\b|\b\d+(?:\.\d+)?\b)/g;

function highlightJava(source) {
  let html = "";
  let previousIndex = 0;
  for (const match of source.matchAll(JAVA_TOKEN)) {
    html += escapeHtml(source.slice(previousIndex, match.index));
    const token = match[0];
    const className = token.startsWith("//") || token.startsWith("/*")
      ? "l3-token-comment"
      : token.startsWith("\"") || token.startsWith("'")
        ? "l3-token-string"
        : token.startsWith("@")
          ? "l3-token-annotation"
          : /^\d/.test(token)
            ? "l3-token-number"
            : "l3-token-keyword";
    html += `<span class="${className}">${escapeHtml(token)}</span>`;
    previousIndex = match.index + token.length;
  }
  html += escapeHtml(source.slice(previousIndex));
  return html || " ";
}

function updateCodeDisplay() {
  const editor = $("#l3-code-editor");
  $("#l3-highlighted-code").innerHTML = highlightJava(editor.value);
  const lineCount = Math.max(1, editor.value.split("\n").length);
  $("#l3-line-numbers").textContent = Array.from({ length: lineCount }, (_, index) => index + 1).join("\n");
  updateEditorButtons();
}

function syncEditorScroll() {
  const editor = $("#l3-code-editor");
  $("#l3-highlighted-code").style.transform = `translate(${-editor.scrollLeft}px, ${-editor.scrollTop}px)`;
  $("#l3-line-numbers").scrollTop = editor.scrollTop;
}

function flattenFiles(nodes, output = []) {
  for (const node of nodes) {
    if (node.type === "file") output.push(node.path);
    else flattenFiles(node.children || [], output);
  }
  return output;
}

function renderTree(nodes, container, depth = 0) {
  for (const entry of nodes) {
    if (entry.type === "directory") {
      const details = element("details", "l3-tree-folder");
      details.open = treeInitialized ? expandedDirectories.has(entry.path) : depth < 1;
      details.addEventListener("toggle", () => {
        if (details.open) expandedDirectories.add(entry.path);
        else expandedDirectories.delete(entry.path);
      });
      const summary = element("summary", "l3-tree-folder-label");
      summary.style.setProperty("--tree-depth", depth);
      summary.append(element("span", "l3-tree-chevron", "›"), element("span", "l3-folder-icon", "▰"), element("span", "", entry.name));
      const explain = element("button", "l3-folder-explain", "Explain");
      explain.type = "button";
      explain.title = `Explain files in ${entry.path}`;
      explain.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        $("#l3-explain-folder").dataset.directory = entry.path;
        $("#l3-explain-folder").disabled = false;
        explainFolder(entry.path);
      });
      summary.append(explain);
      const children = element("div", "l3-tree-children");
      renderTree(entry.children || [], children, depth + 1);
      details.append(summary, children);
      container.append(details);
    } else {
      const row = element("div", `l3-tree-file${openFile === entry.path ? " active" : ""}`);
      row.style.setProperty("--tree-depth", depth);
      const checkbox = element("input", "l3-file-select");
      checkbox.type = "checkbox";
      checkbox.checked = selectedPaths.has(entry.path);
      checkbox.setAttribute("aria-label", `Include ${entry.path} in Assistant context`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedPaths.add(entry.path);
        else selectedPaths.delete(entry.path);
        updateEditorButtons();
      });
      const open = element("button", "l3-file-open");
      open.type = "button";
      open.append(element("span", "l3-file-icon", entry.name.toLowerCase().endsWith(".java") ? "J" : "·"), element("span", "", entry.name));
      open.title = entry.path;
      open.addEventListener("click", () => loadFile(entry.path));
      row.append(checkbox, open);
      container.append(row);
    }
  }
}

function renderProject() {
  if (!project) return;
  $("#l3-project-location").textContent = project.path;
  $("#l3-project-stats").textContent =
    `${project.fileCount.toLocaleString()} files · ${project.directoryCount.toLocaleString()} folders${project.entryLimitReached ? " · tree limit reached" : ""}`;
  const tree = $("#l3-project-tree");
  tree.replaceChildren();
  renderTree(project.structure, tree);
  treeInitialized = true;
  updateEditorButtons();
}

async function loadProject() {
  $("#l3-project-tree").replaceChildren(element("p", "l3-tree-message", "Loading Java project structure…"));
  try {
    project = await getL3Project();
    renderProject();
    setStatus("Project structure loaded.", "success");
  } catch (error) {
    $("#l3-project-tree").replaceChildren(element("p", "l3-tree-message error", error.message));
    setStatus(error.message, "error");
  }
}

async function loadFile(filePath, { line } = {}) {
  if (editorDirty() && !window.confirm("Discard unsaved editor changes?")) return;
  loadingFile = true;
  try {
    const file = await getL3File(filePath);
    openFile = file.path;
    originalHash = file.hash;
    $("#l3-open-file-title").textContent = file.path;
    $("#l3-code-editor").value = file.content;
    $("#l3-code-editor").dataset.savedContent = file.content;
    $("#l3-code-editor").dataset.lastValue = file.content;
    $("#l3-editor-empty").hidden = true;
    $("#l3-editor-shell").hidden = false;
    $("#l3-edit-review").hidden = true;
    $("#l3-assistant-answer").hidden = true;
    undoHistory = [];
    redoHistory = [];
    updateCodeDisplay();
    renderProject();
    if (line) {
      const editor = $("#l3-code-editor");
      const start = editor.value.split("\n").slice(0, line - 1).join("\n").length + (line > 1 ? 1 : 0);
      editor.setSelectionRange(start, start);
      editor.focus();
      editor.scrollTop = Math.max(0, (line - 1) * 20);
    }
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    loadingFile = false;
  }
}

function pushUndo(value) {
  if (undoHistory.at(-1) !== value) undoHistory.push(value);
  if (undoHistory.length > MAX_HISTORY) undoHistory.shift();
  redoHistory = [];
}

function replaceEditorContent(content) {
  const editor = $("#l3-code-editor");
  pushUndo(editor.value);
  editor.value = content;
  editor.dataset.lastValue = content;
  updateCodeDisplay();
}

function undo() {
  const editor = $("#l3-code-editor");
  if (!undoHistory.length) return;
  redoHistory.push(editor.value);
  editor.value = undoHistory.pop();
  editor.dataset.lastValue = editor.value;
  updateCodeDisplay();
}

function redo() {
  const editor = $("#l3-code-editor");
  if (!redoHistory.length) return;
  undoHistory.push(editor.value);
  editor.value = redoHistory.pop();
  editor.dataset.lastValue = editor.value;
  updateCodeDisplay();
}

async function saveOpenFile() {
  if (!openFile || !editorDirty()) return;
  $("#l3-save").disabled = true;
  setStatus(`Saving ${openFile}…`);
  try {
    const saved = await saveL3File(openFile, $("#l3-code-editor").value, originalHash);
    originalHash = saved.hash;
    $("#l3-code-editor").dataset.savedContent = $("#l3-code-editor").value;
    $("#l3-code-editor").dataset.lastValue = $("#l3-code-editor").value;
    setStatus(`Saved ${saved.path}.`, "success");
    updateEditorButtons();
  } catch (error) {
    setStatus(error.message, "error");
    updateEditorButtons();
  }
}

function assistantScope() {
  const paths = selectedPaths.size ? [...selectedPaths] : openFile ? [openFile] : [];
  return { files: paths, openFile };
}

async function runAssistant(mode, { directory = "", selection = "" } = {}) {
  const scope = directory ? { files: [], directory, openFile: "" } : assistantScope();
  if (!scope.files.length && !scope.directory) {
    setStatus("Open or select project files first.", "error");
    return;
  }
  const instruction = $("#l3-assistant-instruction").value.trim();
  if (mode === "edit" && !instruction) {
    setStatus("Describe the code change you want the Assistant to propose.", "error");
    $("#l3-assistant-instruction").focus();
    return;
  }
  const button = mode === "edit" ? $("#l3-propose-edit")
    : mode === "relevance" ? $("#l3-find-transact")
      : directory ? $("#l3-explain-folder")
        : selection ? $("#l3-explain-selection")
          : scope.files.length > 1 ? $("#l3-explain-selected") : $("#l3-explain-file");
  assistantBusy = true;
  updateEditorButtons();
  const assistant = $(".l3-assistant");
  assistant.setAttribute("aria-busy", "true");
  const working = $("#l3-assistant-working");
  const workingMessages = {
    explain: "Reading the selected source and preparing an explanation…",
    edit: "Reviewing the requested change and preparing a proposal…",
    relevance: "Searching for relevant Transact tables and records…",
  };
  $("#l3-assistant-working-message").textContent = workingMessages[mode];
  working.hidden = false;
  $("#l3-assistant-answer").hidden = true;
  $("#l3-edit-review").hidden = true;
  setStatus(mode === "relevance"
    ? "Checking source references and related Transact records…"
    : mode === "edit" ? "Preparing an edit suggestion for your review…"
      : "Analyzing selected source…");
  if (button) button.setAttribute("aria-busy", "true");
  try {
    const result = await askL3Assistant({
      mode,
      instruction,
      ...scope,
      selection,
    });
    if (mode === "edit") {
      showEditSuggestion(result.suggestion);
      setStatus("Suggestion ready for review. It has not changed the file.", "success");
    } else {
      const answer = $("#l3-assistant-answer");
      renderMarkdown(answer, result.answer || "The Assistant returned no explanation.");
      answer.hidden = false;
      setStatus("Assistant response ready.", "success");
    }
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    if (button) button.removeAttribute("aria-busy");
    assistant.removeAttribute("aria-busy");
    working.hidden = true;
    assistantBusy = false;
    updateEditorButtons();
  }
}

function showEditSuggestion(suggestion) {
  const review = $("#l3-edit-review");
  const current = $("#l3-code-editor").value.split("\n");
  const proposed = suggestion.content.split("\n");
  let prefix = 0;
  while (prefix < current.length && prefix < proposed.length && current[prefix] === proposed[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < current.length - prefix && suffix < proposed.length - prefix
      && current[current.length - 1 - suffix] === proposed[proposed.length - 1 - suffix]) suffix += 1;
  const removed = current.slice(prefix, current.length - suffix);
  const added = proposed.slice(prefix, proposed.length - suffix);
  const diff = [
    `@@ lines ${prefix + 1}–${Math.max(prefix + removed.length, prefix + 1)} @@`,
    ...removed.map((line) => `- ${line}`),
    ...added.map((line) => `+ ${line}`),
    ...(suffix ? [`… ${suffix} unchanged trailing line(s)`] : []),
  ].join("\n");
  $("#l3-edit-summary").textContent = suggestion.summary || "Proposed code change";
  $("#l3-edit-diff").textContent = diff;
  review.dataset.content = suggestion.content;
  review.hidden = false;
}

async function explainFolder(directory) {
  await runAssistant("explain", { directory });
}

async function searchProject(event) {
  event.preventDefault();
  const query = $("#l3-search-input").value.trim();
  const resultsPanel = $("#l3-search-results");
  resultsPanel.hidden = false;
  resultsPanel.replaceChildren(element("p", "l3-tree-message", "Searching project source…"));
  try {
    const result = await searchL3Project(query);
    resultsPanel.replaceChildren();
    if (!result.results.length) {
      resultsPanel.append(element("p", "l3-tree-message", "No matching source lines."));
      return;
    }
    resultsPanel.append(element("div", "l3-search-result-count",
      `${result.results.length}${result.truncated ? "+" : ""} matches in ${result.filesScanned} files`));
    for (const match of result.results) {
      const button = element("button", "l3-search-result");
      button.type = "button";
      button.append(element("strong", "", `${match.path}:${match.line}`), element("span", "", match.excerpt));
      button.addEventListener("click", () => loadFile(match.path, { line: match.line }));
      resultsPanel.append(button);
    }
  } catch (error) {
    resultsPanel.replaceChildren(element("p", "l3-tree-message error", error.message));
  }
}

export function initializeL3Developer() {
  $("#l3-search-form").addEventListener("submit", searchProject);
  $("#l3-refresh-tree").addEventListener("click", loadProject);
  $("#l3-undo").addEventListener("click", undo);
  $("#l3-redo").addEventListener("click", redo);
  $("#l3-save").addEventListener("click", saveOpenFile);
  $("#l3-explain-file").addEventListener("click", () => runAssistant("explain"));
  $("#l3-explain-selection").addEventListener("click", () => {
    const editor = $("#l3-code-editor");
    runAssistant("explain", { selection: editor.value.slice(editor.selectionStart, editor.selectionEnd) });
  });
  $("#l3-explain-selected").addEventListener("click", () => runAssistant("explain"));
  $("#l3-explain-folder").addEventListener("click", () => explainFolder($("#l3-explain-folder").dataset.directory));
  $("#l3-propose-edit").addEventListener("click", () => runAssistant("edit"));
  $("#l3-find-transact").addEventListener("click", () => runAssistant("relevance"));
  $("#l3-reject-edit").addEventListener("click", () => {
    $("#l3-edit-review").hidden = true;
    setStatus("Suggestion rejected. The editor was not changed.");
  });
  $("#l3-approve-edit").addEventListener("click", () => {
    const review = $("#l3-edit-review");
    if (review.hidden || !window.confirm("Apply this reviewed suggestion to the editor? The file will still require an explicit Save.")) return;
    replaceEditorContent(review.dataset.content);
    review.hidden = true;
    setStatus("Suggestion applied to the editor. Save to write it to the project.", "success");
  });

  const editor = $("#l3-code-editor");
  editor.addEventListener("input", () => {
    if (!loadingFile) pushUndo(editor.dataset.lastValue ?? editor.dataset.savedContent ?? "");
    editor.dataset.lastValue = editor.value;
    updateCodeDisplay();
  });
  editor.addEventListener("scroll", syncEditorScroll);
  editor.addEventListener("select", updateEditorButtons);
  editor.addEventListener("keyup", updateEditorButtons);
  editor.addEventListener("mouseup", updateEditorButtons);
  editor.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
    } else if (event.key === "Tab") {
      event.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.setRangeText("    ", start, end, "end");
      pushUndo(editor.dataset.lastValue ?? editor.dataset.savedContent);
      editor.dataset.lastValue = editor.value;
      updateCodeDisplay();
    }
  });

  function open() {
    $("#l3-developer-view").hidden = false;
    loadProject();
  }

  return open;
  window.addEventListener("beforeunload", (event) => {
    if (!editorDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  });
}
