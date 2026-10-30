// ============================================================================
// HUELLAS MASTER — CHROME EXTENSION BACKGROUND SERVICE WORKER
// Routes prompts & responses between Huellas Master, Gemini Web, and Google Flow
// ============================================================================

let pendingGeminiTask = null;
let pendingFlowTask = null;

function isHuellasUrl(url = '') {
  return (
    url.includes('localhost:4200') ||
    url.includes('127.0.0.1:4200') ||
    url.includes('raydelw-a11y.github.io/Huellas-Master')
  );
}

async function broadcastToHuellasTabs(message) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && isHuellasUrl(tab.url || '')) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('[Huellas Bridge] Error broadcasting to Huellas tabs:', e);
  }
}

async function sendToTargetService(targetService, payload, senderTabId) {
  const isGemini = targetService === 'GEMINI';
  const urlMatch = isGemini ? 'gemini.google.com' : 'labs.google';
  const defaultUrl = isGemini
    ? 'https://gemini.google.com/app'
    : 'https://labs.google/fx/tools/flow';

  let deliveredCount = 0;

  // 1. Try sending to embedded iframe inside the sender Huellas Master tab first
  if (senderTabId && !payload.preferDockedWindow) {
    try {
      const response = await chrome.tabs.sendMessage(senderTabId, {
        target: targetService,
        ...payload,
      });
      if (response && response.handled) {
        deliveredCount++;
      }
    } catch {}
  }

  // 2. Also check any open/docked tab for Gemini or Google Flow
  const allTabs = await chrome.tabs.query({});
  const serviceTabs = allTabs.filter((t) => t.id && (t.url || '').includes(urlMatch));

  for (const t of serviceTabs) {
    try {
      const res = await chrome.tabs.sendMessage(t.id, {
        target: targetService,
        ...payload,
      });
      if (res && res.handled) {
        deliveredCount++;
        if (payload.focusTab) {
          await chrome.tabs.update(t.id, { active: true });
          if (t.windowId) {
            await chrome.windows.update(t.windowId, { focused: true });
          }
        }
      }
    } catch {}
  }

  // 3. If no embedded iframe or open tab handled it, open a docked window automatically!
  if (deliveredCount === 0 && (payload.action === 'SEND_PROMPT' || payload.action === 'OPEN_DOCKED')) {
    if (isGemini) {
      pendingGeminiTask = payload;
    } else {
      pendingFlowTask = payload;
    }

    await broadcastToHuellasTabs({
      type: 'BRIDGE_STATUS',
      service: targetService,
      status: 'OPENING_WINDOW',
      message: `Abriendo ventana acoplada de ${isGemini ? 'Gemini Web' : 'Google Flow'}...`,
    });

    await chrome.windows.create({
      url: defaultUrl,
      type: 'popup',
      width: 680,
      height: 860,
      left: 740,
      top: 40,
      focused: true,
    });
    return { ok: true, openedNewWindow: true };
  }

  return { ok: deliveredCount > 0, deliveredCount };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;

  if (msg.type === 'HUELLAS_PING') {
    sendResponse({
      installed: true,
      version: '1.0.0',
    });
    return false;
  }

  if (msg.type === 'CONTENT_SCRIPT_READY') {
    const service = msg.service;
    if (service === 'GEMINI' && pendingGeminiTask) {
      const task = pendingGeminiTask;
      pendingGeminiTask = null;
      setTimeout(() => {
        if (sender.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            target: 'GEMINI',
            ...task,
          }).catch(() => {});
        }
      }, 1400);
    } else if (service === 'FLOW' && pendingFlowTask) {
      const task = pendingFlowTask;
      pendingFlowTask = null;
      setTimeout(() => {
        if (sender.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            target: 'FLOW',
            ...task,
          }).catch(() => {});
        }
      }, 1800);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'HUELLAS_COMMAND') {
    const { targetService, payload } = msg;
    sendToTargetService(targetService, payload, sender.tab?.id)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // async response
  }

  // Forward events from Gemini / Flow content scripts back to all Huellas Master tabs
  if (
    msg.type === 'BRIDGE_STATUS' ||
    msg.type === 'GEMINI_RESPONSE_READY' ||
    msg.type === 'FLOW_MEDIA_READY'
  ) {
    broadcastToHuellasTabs(msg);
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
