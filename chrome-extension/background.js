// ============================================================================
// HUELLAS MASTER — BACKGROUND SERVICE WORKER (v2.3.0)
// Automatización Hardware CDP para Google Flow (una sola sesión limpia):
// - Espera 300ms tras chrome.debugger.attach para estabilizar el viewport
// - Toma snapshot de imágenes preexistentes (window.__flowPreExistingMedia y data-huellas-preexisting)
// - Inyección híbrida MAIN (execCommand + InputEvent) + CDP Input.insertText sin Backspace
// - Prioridad 1: Tecla Enter física por hardware (windowsVirtualKeyCode: 13)
// - Prioridad 2: Clic hardware en button.generate-icon-button con Lista Negra estricta (prohibido X / Clear / Download)
// - Inicia el Watcher de imágenes/videos ÚNICAMENTE después de confirmar el envío
// ============================================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getConnectedAiTabsInWindow(windowId) {
  try {
    const queryOpts = typeof windowId === 'number' ? { windowId } : { currentWindow: true };
    const windowTabs = await chrome.tabs.query(queryOpts);

    const geminiTabs = windowTabs
      .filter((t) => t.url && t.url.startsWith('https://gemini.google.com/'))
      .map((t) => ({
        id: t.id,
        windowId: t.windowId,
        title:
          (t.title || 'Google Gemini').replace(/ - Google Gemini$/i, '').trim() ||
          'Google Gemini',
        url: t.url,
      }));

    const flowTabs = windowTabs
      .filter(
        (t) =>
          t.url &&
          (t.url.includes('flow.google.com') ||
            (t.url.includes('labs.google') && t.url.toLowerCase().includes('flow')))
      )
      .map((t) => ({
        id: t.id,
        windowId: t.windowId,
        title:
          (t.title || 'Google Flow').replace(/^Google Flow - /i, '').trim() ||
          'Google Flow',
        url: t.url,
      }));

    const sunoTabs = windowTabs
      .filter((t) => t.url && t.url.includes('suno.com'))
      .map((t) => ({
        id: t.id,
        windowId: t.windowId,
        title: (t.title || 'Suno AI').trim() || 'Suno AI',
        url: t.url,
      }));

    return { geminiTabs, flowTabs, sunoTabs };
  } catch {
    return { geminiTabs: [], flowTabs: [], sunoTabs: [] };
  }
}

async function ensureScriptInjected(tabId, scriptFile) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [scriptFile],
    });
  } catch {}
}

function isHuellasUrl(url) {
  if (!url) return false;
  return (
    url.startsWith('http://localhost:4200') ||
    url.startsWith('http://127.0.0.1:4200') ||
    url.startsWith('https://raydelw-a11y.github.io') ||
    url.includes('huellasdelahumanidad.com')
  );
}

// One-time injection into already-open tabs when extension starts/reloads
(async function initExistingHuellasTabsOnce() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue;
      if (isHuellasUrl(tab.url)) {
        ensureScriptInjected(tab.id, 'huellas-bridge.js');
      } else if (tab.url.startsWith('https://gemini.google.com/')) {
        ensureScriptInjected(tab.id, 'gemini-content.js');
      } else if (
        tab.url.includes('flow.google.com') ||
        (tab.url.includes('labs.google') && tab.url.toLowerCase().includes('flow'))
      ) {
        ensureScriptInjected(tab.id, 'flow-content.js');
      }
    }
  } catch {}
})();

async function broadcastToHuellasTabsInSameWindow(windowId, payload) {
  try {
    const queryOpts = typeof windowId === 'number' ? { windowId } : {};
    const tabs = await chrome.tabs.query(queryOpts);
    for (const tab of tabs) {
      if (tab.id && isHuellasUrl(tab.url)) {
        chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
      }
    }
  } catch {}
}

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (!tab || typeof tab.windowId !== 'number') return;
  if (changeInfo.status === 'complete' || changeInfo.title) {
    const { geminiTabs, flowTabs } = await getConnectedAiTabsInWindow(tab.windowId);
    broadcastToHuellasTabsInSameWindow(tab.windowId, {
      type: 'HUELLAS_CONNECTED_TABS_UPDATE',
      geminiTabs,
      flowTabs,
    });
  }
});

chrome.tabs.onRemoved.addListener(async (_tabId, removeInfo) => {
  if (!removeInfo || removeInfo.isWindowClosing || typeof removeInfo.windowId !== 'number') return;
  const { geminiTabs, flowTabs } = await getConnectedAiTabsInWindow(removeInfo.windowId);
  broadcastToHuellasTabsInSameWindow(removeInfo.windowId, {
    type: 'HUELLAS_CONNECTED_TABS_UPDATE',
    geminiTabs,
    flowTabs,
  });
});

