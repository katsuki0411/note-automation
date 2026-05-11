import { promises as fs } from "node:fs";
import path from "node:path";
import { sql } from "./db";
import type { Article, Idea } from "./types";

export type { Article, Idea } from "./types";

const IMAGES_DIR = path.join(process.cwd(), "public", "generated-images");

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
  };
}

export async function loadArticles(): Promise<Article[]> {
  const rows = await sql<ArticleRow[]>`
    select id, created_at, idea, best_title, title_candidates,
           best_title_reason, body_markdown, image_prompt_subject,
           image_alt_text, image_path
    from articles
    order by created_at desc
  `;
  return rows.map(rowToArticle);
}

export async function saveArticle(article: Article): Promise<void> {
  await sql`
    insert into articles (
      id, created_at, idea, best_title, title_candidates,
      best_title_reason, body_markdown, image_prompt_subject,
      image_alt_text, image_path
    ) values (
      ${article.id},
      ${article.createdAt},
      ${sql.json(article.idea)},
      ${article.bestTitle},
      ${sql.json(article.titleCandidates ?? [])},
      ${article.bestTitleReason ?? ""},
      ${article.bodyMarkdown ?? ""},
      ${article.imagePromptSubject ?? ""},
      ${article.imageAltText ?? null},
      ${article.imagePath ?? null}
    )
    on conflict (id) do update set
      idea = excluded.idea,
      best_title = excluded.best_title,
      title_candidates = excluded.title_candidates,
      best_title_reason = excluded.best_title_reason,
      body_markdown = excluded.body_markdown,
      image_prompt_subject = excluded.image_prompt_subject,
      image_alt_text = excluded.image_alt_text,
      image_path = excluded.image_path
  `;
}

// 画像は当面ローカルfsに保存（Vercel本番運用は Task 5 で Supabase Storage 対応予定）
export async function saveImage(articleId: string, base64: string): Promise<string> {
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  const filename = `${articleId}.png`;
  const filepath = path.join(IMAGES_DIR, filename);
  await fs.writeFile(filepath, Buffer.from(base64, "base64"));
  return `/generated-images/${filename}`;
}
