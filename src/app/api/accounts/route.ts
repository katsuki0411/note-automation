import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createSubAccount,
  isMasterEmail,
  listSubAccounts,
} from "@/lib/subAccounts";

export const runtime = "nodejs";

async function requireMaster() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false as const, status: 401, error: "unauthorized" };
  }
  if (!isMasterEmail(user.email)) {
    return {
      ok: false as const,
      status: 403,
      error: "マスター (MASTER_USER_EMAIL) のみが操作可能です",
    };
  }
  return { ok: true as const, userId: user.id, email: user.email };
}

// GET /api/accounts: マスター視点でサブアカウント一覧
export async function GET() {
  const auth = await requireMaster();
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const subs = await listSubAccounts(auth.userId);
  return Response.json({ subAccounts: subs, master: { email: auth.email } });
}

// POST /api/accounts: サブアカウント新規作成
// body: { email: string, password: string }
export async function POST(req: NextRequest) {
  const auth = await requireMaster();
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
    };
    if (!body.email || !body.password) {
      return Response.json({ error: "email / password が必要です" }, { status: 400 });
    }
    const result = await createSubAccount(auth.userId, {
      email: body.email,
      password: body.password,
    });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "失敗" },
      { status: 400 },
    );
  }
}
