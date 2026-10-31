// ============================================================================
// HUELLAS MASTER — BACKGROUND SERVICE WORKER (v2.2.0)
// Orquestador de conexión en la misma ventana + Doble Capa para Google Flow:
// Capa 1: MAIN World (ProseMirror / Angular / React Fiber + button.generate-icon-button)
// Capa 2: Fallback Hardware CDP (chrome.debugger Input.dispatchMouseEvent / KeyEvent con isTrusted: true)
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

// Keep Huellas Master updated when tabs in the same window change title or URL
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
// GOOGLE FLOW — CAPA 1 (MAIN WORLD) + CAPA 2 (CDP HARDWARE DEBUGGER)
// ============================================================================

/**
 * Ejecutado dentro de world: 'MAIN' en la pestaña de Google Flow.
 * Soporta ProseMirror (pmViewDesc.view), Angular Material (button.generate-icon-button) y React Fiber (__reactProps$).
 */
async function injectAndSubmitViaMainWorld(rawPromptText, mediaType, logoDataUrl) {
  const sleepMain = (ms) => new Promise((r) => setTimeout(r, ms));
  const promptText =
    mediaType === 'THUMBNAILS'
      ? String(rawPromptText || '').replace(/^Thumbnail\s*:\s*/i, '').trim()
      : String(rawPromptText || '').trim();

  // 1. Localizar el editor principal del compositor (excluyendo paneles laterales como .agent-panel-animation-container)
  function findVisibleEditor() {
    const allCandidates = [
      ...document.querySelectorAll('div.ProseMirror[contenteditable="true"]'),
      ...document.querySelectorAll('div[contenteditable="true"][role="textbox"]'),
      ...document.querySelectorAll('textarea:not(.g-recaptcha-response)'),
    ].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 12 && getComputedStyle(el).visibility !== 'hidden';
    });

    const composerCandidates = allCandidates.filter(
      (el) => !el.closest('.agent-panel-animation-container, .sidenav, mat-sidenav, mat-drawer')
    );
    const pool = composerCandidates.length > 0 ? composerCandidates : allCandidates;
    if (pool.length <= 1) return pool[0] || null;

    // Preferir el editor más cercano a la parte inferior central de la ventana (barra de prompt de Flow)
    pool.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
    return pool[0];
  }

  // 2. Localizar el botón de envío DENTRO del contenedor ancestro del editor (priorizando button.generate-icon-button)
  function findComposerSubmitButton(editorEl) {
    const SUBMIT_ICONS = ['arrow_upward', 'arrow_forward', 'send', 'spark', 'auto_awesome'];
    const SUBMIT_LABELS =
      /send|submit|generate|create|enviar|crear|generar|start generation|iniciar generaci/i;

    let ancestor = editorEl ? editorEl.parentElement : null;
    for (let depth = 0; depth < 8 && ancestor && ancestor !== document.body; depth++) {
      // Prioridad 0: Selector exacto de Google Flow verificado en DevTools (button.generate-icon-button)
      const exactGenerateBtn = ancestor.querySelector(
        'button.generate-icon-button, flow-generate-icon-button button, span.submit-button-slot button, [submitbutton] button'
      );
      if (exactGenerateBtn) {
        const r = exactGenerateBtn.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && getComputedStyle(exactGenerateBtn).visibility !== 'hidden') {
          return exactGenerateBtn;
        }
      }

      const buttons = Array.from(ancestor.querySelectorAll('button')).filter((b) => {
        const r = b.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || getComputedStyle(b).visibility === 'hidden') {
          return false;
        }
        const meta = (
          (b.getAttribute('aria-label') || '') +
          ' ' +
          (b.getAttribute('title') || '') +
          ' ' +
          (b.className || '') +
          ' ' +
          (b.textContent || '')
        ).toLowerCase();
        if (
          meta.includes('clear') ||
          meta.includes('limpiar') ||
          meta.includes('borrar') ||
          meta.includes('close') ||
          meta.includes('cerrar') ||
          meta.includes('delete') ||
          meta.includes('settings') ||
          meta.includes('tune') ||
          meta.includes('add-menu') ||
          meta.includes('add ingredient') ||
          meta.includes('upload') ||
          meta.includes('aspect') ||
          meta.includes('16:9') ||
          meta.includes('9:16') ||
          meta.includes('expand')
        ) {
          return false;
        }
        return true;
      });

      if (buttons.length > 0) {
        // Prioridad 1: Botón con ícono Material/Google Symbols de flecha o aria-label de envío
        const iconOrLabelBtn = buttons.find((b) => {
          const text = (b.textContent || '').trim().toLowerCase();
          const aria = (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '');
          const hasSubmitIcon = SUBMIT_ICONS.some((icon) => text.includes(icon));
          const hasSubmitLabel = SUBMIT_LABELS.test(aria);
          return (
            b.classList.contains('generate-icon-button') ||
            hasSubmitIcon ||
            hasSubmitLabel ||
            b.type === 'submit'
          );
        });

        if (iconOrLabelBtn) return iconOrLabelBtn;

        // Prioridad 2: En el contenedor del compositor, el botón habilitado más a la derecha
        if (depth >= 2) {
          const enabledBtns = buttons.filter(
            (b) => !b.disabled && b.getAttribute('aria-disabled') !== 'true'
          );
          if (enabledBtns.length > 0) {
            enabledBtns.sort(
              (a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right
            );
            return enabledBtns[0];
          }
        }
      }
      ancestor = ancestor.parentElement;
    }

    // Fallback: buscar button.generate-icon-button fuera de paneles laterales
    const globalGenerateBtns = Array.from(
      document.querySelectorAll('button.generate-icon-button, flow-generate-icon-button button')
    ).filter(
      (b) =>
        !b.closest('.agent-panel-animation-container, .sidenav') &&
        b.getBoundingClientRect().width > 0
    );
    return globalGenerateBtns[0] || null;
  }

  // 3. Disparar handlers de React Fiber (__reactProps$) si existen
  function invokeReactFiberClick(btn) {
    const propsKey = Object.keys(btn).find(
      (k) => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$')
    );
    if (!propsKey || !btn[propsKey]) return false;

    const props = btn[propsKey];
    const rect = btn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const createSyntheticEvent = (type) => {
      const nativeEvent = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: cx,
        clientY: cy,
        button: 0,
        buttons: 1,
      });
      return {
        nativeEvent,
        currentTarget: btn,
        target: btn,
        bubbles: true,
        cancelable: true,
        defaultPrevented: false,
        eventPhase: 3,
        isTrusted: true,
        clientX: cx,
        clientY: cy,
        button: 0,
        buttons: 1,
        preventDefault() {
          this.defaultPrevented = true;
          nativeEvent.preventDefault();
        },
        stopPropagation() {
          nativeEvent.stopPropagation();
        },
        isDefaultPrevented() {
          return this.defaultPrevented;
        },
        isPropagationStopped() {
          return false;
        },
        persist() {},
      };
    };

    let called = false;
    if (typeof props.onPointerDown === 'function') {
      props.onPointerDown(createSyntheticEvent('pointerdown'));
      called = true;
    }
    if (typeof props.onMouseDown === 'function') {
      props.onMouseDown(createSyntheticEvent('mousedown'));
      called = true;
    }
    if (typeof props.onPointerUp === 'function') {
      props.onPointerUp(createSyntheticEvent('pointerup'));
      called = true;
    }
    if (typeof props.onMouseUp === 'function') {
      props.onMouseUp(createSyntheticEvent('mouseup'));
      called = true;
    }
    if (typeof props.onClick === 'function') {
      props.onClick(createSyntheticEvent('click'));
      called = true;
    }
    return called;
  }

  // 4. Disparar secuencia completa Pointer + Mouse sobre el botón y su <mat-icon> interno (Angular Material MDC)
  function dispatchFullClickSequence(btn) {
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const iconChild = btn.querySelector('mat-icon, .mat-icon, .mdc-button__label') || btn;
    const opts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: cx,
      clientY: cy,
      button: 0,
      buttons: 1,
    };
    for (const targetNode of [iconChild, btn]) {
      try {
        targetNode.dispatchEvent(new PointerEvent('pointerover', opts));
        targetNode.dispatchEvent(new MouseEvent('mouseenter', opts));
        targetNode.dispatchEvent(new PointerEvent('pointerdown', opts));
        targetNode.dispatchEvent(new MouseEvent('mousedown', opts));
        targetNode.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
        targetNode.dispatchEvent(new MouseEvent('mouseup', { ...opts, buttons: 0 }));
        targetNode.dispatchEvent(new MouseEvent('click', { ...opts, buttons: 0, detail: 1 }));
      } catch {}
    }
    try {
      btn.click();
    } catch {}
  }

  const editorEl = findVisibleEditor();
  if (!editorEl) {
    return { injected: false, error: 'No se encontró el editor de prompt en Google Flow.' };
  }

  // Adjuntar logo oficial en modo THUMBNAILS si viene en el payload
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
    await sleepMain(350);
  }

  editorEl.focus();
  editorEl.click();

  // Añadir espacio al final para que el cursor nunca quede atrapado dentro de una mención @
  const safePrompt = promptText.endsWith(' ') ? promptText : `${promptText} `;
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

  // PASO A: Insertar el texto sincronizando ProseMirror, Angular y DOM nativo
  const pmView = editorEl.pmViewDesc?.view;
  if (pmView && pmView.state) {
    try {
      const { state } = pmView;
      const tr = state.tr.insertText(safePrompt, 0, state.doc.content.size);
      pmView.dispatch(tr);
      pmView.focus();
    } catch {}
  } else if (editorEl.tagName === 'TEXTAREA' || editorEl.tagName === 'INPUT') {
    const proto =
      editorEl.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) nativeSetter.call(editorEl, safePrompt);
    else editorEl.value = safePrompt;
  } else {
    const currentNorm = norm(editorEl.innerText || editorEl.textContent || '');
    const expectedNorm = norm(safePrompt);
    if (!currentNorm || currentNorm !== expectedNorm) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editorEl);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('insertText', false, safePrompt);
    }
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
  document.documentElement.setAttribute('data-huellas-flow-injected-ts', String(Date.now()));

  // PASO B: Cerrar cualquier popover de menciones (@) o autocompletado que bloquee Enter
  await sleepMain(60);
  const escapeEvent = new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    keyCode: 27,
    which: 27,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  editorEl.dispatchEvent(escapeEvent);
  if (pmView && typeof pmView.someProp === 'function') {
    try {
      pmView.someProp('handleKeyDown', (f) => f(pmView, escapeEvent));
    } catch {}
  }

  // PASO C: Esperar hasta que Angular/React habilite button.generate-icon-button (máx 600ms)
  let submitBtn = null;
  for (let i = 0; i < 12; i++) {
    await sleepMain(50);
    const candidate = findComposerSubmitButton(editorEl);
    if (
      candidate &&
      !candidate.disabled &&
      candidate.getAttribute('aria-disabled') !== 'true'
    ) {
      submitBtn = candidate;
      break;
    }
  }
  if (!submitBtn) {
    submitBtn = findComposerSubmitButton(editorEl);
  }

  // PASO D: Intentar envío en MAIN world (React Fiber + Angular Material Pointer/Click + ProseMirror Enter)
  let reactClicked = false;
  if (submitBtn) {
    reactClicked = invokeReactFiberClick(submitBtn);
    dispatchFullClickSequence(submitBtn);
  }

  await sleepMain(100);
  const currentText = (editorEl.textContent || editorEl.value || '').trim();
  if (currentText.length > 0) {
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      charCode: 13,
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    if (pmView && typeof pmView.someProp === 'function') {
      try {
        pmView.someProp('handleKeyDown', (f) => f(pmView, enterEvent));
      } catch {}
    }
    editorEl.dispatchEvent(enterEvent);
    editorEl.dispatchEvent(new KeyboardEvent('keypress', enterEvent));
    editorEl.dispatchEvent(new KeyboardEvent('keyup', enterEvent));
  }

  return {
    injected: true,
    reactClicked,
    buttonFound: Boolean(submitBtn),
    buttonClass: submitBtn ? submitBtn.className : null,
  };
}

