import { NextRequest } from "next/server";
import { withProjectContext } from "@/lib/auth";
import { updateArticleContent } from "@/lib/storage";

export const runtime = "nodejs";

// PATCH /api/articles/[id]
// body: { bodyMarkdown?: string; bestTitle?: string }
// マルチポストモーダルの「本文編集」等から呼ばれる手動編集用エンドポイント。
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withProjectContext(async (ctx) => {
    try {
      const { id } = await params;
      if (!id) {
        return Response.json({ error: "id が必要です" }, { status: 400 });
      }
      const body = (await req.json()) as {
        bodyMarkdown?: string;
        bestTitle?: string;
      };

      const updated = await updateArticleContent(ctx.projectId, id, {
        bodyMarkdown: body.bodyMarkdown,
        bestTitle: body.bestTitle,
      });

      if (!updated) {
        return Response.json(
          { error: "更新対象がない、または該当記事が見つかりません" },
          { status: 404 },
        );
      }
      return Response.json({ ok: true, article: updated });
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown error";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
