// ============================================================================
// HUELLAS MASTER — EXTERNAL CHATGPT WEB BRIDGE (MODO CUATRO)
// Runs inside https://chatgpt.com/ windows/tabs managed by background.js
// ============================================================================
(() => {
  if (window.__HUELLAS_CHATGPT_MESSAGE_LISTENER__) {
    try {
      chrome.runtime.onMessage.removeListener(window.__HUELLAS_CHATGPT_MESSAGE_LISTENER__);
    } catch {}
  }

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
      'div[contenteditable="true"][role="textbox"]',
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
      'button[aria-label="Enviar" i]',
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

  function getUserTurnCount() {
    const legacy = document.querySelectorAll('[data-message-author-role="user"]').length;
    const unitKeys = document.querySelectorAll(
      '[data-chatgpt-search-unit-key$=":user"], [data-content-search-unit-key$=":user"]'
    ).length;
    const turnKeys = document.querySelectorAll('[data-turn-key]').length;
    return Math.max(legacy, unitKeys, turnKeys);
  }

  function isChatGptStillGenerating() {
    const stopSelectors = [
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop streaming" i]',
      'button[aria-label*="Stop generating" i]',
      'button[aria-label*="Stop" i]',
      'button[aria-label*="Detener" i]',
    ];
    for (const sel of stopSelectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (isVisible(el)) return true;
      }
    }
    if (document.querySelector('.result-streaming, [data-is-streaming="true"]')) {
      return true;
    }
    const turnStates = Array.from(document.querySelectorAll('[data-talvt-turn-state]'));
    if (turnStates.length > 0) {
      const lastState = (
        turnStates[turnStates.length - 1].getAttribute('data-talvt-turn-state') || ''
      )
        .trim()
        .toLowerCase();
      if (lastState && lastState !== 'complete' && lastState !== 'completed' && lastState !== 'done') {
        return true;
      }
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
    const raw = [
      ...Array.from(
        document.querySelectorAll(
          '[data-message-author-role="assistant"], article[data-testid^="conversation-turn-"] [data-message-author-role="assistant"], [data-chatgpt-search-unit-key$=":assistant"], [data-content-search-unit-key$=":assistant"]'
        )
      ),
      ...Array.from(document.querySelectorAll('[data-chatgpt-agent-turn-start]'))
        .map(
          (m) =>
            m.closest('article, [data-testid^="conversation-turn-"], [data-turn="assistant"]') ||
            m.parentElement
        )
        .filter(Boolean),
    ];
    const unique = raw.filter((el, idx, arr) => el && arr.indexOf(el) === idx);
    // Keep only outermost assistant containers so parent + child of the same turn are not counted twice
    return unique.filter((el, _i, arr) => !arr.some((other) => other !== el && other.contains(el)));
  }

  function extractCleanNodeText(rootEl) {
    if (!rootEl) return '';
    const clone = rootEl.cloneNode(true);
    clone
      .querySelectorAll(
        '.sr-only, button, [role="button"], [role="checkbox"], .copy-code-button, [data-testid*="copy" i], [data-testid*="thought" i], [data-chatgpt-agent-turn-start], script, style, svg'
      )
      .forEach((el) => el.remove());
    clone.querySelectorAll('br').forEach((el) => el.replaceWith('\n'));
    clone
      .querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, pre, tr, blockquote, hr')
      .forEach((el) => {
        el.prepend('\n');
        el.append('\n');
      });
    return (clone.textContent || '')
      .replace(/^(?:\s*(?:ChatGPT\s+(?:dijo|said))\s*:?\s*)+/i, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function extractLatestChatGptResponse() {
    const nodes = getAssistantTurnElements();
    if (nodes.length === 0) return { count: 0, text: '', hasMarkdown: false, hasFinishActions: false };
    const lastNode = nodes[nodes.length - 1];
    const turnArticle = lastNode.closest('article, [data-testid^="conversation-turn-"]') || lastNode;
    const hasFinishActions = Boolean(
      turnArticle.querySelector(
        'button[data-testid="copy-turn-action-button"], button[data-testid="good-response-turn-action-button"], button[data-testid="bad-response-turn-action-button"], button[aria-label*="Copy" i], button[aria-label*="Copiar" i]'
      )
    );
    const rawMd = [
      ...(lastNode.matches && lastNode.matches('.markdown, .prose') ? [lastNode] : []),
      ...Array.from(lastNode.querySelectorAll('.markdown, .prose')),
    ];
    const markdownBlocks = rawMd.filter(
      (n, _i, arr) => !arr.some((other) => other !== n && other.contains(n))
    );
    let text = '';
    if (markdownBlocks.length > 0) {
      text = markdownBlocks
        .map((b) => extractCleanNodeText(b))
        .filter(Boolean)
        .join('\n\n')
        .trim();
    }
    if (!text) {
      text = extractCleanNodeText(lastNode);
    }
    if (/^(?:\d{1,6}|thinking\.{0,3}|pensando\.{0,3}|razonando\.{0,3}|thought\s+for\s+[^\n]{1,40})$/i.test(text)) {
      text = '';
    }
    return {
      count: nodes.length,
      text,
      hasMarkdown: markdownBlocks.length > 0,
      hasFinishActions,
    };
  }

  function setComposerTextDomFallback(el, text) {
    if (!el) return;
    el.focus();
    const normalizedTarget = String(text || '').replace(/\s+/g, ' ').trim();
    const expectedPrefix = normalizedTarget.slice(0, Math.min(28, normalizedTarget.length));
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
      document.execCommand('delete', false);
    } catch {}
    if (((el.innerText || el.textContent || '').trim()).length > 0) {
      el.innerHTML = '<p><br></p>';
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    }
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', String(text || ''));
      el.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        })
      );
      const pastedNorm = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (pastedNorm && (!expectedPrefix || pastedNorm.startsWith(expectedPrefix))) {
        return;
      }
    } catch {}
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      const ok = document.execCommand('insertText', false, text);
      const curNorm = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (ok && curNorm && (!expectedPrefix || curNorm.startsWith(expectedPrefix))) {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        return;
      }
    } catch {}
    el.innerHTML = '';
    for (const line of String(text || '').split('\n')) {
      const p = document.createElement('p');
      if (line.length > 0) p.textContent = line;
      else p.appendChild(document.createElement('br'));
      el.appendChild(p);
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }

  const onChatGptRuntimeMessage = (msg, _sender, sendResponse) => {
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
          const initialUserCount = getUserTurnCount();
          const initialUrl = window.location.href;

          // Primary: hardware/MAIN-world injection & submit via background.js
          const mainInjectRes = await chrome.runtime
            .sendMessage({
              type: 'CHATGPT_MAIN_WORLD_INJECT_AND_SUBMIT',
              prompt: rawPrompt,
              autoSubmit: true,
            })
            .catch(() => null);
          const mainHandled = Boolean(mainInjectRes && mainInjectRes.ok);
          const normalizedTarget = String(rawPrompt || '').replace(/\s+/g, ' ').trim();
          const expectedPrefix = normalizedTarget.slice(0, Math.min(28, normalizedTarget.length));

          for (let attempt = 0; attempt < 14; attempt++) {
            await sleep(attempt === 0 ? 550 : 550);
            const curCount = getAssistantTurnElements().length;
            const curUserCount = getUserTurnCount();
            if (
              isChatGptStillGenerating() ||
              curCount > initialCount ||
              curUserCount > initialUserCount ||
              (/\/c\/[a-z0-9-]+/i.test(window.location.href) && window.location.href !== initialUrl)
            ) {
              break;
            }
            const curInput = findChatGptComposer() || inputEl;
            const curText = String(curInput.value ?? curInput.innerText ?? curInput.textContent ?? '')
              .replace(/\s+/g, ' ')
              .trim();
            // If mainInjectRes already clicked send and emptied the composer, give ChatGPT ~2.2s to transition to /c/... before re-typing
            if (mainHandled && curText.length === 0 && attempt < 4) {
              continue;
            }
            if (!curText || (expectedPrefix && !curText.startsWith(expectedPrefix))) {
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
            const curUserCount = getUserTurnCount();
            const latest = extractLatestChatGptResponse();
            const latestText = (latest.text || '').trim();
            const waitingFirstAssistantChunk = curUserCount > initialUserCount && !latestText;
            const generating = isChatGptStillGenerating() || waitingFirstAssistantChunk;
            const hasNewTurn =
              latest.count > initialCount || (latestText.length > 2 && latestText !== initialLastText);
            const readyEnough = latest.hasFinishActions ? latestText.length >= 12 : latestText.length >= 60;
            const neededStableTicks = latest.hasFinishActions ? 3 : 4;

            if (hasNewTurn && !generating && readyEnough) {
              if (latestText === lastSeenText) {
                stableDoneTicks += 1;
              } else {
                lastSeenText = latestText;
                stableDoneTicks = 1;
              }
              if (stableDoneTicks >= neededStableTicks) {
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
  };
  window.__HUELLAS_CHATGPT_MESSAGE_LISTENER__ = onChatGptRuntimeMessage;
  chrome.runtime.onMessage.addListener(onChatGptRuntimeMessage);
})();
