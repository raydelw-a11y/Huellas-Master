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

  // Allow replacing listener when updated
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
      'textarea',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
    ];
    for (const sel of selectors) {
      const candidates = Array.from(document.querySelectorAll(sel));
      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 80 && rect.height > 16) {
          return el;
        }
      }
    }
    return null;
  }

  function findFlowSubmitButtonNearInput(inputEl) {
    const inputRect = inputEl.getBoundingClientRect();

    // Walk up from inputEl to find the prompt bar container
    const containers = [];
    let curr = inputEl.parentElement;
    for (let depth = 0; depth < 7 && curr && curr !== document.body; depth++) {
      const rect = curr.getBoundingClientRect();
      if (rect.height > 0 && rect.height < 420 && rect.width >= inputRect.width) {
        containers.push(curr);
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
      'setting',
      'tune',
      'sliders',
      'attach',
      'upload',
      'add_photo',
      'image',
      'history',
      'delete',
      'clear',
      'close',
      'expand',
      'collapse',
      'more_vert',
      'more_horiz',
      'menu',
      'mic',
      'volume',
      'download',
      'share',
    ];

    const submitKeywords = [
      'arrow_upward',
      'arrow_forward',
      'send',
      'submit',
      'generate',
      'generar',
      'create',
      'crear',
      'auto_awesome',
      'spark',
      'play_arrow',
      'north',
      'east',
      'run',
      'produce',
    ];

    let bestBtn = null;
    let bestScore = -999;

    const searchRoots = containers.length > 0 ? containers : [document];

    for (const root of searchRoots) {
      const buttons = Array.from(root.querySelectorAll('button, [role="button"]'));
      for (const btn of buttons) {
        if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;
        const rect = btn.getBoundingClientRect();
        if (rect.width < 16 || rect.height < 16) continue;

        // Skip dropdown/menu triggers
        const hasPopup = btn.getAttribute('aria-haspopup');
        if (hasPopup === 'menu' || hasPopup === 'listbox' || hasPopup === 'dialog') continue;
        if (btn.hasAttribute('aria-expanded')) continue;

        const rawText = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        const ariaLabel = (
          btn.getAttribute('aria-label') ||
          btn.getAttribute('title') ||
          btn.getAttribute('data-tooltip') ||
          ''
        )
          .trim()
          .toLowerCase();
        const combined = `${rawText} ${ariaLabel}`;

        if (excludeWords.some((w) => combined.includes(w))) {
          continue;
        }

        let score = 0;

        if (btn.getAttribute('type') === 'submit') {
          score += 120;
        }

        for (const kw of submitKeywords) {
          if (rawText === kw || ariaLabel.includes(kw) || rawText.includes(kw)) {
            score += 90;
            break;
          }
        }

        // Check icon elements inside button
        const iconEls = btn.querySelectorAll('i, span, mat-icon, svg');
        for (const ic of iconEls) {
          const icText = (ic.textContent || ic.getAttribute('data-mat-icon-name') || '')
            .trim()
            .toLowerCase();
          if (submitKeywords.some((kw) => icText === kw || icText.includes(kw))) {
            score += 95;
            break;
          }
        }

        // Prefer buttons located on the right side of the prompt box
        if (rect.left >= inputRect.left + inputRect.width * 0.45) {
          score += 45;
        }
        // Prefer buttons vertically close to the prompt input
        if (Math.abs(rect.top - inputRect.top) < 160) {
          score += 30;
        }
        // Compact icon button (typical round submit arrow button in Google Flow)
        if (rect.width <= 72 && rect.height <= 72 && btn.querySelector('svg, i, span')) {
          score += 20;
        }

        if (score > bestScore) {
          bestScore = score;
          bestBtn = btn;
        }
      }

      if (bestBtn && bestScore >= 60) {
        return bestBtn;
      }
    }

    return bestScore > 0 ? bestBtn : null;
  }

  function setFlowInputText(inputEl, text) {
    inputEl.focus();
    inputEl.click();

    if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
      try {
        inputEl.select();
        document.execCommand('insertText', false, text);
      } catch {}

      if (inputEl.value !== text) {
        const proto =
          inputEl.tagName === 'TEXTAREA'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
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

    // Contenteditable div (Slate / ProseMirror / Lexical in Flow)
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(inputEl);
      selection.removeAllRanges();
      selection.addRange(range);
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
    const enterOpts = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
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
    const inputEl = findFlowPromptInput();
    if (!inputEl) {
      reportStatus(
        'ERROR',
        'No se encontró la caja de prompt en Google Flow. Asegúrate de estar dentro de tu proyecto en flow.google.com.'
      );
      return false;
    }

    setFlowInputText(inputEl, payload.prompt || '');
    reportStatus('PROMPT_INJECTED', 'Prompt pegado en Google Flow, enviando a producción...', {
      clipNumber: payload.clipNumber,
      mediaType: payload.mediaType,
    });

    if (payload.autoSubmit !== false) {
      let attempts = 0;
      const trySubmit = () => {
        attempts++;
        const genBtn = findFlowSubmitButtonNearInput(inputEl);
        if (genBtn) {
          triggerRealisticClick(genBtn);
          reportStatus(
            'GENERATING',
            '🎬 ¡Enviado a producción en Google Flow con tu cuota gratis!',
            {
              clipNumber: payload.clipNumber,
              mediaType: payload.mediaType,
            }
          );
          // Fallback: if after 450ms the input still has the full prompt text, also send Enter
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
          // Final fallback: press Enter inside inputEl
          triggerEnterKey(inputEl);
          reportStatus(
            'GENERATING',
            '🎬 Comando Enter enviado a Google Flow para iniciar producción.',
            { clipNumber: payload.clipNumber }
          );
        }
      };

      setTimeout(trySubmit, 350);
    }

    return true;
  }

  window.__HUELLAS_FLOW_MESSAGE_HANDLER__ = (msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'FLOW') return false;

    if (msg.action === 'SEND_PROMPT_V2') {
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
