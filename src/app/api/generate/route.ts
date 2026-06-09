import { NextRequest } from "next/server";
import { ARTICLE_USER } from "@/lib/prompts";
import { loadArticles, saveArticle, type Article, type Idea } from "@/lib/storage";
import { BRAND, getCtaConfig, MID_ENGAGE_CTA, type ThemeTagKey } from "@/lib/brand";
import { attachArticleToKeyword, loadKeywords } from "@/lib/keywords";
import { getDestination } from "@/lib/destinations";
import {
  resolveSystemPrompt,
  PROMPT_NOT_CONFIGURED_ERROR,
} from "@/lib/promptResolver";
import {
  DEFAULT_ARTICLE_MODEL,
  generateArticleJsonText,
  generateArticleTextChain,
  isArticleModel,
} from "@/lib/articleGen";
import { loadArticleGenConfig } from "@/lib/projectConfigs";
import type { FeedIdea, Keyword, ThemeId } from "@/lib/types";
import { withProjectContext } from "@/lib/auth";
import { sql } from "@/lib/db";
import type { ProjectKind, ProjectPersonaConfig } from "@/lib/projects";

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

// カスタムプロンプト用のシンプルな user prompt。
// idea / 関連記事 / 狙うキーワード を JSON 風に渡し、AI に system プロンプトに沿って
// 出力させる。主婦テンプレ専用の CTA / BRAND placeholder は使わない。
function buildCustomUserPrompt(args: {
  idea: Idea | FeedIdea;
  relatedArticles: { title: string; hook?: string }[];
  fixedTags: string[];
  targetKeyword?: { kw: string; intent: string; longTail?: string[] };
}): string {
  const { idea, relatedArticles, fixedTags, targetKeyword } = args;
  const feed = idea as FeedIdea;
  return `
以下のネタで note 記事を生成してください。

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

      // destination と project の persona を取得
      const destination = await getDestination(ctx.projectId, destinationId);
      if (!destination) {
        return Response.json({ error: "destination が見つかりません" }, { status: 404 });
      }
      const projectRow = await sql<
        { kind: ProjectKind; persona_config: ProjectPersonaConfig }[]
      >`select kind, persona_config from projects where id = ${ctx.projectId} limit 1`;
      const projectMeta = {
        kind: projectRow[0]?.kind ?? "research_based",
        personaConfig: projectRow[0]?.persona_config ?? {},
      };

      // プロンプト解決: カスタム or housewife-default or null
      const resolved = resolveSystemPrompt(destination, projectMeta);
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

      // user prompt の組み立て: 主婦デフォルトはレガシー ARTICLE_USER (CTA placeholder 等を含む)、
      // カスタムはシンプルな buildCustomUserPrompt を使う
      let userPrompt: string;
      if (resolved.source === "housewife-default") {
        const cta = getCtaConfig();
        userPrompt = ARTICLE_USER({
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
            ? { kw: targetKw.kw, intent: targetKw.intent, longTail: feed.keywords?.longTail }
            : undefined,
          ctaChannel: cta.channel,
          ctaAction: cta.action,
          ctaHowTo: cta.howToFull,
          ctaButton: cta.buttonMarkdown,
        });
      } else {
        userPrompt = buildCustomUserPrompt({
          idea,
          relatedArticles,
          fixedTags,
          targetKeyword: targetKw
            ? { kw: targetKw.kw, intent: targetKw.intent, longTail: feed.keywords?.longTail }
            : undefined,
        });
      }

      // 3段プロンプトチェーン: article_gen_config.prompts が設定されていれば段階生成
      //  (MTG 2026-06-07 決定: 「3回プロンプトに噛ませて、記事の精度をあげる」)
      // 各段の動作:
      //  - 1段目: prompts[0] を user prompt 末尾に付与 → text 出力 (中間)
      //  - 2段目: 1段目出力 + prompts[1] → text 出力 (中間)
      //  - 3段目: 2段目出力 + prompts[2] + 既存 userPrompt → JSON 出力 (最終 article)
      // prompts のいずれも空 → 従来通り1段で JSON 生成
      const articleGenConfig = await loadArticleGenConfig(ctx.projectId);
      const chainPrompts = articleGenConfig.prompts ?? ["", "", ""];
      const useChain = chainPrompts.some((p) => p && p.trim().length > 0);

      let responseText: string;
      if (useChain) {
        let context = "";
        // Stage 1 (空ならスキップ)
        if (chainPrompts[0]?.trim()) {
          context = await generateArticleTextChain({
            model: articleModel,
            system: resolved.systemPrompt,
            user: `${userPrompt}\n\n# 1段目プロンプト\n${chainPrompts[0]}`,
          });
        }
        // Stage 2 (空ならスキップ)
        if (chainPrompts[1]?.trim()) {
          context = await generateArticleTextChain({
            model: articleModel,
            system: resolved.systemPrompt,
            user: `# 前段の出力\n${context || "(なし)"}\n\n# 2段目プロンプト\n${chainPrompts[1]}`,
          });
        }
        // Stage 3 = 最終段。JSON 出力に切替。
        // prompts[2] が空でも、context があれば JSON 化のため最終段を呼ぶ。
        const stage3Hint = chainPrompts[2]?.trim() ?? "";
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
      // 主婦デフォルト時のみ既存 placeholder を埋める
      if (resolved.source === "housewife-default") {
        const cta = getCtaConfig();
        body = body.replaceAll("---FIXED_AUTHOR_BIO_PLACEHOLDER---", BRAND.authorBio);
        body = body.replaceAll("---MID_ENGAGE_CTA_PLACEHOLDER---", MID_ENGAGE_CTA);
        body = body.replaceAll("{{cta.channel}}", cta.channel);
        body = body.replaceAll("{{cta.action}}", cta.action);
        body = body.replaceAll("{{cta.howToFull}}", cta.howToFull);
        body = body.replaceAll("{{cta.buttonMarkdown}}", cta.buttonMarkdown);
      }

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
        destinationId, // どのサイト用に生成された記事かを保存
      };

      await saveArticle(ctx.projectId, ctx.userId, article);

      if (targetKw) {
        await attachArticleToKeyword(ctx.projectId, targetKw.id, article.id);
      }

      return Response.json({
        article,
        targetKeyword: targetKw,
        promptSource: resolved.source,
      });
    } catch (e) {
      // Vercel runtime logs に詳細を残す (デフォルトの 500 ハンドラだと message が省略される)
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
