// ============================================================================
// HUELLAS MASTER — GOOGLE FLOW CONTENT SCRIPT (flow.google.com / labs.google)
// Automates prompt injection, production submission, and video/image capture
// ============================================================================

(function () {
  // Always remove any old floating bar if present from an earlier version
  const oldBar = document.getElementById('huellas-flow-floating-bar');
  if (oldBar) {
    oldBar.remove();
  }

  // Replace previous listener if re-injected
  if (window.__HUELLAS_FLOW_MESSAGE_HANDLER__) {
    try {
      chrome.runtime.onMessage.removeListener(window.__HUELLAS_FLOW_MESSAGE_HANDLER__);
    } catch {}
  }

  function reportStatus(status, message, extra = {}) {
    chrome.runtime
      .sendMessage({
        type: 'BRIDGE_STATUS',
        service: 'FLOW',
        status,
        message,
        ...extra,
      })
      .catch(() => {});
  }

  function findFlowPromptInput() {
    const selectors = [
      'textarea[placeholder*="prompt" i]',
      'textarea[placeholder*="describe" i]',
      'textarea[placeholder*="generate" i]',
      'textarea[placeholder*="create" i]',
      'textarea[placeholder*="video" i]',
      'textarea[placeholder*="image" i]',
      'textarea[placeholder*="ask" i]',
      'textarea[placeholder*="type" i]',
      'textarea[placeholder*="genera" i]',
      'textarea[placeholder*="crea" i]',
      'textarea',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
    ];
    for (const sel of selectors) {
      const candidates = Array.from(document.querySelectorAll(sel));
      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 80 && rect.height > 14) {
          return el;
        }
      }
    }
    return null;
  }

  function getButtonDescriptor(btn) {
    const rawText = (btn.innerText || btn.textContent || '').trim().replace(/\s+/g, ' ');
    const aria =
      btn.getAttribute('aria-label') ||
      btn.getAttribute('title') ||
      btn.getAttribute('data-tooltip') ||
      '';
    return (aria || rawText || btn.tagName || 'submit').slice(0, 40);
  }

  function findFlowSubmitButtonsNearInput(inputEl) {
    const inputRect = inputEl.getBoundingClientRect();

    // Find the outermost prompt card container (up to 9 levels up, < 500px tall)
    let promptCard = null;
    let curr = inputEl.parentElement;
    for (let depth = 0; depth < 9 && curr && curr !== document.body; depth++) {
      const rect = curr.getBoundingClientRect();
      if (rect.height > 0 && rect.height < 500 && rect.width >= inputRect.width * 0.85) {
        promptCard = curr;
      }
      curr = curr.parentElement;
    }

    const excludeWords = [
      'ingredient',
      'frame',
      'model',
      'veo',
      'imagen',
      'ratio',
      '16:9',
      '9:16',
      '1:1',
      'setting',
      'ajustes',
      'config',
      'tune',
      'slider',
      'attach',
      'upload',
      'add_photo',
      'add_circle',
      'history',
      'delete',
      'borrar',
      'clear',
      'limpiar',
      'close',
      'cerrar',
      'cancel',
      'expand',
      'fullscreen',
      'open_in_full',
      'close_fullscreen',
      'collapse',
      'minimize',
      'more_vert',
      'more_horiz',
      'menu',
      'mic',
      'volume',
      'audio',
      'sound',
      'download',
      'share',
      'copy',
      'help',
      'info',
      'shuffle',
      'random',
      'casino',
      'undo',
      'redo',
      'back',
      '720p',
      '1080p',
      'text to video',
      'texto a video',
      'frames to video',
      'ingredients to video',
    ];

    const strongSubmitKeywords = [
      'arrow_upward',
      'arrow_forward',
      'send',
      'submit',
      'generate',
      'generar',
      'enviar',
      'producir',
      'play_arrow',
      'north',
      'east',
      'subdirectory_arrow_left',
    ];

    const mediumSubmitKeywords = ['create', 'crear', 'auto_awesome', 'spark', 'bolt', 'run'];

    // Gather all buttons inside promptCard; also include any buttons in document near inputEl
    const candidateSet = new Set();
    if (promptCard) {
      promptCard
        .querySelectorAll('button, [role="button"], input[type="submit"]')
        .forEach((b) => candidateSet.add(b));
    }
    document
      .querySelectorAll('button, [role="button"], input[type="submit"]')
      .forEach((b) => {
        const r = b.getBoundingClientRect();
        if (
          r.width >= 16 &&
          r.height >= 16 &&
          Math.abs(r.top - inputRect.top) < 220 &&
          r.left >= inputRect.left - 40 &&
          r.right <= inputRect.right + 260
        ) {
          candidateSet.add(b);
        }
      });

    let bestEnabledBtn = null;
    let bestEnabledScore = -999;
    let bestDisabledBtn = null;
    let bestDisabledScore = -999;

    for (const btn of candidateSet) {
      const rect = btn.getBoundingClientRect();
      if (rect.width < 16 || rect.height < 16) continue;

      const isDisabled = Boolean(
        btn.disabled ||
          btn.getAttribute('aria-disabled') === 'true' ||
          btn.hasAttribute('disabled')
      );

      const rawText = (btn.innerText || btn.textContent || '').trim().toLowerCase();
      const ariaLabel = [
        btn.getAttribute('aria-label'),
        btn.getAttribute('title'),
        btn.getAttribute('data-tooltip'),
        btn.getAttribute('name'),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      const iconTexts = [];
      btn.querySelectorAll('i, span, mat-icon, google-symbols, svg').forEach((ic) => {
        const t = (
          ic.textContent ||
          ic.getAttribute('data-mat-icon-name') ||
          ic.getAttribute('aria-label') ||
          ''
        )
          .trim()
          .toLowerCase();
        if (t) iconTexts.push(t);
      });

      const combined = `${rawText} ${ariaLabel} ${iconTexts.join(' ')}`.trim();

      const hasStrongSubmit =
        btn.getAttribute('type') === 'submit' ||
        strongSubmitKeywords.some(
          (kw) =>
            rawText === kw ||
            ariaLabel.includes(kw) ||
            iconTexts.some((ic) => ic === kw || ic.includes(kw))
        );

      if (!hasStrongSubmit) {
        const hasPopup = btn.getAttribute('aria-haspopup');
        if (
          hasPopup === 'menu' ||
          hasPopup === 'listbox' ||
          hasPopup === 'dialog' ||
          hasPopup === 'true'
        ) {
          continue;
        }
        if (btn.hasAttribute('aria-expanded')) continue;
        if (excludeWords.some((w) => combined.includes(w))) continue;
        // Skip small multiplier chips like "x1", "x2", "x4"
        if (/^x[1-8]$/.test(rawText)) continue;
      }

      let score = 0;

      if (btn.getAttribute('type') === 'submit') {
        score += 250;
      }

      if (hasStrongSubmit) {
        score += 220;
      } else if (
        mediumSubmitKeywords.some(
          (kw) =>
            rawText === kw ||
            ariaLabel.includes(kw) ||
            iconTexts.some((ic) => ic === kw || ic.includes(kw))
        )
      ) {
        score += 140;
      }

      // Must be on the right side of the prompt box to get positional submit bonus
      if (rect.left >= inputRect.left + inputRect.width * 0.45) {
        score += 65;
        // Favor the bottom-rightmost button inside the prompt bar
        const rightOffset = Math.max(0, Math.min(800, rect.right - inputRect.left));
        const bottomOffset = Math.max(0, Math.min(300, rect.bottom - inputRect.top));
        score += Math.round(rightOffset * 0.06) + Math.round(bottomOffset * 0.14);
      } else {
        score -= 40;
      }

      if (rect.width <= 88 && rect.height <= 68 && btn.querySelector('svg, i, span')) {
        score += 20;
      }

      if (!isDisabled) {
        if (score >= bestEnabledScore) {
          bestEnabledScore = score;
          bestEnabledBtn = btn;
        }
      } else {
        if (score >= bestDisabledScore) {
          bestDisabledScore = score;
          bestDisabledBtn = btn;
        }
      }
    }

    return {
      bestEnabledBtn,
      bestEnabledScore,
      bestDisabledBtn,
      bestDisabledScore,
    };
  }

  function setFlowInputText(inputEl, text) {
    inputEl.focus();
    inputEl.click();

    if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
      const proto =
        inputEl.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

      // Step 1: Always clear to empty string first and fire 'input' so React's _valueTracker
      // resets even if the same prompt text was already in the textarea!
      if (nativeSetter) {
        nativeSetter.call(inputEl, '');
      } else {
        inputEl.value = '';
      }
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));

      // Step 2: Try native Blink C++ Editor::InsertText via execCommand
      try {
        inputEl.focus();
        inputEl.select();
        document.execCommand('insertText', false, text);
      } catch {}

      // Step 3: Ensure value matches and dispatch full InputEvent + KeyboardEvent sequence
      if (inputEl.value !== text) {
        if (nativeSetter) {
          nativeSetter.call(inputEl, text);
        } else {
          inputEl.value = text;
        }
      }

      inputEl.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text,
        })
      );
      inputEl.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text,
        })
      );
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      inputEl.dispatchEvent(
        new KeyboardEvent('keyup', {
          key: ' ',
          code: 'Space',
          keyCode: 32,
          bubbles: true,
        })
      );
      return;
    }

    // Contenteditable div (Slate / ProseMirror / Lexical)
    try {
      inputEl.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(inputEl);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('delete', false, null);
      const inserted = document.execCommand('insertText', false, text);
      if (!inserted || !(inputEl.innerText || '').trim()) {
        inputEl.textContent = text;
      }
    } catch {
      inputEl.textContent = text;
    }

    inputEl.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text,
      })
    );
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function triggerRealisticClick(element) {
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const opts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX,
      clientY,
      button: 0,
      buttons: 1,
    };
    element.dispatchEvent(new PointerEvent('pointerdown', opts));
    element.dispatchEvent(new MouseEvent('mousedown', opts));
    element.dispatchEvent(new PointerEvent('pointerup', opts));
    element.dispatchEvent(new MouseEvent('mouseup', opts));
    element.click();
  }

  function triggerEnterKey(inputEl) {
    inputEl.focus();
    const enterOpts = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    inputEl.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
    inputEl.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
    const form = inputEl.closest('form');
    if (form) {
      try {
        form.requestSubmit();
      } catch {}
    }
  }

  function extractLatestFlowMedia() {
    const videos = Array.from(document.querySelectorAll('video'))
      .map((v) => v.src || v.querySelector('source')?.src || '')
      .filter(Boolean);

    const images = Array.from(document.querySelectorAll('img'))
      .filter((img) => {
        const w = img.naturalWidth || img.width || 0;
        const src = img.src || '';
        return src && !src.includes('avatar') && (w === 0 || w >= 180);
      })
      .map((img) => img.src);

    return { videos, images };
  }

  function handleSendFlowPrompt(payload) {
    // Deduplicate if both SEND_PROMPT and SEND_PROMPT_V2 arrive within 1.2s
    const now = Date.now();
    const lastTs = Number(
      document.documentElement.getAttribute('data-huellas-flow-cmd-ts') || '0'
    );
    if (now - lastTs < 1200) {
      return true;
    }
    document.documentElement.setAttribute('data-huellas-flow-cmd-ts', String(now));

    const promptText = payload.prompt || '';

    // Run after 60ms so if an older listener in an unrefreshed tab ran at t=0ms,
    // our reset + insert overrides it cleanly
    setTimeout(() => {
      const inputEl = findFlowPromptInput();
      if (!inputEl) {
        reportStatus(
          'ERROR',
          'No se encontró la caja de prompt en Google Flow. Asegúrate de haber entrado a tu proyecto en Google Flow.'
        );
        return;
      }

      setFlowInputText(inputEl, promptText);
      reportStatus('PROMPT_INJECTED', 'Prompt pegado en Google Flow, iniciando producción...', {
        clipNumber: payload.clipNumber,
        mediaType: payload.mediaType,
      });

      if (payload.autoSubmit === false) return;

      let attempts = 0;
      const trySubmit = () => {
        attempts++;
        const {
          bestEnabledBtn,
          bestEnabledScore,
          bestDisabledBtn,
          bestDisabledScore,
        } = findFlowSubmitButtonsNearInput(inputEl);

        // If the real submit button is still disabled while React updates state,
        // re-fire the input change and wait instead of clicking a wrong secondary button
        if (
          bestDisabledBtn &&
          bestDisabledScore > bestEnabledScore + 50 &&
          attempts <= 5
        ) {
          setFlowInputText(inputEl, promptText);
          setTimeout(trySubmit, 200);
          return;
        }

        if (bestEnabledBtn && bestEnabledScore >= 60) {
          const btnName = getButtonDescriptor(bestEnabledBtn);
          triggerRealisticClick(bestEnabledBtn);
          reportStatus(
            'GENERATING',
            `🎬 ¡Enviado a producción en Google Flow! (${btnName})`,
            {
              clipNumber: payload.clipNumber,
              mediaType: payload.mediaType,
            }
          );
          // Also send Enter after 450ms if the prompt is still sitting in the input box
          setTimeout(() => {
            const currentVal = (inputEl.value || inputEl.innerText || '').trim();
            if (currentVal && currentVal.length > 15) {
              triggerEnterKey(inputEl);
            }
          }, 450);
          return;
        }

        if (attempts < 8) {
          setTimeout(trySubmit, 200);
        } else {
          // Final fallback: force-enable bestDisabledBtn if present, click it, and send Enter
          if (bestDisabledBtn) {
            try {
              bestDisabledBtn.disabled = false;
              bestDisabledBtn.removeAttribute('disabled');
              bestDisabledBtn.removeAttribute('aria-disabled');
              triggerRealisticClick(bestDisabledBtn);
            } catch {}
          }
          triggerEnterKey(inputEl);
          reportStatus(
            'GENERATING',
            '🎬 Envío activado en Google Flow.',
            { clipNumber: payload.clipNumber }
          );
        }
      };

      setTimeout(trySubmit, 280);
    }, 60);

    return true;
  }

  window.__HUELLAS_FLOW_MESSAGE_HANDLER__ = (msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'FLOW') return false;

    // Support BOTH SEND_PROMPT and SEND_PROMPT_V2 so it works even before extension reload
    if (msg.action === 'SEND_PROMPT' || msg.action === 'SEND_PROMPT_V2') {
      const ok = handleSendFlowPrompt(msg);
      sendResponse({ handled: ok });
      return false;
    }

    if (msg.action === 'GRAB_LAST_MEDIA') {
      const media = extractLatestFlowMedia();
      chrome.runtime
        .sendMessage({
          type: 'FLOW_MEDIA_READY',
          clipNumber: msg.clipNumber,
          videos: media.videos,
          images: media.images,
        })
        .catch(() => {});
      sendResponse({ handled: true, ...media });
      return false;
    }

    return false;
  };

  chrome.runtime.onMessage.addListener(window.__HUELLAS_FLOW_MESSAGE_HANDLER__);
})();
