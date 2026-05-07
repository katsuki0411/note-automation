import { loadKeywords, saveKeywords } from "@/lib/keywords";
import { loadArticles } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    const articles = await loadArticles();
    const state = await loadKeywords();
    let attached = 0;
    let stillUntargeted = 0;

    for (const k of state.keywords) {
      const matchedArticleIds = articles
        .filter((a) => a.bodyMarkdown.includes(k.kw) || a.bestTitle.includes(k.kw))
        .map((a) => a.id);
      if (matchedArticleIds.length > 0) {
        const newOnes = matchedArticleIds.filter((id) => !k.articleIds.includes(id));
        if (newOnes.length > 0) {
          k.articleIds = [...k.articleIds, ...newOnes];
          attached += newOnes.length;
        }
        k.status = "covered";
      } else {
        if (k.status === "covered") k.status = "untargeted";
        stillUntargeted++;
      }
      k.updatedAt = new Date().toISOString();
    }

    await saveKeywords(state);
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
}
