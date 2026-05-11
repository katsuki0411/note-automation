// note-automation Poster — content script
//
// note.com の投稿ページ DOM を操作してタイトル・本文を入力する。
// 初版方針:
//   - 下書き保存まで（公開ボタンは押さない）。動作確認できたら publish:true で公開まで進めるよう拡張する。
//   - タグ・有料/無料・コメント可否・マガジンは未対応。後続コミットで足す。
//   - セレクタは note.com の DOM 変更に追従が必要。すべて TODO マーク済み。

(() => {
  if (window.__noteAutomationPosterLoaded) return;
  window.__noteAutomationPosterLoaded = true;

  let fillInFlight = false;
  let fillDone = false;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "FILL_AND_POST") return;

    // 同一ページに対する FILL_AND_POST は1回しか実行しない（背景側でも防いでいるが二重防御）
    if (fillDone) {
      sendResponse({ ok: true, mode: "draft", skipped: "already-filled" });
      return;
    }
    if (fillInFlight) {
      sendResponse({ ok: false, error: "fill in progress" });
      return;
    }
    fillInFlight = true;

    fillAndPost(msg.payload)
      .then((result) => {
        fillInFlight = false;
        if (result?.ok) fillDone = true;
        sendResponse(result);
      })
      .catch((err) => {
        fillInFlight = false;
        sendResponse({ ok: false, error: err?.message ?? String(err) });
      });
    return true; // async
  });

  async function fillAndPost(payload) {
    const { title, body, publish = false } = payload ?? {};
    if (!title || !body) {
      return { ok: false, error: "title / body が空" };
    }

    // --- タイトル入力 ---
    const titleEl = await waitFor(
      // TODO: 実機の note 投稿ページで確認して差し替える
      'textarea[placeholder*="記事タイトル"], textarea[aria-label*="タイトル"], input[placeholder*="タイトル"]',
      8000,
    );
    if (!titleEl) return { ok: false, error: "タイトル入力欄が見つからない" };
    setNativeValue(titleEl, title);
    titleEl.dispatchEvent(new Event("input", { bubbles: true }));
    titleEl.dispatchEvent(new Event("change", { bubbles: true }));

    // --- 本文入力 ---
    // note は TipTap (ProseMirror) ベース。contenteditable に paste するのが確実。
    const editor = await waitFor(
      // TODO: 実機で確認して差し替える
      'div.ProseMirror, div[contenteditable="true"]',
      8000,
    );
    if (!editor) return { ok: false, error: "本文エディタが見つからない" };
    editor.focus();

    const dt = new DataTransfer();
    dt.setData("text/plain", body);
    editor.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      }),
    );

    // --- 公開 or 下書き ---
    if (publish) {
      // TODO: 公開ボタンのセレクタは実機確認。多段モーダルになる可能性あり。
      return {
        ok: false,
        error: "publish:true は未実装。下書き保存で確認してください",
      };
    }

    // 下書き保存は note 側で自動保存される想定。明示ボタンがあれば押す。
    // TODO: 「下書き保存」ボタンがあるか実機確認

    return { ok: true, mode: "draft" };
  }

  // --- helpers ---

  function waitFor(selector, timeoutMs) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);
    });
  }

  // React/Vue 等が監視する value setter を経由して値を入れる
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }
})();
