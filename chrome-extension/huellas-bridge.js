// ============================================================================
// HUELLAS MASTER — PAGE BRIDGE CONTENT SCRIPT
// Injected into Huellas Master (localhost:4200 & raydelw-a11y.github.io)
// ============================================================================

(function () {
  try {
    document.documentElement.setAttribute('data-huellas-extension', 'installed');
  } catch {}

  function notifyExtensionReady() {
    window.postMessage(
      {
        source: 'HUELLAS_EXTENSION',
        type: 'EXTENSION_READY',
        version: '1.0.0',
      },
      '*'
    );
  }

  // Announce immediately and on DOMContentLoaded / load
  notifyExtensionReady();
  window.addEventListener('DOMContentLoaded', notifyExtensionReady);
  window.addEventListener('load', notifyExtensionReady);

  // Listen for messages from the Huellas Master React app
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'HUELLAS_APP') {
      return;
    }

    const data = event.data;

    if (data.type === 'HUELLAS_PING') {
      notifyExtensionReady();
      return;
    }

    if (data.type === 'HUELLAS_COMMAND') {
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
    }
  });

  // Listen for updates from background.js (Gemini responses, Flow media, status)
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') return false;
    // Only forward messages meant for the Huellas UI
    if (
      message.type === 'BRIDGE_STATUS' ||
      message.type === 'GEMINI_RESPONSE_READY' ||
      message.type === 'FLOW_MEDIA_READY'
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
