# Tab Digest Agent (Agentic AI Chrome Extension)

This is a **Chrome Extension** that demonstrates an **Agentic AI workflow** using OpenAI.  

It can:  
- Scrape the current active tab (article/webpage)  
- Summarize and tag it using an LLM  
- Save and display the digest (title, bullets, tags, last updated)  
- Show **live step-by-step logs** of what the agent is doing  

Each step is **decided by the LLM** (agentic behavior):  
1. `scrape_page`  
2. `summarize_and_tag`  
3. `finalize`  
4. `END`  

---

## 🚀 Features
- Agent chooses tools in sequence (`scrape → summarize → finalize`).  
- Live log streaming (see steps appear as they complete).  
- Persistent logs and digest across popup closes.  
- Toggle button to hide/show logs.  
- Notifications when a digest is ready.  
- Example of **multi-step reasoning + tool calling** for Agentic AI.  

---

## 📂 Project Structure

```
.
├── manifest.json         # Chrome extension manifest (MV3)
├── background.js         # Agent orchestrator + OpenAI calls
├── content.js            # Scrapes page content
├── popup.html            # Extension UI
├── popup.js              # UI logic, digest rendering, log streaming
├── icon128.png           # Extension icon
```

---

## 🔑 Setup Instructions

### 1. Clone the repo
```bash
git clone https://github.com/yourusername/tab-digest-agent.git
cd tab-digest-agent
```

### 2. Add your OpenAI API key
Open `background.js` and replace:

```js
const openaiKey = keyFromSync || "PUT_YOUR_OPENAI_KEY_HERE";
```

with your actual key from [OpenAI API](https://platform.openai.com/).

⚠️ **Note:** Never commit your real key to GitHub.

---

### 3. Load the extension in Chrome
1. Open Chrome and go to `chrome://extensions/`.  
2. Turn on **Developer mode** (top-right).  
3. Click **Load unpacked**.  
4. Select this project folder.  
5. You should now see the extension icon in your toolbar.  

---

### 4. Use the extension
1. Navigate to any article/news webpage.  
2. Click the **Tab Digest Agent** icon.  
3. Click **Make Digest**.  
4. Watch live logs appear step by step:  
   - Scraping → Summarizing → Finalizing.  
5. View the **digest**: title, summary bullets, tags, and last updated.  
6. Use the **Show/Hide Logs** toggle to see/hide logs.  
7. Close and reopen the popup → logs and digest persist.  

---

## 🧠 How it works
- The **controller LLM** decides what to do next based on the current state and history.  
- The available tools are:  
  - `scrape_page` → get page text  
  - `summarize_and_tag` → call OpenAI to summarize + tag  
  - `finalize` → store digest + notify user  
  - `END` → stop execution  
- Logs are written on each step and stored in `chrome.storage.local`.  
- Popup listens for background messages and updates UI live.  

---

## 📸 Demo Screenshot
_Add a screenshot of the popup here after a run._  

---

## 🎥 Demo Video
You can see a short demo video [here](YOUR_YOUTUBE_LINK).

---

## ⚡ Example Logs
```
=== Run started at 9/26/2025, 10:10:05 AM (2025-09-26T17:10:05.737Z) ===
Step 1 — scrape_page ✓ "Some Article Title" (https://example.com) len=12034
Step 2 — summarize_and_tag ✓ bullets=5, tags=3
Step 3 — finalize ✓ Stored digest & notified
```

---

## 🛠 Tech Stack
- **Chrome Extension (MV3)**  
- **JavaScript** (async/await)  
- **OpenAI API** (`gpt-4o-mini`)  
- **Chrome APIs** (`storage`, `scripting`, `notifications`, `alarms`)  

---

## ⚠️ Notes
- This is for learning/demo purposes.  
- Do not publish to Chrome Web Store with hardcoded API keys.  
- You can extend it to fetch news APIs, monitor stocks, or send digests to WhatsApp/Telegram.  

---

## 👨‍💻 Author
Built by [Your Name] as part of an **Agentic AI assignment/demo**.  
