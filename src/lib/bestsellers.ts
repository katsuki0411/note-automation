import { sql } from "./db";
import type { BestsellerItem } from "./amazonBestseller";

export type BestsellerProductRow = {
  id: string;
  project_id: string;
  category: string;
  rank: number;
  title: string;
  url: string;
  asin: string;
  image_url: string | null;
  source_used: "scrape" | "pa-api";
  fetched_at: string;
};

export async function loadBestsellers(projectId: string): Promise<BestsellerProductRow[]> {
  return await sql<BestsellerProductRow[]>`
    select id, project_id, category, rank, title, url, asin, image_url, source_used, fetched_at
    from bestseller_products
    where project_id = ${projectId}
    order by category asc, rank asc
  `;
}

export async function loadBestsellersByCategory(
  projectId: string,
  category: string,
): Promise<BestsellerProductRow[]> {
  return await sql<BestsellerProductRow[]>`
    select id, project_id, category, rank, title, url, asin, image_url, source_used, fetched_at
    from bestseller_products
    where project_id = ${projectId} and category = ${category}
    order by rank asc
  `;
}

// 指定カテゴリの既存データを全削除 + 新規データを一括 insert
// 「最新の TOP10」だけ保持する設計 (履歴は持たない)
export async function replaceBestsellersForCategory(
  projectId: string,
  userId: string,
  category: string,
  items: BestsellerItem[],
  sourceUsed: "scrape" | "pa-api" = "scrape",
): Promise<number> {
  if (items.length === 0) return 0;
  return await sql.begin(async (tx) => {
    await tx`
      delete from bestseller_products
      where project_id = ${projectId} and category = ${category}
    `;
    let inserted = 0;
    for (const it of items) {
      await tx`
        insert into bestseller_products (
          project_id, user_id, category, rank, title, url, asin, image_url, source_used
        ) values (
          ${projectId},
          ${userId},
          ${category},
          ${it.rank},
          ${it.title},
          ${it.url},
          ${it.asin},
          ${it.imageUrl ?? null},
          ${sourceUsed}
        )
        on conflict (project_id, category, asin) do update set
          rank = excluded.rank,
          title = excluded.title,
          url = excluded.url,
          image_url = excluded.image_url,
          source_used = excluded.source_used,
          fetched_at = now()
      `;
      inserted++;
    }
    return inserted;
  });
}
