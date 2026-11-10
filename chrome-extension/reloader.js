try {
  if (window.location.search.includes('force=1')) {
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
