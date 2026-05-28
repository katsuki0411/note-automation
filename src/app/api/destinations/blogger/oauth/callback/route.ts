import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import {
  exchangeCodeForToken,
  getBloggerRedirectUri,
} from "@/lib/oauth/google-blogger";
import {
  createDestination,
  updateDestination,
  getDestination,
} from "@/lib/destinations";
import type { BloggerConfig } from "@/lib/posters/blogger";

export const runtime = "nodejs";

const COOKIE_NAME = "blogger_oauth_state";

type StateCookie = {
  state: string;
  projectId: string;
  userId: string;
  destinationId?: string;
  label: string;
  returnTo: string;
};

function redirectWithFlash(req: NextRequest, returnTo: string, params: Record<string, string>) {
  const origin = new URL(req.url).origin;
  const u = new URL(returnTo, origin);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, v);
  }
  return Response.redirect(u.toString(), 302);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const c = await cookies();
  const cookieRaw = c.get(COOKIE_NAME)?.value;
  // 検証後は消す (再利用防止)
  c.delete(COOKIE_NAME);

  if (!cookieRaw) {
    return new Response(
      "OAuth セッションが見つかりません (cookie が期限切れ / ブラウザを跨いだ可能性)。設定ページから再度連携してください。",
      { status: 400 },
    );
  }
  let parsed: StateCookie;
  try {
    parsed = JSON.parse(cookieRaw) as StateCookie;
  } catch {
    return new Response("OAuth セッション cookie が壊れています", { status: 400 });
  }
  if (stateParam !== parsed.state) {
    return new Response("CSRF state 検証失敗", { status: 400 });
  }
  if (errorParam) {
    return redirectWithFlash(req, parsed.returnTo, {
      blogger_error: errorParam,
    });
  }
  if (!code) {
    return new Response("code が含まれていません", { status: 400 });
  }

  let token;
  try {
    token = await exchangeCodeForToken(code, getBloggerRedirectUri(req));
  } catch (e) {
    return redirectWithFlash(req, parsed.returnTo, {
      blogger_error: e instanceof Error ? e.message : "token_exchange_failed",
    });
  }

  // blog 一覧取得 → 1個目を採用 (複数 blog 持ちは少数派なので、選択UIは後回し)
  const blogsRes = await fetch(
    "https://www.googleapis.com/blogger/v3/users/self/blogs",
    { headers: { Authorization: `Bearer ${token.access_token}` } },
  );
  if (!blogsRes.ok) {
    return redirectWithFlash(req, parsed.returnTo, {
      blogger_error: `blog 一覧取得失敗: ${blogsRes.status}`,
    });
  }
  const blogsData = (await blogsRes.json()) as {
    items?: Array<{ id: string; name: string; url: string }>;
  };
  const firstBlog = blogsData.items?.[0];
  if (!firstBlog) {
    return redirectWithFlash(req, parsed.returnTo, {
      blogger_error:
        "このGoogleアカウントには Blogger ブログがありません。https://www.blogger.com/ で1つ作成してから再連携してください。",
    });
  }

  // 既存 destination 編集 → refresh_token が新規取得できない場合があるので、既存値を温存
  let config: BloggerConfig = {
    blogId: firstBlog.id,
    blogName: firstBlog.name,
    blogUrl: firstBlog.url,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? "",
    tokenExpiresAt: Date.now() + token.expires_in * 1000,
  };

  if (parsed.destinationId) {
    const existing = await getDestination(parsed.projectId, parsed.destinationId);
    if (!existing) {
      return redirectWithFlash(req, parsed.returnTo, {
        blogger_error: "対象の destination が見つかりません",
      });
    }
    const oldCfg = existing.config as Partial<BloggerConfig>;
    if (!config.refreshToken && oldCfg.refreshToken) {
      config = { ...config, refreshToken: oldCfg.refreshToken };
    }
    await updateDestination(parsed.projectId, parsed.destinationId, {
      config: config as unknown as Record<string, unknown>,
    });
    return redirectWithFlash(req, parsed.returnTo, {
      blogger_ok: firstBlog.name,
    });
  }

  // 新規: refresh_token が無いとそもそも使い物にならない
  if (!config.refreshToken) {
    return redirectWithFlash(req, parsed.returnTo, {
      blogger_error:
        "refresh_token が取得できませんでした。Google アカウント側でアプリのアクセス権を一度取り消してから再度連携してください (https://myaccount.google.com/permissions)",
    });
  }
  await createDestination(parsed.projectId, parsed.userId, {
    platform: "blogger",
    label: parsed.label,
    config: config as unknown as Record<string, unknown>,
  });
  return redirectWithFlash(req, parsed.returnTo, {
    blogger_ok: firstBlog.name,
  });
}
