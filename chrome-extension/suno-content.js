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

  // ==========================================================================
  // ETAPA 8 — MOTORES DE MÚSICA (estudiados en vivo el 11/16/2026)
  //   FLOWMUSIC: New session → instrumental ON → 1 prompt (Style + Lyrics) → Send → 2 canciones
  //              (la principal es la que NO dice "(Take 2)") → .m4a en
  //              storage.googleapis.com/producer-app-public/clips/<id>.m4a (tamaño estable = terminada)
  //   SUNO:      /create → Advanced → Lyrics (editor rico) → Styles → More Options → Duration Custom (M:SS)
  //              → Song Title → Create song → 2 versiones → More options de la 1.ª → Download → MP3 → Download
  //              (el MP3 llega por el interceptor MAIN world vía postMessage, sin pasar por Descargas)
  // ==========================================================================
  const musicSleep = (ms) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'HUELLAS_UNTHROTTLED_SLEEP', ms }, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      } catch {
        setTimeout(resolve, ms);
      }
    });

  const musicIsVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  async function musicWaitFor(fn, timeoutMs, stepMs = 400, isAlive = () => true) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (!isAlive()) return null;
      let v = null;
      try {
        v = fn();
      } catch {}
      if (v) return v;
      await musicSleep(stepMs);
    }
    return null;
  }

  function musicDetectCaptcha() {
    const frames = Array.from(document.querySelectorAll('iframe'));
    if (
      frames.some((f) =>
        /hcaptcha|recaptcha|turnstile|challenges\.cloudflare|arkoselabs|funcaptcha/i.test(f.src || '')
      )
    ) {
      return true;
    }
    const txt = (document.body?.innerText || '').slice(0, 20000).toLowerCase();
    return /verify (that )?you are (a )?human|are you a robot|complete the captcha|verifica que eres humano/.test(
      txt
    );
  }

  function musicSetReactValue(el, text) {
    if (!el) return;
    el.focus();
    const proto =
      el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    try {
      if (el._valueTracker) el._valueTracker.setValue('');
    } catch {}
    if (setter) setter.call(el, text);
    else el.value = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function musicSongIdsOnPage() {
    const ids = new Set();
    for (const a of Array.from(document.querySelectorAll('a[href*="/song/"]'))) {
      const m = String(a.getAttribute('href') || '').match(/\/song\/([0-9a-f-]{36})/i);
      if (m) ids.add(m[1].toLowerCase());
    }
    return ids;
  }

  function musicSongAnchors() {
    return Array.from(document.querySelectorAll('a[href*="/song/"]'))
      .map((a) => {
        const m = String(a.getAttribute('href') || '').match(/\/song\/([0-9a-f-]{36})/i);
        return m ? { a, id: m[1].toLowerCase(), text: (a.innerText || '').trim() } : null;
      })
      .filter(Boolean)
      .filter((x) => !/^Playbar/i.test(x.a.getAttribute('aria-label') || ''));
  }

  function musicFail(trackNum, message) {
    reportStatus('ERROR', message, { trackNumber: trackNum });
  }

  function musicSendCaptured(payload) {
    chrome.runtime.sendMessage({ type: 'SUNO_AUDIO_CAPTURED', ...payload }).catch(() => {});
  }

  // ---------------------------- FLOW MUSIC ----------------------------------
  async function runFlowMusicJob(msg, jobSeq) {
    const trackNum = Number(msg.trackNumber) || 1;
    const alive = () => jobSeq === activeSunoJobSeq;
    const label = `Flow Music — Canción #${String(trackNum).padStart(2, '0')}`;
    const fullPrompt = String(msg.prompt || '').trim();
    if (!fullPrompt) return musicFail(trackNum, `⚠️ ${label}: el prompt está vacío.`);

    if (musicDetectCaptcha()) {
      return musicFail(trackNum, `🛑 ${label}: Flow Music muestra una verificación humana. Complétala tú en la pestaña y vuelve a intentar.`);
    }

    // 1. New session (una conversación aparte por canción)
    reportStatus('WORKING', `🎵 ${label}: abriendo "New session"...`, { trackNumber: trackNum });
    const newSession =
      document.querySelector('a[href="/session"]') ||
      Array.from(document.querySelectorAll('button')).find((b) => (b.innerText || '').trim() === 'New session');
    if (!newSession) {
      return musicFail(trackNum, `⚠️ ${label}: no encontré el botón "New session". ¿Iniciaste sesión en flowmusic.app?`);
    }
    newSession.click();
    const freshInput = await musicWaitFor(
      () => {
        if (!/^\/session\/?$/.test(location.pathname)) return null;
        const ta = document.querySelector('textarea[aria-label="Chat message"]');
        return ta && musicIsVisible(ta) && !(ta.value || '').trim() ? ta : null;
      },
      20000,
      400,
      alive
    );
    if (!alive()) return;
    if (!freshInput) return musicFail(trackNum, `⚠️ ${label}: la sesión nueva no cargó a tiempo.`);
    await musicSleep(900);

    // 2. Modo instrumental activado
    const instrumental = await musicWaitFor(
      () => document.querySelector('button[role="switch"][aria-label="Toggle instrumental mode"]'),
      8000,
      400,
      alive
    );
    if (instrumental && instrumental.getAttribute('aria-checked') !== 'true') {
      instrumental.click();
      await musicSleep(500);
    }
    if (instrumental && instrumental.getAttribute('aria-checked') !== 'true') {
      return musicFail(trackNum, `⚠️ ${label}: no pude activar el modo instrumental.`);
    }

    // 3. Prompt único (Style + Lyrics) y envío
    const baseline = musicSongIdsOnPage();
    const input = document.querySelector('textarea[aria-label="Chat message"]');
    musicSetReactValue(input, fullPrompt);
    const sendBtn = await musicWaitFor(
      () => document.querySelector('button[aria-label="Send message"]:not([disabled])'),
      8000,
      300,
      alive
    );
    if (!alive()) return;
    if (!sendBtn) return musicFail(trackNum, `⚠️ ${label}: el botón "Send message" no se habilitó.`);
    sendBtn.click();
    const sent = await musicWaitFor(
      () => !((document.querySelector('textarea[aria-label="Chat message"]') || {}).value || '').trim(),
      8000,
      300,
      alive
    );
    if (!sent) return musicFail(trackNum, `⚠️ ${label}: Flow Music no aceptó el prompt.`);
    reportStatus('GENERATING', `🎵 ${label}: prompt enviado, Flow Music está componiendo (2 versiones)...`, {
      trackNumber: trackNum,
    });

    // 4. Esperar la canción principal (sin "(Take 2)") y que su .m4a deje de crecer
    const t0 = Date.now();
    const maxMs = 9 * 60 * 1000;
    let primaryId = '';
    let lastLen = -1;
    let stableHits = 0;
    while (Date.now() - t0 < maxMs) {
      if (!alive()) return;
      if (musicDetectCaptcha()) {
        return musicFail(trackNum, `🛑 ${label}: apareció una verificación humana. Complétala tú y reintenta.`);
      }
      if (!primaryId) {
        const fresh = musicSongAnchors().filter((x) => !baseline.has(x.id));
        const main = fresh.find((x) => !/\(take\s*2\)/i.test(x.text)) || null;
        if (main) primaryId = main.id;
      }
      if (primaryId) {
        const url = `https://storage.googleapis.com/producer-app-public/clips/${primaryId}.m4a`;
        const probe = await new Promise((resolve) =>
          chrome.runtime.sendMessage({ type: 'PROBE_AUDIO_URL', url }, (r) => {
            void chrome.runtime.lastError;
            resolve(r || { ok: false });
          })
        );
        if (probe.ok && /audio/.test(probe.contentType || '') && probe.length > 150000) {
          stableHits = probe.length === lastLen ? stableHits + 1 : 0;
          lastLen = probe.length;
          if (stableHits >= 2) {
            reportStatus('WORKING', `🎵 ${label}: canción lista, descargando audio...`, { trackNumber: trackNum });
            let dataUrl = await fetchAudioAsDataUrl(url, true);
            if (!isValidAudioDataUrl(dataUrl)) {
              await musicSleep(2500);
              dataUrl = await fetchAudioAsDataUrl(url, true);
            }
            if (!isValidAudioDataUrl(dataUrl)) {
              return musicFail(trackNum, `⚠️ ${label}: no se pudo descargar el audio de la canción.`);
            }
            capturedAudioUrls.add(url);
            musicSendCaptured({
              trackNumber: trackNum,
              trackTitle: msg.trackTitle || '',
              audioUrl: url,
              audioDataUrl: dataUrl,
              engine: 'FLOWMUSIC',
              sourceFormat: 'm4a',
            });
            return;
          }
        }
      }
      const sec = Math.round((Date.now() - t0) / 1000);
      if (sec % 20 < 5) {
        reportStatus('GENERATING', `🎵 ${label}: componiendo... (${sec}s)`, { trackNumber: trackNum });
      }
      await musicSleep(5000);
    }
    musicFail(trackNum, `⚠️ ${label}: tiempo agotado (9 min) esperando la canción.`);
  }

  // ------------------------------- SUNO -------------------------------------
  function sunoRowFor(anchor) {
    let el = anchor;
    for (let i = 0; i < 10 && el; i++) {
      el = el.parentElement;
      if (!el) break;
      const ids = new Set(
        Array.from(el.querySelectorAll('a[href*="/song/"]')).map((a) =>
          String(a.getAttribute('href') || '').split('/song/')[1]
        )
      );
      if (ids.size > 1) return null;
      if (el.querySelector('button[aria-label="More options"]')) return el;
    }
    return null;
  }

  function sunoDurationRowButton(label) {
    return (
      Array.from(document.querySelectorAll('button')).find(
        (b) =>
          (b.innerText || '').trim() === label &&
          ((b.closest('div') && b.closest('div').parentElement && b.closest('div').parentElement.innerText) || '')
            .split('\n')[0]
            .trim() === 'Duration'
      ) || null
    );
  }

  async function runSunoJob(msg, jobSeq) {
    const trackNum = Number(msg.trackNumber) || 1;
    const alive = () => jobSeq === activeSunoJobSeq;
    const label = `Suno — Canción #${String(trackNum).padStart(2, '0')}`;
    const lyrics = String(msg.lyricsPrompt || '').slice(0, 5000);
    let styles = String(msg.stylePrompt || '').trim();
    if (styles.length > 1000) styles = styles.slice(0, 1000).replace(/[,\s][^,]*$/, '');
    const songTitle = String(msg.songTitle || msg.trackTitle || `Cancion_${trackNum}`).slice(0, 80);
    const durationLabel = String(msg.durationLabel || '').trim();

    if (musicDetectCaptcha()) {
      return musicFail(trackNum, `🛑 ${label}: Suno muestra una verificación humana. Complétala tú en la pestaña y vuelve a intentar.`);
    }

    // 1. Ir a Create
    reportStatus('WORKING', `🎵 ${label}: abriendo Create...`, { trackNumber: trackNum });
    if (!/^\/create/.test(location.pathname)) {
      const createLink = document.querySelector('a[href="/create"]');
      if (!createLink) return musicFail(trackNum, `⚠️ ${label}: no encontré "Create" en el menú. ¿Iniciaste sesión en suno.com?`);
      createLink.click();
      await musicWaitFor(() => /^\/create/.test(location.pathname), 15000, 400, alive);
    }
    // 2. Pestaña Advanced
    const advanced = await musicWaitFor(
      () => Array.from(document.querySelectorAll('button[role="tab"]')).find((b) => (b.innerText || '').trim() === 'Advanced'),
      15000,
      400,
      alive
    );
    if (!alive()) return;
    if (!advanced) return musicFail(trackNum, `⚠️ ${label}: no encontré la pestaña "Advanced".`);
    if (advanced.getAttribute('aria-selected') !== 'true') {
      advanced.click();
      await musicSleep(900);
    }

    // 2.5 Limpiar formulario previo si quedó texto de otra canción (Clear all form inputs → Confirm)
    const clearFormBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      /clear all form inputs/i.test(b.getAttribute('aria-label') || b.innerText || '')
    );
    if (clearFormBtn && !clearFormBtn.disabled) {
      clearFormBtn.click();
      const confirmClearBtn = await musicWaitFor(
        () =>
          Array.from(document.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button')).find((b) =>
            /^confirm$/i.test((b.innerText || '').trim())
          ),
        2500,
        200,
        alive
      );
      if (confirmClearBtn) {
        confirmClearBtn.click();
        await musicSleep(500);
      }
    }

    // 3. Lyrics (editor rico: usar paste como vía primaria para preservar los saltos de línea entre tags)
    let lyricsEditor = await musicWaitFor(
      () => document.querySelector('[role="textbox"][aria-label="Lyrics editor"]'),
      10000,
      400,
      alive
    );
    if (!lyricsEditor) return musicFail(trackNum, `⚠️ ${label}: no encontré el campo Lyrics.`);
    lyricsEditor.focus();
    await musicSleep(150);
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', lyrics);
      lyricsEditor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch {}
    await musicSleep(500);
    const firstLyricLine = (lyrics.split('\n').find((l) => l.trim()) || '').trim().slice(0, 18);
    if (firstLyricLine && !(lyricsEditor.innerText || '').includes(firstLyricLine)) {
      try {
        lyricsEditor.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, lyrics);
      } catch {}
      await musicSleep(500);
    }
    if (firstLyricLine && !(lyricsEditor.innerText || '').includes(firstLyricLine)) {
      return musicFail(trackNum, `⚠️ ${label}: no pude pegar la letra en Lyrics.`);
    }

    // 4. Styles
    const stylesBox =
      document.querySelector('textarea[aria-label="Styles"]') ||
      Array.from(document.querySelectorAll('textarea')).find(
        (t) => musicIsVisible(t) && (t.getAttribute('aria-label') || '') !== 'Cowriter prompt'
      );
    if (!stylesBox) return musicFail(trackNum, `⚠️ ${label}: no encontré el campo Styles.`);
    musicSetReactValue(stylesBox, styles);
    await musicSleep(400);

    // 5. More Options → Duration Custom (M:SS)
    if (durationLabel) {
      if (!document.querySelector('input[aria-label="Duration"]') && !sunoDurationRowButton('Custom')) {
        const more = Array.from(document.querySelectorAll('[role="button"]')).find(
          (e) => (e.innerText || '').trim() === 'More Options'
        );
        if (more) {
          more.click();
          await musicSleep(800);
        }
      }
      if (!document.querySelector('input[aria-label="Duration"]')) {
        const customBtn = sunoDurationRowButton('Custom');
        if (customBtn) {
          customBtn.click();
          await musicSleep(800);
        }
      }
      const durInput = await musicWaitFor(() => document.querySelector('input[aria-label="Duration"]'), 6000, 300, alive);
      if (!durInput) return musicFail(trackNum, `⚠️ ${label}: no encontré el campo Duration (More Options → Custom).`);
      musicSetReactValue(durInput, durationLabel);
      durInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      durInput.blur();
      await musicSleep(700);
      const [mm, ss] = durationLabel.split(':').map((x) => Number(x) || 0);
      const wantSec = mm * 60 + ss;
      const slider = document.querySelector('[role="slider"][aria-label="Duration"]');
      const gotSec = Number(slider && slider.getAttribute('aria-valuenow'));
      if (slider && Number.isFinite(gotSec) && gotSec > 0 && Math.abs(gotSec - wantSec) > 2) {
        return musicFail(trackNum, `⚠️ ${label}: Suno no aceptó la duración ${durationLabel} (quedó en ${gotSec}s).`);
      }
    }

    // 6. Song Title (identifica sin ambigüedad las 2 versiones nuevas)
    const titleInput = document.querySelector('input[placeholder="Song Title (Optional)"]');
    if (titleInput) {
      musicSetReactValue(titleInput, songTitle);
      await musicSleep(300);
    }

    // 7. Create
    const baseline = musicSongIdsOnPage();
    const createBtn = await musicWaitFor(
      () => document.querySelector('button[aria-label="Create song"]:not([disabled])'),
      8000,
      300,
      alive
    );
    if (!alive()) return;
    if (!createBtn) return musicFail(trackNum, `⚠️ ${label}: el botón Create no se habilitó.`);
    createBtn.click();
    reportStatus('GENERATING', `🎵 ${label}: Create pulsado, Suno está generando 2 versiones...`, { trackNumber: trackNum });

    // 8. Esperar las 2 versiones terminadas (fila con duración M:SS visible)
    const t0 = Date.now();
    const maxMs = 10 * 60 * 1000;
    let doneRows = [];
    const isRowDone = (row) =>
      Array.from(row.querySelectorAll('[role="button"]')).some(
        (b) => /^Play /.test(b.getAttribute('aria-label') || '') && /^\d{1,2}:\d{2}$/.test((b.innerText || '').trim())
      );
    while (Date.now() - t0 < maxMs) {
      if (!alive()) return;
      if (musicDetectCaptcha()) {
        return musicFail(trackNum, `🛑 ${label}: apareció una verificación humana. Complétala tú y reintenta.`);
      }
      const fresh = musicSongAnchors().filter((x) => !baseline.has(x.id));
      const uniq = [];
      const seen = new Set();
      for (const x of fresh) {
        if (seen.has(x.id)) continue;
        seen.add(x.id);
        const row = sunoRowFor(x.a);
        if (row) uniq.push({ ...x, row });
      }
      doneRows = uniq.filter((x) => isRowDone(x.row));
      const elapsed = Date.now() - t0;
      if (doneRows.length >= 2 || (doneRows.length >= 1 && uniq.length === 1 && elapsed > 120000)) break;
      const sec = Math.round(elapsed / 1000);
      if (sec % 20 < 5) {
        reportStatus('GENERATING', `🎵 ${label}: generando... (${sec}s, ${doneRows.length}/2 listas)`, { trackNumber: trackNum });
      }
      await musicSleep(5000);
    }
    if (!doneRows.length) return musicFail(trackNum, `⚠️ ${label}: tiempo agotado (10 min) esperando las versiones.`);
    const first = doneRows[0];
    await musicSleep(2500);

    // 9. Download de la primera versión en MP3 (capturado por el interceptor MAIN world)
    reportStatus('WORKING', `🎵 ${label}: descargando la primera versión en MP3...`, { trackNumber: trackNum });
    const moreBtn = first.row.querySelector('button[aria-label="More options"]');
    if (!moreBtn) return musicFail(trackNum, `⚠️ ${label}: no encontré el menú de la canción.`);
    moreBtn.click();
    const dlItem = await musicWaitFor(
      () => Array.from(document.querySelectorAll('[role="menuitem"]')).find((i) => /^download/i.test((i.innerText || '').trim())),
      6000,
      300,
      alive
    );
    if (!dlItem) return musicFail(trackNum, `⚠️ ${label}: no apareció la opción Download.`);
    dlItem.click();
    const dialog = await musicWaitFor(
      () => Array.from(document.querySelectorAll('[role="dialog"]')).find((d) => /MP3/.test(d.innerText || '')),
      8000,
      300,
      alive
    );
    if (!dialog) return musicFail(trackNum, `⚠️ ${label}: no apareció el diálogo de descarga.`);
    const mp3Btn = Array.from(dialog.querySelectorAll('button')).find((b) => (b.innerText || '').trim() === 'MP3');
    if (mp3Btn) {
      mp3Btn.click();
      await musicSleep(500);
    }
    const goBtn = Array.from(dialog.querySelectorAll('button'))
      .filter((b) => (b.innerText || '').trim() === 'Download')
      .pop();
    if (!goBtn) return musicFail(trackNum, `⚠️ ${label}: no encontré el botón Download del diálogo.`);
    const captured = new Promise((resolve) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMsg);
        resolve(null);
      }, 90000);
      function onMsg(ev) {
        if (ev.source !== window || !ev.data || ev.data.source !== 'HUELLAS_SUNO_DL') return;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        resolve(ev.data);
      }
      window.addEventListener('message', onMsg);
    });
    document.documentElement.setAttribute('data-huellas-suno-capture', '1');
    goBtn.click();
    const got = await captured;
    document.documentElement.removeAttribute('data-huellas-suno-capture');
    try {
      const closeBtn = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
        (b) => (b.getAttribute('aria-label') || b.innerText || '').trim() === 'Close'
      );
      if (closeBtn) closeBtn.click();
    } catch {}
    if (got && typeof got.dataUrl === 'string' && /^data:(application\/octet-stream|);base64,/i.test(got.dataUrl)) {
      got.dataUrl = got.dataUrl.replace(/^data:[^;]*;base64,/i, 'data:audio/mpeg;base64,');
    }
    if (!got || !isValidAudioDataUrl(got.dataUrl)) {
      return musicFail(trackNum, `⚠️ ${label}: Suno no entregó el MP3 (descarga vacía o bloqueada).`);
    }
    musicSendCaptured({
      trackNumber: trackNum,
      trackTitle: msg.trackTitle || '',
      audioUrl: `https://suno.com/song/${first.id}`,
      audioDataUrl: got.dataUrl,
      engine: 'SUNO',
      sourceFormat: /mpeg|mp3/i.test(got.mime || got.dataUrl.slice(0, 30)) ? 'mp3' : 'm4a',
    });
  }

  async function runMusicEngineJob(msg) {
    const jobSeq = ++activeSunoJobSeq;
    if (window.__HUELLAS_SUNO_WATCHER__) {
      clearInterval(window.__HUELLAS_SUNO_WATCHER__);
      window.__HUELLAS_SUNO_WATCHER__ = null;
    }
    const engine = String(msg.engine || '').toUpperCase();
    const host = (location.hostname || '').toLowerCase();
    try {
      if (engine === 'SUNO') {
        if (!host.includes('suno.com')) return musicFail(msg.trackNumber, '⚠️ Esta pestaña no es suno.com.');
        await runSunoJob(msg, jobSeq);
      } else {
        if (!isFlowMusicSite()) return musicFail(msg.trackNumber, '⚠️ Esta pestaña no es flowmusic.app.');
        await runFlowMusicJob(msg, jobSeq);
      }
    } catch (err) {
      musicFail(msg.trackNumber, `⚠️ Error inesperado en ${engine || 'FLOWMUSIC'}: ${String((err && err.message) || err)}`);
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'SUNO') return false;

    if (msg.action === 'SEND_PROMPT') {
      sendResponse({ handled: true });
      if (msg.engine) runMusicEngineJob(msg);
      else waitForFlowMusicInputAndInject(msg);
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
