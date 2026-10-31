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
      target: scriptFile === 'flow-content.js' ? { tabId, allFrames: true } : { tabId },
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
 * Verifica si algún frame de la pestaña de Google Flow tiene expuesto window.__HUELLAS_FLOW_SDK__ = Flow
 */
async function checkFlowSdkAvailableInTab(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: () => ({
        hasSdk: Boolean(
          window.__HUELLAS_FLOW_SDK__ &&
            typeof window.__HUELLAS_FLOW_SDK__.generate?.image === 'function'
        ),
        isStoryStudio: Boolean(document.getElementById('story-studio-modal-root')),
      }),
    });
    const sdkFrame = (results || []).find((r) => r?.result?.hasSdk);
    const ssFrame = (results || []).find((r) => r?.result?.isStoryStudio);
    return {
      hasSdk: Boolean(sdkFrame),
      sdkFrameId: sdkFrame?.frameId,
      isStoryStudio: Boolean(ssFrame || sdkFrame),
    };
  } catch {
    return { hasSdk: false, isStoryStudio: false };
  }
}

/**
 * Genera 1 imagen directamente usando window.__HUELLAS_FLOW_SDK__.generate.image(...)
 * dentro del frame de Story Studio y devuelve { ok, mediaId, imageDataUrl } directamente a background.js
 * sin depender de postMessage ni de clics en el DOM.
 */
async function generateSingleImageViaFlowSdk(
  tabId,
  rawPrompt,
  aspectRatio = '16:9',
  logoDataUrl = ''
) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      args: [rawPrompt, aspectRatio, logoDataUrl],
      func: async (promptText, ratio, logoData) => {
        const sdk = window.__HUELLAS_FLOW_SDK__;
        if (!sdk || typeof sdk.generate?.image !== 'function') {
          return { hasSdk: false };
        }

        let referenceImageMediaIds = undefined;
        if (logoData && logoData.startsWith('data:') && typeof sdk.upload === 'function') {
          try {
            const base64Logo = logoData.split(',')[1];
            const up = await sdk.upload({
              base64: base64Logo,
              mimeType: 'image/png',
              name: 'Logo Huellas de la Humanidad',
            });
            if (up?.mediaId) {
              referenceImageMediaIds = [up.mediaId];
            }
          } catch (upErr) {
            console.warn('[Huellas Flow SDK] Logo upload warning:', upErr);
          }
        }

        const cleanPrompt = String(promptText || '')
          .replace(/^Thumbnail\s*:\s*/i, '')
          .replace(/^@[A-Za-z0-9_ÁÉÍÓÚáéíóúÑñ]+\s*:\s*/i, '')
          .replace(/^[A-Za-z0-9_ÁÉÍÓÚáéíóúÑñ\s]{1,35}\s*:\s*(?=Frame Description|Create an image)/i, '')
          .trim()
          .slice(0, 3950);

        const modelsToTry = ['🍌 Nano Banana 2', '🍌 Nano Banana Pro', '🍌 Nano Banana 2.1'];
        let lastError = '';
        for (const modelDisplayName of modelsToTry) {
          try {
            const res = await sdk.generate.image({
              prompt: cleanPrompt,
              aspectRatio: ratio || '16:9',
              referenceImageMediaIds,
              modelDisplayName,
            });
            if (res && res.base64) {
              const mime = res.mimeType || 'image/jpeg';
              return {
                hasSdk: true,
                ok: true,
                mediaId: res.mediaId,
                mimeType: mime,
                imageDataUrl: `data:${mime};base64,${res.base64}`,
                modelUsed: modelDisplayName,
              };
            }
          } catch (err) {
            lastError = String(err?.message || err || '');
            // Si el error no es por nombre de modelo, esperar un segundo antes de reintentar
            await new Promise((r) => setTimeout(r, 800));
          }
        }
        return {
          hasSdk: true,
          ok: false,
          error: lastError || 'Flow.generate.image no devolvió base64.',
        };
      },
    });

    const hit = (results || []).find((r) => r?.result?.hasSdk);
    return hit ? hit.result : { hasSdk: false, ok: false };
  } catch (err) {
    return { hasSdk: false, ok: false, error: String(err?.message || err) };
  }
}

