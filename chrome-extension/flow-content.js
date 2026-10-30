// ============================================================================
// HUELLAS MASTER — GOOGLE FLOW CONTENT SCRIPT (labs.google/fx/tools/flow)
// Automates prompt injection, generation trigger, and video/image capture
// ============================================================================

(function () {
  if (window.__HUELLAS_FLOW_SCRIPT_LOADED__) return;
  window.__HUELLAS_FLOW_SCRIPT_LOADED__ = true;

  function reportStatus(status, message, extra = {}) {
    chrome.runtime.sendMessage({
      type: 'BRIDGE_STATUS',
      service: 'FLOW',
      status,
      message,
      ...extra,
    }).catch(() => {});
  }

  function findFlowPromptInput() {
    const selectors = [
      'textarea[placeholder*="prompt" i]',
      'textarea[placeholder*="describe" i]',
      'textarea[placeholder*="create" i]',
      'textarea[placeholder*="video" i]',
      'textarea[placeholder*="image" i]',
      'textarea',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  function findFlowGenerateButton() {
    const buttons = Array.from(document.querySelectorAll('button'));
    for (const btn of buttons) {
      if (btn.disabled || btn.offsetParent === null) continue;
      const txt = (btn.innerText || btn.getAttribute('aria-label') || '').toLowerCase();
      if (
        txt.includes('generate') ||
        txt.includes('create') ||
        txt.includes('generar') ||
        txt.includes('crear') ||
        txt.includes('run') ||
        btn.getAttribute('type') === 'submit'
      ) {
        return btn;
      }
    }
    return null;
  }

  function setFlowInputText(inputEl, text) {
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
        'No se encontró el campo de prompt en Google Flow. Asegúrate de haber entrado a tu proyecto en Google Flow.'
      );
      return false;
    }

    setFlowInputText(inputEl, payload.prompt || '');
    reportStatus('PROMPT_INJECTED', 'Prompt pegado en Google Flow.', {
      clipNumber: payload.clipNumber,
      mediaType: payload.mediaType,
    });

    if (payload.autoSubmit !== false) {
      setTimeout(() => {
        const genBtn = findFlowGenerateButton();
        if (genBtn) {
          genBtn.click();
          reportStatus('GENERATING', 'Generando en Google Flow con tu cuota web...', {
            clipNumber: payload.clipNumber,
            mediaType: payload.mediaType,
          });
        } else {
          reportStatus(
            'PROMPT_INJECTED',
            'Prompt listo en Google Flow (haz clic en Generate o presiona Enter).',
            { clipNumber: payload.clipNumber }
          );
        }
      }, 500);
    }

    return true;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'FLOW') return false;

    if (msg.action === 'SEND_PROMPT') {
      const ok = handleSendFlowPrompt(msg);
      sendResponse({ handled: ok });
      return false;
    }

    if (msg.action === 'GRAB_LAST_MEDIA') {
      const media = extractLatestFlowMedia();
      chrome.runtime.sendMessage({
        type: 'FLOW_MEDIA_READY',
        clipNumber: msg.clipNumber,
        videos: media.videos,
        images: media.images,
      }).catch(() => {});
      sendResponse({ handled: true, ...media });
      return false;
    }

    return false;
  });

  function injectFlowFloatingBadge() {
    if (document.getElementById('huellas-flow-floating-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'huellas-flow-floating-bar';
    bar.style.cssText =
      'position:fixed;bottom:14px;right:16px;z-index:999999;display:flex;align-items:center;gap:8px;background:#14120f;border:1px solid rgba(245,158,11,0.5);color:#fde68a;padding:6px 12px;border-radius:999px;font-family:system-ui,sans-serif;font-size:12px;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,0.6);';

    const dot = document.createElement('span');
    dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#10b981;display:inline-block;';

    const label = document.createElement('span');
    label.textContent = 'Huellas Master • Google Flow';

    const btn = document.createElement('button');
    btn.textContent = '📥 Enviar Media a Huellas';
    btn.style.cssText =
      'background:#f59e0b;color:#09090b;border:none;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:800;cursor:pointer;';
    btn.onclick = () => {
      const media = extractLatestFlowMedia();
      chrome.runtime.sendMessage({
        type: 'FLOW_MEDIA_READY',
        videos: media.videos,
        images: media.images,
      }).catch(() => {});
      btn.textContent = '✓ ¡Enviado a Huellas!';
      setTimeout(() => {
        btn.textContent = '📥 Enviar Media a Huellas';
      }, 2000);
    };

    bar.appendChild(dot);
    bar.appendChild(label);
    bar.appendChild(btn);
    document.body.appendChild(bar);
  }

  if (document.body) {
    injectFlowFloatingBadge();
  } else {
    window.addEventListener('DOMContentLoaded', injectFlowFloatingBadge);
  }

  chrome.runtime.sendMessage({
    type: 'CONTENT_SCRIPT_READY',
    service: 'FLOW',
  }).catch(() => {});
})();
