import { NextRequest } from "next/server";
import { loadArticles, saveArticle, type Article, type Idea } from "@/lib/storage";
import { BRAND, type ThemeTagKey } from "@/lib/brand";
import { attachArticleToKeyword, loadKeywords } from "@/lib/keywords";
import { getDestination } from "@/lib/destinations";
import {
  resolveSystemPrompt,
  extractDestinationStages,
  PROMPT_NOT_CONFIGURED_ERROR,
} from "@/lib/promptResolver";
import {
  DEFAULT_ARTICLE_MODEL,
  generateArticleJsonText,
  generateArticleTextChain,
  isArticleModel,
} from "@/lib/articleGen";
import type { FeedIdea, Keyword, ThemeId } from "@/lib/types";
import { withProjectContext } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

function extractJson(text: string): Record<string, unknown> {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("JSON object not found");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function buildTags(themeId?: ThemeId): string[] {
  const themeKey = themeId as ThemeTagKey | undefined;
  const themeExtra = themeKey && BRAND.themeTags[themeKey] ? BRAND.themeTags[themeKey] : [];
  return [...BRAND.defaultTags, ...themeExtra];
}

async function pickRelatedArticles(
  projectId: string,
  themeId: ThemeId | undefined,
  selfIdeaTitle: string,
  limit = 3,
): Promise<{ title: string; hook?: string }[]> {
  const all = await loadArticles(projectId);
  const sameTheme = all.filter((a) => {
    const aFeed = a.idea as FeedIdea;
    return aFeed?.themeId === themeId && a.bestTitle !== selfIdeaTitle;
  });
  const others = all.filter((a) => {
    const aFeed = a.idea as FeedIdea;
    return aFeed?.themeId !== themeId && a.bestTitle !== selfIdeaTitle;
  });
  const pool = [...sameTheme, ...others].slice(0, limit);
  return pool.map((a) => ({ title: a.bestTitle, hook: a.idea.hook }));
}

async function pickTargetKeyword(
  projectId: string,
  themeId: ThemeId | undefined,
  explicitKwId?: string,
): Promise<Keyword | undefined> {
  const state = await loadKeywords(projectId);
  if (explicitKwId) {
    return state.keywords.find((k) => k.id === explicitKwId);
  }
  const candidates = state.keywords
    .filter((k) => k.themeId === themeId && k.status !== "covered")
    .sort((a, b) => b.priority - a.priority);
  return candidates[0];
}

// destination のプロンプト設定を使うシンプルな user prompt。
// idea / 関連記事 / 狙うキーワード を JSON 風に渡し、destination 側の system プロンプト
// (3段または旧10項目) に沿って AI に出力させる。
function buildUserPrompt(args: {
  idea: Idea | FeedIdea;
  relatedArticles: { title: string; hook?: string }[];
  fixedTags: string[];
  targetKeyword?: { kw: string; intent: string; longTail?: string[] };
}): string {
  const { idea, relatedArticles, fixedTags, targetKeyword } = args;
  const feed = idea as FeedIdea;
  return `
以下のネタで記事を生成してください。

【ネタ】
- タイトル候補: ${idea.title}
- 共感フック: ${idea.hook ?? ""}
- 角度: ${idea.angle ?? ""}
${feed.toolConcept ? `- ツールコンセプト: ${feed.toolConcept}` : ""}
${feed.voice ? `\n【参考となる読者の声】\n> ${feed.voice.quote} (出典: ${feed.voice.platform})\n${feed.voice.context ? `補足: ${feed.voice.context}` : ""}` : ""}

${targetKeyword ? `【狙うキーワード】\n- 主KW: ${targetKeyword.kw}\n- intent: ${targetKeyword.intent}\n${targetKeyword.longTail?.length ? `- ロングテール: ${targetKeyword.longTail.join(" / ")}` : ""}` : ""}

${relatedArticles.length > 0 ? `【同じ著者の関連既存記事 (内部リンクや「合わせて読みたい」の素材に)】\n${relatedArticles.map((a) => `- ${a.title}${a.hook ? ` (${a.hook})` : ""}`).join("\n")}` : ""}

${fixedTags.length > 0 ? `【記事末尾に入れたいタグ候補】\n${fixedTags.map((t) => `#${t}`).join(" ")}` : ""}

【出力フォーマット (JSON のみ)】
{
  "title_candidates": ["候補1", "候補2", "候補3"],
  "best_title": "選んだベストタイトル",
  "best_title_reason": "選んだ理由",
  "body_markdown": "本文 (Markdown)",
  "image_prompt_subject": "見出し画像の被写体・シーン (英語可)",
  "image_alt_text": "alt 文字列"
}
`.trim();
}

export async function POST(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    try {
      const { idea, destinationId, targetKeywordId, model } = (await req.json()) as {
        idea: Idea | FeedIdea;
        destinationId: string;
        targetKeywordId?: string;
        model?: string;
      };
      if (!idea?.title) {
        return Response.json({ error: "ideaが必要です" }, { status: 400 });
      }
      if (!destinationId) {
        return Response.json(
          { error: "destinationId が必要です (記事を作る対象の投稿先)" },
          { status: 400 },
        );
      }

      const destination = await getDestination(ctx.projectId, destinationId);
      if (!destination) {
        return Response.json({ error: "destination が見つかりません" }, { status: 404 });
      }

      // destination の prompt_config からプロンプトを解決。
      // 未設定なら 400 (フォールバックなし)。
      const resolved = resolveSystemPrompt(destination);
      if (!resolved) {
        return Response.json(
          {
            error: PROMPT_NOT_CONFIGURED_ERROR,
            destinationLabel: destination.label,
          },
          { status: 400 },
        );
      }

      const articleModel = isArticleModel(model) ? model : DEFAULT_ARTICLE_MODEL;

      const feed = idea as FeedIdea;
      const fixedTags = buildTags(feed.themeId);
      const relatedArticles = await pickRelatedArticles(ctx.projectId, feed.themeId, idea.title);
      const explicitKwId = targetKeywordId ?? feed.targetKeywordId;
      const targetKw = await pickTargetKeyword(ctx.projectId, feed.themeId, explicitKwId);

      const userPrompt = buildUserPrompt({
        idea,
        relatedArticles,
        fixedTags,
        targetKeyword: targetKw
          ? { kw: targetKw.kw, intent: targetKw.intent, longTail: feed.keywords?.longTail }
          : undefined,
      });

      // 3段プロンプトチェーン: destination.prompt_config.stages のみ参照。
      // stages 未設定なら 1段で systemPrompt + userPrompt で実行。
      const destinationStages = extractDestinationStages(destination);
      const useChain = destinationStages !== null;

      let responseText: string;
      if (useChain && destinationStages) {
        let context = "";
        if (destinationStages[0]?.trim()) {
          context = await generateArticleTextChain({
            model: articleModel,
            system: resolved.systemPrompt,
            user: `${userPrompt}\n\n# 1段目プロンプト\n${destinationStages[0]}`,
          });
        }
        if (destinationStages[1]?.trim()) {
          context = await generateArticleTextChain({
            model: articleModel,
            system: resolved.systemPrompt,
            user: `# 前段の出力\n${context || "(なし)"}\n\n# 2段目プロンプト\n${destinationStages[1]}`,
          });
        }
        const stage3Hint = destinationStages[2]?.trim() ?? "";
        responseText = await generateArticleJsonText({
          model: articleModel,
          system: resolved.systemPrompt,
          user: `# 前段までの出力\n${context || "(なし)"}\n${stage3Hint ? `\n# 3段目プロンプト\n${stage3Hint}\n` : ""}\n# 最終出力指示 (JSON フォーマットに従う)\n${userPrompt}`,
        });
      } else {
        responseText = await generateArticleJsonText({
          model: articleModel,
          system: resolved.systemPrompt,
          user: userPrompt,
        });
      }
      const parsed = extractJson(responseText);

      let body = (parsed.body_markdown as string) ?? "";
      body = body.replace(/^\s*#\s+[^\n]+\n+/, "");

      const article: Article = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        idea,
        titleCandidates: (parsed.title_candidates as string[]) ?? [],
        bestTitle: (parsed.best_title as string) ?? idea.title,
        bestTitleReason: (parsed.best_title_reason as string) ?? "",
        bodyMarkdown: body,
        imagePromptSubject: (parsed.image_prompt_subject as string) ?? "",
        imageAltText: (parsed.image_alt_text as string) ?? "",
        destinationId,
      };

      await saveArticle(ctx.projectId, ctx.userId, article);

      if (targetKw) {
        await attachArticleToKeyword(ctx.projectId, targetKw.id, article.id);
      }

      return Response.json({
        article,
        targetKeyword: targetKw,
        chainSource: useChain ? "destination" : "none",
      });
    } catch (e) {
      console.error("[/api/generate] failed:", e);
      if (e instanceof Error && e.stack) {
        console.error("[/api/generate] stack:", e.stack);
      }
      const message = e instanceof Error ? e.message : "unknown error";
      const stack = e instanceof Error ? e.stack : undefined;
      return Response.json(
        { error: message, stack },
        { status: 500 },
      );
    }
  });
}
