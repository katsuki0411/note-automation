// note-automation Poster — background service worker
//
// 役割:
//   1) ポップアップ or Webアプリから「投稿してくれ」メッセージを受け取る
//   2) note.com の新規投稿ページを開く
//   3) そのタブの読み込みが完了したら content.js にペイロードを渡す
//   4) content.js から返ってきた結果（成功/失敗、公開URL）を呼び出し元に返す

const NEW_POST_URL = "https://note.com/notes/new"; // TODO: 実機で確認

// 投稿中タブ → 投稿ペイロード を保持
/** @type {Map<number, { payload: any, sendResponse: (r:any)=>void }>} */
const pending = new Map();

function handlePostRequest(payload, sendResponse) {
  chrome.tabs.create({ url: NEW_POST_URL, active: true }, (tab) => {
    if (!tab || tab.id == null) {
      sendResponse({ ok: false, error: "新規タブを開けませんでした" });
      return;
    }
    pending.set(tab.id, { payload, sendResponse });
  });
}

// タブ読み込み完了を待って content.js にペイロードを送る
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete") return;
  if (!pending.has(tabId)) return;
  if (!tab.url || !/^https:\/\/(editor\.)?note\.com\//.test(tab.url)) return;

  // 同じタブで onUpdated が複数回 "complete" を発火することがある（SPA navigation 等）。
  // sendMessage の応答コールバックを待たずに pending から即削除して二重送信を防ぐ。
  const entry = pending.get(tabId);
  pending.delete(tabId);

  chrome.tabs.sendMessage(
    tabId,
    { type: "FILL_AND_POST", payload: entry.payload },
    (result) => {
      if (chrome.runtime.lastError) {
        entry.sendResponse({
          ok: false,
          error: `content.js 応答なし: ${chrome.runtime.lastError.message}`,
        });
      } else {
        entry.sendResponse(result ?? { ok: false, error: "空応答" });
      }
    },
  );
});

// 内部メッセージ（ポップアップから）
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "POST_ARTICLE") {
    handlePostRequest(msg.payload, sendResponse);
    return true; // async
  }
});

// 外部メッセージ（Webアプリから）
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "PING") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return;
  }
  if (msg?.type === "POST_ARTICLE") {
    handlePostRequest(msg.payload, sendResponse);
    return true; // async
  }
});
