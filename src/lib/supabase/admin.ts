import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

// Service Role キーで動く管理者クライアント。
// RLS を素通りするので Server (Route Handler / Server Action) でのみ使う。
// ブラウザ側から import しないこと。
export function supabaseAdmin(): SupabaseClient {
  if (_client) return _client;
  // Vercel 環境変数に改行が混入していると HTTP ヘッダ不正で死ぬので除去する
  const url = process.env.SUPABASE_URL?.replace(/\s+/g, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.replace(/\s+/g, "");
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定");
  }
  _client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}