/**
 * Verifica si el editor principal de Google Flow ya se vació (señal inequívoca de que el prompt se sometió).
 */
function checkIfPromptWasSubmitted() {
  const allCandidates = [
    ...document.querySelectorAll('div.ProseMirror[contenteditable="true"]'),
    ...document.querySelectorAll('div[contenteditable="true"][role="textbox"]'),
    ...document.querySelectorAll('textarea:not(.g-recaptcha-response)'),
  ].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 40 && r.height > 12 && getComputedStyle(el).visibility !== 'hidden';
  });

  const composerCandidates = allCandidates.filter(
    (el) => !el.closest('.agent-panel-animation-container, .sidenav, mat-sidenav, mat-drawer')
  );
  const editorEl = composerCandidates[0] || allCandidates[0] || null;
  if (!editorEl) return { submitted: true, remainingLength: 0 };

  const remainingText = (editorEl.textContent || editorEl.value || '').trim();
  return {
    submitted: remainingText.length === 0,
    remainingLength: remainingText.length,
  };
}

/**
 * Secuencia física completa de puntero vía CDP: mouseMoved -> mousePressed -> mouseReleased (isTrusted: true)
 */
async function dispatchHardwareClick(target, x, y) {
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
    button: 'none',
  });
  await sleep(30);
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await sleep(45);
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
 * CAPA 2: Envío por Hardware vía Chrome DevTools Protocol (CDP) con isTrusted: true.
 * Calcula las coordenadas reales de button.generate-icon-button DESPUÉS de insertar el texto
 * y ejecuta el clic físico y/o Enter físico de hardware.
 */