/**
 * Inyecta el JSON del proyecto en la interfaz visual de Story Studio (pestaña "2. Assets")
 * para que las tarjetas y sus imágenes generadas también se vean en pantalla dentro de Story Studio.
 */
async function syncProjectJsonIntoStoryStudioUI(tabId, storyStudioJsonStr, triggerAutocreate = false) {
  if (!storyStudioJsonStr) return { synced: false };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      args: [storyStudioJsonStr, triggerAutocreate],
      func: async (jsonStr, shouldAutocreate) => {
        const sleepFrame = (ms) => new Promise((r) => setTimeout(r, ms));
        const isStoryStudioFrame =
          Boolean(document.getElementById('story-studio-modal-root')) ||
          (Array.from(document.querySelectorAll('header button')).some((b) =>
            /1\.\s*Script/i.test(b.textContent || '')
          ) &&
            Array.from(document.querySelectorAll('header button')).some((b) =>
              /2\.\s*Assets/i.test(b.textContent || '')
            ));

        if (!isStoryStudioFrame) return { synced: false };

        const getStartedBtn = Array.from(document.querySelectorAll('button')).find((b) =>
          /get started/i.test((b.textContent || '').trim())
        );
        if (getStartedBtn) {
          try {
            getStartedBtn.click();
            await sleepFrame(120);
          } catch {}
        }

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
            } catch {}
            return;
          }
          return origInputClick.apply(this, arguments);
        };

        const headerMoreBtn = Array.from(document.querySelectorAll('header button')).find((b) =>
          (b.textContent || '').includes('more_vert')
        );
        if (headerMoreBtn) {
          headerMoreBtn.click();
          await sleepFrame(140);
          const openStoryBtn = Array.from(document.querySelectorAll('header button')).find((b) =>
            /open story/i.test((b.textContent || '').trim())
          );
          if (openStoryBtn) {
            openStoryBtn.click();
          }
        }

        setTimeout(() => {
          HTMLInputElement.prototype.click = origInputClick;
        }, 1200);

        await sleepFrame(450);

        const assetsTabBtn = Array.from(document.querySelectorAll('header button')).find((b) =>
          /2\.\s*Assets/i.test((b.textContent || '').trim())
        );
        if (assetsTabBtn) {
          assetsTabBtn.click();
          await sleepFrame(350);
        }

        let triggeredSections = 0;
        if (shouldAutocreate) {
          const sections = Array.from(document.querySelectorAll('main section'));
          for (const sec of sections) {
            const secMoreBtn = Array.from(sec.querySelectorAll('button')).find((b) =>
              (b.textContent || '').includes('more_vert')
            );
            if (secMoreBtn) {
              secMoreBtn.click();
              await sleepFrame(150);
              const autoCreateBtn = Array.from(sec.querySelectorAll('button')).find((b) =>
                /autocreate images/i.test((b.textContent || '').trim())
              );
              if (autoCreateBtn && !autoCreateBtn.disabled) {
                autoCreateBtn.click();
                triggeredSections++;
                await sleepFrame(200);
              }
            }
          }
        }

        return { synced: true, jsonInjected, triggeredSections };
      },
    });
    const hit = (results || []).find((r) => r?.result?.synced);
    return hit ? hit.result : { synced: false };
  } catch {
    return { synced: false };
  }
}

/**
 * Ejecuta la generación de todas las @Referencias en una cola concurrente de 2 en 2
 * llamando directamente a window.__HUELLAS_FLOW_SDK__.generate.image y enviando cada
 * imagen capturada a Huellas Master (y actualizando las tarjetas en Story Studio).
 */
