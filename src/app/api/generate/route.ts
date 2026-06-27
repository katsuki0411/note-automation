import { NextRequest } from "next/server";
import { loadArticles, saveArticle, type Article, type Idea } from "@/lib/storage";
import { BRAND, type ThemeTagKey } from "@/lib/brand";
import { attachArticleToKeyword, loadKeywords } from "@/lib/keywords";
import { getDestination } from "@/lib/destinations";
import {
  extractDestinationStages,
  PROMPT_NOT_CONFIGURED_ERROR,
} from "@/lib/promptResolver";
import { getAuthorPersona } from "@/lib/authorPersonas";
import {
  DEFAULT_ARTICLE_MODEL,
  generateArticleTextChain,
  isArticleModel,
} from "@/lib/articleGen";
import type { FeedIdea, Keyword, ThemeId } from "@/lib/types";
import { withProjectContext } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

// =========================================================
// Phase 1: プロンプト変数注入 + フェーズ3出力パーサ (2026-06-27)
// =========================================================
// 専門家が作った3段プロンプト (共通仕様0/B 準拠) の {{自動注入}} 欄を MPA が埋め、
// 出力は作者ネイティブの「①タイトル ②本文 ③画像指示」形式のまま受け取り、
// 共通仕様C(3) のパース仕様どおりに分割する。
// =========================================================

// 共通仕様0 (対策キーワード) と 共通仕様B (執筆者プロフィール) の {{}} を実値で埋める。
// Phase 1 (a): ペルソナは自由記述1フィールドを執筆者プロフィールブロックに丸ごと注入する。
function fillPromptPlaceholders(
  stageText: string,
  opts: { keyword: string; personaText?: string },
): string {
  let t = stageText;
  // 執筆者プロフィールブロック (===== 執筆者プロフィール（システム自動注入） ===== 〜 =====) を
  // ペルソナ本文で置換。割当が無ければブロックはそのまま (後段の {{}} 掃除で「（指定なし）」化)。
  if (opts.personaText?.trim()) {
    t = t.replace(
      /=====\s*執筆者プロフィール（システム自動注入）\s*=====[\s\S]*?\n=====/g,
      `===== 執筆者プロフィール =====\n${opts.personaText.trim()}\n=====`,
    );
  }
  // target_keyword 行を実値に
  t = t.replace(/^(\s*target_keyword:).*$/m, `$1 ${opts.keyword}`);
  // INPUT セクションの 〈…対策キーワード…〉 手動マーカーも実値に
  t = t.replace(/〈[^〉]*対策キーワード[^〉]*〉/g, opts.keyword);
  // 残った {{…}} 任意項目は Phase 3 (詳細条件UI) で埋める。現状は「（指定なし）」で無害化。
  t = t.replace(/\{\{[^}]*\}\}/g, "（指定なし）");
  return t;
}

