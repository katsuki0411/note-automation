import { redirect } from "next/navigation";
import MainShell from "@/components/MainShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  listProjectsForUser,
  getMembershipRole,
  getProjectBySlug,
  type ProjectMembership,
} from "@/lib/projects";
import { headers } from "next/headers";

export default async function MainLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // 認証ユーザー取得 (middleware で /login へ流れているはずだが念のため)
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 所属プロジェクト一覧
  const memberships = await listProjectsForUser(user.id);

  // 0件 → 選択画面で新規作成を促す
  if (memberships.length === 0) {
    redirect("/select-project");
  }

  // 現在の slug を middleware が渡してくれている
  const hdrs = await headers();
  const slug = hdrs.get("x-project-slug") ?? memberships[0].slug;

  // member でない slug を cookie に持っているケース → 選択画面に戻す
  const project = await getProjectBySlug(slug);
  if (!project) {
    redirect("/select-project");
  }
  const role = await getMembershipRole(user.id, project.id);
  if (!role) {
    redirect("/select-project");
  }

  const currentProject: ProjectMembership = {
    ...project,
    role,
  };

  return (
    <MainShell currentProject={currentProject} allProjects={memberships}>
      {children}
    </MainShell>
  );
}
