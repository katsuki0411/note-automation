import { NextRequest } from "next/server";
import { ARTICLE_SYSTEM, ARTICLE_USER } from "@/lib/prompts";
import { loadArticles, saveArticle, type Article, type Idea } from "@/lib/storage";
import { BRAND, getCtaConfig, MID_ENGAGE_CTA, type ThemeTagKey } from "@/lib/brand";
import { attachArticleToKeyword, loadKeywords } from "@/lib/keywords";
import {
  DEFAULT_ARTICLE_MODEL,
  generateArticleJsonText,
  isArticleModel,
} from "@/lib/articleGen";
import type { FeedIdea, Keyword, ThemeId } from "@/lib/types";

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
  themeId: ThemeId | undefined,
  selfIdeaTitle: string,
  limit = 3,
): Promise<{ title: string; hook?: string }[]> {
  const all = await loadArticles();
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
  themeId: ThemeId | undefined,
  explicitKwId?: string,
): Promise<Keyword | undefined> {
  const state = await loadKeywords();
  if (explicitKwId) {
    return state.keywords.find((k) => k.id === explicitKwId);
  }
  const candidates = state.keywords
    .filter((k) => k.themeId === themeId && k.status !== "covered")
    .sort((a, b) => b.priority - a.priority);
  return candidates[0];
}

export async function POST(req: NextRequest) {
  try {
    const { idea, targetKeywordId, model } = (await req.json()) as {
      idea: Idea | FeedIdea;
      targetKeywordId?: string;
      model?: string;
    };
    if (!idea?.title) {
      return Response.json({ error: "ideaが必要です" }, { status: 400 });
    }
    const articleModel = isArticleModel(model) ? model : DEFAULT_ARTICLE_MODEL;

    const feed = idea as FeedIdea;
    const fixedTags = buildTags(feed.themeId);
    const relatedArticles = await pickRelatedArticles(feed.themeId, idea.title);
    const explicitKwId = targetKeywordId ?? feed.targetKeywordId;
    const targetKw = await pickTargetKeyword(feed.themeId, explicitKwId);
    const cta = getCtaConfig();

    const userPrompt = ARTICLE_USER({
      title: idea.title,
      hook: idea.hook,
      angle: idea.angle,
      voice: feed.voice
        ? {
            quote: feed.voice.quote,
            platform: feed.voice.platform,
            context: feed.voice.context,
          }
        : undefined,
      toolConcept: feed.toolConcept,
      relatedArticles,
      fixedTags,
      targetKeyword: targetKw
        ? {
            kw: targetKw.kw,
            intent: targetKw.intent,
            longTail: feed.keywords?.longTail,
          }
        : undefined,
      ctaChannel: cta.channel,
      ctaAction: cta.action,
      ctaHowTo: cta.howToFull,
      ctaButton: cta.buttonMarkdown,
    });

    const responseText = await generateArticleJsonText({
      model: articleModel,
      system: ARTICLE_SYSTEM,
      user: userPrompt,
    });
    const parsed = extractJson(responseText);

    let body = (parsed.body_markdown as string) ?? "";
    // note のタイトル欄に best_title をコピペするため、本文先頭の H1 ("# タイトル") は
    // プロンプトで禁止しているが、AI が含めてしまった場合に備えて剥がす safety net。
    body = body.replace(/^\s*#\s+[^\n]+\n+/, "");
    body = body.replaceAll("---FIXED_AUTHOR_BIO_PLACEHOLDER---", BRAND.authorBio);
    body = body.replaceAll("---MID_ENGAGE_CTA_PLACEHOLDER---", MID_ENGAGE_CTA);
    body = body.replaceAll("{{cta.channel}}", cta.channel);
    body = body.replaceAll("{{cta.action}}", cta.action);
    body = body.replaceAll("{{cta.howToFull}}", cta.howToFull);
    body = body.replaceAll("{{cta.buttonMarkdown}}", cta.buttonMarkdown);

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
    };

    await saveArticle(article);

    // 採用したKWに記事IDを紐付け（covered化）
    if (targetKw) {
      await attachArticleToKeyword(targetKw.id, article.id);
    }

    return Response.json({ article, targetKeyword: targetKw });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
