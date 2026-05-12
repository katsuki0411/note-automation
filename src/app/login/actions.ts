"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type LoginState = { error?: string } | undefined;

export async function login(_state: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/") || "/";

  if (!email || !password) {
    return { error: "メールとパスワードを入力してください" };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: error.message };
  }

  // next が外部URLや絶対URLにすり替えられないよう、相対パスに限定
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  redirect(safeNext);
}

export async function logout() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
