import { NextRequest } from "next/server";
import { withProjectContext } from "@/lib/auth";
import {
  listAuthorPersonas,
  createAuthorPersona,
  type AuthorPersonaFields,
} from "@/lib/authorPersonas";

export const runtime = "nodejs";

// GET /api/personas — 執筆者ペルソナ一覧 (project内)
export async function GET() {
  return withProjectContext(async (ctx) => {
    try {
      const personas = await listAuthorPersonas(ctx.projectId);
      return Response.json({ personas });
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}

// POST /api/personas — ペルソナ新規作成
export async function POST(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    try {
      const { name, fields, body } = (await req.json()) as {
        name?: string;
        fields?: AuthorPersonaFields;
        body?: string;
      };
      if (!name?.trim()) {
        return Response.json({ error: "ペルソナ名が必要です" }, { status: 400 });
      }
      const persona = await createAuthorPersona(ctx.projectId, ctx.userId, {
        name: name.trim(),
        fields: fields ?? {},
        body: body ?? "",
      });
      return Response.json({ persona });
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
