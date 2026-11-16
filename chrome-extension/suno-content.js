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

  function isBlockedNonMediaUrl(url) {
    if (!url || typeof url !== 'string') return true;
    const clean = url.trim().toLowerCase();
    if (!clean) return true;
    // Strictly block Cloudflare edge endpoints (RUM, beacon, cdn-cgi)
    if (
      clean.includes('/cdn-cgi/') ||
      clean.includes('cloudflareinsights') ||
      (clean.includes('rum') && clean.includes('cloudflare'))
    ) {
      return true;
    }
    // Block web bundles, styles, scripts, pages, fonts, images
    if (
      clean.includes('/_next/') ||
      clean.includes('/static/') ||
      clean.includes('/api/auth') ||
      clean.includes('/api/trpc')
    ) {
      return true;
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
      cleanNoQuery.endsWith('.txt') ||
      cleanNoQuery.endsWith('.woff') ||
      cleanNoQuery.endsWith('.woff2') ||
      cleanNoQuery.endsWith('.ttf')
    ) {
      return true;
    }
    return false;
  }

  function isGenuineAudioUrl(url) {
    if (isBlockedNonMediaUrl(url)) return false;
    const clean = url.trim().toLowerCase();
    const cleanNoQuery = clean.split(/[?#]/)[0];

    if (
      /\.(?:mp3|m4a|wav|aac|webm|ogg|flac|opus)$/i.test(cleanNoQuery) ||
      /[?&](?:format|ext|type|mime)=(?:audio\/)?(?:mp3|m4a|mpeg|wav|aac|ogg|flac|webm)\b/i.test(clean)
    ) {
      return true;
    }
    if (clean.startsWith('blob:')) {
      return true;
    }
    if (
      (clean.includes('storage.googleapis.com') || clean.includes('googleusercontent.com')) &&
      (clean.includes('/clips/') ||
        clean.includes('/tracks/') ||
        clean.includes('/audio') ||
        clean.includes('producer-app-public') ||
        clean.includes('flowmusic') ||
        clean.includes('suno'))
    ) {
      return true;
    }
    if (
      (clean.includes('flowmusic.app') ||
        clean.includes('producer.ai') ||
        clean.includes('suno.com') ||
        clean.includes('suno.ai')) &&
      /\/(?:audio|stream|download|clips?|tracks?|songs?|generation|music|api\/audio)\b/i.test(
        cleanNoQuery
      )
    ) {
      return true;
    }
    return false;
  }

  function isValidAudioDataUrl(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return false;
    const lower = dataUrl.slice(0, 80).toLowerCase();
    if (lower.startsWith('data:text/') || lower.startsWith('data:application/json')) {
      return false;
    }
    return (
      (lower.startsWith('data:audio/') || lower.startsWith('data:application/ogg')) &&
      dataUrl.length >= 2800
    );
  }

  function collectShowcaseUrlsFromNextData() {
    const showcaseUrls = new Set();
    try {
      const nextDataEl = document.getElementById('__NEXT_DATA__');
      if (nextDataEl && nextDataEl.textContent) {
        const rx =
          /https:\/\/storage\.googleapis\.com\/producer-app-public\/clips\/[^\s"'<>\\]+/gi;
        let m;
        while ((m = rx.exec(nextDataEl.textContent)) !== null) {
          if (!isBlockedNonMediaUrl(m[0])) showcaseUrls.add(m[0]);
        }
      }
    } catch {}
    return showcaseUrls;
  }

  function collectAllCurrentMp3Urls() {
    const urls = new Set();
    const audioUrlRegex =
      /https?:\/\/[^\s"'<>\\]+?\.(?:m4a|mp3|wav|aac|webm|ogg|flac|opus)(?:\?[^\s"'<>\\]*)?/gi;
    const gcsAudioRegex =
      /https?:\/\/(?:storage\.googleapis\.com|[^\s"'<>\\]*googleusercontent\.com)\/(?:producer-app-public\/[^\s"'<>\\]+|[^\s"'<>\\]+?(?:\/(?:clips|tracks|audio)\/[^\s"'<>\\]+|\.(?:m4a|mp3|wav|aac|webm|ogg|flac|opus)(?:\?[^\s"'<>\\]*)?))/gi;
    const serviceAudioRegex =
      /https?:\/\/(?:cdn[12]?\.suno\.ai|[a-zA-Z0-9_.-]+\.(?:flowmusic\.app|producer\.ai|suno\.com))\/[^\s"'<>\\]+?(?:\.(?:m4a|mp3|wav|aac|webm|ogg|flac|opus)(?:\?[^\s"'<>\\]*)?|\/(?:audio|stream|download|clips?|tracks?|songs?|generation|music)\/[^\s"'<>\\]+)/gi;
    const blobRegex = /blob:https?:\/\/[^\s"'<>\\]+/gi;

    const addMatchesFromText = (txt) => {
      if (!txt || typeof txt !== 'string' || txt.includes('/cdn-cgi/')) return;
      for (const rx of [audioUrlRegex, gcsAudioRegex, serviceAudioRegex, blobRegex]) {
        rx.lastIndex = 0;
        let m;
        while ((m = rx.exec(txt)) !== null) {
          if (isGenuineAudioUrl(m[0])) urls.add(m[0]);
        }
      }
    };

    // 1. Check <audio> and <source> elements (including blob:, extensionless streams, and direct CDN URLs)
    for (const a of Array.from(document.querySelectorAll('audio, source'))) {
      const src = a.currentSrc || a.src || '';
      if (src && !isBlockedNonMediaUrl(src) && (src.startsWith('http') || src.startsWith('blob:'))) {
        urls.add(src);
      }
    }

    // 2. Check MAIN-world published attribute (from fetch Content-Type: audio/* & React props)
    try {
      const attr = document.documentElement.getAttribute('data-huellas-flowmusic-urls');
      if (attr) {
        const parsed = JSON.parse(attr);
        if (Array.isArray(parsed)) {
          for (const u of parsed) {
            if (typeof u === 'string' && !isBlockedNonMediaUrl(u) && (u.startsWith('http') || u.startsWith('blob:'))) {
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
          name &&
          !isBlockedNonMediaUrl(name) &&
          (isGenuineAudioUrl(name) ||
            name.includes('flowmusic.app') ||
            name.includes('producer.ai') ||
            name.includes('suno.'))
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

  async function blobToAudioDataUrl(blob) {
    if (!blob || blob.size < 2048) return '';
    const rawType = String(blob.type || '').toLowerCase();
    if (rawType.startsWith('text/') || rawType.includes('json')) return '';
    const targetBlob =
      !rawType || rawType.includes('octet-stream')
        ? new Blob([blob], { type: 'audio/mpeg' })
        : blob;
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => resolve('');
      reader.readAsDataURL(targetBlob);
    });
    return isValidAudioDataUrl(dataUrl) ? dataUrl : '';
  }

  async function fetchAudioAsDataUrl(audioUrl, allowVerifiedMediaElement = false) {
    if (!audioUrl) return '';
    if (isBlockedNonMediaUrl(audioUrl)) return '';
    if (!allowVerifiedMediaElement && !isGenuineAudioUrl(audioUrl)) return '';
    if (audioUrl.startsWith('data:')) {
      return isValidAudioDataUrl(audioUrl) ? audioUrl : '';
    }

    // A. If blob: URL, fetch directly in the page document context
    if (audioUrl.startsWith('blob:')) {
      try {
        const r = await fetch(audioUrl);
        if (r && r.ok) {
          const b = await r.blob();
          const dataUrl = await blobToAudioDataUrl(b);
          if (dataUrl) return dataUrl;
        }
      } catch {}
    }

    // B. Fetch via background service worker (bypasses CORS restrictions)
    try {
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'FETCH_VIDEO_BASE64', url: audioUrl, mediaType: 'audio' },
          (r) => resolve(r || { ok: false })
        );
      });
      if (resp && resp.ok && isValidAudioDataUrl(resp.dataUrl)) {
        return resp.dataUrl;
      }
    } catch {}

    // C. Fallback: direct fetch in page context
    try {
      const r = await fetch(audioUrl, { credentials: 'include' }).catch(() => fetch(audioUrl));
      if (r && r.ok) {
        const b = await r.blob();
        const dataUrl = await blobToAudioDataUrl(b);
        if (dataUrl) return dataUrl;
      }
    } catch {}

    return '';
  }

  const capturedAudioUrls = new Set();
  let activeSunoJobSeq = 0;

  function startSunoAudioWatcher({
    trackNumber,
    trackTitle,
    baselineUrls,
    baselinePlayBtns: passedPlayBtns,
    jobSeq,
  }) {
    if (window.__HUELLAS_SUNO_WATCHER__) {
      clearInterval(window.__HUELLAS_SUNO_WATCHER__);
      window.__HUELLAS_SUNO_WATCHER__ = null;
    }

    const startedAt = Date.now();
    const maxWaitMs = 240000; // 4 minutes
    let capturing = false;
    const baselinePlayBtns =
      passedPlayBtns ||
      new Set(
        Array.from(document.querySelectorAll('main button[aria-label="Play"], button[aria-label="Play"]'))
      );
    const clickedNewPlayBtns = new Set();
    const serviceLabel = isFlowMusicSite() ? 'Flow Music' : 'Suno';
    const expectedTrackNum = trackNumber || 1;

    window.__HUELLAS_SUNO_WATCHER__ = setInterval(async () => {
      if (typeof jobSeq === 'number' && jobSeq !== activeSunoJobSeq) {
        clearInterval(window.__HUELLAS_SUNO_WATCHER__);
        window.__HUELLAS_SUNO_WATCHER__ = null;
        return;
      }
      if (capturing) return;
      const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
      if (Date.now() - startedAt > maxWaitMs) {
        clearInterval(window.__HUELLAS_SUNO_WATCHER__);
        window.__HUELLAS_SUNO_WATCHER__ = null;
        reportStatus(
          'ERROR',
          `⚠️ Tiempo agotado esperando pista #${expectedTrackNum} en ${serviceLabel}.`,
          { trackNumber: expectedTrackNum }
        );
        return;
      }

      const currentUrls = collectAllCurrentMp3Urls();
      let newUrl = '';
      const newCandidates = [];
      const domAudioUrls = new Set();
      for (const u of currentUrls) {
        if (!baselineUrls.has(u)) {
          newCandidates.push(u);
        }
      }

      // Check direct <audio> elements in DOM for any new src not in baseline
      for (const aud of Array.from(document.querySelectorAll('audio, source'))) {
        const src = aud.currentSrc || aud.src || '';
        if (
          src &&
          !isBlockedNonMediaUrl(src) &&
          (src.startsWith('http') || src.startsWith('blob:')) &&
          !baselineUrls.has(src)
        ) {
          domAudioUrls.add(src);
          if (!newCandidates.includes(src)) newCandidates.push(src);
        }
      }

      if (newCandidates.length > 0) {
        newUrl =
          newCandidates.find((u) => /\.(?:mp3|m4a|wav|aac|ogg|flac)(?:[?#]|$)/i.test(u)) ||
          newCandidates.find((u) => !u.startsWith('blob:')) ||
          newCandidates[0];
      }

      // On flowmusic.app, probe new Play button silently if 16s+ passed and URL wasn't in network/Props yet
      if (!newUrl && isFlowMusicSite() && elapsedSec >= 16) {
        const currentPlayBtns = Array.from(
          document.querySelectorAll(
            'main button[aria-label="Play"], button[aria-label="Play"], button[aria-label*="Play" i], button[aria-label*="Reproducir" i]'
          )
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
                    document.querySelectorAll(
                      'main button[aria-label="Pause"], button[aria-label="Pause"], button[aria-label*="Pause" i], button[aria-label*="Pausa" i]'
                    )
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
            `🎵 ${serviceLabel} componiendo pista #${expectedTrackNum} (${trackTitle || 'Instrumental'})... (${elapsedSec}s)`,
            { trackNumber: expectedTrackNum }
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
        `🎵 ¡Pista #${expectedTrackNum} generada en ${serviceLabel}! Descargando audio e inyectando en Pista 5 del Editor (con Fade-In/Out y Ducking)...`,
        { trackNumber: expectedTrackNum }
      );

      await new Promise((r) => setTimeout(r, 1200));
      let audioDataUrl = await fetchAudioAsDataUrl(newUrl, true);
      if (!isValidAudioDataUrl(audioDataUrl)) {
        await new Promise((r) => setTimeout(r, 1800));
        audioDataUrl = await fetchAudioAsDataUrl(newUrl, true);
      }

      if (!isValidAudioDataUrl(audioDataUrl)) {
        // Check alternate candidate before failing
        for (const alt of newCandidates) {
          if (alt === newUrl) continue;
          const altData = await fetchAudioAsDataUrl(alt, domAudioUrls.has(alt) || true);
          if (isValidAudioDataUrl(altData)) {
            newUrl = alt;
            audioDataUrl = altData;
            break;
          }
        }
      }

      if (!isValidAudioDataUrl(audioDataUrl)) {
        reportStatus(
          'ERROR',
          `⚠️ No se pudo descargar el audio binario de la pista #${expectedTrackNum} en ${serviceLabel} (${newUrl.slice(0, 60)}).`,
          { trackNumber: expectedTrackNum }
        );
        return;
      }

      for (const c of newCandidates) capturedAudioUrls.add(c);
      capturedAudioUrls.add(newUrl);

      chrome.runtime
        .sendMessage({
          type: 'SUNO_AUDIO_CAPTURED',
          trackNumber: expectedTrackNum,
          trackTitle:
            trackTitle || `FlowMusic_${String(expectedTrackNum).padStart(2, '0')}`,
          audioUrl: newUrl,
          audioDataUrl,
        })
        .catch(() => {});
    }, 2000);
  }

  async function handleScanSunoTracks(silent = false) {
    const allUrls = Array.from(collectAllCurrentMp3Urls());
    const showcaseUrls = collectShowcaseUrlsFromNextData();
    const targetUrls = allUrls.filter((u) => !showcaseUrls.has(u));
    const serviceLabel = isFlowMusicSite() ? 'Flow Music' : 'Suno';

    if (targetUrls.length === 0) {
      if (!silent) {
        reportStatus(
          'IDLE',
          `Esperando pistas de audio del usuario en ${serviceLabel}...`
        );
      }
      return;
    }

    const uncaptured = targetUrls.filter((u) => !capturedAudioUrls.has(u));
    if (uncaptured.length === 0) return;

    reportStatus(
      'WORKING',
      `🎵 Detectada(s) ${uncaptured.length} pista(s) de audio en ${serviceLabel}...`
    );

    let idx = capturedAudioUrls.size + 1;
    for (const u of uncaptured.slice(0, 12)) {
      try {
        const audioDataUrl = await fetchAudioAsDataUrl(u);
        capturedAudioUrls.add(u);
        if (!isValidAudioDataUrl(audioDataUrl)) continue;
        chrome.runtime
          .sendMessage({
            type: 'SUNO_AUDIO_CAPTURED',
            trackNumber: idx,
            trackTitle: `FlowMusic_${String(idx).padStart(2, '0')}`,
            audioUrl: u,
            audioDataUrl,
            fromPassiveScan: true,
          })
          .catch(() => {});
        idx++;
      } catch (err) {
        console.warn('[Huellas FlowMusic] Error descargando audio:', err);
      }
    }
  }

  async function waitForFlowMusicInputAndInject(msg) {
    const trackNum = msg.trackNumber || 1;
    const promptStr = String(msg.prompt || '');
    const lockKey = `${trackNum}::${promptStr.slice(0, 80)}`;
    const now = Date.now();
    if (
      window.__HUELLAS_SUNO_SUBMIT_LOCK__ &&
      window.__HUELLAS_SUNO_SUBMIT_LOCK__.key === lockKey &&
      now < window.__HUELLAS_SUNO_SUBMIT_LOCK__.until
    ) {
      return;
    }
    window.__HUELLAS_SUNO_SUBMIT_LOCK__ = { key: lockKey, until: now + 2200 };

    const myJobSeq = ++activeSunoJobSeq;
    if (window.__HUELLAS_SUNO_WATCHER__) {
      clearInterval(window.__HUELLAS_SUNO_WATCHER__);
      window.__HUELLAS_SUNO_WATCHER__ = null;
    }

    const serviceLabel = isFlowMusicSite() ? 'Flow Music (flowmusic.app)' : 'Suno';
    const trackTitle =
      msg.trackTitle || `FlowMusic_${String(trackNum).padStart(2, '0')}`;
    const maxAttempts = 100; // ~35 seconds
    let attempts = 0;
    let input = null;

    reportStatus(
      'WORKING',
      `🎵 Conectando con ${serviceLabel}... buscando campo de prompt musical...`,
      { trackNumber: trackNum }
    );

    while (attempts < maxAttempts) {
      if (myJobSeq !== activeSunoJobSeq) return;
      input = findSunoPromptTextarea();
      if (input) break;
      attempts++;
      if (attempts % 12 === 0) {
        const sec = Math.round(attempts * 0.35);
        reportStatus(
          'WORKING',
          `🎵 Conectando con ${serviceLabel}... cargando interfaz (${sec}s)...`,
          { trackNumber: trackNum }
        );
      }
      await new Promise((r) => setTimeout(r, 350));
    }

    if (myJobSeq !== activeSunoJobSeq) return;

    if (!input) {
      reportStatus(
        'ERROR',
        `⚠️ No se encontró el campo de texto en ${serviceLabel}. Abre la pestaña e inicia sesión en https://www.flowmusic.app/ para componer la pista #${trackNum}.`,
        { trackNumber: trackNum }
      );
      return;
    }

    // Seed baselineUrls AFTER SPA rendered the composer input so hydrated gallery tracks aren't misread as new
    const baselineUrls = collectAllCurrentMp3Urls();
    const showcaseUrls = collectShowcaseUrlsFromNextData();
    for (const sUrl of showcaseUrls) {
      baselineUrls.add(sUrl);
      capturedAudioUrls.add(sUrl);
    }

    setNativeTextareaValue(input, promptStr);
    reportStatus(
      'PROMPT_INJECTED',
      `🎵 Prompt de Pista #${trackNum} enviado a ${serviceLabel}.`,
      { trackNumber: trackNum }
    );

    if (msg.autoSubmit !== false) {
      await new Promise((r) => setTimeout(r, 450));
      if (myJobSeq !== activeSunoJobSeq) return;
      // Refresh baseline right before submit to include any tracks hydrated during the 450ms pause
      for (const u of collectAllCurrentMp3Urls()) {
        baselineUrls.add(u);
      }
      const baselinePlayBtns = new Set(
        Array.from(
          document.querySelectorAll(
            'main button[aria-label="Play"], button[aria-label="Play"], button[aria-label*="Play" i], button[aria-label*="Reproducir" i]'
          )
        )
      );
      triggerSubmit(input);
      startSunoAudioWatcher({
        trackNumber: trackNum,
        trackTitle,
        baselineUrls,
        baselinePlayBtns,
        jobSeq: myJobSeq,
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