async function submitViaCDPDebugger(tabId, rawPromptText, mediaType) {
  const target = { tabId };
  const promptText =
    mediaType === 'THUMBNAILS'
      ? String(rawPromptText || '').replace(/^Thumbnail\s*:\s*/i, '').trim()
      : String(rawPromptText || '').trim();

  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (err) {
    const msg = String(err?.message || err || '');
    if (!msg.includes('Another debugger is already attached')) {
      throw err;
    }
  }

  try {
    // 1. Verificar el estado actual del editor y obtener sus coordenadas para darle foco físico
    const [prep] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const allCandidates = [
          ...document.querySelectorAll('div.ProseMirror[contenteditable="true"]'),
          ...document.querySelectorAll('div[contenteditable="true"][role="textbox"]'),
          ...document.querySelectorAll('textarea:not(.g-recaptcha-response)'),
        ].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 40 && r.height > 12 && getComputedStyle(el).visibility !== 'hidden';
        });
        const composerCandidates = allCandidates.filter(
          (el) => !el.closest('.agent-panel-animation-container, .sidenav, mat-sidenav, mat-drawer')
        );
        const editorEl = composerCandidates[0] || allCandidates[0] || null;
        if (!editorEl) return { found: false };

        editorEl.focus();
        const currentText = (editorEl.textContent || editorEl.value || '').trim();
        const rect = editorEl.getBoundingClientRect();
        return {
          found: true,
          hasText: currentText.length > 0,
          editorX: Math.round(rect.left + Math.min(40, rect.width / 2)),
          editorY: Math.round(rect.top + Math.min(20, rect.height / 2)),
        };
      },
    });

    if (!prep?.result?.found) {
      throw new Error('Editor no encontrado durante la fase CDP.');
    }

    const { editorX, editorY, hasText } = prep.result;
    await dispatchHardwareClick(target, editorX, editorY);
    await sleep(60);

    // 2. Si el texto no estaba presente, inyectarlo de forma nativa con Input.insertText
    if (!hasText && promptText) {
      await chrome.debugger.sendCommand(target, 'Input.insertText', {
        text: `${promptText} `,
      });
    }

    // Enviar Espacio + Backspace nativos (isTrusted: true) para despertar validadores de Angular / ProseMirror
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: ' ',
      code: 'Space',
      text: ' ',
      unmodifiedText: ' ',
      windowsVirtualKeyCode: 32,
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: ' ',
      code: 'Space',
      windowsVirtualKeyCode: 32,
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Backspace',
      code: 'Backspace',
      windowsVirtualKeyCode: 8,
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Backspace',
      code: 'Backspace',
      windowsVirtualKeyCode: 8,
    });

    await sleep(80);

    // 3. Enviar Escape físico por si el prompt contiene @Menciones y abrió un menú flotante
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });

    // Esperar a que Angular Material / React estabilice la altura de la caja y habilite button.generate-icon-button
    await sleep(160);

    // 4. Obtener las coordenadas reales (x, y) de button.generate-icon-button dentro del compositor
    const [btnCoords] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const allCandidates = [
          ...document.querySelectorAll('div.ProseMirror[contenteditable="true"]'),
          ...document.querySelectorAll('div[contenteditable="true"][role="textbox"]'),
          ...document.querySelectorAll('textarea:not(.g-recaptcha-response)'),
        ].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 40 && r.height > 12 && getComputedStyle(el).visibility !== 'hidden';
        });
        const composerCandidates = allCandidates.filter(
          (el) => !el.closest('.agent-panel-animation-container, .sidenav, mat-sidenav, mat-drawer')
        );
        const editorEl = composerCandidates[0] || allCandidates[0] || null;
        if (!editorEl) return null;

        const SUBMIT_ICONS = ['arrow_upward', 'arrow_forward', 'send', 'spark', 'auto_awesome'];
        const SUBMIT_LABELS =
          /send|submit|generate|create|enviar|crear|generar|start generation|iniciar generaci/i;

        let ancestor = editorEl.parentElement;
        for (let depth = 0; depth < 8 && ancestor && ancestor !== document.body; depth++) {
          const exactBtn = ancestor.querySelector(
            'button.generate-icon-button, flow-generate-icon-button button, span.submit-button-slot button, [submitbutton] button'
          );
          if (
            exactBtn &&
            !exactBtn.disabled &&
            exactBtn.getAttribute('aria-disabled') !== 'true'
          ) {
            const r = exactBtn.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && getComputedStyle(exactBtn).visibility !== 'hidden') {
              exactBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
              const rect = exactBtn.getBoundingClientRect();
              return {
                x: Math.round(rect.left + rect.width / 2),
                y: Math.round(rect.top + rect.height / 2),
                label: exactBtn.className || 'generate-icon-button',
              };
            }
          }

          const buttons = Array.from(ancestor.querySelectorAll('button')).filter((b) => {
            const r = b.getBoundingClientRect();
            return (
              r.width > 0 &&
              r.height > 0 &&
              !b.disabled &&
              b.getAttribute('aria-disabled') !== 'true' &&
              getComputedStyle(b).visibility !== 'hidden'
            );
          });

          const match = buttons.find((b) => {
            const text = (b.textContent || '').trim().toLowerCase();
            const aria =
              (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '');
            return (
              b.classList.contains('generate-icon-button') ||
              SUBMIT_ICONS.some((icon) => text.includes(icon)) ||
              SUBMIT_LABELS.test(aria) ||
              b.type === 'submit'
            );
          });

          const targetBtn =
            match ||
            (depth >= 2 && buttons.length > 0
              ? buttons.sort(
                  (a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right
                )[0]
              : null);

          if (targetBtn) {
            targetBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            const rect = targetBtn.getBoundingClientRect();
            return {
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2),
              label:
                targetBtn.getAttribute('aria-label') ||
                targetBtn.className ||
                targetBtn.textContent.trim(),
            };
          }
          ancestor = ancestor.parentElement;
        }

        // Fallback directo por clase exacta button.generate-icon-button
        const fallbackBtn = document.querySelector('button.generate-icon-button:not([disabled])');
        if (fallbackBtn) {
          const rect = fallbackBtn.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return {
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2),
              label: 'button.generate-icon-button',
            };
          }
        }
        return null;
      },
    });

    // 5. Ejecutar clic físico por hardware sobre button.generate-icon-button
    if (btnCoords?.result?.x && btnCoords?.result?.y) {
      const { x, y } = btnCoords.result;
      await dispatchHardwareClick(target, x, y);
      await sleep(260);
    }

    // 6. Verificar si se vació el editor; si aún queda texto, enviar tecla física Enter (windowsVirtualKeyCode: 13)
    const [postClickCheck] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: checkIfPromptWasSubmitted,
    });

    if (!postClickCheck?.result?.submitted) {
      await dispatchHardwareClick(target, editorX, editorY);
      await sleep(50);
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        text: '\r',
        unmodifiedText: '\r',
      });
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'char',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        text: '\r',
        unmodifiedText: '\r',
      });
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      });
    }

    return {
      buttonCoords: btnCoords?.result || null,
      fallbackEnterUsed: !postClickCheck?.result?.submitted,
    };
  } finally {
    try {
      await chrome.debugger.detach(target);
    } catch {}
  }
}

