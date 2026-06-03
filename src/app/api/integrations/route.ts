import { NextRequest } from "next/server";
import { withProjectContext } from "@/lib/auth";
import {
  listProjectIntegrations,
  listUserIntegrations,
  upsertProjectIntegration,
  upsertUserIntegration,
  type ProjectIntegrationKind,
  type UserIntegrationKind,
} from "@/lib/integrations";

export const runtime = "nodejs";

// GET /api/integrations
// 現プロジェクト + ログインユーザーの全 integration を一括返却
export async function GET() {
  return withProjectContext(async (ctx) => {
    const [project, user] = await Promise.all([
      listProjectIntegrations(ctx.projectId),
      listUserIntegrations(ctx.userId),
    ]);
    return Response.json({ project, user });
  });
}

// POST /api/integrations
// body: { scope: "project" | "user", kind: string, config: object, enabled?: boolean }
export async function POST(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    const body = (await req.json().catch(() => ({}))) as {
      scope?: "project" | "user";
      kind?: string;
      config?: Record<string, unknown>;
      enabled?: boolean;
    };

    if (!body.scope || !body.kind || typeof body.config !== "object") {
      return Response.json(
        { error: "scope / kind / config が必要です" },
        { status: 400 },
      );
    }

    if (body.scope === "project") {
      const projectKinds: ProjectIntegrationKind[] = ["amazon_associate", "a8_net"];
      if (!projectKinds.includes(body.kind as ProjectIntegrationKind)) {
        return Response.json({ error: `不正な kind: ${body.kind}` }, { status: 400 });
      }
      await upsertProjectIntegration(
        ctx.projectId,
        body.kind as ProjectIntegrationKind,
        body.config ?? {},
        body.enabled ?? true,
      );
    } else if (body.scope === "user") {
      const userKinds: UserIntegrationKind[] = [
        "gemini",
        "claude",
        "ahrefs",
        "dataforseo",
      ];
      if (!userKinds.includes(body.kind as UserIntegrationKind)) {
        return Response.json({ error: `不正な kind: ${body.kind}` }, { status: 400 });
      }
      await upsertUserIntegration(
        ctx.userId,
        body.kind as UserIntegrationKind,
        body.config ?? {},
        body.enabled ?? true,
      );
    } else {
      return Response.json({ error: "scope は project | user" }, { status: 400 });
    }

    return Response.json({ ok: true });
  });
}
