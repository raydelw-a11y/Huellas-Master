// ============================================================================
// HUELLAS MASTER — EXTERNAL MICROSOFT COPILOT WEB BRIDGE (MODO CINCO)
// Runs inside https://copilot.microsoft.com/ and https://copilot.com/ tabs
// ============================================================================
(() => {
  if (window.__HUELLAS_COPILOT_MESSAGE_LISTENER__) {
    try {
      chrome.runtime.onMessage.removeListener(window.__HUELLAS_COPILOT_MESSAGE_LISTENER__);
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

  function deepQueryAll(selector, root = document) {
    const results = [];
    const seen = new Set();
    const visit = (node) => {
      if (!node) return;
      try {
        const matched = node.querySelectorAll ? node.querySelectorAll(selector) : [];
        for (const el of matched) {
          if (!seen.has(el)) {
            seen.add(el);
            results.push(el);
          }
        }
      } catch {}
      try {
        const all = node.querySelectorAll ? node.querySelectorAll('*') : [];
        for (const el of all) {
          if (el.shadowRoot) visit(el.shadowRoot);
        }
      } catch {}
    };
    visit(root);
    return results;
  }

  function detectChallengeOrAuthBlock() {
    const url = window.location.href || '';
    if (/login\.live\.com|login\.microsoftonline\.com|account\.microsoft\.com\/auth|\/login\?/i.test(url)) {
      return 'No hay sesión iniciada en Microsoft Copilot Web dentro de Google Chrome. Inicia sesión en la pestaña abierta de Copilot (https://m365.cloud.microsoft/chat o https://copilot.com/) e inténtalo de nuevo.';
    }
    if (
      document.querySelector('link[href*="unauth-copilotcom" i], script[src*="unauth-copilotcom" i]') ||
      (/copilot\.com\/([a-z]{2}-[a-z]{2,}\/?)?$/i.test(url) &&
        /\b(iniciar\s+sesi[oó]n|sign\s*in)\b/i.test(document.title || '') &&
        !findCopilotComposer())
    ) {
      return 'No hay sesión iniciada en Microsoft Copilot Web dentro de Google Chrome (Microsoft Copilot requiere sesión gratuita iniciada). Inicia sesión en la pestaña de Copilot y avísame.';
    }
    // Never interact with any CAPTCHA / Cloudflare Turnstile / anti-bot challenge
    const bodyTxt = document.body ? document.body.innerText || '' : '';
    const hasChallenge =
      Boolean(
        document.querySelector(
          'iframe[src*="challenges.cloudflare.com" i], iframe[src*="turnstile" i], iframe[src*="arkoselabs" i], iframe[src*="hcaptcha" i], #challenge-running, #cf-challenge-running, [data-testid*="captcha" i]'
        )
      ) || /\b(verificaci[oó]n\s+necesaria|verification\s+required|verify\s+you\s+are\s+human)\b/i.test(bodyTxt);
    if (hasChallenge) {
      return 'Microsoft Copilot Web mostró una verificación de seguridad/anti-bot ("Verificación necesaria") en el navegador. Complétala manualmente en Chrome.';
    }
    return '';
  }

  function dismissFirstRunBanners() {
    try {
      document
        .querySelectorAll(
          'button[data-testid="fre-text-forward-close-button"], button[aria-label="Descartar alerta" i], button[aria-label="Dismiss alert" i]'
        )
        .forEach((b) => {
          if (isVisible(b)) b.click();
        });
    } catch {}
  }

  function findCopilotComposer() {
    dismissFirstRunBanners();
    const selectors = [
      '#m365-chat-editor-target-element',
      '#m365-chat-input-shared-id',
      'span#m365-chat-editor-target-element[role="textbox"]',
      'textarea#userInput',
      'textarea[data-testid="composer-input"]',
      'textarea[data-testid*="composer" i]',
      'textarea[data-testid*="chat-input" i]',
      '[data-testid*="chat-input" i] [contenteditable="true"]',
      '[data-testid*="composer" i] [contenteditable="true"]',
      'textarea[placeholder*="Copilot" i]',
      'textarea[placeholder*="Message" i]',
      'textarea[placeholder*="Mensaje" i]',
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="Pregunta" i]',
      '#userInput[contenteditable="true"]',
      '[data-testid="composer-input"][contenteditable="true"]',
      'div[role="textbox"][contenteditable="true"]',
      'span[role="textbox"][contenteditable="true"]',
      'span[role="textbox"]',
      'textarea',
    ];
    for (const sel of selectors) {
      const candidates = deepQueryAll(sel);
      for (const el of candidates) {
        if (isVisible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true') {
          return el;
        }
      }
    }
    return null;
  }

  function findSendButton() {
    const selectors = [
      'button.fai-SendButton',
      'button.fai-BebopLiteChatInput__send',
      'button[data-testid="submit-button"]',
      'button[aria-label="Submit message" i]',
      'button[aria-label*="Submit message" i]',
      'button[aria-label*="Send message" i]',
      'button[aria-label*="Enviar mensaje" i]',
      'button[aria-label="Send" i]',
      'button[aria-label="Enviar" i]',
      'button[title*="Submit" i]',
      'button[title*="Send" i]',
      'button[title*="Enviar" i]',
      'button[type="submit"][aria-label*="Enviar" i]',
      'button[type="submit"][aria-label*="Send" i]',
      'form button[type="submit"]',
    ];
    for (const sel of selectors) {
      const candidates = deepQueryAll(sel);
      for (const btn of candidates) {
        if (isVisible(btn) && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
          return btn;
        }
      }
    }
    return null;
  }

  function isCopilotStillGenerating() {
    const stopSelectors = [
      'button.fai-SendButton[aria-label*="Detener" i]',
      'button.fai-SendButton[aria-label*="Stop" i]',
      'button.fai-SendButton[title*="Detener" i]',
      'button.fai-SendButton[title*="Stop" i]',
      'button[data-testid="stop-button"]',
      'button[aria-label="Stop responding" i]',
      'button[aria-label*="Stop responding" i]',
      'button[aria-label*="Stop generating" i]',
      'button[aria-label*="Detener" i]',
      'button[title*="Stop" i]',
      'button[title*="Detener" i]',
    ];
    for (const sel of stopSelectors) {
      const els = deepQueryAll(sel);
      for (const el of els) {
        if (isVisible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true') {
          return true;
        }
      }
    }
    if (
      document.querySelector(
        '[data-is-streaming="true"], [aria-busy="true"][data-content="ai-message"], [aria-busy="true"][class*="fai-" i]'
      )
    ) {
      return true;
    }
    return false;
  }

  function readDetectedModelLabel() {
    const selectors = [
      'button[aria-label*="Selector de modelos" i]',
      'button[aria-label*="Model selector" i]',
      'button[data-testid*="mode-selector" i]',
      'button[data-testid*="model-selector" i]',
      'button[data-testid*="composer-mode" i]',
      'button[aria-label*="Think Deeper" i]',
      'button[aria-label*="Quick response" i]',
      'button[aria-label*="Smart" i]',
    ];
    for (const sel of selectors) {
      const els = deepQueryAll(sel);
      for (const el of els) {
        if (isVisible(el)) {
          const txt = (el.innerText || el.textContent || el.getAttribute('aria-label') || '')
            .replace(/\s+/g, ' ')
            .trim();
          if (txt && txt.length <= 50) return `Microsoft Copilot Web (${txt})`;
        }
      }
    }
    return 'Microsoft Copilot Web';
  }

  function getUserTurnCount() {
    const els = deepQueryAll(
      '[data-content="user-message"], [data-testid="user-message"], [data-testid*="user-message" i], [data-author="user"], [data-message-author-role="user"], [class*="fai-UserMessage" i], [class*="UserMessage" i], cib-message-group[source="user"]'
    );
    const unique = els.filter((el, idx, arr) => el && arr.indexOf(el) === idx);
    const outermost = unique.filter((el, _i, arr) => !arr.some((other) => other !== el && other.contains(el)));
    return outermost.length;
  }

  function getAssistantTurnElements() {
    const raw = deepQueryAll(
      '[data-content="ai-message"], [data-testid="ai-message"], [data-testid="bot-message"], [data-testid*="copilot-message" i], [data-testid*="assistant-message" i], [class*="fai-CopilotMessage" i], [class*="CopilotMessage" i], [class*="fai-BotMessage" i], [class*="fai-AgentMessage" i], [role="article"][aria-label*="Copilot" i], div[class*="group/ai-message-item"], div[class*="group/ai-message"], [data-message-author-role="assistant"], cib-message-group[source="bot"]'
    );
    const unique = raw.filter((el, idx, arr) => el && arr.indexOf(el) === idx);
    return unique.filter((el, _i, arr) => !arr.some((other) => other !== el && other.contains(el)));
  }

  function extractCleanNodeText(rootEl) {
    if (!rootEl) return '';
    const clone = rootEl.cloneNode(true);
    clone
      .querySelectorAll(
        '.sr-only, button, [role="button"], [role="toolbar"], [role="menu"], nav, sup, .copy-code-button, [data-testid*="copy" i], [data-testid*="reaction" i], [data-testid*="feedback" i], [data-testid*="citation" i], [data-testid*="source" i], [data-testid*="suggestion" i], [data-testid*="followup" i], [class*="followup" i], [class*="citation" i], script, style, svg'
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
      .replace(/^(?:\s*(?:Copilot\s*(?:said|dijo)?)\s*:?\s*)+/i, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function extractLatestCopilotResponse() {
    const nodes = getAssistantTurnElements();
    if (nodes.length === 0) {
      return { count: 0, text: '', hasFinishActions: false };
    }
    const lastNode = nodes[nodes.length - 1];
    const hasFinishActions = Boolean(
      lastNode.querySelector(
        'button[aria-label*="Copy" i], button[aria-label*="Copiar" i], button[data-testid*="copy" i], button[aria-label*="Like" i], button[aria-label*="Thumbs" i], button[data-testid*="reaction" i], button[data-testid*="feedback" i]'
      )
    );
    const mdSelector = '[class*="markdown" i], [class*="prose" i], [data-testid*="markdown" i]';
    const rawMd = [
      ...(lastNode.matches && lastNode.matches(mdSelector) ? [lastNode] : []),
      ...Array.from(lastNode.querySelectorAll ? lastNode.querySelectorAll(mdSelector) : []),
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
    if (/^(?:thinking\.{0,3}|pensando\.{0,3}|razonando\.{0,3}|searching\.{0,3}|buscando\.{0,3}|generating\.{0,3})$/i.test(text)) {
      text = '';
    }
    return {
      count: nodes.length,
      text,
      hasFinishActions,
    };
  }

  function setComposerTextDomFallback(el, text) {
    if (!el) return;
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto =
        el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      const tracker = el._valueTracker;
      if (tracker && typeof tracker.setValue === 'function') {
        try {
          tracker.setValue('');
        } catch {}
      }
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
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
      if (((el.innerText || el.textContent || '').trim()).length >= Math.min(8, String(text || '').length)) {
        return;
      }
    } catch {}
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    } catch {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
  }

  const onCopilotRuntimeMessage = (msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'COPILOT') return false;
    if (window !== window.top && !findCopilotComposer()) return false;

    if (msg.action === 'ASK_EXTERNAL_COPILOT') {
      const requestId = String(msg.requestId || '').trim();
      const rawPrompt = String(msg.prompt || '').trim();
      sendResponse({ handled: true, requestId });

      (async () => {
        try {
          let inputEl = null;
          for (let i = 0; i < 40; i++) {
            const blockReason = detectChallengeOrAuthBlock();
            if (blockReason && i >= 4) {
              chrome.runtime
                .sendMessage({
                  type: 'EXTERNAL_COPILOT_ASK_RESULT',
                  requestId,
                  ok: false,
                  chatUrl: window.location.href,
                  error: blockReason,
                })
                .catch(() => {});
              return;
            }
            inputEl = findCopilotComposer();
            if (inputEl) break;
            await sleep(350);
          }

          const finalBlockReason = detectChallengeOrAuthBlock();
          if (finalBlockReason || !inputEl) {
            chrome.runtime
              .sendMessage({
                type: 'EXTERNAL_COPILOT_ASK_RESULT',
                requestId,
                ok: false,
                chatUrl: window.location.href,
                error:
                  finalBlockReason ||
                  'No se encontró la caja de texto en Microsoft Copilot Web (verifica https://copilot.microsoft.com/ en Chrome).',
              })
              .catch(() => {});
            return;
          }

          const verifiedModel = readDetectedModelLabel();
          const initialCount = getAssistantTurnElements().length;
          const initialLastText = (extractLatestCopilotResponse().text || '').trim();
          const initialUserCount = getUserTurnCount();
          const initialUrl = window.location.href;

          const mainInjectRes = await chrome.runtime
            .sendMessage({
              type: 'COPILOT_MAIN_WORLD_INJECT_AND_SUBMIT',
              prompt: rawPrompt,
              autoSubmit: true,
            })
            .catch(() => null);
          const mainHandled = Boolean(mainInjectRes && mainInjectRes.ok);
          const normalizedTarget = String(rawPrompt || '').replace(/\s+/g, ' ').trim();
          const expectedPrefix = normalizedTarget.slice(0, Math.min(28, normalizedTarget.length));

          for (let attempt = 0; attempt < 14; attempt++) {
            await sleep(550);
            const curCount = getAssistantTurnElements().length;
            const curUserCount = getUserTurnCount();
            if (
              isCopilotStillGenerating() ||
              curCount > initialCount ||
              curUserCount > initialUserCount ||
              (window.location.href !== initialUrl && /\/(chats?|c)\//i.test(window.location.href))
            ) {
              break;
            }
            const curInput = findCopilotComposer() || inputEl;
            const curText = String(curInput.value ?? curInput.innerText ?? curInput.textContent ?? '')
              .replace(/\s+/g, ' ')
              .trim();
            if (mainHandled && curText.length === 0) {
              break;
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
                  type: 'EXTERNAL_COPILOT_ASK_RESULT',
                  requestId,
                  ok: false,
                  chatUrl: window.location.href,
                  error: blockMid,
                })
                .catch(() => {});
              return;
            }
            const curUserCount = getUserTurnCount();
            const latest = extractLatestCopilotResponse();
            const latestText = (latest.text || '').trim();
            const waitingFirstAssistantChunk = curUserCount > initialUserCount && !latestText;
            const generating = isCopilotStillGenerating() || waitingFirstAssistantChunk;
            const hasNewTurn =
              latest.count > initialCount || (latestText.length > 0 && latestText !== initialLastText);
            const readyEnough = latestText.length >= 2;
            const neededStableTicks = latest.hasFinishActions ? 2 : 3;

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
                    type: 'EXTERNAL_COPILOT_ASK_RESULT',
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

          const finalFallback = (extractLatestCopilotResponse().text || '').trim();
          chrome.runtime
            .sendMessage({
              type: 'EXTERNAL_COPILOT_ASK_RESULT',
              requestId,
              ok: finalFallback.length > 2,
              response: finalFallback,
              chatUrl: window.location.href,
              verifiedModel,
              error:
                finalFallback.length > 2
                  ? undefined
                  : 'Timeout esperando respuesta completa en Microsoft Copilot Web.',
            })
            .catch(() => {});
        } catch (err) {
          chrome.runtime
            .sendMessage({
              type: 'EXTERNAL_COPILOT_ASK_RESULT',
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
  window.__HUELLAS_COPILOT_MESSAGE_LISTENER__ = onCopilotRuntimeMessage;
  chrome.runtime.onMessage.addListener(onCopilotRuntimeMessage);
})();
