import { loadKeywords, updateKeyword } from "@/lib/keywords";
import { loadArticles } from "@/lib/storage";
import { withProjectContext } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  return withProjectContext(async (ctx) => {
    try {
      const articles = await loadArticles(ctx.projectId);
      const state = await loadKeywords(ctx.projectId);
      let attached = 0;
      let stillUntargeted = 0;

      for (const k of state.keywords) {
        const matchedArticleIds = articles
          .filter((a) => a.bodyMarkdown.includes(k.kw) || a.bestTitle.includes(k.kw))
          .map((a) => a.id);
        const patch: Partial<typeof k> = {};
        if (matchedArticleIds.length > 0) {
          const newOnes = matchedArticleIds.filter((id) => !k.articleIds.includes(id));
          if (newOnes.length > 0) {
            patch.articleIds = [...k.articleIds, ...newOnes];
            attached += newOnes.length;
          }
          patch.status = "covered";
        } else {
          if (k.status === "covered") patch.status = "untargeted";
          stillUntargeted++;
        }
        if (Object.keys(patch).length > 0) {
          await updateKeyword(ctx.projectId, k.id, patch);
        }
      }

      return Response.json({
        processedArticles: articles.length,
        processedKeywords: state.keywords.length,
        attached,
        stillUntargeted,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: msg }, { status: 500 });
    }
  });
}
