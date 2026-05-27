import crypto from "node:crypto";
import type { PostArticleInput, PostArticleResult } from "./types";

// AtomPub 投稿の汎用クライアント。
// hatena / livedoor / FC2 / Seesaa など複数サービスが AtomPub に対応しており、
// 認証方式 (WSSE / Basic) と endpoint URL だけ違うので共通化する。

export type AtomPubAuth =
  | { kind: "wsse"; username: string; password: string }
  | { kind: "basic"; username: string; password: string };

export type AtomPubConfig = {
  endpoint: string; // POST する URL (entry collection)
  auth: AtomPubAuth;
  // content の MIME type。Markdown 投稿対応サービス用 (hatena / livedoor)
  // FC2 / Seesaa など HTML 投稿のみのサービスは "text/html" を指定し
  // bodyMarkdown を簡易的に HTML 化する (見出しが H2 ベースなので marked 不使用でもそれなりに通る)
  contentType?: "text/x-markdown" | "text/html";
};

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// WSSE UsernameToken header 生成 (hatena/livedoor で使用)
function generateWSSE(username: string, password: string): string {
  const nonce = crypto.randomBytes(16);
  const created = new Date().toISOString();
  const hash = crypto.createHash("sha1");
  hash.update(nonce);
  hash.update(Buffer.from(created, "utf8"));
  hash.update(Buffer.from(password, "utf8"));
  const passwordDigest = hash.digest("base64");
  const nonceB64 = nonce.toString("base64");
  return `UsernameToken Username="${username}", PasswordDigest="${passwordDigest}", Nonce="${nonceB64}", Created="${created}"`;
}

// Basic 認証ヘッダ生成 (FC2/Seesaa で使用)
function generateBasic(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

// 簡易 Markdown→HTML 変換。フル Markdown パーサは使わず、
// 見出し / 段落 / 引用 / リスト / リンクなど最低限だけサポート。
// (FC2/Seesaa など HTML 投稿のみのサービス用。完全性は犠牲)
function naiveMarkdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inList = false;
  let inBlockquote = false;
  const flushList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  const flushQuote = () => {
    if (inBlockquote) {
      out.push("</blockquote>");
      inBlockquote = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushList();
      flushQuote();
      continue;
    }
    const h2 = line.match(/^##\s+(.+)$/);
    const h3 = line.match(/^###\s+(.+)$/);
    const li = line.match(/^[-*]\s+(.+)$/);
    const quote = line.match(/^>\s?(.*)$/);
    if (h2) {
      flushList();
      flushQuote();
      out.push(`<h2>${escapeHtmlInline(h2[1])}</h2>`);
    } else if (h3) {
      flushList();
      flushQuote();
      out.push(`<h3>${escapeHtmlInline(h3[1])}</h3>`);
    } else if (li) {
      flushQuote();
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${escapeHtmlInline(li[1])}</li>`);
    } else if (quote) {
      flushList();
      if (!inBlockquote) {
        out.push("<blockquote>");
        inBlockquote = true;
      }
      out.push(`<p>${escapeHtmlInline(quote[1])}</p>`);
    } else if (line === "---") {
      flushList();
      flushQuote();
      out.push("<hr/>");
    } else {
      flushList();
      flushQuote();
      out.push(`<p>${escapeHtmlInline(line)}</p>`);
    }
  }
  flushList();
  flushQuote();
  return out.join("\n");
}

// HTML 内に注入されるテキストの inline 強調変換 + escape
function escapeHtmlInline(text: string): string {
  let s = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // **bold**
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return s;
}

function buildAtomXml(
  input: PostArticleInput,
  contentType: "text/x-markdown" | "text/html",
): string {
  const { title, bodyMarkdown, tags = [], draft = false, imageUrl } = input;
  const bodyPrefix = imageUrl
    ? contentType === "text/html"
      ? `<p><img src="${imageUrl}" alt=""/></p>\n`
      : `![](${imageUrl})\n\n`
    : "";
  const renderedBody =
    contentType === "text/html"
      ? bodyPrefix + naiveMarkdownToHtml(bodyMarkdown)
      : bodyPrefix + bodyMarkdown;
  const categoryLines = tags
    .filter((t) => t.trim())
    .map((t) => `  <category term="${escapeXml(t)}" />`)
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<entry xmlns="http://www.w3.org/2005/Atom"
       xmlns:app="http://www.w3.org/2007/app">
  <title>${escapeXml(title)}</title>
  <content type="${contentType}">${escapeXml(renderedBody)}</content>
${categoryLines}
  <app:control>
    <app:draft>${draft ? "yes" : "no"}</app:draft>
  </app:control>
</entry>`;
}

export async function postAtomPubEntry(
  config: AtomPubConfig,
  input: PostArticleInput,
): Promise<PostArticleResult> {
  const contentType = config.contentType ?? "text/x-markdown";
  const xml = buildAtomXml(input, contentType);

  const authHeaders: Record<string, string> = {};
  if (config.auth.kind === "wsse") {
    authHeaders["X-WSSE"] = generateWSSE(config.auth.username, config.auth.password);
    authHeaders["Authorization"] = 'WSSE profile="UsernameToken"';
  } else {
    authHeaders["Authorization"] = generateBasic(config.auth.username, config.auth.password);
  }

  try {
    const res = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml",
        ...authHeaders,
      },
      body: xml,
    });
    if (!res.ok) {
      const errText = await res.text();
      return {
        ok: false,
        error: `投稿失敗: HTTP ${res.status} ${errText.slice(0, 400)}`,
      };
    }
    const responseXml = await res.text();
    const linkAlt = responseXml.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/i);
    const linkEdit = responseXml.match(/<link[^>]+rel="edit"[^>]+href="([^"]+)"/i);
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
