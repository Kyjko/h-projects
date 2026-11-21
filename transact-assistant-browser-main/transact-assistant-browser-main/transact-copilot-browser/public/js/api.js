export async function getHealth() {
  const response = await fetch("/api/health", { headers: { Accept: "application/json" } });
  return response.json();
}

export async function runDiagnostics() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 210_000);
  try {
    const response = await fetch("/api/diagnostics/run", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: "{}",
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Diagnostics could not be completed.");
    return payload;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Connection diagnostics exceeded 3.5 minutes.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function loginCopilot() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 310_000);
  try {
    const response = await fetch("/api/diagnostics/copilot-login", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: "{}",
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Copilot sign-in did not complete.");
    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Copilot sign-in exceeded 5 minutes. Check the browser sign-in window, then retry.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function askCopilot(request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 310_000);
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Request failed.");
    return {
      answer: payload.answer,
      largeResult: payload.largeResult,
      largeResultError: payload.largeResultError,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Transact Assistant did not respond within 5 minutes. Check the local assistant and MCP server, then try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function callTransactTool(tool, args) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 65_000);
  try {
    const response = await fetch("/api/direct", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ tool, arguments: args }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Transact request failed.");
    return payload.result;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Transact did not respond within 65 seconds. Check the local Transact MCP server and try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestRecordDesign(action, record) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 125_000);
  try {
    const response = await fetch("/api/record-design", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ action, ...record, confirm: action === "submit" }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Record design request failed.");
    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Transact did not complete record validation or submission within 125 seconds.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function authoriseRecord(application, id, version = "") {
  const response = await fetch("/api/authorise-record", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ application, id, ...(version ? { version } : {}), confirm: true }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Record authorisation failed.");
  return payload.result;
}

export async function runAAActivity(activity) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 125_000);
  try {
    const response = await fetch("/api/aa-arr-activity", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...activity, confirm: true }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "AA arrangement activity failed.");
    return payload.result;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("The AA activity did not complete within 125 seconds. Check Transact and the activity status before retrying.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function ofsRequest(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 130_000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) },
      ...options,
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) {
      const error = new Error(payload.error || "OFS request failed.");
      error.details = payload.result;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The OFS operation exceeded 130 seconds. Check Transact before retrying.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getOFSStatus() {
  return ofsRequest("/api/ofs/status");
}

export async function loadOFSQueue() {
  return ofsRequest("/api/ofs/queue");
}

export async function generateOFSMessage(details) {
  return ofsRequest("/api/ofs/generate", { method: "POST", body: JSON.stringify(details) });
}

export async function validateOFSMessage(message) {
  return ofsRequest("/api/ofs/validate", { method: "POST", body: JSON.stringify({ message }) });
}

export async function addOFSMessage(message) {
  return ofsRequest("/api/ofs/queue", { method: "POST", body: JSON.stringify({ message, confirm: true }) });
}

export async function runOFSMessage(request) {
  return ofsRequest("/api/ofs/run", { method: "POST", body: JSON.stringify({ ...request, confirm: true }) });
}

export async function clearOFSQueue() {
  return ofsRequest("/api/ofs/queue/clear", { method: "POST", body: JSON.stringify({ confirm: true }) });
}

async function localToolRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Local workspace request failed.");
  return payload;
}

export async function generateEson(records) {
  return localToolRequest("/api/generate-eson", {
    method: "POST",
    body: JSON.stringify({ records }),
  });
}

export async function findReferenceEson(record) {
  const query = new URLSearchParams(record);
  return localToolRequest(`/api/reference-eson?${query}`);
}

export async function listSkills() {
  return localToolRequest("/api/skills");
}

export async function readSkillFile(filePath) {
  const query = new URLSearchParams({ path: filePath });
  return localToolRequest(`/api/skills/file?${query}`);
}

export async function uploadSkill(name, content) {
  return localToolRequest("/api/skills", {
    method: "POST",
    body: JSON.stringify({ name, content }),
  });
}

export async function saveSkill(filePath, content) {
  return localToolRequest("/api/skills/file", {
    method: "PUT",
    body: JSON.stringify({ path: filePath, content }),
  });
}

export async function getL3Project() {
  return localToolRequest("/api/l3/project");
}

export async function getL3File(filePath) {
  const query = new URLSearchParams({ path: filePath });
  return localToolRequest(`/api/l3/file?${query}`);
}

export async function searchL3Project(query, directory = "") {
  const params = new URLSearchParams({ q: query, directory });
  return localToolRequest(`/api/l3/search?${params}`);
}

export async function saveL3File(filePath, content, expectedHash) {
  return localToolRequest("/api/l3/file", {
    method: "PUT",
    body: JSON.stringify({ path: filePath, content, expectedHash }),
  });
}

export async function askL3Assistant(request) {
  return localToolRequest("/api/l3/assistant", {
    method: "POST",
    body: JSON.stringify(request),
  });
}
