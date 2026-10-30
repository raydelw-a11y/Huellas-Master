// ============================================================================
// HUELLAS MASTER — PAGE BRIDGE CONTENT SCRIPT
// Injected into Huellas Master (localhost:4200, raydelw-a11y.github.io, huellasdelahumanidad.com)
// ============================================================================

(function () {
  try {
    document.documentElement.setAttribute('data-huellas-extension', 'installed');
  } catch {}

  function requestAndNotifyExtensionReady() {
    try {
      chrome.runtime.sendMessage({ type: 'HUELLAS_PING' }, (response) => {
        window.postMessage(
          {
            source: 'HUELLAS_EXTENSION',
            type: 'EXTENSION_READY',
            version: response?.version || '1.1.0',
            geminiTabs: response?.geminiTabs || [],
            flowTabs: response?.flowTabs || [],
          },
          '*'
        );
      });
    } catch {
      window.postMessage(
        {
          source: 'HUELLAS_EXTENSION',
          type: 'EXTENSION_READY',
          version: '1.1.0',
          geminiTabs: [],
          flowTabs: [],
        },
        '*'
      );
    }
  }

  requestAndNotifyExtensionReady();
  window.addEventListener('DOMContentLoaded', requestAndNotifyExtensionReady);
  window.addEventListener('load', requestAndNotifyExtensionReady);

  // Listen for messages from the Huellas Master React app
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'HUELLAS_APP') {
      return;
    }

    const data = event.data;

    if (data.type === 'HUELLAS_PING') {
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
            status: 'ERROR',
            message: 'Recarga la pestaña de Huellas Master para reconectar con la extensión.',
          },
          '*'
        );
      }
    }
  });

  // Listen for updates from background.js (Gemini responses, Flow media, status, connected tabs)
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') return false;
    if (
      message.type === 'BRIDGE_STATUS' ||
      message.type === 'GEMINI_RESPONSE_READY' ||
      message.type === 'FLOW_MEDIA_READY' ||
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
