const $ = (id) => document.getElementById(id);
const titleEl = $("title");
const bodyEl = $("body");
const tagsEl = $("tags");
const publishToggle = $("publishToggle");
const postBtn = $("post");
const statusEl = $("status");

function parseTags(raw) {
  return (raw ?? "")
    .split(/[,、]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `status ${kind ?? ""}`;
  statusEl.style.display = text ? "block" : "none";
}

function formatResult(r) {
  if (!r) return null;
  if (r.mode === "in_progress") return null; // 起動中は表示しない
  if (r.ok) {
    if (r.mode === "publish_clicked") return { text: "✓ 公開ボタン押下まで完了（noteタブで確認）", kind: "ok" };
    if (r.mode === "draft") return { text: "✓ 下書きに入力完了", kind: "ok" };
    return { text: "✓ 完了", kind: "ok" };
  }
  return { text: `失敗: ${r.error ?? "不明"}`, kind: "err" };
}

// ポップアップ起動時に直近の結果を復元（ポップアップは新タブ開いた時点で閉じるので必須）
// 表示したら storage からは消す（再オープン時に古い結果が居座らないように）
async function restoreLastResult() {
  try {
    const { lastResult } = await chrome.storage.local.get("lastResult");
    if (!lastResult) return;
    const fresh = Date.now() - (lastResult.ts ?? 0) <= 10 * 60 * 1000;
    if (fresh) {
      const f = formatResult(lastResult);
      if (f) setStatus(f.text, f.kind);
    }
    // 古くても新しくても、表示用としては使い切ったので削除
    await chrome.storage.local.remove("lastResult");
  } catch (_) {}
}

restoreLastResult();

// 結果が後から更新された場合に追従
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.lastResult) return;
  const f = formatResult(changes.lastResult.newValue);
  if (f) setStatus(f.text, f.kind);
});

postBtn.addEventListener("click", () => {
  const title = titleEl.value.trim();
  const body = bodyEl.value;
  const tags = parseTags(tagsEl.value);
  const publish = publishToggle.checked;
  if (!title || !body) {
    setStatus("タイトルと本文の両方を入れてください", "err");
    return;
  }
  postBtn.disabled = true;
  setStatus(publish ? "note.com を開いて公開中..." : "note.com を開いて入力中...");

  chrome.runtime.sendMessage(
    { type: "POST_ARTICLE", payload: { title, body, tags, publish } },
    (res) => {
      postBtn.disabled = false;
      if (chrome.runtime.lastError) {
        setStatus(`エラー: ${chrome.runtime.lastError.message}`, "err");
        return;
      }
      const f = formatResult(res);
      if (f) setStatus(f.text, f.kind);
    },
  );
});
