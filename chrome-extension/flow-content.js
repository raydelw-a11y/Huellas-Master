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
    let bestEl = null;
    let bestBottom = -1;
    for (const sel of selectors) {
      const candidates = Array.from(document.querySelectorAll(sel));
      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 80 && rect.height > 14 && rect.bottom > bestBottom) {
          bestBottom = rect.bottom;
          bestEl = el;
        }
      }
      if (bestEl) return bestEl;
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

    // Find the exact prompt bar container (not a full-screen wrapper)
    let promptCard = null;
    let curr = inputEl.parentElement;
    for (let depth = 0; depth < 8 && curr && curr !== document.body; depth++) {
      const rect = curr.getBoundingClientRect();
      const maxAllowedWidth = Math.max(inputRect.width + 380, inputRect.width * 1.75);
      if (
        rect.height >= inputRect.height &&
        rect.height <= 360 &&
        rect.width >= inputRect.width * 0.9 &&
        rect.width <= maxAllowedWidth
      ) {
        const btnCount = curr.querySelectorAll('button, [role="button"]').length;
        if (btnCount >= 1) {
          promptCard = curr;
        }
      }
      curr = curr.parentElement;
    }

    const strictExcludePhrases = [
      'text to video',
      'texto a video',
      'frames to video',
      'ingredients to video',
      '16:9',
      '9:16',
      '1:1',
      'veo 2',
      'veo 3',
      '720p',
      '1080p',
      'open_in_full',
      'close_fullscreen',
      'more_vert',
      'more_horiz',
      'settings',
      'ajustes',
      'configuración',
      'tune',
      'delete',
      'borrar',
      'clear',
      'limpiar',
      'close',
      'cerrar',
      'cancel',
      'upload',
      'attach',
      'add_photo',
      'add_circle',
      'history',
      'download',
      'share',
      'copy',
      'volume',
      'mic',
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
      'create',
      'crear',
    ];

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
          Math.abs(r.top - inputRect.top) < 200 &&
          r.left >= inputRect.left - 30 &&
          r.right <= inputRect.right + 280
        ) {
          candidateSet.add(b);
        }
      });

    const visibleCandidates = Array.from(candidateSet).filter((btn) => {
      const r = btn.getBoundingClientRect();
      return r.width >= 16 && r.height >= 16;
    });

    // Identify the bottom-rightmost button on the right half of the prompt bar
    const rightHalfButtons = visibleCandidates.filter((btn) => {
      const r = btn.getBoundingClientRect();
      return r.left >= inputRect.left + inputRect.width * 0.4 && r.top >= inputRect.top - 30;
    });

    let maxBottomInBar = -1;
    for (const b of rightHalfButtons) {
      const r = b.getBoundingClientRect();
      if (r.bottom > maxBottomInBar) maxBottomInBar = r.bottom;
    }

    // Bottom-row buttons on the right side (within 55px of the lowest button in the prompt bar)
    const bottomRowRightButtons = rightHalfButtons.filter((b) => {
      const r = b.getBoundingClientRect();
      return r.bottom >= maxBottomInBar - 55;
    });

    let bottomRightmostBtn = null;
    let maxRightCoord = -1;
    for (const b of bottomRowRightButtons) {
      const r = b.getBoundingClientRect();
      if (r.right >= maxRightCoord) {
        maxRightCoord = r.right;
        bottomRightmostBtn = b;
      }
    }

    let bestEnabledBtn = null;
    let bestEnabledScore = -999;
    let bestDisabledBtn = null;
    let bestDisabledScore = -999;

    for (const btn of visibleCandidates) {
      const rect = btn.getBoundingClientRect();
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
            rawText.includes(kw) ||
            ariaLabel.includes(kw) ||
            iconTexts.some((ic) => ic === kw || ic.includes(kw))
        );

      if (!hasStrongSubmit && btn !== bottomRightmostBtn) {
        const hasPopup = btn.getAttribute('aria-haspopup');
        if (
          hasPopup === 'menu' ||
          hasPopup === 'listbox' ||
          hasPopup === 'dialog' ||
          hasPopup === 'true'
        ) {
          continue;
        }
        if (strictExcludePhrases.some((w) => combined.includes(w))) continue;
        if (/^x[1-8]$/.test(rawText)) continue;
      }

      let score = 0;

      if (btn.getAttribute('type') === 'submit') {
        score += 300;
      }

      if (hasStrongSubmit) {
        score += 260;
      }

      // Huge bonus for being the bottom-rightmost button in the prompt bar
      if (btn === bottomRightmostBtn) {
        score += 220;
      }

      if (rect.left >= inputRect.left + inputRect.width * 0.45) {
        score += 65;
        const rightOffset = Math.max(0, Math.min(800, rect.right - inputRect.left));
        const bottomOffset = Math.max(0, Math.min(300, rect.bottom - inputRect.top));
        score += Math.round(rightOffset * 0.08) + Math.round(bottomOffset * 0.14);
      } else {
        score -= 50;
      }

      if (rect.width <= 96 && rect.height <= 72 && btn.querySelector('svg, i, span')) {
        score += 25;
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
      bottomRightmostBtn,
    };
  }

  function setFlowInputText(inputEl, text) {
    // If MAIN world already synced this exact text within the last 1.5s, do NOT reset it!
    const mainSyncTs = Number(
      document.documentElement.getAttribute('data-huellas-main-synced-ts') || '0'
    );
    const currentVal = (inputEl.value ?? inputEl.innerText ?? '').trim();
    if (Date.now() - mainSyncTs < 1500 && currentVal === text.trim()) {
      inputEl.focus();
      return;
    }

    inputEl.focus();
    inputEl.click();

    if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
      const proto =
        inputEl.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

      // Try native Blink C++ Editor::InsertText via execCommand first
      let insertedByExec = false;
      try {
        inputEl.focus();
        inputEl.select();
        insertedByExec = document.execCommand('insertText', false, text);
      } catch {}

      if (!insertedByExec || inputEl.value !== text) {
        if (nativeSetter) {
          nativeSetter.call(inputEl, text);
        } else {
          inputEl.value = text;
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
      return;
    }

    // Contenteditable div (Slate / ProseMirror / Lexical): never overwrite textContent directly
    try {
      inputEl.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(inputEl);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('insertText', false, text);
    } catch {}
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
    const deepTarget = document.elementFromPoint(clientX, clientY) || element;
    deepTarget.dispatchEvent(new PointerEvent('pointerdown', opts));
    deepTarget.dispatchEvent(new MouseEvent('mousedown', opts));
    deepTarget.dispatchEvent(new PointerEvent('pointerup', opts));
    deepTarget.dispatchEvent(new MouseEvent('mouseup', opts));
    deepTarget.dispatchEvent(new MouseEvent('click', opts));
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
    const now = Date.now();
    const lastTs = Number(
      document.documentElement.getAttribute('data-huellas-flow-cmd-ts') || '0'
    );
    if (now - lastTs < 1200) {
      return true;
    }
    document.documentElement.setAttribute('data-huellas-flow-cmd-ts', String(now));

    const promptText = payload.prompt || '';

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
          bottomRightmostBtn,
        } = findFlowSubmitButtonsNearInput(inputEl);

        const targetBtn = bestEnabledBtn || bottomRightmostBtn || bestDisabledBtn;

        if (targetBtn && (bestEnabledScore >= 60 || targetBtn === bottomRightmostBtn)) {
          const btnName = getButtonDescriptor(targetBtn);
          triggerRealisticClick(targetBtn);
          reportStatus(
            'GENERATING',
            `🎬 ¡Enviado a producción en Google Flow! (${btnName})`,
            {
              clipNumber: payload.clipNumber,
              mediaType: payload.mediaType,
            }
          );
          setTimeout(() => {
            const currentVal = (inputEl.value || inputEl.innerText || '').trim();
            if (currentVal && currentVal.length > 15) {
              triggerEnterKey(inputEl);
            }
          }, 400);
          return;
        }

        if (attempts < 6) {
          setTimeout(trySubmit, 200);
        } else {
          triggerEnterKey(inputEl);
          reportStatus(
            'GENERATING',
            '🎬 Envío activado en Google Flow.',
            { clipNumber: payload.clipNumber }
          );
        }
      };

      setTimeout(trySubmit, 250);
    }, 60);

    return true;
  }

  window.__HUELLAS_FLOW_MESSAGE_HANDLER__ = (msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'FLOW') return false;

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
