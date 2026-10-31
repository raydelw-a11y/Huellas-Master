// ============================================================================
// HUELLAS MASTER — BACKGROUND SERVICE WORKER (v2.4.0)
// 1. Inyecta el prompt en el editor inferior de Google Flow ANTES de adjuntar debugger
//    (usando el selector y ordenamiento exacto por bottom que sí pega el texto en pantalla).
// 2. Adjunta chrome.debugger, espera 350ms a que baje la barra superior, verifica que el
//    texto siga en la caja (sin Backspace ni Escape que lo borren) y hace clic físico
//    (isTrusted: true) EXCLUSIVAMENTE sobre button.generate-icon-button + Enter físico.
// 3. Desactiva la descarga automática en segundo plano de imágenes en Referencias para
//    jamás descargar imágenes antiguas de otros proyectos.
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
// GOOGLE FLOW — INYECCIÓN SEGURA EN MAIN WORLD + CLIC HARDWARE EN button.generate-icon-button
// ============================================================================

/**
 * PASO 1 (Ejecutado en world: 'MAIN' ANTES de adjuntar chrome.debugger):
 * Localiza el editor de prompt inferior de Google Flow (ordenando por rect.bottom)
 * e inyecta el texto mediante execCommand('insertText') + ProseMirror + InputEvent.
 * Coloca el cursor al final sin dejar nada seleccionado.
 */
async function injectPromptIntoBottomEditor(rawPromptText, mediaType, logoDataUrl) {
  const sleepMain = (ms) => new Promise((r) => setTimeout(r, ms));
  const promptText =
    mediaType === 'THUMBNAILS'
      ? String(rawPromptText || '').replace(/^Thumbnail\s*:\s*/i, '').trim()
      : String(rawPromptText || '').trim();
  const safePrompt = promptText.endsWith(' ') ? promptText : `${promptText} `;

  function findBottomPromptEditor() {
    const allCandidates = [
      ...document.querySelectorAll('div.ProseMirror[contenteditable="true"]'),
      ...document.querySelectorAll('div[contenteditable="true"][role="textbox"]'),
      ...document.querySelectorAll('textarea:not(.g-recaptcha-response)'),
    ].filter((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.width > 60 &&
        r.height > 14 &&
        r.bottom > 0 &&
        getComputedStyle(el).visibility !== 'hidden' &&
        !el.closest('.agent-panel-animation-container, .sidenav, mat-sidenav, mat-drawer')
      );
    });

    if (allCandidates.length === 0) return null;

    // Ordenar por el más cercano a la parte inferior de la ventana (barra de prompt de Google Flow)
    allCandidates.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.bottom * 2 + rb.width - (ra.bottom * 2 + ra.width);
    });
    return allCandidates[0];
  }

  const editorEl = findBottomPromptEditor();
  if (!editorEl) {
    return { injected: false, error: 'No se encontró la caja de prompt en Google Flow.' };
  }

  // Adjuntar logo oficial sólo cuando se están creando Miniaturas
  if (mediaType === 'THUMBNAILS' && logoDataUrl && logoDataUrl.startsWith('data:')) {
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
    await sleepMain(300);
  }

  editorEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  editorEl.focus();
  editorEl.click();

  // Seleccionar todo el contenido previo del editor y reemplazarlo atómicamente con execCommand('insertText')
  if (editorEl.tagName === 'TEXTAREA' || editorEl.tagName === 'INPUT') {
    const proto =
      editorEl.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) nativeSetter.call(editorEl, safePrompt);
    else editorEl.value = safePrompt;
  } else {
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editorEl);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('insertText', false, safePrompt);
    } catch {}

    // Si execCommand no insertó el texto, usar la vista interna de ProseMirror
    const afterExec = (editorEl.innerText || editorEl.textContent || '').trim();
    if (afterExec.length < 3) {
      const pmView = editorEl.pmViewDesc?.view;
      if (pmView && pmView.state) {
        try {
          const tr = pmView.state.tr.insertText(safePrompt, 0, pmView.state.doc.content.size);
          pmView.dispatch(tr);
        } catch {}
      }
    }
  }

  // Sincronizar también pmViewDesc.view si existe y quedó vacío
  const pmView = editorEl.pmViewDesc?.view;
  if (pmView && pmView.state && (pmView.state.doc.textContent || '').trim().length < 3) {
    try {
      const tr = pmView.state.tr.insertText(safePrompt, 0, pmView.state.doc.content.size);
      pmView.dispatch(tr);
    } catch {}
  }

  editorEl.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: 'insertText',
      data: safePrompt,
    })
  );
  editorEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

  // Colapsar el cursor al final del texto para que NADA quede seleccionado
  if (editorEl.tagName !== 'TEXTAREA' && editorEl.tagName !== 'INPUT') {
    try {
      const sel = window.getSelection();
      if (sel) {
        sel.selectAllChildren(editorEl);
        sel.collapseToEnd();
      }
    } catch {}
  }

  await sleepMain(180);

  // Intentar primer click directo sobre button.generate-icon-button en MAIN world
  const genBtn = Array.from(
    document.querySelectorAll(
      'button.generate-icon-button, flow-generate-icon-button button, span.submit-button-slot button, [submitbutton] button'
    )
  ).find((b) => {
    const r = b.getBoundingClientRect();
    return (
      r.width >= 16 &&
      r.height >= 16 &&
      !b.disabled &&
      b.getAttribute('aria-disabled') !== 'true' &&
      !b.closest('.agent-panel-animation-container, .sidenav, mat-sidenav, mat-drawer')
    );
  });

  if (genBtn) {
    try {
      genBtn.click();
    } catch {}
  }

  const finalLen = (editorEl.innerText || editorEl.textContent || editorEl.value || '').trim()
    .length;
  return {
    injected: finalLen > 0 || Boolean(genBtn),
    remainingLength: finalLen,
  };
}

