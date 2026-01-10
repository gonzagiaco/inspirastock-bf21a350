let isOffline = false;

export function setupOfflineHandler() {
  window.addEventListener("offline", () => {
    if (isOffline) return;
    isOffline = true;
    document.documentElement.dataset.offline = "1";
  });

  window.addEventListener("online", () => {
    isOffline = false;
    delete document.documentElement.dataset.offline;
  });
}
