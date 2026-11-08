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

  if (window.__HUELLAS_GEMINI_SCRIPT_VERSION__ === 10) return;
  window.__HUELLAS_GEMINI_SCRIPT_VERSION__ = 10;
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
          'mat-chip, mat-chip-option, button, [role="button"], [role="checkbox"], [role="switch"], . tool-chip'
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
        // Already active!
        return;
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
        } else {
          await closeAnyOpenOverlayMenus();
        }
      }
    };

    try {
      // 1. Configure Deep Research (ON via "+" -> "More tools >" -> "Deep research", or OFF if disabled)
      await ensureDeepResearchToggle();
      // 2. Configure Model ("Argon ^" -> "4 Argon" -> "Thinking level >" -> "Low" or "High")
      await ensureArgon4AndThinkingLevel();
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
          return;
        }
      }

      const responses = getModelResponseElements();
      const currentCount = responses.length;
      const latest = extractLatestGeminiResponse();
      const stillStreaming = isGeminiStillGenerating() || (isDeepResearch && isDeepResearchActivelyBrowsing());

      const isNewTurnResponse =
        currentCount > initialCount || Boolean(latest.text && latest.text !== initialLastText);

      if (stillStreaming || isNewTurnResponse) {
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

  // ==========================================================================
  // NOTEBOOK "HUELLAS DE LA HUMANIDAD" + 1-CHAT-PER-VIDEO DETECTOR & RENAMER
  // ==========================================================================
  function normalizeCompareText(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function extractVideoNumberToken(str) {
    const m = String(str || '').match(/\bvideo\s*0*(\d+)\b/i);
    return m ? m[1] : '';
  }

  function extractChatIdFromUrl(urlStr) {
    const m = String(urlStr || '').match(/\/app\/([a-zA-Z0-9_-]{8,})/);
    return m ? m[1] : '';
  }

  function doesTitleMatchTargetVideo(candidateTitle, targetVideoName) {
    const normCand = normalizeCompareText(candidateTitle);
    const normTarget = normalizeCompareText(targetVideoName);
    if (!normCand || !normTarget) return false;
    if (normCand === normTarget || normCand.includes(normTarget) || normTarget.includes(normCand)) {
      return true;
    }
    const candNum = extractVideoNumberToken(candidateTitle);
    const targetNum = extractVideoNumberToken(targetVideoName);
    if (candNum && targetNum && candNum === targetNum) {
      return true;
    }
    return false;
  }

  async function ensureGeminiSidebarOpen() {
    const sideCandidates = document.querySelectorAll(
      '[data-test-id="conversation"], .conversation-items-container, .conversations-container, bard-sidenav a[href*="/app/"]'
    );
    const hasVisibleSidebar = Array.from(sideCandidates).some((el) => isElementVisibleInDom(el));
    if (hasVisibleSidebar) return;

    const menuBtns = document.querySelectorAll(
      'button[data-test-id="side-nav-menu-button"], button[aria-label*="Main menu" i], button[aria-label*="Menú principal" i], button[aria-label*="Menu" i], button[aria-label*="Menú" i]'
    );
    for (const btn of menuBtns) {
      if (isElementVisibleInDom(btn)) {
        btn.click();
        await sleep(350);
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
      '.conversation.selected .conversation-title',
      '[aria-selected="true"] .conversation-title',
    ];
    for (const sel of headerSelectors) {
      const el = document.querySelector(sel);
      if (el && isElementVisibleInDom(el)) {
        const txt = (el.innerText || el.textContent || '').trim();
        if (txt && !/^google gemini$/i.test(txt)) return txt;
      }
    }
    const docTitle = (document.title || '').replace(/\s*-\s*Google Gemini$/i, '').trim();
    if (docTitle && !/^gemini$/i.test(docTitle) && !/^google gemini$/i.test(docTitle)) {
      return docTitle;
    }
    return '';
  }

  function findChatElementInSidebar(targetVideoName, targetChatUrl) {
    const targetChatId = extractChatIdFromUrl(targetChatUrl);
    const allItems = Array.from(
      document.querySelectorAll(
        '[data-test-id="conversation"], a[href*="/app/"], .conversation-items-container [role="button"], .conversation-items-container [role="listitem"], .conversations-container [role="button"], .chat-history-list [role="button"]'
      )
    );

    if (targetChatId) {
      for (const item of allItems) {
        const href = item.getAttribute('href') || item.querySelector?.('a')?.getAttribute('href') || '';
        const jslog = item.getAttribute('jslog') || '';
        if (href.includes(targetChatId) || jslog.includes(targetChatId)) {
          return item;
        }
      }
    }

    if (targetVideoName) {
      for (const item of allItems) {
        const txt = (item.innerText || item.textContent || '').trim();
        if (txt && doesTitleMatchTargetVideo(txt, targetVideoName)) {
          return item;
        }
      }
    }
    return null;
  }

  async function renameGeminiConversationInDom(newTitle, targetChatUrl, docId) {
    const cleanNewTitle = String(newTitle || '').trim();
    if (!cleanNewTitle) return false;

    try {
      await ensureGeminiSidebarOpen();

      // If targetChatUrl points to a specific conversation not currently active, click it in sidebar first
      const sidebarItem = findChatElementInSidebar(cleanNewTitle, targetChatUrl);
      const currentTitle = getActiveGeminiChatTitleInDom();
      if (currentTitle && normalizeCompareText(currentTitle) === normalizeCompareText(cleanNewTitle)) {
        chrome.runtime
          .sendMessage({
            type: 'GEMINI_CHAT_LINKED',
            docId,
            geminiChatUrl: window.location.href,
            geminiChatTitle: cleanNewTitle,
          })
          .catch(() => {});
        return true;
      }

      // 1. Try opening the conversation actions menu (top header title menu or sidebar 3-dots button)
      let renameMenuTrigger = null;
      if (sidebarItem && isElementVisibleInDom(sidebarItem)) {
        sidebarItem.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        sidebarItem.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await sleep(150);
        const container =
          sidebarItem.closest('.conversation-items-container, [role="listitem"], .conversation') ||
          sidebarItem.parentElement;
        if (container) {
          renameMenuTrigger = container.querySelector(
            'button[data-test-id="actions-menu-button"], button[aria-label*="More" i], button[aria-label*="Más" i], button[aria-label*="Opciones" i], button[mattooltip*="More" i], button[mattooltip*="Más" i]'
          );
        }
      }

      if (!renameMenuTrigger) {
        const topTitleBtn = document.querySelector(
          'button[data-test-id="conversation-title"], .conversation-title-container button, [data-test-id="conversation-actions-button"], button[aria-label*="Conversation actions" i], button[aria-label*="Acciones de la conversación" i]'
        );
        if (topTitleBtn && isElementVisibleInDom(topTitleBtn)) {
          renameMenuTrigger = topTitleBtn;
        }
      }

      if (renameMenuTrigger) {
        renameMenuTrigger.click();
        await sleep(300);
      }

      // 2. Find and click "Rename" / "Cambiar nombre" menu item or button
      const menuItems = Array.from(
        document.querySelectorAll(
          'button[data-test-id="rename-button"], [role="menuitem"], .mat-mdc-menu-item, button[aria-label*="Rename" i], button[aria-label*="Cambiar nombre" i]'
        )
      );
      let clickedRenameOption = false;
      for (const item of menuItems) {
        if (!isElementVisibleInDom(item)) continue;
        const txt = (item.innerText || item.textContent || '').trim().toLowerCase();
        const aria = (item.getAttribute('aria-label') || '').toLowerCase();
        const hasEditIcon = Boolean(
          item.querySelector('mat-icon[fonticon="edit"], mat-icon[data-mat-icon-name="edit"], mat-icon[fonticon="drive_file_rename_outline"]')
        );
        if (
          txt.includes('rename') ||
          txt.includes('cambiar nombre') ||
          txt.includes('renombrar') ||
          aria.includes('rename') ||
          aria.includes('cambiar nombre') ||
          hasEditIcon
        ) {
          item.click();
          clickedRenameOption = true;
          await sleep(320);
          break;
        }
      }

      if (!clickedRenameOption) return false;

      // 3. Find the rename text input inside the dialog or inline header
      const inputCandidates = Array.from(
        document.querySelectorAll(
          'input[data-test-id="rename-input"], .mat-mdc-dialog-container input, mat-dialog-container input, input[aria-label*="name" i], input[aria-label*="nombre" i], input[aria-label*="title" i], input[aria-label*="título" i], input[type="text"]'
        )
      ).filter((el) => isElementVisibleInDom(el));

      const renameInput = inputCandidates[0];
      if (!renameInput) return false;

      renameInput.focus();
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(renameInput, cleanNewTitle);
      } else {
        renameInput.value = cleanNewTitle;
      }
      renameInput.dispatchEvent(new Event('input', { bubbles: true }));
      renameInput.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(160);

      // 4. Click Save/Rename button in dialog or press Enter
      const saveBtns = Array.from(
        document.querySelectorAll(
          'button[data-test-id="confirm-button"], .mat-mdc-dialog-container button[type="submit"], mat-dialog-container button[color="primary"], .mat-mdc-dialog-actions button'
        )
      ).filter((b) => isElementVisibleInDom(b) && !b.disabled);

      let clickedSave = false;
      for (const btn of saveBtns) {
        const bTxt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        if (
          bTxt.includes('rename') ||
          bTxt.includes('cambiar') ||
          bTxt.includes('guardar') ||
          bTxt.includes('save') ||
          bTxt.includes('aceptar') ||
          bTxt.includes('ok')
        ) {
          btn.click();
          clickedSave = true;
          break;
        }
      }

      if (!clickedSave) {
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

      await sleep(350);
      chrome.runtime
        .sendMessage({
          type: 'GEMINI_CHAT_LINKED',
          docId,
          geminiChatUrl: window.location.href,
          geminiChatTitle: cleanNewTitle,
        })
        .catch(() => {});
      reportStatus(
        'COMPLETED',
        `✏️ Conversación de Gemini renombrada en tiempo real a "${cleanNewTitle}".`,
        { docId }
      );
      return true;
    } catch {
      return false;
    }
  }

  async function ensureCorrectVideoChatBeforePrompt(payload) {
    const targetVideoName = String(payload.videoName || '').trim();
    const targetChatUrl = String(payload.geminiChatUrl || '').trim();
    const notebookName = String(payload.notebookName || 'Huellas de la Humanidad').trim();
    const docId = payload.docId || '';

    if (!targetVideoName && !targetChatUrl) {
      return { isNewChat: false };
    }

    const currentChatId = extractChatIdFromUrl(window.location.href);
    const targetChatId = extractChatIdFromUrl(targetChatUrl);
    const currentDomTitle = getActiveGeminiChatTitleInDom();

    // Case 1: Already inside the exact linked chat URL or a chat whose title matches targetVideoName
    if (
      (targetChatId && currentChatId && targetChatId === currentChatId) ||
      (targetVideoName && currentDomTitle && doesTitleMatchTargetVideo(currentDomTitle, targetVideoName))
    ) {
      chrome.runtime
        .sendMessage({
          type: 'GEMINI_CHAT_LINKED',
          docId,
          geminiChatUrl: window.location.href,
          geminiChatTitle: targetVideoName || currentDomTitle,
        })
        .catch(() => {});

      if (
        targetVideoName &&
        currentDomTitle &&
        normalizeCompareText(currentDomTitle) !== normalizeCompareText(targetVideoName)
      ) {
        await renameGeminiConversationInDom(targetVideoName, window.location.href, docId);
      }
      return { isNewChat: false };
    }

    // Case 2: Search Gemini sidebar for an existing chat of this video (by URL or by Video Name / Number)
    await ensureGeminiSidebarOpen();
    const existingChatItem = findChatElementInSidebar(targetVideoName, targetChatUrl);
    if (existingChatItem) {
      reportStatus(
        'WORKING',
        `🔍 Cambiando automáticamente a la conversación de "${targetVideoName}" en Gemini...`,
        { stageNumber: payload.stageNumber }
      );
      existingChatItem.click();
      await sleep(1500);
      chrome.runtime
        .sendMessage({
          type: 'GEMINI_CHAT_LINKED',
          docId,
          geminiChatUrl: window.location.href,
          geminiChatTitle: targetVideoName,
        })
        .catch(() => {});
      return { isNewChat: false };
    }

    // Case 3: No chat exists yet for this video -> Open a new chat inside the Notebook "Huellas de la Humanidad"
    const existingMessagesInCurrentTab = getModelResponseElements().length;
    const normNotebook = normalizeCompareText(notebookName);

    // Look for Notebook / Gem / Project "Huellas de la Humanidad" in the sidebar
    const sidebarLinks = Array.from(
      document.querySelectorAll('a, button, [role="button"], [role="listitem"], [role="treeitem"]')
    );
    let notebookClicked = false;
    for (const el of sidebarLinks) {
      if (!isElementVisibleInDom(el)) continue;
      const txt = normalizeCompareText(el.innerText || el.textContent || '');
      if (txt === normNotebook || (txt.includes('huellas de la humanidad') && txt.length < 45)) {
        reportStatus(
          'WORKING',
          `📓 Entrando al Notebook "${notebookName}" para crear el chat de "${targetVideoName}"...`,
          { stageNumber: payload.stageNumber }
        );
        el.click();
        notebookClicked = true;
        await sleep(1200);
        break;
      }
    }

    // If current tab still has messages from another video (e.g. Video 76), click "New chat" / "Nuevo chat"
    if (!notebookClicked && (existingMessagesInCurrentTab > 0 || currentChatId)) {
      const newChatBtns = document.querySelectorAll(
        'button[data-test-id="new-chat-button"], a[data-test-id="new-chat-button"], button[aria-label*="New chat" i], button[aria-label*="Nuevo chat" i], button[aria-label*="Nueva conversación" i], a[href="/app"]'
      );
      for (const btn of newChatBtns) {
        if (isElementVisibleInDom(btn)) {
          reportStatus(
            'WORKING',
            `✨ Creando nueva conversación exclusiva para "${targetVideoName}"...`,
            { stageNumber: payload.stageNumber }
          );
          btn.click();
          await sleep(1200);
          break;
        }
      }
    }

    return { isNewChat: true };
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

        // 1B. Automatically detect/switch to the single conversation for this Video inside Notebook "Huellas de la Humanidad"
        const chatState = await ensureCorrectVideoChatBeforePrompt(payload);

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

          // If this was the first prompt of the video, capture the newly assigned chat URL and rename the chat to payload.videoName
          if (payload.videoName || payload.docId) {
            setTimeout(async () => {
              const chatId = extractChatIdFromUrl(window.location.href);
              if (chatId) {
                chrome.runtime
                  .sendMessage({
                    type: 'GEMINI_CHAT_LINKED',
                    docId: payload.docId,
                    geminiChatUrl: window.location.href,
                    geminiChatTitle: payload.videoName || getActiveGeminiChatTitleInDom(),
                  })
                  .catch(() => {});
                if (chatState && chatState.isNewChat && payload.videoName) {
                  await renameGeminiConversationInDom(
                    payload.videoName,
                    window.location.href,
                    payload.docId
                  );
                }
              }
            }, 3200);
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
      renameGeminiConversationInDom(msg.videoName, msg.geminiChatUrl, msg.docId).then((ok) => {
        sendResponse({ handled: ok });
      });
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

    return false;
  };
  window.__HUELLAS_GEMINI_MESSAGE_LISTENER__ = onRuntimeMessage;
  chrome.runtime.onMessage.addListener(onRuntimeMessage);

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
