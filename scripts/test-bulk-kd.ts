// Stage 2.5 (Bulk Keyword Difficulty) の動作確認スクリプト (DFS API 直叩き版)。
// Backlinks サブスクのトライアルが効いて KD が実数値で返るかを最小コストで検証する。
// 使い方: npx tsx --env-file=.env.local scripts/test-bulk-kd.ts

const BASE = "https://api.dataforseo.com/v3";
const LOCATION_JP = 2392;
const LANGUAGE_JP = "ja";
const LOCATION_US = 2840;
const LANGUAGE_EN = "en";

function authHeader(login: string, password: string): string {
  const token = Buffer.from(`${login}:${password}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

async function bulkKd(
  login: string,
  password: string,
  kws: string[],
  locale: { locationCode: number; languageCode: string } = {
    locationCode: LOCATION_JP,
    languageCode: LANGUAGE_JP,
  },
) {
  const body = [
    {
      keywords: kws,
      location_code: locale.locationCode,
      language_code: locale.languageCode,
    },
  ];
  const res = await fetch(
    `${BASE}/dataforseo_labs/google/bulk_keyword_difficulty/live`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(login, password),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { status: res.status, raw: text, items: [] };
  }
  return { status: res.status, raw: json, items: extractItems(json) };
}

function extractItems(json: unknown): Array<{ kw: string; kd: unknown }> {
  try {
    const root = json as {
      tasks?: Array<{
        status_code?: number;
        status_message?: string;
        result?: Array<{
          items?: Array<{
            keyword?: string;
            keyword_difficulty?: number;
          }>;
        }>;
      }>;
    };
    const task = root.tasks?.[0];
    if (!task) return [];
    const items = task.result?.[0]?.items ?? [];
    return items.map((it) => ({
      kw: it.keyword ?? "",
      kd: it.keyword_difficulty ?? null,
    }));
  } catch {
    return [];
  }
}

async function main() {
  const login = (process.env.DATAFORSEO_LOGIN ?? "").trim();
  const password = (process.env.DATAFORSEO_PASSWORD ?? "").trim();
  const useMock = process.env.DATAFORSEO_USE_MOCK === "true";

  console.log("=== DataForSEO 動作確認 (Bulk KD = Backlinks 契約必要) ===");
  console.log(`MODE        : ${useMock ? "MOCK (env: DATAFORSEO_USE_MOCK=true)" : "LIVE"}`);
  console.log(`LOGIN       : ${login ? login : "❌ MISSING"}`);
  console.log(`PASSWORD    : ${password ? `set (${password.length}文字)` : "❌ MISSING"}`);
  console.log();

  if (!login || !password) {
    console.error("DataForSEO 認証情報が未設定。.env.local を確認してください。");
    process.exit(1);
  }
  if (useMock) {
    console.warn("⚠ DATAFORSEO_USE_MOCK=true です。実 API を叩きません。env から外してください。");
    process.exit(0);
  }

  // ① 日本語の超メジャーKW
  const jpKws = ["ベビーカー", "おむつ", "ベビーカー 軽量", "おむつ 夜用"];
  console.log("--- ① JP (location=2392, lang=ja) ---");
  console.log(`keywords: ${jpKws.join(" / ")}`);
  const r1 = await bulkKd(login, password, jpKws, {
    locationCode: LOCATION_JP,
    languageCode: LANGUAGE_JP,
  });
  console.log(`HTTP=${r1.status}, returned=${r1.items.length}`);
  for (const item of r1.items) {
    const kdStr = item.kd === null || item.kd === undefined ? "null" : String(item.kd);
    console.log(`  KD=${kdStr.padStart(4)}  "${item.kw}"`);
  }

  console.log();

  // ② 英語の超メジャーKW (DFS のメインインデックス、これが取れないとサブスクが効いていない確定)
  const enKws = ["running shoes", "iphone case", "nike", "best laptop"];
  console.log("--- ② EN (location=2840, lang=en) — Backlinks 有効判定の決定打 ---");
  console.log(`keywords: ${enKws.join(" / ")}`);
  const r2 = await bulkKd(login, password, enKws, {
    locationCode: LOCATION_US,
    languageCode: LANGUAGE_EN,
  });
  console.log(`HTTP=${r2.status}, returned=${r2.items.length}`);
  for (const item of r2.items) {
    const kdStr = item.kd === null || item.kd === undefined ? "null" : String(item.kd);
    console.log(`  KD=${kdStr.padStart(4)}  "${item.kw}"`);
  }

  // ③ tasks 直下のステータスメッセージも見る (権限エラーが status_message に出る場合あり)
  console.log();
  console.log("--- ③ tasks レベルのステータス確認 ---");
  const root = r2.raw as {
    tasks?: Array<{
      status_code?: number;
      status_message?: string;
      result?: unknown;
    }>;
    cost?: number;
  };
  console.log(`task status_code   : ${root.tasks?.[0]?.status_code}`);
  console.log(`task status_message: ${root.tasks?.[0]?.status_message}`);
  console.log(`cost ($)           : ${root.cost}`);

  console.log();
  const enAllNullOrZero = r2.items.every(
    (i) => i.kd === null || i.kd === undefined || i.kd === 0,
  );
  if (enAllNullOrZero) {
    console.log("❌ 英語 KW でも全て KD=null/0。");
    console.log("→ Backlinks サブスク (Active trial) が DFS 側で有効化されていない確定。");
    console.log("→ 推奨アクション:");
    console.log("   1) DFS ダッシュボード Access Subscriptions ページで Backlinks API 'Active trial' 表示確認");
    console.log("   2) もし 'Active trial' でも KD=0 → DFS サポートチャットで問い合わせ");
    console.log("      (英文例: 'I have Active trial of Backlinks API but Bulk Keyword Difficulty returns 0/null for all keywords. login: info@michisu-inc.com')");
  } else {
    console.log("✅ 英語 KW で KD 取れた。Backlinks サブスクは有効。");
    console.log("→ 日本語 KW で KD=0/null になるのは、その KW が DFS Labs インデックスに無いだけ。");
    console.log("→ より一般的な日本語 KW で再テスト推奨。");
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
