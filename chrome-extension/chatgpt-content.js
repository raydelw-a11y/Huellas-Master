// ============================================================================
// HUELLAS MASTER — EXTERNAL CHATGPT WEB BRIDGE (MODO CUATRO)
// Runs inside temporary https://chatgpt.com/ windows opened by background.js
// ============================================================================
(() => {
  if (window.__HUELLAS_CHATGPT_CONTENT_LOADED__) return;
  window.__HUELLAS_CHATGPT_CONTENT_LOADED__ = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function detectChallengeOrAuthBlock() {
    const url = window.location.href || '';
    if (/\/auth\/login|auth0\.openai\.com|auth\.openai\.com/i.test(url)) {
      return 'ChatGPT Web requiere iniciar sesión en Google Chrome (https://chatgpt.com/).';
    }
    // Never interact with any CAPTCHA / Cloudflare Turnstile / verification gate
    const hasChallenge = Boolean(
      document.querySelector(
        'iframe[src*="challenges.cloudflare.com" i], iframe[src*="turnstile" i], #challenge-running, #cf-challenge-running, [data-testid*="captcha" i]'
      )
    );
    if (hasChallenge) {
      return 'ChatGPT Web mostró una verificación de seguridad en el navegador. Complétala manualmente o usa el prompt copiable.';
    }
    const loginBtn = Array.from(document.querySelectorAll('button, a')).find((el) => {
      if (!isVisible(el)) return false;
      const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      const testId = el.getAttribute('data-testid') || '';
      return (
        testId === 'login-button' ||
        testId === 'welcome-login-button' ||
        /^(log\s*in|iniciar\s+sesi[oó]n)$/i.test(t)
      );
    });
    const composer = findChatGptComposer();
    if (loginBtn || /\/uc(\/|$|\?)/i.test(url)) {
      return 'No hay sesión iniciada en ChatGPT Web dentro del navegador donde está abierto Huellas Master (https://chatgpt.com/). Inicia sesión allí e inténtalo de nuevo.';
    }
    return '';
  }

  function findChatGptComposer() {
    const selectors = [
      '#prompt-textarea[contenteditable="true"]',
      'div#prompt-textarea',
      'textarea#prompt-textarea',
      'div.ProseMirror[contenteditable="true"]',
      '[data-testid="composer-text-input"] [contenteditable="true"]',
      'form textarea[placeholder]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    }
    return null;
  }

  function findSendButton() {
    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label*="Send prompt" i]',
      'button[aria-label*="Enviar mensaje" i]',
      'button[aria-label*="Enviar prompt" i]',
      'button[aria-label="Send" i]',
      'form button[type="submit"]',
    ];
    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && isVisible(btn) && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
        return btn;
      }
    }
    return null;
  }

  function isChatGptStillGenerating() {
    const stopSelectors = [
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop streaming" i]',
      'button[aria-label*="Stop generating" i]',
      'button[aria-label*="Detener" i]',
    ];
    for (const sel of stopSelectors) {
      if (isVisible(document.querySelector(sel))) return true;
    }
    if (document.querySelector('.result-streaming, [data-is-streaming="true"]')) {
      return true;
    }
    return false;
  }

  function readDetectedModelLabel() {
    const selectors = [
      'button[data-testid="model-switcher-dropdown-button"]',
      '[data-testid="model-switcher-dropdown-button"]',
      'button[aria-label*="Model selector" i]',
      'button[aria-label*="Selector de modelo" i]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) {
        const txt = (el.innerText || el.textContent || el.getAttribute('aria-label') || '')
          .replace(/\s+/g, ' ')
          .trim();
        if (txt) return txt;
      }
    }
    return 'ChatGPT Web';
  }

  function getAssistantTurnElements() {
    return Array.from(
      document.querySelectorAll(
        '[data-message-author-role="assistant"], article[data-testid^="conversation-turn-"] [data-message-author-role="assistant"]'
      )
    ).filter((el, idx, arr) => arr.indexOf(el) === idx);
  }

  function extractLatestChatGptResponse() {
    const nodes = getAssistantTurnElements();
    if (nodes.length === 0) return { count: 0, text: '' };
    const lastNode = nodes[nodes.length - 1];
    const markdownBlocks = Array.from(lastNode.querySelectorAll('.markdown, .prose')).filter(
      (n, _i, arr) => !arr.some((other) => other !== n && other.contains(n))
    );
    let text = '';
    if (markdownBlocks.length > 0) {
      text = markdownBlocks
        .map((b) => {
          const clone = b.cloneNode(true);
          clone
            .querySelectorAll('button, [role="button"], .copy-code-button, [data-testid*="copy" i]')
            .forEach((el) => el.remove());
          return (clone.innerText || clone.textContent || '').trim();
        })
        .filter(Boolean)
        .join('\n\n')
        .trim();
    } else {
      const clone = lastNode.cloneNode(true);
      clone
        .querySelectorAll('button, [role="button"], [data-testid*="thought" i]')
        .forEach((el) => el.remove());
      text = (clone.innerText || clone.textContent || '').trim();
    }
    return { count: nodes.length, text };
  }

  function setComposerTextDomFallback(el, text) {
    if (!el) return;
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      const ok = document.execCommand('insertText', false, text);
      if (ok && (el.innerText || '').trim().length > 0) {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        return;
      }
    } catch {}
    el.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = text;
    el.appendChild(p);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'CHATGPT') return false;

    if (msg.action === 'ASK_EXTERNAL_CHATGPT') {
      const requestId = String(msg.requestId || '').trim();
      const rawPrompt = String(msg.prompt || '').trim();
      sendResponse({ handled: true, requestId });

      (async () => {
        try {
          let inputEl = null;
          for (let i = 0; i < 35; i++) {
            const blockReason = detectChallengeOrAuthBlock();
            if (blockReason && i >= 4) {
              chrome.runtime
                .sendMessage({
                  type: 'EXTERNAL_CHATGPT_ASK_RESULT',
                  requestId,
                  ok: false,
                  chatUrl: window.location.href,
                  error: blockReason,
                })
                .catch(() => {});
              return;
            }
            inputEl = findChatGptComposer();
            if (inputEl) break;
            await sleep(350);
          }

          const finalBlockReason = detectChallengeOrAuthBlock();
          if (finalBlockReason || !inputEl) {
            chrome.runtime
              .sendMessage({
                type: 'EXTERNAL_CHATGPT_ASK_RESULT',
                requestId,
                ok: false,
                chatUrl: window.location.href,
                error:
                  finalBlockReason ||
                  'No se encontró la caja de texto en ChatGPT Web (verifica que tengas sesión iniciada en https://chatgpt.com/).',
              })
              .catch(() => {});
            return;
          }

          const verifiedModel = readDetectedModelLabel();
          const initialCount = getAssistantTurnElements().length;
          const initialLastText = (extractLatestChatGptResponse().text || '').trim();
          const initialUserCount = document.querySelectorAll('[data-message-author-role="user"]').length;

          // Primary: hardware/MAIN-world injection & submit via background.js
          await chrome.runtime
            .sendMessage({
              type: 'CHATGPT_MAIN_WORLD_INJECT_AND_SUBMIT',
              prompt: rawPrompt,
              autoSubmit: true,
            })
            .catch(() => {});

          for (let attempt = 0; attempt < 14; attempt++) {
            await sleep(attempt === 0 ? 500 : 550);
            const curCount = getAssistantTurnElements().length;
            const curUserCount = document.querySelectorAll('[data-message-author-role="user"]').length;
            if (
              isChatGptStillGenerating() ||
              curCount > initialCount ||
              curUserCount > initialUserCount
            ) {
              break;
            }
            const curInput = findChatGptComposer() || inputEl;
            const curText = (curInput.value ?? curInput.innerText ?? '').trim();
            if (curText.length < 3) {
              setComposerTextDomFallback(curInput, rawPrompt);
              await sleep(220);
            }
            const sendBtn = findSendButton();
            if (sendBtn) {
              try {
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
            const blockMid = detectChallengeOrAuthBlock();
            if (blockMid) {
              chrome.runtime
                .sendMessage({
                  type: 'EXTERNAL_CHATGPT_ASK_RESULT',
                  requestId,
                  ok: false,
                  chatUrl: window.location.href,
                  error: blockMid,
                })
                .catch(() => {});
              return;
            }
            const generating = isChatGptStillGenerating();
            const latest = extractLatestChatGptResponse();
            const latestText = (latest.text || '').trim();
            const hasNewTurn =
              latest.count > initialCount || (latestText.length > 2 && latestText !== initialLastText);

            if (hasNewTurn && !generating && latestText.length > 2) {
              if (latestText === lastSeenText) {
                stableDoneTicks += 1;
              } else {
                lastSeenText = latestText;
                stableDoneTicks = 1;
              }
              if (stableDoneTicks >= 3) {
                chrome.runtime
                  .sendMessage({
                    type: 'EXTERNAL_CHATGPT_ASK_RESULT',
                    requestId,
                    ok: true,
                    response: latestText,
                    chatUrl: window.location.href,
                    verifiedModel,
                  })
                  .catch(() => {});
                return;
              }
            } else {
              lastSeenText = latestText;
              stableDoneTicks = 0;
            }
          }

          const finalFallback = (extractLatestChatGptResponse().text || '').trim();
          chrome.runtime
            .sendMessage({
              type: 'EXTERNAL_CHATGPT_ASK_RESULT',
              requestId,
              ok: finalFallback.length > 2,
              response: finalFallback,
              chatUrl: window.location.href,
              verifiedModel,
              error:
                finalFallback.length > 2
                  ? undefined
                  : 'Timeout esperando respuesta completa en ChatGPT Web.',
            })
            .catch(() => {});
        } catch (err) {
          chrome.runtime
            .sendMessage({
              type: 'EXTERNAL_CHATGPT_ASK_RESULT',
              requestId,
              ok: false,
              chatUrl: window.location.href,
              error: String(err?.message || err),
            })
            .catch(() => {});
        }
      })();
      return false;
    }
    return false;
  });
})();
