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
    // 1. Direct match for Google Flow's ProseMirror prompt box
    const proseMirror = document.querySelector(
      'div.ProseMirror[contenteditable="true"], div[role="textbox"][contenteditable="true"][aria-label*="create" i], div[role="textbox"][contenteditable="true"]'
    );
    if (proseMirror) {
      const r = proseMirror.getBoundingClientRect();
      if (r.width > 60 && r.height > 14) {
        return proseMirror;
      }
    }

    // 2. Fallback for textarea or other contenteditable inputs
    const allCandidates = Array.from(
      document.querySelectorAll(
        'div[contenteditable="true"], [role="textbox"][contenteditable="true"], textarea:not(.g-recaptcha-response)'
      )
    );
    let bestEl = null;
    let bestScore = -999999;

    for (const el of allCandidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 60 || rect.height < 14) continue;
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;

      let score = rect.bottom * 2 + rect.width;
      const placeholder = (
        el.getAttribute('placeholder') ||
        el.getAttribute('aria-label') ||
        ''
      ).toLowerCase();
      if (
        placeholder.includes('create') ||
        placeholder.includes('prompt') ||
        placeholder.includes('describe') ||
        placeholder.includes('generate') ||
        placeholder.includes('video') ||
        placeholder.includes('genera') ||
        placeholder.includes('crea')
      ) {
        score += 1000;
      }

      if (score > bestScore) {
        bestScore = score;
        bestEl = el;
      }
    }
    return bestEl;
  }

  function findExactFlowSubmitButton(inputEl) {
    // 1. Exact Google Flow submit button selectors verified from live DOM
    const directSelectors = [
      'flow-generate-icon-button button',
      'span.submit-button-slot button',
      '[submitbutton] button',
      'button.generate-icon-button',
      'button[aria-label="Start generation"]',
      'button[aria-label*="Start generation" i]',
      'button[aria-label*="Iniciar generación" i]',
      'button[type="submit"]',
    ];

    for (const sel of directSelectors) {
      const buttons = Array.from(document.querySelectorAll(sel));
      for (const btn of buttons) {
        const r = btn.getBoundingClientRect();
        if (r.width >= 16 && r.height >= 16 && r.top > 0) {
          return btn;
        }
      }
    }

    // 2. Fallback: find actual <button> (never a parent container!) with mat-icon 'arrow_forward' near inputEl
    const inputRect = inputEl ? inputEl.getBoundingClientRect() : { top: 600, left: 800 };
    const allButtons = Array.from(document.querySelectorAll('button'));
    for (const btn of allButtons) {
      const r = btn.getBoundingClientRect();
      if (r.width < 16 || r.height < 16 || r.top <= 0) continue;
      if (Math.abs(r.top - inputRect.top) > 250) continue;
      const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
      if (text === 'arrow_forward' || text === 'arrow_upward' || text === 'send') {
        return btn;
      }
    }

    return null;
  }

  function setFlowInputText(inputEl, text) {
    // If there is a 'Clear prompt' button and the box already has text, clear it cleanly first
    const existingText = (inputEl.value ?? inputEl.innerText ?? '').trim();
    if (existingText.length > 0) {
      const clearBtn = document.querySelector(
        'button.clear-button[aria-label="Clear prompt"], button.clear-button'
      );
      if (clearBtn) {
        try {
          clearBtn.click();
        } catch {}
      }
    }

    inputEl.focus();
    inputEl.click();

    if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
      const proto =
        inputEl.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

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

    // ProseMirror / Contenteditable div in Google Flow
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

  function clickFlowSubmitButton(btn) {
    const rect = btn.getBoundingClientRect();
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
    btn.dispatchEvent(new PointerEvent('pointerdown', opts));
    btn.dispatchEvent(new MouseEvent('mousedown', opts));
    btn.dispatchEvent(new PointerEvent('pointerup', opts));
    btn.dispatchEvent(new MouseEvent('mouseup', opts));
    btn.click();
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
        const submitBtn = findExactFlowSubmitButton(inputEl);

        if (submitBtn && !submitBtn.disabled && submitBtn.getAttribute('aria-disabled') !== 'true') {
          clickFlowSubmitButton(submitBtn);
          reportStatus(
            'GENERATING',
            '🎬 ¡Enviado a producción en Google Flow! (Start generation)',
            {
              clipNumber: payload.clipNumber,
              mediaType: payload.mediaType,
            }
          );
          return;
        }

        if (attempts < 8) {
          setTimeout(trySubmit, 180);
        } else if (submitBtn) {
          clickFlowSubmitButton(submitBtn);
          reportStatus(
            'GENERATING',
            '🎬 ¡Enviado a producción en Google Flow!',
            { clipNumber: payload.clipNumber }
          );
        }
      };

      setTimeout(trySubmit, 220);
    }, 50);

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
