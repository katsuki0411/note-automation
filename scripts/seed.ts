import postgres from "postgres";
import { promises as fs } from "node:fs";
import path from "node:path";

const DATA = path.join(process.cwd(), "data");

async function readJsonSafe<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA, file), "utf-8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });

  // ===== platforms =====
  const platformsState = await readJsonSafe<{ platforms?: any[] }>("platforms.json", {});
  if (platformsState.platforms?.length) {
    let n = 0;
    for (const p of platformsState.platforms) {
      await sql`
        insert into platforms (id, domain, label, category, enabled, is_default, memo, created_at, updated_at)
        values (
          ${p.id ?? crypto.randomUUID()},
          ${p.domain},
          ${p.label},
          ${p.category ?? "other"},
          ${p.enabled ?? true},
          ${p.isDefault ?? false},
          ${p.memo ?? ""},
          ${p.createdAt ?? new Date().toISOString()},
          ${p.updatedAt ?? new Date().toISOString()}
        )
        on conflict (domain) do update set
          label = excluded.label,
          category = excluded.category,
          enabled = excluded.enabled,
          memo = excluded.memo,
          updated_at = excluded.updated_at
      `;
      n++;
    }
    console.log(`✓ platforms: ${n} rows`);
  }

  // ===== keywords =====
  const keywordsState = await readJsonSafe<{ keywords?: any[] }>("keywords.json", {});
  if (keywordsState.keywords?.length) {
    let n = 0;
    for (const k of keywordsState.keywords) {
      await sql`
        insert into keywords (
          id, theme_id, subcategory_id, kw, intent, vol, comp,
          priority, memo, status, article_ids, created_at, updated_at
        ) values (
          ${k.id ?? crypto.randomUUID()},
          ${k.themeId},
          ${k.subcategoryId},
          ${k.kw},
          ${k.intent ?? "trouble"},
          ${k.vol ?? "medium"},
          ${k.comp ?? "medium"},
          ${k.priority ?? 50},
          ${k.memo ?? ""},
          ${k.status ?? "untargeted"},
          ${sql.json(k.articleIds ?? [])},
          ${k.createdAt ?? new Date().toISOString()},
          ${k.updatedAt ?? new Date().toISOString()}
        )
        on conflict (theme_id, kw) do update set
          subcategory_id = excluded.subcategory_id,
          intent = excluded.intent,
          vol = excluded.vol,
          comp = excluded.comp,
          priority = excluded.priority,
          memo = excluded.memo,
          status = excluded.status,
          article_ids = excluded.article_ids,
          updated_at = excluded.updated_at
      `;
      n++;
    }
    console.log(`✓ keywords: ${n} rows`);
  }

  // ===== ideas (feed) =====
  const feed = await readJsonSafe<{ ideas?: any[]; tickCount?: number; lastTickAt?: string }>(
    "idea-feed.json",
    {},
  );
  if (feed.ideas?.length) {
    let n = 0;
    for (const i of feed.ideas) {
      await sql`
        insert into ideas (
          id, created_at, source, theme_id, custom_label, source_mode,
          title, hook, angle, trend_source, voice, tool_concept,
          keywords, target, impression, priority_score, target_keyword_id
        ) values (
          ${i.id ?? crypto.randomUUID()},
          ${i.createdAt ?? new Date().toISOString()},
          ${i.source ?? "gemini"},
          ${i.themeId},
          ${i.customLabel ?? null},
          ${i.sourceMode ?? null},
          ${i.title},
          ${i.hook ?? ""},
          ${i.angle ?? ""},
          ${i.trend_source ?? null},
          ${i.voice ? sql.json(i.voice) : null},
          ${i.toolConcept ?? null},
          ${i.keywords ? sql.json(i.keywords) : null},
          ${i.target ? sql.json(i.target) : null},
          ${i.impression ? sql.json(i.impression) : null},
          ${i.priorityScore ?? null},
          ${i.targetKeywordId ?? null}
        )
        on conflict (id) do nothing
      `;
      n++;
    }
    console.log(`✓ ideas: ${n} rows`);
  }
  if (feed.tickCount || feed.lastTickAt) {
    await sql`
      update feed_state
      set tick_count = ${feed.tickCount ?? 0},
          last_tick_at = ${feed.lastTickAt ?? null}
      where id = 1
    `;
    console.log(`✓ feed_state: tick=${feed.tickCount} lastAt=${feed.lastTickAt}`);
  }

  // ===== articles =====
  const articles = await readJsonSafe<any[]>("articles.json", []);
  if (articles.length) {
    let n = 0;
    for (const a of articles) {
      await sql`
        insert into articles (
          id, created_at, idea, best_title, title_candidates,
          best_title_reason, body_markdown, image_prompt_subject,
          image_alt_text, image_path
        ) values (
          ${a.id ?? crypto.randomUUID()},
          ${a.createdAt ?? new Date().toISOString()},
          ${sql.json(a.idea ?? {})},
          ${a.bestTitle ?? ""},
          ${sql.json(a.titleCandidates ?? [])},
          ${a.bestTitleReason ?? ""},
          ${a.bodyMarkdown ?? ""},
          ${a.imagePromptSubject ?? ""},
          ${a.imageAltText ?? null},
          ${a.imagePath ?? null}
        )
        on conflict (id) do nothing
      `;
      n++;
    }
    console.log(`✓ articles: ${n} rows`);
  }

  // ===== hot_keywords =====
  const hot = await readJsonSafe<{ updatedAt?: string; keywords?: any[]; stats?: any }>(
    "hot-keywords.json",
    {},
  );
  if (hot.keywords?.length) {
    let n = 0;
    for (const h of hot.keywords) {
      await sql`
        insert into hot_keywords (
          kw, theme_id, volume_hint, competition_hint, rise_status, intent,
          priority, pain_intensity, why_hot, sources, discovered_at,
          verified_hits, verified_at, verify_status, sample_urls
        ) values (
          ${h.kw},
          ${h.themeId},
          ${h.volumeHint ?? "medium"},
          ${h.competitionHint ?? "medium"},
          ${h.riseStatus ?? "stable"},
          ${h.intent ?? "trouble"},
          ${h.priority ?? 50},
          ${h.painIntensity ?? 3},
          ${h.whyHot ?? ""},
          ${sql.json(h.sources ?? [])},
          ${h.discoveredAt ?? new Date().toISOString()},
          ${h.verifiedHits ?? null},
          ${h.verifiedAt ?? null},
          ${h.verifyStatus ?? null},
          ${h.sampleUrls ? sql.json(h.sampleUrls) : null}
        )
        on conflict (kw, theme_id) do update set
          volume_hint = excluded.volume_hint,
          competition_hint = excluded.competition_hint,
          rise_status = excluded.rise_status,
          intent = excluded.intent,
          priority = excluded.priority,
          pain_intensity = excluded.pain_intensity,
          why_hot = excluded.why_hot,
          sources = excluded.sources,
          discovered_at = excluded.discovered_at,
          verified_hits = excluded.verified_hits,
          verified_at = excluded.verified_at,
          verify_status = excluded.verify_status,
          sample_urls = excluded.sample_urls
      `;
      n++;
    }
    console.log(`✓ hot_keywords: ${n} rows`);
  }
  if (hot.updatedAt || hot.stats) {
    await sql`
      update hot_keywords_meta
      set updated_at = ${hot.updatedAt ?? null},
          stats = ${hot.stats ? sql.json(hot.stats) : null}
      where id = 1
    `;
    console.log(`✓ hot_keywords_meta: updatedAt=${hot.updatedAt}`);
  }

  // 結果確認
  const counts = await sql<{ table_name: string; n: string }[]>`
    select 'articles' as table_name, count(*)::text as n from articles
    union all select 'ideas', count(*)::text from ideas
    union all select 'keywords', count(*)::text from keywords
    union all select 'platforms', count(*)::text from platforms
    union all select 'hot_keywords', count(*)::text from hot_keywords
    order by table_name
  `;
  console.log("\n📊 Final row counts:");
  for (const c of counts) console.log(`  - ${c.table_name}: ${c.n}`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
