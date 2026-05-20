import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  deleteProject,
  getMembershipRole,
  updateProject,
  type ProjectPersonaConfig,
} from "@/lib/projects";

export const runtime = "nodejs";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const user = await requireUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const role = await getMembershipRole(user.id, id);
  if (role !== "owner") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const patch = (await req.json()) as {
      displayName?: string;
      personaConfig?: ProjectPersonaConfig;
    };
    const updated = await updateProject(id, patch);
    if (!updated) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ project: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const user = await requireUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const role = await getMembershipRole(user.id, id);
  if (role !== "owner") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    await deleteProject(id);
    return Response.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: msg }, { status: 500 });
  }
}
