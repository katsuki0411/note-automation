import { sql } from "./db";
import { THEMES, type FeedIdea, type FeedState, type ThemeId } from "./types";

const MAX_FEED = 100;

type IdeaRow = {
  id: string;
  created_at: string;
  source: "gemini" | "perplexity";
  theme_id: ThemeId;
  custom_label: string | null;
  source_mode: FeedIdea["sourceMode"];
  title: string;
  hook: string | null;
  angle: string | null;
  trend_source: string | null;
  voice: FeedIdea["voice"] | null;
  tool_concept: string | null;
  keywords: FeedIdea["keywords"] | null;
  target: FeedIdea["target"] | null;
  impression: FeedIdea["impression"] | null;
  priority_score: number | null;
  target_keyword_id: string | null;
};

function rowToIdea(r: IdeaRow): FeedIdea {
  return {
    id: r.id,
    createdAt: r.created_at,
    source: r.source,
    themeId: r.theme_id,
    customLabel: r.custom_label ?? undefined,
    sourceMode: r.source_mode ?? undefined,
    title: r.title,
    hook: r.hook ?? "",
    angle: r.angle ?? "",
    trend_source: r.trend_source ?? undefined,
    voice: r.voice ?? undefined,
    toolConcept: r.tool_concept ?? undefined,
    keywords: r.keywords ?? undefined,
    target: r.target ?? undefined,
    impression: r.impression ?? undefined,
    priorityScore: r.priority_score ?? undefined,
    targetKeywordId: r.target_keyword_id ?? undefined,
  };
}

async function loadFeedStateRow(): Promise<{ tickCount: number; lastTickAt: string | null }> {
  const rows = await sql<{ tick_count: number; last_tick_at: string | null }[]>`
    select tick_count, last_tick_at from feed_state where id = 1
  `;
  if (rows.length === 0) return { tickCount: 0, lastTickAt: null };
  return { tickCount: rows[0].tick_count, lastTickAt: rows[0].last_tick_at };
}

export async function loadFeed(): Promise<FeedState> {
  const [ideas, meta] = await Promise.all([
    sql<IdeaRow[]>`
      select id, created_at, source, theme_id, custom_label, source_mode,
             title, hook, angle, trend_source, voice, tool_concept,
             keywords, target, impression, priority_score, target_keyword_id
      from ideas
      order by created_at desc
      limit ${MAX_FEED}
    `,
    loadFeedStateRow(),
  ]);
  return {
    ideas: ideas.map(rowToIdea),
    tickCount: meta.tickCount,
    lastTickAt: meta.lastTickAt ?? undefined,
  };
}

function normalize(s: string): string {
  return s.replace(/[\s!！？?。、・「」『』]/g, "").toLowerCase();
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
  newIdeas: Omit<FeedIdea, "id" | "createdAt">[],
): Promise<{ added: number; skipped: number; state: FeedState; addedIdeas: FeedIdea[] }> {
  const existing = await sql<{ title: string }[]>`
    select title from ideas order by created_at desc limit ${MAX_FEED}
  `;
  const existingTitles = existing.map((e) => e.title);

  const addedIdeas: FeedIdea[] = [];
  let added = 0;
  let skipped = 0;

  for (const idea of newIdeas) {
    const dup = existingTitles.some((t) => similar(t, idea.title));
    if (dup) {
      skipped++;
      continue;
    }
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await sql`
      insert into ideas (
        id, created_at, source, theme_id, custom_label, source_mode,
        title, hook, angle, trend_source, voice, tool_concept,
        keywords, target, impression, priority_score, target_keyword_id
      ) values (
        ${id},
        ${createdAt},
        ${idea.source},
        ${idea.themeId},
        ${idea.customLabel ?? null},
        ${idea.sourceMode ?? null},
        ${idea.title},
        ${idea.hook ?? ""},
        ${idea.angle ?? ""},
        ${idea.trend_source ?? null},
        ${idea.voice ? sql.json(idea.voice) : null},
        ${idea.toolConcept ?? null},
        ${idea.keywords ? sql.json(idea.keywords) : null},
        ${idea.target ? sql.json(idea.target) : null},
        ${idea.impression ? sql.json(idea.impression) : null},
        ${idea.priorityScore ?? null},
        ${idea.targetKeywordId ?? null}
      )
    `;
    addedIdeas.push({ ...idea, id, createdAt });
    existingTitles.unshift(idea.title);
    added++;
  }

  // 古いideaを削除（MAX_FEED超え分）
  await sql`
    delete from ideas
    where id in (
      select id from ideas order by created_at desc offset ${MAX_FEED}
    )
  `;

  // feed_stateのtick_count更新
  const now = new Date().toISOString();
  await sql`
    update feed_state
    set tick_count = tick_count + 1,
        last_tick_at = ${now}
    where id = 1
  `;

  const state = await loadFeed();
  return { added, skipped, state, addedIdeas };
}

export async function dismissIdea(id: string): Promise<void> {
  await sql`delete from ideas where id = ${id}`;
}

export function pickNextTheme(tickCount: number): { id: ThemeId; label: string; desc: string } {
  const t = THEMES[tickCount % THEMES.length];
  return { id: t.id, label: t.label, desc: t.desc };
}
