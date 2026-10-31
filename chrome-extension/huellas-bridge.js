// ============================================================================
// HUELLAS MASTER — PAGE BRIDGE CONTENT SCRIPT (SAFE, SINGLE-INSTANCE)
// ============================================================================

(function () {
  if (window.__HUELLAS_BRIDGE_LOADED__) return;
  window.__HUELLAS_BRIDGE_LOADED__ = true;

  try {
    document.documentElement.setAttribute('data-huellas-extension', 'installed');
  } catch {}

  let lastPingAt = 0;

  function requestAndNotifyExtensionReady() {
    const now = Date.now();
    if (now - lastPingAt < 1500) return;
    lastPingAt = now;

    try {
      chrome.runtime.sendMessage({ type: 'HUELLAS_PING_V2' }, (response) => {
        if (chrome.runtime.lastError) return;
        window.postMessage(
          {
            source: 'HUELLAS_EXTENSION',
            type: 'EXTENSION_READY',
            version: response?.version || '1.2.0',
            geminiTabs: response?.geminiTabs || [],
            flowTabs: response?.flowTabs || [],
          },
          '*'
        );
      });
    } catch {}
  }

  requestAndNotifyExtensionReady();

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'HUELLAS_APP') {
      return;
    }

    const data = event.data;

    if (data.type === 'HUELLAS_PING_V2' || data.type === 'HUELLAS_PING') {
      requestAndNotifyExtensionReady();
      return;
    }

    if (data.type === 'HUELLAS_COMMAND') {
      try {
        chrome.runtime.sendMessage(
          {
            type: 'HUELLAS_COMMAND',
            targetService: data.targetService,
            payload: data.payload,
          },
          (response) => {
            if (chrome.runtime.lastError) return;
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
      } catch {}
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') return false;
    if (
      message.type === 'BRIDGE_STATUS' ||
      message.type === 'GEMINI_RESPONSE_READY' ||
      message.type === 'FLOW_MEDIA_READY' ||
      message.type === 'FLOW_VIDEO_CAPTURED' ||
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
  });
})();
