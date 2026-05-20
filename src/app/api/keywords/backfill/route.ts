import { createKeyword, loadKeywords, normalizeKw, updateKeyword } from "@/lib/keywords";
import { loadArticles } from "@/lib/storage";
import { type FeedIdea, type ThemeId } from "@/lib/types";
import { withProjectContext } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const SUBCATEGORY_HEURISTICS: Record<ThemeId, { id: string; patterns: RegExp }[]> = {
  renraku: [
    { id: "hoikuen", patterns: /(保育園|幼稚園|乳児|保育士|0歳|1歳|2歳|3歳|未就学)/i },
    { id: "gakkou", patterns: /(小学校|中学校|高校|学校|学級|担任|連絡帳|登校|集団)/i },
    { id: "iryou", patterns: /(小児科|歯医者|病院|医者|診察|予防接種|薬)/i },
    { id: "naraigoto", patterns: /(習い事|ピアノ|スイミング|英会話|塾|レッスン)/i },
  ],
  schedule: [
    { id: "family_calendar", patterns: /(カレンダー|予定共有|スケジュール|予定表)/i },
    { id: "soumukai", patterns: /(送迎|送り迎え|お迎え|車|徒歩|駐車場)/i },
    { id: "gyouji", patterns: /(行事|運動会|参観|発表会|遠足)/i },
  ],
  paperwork: [
    { id: "otayori", patterns: /(プリント|お便り|連絡帳|配布物)/i },
    { id: "pta", patterns: /(PTA|保護者会|役員|委員)/i },
    { id: "teishutsu", patterns: /(提出|申請|書類|サイン)/i },
  ],
  money: [
    { id: "kakeibo", patterns: /(家計簿|支出|予算|管理)/i },
    { id: "receipt", patterns: /(レシート|領収書)/i },
    { id: "poikatsu", patterns: /(ポイ活|ポイント|節約)/i },
    { id: "furusato", patterns: /(ふるさと納税|寄付|返礼品|医療費控除)/i },
  ],
  custom: [],
};

function detectSubcategory(themeId: ThemeId, text: string): string {
  const heuristics = SUBCATEGORY_HEURISTICS[themeId] ?? [];
  for (const h of heuristics) {
    if (h.patterns.test(text)) return h.id;
  }
  return "other";
}

export async function POST() {
  return withProjectContext(async (ctx) => {
    try {
      const articles = await loadArticles(ctx.projectId);
      const beforeState = await loadKeywords(ctx.projectId);
      const beforeCount = beforeState.keywords.length;

      let added = 0;
      let attached = 0;

      for (const article of articles) {
        const feedIdea = article.idea as FeedIdea;
        const themeId: ThemeId = feedIdea.themeId ?? "custom";
        const kwData = feedIdea.keywords;
        if (!kwData) continue;

        const allKws: { kw: string; isPrimary: boolean }[] = [
          { kw: kwData.primary, isPrimary: true },
          ...(kwData.secondary ?? []).map((s) => ({ kw: s, isPrimary: false })),
        ];
        const articleText = `${article.bestTitle}\n${kwData.primary}\n${(kwData.secondary ?? []).join(" ")}`;
        const subcategoryId = detectSubcategory(themeId, articleText);

        for (const { kw, isPrimary } of allKws) {
          if (!kw) continue;
          const trimmed = kw.trim();
          if (!trimmed) continue;
          const current = await loadKeywords(ctx.projectId);
          const dup = current.keywords.find(
            (k) => normalizeKw(k.kw) === normalizeKw(trimmed) && k.themeId === themeId,
          );
          if (dup) {
            if (!dup.articleIds.includes(article.id)) {
              await updateKeyword(ctx.projectId, dup.id, {
                articleIds: [...dup.articleIds, article.id],
                status: "covered",
              });
              attached++;
            }
          } else {
            await createKeyword(ctx.projectId, ctx.userId, {
              themeId,
              subcategoryId,
              kw: trimmed,
              intent: "trouble",
              vol: feedIdea.impression?.monthlySearchVolume ?? "medium",
              comp: feedIdea.impression?.competitionLevel ?? "medium",
              priority: isPrimary ? 80 : 60,
              status: "covered",
              articleIds: [article.id],
              memo: `自動投入（記事: ${article.bestTitle.slice(0, 30)}）`,
            });
            added++;
          }
        }
      }

      const afterState = await loadKeywords(ctx.projectId);
      return Response.json({
        processedArticles: articles.length,
        added,
        attached,
        beforeCount,
        afterCount: afterState.keywords.length,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: msg }, { status: 500 });
    }
  });
}
