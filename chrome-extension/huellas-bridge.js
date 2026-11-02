// ============================================================================
// HUELLAS MASTER — PAGE BRIDGE CONTENT SCRIPT (SAFE, SINGLE-INSTANCE)
// ============================================================================

(function () {
  if (window.__HUELLAS_BRIDGE_WINDOW_LISTENER__) {
    try {
      window.removeEventListener('message', window.__HUELLAS_BRIDGE_WINDOW_LISTENER__);
    } catch {}
  }
  if (window.__HUELLAS_BRIDGE_RUNTIME_LISTENER__) {
    try {
      chrome.runtime.onMessage.removeListener(window.__HUELLAS_BRIDGE_RUNTIME_LISTENER__);
    } catch {}
  }
  window.__HUELLAS_BRIDGE_LOADED__ = true;

  try {
    document.documentElement.setAttribute('data-huellas-extension', 'installed');
  } catch {}

  let lastPingAt = 0;

  function requestAndNotifyExtensionReady() {
    const now = Date.now();
    if (now - lastPingAt < 800) return;
    lastPingAt = now;

    try {
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage({ type: 'HUELLAS_PING_V2' }, (response) => {
        if (chrome.runtime.lastError) return;
        window.postMessage(
          {
            source: 'HUELLAS_EXTENSION',
            type: 'EXTENSION_READY',
            version: response?.version || '2.6.2',
            geminiTabs: response?.geminiTabs || [],
            flowTabs: response?.flowTabs || [],
          },
          '*'
        );
      });
    } catch {}
  }

  requestAndNotifyExtensionReady();

  window.__HUELLAS_BRIDGE_WINDOW_LISTENER__ = (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'HUELLAS_APP') {
      return;
    }

    // Si este content script pertenece a un contexto invalidado tras recargar la extensión, desregistrarlo
    if (!chrome?.runtime?.id) {
      try {
        window.removeEventListener('message', window.__HUELLAS_BRIDGE_WINDOW_LISTENER__);
      } catch {}
      return;
    }

    const data = event.data;

    if (data.type === 'HUELLAS_PING_V2' || data.type === 'HUELLAS_PING') {
      requestAndNotifyExtensionReady();
      return;
    }

    if (data.type === 'HUELLAS_COMMAND') {
      try {
        const cleanPayload = { ...(data.payload || {}) };
        if (cleanPayload.action === 'SEND_PROMPT') {
          delete cleanPayload.storyStudioProjectJson;
          if (Array.isArray(cleanPayload.referenceAssetsForClips)) {
            cleanPayload.referenceAssetsForClips = cleanPayload.referenceAssetsForClips.map(
              (r) => ({
                id: r?.id,
                tag: r?.tag,
                name: r?.name,
              })
            );
          }
        }

        chrome.runtime.sendMessage(
          {
            type: 'HUELLAS_COMMAND',
            targetService: data.targetService,
            payload: cleanPayload,
          },
          (response) => {
            if (chrome.runtime.lastError) {
              window.postMessage(
                {
                  source: 'HUELLAS_EXTENSION',
                  type: 'BRIDGE_STATUS',
                  service: data.targetService || 'FLOW',
                  status: 'ERROR',
                  message: `⚠️ Error de comunicación con la extensión: ${chrome.runtime.lastError.message}`,
                },
                '*'
              );
              return;
            }
            window.postMessage(
              {
                source: 'HUELLAS_EXTENSION',
                type: 'COMMAND_ACK',
                requestId: data.requestId,
                response: response || { ok: false },
              },
              '*'
            );
          }
        );
      } catch (err) {
        window.postMessage(
          {
            source: 'HUELLAS_EXTENSION',
            type: 'BRIDGE_STATUS',
            service: data.targetService || 'FLOW',
            status: 'ERROR',
            message: `⚠️ Recarga la página de Huellas Master tras actualizar la extensión (${String(err?.message || err)}).`,
          },
          '*'
        );
      }
    }
  };

  window.addEventListener('message', window.__HUELLAS_BRIDGE_WINDOW_LISTENER__);

  window.__HUELLAS_BRIDGE_RUNTIME_LISTENER__ = (message) => {
    if (!message || typeof message !== 'object') return false;
    if (
      message.type === 'BRIDGE_STATUS' ||
      message.type === 'GEMINI_RESPONSE_READY' ||
      message.type === 'FLOW_MEDIA_READY' ||
      message.type === 'FLOW_VIDEO_CAPTURED' ||
      message.type === 'FLOW_CLIP_IMAGE_CAPTURED' ||
      message.type === 'FLOW_THUMBNAIL_CAPTURED' ||
      message.type === 'FLOW_REFERENCE_CAPTURED' ||
      message.type === 'SUNO_AUDIO_CAPTURED' ||
      message.type === 'HUELLAS_CONNECTED_TABS_UPDATE'
    ) {
      window.postMessage(
        {
          source: 'HUELLAS_EXTENSION',
          ...message,
        },
        '*'
      );
    }
    return false;
  };

  chrome.runtime.onMessage.addListener(window.__HUELLAS_BRIDGE_RUNTIME_LISTENER__);
})();
