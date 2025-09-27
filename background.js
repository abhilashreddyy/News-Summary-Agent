// background.js — MV3 service worker (steps log AFTER they complete)

const CONTROLLER_MODEL = "gpt-4o-mini";
const SUMMARIZER_MODEL = "gpt-4o-mini";

// ===== Helpers =====
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const stripFences = (s) => (s || "").replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

async function getSync(keys) { return new Promise(res => chrome.storage.sync.get(keys, res)); }
async function setLocal(obj) { return new Promise(res => chrome.storage.local.set(obj, res)); }
async function getLocal(keys) { return new Promise(res => chrome.storage.local.get(keys, res)); }

async function callOpenAIChat({ apiKey, model, system, user, temperature = 0.2, max_tokens = 1000 }) {
  if (!apiKey) throw new Error("OpenAI API key missing. Set it in Options or hardcode it in background.js.");
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature, max_tokens })
  });
  if (!r.ok) throw new Error(`OpenAI error ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content?.trim() ?? "";
}

// ===== Tools =====
async function tool_scrape_page() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab.");
  const res = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_PAGE" }).catch(() => null);
  if (!res?.ok) throw new Error(res?.error || "Unable to scrape page. Did you open the page after installing?");
  return res.payload; // {title, url, text}
}

async function tool_summarize_and_tag({ llmKey, page }) {
  const system = `
You are a precise summarizer/tagger. Output STRICT JSON ONLY:
{
  "title": string,
  "url": string,
  "bullets": string[],
  "tags": string[]
}
No markdown, no commentary, no extra fields. Keep bullets crisp and non-duplicative.`;
  const user = JSON.stringify({ title: page.title, url: page.url, text: page.text?.slice(0, 8000) }, null, 2);

  let raw = await callOpenAIChat({ apiKey: llmKey, model: SUMMARIZER_MODEL, system, user, temperature: 0.1, max_tokens: 700 });
  let obj;
  try { obj = JSON.parse(stripFences(raw)); }
  catch {
    const fix = await callOpenAIChat({
      apiKey: llmKey, model: SUMMARIZER_MODEL,
      system: "You fix malformed JSON to valid JSON. Output only JSON.",
      user: raw, temperature: 0, max_tokens: 700
    });
    obj = JSON.parse(stripFences(fix));
  }
  obj.bullets = Array.isArray(obj.bullets) ? obj.bullets.slice(0, 6) : [];
  obj.tags = Array.isArray(obj.tags) ? obj.tags.slice(0, 6).map(s => String(s).toLowerCase()) : [];
  return obj;
}

async function tool_finalize({ digest }) {
  const lastUpdated = new Date().toISOString();
  const finalDigest = { ...digest, lastUpdated };
  await setLocal({ latestDigest: finalDigest }); // overwrite
  try { chrome.runtime.sendMessage({ type: "DIGEST_READY", payload: { lastUpdated } }); } catch (_){}
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon128.png",
      title: "Tab Digest Ready",
      message: "Your summary + tags are ready in the popup."
    });
  } catch (_){}
  return finalDigest;
}

// ===== Controller (Agent) =====
const CONTROLLER_SYSTEM = `
You control a tiny agent. Respond ONLY with JSON:
{"type":"CALL_TOOL","tool":"scrape_page"}
{"type":"CALL_TOOL","tool":"summarize_and_tag"}
{"type":"CALL_TOOL","tool":"finalize"}
{"type":"FINALIZE"}
{"type":"END"}

Rules:
- If no page contents yet, call "scrape_page".
- If page exists but not summarized, call "summarize_and_tag".
- Then call "finalize" (or emit {"type":"FINALIZE"}).
- Then return {"type":"END"}.
JSON only.`;

// ===== Run lock & live log emitter =====
let __RUNNING = false;

// persist + stream each line
function makeLogger(runId, linesArray) {
  return function emit(line) {
    const msg = String(line);
    linesArray.push(msg);
    // persist live so logs survive popup close
    setLocal({ agentLogs: linesArray });
    // stream to popup if it's open
    try { chrome.runtime.sendMessage({ type: "AGENT_LOG", runId, line: msg }); } catch(_){}
  };
}

// ===== Orchestrator with "step finishes → then log" behavior =====
async function runAgentOnce() {
  if (__RUNNING) return { ok:false, error:"Agent already running." };
  __RUNNING = true;

  const runId = `run_${Date.now()}`;
  const logs = [];
  const log = makeLogger(runId, logs);

  // tell popup to clear old logs immediately
  try { chrome.runtime.sendMessage({ type: "AGENT_LOG_RESET", runId }); } catch(_){}
  await setLocal({ agentLogs: [] });

  const startedAt = new Date();
  log(`=== Run started at ${startedAt.toLocaleString()} (${startedAt.toISOString()}) ===`);

  try {
    const { openaiKey: keyFromSync } = await getSync(["openaiKey"]);
    const openaiKey = keyFromSync || "PUT_YOUR_OPENAI_API_KEY_HERE";
    if (!openaiKey || /PUT_YOUR_OPENAI_KEY_HERE/.test(openaiKey)) throw new Error("OpenAI key not set.");

    const state = { page: null, digest: null };
    let history = `You are orchestrating tools to build a page digest.\nSteps taken so far:\n`;

    async function askController() {
      const userPrompt = `${history}\nWhat is the next action? Respond with ONE JSON action only.`;
      return callOpenAIChat({
        apiKey: openaiKey, model: CONTROLLER_MODEL,
        system: CONTROLLER_SYSTEM, user: userPrompt,
        temperature: 0, max_tokens: 250
      });
    }

    try { chrome.runtime.sendMessage({ type: "AGENT_RUN_STARTED", runId, startedAt: startedAt.toISOString() }); } catch(_){}

    let visualStep = 0; // count only completed steps we show

    for (let step = 1; step <= 8; step++) {
      const out = await askController();
      let action;
      try { action = JSON.parse(stripFences(out)); } catch { action = null; }

      if (!action) {
        history += `- Controller returned invalid JSON; retry.\n`;
        continue;
      }

      // FINALIZE (no tool call) — persist, THEN log as a completed step
      if (action.type === "FINALIZE") {
        if (state.digest) {
          await tool_finalize({ digest: state.digest });
          visualStep += 1;
          log(`Step ${visualStep} — finalize ✓ Stored digest & notified`);
          history += `- finalize done.\n`;
        } else {
          visualStep += 1;
          log(`Step ${visualStep} — finalize ✓ No digest present; ended`);
          history += `- finalize ended (no digest).\n`;
        }
        await setLocal({ agentLogs: logs }); // overwrite with this run
        try { chrome.runtime.sendMessage({ type: "AGENT_RUN_DONE", runId, ok: true }); } catch(_){}
        return { ok: true, logs };
      }

      // END — no completed step to show; just exit
      if (action.type === "END") {
        await setLocal({ agentLogs: logs });
        try { chrome.runtime.sendMessage({ type: "AGENT_RUN_DONE", runId, ok: true }); } catch(_){}
        return { ok: true, logs };
      }

      if (action.type === "CALL_TOOL") {
        const tool = (action.tool || "").toLowerCase();

        if (tool === "scrape_page") {
          const page = await tool_scrape_page();              // run tool first
          state.page = page;
          visualStep += 1;                                    // THEN show a step log
          log(`Step ${visualStep} — scrape_page ✓ "${page.title}" (${page.url}) len=${page.text?.length || 0}`);
          history += `- scraped page\n`;
          try { chrome.runtime.sendMessage({ type: "AGENT_PROGRESS", runId, step: visualStep, stage: "scraped", meta: { title: page.title, url: page.url, textLen: page.text?.length || 0 } }); } catch(_){}
          await sleep(40);
          continue;
        }

        if (tool === "summarize_and_tag") {
          if (!state.page) {
            // nothing to log as completed step; controller will try again
            history += `- summarize requested without page\n`;
            continue;
          }
          const result = await tool_summarize_and_tag({ llmKey: openaiKey, page: state.page });
          state.digest = { ...result, _logs: logs };
          visualStep += 1;
          log(`Step ${visualStep} — summarize_and_tag ✓ bullets=${result.bullets.length}, tags=${result.tags.length}`);
          history += `- summarized\n`;
          try { chrome.runtime.sendMessage({ type: "AGENT_PROGRESS", runId, step: visualStep, stage: "summarized", meta: { bullets: result.bullets.length, tags: result.tags.length } }); } catch(_){}
          await sleep(40);
          continue;
        }

        if (tool === "finalize") {
          if (!state.digest) {
            history += `- finalize requested without digest\n`;
            continue;
          }
          await tool_finalize({ digest: state.digest });      // run tool first
          visualStep += 1;                                    // THEN log
          log(`Step ${visualStep} — finalize ✓ Stored digest & notified`);
          history += `- finalize done\n`;
          await setLocal({ agentLogs: logs });
          try { chrome.runtime.sendMessage({ type: "AGENT_RUN_DONE", runId, ok: true }); } catch(_){}
          return { ok: true, logs };
        }

        // Unknown tool — no completed step to show
        history += `- unknown tool "${tool}"\n`;
        continue;
      }

      // Unexpected — no completed step to show
      history += `- unexpected action\n`;
    }

    // safety exit
    await setLocal({ agentLogs: logs });
    try { chrome.runtime.sendMessage({ type: "AGENT_RUN_DONE", runId, ok: false }); } catch(_){}
    return { ok: false, logs, error: "Max steps reached." };
  } finally {
    __RUNNING = false;
  }
}

// ===== Messages from popup =====
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "RUN_AGENT") {
      try {
        const r = await runAgentOnce();
        sendResponse({ ok: true, ...r });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return;
    }
    if (msg?.type === "GET_DIGEST") {
      const data = await getLocal(["latestDigest", "agentLogs"]);
      sendResponse({ ok: true, digest: data.latestDigest || null, logs: data.agentLogs || [] });
      return;
    }
    if (msg?.type === "SET_OPENAI_KEY") {
      await new Promise(res => chrome.storage.sync.set({ openaiKey: msg.key }, res));
      sendResponse({ ok: true });
      return;
    }
  })();
  return true;
});

// Optional: hourly schedule — guarded by run lock so it won't double-run
try {
  chrome.alarms.create("tab_digest_tick", { periodInMinutes: 60 });
  chrome.alarms.onAlarm.addListener(async (a) => {
    if (a.name !== "tab_digest_tick") return;
    const h = new Date().getHours();
    if (h < 8 || h > 22) return;
    try { await runAgentOnce(); } catch(_) {}
  });
} catch (_){}
