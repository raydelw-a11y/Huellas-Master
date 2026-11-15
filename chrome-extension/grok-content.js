// ============================================================================
// HUELLAS MASTER — EXTERNAL GROK WEB BRIDGE (MODO 9 y MODO 10 MÁXIMO — FAST)
// Runs inside https://grok.com/ windows/tabs managed by background.js
// ============================================================================
(() => {
  if (window.__HUELLAS_GROK_MESSAGE_LISTENER__) {
    try {
      chrome.runtime.onMessage.removeListener(window.__HUELLAS_GROK_MESSAGE_LISTENER__);
    } catch {}
  }

  const sleep = (ms) => {
    const waitMs = Math.max(0, Number(ms) || 0);
    if (document.visibilityState === 'hidden' && typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
      return chrome.runtime
        .sendMessage({ type: 'HUELLAS_UNTHROTTLED_SLEEP', ms: waitMs })
        .then(() => undefined)
        .catch(() => new Promise((resolve) => setTimeout(resolve, waitMs)));
    }
    return new Promise((resolve) => setTimeout(resolve, waitMs));
  };

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function detectChallengeOrAuthBlock() {
    const url = window.location.href || '';
    if (/\/sign-in|\/sign-up|accounts\.x\.ai|x\.com\/i\/flow\/login/i.test(url)) {
      return 'Grok Web requiere iniciar sesión en Google Chrome (https://grok.com/).';
    }
    // Strict safety boundary: NEVER click, wait out, solve, or bypass any CAPTCHA / Cloudflare Turnstile / anti-bot gate
    const hasChallenge = Boolean(
      document.querySelector(
        'iframe[src*="challenges.cloudflare.com" i], iframe[src*="turnstile" i], iframe[src*="hcaptcha" i], iframe[src*="recaptcha" i], #challenge-running, #cf-challenge-running, #challenge-form, [data-testid*="captcha" i]'
      ) ||
        /just a moment\.\.\.|attention required|checking your browser|verify you are human|verificaci[oó]n/i.test(
          document.title || ''
        )
    );
    if (hasChallenge) {
      return 'Grok Web mostró una verificación de seguridad / Cloudflare Turnstile en el navegador. Complétala manualmente en Chrome.';
    }
    if (!findGrokComposer()) {
      const loginBtn = Array.from(document.querySelectorAll('button, a')).find((el) => {
        if (!isVisible(el)) return false;
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        return /^(log\s*in|sign\s*in|sign\s*up|iniciar\s+sesi[oó]n|registrarse|continue\s+with\s+google|continuar\s+con\s+google)$/i.test(
          t
        );
      });
      if (loginBtn) {
        return 'No hay sesión iniciada en Grok Web dentro del navegador donde está abierto Huellas Master (https://grok.com/). Inicia sesión allí e inténtalo de nuevo.';
      }
    }
    return '';
  }

  function findGrokComposer() {
    const selectors = [
      '[data-testid="chat-input"] div.ProseMirror[contenteditable="true"]',
      'div.tiptap.ProseMirror[contenteditable="true"]',
      '[data-testid="chat-input"] div[contenteditable="true"][role="textbox"]',
      'form[data-composer] div[contenteditable="true"]',
      'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'form[data-composer] textarea',
      'form textarea',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    }
    return null;
  }

  function findGrokModelButton() {
    const selectors = [
      'button[aria-label^="Modelo:" i]',
      'button[aria-label^="Model:" i]',
      'form[data-composer] button[aria-haspopup="menu"]',
    ];
    for (const sel of selectors) {
      const candidates = document.querySelectorAll(sel);
      for (const btn of candidates) {
        if (!isVisible(btn)) continue;
        const aria = (btn.getAttribute('aria-label') || '').trim();
        const txt = (btn.innerText || btn.textContent || '').replace(/\s+/g, ' ').trim();
        if (/attach|agrega|archivo|connect|conectar|cuenta|account|proyecto|project|chat/i.test(aria)) continue;
        if (/^modelo:|^model:/i.test(aria) || /^(fast|build|auto|expert|heavy|r[aá]pido|grok)\b/i.test(txt)) {
          return btn;
        }
      }
    }
    return null;
  }

  async function ensureGrokFastMode() {
    try {
      const modelBtn = findGrokModelButton();
      if (!modelBtn) return;

      const readLabel = () =>
        ((modelBtn.innerText || '') + ' ' + (modelBtn.getAttribute('aria-label') || ''))
          .replace(/\s+/g, ' ')
          .trim();

      if (/\b(fast|r[aá]pido)\b/i.test(readLabel())) {
        if (modelBtn.getAttribute('aria-expanded') === 'true') {
          document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
          );
          await sleep(100);
          if (modelBtn.getAttribute('aria-expanded') === 'true') {
            modelBtn.click();
            await sleep(100);
          }
        }
        return;
      }

      if (modelBtn.getAttribute('aria-expanded') !== 'true') {
        modelBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        modelBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        modelBtn.click();
        await sleep(220);
      }

      const fastItem = Array.from(
        document.querySelectorAll(
          '[role="menu"] [role="menuitemcheckbox"], [role="menu"] [role="menuitemradio"], [role="menu"] [role="menuitem"], [role="listbox"] [role="option"]'
        )
      ).find((el) => {
        if (!isVisible(el)) return false;
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        return /^(fast|r[aá]pido)\b/i.test(t);
      });

      if (fastItem) {
        fastItem.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        fastItem.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        fastItem.click();
        await sleep(180);
      }

      if (modelBtn.getAttribute('aria-expanded') === 'true') {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
        );
        await sleep(100);
      }
    } catch {}
  }

  function readDetectedModelLabel() {
    const modelBtn = findGrokModelButton();
    if (modelBtn && isVisible(modelBtn)) {
      const aria = (modelBtn.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
      const txt = (modelBtn.innerText || modelBtn.textContent || '').replace(/\s+/g, ' ').trim();
      if (aria && txt && !aria.toLowerCase().includes(txt.toLowerCase())) {
        return `Grok Web (${aria} · ${txt})`;
      }
      if (aria || txt) return `Grok Web (${aria || txt})`;
    }
    return 'Grok Web (grok.com)';
  }

  function findGrokSendButton() {
    const candidateSelectors = [
      'button[data-testid="chat-submit"]',
      'form[data-composer] button[type="submit"]',
      'button[aria-label="Enviar" i]',
      'button[aria-label*="Enviar mensaje" i]',
      'button[aria-label="Send" i]',
      'button[aria-label*="Send message" i]',
      'button[aria-label*="Submit" i]',
    ];
    for (const sel of candidateSelectors) {
      const btn = document.querySelector(sel);
      if (!btn || !isVisible(btn)) continue;
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;
      if (btn.getAttribute('aria-haspopup') === 'menu' || btn.getAttribute('aria-haspopup') === 'true') continue;
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (/model|modelo|attach|agrega|dictar|dictate|voz|voice|stop|detener/i.test(aria)) continue;
      return btn;
    }
    return null;
  }

  function getUserTurnCount() {
    return document.querySelectorAll('[data-testid="user-message"], div[data-message-author-role="user"]').length;
  }

  function isGrokStillGenerating() {
    const stopSelectors = [
      'button[data-testid="chat-stop"]',
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop" i]',
      'button[aria-label*="Detener" i]',
    ];
    for (const sel of stopSelectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (isVisible(el)) return true;
      }
    }
    return false;
  }

  function getGrokAssistantTurnElements() {
    const raw = Array.from(
      document.querySelectorAll('[data-testid="assistant-message"], div[data-message-author-role="assistant"]')
    );
    const unique = raw.filter((el, idx, arr) => el && arr.indexOf(el) === idx);
    return unique.filter((el, _i, arr) => !arr.some((other) => other !== el && other.contains(el)));
  }

  function extractCleanNodeText(rootEl) {
    if (!rootEl) return '';
    const clone = rootEl.cloneNode(true);
    clone
      .querySelectorAll(
        '[data-testid="conversation-trace-slot"], [data-testid="response-footer-actions"], [data-testid*="thinking" i], [data-testid*="thought" i], [class*="thinking" i], [class*="thought" i], [class*="reasoning" i], details, summary'
      )
      .forEach((el) => el.remove());
    clone
      .querySelectorAll(
        '.sr-only, button, [role="button"]:not(:has(pre)), [role="checkbox"], .copy-code-button, [data-testid*="copy" i], script, style, svg'
      )
      .forEach((el) => el.remove());
    clone.querySelectorAll('br').forEach((el) => el.replaceWith('\n'));
    clone.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, pre, tr, blockquote, hr').forEach((el) => {
      el.prepend('\n');
      el.append('\n');
    });
    return (clone.textContent || '')
      .replace(/^(?:\s*Grok\s*:?\s*\n)+/i, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function extractLatestGrokResponse() {
    const nodes = getGrokAssistantTurnElements();
    if (nodes.length === 0) return { count: 0, text: '', hasMarkdown: false, hasFinishActions: false };
    const lastNode = nodes[nodes.length - 1];
    const turnContainer =
      lastNode.closest('[id^="response-"], article') || lastNode.parentElement || lastNode;
    const footerActions = turnContainer.querySelector('[data-testid="response-footer-actions"]');
    const hasFinishActions = Boolean(
      (footerActions && isVisible(footerActions)) ||
        turnContainer.querySelector(
          'button[aria-label*="Copy" i], button[aria-label*="Copiar" i], button[aria-label*="Regenerate" i], button[aria-label*="Regenerar" i]'
        )
    );
    const mdSelector = '.response-content-markdown, .markdown, .prose';
    const rawMd = [
      ...(lastNode.matches && lastNode.matches(mdSelector) ? [lastNode] : []),
      ...Array.from(lastNode.querySelectorAll(mdSelector)),
    ];
    const markdownBlocks = rawMd.filter((n, _i, arr) => !arr.some((other) => other !== n && other.contains(n)));
    let text = '';
    if (markdownBlocks.length > 0) {
      text = markdownBlocks
        .map((b) => extractCleanNodeText(b))
        .filter(Boolean)
        .join('\n\n')
        .trim();
    }
    if (!text && hasFinishActions) {
      text = extractCleanNodeText(lastNode);
    }
    if (/^(?:thinking\.{0,3}|pensando\.{0,3}|razonando\.{0,3}|grok)$/i.test(text)) {
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
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
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

  const onGrokRuntimeMessage = (msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'GROK') return false;

    if (msg.action === 'ASK_EXTERNAL_GROK') {
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
                  type: 'EXTERNAL_GROK_ASK_RESULT',
                  requestId,
                  ok: false,
                  chatUrl: window.location.href,
                  error: blockReason,
                })
                .catch(() => {});
              return;
            }
            inputEl = findGrokComposer();
            if (inputEl) break;
            await sleep(350);
          }

          const finalBlockReason = detectChallengeOrAuthBlock();
          if (finalBlockReason || !inputEl) {
            chrome.runtime
              .sendMessage({
                type: 'EXTERNAL_GROK_ASK_RESULT',
                requestId,
                ok: false,
                chatUrl: window.location.href,
                error:
                  finalBlockReason ||
                  'No se encontró la caja de texto en Grok Web (verifica que tengas sesión iniciada en https://grok.com/).',
              })
              .catch(() => {});
            return;
          }

          await ensureGrokFastMode();
          const verifiedModel = readDetectedModelLabel();
          const initialCount = getGrokAssistantTurnElements().length;
          const initialLastText = (extractLatestGrokResponse().text || '').trim();
          const initialUserCount = getUserTurnCount();
          const initialUrl = window.location.href;

          const mainInjectRes = await chrome.runtime
            .sendMessage({
              type: 'GROK_MAIN_WORLD_INJECT_AND_SUBMIT',
              prompt: rawPrompt,
              autoSubmit: true,
            })
            .catch(() => null);
          const mainHandled = Boolean(mainInjectRes && mainInjectRes.ok);
          const normalizedTarget = String(rawPrompt || '').replace(/\s+/g, ' ').trim();
          const expectedPrefix = normalizedTarget.slice(0, Math.min(28, normalizedTarget.length));

          for (let attempt = 0; attempt < 14; attempt++) {
            await sleep(550);
            const curCount = getGrokAssistantTurnElements().length;
            const curUserCount = getUserTurnCount();
            if (
              isGrokStillGenerating() ||
              curCount > initialCount ||
              curUserCount > initialUserCount ||
              (/\/c\/[a-z0-9-]+/i.test(window.location.href) && window.location.href !== initialUrl)
            ) {
              break;
            }
            const curInput = findGrokComposer() || inputEl;
            const curText = String(curInput.value ?? curInput.innerText ?? curInput.textContent ?? '')
              .replace(/\s+/g, ' ')
              .trim();
            if (mainHandled && curText.length === 0 && attempt < 4) {
              continue;
            }
            if (!curText || (expectedPrefix && !curText.startsWith(expectedPrefix))) {
              setComposerTextDomFallback(curInput, rawPrompt);
              await sleep(220);
            }
            const sendBtn = findGrokSendButton();
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
                  type: 'EXTERNAL_GROK_ASK_RESULT',
                  requestId,
                  ok: false,
                  chatUrl: window.location.href,
                  error: blockMid,
                })
                .catch(() => {});
              return;
            }
            const curUserCount = getUserTurnCount();
            const latest = extractLatestGrokResponse();
            const latestText = (latest.text || '').trim();
            const waitingFirstAssistantChunk =
              curUserCount > initialUserCount && (!latestText || (!latest.hasMarkdown && !latest.hasFinishActions));
            const hasHardStopBtn = isGrokStillGenerating();
            const generating =
              (latest.hasFinishActions && !hasHardStopBtn ? false : hasHardStopBtn) || waitingFirstAssistantChunk;
            const hasNewTurn =
              latest.count > initialCount || (latestText.length > 0 && latestText !== initialLastText);
            const readyEnough = latest.hasFinishActions || latest.hasMarkdown ? latestText.length >= 2 : false;
            const neededStableTicks = latest.hasFinishActions ? 2 : 5;

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
                    type: 'EXTERNAL_GROK_ASK_RESULT',
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

          const finalFallback = (extractLatestGrokResponse().text || '').trim();
          chrome.runtime
            .sendMessage({
              type: 'EXTERNAL_GROK_ASK_RESULT',
              requestId,
              ok: finalFallback.length > 2,
              response: finalFallback,
              chatUrl: window.location.href,
              verifiedModel,
              error:
                finalFallback.length > 2 ? undefined : 'Timeout esperando respuesta completa en Grok Web.',
            })
            .catch(() => {});
        } catch (err) {
          chrome.runtime
            .sendMessage({
              type: 'EXTERNAL_GROK_ASK_RESULT',
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

  window.__HUELLAS_GROK_MESSAGE_LISTENER__ = onGrokRuntimeMessage;
  chrome.runtime.onMessage.addListener(onGrokRuntimeMessage);
})();