/**
 * Ejecutado en world: 'MAIN' DESPUÉS de adjuntar chrome.debugger y esperar 350ms:
 * 1. Verifica que el prompt siga en el editor inferior (y si se borró al abrirse la barra de debug, lo vuelve a pegar).
 * 2. Busca EXCLUSIVAMENTE el botón de enviar (button.generate-icon-button / arrow_upward / arrow_forward),
 *    con Lista Negra estricta que prohíbe tocar cualquier botón de Clear (X), Close o Download.
 */
function ensurePromptAndGetSubmitCoords(rawPromptText, mediaType) {
  const promptText =
    mediaType === 'THUMBNAILS'
      ? String(rawPromptText || '').replace(/^Thumbnail\s*:\s*/i, '').trim()
      : String(rawPromptText || '').trim();
  const safePrompt = promptText.endsWith(' ') ? promptText : `${promptText} `;

  const allCandidates = [
    ...document.querySelectorAll('div.ProseMirror[contenteditable="true"]'),
    ...document.querySelectorAll('div[contenteditable="true"][role="textbox"]'),
    ...document.querySelectorAll('textarea:not(.g-recaptcha-response)'),
  ].filter((el) => {
    const r = el.getBoundingClientRect();
    return (
      r.width > 60 &&
      r.height > 14 &&
      r.bottom > 0 &&
      getComputedStyle(el).visibility !== 'hidden' &&
      !el.closest('.agent-panel-animation-container, .sidenav, mat-sidenav, mat-drawer')
    );
  });

  if (allCandidates.length === 0) {
    return { foundEditor: false };
  }

  allCandidates.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return rb.bottom * 2 + rb.width - (ra.bottom * 2 + ra.width);
  });

  const editorEl = allCandidates[0];
  let currentText = (editorEl.innerText || editorEl.textContent || editorEl.value || '').trim();

  // Si el editor está vacío, inyectar el texto ahora mismo y colocar el cursor al final
  if (currentText.length < 3 && promptText.length > 0) {
    editorEl.focus();
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editorEl);
      sel.removeAllRanges();
      selection?.removeAllRanges?.();
      sel.addRange(range);
      document.execCommand('insertText', false, safePrompt);
    } catch {}

    const pmView = editorEl.pmViewDesc?.view;
    if (pmView && pmView.state && (pmView.state.doc.textContent || '').trim().length < 3) {
      try {
        const tr = pmView.state.tr.insertText(safePrompt, 0, pmView.state.doc.content.size);
        pmView.dispatch(tr);
      } catch {}
    }

    editorEl.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: 'insertText',
        data: safePrompt,
      })
    );
    currentText = (editorEl.innerText || editorEl.textContent || editorEl.value || '').trim();
  }

  // Asegurar siempre que el cursor esté colapsado al final (NUNCA todo el texto seleccionado)
  if (editorEl.tagName !== 'TEXTAREA' && editorEl.tagName !== 'INPUT') {
    try {
      editorEl.focus();
      const sel = window.getSelection();
      if (sel) {
        sel.selectAllChildren(editorEl);
        sel.collapseToEnd();
      }
    } catch {}
  }

  const editorRect = editorEl.getBoundingClientRect();

  // Buscar el botón de enviar:
  // Prioridad 1: button.generate-icon-button (la clase exacta del botón de enviar en Google Flow)
  const FORBIDDEN_PATTERNS =
    /close|clear|delete|remove|cancel|reset|trash|backspace|download|file_download|save|export|cerrar|borrar|limpiar|eliminar|descargar|add|plus|attach|upload|image|mic|voice|settings|tune|sliders|aspect|ratio|model|history|expand|collapse|more_vert|more_horiz|menu/i;

  let chosenBtn = null;

  const exactButtons = Array.from(
    document.querySelectorAll(
      'button.generate-icon-button, flow-generate-icon-button button, span.submit-button-slot button, [submitbutton] button'
    )
  ).filter((b) => {
    const r = b.getBoundingClientRect();
    if (r.width < 16 || r.height < 16 || r.bottom <= 0) return false;
    if (getComputedStyle(b).visibility === 'hidden') return false;
    if (b.closest('.agent-panel-animation-container, .sidenav, mat-sidenav, mat-drawer')) {
      return false;
    }
    const cls = (b.className || '').toLowerCase();
    if (cls.includes('clear') || cls.includes('close') || cls.includes('delete')) return false;
    return true;
  });

  if (exactButtons.length > 0) {
    exactButtons.sort((a, b) => {
      const aDis = Boolean(a.disabled || a.getAttribute('aria-disabled') === 'true');
      const bDis = Boolean(b.disabled || b.getAttribute('aria-disabled') === 'true');
      if (aDis !== bDis) return aDis ? 1 : -1;
      return b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom;
    });
    chosenBtn = exactButtons[0];
  }

  // Prioridad 2: Buscar dentro del contenedor de la barra de prompt (altura <= 340px) por ícono arrow_upward / arrow_forward
  if (!chosenBtn) {
    let composerRoot = editorEl.parentElement;
    let curr = editorEl.parentElement;
    for (let depth = 0; depth < 7 && curr && curr !== document.body; depth++) {
      const r = curr.getBoundingClientRect();
      if (r.height > 340) break;
      composerRoot = curr;
      curr = curr.parentElement;
    }

    if (composerRoot) {
      const SUBMIT_ICONS = ['arrow_upward', 'arrow_forward', 'send', 'subdirectory_arrow_left'];
      const SUBMIT_LABELS =
        /\b(send|submit|generate|create|run|enviar|generar|crear|start generation|iniciar generaci)\b/i;

      const candidateBtns = Array.from(composerRoot.querySelectorAll('button')).filter((b) => {
        const r = b.getBoundingClientRect();
        if (r.width < 16 || r.height < 16 || getComputedStyle(b).visibility === 'hidden') {
          return false;
        }
        const text = (b.textContent || '').trim().toLowerCase();
        const cls = (b.className || '').toLowerCase();
        const aria = (
          (b.getAttribute('aria-label') || '') +
          ' ' +
          (b.getAttribute('title') || '')
        ).toLowerCase();

        if (cls.includes('clear') || cls.includes('close') || cls.includes('delete')) return false;
        if (FORBIDDEN_PATTERNS.test(text) || FORBIDDEN_PATTERNS.test(aria)) return false;
        if (text === 'x' || text === '×' || text === '+') return false;

        return (
          SUBMIT_ICONS.some((ic) => text.includes(ic)) ||
          SUBMIT_LABELS.test(aria) ||
          b.type === 'submit'
        );
      });

      if (candidateBtns.length > 0) {
        chosenBtn = candidateBtns[0];
      }
    }
  }

  let btnInfo = null;
  if (chosenBtn) {
    if (chosenBtn.hasAttribute('disabled') || chosenBtn.classList.contains('disabled')) {
      chosenBtn.removeAttribute('disabled');
      chosenBtn.removeAttribute('aria-disabled');
    }
    chosenBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const br = chosenBtn.getBoundingClientRect();
    window.__lastValidatedFlowSubmitBtn = chosenBtn;
    btnInfo = {
      x: Math.round(br.left + br.width / 2),
      y: Math.round(br.top + br.height / 2),
      className: chosenBtn.className || '',
      text: (chosenBtn.textContent || '').trim(),
    };
  }

  return {
    foundEditor: true,
    textLength: currentText.length,
    editorX: Math.round(editorRect.left + Math.min(60, editorRect.width * 0.3)),
    editorY: Math.round(editorRect.top + Math.min(24, editorRect.height / 2)),
    button: btnInfo,
  };
}

