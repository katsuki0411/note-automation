const $ = (id) => document.getElementById(id);
const titleEl = $("title");
const bodyEl = $("body");
const postBtn = $("post");
const statusEl = $("status");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `status ${kind ?? ""}`;
  statusEl.style.display = text ? "block" : "none";
}

postBtn.addEventListener("click", () => {
  const title = titleEl.value.trim();
  const body = bodyEl.value;
  if (!title || !body) {
    setStatus("タイトルと本文の両方を入れてください", "err");
    return;
  }
  postBtn.disabled = true;
  setStatus("note.com を開いて入力中...");

  chrome.runtime.sendMessage(
    { type: "POST_ARTICLE", payload: { title, body, publish: false } },
    (res) => {
      postBtn.disabled = false;
      if (chrome.runtime.lastError) {
        setStatus(`エラー: ${chrome.runtime.lastError.message}`, "err");
        return;
      }
      if (res?.ok) {
        setStatus(`✓ ${res.mode === "draft" ? "下書きに入力完了" : "投稿完了"}`, "ok");
      } else {
        setStatus(`失敗: ${res?.error ?? "不明"}`, "err");
      }
    },
  );
});