async function runReferencesQueueViaDirectFlowSdk(
  tabId,
  senderWindowId,
  storyStudioJsonStr,
  referenceItems = []
) {
  // 1. Mostrar inmediatamente las tarjetas de @Personas y Lugares en la pestaña "2. Assets" de Story Studio
  if (storyStudioJsonStr) {
    await syncProjectJsonIntoStoryStudioUI(tabId, storyStudioJsonStr, false);
  }

  let parsedProject = null;
  if (storyStudioJsonStr) {
    try {
      parsedProject = JSON.parse(storyStudioJsonStr);
    } catch {}
  }

  const total = referenceItems.length;
  let completed = 0;
  let failed = 0;
  let nextIdx = 0;
  const concurrency = Math.min(2, total);

  async function worker() {
    while (nextIdx < total) {
      const currentIdx = nextIdx++;
      const item = referenceItems[currentIdx];
      if (!item) continue;

      broadcastToHuellasTabsInSameWindow(senderWindowId, {
        type: 'BRIDGE_STATUS',
        service: 'FLOW',
        status: 'GENERATING',
        message: `🍌 Flow SDK (${completed + 1}/${total}): Generando imagen de referencia para ${item.tag} en Nano Banana 2...`,
        mediaType: 'REFERENCES',
      });

      const genRes = await generateSingleImageViaFlowSdk(
        tabId,
        item.formattedPrompt || item.prompt,
        '16:9'
      );

      if (genRes && genRes.ok && genRes.imageDataUrl) {
        completed++;
        // Enviar inmediatamente la imagen en base64 a Huellas Master para que aparezca en la tarjeta de Etapa 6 y se guarde en 04_Referencias
        broadcastToHuellasTabsInSameWindow(senderWindowId, {
          type: 'FLOW_REFERENCE_CAPTURED',
          referenceId: item.id,
          referenceTag: item.tag,
          referenceIndex: currentIdx,
          mediaId: genRes.mediaId,
          imageDataUrl: genRes.imageDataUrl,
        });

        // Actualizar también el JSON de Story Studio para que la tarjeta en Story Studio tenga la imagen
        if (parsedProject && Array.isArray(parsedProject.assets)) {
          const rawB64 = genRes.imageDataUrl.split(',')[1] || '';
          const targetAsset =
            parsedProject.assets.find((a) => a.id === item.id) || parsedProject.assets[currentIdx];
          if (targetAsset && rawB64) {
            const imgId = `img-${item.id || currentIdx}`;
            targetAsset.base64 = rawB64;
            targetAsset.referenceImageId = imgId;
            targetAsset.supportingImages = [
              { id: imgId, mediaId: genRes.mediaId, base64: rawB64 },
            ];
          }
        }
      } else {
        failed++;
        console.warn('[Huellas Flow SDK] Falló referencia:', item.tag, genRes?.error);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // Al terminar la cola, sincronizar el proyecto con todas las imágenes dentro de Story Studio para que se vean en "2. Assets"
  if (parsedProject && completed > 0) {
    try {
      await syncProjectJsonIntoStoryStudioUI(tabId, JSON.stringify(parsedProject, null, 2), false);
    } catch {}
  }

  broadcastToHuellasTabsInSameWindow(senderWindowId, {
    type: 'BRIDGE_STATUS',
    service: 'FLOW',
    status: completed > 0 ? 'SUCCESS' : 'ERROR',
    message:
      completed > 0
        ? `✅ ¡${completed}/${total} imágenes de @Referencias generadas con Flow SDK (🍌 Nano Banana 2), guardadas en tu Media Gallery de Flow, importadas a tus tarjetas de Etapa 6 y guardadas en 04_Referencias!`
        : `⚠️ No se pudieron generar las imágenes vía Flow SDK (${failed} fallidas).`,
    mediaType: 'REFERENCES',
  });
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
          version: '2.5.1',
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
            // 1. Verificar si window.__HUELLAS_FLOW_SDK__ = Flow está disponible en la pestaña de Google Flow
            const sdkStatus = await checkFlowSdkAvailableInTab(targetTab.id);

            // 1A. Etapa 6 (Todas las @Referencias o 1 tarjeta individual de @Referencia) vía window.__HUELLAS_FLOW_SDK__
            if (
              sdkStatus.hasSdk &&
              (payload.mediaType === 'REFERENCES' ||
                (payload.mediaType === 'IMAGE' && payload.referenceId))
            ) {
              const itemsToRun =
                Array.isArray(payload.referenceItems) && payload.referenceItems.length > 0
                  ? payload.referenceItems
                  : [
                      {
                        id: payload.referenceId,
                        tag: payload.referenceTag || '@Referencia',
                        name: payload.referenceTag || 'Referencia',
                        prompt: payload.prompt || '',
                        formattedPrompt: payload.prompt || '',
                      },
                    ];

              sendResponse({
                ok: true,
                tabId: targetTab.id,
                tabTitle: targetTab.title,
                method: 'DIRECT_FLOW_SDK_QUEUE',
                total: itemsToRun.length,
              });

              runReferencesQueueViaDirectFlowSdk(
                targetTab.id,
                senderWindowId,
                payload.storyStudioProjectJson || '',
                itemsToRun
              ).catch((e) => console.warn('[Huellas Flow SDK Queue] Error:', e));
              return;
            }

            // 1B. Etapa 5 (Miniatura Oficial con Logo) vía window.__HUELLAS_FLOW_SDK__
            if (sdkStatus.hasSdk && payload.mediaType === 'THUMBNAILS') {
              sendResponse({
                ok: true,
                tabId: targetTab.id,
                tabTitle: targetTab.title,
                method: 'DIRECT_FLOW_SDK_THUMBNAIL',
              });

              (async () => {
                const ratio = /9:16|vertical/i.test(payload.prompt || '') ? '9:16' : '16:9';
                broadcastToHuellasTabsInSameWindow(senderWindowId, {
                  type: 'BRIDGE_STATUS',
                  service: 'FLOW',
                  status: 'GENERATING',
                  message: `🍌 Flow SDK: Subiendo Logo Oficial y generando Miniatura Opción ${
                    payload.optionLabel || 'A'
                  } (${ratio})...`,
                  mediaType: 'THUMBNAILS',
                });
                const thumbRes = await generateSingleImageViaFlowSdk(
                  targetTab.id,
                  payload.prompt || '',
                  ratio,
                  payload.logoDataUrl || ''
                );
                if (thumbRes && thumbRes.ok && thumbRes.imageDataUrl) {
                  broadcastToHuellasTabsInSameWindow(senderWindowId, {
                    type: 'FLOW_THUMBNAIL_CAPTURED',
                    optionLabel: payload.optionLabel || 'A',
                    imageUrl: thumbRes.imageDataUrl,
                    imageDataUrl: thumbRes.imageDataUrl,
                  });
                } else {
                  broadcastToHuellasTabsInSameWindow(senderWindowId, {
                    type: 'BRIDGE_STATUS',
                    service: 'FLOW',
                    status: 'ERROR',
                    message: `⚠️ Error generando Miniatura vía Flow SDK: ${
                      thumbRes?.error || 'Desconocido'
                    }`,
                  });
                }
              })();
              return;
            }

            // 1C. Si Story Studio está abierto pero aún sin window.__HUELLAS_FLOW_SDK__, inyectar JSON y pulsar Autocreate images
            if (sdkStatus.isStoryStudio && payload.storyStudioProjectJson) {
              const ssRes = await syncProjectJsonIntoStoryStudioUI(
                targetTab.id,
                payload.storyStudioProjectJson,
                true
              );
              if (ssRes && ssRes.synced) {
                broadcastToHuellasTabsInSameWindow(senderWindowId, {
                  type: 'BRIDGE_STATUS',
                  service: 'FLOW',
                  status: 'GENERATING',
                  message: `🎬 Proyecto cargado en Story Studio (Google Flow) y ejecutando Autocreate images...`,
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