/**
 * Verifica si el editor inferior de Google Flow ya se vació (señal de que el prompt se sometió).
 */
function checkBottomEditorSubmitted() {
  const allCandidates = [
    ...document.querySelectorAll('div.ProseMirror[contenteditable="true"]'),
    ...document.querySelectorAll('div[contenteditable="true"][role="textbox"]'),
    ...document.querySelectorAll('textarea:not(.g-recaptcha-response)'),
  ].filter((el) => {
    const r = el.getBoundingClientRect();
    return (
      r.width > 60 &&
      r.height > 14 &&
      r.bottom > 0 &&
      getComputedStyle(el).visibility !== 'hidden' &&
      !el.closest('.agent-panel-animation-container, .sidenav, mat-sidenav, mat-drawer')
    );
  });

  if (allCandidates.length === 0) return { submitted: false, remainingLength: -1 };

  allCandidates.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return rb.bottom * 2 + rb.width - (ra.bottom * 2 + ra.width);
  });

  const editorEl = allCandidates[0];
  const remainingText = (editorEl.innerText || editorEl.textContent || editorEl.value || '').trim();
  return {
    submitted: remainingText.length === 0,
    remainingLength: remainingText.length,
  };
}

async function dispatchHardwareClick(target, x, y) {
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none',
  });
  await sleep(40);
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await sleep(55);
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
}

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
  await sleep(30);
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
  await sleep(40);
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
 * Automatiza directamente el Applet interno "Story Studio" (flow-sdk) de Google Flow
 * si está abierto dentro de algún iframe de la pestaña de Google Flow:
 * 1. Intercepta HTMLInputElement.prototype.click para inyectar el JSON del proyecto sin abrir diálogo de archivos.
 * 2. Abre el menú ⋮ del header -> clic en "Open Story" -> hidrata todos los @Personajes y Lugares.
 * 3. Cambia a la pestaña "2. Assets" y pulsa "Autocreate images" en Characters y Locations (que invoca Flow.generate.image nativamente en cola de 2 en 2).
 * 4. Vigila las tarjetas dentro de Story Studio para capturar cada imagen blob: generada y enviarla de vuelta a Huellas Master.
 */
