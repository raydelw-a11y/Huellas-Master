// ============================================================================
// HUELLAS MASTER — SUNO.COM CONTENT SCRIPT (v1.9.0)
// Injects Suno instrumental prompts, triggers creation, watches for generated
// .mp3 tracks, and sends binary audio back to Huellas Master for Track 5 & disk save.
// ============================================================================

(function () {
  if (window.__HUELLAS_SUNO_CONTENT_LOADED__) return;
  window.__HUELLAS_SUNO_CONTENT_LOADED__ = true;

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
    const textareas = Array.from(document.querySelectorAll('textarea'));
    const visible = textareas.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 120 && r.height > 30;
    });
    if (visible.length === 0) return null;
    // Prefer style/song description textarea
    const byPlaceholder = visible.find((el) => {
      const ph = (el.getAttribute('placeholder') || '').toLowerCase();
      return (
        ph.includes('song') ||
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
    if (setter) {
      setter.call(el, text);
    } else {
      el.value = text;
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findSunoCreateButton() {
    const buttons = Array.from(document.querySelectorAll('button'));
    for (const btn of buttons) {
      const r = btn.getBoundingClientRect();
      if (r.width < 40 || r.height < 24) continue;
      const txt = (btn.innerText || btn.getAttribute('aria-label') || '').trim().toLowerCase();
      if (txt === 'create' || txt.startsWith('create') || txt === 'crear') {
        return btn;
      }
    }
    return null;
  }

  function collectAllCurrentMp3Urls() {
    const urls = new Set();
    // 1. Check <audio> elements
    for (const a of Array.from(document.querySelectorAll('audio'))) {
      const src = a.currentSrc || a.src || a.querySelector('source')?.src || '';
      if (src && (src.includes('.mp3') || src.includes('suno.ai') || src.includes('suno.com'))) {
        urls.add(src);
      }
    }
    // 2. Check links or data attributes with cdn1.suno.ai / cdn2.suno.ai .mp3
    const html = document.body?.innerHTML || '';
    const regex = /https:\/\/cdn[12]?\.suno\.ai\/[a-zA-Z0-9_-]+\.mp3/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      urls.add(match[0]);
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
    const maxWaitMs = 210000; // 3.5 minutes
    let capturing = false;

    window.__HUELLAS_SUNO_WATCHER__ = setInterval(async () => {
      if (capturing) return;
      const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
      if (Date.now() - startedAt > maxWaitMs) {
        clearInterval(window.__HUELLAS_SUNO_WATCHER__);
        window.__HUELLAS_SUNO_WATCHER__ = null;
        reportStatus('ERROR', `⚠️ Tiempo agotado esperando pista #${trackNumber || 1} en Suno.`);
        return;
      }

      const currentUrls = collectAllCurrentMp3Urls();
      let newUrl = '';
      for (const u of currentUrls) {
        if (!baselineUrls.has(u)) {
          newUrl = u;
          break;
        }
      }

      if (!newUrl) {
        if (elapsedSec % 5 === 0) {
          reportStatus(
            'GENERATING',
            `🎵 Suno componiendo pista #${trackNumber || 1} (${trackTitle || 'Instrumental'})... (${elapsedSec}s)`
          );
        }
        return;
      }

      capturing = true;
      baselineUrls.add(newUrl);
      clearInterval(window.__HUELLAS_SUNO_WATCHER__);
      window.__HUELLAS_SUNO_WATCHER__ = null;

      reportStatus(
        'WORKING',
        `🎵 ¡Pista #${trackNumber || 1} detectada en Suno! Descargando MP3 e inyectando en Pista 5 del Editor CapCut...`
      );

      await new Promise((r) => setTimeout(r, 1500));
      const audioDataUrl = await fetchAudioAsDataUrl(newUrl);

      chrome.runtime
        .sendMessage({
          type: 'SUNO_AUDIO_CAPTURED',
          trackNumber: trackNumber || 1,
          trackTitle: trackTitle || `Suno_${String(trackNumber || 1).padStart(2, '0')}`,
          audioUrl: newUrl,
          audioDataUrl,
        })
        .catch(() => {});
    }, 2500);
  }

  async function handleScanSunoTracks() {
    const urls = Array.from(collectAllCurrentMp3Urls());
    if (urls.length === 0) {
      reportStatus('ERROR', 'No se detectaron pistas MP3 activas en la página actual de Suno.');
      return;
    }
    reportStatus('WORKING', `🎵 Capturando ${urls.length} pista(s) MP3 desde Suno...`);
    let idx = 1;
    for (const u of urls.slice(0, 6)) {
      const audioDataUrl = await fetchAudioAsDataUrl(u);
      chrome.runtime
        .sendMessage({
          type: 'SUNO_AUDIO_CAPTURED',
          trackNumber: idx,
          trackTitle: `Suno_${String(idx).padStart(2, '0')}`,
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
      if (!input) {
        reportStatus(
          'ERROR',
          'Abre la sección Create en Suno.com para pegar el prompt musical automáticamente.'
        );
        sendResponse({ handled: false });
        return false;
      }
      setNativeTextareaValue(input, msg.prompt || '');
      reportStatus('PROMPT_INJECTED', `Prompt de Pista #${msg.trackNumber || 1} pegado en Suno.`);

      if (msg.autoSubmit !== false) {
        setTimeout(() => {
          const btn = findSunoCreateButton();
          if (btn) {
            btn.click();
            startSunoAudioWatcher({
              trackNumber: msg.trackNumber || 1,
              trackTitle: msg.trackTitle || `Suno_${String(msg.trackNumber || 1).padStart(2, '0')}`,
              baselineUrls,
            });
          }
        }, 400);
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
