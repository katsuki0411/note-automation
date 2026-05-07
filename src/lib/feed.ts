import { promises as fs } from "node:fs";
import path from "node:path";
import { THEMES, type FeedIdea, type FeedState, type ThemeId } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const FEED_FILE = path.join(DATA_DIR, "idea-feed.json");

const MAX_FEED = 100;

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function loadFeed(): Promise<FeedState> {
  await ensureDir();
  try {
    const raw = await fs.readFile(FEED_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { ideas: [], tickCount: 0 };
  }
}

export async function saveFeed(state: FeedState): Promise<void> {
  await ensureDir();
  await fs.writeFile(FEED_FILE, JSON.stringify(state, null, 2), "utf-8");
}

function normalize(s: string): string {
  return s
    .replace(/[\s!！？?。、・「」『』]/g, "")
    .toLowerCase();
}

function similar(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length < nb.length ? na : nb;
  const longer = na.length < nb.length ? nb : na;
  if (shorter.length < 6) return false;
  return longer.includes(shorter) || shorter.includes(longer.slice(0, shorter.length));
}

export async function appendIdeas(
  newIdeas: Omit<FeedIdea, "id" | "createdAt">[]
): Promise<{ added: number; skipped: number; state: FeedState }> {
  const state = await loadFeed();
  let added = 0;
  let skipped = 0;
  for (const idea of newIdeas) {
    const dup = state.ideas.some((existing) => similar(existing.title, idea.title));
    if (dup) {
      skipped++;
      continue;
    }
    state.ideas.unshift({
      ...idea,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    });
    added++;
  }
  if (state.ideas.length > MAX_FEED) state.ideas = state.ideas.slice(0, MAX_FEED);
  state.tickCount = (state.tickCount ?? 0) + 1;
  state.lastTickAt = new Date().toISOString();
  await saveFeed(state);
  return { added, skipped, state };
}

export async function dismissIdea(id: string): Promise<void> {
  const state = await loadFeed();
  state.ideas = state.ideas.filter((i) => i.id !== id);
  await saveFeed(state);
}

export function pickNextTheme(tickCount: number): { id: ThemeId; label: string; desc: string } {
  const t = THEMES[tickCount % THEMES.length];
  return { id: t.id, label: t.label, desc: t.desc };
}
