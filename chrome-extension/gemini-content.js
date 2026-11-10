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

  if (window.__HUELLAS_GEMINI_SCRIPT_VERSION__ === 14) return;
  window.__HUELLAS_GEMINI_SCRIPT_VERSION__ = 14;
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

  function getPrecedingUserPromptForResponse(responseEl) {
    if (!responseEl) return '';
    try {
      // 1. Check parent turn container (.conversation-container, .chat-turn, etc.)
      let cur = responseEl;
      for (let depth = 0; depth < 4 && cur; depth++) {
        let prev = cur.previousElementSibling;
        while (prev) {
          if (
            prev.tagName &&
            (prev.tagName.toLowerCase() === 'user-query' ||
              prev.matches?.('[data-message-author-role="user"], .user-query-container'))
          ) {
            return (prev.innerText || prev.textContent || '').trim();
          }
          const nestedUser = prev.querySelector?.(
            'user-query, [data-message-author-role="user"], .query-text, .user-query-text'
          );
          if (nestedUser) {
            return (nestedUser.innerText || nestedUser.textContent || '').trim();
          }
          prev = prev.previousElementSibling;
        }
        const parentUser = cur.parentElement?.querySelector?.(
          'user-query, [data-message-author-role="user"], .query-text, .user-query-text'
        );
        if (parentUser && !responseEl.contains(parentUser)) {
          return (parentUser.innerText || parentUser.textContent || '').trim();
        }
        cur = cur.parentElement;
      }
    } catch {}
    return '';
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
      if (!clean || clean.length < 35) continue;
      if (/^Act[uú]a como (?:estratega|especialista)/i.test(clean)) continue;

      const userPrompt = getPrecedingUserPromptForResponse(el);
      if (userPrompt) {
        if (/5\s+OPCIONES\s+DE\s+T[IÍ]TULOS|director\s+editorial\s+y\s+estratega\s+de\s+alto\s+CTR/i.test(userPrompt)) {
          bundle.titles = clean;
          continue;
        }
        if (/COMENTARIO\s+FIJADO\s+DEL\s+VIDEO/i.test(userPrompt) && clean.length <= 2000) {
          bundle.pinnedComment = clean.replace(/^(?:Comentario\s+Fijado(?:\s+del\s+Video)?\s*:\s*)/i, '').trim();
          continue;
        }
        if (/TAGS\s+SEO\s+DE\s+YOUTUBE/i.test(userPrompt) && clean.length <= 1200) {
          bundle.youtubeTags = clean.replace(/^(?:Tags(?:\s+de\s+YouTube|\s+SEO)?\s*:\s*)/i, '').trim();
          continue;
        }
        if (
          (/METADATA\s+DE\s+PUBLICACI[OÓ]N\s+PARA\s+YOUTUBE/i.test(userPrompt) ||
            /Plataforma:\s*YOUTUBE/i.test(userPrompt)) &&
          clean.length >= 400
        ) {
          bundle.youtube = clean;
          continue;
        }
        if (
          (/METADATA\s+DE\s+PUBLICACI[OÓ]N\s+PARA\s+FACEBOOK/i.test(userPrompt) ||
            /Plataforma:\s*FACEBOOK/i.test(userPrompt)) &&
          clean.length >= 400
        ) {
          bundle.facebook = clean;
          continue;
        }
      }

      const hasChapters =
        /Cap[ií]tulos\s*:/i.test(clean) || (clean.match(/\b\d{2}:\d{2}\s*[-–—:]/g) || []).length >= 3;
      const hashtags = clean.match(/#[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9_]+/g) || [];
      const hasSlogan = /Cada historia deja una huella/i.test(clean);
      const hasAiNote = /inteligencia artificial generativa|incongruencias o errores visuales/i.test(clean);
      const commaParts = clean
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const avgCommaPartLen =
        commaParts.length > 0
          ? commaParts.reduce((acc, p) => acc + p.length, 0) / commaParts.length
          : 999;
      const isCommaTagList =
        commaParts.length >= 8 &&
        avgCommaPartLen <= 38 &&
        !clean.includes('¿') &&
        !clean.includes('?') &&
        clean.length <= 1000;

      if (hasChapters && clean.length >= 500) {
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
      } else if (!hasChapters && !hasSlogan && !hasAiNote && hashtags.length < 3 && isCommaTagList) {
        bundle.youtubeTags = clean.replace(/^(?:Tags(?:\s+de\s+YouTube|\s+SEO)?\s*:\s*)/i, '').trim();
      } else if (
        !hasChapters &&
        !hasSlogan &&
        !hasAiNote &&
        hashtags.length < 3 &&
        clean.length >= 40 &&
        clean.length <= 1800 &&
        !isCommaTagList
      ) {
        bundle.pinnedComment = clean.replace(/^(?:Comentario\s+Fijado(?:\s+del\s+Video)?\s*:\s*)/i, '').trim();
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

    const targetLevel = enableArgonLow ? 'LOW' : 'HIGH';

    const triggerHoverAndClick = (el, alsoClick = true) => {
      if (!el) return;
      try {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
        el.dispatchEvent(new PointerEvent('pointerover', opts));
        el.dispatchEvent(new PointerEvent('pointerenter', opts));
        el.dispatchEvent(new MouseEvent('mouseover', opts));
        el.dispatchEvent(new MouseEvent('mouseenter', opts));
        el.dispatchEvent(new PointerEvent('pointermove', opts));
        el.dispatchEvent(new MouseEvent('mousemove', opts));
        if (alsoClick) {
          el.dispatchEvent(new PointerEvent('pointerdown', opts));
          el.dispatchEvent(new MouseEvent('mousedown', opts));
          el.dispatchEvent(new PointerEvent('pointerup', opts));
          el.dispatchEvent(new MouseEvent('mouseup', opts));
          el.click();
        }
      } catch {
        try {
          if (alsoClick) el.click();
        } catch {}
      }
    };

    const closeAnyOpenOverlayMenus = async () => {
      const backdrops = Array.from(
        document.querySelectorAll('.cdk-overlay-backdrop.cdk-overlay-backdrop-showing')
      );
      if (backdrops.length > 0) {
        backdrops.forEach((b) => {
          try {
            b.click();
          } catch {}
        });
        await sleep(160);
      }
      const openMenus = Array.from(
        document.querySelectorAll('.cdk-overlay-container [role="menu"], .mat-mdc-menu-panel')
      ).filter((el) => el && el.offsetParent !== null);
      if (openMenus.length > 0) {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
        );
        await sleep(160);
      }
    };

    const getVisibleMenuItems = () =>
      Array.from(
        document.querySelectorAll(
          '.cdk-overlay-container [role="menuitem"], .cdk-overlay-container [role="menuitemradio"], .cdk-overlay-container [role="option"], .cdk-overlay-container .mat-mdc-menu-item, .cdk-overlay-container button, [role="menuitem"], [role="option"], [role="menuitemradio"], .mat-mdc-menu-item, button.bard-mode-list-button'
        )
      ).filter((el) => el && el.offsetParent !== null);

    // Find the bottom-right model switcher pill button ("Argon ^" / "3.1 Pro" / "3.8 Flash" / "3.5 Flash-Lite")
    const findModelSwitcherBtn = () => {
      const switcherSelectors = [
        '[data-test-id="bard-mode-menu-button"]',
        'bard-mode-switcher button',
        'button.input-area-switch',
        'button[aria-label*="mode" i]',
        'button[aria-label*="modelo" i]',
        'button[aria-label*="selector" i]',
      ];
      for (const sel of switcherSelectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) return el;
      }
      // Fallback: find the pill button near the prompt bar whose text is "Argon", "4 Argon", "3.1 Pro", "3.8 Flash", "3.5 Flash-Lite"
      const allBtns = Array.from(document.querySelectorAll('button, [role="button"]')).filter(
        (el) => el && el.offsetParent !== null && !el.closest('.cdk-overlay-container')
      );
      return (
        allBtns.find((el) => {
          const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          return /^(?:4\s*)?argon$|^3\.\d+\s*(?:pro|flash(?:-lite)?)$/i.test(t);
        }) || null
      );
    };

    // Find the bottom-left "+" button (left of "Ask Gemini") that opens Upload files / Create image / ... More tools >
    const findPlusToolsMenuBtn = () => {
      const inputEl = findPromptInput();
      const inputRect = inputEl ? inputEl.getBoundingClientRect() : null;
      const allBtns = Array.from(document.querySelectorAll('button, [role="button"]')).filter(
        (el) => el && el.offsetParent !== null && !el.closest('.cdk-overlay-container')
      );

      // 1. Check buttons physically located on the left side of the prompt input bar
      if (inputRect) {
        const leftPromptBtns = allBtns
          .filter((el) => {
            const r = el.getBoundingClientRect();
            const verticallyAligned =
              r.bottom >= inputRect.top - 60 && r.top <= inputRect.bottom + 80;
            const onLeftSide = r.left <= inputRect.left + 90;
            return verticallyAligned && onLeftSide && r.width >= 20 && r.width <= 90;
          })
          .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);

        const plusCandidate =
          leftPromptBtns.find((el) => {
            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
            const tip = (el.getAttribute('mattooltip') || el.getAttribute('title') || '').toLowerCase();
            const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
            return (
              aria.includes('add') ||
              aria.includes('más') ||
              aria.includes('more') ||
              aria.includes('upload') ||
              aria.includes('tools') ||
              aria.includes('herramientas') ||
              aria.includes('open') ||
              tip.includes('add') ||
              txt === '+' ||
              txt === 'add'
            );
          }) || leftPromptBtns[0];

        if (plusCandidate) return plusCandidate;
      }

      // 2. Fallback by aria-label / icon name
      return (
        allBtns.find((el) => {
          const aria = (el.getAttribute('aria-label') || '').toLowerCase();
          return (
            aria.includes('add files') ||
            aria.includes('upload') ||
            aria.includes('more tools') ||
            aria.includes('add to prompt')
          );
        }) || null
      );
    };

    // STEP A: Select "4 Argon" AND open "Thinking level >" sub-menu to pick "Low" or "High" (Photo 1)
    const ensureArgon4AndThinkingLevel = async () => {
      await closeAnyOpenOverlayMenus();

      const switcherBtn = findModelSwitcherBtn();
      if (!switcherBtn) return;

      const currentLabel = (switcherBtn.innerText || switcherBtn.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      const isCurrentlyArgon = /\bargon\b/i.test(currentLabel) && !/\bpro\b/i.test(currentLabel);

      // 1. Open the model switcher menu ("Argon ^")
      triggerHoverAndClick(switcherBtn, true);
      await sleep(340);

      let menuItems = getVisibleMenuItems();

      // 2. If not currently on "4 Argon", click "4 Argon" ("Complex tasks") first
      if (!isCurrentlyArgon) {
        const argon4Item =
          menuItems.find((el) => {
            const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            return /\b4\s*argon\b/i.test(txt) || (/argon/i.test(txt) && /complex\s*tasks/i.test(txt));
          }) ||
          menuItems.find((el) => {
            const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            return /\bargon\b/i.test(txt) && !/thinking\s*level/i.test(txt);
          });

        if (argon4Item) {
          triggerHoverAndClick(argon4Item, true);
          await sleep(340);
        }

        // Re-check if clicking "4 Argon" closed the menu; if so, re-open "Argon ^" so we can access "Thinking level >"
        menuItems = getVisibleMenuItems();
        const hasThinkingLevelVisible = menuItems.some((el) =>
          /thinking\s*level|nivel\s*de\s*pensamiento/i.test(
            (el.innerText || el.textContent || '').replace(/\s+/g, ' ')
          )
        );
        if (!hasThinkingLevelVisible) {
          const freshSwitcherBtn = findModelSwitcherBtn() || switcherBtn;
          triggerHoverAndClick(freshSwitcherBtn, true);
          await sleep(340);
          menuItems = getVisibleMenuItems();
        }
      }

      // 3. Find "Thinking level >" inside the open Argon menu and hover + click it to open the sub-menu (Low / Medium / High)
      const thinkingLevelMenuItem = menuItems.find((el) => {
        const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        return /thinking\s*level|nivel\s*de\s*pensamiento/i.test(txt);
      });

      if (thinkingLevelMenuItem) {
        // First hover over "Thinking level >" (Angular Material sub-menus open on mouseenter/pointerenter or click)
        triggerHoverAndClick(thinkingLevelMenuItem, false);
        await sleep(220);

        let subMenuItems = getVisibleMenuItems();
        let hasLowHighSubMenu = subMenuItems.some((el) =>
          /quick\s+and\s+efficient|extra\s+thorough|balanced\s+depth|^\s*(?:low|medium|high)\b/i.test(
            (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
          )
        );

        if (!hasLowHighSubMenu) {
          triggerHoverAndClick(thinkingLevelMenuItem, true);
          await sleep(300);
          subMenuItems = getVisibleMenuItems();
        }

        const targetLevelOption =
          targetLevel === 'HIGH'
            ? subMenuItems.find((el) => {
                const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                return (
                  (/\bhigh\b/i.test(txt) && /extra\s+thorough/i.test(txt)) ||
                  /^(?:✓\s*)?(?:high|alto)(?:\s+extra\s+thorough)?$/i.test(txt)
                );
              }) ||
              subMenuItems.find((el) => {
                const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                return (
                  /\b(high|alto|extra\s+thorough)\b/i.test(txt) &&
                  !/thinking\s*level|low|medium|pro|flash|argon/i.test(txt)
                );
              })
            : subMenuItems.find((el) => {
                const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                return (
                  (/\blow\b/i.test(txt) && /quick\s+and\s+efficient/i.test(txt)) ||
                  /^(?:✓\s*)?(?:low|bajo)(?:\s+quick\s+and\s+efficient)?$/i.test(txt)
                );
              }) ||
              subMenuItems.find((el) => {
                const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                return (
                  /\b(low|bajo|quick\s+and\s+efficient)\b/i.test(txt) &&
                  !/thinking\s*level|high|medium|pro|flash|argon/i.test(txt)
                );
              });

        if (targetLevelOption) {
          triggerHoverAndClick(targetLevelOption, true);
          await sleep(280);
        }
      }

      await closeAnyOpenOverlayMenus();
    };

    // STEP B: Activate or Deactivate "Deep research" via "+" button -> "... More tools >" -> "Deep research" (Photo 2)
    const ensureDeepResearchToggle = async () => {
      await closeAnyOpenOverlayMenus();

      // Check if Deep research is already active as a chip/button in the prompt input bar (outside overlay menus)
      const nonOverlayCandidates = Array.from(
        document.querySelectorAll(
          'mat-chip, mat-chip-option, button, [role="button"], [role="checkbox"], [role="switch"], .tool-chip'
        )
      ).filter((el) => el && el.offsetParent !== null && !el.closest('.cdk-overlay-container'));

      const activeDeepResearchChip = nonOverlayCandidates.find((el) => {
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        const a = (el.getAttribute('aria-label') || '').trim();
        const matchesName =
          /^(?:deep\s*research|investigaci[oó]n\s+profunda)/i.test(t) ||
          /\b(deep\s*research|investigaci[oó]n\s+profunda)\b/i.test(a);
        if (!matchesName) return false;
        // If it's a chip in the input area or explicitly pressed/selected
        const isChipOrSelected =
          el.tagName.toLowerCase().includes('chip') ||
          el.getAttribute('aria-pressed') === 'true' ||
          el.getAttribute('aria-checked') === 'true' ||
          el.classList.contains('selected') ||
          el.classList.contains('active') ||
          el.classList.contains('mdc-evolution-chip--selected') ||
          el.classList.contains('mat-mdc-chip-selected') ||
          Boolean(el.querySelector('[aria-label*="remove" i], [aria-label*="close" i], mat-icon'));
        return isChipOrSelected;
      });

      if (!enableDeepResearch) {
        // Turn OFF Deep research if it is currently active in the prompt bar
        if (activeDeepResearchChip) {
          const removeBtn = activeDeepResearchChip.querySelector(
            'button, [aria-label*="remove" i], [aria-label*="close" i], [aria-label*="quitar" i], [aria-label*="eliminar" i], [matChipRemove]'
          );
          triggerHoverAndClick(removeBtn || activeDeepResearchChip, true);
          await sleep(260);
        }
        return;
      }

      // enableDeepResearch === true:
      if (activeDeepResearchChip) {
        // A button named "Deep research" exists, but it may be the start-screen SUGGESTION (not active):
        // never claim success from this loose check.
        return false;
      }

      // Open "+" menu on the left of "Ask Gemini" (Photo 2)
      const plusBtn = findPlusToolsMenuBtn();
      if (plusBtn) {
        triggerHoverAndClick(plusBtn, true);
        await sleep(340);

        let menuItems = getVisibleMenuItems();

        // Check if "Deep research" is already directly visible in the first menu
        let deepResearchItem = menuItems.find((el) => {
          const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          return /\b(deep\s*research|investigaci[oó]n\s+profunda)\b/i.test(txt);
        });

        if (!deepResearchItem) {
          // Find "... More tools >" ("Más herramientas") and hover + click it to open the sub-menu (Canvas / Deep research / Guided Learning)
          const moreToolsItem = menuItems.find((el) => {
            const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            return /\b(more\s+tools|m[aá]s\s+herramientas)\b/i.test(txt);
          });

          if (moreToolsItem) {
            triggerHoverAndClick(moreToolsItem, false);
            await sleep(240);
            menuItems = getVisibleMenuItems();
            deepResearchItem = menuItems.find((el) => {
              const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
              return /\b(deep\s*research|investigaci[oó]n\s+profunda)\b/i.test(txt);
            });

            if (!deepResearchItem) {
              triggerHoverAndClick(moreToolsItem, true);
              await sleep(320);
              menuItems = getVisibleMenuItems();
              deepResearchItem = menuItems.find((el) => {
                const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                return /\b(deep\s*research|investigaci[oó]n\s+profunda)\b/i.test(txt);
              });
            }
          }
        }

        if (deepResearchItem) {
          triggerHoverAndClick(deepResearchItem, true);
          await sleep(320);
          return true;
        } else {
          await closeAnyOpenOverlayMenus();
        }
      }
      return false;
    };

    const result = { thinkingOk: false, deepResearchOk: !enableDeepResearch, diag: [] };
    try {
      // Primary: CDP hardware mouse sequence (one trusted click per target) + DOM verification in background.js
      let hwConfig = null;
      try {
        hwConfig = await chrome.runtime.sendMessage({
          type: 'GEMINI_HARDWARE_CONFIGURE_MODEL_AND_TOOLS',
          enableHighModel: Boolean(enableHighModel),
          enableDeepResearch: Boolean(enableDeepResearch),
          enableArgonLow: Boolean(enableArgonLow),
        });
      } catch {}
      if (hwConfig) {
        result.thinkingOk = Boolean(hwConfig.thinkingOk);
        result.deepResearchOk = Boolean(hwConfig.deepResearchOk);
        result.diag = Array.isArray(hwConfig.diag) ? hwConfig.diag : [];
        result.debuggerAttached = Boolean(hwConfig.debuggerAttached);
        try {
          console.log('[Huellas] Configuración Gemini (hardware):', hwConfig);
        } catch {}
      }

      // Fallbacks ONLY when the hardware step could not complete (model first, then tool)
      if (!result.thinkingOk) {
        try {
          await ensureArgon4AndThinkingLevel();
          result.thinkingOk = true;
          result.diag.push('Thinking: aplicado vía fallback DOM');
        } catch {}
      }
      if (!result.deepResearchOk && enableDeepResearch && !hwConfig) {
        // Only when the background hardware step was unreachable (its own 3 routes + strict verification already ran otherwise)
        try {
          const ok = await ensureDeepResearchToggle();
          if (ok) {
            result.deepResearchOk = true;
            result.diag.push('Deep Research: aplicado vía fallback DOM');
          }
        } catch {}
      }
    } catch {}
    return result;
  }

  function watchForNewResponse(initialCount, initialLastText, meta) {
    if (activeWatchTimer) clearInterval(activeWatchTimer);
    if (meta && meta.enableDeepResearch) {
      watchDeepResearchOrder(initialCount, initialLastText, meta);
      return;
    }

    let elapsedMs = 0;
    let stableTicks = 0;
    let lastObservedText = '';
    let hasStarted = false;
    let hasClickedStartResearchPlan = false;
    let planClickedAtMs = 0;
    let textAtPlanClick = '';
    const isDeepResearch = Boolean(meta && meta.enableDeepResearch);
    const initialUserQueries = Number(meta && meta.initialUserQueries) || 0;
    const promptFingerprint = String((meta && meta.promptFingerprint) || '').trim();
    const maxTimeoutMs = isDeepResearch ? 1200000 : 180000; // 20 min for Deep Research, 3 min normal

    reportStatus(
      'GENERATING',
      isDeepResearch
        ? '🔬 Gemini Web (Argon 4 · Thinking: High + Deep Research) preparando el Plan de Investigación...'
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
          if (meta && meta.targetChatTitle) {
            setTimeout(() => {
              renameGeminiConversationInDom(meta.targetChatTitle, window.location.href, meta.docId, {
                isDeepResearch: true,
                isActiveTabChat: true,
              });
            }, 1800);
          }
          return;
        }
      }

      const responses = getModelResponseElements();
      const currentCount = responses.length;
      const latest = extractLatestGeminiResponse();
      const stillStreaming = isGeminiStillGenerating() || (isDeepResearch && isDeepResearchActivelyBrowsing());

      const userQueryNodes = Array.from(
        document.querySelectorAll('user-query, [data-message-author-role="user"]')
      );
      const currentUserQueryCount = userQueryNodes.length;
      const lastUserQueryText =
        currentUserQueryCount > 0
          ? normalizeCompareText(
              (
                userQueryNodes[currentUserQueryCount - 1].innerText ||
                userQueryNodes[currentUserQueryCount - 1].textContent ||
                ''
              ).slice(0, 300)
            )
          : '';
      const hasSubmittedNewUserTurn =
        currentUserQueryCount > initialUserQueries ||
        Boolean(
          promptFingerprint &&
            lastUserQueryText &&
            lastUserQueryText.includes(promptFingerprint.slice(0, 40))
        );

      const isNewTurnResponse =
        (hasSubmittedNewUserTurn || stillStreaming || hasStarted) &&
        (currentCount > initialCount || Boolean(latest.text && latest.text !== initialLastText));

      if (stillStreaming || (hasSubmittedNewUserTurn && isNewTurnResponse)) {
        hasStarted = true;
      }

      if (hasStarted && isNewTurnResponse && (latest.text || latest.images.length > 0)) {
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
                : stageNum === 113 && stage11Bundle?.pinnedComment
                ? stage11Bundle.pinnedComment
                : stageNum === 114 && stage11Bundle?.youtubeTags
                ? stage11Bundle.youtubeTags
                : finalLatest.text || latest.text;

            isBusyWithOrder = false;
            chrome.runtime
              .sendMessage({
                type: 'GEMINI_RESPONSE_READY',
                stageNumber: meta.stageNumber,
                docId: (meta && meta.docId) || '',
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
            if (isDeepResearch && !hasClickedStartResearchPlan) {
              setTimeout(() => {
                reportStatus(
                  'ERROR',
                  '⚠️ Atención: se pidió Deep Research pero Gemini respondió SIN mostrar el plan de investigación ("Start research"). Probablemente Deep Research no quedó activo en este chat; revisa la pestaña de Gemini.',
                  meta
                );
              }, 400);
            }
            if (meta && meta.targetChatTitle) {
              const docTitleNow = (document.title || '').replace(/\s*-\s*Google Gemini\s*$/i, '').trim();
              if (normalizeCompareText(docTitleNow) !== normalizeCompareText(meta.targetChatTitle)) {
                linkAndRenameAfterSubmit(
                  {
                    ...(meta.chatState || {}),
                    targetChatTitle: meta.targetChatTitle,
                    isDeepResearchOrder: Boolean(meta.enableDeepResearch),
                    isNewChat: false,
                  },
                  meta.docId || ''
                ).finally(() => {
                  processNextQueuedPrompt();
                });
                return;
              }
            }
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
              docId: (meta && meta.docId) || '',
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

  // ==========================================================================
  // NOTEBOOK "HUELLAS DE LA HUMANIDAD" + 1-CHAT-PER-VIDEO (+ SEPARATE _Deep Research CHAT) DETECTOR & RENAMER
  // ==========================================================================
  const DOC_CHATS_STORAGE_KEY = 'huellas_gemini_doc_chats_v2';

  function loadStoredDocChatMap() {
    try {
      const raw = localStorage.getItem(DOC_CHATS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {}
    return window.__HUELLAS_DOC_CHAT_MAP__ || {};
  }

  function saveStoredDocChatEntry(docKey, partialEntry) {
    if (!docKey) return;
    try {
      const map = loadStoredDocChatMap();
      map[docKey] = {
        ...(map[docKey] || {}),
        ...partialEntry,
        updatedAt: Date.now(),
      };
      window.__HUELLAS_DOC_CHAT_MAP__ = map;
      localStorage.setItem(DOC_CHATS_STORAGE_KEY, JSON.stringify(map));
    } catch {}
  }

  function getStoredDocChatEntry(docKey, baseVideoName) {
    const map = loadStoredDocChatMap();
    if (docKey && map[docKey]) return map[docKey];
    const normBase = normalizeCompareText(baseVideoName);
    if (normBase && map[normBase]) return map[normBase];
    const vNum = extractVideoNumberToken(baseVideoName);
    if (vNum) {
      for (const k of Object.keys(map)) {
        const entry = map[k];
        if (
          entry &&
          (extractVideoNumberToken(entry.baseVideoName || '') === vNum ||
            extractVideoNumberToken(entry.mainChatTitle || '') === vNum)
        ) {
          return entry;
        }
      }
    }
    return {};
  }

  function normalizeCompareText(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function stripDeepResearchSuffix(str) {
    return String(str || '')
      .replace(/[\s_-]*deep\s*research\s*$/i, '')
      .trim();
  }

  function hasDeepResearchSuffix(str) {
    return /(?:^|[\s_-])deep\s*research\b/i.test(String(str || '').trim());
  }

  function extractVideoNumberToken(str) {
    const m = String(str || '').match(/\bvideo\s*0*(\d+)\b/i);
    return m ? m[1] : '';
  }

  function extractChatIdFromUrl(urlStr) {
    const cleanUrl = String(urlStr || '').split('?')[0].split('#')[0].replace(/\/+$/, '');
    // Match /gem/<gemId>/<chatId>
    const gemChatMatch = cleanUrl.match(/\/gem\/[^/]+\/([a-zA-Z0-9_-]{6,})$/i);
    if (gemChatMatch) return gemChatMatch[1];
    // Match /app/<chatId> (including /u/0/app/<chatId>)
    const appChatMatch = cleanUrl.match(/\/app\/([a-zA-Z0-9_-]{6,})$/i);
    if (appChatMatch) return appChatMatch[1];
    return '';
  }

  function doesTitleMatchTargetVideo(candidateTitle, targetBaseVideoName, wantDeepResearch = false) {
    const rawCand = String(candidateTitle || '').trim();
    const rawTargetBase = stripDeepResearchSuffix(targetBaseVideoName);
    if (!rawCand || !rawTargetBase) return false;

    // Never mix the Main Chat ("[Nombre]") with the Deep Research chat ("[Nombre]_Deep Research")
    const candIsDeep = hasDeepResearchSuffix(rawCand);
    if (Boolean(wantDeepResearch) !== candIsDeep) {
      return false;
    }

    const normCandBase = normalizeCompareText(stripDeepResearchSuffix(rawCand));
    const normTargetBase = normalizeCompareText(rawTargetBase);
    if (!normCandBase || !normTargetBase) return false;

    const candNum = extractVideoNumberToken(rawCand);
    const targetNum = extractVideoNumberToken(rawTargetBase);

    // If the target video has a video number (e.g. "77"), NEVER match a chat with a different number or a generic title without that number
    if (targetNum) {
      if (candNum && candNum === targetNum) {
        return true;
      }
      if (candNum && candNum !== targetNum) {
        return false;
      }
      return normCandBase === normTargetBase;
    }

    if (normCandBase === normTargetBase) {
      return true;
    }
    if (
      normCandBase.length >= 12 &&
      normTargetBase.length >= 12 &&
      (normCandBase.includes(normTargetBase) || normTargetBase.includes(normCandBase))
    ) {
      return true;
    }
    return false;
  }

  async function ensureGeminiSidebarOpen() {
    const sideCandidates = document.querySelectorAll(
      '[data-test-id="conversation"], .conversation-items-container, .conversations-container, bard-sidenav a[href*="/app/"], bard-sidenav a[href*="/gem/"]'
    );
    const hasVisibleSidebar = Array.from(sideCandidates).some((el) => isElementVisibleInDom(el));
    if (hasVisibleSidebar) return;

    const menuBtns = document.querySelectorAll(
      'button[data-test-id="side-nav-menu-button"], button[aria-label*="Main menu" i], button[aria-label*="Menú principal" i], button[aria-label*="Expand menu" i], button[aria-label*="Menu" i], button[aria-label*="Menú" i]'
    );
    for (const btn of menuBtns) {
      if (isElementVisibleInDom(btn)) {
        btn.click();
        await sleep(380);
        break;
      }
    }
  }

  function getActiveGeminiChatTitleInDom() {
    const headerSelectors = [
      '[data-test-id="conversation-title"]',
      '.conversation-title',
      'conversation-title',
      '[data-test-id="conversation"].selected .conversation-title',
      '[data-test-id="conversation"].selected',
      '.conversation-items-container.selected .conversation-title',
      '.conversation.selected .conversation-title',
      '[aria-selected="true"] .conversation-title',
      'a[aria-current="page"] .conversation-title',
    ];
    for (const sel of headerSelectors) {
      const el = document.querySelector(sel);
      if (el && isElementVisibleInDom(el)) {
        const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (
          txt &&
          !/^google gemini$/i.test(txt) &&
          !/^gemini$/i.test(txt) &&
          !/^huellas de la humanidad$/i.test(txt)
        ) {
          return txt;
        }
      }
    }
    const docTitle = (document.title || '').replace(/\s*-\s*Google Gemini$/i, '').trim();
    if (
      docTitle &&
      !/^gemini$/i.test(docTitle) &&
      !/^google gemini$/i.test(docTitle) &&
      !/^huellas de la humanidad$/i.test(docTitle)
    ) {
      return docTitle;
    }
    return '';
  }

  function getAllSidebarConversationItems() {
    return Array.from(
      document.querySelectorAll(
        '[data-test-id="conversation"], .conversation-items-container, a[href*="/app/"], a[href*="/gem/"], .conversations-container [role="button"], .conversations-container [role="listitem"], .chat-history-list [role="button"]'
      )
    ).filter((el) => {
      if (!el) return false;
      const href = el.getAttribute('href') || '';
      if (href === '/app' || href === '/u/0/app') return false;
      return true;
    });
  }

  function findChatElementInSidebar(
    targetBaseVideoName,
    targetChatUrl,
    wantDeepResearch = false,
    excludeChatId = ''
  ) {
    const targetChatId = extractChatIdFromUrl(targetChatUrl);
    const allItems = getAllSidebarConversationItems();

    if (targetChatId && targetChatId !== excludeChatId) {
      for (const item of allItems) {
        const href =
          item.getAttribute('href') || item.querySelector?.('a')?.getAttribute('href') || '';
        const jslog = item.getAttribute('jslog') || '';
        if (href.includes(targetChatId) || jslog.includes(targetChatId)) {
          return item;
        }
      }
    }

    if (targetBaseVideoName) {
      for (const item of allItems) {
        const href =
          item.getAttribute('href') || item.querySelector?.('a')?.getAttribute('href') || '';
        const jslog = item.getAttribute('jslog') || '';
        if (excludeChatId && (href.includes(excludeChatId) || jslog.includes(excludeChatId))) {
          continue;
        }
        const titleEl = item.querySelector?.('.conversation-title') || item;
        const txt = (titleEl.innerText || titleEl.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt && doesTitleMatchTargetVideo(txt, targetBaseVideoName, wantDeepResearch)) {
          return item;
        }
      }
    }
    return null;
  }

  function findActiveOrFirstSidebarConversationItem(targetChatUrl) {
    const targetChatId =
      extractChatIdFromUrl(targetChatUrl) || extractChatIdFromUrl(window.location.href);
    const allItems = getAllSidebarConversationItems();

    // 1. Match by exact chat ID in href or jslog
    if (targetChatId) {
      for (const item of allItems) {
        const href =
          item.getAttribute('href') || item.querySelector?.('a')?.getAttribute('href') || '';
        const jslog = item.getAttribute('jslog') || '';
        if (href.includes(targetChatId) || jslog.includes(targetChatId)) {
          return item;
        }
      }
    }

    // 2. Match ONLY the explicitly selected / activated item in sidebar (NEVER fall back to convItems[0] which could be an unrelated chat!)
    const selectedSelectors = [
      '[data-test-id="conversation"].selected',
      '.conversation-items-container.selected',
      '.conversation.selected',
      '[data-test-id="conversation"][aria-selected="true"]',
      'a[aria-current="page"][href*="/app/"]',
      'a[aria-current="page"][href*="/gem/"]',
      '.mdc-list-item--activated',
    ];
    for (const sel of selectedSelectors) {
      const el = document.querySelector(sel);
      if (el && isElementVisibleInDom(el)) return el;
    }

    return null;
  }

  async function renameGeminiConversationInDom(newTitle, targetChatUrl, docId, options = {}) {
    const cleanNewTitle = String(newTitle || '').trim();
    if (!cleanNewTitle) return false;
    // SAFETY (MODO TRIO consensus): only rename the CURRENT chat when its URL is /gem/<notebookGemId>/<expectedChatId>.
    // Any call without strict notebook ids is refused, so a chat outside "Huellas de la Humanidad" can never be renamed.
    const strictGemId = String(options.strictGemId || '');
    const strictChatId = String(options.strictChatId || '');
    const isStillOnExpectedChat = () => {
      const p = parseGemUrl(window.location.href);
      return Boolean(strictGemId && p.gemId === strictGemId && p.chatId && (!strictChatId || p.chatId === strictChatId));
    };
    if (!isStillOnExpectedChat()) return false;
    targetChatUrl = window.location.href;
    const isDeepResearch =
      Boolean(options.isDeepResearch) || hasDeepResearchSuffix(cleanNewTitle);
    const baseVideoName = stripDeepResearchSuffix(cleanNewTitle);
    const docKey = docId || normalizeCompareText(baseVideoName);

    const fireMouseClick = (el) => {
      if (!el) return;
      try {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window };
        el.dispatchEvent(new PointerEvent('pointerover', opts));
        el.dispatchEvent(new PointerEvent('pointerenter', opts));
        el.dispatchEvent(new MouseEvent('mouseover', opts));
        el.dispatchEvent(new MouseEvent('mouseenter', opts));
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.click();
      } catch {
        try {
          el.click();
        } catch {}
      }
    };

    try {
      await ensureGeminiSidebarOpen();

      const currentTitle = getActiveGeminiChatTitleInDom();
      if (currentTitle && normalizeCompareText(currentTitle) === normalizeCompareText(cleanNewTitle)) {
        const currentChatId = extractChatIdFromUrl(window.location.href);
        if (docKey && currentChatId) {
          saveStoredDocChatEntry(
            docKey,
            isDeepResearch
              ? {
                  baseVideoName,
                  deepResearchChatId: currentChatId,
                  deepResearchChatUrl: window.location.href,
                  deepResearchChatTitle: cleanNewTitle,
                }
              : {
                  baseVideoName,
                  mainChatId: currentChatId,
                  mainChatUrl: window.location.href,
                  mainChatTitle: cleanNewTitle,
                }
          );
        }
        chrome.runtime
          .sendMessage({
            type: 'GEMINI_CHAT_LINKED',
            docId,
            geminiChatUrl: window.location.href,
            geminiChatTitle: cleanNewTitle,
            isDeepResearch,
          })
          .catch(() => {});
        return true;
      }

      // Locate target conversation row in sidebar ONLY by the exact current chat id (never by title or "selected" heuristics).
      // If not found, the header "conversation actions" menu of the current chat is used (step 1B).
      let sidebarItem = findChatElementInSidebar('', targetChatUrl, isDeepResearch);

      const findRenameMenuItemInOverlay = () => {
        const menuItems = Array.from(
          document.querySelectorAll(
            '.cdk-overlay-container button[data-test-id="rename-button"], .cdk-overlay-container [data-test-id="rename-button"], .cdk-overlay-container [role="menuitem"], .cdk-overlay-container .mat-mdc-menu-item, button[data-test-id="rename-button"], [role="menuitem"], .mat-mdc-menu-item'
          )
        ).filter((el) => el && el.offsetParent !== null);

        return (
          menuItems.find((item) => {
            const txt = (item.innerText || item.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            const aria = (item.getAttribute('aria-label') || '').toLowerCase();
            const testId = (item.getAttribute('data-test-id') || '').toLowerCase();
            const hasEditIcon = Boolean(
              item.querySelector(
                'mat-icon[fonticon="edit"], mat-icon[data-mat-icon-name="edit"], mat-icon[fonticon="drive_file_rename_outline"], mat-icon[data-mat-icon-name="drive_file_rename_outline"]'
              ) || /\b(edit|drive_file_rename_outline)\b/.test(txt)
            );
            return (
              testId.includes('rename') ||
              /\b(rename|cambiar\s+nombre|cambiar\s+el\s+nombre|renombrar|editar\s+nombre)\b/i.test(txt) ||
              /\b(rename|cambiar\s+nombre|renombrar)\b/i.test(aria) ||
              hasEditIcon
            );
          }) || null
        );
      };

      let renameOptionEl = null;

      // 1A. Try opening the sidebar conversation row's 3-dots action menu (actions-menu-button / more_vert)
      if (sidebarItem) {
        const rowContainer =
          sidebarItem.closest(
            '.conversation-items-container, [role="listitem"], mat-list-item, .conversation, .conversation-item'
          ) ||
          sidebarItem.parentElement ||
          sidebarItem;

        for (const hoverTarget of [rowContainer, sidebarItem]) {
          if (!hoverTarget) continue;
          try {
            hoverTarget.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
            hoverTarget.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
            hoverTarget.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            hoverTarget.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          } catch {}
        }
        await sleep(180);

        const searchRoots = [rowContainer, rowContainer.parentElement, sidebarItem].filter(Boolean);
        let threeDotsBtn = null;
        for (const root of searchRoots) {
          threeDotsBtn =
            root.querySelector(
              'button[data-test-id="actions-menu-button"], [data-test-id="actions-menu-button"], button.conversation-actions-menu-button, button[aria-label*="More options" i], button[aria-label*="Más opciones" i], button[aria-label*="More" i], button[aria-label*="Más" i], button[aria-label*="Opciones" i], button[mattooltip*="More" i], button[mattooltip*="Más" i]'
            ) ||
            Array.from(root.querySelectorAll('button, [role="button"]')).find((b) => {
              const iconTxt = (b.innerText || b.textContent || '').trim().toLowerCase();
              return (
                Boolean(
                  b.querySelector(
                    'mat-icon[fonticon*="more" i], mat-icon[data-mat-icon-name*="more" i]'
                  )
                ) ||
                iconTxt === 'more_vert' ||
                iconTxt === 'more_horiz'
              );
            });
          if (threeDotsBtn) break;
        }

        if (threeDotsBtn) {
          // Force visible in case CSS hides the 3-dots button until OS hover
          try {
            threeDotsBtn.style.opacity = '1';
            threeDotsBtn.style.visibility = 'visible';
            threeDotsBtn.style.pointerEvents = 'auto';
          } catch {}
          fireMouseClick(threeDotsBtn);
          await sleep(340);
          renameOptionEl = findRenameMenuItemInOverlay();
        }
      }

      // 1B. Fallback: Try top conversation title / actions button in header
      if (!renameOptionEl) {
        const topTitleBtn = document.querySelector(
          'button[data-test-id="conversation-title"], [data-test-id="conversation-title"] button, [data-test-id="conversation-title"][role="button"], .conversation-title-container button, [data-test-id="conversation-actions-button"], button[aria-label*="Conversation actions" i], button[aria-label*="Acciones de la conversación" i]'
        );
        if (topTitleBtn && topTitleBtn.offsetParent !== null) {
          fireMouseClick(topTitleBtn);
          await sleep(340);
          renameOptionEl = findRenameMenuItemInOverlay();
        }
      }

      if (!renameOptionEl) return false;
      if (!isStillOnExpectedChat()) {
        await closeOverlayMenusQuick();
        return false;
      }

      // 2. Click "Rename" / "Cambiar nombre" option
      fireMouseClick(renameOptionEl);
      await sleep(360);
      if (!isStillOnExpectedChat()) return false;

      // 3. Also delegate input filling + confirm click to MAIN world (Angular Zone.js) AND execute in content script
      chrome.runtime
        .sendMessage({
          type: 'GEMINI_MAIN_WORLD_COMPLETE_RENAME',
          newTitle: cleanNewTitle,
        })
        .catch(() => {});

      const activeEl = document.activeElement;
      const isActiveRenameField =
        activeEl &&
        (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') &&
        !activeEl.closest('rich-textarea');

      // Only inputs inside the rename dialog or inside the exact sidebar row (never a generic page input)
      const inputCandidates = Array.from(
        document.querySelectorAll(
          'input[data-test-id="rename-input"], .mat-mdc-dialog-container input, mat-dialog-container input, [role="dialog"] input, .conversation-title-container input'
        )
      )
        .concat(sidebarItem ? Array.from((sidebarItem.closest('.conversation-items-container, [role="listitem"], mat-list-item') || sidebarItem).querySelectorAll('input')) : [])
        .filter((el) => el && el.offsetParent !== null && !el.closest('rich-textarea'));

      const renameInput = isActiveRenameField ? activeEl : inputCandidates[0];
      if (!renameInput) return false;

      renameInput.focus();
      if (typeof renameInput.select === 'function') {
        try {
          renameInput.select();
        } catch {}
      }
      try {
        document.execCommand('selectAll', false);
        document.execCommand('insertText', false, cleanNewTitle);
      } catch {}

      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(renameInput, cleanNewTitle);
      } else {
        renameInput.value = cleanNewTitle;
      }
      renameInput.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType: 'insertText',
          data: cleanNewTitle,
        })
      );
      renameInput.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(240);
      if (!isStillOnExpectedChat()) return false;

      // 4. Click Save/Rename button in dialog or press Enter
      const saveBtns = Array.from(
        document.querySelectorAll(
          'button[data-test-id="confirm-button"], button[data-test-id="save-button"], .mat-mdc-dialog-actions button, mat-dialog-actions button, .mat-mdc-dialog-container button, mat-dialog-container button, [role="dialog"] button'
        )
      ).filter((b) => b && b.offsetParent !== null);

      const confirmBtn =
        saveBtns.find((btn) => {
          const bTxt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
          const testId = (btn.getAttribute('data-test-id') || '').toLowerCase();
          if (/cancel|cancelar|close|cerrar/i.test(bTxt)) return false;
          return (
            testId.includes('confirm') ||
            testId.includes('save') ||
            /\b(rename|cambiar|renombrar|guardar|save|aceptar|ok|confirm)\b/i.test(bTxt)
          );
        }) ||
        saveBtns.find((btn) => {
          const bTxt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
          return bTxt && !/cancel|cancelar|close|cerrar/i.test(bTxt);
        });

      if (confirmBtn) {
        try {
          confirmBtn.disabled = false;
          confirmBtn.removeAttribute('disabled');
        } catch {}
        fireMouseClick(confirmBtn);
      } else {
        renameInput.dispatchEvent(
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

      await sleep(400);

      const resolvedChatId =
        extractChatIdFromUrl(targetChatUrl) || extractChatIdFromUrl(window.location.href);
      const resolvedUrl = targetChatUrl || window.location.href;
      if (docKey && resolvedChatId) {
        saveStoredDocChatEntry(
          docKey,
          isDeepResearch
            ? {
                baseVideoName,
                deepResearchChatId: resolvedChatId,
                deepResearchChatUrl: resolvedUrl,
                deepResearchChatTitle: cleanNewTitle,
              }
            : {
                baseVideoName,
                mainChatId: resolvedChatId,
                mainChatUrl: resolvedUrl,
                mainChatTitle: cleanNewTitle,
              }
        );
      }

      chrome.runtime
        .sendMessage({
          type: 'GEMINI_CHAT_LINKED',
          docId,
          geminiChatUrl: resolvedUrl,
          geminiChatTitle: cleanNewTitle,
          isDeepResearch,
        })
        .catch(() => {});
      reportStatus(
        'COMPLETED',
        `✏️ Conversación de Gemini renombrada a "${cleanNewTitle}".`,
        { docId }
      );
      return true;
    } catch {
      return false;
    }
  }

  // LEGACY (unused): replaced by linkAndRenameAfterSubmit (single, notebook-scoped rename)
  function legacyScheduleNewChatLinkAndRename(targetChatTitle, docId, isDeepResearchOrder) {
    const cleanTargetTitle = String(targetChatTitle || '').trim();
    const baseVideoName = stripDeepResearchSuffix(cleanTargetTitle);
    const docKey = docId || normalizeCompareText(baseVideoName);
    const ownerToken = `${docKey}::${isDeepResearchOrder ? 'DEEP' : 'MAIN'}`;
    window.__HUELLAS_CURRENT_TAB_CHAT_OWNER__ = ownerToken;

    let attempts = 0;
    let hasLinkedUrl = false;
    let hasRenamedSuccessfully = false;

    const timer = setInterval(async () => {
      attempts++;
      if (attempts > 24 || hasRenamedSuccessfully) {
        clearInterval(timer);
        return;
      }

      const currentChatId = extractChatIdFromUrl(window.location.href);
      const hasResponses =
        getModelResponseElements().length > 0 ||
        document.querySelectorAll('user-query, [data-message-author-role="user"]').length > 0;

      if (!currentChatId && !hasResponses) return;

      if (currentChatId && !hasLinkedUrl) {
        hasLinkedUrl = true;
        if (docKey) {
          saveStoredDocChatEntry(
            docKey,
            isDeepResearchOrder
              ? {
                  baseVideoName,
                  deepResearchChatId: currentChatId,
                  deepResearchChatUrl: window.location.href,
                  deepResearchChatTitle: cleanTargetTitle,
                }
              : {
                  baseVideoName,
                  mainChatId: currentChatId,
                  mainChatUrl: window.location.href,
                  mainChatTitle: cleanTargetTitle,
                }
          );
        }
        chrome.runtime
          .sendMessage({
            type: 'GEMINI_CHAT_LINKED',
            docId,
            geminiChatUrl: window.location.href,
            geminiChatTitle: cleanTargetTitle || getActiveGeminiChatTitleInDom(),
            isDeepResearch: isDeepResearchOrder,
          })
          .catch(() => {});
      }

      // Wait at least ~4.5s after submission so Gemini's initial auto-title is created in the sidebar before we rename it
      if (attempts >= 4 && cleanTargetTitle && !hasRenamedSuccessfully) {
        const currentDomTitle = getActiveGeminiChatTitleInDom();
        if (
          currentDomTitle &&
          normalizeCompareText(currentDomTitle) === normalizeCompareText(cleanTargetTitle)
        ) {
          hasRenamedSuccessfully = true;
          clearInterval(timer);
          return;
        }
        const ok = await renameGeminiConversationInDom(
          cleanTargetTitle,
          window.location.href,
          docId,
          {
            isDeepResearch: isDeepResearchOrder,
            isActiveTabChat: true,
          }
        );
        if (ok) {
          hasRenamedSuccessfully = true;
          clearInterval(timer);
        }
      }
    }, 1200);
  }

  // LEGACY (unused since MODO TRIO notebook-scoped flow): kept for reference only
  async function legacyEnsureCorrectVideoChatBeforePrompt(payload) {
    const isDeepResearchOrder = Boolean(payload.enableDeepResearch);
    const rawBaseVideoName = stripDeepResearchSuffix(payload.videoName || '');
    const targetChatTitle = rawBaseVideoName
      ? isDeepResearchOrder
        ? `${rawBaseVideoName}_Deep Research`
        : rawBaseVideoName
      : '';
    const notebookName = String(payload.notebookName || 'Huellas de la Humanidad').trim();
    const docId = String(payload.docId || '').trim();
    const docKey = docId || normalizeCompareText(rawBaseVideoName);
    const desiredOwnerToken = docKey ? `${docKey}::${isDeepResearchOrder ? 'DEEP' : 'MAIN'}` : '';

    const storedEntry = getStoredDocChatEntry(docKey, rawBaseVideoName);
    const mainChatUrl = String(payload.geminiChatUrl || storedEntry.mainChatUrl || '').trim();
    const deepResearchChatUrl = String(
      payload.geminiDeepResearchChatUrl || storedEntry.deepResearchChatUrl || ''
    ).trim();

    const targetChatUrl = isDeepResearchOrder ? deepResearchChatUrl : mainChatUrl;
    const oppositeChatUrl = isDeepResearchOrder ? mainChatUrl : deepResearchChatUrl;

    const currentChatId = extractChatIdFromUrl(window.location.href);
    const targetChatId =
      extractChatIdFromUrl(targetChatUrl) ||
      (isDeepResearchOrder ? storedEntry.deepResearchChatId : storedEntry.mainChatId) ||
      '';
    const oppositeChatId =
      extractChatIdFromUrl(oppositeChatUrl) ||
      (isDeepResearchOrder ? storedEntry.mainChatId : storedEntry.deepResearchChatId) ||
      '';

    const currentDomTitle = getActiveGeminiChatTitleInDom();
    const currentDomIsDeep = hasDeepResearchSuffix(currentDomTitle);
    const existingMessagesInCurrentTab =
      getModelResponseElements().length +
      document.querySelectorAll('user-query, [data-message-author-role="user"]').length;

    if (!rawBaseVideoName && !targetChatUrl) {
      return { isNewChat: false, targetChatTitle: '', isDeepResearchOrder };
    }

    // Case 1: Already inside the target chat for this documentary and mode (Main vs _Deep Research)
    const isExactChatIdMatch = Boolean(
      targetChatId && currentChatId && targetChatId === currentChatId
    );
    const isTitleMatchForSameMode = Boolean(
      rawBaseVideoName &&
        currentDomTitle &&
        doesTitleMatchTargetVideo(currentDomTitle, rawBaseVideoName, isDeepResearchOrder) &&
        (!oppositeChatId || currentChatId !== oppositeChatId)
    );
    const isAlreadyOwnedByThisDocAndMode = Boolean(
      desiredOwnerToken &&
        window.__HUELLAS_CURRENT_TAB_CHAT_OWNER__ === desiredOwnerToken &&
        (currentChatId || existingMessagesInCurrentTab > 0) &&
        (!oppositeChatId || currentChatId !== oppositeChatId) &&
        currentDomIsDeep === isDeepResearchOrder
    );

    if (isExactChatIdMatch || isTitleMatchForSameMode || isAlreadyOwnedByThisDocAndMode) {
      window.__HUELLAS_CURRENT_TAB_CHAT_OWNER__ = desiredOwnerToken;
      if (docKey && currentChatId) {
        saveStoredDocChatEntry(
          docKey,
          isDeepResearchOrder
            ? {
                baseVideoName: rawBaseVideoName,
                deepResearchChatId: currentChatId,
                deepResearchChatUrl: window.location.href,
                deepResearchChatTitle: targetChatTitle || currentDomTitle,
              }
            : {
                baseVideoName: rawBaseVideoName,
                mainChatId: currentChatId,
                mainChatUrl: window.location.href,
                mainChatTitle: targetChatTitle || currentDomTitle,
              }
        );
      }
      chrome.runtime
        .sendMessage({
          type: 'GEMINI_CHAT_LINKED',
          docId,
          geminiChatUrl: window.location.href,
          geminiChatTitle: targetChatTitle || currentDomTitle,
          isDeepResearch: isDeepResearchOrder,
        })
        .catch(() => {});

      if (
        targetChatTitle &&
        currentDomTitle &&
        normalizeCompareText(currentDomTitle) !== normalizeCompareText(targetChatTitle)
      ) {
        await renameGeminiConversationInDom(targetChatTitle, window.location.href, docId, {
          isDeepResearch: isDeepResearchOrder,
          isActiveTabChat: true,
        });
      }
      return { isNewChat: false, targetChatTitle, isDeepResearchOrder };
    }

    // Case 2: Search Gemini sidebar for an existing chat of this video & mode (Main vs _Deep Research)
    await ensureGeminiSidebarOpen();
    const existingChatItem = findChatElementInSidebar(
      rawBaseVideoName,
      targetChatUrl,
      isDeepResearchOrder,
      oppositeChatId
    );
    if (existingChatItem) {
      reportStatus(
        'WORKING',
        `🔍 Cambiando automáticamente al chat "${targetChatTitle}" en Gemini...`,
        { stageNumber: payload.stageNumber }
      );
      existingChatItem.click();
      await sleep(1500);
      window.__HUELLAS_CURRENT_TAB_CHAT_OWNER__ = desiredOwnerToken;
      const switchedChatId = extractChatIdFromUrl(window.location.href);
      if (docKey && switchedChatId) {
        saveStoredDocChatEntry(
          docKey,
          isDeepResearchOrder
            ? {
                baseVideoName: rawBaseVideoName,
                deepResearchChatId: switchedChatId,
                deepResearchChatUrl: window.location.href,
                deepResearchChatTitle: targetChatTitle,
              }
            : {
                baseVideoName: rawBaseVideoName,
                mainChatId: switchedChatId,
                mainChatUrl: window.location.href,
                mainChatTitle: targetChatTitle,
              }
        );
      }
      chrome.runtime
        .sendMessage({
          type: 'GEMINI_CHAT_LINKED',
          docId,
          geminiChatUrl: window.location.href,
          geminiChatTitle: targetChatTitle,
          isDeepResearch: isDeepResearchOrder,
        })
        .catch(() => {});

      const domTitleAfterSwitch = getActiveGeminiChatTitleInDom();
      if (
        targetChatTitle &&
        domTitleAfterSwitch &&
        normalizeCompareText(domTitleAfterSwitch) !== normalizeCompareText(targetChatTitle)
      ) {
        await renameGeminiConversationInDom(targetChatTitle, window.location.href, docId, {
          isDeepResearch: isDeepResearchOrder,
          isActiveTabChat: true,
        });
      }
      return { isNewChat: false, targetChatTitle, isDeepResearchOrder };
    }

    // Case 3: No chat exists yet for this video & mode:
    // Both the Main Chat ("[Nombre]") AND the Deep Research chat ("[Nombre]_Deep Research") MUST be created INSIDE the Notebook "Huellas de la Humanidad"!
    const normNotebook = normalizeCompareText(notebookName);
    const isCurrentlyInTargetNotebook = () => {
      if (/\/gem\/[a-zA-Z0-9_-]+/i.test(window.location.href)) return true;
      const mainSelectors = [
        'bot-info-card',
        '.bot-name',
        '[data-test-id="bot-name"]',
        'header',
        'zero-state',
        'hall-of-fame',
        'main',
      ];
      for (const sel of mainSelectors) {
        const nodes = document.querySelectorAll(sel);
        for (const n of nodes) {
          if (!isElementVisibleInDom(n)) continue;
          const t = normalizeCompareText(n.innerText || n.textContent || '');
          if (t.includes(normNotebook) || t.includes('huellas de la humanidad')) {
            return true;
          }
        }
      }
      return false;
    };

    // If current tab is ALREADY an empty new chat inside the Notebook "Huellas de la Humanidad", reuse it directly!
    if (existingMessagesInCurrentTab === 0 && !currentChatId && isCurrentlyInTargetNotebook()) {
      window.__HUELLAS_CURRENT_TAB_CHAT_OWNER__ = desiredOwnerToken;
      return { isNewChat: true, targetChatTitle, isDeepResearchOrder };
    }

    reportStatus(
      'WORKING',
      isDeepResearchOrder
        ? `🔬 Abriendo nueva conversación dentro del Notebook "${notebookName}" para "${targetChatTitle}"...`
        : `📓 Entrando al Notebook "${notebookName}" para crear el chat único "${targetChatTitle}"...`,
      { stageNumber: payload.stageNumber }
    );

    let notebookClicked = false;
    try {
      const hwNotebook = await chrome.runtime.sendMessage({
        type: 'GEMINI_HARDWARE_OPEN_NOTEBOOK_NEW_CHAT',
        notebookName,
      });
      if (hwNotebook && hwNotebook.ok) {
        notebookClicked = true;
      }
    } catch {}

    if (!notebookClicked) {
      await ensureGeminiSidebarOpen();
      const sidebarLinks = Array.from(
        document.querySelectorAll(
          'a[href*="/gem/"], bard-sidenav a, bard-sidenav button, bard-sidenav [role="button"], bard-sidenav [role="listitem"], a, button, [role="button"]'
        )
      );
      for (const el of sidebarLinks) {
        if (!isElementVisibleInDom(el)) continue;
        if (el.closest('[data-test-id="conversation"], .conversation-items-container')) continue;
        const txt = normalizeCompareText(el.innerText || el.textContent || '');
        if (txt === normNotebook || (txt.includes('huellas de la humanidad') && txt.length < 45)) {
          const href = el.getAttribute('href') || el.querySelector?.('a')?.getAttribute('href') || '';
          if (href && href.includes('/gem/')) {
            try {
              localStorage.setItem('huellas_gemini_notebook_url', new URL(href, window.location.origin).href);
            } catch {}
          }
          el.click();
          notebookClicked = true;
          await sleep(1300);
          break;
        }
      }
    }

    if (!notebookClicked) {
      let savedGemUrl = '';
      try {
        savedGemUrl = localStorage.getItem('huellas_gemini_notebook_url') || '';
      } catch {}
      const currentGemRootMatch = window.location.href.match(/(https:\/\/gemini\.google\.com(?:\/u\/\d+)?\/gem\/[a-zA-Z0-9_-]+)/i);
      const targetGemRootUrl = savedGemUrl || (currentGemRootMatch ? currentGemRootMatch[1] : '');
      if (targetGemRootUrl) {
        window.location.href = targetGemRootUrl;
        await sleep(1600);
      }
    }

    // Wait up to 2.5s for any old messages from the previous chat to clear from the DOM
    let clearWait = 0;
    while (getModelResponseElements().length > 0 && clearWait < 8) {
      await sleep(300);
      clearWait++;
    }

    window.__HUELLAS_CURRENT_TAB_CHAT_OWNER__ = desiredOwnerToken;
    return { isNewChat: true, targetChatTitle, isDeepResearchOrder };
  }

  // ==========================================================================
  // NOTEBOOK-SCOPED FLOW (MODO TRIO consensus: Opus + Gemini Pro + Gemini Flash)
  // 1) Enter Notebook "Huellas de la Humanidad" (/gem/<gemId>)  2) look ONLY at its chats (/gem/<gemId>/<chatId>)
  // 3) reuse "<Video>[_Deep Research]" (exact title or saved chat id) or create a new chat inside the notebook
  // 4) single safe rename once the URL is /gem/<gemId>/<chatId>   5) navigation by URL is done by background.js
  //    (chrome.tabs.update + resume) so a page reload never loses the order.
  // ==========================================================================
  function parseGemUrl(url) {
    try {
      const u = new URL(String(url || ''), 'https://gemini.google.com');
      const m = u.pathname.match(/^\/(?:u\/\d+\/)?gem\/([a-zA-Z0-9_-]+)(?:\/([a-zA-Z0-9_-]{6,}))?\/?$/);
      if (!m) return { gemId: '', chatId: '' };
      return { gemId: m[1], chatId: m[2] || '' };
    } catch {
      return { gemId: '', chatId: '' };
    }
  }

  function buildGemRootUrl(anyGemUrl) {
    try {
      const u = new URL(String(anyGemUrl || ''), 'https://gemini.google.com');
      const m = u.pathname.match(/^(\/(?:u\/\d+\/)?gem\/[a-zA-Z0-9_-]+)/);
      return m ? `https://gemini.google.com${m[1]}` : '';
    } catch {
      return '';
    }
  }

  async function closeOverlayMenusQuick() {
    try {
      document.querySelectorAll('.cdk-overlay-backdrop.cdk-overlay-backdrop-showing').forEach((b) => b.click());
      (document.activeElement || document.body).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
      );
    } catch {}
    await sleep(150);
  }

  async function getSavedNotebookInfo() {
    let url = '';
    try {
      const st = await chrome.storage.local.get('huellasNotebookUrl');
      url = (st && st.huellasNotebookUrl) || '';
    } catch {}
    if (!url) {
      try {
        url = localStorage.getItem('huellas_gemini_notebook_url') || '';
      } catch {}
    }
    const rootUrl = buildGemRootUrl(url);
    const gemId = parseGemUrl(rootUrl).gemId;
    return gemId ? { gemId, rootUrl } : { gemId: '', rootUrl: '' };
  }

  async function saveNotebookRootUrl(anyGemUrl) {
    const rootUrl = buildGemRootUrl(anyGemUrl);
    if (!rootUrl) return;
    try {
      await chrome.storage.local.set({ huellasNotebookUrl: rootUrl });
    } catch {}
    try {
      localStorage.setItem('huellas_gemini_notebook_url', rootUrl);
    } catch {}
  }

  function countChatMessages() {
    return (
      getModelResponseElements().length +
      document.querySelectorAll('user-query, [data-message-author-role="user"]').length
    );
  }

  async function waitForUrl(pred, timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (pred(window.location.href)) return true;
      await sleep(200);
    }
    return pred(window.location.href);
  }

  // Chats that belong to the notebook: ONLY links whose href is /gem/<gemId>/<chatId>
  function listNotebookChats(gemId) {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('a[href*="/gem/"]').forEach((a) => {
      const p = parseGemUrl(a.getAttribute('href'));
      if (!gemId || p.gemId !== gemId || !p.chatId || seen.has(p.chatId)) return;
      seen.add(p.chatId);
      const titleEl = a.querySelector('.conversation-title, [class*="title"]') || a;
      out.push({
        el: a,
        chatId: p.chatId,
        title: (titleEl.innerText || titleEl.textContent || '').replace(/\s+/g, ' ').trim(),
      });
    });
    return out;
  }

  function findNotebookRootLink(gemId) {
    return (
      Array.from(document.querySelectorAll('a[href*="/gem/"]')).find((a) => {
        const p = parseGemUrl(a.getAttribute('href'));
        return p.gemId === gemId && !p.chatId;
      }) || null
    );
  }

  async function requestNavigateAndResume(url, payload) {
    const resumeCount = Number(payload.__resumeCount || 0);
    if (resumeCount >= 3) return false;
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'GEMINI_NAVIGATE_AND_RESUME',
        url,
        order: { ...payload, __resumeCount: resumeCount + 1 },
      });
      return Boolean(res && res.ok);
    } catch {
      return false;
    }
  }

  async function openNotebookViaSidebar(notebookName) {
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'GEMINI_HARDWARE_OPEN_NOTEBOOK_NEW_CHAT',
        notebookName,
      });
      if (!res || !res.ok) return '';
    } catch {
      return '';
    }
    const ok = await waitForUrl((u) => Boolean(parseGemUrl(u).gemId), 6000);
    if (!ok) return '';
    await saveNotebookRootUrl(window.location.href);
    return parseGemUrl(window.location.href).gemId;
  }

  // (superseded by the /notebook/<uuid> flow verified live on gemini.google.com)
  async function gemScopedEnsureCorrectVideoChat_unused(payload) {
    const isDeepResearchOrder = Boolean(payload.enableDeepResearch);
    const baseVideoName = stripDeepResearchSuffix(payload.videoName || '');
    const targetChatTitle = baseVideoName
      ? isDeepResearchOrder
        ? `${baseVideoName}_Deep Research`
        : baseVideoName
      : '';
    const notebookName = String(payload.notebookName || 'Huellas de la Humanidad').trim();
    const docId = String(payload.docId || '').trim();
    const docKey = docId || normalizeCompareText(baseVideoName);
    const stage = { stageNumber: payload.stageNumber };

    // STEP 1: be inside the Notebook "Huellas de la Humanidad"
    let nb = await getSavedNotebookInfo();
    let cur = parseGemUrl(window.location.href);

    if (!nb.gemId || cur.gemId !== nb.gemId) {
      reportStatus('WORKING', `📓 Entrando al Notebook "${notebookName}"...`, stage);
      let entered = false;
      if (nb.gemId) {
        // SPA click on the notebook link if visible (no reload)
        const rootLink = findNotebookRootLink(nb.gemId);
        if (rootLink) {
          rootLink.click();
          entered = await waitForUrl((u) => parseGemUrl(u).gemId === nb.gemId, 5000);
        }
      } else {
        const gid = await openNotebookViaSidebar(notebookName);
        if (gid) {
          nb = await getSavedNotebookInfo();
          entered = parseGemUrl(window.location.href).gemId === nb.gemId;
        }
      }
      if (!entered) {
        if (nb.gemId && (await requestNavigateAndResume(nb.rootUrl, payload))) {
          return { navigating: true };
        }
        return {
          abort: true,
          reason: nb.gemId
            ? `No se pudo entrar al Notebook "${notebookName}".`
            : `No se encontró el Notebook "${notebookName}" en la barra lateral de Gemini. Ábrelo una vez manualmente en esta pestaña (la extensión aprenderá su dirección) y vuelve a intentarlo.`,
        };
      }
      cur = parseGemUrl(window.location.href);
      await sleep(900);
    }

    // STEP 2: look ONLY at the notebook's chats for this video's conversation
    const stored = getStoredDocChatEntry(docKey, baseVideoName) || {};
    const storedUrl = String(
      (isDeepResearchOrder
        ? payload.geminiDeepResearchChatUrl || stored.deepResearchChatUrl
        : payload.geminiChatUrl || stored.mainChatUrl) || ''
    );
    const oppositeUrl = String(
      (isDeepResearchOrder
        ? payload.geminiChatUrl || stored.mainChatUrl
        : payload.geminiDeepResearchChatUrl || stored.deepResearchChatUrl) || ''
    );
    const sp = parseGemUrl(storedUrl);
    const oppositeChatId = parseGemUrl(oppositeUrl).chatId;
    let targetChatId = sp.gemId === nb.gemId && sp.chatId !== oppositeChatId ? sp.chatId : '';
    const notebookChats = listNotebookChats(nb.gemId);
    if (!targetChatId && targetChatTitle) {
      const wanted = normalizeCompareText(targetChatTitle);
      const match = notebookChats.find(
        (c) => c.chatId !== oppositeChatId && normalizeCompareText(c.title) === wanted
      );
      if (match) targetChatId = match.chatId;
    }
    try {
      console.log('[Huellas] Notebook chats:', { gemId: nb.gemId, targetChatTitle, targetChatId, chats: notebookChats.map((c) => `${c.title} (${c.chatId})`) });
    } catch {}

    if (targetChatId) {
      if (cur.chatId === targetChatId) {
        return { isNewChat: false, targetChatTitle, isDeepResearchOrder, gemId: nb.gemId, chatId: targetChatId };
      }
      reportStatus('WORKING', `🔍 Abriendo la conversación "${targetChatTitle}" dentro del Notebook...`, stage);
      const link = notebookChats.find((c) => c.chatId === targetChatId);
      if (link) {
        link.el.click();
        const ok = await waitForUrl((u) => {
          const p = parseGemUrl(u);
          return p.gemId === nb.gemId && p.chatId === targetChatId;
        }, 6000);
        if (ok) {
          await sleep(1500);
          return { isNewChat: false, targetChatTitle, isDeepResearchOrder, gemId: nb.gemId, chatId: targetChatId };
        }
      }
      const chatUrl = `${nb.rootUrl}/${targetChatId}`;
      if (await requestNavigateAndResume(chatUrl, payload)) return { navigating: true };
      return { abort: true, reason: `No se pudo abrir la conversación "${targetChatTitle}" del Notebook.` };
    }

    // STEP 3: create a NEW chat inside the notebook
    if (cur.gemId === nb.gemId && !cur.chatId && countChatMessages() === 0) {
      return { isNewChat: true, targetChatTitle, isDeepResearchOrder, gemId: nb.gemId, chatId: '' };
    }
    reportStatus('WORKING', `✨ Creando la conversación "${targetChatTitle}" dentro del Notebook "${notebookName}"...`, stage);
    const rootLink = findNotebookRootLink(nb.gemId);
    if (rootLink) {
      rootLink.click();
      const ok = await waitForUrl((u) => {
        const p = parseGemUrl(u);
        return p.gemId === nb.gemId && !p.chatId;
      }, 5000);
      if (ok) {
        for (let i = 0; i < 12 && countChatMessages() > 0; i++) await sleep(250);
        if (countChatMessages() === 0) {
          return { isNewChat: true, targetChatTitle, isDeepResearchOrder, gemId: nb.gemId, chatId: '' };
        }
      }
    }
    if (await requestNavigateAndResume(nb.rootUrl, payload)) return { navigating: true };
    return { abort: true, reason: 'No se pudo crear una conversación nueva dentro del Notebook.' };
  }

  // Single link + rename, only for the chat of THIS order inside the notebook
  async function gemLinkAndRename_unused(chatState, docId) {
    if (!chatState || !chatState.gemId) return;
    const gemId = chatState.gemId;
    const title = String(chatState.targetChatTitle || '').trim();
    const isDeep = Boolean(chatState.isDeepResearchOrder);
    const ok = await waitForUrl((u) => {
      const p = parseGemUrl(u);
      return p.gemId === gemId && Boolean(p.chatId);
    }, 45000);
    if (!ok) return;
    const p = parseGemUrl(window.location.href);
    if (chatState.chatId && p.chatId !== chatState.chatId) return;
    const chatId = p.chatId;
    const chatUrl = window.location.href.split(/[?#]/)[0];
    const baseVideoName = stripDeepResearchSuffix(title);
    const docKey = docId || normalizeCompareText(baseVideoName);
    if (docKey) {
      saveStoredDocChatEntry(
        docKey,
        isDeep
          ? { baseVideoName, deepResearchChatId: chatId, deepResearchChatUrl: chatUrl, deepResearchChatTitle: title }
          : { baseVideoName, mainChatId: chatId, mainChatUrl: chatUrl, mainChatTitle: title }
      );
    }
    chrome.runtime
      .sendMessage({ type: 'GEMINI_CHAT_LINKED', docId, geminiChatUrl: chatUrl, geminiChatTitle: title, isDeepResearch: isDeep })
      .catch(() => {});
    if (!title) return;
    // Let Gemini assign its automatic title first, then rename ONCE (one retry)
    await sleep(chatState.isNewChat ? 6000 : 1500);
    for (let attempt = 0; attempt < 2; attempt++) {
      const currentTitle = getActiveGeminiChatTitleInDom();
      if (currentTitle && normalizeCompareText(currentTitle) === normalizeCompareText(title)) return;
      const renamed = await renameGeminiConversationInDom(title, chatUrl, docId, {
        isDeepResearch: isDeep,
        strictGemId: gemId,
        strictChatId: chatId,
      });
      if (renamed) return;
      await sleep(8000);
    }
  }

  // ---- Deep Research: plan -> "Start research" -> final report ----
  // Verified live: Spanish UI shows "Empezar la investigación" inside <deep-research-confirmation-widget>
  const START_RESEARCH_RE =
    /\b((?:iniciar|empezar|comenzar)\s+(?:la\s+|a\s+)?investiga(?:ci[oó]n|r)|start\s+(?:the\s+)?research|begin\s+research)\b/i;

  function findStartResearchButtonScoped() {
    const isUsable = (b) => {
      if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
      if (b.closest('bard-sidenav, side-navigation, .cdk-overlay-container')) return false;
      const r = b.getBoundingClientRect();
      return r.width > 4 && r.height > 4;
    };
    const matches = (b) =>
      START_RESEARCH_RE.test((b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim()) ||
      START_RESEARCH_RE.test(b.getAttribute('aria-label') || '') ||
      /start-research|confirm-research/i.test(b.getAttribute('data-test-id') || '');
    const responses = getModelResponseElements();
    const last = responses.length ? responses[responses.length - 1] : null;
    const widgets = Array.from(document.querySelectorAll('deep-research-confirmation-widget'));
    const lastWidget = widgets.length ? widgets[widgets.length - 1] : null;
    const scopes = [lastWidget, ...(last ? [last, last.parentElement] : [])];
    for (const scope of scopes) {
      if (!scope) continue;
      const found = Array.from(scope.querySelectorAll('button, [role="button"]')).filter((b) => isUsable(b) && matches(b));
      if (found.length) return found[found.length - 1];
    }
    // Fallback: the most recent matching button in the conversation (never sidebar/overlays)
    const all = Array.from(document.querySelectorAll('button, [role="button"]')).filter((b) => isUsable(b) && matches(b));
    return all.length ? all[all.length - 1] : null;
  }

  async function clickStartResearch() {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const btn = findStartResearchButtonScoped();
      if (!btn) return true; // nothing to click (already started)
      try {
        btn.scrollIntoView({ block: 'center' });
      } catch {}
      await sleep(250);
      let hw = null;
      try {
        hw = await chrome.runtime.sendMessage({ type: 'GEMINI_HARDWARE_CLICK_START_RESEARCH' });
      } catch {}
      if (!hw || !hw.clicked) {
        try {
          btn.click();
        } catch {}
      }
      for (let i = 0; i < 15; i++) {
        await sleep(200);
        const still = findStartResearchButtonScoped();
        if (!still || isDeepResearchActivelyBrowsing() || isGeminiStillGenerating()) return true;
      }
    }
    return !findStartResearchButtonScoped();
  }

  function extractDeepResearchReport() {
    const latest = extractLatestGeminiResponse();
    // Verified live: the report is rendered ONLY inside <deep-research-immersive-panel> (inside <immersive-panel>).
    // Never use generic [class*="immersive"] containers: one of them wraps the whole chat history.
    const panels = Array.from(document.querySelectorAll('deep-research-immersive-panel')).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 50 && r.height > 50;
    });
    const panel = panels.length ? panels[panels.length - 1] : null;
    if (panel) {
      // Verified live: the clean report body is the panel's message-content / .markdown-main-panel
      // (the panel's root also contains toolbar text like "Contents · Share & Export · Create").
      const bodies = Array.from(panel.querySelectorAll('.markdown-main-panel, message-content')).filter(
        (b) => !b.closest('[class*="thinking" i], thinking-panel, [data-test-id*="thinking" i]')
      );
      let body = null;
      bodies.forEach((b) => {
        if (!body || (b.innerText || '').length > (body.innerText || '').length) body = b;
      });
      // Live innerText keeps paragraphs/line breaks (a detached clone would lose them). While the research is
      // still running the panel only holds "thinking" logs, so no body is found and nothing is captured.
      const text = body ? (body.innerText || '').trim() : '';
      const hasReportActions = Array.from(panel.querySelectorAll('button, [role="button"]')).some((b) => {
        const s = `${b.innerText || ''} ${b.getAttribute('aria-label') || ''}`;
        return /\b(export|exportar|docs|share|compartir|copy|copiar|download|descargar)\b/i.test(s);
      });
      return { text, images: latest.images || [], fromPanel: true, hasReportActions };
    }
    return { text: String(latest.text || ''), images: latest.images || [], fromPanel: false, hasReportActions: false };
  }

  function extractDeepResearchReport_unused() {
    const latest = extractLatestGeminiResponse();
    let best = { text: String(latest.text || ''), images: latest.images || [], fromPanel: false };
    const panelSel =
      'immersive-panel, deep-research-immersive-panel, extended-response-panel, [class*="immersive"], [data-test-id*="immersive"], [class*="research-report"], [class*="deep-research-report"]';
    document.querySelectorAll(panelSel).forEach((el) => {
      if (el.closest('bard-sidenav, .cdk-overlay-container, rich-textarea')) return;
      const r = el.getBoundingClientRect();
      if (r.width < 50 || r.height < 50) return;
      const t = (el.innerText || '').trim();
      if (t.length > best.text.length) best = { text: t, images: best.images, fromPanel: true };
    });
    const scope = best.fromPanel ? document : latest.element || document;
    const hasReportActions = Array.from(scope.querySelectorAll('button, [role="button"]')).some((b) => {
      const s = `${b.innerText || ''} ${b.getAttribute('aria-label') || ''}`;
      return /\b(export|exportar|docs|share|compartir|copy|copiar)\b/i.test(s);
    });
    return { ...best, hasReportActions };
  }

  function watchDeepResearchOrder(initialCount, initialLastText, meta) {
    const startedAt = Date.now();
    const MAX_TOTAL_MS = 60 * 60 * 1000;
    const MAX_PLAN_WAIT_MS = 6 * 60 * 1000;
    const initialUserQueries = Number(meta && meta.initialUserQueries) || 0;
    let phase = 'WAIT_PLAN';
    let planClickedAt = 0;
    let planText = '';
    if (meta && meta.resumeResearching) {
      phase = 'RESEARCHING';
      planClickedAt = Date.now() - 60000;
    }
    let lastText = '';
    let lastChangeAt = Date.now();
    let responseSeenAt = 0;
    let lastStatusAt = 0;
    let busyStep = false;

    const finish = (ok, text, images, message) => {
      clearInterval(activeWatchTimer);
      activeWatchTimer = null;
      window.__HUELLAS_GEMINI_ACTIVE_WATCH_TIMER__ = null;
      isBusyWithOrder = false;
      if (ok) {
        chrome.runtime
          .sendMessage({
            type: 'GEMINI_RESPONSE_READY',
            stageNumber: meta.stageNumber,
            docId: (meta && meta.docId) || '',
            taskType: meta.taskType,
            text,
            images: images || [],
          })
          .catch(() => {});
        reportStatus('COMPLETED', message, meta);
        if (meta && meta.targetChatTitle) {
          const docTitleNow = (document.title || '').replace(/\s*-\s*Google Gemini\s*$/i, '').trim();
          if (normalizeCompareText(docTitleNow) !== normalizeCompareText(meta.targetChatTitle)) {
            linkAndRenameAfterSubmit(
              {
                ...(meta.chatState || {}),
                targetChatTitle: meta.targetChatTitle,
                isDeepResearchOrder: true,
                isNewChat: false,
              },
              meta.docId || ''
            ).finally(() => {
              processNextQueuedPrompt();
            });
            return;
          }
        }
      } else {
        reportStatus('ERROR', message, meta);
      }
      processNextQueuedPrompt();
    };

    reportStatus('GENERATING', '🔬 Deep Research: esperando que Gemini cree el plan de investigación...', meta);

    activeWatchTimer = setInterval(async () => {
      if (busyStep) return;
      const now = Date.now();
      if (now - startedAt > MAX_TOTAL_MS) {
        finish(false, '', [], '⛔ Deep Research superó 60 minutos sin un informe final. No se rellenó nada en la página.');
        return;
      }

      if (phase === 'WAIT_PLAN') {
        const submitted =
          document.querySelectorAll('user-query, [data-message-author-role="user"]').length > initialUserQueries;
        if (!submitted && now - startedAt < 20000) return;
        const btn = findStartResearchButtonScoped();
        if (btn) {
          busyStep = true;
          planText = extractDeepResearchReport().text || '';
          reportStatus('GENERATING', '📋 Plan de investigación creado. Pulsando "Start research"...', meta);
          const started = await clickStartResearch();
          busyStep = false;
          if (!started) {
            finish(false, '', [], '⛔ Se creó el plan pero no se pudo pulsar "Start research" en Gemini. Púlsalo manualmente; no se rellenó nada.');
            return;
          }
          phase = 'RESEARCHING';
          planClickedAt = Date.now();
          lastText = '';
          lastChangeAt = Date.now();
          reportStatus('GENERATING', '🚀 "Start research" pulsado. Gemini Deep Research está investigando (puede tardar varios minutos)...', meta);
          return;
        }
        const latest = extractLatestGeminiResponse();
        if (getModelResponseElements().length > initialCount || (latest.text && latest.text !== initialLastText)) {
          if (!responseSeenAt) responseSeenAt = now;
        }
        const generating = isGeminiStillGenerating();
        if (responseSeenAt && !generating && now - responseSeenAt > 150000) {
          finish(false, '', [], '⛔ Gemini respondió sin crear un plan de Deep Research ("Start research" nunca apareció). No se rellenó nada; revisa que Deep research esté activo en el chat.');
          return;
        }
        if (now - startedAt > MAX_PLAN_WAIT_MS) {
          finish(false, '', [], '⛔ Gemini no creó el plan de investigación en 6 minutos. No se rellenó nada.');
        }
        return;
      }

      // phase === 'RESEARCHING'
      if (findStartResearchButtonScoped() && now - planClickedAt > 8000) {
        busyStep = true;
        await clickStartResearch();
        busyStep = false;
      }
      const generating = isGeminiStillGenerating() || isDeepResearchActivelyBrowsing();
      const report = extractDeepResearchReport();
      // If the report panel is closed, reopen it from the response chip (verified live: <immersive-entry-chip>)
      if (!report.fromPanel && now - (watchDeepResearchOrder.__lastChipClick || 0) > 20000) {
        const chips = Array.from(document.querySelectorAll('immersive-entry-chip'));
        const chip = chips.length ? chips[chips.length - 1] : null;
        if (chip) {
          watchDeepResearchOrder.__lastChipClick = now;
          try {
            (chip.querySelector('button, [role="button"], a') || chip).click();
          } catch {}
        }
      }
      if (report.text !== lastText || generating) {
        if (report.text !== lastText) lastText = report.text;
        lastChangeAt = now;
      }
      if (now - lastStatusAt > 30000) {
        lastStatusAt = now;
        reportStatus(
          'STREAMING',
          `🔬 Deep Research en curso (${Math.round((now - planClickedAt) / 60000)} min · ${report.text.length} caracteres)...`,
          { ...meta, previewText: report.text.slice(0, 220) }
        );
      }
      const minLen = Math.max(1500, Math.round(planText.length * 1.3));
      const stableMs = now - lastChangeAt;
      const requiredStableMs = report.hasReportActions ? 15000 : 25000;
      if (
        now - planClickedAt >= 60000 &&
        !generating &&
        report.text &&
        report.text !== planText &&
        report.text.length >= minLen &&
        stableMs >= requiredStableMs
      ) {
        finish(
          true,
          report.text,
          report.images,
          `✅ Informe de Deep Research capturado (${report.text.length} caracteres) y rellenado en Huellas Master.`
        );
      }
    }, 1500);
    window.__HUELLAS_GEMINI_ACTIVE_WATCH_TIMER__ = activeWatchTimer;
  }

  // ==========================================================================
  // REAL GEMINI NOTEBOOK FLOW (verified live with Chrome DevTools on gemini.google.com):
  //  - Notebook page: /notebook/<uuid>; its chats are listed as <project-chat-row> with
  //    h2[data-test-id="chat-title"] + button[data-test-id="navigate-to-recent-chat"].
  //  - Notebook chats live at /app/<chatId> and do NOT appear in the global sidebar; while inside one,
  //    the sidebar link a[href="/notebook/<uuid>"] has aria-current="page" (membership signal).
  //  - Rename: header "Open menu for conversation actions." -> [data-test-id="rename-button"]
  //    -> input[aria-label="Rename this chat"] -> dialog "Rename" (needs trusted clicks -> background CDP).
  // ==========================================================================
  function getNotebookPathFromUrl(url) {
    try {
      const m = new URL(String(url || ''), 'https://gemini.google.com').pathname.match(
        /^(\/(?:u\/\d+\/)?notebook\/[a-zA-Z0-9_-]+)\/?$/
      );
      return m ? m[1] : '';
    } catch {
      return '';
    }
  }

  function getAppChatIdFromUrl(url) {
    try {
      const m = new URL(String(url || ''), 'https://gemini.google.com').pathname.match(
        /^\/(?:u\/\d+\/)?app\/([a-zA-Z0-9_-]{6,})\/?$/
      );
      return m ? m[1] : '';
    } catch {
      return '';
    }
  }

  function getActiveNotebookPath() {
    const a = document.querySelector('a[href*="/notebook/"][aria-current="page"]');
    return a ? getNotebookPathFromUrl(a.getAttribute('href')) : '';
  }

  function findNotebookLinkByName(notebookName) {
    const wanted = normalizeCompareText(notebookName);
    const links = Array.from(document.querySelectorAll('a[href*="/notebook/"]')).filter((a) =>
      Boolean(getNotebookPathFromUrl(a.getAttribute('href')))
    );
    const textOf = (a) => normalizeCompareText(a.innerText || a.textContent || '');
    const exact = links.find((a) => textOf(a) === wanted);
    if (exact) return exact;
    const partial = links.filter((a) => {
      const t = textOf(a);
      return t && wanted && (t.includes(wanted) || wanted.includes(t));
    });
    return partial.length === 1 ? partial[0] : null; // only when unambiguous
  }

  const DEFAULT_HUELLAS_NOTEBOOK_PATH = '/notebook/5989f0d1-34c7-480e-af01-07f2ef1ee39f';

  async function expandSidebarNotebooksIfNeeded() {
    try {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      const moreBtn = buttons.find((b) => {
        const t = normalizeCompareText(b.innerText || b.textContent || '');
        return t === 'more' || t === 'mas' || t.endsWith(' more') || t.endsWith(' mas');
      });
      if (moreBtn) {
        moreBtn.click();
        await sleep(350);
      }
      const nbToggle = Array.from(document.querySelectorAll('button, [role="button"], a')).find((b) => {
        const t = normalizeCompareText(b.innerText || b.textContent || '');
        return t === 'notebooks' || t === 'cuadernos' || t.includes('notebooks');
      });
      if (nbToggle && !nbToggle.getAttribute('href')?.includes('/notebook/')) {
        nbToggle.click();
        await sleep(350);
      }
    } catch {}
  }

  async function resolveNotebookPath(notebookName) {
    let saved = '';
    try {
      const st = await chrome.storage.local.get('huellasNotebookPath');
      saved = getNotebookPathFromUrl((st && st.huellasNotebookPath) || '');
    } catch {}
    let link = findNotebookLinkByName(notebookName);
    if (!link && !saved) {
      await ensureGeminiSidebarOpen();
      await expandSidebarNotebooksIfNeeded();
      link = findNotebookLinkByName(notebookName);
    }
    const fromLink = link ? getNotebookPathFromUrl(link.getAttribute('href')) : '';
    const currentNbPath = getNotebookPathFromUrl(window.location.href);
    const isHuellasDefault =
      !notebookName || normalizeCompareText(notebookName).includes('huellas de la humanidad');
    const path =
      fromLink ||
      currentNbPath ||
      saved ||
      (isHuellasDefault ? DEFAULT_HUELLAS_NOTEBOOK_PATH : '');
    if (path && path !== saved) {
      try {
        await chrome.storage.local.set({ huellasNotebookPath: path });
      } catch {}
    }
    return path;
  }

  // Chats proven to belong to the notebook (opened from / created in its own page). Needed because Gemini collapses
  // the sidebar (and its aria-current notebook link) when the Deep Research report panel is open.
  const knownNotebookChats = new Set();
  async function loadKnownNotebookChats(nbPath) {
    try {
      const key = `huellasNbChats_${nbPath}`;
      const st = await chrome.storage.local.get(key);
      (Array.isArray(st && st[key]) ? st[key] : []).forEach((id) => knownNotebookChats.add(`${nbPath}|${id}`));
    } catch {}
  }
  async function rememberNotebookChat(nbPath, chatId) {
    if (!nbPath || !chatId) return;
    knownNotebookChats.add(`${nbPath}|${chatId}`);
    try {
      const key = `huellasNbChats_${nbPath}`;
      const st = await chrome.storage.local.get(key);
      const arr = Array.isArray(st && st[key]) ? st[key] : [];
      if (!arr.includes(chatId)) {
        arr.push(chatId);
        await chrome.storage.local.set({ [key]: arr.slice(-200) });
      }
    } catch {}
  }

  // Strict membership: notebook page itself, or an /app/<id> chat that is the active notebook's or a proven notebook chat
  function isInsideNotebook(nbPath) {
    if (!nbPath) return false;
    if (getNotebookPathFromUrl(window.location.href) === nbPath) return true;
    const chatId = getAppChatIdFromUrl(window.location.href);
    if (!chatId) return false;
    const active = getActiveNotebookPath();
    if (active) return active === nbPath;
    return knownNotebookChats.has(`${nbPath}|${chatId}`);
  }

  function listNotebookPageChats() {
    return Array.from(document.querySelectorAll('project-chat-row'))
      .map((row) => {
        const h = row.querySelector('h2[data-test-id="chat-title"], [data-test-id="chat-title"]');
        const btn = row.querySelector('button[data-test-id="navigate-to-recent-chat"]');
        return {
          row,
          btn,
          title: (h ? h.innerText || h.textContent || '' : '').replace(/\s+/g, ' ').trim(),
        };
      })
      .filter((c) => c.btn && c.title);
  }

  async function goToNotebookPage(nbPath, payload) {
    if (getNotebookPathFromUrl(window.location.href) === nbPath) return { ok: true };
    let link =
      Array.from(document.querySelectorAll('a[href*="/notebook/"]')).find(
        (a) => getNotebookPathFromUrl(a.getAttribute('href')) === nbPath
      ) || null;
    if (!link) {
      await ensureGeminiSidebarOpen();
      await expandSidebarNotebooksIfNeeded();
      link =
        Array.from(document.querySelectorAll('a[href*="/notebook/"]')).find(
          (a) => getNotebookPathFromUrl(a.getAttribute('href')) === nbPath
        ) || null;
    }
    if (link) {
      link.click(); // Angular routerLink: SPA navigation, content script survives
      const ok = await waitForUrl((u) => getNotebookPathFromUrl(u) === nbPath, 6000);
      if (ok) return { ok: true };
    }
    if (await requestNavigateAndResume(`https://gemini.google.com${nbPath}`, payload)) return { navigating: true };
    return { ok: false };
  }

  async function ensureCorrectVideoChatBeforePrompt(payload) {
    const isDeepResearchOrder = Boolean(payload.enableDeepResearch);
    const baseVideoName = stripDeepResearchSuffix(payload.videoName || '');
    const targetChatTitle = baseVideoName
      ? isDeepResearchOrder
        ? `${baseVideoName}_Deep Research`
        : baseVideoName
      : '';
    const notebookName = String(payload.notebookName || 'Huellas de la Humanidad').trim();
    const docId = String(payload.docId || '').trim();
    const docKey = docId || normalizeCompareText(baseVideoName);
    const stage = { stageNumber: payload.stageNumber };
    const base = { targetChatTitle, isDeepResearchOrder };

    // STEP 1: the notebook "Huellas de la Humanidad"
    const nbPath = await resolveNotebookPath(notebookName);
    if (!nbPath) {
      return {
        abort: true,
        reason: `No se encontró el Notebook "${notebookName}" en la barra lateral de Gemini (sección Notebooks).`,
      };
    }
    await loadKnownNotebookChats(nbPath);

    const stored = getStoredDocChatEntry(docKey, baseVideoName) || {};
    const linkedChatId =
      getAppChatIdFromUrl(
        isDeepResearchOrder
          ? payload.geminiDeepResearchChatUrl || stored.deepResearchChatUrl
          : payload.geminiChatUrl || stored.mainChatUrl
      ) ||
      (isDeepResearchOrder ? stored.deepResearchChatId : stored.mainChatId) ||
      '';
    const oppositeChatId =
      getAppChatIdFromUrl(
        isDeepResearchOrder
          ? payload.geminiChatUrl || stored.mainChatUrl
          : payload.geminiDeepResearchChatUrl || stored.deepResearchChatUrl
      ) ||
      (isDeepResearchOrder ? stored.mainChatId : stored.deepResearchChatId) ||
      '';

    // Already inside this video's chat of the notebook (exact title OR linked chatId + notebook membership)
    const curChatId = getAppChatIdFromUrl(window.location.href);
    if (curChatId && isInsideNotebook(nbPath) && targetChatTitle) {
      const docTitle = (document.title || '').replace(/\s*-\s*Google Gemini\s*$/i, '').trim();
      const isSameLinkedChat = Boolean(
        linkedChatId && curChatId === linkedChatId && (!oppositeChatId || curChatId !== oppositeChatId)
      );
      if (normalizeCompareText(docTitle) === normalizeCompareText(targetChatTitle) || isSameLinkedChat) {
        return { ...base, isNewChat: false, nbPath, chatId: curChatId };
      }
    }

    // STEP 2: open the notebook page and look ONLY at its own chat list
    reportStatus('WORKING', `📓 Entrando al Notebook "${notebookName}"...`, stage);
    const nav = await goToNotebookPage(nbPath, payload);
    if (nav.navigating) return { navigating: true };
    if (!nav.ok) return { abort: true, reason: `No se pudo abrir el Notebook "${notebookName}".` };
    for (let i = 0; i < 25 && listNotebookPageChats().length === 0 && !document.querySelector('rich-textarea'); i++) {
      await sleep(200);
    }
    await sleep(800);

    // STEP 3: find "<Video>[_Deep Research]" by title or video number in the notebook's "Past chats"
    const chats = listNotebookPageChats();
    try {
      console.log('[Huellas] Chats del Notebook:', chats.map((c) => c.title));
    } catch {}
    const wanted = normalizeCompareText(targetChatTitle);
    const storedWantedTitle = normalizeCompareText(
      isDeepResearchOrder ? stored.deepResearchChatTitle || '' : stored.mainChatTitle || ''
    );
    const match =
      (targetChatTitle && chats.find((c) => normalizeCompareText(c.title) === wanted)) ||
      (storedWantedTitle && chats.find((c) => normalizeCompareText(c.title) === storedWantedTitle)) ||
      (baseVideoName &&
        chats.find((c) => doesTitleMatchTargetVideo(c.title, baseVideoName, isDeepResearchOrder))) ||
      null;
    if (match) {
      reportStatus('WORKING', `🔍 Abriendo "${targetChatTitle || match.title}" dentro del Notebook...`, stage);
      match.btn.click();
      const ok = await waitForUrl((u) => Boolean(getAppChatIdFromUrl(u)), 10000);
      if (ok) {
        // Opened from the notebook's own "Past chats" list => proven notebook chat
        const openedId = getAppChatIdFromUrl(window.location.href);
        await rememberNotebookChat(nbPath, openedId);
        await sleep(1500);
        if (isInsideNotebook(nbPath)) {
          return { ...base, isNewChat: false, nbPath, chatId: openedId };
        }
      }
      return { abort: true, reason: `Se encontró "${targetChatTitle}" en el Notebook pero no se pudo abrir.` };
    }

    // STEP 4: not found -> new chat from the notebook page's own composer (created INSIDE the notebook)
    reportStatus('WORKING', `✨ Creando "${targetChatTitle}" dentro del Notebook "${notebookName}"...`, stage);
    return { ...base, isNewChat: true, nbPath, chatId: '' };
  }

  // Link + rename of THIS order's chat, only while it is inside the notebook
  async function linkAndRenameAfterSubmit(chatState, docId) {
    if (!chatState) return;
    let nbPath = chatState.nbPath || '';
    if (!nbPath) {
      nbPath = await resolveNotebookPath('Huellas de la Humanidad');
    }
    if (!nbPath) return;
    const title = String(chatState.targetChatTitle || '').trim();
    const isDeep = Boolean(chatState.isDeepResearchOrder);
    const ok = await waitForUrl((u) => Boolean(getAppChatIdFromUrl(u)), 60000);
    if (!ok) return;
    const chatId = getAppChatIdFromUrl(window.location.href);
    if (!chatId) return;
    // A new chat sent from the notebook page's own composer belongs to the notebook
    if (chatState.isNewChat) await rememberNotebookChat(nbPath, chatId);
    for (let i = 0; i < 25 && !isInsideNotebook(nbPath); i++) await sleep(200);
    if (!isInsideNotebook(nbPath)) return;
    if (chatState.chatId && chatState.chatId !== chatId) return;
    const chatUrl = `https://gemini.google.com/app/${chatId}`;
    const baseVideoName = stripDeepResearchSuffix(title);
    const docKey = docId || normalizeCompareText(baseVideoName);
    if (docKey) {
      saveStoredDocChatEntry(
        docKey,
        isDeep
          ? { baseVideoName, deepResearchChatId: chatId, deepResearchChatUrl: chatUrl, deepResearchChatTitle: title }
          : { baseVideoName, mainChatId: chatId, mainChatUrl: chatUrl, mainChatTitle: title }
      );
    }
    chrome.runtime
      .sendMessage({ type: 'GEMINI_CHAT_LINKED', docId, geminiChatUrl: chatUrl, geminiChatTitle: title, isDeepResearch: isDeep, notebookPath: nbPath })
      .catch(() => {});
    if (!title) return;
    await sleep(chatState.isNewChat ? 5000 : 800);
    for (let attempt = 0; attempt < 3; attempt++) {
      const docTitle = (document.title || '').replace(/\s*-\s*Google Gemini\s*$/i, '').trim();
      if (normalizeCompareText(docTitle) === normalizeCompareText(title)) return;
      if (!isInsideNotebook(nbPath) || getAppChatIdFromUrl(window.location.href) !== chatId) return;
      let res = null;
      try {
        res = await chrome.runtime.sendMessage({
          type: 'GEMINI_HARDWARE_RENAME_CURRENT_CHAT',
          title,
          chatId,
          nbPath,
          proven: knownNotebookChats.has(`${nbPath}|${chatId}`) || Boolean(chatState.isNewChat),
        });
      } catch {}
      if (res && res.ok) {
        reportStatus('WORKING', `✏️ Conversación del Notebook renombrada a "${title}".`, { docId });
        return;
      }
      await sleep(6000);
    }
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

        // 1B. Enter Notebook "Huellas de la Humanidad" and open/create this video's conversation (notebook-scoped)
        const chatState = await ensureCorrectVideoChatBeforePrompt(payload);
        if (chatState && chatState.navigating) {
          // background.js is reloading this tab to the notebook URL and will resend this order afterwards
          isBusyWithOrder = false;
          reportStatus('WORKING', '↪️ Navegando dentro del Notebook; la orden se reanudará automáticamente al cargar...', {
            stageNumber: payload.stageNumber,
          });
          return;
        }
        if (chatState && chatState.abort) {
          isBusyWithOrder = false;
          reportStatus('ERROR', `⛔ ${chatState.reason}`, { stageNumber: payload.stageNumber });
          processNextQueuedPrompt();
          return;
        }

        // A Deep Research is ALREADY running in this notebook chat: attach to it instead of sending a new prompt
        if (
          payload.enableDeepResearch &&
          chatState &&
          !chatState.isNewChat &&
          (isGeminiStillGenerating() || isDeepResearchActivelyBrowsing())
        ) {
          reportStatus('GENERATING', '🔬 Ya hay una investigación de Deep Research en curso en este chat del Notebook; esperando su informe final...', {
            stageNumber: payload.stageNumber,
          });
          watchDeepResearchOrder(getModelResponseElements().length, extractLatestGeminiResponse().text, {
            stageNumber: payload.stageNumber,
            taskType: payload.taskType || 'STAGE_GENERATION',
            enableHighModel: true,
            enableDeepResearch: true,
            targetChatTitle: chatState.targetChatTitle,
            docId: payload.docId || '',
            initialUserQueries: 0,
            resumeResearching: true,
            chatState,
          });
          return;
        }

        const useArgonLow =
          Boolean(payload.enableArgonLow) ||
          (!payload.enableHighModel && !payload.enableDeepResearch);
        const desiredModeKey = payload.enableDeepResearch
          ? 'ARGON4_HIGH_DEEP_RESEARCH'
          : payload.enableHighModel
          ? 'ARGON4_HIGH'
          : 'ARGON_LOW';

        // 2. Always verify & configure Argon 4 + Thinking Level + Deep Research in DOM (especially after chat navigation)
        if (!payload.skipModelSwitch) {
          reportStatus(
            'WORKING',
            useArgonLow
              ? '⚡ Configurando Gemini Argon 4 en Thinking: Low...'
              : `⚙️ Configurando Gemini Web en Argon 4 (Thinking: High)${
                  payload.enableDeepResearch ? ' + Deep Research activo' : ''
                }...`,
            { stageNumber: payload.stageNumber }
          );
          const cfgResult = await configureGeminiModelAndDeepResearch(
            Boolean(payload.enableHighModel),
            Boolean(payload.enableDeepResearch),
            useArgonLow
          );
          lastConfiguredModelMode = desiredModeKey;

          const levelLabel = useArgonLow ? 'Low' : 'High';
          const diagText =
            cfgResult && Array.isArray(cfgResult.diag) && cfgResult.diag.length > 0
              ? ` [${cfgResult.diag.join(' · ')}]`
              : '';
          // Never run the Deep Research phase without the Deep Research tool actually active
          if (payload.enableDeepResearch && cfgResult && !cfgResult.deepResearchOk) {
            isBusyWithOrder = false;
            reportStatus(
              'ERROR',
              `⛔ No se pudo activar "Deep research" en Gemini (+ → More tools → Deep research), así que NO se envió el prompt para no investigar sin Deep Research.${
                cfgResult.debuggerAttached === false
                  ? ' La extensión no pudo usar chrome.debugger (cierra DevTools en la pestaña de Gemini y recarga la extensión).'
                  : ''
              }${diagText}`,
              { stageNumber: payload.stageNumber }
            );
            processNextQueuedPrompt();
            return;
          }
          if (cfgResult) {
            reportStatus(
              'WORKING',
              `✅ Gemini configurado: 4 Argon · Thinking level: ${levelLabel}${
                cfgResult.thinkingOk ? ' ✓' : ' (sin confirmar)'
              }${payload.enableDeepResearch ? ` · Deep research ${cfgResult.deepResearchOk ? '✓' : '✗'}` : ''}${diagText}`,
              { stageNumber: payload.stageNumber }
            );
          }
        }

        // Final guard: never send if the tab left the notebook while configuring
        if (chatState && chatState.nbPath && !isInsideNotebook(chatState.nbPath)) {
          isBusyWithOrder = false;
          reportStatus('ERROR', '⛔ La pestaña de Gemini salió del Notebook "Huellas de la Humanidad" antes de enviar; no se envió el prompt.', {
            stageNumber: payload.stageNumber,
          });
          processNextQueuedPrompt();
          return;
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
        const initialUserQueries = document.querySelectorAll(
          'user-query, [data-message-author-role="user"]'
        ).length;

        const rawPrompt = String(payload.prompt || '');
        const promptFingerprint = normalizeCompareText(rawPrompt.slice(0, 120));
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

          const resolvedTargetChatTitle =
            (chatState && chatState.targetChatTitle) ||
            (payload.enableDeepResearch
              ? payload.deepResearchVideoName ||
                (payload.videoName
                  ? `${stripDeepResearchSuffix(payload.videoName)}_Deep Research`
                  : '')
              : stripDeepResearchSuffix(payload.videoName || ''));

          watchForNewResponse(initialCount, initialLastText, {
            stageNumber: payload.stageNumber,
            taskType: payload.taskType || 'STAGE_GENERATION',
            enableHighModel: Boolean(payload.enableHighModel),
            enableDeepResearch: Boolean(payload.enableDeepResearch),
            targetChatTitle: resolvedTargetChatTitle,
            docId: payload.docId || '',
            initialUserQueries,
            promptFingerprint,
            chatState,
          });

          // Link the chat id once Gemini assigns /app/<chatId> inside the notebook, then rename ONLY that chat (once)
          if (chatState && chatState.nbPath) {
            linkAndRenameAfterSubmit(chatState, payload.docId || '').catch(() => {});
          }
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

    if (msg.action === 'RENAME_GEMINI_CHAT') {
      (async () => {
        // Wait (max ~60 s) for another order to finish instead of aborting silently
        for (let w = 0; w < 120 && (isBusyWithOrder || isGeminiStillGenerating()); w++) {
          if (w === 0) {
            reportStatus('WORKING', '⏳ Renombrado de chats en espera: Gemini está terminando otra orden...', { docId: msg.docId });
          }
          await sleep(500);
        }
        if (isBusyWithOrder || isGeminiStillGenerating()) {
          reportStatus('ERROR', '⛔ No se renombraron los chats en Gemini: sigue ocupado con otra orden. Pulsa "Actualizar" cuando termine.', { docId: msg.docId });
          sendResponse({ handled: false, busy: true });
          return;
        }
        const notebookName = String(msg.notebookName || 'Huellas de la Humanidad').trim();
        const nbPath = await resolveNotebookPath(notebookName);
        const baseName = stripDeepResearchSuffix(msg.videoName || '');
        const deepName =
          msg.deepResearchVideoName || (baseName ? `${baseName}_Deep Research` : '');
        const oldBaseName = stripDeepResearchSuffix(msg.oldVideoName || '');
        const docId = String(msg.docId || '').trim();
        const docKey = docId || normalizeCompareText(baseName) || normalizeCompareText(oldBaseName);

        if (!nbPath || !baseName) {
          reportStatus(
            'ERROR',
            `⛔ No se renombraron los chats: ${!nbPath ? `no se encontró el Notebook "${notebookName}" en Gemini` : 'nombre de video vacío'}.`,
            { docId }
          );
          sendResponse({ handled: false });
          return;
        }
        await loadKnownNotebookChats(nbPath);

        const stored = getStoredDocChatEntry(docKey, oldBaseName || baseName) || {};
        const knownMainChatId =
          getAppChatIdFromUrl(msg.geminiChatUrl || stored.mainChatUrl || '') ||
          stored.mainChatId ||
          '';
        const knownDeepChatId =
          getAppChatIdFromUrl(msg.geminiDeepResearchChatUrl || stored.deepResearchChatUrl || '') ||
          stored.deepResearchChatId ||
          '';
        const videoNum =
          extractVideoNumberToken(baseName) ||
          extractVideoNumberToken(oldBaseName) ||
          extractVideoNumberToken(stored.baseVideoName || '') ||
          extractVideoNumberToken(stored.mainChatTitle || '');

        const matchesVideoChatTitle = (rawCandTitle, wantDeep) => {
          const cand = String(rawCandTitle || '')
            .replace(/\s*-\s*Google Gemini\s*$/i, '')
            .trim();
          if (!cand) return false;
          if (hasDeepResearchSuffix(cand) !== Boolean(wantDeep)) return false;
          const candBase = stripDeepResearchSuffix(cand);
          const normCand = normalizeCompareText(candBase);
          if (!normCand) return false;
          const knownBases = [
            baseName,
            oldBaseName,
            stored.baseVideoName,
            stripDeepResearchSuffix(stored.mainChatTitle || ''),
            stripDeepResearchSuffix(stored.deepResearchChatTitle || ''),
          ]
            .map(normalizeCompareText)
            .filter(Boolean);
          if (knownBases.includes(normCand)) return true;
          const candNum = extractVideoNumberToken(candBase);
          if (videoNum && candNum && candNum === videoNum) return true;
          return false;
        };

        const renameCurrentOpenAppChat = async (targetTitle, isDeep) => {
          const curChatId = getAppChatIdFromUrl(window.location.href);
          if (!curChatId || !targetTitle) return false;
          await rememberNotebookChat(nbPath, curChatId);
          let renamedOk = false;
          for (let attempt = 0; attempt < 2 && !renamedOk; attempt++) {
            let res = null;
            try {
              res = await chrome.runtime.sendMessage({
                type: 'GEMINI_HARDWARE_RENAME_CURRENT_CHAT',
                title: targetTitle,
                chatId: curChatId,
                nbPath,
                proven: true,
              });
            } catch {}
            renamedOk = Boolean(res && res.ok);
            if (renamedOk || (res && res.error === 'el chat no está dentro del Notebook')) break;
            if (attempt === 0) await sleep(1500);
          }
          if (renamedOk) {
            const chatUrl = `https://gemini.google.com/app/${curChatId}`;
            if (docKey) {
              saveStoredDocChatEntry(
                docKey,
                isDeep
                  ? {
                      baseVideoName: baseName,
                      deepResearchChatId: curChatId,
                      deepResearchChatUrl: chatUrl,
                      deepResearchChatTitle: targetTitle,
                    }
                  : {
                      baseVideoName: baseName,
                      mainChatId: curChatId,
                      mainChatUrl: chatUrl,
                      mainChatTitle: targetTitle,
                    }
              );
            }
            chrome.runtime
              .sendMessage({
                type: 'GEMINI_CHAT_LINKED',
                docId,
                geminiChatUrl: chatUrl,
                geminiChatTitle: targetTitle,
                isDeepResearch: Boolean(isDeep),
                notebookPath: nbPath,
              })
              .catch(() => {});
            reportStatus(
              'WORKING',
              `✏️ Conversación del Notebook actualizada a "${targetTitle}".`,
              { docId }
            );
          }
          return renamedOk;
        };

        let anyRenamed = Boolean(msg.__deepAlreadyRenamed || msg.__mainAlreadyRenamed);
        let mainRenamed = Boolean(msg.__mainAlreadyRenamed);
        let deepRenamed = Boolean(msg.__deepAlreadyRenamed);

        // 1. If the tab is currently open on one of this video's chats, rename it immediately in place
        const curChatId = getAppChatIdFromUrl(window.location.href);
        if (curChatId) {
          const curDocTitle =
            getActiveGeminiChatTitleInDom() ||
            (document.title || '').replace(/\s*-\s*Google Gemini\s*$/i, '').trim();
          const isCurrentVideoDeep =
            (knownDeepChatId && curChatId === knownDeepChatId) ||
            (isInsideNotebook(nbPath) && matchesVideoChatTitle(curDocTitle, true));
          const isCurrentVideoMain =
            !isCurrentVideoDeep &&
            ((knownMainChatId && curChatId === knownMainChatId) ||
              (isInsideNotebook(nbPath) && matchesVideoChatTitle(curDocTitle, false)));

          if (isCurrentVideoDeep && deepName) {
            const r = await renameCurrentOpenAppChat(deepName, true);
            if (r) {
              await sleep(1500);
              anyRenamed = true;
              deepRenamed = true;
            }
          } else if (isCurrentVideoMain && baseName) {
            const r = await renameCurrentOpenAppChat(baseName, false);
            if (r) {
              await sleep(1500);
              anyRenamed = true;
              mainRenamed = true;
            }
          }
        }

        // 2. Enter the Notebook "Huellas de la Humanidad" and check its chat list so both the Main chat and _Deep Research chat (if created) get renamed
        const nav = await goToNotebookPage(nbPath, {
          ...msg,
          target: 'GEMINI',
          action: 'RENAME_GEMINI_CHAT',
          __deepAlreadyRenamed: deepRenamed,
          __mainAlreadyRenamed: mainRenamed,
        });
        if (nav.navigating) {
          sendResponse({ handled: true, navigating: true });
          return;
        }
        if (nav.ok) {
          for (let i = 0; i < 35 && listNotebookPageChats().length === 0; i++) {
            await sleep(220);
          }
          await sleep(450);

          // First check if a _Deep Research chat for this video exists in the Notebook and needs renaming (with ground-truth verification in Notebook rows)
          let chats = listNotebookPageChats();
          for (let deepTry = 0; deepTry < 2; deepTry++) {
            const deepMatch = chats.find((c) => matchesVideoChatTitle(c.title, true));
            if (!deepMatch || !deepName) break;
            if (normalizeCompareText(deepMatch.title) === normalizeCompareText(deepName)) {
              deepRenamed = true;
              anyRenamed = true;
              break;
            }
            const startNbUrl = window.location.href;
            deepMatch.btn.click();
            const opened = await waitForUrl(
              (u) => Boolean(getAppChatIdFromUrl(u)) && u !== startNbUrl,
              9000
            );
            if (!opened) break;
            await sleep(1800);
            await renameCurrentOpenAppChat(deepName, true);
            await sleep(1500);
            // Return to Notebook page to verify the row title in <project-chat-row> and check Main chat
            const backNav = await goToNotebookPage(nbPath, {
              ...msg,
              target: 'GEMINI',
              action: 'RENAME_GEMINI_CHAT',
              __deepAlreadyRenamed: false,
              __mainAlreadyRenamed: mainRenamed,
            });
            if (backNav.navigating) {
              sendResponse({ handled: true, navigating: true });
              return;
            }
            for (let i = 0; i < 35 && listNotebookPageChats().length === 0; i++) {
              await sleep(220);
            }
            await sleep(600);
            chats = listNotebookPageChats();
            const verifyDeepRow = chats.find((c) => matchesVideoChatTitle(c.title, true));
            if (
              verifyDeepRow &&
              normalizeCompareText(verifyDeepRow.title) === normalizeCompareText(deepName)
            ) {
              deepRenamed = true;
              anyRenamed = true;
              break;
            }
          }

          // Now check if the Main chat for this video exists in the Notebook and needs renaming (or linking)
          const mainMatch = chats.find((c) => matchesVideoChatTitle(c.title, false));
          if (mainMatch && baseName) {
            if (normalizeCompareText(mainMatch.title) === normalizeCompareText(baseName)) {
              mainRenamed = true;
              anyRenamed = true;
            } else {
              const startNbUrl = window.location.href;
              mainMatch.btn.click();
              const opened = await waitForUrl(
                (u) => Boolean(getAppChatIdFromUrl(u)) && u !== startNbUrl,
                9000
              );
              if (opened) {
                await sleep(1600);
                const r = await renameCurrentOpenAppChat(baseName, false);
                if (r) {
                  await sleep(1500);
                  anyRenamed = true;
                  mainRenamed = true;
                }
                const endNav = await goToNotebookPage(nbPath, {
                  ...msg,
                  target: 'GEMINI',
                  action: 'RENAME_GEMINI_CHAT',
                  __deepAlreadyRenamed: deepRenamed,
                  __mainAlreadyRenamed: mainRenamed,
                });
                if (endNav.navigating) {
                  sendResponse({ handled: true, navigating: true });
                  return;
                }
                for (let i = 0; i < 30 && listNotebookPageChats().length === 0; i++) {
                  await sleep(220);
                }
              }
            }
          }
        }

        // Fallback: open the known main chat (/app/<id>) directly if it was not found by title in the Notebook
        if (
          !mainRenamed &&
          knownMainChatId &&
          !msg.__huellasDirectMainTried &&
          getAppChatIdFromUrl(window.location.href) !== knownMainChatId
        ) {
          const navDirect = await requestNavigateAndResume(`https://gemini.google.com/app/${knownMainChatId}`, {
            ...msg,
            target: 'GEMINI',
            action: 'RENAME_GEMINI_CHAT',
            __huellasDirectMainTried: true,
            __deepAlreadyRenamed: deepRenamed,
            __mainAlreadyRenamed: mainRenamed,
          });
          if (navDirect) {
            sendResponse({ handled: true, navigating: true });
            return;
          }
        }
        let seenTitles = '';
        try {
          seenTitles = listNotebookPageChats().map((c) => c.title).slice(0, 8).join(' | ');
          console.log('[Huellas RENAME] main:', mainRenamed, 'deep:', deepRenamed, 'chats:', seenTitles);
        } catch {}
        if (anyRenamed) {
          reportStatus(
            'WORKING',
            `✅ Gemini: ${mainRenamed ? `chat principal → "${baseName}"` : 'chat principal no encontrado'}${deepRenamed ? ` · Deep Research → "${deepName}"` : ''}.`,
            { docId }
          );
          try {
            chrome.runtime
              .sendMessage({
                type: 'REMOTE_RENAME_COMPLETED',
                commandId: msg.commandId || '',
                docId,
                videoName: baseName,
                deepResearchVideoName: deepName,
                mainRenamed,
                deepRenamed,
                seenTitles,
              })
              .catch(() => {});
          } catch {}
        } else {
          reportStatus(
            'ERROR',
            `⛔ No se encontró en el Notebook ningún chat de "${oldBaseName || baseName}"${videoNum ? ` (Video ${videoNum})` : ''} para renombrar.${seenTitles ? ` Chats visibles: ${seenTitles}` : ''}`,
            { docId }
          );
        }
        sendResponse({ handled: anyRenamed });
      })();
      return true;
    }

    if (msg.action === 'GEM_SCOPED_RENAME_UNUSED') {
      (async () => {
        const nbInfo = await getSavedNotebookInfo();
        const cur = parseGemUrl(window.location.href);
        const baseName = stripDeepResearchSuffix(msg.videoName || '');
        const deepName =
          msg.deepResearchVideoName || (baseName ? `${baseName}_Deep Research` : '');
        const isDeepChat =
          Boolean(cur.chatId) &&
          (parseGemUrl(msg.geminiDeepResearchChatUrl || '').chatId === cur.chatId ||
            hasDeepResearchSuffix(getActiveGeminiChatTitleInDom()));
        let ok = false;
        if (nbInfo.gemId && cur.gemId === nbInfo.gemId && cur.chatId) {
          ok = await renameGeminiConversationInDom(isDeepChat ? deepName : baseName, window.location.href, msg.docId, {
            isDeepResearch: isDeepChat,
            strictGemId: nbInfo.gemId,
            strictChatId: cur.chatId,
          });
        }
        sendResponse({ handled: ok });
      })();
      return true;
    }

    if (msg.action === 'LEGACY_RENAME_GEMINI_CHAT_DISABLED') {
      (async () => {
        const baseName = stripDeepResearchSuffix(msg.videoName || '');
        const deepName =
          msg.deepResearchVideoName || (baseName ? `${baseName}_Deep Research` : '');
        const currentTitle = getActiveGeminiChatTitleInDom();
        const isCurrentlyInDeepChat = hasDeepResearchSuffix(currentTitle);

        let ok = false;
        if (isCurrentlyInDeepChat && deepName) {
          ok = await renameGeminiConversationInDom(
            deepName,
            msg.geminiDeepResearchChatUrl || window.location.href,
            msg.docId,
            { isDeepResearch: true, isActiveTabChat: true }
          );
          if (baseName && msg.geminiChatUrl) {
            await renameGeminiConversationInDom(baseName, msg.geminiChatUrl, msg.docId, {
              isDeepResearch: false,
              isActiveTabChat: false,
            });
          }
        } else if (baseName) {
          ok = await renameGeminiConversationInDom(
            baseName,
            msg.geminiChatUrl || window.location.href,
            msg.docId,
            { isDeepResearch: false, isActiveTabChat: true }
          );
          if (deepName && msg.geminiDeepResearchChatUrl) {
            await renameGeminiConversationInDom(
              deepName,
              msg.geminiDeepResearchChatUrl,
              msg.docId,
              { isDeepResearch: true, isActiveTabChat: false }
            );
          }
        }
        sendResponse({ handled: ok });
      })();
      return true;
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

    if (msg.action === 'ASK_EXTERNAL_ARGON_HIGH') {
      const requestId = String(msg.requestId || '').trim();
      const rawPrompt = String(msg.prompt || '').trim();
      sendResponse({ handled: true, requestId });
      (async () => {
        try {
          let inputEl = null;
          for (let i = 0; i < 30; i++) {
            inputEl = findPromptInput();
            if (inputEl) break;
            await sleep(300);
          }
          if (!inputEl) {
            chrome.runtime
              .sendMessage({
                type: 'EXTERNAL_GEMINI_ASK_RESULT',
                requestId,
                ok: false,
                error: 'No se encontró la caja de texto en Gemini Web.',
              })
              .catch(() => {});
            return;
          }

          await configureGeminiModelAndDeepResearch(true, false, false);
          await sleep(450);

          // Re-query inputEl AFTER model switching because Angular recreates <rich-textarea>
          for (let i = 0; i < 20; i++) {
            const fresh = findPromptInput();
            if (fresh) {
              inputEl = fresh;
              break;
            }
            await sleep(250);
          }

          const initialCount = getModelResponseElements().length;
          const initialLastText = (extractLatestGeminiResponse().text || '').trim();
          const initialUserQueries = document.querySelectorAll(
            'user-query, [data-message-author-role="user"]'
          ).length;

          setInputText(inputEl, rawPrompt);
          chrome.runtime
            .sendMessage({
              type: 'GEMINI_MAIN_WORLD_INJECT_AND_SUBMIT',
              prompt: rawPrompt,
              autoSubmit: true,
            })
            .catch(() => {});

          let hasSeenInputPopulated = false;
          for (let attempt = 0; attempt < 16; attempt++) {
            await sleep(attempt === 0 ? 400 : 450);
            const curCount = getModelResponseElements().length;
            const curUserQueries = document.querySelectorAll(
              'user-query, [data-message-author-role="user"]'
            ).length;
            const curInput = findPromptInput() || inputEl;
            const rem = (curInput.value ?? curInput.innerText ?? curInput.textContent ?? '').trim();
            if (rem.length >= 10) {
              hasSeenInputPopulated = true;
            }
            if (
              isGeminiStillGenerating() ||
              curCount > initialCount ||
              curUserQueries > initialUserQueries ||
              (hasSeenInputPopulated && rem.length < 5)
            ) {
              break;
            }
            let sendBtn = findSendButton();
            if (!sendBtn) {
              setInputText(curInput, rawPrompt);
              chrome.runtime
                .sendMessage({
                  type: 'GEMINI_MAIN_WORLD_INJECT_AND_SUBMIT',
                  prompt: rawPrompt,
                  autoSubmit: true,
                })
                .catch(() => {});
              await sleep(220);
              sendBtn = findSendButton();
            }
            if (sendBtn) {
              try {
                sendBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                sendBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                sendBtn.click();
              } catch {}
            } else {
              curInput.focus();
              curInput.dispatchEvent(
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

          let stableDoneTicks = 0;
          let lastSeenText = '';
          for (let tick = 0; tick < 290; tick++) {
            await sleep(1000);
            const generating = isGeminiStillGenerating();
            const curCount = getModelResponseElements().length;
            const latestText = (extractLatestGeminiResponse().text || '').trim();
            const hasNewTurn =
              curCount > initialCount || (latestText.length > 40 && latestText !== initialLastText);

            if (hasNewTurn && !generating && latestText.length > 40) {
              if (latestText === lastSeenText) {
                stableDoneTicks += 1;
              } else {
                lastSeenText = latestText;
                stableDoneTicks = 1;
              }
              if (stableDoneTicks >= 3) {
                chrome.runtime
                  .sendMessage({
                    type: 'EXTERNAL_GEMINI_ASK_RESULT',
                    requestId,
                    ok: true,
                    response: latestText,
                    chatUrl: window.location.href,
                  })
                  .catch(() => {});
                return;
              }
            } else {
              lastSeenText = latestText;
              stableDoneTicks = 0;
            }
          }

          const finalFallback = (extractLatestGeminiResponse().text || '').trim();
          chrome.runtime
            .sendMessage({
              type: 'EXTERNAL_GEMINI_ASK_RESULT',
              requestId,
              ok: finalFallback.length > 40,
              response: finalFallback,
              chatUrl: window.location.href,
              error: finalFallback.length > 40 ? undefined : 'Timeout esperando respuesta completa en Gemini Web.',
            })
            .catch(() => {});
        } catch (err) {
          chrome.runtime
            .sendMessage({
              type: 'EXTERNAL_GEMINI_ASK_RESULT',
              requestId,
              ok: false,
              error: String(err?.message || err),
            })
            .catch(() => {});
        }
      })();
      return false;
    }

    return false;
  };
  window.__HUELLAS_GEMINI_MESSAGE_LISTENER__ = onRuntimeMessage;
  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  if (window.__HUELLAS_GEMINI_KEEPALIVE_TIMER__) {
    clearInterval(window.__HUELLAS_GEMINI_KEEPALIVE_TIMER__);
  }
  window.__HUELLAS_GEMINI_KEEPALIVE_TIMER__ = setInterval(() => {
    try {
      if (chrome?.runtime?.id) {
        chrome.runtime.sendMessage({ type: 'HUELLAS_KEEPALIVE' }).catch(() => {});
      }
    } catch {}
  }, 15000);

  chrome.runtime.sendMessage({
    type: 'CONTENT_SCRIPT_READY',
    service: 'GEMINI',
  }).catch(() => {});

  // Immediately scan existing chat turns on script load in case Stage 11 responses (YouTube, Facebook, Pinned Comment, Tags) are in this tab
  setTimeout(() => {
    try {
      const bundle = scanAllStage11ResponsesFromChat();
      if (bundle.youtube || bundle.facebook || bundle.pinnedComment || bundle.youtubeTags) {
        chrome.runtime
          .sendMessage({
            type: 'GEMINI_RESPONSE_READY',
            stageNumber: 111,
            taskType: 'AUTO_RECOVER_STAGE11',
            text: bundle.youtube || bundle.pinnedComment || bundle.facebook || bundle.youtubeTags,
            images: [],
            stage11Bundle: bundle,
          })
          .catch(() => {});
      }
    } catch {}
  }, 350);
})();
