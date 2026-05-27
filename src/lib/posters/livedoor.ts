import { postAtomPubEntry } from "./atompub";
import type { PostArticleInput, PostArticleResult } from "./types";

// livedoor Blog の AtomPub:
//   endpoint: https://livedoor.blogcms.jp/atompub/{livedoorId}/article
//   認証:     WSSE (Username = livedoor ID, Password = AtomPub API キー)
//   API キー: 管理画面 → ブログ設定 → API Key で発行
//   content type: text/x-markdown 対応 (テスト時 HTML フォールバックも考慮)

export type LivedoorConfig = {
  livedoorId: string; // ログインID = WSSE Username
  blogId: string;     // ブログURL の /<blogId>/ 部分。エンドポイントには使わないが将来用に保持
  apiKey: string;     // AtomPub API キー = WSSE Password
};

export async function postToLivedoor(
  config: LivedoorConfig,
  input: PostArticleInput,
): Promise<PostArticleResult> {
  const livedoorId = config.livedoorId?.trim();
  const apiKey = config.apiKey?.trim();
  if (!livedoorId || !apiKey) {
    return { ok: false, error: "livedoorId / apiKey のいずれかが未設定です" };
  }
  return postAtomPubEntry(
    {
      endpoint: `https://livedoor.blogcms.jp/atompub/${encodeURIComponent(livedoorId)}/article`,
      auth: { kind: "wsse", username: livedoorId, password: apiKey },
      contentType: "text/x-markdown",
    },
    input,
  );
}
