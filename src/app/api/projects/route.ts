import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createProject,
  listProjectsForUser,
  type ProjectPersonaConfig,
} from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// このルートは project 未選択でも叩ける必要があるため、
// withProjectContext は使わず素の auth.getUser() で済ます。

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await requireUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const projects = await listProjectsForUser(user.id);
  return Response.json({ projects });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = (await req.json()) as {
      slug?: string;
      displayName?: string;
      personaConfig?: ProjectPersonaConfig;
    };
    if (!body?.slug || !body?.displayName) {
      return Response.json(
        { error: "slug と displayName は必須です" },
        { status: 400 },
      );
    }
    const project = await createProject(user.id, {
      slug: body.slug,
      displayName: body.displayName,
      personaConfig: body.personaConfig,
    });
    return Response.json({ project });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: msg }, { status: 400 });
  }
}
