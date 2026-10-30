// ============================================================================
// HUELLAS MASTER — BACKGROUND SERVICE WORKER (SAME-WINDOW TAB CONNECTION)
// Connects Huellas Master strictly to Gemini Web & Google Flow tabs in the
// SAME Chrome window (sender.tab.windowId). Never opens separate windows.
// ============================================================================

async function getConnectedAiTabsInWindow(windowId) {
  try {
    const queryOpts = typeof windowId === 'number' ? { windowId } : { currentWindow: true };
    const windowTabs = await chrome.tabs.query(queryOpts);

    const geminiTabs = windowTabs
      .filter((t) => t.url && t.url.startsWith('https://gemini.google.com/'))
      .map((t) => ({
        id: t.id,
        windowId: t.windowId,
        title:
          (t.title || 'Google Gemini').replace(/ - Google Gemini$/i, '').trim() ||
          'Google Gemini',
        url: t.url,
      }));

    const flowTabs = windowTabs
      .filter(
        (t) =>
          t.url &&
          (t.url.includes('flow.google.com') ||
            (t.url.includes('labs.google') && t.url.toLowerCase().includes('flow')))
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

// Directly sync React's _valueTracker, __reactProps$.onChange, and submit in Google Flow's MAIN world
async function syncFlowReactInputInMainWorld(tabId, promptText, autoSubmit) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [promptText, autoSubmit !== false],
      func: (text, shouldSubmit) => {
        try {
          const oldBar = document.getElementById('huellas-flow-floating-bar');
          if (oldBar) oldBar.remove();

          const selectors = [
            'textarea[placeholder*="prompt" i]',
            'textarea[placeholder*="describe" i]',
            'textarea[placeholder*="generate" i]',
            'textarea[placeholder*="create" i]',
            'textarea[placeholder*="video" i]',
            'textarea[placeholder*="image" i]',
            'textarea[placeholder*="genera" i]',
            'textarea[placeholder*="crea" i]',
            'textarea',
            'div[contenteditable="true"][role="textbox"]',
            'div[contenteditable="true"]',
          ];
          let inputEl = null;
          let bestBottom = -1;
          for (const sel of selectors) {
            const list = Array.from(document.querySelectorAll(sel));
            for (const el of list) {
              const r = el.getBoundingClientRect();
              if (r.width > 80 && r.height > 14 && r.bottom > bestBottom) {
                bestBottom = r.bottom;
                inputEl = el;
              }
            }
            if (inputEl) break;
          }
          if (!inputEl) return;

          inputEl.focus();
          inputEl.click();

          if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
            const proto =
              inputEl.tagName === 'TEXTAREA'
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype;
            const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (inputEl._valueTracker) {
              inputEl._valueTracker.setValue('');
            }
            if (nativeSetter) {
              nativeSetter.call(inputEl, text);
            } else {
              inputEl.value = text;
            }
            const inputEv = new InputEvent('input', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: text,
            });
            inputEl.dispatchEvent(inputEv);
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));

            const reactPropsKey = Object.keys(inputEl).find((k) =>
              k.startsWith('__reactProps$')
            );
            if (reactPropsKey && typeof inputEl[reactPropsKey]?.onChange === 'function') {
              inputEl[reactPropsKey].onChange({
                target: inputEl,
                currentTarget: inputEl,
                type: 'change',
                nativeEvent: inputEv,
                preventDefault() {},
                stopPropagation() {},
                isDefaultPrevented() {
                  return false;
                },
                isPropagationStopped() {
                  return false;
                },
                persist() {},
              });
            }
          } else {
            try {
              const sel = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(inputEl);
              sel.removeAllRanges();
              sel.addRange(range);
              document.execCommand('insertText', false, text);
            } catch {}
          }

          document.documentElement.setAttribute(
            'data-huellas-main-synced-ts',
            String(Date.now())
          );

          if (!shouldSubmit) return;

          // In MAIN world, also trigger React's onClick / onKeyDown if still unsubmitted at 450ms
          setTimeout(() => {
            const currentVal = (inputEl.value ?? inputEl.innerText ?? '').trim();
            if (!currentVal) return;

            const inputRect = inputEl.getBoundingClientRect();
            const allBtns = Array.from(
              document.querySelectorAll('button, [role="button"], input[type="submit"]')
            ).filter((b) => {
              const r = b.getBoundingClientRect();
              return (
                r.width >= 16 &&
                r.height >= 16 &&
                Math.abs(r.top - inputRect.top) < 200 &&
                r.left >= inputRect.left + inputRect.width * 0.4 &&
                r.right <= inputRect.right + 280
              );
            });

            let maxBottom = -1;
            for (const b of allBtns) {
              const r = b.getBoundingClientRect();
              if (r.bottom > maxBottom) maxBottom = r.bottom;
            }
            const bottomRow = allBtns.filter(
              (b) => b.getBoundingClientRect().bottom >= maxBottom - 55
            );
            let rightmostBtn = null;
            let maxRight = -1;
            for (const b of bottomRow) {
              const r = b.getBoundingClientRect();
              if (r.right >= maxRight) {
                maxRight = r.right;
                rightmostBtn = b;
              }
            }

            if (rightmostBtn) {
              const btnPropsKey = Object.keys(rightmostBtn).find((k) =>
                k.startsWith('__reactProps$')
              );
              if (btnPropsKey && typeof rightmostBtn[btnPropsKey]?.onClick === 'function') {
                try {
                  rightmostBtn[btnPropsKey].onClick({
                    target: rightmostBtn,
                    currentTarget: rightmostBtn,
                    type: 'click',
                    button: 0,
                    preventDefault() {},
                    stopPropagation() {},
                    isDefaultPrevented() {
                      return false;
                    },
                    isPropagationStopped() {
                      return false;
                    },
                    persist() {},
                  });
                } catch {}
              }
            }

            const inputPropsKey = Object.keys(inputEl).find((k) =>
              k.startsWith('__reactProps$')
            );
            if (inputPropsKey && typeof inputEl[inputPropsKey]?.onKeyDown === 'function') {
              try {
                inputEl[inputPropsKey].onKeyDown({
                  key: 'Enter',
                  code: 'Enter',
                  keyCode: 13,
                  which: 13,
                  shiftKey: false,
                  ctrlKey: false,
                  metaKey: false,
                  target: inputEl,
                  currentTarget: inputEl,
                  preventDefault() {},
                  stopPropagation() {},
                  isDefaultPrevented() {
                    return false;
                  },
                  isPropagationStopped() {
                    return false;
                  },
                  persist() {},
                });
              } catch {}
            }
          }, 450);
        } catch {}
      },
    });
  } catch {}
}