/**
 * Orquestador completo de envío de prompt en Google Flow (Capa 1 MAIN + Capa 2 CDP Hardware).
 */
async function handleFlowAutomation(tabId, promptText, payload = {}) {
  const tab = await chrome.tabs.update(tabId, { active: true }).catch(() => null);
  if (tab?.windowId) {
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  }
  await sleep(120);

  const mediaType = String(payload.mediaType || '');
  const logoDataUrl = String(payload.logoDataUrl || '');

  // CAPA 1: Inyección y disparo desde world: 'MAIN'
  const [mainAttempt] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [promptText, mediaType, logoDataUrl],
    func: injectAndSubmitViaMainWorld,
  });

  const mainResult = mainAttempt?.result;
  if (!mainResult?.injected) {
    throw new Error(mainResult?.error || 'No se pudo localizar el editor en Google Flow.');
  }

  if (payload.autoSubmit === false) {
    return { method: 'INJECT_ONLY', details: mainResult };
  }

  // Esperar 350ms para comprobar si la Capa 1 vació el editor
  await sleep(350);

  const [checkAfterMain] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: checkIfPromptWasSubmitted,
  });

  if (checkAfterMain?.result?.submitted) {
    return { method: 'MAIN_WORLD', details: mainResult };
  }

  // CAPA 2: Fallback 100% Hardware (isTrusted: true) con chrome.debugger (CDP)
  console.warn(
    '[Huellas FlowAutomator] Envío en MAIN world bloqueado por isTrusted. Activando CDP Hardware...'
  );
  const cdpResult = await submitViaCDPDebugger(tabId, promptText, mediaType);
  return { method: 'CDP_HARDWARE_DEBUGGER', details: cdpResult };
}

