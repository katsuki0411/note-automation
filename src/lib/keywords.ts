import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  Keyword,
  KeywordCompetition,
  KeywordIntent,
  KeywordStatus,
  KeywordVolume,
  KeywordsState,
  ThemeId,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const KW_FILE = path.join(DATA_DIR, "keywords.json");

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function loadKeywords(): Promise<KeywordsState> {
  await ensureDir();
  try {
    const raw = await fs.readFile(KW_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { keywords: [] };
  }
}

export async function saveKeywords(state: KeywordsState): Promise<void> {
  await ensureDir();
  state.updatedAt = new Date().toISOString();
  await fs.writeFile(KW_FILE, JSON.stringify(state, null, 2), "utf-8");
}

export function normalizeKw(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

export async function findKeyword(kw: string, themeId?: ThemeId): Promise<Keyword | undefined> {
  const state = await loadKeywords();
  const target = normalizeKw(kw);
  return state.keywords.find(
    (k) => normalizeKw(k.kw) === target && (!themeId || k.themeId === themeId),
  );
}

export type CreateKeywordInput = {
  themeId: ThemeId;
  subcategoryId: string;
  kw: string;
  intent?: KeywordIntent;
  vol?: KeywordVolume;
  comp?: KeywordCompetition;
  priority?: number;
  memo?: string;
  status?: KeywordStatus;
  articleIds?: string[];
};

export async function createKeyword(input: CreateKeywordInput): Promise<Keyword> {
  const state = await loadKeywords();
  const dup = state.keywords.find(
    (k) => normalizeKw(k.kw) === normalizeKw(input.kw) && k.themeId === input.themeId,
  );
  if (dup) return dup;
  const now = new Date().toISOString();
  const kw: Keyword = {
    id: crypto.randomUUID(),
    themeId: input.themeId,
    subcategoryId: input.subcategoryId,
    kw: input.kw.trim(),
    intent: input.intent ?? "trouble",
    vol: input.vol ?? "medium",
    comp: input.comp ?? "medium",
    priority: input.priority ?? 50,
    memo: input.memo ?? "",
    status: input.status ?? "untargeted",
    articleIds: input.articleIds ?? [],
    createdAt: now,
    updatedAt: now,
  };
  state.keywords.unshift(kw);
  await saveKeywords(state);
  return kw;
}

export async function updateKeyword(
  id: string,
  patch: Partial<Omit<Keyword, "id" | "createdAt">>,
): Promise<Keyword | undefined> {
  const state = await loadKeywords();
  const idx = state.keywords.findIndex((k) => k.id === id);
  if (idx === -1) return undefined;
  state.keywords[idx] = {
    ...state.keywords[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await saveKeywords(state);
  return state.keywords[idx];
}

export async function deleteKeyword(id: string): Promise<boolean> {
  const state = await loadKeywords();
  const before = state.keywords.length;
  state.keywords = state.keywords.filter((k) => k.id !== id);
  if (state.keywords.length === before) return false;
  await saveKeywords(state);
  return true;
}

export async function attachArticleToKeyword(keywordId: string, articleId: string) {
  const state = await loadKeywords();
  const k = state.keywords.find((x) => x.id === keywordId);
  if (!k) return;
  if (!k.articleIds.includes(articleId)) k.articleIds.push(articleId);
  k.status = "covered";
  k.updatedAt = new Date().toISOString();
  await saveKeywords(state);
}
