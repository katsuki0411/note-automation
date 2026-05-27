import { postAtomPubEntry } from "./atompub";
import type { PostArticleInput, PostArticleResult } from "./types";

// FC2 ブログの AtomPub:
//   endpoint: http://blog.fc2.com/atompub/{blogId}/entry
//   認証:     Basic 認証 (Username = FC2 ID, Password = ログインパスワード)
//   content type: text/html (Markdown 非対応のため naiveMarkdownToHtml で変換)

export type Fc2Config = {
  blogId: string;
  username: string;
  password: string;
};

export async function postToFc2(
  config: Fc2Config,
  input: PostArticleInput,
): Promise<PostArticleResult> {
  const blogId = config.blogId?.trim();
  const username = config.username?.trim();
  const password = config.password?.trim();
  if (!blogId || !username || !password) {
    return { ok: false, error: "blogId / username / password のいずれかが未設定です" };
  }
  return postAtomPubEntry(
    {
      endpoint: `http://blog.fc2.com/atompub/${encodeURIComponent(blogId)}/entry`,
      auth: { kind: "basic", username, password },
      contentType: "text/html",
    },
    input,
  );
}
