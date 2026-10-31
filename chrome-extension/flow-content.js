// ============================================================================
// HUELLAS MASTER — GOOGLE FLOW CONTENT SCRIPT (flow.google.com / labs.google)
// Automates prompt injection, production submission, real-time video watching,
// 3-keyframe extraction, and MP4 binary capture for automatic auditing & saving
// ============================================================================

(function () {
  // Always remove any old floating bar if present from an earlier version
  const oldBar = document.getElementById('huellas-flow-floating-bar');
  if (oldBar) {
    oldBar.remove();
  }

  // Replace previous listener if re-injected
  if (window.__HUELLAS_FLOW_MESSAGE_HANDLER__) {
    try {
      chrome.runtime.onMessage.removeListener(window.__HUELLAS_FLOW_MESSAGE_HANDLER__);
    } catch {}
  }

  if (window.__HUELLAS_FLOW_WATCHER_TIMER__) {
    clearInterval(window.__HUELLAS_FLOW_WATCHER_TIMER__);
    window.__HUELLAS_FLOW_WATCHER_TIMER__ = null;
  }

  function reportStatus(status, message, extra = {}) {
    chrome.runtime
      .sendMessage({
        type: 'BRIDGE_STATUS',
        service: 'FLOW',
        status,
        message,
        ...extra,
      })
      .catch(() => {});
  }

  function findFlowPromptInput() {
    // 1. Direct match for Google Flow's ProseMirror prompt box
    const proseMirror = document.querySelector(
      'div.ProseMirror[contenteditable="true"], div[role="textbox"][contenteditable="true"][aria-label*="create" i], div[role="textbox"][contenteditable="true"]'
    );
    if (proseMirror) {
      const r = proseMirror.getBoundingClientRect();
      if (r.width > 60 && r.height > 14) {
        return proseMirror;
      }
    }

    // 2. Fallback for textarea or other contenteditable inputs
    const allCandidates = Array.from(
      document.querySelectorAll(
        'div[contenteditable="true"], [role="textbox"][contenteditable="true"], textarea:not(.g-recaptcha-response)'
      )
    );
    let bestEl = null;
    let bestScore = -999999;

    for (const el of allCandidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 60 || rect.height < 14) continue;
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;

      let score = rect.bottom * 2 + rect.width;
      const placeholder = (
        el.getAttribute('placeholder') ||
        el.getAttribute('aria-label') ||
        ''
      ).toLowerCase();
      if (
        placeholder.includes('create') ||
        placeholder.includes('prompt') ||
        placeholder.includes('describe') ||
        placeholder.includes('generate') ||
        placeholder.includes('video') ||
        placeholder.includes('genera') ||
        placeholder.includes('crea')
      ) {
        score += 1000;
      }

      if (score > bestScore) {
        bestScore = score;
        bestEl = el;
      }
    }
    return bestEl;
  }

  function findExactFlowSubmitButton(inputEl) {
    // 1. Exact Google Flow submit button selectors verified from live DOM (strict priority order)
    const directSelectors = [
      'flow-generate-icon-button button',
      'span.submit-button-slot button',
      '[submitbutton] button',
      'button.generate-icon-button',
      'button[aria-label="Start generation"]',
      'button[aria-label*="Start generation" i]',
      'button[aria-label*="Iniciar generación" i]',
      'button[type="submit"]',
    ];

    for (const sel of directSelectors) {
      const buttons = Array.from(document.querySelectorAll(sel));
      for (const btn of buttons) {
        const r = btn.getBoundingClientRect();
        if (r.width >= 16 && r.height >= 16 && r.top > 0) {
          return btn;
        }
      }
    }

    // 2. Fallback: find actual <button> (never a parent container!) with mat-icon 'arrow_forward' near inputEl
    const inputRect = inputEl ? inputEl.getBoundingClientRect() : { top: 600, left: 800 };
    const allButtons = Array.from(document.querySelectorAll('button'));
    for (const btn of allButtons) {
      const r = btn.getBoundingClientRect();
      if (r.width < 16 || r.height < 16 || r.top <= 0) continue;
      if (Math.abs(r.top - inputRect.top) > 250) continue;
      const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
      if (text === 'arrow_forward' || text === 'arrow_upward' || text === 'send') {
        return btn;
      }
    }

    return null;
  }

  function setFlowInputText(inputEl, text) {
    // 1. Always clear any existing text in the prompt box first so an old prompt is never submitted
    const existingText = (inputEl.value ?? inputEl.innerText ?? '').trim();
    if (existingText.length > 0) {
      const clearBtn = document.querySelector(
        'button.clear-button[aria-label="Clear prompt"], button.clear-button'
      );
      if (clearBtn) {
        try {
          clearBtn.click();
        } catch {}
      }
    }

    inputEl.focus();
    inputEl.click();

    if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
      const proto =
        inputEl.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

      let insertedByExec = false;
      try {
        inputEl.focus();
        inputEl.select();
        insertedByExec = document.execCommand('insertText', false, text);
      } catch {}

      if (!insertedByExec || inputEl.value !== text) {
        if (nativeSetter) {
          nativeSetter.call(inputEl, text);
        } else {
          inputEl.value = text;
        }
        inputEl.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: text,
          })
        );
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }

    // ProseMirror / Contenteditable div in Google Flow (works both when tab is active or in background)
    try {
      inputEl.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(inputEl);
      selection.removeAllRanges();
      selection.addRange(range);
      try {
        document.execCommand('delete', false);
      } catch {}
      const inserted = document.execCommand('insertText', false, text);

      const expectedPrefix = text.trim().slice(0, 30);
      let afterText = (inputEl.innerText || inputEl.textContent || '').trim();

      // If execCommand failed (e.g. tab in background) or old text remained, force replace via paste + DOM
      if (!inserted || !afterText.includes(expectedPrefix)) {
        try {
          inputEl.innerHTML = '<p><br></p>';
          const dt = new DataTransfer();
          dt.setData('text/plain', text);
          inputEl.dispatchEvent(
            new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true,
              composed: true,
              clipboardData: dt,
            })
          );
        } catch {}
        afterText = (inputEl.innerText || inputEl.textContent || '').trim();
        if (!afterText.includes(expectedPrefix)) {
          inputEl.innerHTML = '';
          const p = document.createElement('p');
          p.textContent = text;
          inputEl.appendChild(p);
          inputEl.dispatchEvent(
            new InputEvent('input', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: text,
            })
          );
        }
      }
    } catch {}
  }

  function dispatchEnterKeyOnInput(inputEl) {
    if (!inputEl) return;
    try {
      inputEl.focus();
      const evInit = {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true,
      };
      inputEl.dispatchEvent(new KeyboardEvent('keydown', evInit));
      inputEl.dispatchEvent(new KeyboardEvent('keypress', evInit));
      inputEl.dispatchEvent(new KeyboardEvent('keyup', evInit));
    } catch {}
  }

  function clickFlowSubmitButton(btn, inputEl) {
    // IMPORTANT: Never pass `view: window` to PointerEvent/MouseEvent in an ISOLATED content script world,
    // because Chrome throws `TypeError: Failed to construct 'PointerEvent': member view is not of type Window`,
    // which previously aborted execution right before `btn.click()`!
    if (btn) {
      try {
        btn.click();
      } catch {}
    } else if (inputEl) {
      dispatchEnterKeyOnInput(inputEl);
    }

    // Follow-up verification at 380ms and 850ms: if the prompt text is still sitting un-submitted
    // in the ProseMirror box, click the submit button again and dispatch Enter.
    [380, 850].forEach((delayMs) => {
      setTimeout(() => {
        const currentInput = findFlowPromptInput() || inputEl;
        if (!currentInput) return;
        const remaining = (currentInput.value ?? currentInput.innerText ?? '').trim();
        if (remaining.length > 10) {
          const freshBtn = findExactFlowSubmitButton(currentInput);
          if (freshBtn && !freshBtn.disabled && freshBtn.getAttribute('aria-disabled') !== 'true') {
            try {
              freshBtn.click();
            } catch {}
            try {
              const rect = freshBtn.getBoundingClientRect();
              const opts = {
                bubbles: true,
                cancelable: true,
                composed: true,
                clientX: rect.left + rect.width / 2,
                clientY: rect.top + rect.height / 2,
                button: 0,
                buttons: 1,
              };
              freshBtn.dispatchEvent(new PointerEvent('pointerdown', opts));
              freshBtn.dispatchEvent(new MouseEvent('mousedown', opts));
              freshBtn.dispatchEvent(new PointerEvent('pointerup', opts));
              freshBtn.dispatchEvent(new MouseEvent('mouseup', opts));
            } catch {}
          }
          if (delayMs >= 800) {
            dispatchEnterKeyOnInput(currentInput);
          }
        }
      }, delayMs);
    });
  }

  function getVideoElementUrl(videoEl) {
    if (!videoEl) return '';
    return (
      videoEl.currentSrc ||
      videoEl.src ||
      videoEl.querySelector('source')?.src ||
      ''
    ).trim();
  }

  function getAllCurrentVideoUrlsSet() {
    const urls = new Set();
    const videos = Array.from(document.querySelectorAll('video'));
    for (const v of videos) {
      const u = getVideoElementUrl(v);
      if (u) urls.add(u);
    }
    return urls;
  }

  function inferClipNumberFromVideoCard(videoEl) {
    let curr = videoEl;
    for (let depth = 0; depth < 7 && curr; depth++) {
      const aria = curr.getAttribute?.('aria-label') || '';
      const text = (aria + ' ' + (curr.innerText || '')).slice(0, 600);
      const match =
        text.match(/\b(\d{1,3})_Clip\b/i) ||
        text.match(/\bClip\s*#?\s*0*(\d{1,3})\b/i);
      if (match && match[1]) {
        return parseInt(match[1], 10);
      }
      curr = curr.parentElement;
    }
    return null;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'video/mp4';
    const bstr = atob(parts[1] || '');
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  }

  async function fetchVideoBinaryDataUrl(videoUrl, imgElementFallback) {
    if (!videoUrl) return '';
    if (videoUrl.startsWith('data:')) return videoUrl;

    // 1. Try direct fetch inside page context (credentials: include, then omit for * CORS)
    for (const credMode of ['include', 'omit']) {
      try {
        const resp = await fetch(videoUrl, { credentials: credMode });
        if (resp.ok) {
          const blob = await resp.blob();
          if (blob.size > 500) {
            return await blobToDataUrl(blob);
          }
        }
      } catch {}
    }

    // 2. Fallback: ask background service worker (bypasses CORS via host_permissions)
    if (!videoUrl.startsWith('blob:')) {
      try {
        const bgResp = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { type: 'FETCH_VIDEO_BASE64', url: videoUrl },
            (r) => resolve(r || { ok: false })
          );
        });
        if (bgResp && bgResp.ok && bgResp.dataUrl) {
          return bgResp.dataUrl;
        }
      } catch {}
    }

    // 3. Canvas fallback if an <img> DOM element is provided
    if (imgElementFallback && imgElementFallback.naturalWidth > 0) {
      try {
        const c = document.createElement('canvas');
        c.width = imgElementFallback.naturalWidth;
        c.height = imgElementFallback.naturalHeight;
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.drawImage(imgElementFallback, 0, 0);
          return c.toDataURL('image/png');
        }
      } catch {}
    }

    return '';
  }

  async function extractThreeKeyframesFromVideoSource(sourceUrlOrVideoEl, liveVideoEl) {
    const frames = [];
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 216;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { frames: [], duration: 0 };

    // Create a clean offscreen video element if we have a same-origin blob URL
    if (typeof sourceUrlOrVideoEl === 'string' && sourceUrlOrVideoEl) {
      try {
        const tempVideo = document.createElement('video');
        tempVideo.muted = true;
        tempVideo.playsInline = true;
        tempVideo.crossOrigin = 'anonymous';
        tempVideo.preload = 'auto';
        tempVideo.src = sourceUrlOrVideoEl;

        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('timeout metadata')), 8000);
          tempVideo.onloadeddata = () => {
            clearTimeout(t);
            resolve(true);
          };
          tempVideo.onerror = () => {
            clearTimeout(t);
            reject(new Error('video load error'));
          };
        });

        const dur =
          Number.isFinite(tempVideo.duration) && tempVideo.duration > 0
            ? tempVideo.duration
            : 8;
        const timestamps = [
          Math.max(0.25, dur * 0.15),
          dur * 0.5,
          Math.max(0.5, dur * 0.85),
        ];

        for (const ts of timestamps) {
          await new Promise((resolve) => {
            const t = setTimeout(() => resolve(false), 3000);
            tempVideo.onseeked = () => {
              clearTimeout(t);
              resolve(true);
            };
            tempVideo.currentTime = Math.min(ts, Math.max(0.1, dur - 0.1));
          });
          ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
          const jpg = canvas.toDataURL('image/jpeg', 0.76);
          if (jpg && jpg.length > 200) {
            frames.push(jpg);
          }
        }

        tempVideo.removeAttribute('src');
        tempVideo.load();
        if (frames.length > 0) {
          return { frames, duration: dur };
        }
      } catch {}
    }

    // Fallback: draw directly from live <video> element on the page
    if (liveVideoEl) {
      try {
        const dur =
          Number.isFinite(liveVideoEl.duration) && liveVideoEl.duration > 0
            ? liveVideoEl.duration
            : 8;
        const timestamps = [
          Math.max(0.25, dur * 0.15),
          dur * 0.5,
          Math.max(0.5, dur * 0.85),
        ];
        for (const ts of timestamps) {
          try {
            liveVideoEl.currentTime = Math.min(ts, Math.max(0.1, dur - 0.1));
            await new Promise((r) => setTimeout(r, 350));
          } catch {}
          ctx.drawImage(liveVideoEl, 0, 0, canvas.width, canvas.height);
          const jpg = canvas.toDataURL('image/jpeg', 0.76);
          if (jpg && jpg.length > 200) {
            frames.push(jpg);
          }
        }
        return { frames, duration: dur };
      } catch {}
    }

    return { frames, duration: 0 };
  }

  async function captureVideoFramesAndBinary(videoEl) {
    const videoUrl = getVideoElementUrl(videoEl);
    const videoDataUrl = await fetchVideoBinaryDataUrl(videoUrl);

    let localBlobUrl = '';
    if (videoDataUrl) {
      try {
        const blob = dataUrlToBlob(videoDataUrl);
        localBlobUrl = URL.createObjectURL(blob);
      } catch {}
    }

    const { frames, duration } = await extractThreeKeyframesFromVideoSource(
      localBlobUrl || videoUrl,
      videoEl
    );

    if (localBlobUrl) {
      try {
        URL.revokeObjectURL(localBlobUrl);
      } catch {}
    }

    return {
      videoUrl,
      videoDataUrl,
      frames,
      duration,
    };
  }

  function getAllCurrentImageUrlsSet() {
    const urls = new Set();
    for (const img of Array.from(document.querySelectorAll('img'))) {
      const src = (img.currentSrc || img.src || '').trim();
      if (src) {
        urls.add(src);
      }
    }
    return urls;
  }

  function startFlowThumbnailWatcher({ optionLabel, baselineImageUrls }) {
    if (window.__HUELLAS_FLOW_THUMB_WATCHER__) {
      clearInterval(window.__HUELLAS_FLOW_THUMB_WATCHER__);
      window.__HUELLAS_FLOW_THUMB_WATCHER__ = null;
    }

    const startedAt = Date.now();
    const maxWaitMs = 150000;
    let capturing = false;

    window.__HUELLAS_FLOW_THUMB_WATCHER__ = setInterval(async () => {
      if (capturing) return;
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > maxWaitMs) {
        clearInterval(window.__HUELLAS_FLOW_THUMB_WATCHER__);
        window.__HUELLAS_FLOW_THUMB_WATCHER__ = null;
        return;
      }

      //During the first 3.5 seconds while Google Flow is still starting the job, record any lazy-loaded existing gallery images into baseline
      if (elapsedMs < 3500) {
        for (const img of Array.from(document.querySelectorAll('img'))) {
          const s = (img.currentSrc || img.src || '').trim();
          if (s) baselineImageUrls.add(s);
        }
        return;
      }

      const imgs = Array.from(document.querySelectorAll('img')).filter((img) => {
        const w = img.naturalWidth || img.width || 0;
        const src = (img.currentSrc || img.src || '').trim();
        return src && !src.includes('avatar') && w >= 280 && !baselineImageUrls.has(src);
      });

      if (imgs.length === 0) return;

      capturing = true;
      clearInterval(window.__HUELLAS_FLOW_THUMB_WATCHER__);
      window.__HUELLAS_FLOW_THUMB_WATCHER__ = null;

      let idx = 0;
      for (const imgEl of imgs.slice(0, 2)) {
        const src = (imgEl.currentSrc || imgEl.src || '').trim();
        baselineImageUrls.add(src);
        const imageDataUrl = await fetchVideoBinaryDataUrl(src, imgEl);
        const opt = optionLabel || (idx === 0 ? 'A' : 'B');
        idx++;
        chrome.runtime
          .sendMessage({
            type: 'FLOW_THUMBNAIL_CAPTURED',
            option: opt,
            imageUrl: src,
            imageDataUrl,
          })
          .catch(() => {});
      }
    }, 2000);
  }

  async function handleScanFlowThumbnails() {
    const imgs = Array.from(document.querySelectorAll('img')).filter((img) => {
      const w = img.naturalWidth || img.width || 0;
      const src = (img.currentSrc || img.src || '').trim();
      return src && !src.includes('avatar') && w >= 280;
    });
    if (imgs.length === 0) {
      reportStatus('ERROR', 'No se encontraron imágenes de miniatura en Google Flow.');
      return;
    }
    // Newest generated images appear at the TOP of Google Flow's feed (imgs.slice(0, 3))
    const latestThree = imgs.slice(0, 3);
    const labels = ['A', 'B', 'C'];
    for (let i = 0; i < latestThree.length; i++) {
      const src = (latestThree[i].currentSrc || latestThree[i].src || '').trim();
      const imageDataUrl = await fetchVideoBinaryDataUrl(src, latestThree[i]);
      chrome.runtime
        .sendMessage({
          type: 'FLOW_THUMBNAIL_CAPTURED',
          option: labels[i] || 'A',
          imageUrl: src,
          imageDataUrl,
        })
        .catch(() => {});
    }
  }

  function startFlowVideoWatcher({
    clipNumber,
    clipId,
    prompt,
    attempt,
    baselineUrls,
    batchStartClip,
    batchEndClip,
    expectedCount,
  }) {
    if (window.__HUELLAS_FLOW_WATCHER_TIMER__) {
      clearInterval(window.__HUELLAS_FLOW_WATCHER_TIMER__);
      window.__HUELLAS_FLOW_WATCHER_TIMER__ = null;
    }

    const totalExpected =
      typeof expectedCount === 'number' && expectedCount > 1
        ? expectedCount
        : batchStartClip && batchEndClip && batchEndClip >= batchStartClip
        ? batchEndClip - batchStartClip + 1
        : 1;

    const startedAt = Date.now();
    const maxWaitMs = totalExpected > 1 ? 1500000 : 270000; // 25 min for 10-clip batch, 4.5 min for 1 clip
    let capturing = false;
    let capturedCount = 0;

    window.__HUELLAS_FLOW_WATCHER_TIMER__ = setInterval(async () => {
      if (capturing) return;
      const elapsedSec = Math.round((Date.now() - startedAt) / 1000);

      if (Date.now() - startedAt > maxWaitMs) {
        clearInterval(window.__HUELLAS_FLOW_WATCHER_TIMER__);
        window.__HUELLAS_FLOW_WATCHER_TIMER__ = null;
        reportStatus(
          'ERROR',
          `⚠️ Tiempo de espera agotado (${elapsedSec}s) esperando video(s) en Google Flow.`,
          { clipNumber, clipId }
        );
        return;
      }

      // Look for any <video> element whose URL is NOT in baselineUrls
      const allVideos = Array.from(document.querySelectorAll('video'));
      let candidateVideo = null;

      for (const v of allVideos) {
        const u = getVideoElementUrl(v);
        if (!u || baselineUrls.has(u)) continue;
        // Ensure video has started loading or has dimensions
        if (v.readyState >= 1 || v.videoWidth > 0 || u.startsWith('http') || u.startsWith('blob:')) {
          candidateVideo = v;
          break;
        }
      }

      if (!candidateVideo) {
        if (elapsedSec % 4 === 0) {
          const nextNum =
            totalExpected > 1
              ? (batchStartClip || clipNumber || 1) + capturedCount
              : clipNumber || '?';
          reportStatus(
            'GENERATING',
            `⏳ Google Flow generando video del Clip #${String(nextNum).padStart(2, '0')}${
              totalExpected > 1 ? ` (${capturedCount}/${totalExpected} del lote listos)` : ''
            }... (${elapsedSec}s)`,
            { clipNumber: nextNum, clipId }
          );
        }
        return;
      }

      capturing = true;
      const candidateUrl = getVideoElementUrl(candidateVideo);
      baselineUrls.add(candidateUrl);

      const inferredNum =
        inferClipNumberFromVideoCard(candidateVideo) ||
        (totalExpected > 1
          ? (batchStartClip || clipNumber || 1) + capturedCount
          : clipNumber || 1);

      capturedCount++;

      if (capturedCount >= totalExpected) {
        clearInterval(window.__HUELLAS_FLOW_WATCHER_TIMER__);
        window.__HUELLAS_FLOW_WATCHER_TIMER__ = null;
      }

      reportStatus(
        'WORKING',
        `🎞️ ¡Video del Clip #${String(inferredNum).padStart(
          2,
          '0'
        )} detectado en Google Flow! Extrayendo fotogramas y archivo MP4 para auditoría automática...`,
        { clipNumber: inferredNum, clipId }
      );

      // Give the video element 900ms to finish buffering initial metadata
      await new Promise((r) => setTimeout(r, 900));

      const captured = await captureVideoFramesAndBinary(candidateVideo);

      try {
        await chrome.runtime.sendMessage({
          type: 'FLOW_VIDEO_CAPTURED',
          clipNumber: inferredNum,
          clipId: totalExpected === 1 ? clipId : undefined,
          attempt: attempt || 1,
          prompt,
          videoUrl: captured.videoUrl,
          videoDataUrl: captured.videoDataUrl,
          frames: captured.frames,
          duration: captured.duration,
        });
      } catch {
        // Fallback without binary if payload was unusually large
        chrome.runtime
          .sendMessage({
            type: 'FLOW_VIDEO_CAPTURED',
            clipNumber: inferredNum,
            clipId: totalExpected === 1 ? clipId : undefined,
            attempt: attempt || 1,
            prompt,
            videoUrl: captured.videoUrl,
            videoDataUrl: '',
            frames: captured.frames,
            duration: captured.duration,
          })
          .catch(() => {});
      } finally {
        capturing = false;
      }
    }, 1800);
  }

  async function handleScanExistingFlowVideos(payload) {
    const videos = Array.from(document.querySelectorAll('video')).filter((v) =>
      Boolean(getVideoElementUrl(v))
    );
    if (videos.length === 0) {
      reportStatus(
        'ERROR',
        'No se encontraron videos generados en la pestaña abierta de Google Flow.'
      );
      return;
    }

    reportStatus(
      'WORKING',
      `🔍 Escaneando ${videos.length} video(s) en Google Flow para auditarlos contra sus Prompts y Voz Narrativa...`
    );

    const seenUrls = new Set();
    let fallbackIndex = 1;

    for (const v of videos) {
      const url = getVideoElementUrl(v);
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);

      const inferredNum = inferClipNumberFromVideoCard(v) || payload?.clipNumber || fallbackIndex;
      fallbackIndex++;

      const captured = await captureVideoFramesAndBinary(v);
      try {
        await chrome.runtime.sendMessage({
          type: 'FLOW_VIDEO_CAPTURED',
          clipNumber: inferredNum,
          clipId: payload?.clipId,
          attempt: 1,
          videoUrl: captured.videoUrl,
          videoDataUrl: captured.videoDataUrl,
          frames: captured.frames,
          duration: captured.duration,
          fromScan: true,
        });
      } catch {}
    }
  }

  function extractLatestFlowMedia() {
    const videos = Array.from(document.querySelectorAll('video'))
      .map((v) => getVideoElementUrl(v))
      .filter(Boolean);

    const images = Array.from(document.querySelectorAll('img'))
      .filter((img) => {
        const w = img.naturalWidth || img.width || 0;
        const src = img.src || '';
        return src && !src.includes('avatar') && (w === 0 || w >= 180);
      })
      .map((img) => img.src);

    return { videos, images };
  }

  function handleSendFlowPrompt(payload) {
    const now = Date.now();
    const lastTs = Number(
      document.documentElement.getAttribute('data-huellas-flow-cmd-ts') || '0'
    );
    if (now - lastTs < 1200) {
      return true;
    }
    document.documentElement.setAttribute('data-huellas-flow-cmd-ts', String(now));

    const rawPromptText = payload.prompt || '';
    const promptText =
      payload.mediaType === 'THUMBNAILS'
        ? rawPromptText.replace(/^Thumbnail\s*:\s*/i, '').trim()
        : rawPromptText;
    const baselineUrls = getAllCurrentVideoUrlsSet();
    const baselineImageUrls = getAllCurrentImageUrlsSet();

    setTimeout(() => {
      const inputEl = findFlowPromptInput();
      if (!inputEl) {
        reportStatus(
          'ERROR',
          'No se encontró la caja de prompt en Google Flow. Asegúrate de haber entrado a tu proyecto en Google Flow.'
        );
        return;
      }

      setFlowInputText(inputEl, promptText);
      reportStatus('PROMPT_INJECTED', 'Prompt pegado en Google Flow, iniciando producción...', {
        clipNumber: payload.clipNumber,
        clipId: payload.clipId,
        mediaType: payload.mediaType,
      });

      if (payload.autoSubmit === false) return;

      let attempts = 0;
      const trySubmit = () => {
        attempts++;
        const submitBtn = findExactFlowSubmitButton(inputEl);

        if (
          submitBtn &&
          !submitBtn.disabled &&
          submitBtn.getAttribute('aria-disabled') !== 'true'
        ) {
          clickFlowSubmitButton(submitBtn, inputEl);
          reportStatus(
            'GENERATING',
            `🎬 Prompt enviado a producción en Google Flow. Vigilando generación automáticamente...`,
            {
              clipNumber: payload.clipNumber,
              clipId: payload.clipId,
              mediaType: payload.mediaType,
            }
          );
          if (payload.mediaType === 'THUMBNAILS') {
            startFlowThumbnailWatcher({
              optionLabel: payload.optionLabel,
              baselineImageUrls,
            });
          } else if (payload.watchForVideo !== false && payload.mediaType !== 'IMAGE') {
            startFlowVideoWatcher({
              clipNumber: payload.clipNumber,
              clipId: payload.clipId,
              prompt: promptText,
              attempt: payload.attempt || 1,
              baselineUrls,
              batchStartClip: payload.batchStartClip,
              batchEndClip: payload.batchEndClip,
              expectedCount: payload.expectedCount,
            });
          }
          return;
        }

        if (attempts < 8) {
          setTimeout(trySubmit, 180);
        } else {
          clickFlowSubmitButton(submitBtn, inputEl);
          reportStatus(
            'GENERATING',
            `🎬 Prompt enviado a producción en Google Flow. Vigilando generación...`,
            { clipNumber: payload.clipNumber, clipId: payload.clipId }
          );
          if (payload.mediaType === 'THUMBNAILS') {
            startFlowThumbnailWatcher({
              optionLabel: payload.optionLabel,
              baselineImageUrls,
            });
          } else if (payload.watchForVideo !== false && payload.mediaType !== 'IMAGE') {
            startFlowVideoWatcher({
              clipNumber: payload.clipNumber,
              clipId: payload.clipId,
              prompt: promptText,
              attempt: payload.attempt || 1,
              baselineUrls,
              batchStartClip: payload.batchStartClip,
              batchEndClip: payload.batchEndClip,
              expectedCount: payload.expectedCount,
            });
          }
        }
      };

      setTimeout(trySubmit, 220);
    }, 50);

    return true;
  }

  window.__HUELLAS_FLOW_MESSAGE_HANDLER__ = (msg, _sender, sendResponse) => {
    if (!msg || msg.target !== 'FLOW') return false;

    if (msg.action === 'SEND_PROMPT' || msg.action === 'SEND_PROMPT_V2') {
      const ok = handleSendFlowPrompt(msg);
      sendResponse({ handled: ok });
      return false;
    }

    if (msg.action === 'SCAN_FLOW_VIDEOS') {
      handleScanExistingFlowVideos(msg);
      sendResponse({ handled: true });
      return false;
    }

    if (msg.action === 'SCAN_FLOW_THUMBNAILS') {
      handleScanFlowThumbnails();
      sendResponse({ handled: true });
      return false;
    }

    if (msg.action === 'STOP_FLOW_WATCHER') {
      if (window.__HUELLAS_FLOW_WATCHER_TIMER__) {
        clearInterval(window.__HUELLAS_FLOW_WATCHER_TIMER__);
        window.__HUELLAS_FLOW_WATCHER_TIMER__ = null;
      }
      sendResponse({ handled: true });
      return false;
    }

    if (msg.action === 'GRAB_LAST_MEDIA') {
      const media = extractLatestFlowMedia();
      chrome.runtime
        .sendMessage({
          type: 'FLOW_MEDIA_READY',
          clipNumber: msg.clipNumber,
          videos: media.videos,
          images: media.images,
        })
        .catch(() => {});
      sendResponse({ handled: true, ...media });
      return false;
    }

    return false;
  };

  chrome.runtime.onMessage.addListener(window.__HUELLAS_FLOW_MESSAGE_HANDLER__);
})();
