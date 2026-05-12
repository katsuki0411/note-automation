// Supabase Auth にユーザーを1人作成する one-shot スクリプト。
// 公開サインアップ画面を作らない方針のため、ここから手動で追加する。
//
// 使い方:
//   npx tsx scripts/create-user.ts <email> <password>
//
// 必須環境変数:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY  ← admin 操作なので絶対公開禁止

import { createClient } from "@supabase/supabase-js";

async function main() {
  const [, , email, password] = process.argv;
  if (!email || !password) {
    console.error("Usage: npx tsx scripts/create-user.ts <email> <password>");
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を .env.local に設定してください");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // 確認メール送らずに即有効化（内部運用なので）
  });

  if (error) {
    console.error("作成失敗:", error.message);
    process.exit(1);
  }

  console.log(`✓ 作成完了: ${data.user?.email} (id=${data.user?.id})`);
}

main();
