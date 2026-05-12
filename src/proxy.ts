// Next.js 16 proxy（旧 middleware）。全ページ＋API を Supabase Auth でゲートする。
import type { NextRequest } from "next/server";
import { updateSessionAndGate } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSessionAndGate(request);
}

export const config = {
  // 静的アセット・Next 内部・generated-images を除外して、それ以外（page / api）を全てゲート
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|generated-images|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.svg$|.*\\.ico$).*)",
  ],
};
