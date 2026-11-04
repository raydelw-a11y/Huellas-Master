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

  if (window.__HUELLAS_GEMINI_SCRIPT_VERSION__ === 6) return;
  window.__HUELLAS_GEMINI_SCRIPT_VERSION__ = 6;
  window.__HUELLAS_GEMINI_SCRIPT_LOADED__ = true;

  if (window.__HUELLAS_GEMINI_ACTIVE_WATCH_TIMER__) {
    clearInterval(window.__HUELLAS_GEMINI_ACTIVE_WATCH_TIMER__);
    window.__HUELLAS_GEMINI_ACTIVE_WATCH_TIMER__ = null;
  }
  if (
    window.__HUELLAS_GEMINI_MESSAGE_LISTENER__ &&
    chrome.runtime &&
    chrome.runtime.onMessage
  ) {
    try {
      chrome.runtime.onMessage.removeListener(window.__HUELLAS_GEMINI_MESSAGE_LISTENER__);
    } catch {}
  }

  let activeWatchTimer = null;
  let isBusyWithOrder = false;
  const promptQueue = [];
  let lastConfiguredModelMode = null;

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
      'button.send-button:not([disabled]):not([aria-disabled="true"])',
      '.send-button-container button:not([disabled]):not([aria-disabled="true"])',
      'button[data-test-id*="send" i]:not([disabled]):not([aria-disabled="true"])',
      'button[aria-label*="Send message" i]:not([disabled]):not([aria-disabled="true"])',
      'button[aria-label*="Enviar mensaje" i]:not([disabled]):not([aria-disabled="true"])',
      'button[aria-label*="Send" i]:not([disabled]):not([aria-disabled="true"])',
      'button[aria-label*="Enviar" i]:not([disabled]):not([aria-disabled="true"])',
      'button[mattooltip*="Send" i]:not([disabled]):not([aria-disabled="true"])',
      'button[mattooltip*="Enviar" i]:not([disabled]):not([aria-disabled="true"])',
    ];
    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) return btn;
    }
    // Fallback: check any button with send icon inside input area
    const iconBtns = Array.from(
      document.querySelectorAll(
        '.input-buttons-wrapper-bottom button, .send-button-container button, rich-textarea ~ * button'
      )
    );
    for (const btn of iconBtns) {
      if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;
      const iconTxt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const hasSendIcon = Boolean(
        btn.querySelector('mat-icon[data-mat-icon-name="send"], mat-icon[fonticon="send"]') ||
          iconTxt === 'send' ||
          iconTxt === 'arrow_upward'
      );
      if (
        hasSendIcon &&
        !aria.includes('stop') &&
        !aria.includes('detener') &&
        !aria.includes('mic')
      ) {
        return btn;
      }
    }
    return null;
  }

  function isElementVisibleInDom(el) {
    if (!el) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    if (el.offsetParent !== null) return true;
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      const rects = el.getClientRects ? el.getClientRects() : [];
      return rects.length > 0;
    } catch {
      return false;
    }
  }

  function isGeminiStillGenerating() {
    const stopSelectors = [
      'button[aria-label*="Stop" i]',
      'button[aria-label*="Detener" i]',
      'button[aria-label*="Interrumpir" i]',
      'button[mattooltip*="Stop" i]',
      'button[mattooltip*="Detener" i]',
      'button[mattooltip*="Interrumpir" i]',
      'button.stop-button',
      'button.send-button.stop',
      '.send-button-container.stop button',
      '.stop-icon',
      'mat-icon[data-mat-icon-name*="stop" i]',
      'mat-icon[fonticon*="stop" i]',
    ];
    for (const sel of stopSelectors) {
      const el = document.querySelector(sel);
      if (isElementVisibleInDom(el)) return true;
    }
    const streamingIndicators = document.querySelectorAll(
      'model-response[is-streaming="true"], message-content[is-streaming="true"], .markdown.streaming, model-response mat-progress-bar, model-response mat-spinner'
    );
    if (streamingIndicators.length > 0) return true;
    return false;
  }

  function getModelResponseElements() {
    const topLevelModelResponses = document.querySelectorAll('model-response');
    if (topLevelModelResponses.length > 0) {
      return Array.from(topLevelModelResponses);
    }
    const roleResponses = document.querySelectorAll('[data-message-author-role="model"]');
    if (roleResponses.length > 0) {
      return Array.from(roleResponses);
    }
    const candidates = document.querySelectorAll('.response-container-content, message-content');
    return Array.from(candidates);
  }

  function cleanDomFragmentToText(rootNode) {
    if (!rootNode) return '';
    const clone = rootNode.cloneNode(true);

    // Strip internal thinking blocks, UI chrome, code-block headers, citations, and buttons
    const junkSelectors = [
      'model-thoughts',
      '.thoughts-container',
      '.thoughts-content',
      '[data-test-id*="thought" i]',
      'message-actions',
      '.message-actions',
      '.response-container-footer',
      '.response-container-header',
      '.code-block-decoration',
      '.code-block-header',
      '.buttons-container',
      '.action-buttons',
      'sources-carousel',
      'sources-list',
      '.citation-marker',
      'sup.citation',
      'button',
      'mat-icon',
      'script',
      'style',
      'svg',
    ];
    for (const sel of junkSelectors) {
      try {
        clone.querySelectorAll(sel).forEach((n) => n.remove());
      } catch {}
    }

    const blockTags = new Set([
      'P',
      'DIV',
      'LI',
      'UL',
      'OL',
      'PRE',
      'CODE-BLOCK',
      'BLOCKQUOTE',
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
      'TR',
      'HR',
      'SECTION',
      'ARTICLE',
      'MESSAGE-CONTENT',
    ]);

    const pieces = [];
    function walk(node) {
      if (!node) return;
      if (node.nodeType === Node.TEXT_NODE) {
        pieces.push(node.nodeValue || '');
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName ? node.tagName.toUpperCase() : '';
      if (tag === 'BR') {
        pieces.push('\n');
        return;
      }
      const isBlock = blockTags.has(tag);
      if (isBlock && pieces.length > 0 && !pieces[pieces.length - 1].endsWith('\n')) {
        pieces.push('\n');
      }
      const children = node.childNodes;
      for (let i = 0; i < children.length; i++) {
        walk(children[i]);
      }
      if (isBlock && pieces.length > 0 && !pieces[pieces.length - 1].endsWith('\n')) {
        pieces.push('\n');
      }
    }

    walk(clone);

    return pieces
      .join('')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(
        /(?:^|\n)[⠀\s]*(?:[-—*]+\s*\n)?[⠀\s]*(?:¡?Metadata\s+completada!?|Una\s+vez\s+publicado\s+el\s+video|entramos\s+en\s+la\s+Etapa\s+12|Etapa\s+12\s*\(?Post-Producci[oó]n|A\s+medida\s+que\s+tu\s+audiencia\s+comente)[\s\S]*$/i,
        ''
      )
      .replace(/[⠀\s]+$/g, '')
      .trim();
  }

  function extractCleanResponseFromElement(el) {
    if (!el) return { text: '', images: [] };

    // Extract ALL message-content blocks outside model-thoughts so multi-block / code-block responses are never truncated
    const msgContents = Array.from(
      el.querySelectorAll('message-content, .model-response-text')
    ).filter(
      (node, idx, arr) =>
        !node.closest('model-thoughts, .thoughts-container, [data-test-id*="thought" i]') &&
        !arr.some((other) => other !== node && other.contains(node))
    );

    let text = '';
    if (msgContents.length > 0) {
      text = msgContents
        .map((mc) => cleanDomFragmentToText(mc))
        .filter(Boolean)
        .join('\n\n')
        .trim();
    }
    if (!text) {
      text = cleanDomFragmentToText(el);
    }

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

  function hasResponseFooterActionBar(el) {
    if (!el) return false;
    return Boolean(
      el.querySelector(
        'message-actions, .message-actions, button[aria-label*="Copiar" i], button[aria-label*="Copy" i], mat-icon[fonticon*="thumb_up" i], mat-icon[data-mat-icon-name*="thumb_up" i], mat-icon[fonticon*="content_copy" i], mat-icon[data-mat-icon-name*="content_copy" i]'
      )
    );
  }

  function isStageResponseSemanticallyComplete(stageNum, text) {
    const clean = String(text || '').trim();
    if (!clean) return false;
    const num = Number(stageNum) || 0;
    const hashtags = clean.match(/#[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_]+/g) || [];
    const hasSlogan = /Cada historia deja una huella/i.test(clean);
    const hasAiNote = /inteligencia artificial generativa|incongruencias o errores visuales/i.test(clean);

    if (num === 111 || num === 11) {
      const hasChapters =
        /Cap[ií]tulos\s*:/i.test(clean) || (clean.match(/\b\d{2}:\d{2}\b/g) || []).length >= 3;
      const hasEnding = hashtags.length >= 3 || (hasSlogan && hashtags.length >= 1);
      return clean.length >= 1200 && hasChapters && hasEnding;
    }
    if (num === 112) {
      const hasEnding = hashtags.length >= 3 || (hasSlogan && hashtags.length >= 1) || (hasAiNote && hasSlogan);
      return clean.length >= 1000 && hasEnding;
    }
    return true;
  }

  function scanAllStage11ResponsesFromChat() {
    const responses = getModelResponseElements();
    const bundle = {
      youtube: '',
      facebook: '',
      pinnedComment: '',
      youtubeTags: '',
    };

    for (const el of responses) {
      const { text } = extractCleanResponseFromElement(el);
      const clean = String(text || '').trim();
      if (!clean || clean.length < 40) continue;
      if (/^Act[uú]a como (?:estratega|especialista)/i.test(clean)) continue;

      const hasChapters =
        /Cap[ií]tulos\s*:/i.test(clean) || (clean.match(/\b\d{2}:\d{2}\s*[-–—:]/g) || []).length >= 3;
      const hashtags = clean.match(/#[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_]+/g) || [];
      const hasSlogan = /Cada historia deja una huella/i.test(clean);
      const hasAiNote = /inteligencia artificial generativa|incongruencias o errores visuales/i.test(clean);
      const commaCount = (clean.match(/,/g) || []).length;

      if (hasChapters && clean.length >= 500) {
        // Prefer the most complete / latest YouTube metadata turn
        if (!bundle.youtube || clean.length >= bundle.youtube.length - 100 || hashtags.length >= 3) {
          bundle.youtube = clean;
        }
      } else if (
        !hasChapters &&
        clean.length >= 500 &&
        (hasSlogan || hasAiNote || hashtags.length >= 3)
      ) {
        if (!bundle.facebook || clean.length >= bundle.facebook.length - 100 || hashtags.length >= 3) {
          bundle.facebook = clean;
        }
      } else if (
        !hasChapters &&
        clean.length >= 60 &&
        clean.length <= 1300 &&
        !hasSlogan &&
        (clean.includes('¿') || clean.includes('?') || commaCount < 8)
      ) {
        if (commaCount < 10) {
          bundle.pinnedComment = clean;
        }
      } else if (
        !hasChapters &&
        clean.length >= 70 &&
        clean.length <= 950 &&
        commaCount >= 6 &&
        !clean.includes('¿')
      ) {
        bundle.youtubeTags = clean;
      }
    }

    return bundle;
  }

  function extractLatestGeminiResponse() {
    const responses = getModelResponseElements();
    if (responses.length === 0) return { text: '', images: [], element: null };
    const lastEl = responses[responses.length - 1];
    const extracted = extractCleanResponseFromElement(lastEl);
    return { ...extracted, element: lastEl };
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
    // IMPORTANT: Never pass multi-line strings with '\n' into document.execCommand('insertText')
    // and DO NOT wipe inputEl.innerHTML = '' first (which breaks Quill's internal Scroll blot on subsequent orders).
    const normalizedText = String(text || '').replace(/\r\n/g, '\n').trim();
    const singleLineSafeText = normalizedText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('   |   ');
    const minExpectedLength = Math.max(10, Math.floor(singleLineSafeText.length * 0.8));

    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(inputEl);
      selection.removeAllRanges();
      selection.addRange(range);

      // 1. Try ClipboardEvent('paste') first (works through Quill's Clipboard module even in background tabs)
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', singleLineSafeText);
        inputEl.dispatchEvent(
          new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            composed: true,
            clipboardData: dt,
          })
        );
      } catch {}

      // 2. Check if paste populated the editor; if not, use execCommand('insertText')
      let afterText = (inputEl.innerText || inputEl.textContent || '').trim();
      if (afterText.length < minExpectedLength) {
        const fallbackRange = document.createRange();
        fallbackRange.selectNodeContents(inputEl);
        selection.removeAllRanges();
        selection.addRange(fallbackRange);
        try {
          document.execCommand('delete', false);
        } catch {}
        try {
          document.execCommand('insertText', false, singleLineSafeText);
        } catch {}
      }

      // 3. If still not populated (e.g. background tab blocked execCommand), reuse existing <p> without destroying Quill root
      afterText = (inputEl.innerText || inputEl.textContent || '').trim();
      if (afterText.length < minExpectedLength) {
        let p = inputEl.querySelector('p');
        if (!p) {
          p = document.createElement('p');
          inputEl.appendChild(p);
        }
        p.textContent = singleLineSafeText;
        Array.from(inputEl.querySelectorAll('p')).forEach((node, idx) => {
          if (idx > 0) node.remove();
        });
      }

      inputEl.classList.remove('ql-blank');
    } catch {
      inputEl.textContent = singleLineSafeText;
    }

    const richHost = inputEl.closest('rich-textarea');
    for (const target of [inputEl, richHost].filter(Boolean)) {
      target.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType: 'insertText',
          data: singleLineSafeText,
        })
      );
      target.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType: 'insertText',
          data: singleLineSafeText,
        })
      );
      target.dispatchEvent(new Event('change', { bubbles: true }));
    }
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

        const stageNum = Number(meta && meta.stageNumber) || 0;
        const isLongMetadataStage = stageNum === 111 || stageNum === 112 || stageNum === 11;
        const semanticallyComplete = isStageResponseSemanticallyComplete(stageNum, latest.text);
        const hasFooterActions = hasResponseFooterActionBar(latest.element);

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

        // For Stage 9 YouTube/Facebook metadata (~3000 chars), do not cut off mid-stream in background tabs before the closing #Hashtags / Slogan arrive
        let requiredStableTicks = isDeepResearch ? 5 : 4;
        if (isLongMetadataStage && !semanticallyComplete && elapsedMs < 65000) {
          requiredStableTicks = hasFooterActions ? 10 : 18;
        }

        if (stableTicks >= requiredStableTicks) {
          clearInterval(activeWatchTimer);
          activeWatchTimer = null;
          window.__HUELLAS_GEMINI_ACTIVE_WATCH_TIMER__ = null;
          setTimeout(() => {
            const finalLatest = extractLatestGeminiResponse();
            const isStage11Family =
              stageNum === 11 ||
              stageNum === 111 ||
              stageNum === 112 ||
              stageNum === 113 ||
              stageNum === 114;
            const stage11Bundle = isStage11Family ? scanAllStage11ResponsesFromChat() : undefined;
            const resolvedText =
              stageNum === 111 && stage11Bundle?.youtube && stage11Bundle.youtube.length > finalLatest.text.length
                ? stage11Bundle.youtube
                : stageNum === 112 && stage11Bundle?.facebook && stage11Bundle.facebook.length > finalLatest.text.length
                ? stage11Bundle.facebook
                : finalLatest.text || latest.text;

            isBusyWithOrder = false;
            chrome.runtime
              .sendMessage({
                type: 'GEMINI_RESPONSE_READY',
                stageNumber: meta.stageNumber,
                taskType: meta.taskType,
                text: resolvedText,
                images: finalLatest.images.length > 0 ? finalLatest.images : latest.images,
                ...(stage11Bundle ? { stage11Bundle } : {}),
              })
              .catch(() => {});
            reportStatus(
              'COMPLETED',
              `¡Respuesta completa de Gemini Web capturada (${resolvedText.length} caracteres) y enviada a Huellas Master!`,
              meta
            );
            processNextQueuedPrompt();
          }, 450);
          return;
        }
      }

      if (elapsedMs >= maxTimeoutMs) {
        clearInterval(activeWatchTimer);
        activeWatchTimer = null;
        window.__HUELLAS_GEMINI_ACTIVE_WATCH_TIMER__ = null;
        isBusyWithOrder = false;
        const finalLatest = extractLatestGeminiResponse();
        if (finalLatest.text && finalLatest.text !== initialLastText) {
          const stageNum = Number(meta && meta.stageNumber) || 0;
          const isStage11Family =
            stageNum === 11 ||
            stageNum === 111 ||
            stageNum === 112 ||
            stageNum === 113 ||
            stageNum === 114;
          const stage11Bundle = isStage11Family ? scanAllStage11ResponsesFromChat() : undefined;
          chrome.runtime
            .sendMessage({
              type: 'GEMINI_RESPONSE_READY',
              stageNumber: meta.stageNumber,
              taskType: meta.taskType,
              text: finalLatest.text,
              images: finalLatest.images,
              ...(stage11Bundle ? { stage11Bundle } : {}),
            })
            .catch(() => {});
        }
        processNextQueuedPrompt();
      }
    }, 800);
    window.__HUELLAS_GEMINI_ACTIVE_WATCH_TIMER__ = activeWatchTimer;
  }

  function processNextQueuedPrompt() {
    if (isBusyWithOrder || promptQueue.length === 0) return;
    const nextPayload = promptQueue.shift();
    setTimeout(() => {
      executeSinglePromptOrder(nextPayload);
    }, 1100);
  }

  function executeSinglePromptOrder(payload) {
    isBusyWithOrder = true;
    (async () => {
      try {
        // 1. Wait if Gemini is still finishing a previous response so the Stop button turns back into Send
        let waitbusyLoops = 0;
        while (isGeminiStillGenerating() && waitbusyLoops < 75) {
          await sleep(400);
          waitbusyLoops++;
        }
        if (waitbusyLoops > 0) {
          await sleep(500);
        }

        const useArgonLow =
          Boolean(payload.enableArgonLow) ||
          (!payload.enableHighModel && !payload.enableDeepResearch);
        const desiredModeKey = payload.enableDeepResearch
          ? 'HIGH_DEEP_RESEARCH'
          : payload.enableHighModel
          ? 'HIGH'
          : 'ARGON_LOW';

        // 2. Configure model (skip re-clicking menu if already configured to the exact same mode in this session)
        if (!payload.skipModelSwitch && lastConfiguredModelMode !== desiredModeKey) {
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
          lastConfiguredModelMode = desiredModeKey;
        }

        const inputEl = findPromptInput();
        if (!inputEl) {
          isBusyWithOrder = false;
          reportStatus(
            'ERROR',
            'No se encontró la caja de texto en Gemini Web. Asegúrate de haber iniciado sesión en gemini.google.com.'
          );
          processNextQueuedPrompt();
          return;
        }

        const initialResponses = getModelResponseElements();
        const initialCount = initialResponses.length;
        const initialLastText = extractLatestGeminiResponse().text;

        const rawPrompt = String(payload.prompt || '');
        setInputText(inputEl, rawPrompt);
        reportStatus('PROMPT_INJECTED', 'Prompt pegado en Gemini Web, enviando orden...', {
          stageNumber: payload.stageNumber,
        });

        // Also ask background.js to run MAIN-world Quill injection & Send click right now (after model switch is done)
        chrome.runtime
          .sendMessage({
            type: 'GEMINI_MAIN_WORLD_INJECT_AND_SUBMIT',
            prompt: rawPrompt,
            autoSubmit: payload.autoSubmit !== false,
          })
          .catch(() => {});

        if (payload.autoSubmit !== false) {
          // 3. Persistent submit retry loop: keep clicking Send / waking Quill until the text box empties or Gemini starts generating
          for (let attempt = 0; attempt < 16; attempt++) {
            await sleep(attempt === 0 ? 350 : 400);

            const currentResponsesCount = getModelResponseElements().length;
            const currentInputEl = findPromptInput() || inputEl;
            const remainingText = (
              currentInputEl.value ??
              currentInputEl.innerText ??
              currentInputEl.textContent ??
              ''
            ).trim();

            if (
              isGeminiStillGenerating() ||
              currentResponsesCount > initialCount ||
              remainingText.length < 5
            ) {
              break;
            }

            let sendBtn = findSendButton();
            if (!sendBtn) {
              // Wake up Quill / Angular FormControl if Send button is still disabled
              setInputText(currentInputEl, rawPrompt);
              chrome.runtime
                .sendMessage({
                  type: 'GEMINI_MAIN_WORLD_INJECT_AND_SUBMIT',
                  prompt: rawPrompt,
                  autoSubmit: true,
                })
                .catch(() => {});
              await sleep(180);
              sendBtn = findSendButton();
            }

            if (sendBtn) {
              try {
                sendBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                sendBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                sendBtn.click();
              } catch {}
            } else {
              currentInputEl.focus();
              currentInputEl.dispatchEvent(
                new KeyboardEvent('keydown', {
                  key: 'Enter',
                  code: 'Enter',
                  keyCode: 13,
                  which: 13,
                  bubbles: true,
                  cancelable: true,
                })
              );
            }
          }

          watchForNewResponse(initialCount, initialLastText, {
            stageNumber: payload.stageNumber,
            taskType: payload.taskType || 'STAGE_GENERATION',
            enableHighModel: Boolean(payload.enableHighModel),
            enableDeepResearch: Boolean(payload.enableDeepResearch),
          });
        } else {
          isBusyWithOrder = false;
          processNextQueuedPrompt();
        }
      } catch {
        isBusyWithOrder = false;
        processNextQueuedPrompt();
      }
    })();
  }

  function handleSendPrompt(payload) {
    if (isBusyWithOrder || activeWatchTimer !== null || isGeminiStillGenerating()) {
      promptQueue.push(payload);
      reportStatus(
        'WORKING',
        `⏳ Orden en cola (#${promptQueue.length}) — se enviará automáticamente en cuanto termine la respuesta actual...`,
        { stageNumber: payload.stageNumber }
      );
      return true;
    }
    executeSinglePromptOrder(payload);
    return true;
  }

  // Listen for commands from background.js
  const onRuntimeMessage = (msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'GEMINI') return false;

    if (msg.action === 'SEND_PROMPT') {
      const ok = handleSendPrompt(msg);
      sendResponse({ handled: ok });
      return false;
    }

    if (msg.action === 'GRAB_LAST_RESPONSE' || msg.action === 'SYNC_STAGE11_FROM_GEMINI') {
      const latest = extractLatestGeminiResponse();
      const stageNum = Number(msg.stageNumber) || 0;
      const isStage11Family =
        msg.action === 'SYNC_STAGE11_FROM_GEMINI' ||
        stageNum === 11 ||
        stageNum === 111 ||
        stageNum === 112 ||
        stageNum === 113 ||
        stageNum === 114;
      const stage11Bundle = isStage11Family ? scanAllStage11ResponsesFromChat() : undefined;
      let resolvedText = latest.text;
      if (stage11Bundle) {
        if (stageNum === 111 && stage11Bundle.youtube) resolvedText = stage11Bundle.youtube;
        else if (stageNum === 112 && stage11Bundle.facebook) resolvedText = stage11Bundle.facebook;
        else if (stageNum === 113 && stage11Bundle.pinnedComment) resolvedText = stage11Bundle.pinnedComment;
        else if (stageNum === 114 && stage11Bundle.youtubeTags) resolvedText = stage11Bundle.youtubeTags;
        else if (stageNum === 11 && stage11Bundle.youtube) resolvedText = stage11Bundle.youtube;
      }
      chrome.runtime.sendMessage({
        type: 'GEMINI_RESPONSE_READY',
        stageNumber: msg.stageNumber,
        taskType: msg.taskType || (msg.action === 'SYNC_STAGE11_FROM_GEMINI' ? 'AUTO_RECOVER_STAGE11' : 'MANUAL_GRAB'),
        text: resolvedText,
        images: latest.images,
        ...(stage11Bundle ? { stage11Bundle } : {}),
      }).catch(() => {});
      sendResponse({ handled: true, textLength: (resolvedText || '').length, stage11Bundle });
      return false;
    }

    return false;
  };
  window.__HUELLAS_GEMINI_MESSAGE_LISTENER__ = onRuntimeMessage;
  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  chrome.runtime.sendMessage({
    type: 'CONTENT_SCRIPT_READY',
    service: 'GEMINI',
  }).catch(() => {});

  // Immediately scan existing chat turns on script load in case Stage 11 YouTube metadata finished streaming in this tab
  setTimeout(() => {
    try {
      const bundle = scanAllStage11ResponsesFromChat();
      if (bundle.youtube && bundle.youtube.length >= 800) {
        chrome.runtime
          .sendMessage({
            type: 'GEMINI_RESPONSE_READY',
            stageNumber: 111,
            taskType: 'AUTO_RECOVER_STAGE11',
            text: bundle.youtube,
            images: [],
            stage11Bundle: bundle,
          })
          .catch(() => {});
      }
    } catch {}
  }, 350);
})();
