import "server-only";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "./supabase/server";
import { sql } from "./db";

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export type ProjectContext = {
  userId: string;
  email: string | null;
  projectId: string;
  slug: string;
  displayName: string;
  role: "owner" | "editor" | "viewer";
};

// 現在のリクエストの認証ユーザー + プロジェクトコンテキストを取得する。
// - 未ログインなら UnauthorizedError
// - slug の project に member でないなら ForbiddenError
// API route / Server Component / Server Action から呼ぶ。
export async function requireProjectContext(): Promise<ProjectContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new UnauthorizedError();

  // proxy.ts で立てた x-project-slug ヘッダから現在のプロジェクトを取得
  const hdrs = await headers();
  const slug = hdrs.get("x-project-slug") ?? "syuhu";

  const rows = await sql<
    { project_id: string; display_name: string; role: string }[]
  >`
    select pm.project_id, p.display_name, pm.role
    from project_members pm
    join projects p on p.id = pm.project_id
    where pm.user_id = ${user.id} and p.slug = ${slug}
    limit 1
  `;
  if (rows.length === 0) {
    throw new ForbiddenError(
      `user ${user.email ?? user.id} is not a member of project '${slug}'`,
    );
  }
  const r = rows[0];
  return {
    userId: user.id,
    email: user.email ?? null,
    projectId: r.project_id,
    slug,
    displayName: r.display_name,
    role: r.role as ProjectContext["role"],
  };
}

// API route 用: requireProjectContext の例外を JSON Response に変換するラッパー
export async function withProjectContext<T>(
  handler: (ctx: ProjectContext) => Promise<T>,
): Promise<T | Response> {
  try {
    const ctx = await requireProjectContext();
    return await handler(ctx);
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    if (e instanceof ForbiddenError) {
      return Response.json({ error: "forbidden", detail: e.message }, { status: 403 });
    }
    throw e;
  }
}
