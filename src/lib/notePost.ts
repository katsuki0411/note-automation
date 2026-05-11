// note-automation Poster Chrome 拡張との通信ヘルパー
// 拡張が注入する bridge.js と window.postMessage で会話する

export type NotePostPayload = {
  title: string;
  body: string;
  tags?: string[];
  publish?: boolean;
};

export type NotePostResult = {
  ok: boolean;
  error?: string;
  mode?: "draft" | "publish_clicked";
};

const PAGE_SOURCE = "note-automation";
const EXT_SOURCE = "note-automation-poster-ext";

export function postToNote(
  payload: NotePostPayload,
  timeoutMs = 60_000,
): Promise<NotePostResult> {
  return new Promise((resolve) => {
    const requestId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const handler = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as
        | {
            source?: string;
            type?: string;
            requestId?: string;
            result?: NotePostResult;
          }
        | undefined;
      if (
        data?.source !== EXT_SOURCE ||
        data?.type !== "POST_ARTICLE_RESULT" ||
        data?.requestId !== requestId
      ) {
        return;
      }
      cleanup();
      resolve(data.result ?? { ok: false, error: "空応答" });
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve({
        ok: false,
        error: "拡張から応答がありません（拡張が未インストールの可能性）",
      });
    }, timeoutMs);

    function cleanup() {
      window.removeEventListener("message", handler);
      clearTimeout(timer);
    }

    window.addEventListener("message", handler);
    window.postMessage(
      { source: PAGE_SOURCE, type: "POST_ARTICLE", requestId, payload },
      "*",
    );
  });
}

// 拡張がインストールされているか軽く検知（bridge.js が起動時に EXTENSION_READY を投げる）
// note: ページロード直後の一瞬しか流れないので、検知には最初の数秒で window.addEventListener 必要。
// 既に取り逃した後でも検知したい場合は ping/pong 方式が必要だが、今は ready 通知だけで運用。
export function detectExtension(timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const handler = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as { source?: string; type?: string } | undefined;
      if (data?.source === EXT_SOURCE && data?.type === "EXTENSION_READY") {
        cleanup();
        resolve(true);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    function cleanup() {
      window.removeEventListener("message", handler);
      clearTimeout(timer);
    }
    window.addEventListener("message", handler);
  });
}
