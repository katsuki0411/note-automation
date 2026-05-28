import { testAtomPubConnection } from "./atompub";
import type { PostingDestinationRow } from "./types";

// destination の platform に応じた接続テスト。
// 認証付き AtomPub GET / または非対応 platform の説明テキストを返す。
export async function testDestinationConnection(
  d: PostingDestinationRow,
): Promise<{ ok: boolean; error?: string; note?: string }> {
  switch (d.platform) {
    case "hatena": {
      const cfg = d.config as { hatenaId?: string; blogDomain?: string; apiKey?: string };
      const hatenaId = cfg.hatenaId?.trim();
      const blogDomain = cfg.blogDomain?.trim();
      const apiKey = cfg.apiKey?.trim();
      if (!hatenaId || !blogDomain || !apiKey) {
        return { ok: false, error: "hatenaId / blogDomain / apiKey のいずれかが未設定" };
      }
      return testAtomPubConnection({
        endpoint: `https://blog.hatena.ne.jp/${hatenaId}/${blogDomain}/atom`,
        auth: { kind: "wsse", username: hatenaId, password: apiKey },
      });
    }
    case "livedoor": {
      const cfg = d.config as { livedoorId?: string; blogId?: string; apiKey?: string };
      const livedoorId = cfg.livedoorId?.trim();
      const apiKey = cfg.apiKey?.trim();
      if (!livedoorId || !apiKey) {
        return { ok: false, error: "livedoorId / apiKey のいずれかが未設定" };
      }
      return testAtomPubConnection({
        endpoint: `https://livedoor.blogcms.jp/atompub/${encodeURIComponent(livedoorId)}/article`,
        auth: { kind: "wsse", username: livedoorId, password: apiKey },
      });
    }
    case "fc2":
      // FC2 は AtomPub 提供がなく XML-RPC API のみ。現状の実装では接続不可。
      return {
        ok: false,
        note: "FC2 は AtomPub 非対応のため、現状の実装では接続できません。XML-RPC への切替は別タスクで対応予定。",
      };
    case "seesaa": {
      const cfg = d.config as { blogId?: string; email?: string; password?: string };
      const blogId = cfg.blogId?.trim();
      const email = cfg.email?.trim();
      const password = cfg.password?.trim();
      if (!blogId || !email || !password) {
        return { ok: false, error: "blogId / email / password のいずれかが未設定" };
      }
      return testAtomPubConnection({
        endpoint: `http://blog.seesaa.jp/atom/blog/${encodeURIComponent(blogId)}/article`,
        auth: { kind: "basic", username: email, password },
      });
    }
    case "note":
      return {
        ok: false,
        note: "note は Chrome 拡張経由のため、サーバーAPIでの接続テストは不可。設定一覧の「再確認」ボタンで拡張のインストール状態を確認してください。",
      };
    case "blogger":
    case "ameba":
      return {
        ok: false,
        note: `${d.platform} は投稿実装が準備中のため、接続テストも未対応です。`,
      };
    default:
      return { ok: false, error: `未対応のプラットフォーム: ${d.platform}` };
  }
}
