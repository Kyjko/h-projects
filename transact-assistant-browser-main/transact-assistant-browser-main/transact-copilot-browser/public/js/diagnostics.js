import { loginCopilot, runDiagnostics } from "./api.js";

const $ = (selector) => document.querySelector(selector);
const CHECKS = [
  ["webToMcp", "Web app → Transact MCP"],
  ["assistant", "Transact Assistant (Copilot CLI)"],
  ["assistantToMcp", "Assistant → Transact MCP"],
  ["wordMcp", "Assistant → Word MCP"],
  ["screenshotMcp", "Assistant → Screenshot MCP"],
  ["database", "Local PostgreSQL (t24)"],
];

function node(tag, className = "", text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function statusLabel(status) {
  return ({
    connected: "Connected",
    failed: "Needs attention",
    unavailable: "Unavailable",
    unauthenticated: "Not authenticated",
    "not-tested": "Not tested",
  })[status] || "Unknown";
}

function renderChecks(checks) {
  const container = $("#diagnostic-checks");
  container.replaceChildren();
  for (const [key, title] of CHECKS) {
    const check = checks[key] || { status: "not-tested", detail: "Not tested yet." };
    const card = node("article", `diagnostic-check ${check.status}`);
    const heading = node("div", "diagnostic-check-heading");
    heading.append(node("h2", "", title), node("span", "diagnostic-badge", statusLabel(check.status)));
    card.append(heading, node("p", "diagnostic-detail", check.detail));
    container.append(card);
  }
}

function updateAuthenticationStatus(check) {
  const status = $("#diagnostic-auth-status");
  status.className = `diagnostic-auth-status${check?.status === "connected" ? " connected" : check?.status === "unauthenticated" ? " unauthenticated" : ""}`;
  if (check?.status === "connected") {
    status.textContent = "Signed in: the local Copilot CLI responded successfully.";
  } else if (check?.status === "unauthenticated") {
    status.textContent = "The Copilot CLI is available but not signed in. Use Sign in / refresh to authenticate.";
  } else if (check?.status === "unavailable") {
    status.textContent = "The Copilot CLI could not be located. Fix its executable path before signing in.";
  } else if (check?.status === "failed") {
    status.textContent = "Authentication or the diagnostic prompt failed. Retry sign-in, then run diagnostics again.";
  } else {
    status.textContent = "Run diagnostics to check whether the local CLI is signed in.";
  }
}

function renderConfigFile(file, label) {
  const row = node("div", "diagnostic-config-file");
  const info = node("div", "diagnostic-config-file-info");
  info.append(
    node("strong", "", label),
    node("code", "", file.path),
    node("span", "", file.purpose),
  );
  row.append(info, node("span", `diagnostic-file-state${file.exists ? " present" : ""}`, file.exists ? "Found" : "Not found"));
  return row;
}

function renderConfiguration(configuration) {
  const container = $("#diagnostic-configuration");
  container.replaceChildren();

  const copilot = node("section", "diagnostic-config-card");
  copilot.append(
    node("h2", "", "Copilot CLI configuration"),
    node("p", "diagnostic-config-summary", configuration.copilot.available
      ? `CLI resolved to ${configuration.copilot.executable || "the system command path"}.`
      : "Copilot CLI could not be located. Set an executable override or install it."),
  );
  for (const file of configuration.copilot.configFiles) {
    copilot.append(renderConfigFile(file, file.path.endsWith("mcp-config.json") ? "MCP registrations" : "CLI settings"));
  }
  const copilotSettings = node("ul", "diagnostic-settings");
  for (const setting of configuration.copilot.settings) {
    const item = node("li");
    item.append(node("code", "", setting.name), document.createTextNode(` — ${setting.purpose}`));
    copilotSettings.append(item);
  }
  copilot.append(copilotSettings);
  copilot.append(node("p", "diagnostic-config-note", "Config file contents are not displayed, to keep credentials and personal settings private. Word MCP and Playwright MCP must be registered here for design-document editing and screenshots; Transact MCP is injected per Assistant request."));

  const transact = node("section", "diagnostic-config-card");
  transact.append(
    node("h2", "", "Transact MCP configuration"),
    node("p", "diagnostic-config-summary", `Effective endpoint: ${configuration.transactMcp.endpoint}`),
    node("p", "diagnostic-config-summary", `Selected by: ${configuration.transactMcp.endpointSource}`),
  );
  for (const file of configuration.transactMcp.configFiles) {
    transact.append(renderConfigFile(file, "Server config.toml candidate"));
  }
  const transactSettings = node("ul", "diagnostic-settings");
  for (const setting of configuration.transactMcp.settings) {
    const item = node("li");
    item.append(node("code", "", setting.name), document.createTextNode(` — ${setting.purpose}`));
    transactSettings.append(item);
  }
  transact.append(transactSettings);
  transact.append(node("p", "diagnostic-config-note", "The browser cannot identify a separately launched MCP server’s working directory. If no config.toml candidate is found, check the server process’s launch directory or --config argument. Never share credentials when requesting support."));
  const database = node("section", "diagnostic-config-card");
  database.append(
    node("h2", "", "Local PostgreSQL queue"),
    node("p", "diagnostic-config-summary", `Endpoint: ${configuration.database.host}:${configuration.database.port}`),
    node("p", "diagnostic-config-summary", `Database / user: ${configuration.database.database} / ${configuration.database.user}`),
    node("p", "diagnostic-config-summary", `Queue table: ${configuration.database.table}`),
    node("p", "diagnostic-config-note", "The database password is read from T24_DATABASE_PASSWORD and is never displayed. OFS message profiles use OFS_MESSAGE_USER / OFS_MESSAGE_PASSWORD plus TRANSACT_OFS_NO_OF_AUTH and TRANSACT_OFS_COMPANY."),
  );
  const ofs = node("section", "diagnostic-config-card");
  ofs.append(
    node("h2", "", "OFS message profile"),
    node("p", "diagnostic-config-summary", `User: ${configuration.ofsMessage.user}; NO.OF.AUTH: ${configuration.ofsMessage.noOfAuth}; company: ${configuration.ofsMessage.company || "(default)"}`),
    node("p", "diagnostic-config-summary", configuration.ofsMessage.passwordConfigured
      ? "OFS password is configured locally and is not displayed."
      : "OFS_MESSAGE_PASSWORD is not configured."),
  );
  container.append(copilot, transact, database, ofs);
}

export function initializeDiagnostics({ onOpen, onClose } = {}) {
  const button = $("#open-diagnostics");
  const runButton = $("#run-diagnostics");
  const loginButton = $("#copilot-login");
  let running = false;
  let loginRunning = false;

  async function run() {
    if (running) return;
    running = true;
    runButton.disabled = true;
    loginButton.disabled = true;
    runButton.textContent = "Checking connections…";
    $("#diagnostic-last-run").textContent = "Running read-only checks…";
    renderChecks({
      webToMcp: { status: "not-tested", detail: "Calling the read-only Transact context tool…" },
      assistant: { status: "not-tested", detail: "Starting Copilot CLI and testing authentication…" },
      assistantToMcp: { status: "not-tested", detail: "Waiting for the Assistant check…" },
      wordMcp: { status: "not-tested", detail: "Waiting for the Assistant check…" },
      screenshotMcp: { status: "not-tested", detail: "Waiting for the Assistant check…" },
      database: { status: "not-tested", detail: "Testing the local t24 PostgreSQL connection…" },
    });
    try {
      const result = await runDiagnostics();
      renderChecks(result.checks);
      updateAuthenticationStatus(result.checks.assistant);
      renderConfiguration(result.configuration);
      $("#diagnostic-last-run").textContent = `Last checked ${new Date(result.checkedAt).toLocaleString()}.`;
      const connection = $("#connection-label");
      connection.textContent = result.checks.webToMcp.status === "connected"
        ? "Transact MCP connected"
        : "Transact MCP needs attention";
      connection.title = result.configuration.transactMcp.endpoint;
    } catch (error) {
      renderChecks({
        webToMcp: { status: "failed", detail: error.message },
        assistant: { status: "not-tested", detail: "The diagnostic request could not reach the local web app." },
        assistantToMcp: { status: "not-tested", detail: "Not tested." },
        wordMcp: { status: "not-tested", detail: "Not tested." },
        screenshotMcp: { status: "not-tested", detail: "Not tested." },
        database: { status: "failed", detail: "The diagnostic request could not test PostgreSQL." },
      });
      updateAuthenticationStatus({ status: "failed" });
      $("#diagnostic-last-run").textContent = "Diagnostic request failed.";
    } finally {
      running = false;
      runButton.disabled = false;
      loginButton.disabled = loginRunning;
      runButton.textContent = "Run diagnostics";
    }
  }

  button.addEventListener("click", () => {
    onOpen?.();
    run();
  });
  runButton.addEventListener("click", run);
  loginButton.addEventListener("click", async () => {
    if (loginRunning || running) return;
    loginRunning = true;
    loginButton.disabled = true;
    loginButton.textContent = "Waiting for GitHub sign-in…";
    $("#diagnostic-auth-status").textContent = "Copilot CLI sign-in is running. Complete authorization in the browser window opened by the CLI.";
    try {
      await loginCopilot();
      $("#diagnostic-auth-status").textContent = "Sign-in completed. Rechecking Copilot CLI authentication and MCP access…";
      await run();
    } catch (error) {
      $("#diagnostic-auth-status").className = "diagnostic-auth-status unauthenticated";
      $("#diagnostic-auth-status").textContent = error.message;
    } finally {
      loginRunning = false;
      loginButton.disabled = false;
      loginButton.textContent = "Sign in / refresh";
    }
  });
  $("#diagnostic-return").addEventListener("click", () => onClose?.());
  return { run };
}
