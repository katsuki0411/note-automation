// note-automation Poster Chrome 拡張との通信ヘルパー
// 拡張が注入する bridge.js と window.postMessage で会話する

export type NotePostPayload = {
  title: string;
  body: string;
  tags?: string[];
  publish?: boolean;
  imageUrl?: string;
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
// 既に取り逃した後でも検知したい場合は pingExtension() を使う。
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

// ボタン押下などで「いま拡張が動いているか」を能動的に確認する。
// bridge.js v0.1.9+ が PING を受け取って PONG を返す仕組みを使う。
// 古いバージョン (PING未対応) や未インストールの場合はタイムアウトで { installed: false }。
export type ExtensionPingResult = {
  installed: boolean;
  version?: string;
};

export function pingExtension(timeoutMs = 1500): Promise<ExtensionPingResult> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve({ installed: false });
      return;
    }
    const requestId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `ping_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const handler = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as
        | { source?: string; type?: string; requestId?: string; version?: string }
        | undefined;
      if (
        data?.source === EXT_SOURCE &&
        data?.type === "PONG" &&
        data?.requestId === requestId
      ) {
        cleanup();
        resolve({ installed: true, version: data.version });
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve({ installed: false });
    }, timeoutMs);
    function cleanup() {
      window.removeEventListener("message", handler);
      clearTimeout(timer);
    }
    window.addEventListener("message", handler);
    window.postMessage(
      { source: PAGE_SOURCE, type: "PING", requestId },
      "*",
    );
  });
}

// いま note.com にログイン中のアカウント（＝投稿先）を拡張経由で取得する。
// 拡張 v0.2.1+ の GET_ACCOUNT に対応。古い拡張・未ログインは ok:false。
export type NoteAccountResult = {
  ok: boolean;
  loggedIn?: boolean;
  urlname?: string | null;
  nickname?: string | null;
  error?: string;
};

export function getNoteAccount(timeoutMs = 6000): Promise<NoteAccountResult> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve({ ok: false, error: "window なし" });
      return;
    }
    const requestId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `acc_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const handler = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as
        | { source?: string; type?: string; requestId?: string; result?: NoteAccountResult }
        | undefined;
      if (
        data?.source === EXT_SOURCE &&
        data?.type === "GET_ACCOUNT_RESULT" &&
        data?.requestId === requestId
      ) {
        cleanup();
        resolve(data.result ?? { ok: false, error: "空応答" });
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve({ ok: false, error: "拡張から応答がありません（未インストール or 旧バージョンの可能性）" });
    }, timeoutMs);
    function cleanup() {
      window.removeEventListener("message", handler);
      clearTimeout(timer);
    }
    window.addEventListener("message", handler);
    window.postMessage(
      { source: PAGE_SOURCE, type: "GET_ACCOUNT", requestId },
      "*",
    );
  });
}
