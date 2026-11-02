// ============================================================================
// HUELLAS MASTER — GOOGLE FLOW CONTENT SCRIPT (flow.google.com / labs.google)
// Automates prompt injection, production submission, real-time video watching,
// 3-keyframe extraction, and MP4 binary capture for automatic auditing & saving
// ============================================================================

(function () {
  // Always remove any old floating bar if present from an earlier version
  const oldBar = document.getElementById('huellas-flow-floating-bar');
  if (oldBar) {
    oldBar.remove();
  }

  // Desactivar cualquier observer previo que ocultaba el botón del dropdown de modelo cuando decía 'Omni 1.1 Flash'
  try {
    if (window.__HUELLAS_OMNI_HIDE_OBSERVER__) {
      window.__HUELLAS_OMNI_HIDE_OBSERVER__.disconnect();
      window.__HUELLAS_OMNI_HIDE_OBSERVER__ = null;
    }
    document.querySelectorAll('[style*="visibility: hidden"]').forEach((el) => {
      const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (/omni\s*1\.1\s*flash/i.test(txt)) {
        el.style.visibility = '';
      }
    });
  } catch {}

  function realUiClick(el) {
    if (!el) return;
    try {
      const r = el.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const opts = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: cx,
        clientY: cy,
        pointerId: 1,
        isPrimary: true,
        button: 0,
        buttons: 1,
      };
      el.dispatchEvent(new PointerEvent('pointerover', opts));
      el.dispatchEvent(new MouseEvent('mouseover', opts));
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      if (typeof el.focus === 'function') el.focus();
      el.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
      el.dispatchEvent(new MouseEvent('mouseup', { ...opts, buttons: 0 }));
      el.dispatchEvent(new MouseEvent('click', { ...opts, buttons: 0 }));
      if (typeof el.click === 'function') el.click();
    } catch {
      try {
        el.click();
      } catch {}
    }
  }

  async function ensureFlowModelSelected(targetMode = 'VIDEO') {
    if (window.__HUELLAS_SWITCHING_MODEL_LOCK__) return;
    window.__HUELLAS_SWITCHING_MODEL_LOCK__ = true;
    const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      const isVideo = targetMode !== 'IMAGE' && targetMode !== 'REFERENCES' && targetMode !== 'THUMBNAILS';
      const targetPatterns = isVideo
        ? [/veo\s*3\.1\s*-\s*lite\s*\[lower priority\]/i, /veo\s*3\.1\s*-\s*lite/i]
        : [/nano\s*banana\s*2\.1/i, /nano\s*banana\s*pro/i, /nano\s*banana\s*2/i];

      const allButtons = Array.from(
        document.querySelectorAll('button, [role="button"], [role="combobox"], mat-select')
      ).filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 18 && r.height > 14 && getComputedStyle(b).visibility !== 'hidden';
      });

      const modelPillBtn = allButtons.find((b) => {
        if (b.closest('.cdk-overlay-container, [role="dialog"], [role="menu"], [role="listbox"]')) {
          return false;
        }
        const txt = (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim();
        return /(veo\s*2|veo\s*3|omni\s*1|nano\s*banana|imagen\s*3)/i.test(txt);
      });

      if (!modelPillBtn) return;

      const pillTxt = (modelPillBtn.innerText || modelPillBtn.textContent || '').replace(/\s+/g, ' ').trim();
      const alreadyOnTarget = targetPatterns.some((pat) => pat.test(pillTxt));
      const hasMultiCount = /\bx[234]\b/i.test(pillTxt);

      if (alreadyOnTarget && !hasMultiCount) return;

      // 1. Abrir el popover de ajustes / modelo en la barra inferior
      realUiClick(modelPillBtn);
      await sleepMs(240);

      const findVisibleOption = (patterns, excludeSet = new Set()) => {
        const candidates = Array.from(
          document.querySelectorAll(
            '[role="option"], [role="menuitem"], [role="menuitemradio"], [role="tab"], [role="radio"], mat-option, mat-button-toggle button, .cdk-overlay-container button, [data-radix-popper-content-wrapper] button, [role="dialog"] button, [role="listbox"] *, button, li'
          )
        ).filter((el) => {
          if (!el || excludeSet.has(el) || el === modelPillBtn) return false;
          const r = el.getBoundingClientRect();
          return r.width > 16 && r.height > 14 && getComputedStyle(el).visibility !== 'hidden';
        });
        for (const pat of patterns) {
          const hit = candidates.find((el) => {
            const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            const a = ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).trim();
            return pat.test(t) || (a && pat.test(a));
          });
          if (hit) return hit;
        }
        return null;
      };

      // 2. Asegurar pestaña Video vs Image dentro del popover
      if (isVideo) {
        const vidTab = findVisibleOption([
          /^(videos?|text\s*to\s*video|texto\s*a\s*video|videocam\s*videos?|videocam\s*video)$/i,
        ]);
        if (vidTab) {
          realUiClick(vidTab);
          await sleepMs(180);
        }
      } else {
        const imgTab = findVisibleOption([
          /^(images?|create\s*images?|text\s*to\s*image|im[aá]genes)$/i,
        ]);
        if (imgTab) {
          realUiClick(imgTab);
          await sleepMs(180);
        }
      }

      // 3. Asegurar cantidad x1 dentro del popover
      const x1Btn = findVisibleOption([/^x?1$/i, /^1\s*(output|video|image|item)?s?$/i]);
      if (x1Btn) {
        realUiClick(x1Btn);
        await sleepMs(140);
      }

      // 4. Buscar directamente 'Veo 3.1 - Lite [Lower Priority]' (sin incluir 'Omni 1.1 Flash' para no confundir el botón cerrado del dropdown)
      let targetOpt = findVisibleOption(targetPatterns);
      if (!targetOpt) {
        // El sub-dropdown de Modelo dentro del popover está cerrado (mostrando p.ej. 'Omni 1.1 Flash' o 'Veo 3.1 - Fast'): abrirlo primero
        const innerModelDropdown = Array.from(
          document.querySelectorAll(
            '.cdk-overlay-container button, .cdk-overlay-container [role="combobox"], .cdk-overlay-container mat-select, [data-radix-popper-content-wrapper] button, [data-radix-popper-content-wrapper] [role="combobox"], [role="dialog"] button, [role="dialog"] [role="combobox"]'
          )
        ).find((el) => {
          if (!el || el === modelPillBtn) return false;
          const r = el.getBoundingClientRect();
          if (r.width < 45 || r.height < 16 || getComputedStyle(el).visibility === 'hidden') return false;
          const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          return /(omni\s*1|veo\s*2|veo\s*3|nano\s*banana|imagen\s*3)/i.test(t);
        });

        if (innerModelDropdown) {
          realUiClick(innerModelDropdown);
          await sleepMs(240);
          targetOpt = findVisibleOption(targetPatterns, new Set([innerModelDropdown]));
        }
      }

      if (targetOpt) {
        realUiClick(targetOpt);
        await sleepMs(200);
      }

      // 5. Cerrar el popover/backdrop para dejar libre la caja de prompt
      const backdrops = Array.from(
        document.querySelectorAll('.cdk-overlay-backdrop, [class*="overlay-backdrop" i]')
      );
      if (backdrops.length > 0) {
        backdrops.forEach((bd) => realUiClick(bd));
        await sleepMs(100);
      } else {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        await sleepMs(80);
      }
    } catch {} finally {
      window.__HUELLAS_SWITCHING_MODEL_LOCK__ = false;
    }
  }

  // Al cargar el content script (y periódicamente si el usuario no está escribiendo), asegurar 'Veo 3.1 - Lite [Lower Priority]' + x1 si está en Omni 1.1 Flash
  setTimeout(() => {
    ensureFlowModelSelected('VIDEO').catch(() => {});
  }, 150);

  if (window.__HUELLAS_MODEL_ENFORCER_TIMER__) {
    clearInterval(window.__HUELLAS_MODEL_ENFORCER_TIMER__);
  }
  window.__HUELLAS_MODEL_ENFORCER_TIMER__ = setInterval(() => {
    try {
      const hasOpenOverlay = Boolean(
        document.querySelector(
          '.cdk-overlay-container [role="option"], .cdk-overlay-container [role="menuitem"], [data-radix-popper-content-wrapper], [role="listbox"]'
        )
      );
      if (hasOpenOverlay) return;
      const allBtns = Array.from(document.querySelectorAll('button, [role="button"], [role="combobox"]'));
      const pill = allBtns.find((b) => {
        const txt = (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim();
        return /omni\s*1\.1\s*flash/i.test(txt);
      });
      if (pill) {
        ensureFlowModelSelected('VIDEO').catch(() => {});
      }
    } catch {}
  }, 2200);

  // Replace previous listener if re-injected
  if (window.__HUELLAS_FLOW_MESSAGE_HANDLER__) {
    try {
      chrome.runtime.onMessage.removeListener(window.__HUELLAS_FLOW_MESSAGE_HANDLER__);
    } catch {}
  }

  if (window.__HUELLAS_FLOW_WATCHER_TIMER__) {
    clearInterval(window.__HUELLAS_FLOW_WATCHER_TIMER__);
    window.__HUELLAS_FLOW_WATCHER_TIMER__ = null;
  }
  if (window.__HUELLAS_FLOW_REF_WATCHER__) {
    clearInterval(window.__HUELLAS_FLOW_REF_WATCHER__);
    window.__HUELLAS_FLOW_REF_WATCHER__ = null;
  }
  if (window.__HUELLAS_FLOW_THUMB_WATCHER__) {
    clearInterval(window.__HUELLAS_FLOW_THUMB_WATCHER__);
    window.__HUELLAS_FLOW_THUMB_WATCHER__ = null;
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
    // 1. Direct match for Google Flow's ProseMirror prompt box (excluding side panels like .agent-panel-animation-container)
    const proseCandidates = Array.from(
      document.querySelectorAll(
        'div.ProseMirror[contenteditable="true"], div[role="textbox"][contenteditable="true"][aria-label*="create" i], div[role="textbox"][contenteditable="true"]'
      )
    ).filter((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.width > 40 &&
        r.height > 12 &&
        !el.closest('.agent-panel-animation-container, .sidenav, mat-sidenav, mat-drawer')
      );
    });
    if (proseCandidates.length > 0) {
      proseCandidates.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
      return proseCandidates[0];
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
      if (el.closest('.agent-panel-animation-container, .sidenav, mat-sidenav, mat-drawer')) {
        continue;
      }
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
    const inputRect = inputEl
      ? inputEl.getBoundingClientRect()
      : {
          top: window.innerHeight - 160,
          bottom: window.innerHeight - 40,
          left: 300,
          right: 900,
          width: 600,
          height: 120,
        };

    // 1. Walk up from inputEl (up to 8 levels) to find button.generate-icon-button or submit button strictly inside the composer container
    let container = inputEl ? inputEl.parentElement : null;
    for (let depth = 0; depth < 8 && container && container !== document.body; depth++) {
      const exactGenerateBtn = container.querySelector(
        'button.generate-icon-button, flow-generate-icon-button button, span.submit-button-slot button, [submitbutton] button'
      );
      if (exactGenerateBtn) {
        const r = exactGenerateBtn.getBoundingClientRect();
        if (r.width >= 16 && r.height >= 16 && r.bottom > 0) {
          return exactGenerateBtn;
        }
      }

      const cRect = container.getBoundingClientRect();
      if (cRect.height > 680) break;
      const btnsInContainer = Array.from(container.querySelectorAll('button')).filter((btn) => {
        const r = btn.getBoundingClientRect();
        if (r.width < 18 || r.height < 18 || r.bottom <= 0) return false;
        const meta = (
          (btn.getAttribute('aria-label') || '') +
          ' ' +
          (btn.getAttribute('title') || '') +
          ' ' +
          (btn.className || '') +
          ' ' +
          (btn.innerText || btn.textContent || '')
        ).toLowerCase();
        if (
          meta.includes('clear') ||
          meta.includes('limpiar') ||
          meta.includes('borrar') ||
          meta.includes('close') ||
          meta.includes('cerrar') ||
          meta.includes('delete') ||
          meta.includes('settings') ||
          meta.includes('ajustes') ||
          meta.includes('config') ||
          meta.includes('tune') ||
          meta.includes('add-menu') ||
          meta.includes('add ingredient') ||
          meta.includes('añadir') ||
          meta.includes('agregar') ||
          meta.includes('upload') ||
          meta.includes('subir') ||
          meta.includes('aspect') ||
          meta.includes('16:9') ||
          meta.includes('9:16') ||
          meta.includes('text to video') ||
          meta.includes('texto a video') ||
          meta.includes('ingredients to video') ||
          meta.includes('image to video') ||
          meta.includes('expand')
        ) {
          return false;
        }
        return true;
      });

      if (btnsInContainer.length > 0) {
        const iconOrActionBtn = btnsInContainer.find((b) => {
          const t = (
            (b.innerText || b.textContent || '') +
            ' ' +
            (b.getAttribute('aria-label') || '') +
            ' ' +
            (b.getAttribute('title') || '')
          )
            .trim()
            .toLowerCase();
          return (
            t.includes('arrow_forward') ||
            t.includes('arrow_upward') ||
            t.includes('send') ||
            t.includes('enviar') ||
            t.includes('start generation') ||
            t.includes('iniciar generación') ||
            t.includes('generate') ||
            t.includes('generar') ||
            t.includes('create') ||
            t.includes('crear') ||
            t.includes('submit') ||
            t.includes('spark') ||
            t.includes('auto_awesome')
          );
        });
        if (iconOrActionBtn) return iconOrActionBtn;

        const rightSideBtns = btnsInContainer.filter(
          (b) =>
            b.getBoundingClientRect().left >= inputRect.left + Math.min(80, inputRect.width * 0.3)
        );
        if (rightSideBtns.length > 0) {
          rightSideBtns.sort(
            (a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right
          );
          return rightSideBtns[0];
        }
      }
      container = container.parentElement;
    }

    // 3. Fallback: find actual <button> near inputEl (checking both inputRect.bottom and inputRect.top so tall multi-line prompts work)
    const allButtons = Array.from(document.querySelectorAll('button'));
    for (const btn of allButtons) {
      const r = btn.getBoundingClientRect();
      if (r.width < 16 || r.height < 16 || r.bottom <= 0) continue;
      const nearBottom = Math.abs(r.bottom - inputRect.bottom) <= 240;
      const nearTop = Math.abs(r.top - inputRect.top) <= 250;
      if (!nearBottom && !nearTop) continue;
      const text = (
        (btn.innerText || btn.textContent || '') +
        ' ' +
        (btn.getAttribute('aria-label') || '')
      )
        .trim()
        .toLowerCase();
      if (
        text.includes('arrow_forward') ||
        text.includes('arrow_upward') ||
        text.includes('send') ||
        text.includes('start generation') ||
        text.includes('iniciar generación') ||
        text.includes('enviar')
      ) {
        return btn;
      }
    }

    return null;
  }

  function collapseSelectionToEnd(inputEl) {
    if (!inputEl) return;
    try {
      inputEl.focus();
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(inputEl);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch {}
  }

  function setFlowInputText(inputEl, text) {
    // Append a trailing space so the cursor at the end is never stuck inside an @mention autocomplete token
    const safeText = String(text || '').endsWith(' ') ? String(text || '') : `${text || ''} `;
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

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
        insertedByExec = document.execCommand('insertText', false, safeText);
      } catch {}

      if (!insertedByExec || norm(inputEl.value) !== norm(safeText)) {
        if (nativeSetter) {
          nativeSetter.call(inputEl, safeText);
        } else {
          inputEl.value = safeText;
        }
        inputEl.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            composed: true,
            inputType: 'insertText',
            data: safeText,
          })
        );
        inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
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

      // Replace selection atomically via execCommand('insertText') so ProseMirror's internal EditorState updates natively
      const inserted = document.execCommand('insertText', false, safeText);
      const afterNorm = norm(inputEl.innerText || inputEl.textContent || '');
      const expectedPrefixNorm = norm(safeText).slice(0, 20);

      // Only fallback if execCommand truly left the editor empty or with stale text
      if (!inserted && afterNorm.length < 5) {
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', safeText);
          inputEl.dispatchEvent(
            new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true,
              composed: true,
              clipboardData: dt,
            })
          );
        } catch {}
      }

      const afterPasteNorm = norm(inputEl.innerText || inputEl.textContent || '');
      if (
        afterPasteNorm.length < 5 ||
        (expectedPrefixNorm.length >= 6 && !afterPasteNorm.includes(expectedPrefixNorm))
      ) {
        try {
          inputEl.focus();
          const sel2 = window.getSelection();
          const r2 = document.createRange();
          r2.selectNodeContents(inputEl);
          sel2.removeAllRanges();
          sel2.addRange(r2);
          document.execCommand('insertText', false, safeText);
        } catch {}
      }

      collapseSelectionToEnd(inputEl);
      inputEl.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType: 'insertText',
          data: ' ',
        })
      );
      document.documentElement.setAttribute('data-huellas-flow-injected-ts', String(Date.now()));
    } catch {}
  }

  function dispatchEnterKeyOnInput(inputEl) {
    if (!inputEl) return;
    try {
      collapseSelectionToEnd(inputEl);
      const evInit = {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        charCode: 13,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        bubbles: true,
        cancelable: true,
        composed: true,
      };
      inputEl.dispatchEvent(new KeyboardEvent('keydown', evInit));
      inputEl.dispatchEvent(new KeyboardEvent('keypress', evInit));
      try {
        inputEl.dispatchEvent(
          new InputEvent('beforeinput', {
            inputType: 'insertParagraph',
            bubbles: true,
            cancelable: true,
            composed: true,
          })
        );
      } catch {}
      inputEl.dispatchEvent(new KeyboardEvent('keyup', evInit));

      const form = inputEl.closest?.('form');
      if (form && typeof form.requestSubmit === 'function') {
        try {
          form.requestSubmit();
        } catch {}
      }
    } catch {}
  }

  function fireRealClickOnButton(btn) {
    if (!btn) return;
    try {
      const rect = btn.getBoundingClientRect();
      const opts = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0,
        buttons: 1,
      };
      btn.dispatchEvent(new PointerEvent('pointerdown', opts));
      btn.dispatchEvent(new MouseEvent('mousedown', opts));
      btn.dispatchEvent(new PointerEvent('pointerup', opts));
      btn.dispatchEvent(new MouseEvent('mouseup', opts));
    } catch {}
    try {
      btn.click();
    } catch {}
  }

  function clickFlowSubmitButton(btn, inputEl, promptText) {
    let submittedSuccessfully = false;

    if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
      fireRealClickOnButton(btn);
    } else if (inputEl) {
      dispatchEnterKeyOnInput(inputEl);
    }

    // Immediate 160ms check: if button click didn't clear the box, also press Enter & click button
    setTimeout(() => {
      const currentInput = findFlowPromptInput() || inputEl;
      if (!currentInput) return;
      const remaining = (
        currentInput.value ??
        currentInput.innerText ??
        currentInput.textContent ??
        ''
      ).trim();
      if (remaining.length <= 4) {
        submittedSuccessfully = true;
        return;
      }
      const freshBtn = findExactFlowSubmitButton(currentInput);
      if (freshBtn && !freshBtn.disabled && freshBtn.getAttribute('aria-disabled') !== 'true') {
        fireRealClickOnButton(freshBtn);
      }
      dispatchEnterKeyOnInput(currentInput);
    }, 160);

    // Check at 350ms whether the prompt box is now empty (submitted!)
    setTimeout(() => {
      const currentInput = findFlowPromptInput() || inputEl;
      if (!currentInput) return;
      const remaining = (
        currentInput.value ??
        currentInput.innerText ??
        currentInput.textContent ??
        ''
      ).trim();
      if (remaining.length <= 4) {
        submittedSuccessfully = true;
      }
    }, 350);

    // Follow-up checkpoints at 540ms, 860ms, 1250ms, and 1750ms
    [540, 860, 1250, 1750].forEach((delayMs) => {
      setTimeout(() => {
        const currentInput = findFlowPromptInput() || inputEl;
        if (!currentInput) return;
        const remaining = (
          currentInput.value ??
          currentInput.innerText ??
          currentInput.textContent ??
          ''
        ).trim();

        // If it already submitted earlier and an old background script re-pasted text at 420ms, clear the duplicate text
        if (submittedSuccessfully) {
          if (remaining.length > 4) {
            const clearBtn = document.querySelector(
              'button.clear-button[aria-label="Clear prompt"], button.clear-button'
            );
            if (clearBtn) {
              try {
                clearBtn.click();
              } catch {}
            } else {
              try {
                currentInput.focus();
                const sel = window.getSelection();
                const r = document.createRange();
                r.selectNodeContents(currentInput);
                sel.removeAllRanges();
                sel.addRange(r);
                document.execCommand('delete', false);
              } catch {}
            }
          }
          return;
        }

        if (remaining.length <= 4) {
          submittedSuccessfully = true;
          return;
        }

        // If at 540ms the prompt is still unsubmitted (or was overwritten via innerHTML at 420ms), re-sync ProseMirror via insertText
        if (delayMs === 540 && promptText) {
          setFlowInputText(currentInput, promptText);
        } else {
          collapseSelectionToEnd(currentInput);
        }

        const freshBtn = findExactFlowSubmitButton(currentInput);
        if (freshBtn && !freshBtn.disabled && freshBtn.getAttribute('aria-disabled') !== 'true') {
          fireRealClickOnButton(freshBtn);
        }
        setTimeout(() => {
          const checkAgain = (
            currentInput.value ??
            currentInput.innerText ??
            currentInput.textContent ??
            ''
          ).trim();
          if (checkAgain.length > 4 && !submittedSuccessfully) {
            dispatchEnterKeyOnInput(currentInput);
          } else if (checkAgain.length <= 4) {
            submittedSuccessfully = true;
          }
        }, 75);
      }, delayMs);
    });
  }

  function getVideoElementUrl(videoEl) {
    if (!videoEl) return '';
    return (
      videoEl.currentSrc ||
      videoEl.src ||
      videoEl.querySelector('source')?.src ||
      ''
    ).trim();
  }

  function getAllCurrentVideoUrlsSet() {
    const urls = new Set();
    const videos = Array.from(document.querySelectorAll('video'));
    for (const v of videos) {
      const u = getVideoElementUrl(v);
      if (u) urls.add(u);
    }
    return urls;
  }

  function inferClipNumberFromVideoCard(videoEl) {
    let curr = videoEl;
    for (let depth = 0; depth < 7 && curr; depth++) {
      const aria = curr.getAttribute?.('aria-label') || '';
      const text = (aria + ' ' + (curr.innerText || '')).slice(0, 600);
      const match =
        text.match(/\b(\d{1,3})_Clip\b/i) ||
        text.match(/\bClip\s*#?\s*0*(\d{1,3})\b/i);
      if (match && match[1]) {
        return parseInt(match[1], 10);
      }
      curr = curr.parentElement;
    }
    return null;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'video/mp4';
    const bstr = atob(parts[1] || '');
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  }

  async function fetchVideoBinaryDataUrl(videoUrl, imgElementFallback) {
    if (!videoUrl) return '';
    if (videoUrl.startsWith('data:')) return videoUrl;

    // 1. Try direct fetch inside page context (credentials: include, then omit for * CORS)
    for (const credMode of ['include', 'omit']) {
      try {
        const resp = await fetch(videoUrl, { credentials: credMode });
        if (resp.ok) {
          const blob = await resp.blob();
          if (blob.size > 500) {
            return await blobToDataUrl(blob);
          }
        }
      } catch {}
    }

    // 2. Fallback: ask background service worker (bypasses CORS via host_permissions)
    if (!videoUrl.startsWith('blob:')) {
      try {
        const bgResp = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { type: 'FETCH_VIDEO_BASE64', url: videoUrl },
            (r) => resolve(r || { ok: false })
          );
        });
        if (bgResp && bgResp.ok && bgResp.dataUrl) {
          return bgResp.dataUrl;
        }
      } catch {}
    }

    // 3. Canvas fallback if an <img> DOM element is provided
    if (imgElementFallback && imgElementFallback.naturalWidth > 0) {
      try {
        const c = document.createElement('canvas');
        c.width = imgElementFallback.naturalWidth;
        c.height = imgElementFallback.naturalHeight;
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.drawImage(imgElementFallback, 0, 0);
          return c.toDataURL('image/png');
        }
      } catch {}
    }

    return '';
  }

  function getCanvasRgbSignature(ctx, width, height) {
    try {
      const data = ctx.getImageData(0, 0, width, height).data;
      const samples = [];
      const cols = 8;
      const rows = 6;
      for (let r = 1; r <= rows; r++) {
        for (let c = 1; c <= cols; c++) {
          const x = Math.min(width - 1, Math.floor((c * width) / (cols + 1)));
          const y = Math.min(height - 1, Math.floor((r * height) / (rows + 1)));
          const idx = (y * width + x) * 4;
          samples.push(`${data[idx] >> 3},${data[idx + 1] >> 3},${data[idx + 2] >> 3}`);
        }
      }
      return samples.join('|');
    } catch {
      return '';
    }
  }

  async function seekAndFlushVideoFrame(videoEl, targetTimeSec) {
    const dur =
      Number.isFinite(videoEl.duration) && videoEl.duration > 0 ? videoEl.duration : 8;
    const clampedTime = Math.min(Math.max(0.08, targetTimeSec), Math.max(0.15, dur - 0.08));

    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        videoEl.removeEventListener('seeked', finish);
        resolve(true);
      };
      const t = setTimeout(finish, 2600);
      videoEl.addEventListener('seeked', () => {
        clearTimeout(t);
        finish();
      });
      try {
        videoEl.currentTime = clampedTime;
      } catch {
        clearTimeout(t);
        finish();
      }
    });

    // En pestañas en segundo plano de Chromium, hacer play() brevemente fuerza al decodificador a volcar el nuevo frame
    try {
      const playPromise = videoEl.play();
      if (playPromise && typeof playPromise.then === 'function') {
        await playPromise.catch(() => {});
      }
      await new Promise((r) => setTimeout(r, 85));
      videoEl.pause();
    } catch {}

    await new Promise((r) => setTimeout(r, 65));
  }

  async function extractThreeKeyframesFromVideoSource(sourceUrlOrVideoEl, liveVideoEl) {
    const frames = [];
    const signatures = [];
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 216;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { frames: [], duration: 0 };

    // Crear un elemento <video> montado en el DOM (oculto) para garantizar que Chromium pinte cada fotograma distinto
    if (typeof sourceUrlOrVideoEl === 'string' && sourceUrlOrVideoEl) {
      let tempVideo = null;
      try {
        tempVideo = document.createElement('video');
        tempVideo.muted = true;
        tempVideo.defaultMuted = true;
        tempVideo.playsInline = true;
        tempVideo.crossOrigin = 'anonymous';
        tempVideo.preload = 'auto';
        tempVideo.style.cssText =
          'position:fixed;left:-9999px;top:-9999px;width:384px;height:216px;opacity:0.01;pointer-events:none;z-index:-1;';
        document.body.appendChild(tempVideo);
        tempVideo.src = sourceUrlOrVideoEl;

        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('timeout metadata')), 8500);
          tempVideo.onloadeddata = () => {
            clearTimeout(t);
            resolve(true);
          };
          tempVideo.onerror = () => {
            clearTimeout(t);
            reject(new Error('video load error'));
          };
        });

        const dur =
          Number.isFinite(tempVideo.duration) && tempVideo.duration > 0.5
            ? tempVideo.duration
            : 8;
        // Inicio 1.0s (12.5%), Mitad 4.5s (56.25%), Final 7.2s (90%)
        const ratios = [0.125, 0.5625, 0.9];

        for (let i = 0; i < ratios.length; i++) {
          let targetTs = Math.max(0.18, dur * ratios[i]);
          await seekAndFlushVideoFrame(tempVideo, targetTs);
          ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
          let sig = getCanvasRgbSignature(ctx, canvas.width, canvas.height);

          // Si el fotograma es idéntico al anterior, desplazar el tiempo +0.65s y reproducir 130ms para forzar cambio de cuadro
          if (sig && signatures.includes(sig)) {
            const altTs = Math.min(dur - 0.1, targetTs + Math.max(0.55, dur * 0.14));
            await seekAndFlushVideoFrame(tempVideo, altTs);
            try {
              await tempVideo.play().catch(() => {});
              await new Promise((r) => setTimeout(r, 130));
              tempVideo.pause();
            } catch {}
            ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
            sig = getCanvasRgbSignature(ctx, canvas.width, canvas.height);
          }

          const jpg = canvas.toDataURL('image/jpeg', 0.8);
          if (jpg && jpg.length > 200) {
            frames.push(jpg);
            if (sig) signatures.push(sig);
          }
        }

        if (frames.length > 0) {
          return { frames, duration: dur };
        }
      } catch {
      } finally {
        if (tempVideo) {
          try {
            tempVideo.pause();
            tempVideo.removeAttribute('src');
            tempVideo.load();
            tempVideo.remove();
          } catch {}
        }
      }
    }

    // Fallback: extraer directamente del elemento <video> en vivo de la página
    if (liveVideoEl) {
      try {
        const dur =
          Number.isFinite(liveVideoEl.duration) && liveVideoEl.duration > 0.5
            ? liveVideoEl.duration
            : 8;
        const ratios = [0.125, 0.5625, 0.9];
        for (let i = 0; i < ratios.length; i++) {
          const ts = Math.max(0.18, dur * ratios[i]);
          await seekAndFlushVideoFrame(liveVideoEl, ts);
          ctx.drawImage(liveVideoEl, 0, 0, canvas.width, canvas.height);
          const jpg = canvas.toDataURL('image/jpeg', 0.8);
          if (jpg && jpg.length > 200) {
            frames.push(jpg);
          }
        }
        return { frames, duration: dur };
      } catch {}
    }

    return { frames, duration: 0 };
  }

  /**
   * Escanea tarjetas de error en Google Flow (como "Failed: This prompt might violate our policies about generating prominent people...").
   * Si markPreexistingOnly = true, marca todas las tarjetas actuales para que no disparen falsos positivos en próximos envíos.
   */
  function scanFlowFailureCards(markPreexistingOnly = false) {
    const POLICY_REGEX =
      /violate our policies|generating prominent people|try a different prompt|refunded for this generation|couldn't generate|unable to generate|generation failed|no se pudo generar|viola nuestras pol|not enough credits|out of credits|insufficient credits|no credits|sin cr[eé]ditos|cr[eé]ditos insuficientes/i;
    const PROMINENT_PEOPLE_REGEX =
      /prominent people|personas prominentes|public figure|figura p[uú]blica|violate our policies/i;

    const candidates = Array.from(
      document.querySelectorAll('div, section, article, mat-card, p, span')
    ).filter((el) => {
      if (!el || el.closest('#huellas-flow-banner')) return false;
      const txt = (el.innerText || el.textContent || '').trim();
      if (txt.length < 22 || txt.length > 680) return false;
      if (!POLICY_REGEX.test(txt)) return false;
      // Preferir el contenedor hoja más específico que contenga el mensaje completo
      const childMatch = Array.from(el.children || []).some((ch) => {
        const cTxt = (ch.innerText || ch.textContent || '').trim();
        return cTxt.length >= 22 && POLICY_REGEX.test(cTxt);
      });
      return !childMatch;
    });

    if (markPreexistingOnly) {
      for (const el of candidates) {
        el.setAttribute('data-huellas-failed-handled', 'true');
        const cardParent = el.closest('[class*="card" i], [class*="result" i], [class*="item" i]');
        if (cardParent) cardParent.setAttribute('data-huellas-failed-handled', 'true');
      }
      return null;
    }

    for (const el of candidates) {
      if (el.getAttribute('data-huellas-failed-handled') === 'true') continue;
      const cardParent = el.closest('[class*="card" i], [class*="result" i], [class*="item" i]');
      if (cardParent && cardParent.getAttribute('data-huellas-failed-handled') === 'true') {
        continue;
      }

      el.setAttribute('data-huellas-failed-handled', 'true');
      if (cardParent) cardParent.setAttribute('data-huellas-failed-handled', 'true');

      const rawText = (
        (cardParent ? cardParent.innerText : el.innerText) ||
        el.textContent ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 420);

      return {
        errorText: rawText,
        isProminentPeopleError: PROMINENT_PEOPLE_REGEX.test(rawText),
      };
    }

    return null;
  }

  async function captureVideoFramesAndBinary(videoEl) {
    const videoUrl = getVideoElementUrl(videoEl);
    const videoDataUrl = await fetchVideoBinaryDataUrl(videoUrl);

    let localBlobUrl = '';
    if (videoDataUrl) {
      try {
        const blob = dataUrlToBlob(videoDataUrl);
        localBlobUrl = URL.createObjectURL(blob);
      } catch {}
    }

    const { frames, duration } = await extractThreeKeyframesFromVideoSource(
      localBlobUrl || videoUrl,
      videoEl
    );

    if (localBlobUrl) {
      try {
        URL.revokeObjectURL(localBlobUrl);
      } catch {}
    }

    return {
      videoUrl,
      videoDataUrl,
      frames,
      duration,
    };
  }

  function getAllCurrentImageUrlsSet() {
    const urls = new Set();
    for (const img of Array.from(document.querySelectorAll('img'))) {
      img.setAttribute('data-huellas-preexisting', 'true');
      const src = (img.currentSrc || img.src || '').trim();
      if (src) {
        urls.add(src);
      }
    }
    return urls;
  }

  /**
   * Filtro estricto para obtener ÚNICAMENTE las imágenes nuevas generadas por el prompt actual
   * e ignorar todas las imágenes de proyectos anteriores (data-huellas-preexisting o en preExistingUrlsSet).
   */
  function getNewlyGeneratedImagesOnly(preExistingUrlsSet, minWidth = 220, minHeight = 150) {
    const allImages = Array.from(document.querySelectorAll('img'));

    return allImages.filter((img) => {
      const src = (img.currentSrc || img.src || '').trim();
      if (!src || src.includes('avatar')) return false;

      // 1. Ignorar cualquier imagen marcada como preexistente antes/durante los primeros segundos del envío
      if (img.getAttribute('data-huellas-preexisting') === 'true') {
        return false;
      }

      // 2. Ignorar cualquier URL en el Set de imágenes preexistentes
      if (preExistingUrlsSet && preExistingUrlsSet.has(src)) {
        return false;
      }

      // 3. Ignorar avatares, chips de ingredientes o íconos pequeños de UI (< 180px)
      const rect = img.getBoundingClientRect();
      if (rect.width > 0 && rect.width < 140 && rect.height < 140) {
        return false;
      }
      const w = img.naturalWidth || img.width || rect.width || 0;
      const h = img.naturalHeight || img.height || rect.height || 0;
      if (w < minWidth || h < minHeight) {
        return false;
      }

      return true;
    });
  }

  function startFlowThumbnailWatcher({ optionLabel, prompt, attempt, baselineImageUrls }) {
    if (window.__HUELLAS_FLOW_THUMB_WATCHER__) {
      clearInterval(window.__HUELLAS_FLOW_THUMB_WATCHER__);
      window.__HUELLAS_FLOW_THUMB_WATCHER__ = null;
    }

    scanFlowFailureCards(true);

    const startedAt = Date.now();
    const maxWaitMs = 150000;
    let capturing = false;

    window.__HUELLAS_FLOW_THUMB_WATCHER__ = setInterval(async () => {
      if (capturing) return;
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > maxWaitMs) {
        clearInterval(window.__HUELLAS_FLOW_THUMB_WATCHER__);
        window.__HUELLAS_FLOW_THUMB_WATCHER__ = null;
        return;
      }

      if (elapsedMs < 3500) {
        scanFlowFailureCards(true);
      } else {
        const failure = scanFlowFailureCards(false);
        if (failure) {
          clearInterval(window.__HUELLAS_FLOW_THUMB_WATCHER__);
          window.__HUELLAS_FLOW_THUMB_WATCHER__ = null;
          reportStatus(
            'ERROR',
            `🛡️ Filtro de Google Flow detectado en Miniatura (${
              failure.isProminentPeopleError ? 'Prominent People' : 'Política'
            }). Reajustando prompt automáticamente para evadir el filtro...`
          );
          chrome.runtime
            .sendMessage({
              type: 'FLOW_GENERATION_FAILED',
              mediaType: 'THUMBNAILS',
              optionLabel: optionLabel || 'A',
              attempt: attempt || 1,
              prompt: prompt || '',
              errorText: failure.errorText,
              isProminentPeopleError: failure.isProminentPeopleError,
            })
            .catch(() => {});
          return;
        }
      }

      // Durante los primeros 6 segundos tras el envío, registrar cualquier imagen existente o lazy-loaded de proyectos antiguos
      if (elapsedMs < 6000) {
        for (const img of Array.from(document.querySelectorAll('img'))) {
          img.setAttribute('data-huellas-preexisting', 'true');
          const s = (img.currentSrc || img.src || '').trim();
          if (s) baselineImageUrls.add(s);
        }
        return;
      }

      const imgs = getNewlyGeneratedImagesOnly(baselineImageUrls, 280, 180);
      if (imgs.length === 0) return;

      capturing = true;
      clearInterval(window.__HUELLAS_FLOW_THUMB_WATCHER__);
      window.__HUELLAS_FLOW_THUMB_WATCHER__ = null;

      let idx = 0;
      for (const imgEl of imgs.slice(0, 2)) {
        imgEl.setAttribute('data-huellas-preexisting', 'true');
        const src = (imgEl.currentSrc || imgEl.src || '').trim();
        baselineImageUrls.add(src);
        const imageDataUrl = await fetchVideoBinaryDataUrl(src, imgEl);
        const opt = optionLabel || (idx === 0 ? 'A' : 'B');
        idx++;
        chrome.runtime
          .sendMessage({
            type: 'FLOW_THUMBNAIL_CAPTURED',
            option: opt,
            imageUrl: src,
            imageDataUrl,
          })
          .catch(() => {});
      }
    }, 2000);
  }

  async function handleScanFlowThumbnails() {
    const imgs = Array.from(document.querySelectorAll('img')).filter((img) => {
      const w = img.naturalWidth || img.width || 0;
      const src = (img.currentSrc || img.src || '').trim();
      return src && !src.includes('avatar') && w >= 280;
    });
    if (imgs.length === 0) {
      reportStatus('ERROR', 'No se encontraron imágenes de miniatura en Google Flow.');
      return;
    }
    const latestThree = imgs.slice(0, 3);
    const labels = ['A', 'B', 'C'];
    for (let i = 0; i < latestThree.length; i++) {
      const src = (latestThree[i].currentSrc || latestThree[i].src || '').trim();
      const imageDataUrl = await fetchVideoBinaryDataUrl(src, latestThree[i]);
      chrome.runtime
        .sendMessage({
          type: 'FLOW_THUMBNAIL_CAPTURED',
          option: labels[i] || 'A',
          imageUrl: src,
          imageDataUrl,
        })
        .catch(() => {});
    }
  }

  function startFlowReferenceImagesWatcher({
    referenceId,
    referenceTag,
    referenceTags,
    expectedCount,
    baselineImageUrls,
  }) {
    if (window.__HUELLAS_FLOW_REF_WATCHER__) {
      clearInterval(window.__HUELLAS_FLOW_REF_WATCHER__);
      window.__HUELLAS_FLOW_REF_WATCHER__ = null;
    }

    const tagsList = Array.isArray(referenceTags) ? referenceTags : [];
    const totalExpected =
      typeof expectedCount === 'number' && expectedCount > 0
        ? expectedCount
        : tagsList.length > 0
        ? tagsList.length
        : 1;

    const startedAt = Date.now();
    const maxWaitMs = Math.max(180000, totalExpected * 75000);
    let capturing = false;
    let capturedCount = 0;

    window.__HUELLAS_FLOW_REF_WATCHER__ = setInterval(async () => {
      if (capturing) return;
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > maxWaitMs) {
        clearInterval(window.__HUELLAS_FLOW_REF_WATCHER__);
        window.__HUELLAS_FLOW_REF_WATCHER__ = null;
        return;
      }

      // Durante los primeros 6 segundos tras enviar el prompt, marcar todas las imágenes ya presentes o lazy-loaded como preexistentes
      if (elapsedMs < 6000) {
        for (const img of Array.from(document.querySelectorAll('img'))) {
          img.setAttribute('data-huellas-preexisting', 'true');
          const s = (img.currentSrc || img.src || '').trim();
          if (s) baselineImageUrls.add(s);
        }
        return;
      }

      const imgs = getNewlyGeneratedImagesOnly(baselineImageUrls, 220, 150);
      if (imgs.length === 0) return;

      capturing = true;
      try {
        for (const imgEl of imgs) {
          imgEl.setAttribute('data-huellas-preexisting', 'true');
          const src = (imgEl.currentSrc || imgEl.src || '').trim();
          if (!src || baselineImageUrls.has(src)) continue;
          baselineImageUrls.add(src);

          const imageDataUrl = await fetchVideoBinaryDataUrl(src, imgEl);
          const matchedTag =
            (totalExpected === 1 ? referenceTag : tagsList[capturedCount]) ||
            tagsList[capturedCount] ||
            referenceTag ||
            '';

          chrome.runtime
            .sendMessage({
              type: 'FLOW_REFERENCE_CAPTURED',
              referenceId: totalExpected === 1 ? referenceId : undefined,
              referenceTag: matchedTag,
              referenceIndex: capturedCount,
              imageUrl: src,
              imageDataUrl,
            })
            .catch(() => {});

          capturedCount++;
          if (capturedCount >= totalExpected) {
            clearInterval(window.__HUELLAS_FLOW_REF_WATCHER__);
            window.__HUELLAS_FLOW_REF_WATCHER__ = null;
            break;
          }
        }
      } finally {
        capturing = false;
      }
    }, 2000);
  }

  async function handleScanFlowReferences(payload) {
    const imgs = Array.from(document.querySelectorAll('img')).filter((img) => {
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      const src = (img.currentSrc || img.src || '').trim();
      return src && !src.includes('avatar') && w >= 220 && h >= 150;
    });
    if (imgs.length === 0) {
      reportStatus(
        'ERROR',
        'No se encontraron imágenes de referencia generadas en la pestaña de Google Flow.'
      );
      return;
    }

    const tagsList = Array.isArray(payload?.referenceTags) ? payload.referenceTags : [];
    const maxToScan = Math.min(imgs.length, Math.max(tagsList.length || 6, 6));
    const sliceImgs = imgs.slice(0, maxToScan);

    reportStatus(
      'WORKING',
      `🔍 Importando ${sliceImgs.length} imagen(es) de @Referencias desde Google Flow...`
    );

    for (let i = 0; i < sliceImgs.length; i++) {
      const src = (sliceImgs[i].currentSrc || sliceImgs[i].src || '').trim();
      const imageDataUrl = await fetchVideoBinaryDataUrl(src, sliceImgs[i]);
      chrome.runtime
        .sendMessage({
          type: 'FLOW_REFERENCE_CAPTURED',
          referenceTag: tagsList[i] || '',
          referenceIndex: i,
          imageUrl: src,
          imageDataUrl,
        })
        .catch(() => {});
    }
  }

  function startFlowVideoWatcher({
    clipNumber,
    clipId,
    prompt,
    attempt,
    baselineUrls,
    batchStartClip,
    batchEndClip,
    expectedCount,
  }) {
    if (window.__HUELLAS_FLOW_WATCHER_TIMER__) {
      clearInterval(window.__HUELLAS_FLOW_WATCHER_TIMER__);
      window.__HUELLAS_FLOW_WATCHER_TIMER__ = null;
    }

    scanFlowFailureCards(true);

    const totalExpected =
      typeof expectedCount === 'number' && expectedCount > 1
        ? expectedCount
        : batchStartClip && batchEndClip && batchEndClip >= batchStartClip
        ? batchEndClip - batchStartClip + 1
        : 1;

    const startedAt = Date.now();
    const maxWaitMs = totalExpected > 1 ? 1500000 : 270000; // 25 min for 10-clip batch, 4.5 min for 1 clip
    let capturing = false;
    let capturedCount = 0;

    window.__HUELLAS_FLOW_WATCHER_TIMER__ = setInterval(async () => {
      if (capturing) return;
      const elapsedMs = Date.now() - startedAt;
      const elapsedSec = Math.round(elapsedMs / 1000);

      if (elapsedMs > maxWaitMs) {
        clearInterval(window.__HUELLAS_FLOW_WATCHER_TIMER__);
        window.__HUELLAS_FLOW_WATCHER_TIMER__ = null;
        reportStatus(
          'ERROR',
          `⚠️ Tiempo de espera agotado (${elapsedSec}s) esperando video(s) en Google Flow.`,
          { clipNumber, clipId }
        );
        return;
      }

      // Durante los primeros 3 segundos, marcar cualquier error anterior en la página como ya manejado
      if (elapsedMs < 3000) {
        scanFlowFailureCards(true);
      } else {
        const failure = scanFlowFailureCards(false);
        if (failure) {
          const failedClipNum =
            totalExpected > 1
              ? (batchStartClip || clipNumber || 1) + capturedCount
              : clipNumber || 1;

          if (totalExpected <= 1) {
            clearInterval(window.__HUELLAS_FLOW_WATCHER_TIMER__);
            window.__HUELLAS_FLOW_WATCHER_TIMER__ = null;
          }

          reportStatus(
            'ERROR',
            `🛡️ Clip #${String(failedClipNum).padStart(
              2,
              '0'
            )}: Google Flow bloqueó el prompt (${
              failure.isProminentPeopleError
                ? 'Política Prominent People / Personas Prominentes'
                : 'Política de Contenido'
            }). Reajustando prompt automáticamente para evadir el filtro y reenviando...`,
            { clipNumber: failedClipNum, clipId }
          );

          chrome.runtime
            .sendMessage({
              type: 'FLOW_GENERATION_FAILED',
              mediaType: 'VIDEO',
              clipNumber: failedClipNum,
              clipId: totalExpected === 1 ? clipId : undefined,
              attempt: attempt || 1,
              prompt: prompt || '',
              errorText: failure.errorText,
              isProminentPeopleError: failure.isProminentPeopleError,
            })
            .catch(() => {});

          if (totalExpected <= 1) {
            return;
          }
        }
      }

      // Look for any <video> element whose URL is NOT in baselineUrls
      const allVideos = Array.from(document.querySelectorAll('video'));
      let candidateVideo = null;

      for (const v of allVideos) {
        const u = getVideoElementUrl(v);
        if (!u || baselineUrls.has(u)) continue;
        // Ensure video has started loading or has dimensions
        if (v.readyState >= 1 || v.videoWidth > 0 || u.startsWith('http') || u.startsWith('blob:')) {
          candidateVideo = v;
          break;
        }
      }

      if (!candidateVideo) {
        if (elapsedSec % 4 === 0) {
          const nextNum =
            totalExpected > 1
              ? (batchStartClip || clipNumber || 1) + capturedCount
              : clipNumber || '?';
          reportStatus(
            'GENERATING',
            `⏳ Google Flow generando video del Clip #${String(nextNum).padStart(2, '0')}${
              totalExpected > 1 ? ` (${capturedCount}/${totalExpected} del lote listos)` : ''
            }... (${elapsedSec}s)`,
            { clipNumber: nextNum, clipId }
          );
        }
        return;
      }

      capturing = true;
      const candidateUrl = getVideoElementUrl(candidateVideo);
      baselineUrls.add(candidateUrl);

      const inferredNum =
        inferClipNumberFromVideoCard(candidateVideo) ||
        (totalExpected > 1
          ? (batchStartClip || clipNumber || 1) + capturedCount
          : clipNumber || 1);

      capturedCount++;

      if (capturedCount >= totalExpected) {
        clearInterval(window.__HUELLAS_FLOW_WATCHER_TIMER__);
        window.__HUELLAS_FLOW_WATCHER_TIMER__ = null;
      }

      reportStatus(
        'WORKING',
        `🎞️ ¡Video del Clip #${String(inferredNum).padStart(
          2,
          '0'
        )} detectado en Google Flow! Extrayendo fotogramas y archivo MP4 para auditoría automática...`,
        { clipNumber: inferredNum, clipId }
      );

      // Give the video element 900ms to finish buffering initial metadata
      await new Promise((r) => setTimeout(r, 900));

      const captured = await captureVideoFramesAndBinary(candidateVideo);

      try {
        await chrome.runtime.sendMessage({
          type: 'FLOW_VIDEO_CAPTURED',
          clipNumber: inferredNum,
          clipId: totalExpected === 1 ? clipId : undefined,
          attempt: attempt || 1,
          prompt,
          videoUrl: captured.videoUrl,
          videoDataUrl: captured.videoDataUrl,
          frames: captured.frames,
          duration: captured.duration,
        });
      } catch {
        // Fallback without binary if payload was unusually large
        chrome.runtime
          .sendMessage({
            type: 'FLOW_VIDEO_CAPTURED',
            clipNumber: inferredNum,
            clipId: totalExpected === 1 ? clipId : undefined,
            attempt: attempt || 1,
            prompt,
            videoUrl: captured.videoUrl,
            videoDataUrl: '',
            frames: captured.frames,
            duration: captured.duration,
          })
          .catch(() => {});
      } finally {
        capturing = false;
      }
    }, 1800);
  }

  async function handleScanExistingFlowVideos(payload) {
    const videos = Array.from(document.querySelectorAll('video')).filter((v) =>
      Boolean(getVideoElementUrl(v))
    );
    if (videos.length === 0) {
      reportStatus(
        'ERROR',
        'No se encontraron videos generados en la pestaña abierta de Google Flow.'
      );
      return;
    }

    reportStatus(
      'WORKING',
      `🔍 Escaneando ${videos.length} video(s) en Google Flow para auditarlos contra sus Prompts y Voz Narrativa...`
    );

    const seenUrls = new Set();
    let fallbackIndex = 1;

    for (const v of videos) {
      const url = getVideoElementUrl(v);
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);

      const inferredNum = inferClipNumberFromVideoCard(v) || payload?.clipNumber || fallbackIndex;
      fallbackIndex++;

      const captured = await captureVideoFramesAndBinary(v);
      try {
        await chrome.runtime.sendMessage({
          type: 'FLOW_VIDEO_CAPTURED',
          clipNumber: inferredNum,
          clipId: payload?.clipId,
          attempt: 1,
          videoUrl: captured.videoUrl,
          videoDataUrl: captured.videoDataUrl,
          frames: captured.frames,
          duration: captured.duration,
          fromScan: true,
        });
      } catch {}
    }
  }

  function extractLatestFlowMedia() {
    const videos = Array.from(document.querySelectorAll('video'))
      .map((v) => getVideoElementUrl(v))
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

  function attachLogoImageToFlow(inputEl, logoDataUrl) {
    if (!logoDataUrl || typeof logoDataUrl !== 'string' || !logoDataUrl.startsWith('data:')) {
      return false;
    }
    try {
      const parts = logoDataUrl.split(',');
      const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/png';
      const bstr = atob(parts[1] || '');
      const u8arr = new Uint8Array(bstr.length);
      for (let i = 0; i < bstr.length; i++) {
        u8arr[i] = bstr.charCodeAt(i);
      }
      const logoFile = new File([u8arr], 'Logo_Huellas_de_la_Humanidad.png', { type: mime });
      const dt = new DataTransfer();
      dt.items.add(logoFile);

      // 1. If a file input exists in Google Flow's DOM, attach the logo file to it directly
      const fileInputs = Array.from(
        document.querySelectorAll('input[type="file"][accept*="image" i], input[type="file"]')
      );
      for (const fi of fileInputs) {
        try {
          fi.files = dt.files;
          fi.dispatchEvent(new Event('change', { bubbles: true }));
          fi.dispatchEvent(new Event('input', { bubbles: true }));
        } catch {}
      }

      // 2. Also paste and drop the logo PNG file onto ProseMirror / composer container
      const targetEl = inputEl || document.body;
      try {
        targetEl.dispatchEvent(
          new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            composed: true,
            clipboardData: dt,
          })
        );
      } catch {}

      const dropZone = targetEl.parentElement || targetEl;
      for (const evType of ['dragenter', 'dragover', 'drop']) {
        try {
          dropZone.dispatchEvent(
            new DragEvent(evType, {
              bubbles: true,
              cancelable: true,
              composed: true,
              dataTransfer: dt,
            })
          );
        } catch {}
      }
      return true;
    } catch {
      return false;
    }
  }

  function startWatcherForPayload(payload) {
    // Asegurar que no quede ningún watcher automático de imágenes corriendo en segundo plano
    if (window.__HUELLAS_FLOW_REF_WATCHER__) {
      clearInterval(window.__HUELLAS_FLOW_REF_WATCHER__);
      window.__HUELLAS_FLOW_REF_WATCHER__ = null;
    }
    if (payload.mediaType === 'VIDEO') {
      const ssModal = document.getElementById('story-studio-modal-root');
      if (ssModal) ssModal.remove();
    }
    if (payload.mediaType === 'REFERENCES' || payload.mediaType === 'IMAGE') {
      // No iniciar autodescarga en segundo plano para Referencias (evita descargar imágenes antiguas de otros proyectos)
      return;
    }

    const rawPromptText = payload.prompt || payload.text || '';
    const promptText =
      payload.mediaType === 'THUMBNAILS'
        ? rawPromptText.replace(/^Thumbnail\s*:\s*/i, '').trim()
        : rawPromptText;
    const baselineUrls = getAllCurrentVideoUrlsSet();
    const baselineImageUrls = getAllCurrentImageUrlsSet();

    if (payload.mediaType === 'THUMBNAILS') {
      startFlowThumbnailWatcher({
        optionLabel: payload.optionLabel,
        prompt: promptText,
        attempt: payload.attempt || 1,
        baselineImageUrls,
      });
    } else if (payload.watchForVideo !== false) {
      startFlowVideoWatcher({
        clipNumber: payload.clipNumber,
        clipId: payload.clipId,
        prompt: promptText,
        attempt: payload.attempt || 1,
        baselineUrls,
        batchStartClip: payload.batchStartClip,
        batchEndClip: payload.batchEndClip,
        expectedCount: payload.expectedCount,
      });
    }
  }

  function handleSendFlowPrompt(payload) {
    const rawPromptText = payload.prompt || payload.text || '';
    const promptText =
      payload.mediaType === 'THUMBNAILS'
        ? rawPromptText.replace(/^Thumbnail\s*:\s*/i, '').trim()
        : rawPromptText;

    // Si llegó directamente a flow-content.js, delegar al Service Worker (background.js)
    // y solo activar el Watcher si el envío fue exitoso
    chrome.runtime.sendMessage(
      {
        action: 'SEND_PROMPT',
        payload: {
          ...payload,
          text: promptText,
          prompt: promptText,
        },
      },
      (response) => {
        if (!chrome.runtime.lastError && response && response.ok && response.submitted) {
          startWatcherForPayload(payload);
        }
      }
    );

    return true;
  }

  window.__HUELLAS_FLOW_MESSAGE_HANDLER__ = (msg, _sender, sendResponse) => {
    if (!msg) return false;

    if (msg.action === 'EXECUTE_FLOW_PROMPT' || msg.type === 'EXECUTE_FLOW_PROMPT') {
      const text = msg.payload?.text || msg.text || msg.prompt || '';
      chrome.runtime.sendMessage(
        {
          action: 'SEND_PROMPT',
          payload: { ...(msg.payload || {}), text, prompt: text },
        },
        (response) => {
          sendResponse(response);
        }
      );
      return true;
    }

    if (msg.target !== 'FLOW') return false;

    if (msg.action === 'START_FLOW_WATCHER_AFTER_SUBMIT') {
      startWatcherForPayload(msg);
      sendResponse({ handled: true });
      return false;
    }

    if (msg.action === 'SEND_PROMPT' || msg.action === 'SEND_PROMPT_V2') {
      const ok = handleSendFlowPrompt(msg);
      sendResponse({ handled: ok });
      return false;
    }

    if (msg.action === 'SCAN_FLOW_VIDEOS') {
      handleScanExistingFlowVideos(msg);
      sendResponse({ handled: true });
      return false;
    }

    if (msg.action === 'SCAN_FLOW_THUMBNAILS') {
      handleScanFlowThumbnails();
      sendResponse({ handled: true });
      return false;
    }

    if (msg.action === 'SCAN_FLOW_REFERENCES') {
      handleScanFlowReferences(msg);
      sendResponse({ handled: true });
      return false;
    }

    if (msg.action === 'STOP_FLOW_WATCHER') {
      if (window.__HUELLAS_FLOW_WATCHER_TIMER__) {
        clearInterval(window.__HUELLAS_FLOW_WATCHER_TIMER__);
        window.__HUELLAS_FLOW_WATCHER_TIMER__ = null;
      }
      if (window.__HUELLAS_FLOW_REF_WATCHER__) {
        clearInterval(window.__HUELLAS_FLOW_REF_WATCHER__);
        window.__HUELLAS_FLOW_REF_WATCHER__ = null;
      }
      sendResponse({ handled: true });
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

  // Listen for images & videos captured inside the Story Studio / Huellas Flow Tool (flow-sdk) iframe and forward to Huellas Master
  if (!window.__HUELLAS_STORY_STUDIO_BRIDGE_LISTENER__) {
    window.__HUELLAS_STORY_STUDIO_BRIDGE_LISTENER__ = true;
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || data.source !== 'HUELLAS_STORY_STUDIO_FRAME') return;

      if (data.type === 'FLOW_REFERENCE_CAPTURED') {
        chrome.runtime
          .sendMessage({
            type: 'FLOW_REFERENCE_CAPTURED',
            referenceId: data.referenceId,
            referenceTag: data.referenceTag,
            referenceIndex: data.referenceIndex,
            mediaId: data.mediaId,
            imageDataUrl: data.imageDataUrl,
          })
          .catch(() => {});
      } else if (data.type === 'FLOW_CLIP_IMAGE_CAPTURED') {
        chrome.runtime
          .sendMessage({
            type: 'FLOW_CLIP_IMAGE_CAPTURED',
            clipNumber: data.clipNumber,
            clipId: data.clipId,
            mediaId: data.mediaId,
            imageUrl: data.imageDataUrl || data.imageUrl,
            imageDataUrl: data.imageDataUrl || data.imageUrl,
          })
          .catch(() => {});
      } else if (data.type === 'FLOW_VIDEO_CAPTURED') {
        chrome.runtime
          .sendMessage({
            type: 'FLOW_VIDEO_CAPTURED',
            clipNumber: data.clipNumber || 1,
            clipId: data.clipId,
            attempt: data.attempt || 1,
            prompt: data.prompt || '',
            videoUrl: data.videoDataUrl || data.videoUrl || '',
            videoDataUrl: data.videoDataUrl || data.videoUrl || '',
            frames: data.frames || [],
            duration: data.duration || 10,
          })
          .catch(() => {});
      }
    });
  }
})();