// ============================================================================
// GOOGLE FLOW — AUTOMATIZACIÓN HARDWARE CDP + HÍBRIDO MAIN WORLD
// ============================================================================

/**
 * Busca el botón de enviar EXCLUSIVAMENTE dentro de la barra del compositor (altura <= 320px).
 * Prohibido salir hacia la galería de proyectos o tocar botones de Clear (X) / Download.
 */
function findStrictComposerSubmitButton() {
  const allCandidates = [
    ...document.querySelectorAll('div.ProseMirror[contenteditable="true"]'),
    ...document.querySelectorAll('div[contenteditable="true"][role="textbox"]'),
    ...document.querySelectorAll('textarea:not(.g-recaptcha-response)'),
  ].filter((el) => {
    const r = el.getBoundingClientRect();
    return (
      r.width > 30 &&
      r.height > 10 &&
      getComputedStyle(el).visibility !== 'hidden' &&
      !el.closest('.agent-panel-animation-container, .sidenav, mat-sidenav, mat-drawer')
    );
  });

  const editorEl = allCandidates[0] || null;
  if (!editorEl) return { found: false, reason: 'NO_EDITOR' };

  const editorRect = editorEl.getBoundingClientRect();

  // Paso 1: Subir desde el editor SOLO mientras estemos dentro de la barra de prompt (altura <= 320px)
  // Esto garantiza que NUNCA tocaremos botones de la galería de proyectos antiguos
  let composerRoot = editorEl.parentElement;
  let curr = editorEl.parentElement;

  for (let depth = 0; depth < 6 && curr && curr !== document.body; depth++) {
    const r = curr.getBoundingClientRect();
    if (r.height > 320) {
      break;
    }
    composerRoot = curr;
    curr = curr.parentElement;
  }

  if (!composerRoot) return { found: false, reason: 'NO_COMPOSER_ROOT' };

  // LISTA NEGRA ESTRICTA: Prohibido tocar botones de borrar (X / Clear), cerrar, descargar, adjuntar o ajustes
  const FORBIDDEN_PATTERNS =
    /close|clear|delete|remove|cancel|reset|trash|backspace|download|file_download|save|export|cerrar|borrar|limpiar|eliminar|descargar|add|plus|attach|upload|image|mic|voice|settings|tune|sliders|aspect|ratio|model|history|expand|collapse|more_vert|more_horiz|menu/i;

  const SUBMIT_ICONS = ['arrow_upward', 'arrow_forward', 'send', 'subdirectory_arrow_left'];
  const SUBMIT_LABELS =
    /\b(send|submit|generate|create|run|enviar|generar|crear|start generation|iniciar generaci)\b/i;

  const allComposerButtons = Array.from(composerRoot.querySelectorAll('button')).filter((b) => {
    const r = b.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || getComputedStyle(b).visibility === 'hidden') {
      return false;
    }

    const iconAndText = (b.textContent || '').trim().toLowerCase();
    const classStr = (b.className || '').toLowerCase();
    const aria = (
      (b.getAttribute('aria-label') || '') +
      ' ' +
      (b.getAttribute('title') || '') +
      ' ' +
      (b.getAttribute('data-tooltip') || '')
    ).toLowerCase();

    // Si es explícitamente button.generate-icon-button, permitirlo siempre que no sea clear/close
    if (classStr.includes('clear') || classStr.includes('close') || classStr.includes('delete')) {
      return false;
    }

    // Excluir si coincide con cualquier patrón prohibido (ej. close / clear / download)
    if (FORBIDDEN_PATTERNS.test(iconAndText) || FORBIDDEN_PATTERNS.test(aria)) {
      return false;
    }

    // Excluir botones cuyo texto sea literalmente "x", "×" o "+"
    if (iconAndText === 'x' || iconAndText === '×' || iconAndText === '+') {
      return false;
    }

    return true;
  });

  // Prioridad 0: Clase exacta de Google Flow verificada en DevTools (button.generate-icon-button)
  let chosenBtn = allComposerButtons.find((b) =>
    b.classList.contains('generate-icon-button') ||
    Boolean(b.closest('flow-generate-icon-button, [submitbutton], .submit-button-slot'))
  );

  // Prioridad 1: Botón con ícono arrow_upward / arrow_forward / send o aria-label de envío
  if (!chosenBtn) {
    chosenBtn = allComposerButtons.find((b) => {
      const text = (b.textContent || '').trim().toLowerCase();
      const aria = (
        (b.getAttribute('aria-label') || '') +
        ' ' +
        (b.getAttribute('title') || '')
      ).toLowerCase();

      return (
        SUBMIT_ICONS.some((icon) => text.includes(icon)) ||
        SUBMIT_LABELS.test(aria) ||
        b.type === 'submit'
      );
    });
  }

  // Prioridad 2: Si el botón usa un <svg> o <mat-icon> sin texto prohibido, tomar el botón redondo en la esquina inferior derecha del compositor
  if (!chosenBtn) {
    const rightSideButtons = allComposerButtons.filter((b) => {
      const r = b.getBoundingClientRect();
      const isRightOfEditorCenter = r.left >= editorRect.left + editorRect.width * 0.5;
      const isCompactButton = r.width <= 72 && r.height <= 72;
      const hasSvgOrIcon = Boolean(b.querySelector('svg, mat-icon, i, span'));
      return isRightOfEditorCenter && isCompactButton && hasSvgOrIcon;
    });

    if (rightSideButtons.length > 0) {
      rightSideButtons.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return rb.right + rb.bottom - (ra.right + ra.bottom);
      });
      chosenBtn = rightSideButtons[0];
    }
  }

  if (!chosenBtn) {
    return { found: false, reason: 'NO_MATCHING_SUBMIT_BTN_IN_COMPOSER' };
  }

  window.__lastValidatedFlowSubmitBtn = chosenBtn;
  const rect = chosenBtn.getBoundingClientRect();
  const isDisabled =
    Boolean(chosenBtn.disabled) || chosenBtn.getAttribute('aria-disabled') === 'true';

  return {
    found: true,
    disabled: isDisabled,
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2),
    text: (chosenBtn.textContent || '').trim(),
    className: chosenBtn.className || '',
    ariaLabel: chosenBtn.getAttribute('aria-label') || '',
  };
}

