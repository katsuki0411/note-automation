import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// 現在のプロジェクト slug を保持する cookie 名 (httpOnly でない通常cookie)
const PROJECT_COOKIE = "project-slug";

// Next.js 16 proxy 用のセッション同期 + 認可ガード + プロジェクトslug 解決
// 優先順位:
//   1. URL パス /p/<slug>/... の slug
//   2. cookie 'project-slug'
//   3. default 'syuhu' (Phase 2 後方互換)
// 抽出した slug は x-project-slug ヘッダで下流に渡す。
export async function updateSessionAndGate(request: NextRequest) {
  const path = request.nextUrl.pathname;

  const slugFromPath = path.match(/^\/p\/([a-z0-9_-]+)(\/|$)/i)?.[1];
  const slugFromCookie = request.cookies.get(PROJECT_COOKIE)?.value;
  const projectSlug = slugFromPath ?? slugFromCookie ?? "syuhu";

  const headersWithProject = new Headers(request.headers);
  headersWithProject.set("x-project-slug", projectSlug);

  let response = NextResponse.next({
    request: { headers: headersWithProject },
  });

  // URL に slug が含まれていた場合、cookie を同期して次回のクッキー優先解決が一致するようにする
  if (slugFromPath && slugFromPath !== slugFromCookie) {
    response.cookies.set(PROJECT_COOKIE, slugFromPath, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return response;
  }

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({
          request: { headers: headersWithProject },
        });
        // URL → cookie 同期も再付与
        if (slugFromPath && slugFromPath !== slugFromCookie) {
          response.cookies.set(PROJECT_COOKIE, slugFromPath, {
            path: "/",
            sameSite: "lax",
            maxAge: 60 * 60 * 24 * 365,
          });
        }
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoginPath = path === "/login" || path.startsWith("/login/");
  const isApiPath = path.startsWith("/api/");

  if (!user && !isLoginPath) {
    if (isApiPath) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }

  if (user && isLoginPath) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  return response;
}
