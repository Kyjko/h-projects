export async function getHealth() {
  const response = await fetch("/api/health", { headers: { Accept: "application/json" } });
  return response.json();
}

export async function askCopilot(request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 125_000);
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
      throw new Error("Transact Assistant did not respond within 125 seconds. Check the local assistant and MCP server, then try again.");
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

export async function authoriseRecord(application, id) {
  const response = await fetch("/api/authorise-record", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ application, id, confirm: true }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Record authorisation failed.");
  return payload.result;
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