// フェーズ3の出力 (①タイトル / ②本文 / 制作メモ / ③画像指示) を分割する。
// Phase 1 では本文をクリーンに取り出すのが目的 (③画像は Phase 4 で扱う)。
function parsePhase3Output(
  raw: string,
  fallbackTitle: string,
): { title: string; body: string } {
  const lineStartOf = (marker: string): number | null => {
    const i = raw.indexOf(marker);
    return i < 0 ? null : raw.lastIndexOf("\n", i) + 1;
  };
  const lineEndOf = (marker: string): number | null => {
    const i = raw.indexOf(marker);
    if (i < 0) return null;
    const e = raw.indexOf("\n", i);
    return e < 0 ? raw.length : e;
  };

  const titleHdrEnd = lineEndOf("note タイトル");
  const bodyHdrStart = lineStartOf("note本文");
  const bodyHdrEnd = lineEndOf("note本文");
  const metaStart = lineStartOf("制作メモ");
  // 画像ブロック開始 ("========== 画像生成指示" or "―― ③ ――" 見出し)
  const imgSearch = raw.search(/={6,}\s*画像生成指示|[―—\-]{2,}\s*③/);
  const imgStart = imgSearch >= 0 ? raw.lastIndexOf("\n", imgSearch) + 1 : null;

  // ① タイトル
  let title = fallbackTitle;
  if (titleHdrEnd !== null && bodyHdrStart !== null && bodyHdrStart > titleHdrEnd) {
    const t = raw.slice(titleHdrEnd, bodyHdrStart).replace(/[―—\-]{3,}/g, "").trim();
    if (t) title = t.split("\n").find((l) => l.trim())?.trim() ?? fallbackTitle;
  }

  // ② 本文 (制作メモ / 画像ブロックの手前まで)
  let body: string;
  if (bodyHdrEnd !== null) {
    const ends = [metaStart, imgStart].filter(
      (x): x is number => x !== null && x > bodyHdrEnd,
    );
    const bodyEnd = ends.length ? Math.min(...ends) : raw.length;
    body = raw.slice(bodyHdrEnd, bodyEnd);
  } else {
    // セクションヘッダーが無い → 全体を本文とみなし、画像/メタブロックだけ落とす
    const cuts = [imgStart, metaStart].filter((x): x is number => x !== null);
    body = raw.slice(0, cuts.length ? Math.min(...cuts) : raw.length);
  }

  // 装飾行 (―――― 区切り / セクション見出し) と先頭重複タイトルを掃除
  body = body
    .replace(/^[―—\-]{3,}.*$/gm, "")
    .replace(/^.*note本文.*$/m, "")
    .trim();
  // 先頭の非空行が title と一致したら除去 (本文冒頭のタイトル重複対策)
  const lines = body.split("\n");
  const firstIdx = lines.findIndex((l) => l.trim() && !l.trim().startsWith("[IMG"));
  if (firstIdx >= 0 && lines[firstIdx].trim() === title) {
    lines.splice(firstIdx, 1);
    body = lines.join("\n").trim();
  }

  return { title, body };
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

// 3段プロンプトに渡す「補足ネタ素材」。
// 出力フォーマットの指示はしない (出力形式は作者の3段プロンプトが規定する)。
// 対策キーワードは fillPromptPlaceholders で各フェーズのINPUTに直接注入される。
function buildMaterialContext(args: {
  idea: Idea | FeedIdea;
  relatedArticles: { title: string; hook?: string }[];
  fixedTags: string[];
}): string {
  const { idea, relatedArticles, fixedTags } = args;
  const feed = idea as FeedIdea;
  return `
# 補足ネタ素材（任意参考。対策キーワード・出力形式は各フェーズのプロンプトに従うこと）
- 参考タイトル: ${idea.title}
- 共感フック: ${idea.hook ?? ""}
- 角度: ${idea.angle ?? ""}
${feed.toolConcept ? `- ツールコンセプト: ${feed.toolConcept}` : ""}
${feed.voice ? `\n【参考となる読者の声】\n> ${feed.voice.quote} (出典: ${feed.voice.platform})\n${feed.voice.context ? `補足: ${feed.voice.context}` : ""}` : ""}
${relatedArticles.length > 0 ? `\n【同じ著者の関連既存記事 (内部リンク素材に)】\n${relatedArticles.map((a) => `- ${a.title}${a.hook ? ` (${a.hook})` : ""}`).join("\n")}` : ""}
${fixedTags.length > 0 ? `\n【記事末尾タグ候補】\n${fixedTags.map((t) => `#${t}`).join(" ")}` : ""}
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

      // destination の 3段プロンプトを取り出す。未設定なら 400。
      const stages = extractDestinationStages(destination);
      if (!stages) {
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

      const material = buildMaterialContext({ idea, relatedArticles, fixedTags });

      // 執筆者ペルソナ (Phase 1(a): 自由記述を執筆者プロフィールブロックに注入)。
      const personaId = (destination.prompt_config as { personaId?: string } | null)?.personaId;
      let personaText = "";
      if (personaId) {
        const persona = await getAuthorPersona(ctx.projectId, personaId);
        if (persona?.body.trim()) personaText = persona.body.trim();
      }

      // 対策キーワード = スカウトKW (なければ idea.title)
      const keyword = targetKw?.kw ?? idea.title;
      const fill = (s: string) => fillPromptPlaceholders(s, { keyword, personaText });

      // 3フェーズ連鎖。各フェーズは {{}} を埋めて素のテキストで実行 (JSON強制はしない)。
      // system は空。各フェーズのプロンプトに必要な指示がすべて含まれている。
      let context = "";
      if (stages[0]?.trim()) {
        context = await generateArticleTextChain({
          model: articleModel,
          system: "",
          user: `${fill(stages[0])}\n\n${material}`,
        });
      }
      if (stages[1]?.trim()) {
        context = await generateArticleTextChain({
          model: articleModel,
          system: "",
          user: `${fill(stages[1])}\n\n# 前フェーズ（フェーズ1）の出力\n${context || "(なし)"}`,
        });
      }
      let responseText = context;
      if (stages[2]?.trim()) {
        responseText = await generateArticleTextChain({
          model: articleModel,
          system: "",
          user: `${fill(stages[2])}\n\n# 前フェーズ（フェーズ2）の出力\n${context || "(なし)"}`,
        });
      }

      // フェーズ3のネイティブ出力 (①②③) を分割して本文をクリーンに取り出す。
      const { title, body } = parsePhase3Output(responseText, idea.title);

      const article: Article = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        idea,
        titleCandidates: [],
        bestTitle: title || idea.title,
        bestTitleReason: "",
        bodyMarkdown: body,
        imagePromptSubject: "",
        imageAltText: "",
        destinationId,
      };

      await saveArticle(ctx.projectId, ctx.userId, article);

      if (targetKw) {
        await attachArticleToKeyword(ctx.projectId, targetKw.id, article.id);
      }

      return Response.json({ article, targetKeyword: targetKw });
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
