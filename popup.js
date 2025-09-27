const elRun = document.getElementById("run");
const elContent = document.getElementById("content");
const elStatus = document.getElementById("status");
const elLogBox = document.getElementById("logBox");
const elToggleLogs = document.getElementById("toggleLogs");
const elLogsSection = document.getElementById("logsSection");

function appendLog(line) {
  elLogBox.textContent += (elLogBox.textContent ? "\n" : "") + line;
  elLogBox.scrollTop = elLogBox.scrollHeight;
}
function clearLogsUI() { elLogBox.textContent = ""; }

async function setLogsVisible(visible) {
  elLogsSection.style.display = visible ? "block" : "none";
  elToggleLogs.textContent = visible ? "Hide Logs" : "Show Logs";
  await chrome.storage.local.set({ showLogsPref: !!visible });
}

function renderDigest(d) {
  if (!d) {
    elContent.innerHTML = "<div class='muted'>No digest yet. Click Make Digest.</div>";
    return;
  }
  const bullets = (d.bullets || []).map(b => `<li>${b}</li>`).join("");
  const tags = (d.tags || []).map(t => `<span class="tag">${t}</span>`).join("");
  elContent.innerHTML = `
    <div><strong><a href="${d.url}" target="_blank" style="text-decoration:none;">${d.title || "(Untitled page)"}</a></strong></div>
    <div class="muted" style="margin:4px 0;">Last updated: ${new Date(d.lastUpdated).toLocaleString()}</div>
    <ul>${bullets}</ul>
    <div class="tags">${tags}</div>
  `;
}

async function refreshDigest() {
  const resp = await chrome.runtime.sendMessage({ type: "GET_DIGEST" });
  if (resp?.ok) renderDigest(resp.digest);
}

// Ensure content.js is available in the active tab (once per popup usage)
async function ensureContentScript() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  } catch (_) { /* likely already injected */ }
}

// Load stored logs & log visibility preference on open
(async () => {
  const data = await new Promise(res => chrome.storage.local.get(["agentLogs", "showLogsPref"], res));
  const show = !!data.showLogsPref;
  await setLogsVisible(show); // sets button text & section display
  clearLogsUI();
  (data.agentLogs || []).forEach(appendLog);
})();

// Toggle button
elToggleLogs.addEventListener("click", async () => {
  const visibleNow = elLogsSection.style.display !== "none";
  await setLogsVisible(!visibleNow);
});

// Run button
elRun.addEventListener("click", async () => {
  elStatus.textContent = "Starting…";
  clearLogsUI(); // UI clears; background also resets storage via AGENT_LOG_RESET
  await ensureContentScript();
  const resp = await chrome.runtime.sendMessage({ type: "RUN_AGENT" });
  if (!resp?.ok && resp?.error) {
    appendLog("ERROR: " + resp.error);
    elStatus.textContent = "Failed.";
  }
});

// Live events from background
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;

  if (msg.type === "AGENT_LOG_RESET") {
    clearLogsUI();
    // no return; wait for AGENT_RUN_STARTED for the header line
  }

  if (msg.type === "AGENT_RUN_STARTED") {
    elStatus.textContent = "Running…";
    appendLog(`=== Run started at ${new Date(msg.startedAt).toLocaleString()} ===`);
    return;
  }

  if (msg.type === "AGENT_LOG") {
    appendLog(msg.line);
    return;
  }

  if (msg.type === "AGENT_RUN_DONE") {
    elStatus.textContent = msg.ok ? "Done." : "Finished (with warnings).";
    refreshDigest();
    return;
  }

  if (msg.type === "DIGEST_READY") {
    refreshDigest();
    return;
  }
});

// Initial load
refreshDigest();
