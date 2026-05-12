import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Next.js 16 proxy 用のセッション同期 + 認可ガード
// - Supabase の session cookie をリクエストとレスポンスで同期させる（トークン期限切れ更新含む）
// - 未認証なら /login にリダイレクト
// - 認証済みで /login に来たら / にリダイレクト
export async function updateSessionAndGate(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    // env 未設定時はゲート不可なのでとりあえず通す（dev でハマらないように）
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
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isLoginPath = path === "/login" || path.startsWith("/login/");
  const isApiPath = path.startsWith("/api/");

  if (!user && !isLoginPath) {
    if (isApiPath) {
      // API は redirect ではなく 401 を返す（フロント側で 401 を見て /login へ誘導できる）
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
