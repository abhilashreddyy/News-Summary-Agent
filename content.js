function getReadableText() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        const s = node.parentElement && getComputedStyle(node.parentElement);
        if (!s || s.visibility === "hidden" || s.display === "none") return NodeFilter.FILTER_REJECT;
        const t = node.nodeValue.replace(/\s+/g, " ").trim();
        return t.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    let buf = [];
    let n;
    while ((n = walker.nextNode())) buf.push(n.nodeValue.replace(/\s+/g, " ").trim());
    return buf.join(" ").replace(/\s{2,}/g, " ").slice(0, 50000);
  }
  
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "SCRAPE_PAGE") {
      try {
        const payload = { title: document.title || "", url: location.href, text: getReadableText() };
        sendResponse({ ok: true, payload });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    }
    return true;
  });
  