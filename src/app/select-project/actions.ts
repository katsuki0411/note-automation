"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getMembershipRole, getProjectBySlug } from "@/lib/projects";
import type { ProjectKind } from "@/lib/projects-types";

const PROJECT_COOKIE = "project-slug";

// kind 別の初期ランディングページを返す
function landingPathForKind(kind: ProjectKind): string {
  switch (kind) {
    case "amazon_affiliate":
    case "a8_affiliate":
      return "/bestsellers";
    case "research_based":
    default:
      return "/";
  }
}

// クライアントから「このプロジェクトを使う」を選んだ時に呼ばれる Server Action。
// member 認可チェック後に cookie をセットして kind 別の初期画面へ redirect。
export async function selectProject(slug: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const project = await getProjectBySlug(slug);
  if (!project) {
    throw new Error(`プロジェクト '${slug}' が見つかりません`);
  }
  const role = await getMembershipRole(user.id, project.id);
  if (!role) {
    throw new Error(`このプロジェクトのメンバーではありません`);
  }

  const cookieStore = await cookies();
  cookieStore.set(PROJECT_COOKIE, slug, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect(landingPathForKind(project.kind));
}
