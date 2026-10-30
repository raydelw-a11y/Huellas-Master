// ============================================================================
// HUELLAS MASTER — BACKGROUND SERVICE WORKER (Manifest V3)
// Connects Huellas Master to real open Gemini Web & Google Flow tabs/windows
// ============================================================================

async function getConnectedAiTabs() {
  const allTabs = await chrome.tabs.query({});
  const geminiTabs = allTabs
    .filter((t) => t.url && t.url.startsWith('https://gemini.google.com/'))
    .map((t) => ({
      id: t.id,
      windowId: t.windowId,
      title: (t.title || 'Google Gemini').replace(/ - Google Gemini$/i, '').trim() || 'Google Gemini',
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
      title: (t.title || 'Google Flow').replace(/^Google Flow - /i, '').trim() || 'Google Flow',
      url: t.url,
    }));

  return { geminiTabs, flowTabs };
}

async function ensureScriptInjected(tabId, scriptFile) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [scriptFile],
    });
  } catch {
    // Ignore if already injected
  }
}

async function injectIntoExistingTabs() {
  try {
    const allTabs = await chrome.tabs.query({});
    for (const tab of allTabs) {
      if (!tab.id || !tab.url) continue;
      if (tab.url.startsWith('https://gemini.google.com/')) {
        ensureScriptInjected(tab.id, 'gemini-content.js');
      } else if (
        tab.url.startsWith('https://flow.google.com/') ||
        tab.url.startsWith('https://labs.google/')
      ) {
        ensureScriptInjected(tab.id, 'flow-content.js');
      } else if (
        tab.url.startsWith('http://localhost:4200') ||
        tab.url.startsWith('https://raydelw-a11y.github.io') ||
        tab.url.includes('huellasdelahumanidad.com')
      ) {
        ensureScriptInjected(tab.id, 'huellas-bridge.js');
      }
    }
  } catch {}
}

chrome.runtime.onInstalled.addListener(() => {
  injectIntoExistingTabs();
});

chrome.runtime.onStartup.addListener(() => {
  injectIntoExistingTabs();
});

async function broadcastToHuellasTabs(payload) {
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
}

async function broadcastTabsUpdate() {
  const { geminiTabs, flowTabs } = await getConnectedAiTabs();
  broadcastToHuellasTabs({
    type: 'HUELLAS_CONNECTED_TABS_UPDATE',
    geminiTabs,
    flowTabs,
  });
}

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === 'complete' || changeInfo.title) {
    broadcastTabsUpdate();
  }
});

chrome.tabs.onRemoved.addListener(() => {
  broadcastTabsUpdate();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  // 1. Ping from Huellas Master
  if (message.type === 'HUELLAS_PING') {
    injectIntoExistingTabs();
    getConnectedAiTabs().then(({ geminiTabs, flowTabs }) => {
      sendResponse({
        ok: true,
        version: '1.1.0',
        geminiTabs,
        flowTabs,
      });
    });
    return true;
  }

  // 2. Unified HUELLAS_COMMAND handler
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

      // A) OPEN_DOCKED: Split screen 50/50 (Huellas Master on Left, Gemini/Flow on Right)
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
          broadcastTabsUpdate();
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: String(err) });
        }
        return;
      }

      // B) FOCUS_TAB: Bring existing Gemini/Flow tab to front (or open a new tab)
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

      // C) SEND_PROMPT, GRAB_LAST_RESPONSE, GRAB_LAST_MEDIA
      let targetTab =
        serviceTabs.find((t) => t.id === payload.tabId) || serviceTabs[0] || null;

      if (!targetTab) {
        broadcastToHuellasTabs({
          type: 'BRIDGE_STATUS',
          service: targetService,
          status: 'WORKING',
          message: `Abriendo pestaña de ${
            targetService === 'FLOW' ? 'Google Flow' : 'Gemini Web'
          }...`,
        });
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
        broadcastTabsUpdate();
      }

      if (targetTab && targetTab.id) {
        if (payload.focusTab) {
          await chrome.tabs.update(targetTab.id, { active: true }).catch(() => {});
        }
        await ensureScriptInjected(targetTab.id, contentScriptFile);
        await new Promise((r) => setTimeout(r, 150));

        chrome.tabs
          .sendMessage(targetTab.id, {
            target: targetService,
            ...payload,
          })
          .catch((err) => {
            broadcastToHuellasTabs({
              type: 'BRIDGE_STATUS',
              service: targetService,
              status: 'ERROR',
              message: `Error al comunicar con la pestaña (${targetTab.title}): ${String(err)}`,
            });
          });

        sendResponse({ ok: true, tabId: targetTab.id, tabTitle: targetTab.title });
      } else {
        sendResponse({ ok: false, error: 'No se encontró ni se pudo abrir la pestaña.' });
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
