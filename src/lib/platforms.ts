import { promises as fs } from "node:fs";
import path from "node:path";
import type { Platform, PlatformCategory, PlatformsState } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "platforms.json");

const SEED_PLATFORMS: Array<Pick<Platform, "domain" | "label" | "category">> = [
  { domain: "chiebukuro.yahoo.co.jp", label: "Yahoo!知恵袋", category: "qa" },
  { domain: "oshiete.goo.ne.jp", label: "教えて!goo", category: "qa" },
  { domain: "okwave.jp", label: "OKWAVE", category: "qa" },
  { domain: "girlschannel.net", label: "ガールズちゃんねる", category: "forum" },
  { domain: "mamastar.jp", label: "ママスタコミュニティ", category: "forum" },
  { domain: "women.benesse.ne.jp", label: "ウィメンズパーク", category: "forum" },
  { domain: "5ch.net", label: "5ちゃんねる", category: "forum" },
  { domain: "kids.nifty.com", label: "ニフティキッズ", category: "forum" },
  { domain: "x.com", label: "X (Twitter)", category: "sns" },
  { domain: "twitter.com", label: "Twitter (旧)", category: "sns" },
  { domain: "threads.net", label: "Threads", category: "sns" },
  { domain: "note.com", label: "note", category: "blog" },
];

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readState(): Promise<PlatformsState | null> {
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeState(state: PlatformsState): Promise<void> {
  await ensureDir();
  state.updatedAt = new Date().toISOString();
  await fs.writeFile(FILE, JSON.stringify(state, null, 2), "utf-8");
}

export async function loadPlatforms(): Promise<Platform[]> {
  const state = await readState();
  if (state) return state.platforms;
  // 初回: SEED投入
  const now = new Date().toISOString();
  const seeded: Platform[] = SEED_PLATFORMS.map((s) => ({
    id: crypto.randomUUID(),
    domain: s.domain,
    label: s.label,
    category: s.category,
    enabled: true,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  }));
  await writeState({ platforms: seeded });
  return seeded;
}

export async function getEnabledDomains(): Promise<string[]> {
  const list = await loadPlatforms();
  return list.filter((p) => p.enabled).map((p) => p.domain);
}

export async function platformLabelForDomainAsync(domain: string): Promise<string> {
  const list = await loadPlatforms();
  const matched = list.find((p) => domain.includes(p.domain));
  return matched?.label ?? domain;
}

export type CreatePlatformInput = {
  domain: string;
  label: string;
  category: PlatformCategory;
  memo?: string;
  enabled?: boolean;
};

function normalizeDomain(d: string): string {
  return d
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

export async function createPlatform(input: CreatePlatformInput): Promise<Platform> {
  const list = await loadPlatforms();
  const dom = normalizeDomain(input.domain);
  if (!dom) throw new Error("ドメインが空です");
  const dup = list.find((p) => p.domain === dom);
  if (dup) throw new Error(`既に存在します: ${dom}`);
  const now = new Date().toISOString();
  const p: Platform = {
    id: crypto.randomUUID(),
    domain: dom,
    label: input.label.trim() || dom,
    category: input.category,
    enabled: input.enabled ?? true,
    memo: input.memo ?? "",
    createdAt: now,
    updatedAt: now,
  };
  list.unshift(p);
  await writeState({ platforms: list });
  return p;
}

export async function updatePlatform(
  id: string,
  patch: Partial<Omit<Platform, "id" | "createdAt" | "isDefault">>,
): Promise<Platform | undefined> {
  const list = await loadPlatforms();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return undefined;
  if (patch.domain) patch.domain = normalizeDomain(patch.domain);
  list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() };
  await writeState({ platforms: list });
  return list[idx];
}

export async function deletePlatform(id: string): Promise<boolean> {
  const list = await loadPlatforms();
  const target = list.find((p) => p.id === id);
  if (!target) return false;
  if (target.isDefault) {
    // デフォルト保護: 削除させずに無効化のみ
    target.enabled = false;
    target.updatedAt = new Date().toISOString();
    await writeState({ platforms: list });
    return true;
  }
  const filtered = list.filter((p) => p.id !== id);
  await writeState({ platforms: filtered });
  return true;
}
