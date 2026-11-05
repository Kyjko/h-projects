export async function getRecentAmendments() {
  const response = await fetch("/api/design-document/amendments", {
    headers: { Accept: "application/json" },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Could not load recent amendments.");
  return payload.amendments;
}

async function readJsonResponse(response, fallback) {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || fallback);
  return payload;
}

export async function editDesignDocument({ file, amendmentIds, records, screenshots, instructions, onJobCreated }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20 * 60 * 1000);
  try {
    const creationResponse = await fetch("/api/design-document/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        filename: file.name,
        amendmentIds,
        records,
        screenshots,
        instructions,
      }),
      signal: controller.signal,
    });
    const { jobId } = await readJsonResponse(creationResponse, "Could not start document editing.");
    onJobCreated?.(jobId);
    const uploadResponse = await fetch(`/api/design-document/jobs/${encodeURIComponent(jobId)}/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        Accept: "application/json",
      },
      body: file,
      signal: controller.signal,
    });
    return await readJsonResponse(uploadResponse, "The design document could not be edited.");
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Document editing exceeded twenty minutes and was cancelled. The server may still be processing the job; check its log before retrying.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getDesignDocumentProgress(jobId) {
  const response = await fetch(`/api/design-document/jobs/${encodeURIComponent(jobId)}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Could not read document-editing progress.");
  return payload;
}
