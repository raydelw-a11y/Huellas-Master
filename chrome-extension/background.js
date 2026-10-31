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

    const sunoTabs = windowTabs
      .filter((t) => t.url && t.url.includes('suno.com'))
      .map((t) => ({
        id: t.id,
        windowId: t.windowId,
        title: (t.title || 'Suno AI').trim() || 'Suno AI',
        url: t.url,
      }));

    return { geminiTabs, flowTabs, sunoTabs };
  } catch {
    return { geminiTabs: [], flowTabs: [], sunoTabs: [] };
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

  // 1. Ping from Huellas Master: return Gemini, Flow & Suno tabs in the SAME window
  if (message.type === 'HUELLAS_PING_V2' || message.type === 'HUELLAS_PING') {
    getConnectedAiTabsInWindow(senderWindowId).then(
      async ({ geminiTabs, flowTabs, sunoTabs }) => {
        for (const gt of geminiTabs) {
          if (gt.id) ensureScriptInjected(gt.id, 'gemini-content.js');
        }
        for (const ft of flowTabs) {
          if (ft.id) ensureScriptInjected(ft.id, 'flow-content.js');
        }
        for (const st of sunoTabs || []) {
          if (st.id) ensureScriptInjected(st.id, 'suno-content.js');
        }
        sendResponse({
          ok: true,
          version: '2.1.0',
          windowId: senderWindowId,
          geminiTabs,
          flowTabs,
          sunoTabs: sunoTabs || [],
        });
      }
    );
    return true;
  }

  // 2. Command execution strictly within the SAME Chrome window
  if (message.type === 'HUELLAS_COMMAND') {
    const targetService =
      message.targetService === 'FLOW'
        ? 'FLOW'
        : message.targetService === 'SUNO'
        ? 'SUNO'
        : 'GEMINI';
    const payload = message.payload || {};
    const action = payload.action;

    (async () => {
      const { geminiTabs, flowTabs, sunoTabs } = await getConnectedAiTabsInWindow(senderWindowId);
      const serviceTabs =
        targetService === 'FLOW'
          ? flowTabs
          : targetService === 'SUNO'
          ? sunoTabs || []
          : geminiTabs;
      const defaultUrl =
        targetService === 'FLOW'
          ? 'https://flow.google.com/'
          : targetService === 'SUNO'
          ? 'https://suno.com/create'
          : 'https://gemini.google.com/app';
      const contentScriptFile =
        targetService === 'FLOW'
          ? 'flow-content.js'
          : targetService === 'SUNO'
          ? 'suno-content.js'
          : 'gemini-content.js';

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
            targetService === 'FLOW'
              ? 'Google Flow'
              : targetService === 'SUNO'
              ? 'Suno AI'
              : 'Gemini Web'
          } en esta misma ventana...`,
        });
        const created = await chrome.tabs.create({
          windowId: senderWindowId,
          url: defaultUrl,
          active: payload.focusTab === true,
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
        if (
          payload.focusTab !== false ||
          ((targetService === 'FLOW' || targetService === 'SUNO') && action === 'SEND_PROMPT')
        ) {
          await chrome.tabs.update(targetTab.id, { active: true }).catch(() => {});
        }
        await ensureScriptInjected(targetTab.id, contentScriptFile);
        await new Promise((r) => setTimeout(r, 120));

        chrome.tabs
          .sendMessage(targetTab.id, {
            target: targetService,
            ...payload,
          })
          .catch(() => {});

        // MAIN-world safety injection & submit for Google Flow (attaches logoDataUrl if present + ensures submit button / Enter fires in MAIN world)
        if (targetService === 'FLOW' && action === 'SEND_PROMPT' && payload.autoSubmit !== false) {
          const flowTabId = targetTab.id;
          const rawPromptArg = String(payload.prompt || '');
          const mediaTypeArg = String(payload.mediaType || '');
          const logoDataUrlArg = String(payload.logoDataUrl || '');
          setTimeout(() => {
            chrome.scripting
              .executeScript({
                target: { tabId: flowTabId },
                world: 'MAIN',
                args: [rawPromptArg, mediaTypeArg, logoDataUrlArg],
                func: (expectedRawPrompt, mediaType, logoDataUrl) => {
                  try {
                    const cleanExpected =
                      mediaType === 'THUMBNAILS'
                        ? expectedRawPrompt.replace(/^Thumbnail\s*:\s*/i, '').trim()
                        : expectedRawPrompt.trim();
                    const inputEl = document.querySelector(
                      'div.ProseMirror[contenteditable="true"], div[role="textbox"][contenteditable="true"]'
                    );
                    if (!inputEl) return;

                    // 1. If creating a thumbnail and logoDataUrl is provided, attach the Official Logo in MAIN world
                    if (
                      mediaType === 'THUMBNAILS' &&
                      logoDataUrl &&
                      logoDataUrl.startsWith('data:')
                    ) {
                      try {
                        const parts = logoDataUrl.split(',');
                        const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/png';
                        const bstr = atob(parts[1] || '');
                        const u8arr = new Uint8Array(bstr.length);
                        for (let i = 0; i < bstr.length; i++) {
                          u8arr[i] = bstr.charCodeAt(i);
                        }
                        const logoFile = new File(
                          [u8arr],
                          'Logo_Huellas_de_la_Humanidad.png',
                          { type: mime }
                        );
                        const dt = new DataTransfer();
                        dt.items.add(logoFile);

                        let capturedInput = document.querySelector(
                          'input[type="file"][accept*="image" i], input[type="file"]'
                        );
                        if (!capturedInput) {
                          const origClick = HTMLInputElement.prototype.click;
                          HTMLInputElement.prototype.click = function () {
                            if (this && this.type === 'file') {
                              capturedInput = this;
                              return;
                            }
                            return origClick.apply(this, arguments);
                          };
                          try {
                            const addBtn = document.querySelector(
                              'button.add-menu-trigger[aria-label*="Add ingredients" i], button.add-menu-trigger'
                            );
                            if (addBtn) {
                              addBtn.click();
                              const menuItems = Array.from(
                                document.querySelectorAll('[role="menuitem"], .mat-mdc-menu-item, button')
                              );
                              const uploadItem = menuItems.find((el) =>
                                /upload|subir|image|imagen|computer|equipo/i.test(
                                  (el.innerText || el.textContent || '') +
                                    ' ' +
                                    (el.getAttribute('aria-label') || '')
                                )
                              );
                              if (uploadItem) uploadItem.click();
                            }
                          } catch {}
                          HTMLInputElement.prototype.click = origClick;
                        }

                        if (capturedInput) {
                          try {
                            capturedInput.files = dt.files;
                            capturedInput.dispatchEvent(new Event('change', { bubbles: true }));
                            capturedInput.dispatchEvent(new Event('input', { bubbles: true }));
                          } catch {}
                        }
                      } catch {}
                    }

                    const hasLogoDelay =
                      mediaType === 'THUMBNAILS' &&
                      logoDataUrl &&
                      logoDataUrl.startsWith('data:')
                        ? 400
                        : 0;

                    setTimeout(() => {
                      const injectedTs = Number(
                        document.documentElement.getAttribute('data-huellas-flow-injected-ts') || '0'
                      );
                      const currentText = (inputEl.innerText || inputEl.textContent || '').trim();

                      // If flow-content.js already injected and submitted (box is now empty), DO NOT re-paste!
                      if (currentText.length < 5 && Date.now() - injectedTs < 5000) {
                        return;
                      }

                      // If flow-content.js could not inject at all, insert via ProseMirror view or execCommand
                      if (currentText.length < 5 && cleanExpected) {
                        const safeText = cleanExpected.endsWith(' ')
                          ? cleanExpected
                          : `${cleanExpected} `;
                        const pmView = inputEl.pmViewDesc?.view;
                        if (pmView && pmView.state) {
                          try {
                            const tr = pmView.state.tr.insertText(
                              safeText,
                              0,
                              pmView.state.doc.content.size
                            );
                            pmView.dispatch(tr);
                          } catch {}
                        } else {
                          try {
                            inputEl.focus();
                            const sel = window.getSelection();
                            const r = document.createRange();
                            r.selectNodeContents(inputEl);
                            sel.removeAllRanges();
                            sel.addRange(r);
                            document.execCommand('insertText', false, safeText);
                          } catch {}
                        }
                      }

                      // Ensure ProseMirror's internal EditorView state is synced if text is in DOM
                      const textNow = (inputEl.innerText || inputEl.textContent || '').trim();
                      if (textNow.length >= 5) {
                        const pmView = inputEl.pmViewDesc?.view;
                        if (
                          pmView &&
                          pmView.state &&
                          (pmView.state.doc.textContent || '').trim().length < 5
                        ) {
                          try {
                            const tr = pmView.state.tr.insertText(
                              `${textNow} `,
                              0,
                              pmView.state.doc.content.size
                            );
                            pmView.dispatch(tr);
                          } catch {}
                        }
                      }

                      setTimeout(() => {
                        const remaining = (
                          inputEl?.innerText ||
                          inputEl?.textContent ||
                          ''
                        ).trim();
                        if (!remaining || remaining.length < 5) return;

                        const selectors = [
                          'flow-generate-icon-button button',
                          'span.submit-button-slot button',
                          '[submitbutton] button',
                          'button.generate-icon-button',
                          'button[aria-label="Start generation"]',
                          'button[aria-label*="Start generation" i]',
                          'button[aria-label*="Iniciar generación" i]',
                          'button[aria-label*="Send" i]',
                          'button[aria-label*="Enviar" i]',
                          'button[type="submit"]',
                        ];
                        for (const sel of selectors) {
                          const btn = document.querySelector(sel);
                          if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
                            const r = btn.getBoundingClientRect();
                            if (r.width >= 16 && r.height >= 16 && r.bottom > 0) {
                              btn.click();
                              break;
                            }
                          }
                        }

                        // If 180ms later the prompt is still sitting in inputEl, press Enter in MAIN world
                        setTimeout(() => {
                          const stillThere = (
                            inputEl?.innerText ||
                            inputEl?.textContent ||
                            ''
                          ).trim();
                          if (!stillThere || stillThere.length < 5) return;
                          try {
                            inputEl.focus();
                            const sel = window.getSelection();
                            if (sel) {
                              const range = document.createRange();
                              range.selectNodeContents(inputEl);
                              range.collapse(false);
                              sel.removeAllRanges();
                              sel.addRange(range);
                            }
                            const evInit = {
                              key: 'Enter',
                              code: 'Enter',
                              keyCode: 13,
                              which: 13,
                              charCode: 13,
                              bubbles: true,
                              cancelable: true,
                              composed: true,
                            };
                            inputEl.dispatchEvent(new KeyboardEvent('keydown', evInit));
                            inputEl.dispatchEvent(new KeyboardEvent('keypress', evInit));
                            inputEl.dispatchEvent(new KeyboardEvent('keyup', evInit));
                          } catch {}
                        }, 180);
                      }, 180);
                    }, hasLogoDelay);
                  } catch {}
                },
              })
              .catch(() => {});
          }, 380);
        }

        // MAIN-world safety injection & submit for Gemini Web (works even when the Gemini tab is in the background!)
        if (targetService === 'GEMINI' && action === 'SEND_PROMPT' && payload.autoSubmit !== false) {
          const geminiTabId = targetTab.id;
          const geminiPromptArg = String(payload.prompt || '');
          setTimeout(() => {
            chrome.scripting
              .executeScript({
                target: { tabId: geminiTabId },
                world: 'MAIN',
                args: [geminiPromptArg],
                func: (expectedPrompt) => {
                  try {
                    const cleanExpected = (expectedPrompt || '').trim();
                    if (!cleanExpected) return;
                    const inputEl = document.querySelector(
                      'rich-textarea div.ql-editor[contenteditable="true"], div.ql-editor[contenteditable="true"], div[contenteditable="true"][role="textbox"], textarea'
                    );
                    if (!inputEl) return;

                    const currentText = (
                      inputEl.value ??
                      inputEl.innerText ??
                      inputEl.textContent ??
                      ''
                    ).trim();
                    if (!currentText || !currentText.includes(cleanExpected.slice(0, 30))) {
                      inputEl.focus();
                      try {
                        const dt = new DataTransfer();
                        dt.setData('text/plain', cleanExpected);
                        inputEl.dispatchEvent(
                          new ClipboardEvent('paste', {
                            bubbles: true,
                            cancelable: true,
                            composed: true,
                            clipboardData: dt,
                          })
                        );
                      } catch {}
                      const afterPaste = (
                        inputEl.value ??
                        inputEl.innerText ??
                        inputEl.textContent ??
                        ''
                      ).trim();
                      if (!afterPaste || !afterPaste.includes(cleanExpected.slice(0, 25))) {
                        inputEl.innerHTML = '';
                        const p = document.createElement('p');
                        p.textContent = cleanExpected;
                        inputEl.appendChild(p);
                        inputEl.dispatchEvent(
                          new InputEvent('input', {
                            bubbles: true,
                            cancelable: true,
                            inputType: 'insertText',
                            data: cleanExpected,
                          })
                        );
                      }
                    }

                    setTimeout(() => {
                      const remaining = (
                        inputEl?.value ??
                        inputEl?.innerText ??
                        inputEl?.textContent ??
                        ''
                      ).trim();
                      if (!remaining || remaining.length < 5) return;
                      const sendSelectors = [
                        'button.send-button:not([disabled])',
                        '.send-button-container button:not([disabled])',
                        'button[aria-label*="Send message" i]:not([disabled])',
                        'button[aria-label*="Enviar mensaje" i]:not([disabled])',
                        'button[aria-label*="Send" i]:not([disabled])',
                        'button[aria-label*="Enviar" i]:not([disabled])',
                      ];
                      for (const sel of sendSelectors) {
                        const btn = document.querySelector(sel);
                        if (btn) {
                          btn.click();
                          return;
                        }
                      }
                    }, 220);
                  } catch {}
                },
              })
              .catch(() => {});
          }, 420);
        }

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

  // 3. Forward status & responses from Gemini/Flow/Suno tab ONLY to Huellas Master in the SAME window
  if (
    message.type === 'BRIDGE_STATUS' ||
    message.type === 'GEMINI_RESPONSE_READY' ||
    message.type === 'FLOW_MEDIA_READY' ||
    message.type === 'FLOW_VIDEO_CAPTURED' ||
    message.type === 'FLOW_THUMBNAIL_CAPTURED' ||
    message.type === 'FLOW_REFERENCE_CAPTURED' ||
    message.type === 'SUNO_AUDIO_CAPTURED'
  ) {
    broadcastToHuellasTabsInSameWindow(senderWindowId, message);
    sendResponse({ ok: true });
    return true;
  }

  // 4. Fetch cross-origin video/image binary as base64 DataURL for frame extraction & auto-download
  if (message.type === 'FETCH_VIDEO_BASE64' && message.url) {
    (async () => {
      try {
        let resp = await fetch(message.url, { credentials: 'include' }).catch(() => null);
        if (!resp || !resp.ok) {
          resp = await fetch(message.url, { credentials: 'omit' });
        }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        const b64 = btoa(binary);
        const mime = resp.headers.get('content-type') || 'video/mp4';
        sendResponse({ ok: true, dataUrl: `data:${mime};base64,${b64}` });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  return false;
});
