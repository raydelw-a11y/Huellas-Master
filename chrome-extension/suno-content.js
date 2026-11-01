// ============================================================================
// HUELLAS MASTER — FLOW MUSIC (flowmusic.app) & SUNO CONTENT SCRIPT (v2.6.0)
// Injects documentary instrumental prompts into Flow Music (flowmusic.app),
// triggers generation, watches for newly created .m4a/.mp3/.wav tracks,
// and sends binary audio back to Huellas Master for Track 5 & 02_Audio save.
// ============================================================================

(function () {
  if (window.__HUELLAS_SUNO_CONTENT_LOADED__) return;
  window.__HUELLAS_SUNO_CONTENT_LOADED__ = true;

  const isFlowMusicSite = () => {
    const h = (location.hostname || '').toLowerCase();
    return h.includes('flowmusic.app') || h.includes('producer.ai');
  };

  function reportStatus(status, message, extra = {}) {
    try {
      chrome.runtime
        .sendMessage({
          type: 'BRIDGE_STATUS',
          service: 'SUNO',
          status,
          message,
          ...extra,
        })
        .catch(() => {});
    } catch {}
  }

  function findSunoPromptTextarea() {
    const exactFlowMusic =
      document.querySelector('textarea[aria-label="Chat message"]') ||
      document.querySelector('textarea[placeholder*="Describe your song" i]');
    if (exactFlowMusic) return exactFlowMusic;

    const textareas = Array.from(document.querySelectorAll('textarea'));
    const visible = textareas.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 100 && r.height >= 16;
    });
    if (visible.length === 0) return null;
    const byPlaceholder = visible.find((el) => {
      const ph = (
        (el.getAttribute('placeholder') || '') +
        ' ' +
        (el.getAttribute('aria-label') || '')
      ).toLowerCase();
      return (
        ph.includes('song') ||
        ph.includes('chat message') ||
        ph.includes('style') ||
        ph.includes('describe') ||
        ph.includes('prompt') ||
        ph.includes('instrumental')
      );
    });
    return byPlaceholder || visible[0];
  }

  function setNativeTextareaValue(el, text) {
    if (!el) return;
    const proto = window.HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    el.focus();
    try {
      if (el._valueTracker) {
        el._valueTracker.setValue('');
      }
    } catch {}
    if (setter) {
      setter.call(el, text);
    } else {
      el.value = text;
    }
    el.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text,
      })
    );
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findSunoCreateButton() {
    const flowSendBtn =
      document.querySelector('button[aria-label="Send message"]:not([disabled])') ||
      document.querySelector('button[aria-label="Send message"]') ||
      document.querySelector('button[aria-label*="Send" i]:not([disabled])');
    if (flowSendBtn) return flowSendBtn;

    const buttons = Array.from(document.querySelectorAll('button'));
    for (const btn of buttons) {
      const r = btn.getBoundingClientRect();
      if (r.width < 22 || r.height < 22) continue;
      const txt = (btn.innerText || btn.getAttribute('aria-label') || '').trim().toLowerCase();
      if (
        txt === 'send message' ||
        txt === 'create' ||
        txt.startsWith('create') ||
        txt === 'crear' ||
        txt === 'generate'
      ) {
        return btn;
      }
    }
    return null;
  }

  function collectAllCurrentMp3Urls() {
    const urls = new Set();
    const clipRegex =
      /https:\/\/storage\.googleapis\.com\/producer-app-public\/clips\/[a-zA-Z0-9_-]+\.(?:m4a|mp3|wav)/g;
    const sunoRegex = /https:\/\/cdn[12]?\.suno\.ai\/[a-zA-Z0-9_-]+\.mp3/g;

    const addMatchesFromText = (txt) => {
      if (!txt) return;
      let m;
      while ((m = clipRegex.exec(txt)) !== null) {
        urls.add(m[0]);
      }
      while ((m = sunoRegex.exec(txt)) !== null) {
        urls.add(m[0]);
      }
    };

    // 1. Check <audio> and <source> elements
    for (const a of Array.from(document.querySelectorAll('audio, source'))) {
      const src = a.currentSrc || a.src || '';
      if (
        src &&
        (src.includes('.m4a') ||
          src.includes('.mp3') ||
          src.includes('.wav') ||
          src.includes('producer-app-public/clips/') ||
          src.includes('suno.ai') ||
          src.includes('suno.com'))
      ) {
        urls.add(src);
      }
    }

    // 2. Check MAIN-world published attribute (from network & React Fiber hook)
    try {
      const attr = document.documentElement.getAttribute('data-huellas-flowmusic-urls');
      if (attr) {
        const parsed = JSON.parse(attr);
        if (Array.isArray(parsed)) {
          for (const u of parsed) {
            if (typeof u === 'string' && u.startsWith('http')) urls.add(u);
          }
        }
      }
    } catch {}

    // 3. Check performance resource timing entries
    try {
      const entries = performance.getEntriesByType('resource') || [];
      for (const entry of entries) {
        const name = entry?.name || '';
        if (
          name.includes('producer-app-public/clips/') ||
          name.includes('cdn1.suno.ai') ||
          name.includes('cdn2.suno.ai')
        ) {
          addMatchesFromText(name);
        }
      }
    } catch {}

    // 4. Check HTML and __NEXT_DATA__ (ensures showcase baseline tracks are known before generation)
    addMatchesFromText(document.body?.innerHTML || '');
    const nextDataEl = document.getElementById('__NEXT_DATA__');
    if (nextDataEl) {
      addMatchesFromText(nextDataEl.textContent || '');
    }

    return urls;
  }

  async function fetchAudioAsDataUrl(audioUrl) {
    try {
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'FETCH_VIDEO_BASE64', url: audioUrl },
          (r) => resolve(r || { ok: false })
        );
      });
      if (resp && resp.ok && resp.dataUrl) {
        return resp.dataUrl;
      }
    } catch {}
    return '';
  }

  function startSunoAudioWatcher({ trackNumber, trackTitle, baselineUrls }) {
    if (window.__HUELLAS_SUNO_WATCHER__) {
      clearInterval(window.__HUELLAS_SUNO_WATCHER__);
      window.__HUELLAS_SUNO_WATCHER__ = null;
    }

    const startedAt = Date.now();
    const maxWaitMs = 240000; // 4 minutes
    let capturing = false;
    const baselinePlayBtns = new Set(
      Array.from(document.querySelectorAll('main button[aria-label="Play"]'))
    );
    const clickedNewPlayBtns = new Set();
    const serviceLabel = isFlowMusicSite() ? 'Flow Music' : 'Suno';

    window.__HUELLAS_SUNO_WATCHER__ = setInterval(async () => {
      if (capturing) return;
      const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
      if (Date.now() - startedAt > maxWaitMs) {
        clearInterval(window.__HUELLAS_SUNO_WATCHER__);
        window.__HUELLAS_SUNO_WATCHER__ = null;
        reportStatus(
          'ERROR',
          `⚠️ Tiempo agotado esperando pista #${trackNumber || 1} en ${serviceLabel}.`
        );
        return;
      }

      const currentUrls = collectAllCurrentMp3Urls();
      let newUrl = '';
      // Prefer .m4a or .mp3 over .wav if multiple formats of the new clip appear
      const newCandidates = [];
      for (const u of currentUrls) {
        if (!baselineUrls.has(u)) {
          newCandidates.push(u);
        }
      }
      if (newCandidates.length > 0) {
        newUrl =
          newCandidates.find((u) => u.endsWith('.m4a') || u.endsWith('.mp3')) ||
          newCandidates[0];
      }

      // On flowmusic.app, if a new Play button appeared in the chat thread, click it once so <audio src> mounts
      if (!newUrl && isFlowMusicSite() && elapsedSec >= 8) {
        const currentPlayBtns = Array.from(
          document.querySelectorAll('main button[aria-label="Play"]')
        );
        for (const pb of currentPlayBtns) {
          if (!baselinePlayBtns.has(pb) && !clickedNewPlayBtns.has(pb)) {
            clickedNewPlayBtns.add(pb);
            try {
              pb.click();
              setTimeout(() => {
                for (const aud of Array.from(document.querySelectorAll('audio'))) {
                  try {
                    aud.pause();
                  } catch {}
                }
              }, 600);
            } catch {}
            break;
          }
        }
      }

      if (!newUrl) {
        if (elapsedSec % 5 === 0) {
          reportStatus(
            'GENERATING',
            `🎵 ${serviceLabel} componiendo pista #${trackNumber || 1} (${trackTitle || 'Instrumental'})... (${elapsedSec}s)`
          );
        }
        return;
      }

      capturing = true;
      for (const c of newCandidates) baselineUrls.add(c);
      clearInterval(window.__HUELLAS_SUNO_WATCHER__);
      window.__HUELLAS_SUNO_WATCHER__ = null;

      reportStatus(
        'WORKING',
        `🎵 ¡Pista #${trackNumber || 1} generada en ${serviceLabel}! Descargando audio e inyectando en Pista 5 del Editor (con Fade-In/Out y Ducking)...`
      );

      await new Promise((r) => setTimeout(r, 1500));
      const audioDataUrl = await fetchAudioAsDataUrl(newUrl);

      chrome.runtime
        .sendMessage({
          type: 'SUNO_AUDIO_CAPTURED',
          trackNumber: trackNumber || 1,
          trackTitle:
            trackTitle || `FlowMusic_${String(trackNumber || 1).padStart(2, '0')}`,
          audioUrl: newUrl,
          audioDataUrl,
        })
        .catch(() => {});
    }, 2500);
  }

  async function handleScanSunoTracks() {
    const allUrls = Array.from(collectAllCurrentMp3Urls());
    // Exclude preloaded showcase tracks from __NEXT_DATA__ if possible
    const showcaseUrls = new Set();
    try {
      const nextDataEl = document.getElementById('__NEXT_DATA__');
      if (nextDataEl && nextDataEl.textContent) {
        const rx =
          /https:\/\/storage\.googleapis\.com\/producer-app-public\/clips\/[a-zA-Z0-9_-]+\.(?:m4a|mp3|wav)/g;
        let m;
        while ((m = rx.exec(nextDataEl.textContent)) !== null) {
          showcaseUrls.add(m[0]);
        }
      }
    } catch {}

    const userUrls = allUrls.filter((u) => !showcaseUrls.has(u));
    const targetUrls = userUrls.length > 0 ? userUrls : allUrls;
    const serviceLabel = isFlowMusicSite() ? 'Flow Music' : 'Suno';

    if (targetUrls.length === 0) {
      reportStatus(
        'ERROR',
        `No se detectaron pistas de audio activas en la página actual de ${serviceLabel}.`
      );
      return;
    }
    reportStatus(
      'WORKING',
      `🎵 Capturando ${targetUrls.length} pista(s) desde ${serviceLabel}...`
    );
    let idx = 1;
    for (const u of targetUrls.slice(0, 12)) {
      const audioDataUrl = await fetchAudioAsDataUrl(u);
      chrome.runtime
        .sendMessage({
          type: 'SUNO_AUDIO_CAPTURED',
          trackNumber: idx,
          trackTitle: `FlowMusic_${String(idx).padStart(2, '0')}`,
          audioUrl: u,
          audioDataUrl,
        })
        .catch(() => {});
      idx++;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'SUNO') return false;

    if (msg.action === 'SEND_PROMPT') {
      const baselineUrls = collectAllCurrentMp3Urls();
      const input = findSunoPromptTextarea();
      const serviceLabel = isFlowMusicSite() ? 'Flow Music (flowmusic.app)' : 'Suno';
      if (!input) {
        reportStatus(
          'ERROR',
          `Abre ${serviceLabel} para pegar el prompt musical automáticamente.`
        );
        sendResponse({ handled: false });
        return false;
      }
      setNativeTextareaValue(input, msg.prompt || '');
      reportStatus(
        'PROMPT_INJECTED',
        `🎵 Prompt de Pista #${msg.trackNumber || 1} enviado a ${serviceLabel}.`
      );

      if (msg.autoSubmit !== false) {
        setTimeout(() => {
          const btn = findSunoCreateButton();
          if (btn && !btn.disabled) {
            btn.click();
          } else {
            input.dispatchEvent(
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
          startSunoAudioWatcher({
            trackNumber: msg.trackNumber || 1,
            trackTitle:
              msg.trackTitle ||
              `FlowMusic_${String(msg.trackNumber || 1).padStart(2, '0')}`,
            baselineUrls,
          });
        }, 450);
      }
      sendResponse({ handled: true });
      return false;
    }

    if (msg.action === 'SCAN_SUNO_TRACKS') {
      handleScanSunoTracks();
      sendResponse({ handled: true });
      return false;
    }

    return false;
  });
})();
