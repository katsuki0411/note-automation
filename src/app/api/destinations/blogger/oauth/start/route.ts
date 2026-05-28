import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { withProjectContext } from "@/lib/auth";
import {
  buildAuthUrl,
  getBloggerRedirectUri,
} from "@/lib/oauth/google-blogger";

export const runtime = "nodejs";

const COOKIE_NAME = "blogger_oauth_state";
const COOKIE_TTL_SEC = 600; // 10分

// GET /api/destinations/blogger/oauth/start?destinationId=...&label=...&returnTo=/settings
// - destinationId 指定なし: 新規 destination を作る (callback で createDestination)
// - destinationId 指定あり: 既存 destination を再連携 (callback で updateDestination)
export async function GET(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    const url = new URL(req.url);
    const destinationId = url.searchParams.get("destinationId") ?? undefined;
    const label =
      url.searchParams.get("label")?.slice(0, 100) ?? "Bloggerブログ";
    const returnTo = url.searchParams.get("returnTo") ?? "/settings";

    const state = crypto.randomBytes(16).toString("hex");
    const cookieValue = JSON.stringify({
      state,
      projectId: ctx.projectId,
      userId: ctx.userId,
      destinationId,
      label,
      returnTo,
    });
    const c = await cookies();
    c.set(COOKIE_NAME, cookieValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: COOKIE_TTL_SEC,
      path: "/",
    });

    const authUrl = buildAuthUrl(state, getBloggerRedirectUri(req));
    return Response.redirect(authUrl, 302);
  });
}
