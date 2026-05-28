import "server-only";

// Google OAuth2 + Blogger API v3 ユーティリティ。
// アプリ側で1つの OAuth クライアントを保持し、ユーザーは「Google で連携」ボタンだけで完結。
// 環境変数: GOOGLE_BLOGGER_CLIENT_ID / GOOGLE_BLOGGER_CLIENT_SECRET / APP_BASE_URL (任意)

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const BLOGGER_SCOPE = "https://www.googleapis.com/auth/blogger";

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // seconds
  scope: string;
  token_type: "Bearer";
};

function getCreds(): { id: string; secret: string } {
  const id = process.env.GOOGLE_BLOGGER_CLIENT_ID;
  const secret = process.env.GOOGLE_BLOGGER_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "GOOGLE_BLOGGER_CLIENT_ID / GOOGLE_BLOGGER_CLIENT_SECRET が未設定です",
    );
  }
  return { id, secret };
}

// callback URL は APP_BASE_URL を優先 (Vercel 本番では設定必須)、
// なければリクエストの origin を使う (localhost 開発時の便利機能)
export function getBloggerRedirectUri(req: Request): string {
  const envBase = process.env.APP_BASE_URL?.replace(/\/+$/, "");
  if (envBase) return `${envBase}/api/destinations/blogger/oauth/callback`;
  const u = new URL(req.url);
  return `${u.origin}/api/destinations/blogger/oauth/callback`;
}

export function buildAuthUrl(state: string, redirectUri: string): string {
  const { id } = getCreds();
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: BLOGGER_SCOPE,
    access_type: "offline",
    prompt: "consent", // refresh_token を毎回確実に得るために必須
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const { id, secret } = getCreds();
  const body = new URLSearchParams({
    code,
    client_id: id,
    client_secret: secret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<TokenResponse> {
  const { id, secret } = getCreds();
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: id,
    client_secret: secret,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Refresh failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}