function isHuellasUrl(url) {
  if (!url) return false;
  return (
    url.startsWith('http://localhost:4200') ||
    url.startsWith('http://127.0.0.1:4200') ||
    url.startsWith('https://raydelw-a11y.github.io') ||
    url.includes('huellasdelahumanidad.com')
  );
}

// One-time injection into already-open tabs when extension starts/reloads
(async function initExistingHuellasTabsOnce() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue;
      if (isHuellasUrl(tab.url)) {
        ensureScriptInjected(tab.id, 'huellas-bridge.js');
      } else if (tab.url.startsWith('https://gemini.google.com/')) {
        ensureScriptInjected(tab.id, 'gemini-content.js');
      } else if (
        tab.url.includes('flow.google.com') ||
        (tab.url.includes('labs.google') && tab.url.toLowerCase().includes('flow'))
      ) {
        ensureScriptInjected(tab.id, 'flow-content.js');
      }
    }
  } catch {}
})();

async function broadcastToHuellasTabsInSameWindow(windowId, payload) {
  try {
    const queryOpts = typeof windowId === 'number' ? { windowId } : {};
    const tabs = await chrome.tabs.query(queryOpts);
    for (const tab of tabs) {
      if (tab.id && isHuellasUrl(tab.url)) {
        chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
      }
    }
  } catch {}
}

// Keep Huellas Master updated when tabs in the same window change title or URL
chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (!tab || typeof tab.windowId !== 'number') return;
  if (changeInfo.status === 'complete' || changeInfo.title) {
    const { geminiTabs, flowTabs } = await getConnectedAiTabsInWindow(tab.windowId);
    broadcastToHuellasTabsInSameWindow(tab.windowId, {
      type: 'HUELLAS_CONNECTED_TABS_UPDATE',
      geminiTabs,
      flowTabs,
    });
  }
});

