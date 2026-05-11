// note-automation Poster — bridge content script
//
// note-automation の Webアプリページに注入され、
// ページ ↔ 拡張 background 間を window.postMessage で中継する。
// これにより Webアプリ側は拡張IDを知らずに投稿リクエストを送れる。

(() => {
  if (window.__noteAutomationPosterBridgeLoaded) return;
  window.__noteAutomationPosterBridgeLoaded = true;

  // ページ → 拡張
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "note-automation") return;

    if (data.type === "POST_ARTICLE") {
      chrome.runtime.sendMessage(
        { type: "POST_ARTICLE", payload: data.payload },
        (result) => {
          window.postMessage(
            {
              source: "note-automation-poster-ext",
              type: "POST_ARTICLE_RESULT",
              requestId: data.requestId,
              result:
                result ?? {
                  ok: false,
                  error:
                    chrome.runtime.lastError?.message ?? "unknown bridge error",
                },
            },
            "*",
          );
        },
      );
    }
  });

  // 拡張インストール検知用の ready 通知
  window.postMessage(
    {
      source: "note-automation-poster-ext",
      type: "EXTENSION_READY",
      version: chrome.runtime.getManifest().version,
    },
    "*",
  );
})();
