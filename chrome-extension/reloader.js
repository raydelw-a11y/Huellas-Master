(async () => {
  try {
    if (window.location.search.includes('force=1')) {
      try {
        const st = await chrome.storage.local.get([
          'huellasActiveExternalAsks',
          'huellasActiveExternalAsk',
        ]);
        const map = (st && st.huellasActiveExternalAsks) || {};
        const now = Date.now();
        const hasActiveExternal =
          Object.values(map).some((v) => v && now - Number(v.startedAt || 0) < 360000) ||
          Boolean(
            st?.huellasActiveExternalAsk &&
              now - Number(st.huellasActiveExternalAsk.startedAt || 0) < 360000
          );
        if (hasActiveExternal) {
          await chrome.storage.local.set({ huellasPendingDeferredReload: true });
          window.close();
          return;
        }
      } catch {}
      chrome.runtime.reload();
    } else {
      chrome.runtime.sendMessage({ type: 'HUELLAS_KEEPALIVE' }, () => {
        try {
          window.close();
        } catch {}
      });
      setTimeout(() => {
        try {
          window.close();
        } catch {}
      }, 350);
    }
  } catch (e) {
    console.error(e);
  }
})();