chrome.tabs.onRemoved.addListener(async (_tabId, removeInfo) => {
  if (!removeInfo || removeInfo.isWindowClosing || typeof removeInfo.windowId !== 'number') return;
  const { geminiTabs, flowTabs } = await getConnectedAiTabsInWindow(removeInfo.windowId);
  broadcastToHuellasTabsInSameWindow(removeInfo.windowId, {
    type: 'HUELLAS_CONNECTED_TABS_UPDATE',
    geminiTabs,
    flowTabs,
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  const senderWindowId = sender?.tab?.windowId;

  // 1. Ping from Huellas Master: return ONLY Gemini & Flow tabs in the SAME window
  if (message.type === 'HUELLAS_PING_V2' || message.type === 'HUELLAS_PING') {
    getConnectedAiTabsInWindow(senderWindowId).then(async ({ geminiTabs, flowTabs }) => {
      for (const gt of geminiTabs) {
        if (gt.id) ensureScriptInjected(gt.id, 'gemini-content.js');
      }
      for (const ft of flowTabs) {
        if (ft.id) ensureScriptInjected(ft.id, 'flow-content.js');
      }
      sendResponse({
        ok: true,
        version: '1.5.1',
        windowId: senderWindowId,
        geminiTabs,
        flowTabs,
      });
    });
    return true;
  }

  // 2. Command execution strictly within the SAME Chrome window
  if (message.type === 'HUELLAS_COMMAND') {
    const targetService = message.targetService === 'FLOW' ? 'FLOW' : 'GEMINI';
    const payload = message.payload || {};
    const action = payload.action;

    (async () => {
      const { geminiTabs, flowTabs } = await getConnectedAiTabsInWindow(senderWindowId);
      const serviceTabs = targetService === 'FLOW' ? flowTabs : geminiTabs;
      const defaultUrl =
        targetService === 'FLOW' ? 'https://flow.google.com/' : 'https://gemini.google.com/app';
      const contentScriptFile =
        targetService === 'FLOW' ? 'flow-content.js' : 'gemini-content.js';

      // Focus or open tab in the SAME window (never create a new window)
      if (action === 'FOCUS_TAB' || action === 'OPEN_DOCKED') {
        const existing =
          serviceTabs.find((t) => t.id === payload.tabId) || serviceTabs[0] || null;
        if (existing && existing.id) {
          await chrome.tabs.update(existing.id, { active: true });
          sendResponse({ ok: true, tabId: existing.id });
        } else {
          const created = await chrome.tabs.create({
            windowId: senderWindowId,
            url: defaultUrl,
            active: true,
          });
          sendResponse({ ok: true, tabId: created.id });
        }
        return;
      }

      // Find target tab in the SAME window
      let targetTab =
        serviceTabs.find((t) => t.id === payload.tabId) || serviceTabs[0] || null;

      if (!targetTab) {
        broadcastToHuellasTabsInSameWindow(senderWindowId, {
          type: 'BRIDGE_STATUS',
          service: targetService,
          status: 'WORKING',
          message: `Abriendo pestaña de ${
            targetService === 'FLOW' ? 'Google Flow' : 'Gemini Web'
          } en esta misma ventana...`,
        });
        const created = await chrome.tabs.create({
          windowId: senderWindowId,
          url: defaultUrl,
          active: true,
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
        if (payload.focusTab || (targetService === 'FLOW' && action === 'SEND_PROMPT')) {
          await chrome.tabs.update(targetTab.id, { active: true }).catch(() => {});
        }
        await ensureScriptInjected(targetTab.id, contentScriptFile);
        if (targetService === 'FLOW' && action === 'SEND_PROMPT' && payload.prompt) {
          await syncFlowReactInputInMainWorld(
            targetTab.id,
            payload.prompt,
            payload.autoSubmit
          );
        }
        await new Promise((r) => setTimeout(r, 150));

        chrome.tabs
          .sendMessage(targetTab.id, {
            target: targetService,
            ...payload,
          })
          .catch(() => {});

        sendResponse({ ok: true, tabId: targetTab.id, tabTitle: targetTab.title });
      } else {
        sendResponse({
          ok: false,
          error: 'No se encontró la pestaña en esta ventana.',
        });
      }
    })();

    return true;
  }

  // 3. Forward status & responses from Gemini/Flow tab ONLY to Huellas Master in the SAME window
  if (
    message.type === 'BRIDGE_STATUS' ||
    message.type === 'GEMINI_RESPONSE_READY' ||
    message.type === 'FLOW_MEDIA_READY'
  ) {
    broadcastToHuellasTabsInSameWindow(senderWindowId, message);
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