/**
 * Verifica si el prompt realmente fue enviado (el editor se vació tras Enter o tras clic en el botón validado).
 */
function checkSubmissionState() {
  const allCandidates = [
    ...document.querySelectorAll('div.ProseMirror[contenteditable="true"]'),
    ...document.querySelectorAll('div[contenteditable="true"][role="textbox"]'),
    ...document.querySelectorAll('textarea:not(.g-recaptcha-response)'),
  ].filter((el) => {
    const r = el.getBoundingClientRect();
    return (
      r.width > 30 &&
      r.height > 10 &&
      getComputedStyle(el).visibility !== 'hidden' &&
      !el.closest('.agent-panel-animation-container, .sidenav, mat-sidenav, mat-drawer')
    );
  });

  const editorEl = allCandidates[0] || null;
  if (!editorEl) return { submitted: true, remainingLength: 0 };

  const remainingText = (editorEl.textContent || editorEl.value || '').trim();
  return {
    submitted: remainingText.length === 0,
    remainingLength: remainingText.length,
  };
}

/**
 * Envía la secuencia completa de la tecla física Enter por hardware vía CDP
 */
async function sendHardwareEnterKey(target) {
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    macCharCode: 13,
    text: '\r',
    unmodifiedText: '\r',
  });
  await sleep(25);
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
    type: 'char',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    macCharCode: 13,
    text: '\r',
    unmodifiedText: '\r',
  });
  await sleep(35);
  await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    macCharCode: 13,
  });
}

/**
 * Secuencia física completa de ratón: mouseMoved -> mousePressed -> mouseReleased
 */
async function dispatchHardwareClick(target, x, y) {
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none',
  });
  await sleep(35);
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await sleep(50);
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
}

/**
 * Ejecuta en una sola sesión limpia de chrome.debugger:
 * 1. Snapshot de imágenes antiguas (window.__flowPreExistingMedia y data-huellas-preexisting)
 * 2. Foco físico en el editor + inyección híbrida MAIN (execCommand + InputEvent) + CDP Input.insertText
 * 3. Envío por Hardware Enter (#1) -> Clic Hardware en button.generate-icon-button (#2) -> React/Angular fallback (#3)
 */
