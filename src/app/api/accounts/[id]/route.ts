import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteSubAccount, isMasterEmail } from "@/lib/subAccounts";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isMasterEmail(user.email)) {
    return Response.json(
      { error: "マスターのみ削除可能です" },
      { status: 403 },
    );
  }
  try {
    const { id } = await params;
    await deleteSubAccount(user.id, id);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "失敗" },
      { status: 400 },
    );
  }
}
