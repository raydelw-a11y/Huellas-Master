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

  // Prevent Flow Music from auto-playing songs when generation finishes
  let lastManualPlayClickAt = 0;
  if (isFlowMusicSite()) {
    const recordManualPlayIfTrusted = (e) => {
      try {
        if (!e || !e.isTrusted) return;
        if (document.documentElement.getAttribute('data-huellas-synthetic-click') === '1') return;
        const btn = e.target?.closest?.('button');
        if (!btn) return;
        const label = (
          (btn.getAttribute('aria-label') || '') +
          ' ' +
          (btn.innerText || '')
        ).toLowerCase();
        if (label.includes('play') || label.includes('reproducir')) {
          lastManualPlayClickAt = Date.now();
          document.documentElement.setAttribute(
            'data-huellas-last-manual-play',
            String(lastManualPlayClickAt)
          );
        }
      } catch {}
    };

    window.addEventListener('pointerdown', recordManualPlayIfTrusted, true);
    window.addEventListener('click', recordManualPlayIfTrusted, true);

    const stopUnexpectedAutoplay = (e) => {
      try {
        const media = e?.target;
        if (!media || typeof media.pause !== 'function') return;
        const isSynthetic =
          document.documentElement.getAttribute('data-huellas-synthetic-click') === '1';
        const isManual = !isSynthetic && Date.now() - lastManualPlayClickAt < 1800;
        if (!isManual) {
          media.muted = true;
          media.volume = 0;
          media.pause();
        } else {
          media.muted = false;
          if (media.volume === 0) media.volume = 1;
        }
      } catch {}
    };

    window.addEventListener('play', stopUnexpectedAutoplay, true);
    window.addEventListener('playing', stopUnexpectedAutoplay, true);
  }

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
    // 1. Specific known selectors for Flow Music (flowmusic.app / producer.ai) & Suno
    const exactSelectors = [
      'textarea[aria-label="Chat message"]',
      'textarea[placeholder*="Describe your song" i]',
      'textarea[placeholder*="Describe" i]',
      'textarea[placeholder*="song" i]',
      'textarea[placeholder*="music" i]',
      'textarea[placeholder*="prompt" i]',
      'textarea[placeholder*="track" i]',
      'textarea[placeholder*="style" i]',
      'textarea[data-testid*="prompt" i]',
      'textarea[data-testid*="chat" i]',
      'textarea[name="prompt"]',
      'textarea[name="message"]',
      'input[type="text"][placeholder*="Describe" i]',
      'input[type="text"][placeholder*="song" i]',
      'input[type="text"][placeholder*="music" i]',
      'input[type="text"][placeholder*="prompt" i]',
      'input[type="text"][aria-label*="prompt" i]',
      'input[type="text"][aria-label*="message" i]',
      '[contenteditable="true"][aria-label*="prompt" i]',
      '[contenteditable="true"][aria-label*="message" i]',
      '[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      '[role="textbox"]',
    ];

    for (const sel of exactSelectors) {
      try {
        const found = document.querySelector(sel);
        if (found) {
          const r = found.getBoundingClientRect();
          if (r.width > 40 && r.height >= 14 && window.getComputedStyle(found).display !== 'none') {
            return found;
          }
        }
      } catch {}
    }

    // 2. Any visible textarea on screen
    const textareas = Array.from(document.querySelectorAll('textarea'));
    const visibleTextareas = textareas.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 40 && r.height >= 14 && window.getComputedStyle(el).display !== 'none';
    });
    if (visibleTextareas.length > 0) {
      const byKeyword = visibleTextareas.find((el) => {
        const ph = (
          (el.getAttribute('placeholder') || '') +
          ' ' +
          (el.getAttribute('aria-label') || '')
        ).toLowerCase();
        return (
          ph.includes('song') ||
          ph.includes('chat') ||
          ph.includes('style') ||
          ph.includes('describe') ||
          ph.includes('prompt') ||
          ph.includes('music') ||
          ph.includes('instrumental')
        );
      });
      return byKeyword || visibleTextareas[0];
    }

    // 3. Any visible text input in main or forms
    const inputs = Array.from(
      document.querySelectorAll(
        'main input[type="text"], main input:not([type]), form input[type="text"], form input:not([type]), input[type="text"], input:not([type])'
      )
    );
    const visibleInputs = inputs.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 80 && r.height >= 16 && window.getComputedStyle(el).display !== 'none';
    });
    if (visibleInputs.length > 0) {
      const byKeyword = visibleInputs.find((el) => {
        const ph = (
          (el.getAttribute('placeholder') || '') +
          ' ' +
          (el.getAttribute('aria-label') || '')
        ).toLowerCase();
        return (
          ph.includes('song') ||
          ph.includes('chat') ||
          ph.includes('describe') ||
          ph.includes('prompt') ||
          ph.includes('music')
        );
      });
      return byKeyword || visibleInputs[0];
    }

    return null;
  }

  function setNativeTextareaValue(el, text) {
    if (!el) return;
    el.focus();

    if (el instanceof HTMLTextAreaElement || el.tagName === 'TEXTAREA') {
      const proto = window.HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      try {
        if (el._valueTracker) el._valueTracker.setValue('');
      } catch {}
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text,
        })
      );
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el instanceof HTMLInputElement || el.tagName === 'INPUT') {
      const proto = window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      try {
        if (el._valueTracker) el._valueTracker.setValue('');
      } catch {}
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text,
        })
      );
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, text);
      } catch {}
      if ((el.innerText || '').trim() !== text.trim()) {
        el.innerText = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }

  function findSunoCreateButton(inputEl) {
    // 1. Direct explicit button match
    const flowSendBtn =
      document.querySelector('button[aria-label="Send message"]:not([disabled])') ||
      document.querySelector('button[aria-label="Send message"]') ||
      document.querySelector('button[aria-label*="Send" i]:not([disabled])') ||
      document.querySelector('button[aria-label*="Generate" i]:not([disabled])') ||
      document.querySelector('button[aria-label*="Create" i]:not([disabled])') ||
      document.querySelector('button[aria-label*="Submit" i]:not([disabled])') ||
      document.querySelector('button[type="submit"]:not([disabled])');
    if (flowSendBtn) return flowSendBtn;

    // 2. Sibling / child button inside same form or container as input
    if (inputEl) {
      const container = inputEl.closest('form, div[class*="chat" i], div[class*="prompt" i], div[class*="input" i], section');
      if (container) {
        const containerBtns = Array.from(container.querySelectorAll('button:not([disabled])'));
        for (const btn of containerBtns) {
          const txt = (btn.innerText || btn.getAttribute('aria-label') || '').toLowerCase();
          if (
            txt.includes('send') ||
            txt.includes('create') ||
            txt.includes('generate') ||
            txt.includes('crear') ||
            txt.includes('submit')
          ) {
            return btn;
          }
          if (btn.querySelector('svg')) {
            return btn;
          }
        }
        if (containerBtns.length === 1) return containerBtns[0];
      }
    }

    // 3. Any visible button on the page with matching text
    const buttons = Array.from(document.querySelectorAll('button:not([disabled])'));
    for (const btn of buttons) {
      const r = btn.getBoundingClientRect();
      if (r.width < 18 || r.height < 18) continue;
      const txt = (btn.innerText || btn.getAttribute('aria-label') || '').trim().toLowerCase();
      if (
        txt === 'send message' ||
        txt === 'create' ||
        txt.startsWith('create') ||
        txt === 'crear' ||
        txt === 'generate' ||
        txt === 'generar' ||
        txt === 'submit'
      ) {
        return btn;
      }
    }
    return null;
  }

  function triggerSubmit(inputEl) {
    const btn = findSunoCreateButton(inputEl);
    if (btn && !btn.disabled) {
      btn.click();
      return true;
    }
    if (inputEl) {
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
      inputEl.dispatchEvent(
        new KeyboardEvent('keypress', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        })
      );
      inputEl.dispatchEvent(
        new KeyboardEvent('keyup', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        })
      );
      const form = inputEl.closest('form');
      if (form) {
        try {
          if (typeof form.requestSubmit === 'function') form.requestSubmit();
          else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        } catch {}
      }
      return true;
    }
    return false;
  }

  function isGenuineAudioUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const clean = url.trim().toLowerCase();
    // Strictly block Cloudflare edge endpoints (RUM, beacon, cdn-cgi)
    if (clean.includes('/cdn-cgi/') || (clean.includes('rum') && clean.includes('cloudflare'))) {
      return false;
    }
    // Block web bundles, styles, scripts, pages, images
    if (
      clean.includes('/_next/') ||
      clean.includes('/static/') ||
      clean.includes('/api/auth') ||
      clean.includes('/api/trpc')
    ) {
      return false;
    }
    const cleanNoQuery = clean.split(/[?#]/)[0];
    if (
      cleanNoQuery.endsWith('.js') ||
      cleanNoQuery.endsWith('.css') ||
      cleanNoQuery.endsWith('.json') ||
      cleanNoQuery.endsWith('.html') ||
      cleanNoQuery.endsWith('.png') ||
      cleanNoQuery.endsWith('.jpg') ||
      cleanNoQuery.endsWith('.jpeg') ||
      cleanNoQuery.endsWith('.svg') ||
      cleanNoQuery.endsWith('.ico') ||
      cleanNoQuery.endsWith('.webp') ||
      cleanNoQuery.endsWith('.map') ||
      cleanNoQuery.endsWith('.txt')
    ) {
      return false;
    }
    // Must be valid audio
    if (
      cleanNoQuery.endsWith('.mp3') ||
      cleanNoQuery.endsWith('.m4a') ||
      cleanNoQuery.endsWith('.wav') ||
      cleanNoQuery.endsWith('.aac') ||
      cleanNoQuery.endsWith('.webm') ||
      cleanNoQuery.endsWith('.ogg') ||
      cleanNoQuery.endsWith('.flac')
    ) {
      return true;
    }
    if (clean.startsWith('blob:') && !clean.includes('/cdn-cgi/')) {
      return true;
    }
    if (
      clean.includes('storage.googleapis.com') &&
      (clean.includes('/clips/') || clean.includes('/tracks/') || clean.includes('producer-app-public'))
    ) {
      return true;
    }
    return false;
  }

  function collectAllCurrentMp3Urls() {
    const urls = new Set();
    const audioUrlRegex =
      /https?:\/\/[^\s"'<>\\]+?\.(?:m4a|mp3|wav|aac|webm|ogg|flac)(?:\?[^\s"'<>\\]*)?/gi;
    const gcsAudioRegex =
      /https?:\/\/storage\.googleapis\.com\/(?:producer-app-public\/[^\s"'<>\\]+|[^\s"'<>\\]+?\.(?:m4a|mp3|wav|aac|webm|ogg|flac)(?:\?[^\s"'<>\\]*)?)/gi;
    const serviceAudioRegex =
      /https?:\/\/(?:cdn[12]?\.suno\.ai|[a-zA-Z0-9_.-]+\.flowmusic\.app|[a-zA-Z0-9_.-]+\.producer\.ai)\/[^\s"'<>\\]+?\.(?:m4a|mp3|wav|aac|webm|ogg|flac)(?:\?[^\s"'<>\\]*)?/gi;
    const blobRegex =
      /blob:https?:\/\/[^\s"'<>\\]+/gi;

    const addMatchesFromText = (txt) => {
      if (!txt || typeof txt !== 'string' || txt.includes('/cdn-cgi/')) return;
      let m;
      while ((m = audioUrlRegex.exec(txt)) !== null) {
        if (isGenuineAudioUrl(m[0])) urls.add(m[0]);
      }
      while ((m = gcsAudioRegex.exec(txt)) !== null) {
        if (isGenuineAudioUrl(m[0])) urls.add(m[0]);
      }
      while ((m = serviceAudioRegex.exec(txt)) !== null) {
        if (isGenuineAudioUrl(m[0])) urls.add(m[0]);
      }
      while ((m = blobRegex.exec(txt)) !== null) {
        if (isGenuineAudioUrl(m[0])) urls.add(m[0]);
      }
    };

    // 1. Check <audio> and <source> elements (including blob: and direct CDN URLs)
    for (const a of Array.from(document.querySelectorAll('audio, source'))) {
      const src = a.currentSrc || a.src || '';
      if (src && isGenuineAudioUrl(src)) {
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
            if (typeof u === 'string' && isGenuineAudioUrl(u)) {
              urls.add(u);
            }
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
          (name.includes('.mp3') ||
            name.includes('.m4a') ||
            name.includes('.wav') ||
            name.includes('.aac') ||
            name.includes('.webm') ||
            name.includes('.ogg') ||
            name.includes('.flac') ||
            name.includes('storage.googleapis.com') ||
            name.includes('producer-app-public')) &&
          !name.includes('/cdn-cgi/')
        ) {
          addMatchesFromText(name);
        }
      }
    } catch {}

    // 4. Check HTML and __NEXT_DATA__
    addMatchesFromText(document.body?.innerHTML || '');
    const nextDataEl = document.getElementById('__NEXT_DATA__');
    if (nextDataEl) {
      addMatchesFromText(nextDataEl.textContent || '');
    }

    return urls;
  }

  async function fetchAudioAsDataUrl(audioUrl) {
    if (!audioUrl || !isGenuineAudioUrl(audioUrl)) return '';
    if (audioUrl.startsWith('data:')) return audioUrl;

    // A. If blob: URL, fetch directly in the page document context
    if (audioUrl.startsWith('blob:')) {
      try {
        const r = await fetch(audioUrl);
        const b = await r.blob();
        const dataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result || '');
          reader.onerror = () => resolve('');
          reader.readAsDataURL(b);
        });
        if (dataUrl) return dataUrl;
      } catch {}
    }

    // B. Fetch via background service worker (bypasses CORS restrictions)
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

    // C. Fallback: direct fetch in page context
    try {
      const r = await fetch(audioUrl, { credentials: 'include' }).catch(() => fetch(audioUrl));
      if (r && r.ok) {
        const b = await r.blob();
        const dataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result || '');
          reader.onerror = () => resolve('');
          reader.readAsDataURL(b);
        });
        if (dataUrl) return dataUrl;
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
      Array.from(document.querySelectorAll('main button[aria-label="Play"], button[aria-label="Play"]'))
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
      const newCandidates = [];
      for (const u of currentUrls) {
        if (!baselineUrls.has(u)) {
          newCandidates.push(u);
        }
      }

      // Check direct <audio> elements in DOM for any new src not in baseline
      for (const aud of Array.from(document.querySelectorAll('audio, source'))) {
        const src = aud.currentSrc || aud.src || '';
        if (src && (src.startsWith('http') || src.startsWith('blob:')) && !baselineUrls.has(src)) {
          if (!newCandidates.includes(src)) newCandidates.push(src);
        }
      }

      if (newCandidates.length > 0) {
        newUrl =
          newCandidates.find((u) => u.includes('.mp3') || u.includes('.m4a')) ||
          newCandidates[0];
      }

      // On flowmusic.app, probe new Play button silently if 16s+ passed and URL wasn't in network/Fiber yet
      if (!newUrl && isFlowMusicSite() && elapsedSec >= 16) {
        const currentPlayBtns = Array.from(
          document.querySelectorAll('main button[aria-label="Play"], button[aria-label="Play"], button[aria-label*="Play" i], button[aria-label*="Reproducir" i]')
        );
        for (const pb of currentPlayBtns) {
          if (!baselinePlayBtns.has(pb) && !clickedNewPlayBtns.has(pb)) {
            clickedNewPlayBtns.add(pb);
            try {
              document.documentElement.setAttribute('data-huellas-synthetic-click', '1');
              for (const aud of Array.from(document.querySelectorAll('audio'))) {
                try {
                  aud.muted = true;
                  aud.volume = 0;
                } catch {}
              }
              pb.click();
              setTimeout(() => {
                try {
                  for (const aud of Array.from(document.querySelectorAll('audio'))) {
                    aud.muted = true;
                    aud.volume = 0;
                    aud.pause();
                  }
                  const pauseBtns = Array.from(
                    document.querySelectorAll('main button[aria-label="Pause"], button[aria-label="Pause"]')
                  );
                  for (const pauseBtn of pauseBtns) {
                    pauseBtn.click();
                  }
                } catch {}
                setTimeout(() => {
                  document.documentElement.removeAttribute('data-huellas-synthetic-click');
                }, 200);
              }, 80);
            } catch {
              document.documentElement.removeAttribute('data-huellas-synthetic-click');
            }
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

      await new Promise((r) => setTimeout(r, 1200));
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
    }, 2000);
  }

  const capturedAudioUrls = new Set();

  async function handleScanSunoTracks(silent = false) {
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
      if (!silent) {
        reportStatus(
          'IDLE',
          `Esperando pistas de audio en la página de ${serviceLabel}...`
        );
      }
      return;
    }

    const uncaptured = targetUrls.filter((u) => !capturedAudioUrls.has(u));
    if (uncaptured.length === 0) return;

    reportStatus(
      'WORKING',
      `🎵 Auto-capturando ${uncaptured.length} nueva(s) pista(s) de audio desde ${serviceLabel}...`
    );

    let idx = capturedAudioUrls.size + 1;
    for (const u of uncaptured.slice(0, 12)) {
      try {
        const audioDataUrl = await fetchAudioAsDataUrl(u);
        capturedAudioUrls.add(u);
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
      } catch (err) {
        console.warn('[Huellas FlowMusic] Error descargando audio:', err);
      }
    }
  }

  // Auto-detector pasivo en FlowMusic: vigila la creación de nuevas pistas de audio en segundo plano
  if (isFlowMusicSite()) {
    setInterval(() => {
      try {
        handleScanSunoTracks(true);
      } catch {}
    }, 12000);
  }

  async function waitForFlowMusicInputAndInject(msg) {
    const serviceLabel = isFlowMusicSite() ? 'Flow Music (flowmusic.app)' : 'Suno';
    const baselineUrls = collectAllCurrentMp3Urls();
    const trackNum = msg.trackNumber || 1;
    const trackTitle =
      msg.trackTitle || `FlowMusic_${String(trackNum).padStart(2, '0')}`;
    const maxAttempts = 100; // ~35 seconds
    let attempts = 0;
    let input = null;

    reportStatus(
      'WORKING',
      `🎵 Conectando con ${serviceLabel}... buscando campo de prompt musical...`
    );

    while (attempts < maxAttempts) {
      input = findSunoPromptTextarea();
      if (input) break;
      attempts++;
      if (attempts % 12 === 0) {
        const sec = Math.round(attempts * 0.35);
        reportStatus(
          'WORKING',
          `🎵 Conectando con ${serviceLabel}... cargando interfaz (${sec}s)...`
        );
      }
      await new Promise((r) => setTimeout(r, 350));
    }

    if (!input) {
      reportStatus(
        'ERROR',
        `⚠️ No se encontró el campo de texto en ${serviceLabel}. Abre la pestaña e inicia sesión en https://www.flowmusic.app/ para componer la pista #${trackNum}.`
      );
      return;
    }

    setNativeTextareaValue(input, msg.prompt || '');
    reportStatus(
      'PROMPT_INJECTED',
      `🎵 Prompt de Pista #${trackNum} enviado a ${serviceLabel}.`
    );

    if (msg.autoSubmit !== false) {
      await new Promise((r) => setTimeout(r, 450));
      triggerSubmit(input);
      startSunoAudioWatcher({
        trackNumber: trackNum,
        trackTitle,
        baselineUrls,
      });
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'SUNO') return false;

    if (msg.action === 'SEND_PROMPT') {
      sendResponse({ handled: true });
      waitForFlowMusicInputAndInject(msg);
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