async function executeFlowPromptHardware(tabId, rawPromptText, payload = {}) {
  const target = { tabId };
  const mediaType = String(payload.mediaType || '');
  const logoDataUrl = String(payload.logoDataUrl || '');
  const promptText =
    mediaType === 'THUMBNAILS'
      ? String(rawPromptText || '').replace(/^Thumbnail\s*:\s*/i, '').trim()
      : String(rawPromptText || '').trim();

  // 1. Activar la pestaña y enfocar la ventana
  const tab = await chrome.tabs.update(tabId, { active: true }).catch(() => null);
  if (tab?.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  }
  await sleep(150);

  // 2. Adjuntar chrome.debugger desde el inicio
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (err) {
    const msg = String(err?.message || err || '');
    if (!msg.includes('Another debugger is already attached')) {
      throw err;
    }
  }

  // IMPORTANTE: Esperar 300ms a que la barra superior "started debugging" de Chrome
  // termine de bajar para que las coordenadas (X, Y) del viewport jamás se desplacen.
  await sleep(300);

  try {
    // 3. Tomar snapshot de imágenes antiguas + adjuntar logo si es miniatura + localizar y limpiar el editor
    const [prep] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [mediaType, logoDataUrl],
      func: (mType, logoUrl) => {
        // Marcar y guardar todas las imágenes/videos que YA existen en la página (de proyectos antiguos)
        const mediaEls = Array.from(document.querySelectorAll('img, video'));
        const currentUrls = [];
        for (const el of mediaEls) {
          el.setAttribute('data-huellas-preexisting', 'true');
          const u = (el.currentSrc || el.src || '').trim();
          if (u) currentUrls.push(u);
        }
        window.__flowPreExistingMedia = new Set(currentUrls);

        // Localizar el editor visible de Google Flow (excluyendo paneles laterales)
        const candidates = [
          ...document.querySelectorAll('div.ProseMirror[contenteditable="true"]'),
          ...document.querySelectorAll('div[contenteditable="true"][role="textbox"]'),
          ...document.querySelectorAll('textarea:not(.g-recaptcha-response)'),
        ].filter((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.width > 30 &&
            r.height > 10 &&
            getComputedStyle(el).visibility !== 'hidden' &&
            !el.closest('.agent-panel-animation-container, .sidenav, mat-sidenav, mat-drawer')
          );
        });

        const editorEl = candidates[0] || null;
        if (!editorEl) {
          return { found: false, error: 'No se encontró el campo de texto de Google Flow.' };
        }

        // Si es miniatura y hay logo oficial, adjuntarlo al input file
        if (mType === 'THUMBNAILS' && logoUrl && logoUrl.startsWith('data:')) {
          try {
            const parts = logoUrl.split(',');
            const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/png';
            const bstr = atob(parts[1] || '');
            const u8arr = new Uint8Array(bstr.length);
            for (let i = 0; i < bstr.length; i++) {
              u8arr[i] = bstr.charCodeAt(i);
            }
            const logoFile = new File([u8arr], 'Logo_Huellas_de_la_Humanidad.png', { type: mime });
            const dt = new DataTransfer();
            dt.items.add(logoFile);
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
          } catch {}
        }

        // Si había texto residual de un intento previo, limpiarlo en ProseMirror antes de empezar
        const pmView = editorEl.pmViewDesc?.view;
        const existingText = (editorEl.textContent || editorEl.value || '').trim();
        if (existingText.length > 0) {
          if (pmView && pmView.state) {
            try {
              const tr = pmView.state.tr.delete(0, pmView.state.doc.content.size);
              pmView.dispatch(tr);
            } catch {}
          } else if (editorEl.tagName === 'TEXTAREA') {
            editorEl.value = '';
          } else {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(editorEl);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('delete', false);
          }
        }

        editorEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        editorEl.focus();

        const rect = editorEl.getBoundingClientRect();
        return {
          found: true,
          preExistingCount: currentUrls.length,
          editorX: Math.round(rect.left + Math.min(45, rect.width * 0.25)),
          editorY: Math.round(rect.top + rect.height / 2),
        };
      },
    });

    if (!prep?.result?.found) {
      throw new Error(prep?.result?.error || 'No se encontró el editor.');
    }

    const { editorX, editorY, preExistingCount } = prep.result;

    // 4. Hacer clic físico dentro del editor para darle foco nativo real al cursor
    await dispatchHardwareClick(target, editorX, editorY);
    await sleep(100);

    // 5. Inyección Híbrida (MAIN World execCommand + InputEvent + CDP Input.insertText si hace falta)
    // Actualiza simultáneamente el estado interno de ProseMirror, Angular/Wiz/Lit y el DOM sin usar Backspace
    const [hybridInsert] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [promptText],
      func: (textToInsert) => {
        const candidates = [
          ...document.querySelectorAll('div.ProseMirror[contenteditable="true"]'),
          ...document.querySelectorAll('div[contenteditable="true"][role="textbox"]'),
          ...document.querySelectorAll('textarea:not(.g-recaptcha-response)'),
        ].filter((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.width > 30 &&
            r.height > 10 &&
            getComputedStyle(el).visibility !== 'hidden' &&
            !el.closest('.agent-panel-animation-container, .sidenav, mat-sidenav, mat-drawer')
          );
        });
        const textbox = candidates[0] || null;
        if (!textbox) return { injectedInMain: false };

        textbox.focus();
        const selection = window.getSelection();
        if (selection && textbox.tagName !== 'TEXTAREA') {
          const range = document.createRange();
          range.selectNodeContents(textbox);
          selection.removeAllRanges();
          selection.addRange(range);
        }

        document.execCommand('insertText', false, textToInsert);

        const inputEvent = new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType: 'insertText',
          data: textToInsert,
        });
        textbox.dispatchEvent(inputEvent);
        textbox.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

        const current = (textbox.textContent || textbox.value || '').trim();
        return {
          injectedInMain: current.length > 0,
          length: current.length,
        };
      },
    });

    // Si execCommand en MAIN world no llenó el campo, inyectar vía CDP Input.insertText
    if (!hybridInsert?.result?.injectedInMain) {
      await chrome.debugger.sendCommand(target, 'Input.insertText', {
        text: promptText,
      });
    }
    await sleep(120);

    // 6. Verificar que el texto entró, colocar el cursor al final (NUNCA seleccionar todo) y detectar si hay menú @
    const [verifyInsert] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [promptText],
      func: (expectedText) => {
        const candidates = [
          ...document.querySelectorAll('div.ProseMirror[contenteditable="true"]'),
          ...document.querySelectorAll('div[contenteditable="true"][role="textbox"]'),
          ...document.querySelectorAll('textarea:not(.g-recaptcha-response)'),
        ].filter((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.width > 30 &&
            r.height > 10 &&
            getComputedStyle(el).visibility !== 'hidden' &&
            !el.closest('.agent-panel-animation-container, .sidenav, mat-sidenav, mat-drawer')
          );
        });
        const editorEl = candidates[0] || null;
        if (!editorEl) return { ok: false };

        let current = (editorEl.textContent || editorEl.value || '').trim();

        if (current.length === 0) {
          editorEl.focus();
          const pmView = editorEl.pmViewDesc?.view;
          if (pmView && pmView.state) {
            const tr = pmView.state.tr.insertText(expectedText, 0, pmView.state.doc.content.size);
            pmView.dispatch(tr);
          } else {
            document.execCommand('insertText', false, expectedText);
          }
          current = (editorEl.textContent || editorEl.value || '').trim();
        }

        editorEl.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            composed: true,
            inputType: 'insertText',
            data: expectedText,
          })
        );

        // Colocar el cursor al final del texto (NUNCA dejar el texto seleccionado)
        if (editorEl.tagName !== 'TEXTAREA') {
          const sel = window.getSelection();
          if (sel) {
            sel.selectAllChildren(editorEl);
            sel.collapseToEnd();
          }
        }

        const mentionMenuOpen = Boolean(
          document.querySelector(
            '[role="listbox"], [data-radix-popper-content-wrapper] [role="option"]'
          )
        );

        return {
          ok: current.length > 0,
          insertedLength: current.length,
          mentionMenuOpen,
        };
      },
    });

    if (!verifyInsert?.result?.ok) {
      throw new Error('El prompt no pudo insertarse en el editor de Google Flow.');
    }

    // Solo enviar Escape si realmente hay un menú de sugerencias (@) abierto
    if (verifyInsert.result.mentionMenuOpen) {
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      });
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      });
      await sleep(100);
    }

    // 7. Esperar hasta 700ms a que button.generate-icon-button dentro del compositor se habilite
    let submitBtnInfo = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      await sleep(70);
      const [btnScan] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: findStrictComposerSubmitButton,
      });
      if (btnScan?.result?.found && !btnScan.result.disabled) {
        submitBtnInfo = btnScan.result;
        break;
      }
    }

    // =========================================================================
    // 8. MÉTODO DE ENVÍO #1 (PRIORIDAD MÁXIMA): TECLA ENTER FÍSICA POR HARDWARE
    // No puede tocar jamás por error un botón de "Borrar (X)" ni de "Descargar"
    // =========================================================================
    await sendHardwareEnterKey(target);
    await sleep(450);

    let [statusAfterEnter] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: checkSubmissionState,
    });

    if (statusAfterEnter?.result?.submitted) {
      return {
        success: true,
        submitted: true,
        method: 'HARDWARE_ENTER_KEY',
        preExistingCount,
      };
    }

    // =========================================================================
    // 9. MÉTODO DE ENVÍO #2: CLIC HARDWARE EN EL BOTÓN DE ENVIAR VALIDADO (button.generate-icon-button)
    // Solo hace clic si el botón pasó la lista negra (NO es X, Clear ni Download)
    // =========================================================================
    const [freshBtnScan] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: findStrictComposerSubmitButton,
    });

    const validBtn = freshBtnScan?.result?.found ? freshBtnScan.result : submitBtnInfo;

    if (validBtn?.x && validBtn?.y) {
      // Si el framework aún mantiene el atributo disabled de forma estática, habilitarlo antes del clic físico
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => {
          const btn = window.__lastValidatedFlowSubmitBtn;
          if (btn && (btn.hasAttribute('disabled') || btn.classList.contains('disabled'))) {
            btn.removeAttribute('disabled');
            btn.removeAttribute('aria-disabled');
          }
        },
      });
      await dispatchHardwareClick(target, validBtn.x, validBtn.y);
      await sleep(450);
    }

    let [statusAfterClick] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: checkSubmissionState,
    });

    if (statusAfterClick?.result?.submitted) {
      return {
        success: true,
        submitted: true,
        method: 'HARDWARE_BUTTON_CLICK',
        buttonClicked: validBtn,
        preExistingCount,
      };
    }

    // =========================================================================
    // 10. MÉTODO DE ENVÍO #3: DISPARO DIRECTO EN __reactProps$.onClick / .click() DEL BOTÓN VALIDADO
    // =========================================================================
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const btn = window.__lastValidatedFlowSubmitBtn;
        if (!btn) return;
        const propsKey = Object.keys(btn).find((k) => k.startsWith('__reactProps$'));
        if (propsKey && typeof btn[propsKey]?.onClick === 'function') {
          btn[propsKey].onClick({
            nativeEvent: new MouseEvent('click', { bubbles: true, cancelable: true }),
            currentTarget: btn,
            target: btn,
            bubbles: true,
            cancelable: true,
            defaultPrevented: false,
            isTrusted: true,
            preventDefault() {},
            stopPropagation() {},
            isDefaultPrevented: () => false,
            isPropagationStopped: () => false,
            persist() {},
          });
        }
        try {
          btn.click();
        } catch {}
      },
    });

    await sleep(350);
    const [finalStatus] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: checkSubmissionState,
    });

    if (!finalStatus?.result?.submitted) {
      throw new Error(
        `El prompt quedó en el editor sin enviarse. Botón detectado: ${JSON.stringify(
          validBtn || null
        )}`
      );
    }

    return {
      success: true,
      submitted: true,
      method: 'REACT_FIBER_FALLBACK',
      preExistingCount,
    };
  } finally {
    try {
      await chrome.debugger.detach(target);
    } catch {}
  }
}

