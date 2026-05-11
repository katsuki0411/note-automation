// note-automation Poster — bridge content script
//
// note-automation の Webアプリページに注入され、
// ページ ↔ 拡張 background 間を window.postMessage で中継する。
// これにより Webアプリ側は拡張IDを知らずに投稿リクエストを送れる。

(() => {
  if (window.__noteAutomationPosterBridgeLoaded) return;

  // manifest の content_scripts は *.vercel.app に広く合致させているため、
  // ここで note-automation の本番/プレビュー/ローカルだけにスコープを絞る。
  // 他の vercel.app サイトから誤った POST_ARTICLE を受け付けないため必須。
  const host = location.hostname;
  const isAllowed =
    host === "localhost" ||
    host === "note-automation-rho.vercel.app" ||
    (host.startsWith("note-automation-") && host.endsWith(".vercel.app"));
  if (!isAllowed) return;

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
