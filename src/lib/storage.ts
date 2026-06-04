import { sql } from "./db";
import { supabaseAdmin } from "./supabase/admin";
import type { Article, Idea } from "./types";

export type { Article, Idea } from "./types";

const IMAGES_BUCKET = "images";

type ArticleRow = {
  id: string;
  created_at: string;
  idea: Idea;
  best_title: string;
  title_candidates: string[];
  best_title_reason: string;
  body_markdown: string;
  image_prompt_subject: string;
  image_alt_text: string | null;
  image_path: string | null;
  posted_at: string | null;
  destination_id: string | null;
};

function rowToArticle(r: ArticleRow): Article {
  return {
    id: r.id,
    createdAt: r.created_at,
    idea: r.idea,
    bestTitle: r.best_title,
    titleCandidates: r.title_candidates ?? [],
    bestTitleReason: r.best_title_reason ?? "",
    bodyMarkdown: r.body_markdown ?? "",
    imagePromptSubject: r.image_prompt_subject ?? "",
    imageAltText: r.image_alt_text ?? undefined,
    imagePath: r.image_path ?? undefined,
    postedAt: r.posted_at ?? undefined,
    destinationId: r.destination_id ?? undefined,
  };
}

export async function loadArticles(projectId: string): Promise<Article[]> {
  const rows = await sql<ArticleRow[]>`
    select id, created_at, idea, best_title, title_candidates,
           best_title_reason, body_markdown, image_prompt_subject,
           image_alt_text, image_path, posted_at, destination_id
    from articles
    where project_id = ${projectId}
    order by created_at desc
  `;
  return rows.map(rowToArticle);
}

export async function saveArticle(
  projectId: string,
  userId: string,
  article: Article,
): Promise<void> {
  await sql`
    insert into articles (
      id, project_id, user_id, created_at, idea, best_title, title_candidates,
      best_title_reason, body_markdown, image_prompt_subject,
      image_alt_text, image_path, posted_at, destination_id
    ) values (
      ${article.id},
      ${projectId},
      ${userId},
      ${article.createdAt},
      ${sql.json(article.idea)},
      ${article.bestTitle},
      ${sql.json(article.titleCandidates ?? [])},
      ${article.bestTitleReason ?? ""},
      ${article.bodyMarkdown ?? ""},
      ${article.imagePromptSubject ?? ""},
      ${article.imageAltText ?? null},
      ${article.imagePath ?? null},
      ${article.postedAt ?? null},
      ${article.destinationId ?? null}
    )
    on conflict (id) do update set
      idea = excluded.idea,
      best_title = excluded.best_title,
      title_candidates = excluded.title_candidates,
      best_title_reason = excluded.best_title_reason,
      body_markdown = excluded.body_markdown,
      image_prompt_subject = excluded.image_prompt_subject,
      image_alt_text = excluded.image_alt_text,
      image_path = excluded.image_path,
      posted_at = excluded.posted_at,
      destination_id = excluded.destination_id
  `;
}

export async function markArticlePosted(
  projectId: string,
  articleId: string,
): Promise<void> {
  await sql`
    update articles
       set posted_at = now()
     where id = ${articleId} and project_id = ${projectId}
  `;
}

// マルチポストモーダル等での手動編集を反映する。
// 現状は本文・タイトルのみ。画像やタグはこのルートでは触らない。
export async function updateArticleContent(
  projectId: string,
  articleId: string,
  patch: { bodyMarkdown?: string; bestTitle?: string },
): Promise<Article | null> {
  const next: { body_markdown?: string; best_title?: string } = {};
  if (typeof patch.bodyMarkdown === "string") next.body_markdown = patch.bodyMarkdown;
  if (typeof patch.bestTitle === "string" && patch.bestTitle.trim()) {
    next.best_title = patch.bestTitle.trim();
  }
  if (Object.keys(next).length === 0) return null;

  // 個別の update を投げる。sql タグの仕様で「動的 SET 句」を作るより明示的な方が安全。
  if (next.body_markdown !== undefined && next.best_title !== undefined) {
    await sql`
      update articles
         set body_markdown = ${next.body_markdown},
             best_title    = ${next.best_title}
       where id = ${articleId} and project_id = ${projectId}
    `;
  } else if (next.body_markdown !== undefined) {
    await sql`
      update articles
         set body_markdown = ${next.body_markdown}
       where id = ${articleId} and project_id = ${projectId}
    `;
  } else if (next.best_title !== undefined) {
    await sql`
      update articles
         set best_title = ${next.best_title}
       where id = ${articleId} and project_id = ${projectId}
    `;
  }

  const rows = await sql<ArticleRow[]>`
    select id, created_at, idea, best_title, title_candidates,
           best_title_reason, body_markdown, image_prompt_subject,
           image_alt_text, image_path, posted_at, destination_id
      from articles
     where id = ${articleId} and project_id = ${projectId}
     limit 1
  `;
  return rows[0] ? rowToArticle(rows[0]) : null;
}

// Supabase Storage の `images` 公開バケットに保存し、public URL を返す。
// 再生成時に上書きされるよう upsert: true。
// 画像パスにも projectId を含めて、別 project が同じ articleId を使うことが
// 仮にあっても衝突しないようにする。
export async function saveImage(
  projectId: string,
  articleId: string,
  base64: string,
): Promise<string> {
  const supa = supabaseAdmin();
  const filename = `articles/${projectId}/${articleId}.png`;
  const buffer = Buffer.from(base64, "base64");
  const { error: uploadError } = await supa.storage
    .from(IMAGES_BUCKET)
    .upload(filename, buffer, {
      contentType: "image/png",
      upsert: true,
    });
  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }
  const { data } = supa.storage.from(IMAGES_BUCKET).getPublicUrl(filename);
  return `${data.publicUrl}?t=${Date.now()}`;
}
