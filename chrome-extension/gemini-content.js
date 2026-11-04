// ============================================================================
// HUELLAS MASTER — GEMINI WEB CONTENT SCRIPT (gemini.google.com)
// Automates prompt injection, submission, and response/image extraction
// ============================================================================

(function () {
  // Always remove any old floating bar immediately (even if script was already loaded)
  const oldGeminiBar = document.getElementById('huellas-gemini-floating-bar');
  if (oldGeminiBar) {
    oldGeminiBar.remove();
  }

  if (window.__HUELLAS_GEMINI_SCRIPT_LOADED__) return;
  window.__HUELLAS_GEMINI_SCRIPT_LOADED__ = true;

  let activeWatchTimer = null;

  function reportStatus(status, message, extra = {}) {
    chrome.runtime.sendMessage({
      type: 'BRIDGE_STATUS',
      service: 'GEMINI',
      status,
      message,
      ...extra,
    }).catch(() => {});
  }

  function findPromptInput() {
    const selectors = [
      'rich-textarea div.ql-editor[contenteditable="true"]',
      'div.ql-editor[contenteditable="true"]',
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][aria-label*="prompt" i]',
      'div[contenteditable="true"][aria-label*="mensaje" i]',
      'div[contenteditable="true"][aria-label*=" petición" i]',
      'textarea',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function findSendButton() {
    const selectors = [
      'button.send-button:not([disabled])',
      '.send-button-container button:not([disabled])',
      'button[aria-label*="Send message" i]:not([disabled])',
      'button[aria-label*="Enviar mensaje" i]:not([disabled])',
      'button[aria-label*="Send" i]:not([disabled])',
      'button[aria-label*="Enviar" i]:not([disabled])',
      'button[mattooltip*="Send" i]:not([disabled])',
      'button[mattooltip*="Enviar" i]:not([disabled])',
    ];
    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn) return btn;
    }
    return null;
  }

  function isGeminiStillGenerating() {
    const stopSelectors = [
      'button[aria-label*="Stop" i]',
      'button[aria-label*="Detener" i]',
      '.stop-icon',
      'mat-icon[data-mat-icon-name="stop"]',
    ];
    for (const sel of stopSelectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return true;
    }
    return false;
  }

  function getModelResponseElements() {
    const candidates = document.querySelectorAll(
      'model-response, message-content, .model-response-text, .response-container-content, [data-message-author-role="model"]'
    );
    return Array.from(candidates);
  }

  function extractCleanResponseFromElement(el) {
    if (!el) return { text: '', images: [] };

    // Prefer message-content or .markdown inside model-response if present
    const markdownContainer =
      el.querySelector('message-content, .markdown, .model-response-text') || el;

    // Extract text preserving paragraphs & code blocks
    const text = (markdownContainer.innerText || markdownContainer.textContent || '').trim();

    // Extract any generated images inside this response
    const imgs = Array.from(el.querySelectorAll('img'))
      .filter((img) => {
        const src = img.src || '';
        const w = img.naturalWidth || img.width || 0;
        if (!src || src.includes(' avatar') || src.includes('gstatic.com/lamda')) return false;
        return w === 0 || w >= 120;
      })
      .map((img) => img.src);

    return { text, images: imgs };
  }

  function extractLatestGeminiResponse() {
    const responses = getModelResponseElements();
    if (responses.length === 0) return { text: '', images: [] };
    const lastEl = responses[responses.length - 1];
    return extractCleanResponseFromElement(lastEl);
  }

  function setInputText(inputEl, text) {
    inputEl.focus();

    if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(inputEl, text);
      } else {
        inputEl.value = text;
      }
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    // Contenteditable (Quill / Rich-Textarea in Gemini)
    // IMPORTANT: Never pass multi-line strings with '\n' into document.execCommand('insertText'),
    // because Quill treats the first '\n' as an Enter keypress (insertParagraph) and submits only Line 1!
    const normalizedText = String(text || '').replace(/\r\n/g, '\n').trim();
    const singleLineSafeText = normalizedText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('   |   ');
    const minExpectedLength = Math.max(10, Math.floor(singleLineSafeText.length * 0.8));

    try {
      const lines = normalizedText.split('\n');
      inputEl.innerHTML = '';
      for (const line of lines) {
        const p = document.createElement('p');
        if (line.trim().length > 0) {
          p.textContent = line;
        } else {
          p.appendChild(document.createElement('br'));
        }
        inputEl.appendChild(p);
      }

      // Place caret at the very end and insert a single space (no '\n') so Quill/Angular enables the Send button
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(inputEl);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      try {
        document.execCommand('insertText', false, ' ');
      } catch {}

      let afterText = (inputEl.innerText || inputEl.textContent || '').trim();
      if (afterText.length < minExpectedLength) {
        // Fallback: select all and insert single-line safe text (zero '\n' characters)
        const fallbackRange = document.createRange();
        fallbackRange.selectNodeContents(inputEl);
        selection.removeAllRanges();
        selection.addRange(fallbackRange);
        try {
          document.execCommand('delete', false);
        } catch {}
        document.execCommand('insertText', false, singleLineSafeText);
      }
    } catch {
      inputEl.textContent = singleLineSafeText;
    }

    inputEl.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: 'insertFromPaste',
        data: singleLineSafeText,
      })
    );
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function findDeepResearchStartPlanButton() {
    const allButtons = Array.from(
      document.querySelectorAll('button, [role="button"], a.mat-mdc-button-base')
    );
    const startPlanRegex =
      /\b(iniciar\s+investigaci[oó]n|empezar\s+a\s+investigar|comenzar\s+investigaci[oó]n|start\s+research|begin\s+research|confirmar\s+plan|confirm\s+plan)\b/i;

    for (const btn of allButtons) {
      if (!btn || btn.disabled || btn.offsetParent === null) continue;
      const text = (btn.innerText || btn.textContent || '').replace(/\s+/g, ' ').trim();
      const aria = (btn.getAttribute('aria-label') || '').trim();
      const testId = (btn.getAttribute('data-test-id') || '').trim();
      if (
        startPlanRegex.test(text) ||
        startPlanRegex.test(aria) ||
        /start-research|confirm-research/i.test(testId)
      ) {
        return btn;
      }
    }
    return null;
  }

  function isDeepResearchActivelyBrowsing() {
    const progressCandidates = document.querySelectorAll(
      'deep-research-progress, [class*="deep-research" i], [class*="research-progress" i], mat-progress-bar, mat-spinner'
    );
    for (const el of Array.from(progressCandidates)) {
      if (el && el.offsetParent !== null) {
        const txt = (el.innerText || el.textContent || '').toLowerCase();
        if (
          txt.includes('analizando') ||
          txt.includes('buscando') ||
          txt.includes('investigando') ||
          txt.includes('researching') ||
          txt.includes('browsing') ||
          txt.includes('sitios web') ||
          txt.includes('websites')
        ) {
          return true;
        }
      }
    }
    return false;
  }

  async function configureGeminiModelAndDeepResearch(
    enableHighModel,
    enableDeepResearch,
    enableArgonLow
  ) {
    if (!enableHighModel && !enableDeepResearch && !enableArgonLow) return;

    try {
      // 1. Find the main model switcher button in Gemini Web
      const switcherSelectors = [
        '[data-test-id="bard-mode-menu-button"]',
        'bard-mode-switcher button',
        'button.input-area-switch',
        'button[aria-label*="mode" i]',
        'button[aria-label*="modelo" i]',
        'button[aria-label*="selector" i]',
      ];
      let switcherBtn = null;
      for (const sel of switcherSelectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) {
          switcherBtn = el;
          break;
        }
      }

      if (switcherBtn) {
        const currentLabel = (switcherBtn.innerText || switcherBtn.textContent || '').toLowerCase();
        const needsModelClick = enableArgonLow
          ? !(/argon/i.test(currentLabel) && /\b(low|bajo)\b/i.test(currentLabel))
          : (enableHighModel && !/pro|high|thinking|avanzado|ultra/i.test(currentLabel)) ||
            (enableDeepResearch && !/deep\s*research|investigaci[oó]n\s+profunda/i.test(currentLabel));

        if (needsModelClick) {
          switcherBtn.click();
          await sleep(280);

          const getVisibleMenuItems = () =>
            Array.from(
              document.querySelectorAll(
                '[role="menuitem"], [role="option"], [role="menuitemradio"], [role="radio"], [role="tab"], .mat-mdc-menu-item, button.bard-mode-list-button'
              )
            ).filter((el) => el && el.offsetParent !== null);

          let menuItems = getVisibleMenuItems();

          if (enableArgonLow) {
            // 1A. Look for a combined "Argon Low" item first, then "Argon" (not High), then "Low / Flash / Fast"
            const argonLowCombined = menuItems.find((el) => {
              const txt = (el.innerText || el.textContent || '').trim();
              return /argon/i.test(txt) && /\b(low|bajo)\b/i.test(txt);
            });
            const argonItem =
              argonLowCombined ||
              menuItems.find((el) => {
                const txt = (el.innerText || el.textContent || '').trim();
                return /argon/i.test(txt) && !/\bhigh\b/i.test(txt);
              }) ||
              menuItems.find((el) => /argon/i.test((el.innerText || el.textContent || '').trim()));

            if (argonItem) {
              argonItem.click();
              await sleep(240);
            }

            // Re-query visible menu/sub-menu items in case clicking Argon revealed Low/Medium/High options
            menuItems = getVisibleMenuItems();
            const lowMenuItem =
              menuItems.find((el) =>
                /^(?:low|bajo|argon\s*low|argon\s*\(low\))$/i.test(
                  (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
                )
              ) ||
              menuItems.find((el) => {
                const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                return /\b(low|bajo|flash|fast|r[aá]pido)\b/i.test(txt) && !/\bhigh\b/i.test(txt);
              });

            if (lowMenuItem && lowMenuItem !== argonItem) {
              lowMenuItem.click();
              await sleep(220);
            } else if (!argonItem) {
              document.body.click();
              await sleep(120);
            }
          } else {
            let chosenItem = null;
            if (enableDeepResearch) {
              chosenItem = menuItems.find((el) =>
                /deep\s*research|investigaci[oó]n\s+profunda/i.test(
                  (el.innerText || el.textContent || '').trim()
                )
              );
            }
            if (!chosenItem && enableHighModel) {
              chosenItem =
                menuItems.find((el) => {
                  const txt = (el.innerText || el.textContent || '').trim();
                  return /argon/i.test(txt) && /\bhigh\b/i.test(txt);
                }) ||
                menuItems.find((el) =>
                  /\b(3\.1\s*pro|2\.5\s*pro|pro|high|avanzado|thinking|razonamiento)\b/i.test(
                    (el.innerText || el.textContent || '').trim()
                  )
                ) ||
                null;
            }

            if (chosenItem) {
              chosenItem.click();
              await sleep(260);
            } else {
              document.body.click();
              await sleep(120);
            }
          }
        }
      }

      // 1B. If enableArgonLow is active, also check if there is a separate Thinking/Reasoning level selector or pill ("High" / "Medium" / "Low") in the toolbar or header
      if (enableArgonLow) {
        const allButtons = Array.from(
          document.querySelectorAll(
            'button, [role="button"], [role="combobox"], [role="radio"], [role="tab"], mat-select, mat-chip'
          )
        ).filter((el) => el && el.offsetParent !== null);

        // Direct "Low" pill/tab button if visible
        const directLowBtn = allButtons.find((el) => {
          const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          const a = (el.getAttribute('aria-label') || '').trim();
          return /^(?:low|bajo)$/i.test(t) || /\b(?:thinking|reasoning|nivel|level|argon)\b.*\blow\b/i.test(a);
        });

        if (directLowBtn) {
          directLowBtn.click();
          await sleep(200);
        } else {
          // Or if there is a level dropdown button currently showing "High" or "Medium", click it and pick "Low"
          const levelDropdownBtn = allButtons.find((el) => {
            if (el === switcherBtn) return false;
            const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            const a = (el.getAttribute('aria-label') || '').trim();
            return (
              /^(?:high|medium|alto|medio|thinking:\s*high|argon\s*high)$/i.test(t) ||
              /\b(thinking|reasoning|effort|level|nivel)\b/i.test(a)
            );
          });
          if (levelDropdownBtn) {
            levelDropdownBtn.click();
            await sleep(240);
            const opts = Array.from(
              document.querySelectorAll(
                '[role="menuitem"], [role="option"], [role="menuitemradio"], .mat-mdc-menu-item, mat-option, button'
              )
            ).filter((el) => el && el.offsetParent !== null);
            const lowOpt =
              opts.find((el) =>
                /^(?:low|bajo)$/i.test((el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim())
              ) ||
              opts.find((el) =>
                /\b(low|bajo)\b/i.test((el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim())
              );
            if (lowOpt) {
              lowOpt.click();
              await sleep(200);
            } else {
              document.body.click();
              await sleep(100);
            }
          }
        }
      }

      // 2. Manage Deep Research chip/button in the prompt input toolbar (turn ON if enableDeepResearch, turn OFF if enableArgonLow)
      const toolbarCandidates = Array.from(
        document.querySelectorAll('button, mat-chip, [role="button"], [role="checkbox"], [role="switch"]')
      ).filter((el) => el && el.offsetParent !== null);

      const deepResearchBtn = toolbarCandidates.find((el) => {
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        const a = (el.getAttribute('aria-label') || '').trim();
        return (
          /^(?:deep\s*research|investigaci[oó]n\s+profunda)$/i.test(t) ||
          /\b(deep\s*research|investigaci[oó]n\s+profunda)\b/i.test(a)
        );
      });

      if (deepResearchBtn) {
        const isAlreadyPressed =
          deepResearchBtn.getAttribute('aria-pressed') === 'true' ||
          deepResearchBtn.getAttribute('aria-checked') === 'true' ||
          deepResearchBtn.classList.contains('selected') ||
          deepResearchBtn.classList.contains('active') ||
          deepResearchBtn.classList.contains('mdc-evolution-chip--selected');

        if (enableDeepResearch && !isAlreadyPressed) {
          deepResearchBtn.click();
          await sleep(260);
        } else if (!enableDeepResearch && isAlreadyPressed) {
          deepResearchBtn.click();
          await sleep(220);
        }
      }
    } catch {}
  }

  function watchForNewResponse(initialCount, initialLastText, meta) {
    if (activeWatchTimer) clearInterval(activeWatchTimer);

    let elapsedMs = 0;
    let stableTicks = 0;
    let lastObservedText = '';
    let hasStarted = false;
    let hasClickedStartResearchPlan = false;
    let planClickedAtMs = 0;
    let textAtPlanClick = '';
    const isDeepResearch = Boolean(meta && meta.enableDeepResearch);
    const maxTimeoutMs = isDeepResearch ? 1200000 : 180000; // 20 min for Deep Research, 3 min normal

    reportStatus(
      'GENERATING',
      isDeepResearch
        ? '🔬 Gemini Web (High + Deep Research) preparando el Plan de Investigación...'
        : 'Gemini Web está redactando la respuesta...',
      meta
    );

    activeWatchTimer = setInterval(() => {
      elapsedMs += 800;

      // Auto-click "Iniciar investigación" / "Start research" when Deep Research presents its research plan!
      if (isDeepResearch && !hasClickedStartResearchPlan) {
        const startPlanBtn = findDeepResearchStartPlanButton();
        if (startPlanBtn) {
          hasClickedStartResearchPlan = true;
          planClickedAtMs = elapsedMs;
          textAtPlanClick = extractLatestGeminiResponse().text || '';
          stableTicks = 0;
          try {
            startPlanBtn.click();
          } catch {}
          reportStatus(
            'GENERATING',
            '🚀 ¡Botón "Iniciar investigación" presionado automáticamente! Gemini Deep Research está investigando múltiples fuentes...',
            meta
          );
          return;
        }
      }

      const responses = getModelResponseElements();
      const currentCount = responses.length;
      const latest = extractLatestGeminiResponse();
      const stillStreaming = isGeminiStillGenerating() || (isDeepResearch && isDeepResearchActivelyBrowsing());

      if (
        stillStreaming ||
        currentCount > initialCount ||
        (latest.text && latest.text !== initialLastText)
      ) {
        hasStarted = true;
      }

      if (hasStarted && (latest.text || latest.images.length > 0)) {
        // If Deep Research just clicked "Start research", wait until the final report replaces/expands the plan
        if (
          isDeepResearch &&
          hasClickedStartResearchPlan &&
          elapsedMs - planClickedAtMs < 15000 &&
          latest.text === textAtPlanClick
        ) {
          stableTicks = 0;
          return;
        }

        // Also if Deep Research is enabled and the "Start research" button is about to appear on the plan card, give it a few ticks before concluding
        if (
          isDeepResearch &&
          !hasClickedStartResearchPlan &&
          elapsedMs < 25000 &&
          latest.text.length < 2500
        ) {
          const maybePlanBtn = findDeepResearchStartPlanButton();
          if (maybePlanBtn) return;
        }

        if (!stillStreaming && latest.text === lastObservedText && latest.text.length > 10) {
          stableTicks++;
        } else if (!stillStreaming && latest.images.length > 0 && latest.text === lastObservedText) {
          stableTicks++;
        } else {
          stableTicks = 0;
          lastObservedText = latest.text;
          reportStatus(
            'STREAMING',
            `Recibiendo respuesta de Gemini Web (${latest.text.length} caracteres)...`,
            {
              ...meta,
              previewText: latest.text.slice(0, 220),
            }
          );
        }

        const requiredStableTicks = isDeepResearch ? 5 : 3;
        if (stableTicks >= requiredStableTicks) {
          clearInterval(activeWatchTimer);
          activeWatchTimer = null;
          chrome.runtime.sendMessage({
            type: 'GEMINI_RESPONSE_READY',
            stageNumber: meta.stageNumber,
            taskType: meta.taskType,
            text: latest.text,
            images: latest.images,
          }).catch(() => {});
          reportStatus('COMPLETED', '¡Respuesta de Gemini Web capturada y enviada a Huellas Master!', meta);
          return;
        }
      }

      if (elapsedMs >= maxTimeoutMs) {
        clearInterval(activeWatchTimer);
        activeWatchTimer = null;
        if (latest.text && latest.text !== initialLastText) {
          chrome.runtime.sendMessage({
            type: 'GEMINI_RESPONSE_READY',
            stageNumber: meta.stageNumber,
            taskType: meta.taskType,
            text: latest.text,
            images: latest.images,
          }).catch(() => {});
        }
      }
    }, 800);
  }

  function handleSendPrompt(payload) {
    (async () => {
      const useArgonLow =
        Boolean(payload.enableArgonLow) ||
        (!payload.enableHighModel && !payload.enableDeepResearch);

      if (payload.enableHighModel || payload.enableDeepResearch || useArgonLow) {
        reportStatus(
          'WORKING',
          useArgonLow
            ? '⚡ Configurando Gemini Argon en Low...'
            : `⚙️ Configurando Gemini Web en modo ${
                payload.enableDeepResearch ? 'High + Deep Research' : 'High / Pro'
              }...`,
          { stageNumber: payload.stageNumber }
        );
        await configureGeminiModelAndDeepResearch(
          Boolean(payload.enableHighModel),
          Boolean(payload.enableDeepResearch),
          useArgonLow
        );
      }

      const inputEl = findPromptInput();
      if (!inputEl) {
        reportStatus(
          'ERROR',
          'No se encontró la caja de texto en Gemini Web. Asegúrate de haber iniciado sesión en gemini.google.com.'
        );
        return;
      }

      const initialResponses = getModelResponseElements();
      const initialCount = initialResponses.length;
      const initialLastText = extractLatestGeminiResponse().text;

      setInputText(inputEl, payload.prompt || '');
      reportStatus('PROMPT_INJECTED', 'Prompt pegado en Gemini Web...', {
        stageNumber: payload.stageNumber,
      });

      if (payload.autoSubmit !== false) {
        setTimeout(() => {
          const sendBtn = findSendButton();
          if (sendBtn) {
            sendBtn.click();
          } else {
            inputEl.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true,
              })
            );
          }
          watchForNewResponse(initialCount, initialLastText, {
            stageNumber: payload.stageNumber,
            taskType: payload.taskType || 'STAGE_GENERATION',
            enableHighModel: Boolean(payload.enableHighModel),
            enableDeepResearch: Boolean(payload.enableDeepResearch),
          });
        }, 450);
      }
    })();

    return true;
  }

  // Listen for commands from background.js
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'GEMINI') return false;

    if (msg.action === 'SEND_PROMPT') {
      const ok = handleSendPrompt(msg);
      sendResponse({ handled: ok });
      return false;
    }

    if (msg.action === 'GRAB_LAST_RESPONSE') {
      const latest = extractLatestGeminiResponse();
      chrome.runtime.sendMessage({
        type: 'GEMINI_RESPONSE_READY',
        stageNumber: msg.stageNumber,
        taskType: msg.taskType || 'MANUAL_GRAB',
        text: latest.text,
        images: latest.images,
      }).catch(() => {});
      sendResponse({ handled: true, textLength: latest.text.length });
      return false;
    }

    return false;
  });

  chrome.runtime.sendMessage({
    type: 'CONTENT_SCRIPT_READY',
    service: 'GEMINI',
  }).catch(() => {});
})();