// ============================================================================
// MESSAGE LISTENER (HUELLAS MASTER + CONTENT SCRIPTS)
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;

  const senderWindowId = sender?.tab?.windowId;

  // Direct SEND_PROMPT / EXECUTE_FLOW_PROMPT delegation
  if (
    message.action === 'SEND_PROMPT' ||
    message.type === 'SEND_PROMPT' ||
    message.action === 'EXECUTE_FLOW_PROMPT' ||
    message.type === 'EXECUTE_FLOW_PROMPT'
  ) {
    const tabId = message.payload?.tabId || message.tabId || sender?.tab?.id;
    const promptText =
      message.payload?.text ||
      message.payload?.prompt ||
      message.text ||
      message.prompt;

    if (!tabId || !promptText) {
      sendResponse({ success: false, error: 'Faltan parámetros tabId o promptText.' });
      return false;
    }

    executeFlowPromptHardware(tabId, promptText, message.payload || message)
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((err) => {
        console.error('[FlowAutomator] Error:', err);
        sendResponse({ success: false, ok: false, error: String(err?.message || err) });
      });

    return true;
  }

  if (!message.type) return false;

  // 1. Ping from Huellas Master: return Gemini, Flow & Suno tabs in the SAME window
  if (message.type === 'HUELLAS_PING_V2' || message.type === 'HUELLAS_PING') {
    getConnectedAiTabsInWindow(senderWindowId).then(
      async ({ geminiTabs, flowTabs, sunoTabs }) => {
        for (const gt of geminiTabs) {
          if (gt.id) ensureScriptInjected(gt.id, 'gemini-content.js');
        }
        for (const ft of flowTabs) {
          if (ft.id) ensureScriptInjected(ft.id, 'flow-content.js');
        }
        for (const st of sunoTabs || []) {
          if (st.id) ensureScriptInjected(st.id, 'suno-content.js');
        }
        sendResponse({
          ok: true,
          version: '2.3.0',
          windowId: senderWindowId,
          geminiTabs,
          flowTabs,
          sunoTabs: sunoTabs || [],
        });
      }
    );
    return true;
  }

  // 2. Command execution strictly within the SAME Chrome window
  if (message.type === 'HUELLAS_COMMAND') {
    const targetService =
      message.targetService === 'FLOW'
        ? 'FLOW'
        : message.targetService === 'SUNO'
        ? 'SUNO'
        : 'GEMINI';
    const payload = message.payload || {};
    const action = payload.action;

    (async () => {
      const { geminiTabs, flowTabs, sunoTabs } = await getConnectedAiTabsInWindow(senderWindowId);
      const serviceTabs =
        targetService === 'FLOW'
          ? flowTabs
          : targetService === 'SUNO'
          ? sunoTabs || []
          : geminiTabs;
      const defaultUrl =
        targetService === 'FLOW'
          ? 'https://flow.google.com/'
          : targetService === 'SUNO'
          ? 'https://suno.com/create'
          : 'https://gemini.google.com/app';
      const contentScriptFile =
        targetService === 'FLOW'
          ? 'flow-content.js'
          : targetService === 'SUNO'
          ? 'suno-content.js'
          : 'gemini-content.js';

      // Focus or open tab in the SAME window (never create a new window)
      if (action === 'FOCUS_TAB' || action === 'OPEN_DOCKED') {
        const existing =
          serviceTabs.find((t) => t.id === payload.tabId) || serviceTabs[0] || null;
        if (existing && existing.id) {
          await chrome.tabs.update(existing.id, { active: true });
          sendResponse({ ok: true, tabId: existing.id });
        } else {
          const created = await chrome.tabs.create({
            windowId: senderWindowId,
            url: defaultUrl,
            active: true,
          });
          sendResponse({ ok: true, tabId: created.id });
        }
        return;
      }

      // Find target tab in the SAME window
      let targetTab =
        serviceTabs.find((t) => t.id === payload.tabId) || serviceTabs[0] || null;

      if (!targetTab) {
        broadcastToHuellasTabsInSameWindow(senderWindowId, {
          type: 'BRIDGE_STATUS',
          service: targetService,
          status: 'WORKING',
          message: `Abriendo pestaña de ${
            targetService === 'FLOW'
              ? 'Google Flow'
              : targetService === 'SUNO'
              ? 'Suno AI'
              : 'Gemini Web'
          } en esta misma ventana...`,
        });
        const created = await chrome.tabs.create({
          windowId: senderWindowId,
          url: defaultUrl,
          active: true,
        });
        await sleep(4500);
        targetTab = {
          id: created.id,
          windowId: created.windowId,
          title: created.title || targetService,
          url: created.url || defaultUrl,
        };
      }

      if (targetTab && targetTab.id) {
        if (
          payload.focusTab !== false ||
          ((targetService === 'FLOW' || targetService === 'SUNO') && action === 'SEND_PROMPT')
        ) {
          await chrome.tabs.update(targetTab.id, { active: true }).catch(() => {});
        }
        await ensureScriptInjected(targetTab.id, contentScriptFile);
        await sleep(100);

        if (targetService === 'FLOW' && action === 'SEND_PROMPT') {
          try {
            // 1. Primero ejecutar el envío por Hardware CDP (que toma snapshot de las imágenes antiguas antes de enviar)
            const autoRes = await executeFlowPromptHardware(
              targetTab.id,
              String(payload.prompt || ''),
              payload
            );

            // 2. ÚNICAMENTE cuando el prompt ya fue enviado con éxito, iniciar el Watcher en flow-content.js
            chrome.tabs
              .sendMessage(targetTab.id, {
                target: 'FLOW',
                ...payload,
                action: 'START_FLOW_WATCHER_AFTER_SUBMIT',
              })
              .catch(() => {});

            broadcastToHuellasTabsInSameWindow(senderWindowId, {
              type: 'BRIDGE_STATUS',
              service: 'FLOW',
              status: 'GENERATING',
              message: `🎬 Prompt enviado y sometido en Google Flow (${autoRes.method}). Vigilando únicamente imágenes/videos nuevos...`,
              clipNumber: payload.clipNumber,
              clipId: payload.clipId,
              mediaType: payload.mediaType,
            });
            sendResponse({
              ok: true,
              tabId: targetTab.id,
              tabTitle: targetTab.title,
              ...autoRes,
            });
          } catch (err) {
            broadcastToHuellasTabsInSameWindow(senderWindowId, {
              type: 'BRIDGE_STATUS',
              service: 'FLOW',
              status: 'ERROR',
              message: `⚠️ Error sometiendo prompt en Google Flow: ${String(err?.message || err)}`,
            });
            sendResponse({
              ok: false,
              error: String(err?.message || err),
            });
          }
          return;
        }

        // Resto de acciones (SCAN_FLOW_VIDEOS, SCAN_FLOW_REFERENCES, GEMINI, SUNO, etc.)
        chrome.tabs
          .sendMessage(targetTab.id, {
            target: targetService,
            ...payload,
          })
          .catch(() => {});

        // MAIN-world safety injection & submit for Gemini Web
        if (targetService === 'GEMINI' && action === 'SEND_PROMPT' && payload.autoSubmit !== false) {
          const geminiTabId = targetTab.id;
          const geminiPromptArg = String(payload.prompt || '');
          setTimeout(() => {
            chrome.scripting
              .executeScript({
                target: { tabId: geminiTabId },
                world: 'MAIN',
                args: [geminiPromptArg],
                func: (expectedPrompt) => {
                  try {
                    const cleanExpected = (expectedPrompt || '').trim();
                    if (!cleanExpected) return;
                    const inputEl = document.querySelector(
                      'rich-textarea div.ql-editor[contenteditable="true"], div.ql-editor[contenteditable="true"], div[contenteditable="true"][role="textbox"], textarea'
                    );
                    if (!inputEl) return;

                    const currentText = (
                      inputEl.value ??
                      inputEl.innerText ??
                      inputEl.textContent ??
                      ''
                    ).trim();
                    if (!currentText || !currentText.includes(cleanExpected.slice(0, 30))) {
                      inputEl.focus();
                      try {
                        const dt = new DataTransfer();
                        dt.setData('text/plain', cleanExpected);
                        inputEl.dispatchEvent(
                          new ClipboardEvent('paste', {
                            bubbles: true,
                            cancelable: true,
                            composed: true,
                            clipboardData: dt,
                          })
                        );
                      } catch {}
                      const afterPaste = (
                        inputEl.value ??
                        inputEl.innerText ??
                        inputEl.textContent ??
                        ''
                      ).trim();
                      if (!afterPaste || !afterPaste.includes(cleanExpected.slice(0, 25))) {
                        inputEl.innerHTML = '';
                        const p = document.createElement('p');
                        p.textContent = cleanExpected;
                        inputEl.appendChild(p);
                        inputEl.dispatchEvent(
                          new InputEvent('input', {
                            bubbles: true,
                            cancelable: true,
                            inputType: 'insertText',
                            data: cleanExpected,
                          })
                        );
                      }
                    }

                    setTimeout(() => {
                      const remaining = (
                        inputEl?.value ??
                        inputEl?.innerText ??
                        inputEl?.textContent ??
                        ''
                      ).trim();
                      if (!remaining || remaining.length < 5) return;
                      const sendSelectors = [
                        'button.send-button:not([disabled])',
                        '.send-button-container button:not([disabled])',
                        'button[aria-label*="Send message" i]:not([disabled])',
                        'button[aria-label*="Enviar mensaje" i]:not([disabled])',
                        'button[aria-label*="Send" i]:not([disabled])',
                        'button[aria-label*="Enviar" i]:not([disabled])',
                      ];
                      for (const sel of sendSelectors) {
                        const btn = document.querySelector(sel);
                        if (btn) {
                          btn.click();
                          return;
                        }
                      }
                    }, 220);
                  } catch {}
                },
              })
              .catch(() => {});
          }, 420);
        }

        sendResponse({ ok: true, tabId: targetTab.id, tabTitle: targetTab.title });
      } else {
        sendResponse({
          ok: false,
          error: 'No se encontró la pestaña en esta ventana.',
        });
      }
    })();

    return true;
  }

  // 3. Forward status & responses from Gemini/Flow/Suno tab ONLY to Huellas Master in the SAME window
  if (
    message.type === 'BRIDGE_STATUS' ||
    message.type === 'GEMINI_RESPONSE_READY' ||
    message.type === 'FLOW_MEDIA_READY' ||
    message.type === 'FLOW_VIDEO_CAPTURED' ||
    message.type === 'FLOW_THUMBNAIL_CAPTURED' ||
    message.type === 'FLOW_REFERENCE_CAPTURED' ||
    message.type === 'SUNO_AUDIO_CAPTURED'
  ) {
    broadcastToHuellasTabsInSameWindow(senderWindowId, message);
    sendResponse({ ok: true });
    return true;
  }

  // 4. Fetch cross-origin video/image binary as base64 DataURL for frame extraction & auto-download
  if (message.type === 'FETCH_VIDEO_BASE64' && message.url) {
    (async () => {
      try {
        let resp = await fetch(message.url, { credentials: 'include' }).catch(() => null);
        if (!resp || !resp.ok) {
          resp = await fetch(message.url, { credentials: 'omit' });
        }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        const b64 = btoa(binary);
        const mime = resp.headers.get('content-type') || 'video/mp4';
        sendResponse({ ok: true, dataUrl: `data:${mime};base64,${b64}` });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  return false;
});
