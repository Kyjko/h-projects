const APPLICATION = /^[A-Z0-9][A-Z0-9.]*$/;
const VERSION = /^[A-Z0-9][A-Z0-9._-]{0,127}$/;
const FIELD = /^[A-Z0-9@._-]+$/;
const FUNCTIONS = new Set(["I", "S"]);
const MAX_MESSAGE_LENGTH = 256 * 1024;

export function getOFSMessageConfig(env = process.env) {
  return {
    user: env.OFS_MESSAGE_USER || "AUTHOR",
    password: env.OFS_MESSAGE_PASSWORD || "",
    company: env.TRANSACT_OFS_COMPANY ?? "",
    noOfAuth: env.TRANSACT_OFS_NO_OF_AUTH ?? "0",
  };
}

function parseDataFields(segments, required) {
  if (!segments.length && !required) return [];
  if (!segments.length || segments.length > 1000) {
    throw Object.assign(new Error("An OFS input must contain between 1 and 1000 field assignments."), { status: 400 });
  }
  const fields = segments.map((segment, index) => {
    const match = /^([A-Z0-9@._-]+)(?::([1-9]\d*)(?::([1-9]\d*))?)?=(.*)$/s.exec(segment);
    if (!match || !FIELD.test(match[1])) {
      throw Object.assign(new Error(`Invalid OFS field assignment in data segment ${index + 1}.`), { status: 400 });
    }
    const [, name, mvText, svText, encodedValue] = match;
    const value = encodedValue === "\\NULL" ? "NULL" : encodedValue;
    if (value.length > 6000) {
      throw Object.assign(new Error(`OFS value for ${name} exceeds 6000 characters.`), { status: 400 });
    }
    return {
      name,
      ...(mvText ? { mv: Number(mvText) } : {}),
      ...(svText ? { sv: Number(svText) } : {}),
      ...(encodedValue === "NULL" ? { intent: "clear", value: "" } : { value }),
    };
  });
  const positions = fields.map((field) => `${field.name}:${field.mv || 1}:${field.sv || 1}`);
  if (new Set(positions).size !== positions.length) {
    throw Object.assign(new Error("OFS message contains duplicate field positions."), { status: 400 });
  }
  return fields;
}

export function parseOFSMessage(message, config = getOFSMessageConfig()) {
  if (typeof message !== "string" || !message.trim() || message.length > MAX_MESSAGE_LENGTH) {
    throw Object.assign(new Error(`OFS message must contain 1 to ${MAX_MESSAGE_LENGTH} characters.`), { status: 400 });
  }
  if (/[\r\n]/.test(message)) {
    throw Object.assign(new Error("OFS messages must be a single line."), { status: 400 });
  }
  const segments = message.trim().split(",");
  if (segments.length < 4) {
    throw Object.assign(new Error("OFS message is incomplete; expected application, header, user information, and record ID."), { status: 400 });
  }
  const application = segments[0].toUpperCase();
  if (!APPLICATION.test(application)) {
    throw Object.assign(new Error("OFS application names may contain letters, numbers, and periods only."), { status: 400 });
  }

  const header = segments[1].split("/");
  if (header.length !== 5) {
    throw Object.assign(new Error("OFS header must include VERSION/FUNCTION/PROCESS/GTS/NO.OF.AUTH positions."), { status: 400 });
  }
  const [version, operation, process, gts, noOfAuth] = header;
  if (version && !VERSION.test(version.toUpperCase())) {
    throw Object.assign(new Error("OFS VERSION contains invalid characters."), { status: 400 });
  }
  const normalizedOperation = operation.toUpperCase();
  if (!FUNCTIONS.has(normalizedOperation)) {
    throw Object.assign(new Error(`Only OFS functions I and S are supported; function ${operation || "(empty)"} cannot be executed here.`), { status: 400 });
  }
  if (process || gts) {
    throw Object.assign(new Error("OFS PROCESS and GTS options are not supported by the configured Transact MCP ofs-input tool."), { status: 400 });
  }
  if (noOfAuth !== config.noOfAuth) {
    throw Object.assign(new Error(`NO.OF.AUTH must match the configured value (${config.noOfAuth}).`), { status: 400 });
  }

  const userInfo = segments[2].split("/");
  const companyMatches = config.company
    ? userInfo.length === 3 && userInfo[2] === config.company
    : userInfo.length === 2 || (userInfo.length === 3 && userInfo[2] === "");
  if (!companyMatches
      || userInfo[0] !== config.user
      || !config.password
      || userInfo[1] !== config.password) {
    throw Object.assign(new Error("OFS credentials or company do not match the local Transact MCP configuration."), { status: 400 });
  }
  const id = segments[3].replace(/\?/g, ",").replace(/\^/g, "/");
  if (!id || id.length > 256) {
    throw Object.assign(new Error("OFS record ID must contain between 1 and 256 characters."), { status: 400 });
  }
  if (normalizedOperation === "S" && version) {
    throw Object.assign(new Error("OFS function S uses ofs-read, which does not accept a VERSION parameter."), { status: 400 });
  }
  const fields = parseDataFields(segments.slice(4), normalizedOperation === "I");
  if (normalizedOperation === "S" && fields.length) {
    throw Object.assign(new Error("OFS function S does not accept field assignments."), { status: 400 });
  }
  return {
    operation: normalizedOperation,
    application,
    id,
    ...(version ? { version } : {}),
    fields,
    confirm: true,
  };
}

