import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server Component / Server Action / Route Handler 用の Supabase クライアント
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY が未設定");
  }
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component で cookies().set が許されない context（読み取り専用）
          // proxy.ts と Server Action 側でセッション更新を行うので無視で問題ない
        }
      },
    },
  });
}
