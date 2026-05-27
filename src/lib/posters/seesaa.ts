import { postAtomPubEntry } from "./atompub";
import type { PostArticleInput, PostArticleResult } from "./types";

// Seesaa ブログの AtomPub:
//   endpoint: http://blog.seesaa.jp/atom/blog/{blogId}/article
//   認証:     Basic 認証 (Username = ログインメアド, Password = ログインパスワード)
//   content type: text/html

export type SeesaaConfig = {
  blogId: string; // ブログ ID (管理画面 URL の数字部分)
  email: string;  // ログインメアド
  password: string;
};

export async function postToSeesaa(
  config: SeesaaConfig,
  input: PostArticleInput,
): Promise<PostArticleResult> {
  const blogId = config.blogId?.trim();
  const email = config.email?.trim();
  const password = config.password?.trim();
  if (!blogId || !email || !password) {
    return { ok: false, error: "blogId / email / password のいずれかが未設定です" };
  }
  return postAtomPubEntry(
    {
      endpoint: `http://blog.seesaa.jp/atom/blog/${encodeURIComponent(blogId)}/article`,
      auth: { kind: "basic", username: email, password },
      contentType: "text/html",
    },
    input,
  );
}
