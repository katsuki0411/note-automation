import { NextRequest } from "next/server";
import { checkAllEnabledAllProjects } from "@/lib/seoRank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel Cron 用エンドポイント。CRON_SECRET 認証で全プロジェクト横断で
// 有効ターゲットを順位チェックする。認証ユーザーコンテキストは無い。
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  try {
    const summary = await checkAllEnabledAllProjects();
    return Response.json({ ok: true, ...summary, ranAt: new Date().toISOString() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: msg }, { status: 500 });
  }
}
