import { promises as fs } from "node:fs";
import path from "node:path";
import type { Article } from "./types";

export type { Article, Idea } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const ARTICLES_FILE = path.join(DATA_DIR, "articles.json");
const IMAGES_DIR = path.join(process.cwd(), "public", "generated-images");

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(IMAGES_DIR, { recursive: true });
}

export async function loadArticles(): Promise<Article[]> {
  await ensureDirs();
  try {
    const raw = await fs.readFile(ARTICLES_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveArticle(article: Article): Promise<void> {
  await ensureDirs();
  const articles = await loadArticles();
  const existingIdx = articles.findIndex((a) => a.id === article.id);
  if (existingIdx >= 0) {
    articles[existingIdx] = article;
  } else {
    articles.unshift(article);
  }
  await fs.writeFile(ARTICLES_FILE, JSON.stringify(articles, null, 2), "utf-8");
}

export async function saveImage(articleId: string, base64: string): Promise<string> {
  await ensureDirs();
  const filename = `${articleId}.png`;
  const filepath = path.join(IMAGES_DIR, filename);
  await fs.writeFile(filepath, Buffer.from(base64, "base64"));
  return `/generated-images/${filename}`;
}
