// ============================================================================
// HUELLAS MASTER — BACKGROUND SERVICE WORKER (v2.5.4)
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
    const allTabs = await chrome.tabs.query({}).catch(() => windowTabs);

    const isFlowTabUrl = (url) => {
      if (!url) return false;
      const lower = url.toLowerCase();
      return (
        lower.includes('flow.google.com') ||
        (lower.includes('labs.google') && lower.includes('flow'))
      );
    };

    const mapGemini = (t) => ({
      id: t.id,
      windowId: t.windowId,
      title:
        (t.title || 'Google Gemini').replace(/ - Google Gemini$/i, '').trim() ||
        'Google Gemini',
      url: t.url,
    });

    const mapFlow = (t) => ({
      id: t.id,
      windowId: t.windowId,
      active: Boolean(t.active),
      title:
        (t.title || 'Google Flow').replace(/^Google Flow - /i, '').trim() ||
        'Google Flow',
      url: t.url,
    });

    const sortFlowTabs = (list) =>
      [...list].sort((a, b) => {
        const aAbout = /\/about(\/|$|\?)/i.test(a.url || '') ? 1 : 0;
        const bAbout = /\/about(\/|$|\?)/i.test(b.url || '') ? 1 : 0;
        if (aAbout !== bAbout) return aAbout - bAbout;
        const aProj = /\/project\//i.test(a.url || '') ? 0 : 1;
        const bProj = /\/project\//i.test(b.url || '') ? 0 : 1;
        if (aProj !== bProj) return aProj - bProj;
        if (Boolean(a.active) !== Boolean(b.active)) return a.active ? -1 : 1;
        return (b.id || 0) - (a.id || 0);
      });

    let geminiTabs = windowTabs
      .filter((t) => t.url && t.url.startsWith('https://gemini.google.com/'))
      .map(mapGemini);
    if (geminiTabs.length === 0) {
      geminiTabs = allTabs
        .filter((t) => t.url && t.url.startsWith('https://gemini.google.com/'))
        .map(mapGemini);
    }

    let flowTabs = sortFlowTabs(windowTabs.filter((t) => isFlowTabUrl(t.url)).map(mapFlow));
    if (flowTabs.length === 0) {
      flowTabs = sortFlowTabs(allTabs.filter((t) => isFlowTabUrl(t.url)).map(mapFlow));
    }

    const isMusicTabUrl = (url) => {
      if (!url) return false;
      const lower = url.toLowerCase();
      return (
        lower.includes('flowmusic.app') ||
        lower.includes('producer.ai') ||
        lower.includes('suno.com')
      );
    };

    const mapMusicTab = (t) => ({
      id: t.id,
      windowId: t.windowId,
      title:
        (t.title || (t.url && t.url.includes('flowmusic') ? 'Flow Music' : 'Flow Music')).trim() ||
        'Flow Music',
      url: t.url,
    });

    const sortMusicTabs = (list) =>
      [...list].sort((a, b) => {
        const aFlowMusic = (a.url || '').toLowerCase().includes('flowmusic.app') ? 0 : 1;
        const bFlowMusic = (b.url || '').toLowerCase().includes('flowmusic.app') ? 0 : 1;
        if (aFlowMusic !== bFlowMusic) return aFlowMusic - bFlowMusic;
        return (b.id || 0) - (a.id || 0);
      });

    let sunoTabs = sortMusicTabs(
      windowTabs.filter((t) => isMusicTabUrl(t.url)).map(mapMusicTab)
    );
    if (sunoTabs.length === 0) {
      sunoTabs = sortMusicTabs(
        allTabs.filter((t) => isMusicTabUrl(t.url)).map(mapMusicTab)
      );
    }

    return { geminiTabs, flowTabs, sunoTabs };
  } catch {
    return { geminiTabs: [], flowTabs: [], sunoTabs: [] };
  }
}

async function ensureFlowMusicAntiAutoplayInMainWorld(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        try {
          if (window.__HUELLAS_FLOWMUSIC_ANTI_AUTOPLAY__) return;
          window.__HUELLAS_FLOWMUSIC_ANTI_AUTOPLAY__ = true;
          window.__HUELLAS_FLOWMUSIC_URLS__ = window.__HUELLAS_FLOWMUSIC_URLS__ || new Set();

          const publishUrls = () => {
            try {
              document.documentElement.setAttribute(
                'data-huellas-flowmusic-urls',
                JSON.stringify(Array.from(window.__HUELLAS_FLOWMUSIC_URLS__))
              );
            } catch {}
          };

          const extractClipUrlsFromText = (txt) => {
            if (!txt || typeof txt !== 'string') return;
            const rx =
              /https:\/\/storage\.googleapis\.com\/producer-app-public\/clips\/[a-zA-Z0-9_-]+\.(?:m4a|mp3|wav)/g;
            let m;
            let added = false;
            while ((m = rx.exec(txt)) !== null) {
              if (!window.__HUELLAS_FLOWMUSIC_URLS__.has(m[0])) {
                window.__HUELLAS_FLOWMUSIC_URLS__.add(m[0]);
                added = true;
              }
            }
            if (added) publishUrls();
          };

          const mediaProto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
          if (mediaProto) {
            const srcDesc = Object.getOwnPropertyDescriptor(mediaProto, 'src');
            if (srcDesc && typeof srcDesc.set === 'function') {
              Object.defineProperty(mediaProto, 'src', {
                configurable: true,
                enumerable: true,
                get: srcDesc.get,
                set(val) {
                  try {
                    if (typeof val === 'string') extractClipUrlsFromText(val);
                  } catch {}
                  return srcDesc.set.call(this, val);
                },
              });
            }

            const origPlay = mediaProto.play;
            if (typeof origPlay === 'function') {
              mediaProto.play = function (...playArgs) {
                try {
                  const currentUrl = this.currentSrc || this.src || '';
                  if (currentUrl) extractClipUrlsFromText(currentUrl);
                  const isSynthetic =
                    document.documentElement.getAttribute('data-huellas-synthetic-click') === '1';
                  const lastManual = Number(
                    document.documentElement.getAttribute('data-huellas-last-manual-play') || '0'
                  );
                  const isManualPlay = !isSynthetic && Date.now() - lastManual < 1800;
                  if (!isManualPlay) {
                    this.muted = true;
                    this.volume = 0;
                    try {
                      this.pause();
                    } catch {}
                    return Promise.resolve();
                  }
                  this.muted = false;
                  if (this.volume === 0) this.volume = 1;
                } catch {}
                return origPlay.apply(this, playArgs);
              };
            }
          }
        } catch {}
      },
    });
  } catch {}
}

async function ensureScriptInjected(tabId, scriptFile) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [scriptFile],
    });
    if (scriptFile === 'suno-content.js') {
      await ensureFlowMusicAntiAutoplayInMainWorld(tabId);
    }
  } catch {}
}

function isStrictHuellasStudioAppUrl(url, title = '') {
  if (!url) return false;
  const lowerUrl = String(url).toLowerCase();
  const lowerTitle = String(title || '').toLowerCase();
  if (/^https?:\/\/(localhost|127\.0\.0\.1):(4200|5173)(\/|$|\?|#)/i.test(lowerUrl)) {
    return true;
  }
  if (lowerUrl.startsWith('https://raydelw-a11y.github.io/huellas-master')) {
    return true;
  }
  if (
    lowerUrl.includes('.onrender.com') &&
    (lowerUrl.includes('huellas') || lowerTitle.includes('huellas'))
  ) {
    return true;
  }
  return false;
}

function isHuellasUrl(url, title = '') {
  if (!url) return false;
  if (isStrictHuellasStudioAppUrl(url, title)) return true;
  return String(url).toLowerCase().includes('huellasdelahumanidad.com');
}

async function getHuellasBrowserProfilePresence() {
  try {
    const tabs = await chrome.tabs.query({});
    const appTabs = tabs.filter((t) => t && t.id && isStrictHuellasStudioAppUrl(t.url, t.title));
    appTabs.sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || (b.id || 0) - (a.id || 0));
    const appTab = appTabs[0] || null;

    const notebookTabs = tabs.filter(
      (t) => t && t.id && /^https:\/\/gemini\.google\.com\/(u\/\d+\/)?notebook\//i.test(t.url || '')
    );
    const siteTabs = tabs.filter(
      (t) => t && t.id && String(t.url || '').toLowerCase().includes('huellasdelahumanidad.com')
    );
    const workspaceTab = notebookTabs[0] || siteTabs[0] || null;
    const anchorTab = appTab || workspaceTab || null;

    return {
      hasAppWindow: Boolean(appTab),
      hasWorkspace: Boolean(appTab || workspaceTab),
      anchorTab,
      anchorWindowId: anchorTab && typeof anchorTab.windowId === 'number' ? anchorTab.windowId : null,
    };
  } catch {
    return {
      hasAppWindow: false,
      hasWorkspace: false,
      anchorTab: null,
      anchorWindowId: null,
    };
  }
}

async function createTemporaryExternalWindowInAppBrowser(targetUrl) {
  const presence = await getHuellasBrowserProfilePresence();
  if (!presence.hasAppWindow && !presence.hasWorkspace) {
    throw new Error('Este navegador/perfil no contiene la ventana abierta de Huellas Master.');
  }

  let appWin = null;
  if (typeof presence.anchorWindowId === 'number') {
    appWin = await chrome.windows.get(presence.anchorWindowId).catch(() => null);
  }

  let createdWin = null;
  if (
    appWin &&
    appWin.state !== 'minimized' &&
    appWin.state !== 'fullscreen' &&
    typeof appWin.left === 'number' &&
    typeof appWin.top === 'number' &&
    typeof appWin.width === 'number' &&
    typeof appWin.height === 'number'
  ) {
    createdWin = await chrome.windows
      .create({
        url: targetUrl,
        focused: false,
        type: 'normal',
        left: Math.max(0, Math.round(appWin.left + 36)),
        top: Math.max(24, Math.round(appWin.top + 36)),
        width: Math.min(Math.max(960, Math.round(appWin.width - 72)), 1320),
        height: Math.min(Math.max(700, Math.round(appWin.height - 60)), 940),
      })
      .catch(() => null);
  }

  if (!createdWin) {
    createdWin = await chrome.windows
      .create({
        url: targetUrl,
        focused: false,
        type: 'normal',
      })
      .catch(() => null);
  }

  let createdWindowId = null;
  let tabId = null;
  if (createdWin && createdWin.id) {
    createdWindowId = createdWin.id;
    if (Array.isArray(createdWin.tabs) && createdWin.tabs[0] && createdWin.tabs[0].id) {
      tabId = createdWin.tabs[0].id;
    } else {
      const winTabs = await chrome.tabs.query({ windowId: createdWin.id }).catch(() => []);
      if (winTabs[0] && winTabs[0].id) tabId = winTabs[0].id;
    }
  }

  if (!tabId) {
    const createdTab = await chrome.tabs.create({
      url: targetUrl,
      active: false,
      ...(typeof presence.anchorWindowId === 'number' ? { windowId: presence.anchorWindowId } : {}),
    });
    tabId = createdTab.id;
  }

  return { createdWindowId, tabId, anchorWindowId: presence.anchorWindowId, hasAppWindow: presence.hasAppWindow };
}

async function createTemporaryTabInAppWindow(targetUrl) {
  const presence = await getHuellasBrowserProfilePresence();
  if (!presence.hasAppWindow && !presence.hasWorkspace) {
    throw new Error('Este navegador/perfil no contiene la ventana abierta de Huellas Master.');
  }
  const createOpts = {
    url: targetUrl,
    active: false,
    ...(typeof presence.anchorWindowId === 'number' ? { windowId: presence.anchorWindowId } : {}),
  };
  const createdTab = await chrome.tabs.create(createOpts);
  if (createdTab && createdTab.id) {
    await chrome.tabs.update(createdTab.id, { autoDiscardable: false }).catch(() => {});
  }
  return {
    createdWindowId: null,
    tabId: createdTab.id,
    anchorWindowId: presence.anchorWindowId,
    hasAppWindow: presence.hasAppWindow,
  };
}

async function initExistingHuellasTabsOnce() {
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
      } else if (
        tab.url.includes('flowmusic.app') ||
        tab.url.includes('producer.ai') ||
        tab.url.includes('suno.com')
      ) {
        ensureScriptInjected(tab.id, 'suno-content.js');
      }
    }
  } catch {}
}

initExistingHuellasTabsOnce();
try {
  chrome.runtime.onInstalled.addListener(() => {
    initExistingHuellasTabsOnce();
  });
  chrome.runtime.onStartup.addListener(() => {
    initExistingHuellasTabsOnce();
  });
} catch {}

async function broadcastToHuellasTabsInSameWindow(windowId, payload) {
  try {
    const queryOpts = typeof windowId === 'number' ? { windowId } : {};
    const tabs = await chrome.tabs.query(queryOpts);
    let huellasTabs = tabs.filter((t) => t.id && isHuellasUrl(t.url));
    // Gemini may live in another window / macOS Space: fall back to every Huellas tab so results are never lost
    if (huellasTabs.length === 0 && typeof windowId === 'number') {
      const allTabs = await chrome.tabs.query({});
      huellasTabs = allTabs.filter((t) => t.id && isHuellasUrl(t.url));
    }
    for (const tab of huellasTabs) {
      chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
    }
    return huellasTabs.length;
  } catch {
    return 0;
  }
}

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  if (!tab || typeof tab.windowId !== 'number') return;
  if (
    tab.id &&
    tab.url &&
    (tab.url.includes('flowmusic.app') || tab.url.includes('producer.ai')) &&
    (changeInfo.status === 'loading' || changeInfo.status === 'complete')
  ) {
    ensureFlowMusicAntiAutoplayInMainWorld(tab.id);
  }
  if (changeInfo.status === 'complete' || changeInfo.title) {
    const { geminiTabs, flowTabs, sunoTabs } = await getConnectedAiTabsInWindow(tab.windowId);
    broadcastToHuellasTabsInSameWindow(tab.windowId, {
      type: 'HUELLAS_CONNECTED_TABS_UPDATE',
      geminiTabs,
      flowTabs,
      sunoTabs: sunoTabs || [],
    });
  }
});

chrome.tabs.onRemoved.addListener(async (_tabId, removeInfo) => {
  if (!removeInfo || removeInfo.isWindowClosing || typeof removeInfo.windowId !== 'number') return;
  const { geminiTabs, flowTabs, sunoTabs } = await getConnectedAiTabsInWindow(removeInfo.windowId);
  broadcastToHuellasTabsInSameWindow(removeInfo.windowId, {
    type: 'HUELLAS_CONNECTED_TABS_UPDATE',
    geminiTabs,
    flowTabs,
    sunoTabs: sunoTabs || [],
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
async function injectPromptIntoBottomEditor(rawPromptText, mediaType, logoDataUrl, autoSubmit = true) {
  const sleepMain = (ms) => new Promise((r) => setTimeout(r, ms));
  const isVidPrompt =
    mediaType === 'VIDEO' || /^\s*\*?\*?Clip\s+\d+/i.test(String(rawPromptText || ''));
  let promptText =
    mediaType === 'THUMBNAILS'
      ? String(rawPromptText || '').replace(/^Thumbnail\s*:\s*/i, '').trim()
      : String(rawPromptText || '').trim();

  // Veo 3.1 - Lite [Lower Priority] admite un máximo de 8 segundos por clip:
  // normalizar cualquier referencia de 10 segundos a 8 segundos para que Google Flow nunca rechace el clip.
  if (isVidPrompt) {
    promptText = promptText
      .replace(/\b10-second\b/gi, '8-second')
      .replace(/\b10\s+seconds\b/gi, '8 seconds')
      .replace(/\bfrom\s+0s\s+to\s+10s\b/gi, 'from 0s to 8s')
      .replace(/\b0s[–-]10s\b/gi, '0s–8s')
      .replace(/\b5s[–-]10s\b/gi, '4s–8s')
      .replace(
        /^(\*?\*?Clip\s+\d+)\s*\((\d{1,2}):(\d{2})\s*(?:-|–|—|to)\s*(\d{1,2}):(\d{2})\)\s*(\*?\*?\s*:)/i,
        (_m, prefix, m1, s1, m2, s2, suffix) => {
          const start = parseInt(m1, 10) * 60 + parseInt(s1, 10);
          const end = parseInt(m2, 10) * 60 + parseInt(s2, 10);
          if (end - start > 8) {
            const cappedEnd = start + 8;
            const em = String(Math.floor(cappedEnd / 60)).padStart(2, '0');
            const es = String(cappedEnd % 60).padStart(2, '0');
            return `${prefix} (${String(m1).padStart(2, '0')}:${s1} - ${em}:${es})${suffix}`;
          }
          return _m;
        }
      );
  }
  const safePrompt = promptText.endsWith(' ') ? promptText : `${promptText} `;

  function findBottomPromptEditor() {
    const rawList = [
      ...document.querySelectorAll('div.ProseMirror[contenteditable="true"]'),
      ...document.querySelectorAll('div[contenteditable="true"][role="textbox"]'),
      ...document.querySelectorAll('rich-textarea [contenteditable="true"], .ql-editor[contenteditable="true"]'),
      ...document.querySelectorAll('[contenteditable="true"]:not([aria-hidden="true"])'),
      ...document.querySelectorAll('textarea:not(.g-recaptcha-response):not([readonly])'),
    ];

    const seen = new Set();
    const allCandidates = rawList.filter((el) => {
      if (seen.has(el)) return false;
      seen.add(el);
      const r = el.getBoundingClientRect();
      return (
        r.width > 50 &&
        r.height > 12 &&
        r.bottom > 0 &&
        getComputedStyle(el).visibility !== 'hidden' &&
        !el.closest(
          '#story-studio-modal-root, .agent-panel-animation-container, .sidenav, mat-sidenav, mat-drawer'
        )
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

  let editorEl = findBottomPromptEditor();
  if (!editorEl) {
    return { injected: false, error: 'No se encontró la caja de prompt en la página principal de Google Flow.' };
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
    await sleepMain(350);
    editorEl = findBottomPromptEditor() || editorEl;
  }

  const findProseMirrorView = (rootEl) => {
    if (!rootEl) return null;
    if (rootEl.pmViewDesc?.view) return rootEl.pmViewDesc.view;
    try {
      for (const ch of Array.from(rootEl.querySelectorAll('*'))) {
        if (ch.pmViewDesc?.view) return ch.pmViewDesc.view;
      }
      let p = rootEl.parentElement;
      for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
        if (p.pmViewDesc?.view) return p.pmViewDesc.view;
      }
    } catch {}
    return null;
  };

  editorEl.focus();

  if (editorEl.tagName === 'TEXTAREA' || editorEl.tagName === 'INPUT') {
    const proto =
      editorEl.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) nativeSetter.call(editorEl, safePrompt);
    else editorEl.value = safePrompt;
  } else {
    // 1. Insertar directamente a través del EditorView nativo de ProseMirror (funciona incluso con la pestaña en segundo plano sin modificar atributos DOM)
    const pmView = findProseMirrorView(editorEl);
    if (pmView && pmView.state) {
      try {
        const tr = pmView.state.tr.insertText(safePrompt, 0, pmView.state.doc.content.size);
        pmView.dispatch(tr);
      } catch {}
    }

    // 2. Respaldo con execCommand('insertText') sólo si ProseMirror no actualizó el texto
    const currentLen = (editorEl.innerText || editorEl.textContent || '').trim().length;
    if (currentLen < 3) {
      try {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editorEl);
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand('insertText', false, safePrompt);
      } catch {}
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

  // Pausa humana natural para que Google Flow habilite el botón de enviar sin manipular atributos DOM
  await sleepMain(480);

  const beforeClickLen = (editorEl.innerText || editorEl.textContent || editorEl.value || '').trim()
    .length;

  let clickedGenBtnInMain = false;
  if (autoSubmit !== false && beforeClickLen >= 3) {
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
        clickedGenBtnInMain = true;
      } catch {}
    }
  }

  return {
    injected: beforeClickLen >= 3,
    beforeClickLen,
    clickedGenBtnInMain,
  };
}

/**
 * Ejecutado en world: 'MAIN' DESPUÉS de adjuntar chrome.debugger y esperar 350ms:
 * 1. Verifica que el prompt siga en el editor inferior (y si se borró al abrirse la barra de debug, lo vuelve a pegar).
 * 2. Busca EXCLUSIVAMENTE el botón de enviar (button.generate-icon-button / arrow_upward / arrow_forward),
 *    con Lista Negra estricta que prohíbe tocar cualquier botón de Clear (X), Close o Download.
 */
function ensurePromptAndGetSubmitCoords(rawPromptText, mediaType) {
  const isVidPrompt =
    mediaType === 'VIDEO' || /^\s*\*?\*?Clip\s+\d+/i.test(String(rawPromptText || ''));
  let promptText =
    mediaType === 'THUMBNAILS'
      ? String(rawPromptText || '').replace(/^Thumbnail\s*:\s*/i, '').trim()
      : String(rawPromptText || '').trim();
  if (isVidPrompt) {
    promptText = promptText
      .replace(/\b10-second\b/gi, '8-second')
      .replace(/\b10\s+seconds\b/gi, '8 seconds')
      .replace(/\bfrom\s+0s\s+to\s+10s\b/gi, 'from 0s to 8s')
      .replace(/\b0s[–-]10s\b/gi, '0s–8s')
      .replace(/\b5s[–-]10s\b/gi, '4s–8s')
      .replace(
        /^(\*?\*?Clip\s+\d+)\s*\((\d{1,2}):(\d{2})\s*(?:-|–|—|to)\s*(\d{1,2}):(\d{2})\)\s*(\*?\*?\s*:)/i,
        (_m, prefix, m1, s1, m2, s2, suffix) => {
          const start = parseInt(m1, 10) * 60 + parseInt(s1, 10);
          const end = parseInt(m2, 10) * 60 + parseInt(s2, 10);
          if (end - start > 8) {
            const cappedEnd = start + 8;
            const em = String(Math.floor(cappedEnd / 60)).padStart(2, '0');
            const es = String(cappedEnd % 60).padStart(2, '0');
            return `${prefix} (${String(m1).padStart(2, '0')}:${s1} - ${em}:${es})${suffix}`;
          }
          return _m;
        }
      );
  }
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
      !el.closest(
        '#story-studio-modal-root, .agent-panel-animation-container, .sidenav, mat-sidenav, mat-drawer'
      )
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

  const findProseMirrorView = (rootEl) => {
    if (!rootEl) return null;
    if (rootEl.pmViewDesc?.view) return rootEl.pmViewDesc.view;
    try {
      for (const ch of Array.from(rootEl.querySelectorAll('*'))) {
        if (ch.pmViewDesc?.view) return ch.pmViewDesc.view;
      }
      let p = rootEl.parentElement;
      for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
        if (p.pmViewDesc?.view) return p.pmViewDesc.view;
      }
    } catch {}
    return null;
  };

  // Si el editor está vacío, inyectar el texto ahora mismo y colocar el cursor al final
  if (currentText.length < 3 && promptText.length > 0) {
    editorEl.focus();
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editorEl);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, safePrompt);
    } catch {}

    const pmView = findProseMirrorView(editorEl);
    if (pmView && pmView.state && (pmView.state.doc.textContent || '').trim().length < 3) {
      try {
        const tr = pmView.state.tr.insertText(safePrompt, 0, pmView.state.doc.content.size);
        pmView.dispatch(tr);
      } catch {}
    }

    if ((editorEl.innerText || editorEl.textContent || '').trim().length < 3) {
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', safePrompt);
        editorEl.dispatchEvent(
          new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            composed: true,
            clipboardData: dt,
          })
        );
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
  let buttonWasDisabled = false;
  if (chosenBtn) {
    buttonWasDisabled = Boolean(
      chosenBtn.disabled ||
        chosenBtn.hasAttribute('disabled') ||
        chosenBtn.getAttribute('aria-disabled') === 'true' ||
        chosenBtn.classList.contains('disabled')
    );
    chosenBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const br = chosenBtn.getBoundingClientRect();
    btnInfo = {
      x: Math.round(br.left + br.width / 2),
      y: Math.round(br.top + br.height / 2),
      className: chosenBtn.className || '',
      text: (chosenBtn.textContent || '').trim(),
    };
  }

  return {
    foundEditor: true,
    safePrompt,
    textLength: currentText.length,
    buttonWasDisabled,
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

async function cdpSendWithTimeout(target, method, params = {}, timeoutMs = 450) {
  let timer = null;
  try {
    return await Promise.race([
      chrome.debugger.sendCommand(target, method, params).then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), Math.max(120, Number(timeoutMs) || 450));
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function dispatchHardwareClick(target, x, y) {
  const okMove = await cdpSendWithTimeout(
    target,
    'Input.dispatchMouseEvent',
    {
      type: 'mouseMoved',
      x,
      y,
      button: 'none',
    },
    360
  );
  if (!okMove) return false;
  await sleep(35);
  const okDown = await cdpSendWithTimeout(
    target,
    'Input.dispatchMouseEvent',
    {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    },
    360
  );
  if (!okDown) return false;
  await sleep(45);
  return await cdpSendWithTimeout(
    target,
    'Input.dispatchMouseEvent',
    {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    },
    360
  );
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
 * Obtiene todos los executionContexts (MAIN world) de un debuggee ({ tabId } o { targetId } de OOPIF).
 */
async function getCdpExecutionContexts(debuggee) {
  try {
    await chrome.debugger.attach(debuggee, '1.3');
  } catch (err) {
    const msg = String(err?.message || err || '');
    if (!msg.includes('Already attached') && !msg.includes('Another debugger is already attached')) {
      throw err;
    }
  }

  const contexts = [];
  const onEvent = (source, method, params) => {
    const sameTarget =
      (debuggee.targetId && source.targetId === debuggee.targetId) ||
      (debuggee.tabId && source.tabId === debuggee.tabId);
    if (sameTarget && method === 'Runtime.executionContextCreated' && params?.context) {
      contexts.push(params.context);
    }
  };

  chrome.debugger.onEvent.addListener(onEvent);
  try {
    await chrome.debugger.sendCommand(debuggee, 'Runtime.disable').catch(() => {});
    await chrome.debugger.sendCommand(debuggee, 'Runtime.enable');
    await sleep(140);
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
  }

  return contexts;
}

/**
 * Devuelve todos los targets candidatos de una pestaña de Google Flow, incluyendo:
 * 1) Todos los Out-Of-Process Iframes (OOPIF: <iframe sandbox="allow-scripts" src="https://...usercontent.goog/...">)
 *    que chrome.scripting.executeScript NO puede alcanzar por tener origen opaco null.
 * 2) El tab principal ({ tabId }) y sus subframes en el mismo proceso.
 */
async function getFlowCdpCandidateDebuggees(tabId) {
  const candidates = [];

  try {
    const allTargets = await chrome.debugger.getTargets();
    const subTargets = (allTargets || []).filter((t) => {
      if (!t || !t.id) return false;
      if (t.type === 'service_worker' || t.type === 'background_page' || t.type === 'worker') {
        return false;
      }
      const u = String(t.url || '').toLowerCase();
      if (
        u.startsWith('chrome-extension://') ||
        u.startsWith('chrome://') ||
        u.startsWith('devtools://') ||
        u.startsWith('edge://') ||
        u.includes('gemini.google.com') ||
        u.includes('suno.com') ||
        isHuellasUrl(u)
      ) {
        return false;
      }
      if (t.tabId === tabId && t.type === 'page') return false;
      if (t.tabId === tabId) return true;
      return (
        t.type === 'iframe' ||
        t.type === 'other' ||
        u.includes('usercontent.goog') ||
        u.includes('googleusercontent.com') ||
        u.includes('scf.usercontent') ||
        u.includes('aisandbox') ||
        u.includes('flow.google') ||
        u.includes('labs.google') ||
        u.includes('aistudio.google') ||
        u.startsWith('blob:') ||
        u === 'about:srcdoc'
      );
    });

    // Priorizar iframes de usercontent.goog / googleusercontent.com (donde corre Story Studio)
    subTargets.sort((a, b) => {
      const aUrl = String(a.url || '').toLowerCase();
      const bUrl = String(b.url || '').toLowerCase();
      const aScore =
        (a.type === 'iframe' ? 5 : 0) +
        (aUrl.includes('usercontent.goog') || aUrl.includes('googleusercontent.com') ? 6 : 0) +
        (a.tabId === tabId ? 3 : 0);
      const bScore =
        (b.type === 'iframe' ? 5 : 0) +
        (bUrl.includes('usercontent.goog') || bUrl.includes('googleusercontent.com') ? 6 : 0) +
        (b.tabId === tabId ? 3 : 0);
      return bScore - aScore;
    });

    for (const t of subTargets) {
      candidates.push({ debuggee: { targetId: t.id }, contextId: undefined, url: t.url, type: t.type });
    }
  } catch {}

  try {
    const mainContexts = await getCdpExecutionContexts({ tabId });
    const mainDefaults = mainContexts.filter((c) => c.auxData?.isDefault !== false);
    if (mainDefaults.length > 0) {
      for (const ctx of mainDefaults) {
        candidates.push({ debuggee: { tabId }, contextId: ctx.id });
      }
    } else {
      candidates.push({ debuggee: { tabId }, contextId: undefined });
    }
  } catch {
    candidates.push({ debuggee: { tabId }, contextId: undefined });
  }

  return candidates;
}

/**
 * Ejecuta una función asíncrona en todos los frames/OOPIFs de la pestaña de Google Flow
 * (primero vía chrome.scripting.executeScript y luego vía CDP Runtime.evaluate en todos los OOPIFs)
 * hasta encontrar el frame donde matchPredicate(result) sea verdadero.
 */
async function evaluateAcrossAllFlowFramesAndOopifs(
  tabId,
  func,
  args = [],
  matchPredicate = (r) => Boolean(r && (r.hasSdk || r.ok || r.injected || r.synced))
) {
  // 1. Intento rápido con chrome.scripting.executeScript
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      args,
      func,
    });
    const hit = (results || []).find((r) => matchPredicate(r?.result));
    if (hit && hit.result) {
      return hit.result;
    }
  } catch {}

  // 2. Intento profundo con CDP Runtime.evaluate en cada OOPIF (<iframe sandbox="allow-scripts">)
  const candidates = await getFlowCdpCandidateDebuggees(tabId);
  const serializedArgs = args
    .map((a) => (a === undefined ? 'undefined' : JSON.stringify(a)))
    .join(', ');
  const expression = `(${func.toString()})(${serializedArgs})`;

  let lastResult = null;
  for (const cand of candidates) {
    try {
      try {
        await chrome.debugger.attach(cand.debuggee, '1.3');
      } catch {}
      const evalRes = await chrome.debugger.sendCommand(cand.debuggee, 'Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        ...(cand.contextId ? { contextId: cand.contextId } : {}),
      });
      const val = evalRes?.result?.value;
      if (val) {
        lastResult = val;
        if (matchPredicate(val)) {
          return val;
        }
      }
    } catch {}
  }

  return lastResult;
}

/**
 * Verifica si algún frame o iframe OOPIF (<iframe sandbox="allow-scripts">) de la pestaña de Google Flow
 * tiene expuesto window.__HUELLAS_FLOW_SDK__ = Flow, import('flow-sdk'), o Story Studio abierto.
 */
async function checkFlowSdkAvailableInTab(tabId) {
  try {
    const probeRes = await evaluateAcrossAllFlowFramesAndOopifs(
      tabId,
      async () => {
        const sleepProbe = (ms) => new Promise((r) => setTimeout(r, ms));
        let sdk = window.__HUELLAS_FLOW_SDK__ || window.Flow || null;

        if (!sdk || typeof sdk.generate?.image !== 'function') {
          try {
            const mod = await import('flow-sdk');
            if (mod && (mod.Flow || mod.default)) {
              sdk = mod.Flow || mod.default;
              window.__HUELLAS_FLOW_SDK__ = sdk;
            }
          } catch {}
        }

        if (!sdk || typeof sdk.generate?.image !== 'function') {
          try {
            const imScripts = Array.from(document.querySelectorAll('script[type="importmap"]'));
            for (const s of imScripts) {
              try {
                const map = JSON.parse(s.textContent || '{}');
                const flowUrl = map?.imports?.['flow-sdk'];
                if (flowUrl) {
                  const mod = await import(flowUrl);
                  if (mod && (mod.Flow || mod.default)) {
                    sdk = mod.Flow || mod.default;
                    window.__HUELLAS_FLOW_SDK__ = sdk;
                    break;
                  }
                }
              } catch {}
            }
          } catch {}
        }

        if (!sdk || typeof sdk.generate?.image !== 'function') {
          try {
            const resources = performance.getEntriesByType('resource') || [];
            for (const r of resources) {
              if (r.name && /flow-sdk/i.test(r.name)) {
                try {
                  const mod = await import(r.name);
                  if (mod && (mod.Flow || mod.default)) {
                    sdk = mod.Flow || mod.default;
                    window.__HUELLAS_FLOW_SDK__ = sdk;
                    break;
                  }
                } catch {}
              }
            }
          } catch {}
        }

        const isHuellasBridgeTool = Boolean(
          document.getElementById('huellas-flow-bridge-root') ||
            window.__HUELLAS_FLOW_BRIDGE__ ||
            typeof window.__HUELLAS_GENERATE_VIDEO__ === 'function'
        );

        const isStoryStudio =
          !isHuellasBridgeTool &&
          Boolean(
            document.getElementById('story-studio-modal-root') ||
              (Array.from(document.querySelectorAll('button')).some((b) =>
                /1\.\s*Script/i.test(b.textContent || '')
              ) &&
                Array.from(document.querySelectorAll('button')).some((b) =>
                  /2\.\s*Assets/i.test(b.textContent || '')
                )) ||
              Array.from(document.querySelectorAll('button')).some((b) =>
                /^get started$/i.test((b.textContent || '').trim())
              )
          );

        if (isStoryStudio && (!sdk || typeof sdk.generate?.image !== 'function')) {
          const getStartedBtn = Array.from(document.querySelectorAll('button')).find((b) =>
            /^get started$/i.test((b.textContent || '').trim())
          );
          if (getStartedBtn) {
            try {
              getStartedBtn.click();
              await sleepProbe(350);
              sdk = window.__HUELLAS_FLOW_SDK__ || window.Flow || null;
            } catch {}
          }
        }

        return {
          hasSdk: Boolean(
            isHuellasBridgeTool ||
              (sdk &&
                (typeof sdk.generate?.image === 'function' ||
                  typeof sdk.generate?.video === 'function'))
          ),
          isHuellasBridgeTool,
          isStoryStudio,
        };
      },
      [],
      (r) => Boolean(r && r.hasSdk)
    );

    if (probeRes && probeRes.hasSdk) {
      return {
        hasSdk: true,
        isHuellasBridgeTool: Boolean(probeRes.isHuellasBridgeTool),
        isStoryStudio: Boolean(probeRes.isStoryStudio),
      };
    }

    // Segunda pasada por si no tiene hasSdk pero sí tiene Story Studio abierto
    const ssRes = await evaluateAcrossAllFlowFramesAndOopifs(
      tabId,
      () => ({
        hasSdk: Boolean(
          document.getElementById('huellas-flow-bridge-root') ||
            window.__HUELLAS_FLOW_BRIDGE__ ||
            typeof window.__HUELLAS_GENERATE_VIDEO__ === 'function' ||
            (window.__HUELLAS_FLOW_SDK__ &&
              (typeof window.__HUELLAS_FLOW_SDK__.generate?.image === 'function' ||
                typeof window.__HUELLAS_FLOW_SDK__.generate?.video === 'function'))
        ),
        isStoryStudio: Boolean(
          document.getElementById('story-studio-modal-root') ||
            Array.from(document.querySelectorAll('button')).some((b) =>
              /1\.\s*Script|2\.\s*Assets|3\.\s*Storyboard/i.test(b.textContent || '')
            )
        ),
      }),
      [],
      (r) => Boolean(r && (r.hasSdk || r.isStoryStudio))
    );

    return {
      hasSdk: Boolean(ssRes?.hasSdk),
      isStoryStudio: Boolean(ssRes?.isStoryStudio),
    };
  } catch {
    return { hasSdk: false, isStoryStudio: false };
  }
}

/**
 * Genera 1 imagen directamente usando window.__HUELLAS_FLOW_SDK__.generate.image(...)
 * dentro del frame/OOPIF de Story Studio y devuelve { ok, mediaId, imageDataUrl } directamente a background.js
 * sin depender de postMessage ni de clics en el DOM.
 */
async function generateSingleImageViaFlowSdk(
  tabId,
  rawPrompt,
  aspectRatio = '16:9',
  logoDataUrl = ''
) {
  try {
    const res = await evaluateAcrossAllFlowFramesAndOopifs(
      tabId,
      async (promptText, ratio, logoData) => {
        let sdk = window.__HUELLAS_FLOW_SDK__ || window.Flow || null;
        if (!sdk || typeof sdk.generate?.image !== 'function') {
          try {
            const mod = await import('flow-sdk');
            sdk = mod?.Flow || mod?.default || null;
            if (sdk) window.__HUELLAS_FLOW_SDK__ = sdk;
          } catch {}
        }
        if (!sdk || typeof sdk.generate?.image !== 'function') {
          try {
            const imScripts = Array.from(document.querySelectorAll('script[type="importmap"]'));
            for (const s of imScripts) {
              try {
                const map = JSON.parse(s.textContent || '{}');
                const flowUrl = map?.imports?.['flow-sdk'];
                if (flowUrl) {
                  const mod = await import(flowUrl);
                  sdk = mod?.Flow || mod?.default || null;
                  if (sdk) {
                    window.__HUELLAS_FLOW_SDK__ = sdk;
                    break;
                  }
                }
              } catch {}
            }
          } catch {}
        }
        if (!sdk || typeof sdk.generate?.image !== 'function') {
          try {
            const resources = performance.getEntriesByType('resource') || [];
            for (const r of resources) {
              if (r.name && /flow-sdk/i.test(r.name)) {
                try {
                  const mod = await import(r.name);
                  sdk = mod?.Flow || mod?.default || null;
                  if (sdk) {
                    window.__HUELLAS_FLOW_SDK__ = sdk;
                    break;
                  }
                } catch {}
              }
            }
          } catch {}
        }
        if (
          typeof window.__HUELLAS_GENERATE_VIDEO__ !== 'function' &&
          (!sdk ||
            (typeof sdk.generate?.video !== 'function' &&
              typeof sdk.generate?.image !== 'function'))
        ) {
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

        // Prioridad estricta de Imagen: 1) Nano Banana 2.1 -> 2) Nano Banana Pro (siempre x1 item)
        const modelsToTry = [
          '🍌 Nano Banana 2.1',
          'Nano Banana 2.1',
          '🍌 Nano Banana Pro',
          'Nano Banana Pro',
        ];
        let lastError = '';
        for (const modelDisplayName of modelsToTry) {
          try {
            const imgRes = await sdk.generate.image({
              prompt: cleanPrompt,
              aspectRatio: ratio || '16:9',
              count: 1,
              sampleCount: 1,
              numOutputs: 1,
              outputsPerPrompt: 1,
              referenceImageMediaIds,
              modelDisplayName,
            });
            if (imgRes && imgRes.base64) {
              const mime = imgRes.mimeType || 'image/jpeg';
              return {
                hasSdk: true,
                ok: true,
                mediaId: imgRes.mediaId,
                mimeType: mime,
                imageDataUrl: `data:${mime};base64,${imgRes.base64}`,
                modelUsed: modelDisplayName,
              };
            }
          } catch (err) {
            lastError = String(err?.message || err || '');
            await new Promise((r) => setTimeout(r, 800));
          }
        }
        return {
          hasSdk: true,
          ok: false,
          error: lastError || 'Flow.generate.image no devolvió base64.',
        };
      },
      [rawPrompt, aspectRatio, logoDataUrl],
      (r) => Boolean(r && r.hasSdk)
    );

    return res && res.hasSdk ? res : { hasSdk: false, ok: false };
  } catch (err) {
    return { hasSdk: false, ok: false, error: String(err?.message || err) };
  }
}

let stopFlowAutoPilotRequested = false;

/**
 * Genera el cuadro inicial (Flow.generate.image) y el video (Flow.generate.video + fallback cinematográfico)
 * de un Clip de Etapa 8 directamente vía window.__HUELLAS_FLOW_SDK__ dentro del frame/OOPIF de Story Studio.
 */
async function generateSingleClipViaFlowSdk(
  tabId,
  clipItem = {},
  aspectRatio = '16:9',
  referenceAssets = []
) {
  try {
    const res = await evaluateAcrossAllFlowFramesAndOopifs(
      tabId,
      async (item, ratio, refsList) => {
        let sdk = window.__HUELLAS_FLOW_SDK__ || window.Flow || null;
        if (!sdk || typeof sdk.generate?.image !== 'function') {
          try {
            const mod = await import('flow-sdk');
            sdk = mod?.Flow || mod?.default || null;
            if (sdk) window.__HUELLAS_FLOW_SDK__ = sdk;
          } catch {}
        }
        if (!sdk || typeof sdk.generate?.image !== 'function') {
          try {
            const imScripts = Array.from(document.querySelectorAll('script[type="importmap"]'));
            for (const s of imScripts) {
              try {
                const map = JSON.parse(s.textContent || '{}');
                const flowUrl = map?.imports?.['flow-sdk'];
                if (flowUrl) {
                  const mod = await import(flowUrl);
                  sdk = mod?.Flow || mod?.default || null;
                  if (sdk) {
                    window.__HUELLAS_FLOW_SDK__ = sdk;
                    break;
                  }
                }
              } catch {}
            }
          } catch {}
        }
        if (!sdk || typeof sdk.generate?.image !== 'function') {
          try {
            const resources = performance.getEntriesByType('resource') || [];
            for (const r of resources) {
              if (r.name && /flow-sdk/i.test(r.name)) {
                try {
                  const mod = await import(r.name);
                  sdk = mod?.Flow || mod?.default || null;
                  if (sdk) {
                    window.__HUELLAS_FLOW_SDK__ = sdk;
                    break;
                  }
                } catch {}
              }
            }
          } catch {}
        }
        if (
          typeof window.__HUELLAS_GENERATE_VIDEO__ !== 'function' &&
          (!sdk ||
            (typeof sdk.generate?.video !== 'function' &&
              typeof sdk.generate?.image !== 'function'))
        ) {
          return { hasSdk: false };
        }

        window.__HUELLAS_REF_MEDIA_IDS__ = window.__HUELLAS_REF_MEDIA_IDS__ || {};
        const refCache = window.__HUELLAS_REF_MEDIA_IDS__;

        const rawImagePrompt = String(item.imagePrompt || item.prompt || '').trim();
        const rawVideoPrompt = String(item.videoPrompt || item.prompt || '').trim();
        const combinedLower = `${rawImagePrompt} ${rawVideoPrompt}`.toLowerCase();

        // 1. Resolver hasta 3 @Referencias vinculadas al clip (subiéndolas una sola vez con Flow.upload si tienen base64)
        const referenceImageMediaIds = [];
        if (Array.isArray(refsList) && refsList.length > 0 && typeof sdk.upload === 'function') {
          const matchedRefs = refsList.filter((r) => {
            const tagClean = String(r.tag || '')
              .replace(/^@+/, '')
              .toLowerCase();
            const nameClean = String(r.name || '').toLowerCase();
            return (
              (tagClean && combinedLower.includes(tagClean)) ||
              (nameClean && combinedLower.includes(nameClean))
            );
          });
          const chosenRefs = (matchedRefs.length > 0 ? matchedRefs : refsList).slice(0, 3);
          for (const ref of chosenRefs) {
            const cacheKey = ref.id || ref.tag || ref.name;
            if (cacheKey && refCache[cacheKey]) {
              referenceImageMediaIds.push(refCache[cacheKey]);
              continue;
            }
            if (ref.imageUrl && String(ref.imageUrl).startsWith('data:image/')) {
              try {
                const parts = String(ref.imageUrl).split(',');
                const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/png';
                const b64 = parts[1] || '';
                if (b64) {
                  const up = await sdk.upload({
                    base64: b64,
                    mimeType: mime,
                    name: `Ref - ${ref.name || ref.tag || 'Asset'}`,
                  });
                  if (up?.mediaId) {
                    if (cacheKey) refCache[cacheKey] = up.mediaId;
                    referenceImageMediaIds.push(up.mediaId);
                  }
                }
              } catch (upErr) {
                console.warn('[Huellas Flow SDK] Ref upload skipped:', upErr);
              }
            }
          }
        }

        const realisticStyle =
          'Hyper-realistic cinematic film still. Shallow depth of field, atmospheric lighting, ultra-high-fidelity textures. Lifelike characters exhibit visible skin pores, natural flaws, and nuanced micro-expressions within a softly focused, immersive environment. Characters ignore the camera. Uncropped full frame, textless, no letterboxing.';

        const cleanImgPromptBase = (rawImagePrompt || rawVideoPrompt)
          .replace(/^\*\*?Image\s*\d+\s*:\*\*?\s*/i, '')
          .replace(/^Image\s*\d+\s*:\s*/i, '')
          .replace(/^\*\*?Clip\s*\d+\s*(?:\([^)]*\))?\s*:\*\*?\s*/i, '')
          .replace(/^Clip\s*\d+\s*(?:\([^)]*\))?\s*:\s*/i, '')
          .trim();

        const fullImgPrompt = cleanImgPromptBase.includes('Visual Style:')
          ? cleanImgPromptBase.slice(0, 3950)
          : `${cleanImgPromptBase.slice(0, 3550)}\nVisual Style: ${realisticStyle}`.slice(0, 3950);

        const cleanVidPrompt = (rawVideoPrompt || rawImagePrompt)
          .replace(/^\*\*?Clip\s*\d+\s*(?:\([^)]*\))?\s*:\*\*?\s*/i, '')
          .replace(/^Clip\s*\d+\s*(?:\([^)]*\))?\s*:\s*/i, '')
          .replace(/^\*\*?Image\s*\d+\s*:\*\*?\s*/i, '')
          .replace(/^Image\s*\d+\s*:\s*/i, '')
          .trim()
          .slice(0, 3950);

        // 2. Determinar la duración exacta del clip elegida en la Etapa 1 (Clip 1 vs Clips 2+)
        const resolveClipDurationSeconds = () => {
          const explicit = Number(item.durationSeconds || item.duration);
          if (Number.isFinite(explicit) && explicit >= 1 && explicit <= 60) {
            return Math.round(explicit);
          }
          const rangeSrc = String(item.timeRange || item.videoPrompt || '');
          const rangeMatch = rangeSrc.match(/(\d{1,2}):(\d{2})\s*(?:-|–|—|to)\s*(\d{1,2}):(\d{2})/);
          if (rangeMatch) {
            const startSec = parseInt(rangeMatch[1], 10) * 60 + parseInt(rangeMatch[2], 10);
            const endSec = parseInt(rangeMatch[3], 10) * 60 + parseInt(rangeMatch[4], 10);
            const diff = endSec - startSec;
            if (diff >= 1 && diff <= 60) {
              return diff;
            }
          }
          const promptSecMatch =
            String(item.videoPrompt || '').match(/across\s+the\s+full\s+(\d+)\s+seconds/i) ||
            String(item.videoPrompt || '').match(/throughout\s+the\s+(\d+)-second\s+shot/i) ||
            String(item.videoPrompt || '').match(/from\s+0s\s+to\s+(\d+)s/i);
          if (promptSecMatch) {
            const pSec = parseInt(promptSecMatch[1], 10);
            if (pSec >= 1 && pSec <= 60) {
              return pSec;
            }
          }
          return Number(item.clipNumber) === 1 ? 6 : 10;
        };

        const targetDurationSec = resolveClipDurationSeconds();

        // 3. Intentar PRIMERO generar Video nativo directo con 'Veo 3.1 - Lite [Lower Priority]' (Gratis / 0 créditos, x1 item)
        //    sin gastar créditos generando imagen previa.
        let videoDataUrl = '';
        let videoMediaId = undefined;
        let videoMode = 'FLOW_SDK';
        let startImageMediaId = undefined;
        let startImageDataUrl = '';
        let lastError = '';

        const baseVidOpts = {
          prompt: cleanVidPrompt,
          aspectRatio: ratio || '16:9',
          resolution: '720p',
          count: 1,
          sampleCount: 1,
          numOutputs: 1,
          outputsPerPrompt: 1,
          durationSeconds: targetDurationSec,
          duration: targetDurationSec,
          ...(referenceImageMediaIds.length > 0 ? { referenceImageMediaIds } : {}),
        };

        // 3A. Si el Tool dentro de Google Flow expuso window.__HUELLAS_GENERATE_VIDEO__, usarlo primero
        if (typeof window.__HUELLAS_GENERATE_VIDEO__ === 'function') {
          try {
            const customRes = await window.__HUELLAS_GENERATE_VIDEO__({
              ...baseVidOpts,
              clipNumber: item.clipNumber,
              clipId: item.id,
              modelDisplayName: 'Veo 3.1 - Lite [Lower Priority]',
            });
            if (customRes && (customRes.base64 || customRes.videoDataUrl)) {
              const vMime = customRes.mimeType || 'video/mp4';
              videoDataUrl =
                customRes.videoDataUrl || `data:${vMime};base64,${customRes.base64}`;
              videoMediaId = customRes.mediaId;
              videoMode = 'NATIVE_VIDEO_Veo 3.1 - Lite [Lower Priority]';
            }
          } catch (cErr) {
            lastError = String(cErr?.message || cErr || '');
          }
        }

        // 3B. Usar Flow.generate.video con 'Veo 3.1 - Lite [Lower Priority]' (probando primero la firma limpia exacta del SDK)
        if (!videoDataUrl && typeof sdk?.generate?.video === 'function') {
          const cleanMinimalOpts = {
            prompt: cleanVidPrompt,
            aspectRatio: ratio || '16:9',
            ...(referenceImageMediaIds.length > 0 ? { referenceImageMediaIds } : {}),
          };
          const vidAttempts = [
            {
              ...cleanMinimalOpts,
              modelDisplayName: 'Veo 3.1 - Lite [Lower Priority]',
            },
            {
              ...cleanMinimalOpts,
              resolution: '720p',
              durationSeconds: targetDurationSec,
              modelDisplayName: 'Veo 3.1 - Lite [Lower Priority]',
            },
            {
              ...baseVidOpts,
              modelDisplayName: 'Veo 3.1 - Lite [Lower Priority]',
              model: 'Veo 3.1 - Lite [Lower Priority]',
            },
            {
              ...cleanMinimalOpts,
            },
          ];
          for (const attemptOpts of vidAttempts) {
            try {
              const vidRes = await sdk.generate.video(attemptOpts);
              if (vidRes && (vidRes.base64 || vidRes.videoDataUrl)) {
                const vMime = vidRes.mimeType || 'video/mp4';
                videoDataUrl =
                  vidRes.videoDataUrl || `data:${vMime};base64,${vidRes.base64}`;
                videoMediaId = vidRes.mediaId;
                videoMode = 'NATIVE_VIDEO_Veo 3.1 - Lite [Lower Priority]';
                break;
              }
            } catch (vErr) {
              lastError = String(vErr?.message || vErr || '');
            }
          }
        }

        // 4. Extraer 3 Keyframes reales del video .MP4 generado para la auditoría en Etapa 8
        const frames = [];
        if (videoDataUrl) {
          try {
            const vidEl = document.createElement('video');
            vidEl.muted = true;
            vidEl.playsInline = true;
            vidEl.src = videoDataUrl;
            await new Promise((resolve) => {
              const t = setTimeout(resolve, 3500);
              vidEl.onloadeddata = () => {
                clearTimeout(t);
                resolve();
              };
              vidEl.onerror = () => {
                clearTimeout(t);
                resolve();
              };
            });
            const dur = Number.isFinite(vidEl.duration) && vidEl.duration > 0.5 ? vidEl.duration : 6;
            const isVert = ratio === '9:16';
            const kfW = isVert ? 360 : 640;
            const kfH = isVert ? 640 : 360;
            const kfCanvas = document.createElement('canvas');
            kfCanvas.width = kfW;
            kfCanvas.height = kfH;
            const kfCtx = kfCanvas.getContext('2d');
            if (kfCtx) {
              for (const frac of [0.12, 0.5, 0.88]) {
                try {
                  vidEl.currentTime = Math.max(0.05, dur * frac);
                  await new Promise((r) => {
                    const st = setTimeout(r, 450);
                    vidEl.onseeked = () => {
                      clearTimeout(st);
                      r();
                    };
                  });
                  kfCtx.drawImage(vidEl, 0, 0, kfW, kfH);
                  frames.push(kfCanvas.toDataURL('image/jpeg', 0.85));
                } catch {}
              }
            }
          } catch (synthErr) {
            console.warn('[Huellas Flow SDK] Video keyframe extraction warning:', synthErr);
          }
        }

        if (!videoDataUrl && !startImageDataUrl) {
          return {
            hasSdk: true,
            ok: false,
            isNativeVideo: false,
            error: lastError || 'No se pudo generar el clip vía Flow SDK.',
          };
        }

        return {
          hasSdk: true,
          ok: true,
          isNativeVideo: Boolean(videoDataUrl && String(videoMode).startsWith('NATIVE_VIDEO')),
          mode: videoMode,
          mediaId: videoMediaId || startImageMediaId,
          startImageMediaId,
          startImageDataUrl,
          videoDataUrl: videoDataUrl || '',
          frames: frames.length > 0 ? frames : startImageDataUrl ? [startImageDataUrl] : [],
          duration: targetDurationSec,
        };
      },
      [clipItem, aspectRatio, referenceAssets],
      (r) => Boolean(r && r.hasSdk)
    );

    return res && res.hasSdk ? res : { hasSdk: false, ok: false };
  } catch (err) {
    return { hasSdk: false, ok: false, error: String(err?.message || err) };
  }
}

/**
 * Inyecta el JSON del proyecto en la interfaz visual de Story Studio (pestaña "2. Assets" o "3. Storyboard")
 * dentro del frame/OOPIF para que las tarjetas y sus imágenes generadas se vean en pantalla dentro de Story Studio.
 */
async function syncProjectJsonIntoStoryStudioUI(
  tabId,
  storyStudioJsonStr,
  triggerAutocreate = false,
  targetSection = 'ASSETS'
) {
  if (!storyStudioJsonStr) return { synced: false };
  try {
    const res = await evaluateAcrossAllFlowFramesAndOopifs(
      tabId,
      async (jsonStr, shouldAutocreate, sectionTarget) => {
        const sleepFrame = (ms) => new Promise((r) => setTimeout(r, ms));
        const isStoryStudioFrame =
          Boolean(document.getElementById('story-studio-modal-root')) ||
          (Array.from(document.querySelectorAll('button')).some((b) =>
            /1\.\s*Script/i.test(b.textContent || '')
          ) &&
            Array.from(document.querySelectorAll('button')).some((b) =>
              /2\.\s*Assets/i.test(b.textContent || '')
            )) ||
          Array.from(document.querySelectorAll('button')).some((b) =>
            /^get started$/i.test((b.textContent || '').trim())
          );

        if (!isStoryStudioFrame) return { synced: false };

        const getStartedBtn = Array.from(document.querySelectorAll('button')).find((b) =>
          /get started/i.test((b.textContent || '').trim())
        );
        if (getStartedBtn) {
          try {
            getStartedBtn.click();
            await sleepFrame(220);
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
          await sleepFrame(150);
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

        const targetTabRegex =
          sectionTarget === 'STORYBOARD' ? /3\.\s*Storyboard/i : /2\.\s*Assets/i;
        const tabBtn = Array.from(document.querySelectorAll('header button')).find((b) =>
          targetTabRegex.test((b.textContent || '').trim())
        );
        if (tabBtn) {
          tabBtn.click();
          await sleepFrame(400);
        }

        let triggeredSections = 0;
        if (shouldAutocreate) {
          if (sectionTarget === 'STORYBOARD') {
            const moreBtns = Array.from(document.querySelectorAll('main button')).filter((b) =>
              (b.textContent || '').includes('more_vert')
            );
            for (const mb of moreBtns) {
              mb.click();
              await sleepFrame(160);
              const autoBtn = Array.from(document.querySelectorAll('main button')).find((b) =>
                /autocreate images/i.test((b.textContent || '').trim())
              );
              if (autoBtn && !autoBtn.disabled) {
                autoBtn.click();
                triggeredSections++;
                await sleepFrame(220);
              }
            }
          } else {
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
        }

        return { synced: true, jsonInjected, triggeredSections };
      },
      [storyStudioJsonStr, triggerAutocreate, targetSection],
      (r) => Boolean(r && r.synced)
    );
    return res && res.synced ? res : { synced: false };
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
  const mediaType = String(payload.mediaType || '');
  const logoDataUrl = String(payload.logoDataUrl || '');
  const shouldAutoSubmit = payload.autoSubmit !== false;

  // 1. Activar la pestaña de Google Flow únicamente si focusTab === true
  if (payload.focusTab === true) {
    const tab = await chrome.tabs.update(tabId, { active: true }).catch(() => null);
    if (tab?.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    }
    await sleep(150);
  }

  // 2. Modo Sigiloso y Mínimo (idéntico a Gemini y Flow Music):
  //    - Sólo en el top-frame de Google Flow (`target: { tabId }`, NUNCA `allFrames: true` para no tocar iframes de reCAPTCHA Enterprise).
  //    - Sin adjuntar `chrome.debugger` ni tocar el menú desplegable de modelos.
  //    - Un único clic limpio (`genBtn.click()`) con pausa natural tras actualizar ProseMirror.
  const mainAttempts = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [rawPromptText, mediaType, logoDataUrl, shouldAutoSubmit],
    func: injectPromptIntoBottomEditor,
  });

  const mainAttempt = (mainAttempts || [])[0];
  if (!mainAttempt?.result?.injected) {
    throw new Error(
      mainAttempt?.result?.error || 'No se encontró la caja de prompt en la página principal de Google Flow.'
    );
  }

  return {
    success: true,
    submitted: shouldAutoSubmit && Boolean(mainAttempt.result.clickedGenBtnInMain),
    method: 'STEALTH_MAIN_DIRECT',
  };
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
          version: '2.6.3',
          windowId: senderWindowId,
          geminiTabs,
          flowTabs,
          sunoTabs: sunoTabs || [],
        });
      }
    );
    return true;
  }

  // Proxy seguro app pública (github.io / onrender) -> servidor local (evita el bloqueo Local Network Access del navegador)
  if (message.type === 'HUELLAS_LOCAL_API') {
    const apiPath = String(message.path || '');
    const method = String(message.method || 'GET').toUpperCase();
    const ALLOWED_LOCAL_API_PATHS = new Set(['/api/system/rename-doc-folder']);
    if (!ALLOWED_LOCAL_API_PATHS.has(apiPath) || (method !== 'GET' && method !== 'POST')) {
      sendResponse({ ok: false, status: 403, error: 'ruta local no permitida' });
      return false;
    }
    (async () => {
      let lastErr = '';
      for (const base of ['http://localhost:4200', 'http://127.0.0.1:4200']) {
        try {
          const res = await fetch(`${base}${apiPath}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: method === 'POST' ? JSON.stringify(message.body || {}) : undefined,
            cache: 'no-store',
          });
          const ct = res.headers.get('content-type') || '';
          const data = ct.includes('application/json') ? await res.json().catch(() => null) : null;
          sendResponse({ ok: res.ok, status: res.status, data });
          return;
        } catch (e) {
          lastErr = String(e?.message || e);
        }
      }
      sendResponse({ ok: false, status: 0, error: lastErr || 'servidor local http://localhost:4200 no disponible' });
    })();
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
      try {
      const { geminiTabs, flowTabs, sunoTabs } = await getConnectedAiTabsInWindow(senderWindowId);
      let serviceTabs =
        targetService === 'FLOW'
          ? flowTabs
          : targetService === 'SUNO'
          ? sunoTabs || []
          : geminiTabs;
      const defaultUrl =
        targetService === 'FLOW'
          ? 'https://flow.google.com/'
          : targetService === 'SUNO'
          ? 'https://www.flowmusic.app/'
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

      let preferredServiceTab = null;
      let preResolvedGeminiDispatch = null;
      if (targetService === 'GEMINI' && action === 'SEND_PROMPT') {
        preResolvedGeminiDispatch = await acquireGeminiTargetTabWithWindowPolicy(
          payload,
          senderWindowId
        );
        if (preResolvedGeminiDispatch && preResolvedGeminiDispatch.targetTab) {
          preferredServiceTab = preResolvedGeminiDispatch.targetTab;
          if (preResolvedGeminiDispatch.openedNewWindow) {
            broadcastToHuellasTabsInSameWindow(senderWindowId, {
              type: 'BRIDGE_STATUS',
              service: 'GEMINI',
              status: 'WORKING',
              message: isStandaloneCreateImageOrder(payload)
                ? '🪟 Abriendo ventana nueva en un chat limpio (sin vinculación de Notebook) para crear la imagen...'
                : '🪟 Abriendo ventana nueva directamente en el chat del documental porque las pestañas abiertas están en uso o no había ninguna...',
            });
          }
        }
      } else if (targetService === 'GEMINI') {
        serviceTabs = await filterOutExternalAskTabs(serviceTabs);
        // Prefer the Gemini tab already on the target chatId or on the Notebook "Huellas de la Humanidad"
        let nbPath = '';
        try {
          const st = await chrome.storage.local.get('huellasNotebookPath');
          nbPath = (st && st.huellasNotebookPath) || '';
        } catch {}
        const { targetChatId } = await resolveDesiredGeminiChatTarget(payload);
        const pathOf = (u) => {
          try {
            return new URL(u).pathname.replace(/^\/u\/\d+(?=\/)/, '').replace(/\/$/, '');
          } catch {
            return '';
          }
        };
        preferredServiceTab =
          (targetChatId &&
            serviceTabs.find((t) => extractGeminiAppChatId(t.url || '') === targetChatId)) ||
          serviceTabs.find((t) => t.id === payload.tabId) ||
          (nbPath &&
            serviceTabs.find(
              (t) => pathOf(t.url || '') === nbPath.replace(/^\/u\/\d+(?=\/)/, '').replace(/\/$/, '')
            )) ||
          serviceTabs.find((t) => /^\/notebook\//.test(pathOf(t.url || ''))) ||
          serviceTabs.find((t) => /^\/app\//.test(pathOf(t.url || ''))) ||
          serviceTabs.find((t) => /^\/app\/?$/.test(pathOf(t.url || ''))) ||
          null;
      }
      let targetTab =
        preferredServiceTab || serviceTabs.find((t) => t.id === payload.tabId) || serviceTabs[0] || null;

      const shouldFocusTargetTab =
        targetService === 'GEMINI' || targetService === 'FLOW' || targetService === 'SUNO'
          ? false
          : payload.focusTab === true;

      if (!targetTab) {
        if (action === 'RENAME_GEMINI_CHAT') {
          sendResponse({ ok: false, noTab: true });
          return;
        }
        broadcastToHuellasTabsInSameWindow(senderWindowId, {
          type: 'BRIDGE_STATUS',
          service: targetService,
          status: 'WORKING',
          message: `Abriendo pestaña de ${
            targetService === 'FLOW'
              ? 'Google Flow'
              : targetService === 'SUNO'
              ? 'Flow Music (flowmusic.app)'
              : 'Gemini Web'
          } en segundo plano...`,
        });
        const created = await chrome.tabs.create({
          windowId: senderWindowId,
          url: defaultUrl,
          active: shouldFocusTargetTab,
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
        if (shouldFocusTargetTab) {
          await chrome.tabs.update(targetTab.id, { active: true }).catch(() => {});
        }
        await ensureScriptInjected(targetTab.id, contentScriptFile);
        await sleep(100);

        if (targetService === 'FLOW' && action === 'STOP_FLOW_WATCHER') {
          stopFlowAutoPilotRequested = true;
        }

        if (
          targetService === 'FLOW' &&
          (action === 'SEND_PROMPT' || action === 'LOAD_STORY_STUDIO_PROJECT')
        ) {
          stopFlowAutoPilotRequested = false;
          try {
            // 1. Modo Directo en la Página Principal de Google Flow (igual que Gemini y Flow Music):
            //    Cuando action === 'SEND_PROMPT', no interceptar con Story Studio ni flow-sdk;
            //    ir directamente al compositor de la página principal de Google Flow (executeFlowPromptHardware).
            let sdkStatus = { hasSdk: false, isStoryStudio: false };
            if (action === 'LOAD_STORY_STUDIO_PROJECT') {
              sdkStatus = await checkFlowSdkAvailableInTab(targetTab.id);
            }

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

            // 1C. Etapa 8 (Imagen Inicial de un Clip individual "🚀 Flow Imagen") vía window.__HUELLAS_FLOW_SDK__
            if (sdkStatus.hasSdk && payload.mediaType === 'IMAGE' && !payload.referenceId) {
              const clipNum = Number(payload.clipNumber) || 1;
              const padded = String(clipNum).padStart(2, '0');
              const ratio = payload.aspectRatio === '9:16' ? '9:16' : '16:9';

              sendResponse({
                ok: true,
                tabId: targetTab.id,
                tabTitle: targetTab.title,
                method: 'DIRECT_FLOW_SDK_CLIP_IMAGE',
              });

              (async () => {
                broadcastToHuellasTabsInSameWindow(senderWindowId, {
                  type: 'BRIDGE_STATUS',
                  service: 'FLOW',
                  status: 'GENERATING',
                  message: `🍌 Flow SDK: Generando Imagen Inicial del Clip #${padded} (${ratio}) en Nano Banana 2...`,
                  clipNumber: clipNum,
                  clipId: payload.clipId,
                  mediaType: 'IMAGE',
                });

                const imgRes = await generateSingleImageViaFlowSdk(
                  targetTab.id,
                  payload.prompt || '',
                  ratio
                );

                if (imgRes && imgRes.ok && imgRes.imageDataUrl) {
                  broadcastToHuellasTabsInSameWindow(senderWindowId, {
                    type: 'FLOW_CLIP_IMAGE_CAPTURED',
                    clipNumber: clipNum,
                    clipId: payload.clipId,
                    mediaId: imgRes.mediaId,
                    imageUrl: imgRes.imageDataUrl,
                    imageDataUrl: imgRes.imageDataUrl,
                  });
                } else {
                  broadcastToHuellasTabsInSameWindow(senderWindowId, {
                    type: 'BRIDGE_STATUS',
                    service: 'FLOW',
                    status: 'ERROR',
                    message: `⚠️ Error generando Imagen Inicial del Clip #${padded}: ${
                      imgRes?.error || 'Desconocido'
                    }`,
                  });
                }
              })();
              return;
            }

            // 1D. Etapa 8 (Video de Clip individual / Lotes de 10):
            // Si el Tool propio "Huellas Master Bridge" dentro de Google Flow está abierto (`window.__HUELLAS_GENERATE_VIDEO__` o `Flow.generate.video`),
            // ejecutar primero vía SDK directo con 'Veo 3.1 - Lite [Lower Priority]' (x1, 0 créditos).
            // Si no devuelve MP4 nativo (o el Tool no está abierto), caer automáticamente a la barra inferior de Google Flow.
            if (payload.mediaType === 'VIDEO' && sdkStatus.hasSdk) {
              try {
                const ratio = payload.aspectRatio === '9:16' ? '9:16' : '16:9';
                const refAssets = Array.isArray(payload.referenceAssetsForClips)
                  ? payload.referenceAssetsForClips
                  : Array.isArray(payload.referenceItems)
                  ? payload.referenceItems
                  : [];

                if (Array.isArray(payload.batchClipsData) && payload.batchClipsData.length > 1) {
                  const bClips = payload.batchClipsData;
                  const firstClip = bClips[0];
                  const firstRes = await generateSingleClipViaFlowSdk(
                    targetTab.id,
                    firstClip,
                    ratio,
                    refAssets
                  );
                  if (firstRes && firstRes.isNativeVideo && firstRes.videoDataUrl) {
                    sendResponse({
                      ok: true,
                      tabId: targetTab.id,
                      tabTitle: targetTab.title,
                      method: 'FLOW_SDK_NATIVE_VIDEO_BATCH',
                      total: bClips.length,
                    });
                    broadcastToHuellasTabsInSameWindow(senderWindowId, {
                      type: 'FLOW_VIDEO_CAPTURED',
                      videoUrl: firstRes.videoDataUrl,
                      videoDataUrl: firstRes.videoDataUrl,
                      frames: Array.isArray(firstRes.frames) ? firstRes.frames : [],
                      clipNumber: Number(firstClip.clipNumber) || 1,
                      clipId: firstClip.id,
                      aspectRatio: ratio,
                      timestamp: Date.now(),
                    });
                    (async () => {
                      for (let i = 1; i < bClips.length; i++) {
                        if (stopFlowAutoPilotRequested) break;
                        const cItem = bClips[i];
                        const cNum = Number(cItem.clipNumber) || i + 1;
                        broadcastToHuellasTabsInSameWindow(senderWindowId, {
                          type: 'BRIDGE_STATUS',
                          service: 'FLOW',
                          status: 'GENERATING',
                          message: `🎬 Tool Huellas Flow (${i + 1}/${bClips.length}): Generando Clip #${cNum} con Veo 3.1 - Lite [Lower Priority] (0 créditos)...`,
                          mediaType: 'VIDEO',
                          clipNumber: cNum,
                          clipId: cItem.id,
                        });
                        const cRes = await generateSingleClipViaFlowSdk(
                          targetTab.id,
                          cItem,
                          ratio,
                          refAssets
                        );
                        if (cRes && cRes.isNativeVideo && cRes.videoDataUrl) {
                          broadcastToHuellasTabsInSameWindow(senderWindowId, {
                            type: 'FLOW_VIDEO_CAPTURED',
                            videoUrl: cRes.videoDataUrl,
                            videoDataUrl: cRes.videoDataUrl,
                            frames: Array.isArray(cRes.frames) ? cRes.frames : [],
                            clipNumber: cNum,
                            clipId: cItem.id,
                            aspectRatio: ratio,
                            timestamp: Date.now(),
                          });
                        }
                      }
                    })();
                    return;
                  }
                } else {
                  const clipNum = Number(payload.clipNumber) || 1;
                  const clipPromptText = String(
                    payload.prompt || payload.videoPrompt || payload.imagePrompt || ''
                  ).slice(0, 3950);
                  broadcastToHuellasTabsInSameWindow(senderWindowId, {
                    type: 'BRIDGE_STATUS',
                    service: 'FLOW',
                    status: 'GENERATING',
                    message: `🎬 Generando Video Clip #${clipNum} en el Tool Huellas Flow (Veo 3.1 - Lite [Lower Priority] • x1 • 0 créditos)...`,
                    mediaType: 'VIDEO',
                    clipNumber: clipNum,
                    clipId: payload.clipId,
                  });
                  const clipRes = await generateSingleClipViaFlowSdk(
                    targetTab.id,
                    {
                      id: payload.clipId,
                      clipNumber: clipNum,
                      prompt: clipPromptText,
                      videoPrompt: clipPromptText,
                      imagePrompt: payload.imagePrompt || clipPromptText,
                      title: `Clip #${clipNum}`,
                    },
                    ratio,
                    refAssets
                  );
                  if (clipRes && clipRes.isNativeVideo && clipRes.videoDataUrl) {
                    broadcastToHuellasTabsInSameWindow(senderWindowId, {
                      type: 'FLOW_VIDEO_CAPTURED',
                      videoUrl: clipRes.videoDataUrl,
                      videoDataUrl: clipRes.videoDataUrl,
                      frames: Array.isArray(clipRes.frames) ? clipRes.frames : [],
                      clipNumber: clipNum,
                      clipId: payload.clipId,
                      aspectRatio: ratio,
                      timestamp: Date.now(),
                    });
                    broadcastToHuellasTabsInSameWindow(senderWindowId, {
                      type: 'BRIDGE_STATUS',
                      service: 'FLOW',
                      status: 'READY',
                      message: `✅ Video Clip #${clipNum} generado con Veo 3.1 - Lite [Lower Priority] (0 créditos) y enviado a Huellas Master.`,
                      mediaType: 'VIDEO',
                      clipNumber: clipNum,
                      clipId: payload.clipId,
                    });
                    sendResponse({
                      ok: true,
                      tabId: targetTab.id,
                      tabTitle: targetTab.title,
                      method: 'FLOW_SDK_NATIVE_VIDEO',
                      clipNumber: clipNum,
                    });
                    return;
                  }
                }
              } catch (sdkVidErr) {
                console.warn('[Huellas Flow SDK Video] Fallback to bottom bar:', sdkVidErr);
              }
            }

            // 1E. Si Story Studio está abierto (sólo para proyectos de imágenes / referencias, NUNCA para VIDEO), inyectar JSON y pulsar Autocreate images
            if (
              sdkStatus.isStoryStudio &&
              payload.storyStudioProjectJson &&
              payload.mediaType !== 'VIDEO'
            ) {
              const targetSection =
                payload.mediaType === 'IMAGE' && !payload.referenceId ? 'STORYBOARD' : 'ASSETS';
              const ssRes = await syncProjectJsonIntoStoryStudioUI(
                targetTab.id,
                payload.storyStudioProjectJson,
                true,
                targetSection
              );
              if (ssRes && ssRes.synced) {
                broadcastToHuellasTabsInSameWindow(senderWindowId, {
                  type: 'BRIDGE_STATUS',
                  service: 'FLOW',
                  status: 'GENERATING',
                  message: `🎬 Proyecto cargado en Story Studio (Google Flow • ${targetSection}) y ejecutando Autocreate images...`,
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
                  if (stopFlowAutoPilotRequested) break;
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

            // 2B. Si Story Studio no está abierto y se envió un Lote de 10 (batchClipsData) en la barra inferior de Google Flow, enviarlos 1 por 1 (< 3,950 chars cada uno)
            if (
              payload.mediaType === 'VIDEO' &&
              Array.isArray(payload.batchClipsData) &&
              payload.batchClipsData.length > 1
            ) {
              const bClips = payload.batchClipsData;
              sendResponse({
                ok: true,
                tabId: targetTab.id,
                tabTitle: targetTab.title,
                method: 'SEQUENTIAL_BATCH_CLIPS_QUEUE',
                total: bClips.length,
              });

              (async () => {
                for (let i = 0; i < bClips.length; i++) {
                  if (stopFlowAutoPilotRequested) break;
                  const cItem = bClips[i];
                  const singleClipPrompt = String(cItem.videoPrompt || cItem.imagePrompt || '').slice(
                    0,
                    3950
                  );
                  const padded = String(cItem.clipNumber || i + 1).padStart(2, '0');
                  broadcastToHuellasTabsInSameWindow(senderWindowId, {
                    type: 'BRIDGE_STATUS',
                    service: 'FLOW',
                    status: 'GENERATING',
                    message: `🎬 Cola Lote Flow (${i + 1}/${bClips.length}): Enviando y sometiendo Clip #${padded} (< 3,950 chars)...`,
                    clipNumber: cItem.clipNumber,
                    clipId: cItem.id,
                    mediaType: 'VIDEO',
                  });
                  try {
                    await executeFlowPromptHardware(targetTab.id, singleClipPrompt, {
                      ...payload,
                      clipNumber: cItem.clipNumber,
                      clipId: cItem.id,
                      mediaType: 'VIDEO',
                    });
                    chrome.tabs
                      .sendMessage(targetTab.id, {
                        target: 'FLOW',
                        ...payload,
                        clipNumber: cItem.clipNumber,
                        clipId: cItem.id,
                        action: 'START_FLOW_WATCHER_AFTER_SUBMIT',
                      })
                      .catch(() => {});
                  } catch (bErr) {
                    console.warn('[Huellas Batch Queue] Error en Clip:', cItem.clipNumber, bErr);
                  }
                  if (i < bClips.length - 1) {
                    await sleep(9000);
                  }
                }
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

        let finalDispatchPayload =
          preResolvedGeminiDispatch && preResolvedGeminiDispatch.finalPayload
            ? preResolvedGeminiDispatch.finalPayload
            : payload;
        if (targetService === 'GEMINI') {
          if (action === 'SEND_PROMPT' && !preResolvedGeminiDispatch?.skipPrePosition) {
            finalDispatchPayload = await prePositionGeminiTabForOrder(targetTab, finalDispatchPayload);
          }
          await ensureScriptInjected(targetTab.id, 'gemini-content.js');
        }

        let deliveredToTab = false;
        for (let sendTry = 0; sendTry < 4 && !deliveredToTab; sendTry++) {
          if (sendTry > 0) {
            await sleep(300);
            await ensureScriptInjected(targetTab.id, contentScriptFile);
            await sleep(120);
          }
          try {
            await chrome.tabs.sendMessage(targetTab.id, {
              target: targetService,
              ...finalDispatchPayload,
            });
            deliveredToTab = true;
          } catch {}
        }

        // MAIN-world network hook + React Fiber scanner + prompt submitter for Flow Music (flowmusic.app)
        if (targetService === 'SUNO' && action === 'SEND_PROMPT') {
          const sunoTabId = targetTab.id;
          const sunoPromptArg = String(payload.prompt || '');
          const autoSubmitArg = payload.autoSubmit !== false;
          chrome.scripting
            .executeScript({
              target: { tabId: sunoTabId },
              world: 'MAIN',
              args: [sunoPromptArg, autoSubmitArg],
              func: (expectedPrompt, shouldSubmit) => {
                try {
                  // 1. Install network & React Fiber audio URL collector in MAIN world
                  if (!window.__HUELLAS_FLOWMUSIC_NET_HOOK__) {
                    window.__HUELLAS_FLOWMUSIC_NET_HOOK__ = true;
                    window.__HUELLAS_FLOWMUSIC_URLS__ = new Set();

                    const publishUrls = () => {
                      try {
                        document.documentElement.setAttribute(
                          'data-huellas-flowmusic-urls',
                          JSON.stringify(Array.from(window.__HUELLAS_FLOWMUSIC_URLS__))
                        );
                      } catch {}
                    };

                    const extractClipUrlsFromText = (txt) => {
                      if (!txt || typeof txt !== 'string') return;
                      const rx =
                        /https:\/\/storage\.googleapis\.com\/producer-app-public\/clips\/[a-zA-Z0-9_-]+\.(?:m4a|mp3|wav)/g;
                      let m;
                      let added = false;
                      while ((m = rx.exec(txt)) !== null) {
                        if (!window.__HUELLAS_FLOWMUSIC_URLS__.has(m[0])) {
                          window.__HUELLAS_FLOWMUSIC_URLS__.add(m[0]);
                          added = true;
                        }
                      }
                      if (added) publishUrls();
                    };

                    const origFetch = window.fetch;
                    window.fetch = async function (...args) {
                      const res = await origFetch.apply(this, args);
                      try {
                        const clone = res.clone();
                        clone
                          .text()
                          .then((t) => extractClipUrlsFromText(t))
                          .catch(() => {});
                      } catch {}
                      return res;
                    };

                    // Intercept HTMLMediaElement.src & .play() in MAIN world to capture URLs and block automatic playback
                    try {
                      const mediaProto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
                      if (mediaProto) {
                        const srcDesc = Object.getOwnPropertyDescriptor(mediaProto, 'src');
                        if (srcDesc && typeof srcDesc.set === 'function') {
                          Object.defineProperty(mediaProto, 'src', {
                            configurable: true,
                            enumerable: true,
                            get: srcDesc.get,
                            set(val) {
                              try {
                                if (typeof val === 'string') extractClipUrlsFromText(val);
                              } catch {}
                              return srcDesc.set.call(this, val);
                            },
                          });
                        }

                        const origPlay = mediaProto.play;
                        if (typeof origPlay === 'function') {
                          mediaProto.play = function (...playArgs) {
                            try {
                              const currentUrl = this.currentSrc || this.src || '';
                              if (currentUrl) extractClipUrlsFromText(currentUrl);
                              const isSynthetic =
                                document.documentElement.getAttribute('data-huellas-synthetic-click') ===
                                '1';
                              const lastManual = Number(
                                document.documentElement.getAttribute('data-huellas-last-manual-play') ||
                                  '0'
                              );
                              const isManualPlay =
                                !isSynthetic && Date.now() - lastManual < 1800;
                              if (!isManualPlay) {
                                this.muted = true;
                                this.volume = 0;
                                try {
                                  this.pause();
                                } catch {}
                                return Promise.resolve();
                              }
                              this.muted = false;
                              if (this.volume === 0) this.volume = 1;
                            } catch {}
                            return origPlay.apply(this, playArgs);
                          };
                        }
                      }
                    } catch {}

                    // Periodic React Fiber & DOM attribute scan in MAIN world
                    setInterval(() => {
                      try {
                        const els = document.querySelectorAll('main *, audio, source');
                        for (const el of els) {
                          if (el.src && el.src.includes('producer-app-public/clips/')) {
                            extractClipUrlsFromText(el.src);
                          }
                          for (const k of Object.keys(el)) {
                            if (k.startsWith('__reactProps$') || k.startsWith('__reactFiber$')) {
                              try {
                                const s = JSON.stringify(el[k], (key, val) => {
                                  if (key.startsWith('_') || val instanceof Node || val instanceof Window)
                                    return undefined;
                                  return val;
                                });
                                if (s && s.includes('producer-app-public/clips/')) {
                                  extractClipUrlsFromText(s);
                                }
                              } catch {}
                            }
                          }
                        }
                      } catch {}
                    }, 2200);
                  }

                  // 2. Ensure prompt is injected into Flow Music React textarea and submitted
                  setTimeout(() => {
                    try {
                      const inputEl =
                        document.querySelector('textarea[aria-label="Chat message"]') ||
                        document.querySelector('textarea[placeholder*="Describe your song" i]') ||
                        document.querySelector('textarea');
                      if (!inputEl || !expectedPrompt) return;

                      const currentVal = (inputEl.value || '').trim();
                      if (currentVal.length < Math.min(12, expectedPrompt.length)) {
                        inputEl.focus();
                        const proto = window.HTMLTextAreaElement.prototype;
                        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                        const tracker = inputEl._valueTracker;
                        if (tracker) tracker.setValue('');
                        if (setter) setter.call(inputEl, expectedPrompt);
                        else inputEl.value = expectedPrompt;
                        inputEl.dispatchEvent(
                          new InputEvent('input', {
                            bubbles: true,
                            cancelable: true,
                            inputType: 'insertText',
                            data: expectedPrompt,
                          })
                        );
                        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                      }

                      if (shouldSubmit) {
                        setTimeout(() => {
                          const rem = (inputEl.value || '').trim();
                          if (rem.length < 3) return;
                          const sendBtn =
                            document.querySelector('button[aria-label="Send message"]:not([disabled])') ||
                            document.querySelector('button[aria-label*="Send" i]:not([disabled])');
                          if (sendBtn) {
                            sendBtn.click();
                          } else {
                            inputEl.dispatchEvent(
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
                        }, 250);
                      }
                    } catch {}
                  }, 300);
                } catch {}
              },
            })
            .catch(() => {});
        }

        sendResponse({ ok: true, tabId: targetTab.id, tabTitle: targetTab.title });
      } else {
        sendResponse({
          ok: false,
          error: 'No se encontró la pestaña en esta ventana.',
        });
      }
      } catch (cmdErr) {
        console.error('[Huellas HUELLAS_COMMAND] Error:', cmdErr);
        broadcastToHuellasTabsInSameWindow(senderWindowId, {
          type: 'BRIDGE_STATUS',
          service: targetService,
          status: 'ERROR',
          message: `⚠️ Error en puente de extensión (${targetService}): ${String(
            cmdErr?.message || cmdErr
          )}`,
        });
        sendResponse({ ok: false, error: String(cmdErr?.message || cmdErr) });
      }
    })();

    return true;
  }

  if (message.type === 'GEMINI_MAIN_WORLD_INJECT_AND_SUBMIT' && sender?.tab?.id) {
    const geminiTabId = sender.tab.id;
    const geminiPromptArg = String(message.prompt || '');
    const shouldAutoSubmit = message.autoSubmit !== false;
    const stageNumForInject = Number(message.stageNumber) || 0;
    const preserveNewlinesForStage =
      stageNumForInject === 4 ||
      stageNumForInject === 5 ||
      stageNumForInject === 6 ||
      stageNumForInject === 8 ||
      stageNumForInject === 80 ||
      stageNumForInject === 101 ||
      stageNumForInject === 505;
    chrome.scripting
      .executeScript({
        target: { tabId: geminiTabId },
        world: 'MAIN',
        args: [geminiPromptArg, shouldAutoSubmit, preserveNewlinesForStage],
        func: (expectedPrompt, autoSubmit, keepNewlines) => {
          try {
            const cleanExpected = keepNewlines
              ? (expectedPrompt || '')
                  .replace(/\r\n/g, '\n')
                  .split('\n')
                  .map((l) => l.trimEnd())
                  .join('\n')
                  .trim()
              : (expectedPrompt || '')
                  .replace(/\r\n/g, '\n')
                  .split('\n')
                  .map((l) => l.trim())
                  .filter(Boolean)
                  .join('   |   ')
                  .trim();
            if (!cleanExpected) return;

            const findSendBtn = () => {
              const sendSelectors = [
                'button.send-button:not([disabled]):not([aria-disabled="true"])',
                '.send-button-container button:not([disabled]):not([aria-disabled="true"])',
                'button[data-test-id*="send" i]:not([disabled]):not([aria-disabled="true"])',
                'button[aria-label*="Send message" i]:not([disabled]):not([aria-disabled="true"])',
                'button[aria-label*="Enviar mensaje" i]:not([disabled]):not([aria-disabled="true"])',
                'button[aria-label*="Send" i]:not([disabled]):not([aria-disabled="true"])',
                'button[aria-label*="Enviar" i]:not([disabled]):not([aria-disabled="true"])',
              ];
              for (const sel of sendSelectors) {
                const btn = document.querySelector(sel);
                if (btn && btn.offsetParent !== null) return btn;
              }
              return null;
            };

            const inputEl = document.querySelector(
              'rich-textarea div.ql-editor[contenteditable="true"], div.ql-editor[contenteditable="true"], div[contenteditable="true"][role="textbox"], textarea'
            );
            if (!inputEl) return;

            const minExpectedLen = Math.max(10, Math.floor(cleanExpected.length * 0.8));
            const currentText = (
              inputEl.value ??
              inputEl.innerText ??
              inputEl.textContent ??
              ''
            ).trim();
            const existingSendBtn = findSendBtn();

            // Even if text is visually present, if the Send button is STILL disabled, re-inject via MAIN-world Quill/Clipboard/execCommand to wake Angular FormControl!
            if (!currentText || currentText.length < minExpectedLen || !existingSendBtn) {
              inputEl.focus();

              // 1. If Quill instance is attached on element or rich-textarea, update via Quill API
              const richHost = inputEl.closest('rich-textarea');
              const quillInst = inputEl.__quill || (richHost && richHost.__quill);
              if (quillInst && typeof quillInst.setText === 'function') {
                try {
                  quillInst.setText(cleanExpected, 'user');
                } catch {}
              }

              // 2. Dispatch MAIN-world ClipboardEvent('paste')
              try {
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(inputEl);
                selection.removeAllRanges();
                selection.addRange(range);

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

              // 3. If still not enabled, try execCommand('insertText') in MAIN world
              if (!findSendBtn()) {
                try {
                  const selection = window.getSelection();
                  const range = document.createRange();
                  range.selectNodeContents(inputEl);
                  selection.removeAllRanges();
                  selection.addRange(range);
                  document.execCommand('insertText', false, cleanExpected);
                } catch {}
              }

              // 4. Ensure text is in existing <p> (never innerHTML = '') and fire InputEvent in MAIN world
              const afterInsert = (
                inputEl.value ??
                inputEl.innerText ??
                inputEl.textContent ??
                ''
              ).trim();
              if (!afterInsert || afterInsert.length < minExpectedLen) {
                let p = inputEl.querySelector('p');
                if (!p) {
                  p = document.createElement('p');
                  inputEl.appendChild(p);
                }
                p.textContent = cleanExpected;
              }
              inputEl.classList.remove('ql-blank');
              for (const t of [inputEl, richHost].filter(Boolean)) {
                t.dispatchEvent(
                  new InputEvent('beforeinput', {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    inputType: 'insertText',
                    data: cleanExpected,
                  })
                );
                t.dispatchEvent(
                  new InputEvent('input', {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    inputType: 'insertText',
                    data: cleanExpected,
                  })
                );
                t.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }

            if (autoSubmit) {
              let attemptsLeft = 12;
              const tryClickSend = () => {
                const remaining = (
                  inputEl?.value ??
                  inputEl?.innerText ??
                  inputEl?.textContent ??
                  ''
                ).trim();
                if (!remaining || remaining.length < 3) return;
                const btn = findSendBtn();
                if (btn) {
                  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                  btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                  btn.click();
                  return;
                }
                attemptsLeft -= 1;
                if (attemptsLeft > 0) {
                  setTimeout(tryClickSend, 220);
                } else {
                  inputEl.focus();
                  inputEl.dispatchEvent(
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
              };
              setTimeout(tryClickSend, 180);
            }
          } catch {}
        },
      })
      .then(async () => {
        if (!shouldAutoSubmit || stageNumForInject === 505) return;
        await sleep(900);
        const snapCheck = await inspectGeminiTabLatestResponse(geminiTabId);
        if (
          snapCheck &&
          snapCheck.userQueries === 0 &&
          snapCheck.count === 0 &&
          !snapCheck.generating
        ) {
          await forceSubmitPromptInGeminiTab(geminiTabId, geminiPromptArg);
        }
      })
      .catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'GEMINI_MAIN_WORLD_COMPLETE_RENAME' && sender?.tab?.id) {
    const geminiTabId = sender.tab.id;
    const newTitleArg = String(message.newTitle || '').trim();
    chrome.scripting
      .executeScript({
        target: { tabId: geminiTabId },
        world: 'MAIN',
        args: [newTitleArg],
        func: (targetNewTitle) => {
          try {
            if (!targetNewTitle) return;
            const activeEl = document.activeElement;
            const isActiveRenameField =
              activeEl &&
              (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') &&
              !activeEl.closest('rich-textarea');

            const candidates = Array.from(
              document.querySelectorAll(
                'input[data-test-id="rename-input"], .mat-mdc-dialog-container input, mat-dialog-container input, [role="dialog"] input, .conversation-items-container input, bard-sidenav input, .conversation-title-container input, input[aria-label*="name" i], input[aria-label*="nombre" i], input[aria-label*="title" i], input[aria-label*="título" i], input[type="text"]:not([readonly])'
              )
            ).filter((el) => el && el.offsetParent !== null && !el.closest('rich-textarea'));

            const renameInput = isActiveRenameField ? activeEl : candidates[0];
            if (!renameInput) return;

            renameInput.focus();
            if (typeof renameInput.select === 'function') {
              try {
                renameInput.select();
              } catch {}
            }
            try {
              document.execCommand('selectAll', false);
              document.execCommand('insertText', false, targetNewTitle);
            } catch {}

            const currentVal = (renameInput.value || '').trim();
            if (currentVal !== targetNewTitle) {
              const nativeSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value'
              )?.set;
              if (nativeSetter) {
                nativeSetter.call(renameInput, targetNewTitle);
              } else {
                renameInput.value = targetNewTitle;
              }
            }

            renameInput.dispatchEvent(
              new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                composed: true,
                inputType: 'insertText',
                data: targetNewTitle,
              })
            );
            renameInput.dispatchEvent(
              new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                composed: true,
                inputType: 'insertText',
                data: targetNewTitle,
              })
            );
            renameInput.dispatchEvent(new Event('change', { bubbles: true }));
            renameInput.dispatchEvent(
              new KeyboardEvent('keyup', {
                key: targetNewTitle.slice(-1) || 'a',
                bubbles: true,
              })
            );

            setTimeout(() => {
              try {
                const dialogBtns = Array.from(
                  document.querySelectorAll(
                    'button[data-test-id="confirm-button"], button[data-test-id="save-button"], .mat-mdc-dialog-actions button, mat-dialog-actions button, .mat-mdc-dialog-container button, mat-dialog-container button, [role="dialog"] button'
                  )
                ).filter((b) => b && b.offsetParent !== null);

                const confirmBtn =
                  dialogBtns.find((b) => {
                    const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
                    const testId = (b.getAttribute('data-test-id') || '').toLowerCase();
                    if (/cancel|cancelar|close|cerrar/i.test(txt)) return false;
                    return (
                      testId.includes('confirm') ||
                      testId.includes('save') ||
                      /\b(rename|cambiar|renombrar|guardar|save|aceptar|ok|confirm)\b/i.test(txt)
                    );
                  }) ||
                  dialogBtns.find((b) => {
                    const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
                    return txt && !/cancel|cancelar|close|cerrar/i.test(txt);
                  });

                if (confirmBtn) {
                  confirmBtn.disabled = false;
                  confirmBtn.removeAttribute('disabled');
                  confirmBtn.setAttribute('aria-disabled', 'false');
                  confirmBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                  confirmBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                  confirmBtn.click();
                } else {
                  renameInput.dispatchEvent(
                    new KeyboardEvent('keydown', {
                      key: 'Enter',
                      code: 'Enter',
                      keyCode: 13,
                      which: 13,
                      bubbles: true,
                      cancelable: true,
                    })
                  );
                  renameInput.dispatchEvent(
                    new KeyboardEvent('keyup', {
                      key: 'Enter',
                      code: 'Enter',
                      keyCode: 13,
                      which: 13,
                      bubbles: true,
                      cancelable: true,
                    })
                  );
                  renameInput.blur();
                }
              } catch {}
            }, 220);
          } catch {}
        },
      })
      .catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  // ==========================================================================
  // GEMINI HARDWARE + MAIN-WORLD ANGULAR (__ngContext__ / NgZone) AUTOMATION
  // (Técnica combinada: ABA Matrix NgZone/__ngContext__ + CDP Input.dispatchMouseEvent)
  // ==========================================================================
  if (message.type === 'GEMINI_HARDWARE_OPEN_NOTEBOOK_NEW_CHAT' && sender?.tab?.id) {
    const geminiTabId = sender.tab.id;
    const notebookNameArg = String(message.notebookName || 'Huellas de la Humanidad').trim();
    (async () => {
      const target = { tabId: geminiTabId };
      let debuggerAttached = false; // not needed: clicks happen once inside the page (no CDP infobar)
      try {
        // Step 1: Ensure sidebar is open and locate the Notebook/Gem "Huellas de la Humanidad" in MAIN world
        const runNotebookStep = async (phase) => {
          const res = await chrome.scripting
            .executeScript({
              target: { tabId: geminiTabId },
              world: 'MAIN',
              args: [notebookNameArg, phase],
              func: (nbName, stepPhase) => {
                const norm = (s) =>
                  String(s || '')
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, ' ')
                    .trim();

                const findNgZone = () => {
                  const els = document.querySelectorAll('*');
                  for (let i = 0; i < Math.min(els.length, 600); i++) {
                    const c = els[i].__ngContext__;
                    if (!c) continue;
                    const arr = Array.isArray(c) ? c : [c];
                    for (const v of arr) {
                      if (v && v._zone && typeof v._zone.run === 'function') return v._zone;
                      if (v && v.ngZone && typeof v.ngZone.run === 'function') return v.ngZone;
                    }
                  }
                  return null;
                };

                const triggerInZone = (el) => {
                  if (!el) return null;
                  const zone = findNgZone();
                  const r = el.getBoundingClientRect();
                  const cx = Math.round(r.left + r.width / 2);
                  const cy = Math.round(r.top + r.height / 2);
                  const fire = () => {
                    try {
                      el.click();
                    } catch {}
                  };
                  if (zone) zone.run(fire);
                  else fire();
                  return { x: cx, y: cy, text: (el.innerText || el.textContent || '').trim() };
                };

                // Record base Gem/Notebook URL if currently inside /gem/<gemId>
                const gemUrlMatch = window.location.href.match(
                  /^(https:\/\/gemini\.google\.com(?:\/u\/\d+)?\/gem\/[a-zA-Z0-9_-]+)/i
                );
                if (gemUrlMatch && gemUrlMatch[1]) {
                  try {
                    localStorage.setItem('huellas_gemini_notebook_url', gemUrlMatch[1]);
                  } catch {}
                }

                // Also scan any <a href*="/gem/"> matching "Huellas de la Humanidad"
                const allLinks = Array.from(document.querySelectorAll('a[href*="/gem/"]'));
                for (const a of allLinks) {
                  const t = norm(a.innerText || a.textContent || a.getAttribute('aria-label') || '');
                  if (t.includes('huellas de la humanidad')) {
                    const href = a.href || a.getAttribute('href') || '';
                    const m = href.match(/^(?:https:\/\/gemini\.google\.com)?((?:\/u\/\d+)?\/gem\/[a-zA-Z0-9_-]+)$/i);
                    if (m) {
                      try {
                        localStorage.setItem(
                          'huellas_gemini_notebook_url',
                          `https://gemini.google.com${m[1]}`
                        );
                      } catch {}
                    }
                  }
                }

                if (stepPhase === 'OPEN_SIDEBAR') {
                  const sideCandidates = document.querySelectorAll(
                    '[data-test-id="conversation"], .conversation-items-container, bard-sidenav a[href*="/gem/"], bot-list-item'
                  );
                  const visible = Array.from(sideCandidates).some((el) => {
                    const r = el.getBoundingClientRect();
                    return r.width > 10 && r.height > 10 && r.right > 20;
                  });
                  if (!visible) {
                    const menuBtn = document.querySelector(
                      'button[data-test-id="side-nav-menu-button"], button[aria-label*="Main menu" i], button[aria-label*="Menú principal" i], button[aria-label*="Expand menu" i]'
                    );
                    if (menuBtn && menuBtn.offsetParent !== null) {
                      return { action: 'CLICKED_MENU', target: triggerInZone(menuBtn) };
                    }
                  }
                  return { action: 'SIDEBAR_ALREADY_OPEN' };
                }

                if (stepPhase === 'EXPAND_GEMS') {
                  // If Gems list in sidebar has a "More" / "Mostrar más" button, expand it
                  const moreGemBtns = Array.from(
                    document.querySelectorAll(
                      'bard-sidenav button, mat-sidenav button, [role="navigation"] button'
                    )
                  ).filter((b) => {
                    if (!b || b.offsetParent === null) return false;
                    const t = norm(b.innerText || b.textContent || b.getAttribute('aria-label') || '');
                    return /^(more|mas|mostrar mas|ver mas|show more)$/i.test(t);
                  });
                  if (moreGemBtns.length > 0) {
                    return { action: 'EXPANDED_GEMS', target: triggerInZone(moreGemBtns[0]) };
                  }
                  return { action: 'NO_EXPAND_NEEDED' };
                }

                // stepPhase === 'CLICK_NOTEBOOK':
                // Find the Notebook/Gem item "Huellas de la Humanidad" (NEVER an existing conversation item!)
                const normTarget = norm(nbName);
                const candidates = Array.from(
                  document.querySelectorAll(
                    'bot-list-item a, bot-list-item button, bot-list-item, a[href*="/gem/"], [data-test-id*="bot"], [data-test-id*="gem"], bard-sidenav a, bard-sidenav button, bard-sidenav [role="listitem"], bard-sidenav [role="button"], .bot-title, a, button'
                  )
                ).filter((el) => {
                  if (!el || el.offsetParent === null) return false;
                  // Strictly exclude conversation history rows so we NEVER click an existing chat!
                  if (
                    el.closest(
                      '[data-test-id="conversation"], .conversation-items-container, .conversations-container, .chat-history-list'
                    )
                  ) {
                    return false;
                  }
                  const href = el.getAttribute('href') || el.querySelector?.('a')?.getAttribute('href') || '';
                  // Exclude links to a specific existing chat (/app/<id> or /gem/<gemId>/<chatId>)
                  if (/\/app\/[a-zA-Z0-9_-]{6,}/i.test(href)) return false;
                  if (/\/gem\/[^/]+\/[a-zA-Z0-9_-]{6,}/i.test(href)) return false;
                  const txt = norm(el.innerText || el.textContent || el.getAttribute('aria-label') || '');
                  return (
                    txt === normTarget ||
                    (txt.includes('huellas de la humanidad') && txt.length <= 55)
                  );
                });

                // Prefer the most specific clickable element (<a> or <button> or smallest bounding box)
                candidates.sort((a, b) => {
                  const aIsLinkOrBtn = a.tagName === 'A' || a.tagName === 'BUTTON' ? 0 : 1;
                  const bIsLinkOrBtn = b.tagName === 'A' || b.tagName === 'BUTTON' ? 0 : 1;
                  if (aIsLinkOrBtn !== bIsLinkOrBtn) return aIsLinkOrBtn - bIsLinkOrBtn;
                  return (a.innerText || '').length - (b.innerText || '').length;
                });

                if (candidates.length > 0) {
                  const chosen = candidates[0];
                  const href =
                    chosen.getAttribute('href') ||
                    chosen.closest('a')?.getAttribute('href') ||
                    chosen.querySelector?.('a')?.getAttribute('href') ||
                    '';
                  if (href && href.includes('/gem/')) {
                    const fullUrl = href.startsWith('http')
                      ? href
                      : `https://gemini.google.com${href.startsWith('/') ? '' : '/'}${href}`;
                    try {
                      localStorage.setItem('huellas_gemini_notebook_url', fullUrl);
                    } catch {}
                  }
                  return {
                    action: 'CLICKED_NOTEBOOK',
                    target: triggerInZone(chosen),
                    savedNotebookUrl: localStorage.getItem('huellas_gemini_notebook_url') || '',
                  };
                }

                // No direct navigation here (window.location.href would reload the page and kill the in-flight order).
                // The content script asks background to navigate with chrome.tabs.update + resume instead.
                return { action: 'NOTEBOOK_NOT_FOUND' };
              },
            })
            .catch(() => []);
          return (res && res[0] && res[0].result) || null;
        };

        // triggerInZone() already clicks inside the page: NO extra hardware click (a 2nd click toggles the sidebar closed)
        await runNotebookStep('OPEN_SIDEBAR');
        await sleep(450);

        let s3 = await runNotebookStep('CLICK_NOTEBOOK');
        if (!s3 || s3.action === 'NOTEBOOK_NOT_FOUND') {
          await runNotebookStep('EXPAND_GEMS');
          await sleep(450);
          s3 = await runNotebookStep('CLICK_NOTEBOOK');
        }

        let gemRootUrl = '';
        if (s3 && s3.action === 'CLICKED_NOTEBOOK') {
          for (let i = 0; i < 20; i++) {
            await sleep(250);
            const t = await chrome.tabs.get(geminiTabId).catch(() => null);
            const m = t && String(t.url || '').match(/^(https:\/\/gemini\.google\.com(?:\/u\/\d+)?\/gem\/[a-zA-Z0-9_-]+)/);
            if (m) {
              gemRootUrl = m[1];
              break;
            }
          }
          if (gemRootUrl) {
            await chrome.storage.local.set({ huellasNotebookUrl: gemRootUrl }).catch(() => {});
          }
        }

        sendResponse({ ok: Boolean(gemRootUrl), gemRootUrl, result: s3 });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      } finally {
        if (debuggerAttached) {
          await chrome.debugger.detach(target).catch(() => {});
        }
      }
    })();
    return true;
  }

  // Navigate the Gemini tab by URL (full load) and RESUME the same order after the page loads.
  // The order is persisted in chrome.storage.session so it survives the reload and service-worker restarts.
  if (message.type === 'GEMINI_NAVIGATE_AND_RESUME' && sender?.tab?.id) {
    const navTabId = sender.tab.id;
    const navUrl = String(message.url || '');
    (async () => {
      try {
        if (
          !/^https:\/\/gemini\.google\.com\/(?:u\/\d+\/)?(?:notebook\/[a-zA-Z0-9_-]+|app\/[a-zA-Z0-9_-]{6,}|gem\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)?)$/.test(
            navUrl
          )
        ) {
          sendResponse({ ok: false, error: 'URL fuera del Notebook' });
          return;
        }
        await chrome.storage.session.set({
          [huellasGeminiResumeKey(navTabId)]: { order: message.order, createdAt: Date.now(), url: navUrl },
        });
        sendResponse({ ok: true });
        await chrome.tabs.update(navTabId, { url: navUrl });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  // One trusted (CDP) click on Deep Research's "Start research" button, measured AFTER attaching the debugger
  if (message.type === 'GEMINI_HARDWARE_CLICK_START_RESEARCH' && sender?.tab?.id) {
    const srTabId = sender.tab.id;
    (async () => {
      const target = { tabId: srTabId };
      let attached = false;
      try {
        try {
          await chrome.debugger.attach(target, '1.3');
          attached = true;
        } catch {}
        if (!attached) {
          sendResponse({ clicked: false, error: 'debugger no disponible' });
          return;
        }
        await sleep(450); // debugger infobar resizes the viewport
        const res = await chrome.scripting
          .executeScript({
            target: { tabId: srTabId },
            func: () => {
              const re =
                /\b((?:iniciar|empezar|comenzar)\s+(?:la\s+|a\s+)?investiga(?:ci[oó]n|r)|start\s+(?:the\s+)?research|begin\s+research)\b/i;
              const usable = (b) => {
                if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
                if (b.closest('bard-sidenav, side-navigation, .cdk-overlay-container')) return false;
                const r = b.getBoundingClientRect();
                return r.width > 4 && r.height > 4;
              };
              const matches = (b) =>
                re.test((b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim()) ||
                re.test(b.getAttribute('aria-label') || '');
              const responses = document.querySelectorAll('model-response, [data-message-author-role="model"]');
              const last = responses.length ? responses[responses.length - 1] : null;
              const widgets = document.querySelectorAll('deep-research-confirmation-widget');
              const lastWidget = widgets.length ? widgets[widgets.length - 1] : null;
              let btns = lastWidget ? Array.from(lastWidget.querySelectorAll('button, [role="button"]')).filter((b) => usable(b) && matches(b)) : [];
              if (!btns.length && last) {
                btns = Array.from(last.querySelectorAll('button, [role="button"]')).filter((b) => usable(b) && matches(b));
              }
              if (!btns.length) {
                btns = Array.from(document.querySelectorAll('button, [role="button"]')).filter((b) => usable(b) && matches(b));
              }
              const btn = btns.length ? btns[btns.length - 1] : null;
              if (!btn) return { found: false };
              btn.scrollIntoView({ block: 'center' });
              const r = btn.getBoundingClientRect();
              return { found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            },
          })
          .catch(() => []);
        const loc = res && res[0] && res[0].result;
        if (!loc || !loc.found) {
          sendResponse({ clicked: false, error: 'botón no encontrado' });
          return;
        }
        await dispatchHardwareClick(target, loc.x, loc.y).catch(() => {});
        await sleep(300);
        sendResponse({ clicked: true });
      } catch (err) {
        sendResponse({ clicked: false, error: String(err?.message || err) });
      } finally {
        if (attached) await chrome.debugger.detach(target).catch(() => {});
      }
    })();
    return true;
  }

  // Rename the CURRENT Gemini chat via its header menu (selectors verified live), only if it is
  // /app/<chatId> AND the notebook nbPath is the active one (aria-current) -> never a chat outside the notebook.
  if (message.type === 'GEMINI_HARDWARE_RENAME_CURRENT_CHAT' && sender?.tab?.id) {
    const rnTabId = sender.tab.id;
    const newTitle = String(message.title || '').trim();
    const wantChatId = String(message.chatId || '');
    const wantNb = String(message.nbPath || '');
    (async () => {
      const target = { tabId: rnTabId };
      let attached = false;
      let prevActiveTabId = null;
      const locate = async (step, clickInDom = false) => {
        const res = await chrome.scripting
          .executeScript({
            target: { tabId: rnTabId },
            world: 'MAIN',
            args: [step, wantChatId, wantNb, newTitle, Boolean(message.proven), Boolean(clickInDom)],
            func: (op, chatId, nbPath, title, proven, doClick) => {
              const vis = (el) => {
                if (!el) return false;
                const r = el.getBoundingClientRect();
                return r.width > 2 && r.height > 2;
              };
              const act = (el) => {
                const r = el.getBoundingClientRect();
                if (doClick) {
                  try {
                    el.click();
                  } catch {}
                }
                return { found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
              };
              const path = location.pathname.replace(/\/$/, '');
              const curChat = (path.match(/\/app\/([a-zA-Z0-9_-]{6,})$/) || [])[1] || '';
              const activeNb = document.querySelector('a[href*="/notebook/"][aria-current="page"]');
              const activeNbHref = activeNb ? activeNb.getAttribute('href') || '' : '';
              const activeNbUuid = (activeNbHref.match(/\/notebook\/([a-zA-Z0-9_-]+)/) || [])[1] || '';
              const wantNbUuid = (String(nbPath || '').match(/\/notebook\/([a-zA-Z0-9_-]+)/) || [])[1] || '';
              const inside =
                curChat === chatId &&
                Boolean(wantNbUuid) &&
                (proven || !activeNbUuid || activeNbUuid === wantNbUuid);
              if (!inside) return { found: false, notInside: true, curChat, activeNbUuid, wantNbUuid };
              if (op === 'CLOSE_IMMERSIVE_IF_COVERING') {
                const hdrBtn = Array.from(
                  document.querySelectorAll(
                    'button[aria-label*="conversation actions" i], button[aria-label*="acciones de la conversación" i], [data-test-id="conversation-actions-button"], button[data-test-id="conversation-title"]'
                  )
                ).find(vis);
                if (hdrBtn) return { found: false, headerVisible: true };
                const closeImm = Array.from(
                  document.querySelectorAll(
                    'deep-research-immersive-panel button[aria-label*="close" i], deep-research-immersive-panel button[aria-label*="cerrar" i], [data-test-id="close-button"], button[aria-label="Close"]'
                  )
                ).find(vis);
                return closeImm ? act(closeImm) : { found: false, headerVisible: false };
              }
              if (op === 'TRIGGER') {
                const candidates = Array.from(
                  document.querySelectorAll(
                    'button[aria-label*="conversation actions" i], button[aria-label*="acciones de la conversación" i], button[aria-label*="acciones de conversación" i], button[aria-label*="opciones de conversación" i], [data-test-id="conversation-actions-button"], button[data-test-id="conversation-title"]'
                  )
                ).filter(
                  (el) =>
                    vis(el) &&
                    !el.closest('deep-research-immersive-panel, bard-sidenav, side-navigation, [role="navigation"]')
                );
                const b =
                  candidates[0] ||
                  Array.from(
                    document.querySelectorAll(
                      'button[aria-label*="conversation actions" i], button[aria-label*="acciones de la conversación" i], [data-test-id="conversation-actions-button"], button[data-test-id="conversation-title"]'
                    )
                  ).find(vis);
                return b ? act(b) : { found: false };
              }
              if (op === 'RENAME_ITEM') {
                const it = Array.from(
                  document.querySelectorAll('[data-test-id="rename-button"], [role="menuitem"]')
                ).find(
                  (el) =>
                    vis(el) &&
                    ((el.getAttribute('data-test-id') || '') === 'rename-button' ||
                      /^(rename|cambiar(?:\s+el)?\s+nombre|renombrar)$/i.test((el.innerText || '').trim()))
                );
                return it ? act(it) : { found: false };
              }
              if (op === 'INPUT') {
                const inp = Array.from(
                  document.querySelectorAll(
                    'input[aria-label="Rename this chat"], [data-test-id="edit-title-input"] input, input[aria-label*="rename" i], input[aria-label*="cambiar nombre" i], [role="dialog"] input, mat-dialog-container input'
                  )
                ).find(vis);
                if (!inp) return { found: false };
                inp.focus();
                try {
                  inp.select();
                  document.execCommand('selectAll', false, null);
                  document.execCommand('insertText', false, title);
                } catch {}
                try {
                  if (inp.value !== title) {
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                    if (setter) setter.call(inp, title);
                    else inp.value = title;
                  }
                  inp.dispatchEvent(
                    new InputEvent('input', {
                      bubbles: true,
                      cancelable: true,
                      composed: true,
                      data: title,
                      inputType: 'insertText',
                    })
                  );
                  inp.dispatchEvent(new Event('change', { bubbles: true }));
                } catch {}
                const r = inp.getBoundingClientRect();
                return {
                  found: true,
                  val: inp.value,
                  x: Math.round(r.left + r.width / 2),
                  y: Math.round(r.top + r.height / 2),
                };
              }
              if (op === 'CONFIRM') {
                const dlg =
                  document
                    .querySelector('[data-test-id="edit-title-input"], input[aria-label="Rename this chat"]')
                    ?.closest('[role="dialog"], mat-dialog-container, .mat-mdc-dialog-container') || document;
                const btn = Array.from(dlg.querySelectorAll('button')).find(
                  (b) =>
                    vis(b) &&
                    !b.disabled &&
                    b.getAttribute('aria-disabled') !== 'true' &&
                    /^(rename|cambiar(?:\s+el)?\s+nombre|renombrar|guardar|save)$/i.test((b.innerText || '').trim())
                );
                return btn ? act(btn) : { found: false };
              }
              if (op === 'VERIFY') {
                const dlgInp = Array.from(
                  document.querySelectorAll(
                    'input[aria-label="Rename this chat"], [data-test-id="edit-title-input"] input, [role="dialog"] input, mat-dialog-container input'
                  )
                ).find(vis);
                if (dlgInp) {
                  return { found: true, done: false, dialogStillOpen: true };
                }
                const domTitleEl = Array.from(
                  document.querySelectorAll(
                    '[data-test-id="conversation-title"], button[data-test-id="conversation-actions-button"], .conversation-title'
                  )
                ).find((el) => vis(el) && !el.closest('deep-research-immersive-panel'));
                const domTitle = domTitleEl
                  ? (domTitleEl.innerText || domTitleEl.textContent || '').replace(/\s+/g, ' ').trim()
                  : '';
                const docT = (document.title || '').replace(/\s*-\s*Google Gemini\s*$/i, '').trim();
                const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
                const targetNorm = norm(title);
                const domMatches = Boolean(domTitle) && norm(domTitle) === targetNorm;
                const docMatches = Boolean(docT) && norm(docT) === targetNorm;
                return {
                  found: true,
                  // Only the real Gemini title counts (document.title can be changed locally without saving)
                  done: domMatches,
                  domTitle,
                  docTitle: docT,
                };
              }
              return { found: false };
            },
          })
          .catch(() => []);
        return (res && res[0] && res[0].result) || { found: false };
      };
      const waitLocate = async (step, tries = 10, clickInDom = false) => {
        let r = null;
        for (let i = 0; i < tries; i++) {
          r = await locate(step, clickInDom);
          if (r.found || r.notInside) return r;
          await sleep(150);
        }
        return r || { found: false };
      };
      try {
        if (!newTitle || !wantChatId || !wantNb) {
          sendResponse({ ok: false, error: 'parámetros incompletos' });
          return;
        }
        await locate('CLOSE_IMMERSIVE_IF_COVERING', true);
        await sleep(250);
        const pre = await locate('VERIFY');
        if (pre.notInside) {
          sendResponse({ ok: false, error: 'el chat no está dentro del Notebook' });
          return;
        }
        if (pre.done) {
          sendResponse({ ok: true, already: true });
          return;
        }

        let verified = false;
        // Primary path: Hardware CDP click (isTrusted: true) so Angular Material dialog & Google batchexecute RPC always fire
        try {
          const t = await chrome.tabs.get(rnTabId);
          if (t && !t.active) {
            const act = await chrome.tabs.query({ windowId: t.windowId, active: true });
            if (act && act[0]) prevActiveTabId = act[0].id;
            await chrome.tabs.update(rnTabId, { active: true });
            await sleep(250);
          }
        } catch {}
        try {
          await chrome.debugger.attach(target, '1.3');
          attached = true;
          await sleep(400);
        } catch {
          try {
            await chrome.debugger.sendCommand(target, 'Runtime.evaluate', { expression: '1' });
            attached = true;
          } catch {}
        }

        if (attached) {
          const trig = await waitLocate('TRIGGER', 10, false);
          if (trig.found) {
            await dispatchHardwareClick(target, trig.x, trig.y);
            await sleep(250);
            const item = await waitLocate('RENAME_ITEM', 10, false);
            if (item.found) {
              await dispatchHardwareClick(target, item.x, item.y);
              await sleep(300);
              const inp = await waitLocate('INPUT', 10, false);
              if (inp.found) {
                await sleep(280);
                const confirm = await waitLocate('CONFIRM', 10, false);
                if (confirm.found) {
                  await dispatchHardwareClick(target, confirm.x, confirm.y);
                  for (let i = 0; i < 14 && !verified; i++) {
                    await sleep(250);
                    const v = await locate('VERIFY');
                    verified = Boolean(v.done);
                  }
                }
              }
            }
          }
        }

        // Fallback: MAIN-world click pass if CDP was unavailable or did not verify
        if (!verified) {
          const mTrig = await waitLocate('TRIGGER', 8, true);
          if (mTrig.found) {
            await sleep(250);
            const mItem = await waitLocate('RENAME_ITEM', 8, true);
            if (mItem.found) {
              await sleep(300);
              const mInp = await waitLocate('INPUT', 8, false);
              if (mInp.found) {
                await sleep(250);
                const mConf = await waitLocate('CONFIRM', 8, true);
                if (mConf.found) {
                  for (let i = 0; i < 12 && !verified; i++) {
                    await sleep(250);
                    const v = await locate('VERIFY');
                    verified = Boolean(v.done);
                  }
                }
              }
            }
          }
        }

        if (verified) {
          // Crucial: let Google's batchexecute RPC persist the title on the backend before any SPA navigation
          await sleep(1800);
        }
        sendResponse({ ok: verified, error: verified ? '' : 'el título no cambió' });
      } catch (err) {
        if (attached) {
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
        }
        sendResponse({ ok: false, error: String(err?.message || err) });
      } finally {
        if (attached) await chrome.debugger.detach(target).catch(() => {});
        if (prevActiveTabId) await chrome.tabs.update(prevActiveTabId, { active: true }).catch(() => {});
      }
    })();
    return true;
  }

  if (message.type === 'GEMINI_HARDWARE_CONFIGURE_MODEL_AND_TOOLS' && sender?.tab?.id) {
    const geminiTabId = sender.tab.id;
    const wantHigh =
      String(message.thinkingLevel || '').toUpperCase() === 'HIGH' ||
      (Boolean(message.enableHighModel) &&
        !Boolean(message.enableCarbonLow) &&
        !Boolean(message.enableArgonLow));
    const enableDeepResearch = Boolean(message.enableDeepResearch);
    const enableCreateImage = Boolean(message.enableCreateImage);
    const aspectRatio = String(message.aspectRatio || '').trim();
    const targetLevel = wantHigh ? 'HIGH' : 'LOW';

    (async () => {
      const target = { tabId: geminiTabId };
      let debuggerAttached = false;
      let prevActiveTabId = null;
      let switchedTabTemporarily = false;

      try {
        // Keep external debate queries (and standard model selection without DeepResearch/Image submenus) 100% silent in background (active: false)
        const isExternalAskTab =
          activeExternalAskTabId === geminiTabId ||
          Array.from(activeExternalAskMap.values()).some((v) => v && v.tabId === geminiTabId);
        await chrome.tabs.update(geminiTabId, { autoDiscardable: false }).catch(() => {});
        if (!isExternalAskTab && (enableDeepResearch || enableCreateImage)) {
          try {
            const gemTab = await chrome.tabs.get(geminiTabId);
            if (gemTab && !gemTab.active && gemTab.windowId) {
              const activeTabs = await chrome.tabs.query({ windowId: gemTab.windowId, active: true });
              if (activeTabs && activeTabs[0] && activeTabs[0].id !== geminiTabId) {
                prevActiveTabId = activeTabs[0].id;
              }
              await chrome.tabs.update(geminiTabId, { active: true }).catch(() => {});
              switchedTabTemporarily = true;
              await sleep(220);
            }
          } catch {}
        }

        try {
          await Promise.race([
            chrome.debugger.attach(target, '1.3'),
            sleep(600).then(() => {
              throw new Error('attach_timeout');
            }),
          ]);
          debuggerAttached = true;
        } catch {
          // Possibly already attached by this extension: probe if commands still work
          try {
            const probeOk = await cdpSendWithTimeout(target, 'Runtime.evaluate', { expression: '1' }, 350);
            if (probeOk) debuggerAttached = true;
          } catch {}
        }
        if (debuggerAttached) {
          await cdpSendWithTimeout(
            target,
            'Emulation.setFocusEmulationEnabled',
            { enabled: true },
            400
          ).catch(() => {});
        }
        // Check if the window is unfocused/occluded on macOS (CDP Input.dispatchMouseEvent stalls on occluded NSWindows)
        let cdpInputOccluded = false;
        try {
          const gemTabNow = await chrome.tabs.get(geminiTabId).catch(() => null);
          if (!gemTabNow || !gemTabNow.active) {
            cdpInputOccluded = true;
          } else if (typeof gemTabNow.windowId === 'number') {
            const gemWinNow = await chrome.windows.get(gemTabNow.windowId).catch(() => null);
            if (!gemWinNow || !gemWinNow.focused) {
              cdpInputOccluded = true;
            }
          }
        } catch {}
        // The "is debugging this browser" infobar resizes the viewport: wait before measuring coordinates
        await sleep(debuggerAttached ? 300 : 120);

        const diag = [];

        // Synthetic fallback (used when chrome.debugger is unavailable or window is occluded): ONE event sequence at a point
        const syntheticAt = async (x, y, withClick) => {
          await chrome.scripting
            .executeScript({
              target: { tabId: geminiTabId },
              world: 'MAIN',
              args: [x, y, Boolean(withClick)],
              func: (px, py, doClick) => {
                const el = document.elementFromPoint(px, py);
                if (!el) return false;
                const opts = { bubbles: true, cancelable: true, clientX: px, clientY: py, view: window };
                try {
                  el.dispatchEvent(new PointerEvent('pointerover', opts));
                  el.dispatchEvent(new PointerEvent('pointerenter', opts));
                  el.dispatchEvent(new MouseEvent('mouseover', opts));
                  el.dispatchEvent(new MouseEvent('mouseenter', opts));
                  el.dispatchEvent(new PointerEvent('pointermove', opts));
                  el.dispatchEvent(new MouseEvent('mousemove', opts));
                  if (doClick) {
                    el.dispatchEvent(new PointerEvent('pointerdown', opts));
                    el.dispatchEvent(new MouseEvent('mousedown', opts));
                    el.dispatchEvent(new PointerEvent('pointerup', opts));
                    el.dispatchEvent(new MouseEvent('mouseup', opts));
                    el.click();
                  }
                } catch {}
                return true;
              },
            })
            .catch(() => {});
        };

        const hardwareHoverOnly = async (x, y) => {
          if (!x || !y) return;
          if (!debuggerAttached || cdpInputOccluded) {
            await syntheticAt(x, y, false);
            await sleep(60);
            return;
          }
          const ok1 = await cdpSendWithTimeout(target, 'Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: Math.max(2, x - 6),
            y,
            button: 'none',
          });
          if (!ok1) {
            cdpInputOccluded = true;
            await syntheticAt(x, y, false);
            await sleep(60);
            return;
          }
          await sleep(35);
          await cdpSendWithTimeout(target, 'Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x,
            y,
            button: 'none',
          });
          await sleep(60);
        };

        // EXACTLY ONE click per target (never synthetic + hardware on the same element, which toggles menus closed)
        const hardwareHoverAndClick = async (x, y) => {
          if (!x || !y) return;
          if (!debuggerAttached || cdpInputOccluded) {
            await syntheticAt(x, y, true);
            return;
          }
          await hardwareHoverOnly(x, y);
          if (cdpInputOccluded) {
            await syntheticAt(x, y, true);
            return;
          }
          const clickedOk = await dispatchHardwareClick(target, x, y).catch(() => false);
          if (!clickedOk) {
            cdpInputOccluded = true;
            await syntheticAt(x, y, true);
          }
        };

        // Helper that executes a DOM/Angular inspection & action step inside MAIN world
        const runMainStep = async (stepName, stepArg = '') => {
          const res = await chrome.scripting
            .executeScript({
              target: { tabId: geminiTabId },
              world: 'MAIN',
              args: [stepName, stepArg],
              func: (op, argVal) => {
                // PURE LOCATOR: returns center coordinates only. All clicks/hovers are done ONCE by the caller
                // (CDP hardware events), so menus are never toggled open+closed by a double click.
                const triggerAngularElement = (el) => {
                  if (!el) return null;
                  try {
                    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                  } catch {}
                  const r = el.getBoundingClientRect();
                  return {
                    found: true,
                    x: Math.round(r.left + r.width / 2),
                    y: Math.round(r.top + r.height / 2),
                    text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
                  };
                };

                const isItemChecked = (el) => {
                  if (!el) return false;
                  if (el.getAttribute('aria-checked') === 'true') return true;
                  if (el.getAttribute('aria-selected') === 'true') return true;
                  if (el.getAttribute('aria-current') === 'true') return true;
                  const cls = String(el.className || '');
                  if (/\b(is-selected|selected|checked|active|mat-mdc-menu-item-highlighted-selected)\b/.test(cls))
                    return true;
                  const icons = Array.from(el.querySelectorAll('mat-icon, .material-symbols-outlined, .google-symbols'));
                  if (
                    icons.some((ic) => {
                      const n = (
                        ic.getAttribute('fonticon') ||
                        ic.getAttribute('data-mat-icon-name') ||
                        ic.textContent ||
                        ''
                      )
                        .trim()
                        .toLowerCase();
                      if (!/^(check|done|check_circle|radio_button_checked)$/.test(n)) return false;
                      const cs = getComputedStyle(ic);
                      return cs.visibility !== 'hidden' && cs.opacity !== '0' && cs.display !== 'none';
                    })
                  )
                    return true;
                  return /^\s*[✓✔]/.test(el.innerText || '');
                };

                const getComposerRoot = () => {
                  const input = document.querySelector(
                    'rich-textarea, div.ql-editor[contenteditable="true"], div[contenteditable="true"][role="textbox"]'
                  );
                  if (!input) return null;
                  let node = input;
                  for (let i = 0; i < 9 && node.parentElement; i++) {
                    node = node.parentElement;
                    const tag = node.tagName.toLowerCase();
                    if (tag === 'input-area-v2' || tag === 'input-container' || tag === 'fieldset') return node;
                    if (/input-area|input-container|text-input-field/i.test(String(node.className || '')) && i >= 2)
                      return node;
                  }
                  return node;
                };

                const DR_RE = /\b(deep\s*research|investigaci[oó]n\s+profunda)\b/i;

                const findActiveDeepResearchChip = () => {
                  const root = getComposerRoot() || document;
                  const nodes = Array.from(
                    root.querySelectorAll('button, [role="button"], mat-chip, mat-chip-option, [class*="chip"]')
                  ).filter(
                    (el) =>
                      el.offsetParent !== null &&
                      !el.closest('.cdk-overlay-container') &&
                      !el.closest('bard-sidenav, side-navigation, conversations-list, model-response, message-content, user-query')
                  );
                  // STRICT: only an explicit "deselect/remove Deep research" control or a pressed/checked toggle counts.
                  // (The start screen shows a SUGGESTION button "Deep Research" with an icon; that one is NOT active.)
                  for (const el of nodes) {
                    const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                    const a = (el.getAttribute('aria-label') || el.getAttribute('mattooltip') || '').trim();
                    if (DR_RE.test(a) && /\b(deselect|remove|quitar|desactivar|deseleccionar|cancel)\b/i.test(a)) return el;
                    const named = /^(?:deep\s*research|investigaci[oó]n\s+profunda)$/i.test(t) || DR_RE.test(a);
                    if (!named) continue;
                    if (el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-checked') === 'true')
                      return el;
                    const holder = el.closest('mat-chip, mat-chip-option, [class*="chip"]') || el.parentElement || el;
                    const closeCtl = holder.querySelector(
                      '[aria-label*="deselect" i], [aria-label*="remove" i], [aria-label*="quitar" i], [aria-label*="deseleccionar" i], mat-icon[fonticon="close"], mat-icon[data-mat-icon-name="close"]'
                    );
                    if (closeCtl && closeCtl !== el) return holder;
                  }
                  return null;
                };

                const findDeepResearchSuggestionButton = () => {
                  const root = getComposerRoot()?.parentElement || document;
                  const nodes = Array.from(root.querySelectorAll('button, [role="button"], mat-chip, mat-chip-option')).filter(
                    (el) =>
                      el.offsetParent !== null &&
                      !el.closest('.cdk-overlay-container') &&
                      !el.closest('bard-sidenav, side-navigation, conversations-list, model-response, message-content, user-query')
                  );
                  return (
                    nodes.find((el) =>
                      /^(?:deep\s*research|investigaci[oó]n\s+profunda)$/i.test(
                        (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
                      )
                    ) || null
                  );
                };

                const dumpComposerState = () => {
                  const ed = document.querySelector('rich-textarea .ql-editor, div.ql-editor[contenteditable="true"]');
                  const root = getComposerRoot()?.parentElement || document;
                  const ctl = Array.from(root.querySelectorAll('button, [role="button"], mat-chip, [class*="chip"]'))
                    .filter((el) => el.offsetParent !== null && !el.closest('.cdk-overlay-container, bard-sidenav, model-response, user-query'))
                    .map((el) => {
                      const t = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 24);
                      const a = (el.getAttribute('aria-label') || '').slice(0, 40);
                      return t || a ? `${t}${a ? `{${a}}` : ''}` : '';
                    })
                    .filter(Boolean)
                    .slice(0, 14);
                  return `placeholder="${(ed && (ed.getAttribute('data-placeholder') || '')) || ''}" controles=[${ctl.join(' | ')}]`;
                };

                const isResearchPlaceholder = () => {
                  const ed = document.querySelector('rich-textarea .ql-editor, div.ql-editor[contenteditable="true"]');
                  const ph = (ed && (ed.getAttribute('data-placeholder') || ed.getAttribute('aria-label'))) || '';
                  return /research|investig/i.test(ph);
                };

                // Gemini renders menus in BOTH .cdk-overlay-container (e.g. "Upload & tools") and the top-layer
                // .cdk-overlay-popover (e.g. mode picker / Thinking level) with <gem-menu-item> rows (verified live).
                const OVERLAY_ROOT_SEL = '.cdk-overlay-container, .cdk-overlay-popover';
                const getOverlayMenuItems = () => {
                  const out = [];
                  document.querySelectorAll(OVERLAY_ROOT_SEL).forEach((root) => {
                    root
                      .querySelectorAll(
                        '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="listitem"], .mat-mdc-menu-item, gem-menu-item, mat-list-item, mat-list-option, li, button'
                      )
                      .forEach((el) => {
                        if (out.includes(el)) return;
                        const r = el.getBoundingClientRect();
                        if (r.width > 10 && r.height > 10) out.push(el);
                      });
                  });
                  return out;
                };

                // Generic text search inside overlays: smallest visible element whose text matches, lifted to its clickable row
                const findOverlayItemByText = (re) => {
                  const fromItems = getOverlayMenuItems().filter((el) =>
                    re.test((el.innerText || el.textContent || '').replace(/\s+/g, ' '))
                  );
                  const pool = fromItems.length
                    ? fromItems
                    : Array.from(document.querySelectorAll('.cdk-overlay-container *, .cdk-overlay-popover *')).filter((el) => {
                        const rr = el.getBoundingClientRect();
                        if (rr.width < 3 || rr.height < 3) return false;
                        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
                        return t.length > 0 && t.length < 60 && re.test(t);
                      });
                  if (!pool.length) return null;
                  pool.sort((a, b) => {
                    const ra = a.getBoundingClientRect();
                    const rb = b.getBoundingClientRect();
                    return ra.width * ra.height - rb.width * rb.height;
                  });
                  const best = pool[0];
                  return (
                    best.closest(
                      'gem-menu-item, [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], .mat-mdc-menu-item, mat-list-item, li, button'
                    ) || best
                  );
                };

                if (op === 'CLOSE_MENUS') {
                  document
                    .querySelectorAll(
                      '[data-test-id="bard-mode-menu-button"][aria-expanded="true"], button.input-area-switch[aria-expanded="true"], [gemmenutrigger][aria-expanded="true"]'
                    )
                    .forEach((btn) => {
                      try {
                        btn.click();
                      } catch {}
                    });
                  const backdrops = Array.from(
                    document.querySelectorAll('.cdk-overlay-backdrop.cdk-overlay-backdrop-showing')
                  );
                  backdrops.forEach((b) => {
                    try {
                      b.click();
                    } catch {}
                  });
                  // CDK OverlayKeyboardDispatcher listens on document.body (never call hidePopover() directly, as that desynchronizes gemMenuTrigger)
                  const escTarget = document.activeElement || document.body;
                  try {
                    escTarget.dispatchEvent(
                      new KeyboardEvent('keydown', {
                        key: 'Escape',
                        code: 'Escape',
                        keyCode: 27,
                        which: 27,
                        bubbles: true,
                        cancelable: true,
                      })
                    );
                  } catch {}
                  return { closed: true, openMenus: document.querySelectorAll('.cdk-overlay-container .mat-mdc-menu-panel').length };
                }

                if (op === 'COUNT_OPEN_MENUS') {
                  return {
                    count: Array.from(
                      document.querySelectorAll(
                        '.cdk-overlay-container .mat-mdc-menu-panel, .cdk-overlay-container [role="menu"], .cdk-overlay-popover [role="menu"], .cdk-overlay-popover gem-menu'
                      )
                    ).filter((el) => {
                      const r = el.getBoundingClientRect();
                      return r.width > 2 && r.height > 2;
                    }).length,
                  };
                }

                const findComposerModePickerButton = () => {
                  const inputEl = document.querySelector(
                    'rich-textarea div.ql-editor, div[contenteditable="true"][role="textbox"], rich-textarea'
                  );
                  const inputRect = inputEl ? inputEl.getBoundingClientRect() : null;
                  const composerRoot =
                    (inputEl &&
                      inputEl.closest(
                        'input-area-v2, .input-area-container, .input-area, .text-input-field, form'
                      )) ||
                    document;
                  const prioritySelectors = [
                    '[data-test-id="bard-mode-menu-button"]',
                    'button.input-area-switch',
                    'button[aria-label*="mode picker" i]',
                    'button[aria-label*="selector de modo" i]',
                    'button[aria-label*="currently " i]',
                    'button[aria-label*="actualmente " i]',
                  ];
                  for (const scope of [composerRoot, document]) {
                    for (const sel of prioritySelectors) {
                      const candidates = Array.from(scope.querySelectorAll(sel)).filter((el) => {
                        if (!el || el.offsetParent === null) return false;
                        if (el.closest('.cdk-overlay-container, .cdk-overlay-popover, bard-sidenav, side-navigation')) {
                          return false;
                        }
                        const r = el.getBoundingClientRect();
                        return r.width > 8 && r.height > 8;
                      });
                      if (candidates.length > 0) return candidates[0];
                    }
                  }
                  const allBtns = Array.from(document.querySelectorAll('button, [role="button"]')).filter((el) => {
                    if (!el || el.offsetParent === null) return false;
                    if (el.closest('.cdk-overlay-container, .cdk-overlay-popover, bard-sidenav, side-navigation')) {
                      return false;
                    }
                    const r = el.getBoundingClientRect();
                    return r.width > 8 && r.height > 8;
                  });
                  if (inputRect) {
                    const nearComposer = allBtns.filter((el) => {
                      const r = el.getBoundingClientRect();
                      return (
                        r.bottom >= inputRect.top - 70 &&
                        r.top <= inputRect.bottom + 95 &&
                        r.left >= inputRect.left + 40
                      );
                    });
                    const nearMatch = nearComposer.find((el) => {
                      const t = `${el.getAttribute('aria-label') || ''} ${el.innerText || el.textContent || ''}`
                        .replace(/\s+/g, ' ')
                        .trim();
                      return /\b(carbon|argon|flash|pro|high|low|medium|mode|modo|thinking)\b/i.test(t);
                    });
                    if (nearMatch) return nearMatch;
                  }
                  const pillMatch = allBtns.find((el) => {
                    if (el.closest('bard-mode-switcher, header')) return false;
                    const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                    return /^(?:4\s*)?(?:carbon|argon)(?:\s*(?:high|medium|low))?$|^3\.\d+\s*(?:pro|flash(?:-lite)?)$/i.test(t);
                  });
                  if (pillMatch) return pillMatch;
                  const fallbackHeader = document.querySelector('bard-mode-switcher button');
                  return fallbackHeader && fallbackHeader.offsetParent !== null ? fallbackHeader : null;
                };

                if (op === 'READ_MODE_LABEL') {
                  const sw = findComposerModePickerButton();
                  if (!sw) return { label: '' };
                  const aria = (sw.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
                  const inner = (sw.innerText || sw.textContent || '').replace(/\s+/g, ' ').trim();
                  return { label: [aria, inner].filter(Boolean).join(' · ') };
                }

                if (op === 'CHECK_DEEP_RESEARCH_CHIP') {
                  const chip = findActiveDeepResearchChip();
                  const placeholderSaysResearch = isResearchPlaceholder();
                  if (!chip) return { active: placeholderSaysResearch, viaPlaceholder: placeholderSaysResearch };
                  const removeBtn =
                    chip.querySelector(
                      'button, [aria-label*="remove" i], [aria-label*="close" i], [aria-label*="quitar" i], [aria-label*="deselect" i], [matChipRemove]'
                    ) || chip;
                  const r = removeBtn.getBoundingClientRect();
                  return {
                    active: true,
                    text: (chip.innerText || '').trim().slice(0, 40),
                    x: Math.round(r.left + r.width / 2),
                    y: Math.round(r.top + r.height / 2),
                  };
                }

                if (op === 'CHECK_CREATE_IMAGE_CHIP') {
                  const root = getComposerRoot() || document;
                  const nodes = Array.from(
                    root.querySelectorAll('button, [role="button"], mat-chip, mat-chip-option, [class*="chip"]')
                  ).filter(
                    (el) =>
                      el.offsetParent !== null &&
                      !el.closest('.cdk-overlay-container, .cdk-overlay-popover') &&
                      !el.closest('bard-sidenav, side-navigation, conversations-list, model-response, message-content, user-query')
                  );
                  let chip = null;
                  for (const el of nodes) {
                    const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                    const a = (el.getAttribute('aria-label') || el.getAttribute('mattooltip') || '').trim();
                    if (
                      /\b(deselect|remove|quitar|desactivar|deseleccionar|cancel)\b/i.test(a) &&
                      /\b(create\s*images?|images?|crear\s*im[aá]gen(?:es)?|im[aá]gen(?:es)?)\b/i.test(a)
                    ) {
                      chip = el;
                      break;
                    }
                    const named = /^(?:create\s*images?|images|crear\s*im[aá]gen(?:es)?|im[aá]genes)$/i.test(t);
                    if (!named) continue;
                    if (
                      el.getAttribute('aria-pressed') === 'true' ||
                      el.getAttribute('aria-checked') === 'true' ||
                      /\bmat-tonal-button\b/i.test(String(el.className || ''))
                    ) {
                      chip = el;
                      break;
                    }
                    const holder = el.closest('mat-chip, mat-chip-option, [class*="chip"]') || el.parentElement || el;
                    const closeCtl = holder.querySelector(
                      '[aria-label*="deselect" i], [aria-label*="remove" i], [aria-label*="quitar" i], [aria-label*="deseleccionar" i], mat-icon[fonticon="close"], mat-icon[data-mat-icon-name="close"]'
                    );
                    if (closeCtl && closeCtl !== el) {
                      chip = holder;
                      break;
                    }
                  }
                  const ed = document.querySelector('rich-textarea .ql-editor, div.ql-editor[contenteditable="true"]');
                  const ph = (ed && (ed.getAttribute('data-placeholder') || ed.getAttribute('aria-label'))) || '';
                  const placeholderSaysImage = /describe\s+your\s+image|describe\s+tu\s+imagen/i.test(ph);
                  if (!chip) return { active: placeholderSaysImage, viaPlaceholder: placeholderSaysImage };
                  const removeBtn =
                    chip.querySelector(
                      'button, [aria-label*="deselect" i], [aria-label*="remove" i], [aria-label*="close" i], [aria-label*="quitar" i], [matChipRemove]'
                    ) || chip;
                  const r = removeBtn.getBoundingClientRect();
                  return {
                    active: true,
                    text: (chip.innerText || chip.getAttribute('aria-label') || '').trim().slice(0, 40),
                    x: Math.round(r.left + r.width / 2),
                    y: Math.round(r.top + r.height / 2),
                  };
                }

                if (op === 'FIND_CREATE_IMAGE_IN_OVERLAY') {
                  const createImgItem = findOverlayItemByText(/\b(create\s*images?|crear\s*im[aá]gen(?:es)?)\b/i);
                  return createImgItem
                    ? { ...triggerAngularElement(createImgItem, false), alreadyChecked: isItemChecked(createImgItem) }
                    : {
                        found: false,
                        items: getOverlayMenuItems().map((i) => (i.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30)),
                      };
                }

                if (op === 'FIND_ASPECT_RATIO_BUTTON') {
                  const root = getComposerRoot() || document;
                  const btns = Array.from(root.querySelectorAll('button, [role="button"]')).filter(
                    (el) =>
                      el.offsetParent !== null &&
                      !el.closest('.cdk-overlay-container, .cdk-overlay-popover, bard-sidenav, model-response, user-query')
                  );
                  const arBtn = btns.find((el) => {
                    const t = `${el.innerText || el.textContent || ''} ${el.getAttribute('aria-label') || ''}`
                      .replace(/\s+/g, ' ')
                      .trim();
                    return /\b(aspect\s*ratio|relaci[oó]n\s*de\s*aspecto|16\s*:\s*9|9\s*:\s*16|1\s*:\s*1|4\s*:\s*3|3\s*:\s*4)\b/i.test(t);
                  });
                  return arBtn ? triggerAngularElement(arBtn, false) : { found: false };
                }

                if (op === 'FIND_ASPECT_RATIO_OPTION_IN_OVERLAY') {
                  const wantVertical = argVal === '9:16';
                  const ratioRe = wantVertical
                    ? /\b(9\s*:\s*16|portrait|vertical)\b/i
                    : /\b(16\s*:\s*9|widescreen|landscape|horizontal)\b/i;
                  const item = findOverlayItemByText(ratioRe);
                  return item
                    ? { ...triggerAngularElement(item, false), alreadyChecked: isItemChecked(item) }
                    : { found: false };
                }

                if (op === 'READ_THINKING_OPTIONS') {
                  // Read ALL gem-menu-item / menuitemradio nodes in overlay (including collapsed Thinking level submenu items whose rect is 0x0)
                  const allMenuNodes = Array.from(
                    document.querySelectorAll(
                      '.cdk-overlay-popover gem-menu-item, .cdk-overlay-popover [role="menuitemradio"], .cdk-overlay-container gem-menu-item, .cdk-overlay-container [role="menuitemradio"], .cdk-overlay-container [role="menuitem"], .cdk-overlay-container .mat-mdc-menu-item'
                    )
                  );
                  const pool = allMenuNodes.length > 0 ? allMenuNodes : getOverlayMenuItems();
                  const read = (re) => {
                    const it = pool.find((el) =>
                      re.test((el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim())
                    );
                    return it ? isItemChecked(it) : null;
                  };
                  return {
                    carbon: read(/\b4\s*carbon\b|most\s+complex\s+work/i),
                    low: read(/^(?:[✓✔]\s*)?(?:low|bajo)\b/i),
                    medium: read(/^(?:[✓✔]\s*)?(?:medium|medio)\b/i),
                    high: read(/^(?:[✓✔]\s*)?(?:high|alto)\b/i),
                  };
                }

                if (op === 'ENSURE_MODEL_MENU_EXPANDED_DOM') {
                  const sw = findComposerModePickerButton();
                  if (!sw) return { expanded: false };
                  if (sw.getAttribute('aria-expanded') !== 'true') {
                    try {
                      sw.click();
                    } catch {}
                  }
                  return { expanded: sw.getAttribute('aria-expanded') === 'true' };
                }

                if (op === 'EXPAND_THINKING_SUBMENU_DOM') {
                  const tl =
                    document.querySelector('.cdk-overlay-popover gem-menu-item[value="thinking_level"]') ||
                    Array.from(
                      document.querySelectorAll('.cdk-overlay-popover gem-menu-item, .cdk-overlay-container [role="menuitem"]')
                    ).find((el) =>
                      /thinking\s*level|nivel\s*de\s*pensamiento/i.test(
                        (el.innerText || el.textContent || '').replace(/\s+/g, ' ')
                      )
                    );
                  if (!tl) return { found: false };
                  const r = tl.getBoundingClientRect();
                  const evOpts = {
                    bubbles: true,
                    cancelable: true,
                    clientX: Math.round(r.left + Math.max(12, r.width / 2)),
                    clientY: Math.round(r.top + Math.max(10, r.height / 2)),
                    view: window,
                  };
                  try {
                    tl.dispatchEvent(new PointerEvent('pointerenter', evOpts));
                    tl.dispatchEvent(new MouseEvent('mouseenter', evOpts));
                    tl.dispatchEvent(new MouseEvent('mouseover', evOpts));
                    if (tl.getAttribute('aria-expanded') !== 'true') {
                      tl.click();
                    }
                  } catch {}
                  return { found: true, expanded: tl.getAttribute('aria-expanded') === 'true' };
                }

                if (op === 'CLICK_CARBON4_DOM') {
                  const allItems = Array.from(
                    document.querySelectorAll(
                      '.cdk-overlay-popover gem-menu-item, .cdk-overlay-popover [role="menuitemradio"], .cdk-overlay-container [role="menuitemradio"], .cdk-overlay-container [role="menuitem"]'
                    )
                  );
                  const c4 =
                    allItems.find((el) => {
                      const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                      return /\b4\s*carbon\b/i.test(txt) || (/carbon/i.test(txt) && /most\s+complex\s+work/i.test(txt));
                    }) ||
                    allItems.find((el) => {
                      const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                      return /\b4\s*argon\b/i.test(txt);
                    });
                  if (!c4) return { clicked: false };
                  if (!isItemChecked(c4)) {
                    try {
                      c4.click();
                    } catch {}
                  }
                  return { clicked: true, alreadyChecked: isItemChecked(c4) };
                }

                if (op === 'CLICK_THINKING_OPTION_DOM') {
                  const wantHighOpt = argVal === 'HIGH';
                  const allItems = Array.from(
                    document.querySelectorAll(
                      '.cdk-overlay-popover gem-menu-item, .cdk-overlay-popover [role="menuitemradio"], .cdk-overlay-container [role="menuitemradio"], .cdk-overlay-container [role="menuitem"]'
                    )
                  );
                  const optEl = wantHighOpt
                    ? allItems.find((el) => {
                        const val = (el.getAttribute('value') || '').trim().toLowerCase();
                        const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                        return (
                          val === 'high' ||
                          (/\bhigh\b/i.test(txt) && /extra\s+thorough/i.test(txt)) ||
                          (/^(?:[✓✔]\s*)?(?:high|alto)\b/i.test(txt) &&
                            !/thinking\s*level|nivel\s*de\s*pensamiento|low|medium|pro|flash|argon|carbon/i.test(txt))
                        );
                      })
                    : allItems.find((el) => {
                        const val = (el.getAttribute('value') || '').trim().toLowerCase();
                        const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                        return (
                          val === 'low' ||
                          (/\blow\b/i.test(txt) && /(?:fast|quick)\s+and\s+efficient/i.test(txt)) ||
                          (/^(?:[✓✔]\s*)?(?:low|bajo)\b/i.test(txt) &&
                            !/thinking\s*level|nivel\s*de\s*pensamiento|high|medium|pro|flash|argon|carbon/i.test(txt))
                        );
                      });
                  if (!optEl) return { clicked: false };
                  if (!isItemChecked(optEl)) {
                    try {
                      optEl.click();
                    } catch {}
                  }
                  return { clicked: true };
                }

                if (op === 'OPEN_TOOLS_OR_PLUS_DOM') {
                  const root = getComposerRoot() || document;
                  const directToolBtn = Array.from(
                    root.querySelectorAll(
                      'toolbox-drawer button, button.toolbox-drawer-button, button[aria-label*="Tools" i], button[aria-label*="Herramientas" i], button[aria-label*="Upload & tools" i], button[aria-label*="Subir y herramientas" i], button[aria-label*="Add" i][aria-haspopup], button[aria-label*="Añadir" i][aria-haspopup]'
                    )
                  ).find(
                    (b) =>
                      b.offsetParent !== null &&
                      !b.closest('bard-sidenav, side-navigation, [role="navigation"], model-response, user-query')
                  );
                  if (!directToolBtn) return { clicked: false };
                  try {
                    const r = directToolBtn.getBoundingClientRect();
                    const ev = {
                      bubbles: true,
                      cancelable: true,
                      clientX: Math.round(r.left + r.width / 2),
                      clientY: Math.round(r.top + r.height / 2),
                      view: window,
                    };
                    directToolBtn.dispatchEvent(new PointerEvent('pointerdown', ev));
                    directToolBtn.dispatchEvent(new MouseEvent('mousedown', ev));
                    directToolBtn.dispatchEvent(new PointerEvent('pointerup', ev));
                    directToolBtn.dispatchEvent(new MouseEvent('mouseup', ev));
                    directToolBtn.click();
                    return { clicked: true };
                  } catch {
                    return { clicked: false };
                  }
                }

                if (op === 'CLICK_CREATE_IMAGE_DOM') {
                  const candidates = Array.from(
                    document.querySelectorAll(
                      '.cdk-overlay-container button, .cdk-overlay-container [role="menuitem"], .cdk-overlay-container [role="menuitemcheckbox"], .cdk-overlay-container [role="option"], .cdk-overlay-container gem-menu-item, .cdk-overlay-container mat-list-item, toolbox-drawer button, .input-area-container button'
                    )
                  ).filter(
                    (el) =>
                      el.offsetParent !== null &&
                      !el.closest('bard-sidenav, side-navigation, model-response, user-query')
                  );
                  const target = candidates.find((el) => {
                    const txt = `${el.innerText || el.textContent || ''} ${el.getAttribute('aria-label') || ''}`
                      .replace(/\s+/g, ' ')
                      .trim();
                    return (
                      /\b(create\s*images?|crear\s*im[aá]gen(?:es)?|generate\s*images?|generar\s*im[aá]gen(?:es)?|imagen\s*3|imagen)\b/i.test(
                        txt
                      ) && !/\b(deselect|remove|quitar|desactivar|deseleccionar)\b/i.test(txt)
                    );
                  });
                  if (!target) return { clicked: false };
                  if (isItemChecked(target)) return { clicked: true, alreadyChecked: true };
                  try {
                    const r = target.getBoundingClientRect();
                    const ev = {
                      bubbles: true,
                      cancelable: true,
                      clientX: Math.round(r.left + r.width / 2),
                      clientY: Math.round(r.top + r.height / 2),
                      view: window,
                    };
                    target.dispatchEvent(new PointerEvent('pointerdown', ev));
                    target.dispatchEvent(new MouseEvent('mousedown', ev));
                    target.dispatchEvent(new PointerEvent('pointerup', ev));
                    target.dispatchEvent(new MouseEvent('mouseup', ev));
                    target.click();
                    return { clicked: true };
                  } catch {
                    return { clicked: false };
                  }
                }

                if (op === 'FIND_AND_OPEN_PLUS_MENU') {
                  // Verified live: the composer "+" is button[aria-label="Upload & tools"] inside .input-area
                  const exactPlus = Array.from(
                    document.querySelectorAll(
                      'button[aria-label="Upload & tools"], button[aria-label*="Upload & tools" i], button[aria-label*="Subir y herramientas" i], button[aria-label*="herramientas" i][aria-haspopup]'
                    )
                  ).find((b) => {
                    const r = b.getBoundingClientRect();
                    return r.width > 4 && r.height > 4 && !b.closest('bard-sidenav, side-navigation, [role="navigation"], .cdk-overlay-container, .cdk-overlay-popover');
                  });
                  if (exactPlus) return triggerAngularElement(exactPlus, false);
                  const inputEl = document.querySelector(
                    'rich-textarea div.ql-editor, div[contenteditable="true"][role="textbox"], rich-textarea'
                  );
                  const inputRect = inputEl ? inputEl.getBoundingClientRect() : null;
                  const allBtns = Array.from(
                    document.querySelectorAll('button, [role="button"]')
                  ).filter(
                    (el) =>
                      el &&
                      el.offsetParent !== null &&
                      !el.closest('.cdk-overlay-container, .cdk-overlay-popover, bard-sidenav, side-navigation, [role="navigation"]')
                  );

                  let plusBtn = null;
                  if (inputRect) {
                    const leftBtns = allBtns
                      .filter((el) => {
                        const r = el.getBoundingClientRect();
                        const vert =
                          r.bottom >= inputRect.top - 70 && r.top <= inputRect.bottom + 90;
                        const left = r.left <= inputRect.left + 110;
                        return vert && left && r.width >= 18 && r.width <= 95;
                      })
                      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);

                    plusBtn =
                      leftBtns.find((el) => {
                        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                        const tip = (
                          el.getAttribute('mattooltip') ||
                          el.getAttribute('title') ||
                          ''
                        ).toLowerCase();
                        const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
                        return (
                          aria.includes('add') ||
                          aria.includes('más') ||
                          aria.includes('more') ||
                          aria.includes('upload') ||
                          aria.includes('tools') ||
                          aria.includes('herramientas') ||
                          aria.includes('open') ||
                          tip.includes('add') ||
                          txt === '+' ||
                          txt === 'add'
                        );
                      }) || leftBtns[0];
                  }

                  if (!plusBtn) {
                    plusBtn = allBtns.find((el) => {
                      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                      return (
                        aria.includes('add files') ||
                        aria.includes('upload') ||
                        aria.includes('more tools') ||
                        aria.includes('add to prompt')
                      );
                    });
                  }

                  return plusBtn ? triggerAngularElement(plusBtn, false) : { found: false };
                }

                if (op === 'FIND_MORE_TOOLS_IN_OVERLAY') {
                  const directDeep = findOverlayItemByText(DR_RE);
                  if (directDeep) {
                    return {
                      directDeepResearch: true,
                      ...triggerAngularElement(directDeep, false),
                    };
                  }
                  const moreTools = findOverlayItemByText(/\b(more\s+tools|m[aá]s\s+herramientas|tools|herramientas)\b/i);
                  return moreTools
                    ? {
                        directDeepResearch: false,
                        ...triggerAngularElement(moreTools, true),
                      }
                    : {
                        found: false,
                        items: getOverlayMenuItems().map((i) => (i.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30)),
                      };
                }

                if (op === 'FIND_DEEP_RESEARCH_IN_OVERLAY') {
                  const deepItem = findOverlayItemByText(DR_RE);
                  return deepItem
                    ? { ...triggerAngularElement(deepItem, false), alreadyChecked: isItemChecked(deepItem) }
                    : {
                        found: false,
                        items: getOverlayMenuItems().map((i) => (i.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30)),
                      };
                }

                if (op === 'FIND_DR_SUGGESTION_BUTTON') {
                  const btn = findDeepResearchSuggestionButton();
                  return btn ? triggerAngularElement(btn, false) : { found: false };
                }

                if (op === 'DUMP_COMPOSER') {
                  return { dump: dumpComposerState() };
                }

                if (op === 'FIND_AND_OPEN_MODEL_SWITCHER') {
                  const switcherBtn = findComposerModePickerButton();
                  if (!switcherBtn) return { found: false };
                  const ariaLabel = (switcherBtn.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
                  const innerLabel = (switcherBtn.innerText || switcherBtn.textContent || '')
                    .replace(/\s+/g, ' ')
                    .trim();
                  const label = `${ariaLabel} ${innerLabel}`.trim();
                  const isAlreadyCarbon = /\bcarbon\b/i.test(label) && !/\bargon|pro|flash\b/i.test(label);
                  return {
                    ...triggerAngularElement(switcherBtn, false),
                    isAlreadyCarbon,
                    label,
                  };
                }

                if (op === 'FIND_CARBON4_IN_OVERLAY') {
                  const items = getOverlayMenuItems();
                  const carbon4 =
                    items.find((el) => {
                      const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                      return (
                        /\b4\s*carbon\b/i.test(txt) ||
                        (/carbon/i.test(txt) && /most\s+complex\s+work/i.test(txt))
                      );
                    }) ||
                    items.find((el) => {
                      const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                      return /\bcarbon\b/i.test(txt) && !/thinking\s*level/i.test(txt);
                    }) ||
                    items.find((el) => {
                      const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                      return /\b4\s*argon\b/i.test(txt) || (/\bargon\b/i.test(txt) && !/thinking\s*level/i.test(txt));
                    });
                  return carbon4
                    ? { ...triggerAngularElement(carbon4, false), matchedText: (carbon4.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40) }
                    : { found: false };
                }

                if (op === 'FIND_THINKING_LEVEL_IN_OVERLAY') {
                  const items = getOverlayMenuItems();
                  const thinkingItem = items.find((el) =>
                    /thinking\s*level|nivel\s*de\s*pensamiento/i.test(
                      (el.innerText || el.textContent || '').replace(/\s+/g, ' ')
                    )
                  );
                  return thinkingItem ? triggerAngularElement(thinkingItem, true) : { found: false };
                }

                if (op === 'FIND_THINKING_OPTION_IN_OVERLAY') {
                  const items = getOverlayMenuItems();
                  const wantHigh = argVal === 'HIGH';
                  const option = wantHigh
                    ? items.find((el) => {
                        const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                        return (
                          (/\bhigh\b/i.test(txt) && /extra\s+thorough/i.test(txt)) ||
                          /^(?:✓\s*)?(?:high|alto)(?:\s+extra\s+thorough)?$/i.test(txt)
                        );
                      }) ||
                      items.find((el) => {
                        const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                        return (
                          /\b(high|alto|extra\s+thorough)\b/i.test(txt) &&
                          !/thinking\s*level|low|medium|pro|flash|argon|carbon/i.test(txt)
                        );
                      })
                    : items.find((el) => {
                        const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                        return (
                          (/\blow\b/i.test(txt) && /(?:fast|quick)\s+and\s+efficient/i.test(txt)) ||
                          /^(?:✓\s*)?(?:low|bajo)(?:\s+(?:fast|quick)\s+and\s+efficient)?$/i.test(txt)
                        );
                      }) ||
                      items.find((el) => {
                        const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                        return (
                          /\b(low|bajo|(?:fast|quick)\s+and\s+efficient)\b/i.test(txt) &&
                          !/thinking\s*level|high|medium|pro|flash|argon|carbon/i.test(txt)
                        );
                      });
                  return option
                    ? { ...triggerAngularElement(option, false), alreadyChecked: isItemChecked(option) }
                    : { found: false, items: items.map((i) => (i.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40)) };
                }

                return { found: false };
              },
            })
            .catch(() => []);
          return (res && res[0] && res[0].result) || { found: false };
        };

        const pressEscape = async () => {
          if (!debuggerAttached || cdpInputOccluded) return;
          const base = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
          const okEsc = await cdpSendWithTimeout(target, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
          if (!okEsc) {
            cdpInputOccluded = true;
            return;
          }
          await cdpSendWithTimeout(target, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
        };

        const closeMenus = async () => {
          for (let i = 0; i < 3; i++) {
            const open = await runMainStep('COUNT_OPEN_MENUS');
            if (!open || !open.count) return;
            await pressEscape();
            await sleep(120);
            await runMainStep('CLOSE_MENUS');
            await sleep(160);
          }
        };

        // Poll a locator step until it is found (menus animate in ~150-250ms)
        const waitFound = async (op, arg = '', tries = 8, delay = 140) => {
          let res = null;
          for (let i = 0; i < tries; i++) {
            res = await runMainStep(op, arg);
            if (res && res.found) return res;
            await sleep(delay);
          }
          return res || { found: false };
        };

        const openModelMenu = async () => {
          const sw = await runMainStep('FIND_AND_OPEN_MODEL_SWITCHER');
          if (!sw || !sw.found) return null;
          await hardwareHoverAndClick(sw.x, sw.y);
          await sleep(180);
          await runMainStep('ENSURE_MODEL_MENU_EXPANDED_DOM');
          await sleep(160);
          const directOpt = await runMainStep('FIND_THINKING_OPTION_IN_OVERLAY', targetLevel);
          if (directOpt && directOpt.found) {
            return { sw, thinkingFound: false, th: { found: false }, directOpt };
          }
          const th = await waitFound('FIND_THINKING_LEVEL_IN_OVERLAY', '', 4, 130);
          return { sw, thinkingFound: Boolean(th && th.found), th };
        };

        const openThinkingSubmenu = async (th, directOpt) => {
          if (directOpt && directOpt.found) return directOpt;
          let opt = await waitFound('FIND_THINKING_OPTION_IN_OVERLAY', targetLevel, 2, 100);
          if (opt.found) return opt;
          if (th && th.found) {
            await hardwareHoverOnly(th.x, th.y);
            opt = await waitFound('FIND_THINKING_OPTION_IN_OVERLAY', targetLevel, 3, 120);
            if (!opt.found) {
              await hardwareHoverAndClick(th.x, th.y);
              opt = await waitFound('FIND_THINKING_OPTION_IN_OVERLAY', targetLevel, 3, 120);
            }
          }
          if (!opt.found) {
            await runMainStep('EXPAND_THINKING_SUBMENU_DOM');
            await sleep(220);
            opt = await waitFound('FIND_THINKING_OPTION_IN_OVERLAY', targetLevel, 4, 120);
          }
          return opt;
        };

        // --- PART 1: MODEL "4 Carbon" + "Thinking level" -> targetLevel (LOW for app, HIGH for MODO DUO/TRIO/CUATRO) ---
        let thinkingOk = false;
        let thinkingVerified = false;
        let verifiedModelLabel = '';
        const canonicalTargetLabel = targetLevel === 'HIGH' ? '4 Carbon · High' : '4 Carbon · Low';
        const modeMatchesTarget = async () => {
          const ml = await runMainStep('READ_MODE_LABEL');
          const label = String((ml && ml.label) || '');
          const re = targetLevel === 'HIGH' ? /\bcarbon\b[^,]*\bhigh\b/i : /\bcarbon\b[^,]*\blow\b/i;
          if (re.test(label)) {
            verifiedModelLabel = canonicalTargetLabel;
            return true;
          }
          return false;
        };
        if (await modeMatchesTarget()) {
          thinkingOk = true;
          thinkingVerified = true;
        }
        for (let attempt = 1; attempt <= 3 && !thinkingOk; attempt++) {
          await closeMenus();
          let menu = await openModelMenu();
          if (!menu) {
            diag.push(`T${attempt}: switcher no encontrado`);
            await sleep(350);
            continue;
          }

          // Check current checked state directly inside gem-menu-item nodes
          const preState = await runMainStep('READ_THINKING_OPTIONS');
          const preWant = targetLevel === 'HIGH' ? preState?.high : preState?.low;
          const isCarbonActive = preState?.carbon === true || (preState?.carbon === null && Boolean(menu.sw.isAlreadyCarbon));
          if (isCarbonActive && preWant === true) {
            thinkingOk = true;
            thinkingVerified = true;
            verifiedModelLabel = canonicalTargetLabel;
            break;
          }

          if (!isCarbonActive) {
            const c4 = await waitFound('FIND_CARBON4_IN_OVERLAY', '', 5, 130);
            if (c4.found) {
              await hardwareHoverAndClick(c4.x, c4.y);
              await sleep(260);
            }
            await runMainStep('CLICK_CARBON4_DOM');
            await sleep(320);
            await closeMenus();
            menu = await openModelMenu();
            if (!menu) continue;
            const afterCarbonState = await runMainStep('READ_THINKING_OPTIONS');
            const afterCarbonWant = targetLevel === 'HIGH' ? afterCarbonState?.high : afterCarbonState?.low;
            if (afterCarbonWant === true) {
              thinkingOk = true;
              thinkingVerified = true;
              verifiedModelLabel = canonicalTargetLabel;
              break;
            }
          }

          const opt = await openThinkingSubmenu(menu.th, menu.directOpt);
          if (opt && opt.found) {
            if (!opt.alreadyChecked) {
              await hardwareHoverAndClick(opt.x, opt.y);
              await sleep(280);
            }
          } else {
            await runMainStep('EXPAND_THINKING_SUBMENU_DOM');
            await sleep(200);
          }
          // Unfocused window safeguard: if menu is still open and option wasn't toggled by CDP mouse event, click in MAIN world
          await runMainStep('CLICK_THINKING_OPTION_DOM', targetLevel);
          await sleep(320);

          await closeMenus();
          if (await modeMatchesTarget()) {
            thinkingOk = true;
            thinkingVerified = true;
            break;
          }

          // Strict DOM verification: reopen menu and verify aria-checked="true" on 4 Carbon + target Thinking level
          const vMenu = await openModelMenu();
          if (vMenu) {
            let state = await runMainStep('READ_THINKING_OPTIONS');
            let want = targetLevel === 'HIGH' ? state?.high : state?.low;
            if (want === null && vMenu.thinkingFound) {
              await runMainStep('EXPAND_THINKING_SUBMENU_DOM');
              await sleep(200);
              state = await runMainStep('READ_THINKING_OPTIONS');
              want = targetLevel === 'HIGH' ? state?.high : state?.low;
            }
            if (want !== true) {
              await runMainStep('EXPAND_THINKING_SUBMENU_DOM');
              await sleep(180);
              await runMainStep('CLICK_THINKING_OPTION_DOM', targetLevel);
              await sleep(280);
              await closeMenus();
              const vMenu2 = await openModelMenu();
              if (vMenu2) {
                state = await runMainStep('READ_THINKING_OPTIONS');
                want = targetLevel === 'HIGH' ? state?.high : state?.low;
              }
            }
            const carbonConfirmed = state?.carbon !== false;
            if (want === true && carbonConfirmed) {
              thinkingOk = true;
              thinkingVerified = true;
              verifiedModelLabel = canonicalTargetLabel;
            } else if (want === null && carbonConfirmed && state?.high !== true && state?.low !== true && state?.medium !== true) {
              thinkingOk = true;
              verifiedModelLabel = canonicalTargetLabel;
            } else {
              diag.push(`T${attempt}: verificación falló (carbon=${state?.carbon}, low=${state?.low}, medium=${state?.medium}, high=${state?.high})`);
            }
          }
        }
        await closeMenus();
        if (thinkingOk && verifiedModelLabel) {
          verifiedExternalGeminiModels.set(geminiTabId, verifiedModelLabel);
        }

        // --- PART 2: DEEP RESEARCH (+ -> More tools -> Deep research) with verification ---
        let deepResearchOk = false;
        const initialChip = await runMainStep('CHECK_DEEP_RESEARCH_CHIP');
        if (!enableDeepResearch) {
          if (initialChip?.active && initialChip.x) {
            await hardwareHoverAndClick(initialChip.x, initialChip.y);
            await sleep(350);
          }
          const after = await runMainStep('CHECK_DEEP_RESEARCH_CHIP');
          deepResearchOk = !after?.active;
        } else if (initialChip?.active) {
          deepResearchOk = true;
        } else {
          const waitChipActive = async (rounds = 10) => {
            for (let i = 0; i < rounds; i++) {
              await sleep(180);
              const chk = await runMainStep('CHECK_DEEP_RESEARCH_CHIP');
              if (chk?.active) return true;
            }
            return false;
          };
          let clickedOnce = false;
          for (let attempt = 1; attempt <= 3 && !deepResearchOk; attempt++) {
            await closeMenus();
            const plusInfo = await runMainStep('FIND_AND_OPEN_PLUS_MENU');
            let deepInfo = null;
            if (!plusInfo?.found) {
              diag.push(`D${attempt}: botón "+" no encontrado`);
            } else {
              await hardwareHoverAndClick(plusInfo.x, plusInfo.y);
              const moreTools = await waitFound('FIND_MORE_TOOLS_IN_OVERLAY', '', 8, 140);
              if (!moreTools.found) {
                diag.push(`D${attempt}: menú "+" sin "More tools" [${(moreTools.items || []).join(' | ')}]`);
              } else if (moreTools.directDeepResearch) {
                deepInfo = moreTools;
              } else {
                await hardwareHoverOnly(moreTools.x, moreTools.y);
                deepInfo = await waitFound('FIND_DEEP_RESEARCH_IN_OVERLAY', '', 6, 140);
                if (!deepInfo.found) {
                  await hardwareHoverAndClick(moreTools.x, moreTools.y);
                  deepInfo = await waitFound('FIND_DEEP_RESEARCH_IN_OVERLAY', '', 6, 150);
                }
                if (!deepInfo.found) {
                  diag.push(`D${attempt}: "Deep research" no apareció en submenú [${(deepInfo.items || []).join(' | ')}]`);
                  deepInfo = null;
                }
              }
            }

            if (deepInfo && deepInfo.found) {
              if (deepInfo.alreadyChecked) {
                // Item is already selected: do NOT click again (that would turn it OFF)
                deepResearchOk = true;
                break;
              }
              if (clickedOnce) {
                // A previous click may have worked but the chip wasn't detectable: avoid toggling it back off
                diag.push(`D${attempt}: reintento tras clic previo`);
              }
              await hardwareHoverAndClick(deepInfo.x, deepInfo.y);
              clickedOnce = true;
              if (await waitChipActive(10)) {
                deepResearchOk = true;
                break;
              }
              diag.push(`D${attempt}: clic en menú hecho pero Deep Research no quedó activo`);
              continue;
            }

            // Route 3: the "Deep Research" suggestion button shown next to the composer
            await closeMenus();
            const sugg = await runMainStep('FIND_DR_SUGGESTION_BUTTON');
            if (sugg?.found) {
              await hardwareHoverAndClick(sugg.x, sugg.y);
              clickedOnce = true;
              if (await waitChipActive(10)) {
                deepResearchOk = true;
                diag.push(`D${attempt}: activado con el botón sugerido "Deep Research"`);
                break;
              }
              diag.push(`D${attempt}: botón sugerido pulsado pero sin confirmación`);
            }
          }
          if (!deepResearchOk) {
            const dump = await runMainStep('DUMP_COMPOSER');
            if (dump?.dump) diag.push(`Estado: ${dump.dump}`);
          }
        }

        await closeMenus();

        // --- PART 3: CREATE IMAGE (+ -> Create image) with verification & auto-cleanup when disabled ---
        let createImageOk = false;
        const initialImgChip = await runMainStep('CHECK_CREATE_IMAGE_CHIP');
        if (!enableCreateImage) {
          if (initialImgChip?.active && initialImgChip.x) {
            await hardwareHoverAndClick(initialImgChip.x, initialImgChip.y);
            await sleep(320);
          }
          const afterImg = await runMainStep('CHECK_CREATE_IMAGE_CHIP');
          createImageOk = !afterImg?.active;
        } else if (initialImgChip?.active) {
          createImageOk = true;
        } else {
          const waitImgChipActive = async (rounds = 10) => {
            for (let i = 0; i < rounds; i++) {
              await sleep(160);
              const chk = await runMainStep('CHECK_CREATE_IMAGE_CHIP');
              if (chk?.active) return true;
            }
            return false;
          };
          for (let attempt = 1; attempt <= 3 && !createImageOk; attempt++) {
            await closeMenus();
            // First try direct DOM click if composer already exposes a Create image / Tools button or in unfocused windows
            const preDomClick = await runMainStep('CLICK_CREATE_IMAGE_DOM');
            if (preDomClick?.clicked && (preDomClick.alreadyChecked || (await waitImgChipActive(6)))) {
              createImageOk = true;
              break;
            }
            const plusInfo = await runMainStep('FIND_AND_OPEN_PLUS_MENU');
            if (plusInfo?.found) {
              await hardwareHoverAndClick(plusInfo.x, plusInfo.y);
            } else {
              const domOpened = await runMainStep('OPEN_TOOLS_OR_PLUS_DOM');
              if (!domOpened?.clicked) {
                diag.push(`I${attempt}: botón "+" / Tools no encontrado`);
                continue;
              }
            }
            let createImgInfo = await waitFound('FIND_CREATE_IMAGE_IN_OVERLAY', '', 6, 130);
            if (!createImgInfo.found) {
              await runMainStep('OPEN_TOOLS_OR_PLUS_DOM');
              await sleep(260);
              createImgInfo = await waitFound('FIND_CREATE_IMAGE_IN_OVERLAY', '', 6, 130);
            }
            if (!createImgInfo.found) {
              const moreTools = await runMainStep('FIND_MORE_TOOLS_IN_OVERLAY');
              if (moreTools?.found && !moreTools.directDeepResearch) {
                await hardwareHoverOnly(moreTools.x, moreTools.y);
                createImgInfo = await waitFound('FIND_CREATE_IMAGE_IN_OVERLAY', '', 5, 130);
              }
            }
            if (!createImgInfo?.found) {
              const domFallbackClick = await runMainStep('CLICK_CREATE_IMAGE_DOM');
              if (domFallbackClick?.clicked && (domFallbackClick.alreadyChecked || (await waitImgChipActive(8)))) {
                createImageOk = true;
                break;
              }
              diag.push(`I${attempt}: "Create image" no apareció en menú "+" [${(createImgInfo?.items || []).join(' | ')}]`);
              continue;
            }
            if (createImgInfo.alreadyChecked) {
              createImageOk = true;
              break;
            }
            await hardwareHoverAndClick(createImgInfo.x, createImgInfo.y);
            if (await waitImgChipActive(7)) {
              createImageOk = true;
              break;
            }
            const domDirectClick = await runMainStep('CLICK_CREATE_IMAGE_DOM');
            if (domDirectClick?.clicked && (await waitImgChipActive(8))) {
              createImageOk = true;
              break;
            }
            diag.push(`I${attempt}: clic en "Create image" hecho pero el chip "Images" no quedó activo`);
          }
        }

        // Optional native Aspect ratio selection ("16:9" vs "9:16") inside Create image mode
        if (enableCreateImage && createImageOk && (aspectRatio === '16:9' || aspectRatio === '9:16')) {
          await closeMenus();
          const arBtn = await runMainStep('FIND_ASPECT_RATIO_BUTTON');
          if (arBtn?.found && !new RegExp(aspectRatio.replace(':', '\\s*:\\s*')).test(arBtn.text || '')) {
            await hardwareHoverAndClick(arBtn.x, arBtn.y);
            const arOpt = await waitFound('FIND_ASPECT_RATIO_OPTION_IN_OVERLAY', aspectRatio, 6, 120);
            if (arOpt?.found && !arOpt.alreadyChecked) {
              await hardwareHoverAndClick(arOpt.x, arOpt.y);
              await sleep(220);
            }
            await closeMenus();
          }
        }

        await closeMenus();

        sendResponse({
          ok: true,
          targetLevel,
          enableDeepResearch,
          enableCreateImage,
          thinkingOk,
          thinkingVerified,
          verifiedModel: verifiedModelLabel,
          deepResearchOk,
          createImageOk,
          debuggerAttached,
          diag,
        });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      } finally {
        if (debuggerAttached) {
          await chrome.debugger.detach(target).catch(() => {});
        }
        if (switchedTabTemporarily && prevActiveTabId) {
          await chrome.tabs.update(prevActiveTabId, { active: true }).catch(() => {});
        }
      }
    })();
    return true;
  }

  // 3. Forward status & responses from Gemini/Flow/Suno tab ONLY to Huellas Master in the SAME window
  const isSenderExternalAskTab =
    Boolean(sender?.tab?.id) &&
    (activeExternalAskTabId === sender.tab.id ||
      Array.from(activeExternalAskMap.values()).some((v) => v && v.tabId === sender.tab.id));

  if (message.type === 'GEMINI_RESPONSE_READY') {
    if (isSenderExternalAskTab) {
      sendResponse({ ok: true, ignoredExternalAskTab: true });
      return false;
    }
    // Remote (mobile) orders: persist result ONLY in the local server (never applied to the Mac app's active doc).
    // If the server is unreachable, fall back to broadcasting with docId + isRemoteOrder so nothing is lost.
    (async () => {
      const outcome = await forwardRemoteStageResultIfAny(message, sender).catch(() => null);
      if (outcome && outcome.isRemote) {
        if (!outcome.saved) {
          broadcastToHuellasTabsInSameWindow(senderWindowId, {
            ...message,
            docId: message.docId || outcome.docId,
            isRemoteOrder: true,
          });
        }
        return;
      }
      broadcastToHuellasTabsInSameWindow(senderWindowId, message);
      // Local orders: idempotent backup in the Mac server (only fills an EMPTY field), so a reloaded/closed
      // app tab can never lose a 25-min Deep Research report
      const stageNum = Number(message.stageNumber) || 0;
      if (
        message.docId &&
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 80, 101, 11, 111, 112, 113, 114, 115, 12].includes(stageNum) &&
        String(message.text || '').trim().length > 20
      ) {
        fetch('http://localhost:4200/api/gemini-web/remote-stage-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            docId: message.docId,
            stageNumber: stageNum,
            text: message.text,
            onlyIfEmpty: true,
            isPartialContinuation: Boolean(message.isPartialContinuation),
            continuationRound: Number(message.continuationRound || 0),
            chatUrl: sender?.tab?.url || '',
          }),
        }).catch(() => {});
      }
    })();
    sendResponse({ ok: true });
    return true;
  }
  if (
    message.type === 'BRIDGE_STATUS' ||
    message.type === 'GEMINI_CHAT_LINKED' ||
    message.type === 'FLOW_MEDIA_READY' ||
    message.type === 'FLOW_VIDEO_CAPTURED' ||
    message.type === 'FLOW_CLIP_IMAGE_CAPTURED' ||
    message.type === 'FLOW_THUMBNAIL_CAPTURED' ||
    message.type === 'GEMINI_THUMBNAIL_CAPTURED' ||
    message.type === 'FLOW_REFERENCE_CAPTURED' ||
    message.type === 'FLOW_GENERATION_FAILED' ||
    message.type === 'SUNO_AUDIO_CAPTURED'
  ) {
    if (isSenderExternalAskTab) {
      sendResponse({ ok: true, ignoredExternalAskTab: true });
      return false;
    }
    if (message.type === 'GEMINI_CHAT_LINKED') {
      saveChatLinkInBackgroundRegistry(message).catch(() => {});
      if (message.docId && message.geminiChatUrl) {
        fetch('http://localhost:4200/api/gemini-web/link-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message),
        }).catch(() => {});
      }
    }
    if (
      (message.type === 'FLOW_THUMBNAIL_CAPTURED' || message.type === 'GEMINI_THUMBNAIL_CAPTURED') &&
      (message.imageDataUrl || message.imageUrl)
    ) {
      const normalizedOpt = message.option || message.optionLabel || 'A';
      (async () => {
        let previewDataUrl = '';
        try {
          const resp = await fetch('http://localhost:4200/api/gemini-web/save-captured-thumbnail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              docId: message.docId || '',
              option: normalizedOpt,
              optionLabel: normalizedOpt,
              imageDataUrl: message.imageDataUrl || message.imageUrl || '',
            }),
          });
          if (resp.ok) {
            const savedMeta = await resp.json().catch(() => null);
            if (savedMeta && savedMeta.previewDataUrl) {
              previewDataUrl = String(savedMeta.previewDataUrl);
            }
          }
        } catch {}
        broadcastToHuellasTabsInSameWindow(senderWindowId, {
          ...message,
          option: normalizedOpt,
          optionLabel: normalizedOpt,
          ...(previewDataUrl ? { previewDataUrl } : {}),
        });
      })();
      sendResponse({ ok: true });
      return true;
    }
    if (message.type === 'FLOW_GENERATION_FAILED' && message.mediaType === 'THUMBNAILS') {
      fetch('http://localhost:4200/api/gemini-web/fail-captured-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docId: message.docId || '',
          option: message.option || message.optionLabel || 'A',
          errorText: message.errorText || 'Gemini Web no devolvió la imagen de la miniatura.',
        }),
      }).catch(() => {});
    }
    broadcastToHuellasTabsInSameWindow(senderWindowId, message);
    sendResponse({ ok: true });
    return true;
  }

  // 4B. Attach Official Logo image (DataURL or URL) into Gemini Web's composer via MAIN-world ClipboardEvent('paste')
  if (message.type === 'GEMINI_MAIN_WORLD_ATTACH_IMAGE' && sender?.tab?.id) {
    const geminiTabId = sender.tab.id;
    const rawImageSource = String(message.dataUrl || '').trim();
    const fileName = String(message.fileName || 'logo_huellas_de_la_humanidad.png').trim();
    (async () => {
      try {
        let resolvedDataUrl = rawImageSource;
        if (resolvedDataUrl && !resolvedDataUrl.startsWith('data:')) {
          const resp = await fetch(resolvedDataUrl, { credentials: 'include' }).catch(() => null);
          if (resp && resp.ok) {
            const buf = await resp.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let binary = '';
            const chunkSize = 0x8000;
            for (let i = 0; i < bytes.length; i += chunkSize) {
              binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
            }
            const mime = (resp.headers.get('content-type') || 'image/png').split(';')[0].trim() || 'image/png';
            resolvedDataUrl = `data:${mime};base64,${btoa(binary)}`;
          }
        }

        if (!resolvedDataUrl || !resolvedDataUrl.startsWith('data:')) {
          sendResponse({ ok: false, error: 'Logo DataURL inválido o vacío' });
          return;
        }

        const pasteRes = await chrome.scripting
          .executeScript({
            target: { tabId: geminiTabId },
            world: 'MAIN',
            args: [resolvedDataUrl, fileName],
            func: (dataUrlStr, fname) => {
              try {
                // Remove ONLY leftover uploaded file attachments (NEVER touch mat-chip-row / Create image / Tools chips!)
                document
                  .querySelectorAll(
                    'uploader-file-preview button, .file-preview-container button, button[aria-label*="close attachment" i], button[aria-label*="cerrar archivo" i], button[aria-label*="remove attachment" i], button[aria-label*="remove file" i], button[aria-label*="quitar archivo" i]'
                  )
                  .forEach((b) => {
                    try {
                      if (b.closest('mat-chip-row, mat-chip, mat-chip-option, toolbox-drawer')) return;
                      const aria = `${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`;
                      if (/create\s*images?|crear\s*im[aá]gen|images|im[aá]genes|deep\s*research|canvas|tool|herramienta/i.test(aria)) {
                        return;
                      }
                      b.click();
                    } catch {}
                  });

                const ed = document.querySelector(
                  'rich-textarea .ql-editor, div.ql-editor[contenteditable="true"], div[contenteditable="true"][role="textbox"]'
                );
                if (!ed) return { pasted: false, error: 'Editor no encontrado' };
                ed.focus();

                const commaIdx = dataUrlStr.indexOf(',');
                if (commaIdx === -1) return { pasted: false, error: 'Formato DataURL inválido' };
                const header = dataUrlStr.slice(0, commaIdx);
                const b64 = dataUrlStr.slice(commaIdx + 1);
                const mimeMatch = header.match(/data:([^;]+)/i);
                const mime = (mimeMatch && mimeMatch[1]) || 'image/png';

                const bin = atob(b64);
                const arr = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);

                const file = new File([arr], fname || 'logo_huellas.png', { type: mime });
                const dt = new DataTransfer();
                dt.items.add(file);

                // Prefer native <input type="file"> when present in the composer, otherwise ClipboardEvent('paste') + DragEvent('drop')
                const fileInput = document.querySelector(
                  'input-area-v2 input[type="file"], .input-area-container input[type="file"], input[type="file"][accept*="image"]'
                );
                if (fileInput) {
                  try {
                    fileInput.files = dt.files;
                    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
                  } catch {}
                }
                const pasteEv = new ClipboardEvent('paste', {
                  bubbles: true,
                  cancelable: true,
                  composed: true,
                  clipboardData: dt,
                });
                ed.dispatchEvent(pasteEv);
                return { pasted: true };
              } catch (e) {
                return { pasted: false, error: String(e?.message || e) };
              }
            },
          })
          .catch(() => []);

        const firstOut = (pasteRes && pasteRes[0] && pasteRes[0].result) || { pasted: false };
        if (!firstOut.pasted) {
          sendResponse({ ok: false, error: firstOut.error || 'No se pudo pegar la imagen del logo' });
          return;
        }

        // Poll up to ~10 seconds until the attachment preview chip is visible and upload progress spinners finish
        let attached = false;
        let uploadReady = false;
        for (let i = 0; i < 40; i++) {
          await sleep(250);
          const chkRes = await chrome.scripting
            .executeScript({
              target: { tabId: geminiTabId },
              world: 'MAIN',
              func: () => {
                const root =
                  document.querySelector('input-area-v2, .input-area-container, .input-area') || document;
                const hasImg =
                  root.querySelectorAll(
                    'uploader-file-preview, .file-preview-container, [data-test-id*="file-preview" i], [data-test-id*="attachment" i], img.gem-attachment-style-img, button[aria-label*="close attachment" i], button[aria-label*="cerrar archivo" i], button[aria-label*="remove file" i], button[aria-label*="quitar archivo" i], [class*="attachment"] img, [class*="file-preview"] img, img[src^="blob:"], img[src^="data:image"]'
                  ).length > 0;
                const uploading =
                  root.querySelectorAll(
                    'uploader-file-preview mat-progress-spinner, .file-preview-container mat-progress-spinner, mat-progress-spinner, mat-spinner, [role="progressbar"], [class*="upload-progress" i], [class*="loading-spinner" i]'
                  ).length > 0;
                return { hasImg, uploading };
              },
            })
            .catch(() => []);
          const st = (chkRes && chkRes[0] && chkRes[0].result) || {};
          if (st.hasImg) {
            attached = true;
            if (!st.uploading && i >= 2) {
              uploadReady = true;
              break;
            }
          }
        }

        sendResponse({ ok: attached, ready: uploadReady });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  // 4C. Deselect "Create image" ("Images" chip) in Gemini Web composer after image generation finishes
  if (message.type === 'GEMINI_MAIN_WORLD_DESELECT_CREATE_IMAGE' && sender?.tab?.id) {
    const geminiTabId = sender.tab.id;
    chrome.scripting
      .executeScript({
        target: { tabId: geminiTabId },
        world: 'MAIN',
        func: () => {
          const root =
            document.querySelector('input-area-v2, .input-area-container, .input-area') || document;
          const desel = Array.from(root.querySelectorAll('button, [role="button"]')).find((b) => {
            const a = (b.getAttribute('aria-label') || '').trim();
            return (
              /\b(deselect|remove|quitar|desactivar|deseleccionar)\b/i.test(a) &&
              /\b(create\s*images?|images?|crear\s*im[aá]gen(?:es)?|im[aá]gen(?:es)?)\b/i.test(a)
            );
          });
          if (desel) {
            try {
              desel.click();
              return true;
            } catch {}
          }
          return false;
        },
      })
      .catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  // 4D. Fetch generated Gemini image URL (with high-res upgrade for googleusercontent.com) as permanent base64 DataURL
  if (message.type === 'FETCH_IMAGE_BASE64' && message.url) {
    (async () => {
      try {
        const origUrl = String(message.url || '').trim();
        const candidateUrls = [];
        if (/googleusercontent\.com\//i.test(origUrl)) {
          const upgraded = origUrl.replace(/=(?:s\d+|w\d+(?:-h\d+)?)(?:-[a-zA-Z0-9-]+)?(?=$|[?#])/, '=s2048');
          if (upgraded && upgraded !== origUrl) candidateUrls.push(upgraded);
        }
        candidateUrls.push(origUrl);

        let resp = null;
        for (const u of candidateUrls) {
          resp = await fetch(u, { credentials: 'include' }).catch(() => null);
          if (!resp || !resp.ok) {
            resp = await fetch(u, { credentials: 'omit' }).catch(() => null);
          }
          if (resp && resp.ok) break;
        }
        if (!resp || !resp.ok) throw new Error(`HTTP ${resp ? resp.status : 0}`);

        const buf = await resp.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        const b64 = btoa(binary);
        let rawMime = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!rawMime || rawMime.includes('octet-stream') || !rawMime.startsWith('image/')) {
          if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
            rawMime = 'image/png';
          } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
            rawMime = 'image/jpeg';
          } else if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
            rawMime = 'image/webp';
          } else {
            rawMime = 'image/png';
          }
        }
        sendResponse({ ok: true, dataUrl: `data:${rawMime};base64,${b64}` });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
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
        let rawMime = (resp.headers.get('content-type') || '').toLowerCase();
        const lowerUrl = String(message.url || '').toLowerCase();
        if (!rawMime || rawMime.includes('octet-stream')) {
          if (lowerUrl.includes('.m4a')) rawMime = 'audio/mp4';
          else if (lowerUrl.includes('.mp3')) rawMime = 'audio/mpeg';
          else if (lowerUrl.includes('.wav')) rawMime = 'audio/wav';
          else rawMime = 'video/mp4';
        }
        sendResponse({ ok: true, dataUrl: `data:${rawMime};base64,${b64}` });
      } catch (err) {
        sendResponse({ ok: false, error: String(err?.message || err) });
      }
    })();
    return true;
  }

  if (message.type === 'HUELLAS_KEEPALIVE') {
    checkExtensionAutoReloadFromLocalServer(false);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'HUELLAS_UNTHROTTLED_SLEEP') {
    const delayMs = Math.min(Math.max(Number(message.ms) || 50, 10), 15000);
    setTimeout(() => {
      try {
        sendResponse({ ok: true });
      } catch {}
    }, delayMs);
    return true;
  }

  if (message.type === 'EXTERNAL_GEMINI_ASK_RESULT') {
    (async () => {
      await fetch('http://localhost:4200/api/gemini-web/ask-external-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      }).catch(() => {});
      await cleanupActiveExternalAskWindow(message.requestId, sender?.tab?.windowId, sender?.tab?.id);
    })();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'EXTERNAL_CHATGPT_ASK_RESULT') {
    (async () => {
      const memEntry = message.requestId ? activeExternalAskMap.get(message.requestId) : null;
      const tabIdFromSender = sender?.tab?.id || null;
      const reusedExisting = Boolean(
        (memEntry && memEntry.keepOpenOnCleanup) ||
          (tabIdFromSender && reusedExternalTabIds.has(tabIdFromSender))
      );
      await fetch('http://localhost:4200/api/chatgpt-web/ask-external-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...message,
          tabId: tabIdFromSender,
          reusedExisting,
        }),
      }).catch(() => {});
      await cleanupActiveExternalAskWindow(message.requestId, null, tabIdFromSender, {
        keepOpen: reusedExisting,
      });
    })();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'CHATGPT_MAIN_WORLD_INJECT_AND_SUBMIT' && sender?.tab?.id) {
    const tabId = sender.tab.id;
    const rawPrompt = String(message.prompt || '');
    (async () => {
      const ok = await forceSubmitPromptInChatGptTab(tabId, rawPrompt);
      sendResponse({ ok });
    })();
    return true;
  }

  if (message.type === 'EXTERNAL_COPILOT_ASK_RESULT') {
    (async () => {
      const memEntry = message.requestId ? activeExternalAskMap.get(message.requestId) : null;
      const tabIdFromSender = sender?.tab?.id || null;
      const reusedExisting = Boolean(
        (memEntry && memEntry.keepOpenOnCleanup) ||
          (tabIdFromSender && reusedExternalTabIds.has(tabIdFromSender))
      );
      await fetch('http://localhost:4200/api/copilot-web/ask-external-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...message,
          tabId: tabIdFromSender,
          reusedExisting,
        }),
      }).catch(() => {});
      await cleanupActiveExternalAskWindow(message.requestId, null, tabIdFromSender, {
        keepOpen: reusedExisting,
      });
    })();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'COPILOT_MAIN_WORLD_INJECT_AND_SUBMIT' && sender?.tab?.id) {
    const tabId = sender.tab.id;
    const rawPrompt = String(message.prompt || '');
    (async () => {
      const ok = await forceSubmitPromptInCopilotTab(tabId, rawPrompt);
      sendResponse({ ok });
    })();
    return true;
  }

  if (message.type === 'REMOTE_RENAME_COMPLETED') {
    fetch('http://localhost:4200/api/system/confirm-remote-rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    }).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'HUELLAS_RELOAD_EXTENSION') {
    sendResponse({ ok: true, reloading: true });
    setTimeout(() => {
      try {
        chrome.runtime.reload();
      } catch {}
    }, 80);
    return false;
  }

  return false;
});

// ============================================================================
// AUTO-RELOAD WATCHER & EXTERNAL GEMINI / CHATGPT BRIDGE (MODO DUO / TRIO / CUATRO)
// ============================================================================
let currentExtFingerprint = '';
let isCheckingExtFingerprint = false;
let activeExternalAskCount = 0;
let activeExternalAskWindowId = null;
let activeExternalAskTabId = null;
const activeExternalAskMap = new Map();
const verifiedExternalGeminiModels = new Map();
const reusedExternalTabIds = new Set();
const claimedExternalAskIds = new Set();
const claimedGeminiCommandIds = new Set();
let externalAskStorageChain = Promise.resolve();

function withExternalAskStorageLock(fn) {
  const next = externalAskStorageChain.then(fn, fn);
  externalAskStorageChain = next.catch(() => {});
  return next;
}

async function getStoredExternalAskMap() {
  try {
    const st = await chrome.storage.local.get(['huellasActiveExternalAsks', 'huellasActiveExternalAsk']);
    const map = { ...((st && st.huellasActiveExternalAsks) || {}) };
    if (st && st.huellasActiveExternalAsk && st.huellasActiveExternalAsk.requestId) {
      map[st.huellasActiveExternalAsk.requestId] = st.huellasActiveExternalAsk;
    }
    return map;
  } catch {
    return {};
  }
}

async function registerActiveExternalAskWindow(requestId, windowId, tabId, opts = {}) {
  if (!requestId) return;
  const keepOpenOnCleanup = Boolean(opts && opts.keepOpenOnCleanup);
  if (tabId && keepOpenOnCleanup) {
    reusedExternalTabIds.add(tabId);
  }
  const entry = {
    requestId,
    windowId: windowId || null,
    tabId: tabId || null,
    keepOpenOnCleanup,
    startedAt: Date.now(),
  };
  activeExternalAskMap.set(requestId, entry);
  if (windowId && !keepOpenOnCleanup) activeExternalAskWindowId = windowId;
  if (tabId) activeExternalAskTabId = tabId;
  await withExternalAskStorageLock(async () => {
    const map = await getStoredExternalAskMap();
    map[requestId] = entry;
    await chrome.storage.local
      .set({ huellasActiveExternalAsks: map, huellasActiveExternalAsk: entry })
      .catch(() => {});
  });
}

async function cleanupActiveExternalAskWindow(requestId, fallbackWinId, fallbackTabId, opts = {}) {
  const { winId, tId, keepOpen, remainingCount } = await withExternalAskStorageLock(async () => {
    const map = await getStoredExternalAskMap();
    const memEntry = requestId ? activeExternalAskMap.get(requestId) : null;
    const storedEntry = requestId ? map[requestId] : null;
    const wasAlreadyCleaned = Boolean(requestId && !memEntry && !storedEntry);
    const resolvedWinId =
      (memEntry && memEntry.windowId) ||
      (storedEntry && storedEntry.windowId) ||
      fallbackWinId ||
      (!requestId ? activeExternalAskWindowId : null) ||
      null;
    const resolvedTabId =
      (memEntry && memEntry.tabId) ||
      (storedEntry && storedEntry.tabId) ||
      fallbackTabId ||
      (!requestId ? activeExternalAskTabId : null) ||
      null;
    const shouldKeepOpen = Boolean(
      (opts && opts.keepOpen) ||
        wasAlreadyCleaned ||
        (memEntry && memEntry.keepOpenOnCleanup) ||
        (storedEntry && storedEntry.keepOpenOnCleanup) ||
        (resolvedTabId && reusedExternalTabIds.has(resolvedTabId))
    );

    if (requestId) {
      activeExternalAskMap.delete(requestId);
      delete map[requestId];
    }
    if (activeExternalAskWindowId === resolvedWinId) activeExternalAskWindowId = null;
    if (activeExternalAskTabId === resolvedTabId) activeExternalAskTabId = null;

    await chrome.storage.local
      .set({ huellasActiveExternalAsks: map })
      .catch(() => {});
    await chrome.storage.local.remove('huellasActiveExternalAsk').catch(() => {});
    return {
      winId: resolvedWinId,
      tId: resolvedTabId,
      keepOpen: shouldKeepOpen,
      remainingCount: Object.keys(map).length + activeExternalAskMap.size,
    };
  });

  if (tId) {
    verifiedExternalGeminiModels.delete(tId);
    await chrome.debugger.detach({ tabId: tId }).catch(() => {});
  }
  if (!keepOpen) {
    if (winId) {
      const winTabs = await chrome.tabs.query({ windowId: winId }).catch(() => []);
      let canCloseSingleWin =
        winTabs.length === 1 &&
        !winTabs.some((t) => isHuellasUrl(t.url, t.title) || /\/notebook\//i.test(t.url || ''));
      if (canCloseSingleWin && winTabs[0]) {
        const u0 = String(winTabs[0].url || '');
        if (/gemini\.google\.com/i.test(u0)) {
          const allGem = await chrome.tabs.query({ url: 'https://gemini.google.com/*' }).catch(() => []);
          if (allGem.length <= 1) canCloseSingleWin = false;
        } else if (/chatgpt\.com|chat\.openai\.com/i.test(u0)) {
          const allGpt = await chrome.tabs
            .query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] })
            .catch(() => []);
          if (allGpt.length <= 1) canCloseSingleWin = false;
        } else if (/copilot\.microsoft\.com|(^|\/\/|\.)copilot\.com/i.test(u0)) {
          const allCop = await chrome.tabs
            .query({
              url: [
                'https://copilot.microsoft.com/*',
                'https://*.copilot.microsoft.com/*',
                'https://copilot.com/*',
                'https://*.copilot.com/*',
              ],
            })
            .catch(() => []);
          if (allCop.length <= 1) canCloseSingleWin = false;
        }
      }
      if (canCloseSingleWin) {
        await chrome.windows.remove(winId).catch(() => {});
      }
    }
    if (tId) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const stillOpen = await chrome.tabs.get(tId).catch(() => null);
        if (!stillOpen) break;
        // Never close the user's Huellas Master or Notebook tab, and NEVER close the last remaining Gemini, ChatGPT, or Copilot tab
        const stillUrl = String(stillOpen.url || '');
        if (isHuellasUrl(stillUrl, stillOpen.title) || /\/notebook\//i.test(stillUrl)) {
          break;
        }
        if (/gemini\.google\.com/i.test(stillUrl)) {
          const allGem = await chrome.tabs.query({ url: 'https://gemini.google.com/*' }).catch(() => []);
          if (allGem.length <= 1) break;
        } else if (/chatgpt\.com|chat\.openai\.com/i.test(stillUrl)) {
          const allGpt = await chrome.tabs
            .query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] })
            .catch(() => []);
          if (allGpt.length <= 1) break;
        } else if (/copilot\.microsoft\.com|(^|\/\/|\.)copilot\.com/i.test(stillUrl)) {
          const allCop = await chrome.tabs
            .query({
              url: [
                'https://copilot.microsoft.com/*',
                'https://*.copilot.microsoft.com/*',
                'https://copilot.com/*',
                'https://*.copilot.com/*',
              ],
            })
            .catch(() => []);
          if (allCop.length <= 1) break;
        }
        await chrome.tabs.remove(tId).catch(() => {});
        await sleep(180);
      }
    }
  }

  // If an extension reload was deferred while this temporary tab/window was running, execute it safely once none remain
  if (remainingCount === 0) {
    try {
      const st = await chrome.storage.local.get('huellasPendingDeferredReload');
      if (st && st.huellasPendingDeferredReload) {
        await chrome.storage.local.remove('huellasPendingDeferredReload');
        setTimeout(() => {
          try {
            chrome.runtime.reload();
          } catch {}
        }, 250);
      }
    } catch {}
  }
}

async function runPendingGeminiCommandOrder(cmd) {
  if (!cmd || !cmd.action) return;
  let targetTab = null;
  let finalCmd = cmd;

  if (cmd.action === 'SEND_PROMPT') {
    const presence = await getHuellasBrowserProfilePresence().catch(() => null);
    const anchorWinId =
      presence && typeof presence.anchorWindowId === 'number' ? presence.anchorWindowId : null;
    const resolved = await acquireGeminiTargetTabWithWindowPolicy(cmd, anchorWinId);
    targetTab = resolved.targetTab;
    finalCmd = resolved.finalPayload || cmd;
  }

  if (!targetTab || !targetTab.id) {
    const rawGeminiTabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
    const geminiTabs = await filterOutExternalAskTabs(rawGeminiTabs);
    const { targetChatId } = await resolveDesiredGeminiChatTarget(cmd);
    targetTab =
      (targetChatId &&
        geminiTabs.find((t) => extractGeminiAppChatId(t.url || '') === targetChatId)) ||
      geminiTabs[0] ||
      null;
    if (!targetTab || !targetTab.id) {
      const initialUrl = targetChatId
        ? `https://gemini.google.com/app/${targetChatId}`
        : 'https://gemini.google.com/notebook/5989f0d1-34c7-480e-af01-07f2ef1ee39f';
      const createdWin = await chrome.windows.create({
        url: initialUrl,
        focused: false,
        type: 'normal',
      });
      targetTab = (createdWin && Array.isArray(createdWin.tabs) && createdWin.tabs[0]) || null;
      if (targetTab && targetTab.id) {
        await waitForGeminiTabLoadComplete(targetTab.id, 16000);
        await sleep(2200);
        targetTab = (await chrome.tabs.get(targetTab.id).catch(() => null)) || targetTab;
      }
    }
    if (cmd.action === 'SEND_PROMPT' && targetTab && targetTab.id) {
      finalCmd = await prePositionGeminiTabForOrder(targetTab, cmd);
    }
  }

  if (!targetTab || !targetTab.id) return;
  const tabId = targetTab.id;
  if (finalCmd.remoteStage) {
    await chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});
    await chrome.storage.local
      .set({
        [`huellasRemoteStage_${tabId}`]: {
          commandId: finalCmd.remoteCommandId || finalCmd.commandId,
          docId: finalCmd.docId,
          stageNumber: finalCmd.stageNumber,
          isDeepResearch: Boolean(finalCmd.enableDeepResearch),
          replacesDeletedChat: Boolean(finalCmd.replacesDeletedChat),
          startedAt: Date.now(),
        },
      })
      .catch(() => {});
  }
  await ensureScriptInjected(tabId, 'gemini-content.js');
  await sleep(250);
  await chrome.tabs.sendMessage(tabId, {
    target: 'GEMINI',
    ...finalCmd,
  });
}

async function forwardRemoteStageResultIfAny(message, sender) {
  const tabId = sender?.tab?.id;
  if (!tabId) return { isRemote: false };
  const key = `huellasRemoteStage_${tabId}`;
  let info = null;
  try {
    const st = await chrome.storage.local.get(key);
    info = st && st[key];
  } catch {}
  if (!info || !info.commandId) return { isRemote: false };
  // Keep tab marker alive during Stage 8 multi-turn continuations; consume it only on the final turn
  if (!message.isPartialContinuation) {
    await chrome.storage.local.remove(key).catch(() => {});
  }
  if (Date.now() - Number(info.startedAt || 0) > 2 * 60 * 60 * 1000) {
    return { isRemote: false };
  }
  const body = JSON.stringify({
    remoteCommandId: info.commandId,
    docId: info.docId,
    stageNumber: message.stageNumber || info.stageNumber,
    isDeepResearch: Boolean(info.isDeepResearch),
    replacesDeletedChat: Boolean(info.replacesDeletedChat),
    isPartialContinuation: Boolean(message.isPartialContinuation),
    continuationRound: Number(message.continuationRound || 0),
    text: message.text || '',
    chatUrl: sender?.tab?.url || '',
  });
  let saved = false;
  for (let attempt = 0; attempt < 6 && !saved; attempt++) {
    try {
      const r = await fetch('http://localhost:4200/api/gemini-web/remote-stage-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (r.ok) {
        saved = true;
        break;
      }
    } catch {}
    await sleep(5000 * (attempt + 1));
  }
  return { isRemote: true, saved, docId: info.docId };
}

async function inspectGeminiTabLatestResponse(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const isVisible = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const stopSelectors = [
          'button[aria-label*="Stop" i]',
          'button[aria-label*="Detener" i]',
          'button[aria-label*="Interrumpir" i]',
          'button.stop-button',
          'button.send-button.stop',
          '.send-button-container.stop button',
        ];
        let generating = false;
        for (const sel of stopSelectors) {
          if (isVisible(document.querySelector(sel))) {
            generating = true;
            break;
          }
        }
        if (
          !generating &&
          document.querySelectorAll(
            'model-response[is-streaming="true"], message-content[is-streaming="true"], .markdown.streaming, model-response mat-progress-bar, model-response mat-spinner'
          ).length > 0
        ) {
          generating = true;
        }
        const nodes = document.querySelectorAll('model-response, [data-message-author-role="model"]');
        const count = nodes.length;
        let text = '';
        let hasActionBar = false;
        if (count > 0) {
          const lastNode = nodes[count - 1];
          hasActionBar = Boolean(
            lastNode.querySelector(
              'message-actions, .message-actions, button[aria-label*="Copiar" i], button[aria-label*="Copy" i], mat-icon[fonticon*="thumb_up" i], mat-icon[data-mat-icon-name*="thumb_up" i], mat-icon[fonticon*="content_copy" i], mat-icon[data-mat-icon-name*="content_copy" i]'
            )
          );
          const msgContents = Array.from(
            lastNode.querySelectorAll('message-content, .model-response-text')
          ).filter(
            (n, idx, arr) =>
              !n.closest('model-thoughts, .thoughts-container, .thoughts-content, [data-test-id*="thought" i]') &&
              !arr.some((other) => other !== n && other.contains(n))
          );
          if (msgContents.length > 0) {
            text = msgContents
              .map((mc) => {
                const c = mc.cloneNode(true);
                c.querySelectorAll(
                  'model-thoughts, .thoughts-container, .thoughts-content, [data-test-id*="thought" i], message-actions, .message-actions, button, script, style, svg'
                ).forEach((el) => el.remove());
                return (c.innerText || c.textContent || '').trim();
              })
              .filter(Boolean)
              .join('\n\n')
              .replace(/^(?:Gemini said|Gemini dijo)\s*/i, '')
              .trim();
          }
          // If <model-response> exists but <message-content> is still empty, Argon High is still in the thinking phase
          if (!text && !hasActionBar) {
            generating = true;
          }
        }
        const userQueries = document.querySelectorAll(
          'user-query, [data-message-author-role="user"]'
        ).length;
        const hasComposer = Boolean(
          document.querySelector(
            'rich-textarea div.ql-editor[contenteditable="true"], div[contenteditable="true"][role="textbox"], textarea'
          )
        );
        let modeLabel = '';
        const modeBtn =
          document.querySelector(
            'bard-mode-switcher button, [data-test-id*="bard-mode" i] button, button[data-test-id*="bard-mode" i], button[aria-label*="mode picker" i], button[aria-label*="selector de modo" i]'
          ) || null;
        if (modeBtn) {
          const aria = (modeBtn.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
          const inner = (modeBtn.innerText || modeBtn.textContent || '').replace(/\s+/g, ' ').trim();
          modeLabel = [aria, inner].filter(Boolean).join(' · ');
        }
        return {
          generating,
          count,
          userQueries,
          hasComposer,
          modeLabel,
          text,
          hasActionBar,
          url: window.location.href,
        };
      },
    });
    return (results && results[0] && results[0].result) || null;
  } catch {
    return null;
  }
}

async function forceSubmitPromptInGeminiTab(tabId, rawPrompt) {
  const cleanPrompt = String(rawPrompt || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('   |   ')
    .trim();
  if (!tabId || !cleanPrompt) return false;

  try {
    // Step 1: Close any stuck CDK overlay backdrop & inject/click in MAIN world
    const mainRes = await chrome.scripting
      .executeScript({
        target: { tabId },
        world: 'MAIN',
        args: [cleanPrompt],
        func: (promptText) => {
          try {
            document
              .querySelectorAll('.cdk-overlay-backdrop')
              .forEach((b) => b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
          } catch {}

          const inputEl = document.querySelector(
            'rich-textarea div.ql-editor[contenteditable="true"], div.ql-editor[contenteditable="true"], div[contenteditable="true"][role="textbox"], textarea'
          );
          if (!inputEl) return { ok: false, reason: 'no_input' };

          const findSendBtn = () => {
            const sels = [
              'button.send-button:not([disabled]):not([aria-disabled="true"])',
              '.send-button-container button:not([disabled]):not([aria-disabled="true"])',
              'button[data-test-id*="send" i]:not([disabled]):not([aria-disabled="true"])',
              'button[aria-label*="Send message" i]:not([disabled]):not([aria-disabled="true"])',
              'button[aria-label*="Enviar mensaje" i]:not([disabled]):not([aria-disabled="true"])',
              'button[aria-label*="Send" i]:not([disabled]):not([aria-disabled="true"])',
              'button[aria-label*="Enviar" i]:not([disabled]):not([aria-disabled="true"])',
            ];
            for (const s of sels) {
              const b = document.querySelector(s);
              if (b && b.offsetParent !== null) return b;
            }
            return null;
          };

          inputEl.focus();
          const richHost = inputEl.closest('rich-textarea');
          const quillInst = inputEl.__quill || (richHost && richHost.__quill);
          if (quillInst && typeof quillInst.setText === 'function') {
            try {
              quillInst.setText(promptText, 'user');
            } catch {}
          }

          try {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(inputEl);
            sel.removeAllRanges();
            sel.addRange(range);
            const dt = new DataTransfer();
            dt.setData('text/plain', promptText);
            inputEl.dispatchEvent(
              new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                composed: true,
                clipboardData: dt,
              })
            );
          } catch {}

          if (!findSendBtn()) {
            try {
              const sel = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(inputEl);
              sel.removeAllRanges();
              sel.addRange(range);
              document.execCommand('insertText', false, promptText);
            } catch {}
          }

          const curTxt = (inputEl.value ?? inputEl.innerText ?? inputEl.textContent ?? '').trim();
          if (!curTxt || curTxt.length < Math.min(15, promptText.length)) {
            let p = inputEl.querySelector('p');
            if (!p) {
              p = document.createElement('p');
              inputEl.appendChild(p);
            }
            p.textContent = promptText;
          }
          inputEl.classList.remove('ql-blank');
          for (const t of [inputEl, richHost].filter(Boolean)) {
            t.dispatchEvent(
              new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                composed: true,
                inputType: 'insertText',
                data: promptText,
              })
            );
            t.dispatchEvent(
              new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                composed: true,
                inputType: 'insertText',
                data: promptText,
              })
            );
            t.dispatchEvent(new Event('change', { bubbles: true }));
          }

          const sendBtn = findSendBtn();
          if (sendBtn) {
            sendBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            sendBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            sendBtn.click();
          } else {
            inputEl.dispatchEvent(
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

          const r = inputEl.getBoundingClientRect();
          const sb = sendBtn ? sendBtn.getBoundingClientRect() : null;
          return {
            ok: true,
            clickedSend: Boolean(sendBtn),
            inputX: Math.round(r.left + Math.min(80, Math.max(12, r.width / 3))),
            inputY: Math.round(r.top + Math.max(10, r.height / 2)),
            sendX: sb ? Math.round(sb.left + sb.width / 2) : 0,
            sendY: sb ? Math.round(sb.top + sb.height / 2) : 0,
          };
        },
      })
      .catch(() => null);

    await sleep(650);
    const snapAfterMain = await inspectGeminiTabLatestResponse(tabId);
    if (
      snapAfterMain &&
      (snapAfterMain.userQueries > 0 || snapAfterMain.count > 0 || snapAfterMain.generating)
    ) {
      return true;
    }

    // Step 2: Hardware CDP fallback (works in unfocused windows where synthetic events are ignored)
    const coords = (mainRes && mainRes[0] && mainRes[0].result) || null;
    const target = { tabId };
    let attached = false;
    try {
      await Promise.race([
        chrome.debugger.attach(target, '1.3'),
        sleep(500).then(() => {
          throw new Error('attach_timeout');
        }),
      ]);
      attached = true;
    } catch {
      if (await cdpSendWithTimeout(target, 'Runtime.evaluate', { expression: '1' }, 400)) {
        attached = true;
      }
    }
    if (attached) {
      try {
        await sleep(250);
        // Dismiss any overlay with Escape first
        await cdpSendWithTimeout(target, 'Input.dispatchKeyEvent', {
          type: 'rawKeyDown',
          key: 'Escape',
          code: 'Escape',
          windowsVirtualKeyCode: 27,
          nativeVirtualKeyCode: 27,
        });
        await cdpSendWithTimeout(target, 'Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Escape',
          code: 'Escape',
          windowsVirtualKeyCode: 27,
          nativeVirtualKeyCode: 27,
        });
        await sleep(120);

        if (coords && coords.inputX > 0 && coords.inputY > 0) {
          await dispatchHardwareClick(target, coords.inputX, coords.inputY).catch(() => {});
          await sleep(120);
        }

        // Clear any uncommitted text and insert via CDP Input.insertText (trusted input)
        await chrome.scripting
          .executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => {
              const el = document.querySelector(
                'rich-textarea div.ql-editor[contenteditable="true"], div[contenteditable="true"][role="textbox"], textarea'
              );
              if (!el) return;
              el.focus();
              try {
                const s = window.getSelection();
                const r = document.createRange();
                r.selectNodeContents(el);
                s.removeAllRanges();
                s.addRange(r);
                document.execCommand('delete', false);
              } catch {}
            },
          })
          .catch(() => {});

        await cdpSendWithTimeout(target, 'Input.insertText', { text: cleanPrompt }, 800);
        await sleep(300);

        // Click the newly-enabled send button directly in MAIN world first (works even in background/occluded tabs!),
        // and return coordinates in case hardware click fallback is also needed.
        const sbRes = await chrome.scripting
          .executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => {
              const b = document.querySelector(
                'button.send-button:not([disabled]):not([aria-disabled="true"]), .send-button-container button:not([disabled]):not([aria-disabled="true"]), button[data-test-id*="send" i]:not([disabled]):not([aria-disabled="true"]), button[aria-label*="Send" i]:not([disabled]):not([aria-disabled="true"]), button[aria-label*="Enviar" i]:not([disabled]):not([aria-disabled="true"])'
              );
              if (!b) return null;
              try {
                b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                b.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                b.click();
              } catch {}
              const r = b.getBoundingClientRect();
              if (r.width <= 0 || r.height <= 0) return { clickedDom: true, x: 0, y: 0 };
              return { clickedDom: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            },
          })
          .catch(() => null);
        const sbCoords = (sbRes && sbRes[0] && sbRes[0].result) || null;
        await sleep(450);
        const snapAfterDomClick = await inspectGeminiTabLatestResponse(tabId);
        const alreadySubmitted = Boolean(
          snapAfterDomClick &&
            (snapAfterDomClick.userQueries > 0 || snapAfterDomClick.count > 0 || snapAfterDomClick.generating)
        );
        if (!alreadySubmitted) {
          if (sbCoords && sbCoords.x > 0 && sbCoords.y > 0) {
            await dispatchHardwareClick(target, sbCoords.x, sbCoords.y).catch(() => {});
          } else {
            await cdpSendWithTimeout(target, 'Input.dispatchKeyEvent', {
              type: 'rawKeyDown',
              key: 'Enter',
              code: 'Enter',
              windowsVirtualKeyCode: 13,
              nativeVirtualKeyCode: 13,
            });
            await cdpSendWithTimeout(target, 'Input.dispatchKeyEvent', {
              type: 'keyUp',
              key: 'Enter',
              code: 'Enter',
              windowsVirtualKeyCode: 13,
              nativeVirtualKeyCode: 13,
            });
          }
        }
      } finally {
        await chrome.debugger.detach(target).catch(() => {});
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function runExternalGeminiAskOrder(task) {
  if (task.prompt === '__READ_CURRENT__') {
    const geminiTabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
    const preferredTab =
      (activeExternalAskTabId && geminiTabs.find((t) => t.id === activeExternalAskTabId)) ||
      geminiTabs[geminiTabs.length - 1] ||
      geminiTabs[0] ||
      null;
    if (!preferredTab || !preferredTab.id) {
      await fetch('http://localhost:4200/api/gemini-web/ask-external-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: task.id, ok: false, error: 'No hay pestaña de Gemini abierta.' }),
      }).catch(() => {});
      return;
    }
    const snap = await inspectGeminiTabLatestResponse(preferredTab.id);
    await fetch('http://localhost:4200/api/gemini-web/ask-external-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: task.id,
        ok: Boolean(snap && snap.text),
        response: (snap && snap.text) || '',
        chatUrl: (snap && snap.url) || preferredTab.url || '',
      }),
    }).catch(() => {});
    return;
  }

  activeExternalAskCount += 1;
  let createdWindowId = null;
  let tabId = null;
  try {
    const opened = await createTemporaryTabInAppWindow('https://gemini.google.com/app');
    createdWindowId = opened.createdWindowId;
    tabId = opened.tabId;

    await registerActiveExternalAskWindow(task.id, createdWindowId, tabId);
    fetch('http://localhost:4200/api/gemini-web/ask-external-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: task.id,
        windowId: createdWindowId,
        tabId,
        hasAppWindow: opened.hasAppWindow,
        hasWorkspace: true,
      }),
    }).catch(() => {});

    // Wait until the new Gemini window/tab finishes loading https://gemini.google.com/app AND mounts the composer
    for (let w = 0; w < 35; w++) {
      await sleep(400);
      const tInfo = await chrome.tabs.get(tabId).catch(() => null);
      if (tInfo && tInfo.status === 'complete' && /^https:\/\/gemini\.google\.com\/app/.test(tInfo.url || '')) {
        const snapReady = await inspectGeminiTabLatestResponse(tabId);
        if (snapReady && snapReady.hasComposer) {
          break;
        }
      }
    }
    await sleep(600);

    const orderPayload = {
      target: 'GEMINI',
      action: 'ASK_EXTERNAL_CARBON_LOW',
      thinkingLevel: 'LOW',
      requestId: task.id,
      prompt: task.prompt,
    };
    let deliveredAck = false;
    for (let tryIdx = 0; tryIdx < 10; tryIdx++) {
      await ensureScriptInjected(tabId, 'gemini-content.js');
      await sleep(350);
      const ack = await chrome.tabs.sendMessage(tabId, orderPayload).catch(() => null);
      if (ack && ack.handled) {
        deliveredAck = true;
        break;
      }
      await sleep(450);
    }

    if (!deliveredAck) {
      const snapCheck = await inspectGeminiTabLatestResponse(tabId);
      const lbl = String((snapCheck && snapCheck.modeLabel) || '');
      const alreadyCarbonLow =
        /\b(carbon|argon)\b/i.test(lbl) && /\b(low|bajo)\b/i.test(lbl) && !/\b(high|alto|medium|medio|flash)\b/i.test(lbl);
      if (!alreadyCarbonLow) {
        await fetch('http://localhost:4200/api/gemini-web/ask-external-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: task.id,
            ok: false,
            verifiedModel: lbl || 'sin_confirmar',
            error: `No se pudo inyectar el selector de 4 Carbon · Low en Gemini Web (quedó en "${
              lbl || 'desconocido'
            }"). Envío bloqueado para evitar usar un modelo distinto.`,
          }),
        }).catch(() => {});
        return;
      }
      await forceSubmitPromptInGeminiTab(tabId, task.prompt);
    }

    let stableDoneTicks = 0;
    let lastText = '';
    for (let i = 0; i < 150; i++) {
      await sleep(2000);
      await chrome.runtime.getPlatformInfo().catch(() => null);
      if (!pendingExternalCheckActive(task.id)) break;
      const tStillExists = await chrome.tabs.get(tabId).catch(() => null);
      if (!tStillExists) break;
      const snap = await inspectGeminiTabLatestResponse(tabId);
      if (!snap) continue;
      if (
        snap.userQueries === 0 &&
        snap.count === 0 &&
        !snap.generating &&
        (i === 6 || i === 12) &&
        /\b(carbon|argon)\b/i.test(String(snap.modeLabel || '')) &&
        !/\b(high|alto|medium|medio|flash)\b/i.test(String(snap.modeLabel || ''))
      ) {
        await forceSubmitPromptInGeminiTab(tabId, task.prompt);
        continue;
      }
      if (snap.count > 0 && !snap.generating && snap.text.trim().length > 2) {
        if (snap.text === lastText) {
          stableDoneTicks += 1;
        } else {
          lastText = snap.text;
          stableDoneTicks = 1;
        }
        if (stableDoneTicks >= 3) {
          const resolvedGemModel =
            verifiedExternalGeminiModels.get(tabId) ||
            (/\blow|bajo\b/i.test(String(snap.modeLabel || '')) ? snap.modeLabel : '') ||
            '4 Carbon · Low';
          await fetch('http://localhost:4200/api/gemini-web/ask-external-result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requestId: task.id,
              ok: true,
              verifiedModel: resolvedGemModel,
              response: snap.text,
              chatUrl: snap.url,
            }),
          }).catch(() => {});
          return;
        }
      } else {
        lastText = snap.text || '';
        stableDoneTicks = 0;
      }
    }
  } finally {
    activeExternalAskCount = Math.max(0, activeExternalAskCount - 1);
    if (tabId) verifiedExternalGeminiModels.delete(tabId);
    await cleanupActiveExternalAskWindow(task.id, createdWindowId, tabId);
  }
}

let latestServerActiveExternalAskIds = null;

function pendingExternalCheckActive(id) {
  if (!id || !latestServerActiveExternalAskIds) return true;
  const entry = activeExternalAskMap.get(id);
  if (entry && Date.now() - Number(entry.startedAt || 0) < 6000) return true;
  return latestServerActiveExternalAskIds.has(id);
}

async function inspectChatGptTabLatestResponse(tabId) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        if (!window.__HUELLAS_BG_RAF_PATCHED__) {
          window.__HUELLAS_BG_RAF_PATCHED__ = true;
          const nativeRAF = window.requestAnimationFrame.bind(window);
          window.requestAnimationFrame = (cb) => {
            if (document.visibilityState === 'hidden') {
              return window.setTimeout(() => cb(performance.now()), 16);
            }
            return nativeRAF(cb);
          };
        }
        const isVis = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const url = window.location.href || '';
        let blockReason = '';
        if (/\/auth\/login|auth0\.openai\.com|auth\.openai\.com/i.test(url)) {
          blockReason = 'ChatGPT Web requiere iniciar sesión en Google Chrome (https://chatgpt.com/).';
        } else if (
          document.querySelector(
            'iframe[src*="challenges.cloudflare.com" i], iframe[src*="turnstile" i], #challenge-running, #cf-challenge-running, [data-testid*="captcha" i]'
          )
        ) {
          blockReason =
            'ChatGPT Web mostró una verificación de seguridad en el navegador. Complétala manualmente o usa el prompt copiable.';
        }

        const composerSelectors = [
          '#prompt-textarea[contenteditable="true"]',
          'div#prompt-textarea',
          'textarea#prompt-textarea',
          'div.ProseMirror[contenteditable="true"]',
          'div[contenteditable="true"][role="textbox"]',
          '[data-testid="composer-text-input"] [contenteditable="true"]',
          'form textarea[placeholder]',
        ];
        let composer = null;
        for (const s of composerSelectors) {
          const el = document.querySelector(s);
          if (isVis(el)) {
            composer = el;
            break;
          }
        }

        if (!blockReason) {
          const loginBtn = Array.from(document.querySelectorAll('button, a')).find((el) => {
            if (!isVis(el)) return false;
            const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            const testId = el.getAttribute('data-testid') || '';
            return (
              testId === 'login-button' ||
              testId === 'welcome-login-button' ||
              /^(log\s*in|iniciar\s+sesi[oó]n)$/i.test(t)
            );
          });
          if (loginBtn || /\/uc(\/|$|\?)/i.test(url)) {
            blockReason =
              'No hay sesión iniciada en ChatGPT Web dentro del navegador donde está abierto Huellas Master (https://chatgpt.com/). Inicia sesión allí e inténtalo de nuevo.';
          }
        }

        const stopSelectors = [
          'button[data-testid="stop-button"]',
          'button[aria-label*="Stop streaming" i]',
          'button[aria-label*="Stop generating" i]',
          'form button[aria-label="Stop" i]',
          'form button[aria-label*="Detener" i]',
        ];
        let hasExplicitStopBtn = false;
        for (const s of stopSelectors) {
          const stopEls = document.querySelectorAll(s);
          for (const stEl of stopEls) {
            if (isVis(stEl)) {
              hasExplicitStopBtn = true;
              break;
            }
          }
          if (hasExplicitStopBtn) break;
        }
        let generating = hasExplicitStopBtn;
        if (!generating && document.querySelector('.result-streaming, [data-is-streaming="true"]')) {
          generating = true;
        }
        if (!generating) {
          const turnStates = Array.from(document.querySelectorAll('[data-talvt-turn-state]'));
          if (turnStates.length > 0) {
            const lastState = (
              turnStates[turnStates.length - 1].getAttribute('data-talvt-turn-state') || ''
            )
              .trim()
              .toLowerCase();
            if (lastState && lastState !== 'complete' && lastState !== 'completed' && lastState !== 'done') {
              generating = true;
            }
          }
        }

        let verifiedModel = 'ChatGPT Web';
        const modelBtn =
          document.querySelector('button[data-testid="model-switcher-dropdown-button"]') ||
          document.querySelector('[data-testid="model-switcher-dropdown-button"]') ||
          document.querySelector('button[aria-label*="Model selector" i]') ||
          document.querySelector('button[aria-label*="Selector de modelo" i]');
        if (isVis(modelBtn)) {
          const txt = (modelBtn.innerText || modelBtn.textContent || '').replace(/\s+/g, ' ').trim();
          if (txt) verifiedModel = txt;
        }

        const rawNodes = Array.from(
          document.querySelectorAll(
            '[data-chatgpt-search-unit-key$=":assistant"], [data-content-search-unit-key$=":assistant"], [data-markdown-text-style="assistant-message"], [data-message-author-role="assistant"], article[data-testid^="conversation-turn-"] [data-message-author-role="assistant"]'
          )
        );
        const uniqueNodes = rawNodes.filter((el, idx, arr) => el && arr.indexOf(el) === idx);
        const nodes = uniqueNodes.filter(
          (el, _i, arr) => !arr.some((other) => other !== el && other.contains(el))
        );

        const extractCleanText = (rootEl) => {
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
        };

        let text = '';
        let hasFinishActions = false;
        let hasMarkdown = false;
        if (nodes.length > 0) {
          const lastNode = nodes[nodes.length - 1];
          const turnArticle =
            lastNode.closest('article, [data-testid^="conversation-turn-"], [data-talvt-turn-state], [data-turn-key]') || lastNode;
          const turnStateAttr = (turnArticle.getAttribute('data-talvt-turn-state') || '').trim().toLowerCase();
          hasFinishActions =
            turnStateAttr === 'complete' ||
            turnStateAttr === 'completed' ||
            turnStateAttr === 'done' ||
            Boolean(
              turnArticle.querySelector(
                'button[data-testid="copy-turn-action-button"], button[data-testid="good-response-turn-action-button"], button[data-testid="bad-response-turn-action-button"], button[aria-label*="Copy" i], button[aria-label*="Copiar" i]'
              )
            );
          const mdSelector = '[data-markdown-text-style="assistant-message"], [class*="MarkdownRoot"], .markdown, .prose';
          const rawMd = [
            ...(lastNode.matches && lastNode.matches(mdSelector) ? [lastNode] : []),
            ...Array.from(lastNode.querySelectorAll(mdSelector)),
          ];
          const markdownBlocks = rawMd.filter(
            (n, _i, arr) => !arr.some((other) => other !== n && other.contains(n))
          );
          hasMarkdown = markdownBlocks.length > 0;
          if (markdownBlocks.length > 0) {
            text = markdownBlocks
              .map((b) => extractCleanText(b))
              .filter(Boolean)
              .join('\n\n')
              .trim();
          }
          if (!text) {
            text = extractCleanText(lastNode);
          }
          if (
            /^(?:\d{1,6}|thinking\.{0,3}|pensando\.{0,3}|razonando\.{0,3}|thought\s+for\s+[^\n]{1,40})$/i.test(
              text
            )
          ) {
            text = '';
          }
        }

        const userQueries = Math.max(
          document.querySelectorAll('[data-message-author-role="user"]').length,
          document.querySelectorAll(
            '[data-chatgpt-search-unit-key$=":user"], [data-content-search-unit-key$=":user"]'
          ).length,
          document.querySelectorAll('[data-turn-key]').length
        );
        if (hasFinishActions && !hasExplicitStopBtn) {
          generating = false;
        } else if (!generating && userQueries > 0 && (nodes.length === 0 || !text)) {
          generating = true;
        }

        return {
          url,
          blockReason,
          hasComposer: Boolean(composer),
          userQueries,
          generating,
          verifiedModel,
          count: nodes.length,
          hasFinishActions,
          hasMarkdown,
          text,
        };
      },
    });
    return (res && res[0] && res[0].result) || null;
  } catch {
    return null;
  }
}

async function forceSubmitPromptInChatGptTab(tabId, promptText) {
  try {
    const snapBefore = await inspectChatGptTabLatestResponse(tabId);
    const beforeUrl = (snapBefore && snapBefore.url) || '';
    const beforeUserQueries = (snapBefore && snapBefore.userQueries) || 0;
    const beforeCount = (snapBefore && snapBefore.count) || 0;

    const mainRes = await chrome.scripting
      .executeScript({
        target: { tabId },
        world: 'MAIN',
        args: [String(promptText || '')],
        func: async (rawText) => {
          if (!window.__HUELLAS_BG_RAF_PATCHED__) {
            window.__HUELLAS_BG_RAF_PATCHED__ = true;
            const nativeRAF = window.requestAnimationFrame.bind(window);
            window.requestAnimationFrame = (cb) => {
              if (document.visibilityState === 'hidden') {
                return window.setTimeout(() => cb(performance.now()), 16);
              }
              return nativeRAF(cb);
            };
          }
          // Unthrottled macrotask yield even in hidden (active: false) tabs via MessageChannel
          const yieldMacrotask = () =>
            new Promise((resolve) => {
              try {
                const mc = new MessageChannel();
                mc.port1.onmessage = () => resolve();
                mc.port2.postMessage(0);
              } catch {
                setTimeout(resolve, 16);
              }
            });
          const waitTick = async (ms) => {
            if (document.visibilityState === 'hidden') {
              const loops = Math.max(2, Math.min(8, Math.ceil(ms / 15)));
              for (let k = 0; k < loops; k++) {
                await yieldMacrotask();
              }
              return;
            }
            await new Promise((r) => setTimeout(r, ms));
          };
          const isVis = (el) => {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const composerSelectors = [
            '#prompt-textarea[contenteditable="true"]',
            'div#prompt-textarea',
            'textarea#prompt-textarea',
            'div.ProseMirror[contenteditable="true"]',
            'div[contenteditable="true"][role="textbox"]',
            '[data-testid="composer-text-input"] [contenteditable="true"]',
            'form textarea[placeholder]',
          ];
          let inputEl = null;
          for (const s of composerSelectors) {
            const el = document.querySelector(s);
            if (isVis(el)) {
              inputEl = el;
              break;
            }
          }
          if (!inputEl) return { ok: false };
          inputEl.focus();

          const normalizedTarget = String(rawText || '').replace(/\s+/g, ' ').trim();
          const expectedPrefix = normalizedTarget.slice(0, Math.min(28, normalizedTarget.length));

          if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
            const setter = Object.getOwnPropertyDescriptor(
              window.HTMLTextAreaElement.prototype,
              'value'
            )?.set;
            if (setter) setter.call(inputEl, rawText);
            else inputEl.value = rawText;
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            // 1. Primary path (works 100% in active: false hidden tabs without OS focus): direct ProseMirror state transaction
            let pmApplied = false;
            try {
              const pmHost =
                (inputEl.pmViewDesc && inputEl) ||
                inputEl.closest('.ProseMirror') ||
                inputEl.querySelector('.ProseMirror');
              const pmView = pmHost && pmHost.pmViewDesc && pmHost.pmViewDesc.view;
              if (pmView && pmView.state && pmView.dispatch) {
                const { state } = pmView;
                const schema = state.schema;
                let tr = state.tr;
                if (schema && schema.nodes && schema.nodes.paragraph) {
                  const lines = String(rawText || '').split('\n');
                  const paras = lines.map((line) =>
                    line.length > 0
                      ? schema.nodes.paragraph.create(null, schema.text(line))
                      : schema.nodes.paragraph.create()
                  );
                  tr = state.tr.replaceWith(0, state.doc.content.size, paras);
                } else {
                  tr = state.tr.insertText(String(rawText || ''), 0, state.doc.content.size);
                }
                pmView.dispatch(tr);
                inputEl.dispatchEvent(
                  new InputEvent('input', { bubbles: true, inputType: 'insertText', data: rawText })
                );
                await waitTick(45);
                const afterPm = (inputEl.innerText || inputEl.textContent || '').replace(/\s+/g, ' ').trim();
                if (afterPm && (!expectedPrefix || afterPm.startsWith(expectedPrefix))) {
                  pmApplied = true;
                }
              }
            } catch {}

            if (!pmApplied) {
              try {
                const sel = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(inputEl);
                sel.removeAllRanges();
                sel.addRange(range);
                document.execCommand('delete', false);
              } catch {}
              if (((inputEl.innerText || inputEl.textContent || '').trim()).length > 0) {
                inputEl.innerHTML = '<p><br></p>';
                inputEl.dispatchEvent(
                  new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' })
                );
                await waitTick(45);
              }

              // 2. Dispatch synthetic paste with DataTransfer
              try {
                inputEl.focus();
                const sel = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(inputEl);
                sel.removeAllRanges();
                sel.addRange(range);
                const dt = new DataTransfer();
                dt.setData('text/plain', String(rawText || ''));
                const pasteEvt = new ClipboardEvent('paste', {
                  bubbles: true,
                  cancelable: true,
                  clipboardData: dt,
                });
                inputEl.dispatchEvent(pasteEvt);
                await waitTick(60);
              } catch {}

              let curNorm = (inputEl.innerText || inputEl.textContent || '').replace(/\s+/g, ' ').trim();
              if (!curNorm || (expectedPrefix && !curNorm.startsWith(expectedPrefix))) {
                try {
                  const sel = window.getSelection();
                  const range = document.createRange();
                  range.selectNodeContents(inputEl);
                  sel.removeAllRanges();
                  sel.addRange(range);
                  document.execCommand('insertText', false, rawText);
                } catch {}
                curNorm = (inputEl.innerText || inputEl.textContent || '').replace(/\s+/g, ' ').trim();
              }

              if (!curNorm || (expectedPrefix && !curNorm.startsWith(expectedPrefix))) {
                inputEl.innerHTML = '';
                for (const line of String(rawText || '').split('\n')) {
                  const p = document.createElement('p');
                  if (line.length > 0) p.textContent = line;
                  else p.appendChild(document.createElement('br'));
                  inputEl.appendChild(p);
                }
                inputEl.dispatchEvent(
                  new InputEvent('input', { bubbles: true, inputType: 'insertText', data: rawText })
                );
              }
            }
          }

          const findSend = () => {
            const sels = [
              'button[data-testid="send-button"]',
              'button[aria-label*="Send prompt" i]',
              'button[aria-label*="Enviar mensaje" i]',
              'button[aria-label*="Enviar prompt" i]',
              'button[aria-label="Send" i]',
              'button[aria-label="Enviar" i]',
              'form button[type="submit"]',
            ];
            for (const s of sels) {
              const b = document.querySelector(s);
              if (b && isVis(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true') return b;
            }
            return null;
          };

          let clickedSend = false;
          let sendBtn = findSend();
          for (let w = 0; w < 10 && !sendBtn; w++) {
            await waitTick(30);
            sendBtn = findSend();
          }
          if (sendBtn) {
            sendBtn.click();
            clickedSend = true;
          } else {
            const form = inputEl.closest('form');
            if (form && typeof form.requestSubmit === 'function') {
              try {
                form.requestSubmit();
                clickedSend = true;
              } catch {}
            }
            if (!clickedSend) {
              inputEl.dispatchEvent(
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

          const r = inputEl.getBoundingClientRect();
          const sb = sendBtn ? sendBtn.getBoundingClientRect() : null;
          return {
            ok: true,
            clickedSend,
            inputX: Math.round(r.left + Math.min(80, Math.max(12, r.width / 3))),
            inputY: Math.round(r.top + Math.max(10, r.height / 2)),
            sendX: sb ? Math.round(sb.left + sb.width / 2) : 0,
            sendY: sb ? Math.round(sb.top + sb.height / 2) : 0,
          };
        },
      })
      .catch(() => null);

    for (const waitMs of [550, 750]) {
      await sleep(waitMs);
      const snapAfterMain = await inspectChatGptTabLatestResponse(tabId);
      if (
        snapAfterMain &&
        (snapAfterMain.generating ||
          snapAfterMain.userQueries > beforeUserQueries ||
          snapAfterMain.count > beforeCount ||
          (snapAfterMain.url && snapAfterMain.url !== beforeUrl && /\/c\/[a-z0-9-]+/i.test(snapAfterMain.url)))
      ) {
        return true;
      }
      // Also check if clicking send already emptied the composer (meaning submission is in flight; do NOT re-insert a duplicate draft!)
      const composerRemainingRes = await chrome.scripting
        .executeScript({
          target: { tabId },
          world: 'MAIN',
          func: () => {
            const el =
              document.querySelector('#prompt-textarea[contenteditable="true"]') ||
              document.querySelector('div#prompt-textarea') ||
              document.querySelector('textarea#prompt-textarea') ||
              document.querySelector('div.ProseMirror[contenteditable="true"]') ||
              document.querySelector('div[contenteditable="true"][role="textbox"]');
            if (!el) return -1;
            const val = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? el.value : el.innerText || el.textContent;
            return String(val || '').trim().length;
          },
        })
        .catch(() => null);
      const remainingLen =
        composerRemainingRes && composerRemainingRes[0] && typeof composerRemainingRes[0].result === 'number'
          ? composerRemainingRes[0].result
          : -1;
      if (remainingLen === 0) {
        return true;
      }
    }

    // Hardware CDP fallback (guarded with cdpSendWithTimeout so occluded macOS windows never hang)
    const coords = (mainRes && mainRes[0] && mainRes[0].result) || null;
    const target = { tabId };
    let attached = false;
    try {
      await Promise.race([
        chrome.debugger.attach(target, '1.3'),
        sleep(500).then(() => {
          throw new Error('attach_timeout');
        }),
      ]);
      attached = true;
    } catch {
      if (await cdpSendWithTimeout(target, 'Runtime.evaluate', { expression: '1' }, 450)) {
        attached = true;
      }
    }
    if (attached) {
      try {
        await cdpSendWithTimeout(target, 'Emulation.setFocusEmulationEnabled', { enabled: true }, 450).catch(() => {});
        await sleep(150);
        if (coords && coords.inputX > 0 && coords.inputY > 0) {
          await dispatchHardwareClick(target, coords.inputX, coords.inputY).catch(() => {});
          await sleep(100);
        }
        await chrome.scripting
          .executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => {
              const el =
                document.querySelector('#prompt-textarea[contenteditable="true"]') ||
                document.querySelector('div#prompt-textarea') ||
                document.querySelector('textarea#prompt-textarea') ||
                document.querySelector('div.ProseMirror[contenteditable="true"]') ||
                document.querySelector('div[contenteditable="true"][role="textbox"]');
              if (!el) return;
              el.focus();
              if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                el.value = '';
                el.dispatchEvent(new Event('input', { bubbles: true }));
              } else {
                el.innerHTML = '<p><br></p>';
                el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
              }
            },
          })
          .catch(() => {});
        await sleep(80);
        await cdpSendWithTimeout(target, 'Input.insertText', { text: String(promptText || '') }, 600).catch(() => {});
        await sleep(240);

        const btnCoordsRes = await chrome.scripting
          .executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => {
              const sels = [
                'button[data-testid="send-button"]',
                'button[aria-label*="Send prompt" i]',
                'button[aria-label*="Enviar mensaje" i]',
                'button[aria-label*="Enviar prompt" i]',
                'button[aria-label="Send" i]',
                'button[aria-label="Enviar" i]',
                'form button[type="submit"]',
              ];
              for (const s of sels) {
                const b = document.querySelector(s);
                if (b && !b.disabled && b.getAttribute('aria-disabled') !== 'true') {
                  try {
                    b.click();
                  } catch {}
                  const r = b.getBoundingClientRect();
                  if (r.width > 0 && r.height > 0) {
                    return { clickedDom: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
                  }
                  return { clickedDom: true, x: 0, y: 0 };
                }
              }
              return null;
            },
          })
          .catch(() => null);
        const btnCoords = (btnCoordsRes && btnCoordsRes[0] && btnCoordsRes[0].result) || null;
        if (!btnCoords?.clickedDom && btnCoords && btnCoords.x > 0 && btnCoords.y > 0) {
          await dispatchHardwareClick(target, btnCoords.x, btnCoords.y).catch(() => {});
        } else if (!btnCoords?.clickedDom) {
          await cdpSendWithTimeout(
            target,
            'Input.dispatchKeyEvent',
            {
              type: 'rawKeyDown',
              key: 'Enter',
              code: 'Enter',
              windowsVirtualKeyCode: 13,
              nativeVirtualKeyCode: 13,
              text: '\r',
              unmodifiedText: '\r',
            },
            450
          ).catch(() => {});
          await cdpSendWithTimeout(
            target,
            'Input.dispatchKeyEvent',
            {
              type: 'keyUp',
              key: 'Enter',
              code: 'Enter',
              windowsVirtualKeyCode: 13,
              nativeVirtualKeyCode: 13,
            },
            450
          ).catch(() => {});
        }
        await sleep(350);
      } finally {
        await chrome.debugger.detach(target).catch(() => {});
      }
    }
    return true;
  } catch {
    return false;
  }
}

let chatGptAcquireLockChain = Promise.resolve();
function withChatGptAcquireLock(fn) {
  const next = chatGptAcquireLockChain.then(fn, fn);
  chatGptAcquireLockChain = next.catch(() => {});
  return next;
}

async function acquireChatGptTabForExternalAsk(requestId) {
  return withChatGptAcquireLock(async () => {
    const presence = await getHuellasBrowserProfilePresence();
    if (!presence.hasAppWindow && !presence.hasWorkspace) {
      throw new Error('Este navegador/perfil no contiene la ventana abierta de Huellas Master.');
    }

    // Collect all tabs currently running an Antigravity external ask (both in-memory and persistent storage across SW wakes)
    const busyTabIds = new Set();
    for (const [reqId, v] of activeExternalAskMap.entries()) {
      if (reqId !== requestId && v && v.tabId) busyTabIds.add(v.tabId);
    }
    const storedMap = await getStoredExternalAskMap();
    const nowMs = Date.now();
    for (const [reqId, v] of Object.entries(storedMap)) {
      if (!v || !v.tabId || reqId === requestId) continue;
      const ageMs = nowMs - Number(v.startedAt || 0);
      if (ageMs < 360000 && ((latestServerActiveExternalAskIds && latestServerActiveExternalAskIds.has(reqId)) || ageMs < 20000)) {
        busyTabIds.add(v.tabId);
      }
    }

    const openChatGptTabs = (
      await chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] }).catch(() => [])
    ).filter((t) => t && t.id && !busyTabIds.has(t.id));

    if (openChatGptTabs.length > 0) {
      const winTabCounts = new Map();
      for (const t of openChatGptTabs) {
        if (typeof t.windowId === 'number' && !winTabCounts.has(t.windowId)) {
          const wTabs = await chrome.tabs.query({ windowId: t.windowId }).catch(() => []);
          winTabCounts.set(t.windowId, wTabs.length || 99);
        }
      }
      // Prefer standalone ChatGPT window if open, then background (!active) tabs so screen never shifts, then Huellas window
      openChatGptTabs.sort((a, b) => {
        const aStandalone = winTabCounts.get(a.windowId) === 1 ? 1 : 0;
        const bStandalone = winTabCounts.get(b.windowId) === 1 ? 1 : 0;
        if (bStandalone !== aStandalone) return bStandalone - aStandalone;
        if (Boolean(a.active) !== Boolean(b.active)) return Number(Boolean(a.active)) - Number(Boolean(b.active));
        const aInAppWin = a.windowId === presence.anchorWindowId ? 1 : 0;
        const bInAppWin = b.windowId === presence.anchorWindowId ? 1 : 0;
        if (bInAppWin !== aInAppWin) return bInAppWin - aInAppWin;
        return (b.lastAccessed || b.id || 0) - (a.lastAccessed || a.id || 0);
      });

      for (const candidateTab of openChatGptTabs) {
        const tabId = candidateTab.id;
        const curSnap = await inspectChatGptTabLatestResponse(tabId);
        // If this ChatGPT tab is actively streaming/generating for another call, skip it so we don't interrupt it
        if (curSnap && curSnap.generating) {
          continue;
        }

        await chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});

        let currentPathname = '';
        try {
          currentPathname = new URL((curSnap && curSnap.url) || candidateTab.url || '').pathname;
        } catch {}
        const isAlreadyFreshNewChat =
          (currentPathname === '/' || currentPathname === '') &&
          curSnap &&
          curSnap.userQueries === 0 &&
          curSnap.count === 0 &&
          !curSnap.generating;

        if (!isAlreadyFreshNewChat) {
          // 1. Try clicking the top-level "Nuevo chat" / "New chat" button silently inside MAIN world (never activating the tab)
          const clickedNewChatRes = await chrome.scripting
            .executeScript({
              target: { tabId },
              world: 'MAIN',
              func: () => {
                const isVis = (el) => {
                  if (!el) return false;
                  const r = el.getBoundingClientRect();
                  return r.width > 0 && r.height > 0;
                };
                const exactSelectors = [
                  'header button[aria-label="Nuevo chat"]',
                  'header button[aria-label="New chat"]',
                  '[data-app-shell-titlebar] button[aria-label="Nuevo chat"]',
                  '[data-app-shell-titlebar] button[aria-label="New chat"]',
                  '[data-testid="create-new-chat-button"]',
                  'a[href="/"]',
                ];
                for (const sel of exactSelectors) {
                  const el = document.querySelector(sel);
                  if (isVis(el)) {
                    el.click();
                    return true;
                  }
                }
                const btns = Array.from(document.querySelectorAll('button, a')).filter((el) => {
                  if (!isVis(el)) return false;
                  const href = el.getAttribute('href') || '';
                  if (/^\/c\/|^\/g\//i.test(href)) return false;
                  const aria = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
                  const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                  if (/\b(en|in)\s+\S+/i.test(aria) || /\b(en|in)\s+\S+/i.test(txt)) return false;
                  return /^(?:nuevo\s+chat|new\s+chat)$/i.test(aria) || /^(?:nuevo\s+chat|new\s+chat)$/i.test(txt);
                });
                if (btns[0]) {
                  btns[0].click();
                  return true;
                }
                return false;
              },
            })
            .catch(() => null);

          const clickedNewChat = Boolean(clickedNewChatRes && clickedNewChatRes[0] && clickedNewChatRes[0].result);
          let switchedCleanly = false;
          if (clickedNewChat) {
            for (let poll = 0; poll < 8; poll++) {
              await sleep(220);
              const s = await inspectChatGptTabLatestResponse(tabId);
              let pName = '';
              try {
                pName = new URL((s && s.url) || '').pathname;
              } catch {}
              if (s && (pName === '/' || pName === '') && s.userQueries === 0 && s.count === 0 && !s.generating) {
                switchedCleanly = true;
                break;
              }
            }
          }

          if (!switchedCleanly) {
            await chrome.tabs.update(tabId, { url: 'https://chatgpt.com/' }).catch(() => {});
          }
        }

        // Register atomically inside the lock so any concurrent Antigravity chat immediately sees this tab as busy
        if (requestId) {
          await registerActiveExternalAskWindow(requestId, null, tabId, {
            keepOpenOnCleanup: true,
          });
        }
        return {
          createdWindowId: null,
          tabId,
          reusedExisting: true,
          hasAppWindow: presence.hasAppWindow,
        };
      }
    }

    // Either no ChatGPT tab is open OR another Antigravity chat is already running a call in the open ChatGPT tab:
    // open a silent background temporary tab (active: false) in the Huellas Master browser window and close it when done
    const opened = await createTemporaryTabInAppWindow('https://chatgpt.com/');
    if (requestId) {
      await registerActiveExternalAskWindow(requestId, opened.createdWindowId, opened.tabId, {
        keepOpenOnCleanup: false,
      });
    }
    return {
      createdWindowId: opened.createdWindowId,
      tabId: opened.tabId,
      reusedExisting: false,
      hasAppWindow: opened.hasAppWindow,
    };
  });
}

async function runExternalChatGptAskOrder(task) {
  if (!task || !task.id || !task.prompt) return;
  if (task.prompt === '__READ_CURRENT__') {
    const gptTabs = await chrome.tabs
      .query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] })
      .catch(() => []);
    const preferredTab = gptTabs[gptTabs.length - 1] || gptTabs[0] || null;
    if (!preferredTab || !preferredTab.id) {
      await fetch('http://localhost:4200/api/chatgpt-web/ask-external-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: task.id, ok: false, error: 'No hay pestaña de ChatGPT abierta.' }),
      }).catch(() => {});
      return;
    }
    const snap = await inspectChatGptTabLatestResponse(preferredTab.id);
    await fetch('http://localhost:4200/api/chatgpt-web/ask-external-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: task.id,
        ok: Boolean(snap && snap.text),
        reusedExisting: true,
        verifiedModel: (snap && snap.verifiedModel) || 'ChatGPT Web',
        response: (snap && snap.text) || '',
        chatUrl: (snap && snap.url) || preferredTab.url || '',
        error: snap && !snap.text ? 'Respuesta vacía en la pestaña actual de ChatGPT.' : undefined,
      }),
    }).catch(() => {});
    return;
  }
  activeExternalAskCount += 1;
  let createdWindowId = null;
  let tabId = null;
  let reusedExisting = false;
  try {
    const opened = await acquireChatGptTabForExternalAsk(task.id);
    createdWindowId = opened.createdWindowId;
    tabId = opened.tabId;
    reusedExisting = Boolean(opened.reusedExisting);

    await registerActiveExternalAskWindow(task.id, createdWindowId, tabId, {
      keepOpenOnCleanup: reusedExisting,
    });
    await fetch('http://localhost:4200/api/chatgpt-web/ask-external-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: task.id,
        windowId: createdWindowId,
        tabId,
        reusedExisting,
        hasAppWindow: opened.hasAppWindow,
        hasWorkspace: true,
      }),
    }).catch(() => {});

    for (let w = 0; w < 35; w++) {
      await sleep(400);
      const tInfo = await chrome.tabs.get(tabId).catch(() => null);
      if (tInfo && tInfo.status === 'complete' && /^https:\/\/(chatgpt\.com|chat\.openai\.com)/i.test(tInfo.url || '')) {
        const snapReady = await inspectChatGptTabLatestResponse(tabId);
        if (snapReady && snapReady.blockReason && w >= 4) {
          await fetch('http://localhost:4200/api/chatgpt-web/ask-external-result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requestId: task.id,
              ok: false,
              tabId,
              windowId: createdWindowId,
              reusedExisting,
              chatUrl: snapReady.url || tInfo.url || '',
              error: snapReady.blockReason,
            }),
          }).catch(() => {});
          return;
        }
        if (snapReady && snapReady.hasComposer) {
          break;
        }
      }
    }
    await sleep(450);

    const checkBlock = await inspectChatGptTabLatestResponse(tabId);
    if (checkBlock && checkBlock.blockReason) {
      await fetch('http://localhost:4200/api/chatgpt-web/ask-external-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: task.id,
          ok: false,
          tabId,
          windowId: createdWindowId,
          reusedExisting,
          chatUrl: checkBlock.url || '',
          error: checkBlock.blockReason,
        }),
      }).catch(() => {});
      return;
    }

    const baselineCount = (checkBlock && checkBlock.count) || 0;
    const baselineText = ((checkBlock && checkBlock.text) || '').trim();

    const orderPayload = {
      target: 'CHATGPT',
      action: 'ASK_EXTERNAL_CHATGPT',
      requestId: task.id,
      prompt: task.prompt,
    };
    let deliveredAck = false;
    for (let tryIdx = 0; tryIdx < 8; tryIdx++) {
      await ensureScriptInjected(tabId, 'chatgpt-content.js');
      await sleep(350);
      const ack = await chrome.tabs.sendMessage(tabId, orderPayload).catch(() => null);
      if (ack && ack.handled) {
        deliveredAck = true;
        break;
      }
      await sleep(400);
    }

    if (!deliveredAck) {
      await forceSubmitPromptInChatGptTab(tabId, task.prompt);
    }

    let stableDoneTicks = 0;
    let lastText = '';
    for (let i = 0; i < 150; i++) {
      await sleep(2000);
      await chrome.runtime.getPlatformInfo().catch(() => null);
      if (!pendingExternalCheckActive(task.id)) break;
      const tStillExists = await chrome.tabs.get(tabId).catch(() => null);
      if (!tStillExists) break;
      const snap = await inspectChatGptTabLatestResponse(tabId);
      if (!snap) continue;
      if (snap.blockReason) {
        await fetch('http://localhost:4200/api/chatgpt-web/ask-external-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: task.id,
            ok: false,
            tabId,
            windowId: createdWindowId,
            reusedExisting,
            chatUrl: snap.url || '',
            error: snap.blockReason,
          }),
        }).catch(() => {});
        return;
      }
      if (snap.userQueries === 0 && snap.count === 0 && !snap.generating && (i === 5 || i === 10)) {
        await forceSubmitPromptInChatGptTab(tabId, task.prompt);
        continue;
      }
      const trimmedSnapText = snap.text.trim();
      const isNewTurn =
        snap.count > baselineCount || (trimmedSnapText.length > 0 && trimmedSnapText !== baselineText);
      const readyEnough = snap.hasFinishActions ? trimmedSnapText.length >= 2 : trimmedSnapText.length >= 2;
      const neededStableTicks = snap.hasFinishActions ? 2 : 3;
      if (isNewTurn && !snap.generating && readyEnough) {
        if (snap.text === lastText) {
          stableDoneTicks += 1;
        } else {
          lastText = snap.text;
          stableDoneTicks = 1;
        }
        if (stableDoneTicks >= neededStableTicks) {
          await fetch('http://localhost:4200/api/chatgpt-web/ask-external-result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requestId: task.id,
              ok: true,
              tabId,
              windowId: createdWindowId,
              reusedExisting,
              verifiedModel: snap.verifiedModel || 'ChatGPT Web',
              response: snap.text,
              chatUrl: snap.url,
            }),
          }).catch(() => {});
          return;
        }
      } else {
        lastText = snap.text || '';
        stableDoneTicks = 0;
      }
    }
  } finally {
    activeExternalAskCount = Math.max(0, activeExternalAskCount - 1);
    await cleanupActiveExternalAskWindow(task.id, createdWindowId, tabId, {
      keepOpen: reusedExisting,
    });
  }
}

let lastResidentTabsCheckAt = 0;
let isEnsuringResidentTabs = false;

async function ensureResidentGeminiAndChatGptTabs(presence) {
  if (isEnsuringResidentTabs) return;
  if (!presence || !presence.hasAppWindow) return;
  const now = Date.now();
  if (now - lastResidentTabsCheckAt < 3500) return;
  lastResidentTabsCheckAt = now;
  isEnsuringResidentTabs = true;
  try {
    const winOpt = typeof presence.anchorWindowId === 'number' ? { windowId: presence.anchorWindowId } : {};

    // 1. Always keep at least 1 Gemini tab open and alive (autoDiscardable: false)
    const geminiTabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' }).catch(() => []);
    if (geminiTabs.length === 0) {
      const createdGem = await chrome.tabs
        .create({
          url: 'https://gemini.google.com/app',
          active: false,
          ...winOpt,
        })
        .catch(() => null);
      if (createdGem && createdGem.id) {
        await chrome.tabs.update(createdGem.id, { autoDiscardable: false }).catch(() => {});
      }
    } else if (geminiTabs[0] && geminiTabs[0].id && geminiTabs[0].autoDiscardable !== false) {
      await chrome.tabs.update(geminiTabs[0].id, { autoDiscardable: false }).catch(() => {});
    }

    // 2. Always keep at least 1 ChatGPT tab open and alive (autoDiscardable: false)
    const chatGptTabs = await chrome.tabs
      .query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] })
      .catch(() => []);
    if (chatGptTabs.length === 0) {
      const createdGpt = await chrome.tabs
        .create({
          url: 'https://chatgpt.com/',
          active: false,
          ...winOpt,
        })
        .catch(() => null);
      if (createdGpt && createdGpt.id) {
        reusedExternalTabIds.add(createdGpt.id);
        await chrome.tabs.update(createdGpt.id, { autoDiscardable: false }).catch(() => {});
      }
    } else if (chatGptTabs[0] && chatGptTabs[0].id && chatGptTabs[0].autoDiscardable !== false) {
      await chrome.tabs.update(chatGptTabs[0].id, { autoDiscardable: false }).catch(() => {});
    }
  } catch {
  } finally {
    isEnsuringResidentTabs = false;
  }
}

const COPILOT_TAB_URL_PATTERNS = [
  'https://copilot.microsoft.com/*',
  'https://*.copilot.microsoft.com/*',
  'https://copilot.com/*',
  'https://*.copilot.com/*',
  'https://m365.cloud.microsoft/*',
  'https://copilot.cloud.microsoft/*',
];

async function inspectCopilotTabLatestResponse(tabId) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: () => {
        if (!window.__HUELLAS_BG_RAF_PATCHED__) {
          window.__HUELLAS_BG_RAF_PATCHED__ = true;
          const nativeRAF = window.requestAnimationFrame.bind(window);
          window.requestAnimationFrame = (cb) => {
            if (document.visibilityState === 'hidden') {
              return window.setTimeout(() => cb(performance.now()), 16);
            }
            return nativeRAF(cb);
          };
        }
        const isVis = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const deepQueryAll = (selector, root = document) => {
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
        };

        const url = window.location.href || '';
        try {
          document
            .querySelectorAll(
              'button[data-testid="fre-text-forward-close-button"], button[aria-label="Descartar alerta" i], button[aria-label="Dismiss alert" i]'
            )
            .forEach((b) => {
              if (isVis(b)) b.click();
            });
        } catch {}
        const composerSelectors = [
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
        let composer = null;
        for (const sel of composerSelectors) {
          const els = deepQueryAll(sel);
          for (const el of els) {
            if (isVis(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true') {
              composer = el;
              break;
            }
          }
          if (composer) break;
        }

        let blockReason = '';
        if (/login\.live\.com|login\.microsoftonline\.com|account\.microsoft\.com\/auth|\/login\?/i.test(url)) {
          blockReason =
            'No hay sesión iniciada en Microsoft Copilot Web dentro de Google Chrome. Inicia sesión en la pestaña abierta de Copilot e inténtalo de nuevo.';
        } else if (
          !composer &&
          (document.querySelector('link[href*="unauth-copilotcom" i], script[src*="unauth-copilotcom" i]') ||
            (/copilot\.com\/([a-z]{2}-[a-z]{2,}\/?)?$/i.test(url) &&
              /\b(iniciar\s+sesi[oó]n|sign\s*in)\b/i.test(document.title || '')))
        ) {
          blockReason =
            'No hay sesión iniciada en Microsoft Copilot Web dentro de Google Chrome (Microsoft Copilot requiere sesión gratuita iniciada). Inicia sesión en la pestaña de Copilot y avísame.';
        } else if (
          document.querySelector(
            'iframe[src*="challenges.cloudflare.com" i], iframe[src*="turnstile" i], iframe[src*="arkoselabs" i], iframe[src*="hcaptcha" i], #challenge-running, #cf-challenge-running, [data-testid*="captcha" i]'
          ) ||
          /\b(verificaci[oó]n\s+necesaria|verification\s+required|verify\s+you\s+are\s+human)\b/i.test(
            document.body ? document.body.innerText || '' : ''
          )
        ) {
          blockReason =
            'Microsoft Copilot Web mostró una verificación de seguridad/anti-bot ("Verificación necesaria") en el navegador. Complétala manualmente en Chrome.';
        }

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
        let hasExplicitStopBtn = false;
        for (const s of stopSelectors) {
          const stopEls = deepQueryAll(s);
          for (const stEl of stopEls) {
            if (isVis(stEl) && !stEl.disabled && stEl.getAttribute('aria-disabled') !== 'true') {
              hasExplicitStopBtn = true;
              break;
            }
          }
          if (hasExplicitStopBtn) break;
        }
        let generating =
          hasExplicitStopBtn ||
          Boolean(
            document.querySelector(
              '[data-is-streaming="true"], [aria-busy="true"][data-content="ai-message"], [aria-busy="true"][class*="fai-" i]'
            )
          );

        let verifiedModel = 'Microsoft Copilot Web';
        const modeBtns = deepQueryAll(
          'button[aria-label*="Selector de modelos" i], button[aria-label*="Model selector" i], button[data-testid*="mode-selector" i], button[data-testid*="model-selector" i], button[data-testid*="composer-mode" i], button[aria-label*="Auto" i], button[aria-label*="Think Deeper" i], button[aria-label*="Quick response" i], button[aria-label*="Respuesta rápida" i], button[aria-label*="Smart" i]'
        );
        for (const mb of modeBtns) {
          if (isVis(mb)) {
            const txt = (mb.innerText || mb.textContent || mb.getAttribute('aria-label') || '')
              .replace(/\s+/g, ' ')
              .trim();
            if (txt && txt.length <= 50) {
              verifiedModel = `Microsoft Copilot Web (${txt})`;
              break;
            }
          }
        }

        const rawUserNodes = deepQueryAll(
          '[data-content="user-message"], [data-testid="user-message"], [data-testid*="user-message" i], [data-author="user"], [data-message-author-role="user"], [class*="fai-UserMessage" i], [class*="UserMessage" i], cib-message-group[source="user"]'
        );
        const uniqUsers = rawUserNodes.filter((el, idx, arr) => el && arr.indexOf(el) === idx);
        const userQueries = uniqUsers.filter(
          (el, _i, arr) => !arr.some((other) => other !== el && other.contains(el))
        ).length;

        const rawNodes = deepQueryAll(
          '[data-content="ai-message"], [data-testid="ai-message"], [data-testid="bot-message"], [data-testid*="copilot-message" i], [data-testid*="assistant-message" i], [class*="fai-CopilotMessage" i], [class*="CopilotMessage" i], [class*="fai-BotMessage" i], [class*="fai-AgentMessage" i], [role="article"][aria-label*="Copilot" i], div[class*="group/ai-message-item"], div[class*="group/ai-message"], [data-message-author-role="assistant"], cib-message-group[source="bot"]'
        );
        const uniqNodes = rawNodes.filter((el, idx, arr) => el && arr.indexOf(el) === idx);
        const nodes = uniqNodes.filter(
          (el, _i, arr) => !arr.some((other) => other !== el && other.contains(el))
        );

        const extractCleanText = (rootEl) => {
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
        };

        let text = '';
        let hasFinishActions = false;
        if (nodes.length > 0) {
          const lastNode = nodes[nodes.length - 1];
          hasFinishActions = Boolean(
            lastNode.querySelector &&
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
          if (markdownBlocks.length > 0) {
            text = markdownBlocks
              .map((b) => extractCleanText(b))
              .filter(Boolean)
              .join('\n\n')
              .trim();
          }
          if (!text) {
            text = extractCleanText(lastNode);
          }
          if (
            /^(?:thinking\.{0,3}|pensando\.{0,3}|razonando\.{0,3}|searching\.{0,3}|buscando\.{0,3}|generating\.{0,3})$/i.test(
              text
            )
          ) {
            text = '';
          }
        }

        if (!generating && userQueries > 0 && (nodes.length === 0 || !text)) {
          generating = true;
        }

        const msgBar = document.querySelector('.fui-MessageBar');
        const needsReload = Boolean(
          msgBar && isVis(msgBar) && /\b(actualice|actualizar|refresh|reload)\b/i.test(msgBar.innerText || '')
        );

        return {
          url,
          blockReason,
          needsReload,
          hasComposer: Boolean(composer),
          userQueries,
          generating,
          verifiedModel,
          count: nodes.length,
          hasFinishActions,
          text,
        };
      },
    });
    if (!Array.isArray(res) || res.length === 0) return null;
    const frames = res.map((r) => r && r.result).filter(Boolean);
    const withComposer = frames.find((f) => f.hasComposer);
    if (withComposer) return withComposer;
    const withBlock = frames.find((f) => f.blockReason);
    if (withBlock) return withBlock;
    return frames[0] || null;
  } catch {
    return null;
  }
}

async function forceSubmitPromptInCopilotTab(tabId, promptText) {
  try {
    const snapBefore = await inspectCopilotTabLatestResponse(tabId);
    const beforeUrl = (snapBefore && snapBefore.url) || '';
    const beforeUserQueries = (snapBefore && snapBefore.userQueries) || 0;
    const beforeCount = (snapBefore && snapBefore.count) || 0;

    const mainRes = await chrome.scripting
      .executeScript({
        target: { tabId, allFrames: true },
        world: 'MAIN',
        args: [String(promptText || '')],
        func: async (rawText) => {
          const isVis = (el) => {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const deepQueryAll = (selector, root = document) => {
            const out = [];
            const seen = new Set();
            const visit = (n) => {
              if (!n) return;
              try {
                for (const el of n.querySelectorAll ? n.querySelectorAll(selector) : []) {
                  if (!seen.has(el)) {
                    seen.add(el);
                    out.push(el);
                  }
                }
              } catch {}
              try {
                for (const el of n.querySelectorAll ? n.querySelectorAll('*') : []) {
                  if (el.shadowRoot) visit(el.shadowRoot);
                }
              } catch {}
            };
            visit(root);
            return out;
          };

          // Switch Auto / Smart / Think Deeper -> Quick response (Respuesta rápida)
          try {
            const modeTriggerSels = [
              'button[aria-label*="Selector de modelos" i]',
              'button[aria-label*="Model selector" i]',
              'button[data-testid*="mode-selector" i]',
              'button[data-testid*="model-selector" i]',
              'button[data-testid*="composer-mode" i]',
              'button[aria-label*="Auto" i]',
              'button[aria-label*="Think Deeper" i]',
              'button[aria-label*="Quick response" i]',
              'button[aria-label*="Respuesta rápida" i]',
              'button[aria-label*="Smart" i]',
            ];
            let mBtn = null;
            for (const ms of modeTriggerSels) {
              for (const el of deepQueryAll(ms)) {
                if (isVis(el) && !el.disabled) {
                  mBtn = el;
                  break;
                }
              }
              if (mBtn) break;
            }
            if (!mBtn) {
              for (const b of deepQueryAll('button')) {
                if (!isVis(b) || b.disabled) continue;
                const t = (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim();
                if (/^(Auto|Smart|Think Deeper|Think deeper|Profundizar)$/i.test(t)) {
                  mBtn = b;
                  break;
                }
              }
            }
            if (mBtn) {
              const curModeLabel = (mBtn.innerText || mBtn.textContent || mBtn.getAttribute('aria-label') || '')
                .replace(/\s+/g, ' ')
                .trim();
              if (!/quick\s*response|respuesta\s*r[aá]pida/i.test(curModeLabel)) {
                for (const evType of ['pointerdown', 'mousedown', 'mouseup']) {
                  mBtn.dispatchEvent(new MouseEvent(evType, { bubbles: true, cancelable: true, view: window }));
                }
                mBtn.click();
                let pickedMode = false;
                for (let poll = 0; poll < 8; poll++) {
                  await new Promise((r) => setTimeout(r, 90));
                  const items = deepQueryAll(
                    '[role="menuitem"], [role="menuitemradio"], [role="option"], [data-radix-collection-item], [data-testid*="quick" i], [class*="MenuItem" i], li, button'
                  ).filter((el) => el !== mBtn && isVis(el) && !mBtn.contains(el));
                  const matching = items.filter((el) => {
                    const txt = (el.innerText || el.textContent || el.getAttribute('aria-label') || '')
                      .replace(/\s+/g, ' ')
                      .trim();
                    return txt.length <= 140 && /quick\s*response|respuesta\s*r[aá]pida/i.test(txt);
                  });
                  const innermost = matching.filter(
                    (el, _i, arr) => !arr.some((other) => other !== el && el.contains(other))
                  );
                  const pick = innermost[0] || matching[0];
                  if (pick) {
                    for (const evType of ['pointerdown', 'mousedown', 'mouseup']) {
                      pick.dispatchEvent(new MouseEvent(evType, { bubbles: true, cancelable: true, view: window }));
                    }
                    pick.click();
                    pickedMode = true;
                    await new Promise((r) => setTimeout(r, 200));
                    break;
                  }
                }
                if (!pickedMode) {
                  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
                }
              }
            }
          } catch {}

          const composerSels = [
            '#m365-chat-editor-target-element',
            '#m365-chat-input-shared-id',
            'span#m365-chat-editor-target-element[role="textbox"]',
            'textarea#userInput',
            'textarea[data-testid="composer-input"]',
            'textarea[data-testid*="composer" i]',
            'textarea[placeholder*="Copilot" i]',
            'textarea[placeholder*="Message" i]',
            'textarea[placeholder*="Mensaje" i]',
            'textarea[placeholder*="Ask" i]',
            '#userInput[contenteditable="true"]',
            'div[role="textbox"][contenteditable="true"]',
            'span[role="textbox"][contenteditable="true"]',
            'span[role="textbox"]',
            'textarea',
          ];
          let inputEl = null;
          for (const s of composerSels) {
            for (const c of deepQueryAll(s)) {
              if (isVis(c) && !c.disabled) {
                inputEl = c;
                break;
              }
            }
            if (inputEl) break;
          }
          if (!inputEl) return { ok: false, reason: 'no_input' };

          inputEl.focus();
          if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
            const proto =
              inputEl.tagName === 'TEXTAREA'
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            const tracker = inputEl._valueTracker;
            if (tracker && typeof tracker.setValue === 'function') {
              try {
                tracker.setValue('');
              } catch {}
            }
            if (setter) setter.call(inputEl, rawText);
            else inputEl.value = rawText;
            inputEl.dispatchEvent(
              new InputEvent('input', { bubbles: true, inputType: 'insertText', data: rawText })
            );
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            try {
              const sel = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(inputEl);
              sel.removeAllRanges();
              sel.addRange(range);
              document.execCommand('delete', false);
            } catch {}
            let pastedOk = false;
            try {
              const dt = new DataTransfer();
              dt.setData('text/plain', rawText);
              inputEl.dispatchEvent(
                new ClipboardEvent('paste', {
                  bubbles: true,
                  cancelable: true,
                  clipboardData: dt,
                })
              );
              pastedOk = ((inputEl.innerText || inputEl.textContent || '').trim().length >= Math.min(8, rawText.length));
            } catch {}
            if (!pastedOk) {
              try {
                const sel = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(inputEl);
                sel.removeAllRanges();
                sel.addRange(range);
                document.execCommand('insertText', false, rawText);
              } catch {
                inputEl.textContent = rawText;
              }
              inputEl.dispatchEvent(
                new InputEvent('input', { bubbles: true, inputType: 'insertText', data: rawText })
              );
            }
          }

          await new Promise((r) => setTimeout(r, 350));

          const sendSels = [
            'button.fai-SendButton',
            'button.fai-BebopLiteChatInput__send',
            'button[data-testid="submit-button"]',
            'button[data-testid*="submit" i]',
            'button[data-testid*="send" i]',
            'button[aria-label="Submit message" i]',
            'button[aria-label*="Submit message" i]',
            'button[aria-label*="Send message" i]',
            'button[aria-label*="Enviar mensaje" i]',
            'button[aria-label*="Submit" i]',
            'button[aria-label*="Send" i]',
            'button[aria-label*="Enviar" i]',
            'button[aria-label="Send" i]',
            'button[aria-label="Enviar" i]',
            'button[title*="Submit" i]',
            'button[title*="Send" i]',
            'button[title*="Enviar" i]',
            'button[type="submit"][aria-label*="Enviar" i]',
            'button[type="submit"][aria-label*="Send" i]',
            'form button[type="submit"]',
          ];
          for (const s of sendSels) {
            for (const b of deepQueryAll(s)) {
              if (isVis(b) && !b.disabled && b.getAttribute('aria-disabled') !== 'true') {
                b.click();
                return { ok: true, clickedSend: true };
              }
            }
          }

          inputEl.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Enter',
              code: 'Enter',
              keyCode: 13,
              which: 13,
              bubbles: true,
              cancelable: true,
            })
          );
          return { ok: true, clickedSend: false };
        },
      })
      .catch(() => null);

    await sleep(900);
    const snapAfter = await inspectCopilotTabLatestResponse(tabId);
    const submittedInMain = Boolean(
      snapAfter &&
        (snapAfter.generating ||
          snapAfter.userQueries > beforeUserQueries ||
          snapAfter.count > beforeCount ||
          (snapAfter.url && snapAfter.url !== beforeUrl && /\/(chats?|c)\//i.test(snapAfter.url)))
    );

    if (!submittedInMain) {
      const tabInfo = await chrome.tabs.get(tabId).catch(() => null);
      const isHiddenTab = Boolean(tabInfo && !tabInfo.active);
      const target = { tabId };
      try {
        await chrome.debugger.attach(target, '1.3');
      } catch {}
      try {
        const inputCoordsRes = await chrome.scripting
          .executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => {
              const sels = [
                '#m365-chat-editor-target-element',
                'span#m365-chat-editor-target-element[role="textbox"]',
                'textarea#userInput',
                'textarea[data-testid="composer-input"]',
                'div[role="textbox"][contenteditable="true"]',
                'span[role="textbox"][contenteditable="true"]',
                'textarea',
              ];
              for (const s of sels) {
                const el = document.querySelector(s);
                if (el && !el.disabled) {
                  el.focus();
                  try {
                    const sel = window.getSelection();
                    const range = document.createRange();
                    range.selectNodeContents(el);
                    sel.removeAllRanges();
                    sel.addRange(range);
                    document.execCommand('delete', false);
                  } catch {}
                  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                    el.value = '';
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                  }
                  const r = el.getBoundingClientRect();
                  if (r.width > 0 && r.height > 0) {
                    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
                  }
                  return { x: 0, y: 0 };
                }
              }
              return null;
            },
          })
          .catch(() => null);
        const inputCoords = (inputCoordsRes && inputCoordsRes[0] && inputCoordsRes[0].result) || null;
        if (!isHiddenTab && inputCoords && inputCoords.x > 0 && inputCoords.y > 0) {
          await dispatchHardwareClick(target, inputCoords.x, inputCoords.y).catch(() => {});
          await sleep(100);
        }
        await chrome.scripting
          .executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => {
              const sels = [
                '#m365-chat-editor-target-element',
                'span#m365-chat-editor-target-element[role="textbox"]',
                'textarea#userInput',
                'textarea[data-testid="composer-input"]',
                'div[role="textbox"][contenteditable="true"]',
                'span[role="textbox"][contenteditable="true"]',
                'textarea',
              ];
              for (const s of sels) {
                const el = document.querySelector(s);
                if (el && !el.disabled) {
                  el.focus();
                  return true;
                }
              }
              return false;
            },
          })
          .catch(() => null);
        // Clear any leftover text inside Lexical via SelectAll + Backspace before inserting
        await cdpSendWithTimeout(
          target,
          'Input.dispatchKeyEvent',
          {
            type: 'rawKeyDown',
            key: 'a',
            code: 'KeyA',
            modifiers: 4,
            commands: ['selectAll'],
            windowsVirtualKeyCode: 65,
            nativeVirtualKeyCode: 65,
          },
          300
        ).catch(() => {});
        await cdpSendWithTimeout(
          target,
          'Input.dispatchKeyEvent',
          {
            type: 'keyUp',
            key: 'a',
            code: 'KeyA',
            windowsVirtualKeyCode: 65,
            nativeVirtualKeyCode: 65,
          },
          300
        ).catch(() => {});
        await cdpSendWithTimeout(
          target,
          'Input.dispatchKeyEvent',
          {
            type: 'rawKeyDown',
            key: 'Backspace',
            code: 'Backspace',
            windowsVirtualKeyCode: 8,
            nativeVirtualKeyCode: 8,
          },
          300
        ).catch(() => {});
        await cdpSendWithTimeout(
          target,
          'Input.dispatchKeyEvent',
          {
            type: 'keyUp',
            key: 'Backspace',
            code: 'Backspace',
            windowsVirtualKeyCode: 8,
            nativeVirtualKeyCode: 8,
          },
          300
        ).catch(() => {});
        await sleep(80);
        await cdpSendWithTimeout(target, 'Input.insertText', { text: String(promptText || '') }, 3000).catch(
          () => {}
        );
        await sleep(320);

        const btnCoordsRes = await chrome.scripting
          .executeScript({
            target: { tabId },
            world: 'MAIN',
            func: () => {
              const sels = [
                'button.fai-SendButton',
                'button.fai-BebopLiteChatInput__send',
                'button[data-testid="submit-button"]',
                'button[aria-label*="Submit message" i]',
                'button[aria-label*="Send message" i]',
                'button[aria-label*="Enviar mensaje" i]',
                'button[aria-label="Send" i]',
                'button[aria-label="Enviar" i]',
                'button[title*="Send" i]',
                'button[title*="Enviar" i]',
                'form button[type="submit"]',
              ];
              for (const s of sels) {
                const b = document.querySelector(s);
                if (b && !b.disabled && b.getAttribute('aria-disabled') !== 'true') {
                  try {
                    b.click();
                  } catch {}
                  const r = b.getBoundingClientRect();
                  if (r.width > 0 && r.height > 0) {
                    return {
                      clickedDom: true,
                      x: Math.round(r.left + r.width / 2),
                      y: Math.round(r.top + r.height / 2),
                    };
                  }
                  return { clickedDom: true, x: 0, y: 0 };
                }
              }
              return null;
            },
          })
          .catch(() => null);
        const btnCoords = (btnCoordsRes && btnCoordsRes[0] && btnCoordsRes[0].result) || null;
        if (!btnCoords?.clickedDom && btnCoords && btnCoords.x > 0 && btnCoords.y > 0) {
          await dispatchHardwareClick(target, btnCoords.x, btnCoords.y).catch(() => {});
        } else if (!btnCoords?.clickedDom) {
          await cdpSendWithTimeout(
            target,
            'Input.dispatchKeyEvent',
            {
              type: 'rawKeyDown',
              key: 'Enter',
              code: 'Enter',
              windowsVirtualKeyCode: 13,
              nativeVirtualKeyCode: 13,
              text: '\r',
              unmodifiedText: '\r',
            },
            450
          ).catch(() => {});
          await cdpSendWithTimeout(
            target,
            'Input.dispatchKeyEvent',
            {
              type: 'keyUp',
              key: 'Enter',
              code: 'Enter',
              windowsVirtualKeyCode: 13,
              nativeVirtualKeyCode: 13,
            },
            450
          ).catch(() => {});
        }
        await sleep(350);
      } finally {
        await chrome.debugger.detach(target).catch(() => {});
      }
    }
    const finalSnap = await inspectCopilotTabLatestResponse(tabId);
    return Boolean(
      submittedInMain ||
        (finalSnap &&
          (finalSnap.generating ||
            finalSnap.userQueries > beforeUserQueries ||
            finalSnap.count > beforeCount ||
            (finalSnap.url && finalSnap.url !== beforeUrl && /\/(chats?|c)\//i.test(finalSnap.url))))
    );
  } catch {
    return false;
  }
}

let copilotAcquireLockChain = Promise.resolve();
function withCopilotAcquireLock(fn) {
  const next = copilotAcquireLockChain.then(fn, fn);
  copilotAcquireLockChain = next.catch(() => {});
  return next;
}

async function acquireCopilotTabForExternalAsk(requestId) {
  return withCopilotAcquireLock(async () => {
    const presence = await getHuellasBrowserProfilePresence();
    if (!presence.hasAppWindow && !presence.hasWorkspace) {
      throw new Error('Este navegador/perfil no contiene la ventana abierta de Huellas Master.');
    }

    const busyTabIds = new Set();
    for (const [reqId, v] of activeExternalAskMap.entries()) {
      if (reqId !== requestId && v && v.tabId) busyTabIds.add(v.tabId);
    }
    const storedMap = await getStoredExternalAskMap();
    const nowMs = Date.now();
    for (const [reqId, v] of Object.entries(storedMap)) {
      if (!v || !v.tabId || reqId === requestId) continue;
      const ageMs = nowMs - Number(v.startedAt || 0);
      if (
        ageMs < 360000 &&
        ((latestServerActiveExternalAskIds && latestServerActiveExternalAskIds.has(reqId)) || ageMs < 20000)
      ) {
        busyTabIds.add(v.tabId);
      }
    }

    const openCopilotTabs = (
      await chrome.tabs.query({ url: COPILOT_TAB_URL_PATTERNS }).catch(() => [])
    ).filter((t) => t && t.id && !busyTabIds.has(t.id));

    if (openCopilotTabs.length > 0) {
      openCopilotTabs.sort((a, b) => {
        if (Boolean(a.active) !== Boolean(b.active)) return Number(Boolean(a.active)) - Number(Boolean(b.active));
        const aInAppWin = a.windowId === presence.anchorWindowId ? 1 : 0;
        const bInAppWin = b.windowId === presence.anchorWindowId ? 1 : 0;
        if (bInAppWin !== aInAppWin) return bInAppWin - aInAppWin;
        return (b.lastAccessed || b.id || 0) - (a.lastAccessed || a.id || 0);
      });

      for (const candidateTab of openCopilotTabs) {
        const tabId = candidateTab.id;
        const curSnap = await inspectCopilotTabLatestResponse(tabId);
        if (curSnap && curSnap.generating) {
          continue;
        }

        await chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});

        if (curSnap && curSnap.needsReload) {
          await chrome.tabs.update(tabId, { url: 'https://copilot.com/chat' }).catch(() => {});
          await sleep(1200);
        } else {
          const isAlreadyFreshNewChat =
            curSnap && curSnap.userQueries === 0 && curSnap.count === 0 && !curSnap.generating && curSnap.hasComposer;

          if (!isAlreadyFreshNewChat) {
            const clickedNewChatRes = await chrome.scripting
              .executeScript({
                target: { tabId },
                world: 'MAIN',
                func: () => {
                  const isVis = (el) => {
                    if (!el) return false;
                    const r = el.getBoundingClientRect();
                    return r.width > 0 && r.height > 0;
                  };
                  const selectors = [
                    'button.fai-CopilotNavItem[aria-label="Chat" i]',
                    'a.fai-CopilotNavItem[aria-label*="Nuevo chat" i]',
                    'a.fai-CopilotNavItem[aria-label*="New chat" i]',
                    'a[aria-label*="Nuevo chat" i]',
                    'a[aria-label*="New chat" i]',
                    'button[data-testid="new-chat-button"]',
                    'button[data-testid*="new-chat" i]',
                    'button[aria-label*="New chat" i]',
                    'button[aria-label*="Nuevo chat" i]',
                    'button[aria-label*="Start new chat" i]',
                    'button[title*="New chat" i]',
                    'button[title*="Nuevo chat" i]',
                    'a[data-testid*="new-chat" i]',
                  ];
                  for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (isVis(el)) {
                      el.click();
                      return true;
                    }
                  }
                  return false;
                },
              })
              .catch(() => null);

            const clickedNewChat = Boolean(clickedNewChatRes && clickedNewChatRes[0] && clickedNewChatRes[0].result);
            let switchedCleanly = false;
            if (clickedNewChat) {
              for (let poll = 0; poll < 8; poll++) {
                await sleep(250);
                const s = await inspectCopilotTabLatestResponse(tabId);
                if (s && s.userQueries === 0 && s.count === 0 && !s.generating && s.hasComposer && !s.needsReload) {
                  switchedCleanly = true;
                  break;
                }
              }
            }
            if (!switchedCleanly) {
              await chrome.tabs.update(tabId, { url: 'https://copilot.com/chat' }).catch(() => {});
            }
          }
        }

        if (requestId) {
          await registerActiveExternalAskWindow(requestId, null, tabId, {
            keepOpenOnCleanup: true,
          });
        }
        return {
          createdWindowId: null,
          tabId,
          reusedExisting: true,
          hasAppWindow: presence.hasAppWindow,
        };
      }
    }

    const opened = await createTemporaryTabInAppWindow('https://copilot.com/chat');
    if (requestId) {
      await registerActiveExternalAskWindow(requestId, opened.createdWindowId, opened.tabId, {
        keepOpenOnCleanup: false,
      });
    }
    return {
      createdWindowId: opened.createdWindowId,
      tabId: opened.tabId,
      reusedExisting: false,
      hasAppWindow: opened.hasAppWindow,
    };
  });
}

async function runExternalCopilotAskOrder(task) {
  if (!task || !task.id || !task.prompt) return;
  if (task.prompt === '__READ_CURRENT__') {
    const copTabs = await chrome.tabs.query({ url: COPILOT_TAB_URL_PATTERNS }).catch(() => []);
    if (!copTabs || copTabs.length === 0) {
      await fetch('http://localhost:4200/api/copilot-web/ask-external-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: task.id, ok: false, error: 'No hay pestaña de Copilot abierta.' }),
      }).catch(() => {});
      return;
    }
    const orderedTabs = [...copTabs].sort((a, b) => {
      const aHasChat = /\/(chats?|c)\//i.test(a.url || '') ? 1 : 0;
      const bHasChat = /\/(chats?|c)\//i.test(b.url || '') ? 1 : 0;
      if (bHasChat !== aHasChat) return bHasChat - aHasChat;
      return Number(Boolean(b.active)) - Number(Boolean(a.active));
    });
    let chosenTab = orderedTabs[0];
    let chosenSnap = null;
    for (const candidate of orderedTabs) {
      if (!candidate.id) continue;
      const s = await inspectCopilotTabLatestResponse(candidate.id);
      if (!chosenSnap) {
        chosenTab = candidate;
        chosenSnap = s;
      }
      if (s && s.text) {
        chosenTab = candidate;
        chosenSnap = s;
        break;
      }
    }
    await fetch('http://localhost:4200/api/copilot-web/ask-external-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: task.id,
        ok: Boolean(chosenSnap && chosenSnap.text),
        reusedExisting: true,
        verifiedModel: (chosenSnap && chosenSnap.verifiedModel) || 'Microsoft Copilot Web',
        response: (chosenSnap && chosenSnap.text) || '',
        chatUrl: (chosenSnap && chosenSnap.url) || chosenTab.url || '',
        error: chosenSnap && !chosenSnap.text ? 'Respuesta vacía en la pestaña actual de Copilot.' : undefined,
      }),
    }).catch(() => {});
    return;
  }

  activeExternalAskCount += 1;
  let createdWindowId = null;
  let tabId = null;
  let reusedExisting = false;
  try {
    const opened = await acquireCopilotTabForExternalAsk(task.id);
    createdWindowId = opened.createdWindowId;
    tabId = opened.tabId;
    reusedExisting = Boolean(opened.reusedExisting);

    await registerActiveExternalAskWindow(task.id, createdWindowId, tabId, {
      keepOpenOnCleanup: reusedExisting,
    });
    await fetch('http://localhost:4200/api/copilot-web/ask-external-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: task.id,
        windowId: createdWindowId,
        tabId,
        reusedExisting,
        hasAppWindow: opened.hasAppWindow,
        hasWorkspace: true,
      }),
    }).catch(() => {});

    for (let w = 0; w < 40; w++) {
      await sleep(400);
      const tInfo = await chrome.tabs.get(tabId).catch(() => null);
      const curUrl = (tInfo && tInfo.url) || '';
      if (tInfo && /login\.live\.com|login\.microsoftonline\.com|account\.microsoft\.com\/auth/i.test(curUrl) && w >= 4) {
        await fetch('http://localhost:4200/api/copilot-web/ask-external-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: task.id,
            ok: false,
            tabId,
            windowId: createdWindowId,
            reusedExisting,
            chatUrl: curUrl,
            error:
              'No hay sesión iniciada en Microsoft Copilot Web dentro de Google Chrome. Inicia sesión en la pestaña abierta de Copilot e inténtalo de nuevo.',
          }),
        }).catch(() => {});
        return;
      }
      if (
        tInfo &&
        tInfo.status === 'complete' &&
        /^https:\/\/([a-z0-9-]+\.)?(copilot\.microsoft\.com|copilot\.com|cloud\.microsoft)/i.test(curUrl)
      ) {
        const snapReady = await inspectCopilotTabLatestResponse(tabId);
        if (snapReady && snapReady.blockReason && w >= 4) {
          await fetch('http://localhost:4200/api/copilot-web/ask-external-result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requestId: task.id,
              ok: false,
              tabId,
              windowId: createdWindowId,
              reusedExisting,
              chatUrl: snapReady.url || tInfo.url || '',
              error: snapReady.blockReason,
            }),
          }).catch(() => {});
          return;
        }
        if (snapReady && snapReady.hasComposer) {
          break;
        }
      }
    }
    await sleep(450);

    const checkBlock = await inspectCopilotTabLatestResponse(tabId);
    if (checkBlock && checkBlock.blockReason) {
      await fetch('http://localhost:4200/api/copilot-web/ask-external-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: task.id,
          ok: false,
          tabId,
          windowId: createdWindowId,
          reusedExisting,
          chatUrl: checkBlock.url || '',
          error: checkBlock.blockReason,
        }),
      }).catch(() => {});
      return;
    }

    const baselineCount = (checkBlock && checkBlock.count) || 0;
    const baselineText = ((checkBlock && checkBlock.text) || '').trim();

    const orderPayload = {
      target: 'COPILOT',
      action: 'ASK_EXTERNAL_COPILOT',
      requestId: task.id,
      prompt: task.prompt,
    };
    let deliveredAck = false;
    for (let tryIdx = 0; tryIdx < 8; tryIdx++) {
      await ensureScriptInjected(tabId, 'copilot-content.js');
      await sleep(350);
      const ack = await chrome.tabs.sendMessage(tabId, orderPayload).catch(() => null);
      if (ack && ack.handled) {
        deliveredAck = true;
        break;
      }
      await sleep(400);
    }

    if (!deliveredAck) {
      await forceSubmitPromptInCopilotTab(tabId, task.prompt);
    }

    let stableDoneTicks = 0;
    let lastText = '';
    for (let i = 0; i < 150; i++) {
      await sleep(2000);
      await chrome.runtime.getPlatformInfo().catch(() => null);
      if (!pendingExternalCheckActive(task.id)) break;
      const tStillExists = await chrome.tabs.get(tabId).catch(() => null);
      if (!tStillExists) break;
      const snap = await inspectCopilotTabLatestResponse(tabId);
      if (!snap) continue;
      if (snap.blockReason) {
        await fetch('http://localhost:4200/api/copilot-web/ask-external-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: task.id,
            ok: false,
            tabId,
            windowId: createdWindowId,
            reusedExisting,
            chatUrl: snap.url || '',
            error: snap.blockReason,
          }),
        }).catch(() => {});
        return;
      }
      if (snap.userQueries === 0 && snap.count === 0 && !snap.generating && (i === 5 || i === 10)) {
        await forceSubmitPromptInCopilotTab(tabId, task.prompt);
        continue;
      }
      const trimmedSnapText = (snap.text || '').trim();
      const isNewTurn =
        snap.count > baselineCount || (trimmedSnapText.length > 0 && trimmedSnapText !== baselineText);
      const readyEnough = trimmedSnapText.length >= 2;
      const neededStableTicks = snap.hasFinishActions ? 2 : 3;
      if (isNewTurn && !snap.generating && readyEnough) {
        if (snap.text === lastText) {
          stableDoneTicks += 1;
        } else {
          lastText = snap.text;
          stableDoneTicks = 1;
        }
        if (stableDoneTicks >= neededStableTicks) {
          await fetch('http://localhost:4200/api/copilot-web/ask-external-result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requestId: task.id,
              ok: true,
              tabId,
              windowId: createdWindowId,
              reusedExisting,
              verifiedModel: snap.verifiedModel || 'Microsoft Copilot Web',
              response: snap.text,
              chatUrl: snap.url,
            }),
          }).catch(() => {});
          return;
        }
      } else {
        lastText = snap.text || '';
        stableDoneTicks = 0;
      }
    }
  } finally {
    activeExternalAskCount = Math.max(0, activeExternalAskCount - 1);
    await cleanupActiveExternalAskWindow(task.id, createdWindowId, tabId, {
      keepOpen: reusedExisting,
    });
  }
}

async function checkExtensionAutoReloadFromLocalServer(isStartup = false) {
  if (isCheckingExtFingerprint) return;
  isCheckingExtFingerprint = true;
  try {
    const presence = await getHuellasBrowserProfilePresence();
    await ensureResidentGeminiAndChatGptTabs(presence);
    const qs = `?hasAppWindow=${presence.hasAppWindow ? '1' : '0'}&hasWorkspace=${
      presence.hasWorkspace ? '1' : '0'
    }${isStartup ? '&ack=1' : ''}`;
    const res = await fetch(`http://localhost:4200/api/extension/fingerprint${qs}`, {
      cache: 'no-store',
    });
    if (!res.ok) return;
    const data = await res.json();
    const serverActiveAskIds = new Set(Array.isArray(data?.activeExternalAskIds) ? data.activeExternalAskIds : []);
    latestServerActiveExternalAskIds = serverActiveAskIds;
    const canClaimInThisBrowser =
      presence.hasAppWindow || (presence.hasWorkspace && Boolean(data?.allowWorkspaceFallback));

    if (
      canClaimInThisBrowser &&
      Array.isArray(data?.pendingGeminiCommands) &&
      data.pendingGeminiCommands.length > 0
    ) {
      for (const cmd of data.pendingGeminiCommands) {
        if (!cmd || !cmd.commandId || claimedGeminiCommandIds.has(cmd.commandId)) continue;
        claimedGeminiCommandIds.add(cmd.commandId);
        fetch('http://localhost:4200/api/extension/claim-gemini-command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commandId: cmd.commandId,
            hasAppWindow: presence.hasAppWindow,
            hasWorkspace: presence.hasWorkspace,
          }),
        }).catch(() => {});
        runPendingGeminiCommandOrder(cmd).catch((err) => {
          console.warn('[Huellas Bridge] Error ejecutando comando remoto en Gemini:', err);
        });
      }
    }

    if (canClaimInThisBrowser) {
      const geminiTasks = Array.isArray(data?.pendingExternalGeminiAsks)
        ? data.pendingExternalGeminiAsks
        : data?.pendingExternalGeminiAsk
          ? [data.pendingExternalGeminiAsk]
          : [];
      for (const task of geminiTasks) {
        if (!task || !task.id || claimedExternalAskIds.has(task.id)) continue;
        claimedExternalAskIds.add(task.id);
        const claimRes = await fetch('http://localhost:4200/api/gemini-web/ask-external-claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: task.id,
            hasAppWindow: presence.hasAppWindow,
            hasWorkspace: presence.hasWorkspace,
          }),
        })
          .then((r) => r.json())
          .catch(() => null);
        if (claimRes && claimRes.ok) {
          runExternalGeminiAskOrder(task).catch((err) => {
            fetch('http://localhost:4200/api/gemini-web/ask-external-result', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                requestId: task.id,
                ok: false,
                error: String(err?.message || err),
              }),
            }).catch(() => {});
          });
        } else {
          claimedExternalAskIds.delete(task.id);
        }
      }

      const chatGptTasks = Array.isArray(data?.pendingExternalChatGptAsks)
        ? data.pendingExternalChatGptAsks
        : data?.pendingExternalChatGptAsk
          ? [data.pendingExternalChatGptAsk]
          : [];
      for (const chatGptTask of chatGptTasks) {
        if (!chatGptTask || !chatGptTask.id || claimedExternalAskIds.has(chatGptTask.id)) continue;
        claimedExternalAskIds.add(chatGptTask.id);
        const claimRes = await fetch('http://localhost:4200/api/chatgpt-web/ask-external-claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: chatGptTask.id,
            hasAppWindow: presence.hasAppWindow,
            hasWorkspace: presence.hasWorkspace,
          }),
        })
          .then((r) => r.json())
          .catch(() => null);
        if (claimRes && claimRes.ok) {
          runExternalChatGptAskOrder(chatGptTask).catch((err) => {
            fetch('http://localhost:4200/api/chatgpt-web/ask-external-result', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                requestId: chatGptTask.id,
                ok: false,
                error: String(err?.message || err),
              }),
            }).catch(() => {});
          });
        } else {
          claimedExternalAskIds.delete(chatGptTask.id);
        }
      }
    }

    // Sweep any orphaned temporary Gemini/ChatGPT windows whose server-side ask-external request already finished, timed out, or restarted
    const storedAsksMap = await getStoredExternalAskMap();
    const nowMs = Date.now();
    let hasRunningExternalAsk = activeExternalAskCount > 0;
    for (const [reqId, info] of Object.entries(storedAsksMap)) {
      const ageMs = nowMs - Number((info && info.startedAt) || 0);
      if (serverActiveAskIds.has(reqId) && ageMs < 360000) {
        hasRunningExternalAsk = true;
      } else if (ageMs > 5000 && !activeExternalAskMap.has(reqId)) {
        await cleanupActiveExternalAskWindow(reqId, info && info.windowId, info && info.tabId, {
          keepOpen: Boolean(info && info.keepOpenOnCleanup),
        });
      }
    }

    const nextFp = String(data?.fingerprint || '').trim();
    if (!nextFp) return;

    if (!currentExtFingerprint) {
      let storedFp = '';
      try {
        const st = await chrome.storage.local.get('huellasExtFingerprint');
        storedFp = String((st && st.huellasExtFingerprint) || '').trim();
      } catch {}
      currentExtFingerprint = nextFp;
      if (storedFp !== nextFp) {
        try {
          await chrome.storage.local.set({ huellasExtFingerprint: nextFp });
        } catch {}
      }
      return;
    }

    if (nextFp !== currentExtFingerprint && !hasRunningExternalAsk) {
      // Never reload the extension while a Deep Research watcher is running (it would kill the content script)
      try {
        const st = await chrome.storage.local.get('huellasDeepResearchActiveUntil');
        if (Number(st && st.huellasDeepResearchActiveUntil) > Date.now()) return;
      } catch {}
      currentExtFingerprint = nextFp;
      try {
        await chrome.storage.local.set({ huellasExtFingerprint: nextFp });
      } catch {}
      chrome.runtime.reload();
    }
  } catch {
  } finally {
    isCheckingExtFingerprint = false;
  }
}

checkExtensionAutoReloadFromLocalServer(true);
setInterval(() => {
  checkExtensionAutoReloadFromLocalServer(false);
}, 1200);

// ============================================================================
// GEMINI NOTEBOOK: resume an order after a URL navigation (MODO TRIO consensus)
// The content script dies when the page reloads; the order is kept in chrome.storage.session
// and re-sent once the Gemini tab finishes loading the notebook/chat URL.
// ============================================================================
function extractGeminiAppChatId(url = '') {
  const m = String(url || '').match(/gemini\.google\.com\/(?:u\/\d+\/)?app\/([a-zA-Z0-9_-]{6,})/i);
  return m ? m[1] : '';
}

function buildGeminiAppUrlPreservingAccount(currentUrl = '', chatId = '') {
  const acct = String(currentUrl || '').match(/gemini\.google\.com(\/u\/\d+)\//i);
  const prefix = acct ? acct[1] : '';
  return `https://gemini.google.com${prefix}/app/${chatId}`;
}

function normalizeDocTitleKeyBg(text = '') {
  return String(text || '')
    .normalize('NFKC')
    .replace(/_?\s*deep\s*research$/i, '')
    .replace(/[\u2012\u2013\u2014\u2015]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function filterOutExternalAskTabs(tabs) {
  if (!Array.isArray(tabs) || tabs.length === 0) return [];
  const excludedTabIds = new Set();
  const excludedWinIds = new Set();
  if (activeExternalAskTabId) excludedTabIds.add(activeExternalAskTabId);
  if (activeExternalAskWindowId) excludedWinIds.add(activeExternalAskWindowId);
  for (const v of activeExternalAskMap.values()) {
    if (v && v.tabId) excludedTabIds.add(v.tabId);
    if (v && v.windowId) excludedWinIds.add(v.windowId);
  }
  try {
    const map = await getStoredExternalAskMap();
    for (const v of Object.values(map || {})) {
      if (v && v.tabId) excludedTabIds.add(v.tabId);
      if (v && v.windowId) excludedWinIds.add(v.windowId);
    }
  } catch {}
  return tabs.filter((t) => t && !excludedTabIds.has(t.id) && !excludedWinIds.has(t.windowId));
}

async function recordNotebookChatInStorage(nbPath, chatId) {
  if (!nbPath || !chatId) return;
  try {
    const key = `huellasNbChats_${nbPath}`;
    const st = await chrome.storage.local.get(key);
    const arr = Array.isArray(st && st[key]) ? st[key] : [];
    if (!arr.includes(chatId)) {
      arr.push(chatId);
      await chrome.storage.local.set({ [key]: arr.slice(-200) });
    }
  } catch {}
}

async function saveChatLinkInBackgroundRegistry(msg) {
  if (!msg) return;
  const chatId = extractGeminiAppChatId(msg.geminiChatUrl || msg.chatUrl || '');
  if (!chatId) return;
  const chatUrl = `https://gemini.google.com/app/${chatId}`;
  const isDeep = Boolean(msg.isDeepResearch) || /_\s*deep\s*research$/i.test(String(msg.geminiChatTitle || ''));
  const replacesDeletedChat = Boolean(msg.replacesDeletedChat);
  const docKey = msg.docId ? `doc:${msg.docId}` : '';
  const nameKey = msg.geminiChatTitle ? `name:${normalizeDocTitleKeyBg(msg.geminiChatTitle)}` : '';
  try {
    const st = await chrome.storage.local.get(['huellas_doc_chats_registry_v2', 'huellasNotebookPath']);
    const reg = { ...((st && st.huellas_doc_chats_registry_v2) || {}) };
    const nbPath = msg.notebookPath || (st && st.huellasNotebookPath) || '';
    if (nbPath) await recordNotebookChatInStorage(nbPath, chatId);
    const prev = (docKey && reg[docKey]) || (nameKey && reg[nameKey]) || {};
    const next = { ...prev, updatedAt: Date.now() };
    if (isDeep) {
      if (prev.mainChatId && prev.mainChatId === chatId) return;
      if (!prev.deepResearchChatId || replacesDeletedChat) {
        next.deepResearchChatId = chatId;
        next.deepResearchChatUrl = chatUrl;
      }
    } else {
      if (prev.deepResearchChatId && prev.deepResearchChatId === chatId) return;
      if (!prev.mainChatId || replacesDeletedChat) {
        next.mainChatId = chatId;
        next.mainChatUrl = chatUrl;
      }
    }
    if (docKey) reg[docKey] = next;
    if (nameKey) reg[nameKey] = next;
    await chrome.storage.local.set({ huellas_doc_chats_registry_v2: reg });
  } catch {}
}

async function resolveDesiredGeminiChatTarget(payload) {
  const isDeepResearch = Boolean(payload && payload.enableDeepResearch) === true;
  let regEntry = {};
  try {
    const st = await chrome.storage.local.get('huellas_doc_chats_registry_v2');
    const reg = (st && st.huellas_doc_chats_registry_v2) || {};
    const docKey = payload?.docId ? `doc:${payload.docId}` : '';
    const nameKey = payload?.videoName ? `name:${normalizeDocTitleKeyBg(payload.videoName)}` : '';
    regEntry = (docKey && reg[docKey]) || (nameKey && reg[nameKey]) || {};
  } catch {}

  // Authoritative payload URLs from App.tsx / server.ts always take priority over cached local registry
  const mainChatId =
    extractGeminiAppChatId(payload?.geminiChatUrl) ||
    extractGeminiAppChatId(regEntry.mainChatUrl) ||
    regEntry.mainChatId ||
    '';
  const deepChatId =
    extractGeminiAppChatId(payload?.geminiDeepResearchChatUrl) ||
    extractGeminiAppChatId(regEntry.deepResearchChatUrl) ||
    regEntry.deepResearchChatId ||
    '';

  let targetChatId = isDeepResearch ? deepChatId : mainChatId;
  const oppositeChatId = isDeepResearch ? mainChatId : deepChatId;
  if (targetChatId && oppositeChatId && targetChatId === oppositeChatId) {
    if (isDeepResearch) targetChatId = '';
  }
  return { isDeepResearch, targetChatId, oppositeChatId };
}

function waitForGeminiTabLoadComplete(tabId, timeoutMs = 16000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        chrome.tabs.onUpdated.removeListener(listener);
      } catch {}
      resolve(val);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finish(true);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function prePositionGeminiTabForOrder(targetTab, payload) {
  if (!targetTab || !targetTab.id || !payload || payload.__directChatNotFound) return payload;
  const { isDeepResearch, targetChatId } = await resolveDesiredGeminiChatTarget(payload);
  let nbPath = '/notebook/5989f0d1-34c7-480e-af01-07f2ef1ee39f';
  try {
    const st = await chrome.storage.local.get('huellasNotebookPath');
    if (st && st.huellasNotebookPath) nbPath = st.huellasNotebookPath;
  } catch {}

  if (!targetChatId) return payload;

  // Ensure the Notebook guard in gemini-content.js recognizes this linked chat even if the left sidebar is collapsed
  await recordNotebookChatInStorage(nbPath, targetChatId);
  // Self-heal background registry with authoritative payload URL
  await saveChatLinkInBackgroundRegistry({
    docId: payload.docId,
    geminiChatTitle: isDeepResearch ? `${payload.videoName || ''}_Deep Research` : payload.videoName || '',
    geminiChatUrl: `https://gemini.google.com/app/${targetChatId}`,
    isDeepResearch,
    replacesDeletedChat: true,
    notebookPath: nbPath,
  });

  const freshTab = (await chrome.tabs.get(targetTab.id).catch(() => null)) || targetTab;
  const currentChatId = extractGeminiAppChatId(freshTab.url || '');
  if (currentChatId === targetChatId) {
    return payload;
  }

  const targetUrl = buildGeminiAppUrlPreservingAccount(freshTab.url || '', targetChatId);
  await chrome.tabs.update(targetTab.id, { url: targetUrl }).catch(() => {});
  await waitForGeminiTabLoadComplete(targetTab.id, 16000);
  await sleep(1400);

  const afterTab = await chrome.tabs.get(targetTab.id).catch(() => null);
  const landedChatId = extractGeminiAppChatId((afterTab && afterTab.url) || '');
  if (landedChatId === targetChatId) {
    targetTab.url = afterTab.url;
    return payload;
  }

  // Google redirected away (e.g. to /app because the user manually deleted that chat in Gemini):
  // clean stale chatId and navigate to the Notebook root so a fresh chat can be created cleanly without hanging!
  try {
    const st = await chrome.storage.local.get('huellas_doc_chats_registry_v2');
    const reg = { ...((st && st.huellas_doc_chats_registry_v2) || {}) };
    for (const k of Object.keys(reg)) {
      if (isDeepResearch && reg[k]?.deepResearchChatId === targetChatId) {
        delete reg[k].deepResearchChatId;
        delete reg[k].deepResearchChatUrl;
      } else if (!isDeepResearch && reg[k]?.mainChatId === targetChatId) {
        delete reg[k].mainChatId;
        delete reg[k].mainChatUrl;
      }
    }
    await chrome.storage.local.set({ huellas_doc_chats_registry_v2: reg });
  } catch {}

  const acctMatch = String((afterTab && afterTab.url) || freshTab.url || '').match(/gemini\.google\.com(\/u\/\d+)\//i);
  const acctPrefix = acctMatch ? acctMatch[1] : '';
  const cleanNbPath = nbPath.replace(/^\/u\/\d+(?=\/)/, '');
  await chrome.tabs.update(targetTab.id, { url: `https://gemini.google.com${acctPrefix}${cleanNbPath}` }).catch(() => {});
  await waitForGeminiTabLoadComplete(targetTab.id, 15000);
  await sleep(1200);

  return {
    ...payload,
    __directChatNotFound: true,
    replacesDeletedChat: true,
    ...(isDeepResearch ? { geminiDeepResearchChatUrl: '' } : { geminiChatUrl: '' }),
  };
}

function huellasGeminiResumeKey(tabId) {
  return `huellasGeminiResume_${tabId}`;
}

async function resumeGeminiOrderIfPending(tabId, tabUrl) {
  const key = huellasGeminiResumeKey(tabId);
  let pending = null;
  try {
    const st = await chrome.storage.session.get(key);
    pending = st && st[key];
  } catch {}
  if (!pending || !pending.order) return;
  const normalizeGeminiPath = (u) =>
    String(u || '')
      .replace(/^https:\/\/gemini\.google\.com/, '')
      .split(/[?#]/)[0]
      .replace(/^\/u\/\d+(?=\/)/, '')
      .replace(/\/$/, '');
  const wantPath = normalizeGeminiPath(pending.url);
  const gotPath = normalizeGeminiPath(tabUrl);
  if (Date.now() - (pending.createdAt || 0) > 120000) {
    await chrome.storage.session.remove(key).catch(() => {});
    return;
  }
  const redirectedFromDeletedAppChat =
    /^\/app\/[a-zA-Z0-9_-]{6,}$/i.test(wantPath) &&
    (gotPath === '/app' || /^\/notebook\//i.test(gotPath)) &&
    Date.now() - (pending.createdAt || 0) > 1200;
  if (!wantPath || (wantPath !== gotPath && !redirectedFromDeletedAppChat)) return;
  await chrome.storage.session.remove(key).catch(() => {});
  await sleep(2200);
  await ensureScriptInjected(tabId, 'gemini-content.js');
  await sleep(500);
  const resumedOrder = redirectedFromDeletedAppChat
    ? {
        ...pending.order,
        __directChatNotFound: true,
        replacesDeletedChat: true,
        ...(pending.order.enableDeepResearch
          ? { geminiDeepResearchChatUrl: '' }
          : { geminiChatUrl: '' }),
      }
    : pending.order;
  chrome.tabs.sendMessage(tabId, { ...resumedOrder, target: 'GEMINI' }).catch(() => {});
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const url = (tab && tab.url) || '';
  if (!/^https:\/\/gemini\.google\.com\//.test(url)) return;
  resumeGeminiOrderIfPending(tabId, url).catch(() => {});
});

const standaloneImageWindowIdsMem = new Set();

async function getStandaloneImageWindowIds() {
  const out = new Set(standaloneImageWindowIdsMem);
  try {
    const st = await chrome.storage.session.get('huellasStandaloneImgWinIds');
    const arr = Array.isArray(st && st.huellasStandaloneImgWinIds) ? st.huellasStandaloneImgWinIds : [];
    for (const id of arr) {
      if (typeof id === 'number') out.add(id);
    }
  } catch {}
  return out;
}

async function registerStandaloneImageWindowId(winId) {
  if (typeof winId !== 'number') return;
  standaloneImageWindowIdsMem.add(winId);
  try {
    const cur = await getStandaloneImageWindowIds();
    cur.add(winId);
    await chrome.storage.session.set({
      huellasStandaloneImgWinIds: Array.from(cur).slice(-30),
    });
  } catch {}
}

function isStandaloneCreateImageOrder(payload) {
  if (!payload) return false;
  return Boolean(
    payload.standaloneNewChat ||
      payload.noNotebook ||
      payload.enableCreateImage ||
      payload.mediaType === 'THUMBNAILS' ||
      Number(payload.stageNumber) === 505
  );
}

async function isGeminiTabCurrentlyBusy(tab) {
  if (!tab || !tab.id) return true;
  const tabId = tab.id;
  if (
    activeExternalAskTabId === tabId ||
    Array.from(activeExternalAskMap.values()).some((v) => v && v.tabId === tabId)
  ) {
    return true;
  }
  try {
    const remoteKey = `huellasRemoteStage_${tabId}`;
    const st = await chrome.storage.local.get(remoteKey);
    const rec = st && st[remoteKey];
    if (rec && Date.now() - Number(rec.startedAt || 0) < 20 * 60 * 1000) {
      return true;
    }
  } catch {}
  try {
    const pingRes = await Promise.race([
      chrome.tabs.sendMessage(tabId, { target: 'GEMINI', action: 'PING_GEMINI_BUSY' }),
      sleep(450).then(() => null),
    ]);
    if (pingRes && pingRes.ok) {
      return Boolean(pingRes.busy);
    }
  } catch {}
  try {
    const domRes = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const stopSelectors = [
          'button[aria-label*="Stop" i]',
          'button[aria-label*="Detener" i]',
          'button[mattooltip*="Stop" i]',
          'button[mattooltip*="Detener" i]',
        ];
        for (const sel of stopSelectors) {
          const btn = document.querySelector(sel);
          if (btn && btn.offsetParent !== null) return true;
        }
        return Boolean(window.__HUELLAS_GEMINI_ACTIVE_WATCH_TIMER__);
      },
    });
    if (domRes && domRes[0] && domRes[0].result === true) {
      return true;
    }
  } catch {}
  return false;
}

async function acquireGeminiTargetTabWithWindowPolicy(payload, senderWindowId = null) {
  const rawGeminiTabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' }).catch(() => []);
  const geminiTabs = await filterOutExternalAskTabs(rawGeminiTabs);
  const standaloneImgWinIds = await getStandaloneImageWindowIds();

  // Preserve user's active Google account slot (/u/<N>) if present on any open Gemini tab
  let acctPrefix = '';
  for (const t of rawGeminiTabs) {
    const m = String(t?.url || '').match(/gemini\.google\.com(\/u\/\d+)\//i);
    if (m) {
      acctPrefix = m[1];
      break;
    }
  }

  // CASE A: Create Image call -> NEW window (if no idle standalone image window exists) in a NEW clean chat WITHOUT Notebook linkage
  if (isStandaloneCreateImageOrder(payload)) {
    const freshUnlinkedUrl = `https://gemini.google.com${acctPrefix}/app`;
    let reusableStandaloneTab = null;

    for (const t of geminiTabs) {
      if (!t || !t.id || typeof t.windowId !== 'number') continue;
      if (!standaloneImgWinIds.has(t.windowId)) continue;
      if (senderWindowId && t.windowId === senderWindowId) continue;
      if (/\/notebook\//i.test(String(t.url || ''))) continue;
      const busy = await isGeminiTabCurrentlyBusy(t);
      if (!busy) {
        reusableStandaloneTab = t;
        break;
      }
    }

    const cleanPayload = {
      ...payload,
      standaloneNewChat: true,
      noNotebook: true,
      geminiChatUrl: '',
      geminiDeepResearchChatUrl: '',
      notebookName: '',
    };

    if (reusableStandaloneTab && reusableStandaloneTab.id) {
      await chrome.tabs
        .update(reusableStandaloneTab.id, { url: freshUnlinkedUrl, autoDiscardable: false })
        .catch(() => {});
      await waitForGeminiTabLoadComplete(reusableStandaloneTab.id, 16000);
      await sleep(1800);
      const updated =
        (await chrome.tabs.get(reusableStandaloneTab.id).catch(() => null)) || reusableStandaloneTab;
      return {
        targetTab: updated,
        finalPayload: cleanPayload,
        openedNewWindow: false,
        skipPrePosition: true,
      };
    }

    const createdWin = await chrome.windows.create({
      url: freshUnlinkedUrl,
      focused: false,
      type: 'normal',
    });
    if (createdWin && typeof createdWin.id === 'number') {
      await registerStandaloneImageWindowId(createdWin.id);
    }
    let createdTab =
      (createdWin && Array.isArray(createdWin.tabs) && createdWin.tabs[0]) || null;
    if (!createdTab && createdWin && typeof createdWin.id === 'number') {
      const winTabs = await chrome.tabs.query({ windowId: createdWin.id }).catch(() => []);
      createdTab = winTabs[0] || null;
    }
    if (createdTab && createdTab.id) {
      await chrome.tabs.update(createdTab.id, { autoDiscardable: false }).catch(() => {});
      await waitForGeminiTabLoadComplete(createdTab.id, 16000);
      await sleep(2200);
      createdTab = (await chrome.tabs.get(createdTab.id).catch(() => null)) || createdTab;
    }
    return {
      targetTab: createdTab,
      finalPayload: cleanPayload,
      openedNewWindow: true,
      skipPrePosition: true,
    };
  }

  // CASE B: Documentary chat calls (including Stage 5 / 101 Neuropsychological Click Triggers)
  // -> Execute INSIDE the documentary's chat; open a NEW window if no Gemini tab/window is open OR all open ones are currently in use!
  let nbPath = '/notebook/5989f0d1-34c7-480e-af01-07f2ef1ee39f';
  try {
    const st = await chrome.storage.local.get('huellasNotebookPath');
    if (st && st.huellasNotebookPath) nbPath = st.huellasNotebookPath;
  } catch {}
  const cleanNbPath = nbPath.replace(/^\/u\/\d+(?=\/)/, '');
  const { isDeepResearch, targetChatId } = await resolveDesiredGeminiChatTarget(payload);

  const candidateDocTabs = geminiTabs.filter(
    (t) => t && t.id && !standaloneImgWinIds.has(t.windowId)
  );

  const idleDocTabs = [];
  for (const t of candidateDocTabs) {
    const busy = await isGeminiTabCurrentlyBusy(t);
    if (!busy) {
      idleDocTabs.push(t);
    }
  }

  const pathOf = (u) => {
    try {
      return new URL(u).pathname.replace(/^\/u\/\d+(?=\/)/, '').replace(/\/$/, '');
    } catch {
      return '';
    }
  };

  if (idleDocTabs.length > 0) {
    const chosenIdleTab =
      (targetChatId &&
        idleDocTabs.find((t) => extractGeminiAppChatId(t.url || '') === targetChatId)) ||
      (payload?.tabId && idleDocTabs.find((t) => t.id === payload.tabId)) ||
      idleDocTabs.find(
        (t) => pathOf(t.url || '') === cleanNbPath.replace(/\/$/, '')
      ) ||
      idleDocTabs.find((t) => /^\/notebook\//.test(pathOf(t.url || ''))) ||
      (senderWindowId && idleDocTabs.find((t) => t.windowId === senderWindowId)) ||
      idleDocTabs[0];

    const finalPayload =
      payload?.action === 'SEND_PROMPT'
        ? await prePositionGeminiTabForOrder(chosenIdleTab, payload)
        : payload;
    const refreshedTab =
      (await chrome.tabs.get(chosenIdleTab.id).catch(() => null)) || chosenIdleTab;
    return {
      targetTab: refreshedTab,
      finalPayload,
      openedNewWindow: false,
      skipPrePosition: true,
    };
  }

  // No Gemini tab/window is open OR every open Gemini tab/window is currently in use -> open a NEW Chrome window in the documentary's chat!
  if (targetChatId) {
    await recordNotebookChatInStorage(nbPath, targetChatId);
    await saveChatLinkInBackgroundRegistry({
      docId: payload?.docId,
      geminiChatTitle: isDeepResearch
        ? `${payload?.videoName || ''}_Deep Research`
        : payload?.videoName || '',
      geminiChatUrl: `https://gemini.google.com/app/${targetChatId}`,
      isDeepResearch,
      replacesDeletedChat: true,
      notebookPath: nbPath,
    });
  }

  const initialDocUrl = targetChatId
    ? `https://gemini.google.com${acctPrefix}/app/${targetChatId}`
    : `https://gemini.google.com${acctPrefix}${cleanNbPath}`;

  const createdDocWin = await chrome.windows.create({
    url: initialDocUrl,
    focused: false,
    type: 'normal',
  });
  let createdDocTab =
    (createdDocWin && Array.isArray(createdDocWin.tabs) && createdDocWin.tabs[0]) || null;
  if (!createdDocTab && createdDocWin && typeof createdDocWin.id === 'number') {
    const winTabs = await chrome.tabs.query({ windowId: createdDocWin.id }).catch(() => []);
    createdDocTab = winTabs[0] || null;
  }
  let finalPayload = payload;
  if (createdDocTab && createdDocTab.id) {
    await chrome.tabs.update(createdDocTab.id, { autoDiscardable: false }).catch(() => {});
    await waitForGeminiTabLoadComplete(createdDocTab.id, 16000);
    await sleep(2200);
    createdDocTab = (await chrome.tabs.get(createdDocTab.id).catch(() => null)) || createdDocTab;
    if (payload?.action === 'SEND_PROMPT') {
      finalPayload = await prePositionGeminiTabForOrder(createdDocTab, payload);
      createdDocTab = (await chrome.tabs.get(createdDocTab.id).catch(() => null)) || createdDocTab;
    }
  }
  return {
    targetTab: createdDocTab,
    finalPayload,
    openedNewWindow: true,
    skipPrePosition: true,
  };
}
