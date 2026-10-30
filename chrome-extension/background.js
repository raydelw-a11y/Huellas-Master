// ============================================================================
// HUELLAS MASTER — BACKGROUND SERVICE WORKER (SAME-WINDOW TAB CONNECTION)
// Connects Huellas Master strictly to Gemini Web & Google Flow tabs in the
// SAME Chrome window (sender.tab.windowId). Never opens separate windows.
// ============================================================================

async function uploadDiagToLocalServer(filename, dataObj) {
  try {
    const fd = new FormData();
    fd.append(
      'file',
      new Blob([JSON.stringify(dataObj, null, 2)], { type: 'application/json' }),
      filename
    );
    await fetch('http://127.0.0.1:4200/api/assets/upload', {
      method: 'POST',
      body: fd,
    });
  } catch {}
}

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

// Directly sync input and trigger submit in Google Flow's MAIN world
async function syncFlowReactInputInMainWorld(tabId, promptText, autoSubmit) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [promptText, autoSubmit !== false],
      func: (text, shouldSubmit) => {
        try {
          const oldBar = document.getElementById('huellas-flow-floating-bar');
          if (oldBar) oldBar.remove();

          const allInputs = Array.from(
            document.querySelectorAll(
              'textarea, div[contenteditable="true"], [role="textbox"][contenteditable="true"]'
            )
          );
          let inputEl = null;
          let bestScore = -999999;
          for (const el of allInputs) {
            const r = el.getBoundingClientRect();
            if (r.width < 80 || r.height < 14) continue;
            if (r.bottom <= 0 || r.top >= window.innerHeight) continue;
            let s = r.bottom * 2 + r.width;
            const ph = (
              el.getAttribute('placeholder') ||
              el.getAttribute('aria-label') ||
              ''
            ).toLowerCase();
            if (
              ph.includes('prompt') ||
              ph.includes('describe') ||
              ph.includes('generate') ||
              ph.includes('create') ||
              ph.includes('video') ||
              ph.includes('genera') ||
              ph.includes('crea')
            ) {
              s += 1000;
            }
            if (s > bestScore) {
              bestScore = s;
              inputEl = el;
            }
          }

          if (!inputEl) {
            return { ok: false, reason: 'no_input_found', url: location.href };
          }

          inputEl.focus();
          inputEl.click();

          if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
            const proto =
              inputEl.tagName === 'TEXTAREA'
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype;
            const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

            try {
              inputEl.select();
              document.execCommand('insertText', false, text);
            } catch {}

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

          const inputRect = inputEl.getBoundingClientRect();
          const nearBtns = Array.from(
            document.querySelectorAll('button, [role="button"], input[type="submit"]')
          )
            .map((b) => {
              const r = b.getBoundingClientRect();
              if (r.width < 12 || r.height < 12) return null;
              return {
                tag: b.tagName,
                type: b.getAttribute('type'),
                disabled: Boolean(b.disabled || b.getAttribute('aria-disabled') === 'true'),
                ariaLabel: b.getAttribute('aria-label'),
                text: (b.innerText || b.textContent || '').trim().slice(0, 60),
                rect: {
                  left: Math.round(r.left),
                  top: Math.round(r.top),
                  right: Math.round(r.right),
                  bottom: Math.round(r.bottom),
                  w: Math.round(r.width),
                  h: Math.round(r.height),
                },
                html: (b.outerHTML || '').slice(0, 220),
              };
            })
            .filter(Boolean);

          if (shouldSubmit) {
            setTimeout(() => {
              const currentVal = (inputEl.value ?? inputEl.innerText ?? '').trim();
              if (!currentVal) return;

              const exactIcons = ['arrow_forward', 'arrow_upward', 'send', 'subdirectory_arrow_left'];
              let targetBtn = null;

              // 1. Check for arrow_forward / arrow_upward / send icon across the full prompt bar width
              const iconEls = Array.from(
                document.querySelectorAll('button, [role="button"], i, span, mat-icon, google-symbols')
              );
              for (const el of iconEls) {
                const t = (
                  el.textContent ||
                  el.getAttribute('data-mat-icon-name') ||
                  ''
                )
                  .trim()
                  .toLowerCase();
                if (exactIcons.includes(t)) {
                  const r = el.getBoundingClientRect();
                  if (
                    r.width >= 8 &&
                    r.height >= 8 &&
                    Math.abs(r.top - inputRect.top) < 260 &&
                    r.left >= inputRect.left
                  ) {
                    targetBtn = el.closest('button, [role="button"]') || el.parentElement || el;
                    break;
                  }
                }
              }

              // 2. Fallback to bottom-rightmost button on the right of inputEl (across full screen width)
              if (!targetBtn) {
                const rightBtns = Array.from(
                  document.querySelectorAll('button, [role="button"], input[type="submit"]')
                ).filter((b) => {
                  const r = b.getBoundingClientRect();
                  return (
                    r.width >= 14 &&
                    r.height >= 14 &&
                    Math.abs(r.top - inputRect.top) < 260 &&
                    r.left >= inputRect.left + 40
                  );
                });
                let maxBottom = -1;
                for (const b of rightBtns) {
                  const r = b.getBoundingClientRect();
                  if (r.bottom > maxBottom) maxBottom = r.bottom;
                }
                const bottomRow = rightBtns.filter(
                  (b) => b.getBoundingClientRect().bottom >= maxBottom - 60
                );
                let maxRight = -1;
                for (const b of bottomRow) {
                  const r = b.getBoundingClientRect();
                  if (r.right >= maxRight) {
                    maxRight = r.right;
                    targetBtn = b;
                  }
                }
              }

              if (targetBtn) {
                try {
                  targetBtn.click();
                } catch {}
                const btnPropsKey = Object.keys(targetBtn).find((k) =>
                  k.startsWith('__reactProps$')
                );
                if (btnPropsKey && typeof targetBtn[btnPropsKey]?.onClick === 'function') {
                  try {
                    targetBtn[btnPropsKey].onClick({
                      target: targetBtn,
                      currentTarget: targetBtn,
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
            }, 380);
          }

          return {
            ok: true,
            url: location.href,
            inputTag: inputEl.tagName,
            inputContentEditable: inputEl.getAttribute('contenteditable'),
            inputRect: {
              left: Math.round(inputRect.left),
              top: Math.round(inputRect.top),
              right: Math.round(inputRect.right),
              bottom: Math.round(inputRect.bottom),
              w: Math.round(inputRect.width),
              h: Math.round(inputRect.height),
            },
            buttonsCount: nearBtns.length,
            buttons: nearBtns,
          };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
    });
    if (results && results[0] && results[0].result) {
      uploadDiagToLocalServer('flow_main_world_diag.json', results[0].result);
    }
  } catch (err) {
    uploadDiagToLocalServer('flow_main_world_error.json', { error: String(err) });
  }
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
        chrome.scripting
          .executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: () => {
              const inputs = Array.from(
                document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')
              ).map((el) => {
                const r = el.getBoundingClientRect();
                return {
                  tag: el.tagName,
                  role: el.getAttribute('role'),
                  ce: el.getAttribute('contenteditable'),
                  ph: el.getAttribute('placeholder') || el.getAttribute('aria-label'),
                  rect: { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) },
                  html: (el.outerHTML || '').slice(0, 260),
                };
              });
              const btns = Array.from(
                document.querySelectorAll('button, [role="button"], i, span')
              )
                .filter((b) => {
                  const r = b.getBoundingClientRect();
                  if (r.width < 12 || r.height < 12) return false;
                  if (b.tagName === 'BUTTON' || b.getAttribute('role') === 'button') return true;
                  const t = (b.textContent || '').trim().toLowerCase();
                  return t === 'arrow_forward' || t === 'arrow_upward' || t === 'send';
                })
                .map((b) => {
                  const r = b.getBoundingClientRect();
                  return {
                    tag: b.tagName,
                    role: b.getAttribute('role'),
                    disabled: Boolean(b.disabled || b.getAttribute('aria-disabled') === 'true'),
                    aria: b.getAttribute('aria-label') || b.getAttribute('title'),
                    text: (b.innerText || b.textContent || '').trim().slice(0, 60),
                    rect: { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) },
                    html: (b.outerHTML || '').slice(0, 240),
                  };
                });
              return { url: location.href, inputs, btns };
            },
          })
          .then((res) => {
            if (res && res[0] && res[0].result) {
              uploadDiagToLocalServer('flow_reload_diag.json', res[0].result);
            }
          })
          .catch(() => {});
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
        version: '1.6.0',
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
