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

  function watchForNewResponse(initialCount, initialLastText, meta) {
    if (activeWatchTimer) clearInterval(activeWatchTimer);

    let elapsedMs = 0;
    let stableTicks = 0;
    let lastObservedText = '';
    let hasStarted = false;

    reportStatus('GENERATING', 'Gemini Web está redactando la respuesta...', meta);

    activeWatchTimer = setInterval(() => {
      elapsedMs += 800;
      const responses = getModelResponseElements();
      const currentCount = responses.length;
      const latest = extractLatestGeminiResponse();
      const stillStreaming = isGeminiStillGenerating();

      if (
        stillStreaming ||
        currentCount > initialCount ||
        (latest.text && latest.text !== initialLastText)
      ) {
        hasStarted = true;
      }

      if (hasStarted && (latest.text || latest.images.length > 0)) {
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

        if (stableTicks >= 3) {
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

      // Timeout after 180 seconds
      if (elapsedMs >= 180000) {
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
    const inputEl = findPromptInput();
    if (!inputEl) {
      reportStatus(
        'ERROR',
        'No se encontró la caja de texto en Gemini Web. Asegúrate de haber iniciado sesión en gemini.google.com.'
      );
      return false;
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
        });
      }, 450);
    }

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
