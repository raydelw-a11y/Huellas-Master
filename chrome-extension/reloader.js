(async () => {
  const closeSelfSilently = () => {
    try {
      if (chrome?.tabs?.getCurrent) {
        chrome.tabs.getCurrent((t) => {
          if (t && t.id) {
            chrome.tabs.remove(t.id).catch(() => {
              try {
                window.close();
              } catch {}
            });
          } else {
            try {
              window.close();
            } catch {}
          }
        });
        return;
      }
    } catch {}
    try {
      window.close();
    } catch {}
  };

  try {
    if (window.location.search.includes('force=1')) {
      try {
        const st = await chrome.storage.local.get([
          'huellasActiveExternalAsks',
          'huellasActiveExternalAsk',
          'huellasActiveGeminiStageOrder',
        ]);
        const map = (st && st.huellasActiveExternalAsks) || {};
        const now = Date.now();
        const activeStageOrder = st && st.huellasActiveGeminiStageOrder;
        const hasActiveStageOrder = Boolean(
          activeStageOrder && now - Number(activeStageOrder.startedAt || 0) < 1500000
        );
        const hasActiveExternal =
          hasActiveStageOrder ||
          Object.values(map).some((v) => v && now - Number(v.startedAt || 0) < 360000) ||
          Boolean(
            st?.huellasActiveExternalAsk &&
              now - Number(st.huellasActiveExternalAsk.startedAt || 0) < 360000
          );
        if (hasActiveExternal) {
          await chrome.storage.local.set({ huellasPendingDeferredReload: true });
          closeSelfSilently();
          return;
        }
      } catch {}
      chrome.runtime.reload();
    } else {
      chrome.runtime.sendMessage({ type: 'HUELLAS_KEEPALIVE' }, () => {
        closeSelfSilently();
      });
      setTimeout(() => {
        closeSelfSilently();
      }, 350);
    }
  } catch (e) {
    console.error(e);
  }
})();
