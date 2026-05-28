import "server-only";
import { refreshAccessToken } from "@/lib/oauth/google-blogger";
import { updateDestination } from "@/lib/destinations";
import type { PostArticleInput, PostArticleResult } from "./types";

// Blogger API v3 投稿アダプタ。
// destination.config に accessToken / refreshToken / tokenExpiresAt を保存し、
// 期限切れ時は refresh_token で自動更新 → DB に上書き保存する。
// docs: https://developers.google.com/blogger/docs/3.0/using

export type BloggerConfig = {
  blogId: string;
  blogName?: string;
  blogUrl?: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number; // epoch ms
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Markdown → HTML の最低限変換 (Blogger は HTML 投稿のみ)
// h2/h3 見出し / 段落 / 画像 / 改行のみサポート (本ツールの生成物は概ねこの範囲に収まる)
function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inPara = false;
  const closePara = () => {
    if (inPara) {
      out.push("</p>");
      inPara = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#{2,3}\s+/.test(line)) {
      closePara();
      const level = (line.match(/^(#+)/)![1] ?? "##").length;
      const text = line.replace(/^#+\s+/, "");
      out.push(`<h${level}>${escapeHtml(text)}</h${level}>`);
    } else if (/^!\[[^\]]*\]\(([^)]+)\)\s*$/.test(line)) {
      closePara();
      const m = line.match(/^!\[[^\]]*\]\(([^)]+)\)\s*$/)!;
      out.push(`<p><img src="${escapeHtml(m[1])}" alt="" /></p>`);
    } else if (line === "") {
      closePara();
    } else {
      if (!inPara) {
        out.push("<p>");
        inPara = true;
      } else {
        out.push("<br />");
      }
      out.push(escapeHtml(line));
    }
  }
  closePara();
  return out.join("\n");
}

// access_token が期限切れ間近なら refresh_token で更新し、DB にも保存
async function ensureFreshToken(
  config: BloggerConfig,
  projectId: string,
  destinationId: string,
): Promise<{ token: string; config: BloggerConfig }> {
  const now = Date.now();
  if (config.tokenExpiresAt > now + 60_000 && config.accessToken) {
    return { token: config.accessToken, config };
  }
  const fresh = await refreshAccessToken(config.refreshToken);
  const next: BloggerConfig = {
    ...config,
    accessToken: fresh.access_token,
    tokenExpiresAt: now + fresh.expires_in * 1000,
    // Google が refresh_token を再発行しないケースもあるので、無い時は既存を維持
    refreshToken: fresh.refresh_token ?? config.refreshToken,
  };
  await updateDestination(projectId, destinationId, {
    config: next as unknown as Record<string, unknown>,
  });
  return { token: fresh.access_token, config: next };
}

export async function postToBlogger(
  config: BloggerConfig,
  input: PostArticleInput,
  ctx: { projectId: string; destinationId: string },
): Promise<PostArticleResult> {
  if (!config.blogId || !config.refreshToken) {
    return {
      ok: false,
      error: "未連携です — 設定 → 投稿先で「Google で連携」を実行してください",
    };
  }
  try {
    const { token } = await ensureFreshToken(config, ctx.projectId, ctx.destinationId);
    const html = input.imageUrl
      ? `<p><img src="${escapeHtml(input.imageUrl)}" alt="" /></p>\n${markdownToHtml(input.bodyMarkdown)}`
      : markdownToHtml(input.bodyMarkdown);

    const url = new URL(
      `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(
        config.blogId,
      )}/posts/`,
    );
    if (input.draft) url.searchParams.set("isDraft", "true");

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        kind: "blogger#post",
        title: input.title,
        content: html,
        labels: input.tags ?? [],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return {
        ok: false,
        error: `Blogger 投稿失敗: HTTP ${res.status} ${errText.slice(0, 400)}`,
      };
    }
    const data = (await res.json()) as { url?: string; id?: string };
    return { ok: true, url: data.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// 接続確認用: blogs.get で対象 blog にアクセス可能か確認 (token refresh の動作確認も兼ねる)
export async function testBloggerConnection(
  config: BloggerConfig,
  ctx: { projectId: string; destinationId: string },
): Promise<{ ok: boolean; error?: string; note?: string }> {
  if (!config.blogId || !config.refreshToken) {
    return {
      ok: false,
      error: "未連携 — 「Google で連携」ボタンから OAuth 連携してください",
    };
  }
  try {
    const { token } = await ensureFreshToken(config, ctx.projectId, ctx.destinationId);
    const res = await fetch(
      `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(config.blogId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      return {
        ok: false,
        error: `Blogger API 失敗: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as { name?: string; url?: string };
    return {
      ok: true,
      note: `${data.name ?? "ブログ"} (${data.url ?? config.blogId}) に接続OK`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "失敗" };
  }
}
