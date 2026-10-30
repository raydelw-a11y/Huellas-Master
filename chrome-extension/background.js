// ============================================================================
// HUELLAS MASTER — BACKGROUND SERVICE WORKER (SAFE, ZERO-LOOP)
// ============================================================================

async function getConnectedAiTabs() {
  try {
    const allTabs = await chrome.tabs.query({});
    const geminiTabs = allTabs
      .filter((t) => t.url && t.url.startsWith('https://gemini.google.com/'))
      .map((t) => ({
        id: t.id,
        windowId: t.windowId,
        title:
          (t.title || 'Google Gemini').replace(/ - Google Gemini$/i, '').trim() ||
          'Google Gemini',
        url: t.url,
      }));

    const flowTabs = allTabs
      .filter(
        (t) =>
          t.url &&
          (t.url.startsWith('https://flow.google.com/') ||
            t.url.startsWith('https://labs.google/fx/tools/flow'))
      )
      .map((t) => ({
        id: t.id,
        windowId: t.windowId,
        title:
          (t.title || 'Google Flow').replace(/^Google Flow - /i, '').trim() ||
          'Google Flow',
        url: t.url,
      }));

    return { geminiTabs, flowTabs };
  } catch {
    return { geminiTabs: [], flowTabs: [] };
  }
}

async function ensureScriptInjected(tabId, scriptFile) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [scriptFile],
    });
  } catch {}
}

async function broadcastToHuellasTabs(payload) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (
        tab.id &&
        tab.url &&
        (tab.url.startsWith('http://localhost:4200') ||
          tab.url.startsWith('https://raydelw-a11y.github.io') ||
          tab.url.includes('huellasdelahumanidad.com'))
      ) {
        chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
      }
    }
  } catch {}
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  // 1. Lightweight Ping (NO script injection here to prevent loops)
  if (message.type === 'HUELLAS_PING_V2') {
    getConnectedAiTabs().then(({ geminiTabs, flowTabs }) => {
      sendResponse({
        ok: true,
        version: '1.2.0',
        geminiTabs,
        flowTabs,
      });
    });
    return true;
  }

  // 2. On-demand command execution
  if (message.type === 'HUELLAS_COMMAND') {
    const targetService = message.targetService === 'FLOW' ? 'FLOW' : 'GEMINI';
    const payload = message.payload || {};
    const action = payload.action;

    (async () => {
      const { geminiTabs, flowTabs } = await getConnectedAiTabs();
      const serviceTabs = targetService === 'FLOW' ? flowTabs : geminiTabs;
      const defaultUrl =
        targetService === 'FLOW' ? 'https://flow.google.com/' : 'https://gemini.google.com/app';
      const contentScriptFile =
        targetService === 'FLOW' ? 'flow-content.js' : 'gemini-content.js';

      if (action === 'OPEN_DOCKED') {
        try {
          if (sender?.tab?.windowId) {
            await chrome.windows
              .update(sender.tab.windowId, {
                state: 'normal',
                left: 0,
                top: 25,
                width: 920,
                height: 1020,
              })
              .catch(() => {});
          }

          const existing =
            serviceTabs.find((t) => t.id === payload.tabId) || serviceTabs[0] || null;
          if (existing && existing.id) {
            if (sender?.tab?.windowId && existing.windowId === sender.tab.windowId) {
              await chrome.windows.create({
                tabId: existing.id,
                left: 920,
                top: 25,
                width: 780,
                height: 1020,
                focused: true,
              });
            } else if (existing.windowId) {
              await chrome.tabs.update(existing.id, { active: true });
              await chrome.windows.update(existing.windowId, {
                state: 'normal',
                left: 920,
                top: 25,
                width: 780,
                height: 1020,
                focused: true,
              });
            }
          } else {
            await chrome.windows.create({
              url: defaultUrl,
              type: 'normal',
              left: 920,
              top: 25,
              width: 780,
              height: 1020,
              focused: true,
            });
          }
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: String(err) });
        }
        return;
      }

      if (action === 'FOCUS_TAB') {
        const existing =
          serviceTabs.find((t) => t.id === payload.tabId) || serviceTabs[0] || null;
        if (existing && existing.id) {
          await chrome.tabs.update(existing.id, { active: true });
          if (existing.windowId) {
            await chrome.windows.update(existing.windowId, { focused: true });
          }
          sendResponse({ ok: true });
        } else {
          await chrome.tabs.create({ url: defaultUrl, active: true });
          sendResponse({ ok: true });
        }
        return;
      }

      let targetTab =
        serviceTabs.find((t) => t.id === payload.tabId) || serviceTabs[0] || null;

      if (!targetTab) {
        const created = await chrome.tabs.create({
          url: defaultUrl,
          active: targetService === 'FLOW',
        });
        await new Promise((r) => setTimeout(r, 4500));
        targetTab = {
          id: created.id,
          windowId: created.windowId,
          title: created.title || targetService,
          url: created.url || defaultUrl,
        };
      }

      if (targetTab && targetTab.id) {
        await ensureScriptInjected(targetTab.id, contentScriptFile);
        await new Promise((r) => setTimeout(r, 150));

        chrome.tabs
          .sendMessage(targetTab.id, {
            target: targetService,
            ...payload,
          })
          .catch(() => {});

        sendResponse({ ok: true, tabId: targetTab.id, tabTitle: targetTab.title });
      } else {
        sendResponse({ ok: false, error: 'No se encontró la pestaña.' });
      }
    })();

    return true;
  }

  // 3. Forward status & responses from Gemini/Flow content scripts to Huellas Master
  if (
    message.type === 'BRIDGE_STATUS' ||
    message.type === 'GEMINI_RESPONSE_READY' ||
    message.type === 'FLOW_MEDIA_READY'
  ) {
    broadcastToHuellasTabs(message);
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