async function tryAutomateStoryStudioInTab(tabId, storyStudioJsonStr, referenceItems = []) {
  if (!storyStudioJsonStr) return { storyStudioFound: false };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      args: [storyStudioJsonStr, referenceItems],
      func: async (jsonStr, refItems) => {
        const sleepFrame = (ms) => new Promise((r) => setTimeout(r, ms));
        const isStoryStudioFrame =
          Boolean(document.getElementById('story-studio-modal-root')) ||
          (Array.from(document.querySelectorAll('header button')).some((b) =>
            /1\.\s*Script/i.test(b.textContent || '')
          ) &&
            Array.from(document.querySelectorAll('header button')).some((b) =>
              /2\.\s*Assets/i.test(b.textContent || '')
            ));

        if (!isStoryStudioFrame) {
          return { storyStudioFound: false };
        }

        // 0. Si el usuario expuso window.__HUELLAS_FLOW_SDK__ = Flow en Story Studio, llamarlo directamente
        if (
          window.__HUELLAS_FLOW_SDK__ &&
          typeof window.__HUELLAS_FLOW_SDK__.generate?.image === 'function' &&
          Array.isArray(refItems) &&
          refItems.length > 0
        ) {
          (async () => {
            for (let i = 0; i < refItems.length; i++) {
              const item = refItems[i];
              try {
                const res = await window.__HUELLAS_FLOW_SDK__.generate.image({
                  prompt: item.formattedPrompt || item.prompt,
                  aspectRatio: '16:9',
                  modelDisplayName: '🍌 Nano Banana 2',
                });
                if (res && res.base64) {
                  const mime = res.mimeType || 'image/jpeg';
                  window.postMessage(
                    {
                      source: 'HUELLAS_STORY_STUDIO_FRAME',
                      type: 'FLOW_REFERENCE_CAPTURED',
                      referenceId: item.id,
                      referenceTag: item.tag,
                      referenceIndex: i,
                      mediaId: res.mediaId,
                      imageDataUrl: `data:${mime};base64,${res.base64}`,
                    },
                    '*'
                  );
                }
              } catch (e) {
                console.warn('[Huellas Story Studio SDK] Error generating image:', e);
              }
            }
          })();
          return { storyStudioFound: true, method: 'DIRECT_FLOW_SDK', count: refItems.length };
        }

        // 1. Cerrar modal de bienvenida "Welcome to Story Studio" / "Get Started" si está abierto
        const getStartedBtn = Array.from(document.querySelectorAll('button')).find((b) =>
          /get started/i.test((b.textContent || '').trim())
        );
        if (getStartedBtn) {
          try {
            getStartedBtn.click();
            await sleepFrame(150);
          } catch {}
        }

        // Registrar las imágenes blob: que ya existían antes de inyectar para no re-importar viejas
        const preExistingBlobs = new Set(
          Array.from(document.querySelectorAll('img'))
            .map((img) => img.src)
            .filter(Boolean)
        );

        // 2. Interceptar HTMLInputElement.prototype.click para inyectar el archivo .json en "Open Story" sin abrir Finder
        const origInputClick = HTMLInputElement.prototype.click;
        let jsonInjected = false;
        HTMLInputElement.prototype.click = function () {
          if (this.type === 'file' && (this.accept === '.json' || !this.accept)) {
            HTMLInputElement.prototype.click = origInputClick;
            try {
              const file = new File([jsonStr], 'Huellas_Story_Studio.json', {
                type: 'application/json',
              });
              const dt = new DataTransfer();
              dt.items.add(file);
              this.files = dt.files;
              jsonInjected = true;
              if (typeof this.onchange === 'function') {
                this.onchange({ target: this });
              } else {
                this.dispatchEvent(new Event('change', { bubbles: true }));
              }
            } catch (err) {
              console.warn('[Huellas Story Studio] Error injecting JSON file:', err);
            }
            return;
          }
          return origInputClick.apply(this, arguments);
        };

        // 3. Abrir el menú ⋮ del header y hacer clic en "Open Story"
        const headerMoreBtn = Array.from(document.querySelectorAll('header button')).find((b) =>
          (b.textContent || '').includes('more_vert')
        );
        if (headerMoreBtn) {
          headerMoreBtn.click();
          await sleepFrame(150);
          const openStoryBtn = Array.from(document.querySelectorAll('header button')).find((b) =>
            /open story/i.test((b.textContent || '').trim())
          );
          if (openStoryBtn) {
            openStoryBtn.click();
          }
        }

        // Restaurar HTMLInputElement.prototype.click por seguridad
        setTimeout(() => {
          HTMLInputElement.prototype.click = origInputClick;
        }, 1500);

        await sleepFrame(550);

        // 4. Cambiar a la pestaña "2. Assets"
        const assetsTabBtn = Array.from(document.querySelectorAll('header button')).find((b) =>
          /2\.\s*Assets/i.test((b.textContent || '').trim())
        );
        if (assetsTabBtn) {
          assetsTabBtn.click();
          await sleepFrame(450);
        }

        // 5. En cada sección (Characters y Locations), abrir su menú ⋮ y pulsar "Autocreate images"
        let triggeredSections = 0;
        const sections = Array.from(document.querySelectorAll('main section'));
        for (const sec of sections) {
          const secMoreBtn = Array.from(sec.querySelectorAll('button')).find((b) =>
            (b.textContent || '').includes('more_vert')
          );
          if (secMoreBtn) {
            secMoreBtn.click();
            await sleepFrame(160);
            const autoCreateBtn = Array.from(sec.querySelectorAll('button')).find((b) =>
              /autocreate images/i.test((b.textContent || '').trim())
            );
            if (autoCreateBtn && !autoCreateBtn.disabled) {
              autoCreateBtn.click();
              triggeredSections++;
              await sleepFrame(220);
            } else {
              // Si no hay botón "Autocreate images", intentar el botón "Autofill Characters/Locations"
              const autofillBtn = Array.from(sec.querySelectorAll('button')).find((b) =>
                /autofill/i.test((b.textContent || '').trim())
              );
              if (autofillBtn && !autofillBtn.disabled) {
                autofillBtn.click();
                triggeredSections++;
                await sleepFrame(220);
              }
            }
          }
        }

        // 6. Vigilar las tarjetas dentro de Story Studio para capturar cada nueva imagen blob: generada
        if (window.__HUELLAS_STORY_STUDIO_WATCHER__) {
          clearInterval(window.__HUELLAS_STORY_STUDIO_WATCHER__);
        }
        const capturedSrcs = new Set(preExistingBlobs);
        let elapsed = 0;
        window.__HUELLAS_STORY_STUDIO_WATCHER__ = setInterval(async () => {
          elapsed += 2500;
          if (elapsed > 360000) {
            clearInterval(window.__HUELLAS_STORY_STUDIO_WATCHER__);
            window.__HUELLAS_STORY_STUDIO_WATCHER__ = null;
            return;
          }

          const imgs = Array.from(document.querySelectorAll('main section img'));
          for (const img of imgs) {
            const src = img.src || '';
            if (!src || capturedSrcs.has(src)) continue;
            if (!img.complete || (img.naturalWidth > 0 && img.naturalWidth < 120)) continue;
            capturedSrcs.add(src);

            try {
              const resp = await fetch(src);
              const blob = await resp.blob();
              const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });

              // Identificar a qué @Referencia pertenece leyendo el texto de su tarjeta
              const cardEl = img.closest('[class*="rounded"]') || img.parentElement?.parentElement;
              const cardText = (cardEl?.innerText || cardEl?.textContent || '').toLowerCase();
              let matchedItem = null;
              let matchedIdx = -1;
              if (Array.isArray(refItems)) {
                for (let idx = 0; idx < refItems.length; idx++) {
                  const candidate = refItems[idx];
                  const cleanName = (candidate.name || candidate.tag || '')
                    .replace(/^@+/, '')
                    .replace(/_/g, ' ')
                    .toLowerCase()
                    .trim();
                  if (cleanName && cardText.includes(cleanName)) {
                    matchedItem = candidate;
                    matchedIdx = idx;
                    break;
                  }
                }
              }

              window.postMessage(
                {
                  source: 'HUELLAS_STORY_STUDIO_FRAME',
                  type: 'FLOW_REFERENCE_CAPTURED',
                  referenceId: matchedItem?.id,
                  referenceTag: matchedItem?.tag,
                  referenceIndex: matchedIdx >= 0 ? matchedIdx : undefined,
                  imageDataUrl: dataUrl,
                },
                '*'
              );
            } catch (e) {
              console.warn('[Huellas Story Studio] Failed to read blob image:', e);
            }
          }
        }, 2500);

        return {
          storyStudioFound: true,
          jsonInjected,
          triggeredSections,
          method: 'STORY_STUDIO_AUTOCREATE_IMAGES',
        };
      },
    });

    const hit = (results || []).find((r) => r?.result?.storyStudioFound);
    return hit ? hit.result : { storyStudioFound: false };
  } catch (err) {
    console.warn('[Huellas Story Studio] executeScript allFrames warning:', err);
    return { storyStudioFound: false };
  }
}

