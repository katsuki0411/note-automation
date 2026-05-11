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
    const { title, body, tags = [], publish = false } = payload ?? {};
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
    if (!publish) {
      // 下書き保存は note 側で自動保存される想定
      return { ok: true, mode: "draft" };
    }

    // 本文反映が DOM に行き渡るまで少し待つ
    await sleep(500);

    // 1) エディタ画面右上の「公開」または「公開設定」ボタンを押す → モーダル起動
    const openModalBtn = await waitForButton(["公開設定", "公開に進む", "公開"], 8000);
    if (!openModalBtn) return { ok: false, error: "公開ボタンが見つからない" };
    openModalBtn.click();

    // 2) モーダル描画を待つ
    await sleep(800);

    // 3) タグ入力（あれば）
    if (tags.length > 0) {
      try {
        await fillTags(tags);
      } catch (e) {
        // タグ入力失敗は致命傷にせずログだけ残す
        console.warn("[note-poster] タグ入力に失敗:", e);
      }
    }

    // 4) 最終投稿ボタン
    const finalBtn = await waitForButton(["投稿する", "公開する", "投稿"], 8000);
    if (!finalBtn) return { ok: false, error: "最終投稿ボタンが見つからない" };

    // 3) sendResponse を先に返してから click する。
    //    note.com の公開遷移でこのページが bfcache に入りメッセージポートが閉じるため、
    //    click 前に応答を返却する。結果（公開済みURL等）は note のタブを見れば分かるので
    //    拡張側で追跡しない。
    setTimeout(() => finalBtn.click(), 200);
    return { ok: true, mode: "publish_clicked" };
  }

  // --- helpers ---

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.disabled) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    return true;
  }

  // テキスト一致のボタンを表示中・有効なものに限って探す（モーダル描画を待つためポーリング）
  async function waitForButton(textCandidates, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const all = document.querySelectorAll('button, [role="button"], a');
      for (const el of all) {
        if (!isVisible(el)) continue;
        const t = (el.innerText || el.textContent || "").trim();
        if (!t) continue;
        if (textCandidates.some((needle) => t === needle)) return el;
      }
      // 完全一致がなければ部分一致でフォールバック
      for (const el of all) {
        if (!isVisible(el)) continue;
        const t = (el.innerText || el.textContent || "").trim();
        if (!t) continue;
        if (textCandidates.some((needle) => t.includes(needle))) return el;
      }
      await sleep(200);
    }
    return null;
  }

  // モーダル内のタグ入力欄に1個ずつタグを入れる。
  // note の挙動: 入力 → Enter で確定（チップ化）。確定機構がEnter以外なら要修正。
  async function fillTags(tags) {
    const tagInput = await waitFor(
      // TODO: 実機の note 公開モーダルで確認
      'input[placeholder*="タグ"], input[aria-label*="タグ"], input[name*="tag"]',
      5000,
    );
    if (!tagInput) {
      console.warn("[note-poster] タグ入力欄が見つからない、スキップ");
      return;
    }
    tagInput.focus();
    for (const tag of tags) {
      const t = String(tag).trim();
      if (!t) continue;
      setNativeValue(tagInput, t);
      tagInput.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(150);
      for (const type of ["keydown", "keypress", "keyup"]) {
        tagInput.dispatchEvent(
          new KeyboardEvent(type, {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
      await sleep(250);
    }
  }

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