export function generateOFSMessage(details, config = getOFSMessageConfig()) {
  if (!config.password) {
    throw Object.assign(new Error("Set OFS_MESSAGE_PASSWORD in the local environment to generate OFS messages."), { status: 503 });
  }
  const application = typeof details?.application === "string" ? details.application.trim().toUpperCase() : "";
  const version = typeof details?.version === "string" ? details.version.trim().toUpperCase() : "";
  const operation = typeof details?.function === "string" ? details.function.trim().toUpperCase() : "";
  const id = typeof details?.id === "string" ? details.id.trim() : "";
  const data = typeof details?.data === "string" ? details.data.trim() : "";
  if (!APPLICATION.test(application) || (version && !VERSION.test(version))) {
    throw Object.assign(new Error("Enter a valid Transact application and optional VERSION."), { status: 400 });
  }
  if (!FUNCTIONS.has(operation)) {
    throw Object.assign(new Error("Only functions I (record input/amend) and S (record read) are supported."), { status: 400 });
  }
  if (!id || id.length > 256 || /[\r\n]/.test(id)) {
    throw Object.assign(new Error("Enter a record ID between 1 and 256 characters without line breaks."), { status: 400 });
  }
  if (operation === "I" && !data) {
    throw Object.assign(new Error("Enter at least one FIELD=VALUE assignment."), { status: 400 });
  }
  if (operation === "S" && data) {
    throw Object.assign(new Error("Function S does not use message data; clear the field assignments."), { status: 400 });
  }
  const encodedId = id.replace(/,/g, "?").replace(/\//g, "^");
  const userInfo = `${config.user}/${config.password}${config.company ? `/${config.company}` : ""}`;
  const message = `${application},${version}/${operation}///${config.noOfAuth},${userInfo},${encodedId}${data ? `,${data}` : ""}`;
  parseOFSMessage(message, config);
  return message;
}

export function maskOFSMessage(message, config = getOFSMessageConfig()) {
  if (typeof message !== "string") return "";
  const segments = message.split(",");
  if (segments.length >= 3) {
    const userInfo = segments[2].split("/");
    if (userInfo.length >= 2) {
      userInfo[1] = "***";
      segments[2] = userInfo.join("/");
      return segments.join(",");
    }
  }
  return config.password ? message.replaceAll(config.password, "***") : message;
}
