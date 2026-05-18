import crypto from "node:crypto";

// はてなブログ AtomPub API への投稿アダプタ。
// ドキュメント: https://developer.hatena.ne.jp/ja/documents/blog/apis/atom

export type HatenaConfig = {
  hatenaId: string;       // 例 "t3zztwzmay"
  blogDomain: string;     // 例 "t3zztwzmay.hatenablog.com"
  apiKey: string;         // 詳細設定 → AtomPub の API キー
};

export type PostArticleInput = {
  title: string;
  bodyMarkdown: string;
  tags?: string[];
  draft?: boolean;
  imageUrl?: string;      // 本文先頭に挿入する画像URL（アイキャッチ代替）
};

export type PostArticleResult = {
  ok: boolean;
  url?: string;
  editUrl?: string;
  error?: string;
};

// WSSE 認証ヘッダーを生成
// Spec: PasswordDigest = base64(sha1(nonce + created + apiKey))
function generateWSSE(username: string, apiKey: string): string {
  const nonce = crypto.randomBytes(16);
  const created = new Date().toISOString();
  const hash = crypto.createHash("sha1");
  hash.update(nonce);
  hash.update(Buffer.from(created, "utf8"));
  hash.update(Buffer.from(apiKey, "utf8"));
  const passwordDigest = hash.digest("base64");
  const nonceB64 = nonce.toString("base64");
  return `UsernameToken Username="${username}", PasswordDigest="${passwordDigest}", Nonce="${nonceB64}", Created="${created}"`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildAtomXml(input: PostArticleInput): string {
  const { title, bodyMarkdown, tags = [], draft = false, imageUrl } = input;
  // 画像URL があれば本文の冒頭に Markdown 画像として挿入
  // → はてなブログでは記事内の最初の画像が自動でアイキャッチ(OGP)になる
  const contentBody = imageUrl
    ? `![](${imageUrl})\n\n${bodyMarkdown}`
    : bodyMarkdown;
  const categoryLines = tags
    .filter((t) => t.trim())
    .map((t) => `  <category term="${escapeXml(t)}" />`)
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<entry xmlns="http://www.w3.org/2005/Atom"
       xmlns:app="http://www.w3.org/2007/app">
  <title>${escapeXml(title)}</title>
  <content type="text/x-markdown">${escapeXml(contentBody)}</content>
${categoryLines}
  <app:control>
    <app:draft>${draft ? "yes" : "no"}</app:draft>
  </app:control>
</entry>`;
}

export async function postToHatena(
  config: HatenaConfig,
  input: PostArticleInput,
): Promise<PostArticleResult> {
  const hatenaId = config.hatenaId?.trim();
  const blogDomain = config.blogDomain?.trim();
  const apiKey = config.apiKey?.trim();
  if (!hatenaId || !blogDomain || !apiKey) {
    return {
      ok: false,
      error: "hatenaId / blogDomain / apiKey のいずれかが未設定です",
    };
  }
  const url = `https://blog.hatena.ne.jp/${hatenaId}/${blogDomain}/atom/entry`;
  const xml = buildAtomXml(input);
  const wsse = generateWSSE(hatenaId, apiKey);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml",
        "X-WSSE": wsse,
      },
      body: xml,
    });
    if (!res.ok) {
      const errText = await res.text();
      return {
        ok: false,
        error: `はてな投稿失敗: HTTP ${res.status} ${errText.slice(0, 400)}`,
      };
    }
    // 201 Created。レスポンス Atom XML から公開URLを抽出
    const responseXml = await res.text();
    const linkAlt = responseXml.match(
      /<link[^>]+rel="alternate"[^>]+href="([^"]+)"/i,
    );
    const linkEdit = responseXml.match(
      /<link[^>]+rel="edit"[^>]+href="([^"]+)"/i,
    );
    return {
      ok: true,
      url: linkAlt?.[1],
      editUrl: linkEdit?.[1],
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