// ============================================================================
// MESSAGE LISTENER (HUELLAS MASTER + CONTENT SCRIPTS)
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;

  const senderWindowId = sender?.tab?.windowId;

  // Direct SEND_PROMPT / EXECUTE_FLOW_PROMPT delegation from flow-content.js or popup
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

    handleFlowAutomation(tabId, promptText, message.payload || message)
      .then((res) => sendResponse({ success: true, ok: true, ...res }))
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
          version: '2.2.0',
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
          // 1. Notificar a flow-content.js que inicie únicamente el Watcher de Videos / Miniaturas / Referencias
          chrome.tabs
            .sendMessage(targetTab.id, {
              target: 'FLOW',
              ...payload,
              delegatedToBackground: true,
            })
            .catch(() => {});

          // 2. Ejecutar la automatización de Doble Capa (MAIN World + CDP Hardware Debugger)
          try {
            const autoRes = await handleFlowAutomation(
              targetTab.id,
              String(payload.prompt || ''),
              payload
            );
            broadcastToHuellasTabsInSameWindow(senderWindowId, {
              type: 'BRIDGE_STATUS',
              service: 'FLOW',
              status: 'GENERATING',
              message: `🎬 Prompt enviado y sometido en Google Flow (${autoRes.method}). Vigilando generación automáticamente...`,
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
