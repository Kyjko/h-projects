const APPLICATION = "[A-Z0-9][A-Z0-9.]*";
const VERSION = "[A-Z0-9][A-Z0-9._-]*";

export function parseApplicationInput(value) {
  const input = String(value || "").trim();
  const match = input.match(new RegExp(
    `^(${APPLICATION})(?:,(${VERSION}))?(?:\\s+([SIALE])(?:\\s+([^\\s]+))?)?$`,
    "i",
  ));
  if (!match) return null;

  const application = match[1].toUpperCase();
  const version = match[2]?.toUpperCase() || "";
  const command = match[3]?.toUpperCase() || "";
  const recordId = match[4] || "";
  if (command && ["S", "I", "A"].includes(command) && !recordId) {
    return { application, version, command, recordId, needsRecordId: true };
  }
  if (command && ["L", "E"].includes(command) && recordId) return null;
  return { application, version, command, recordId, needsRecordId: false };
}
