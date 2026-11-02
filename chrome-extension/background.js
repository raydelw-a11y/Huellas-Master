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
        (lower.includes('labs.google') && lower.includes('flow')) ||
        lower.includes('usercontent.goog')
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
      target: scriptFile === 'flow-content.js' ? { tabId, allFrames: true } : { tabId },
      files: [scriptFile],
    });
    if (scriptFile === 'suno-content.js') {
      await ensureFlowMusicAntiAutoplayInMainWorld(tabId);
    }
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
      } else if (
        tab.url.includes('flowmusic.app') ||
        tab.url.includes('producer.ai') ||
        tab.url.includes('suno.com')
      ) {
        ensureScriptInjected(tab.id, 'suno-content.js');
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
async function injectPromptIntoBottomEditor(rawPromptText, mediaType, logoDataUrl) {
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

  const collectNodesDeep = (root, selector, visited = new Set()) => {
    if (!root || visited.has(root)) return [];
    visited.add(root);
    const list = [];
    try {
      list.push(...Array.from(root.querySelectorAll(selector)));
    } catch {}
    try {
      const allEls = root.querySelectorAll('*');
      for (const el of allEls) {
        if (el.shadowRoot) {
          list.push(...collectNodesDeep(el.shadowRoot, selector, visited));
        }
      }
    } catch {}
    return list;
  };

  function findBottomPromptEditor() {
    const rawList = [
      ...collectNodesDeep(document, 'div.ProseMirror[contenteditable="true"]'),
      ...collectNodesDeep(document, 'div[contenteditable="true"][role="textbox"]'),
      ...collectNodesDeep(
        document,
        'rich-textarea [contenteditable="true"], .ql-editor[contenteditable="true"]'
      ),
      ...collectNodesDeep(document, '[contenteditable="true"]:not([aria-hidden="true"])'),
      ...collectNodesDeep(document, 'textarea:not(.g-recaptcha-response):not([readonly])'),
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

  let editorEl = findBottomPromptEditor();
  if (!editorEl) {
    // 1. Si estamos en Story Studio ("Get started" o pestaña Storyboard/Assets sin tarjeta seleccionada)
    const allBtns = collectNodesDeep(document, 'button, a[role="button"], a[href*="flow"]');
    const getStartedBtn = allBtns.find((b) =>
      /^get started$/i.test((b.textContent || '').trim())
    );
    if (getStartedBtn) {
      try {
        getStartedBtn.click();
        await sleepMain(500);
        editorEl = findBottomPromptEditor();
      } catch {}
    }

    if (!editorEl) {
      // Si estamos en Story Studio en "3. Storyboard" o "2. Assets", abrir o seleccionar una tarjeta para que aparezca el <textarea> de edición
      const storyboardTabBtn = allBtns.find((b) =>
        /3\.\s*Storyboard/i.test((b.textContent || '').trim())
      );
      const scriptTabBtn = allBtns.find((b) =>
        /1\.\s*Script/i.test((b.textContent || '').trim())
      );
      if (storyboardTabBtn || scriptTabBtn) {
        try {
          const createFirstBtn = allBtns.find((b) =>
            /create your first frame|add frame/i.test((b.textContent || '').trim())
          );
          if (createFirstBtn) {
            createFirstBtn.click();
            await sleepMain(350);
          } else {
            // Hacer clic en la primera tarjeta de frame si existe
            const frameCard = document.querySelector('main [role="button"], main .aspect-video');
            if (frameCard) {
              frameCard.click();
              await sleepMain(350);
            }
          }
          editorEl = findBottomPromptEditor();
          if (!editorEl && scriptTabBtn) {
            scriptTabBtn.click();
            await sleepMain(350);
            editorEl = findBottomPromptEditor();
          }
        } catch {}
      }
    }

    if (!editorEl) {
      // 2. Si estamos en la pantalla de inicio / listado de proyectos de Google Flow ("addNew project" / "Create with Flow" / "+ New")
      const refreshedBtns = collectNodesDeep(document, 'button, a[role="button"], a[href]');
      const newProjBtn = refreshedBtns.find((b) =>
        /(new project|nuevo proyecto|create with flow|create project|start creating|try flow|\+\s*new)/i.test(
          (b.textContent || '').trim()
        )
      );
      if (newProjBtn) {
        try {
          if (
            newProjBtn.tagName === 'A' &&
            newProjBtn.href &&
            newProjBtn.target === '_blank' &&
            /\/about/i.test(location.href)
          ) {
            location.href = newProjBtn.href;
          } else {
            newProjBtn.click();
          }
          for (let w = 0; w < 4 && !editorEl; w++) {
            await sleepMain(550);
            editorEl = findBottomPromptEditor();
          }
        } catch {}
      }
    }
  }
  if (!editorEl) {
    return { injected: false, error: 'No se encontró la caja de prompt en Google Flow.' };
  }

  // Asegurar siempre en la interfaz de Google Flow:
  // 1) Cerrar Story Studio si quedó abierto cuando se va a generar VIDEO real en el compositor de Google Flow
  // 2) Modo correcto: Video (Text to Video / Videos) para clips, o Image (Create images / Images) para referencias/miniaturas
  // 3) Cantidad de salidas = x1 (1 solo item por envío para no gastar créditos extra)
  // 4) Motor de Video = 'Veo 3.1 - Lite [Lower Priority]' (respaldo si se agotaron créditos de Omni 1.1 Flash)
  // 5) Motor de Imagen = 'Nano Banana 2.1' -> respaldo 'Nano Banana Pro'
  try {
    const isVideoMode =
      mediaType === 'VIDEO' || /^\s*\*?\*?Clip\s+\d+/i.test(String(rawPromptText || ''));

    if (isVideoMode) {
      const ssModal = document.getElementById('story-studio-modal-root');
      if (ssModal) {
        ssModal.remove();
      }
    }

    // Restaurar visibilidad por si algún observer previo ocultó el botón cerrado del dropdown ('Omni 1.1 Flash')
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

    const realUiClick = (el) => {
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
    };

    // En modo VIDEO buscamos exclusivamente 'Veo 3.1 - Lite [Lower Priority]' para no confundir el botón cerrado 'Omni 1.1 Flash' con una opción ya elegida
    const preferredModels = isVideoMode
      ? [
          /veo\s*3\.1\s*-\s*lite\s*\[lower priority\]/i,
          /veo\s*3\.1\s*-\s*lite/i,
        ]
      : [
          /nano\s*banana\s*2\.1/i,
          /nano\s*banana\s*pro/i,
          /nano\s*banana\s*2/i,
          /nano\s*banana/i,
        ];

    const selectMenuOptionMatching = async (patterns, excludeEl = null) => {
      await sleepMain(160);
      const options = collectNodesDeep(
        document,
        '[role="menuitem"], [role="menuitemradio"], [role="option"], [role="tab"], [role="radio"], mat-option, mat-button-toggle button, [data-radix-popper-content-wrapper] button, [role="dialog"] button, [role="listbox"] *, button, li'
      ).filter((el) => {
        if (!el || el === excludeEl) return false;
        const r = el.getBoundingClientRect();
        return r.width > 16 && r.height > 14 && getComputedStyle(el).visibility !== 'hidden';
      });
      for (const pat of patterns) {
        const found = options.find((el) => {
          const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          const aria = ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).trim();
          return pat.test(txt) || (aria && pat.test(aria));
        });
        if (found) {
          realUiClick(found);
          await sleepMain(180);
          return true;
        }
      }
      return false;
    };

    // A) Si hay un selector de modo (Video vs Image) fuera del popover que esté en modo incorrecto, cambiarlo primero
    const allUiButtons = collectNodesDeep(
      document,
      'button, [role="button"], [role="tab"], [role="combobox"], mat-select'
    ).filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 18 && r.height > 14 && getComputedStyle(b).visibility !== 'hidden';
    });

    if (isVideoMode) {
      const topImageModeBtn = allUiButtons.find((b) => {
        const txt = (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim();
        return /^(create\s*images?|images?\s*mode|text\s*to\s*image|im[aá]genes)$/i.test(txt);
      });
      if (topImageModeBtn) {
        realUiClick(topImageModeBtn);
        await selectMenuOptionMatching([
          /^(videos?|text\s*to\s*video|texto\s*a\s*video|create\s*videos?|videocam\s*videos?)$/i,
        ]);
      }
    }

    // B) Si hay un selector de cantidad en x2 / x3 / x4 visible cerca del editor, cambiarlo a x1
    const multiCountBtn = allUiButtons.find((b) => {
      const txt = (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim();
      const aria = (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '');
      return (
        /^(x[234]|[234]\s*outputs?|[234]\s*videos?|[234]\s*images?)$/i.test(txt) ||
        (/outputs?\s*per\s*prompt/i.test(aria) && /\b[234]\b/.test(txt))
      );
    });
    if (multiCountBtn) {
      realUiClick(multiCountBtn);
      await selectMenuOptionMatching([/^x?1$/i, /^1\s*(output|video|image|item)?s?$/i, /\bx1\b/i], multiCountBtn);
    }

    // C) Verificar el selector de modelo/ajustes activo en la barra inferior y asegurar modo Video + 'Veo 3.1 - Lite [Lower Priority]' + x1
    const modelTriggerBtn = allUiButtons.find((b) => {
      if (b.closest('.cdk-overlay-container, [role="dialog"], [role="menu"], [role="listbox"]')) {
        return false;
      }
      const txt = (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim();
      return /(veo\s*2|veo\s*3|omni\s*1|nano\s*banana|imagen\s*3)/i.test(txt);
    });
    if (modelTriggerBtn) {
      const currentModelTxt = (modelTriggerBtn.innerText || modelTriggerBtn.textContent || '').replace(/\s+/g, ' ').trim();
      const alreadyPrimary = preferredModels.some((pat) => pat.test(currentModelTxt));
      const hasMultiCountInPill = /\bx[234]\b/i.test(currentModelTxt);

      if (!alreadyPrimary || hasMultiCountInPill) {
        realUiClick(modelTriggerBtn);
        await sleepMain(240);

        // C1) Si estamos en modo VIDEO pero el popover está en la pestaña Image (Nano Banana), pulsar la pestaña Video/Videos primero
        if (isVideoMode) {
          await selectMenuOptionMatching(
            [
              /^(videos?|text\s*to\s*video|texto\s*a\s*video|videocam\s*videos?|videocam\s*video)$/i,
              /\btext\s*to\s*video\b/i,
            ],
            modelTriggerBtn
          );
        } else {
          await selectMenuOptionMatching(
            [
              /^(images?|create\s*images?|text\s*to\s*image|image\s*to\s*image|im[aá]genes)$/i,
            ],
            modelTriggerBtn
          );
        }

        // C2) Asegurar cantidad x1 y duración <= 8s (para Veo 3.1 - Lite [Lower Priority]) dentro del popover
        await selectMenuOptionMatching([/^x?1$/i, /^1\s*(output|video|image|item)?s?$/i], modelTriggerBtn);
        if (isVideoMode) {
          await selectMenuOptionMatching([/^8\s*s(ec(ond)?s?)?$/i, /^8s$/i], modelTriggerBtn);
        }

        // C3) Intentar elegir directamente 'Veo 3.1 - Lite [Lower Priority]' (o abrir el sub-dropdown de modelo dentro del popover)
        let picked = await selectMenuOptionMatching(preferredModels, modelTriggerBtn);
        if (!picked) {
          const innerDropdownBtns = collectNodesDeep(
            document,
            '.cdk-overlay-container button, .cdk-overlay-container [role="combobox"], .cdk-overlay-container mat-select, [data-radix-popper-content-wrapper] button, [data-radix-popper-content-wrapper] [role="combobox"], [role="dialog"] button, [role="dialog"] [role="combobox"], [role="menu"] button'
          ).filter((el) => {
            if (!el || el === modelTriggerBtn) return false;
            const r = el.getBoundingClientRect();
            if (r.width < 40 || r.height < 16 || getComputedStyle(el).visibility === 'hidden') return false;
            const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            return /(omni\s*1|veo\s*2|veo\s*3|nano\s*banana|imagen\s*3|model|modelo)/i.test(txt);
          });
          if (innerDropdownBtns.length > 0) {
            realUiClick(innerDropdownBtns[0]);
            await sleepMain(240);
            picked = await selectMenuOptionMatching(preferredModels, innerDropdownBtns[0]);
          }
        }

        // C4) Cerrar cualquier popover/backdrop abierto para que no bloquee el editor ni el botón de enviar
        const backdrops = Array.from(
          document.querySelectorAll('.cdk-overlay-backdrop, [class*="overlay-backdrop" i]')
        );
        if (backdrops.length > 0) {
          for (const bd of backdrops) {
            try {
              realUiClick(bd);
            } catch {}
          }
          await sleepMain(180);
        } else {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
          await sleepMain(180);
        }
      }
    }
  } catch {}

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

  // Verificar si el botón de modelo en la barra inferior ya quedó en el motor correcto ('Veo 3.1 - Lite [Lower Priority]' para video)
  let modelVerifiedOnTarget = true;
  try {
    const isVideoModeCheck =
      mediaType === 'VIDEO' || /^\s*\*?\*?Clip\s+\d+/i.test(String(rawPromptText || ''));
    const pillBtn = Array.from(
      document.querySelectorAll('button, [role="button"], [role="combobox"], mat-select')
    ).find((b) => {
      if (b.closest('.cdk-overlay-container, [role="dialog"], [role="menu"], [role="listbox"]')) {
        return false;
      }
      const r = b.getBoundingClientRect();
      if (r.width < 18 || r.height < 14 || getComputedStyle(b).visibility === 'hidden') return false;
      const txt = (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim();
      return /(veo\s*2|veo\s*3|omni\s*1|nano\s*banana|imagen\s*3)/i.test(txt);
    });
    if (pillBtn) {
      const pillTxt = (pillBtn.innerText || pillBtn.textContent || '').replace(/\s+/g, ' ').trim();
      if (isVideoModeCheck && !/veo\s*3\.1\s*-\s*lite/i.test(pillTxt)) {
        modelVerifiedOnTarget = false;
      } else if (!isVideoModeCheck && !/nano\s*banana/i.test(pillTxt)) {
        modelVerifiedOnTarget = false;
      } else if (/\bx[234]\b/i.test(pillTxt)) {
        modelVerifiedOnTarget = false;
      }
    }
  } catch {}

  // Intentar primer click directo sobre button.generate-icon-button en MAIN world SÓLO si el modelo ya está en Veo 3.1 - Lite [Lower Priority]
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

  if (genBtn && modelVerifiedOnTarget) {
    try {
      genBtn.click();
    } catch {}
  }

  const finalLen = (editorEl.innerText || editorEl.textContent || editorEl.value || '').trim()
    .length;
  return {
    injected: finalLen > 0 || Boolean(genBtn),
    remainingLength: finalLen,
    needsHardwareModelSwitch: !modelVerifiedOnTarget,
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
  const target = { tabId };
  const mediaType = String(payload.mediaType || '');
  const logoDataUrl = String(payload.logoDataUrl || '');

  // 1. Activar la pestaña de Google Flow únicamente si focusTab === true
  if (payload.focusTab === true) {
    const tab = await chrome.tabs.update(tabId, { active: true }).catch(() => null);
    if (tab?.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    }
    await sleep(150);
  }

  // 2. Inyectar el prompt en MAIN world ANTES de adjuntar chrome.debugger (buscando en todos los frames)
  const mainAttempts = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    args: [rawPromptText, mediaType, logoDataUrl],
    func: injectPromptIntoBottomEditor,
  });

  const mainAttempt =
    (mainAttempts || []).find((r) => r?.result?.injected) || (mainAttempts || [])[0];
  const matchedFrameId = typeof mainAttempt?.frameId === 'number' ? mainAttempt.frameId : 0;
  const frameTarget =
    matchedFrameId > 0 ? { tabId, frameIds: [matchedFrameId] } : { tabId };

  if (!mainAttempt?.result?.injected) {
    // 2B. Buscar también en todos los Out-Of-Process Iframes (OOPIFs / Story Studio) vía CDP
    const oopifAttempt = await evaluateAcrossAllFlowFramesAndOopifs(
      tabId,
      injectPromptIntoBottomEditor,
      [rawPromptText, mediaType, logoDataUrl],
      (r) => Boolean(r && r.injected)
    );
    if (oopifAttempt && oopifAttempt.injected) {
      return {
        success: true,
        submitted: true,
        method: 'CDP_OOPIF_DIRECT',
      };
    }

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
    target: frameTarget,
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
    // 3B. Si el selector de modelo aún no está en 'Veo 3.1 - Lite [Lower Priority]' (para video) o 'Nano Banana' (para imagen),
    //     cambiarlo usando clics físicos de hardware (isTrusted: true vía CDP) antes de enviar el prompt.
    try {
      const isVideoModeCdp =
        mediaType === 'VIDEO' || /^\s*\*?\*?Clip\s+\d+/i.test(String(rawPromptText || ''));
      const [pillCheck] = await chrome.scripting.executeScript({
        target: frameTarget,
        world: 'MAIN',
        args: [isVideoModeCdp],
        func: (isVid) => {
          const allBtns = Array.from(
            document.querySelectorAll('button, [role="button"], [role="combobox"], mat-select')
          ).filter((b) => {
            if (b.closest('.cdk-overlay-container, [role="dialog"], [role="menu"], [role="listbox"]'))
              return false;
            const r = b.getBoundingClientRect();
            return r.width > 18 && r.height > 14 && getComputedStyle(b).visibility !== 'hidden';
          });
          const pill = allBtns.find((b) => {
            const txt = (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim();
            return /(veo\s*2|veo\s*3|omni\s*1|nano\s*banana|imagen\s*3)/i.test(txt);
          });
          if (!pill) return { needsSwitch: false };
          const txt = (pill.innerText || pill.textContent || '').replace(/\s+/g, ' ').trim();
          const okModel = isVid ? /veo\s*3\.1\s*-\s*lite/i.test(txt) : /nano\s*banana/i.test(txt);
          const okCount = !/\bx[234]\b/i.test(txt);
          const r = pill.getBoundingClientRect();
          return {
            needsSwitch: !okModel || !okCount,
            x: Math.round(r.left + r.width / 2),
            y: Math.round(r.top + r.height / 2),
          };
        },
      });

      if (pillCheck?.result?.needsSwitch && pillCheck.result.x && pillCheck.result.y) {
        // 1) Clic físico en la píldora de modelo inferior para abrir el popover
        await dispatchHardwareClick(target, pillCheck.result.x, pillCheck.result.y);
        await sleep(320);

        // 2) Buscar dentro del popover la pestaña Video/Image, botón x1, y la opción 'Veo 3.1 - Lite [Lower Priority]' (o el sub-dropdown de modelo)
        const [popoverCheck] = await chrome.scripting.executeScript({
          target: frameTarget,
          world: 'MAIN',
          args: [isVideoModeCdp],
          func: (isVid) => {
            const getCenter = (el) => {
              if (!el) return null;
              const r = el.getBoundingClientRect();
              if (r.width < 12 || r.height < 12) return null;
              return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            };
            const allNodes = Array.from(
              document.querySelectorAll(
                '[role="option"], [role="menuitem"], [role="menuitemradio"], [role="tab"], [role="radio"], mat-option, mat-button-toggle button, .cdk-overlay-container button, [data-radix-popper-content-wrapper] button, [role="dialog"] button, [role="listbox"] *, button, li'
              )
            ).filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 14 && r.height > 12 && getComputedStyle(el).visibility !== 'hidden';
            });

            const targetPat = isVid
              ? /veo\s*3\.1\s*-\s*lite\s*\[lower priority\]|veo\s*3\.1\s*-\s*lite/i
              : /nano\s*banana\s*2\.1|nano\s*banana\s*pro|nano\s*banana/i;

            const directOpt = allNodes.find((el) => {
              const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
              return targetPat.test(t) && t.length < 60;
            });

            const x1Btn = allNodes.find((el) => {
              const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
              return /^x?1$/i.test(t);
            });

            const dur8sBtn = isVid
              ? allNodes.find((el) => {
                  const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                  return /^8\s*s(ec(ond)?s?)?$/i.test(t);
                })
              : null;

            const innerDropdown = Array.from(
              document.querySelectorAll(
                '.cdk-overlay-container button, .cdk-overlay-container [role="combobox"], .cdk-overlay-container mat-select, [data-radix-popper-content-wrapper] button, [data-radix-popper-content-wrapper] [role="combobox"], [role="dialog"] button, [role="dialog"] [role="combobox"]'
              )
            ).find((el) => {
              const r = el.getBoundingClientRect();
              if (r.width < 45 || r.height < 16 || getComputedStyle(el).visibility === 'hidden')
                return false;
              const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
              return /(omni\s*1|veo\s*2|veo\s*3|nano\s*banana|imagen\s*3)/i.test(t);
            });

            return {
              x1Coords: getCenter(x1Btn),
              dur8sCoords: getCenter(dur8sBtn),
              directOptCoords: getCenter(directOpt),
              innerDropdownCoords: getCenter(innerDropdown),
            };
          },
        });

        if (popoverCheck?.result?.x1Coords) {
          await dispatchHardwareClick(
            target,
            popoverCheck.result.x1Coords.x,
            popoverCheck.result.x1Coords.y
          );
          await sleep(180);
        }

        if (popoverCheck?.result?.dur8sCoords) {
          await dispatchHardwareClick(
            target,
            popoverCheck.result.dur8sCoords.x,
            popoverCheck.result.dur8sCoords.y
          );
          await sleep(180);
        }

        if (popoverCheck?.result?.directOptCoords) {
          await dispatchHardwareClick(
            target,
            popoverCheck.result.directOptCoords.x,
            popoverCheck.result.directOptCoords.y
          );
          await sleep(240);
        } else if (popoverCheck?.result?.innerDropdownCoords) {
          // Abrir el sub-dropdown de modelo dentro del popover con clic físico
          await dispatchHardwareClick(
            target,
            popoverCheck.result.innerDropdownCoords.x,
            popoverCheck.result.innerDropdownCoords.y
          );
          await sleep(300);

          const [listCheck] = await chrome.scripting.executeScript({
            target: frameTarget,
            world: 'MAIN',
            args: [isVideoModeCdp],
            func: (isVid) => {
              const targetPat = isVid
                ? /veo\s*3\.1\s*-\s*lite\s*\[lower priority\]|veo\s*3\.1\s*-\s*lite/i
                : /nano\s*banana\s*2\.1|nano\s*banana\s*pro|nano\s*banana/i;
              const items = Array.from(
                document.querySelectorAll(
                  '[role="option"], [role="menuitem"], [role="menuitemradio"], mat-option, .cdk-overlay-container button, [data-radix-popper-content-wrapper] *, [role="listbox"] *, li, button'
                )
              ).filter((el) => {
                const r = el.getBoundingClientRect();
                return r.width > 30 && r.height > 14 && getComputedStyle(el).visibility !== 'hidden';
              });
              const hit = items.find((el) => {
                const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                return targetPat.test(t) && t.length < 65;
              });
              if (!hit) return null;
              const r = hit.getBoundingClientRect();
              return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            },
          });

          if (listCheck?.result?.x && listCheck?.result?.y) {
            await dispatchHardwareClick(target, listCheck.result.x, listCheck.result.y);
            await sleep(240);
          }
        }

        // Cerrar cualquier popover residual con Escape antes de medir el botón de enviar
        await chrome.debugger
          .sendCommand(target, 'Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'Escape',
            code: 'Escape',
            windowsVirtualKeyCode: 27,
            nativeVirtualKeyCode: 27,
          })
          .catch(() => {});
        await chrome.debugger
          .sendCommand(target, 'Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'Escape',
            code: 'Escape',
            windowsVirtualKeyCode: 27,
            nativeVirtualKeyCode: 27,
          })
          .catch(() => {});
        await sleep(150);
      }
    } catch {}

    // 4. Asegurar que el texto sigue en el editor inferior y obtener las coordenadas exactas de button.generate-icon-button
    const [prep] = await chrome.scripting.executeScript({
      target: frameTarget,
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
      target: frameTarget,
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
          version: '2.6.0',
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

      let targetTab =
        serviceTabs.find((t) => t.id === payload.tabId) || serviceTabs[0] || null;

      const shouldFocusTargetTab =
        targetService === 'GEMINI' || targetService === 'FLOW' || targetService === 'SUNO'
          ? false
          : payload.focusTab === true;

      if (!targetTab) {
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
                    const cleanExpected = (expectedPrompt || '')
                      .replace(/\r\n/g, '\n')
                      .split('\n')
                      .map((l) => l.trim())
                      .filter(Boolean)
                      .join('   |   ')
                      .trim();
                    if (!cleanExpected) return;
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
                    if (!currentText || currentText.length < minExpectedLen) {
                      inputEl.focus();
                      try {
                        const selection = window.getSelection();
                        const range = document.createRange();
                        range.selectNodeContents(inputEl);
                        selection.removeAllRanges();
                        selection.addRange(range);
                        document.execCommand('delete', false);
                        document.execCommand('insertText', false, cleanExpected);
                      } catch {}
                      const afterInsert = (
                        inputEl.value ??
                        inputEl.innerText ??
                        inputEl.textContent ??
                        ''
                      ).trim();
                      if (!afterInsert || afterInsert.length < minExpectedLen) {
                        inputEl.innerHTML = '';
                        const p = document.createElement('p');
                        p.textContent = cleanExpected;
                        inputEl.appendChild(p);
                        inputEl.dispatchEvent(
                          new InputEvent('input', {
                            bubbles: true,
                            cancelable: true,
                            composed: true,
                            inputType: 'insertFromPaste',
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
    })();

    return true;
  }

  // 3. Forward status & responses from Gemini/Flow/Suno tab ONLY to Huellas Master in the SAME window
  if (
    message.type === 'BRIDGE_STATUS' ||
    message.type === 'GEMINI_RESPONSE_READY' ||
    message.type === 'FLOW_MEDIA_READY' ||
    message.type === 'FLOW_VIDEO_CAPTURED' ||
    message.type === 'FLOW_CLIP_IMAGE_CAPTURED' ||
    message.type === 'FLOW_THUMBNAIL_CAPTURED' ||
    message.type === 'FLOW_REFERENCE_CAPTURED' ||
    message.type === 'FLOW_GENERATION_FAILED' ||
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

  return false;
});
