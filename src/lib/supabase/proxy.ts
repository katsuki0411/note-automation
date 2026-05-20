import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Next.js 16 proxy 用のセッション同期 + 認可ガード + プロジェクトslug 抽出
// - Supabase の session cookie をリクエストとレスポンスで同期させる（トークン期限切れ更新含む）
// - 未認証なら /login にリダイレクト
// - 認証済みで /login に来たら / にリダイレクト
// - URL から /p/<slug>/... の slug を抽出して x-project-slug ヘッダで下流に渡す
//   (slug 無しのトップやログイン経由は default 'syuhu')
export async function updateSessionAndGate(request: NextRequest) {
  // ===== プロジェクト slug 抽出 =====
  // /p/<slug>/...  形式を解釈する。これ以外のパスは default 'syuhu' とする
  // (Phase 2 移行期は全ページ slug 無しでもアクセスできるように後方互換)
  const path = request.nextUrl.pathname;
  const slugMatch = path.match(/^\/p\/([a-z0-9_-]+)(\/|$)/i);
  const projectSlug = slugMatch ? slugMatch[1] : "syuhu";

  // ヘッダにセットして downstream の Server Component / Route Handler から見えるようにする
  const headersWithProject = new Headers(request.headers);
  headersWithProject.set("x-project-slug", projectSlug);

  let response = NextResponse.next({
    request: { headers: headersWithProject },
  });

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