/**
 * Orquestador completo para Google Flow:
 * 1. Pega el prompt en MAIN world ANTES de abrir chrome.debugger.
 * 2. Si el prompt sigue en la caja, abre chrome.debugger, espera 350ms, hace clic físico
 *    sobre button.generate-icon-button y si aún queda texto envía Enter físico.
 */
async function executeFlowPromptHardware(tabId, rawPromptText, payload = {}) {
  const target = { tabId };
  const mediaType = String(payload.mediaType || '');
  const logoDataUrl = String(payload.logoDataUrl || '');

  // 1. Activar la pestaña de Google Flow
  const tab = await chrome.tabs.update(tabId, { active: true }).catch(() => null);
  if (tab?.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  }
  await sleep(150);

  // 2. Inyectar el prompt en MAIN world ANTES de adjuntar chrome.debugger
  const [mainAttempt] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [rawPromptText, mediaType, logoDataUrl],
    func: injectPromptIntoBottomEditor,
  });

  if (!mainAttempt?.result?.injected) {
    throw new Error(
      mainAttempt?.result?.error || 'No se encontró la caja de prompt en Google Flow.'
    );
  }

  if (payload.autoSubmit === false) {
    return { success: true, submitted: false, method: 'INJECT_ONLY' };
  }

  // Esperar 280ms por si el click en MAIN world ya envió el prompt
  await sleep(280);
  const [checkInitial] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: checkBottomEditorSubmitted,
  });

  if (checkInitial?.result?.submitted) {
    return { success: true, submitted: true, method: 'MAIN_WORLD_DIRECT' };
  }

  // 3. El texto ya está en la caja pero requiere evento físico (isTrusted: true) -> Adjuntar chrome.debugger
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (err) {
    const msg = String(err?.message || err || '');
    if (!msg.includes('Another debugger is already attached')) {
      throw err;
    }
  }

  // Esperar 350ms a que la barra amarilla de depuración termine de bajar
  await sleep(350);

  try {
    // 4. Asegurar que el texto sigue en el editor inferior y obtener las coordenadas exactas de button.generate-icon-button
    const [prep] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [rawPromptText, mediaType],
      func: ensurePromptAndGetSubmitCoords,
    });

    if (!prep?.result?.foundEditor) {
      throw new Error('No se encontró el editor inferior durante la fase CDP.');
    }

    const { editorX, editorY, button } = prep.result;

    // 5. Hacer clic físico en button.generate-icon-button si está presente
    if (button && button.x && button.y) {
      await dispatchHardwareClick(target, button.x, button.y);
      await sleep(450);
    }

    // Comprobar si el clic físico sobre button.generate-icon-button ya sometió el prompt
    const [afterBtnCheck] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: checkBottomEditorSubmitted,
    });

    if (afterBtnCheck?.result?.submitted) {
      return {
        success: true,
        submitted: true,
        method: 'CDP_HARDWARE_GENERATE_BUTTON',
        buttonClicked: button,
      };
    }

    // 6. Si tras el clic en button.generate-icon-button el texto sigue en la caja, dar foco al editor y enviar Enter físico
    await dispatchHardwareClick(target, editorX, editorY);
    await sleep(80);
    // Colapsar selección al final por si el clic seleccionó algo
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          sel.collapseToEnd();
        }
      },
    });
    await sleep(40);
    await sendHardwareEnterKey(target);
    await sleep(450);

    // 7. Si después de Enter aún sigue el botón habilitado, volver a medir button.generate-icon-button y hacer clic físico una vez más
    const [afterEnterCheck] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: checkBottomEditorSubmitted,
    });

    if (!afterEnterCheck?.result?.submitted && button && button.x && button.y) {
      await dispatchHardwareClick(target, button.x, button.y);
      await sleep(350);
    }

    return {
      success: true,
      submitted: true,
      method: 'CDP_HARDWARE_BUTTON_AND_ENTER',
      buttonClicked: button,
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

  // 1. Ping from Huellas Master
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
          version: '2.5.0',
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

        if (
          targetService === 'FLOW' &&
          (action === 'SEND_PROMPT' || action === 'LOAD_STORY_STUDIO_PROJECT')
        ) {
          try {
            // 1. Si el comando trae proyecto para Story Studio (ej. Etapa 6 Referencias), intentar primero inyectarlo en Story Studio (flow-sdk nativo)
            if (payload.storyStudioProjectJson) {
              const ssRes = await tryAutomateStoryStudioInTab(
                targetTab.id,
                payload.storyStudioProjectJson,
                payload.referenceItems || []
              );
              if (ssRes && ssRes.storyStudioFound) {
                broadcastToHuellasTabsInSameWindow(senderWindowId, {
                  type: 'BRIDGE_STATUS',
                  service: 'FLOW',
                  status: 'GENERATING',
                  message: `🎬 ¡Conectado a Story Studio (flow-sdk) en Google Flow! Generando automáticamente las ${(payload.referenceItems || []).length || ''} @Referencias en cola de 2 en 2...`,
                  mediaType: payload.mediaType,
                });
                sendResponse({
                  ok: true,
                  tabId: targetTab.id,
                  tabTitle: targetTab.title,
                  ...ssRes,
                });
                return;
              }
            }

            // 2. Si Story Studio no está abierto y estamos en la Etapa 6 (múltiples @Referencias), enviarlas en COLA SECUENCIAL 1 por 1 (< 3,950 chars cada una)
            if (
              payload.mediaType === 'REFERENCES' &&
              Array.isArray(payload.referenceItems) &&
              payload.referenceItems.length > 1
            ) {
              const items = payload.referenceItems;
              sendResponse({
                ok: true,
                tabId: targetTab.id,
                tabTitle: targetTab.title,
                method: 'SEQUENTIAL_REFERENCE_QUEUE',
                total: items.length,
              });

              (async () => {
                for (let i = 0; i < items.length; i++) {
                  const item = items[i];
                  const singlePrompt = String(item.formattedPrompt || item.prompt || '').slice(
                    0,
                    3950
                  );
                  broadcastToHuellasTabsInSameWindow(senderWindowId, {
                    type: 'BRIDGE_STATUS',
                    service: 'FLOW',
                    status: 'GENERATING',
                    message: `🎬 Cola Flow (${i + 1}/${items.length}): Enviando y sometiendo ${item.tag} (< 3,950 chars)...`,
                    mediaType: 'REFERENCES',
                  });
                  try {
                    await executeFlowPromptHardware(targetTab.id, singlePrompt, {
                      ...payload,
                      mediaType: 'IMAGE',
                    });
                  } catch (qErr) {
                    console.warn('[Huellas Queue] Error en item:', item.tag, qErr);
                  }
                  if (i < items.length - 1) {
                    await sleep(6500);
                  }
                }
                broadcastToHuellasTabsInSameWindow(senderWindowId, {
                  type: 'BRIDGE_STATUS',
                  service: 'FLOW',
                  status: 'SUCCESS',
                  message: `✅ Cola de ${items.length} @Referencias enviada una por una a Google Flow. Usa "📥 Importar de Flow" cuando terminen de renderizar.`,
                  mediaType: 'REFERENCES',
                });
              })();
              return;
            }

            // 3. Envío individual normal (< 3,950 chars) en la barra inferior de Google Flow
            const safeSinglePrompt = String(payload.prompt || '').slice(0, 3950);
            const autoRes = await executeFlowPromptHardware(
              targetTab.id,
              safeSinglePrompt,
              payload
            );

            // Solo iniciar el Watcher automático para VIDEO (en Referencias/Imágenes no se autodescargan imágenes en segundo plano para evitar bajar imágenes antiguas)
            if (payload.mediaType === 'VIDEO' && payload.watchForVideo !== false) {
              chrome.tabs
                .sendMessage(targetTab.id, {
                  target: 'FLOW',
                  ...payload,
                  action: 'START_FLOW_WATCHER_AFTER_SUBMIT',
                })
                .catch(() => {});
            }

            broadcastToHuellasTabsInSameWindow(senderWindowId, {
              type: 'BRIDGE_STATUS',
              service: 'FLOW',
              status: 'GENERATING',
              message: `🎬 Prompt enviado y sometido en Google Flow (${autoRes.method}).`,
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
