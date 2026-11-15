// ============================================================================
// HUELLAS MASTER — EXTERNAL CLAUDE WEB BRIDGE (MODO OCHO y MODO NUEVE MÁXIMO)
// Runs inside https://claude.ai/ windows/tabs managed by background.js
// ============================================================================
(() => {
  if (window.__HUELLAS_CLAUDE_MESSAGE_LISTENER__) {
    try {
      chrome.runtime.onMessage.removeListener(window.__HUELLAS_CLAUDE_MESSAGE_LISTENER__);
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
    if (/\/login|\/signup|\/onboarding|auth\.anthropic\.com/i.test(url)) {
      return 'Claude Web requiere iniciar sesión en Google Chrome (https://claude.ai/).';
    }
    // Never interact with any CAPTCHA / Cloudflare Turnstile / anti-bot gate
    const hasChallenge = Boolean(
      document.querySelector(
        'iframe[src*="challenges.cloudflare.com" i], iframe[src*="turnstile" i], #challenge-running, #cf-challenge-running, #challenge-form, [data-testid*="captcha" i]'
      ) ||
      /just a moment\.\.\.|checking your browser|verify you are human|verificaci[oó]n/i.test(document.title || '')
    );
    if (hasChallenge) {
      return 'Claude Web mostró una verificación de seguridad / Turnstile en el navegador. Complétala manualmente en Chrome.';
    }
    const loginBtn = Array.from(document.querySelectorAll('button, a')).find((el) => {
      if (!isVisible(el)) return false;
      const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      return /^(log\s*in|sign\s*in|iniciar\s+sesi[oó]n|continue\s+with\s+google|continuar\s+con\s+google)$/i.test(t);
    });
    if (loginBtn) {
      return 'No hay sesión iniciada en Claude Web dentro del navegador donde está abierto Huellas Master (https://claude.ai/). Inicia sesión allí e inténtalo de nuevo.';
    }
    return '';
  }

  function findClaudeComposer() {
    const selectors = [
      'div.ProseMirror[contenteditable="true"]',
      'fieldset div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][data-placeholder]',
      '[data-testid="chat-input"]',
      'fieldset div[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'form textarea',
      'textarea',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    }
    return null;
  }

  function findClaudeSendButton() {
    const candidateSelectors = [
      'button[aria-label*="Send message" i]',
      'button[aria-label="Send" i]',
      'button[aria-label*="Enviar mensaje" i]',
      'button[aria-label="Enviar" i]',
      'button[data-testid="send-button"]',
    ];
    for (const sel of candidateSelectors) {
      const btn = document.querySelector(sel);
      if (!btn || !isVisible(btn)) continue;
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;
      if (btn.getAttribute('aria-haspopup') === 'menu' || btn.getAttribute('aria-haspopup') === 'true') continue;
      if (btn.hasAttribute('aria-expanded')) continue;
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (/model|style|attach|upload|file|thinking|search|voice|stop|detener|setting/i.test(aria)) continue;
      return btn;
    }
    return null;
  }

  function getUserTurnCount() {
    const userNodes = document.querySelectorAll(
      '[data-testid="user-message"], .font-user-message, div[data-message-author-role="user"]'
    );
    return userNodes.length;
  }

  function isClaudeStillGenerating() {
    const stopSelectors = [
      'button[aria-label*="Stop" i]',
      'button[aria-label*="Detener" i]',
      'button[aria-label*="Stop generating" i]',
      'button[data-testid="stop-button"]',
    ];
    for (const sel of stopSelectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (isVisible(el)) return true;
      }
    }
    if (document.querySelector('[data-is-streaming="true"], .result-streaming')) {
      return true;
    }
    return false;
  }

  function readDetectedModelLabel() {
    const selectors = [
      'button[data-testid="model-selector-dropdown"]',
      '[data-testid="model-selector-dropdown"]',
      'button[aria-haspopup="menu"]',
      'button[aria-label*="model" i]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) {
        const txt = (el.innerText || el.textContent || el.getAttribute('aria-label') || '')
          .replace(/\s+/g, ' ')
          .trim();
        if (/claude|sonnet|opus|haiku/i.test(txt)) return txt;
      }
    }
    return 'Claude Web (claude.ai)';
  }

  function getClaudeAssistantTurnElements() {
    const raw = Array.from(
      document.querySelectorAll(
        '.font-claude-message, .font-claude-response, [data-testid="assistant-message"], div[data-message-author-role="assistant"], [data-is-streaming="false"] .font-claude-message'
      )
    );
    const unique = raw.filter((el, idx, arr) => el && arr.indexOf(el) === idx);
    return unique.filter((el, _i, arr) => !arr.some((other) => other !== el && other.contains(el)));
  }

  function extractCleanNodeText(rootEl) {
    if (!rootEl) return '';
    const clone = rootEl.cloneNode(true);
    // Purge Extended Thinking accordions, reasoning sections and collapsible thought blocks
    clone
      .querySelectorAll(
        'button[aria-expanded], [data-testid*="thinking" i], [class*="thinking" i], [data-testid*="thought" i], [class*="thought" i], [class*="reasoning" i], details, summary'
      )
      .forEach((el) => {
        const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').toLowerCase();
        if (
          /thought|thinking|pensando|razonamiento|pens[oó]/i.test(t) ||
          el.matches('[data-testid*="thinking" i], [class*="thinking" i], [data-testid*="thought" i], [class*="thought" i], [class*="reasoning" i]')
        ) {
          el.remove();
        }
      });
    clone
      .querySelectorAll(
        '[data-testid*="thinking" i], [class*="thinking" i], [data-testid*="thought" i], [class*="thought" i], [class*="reasoning" i], [aria-label*="thought" i], [aria-label*="thinking" i], [aria-label*="razonamiento" i]'
      )
      .forEach((el) => el.remove());
    // Purge buttons, badges, copy tools and artifacts while protecting preformatted code
    clone
      .querySelectorAll(
        '.sr-only, button, [role="button"], [role="checkbox"], .copy-code-button, [data-testid*="copy" i], [data-testid*="artifact" i], script, style, svg'
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
      .replace(/^(?:\s*(?:Claude\s+(?:dijo|said))\s*:?\s*)+/i, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function extractLatestClaudeResponse() {
    const nodes = getClaudeAssistantTurnElements();
    if (nodes.length === 0) return { count: 0, text: '', hasMarkdown: false, hasFinishActions: false };
    const lastNode = nodes[nodes.length - 1];
    const turnArticle =
      lastNode.closest('article, [data-testid^="conversation-turn-"], [data-turn-key]') || lastNode;
    const hasFinishActions =
      lastNode.getAttribute('data-is-streaming') === 'false' ||
      Boolean(
        turnArticle.querySelector(
          'button[aria-label*="Copy" i], button[aria-label*="Copiar" i], button[aria-label*="Retry" i], button[data-testid*="action-bar" i]'
        )
      );
    const mdSelector = '.font-claude-message, .font-claude-response, .standard-markdown, .prose, .markdown';
    const rawMd = [
      ...(lastNode.matches && lastNode.matches(mdSelector) ? [lastNode] : []),
      ...Array.from(lastNode.querySelectorAll(mdSelector)),
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
    if (!text && hasFinishActions) {
      text = extractCleanNodeText(lastNode);
    }
    if (
      /^(?:\d{1,6}|thinking\.{0,3}|pensando\.{0,3}|razonando\.{0,3}|thought\s+for\s+[^\n]{1,40}|pens[oó]\s+durante\s+[^\n]{1,40})$/i.test(
        text
      ) ||
      (!markdownBlocks.length &&
        !hasFinishActions &&
        /(?:thought\s+for|thinking|pensando|razonando|pens[oó]\s+durante)/i.test(text))
    ) {
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

  const onClaudeRuntimeMessage = (msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'CLAUDE') return false;

    if (msg.action === 'ASK_EXTERNAL_CLAUDE') {
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
                  type: 'EXTERNAL_CLAUDE_ASK_RESULT',
                  requestId,
                  ok: false,
                  chatUrl: window.location.href,
                  error: blockReason,
                })
                .catch(() => {});
              return;
            }
            inputEl = findClaudeComposer();
            if (inputEl) break;
            await sleep(350);
          }

          const finalBlockReason = detectChallengeOrAuthBlock();
          if (finalBlockReason || !inputEl) {
            chrome.runtime
              .sendMessage({
                type: 'EXTERNAL_CLAUDE_ASK_RESULT',
                requestId,
                ok: false,
                chatUrl: window.location.href,
                error:
                  finalBlockReason ||
                  'No se encontró la caja de texto en Claude Web (verifica que tengas sesión iniciada en https://claude.ai/).',
              })
              .catch(() => {});
            return;
          }

          const verifiedModel = readDetectedModelLabel();
          const initialCount = getClaudeAssistantTurnElements().length;
          const initialLastText = (extractLatestClaudeResponse().text || '').trim();
          const initialUserCount = getUserTurnCount();
          const initialUrl = window.location.href;

          // Primary: hardware/MAIN-world injection & submit via background.js
          const mainInjectRes = await chrome.runtime
            .sendMessage({
              type: 'CLAUDE_MAIN_WORLD_INJECT_AND_SUBMIT',
              prompt: rawPrompt,
              autoSubmit: true,
            })
            .catch(() => null);
          const mainHandled = Boolean(mainInjectRes && mainInjectRes.ok);
          const normalizedTarget = String(rawPrompt || '').replace(/\s+/g, ' ').trim();
          const expectedPrefix = normalizedTarget.slice(0, Math.min(28, normalizedTarget.length));

          for (let attempt = 0; attempt < 14; attempt++) {
            await sleep(550);
            const curCount = getClaudeAssistantTurnElements().length;
            const curUserCount = getUserTurnCount();
            if (
              isClaudeStillGenerating() ||
              curCount > initialCount ||
              curUserCount > initialUserCount ||
              (/\/chat\/[a-z0-9-]+/i.test(window.location.href) && window.location.href !== initialUrl)
            ) {
              break;
            }
            const curInput = findClaudeComposer() || inputEl;
            const curText = String(curInput.value ?? curInput.innerText ?? curInput.textContent ?? '')
              .replace(/\s+/g, ' ')
              .trim();
            // If main injection already submitted and cleared composer, allow Claude ~2.2s to transition to /chat/...
            if (mainHandled && curText.length === 0 && attempt < 4) {
              continue;
            }
            if (!curText || (expectedPrefix && !curText.startsWith(expectedPrefix))) {
              setComposerTextDomFallback(curInput, rawPrompt);
              await sleep(220);
            }
            const sendBtn = findClaudeSendButton();
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
                  type: 'EXTERNAL_CLAUDE_ASK_RESULT',
                  requestId,
                  ok: false,
                  chatUrl: window.location.href,
                  error: blockMid,
                })
                .catch(() => {});
              return;
            }
            const curUserCount = getUserTurnCount();
            const latest = extractLatestClaudeResponse();
            const latestText = (latest.text || '').trim();
            const waitingFirstAssistantChunk =
              curUserCount > initialUserCount &&
              (!latestText || (!latest.hasMarkdown && !latest.hasFinishActions));
            const hasHardStopBtn = Boolean(
              isVisible(document.querySelector('button[aria-label*="Stop" i]')) ||
                isVisible(document.querySelector('button[data-testid="stop-button"]'))
            );
            const generating =
              (latest.hasFinishActions && !hasHardStopBtn
                ? false
                : isClaudeStillGenerating()) || waitingFirstAssistantChunk;
            const hasNewTurn =
              latest.count > initialCount || (latestText.length > 0 && latestText !== initialLastText);
            const readyEnough =
              latest.hasFinishActions || latest.hasMarkdown ? latestText.length >= 2 : false;
            const neededStableTicks = latest.hasFinishActions ? 2 : 6;

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
                    type: 'EXTERNAL_CLAUDE_ASK_RESULT',
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

          const finalFallback = (extractLatestClaudeResponse().text || '').trim();
          chrome.runtime
            .sendMessage({
              type: 'EXTERNAL_CLAUDE_ASK_RESULT',
              requestId,
              ok: finalFallback.length > 2,
              response: finalFallback,
              chatUrl: window.location.href,
              verifiedModel,
              error:
                finalFallback.length > 2
                  ? undefined
                  : 'Timeout esperando respuesta completa en Claude Web.',
            })
            .catch(() => {});
        } catch (err) {
          chrome.runtime
            .sendMessage({
              type: 'EXTERNAL_CLAUDE_ASK_RESULT',
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

  window.__HUELLAS_CLAUDE_MESSAGE_LISTENER__ = onClaudeRuntimeMessage;
  chrome.runtime.onMessage.addListener(onClaudeRuntimeMessage);
})();
