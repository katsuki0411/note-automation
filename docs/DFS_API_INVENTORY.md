# DataForSEO API 完全インベントリ (v3)

> 調査日: 2026-06-07
> 対象: MultiPostAI の KW評価ロジック「DataForSEO 一本化」のための機能棚卸し
> 公式ドキュメント: https://docs.dataforseo.com/v3/

## 0. サマリー: 日本市場 KW評価で使える主要 API トップ10

日本 (`location_code=2392`, `language_code=ja`) で利用可能、かつ MultiPostAI の KW評価フェーズで実用性の高いものを優先順位付き。

| # | API エンドポイント | 取れる主要指標 | 概算コスト |
|---|---|---|---|
| 1 | **Labs / Google / Keyword Overview Live** | search_volume / cpc / competition / **keyword_difficulty** / monthly_searches / serp_info / avg_backlinks_info / search_intent / 12ヶ月トレンド | $0.0101 / req (1KW), 最大1000KW/req |
| 2 | **Labs / Google / Bulk Keyword Difficulty Live** | keyword_difficulty (0-100) のみを最大1000KW一括で取得 | $0.01 task + $0.0001/KW |
| 3 | **Labs / Google / Keyword Suggestions Live** | seed→補完KW (autocomplete系) + 全Overview指標 | $0.01 task + $0.0001/item |
| 4 | **Labs / Google / Related Keywords Live** | "他の人はこちらも検索" 系の関連KW、depth指定で~4680KW展開 | $0.01 task + $0.0001/item |
| 5 | **Labs / Google / Keyword Ideas Live** | カテゴリベース関連KW (最大200 seed) | $0.01 task + $0.0001/item |
| 6 | **Labs / Google / Historical Search Volume Live** | 2019年〜現在の月次SV履歴 + トレンド% (季節性判定用) | $0.01 task + $0.0001/KW |
| 7 | **Labs / Google / SERP Competitors Live** | KW群に対する競合ドメインTop N + visibility / etv | $0.01 task + $0.0001/KW |
| 8 | **Labs / Google / Search Intent Live** | KW群の4分類 intent (informational/navigational/commercial/transactional) | $0.001 task + $0.0001/KW |
| 9 | **SERP / Google / Organic Live Advanced** | 実 SERP TOP100 + 全 feature (PAA / Knowledge Graph / **AI Overview** / Featured Snippet / Shopping / Top Stories 等) | $2.00 / 1000 SERP (10件まで) |
| 10 | **Keywords Data / Google Trends Explore Live** | interest_over_time / related_topics / related_queries (季節性・話題化判定) | 公式記載: ~$1.00/1000 task |

**この10本で「SV / CPC / KD / SERP / 関連KW / トレンド / Intent / 競合ドメイン / AI Overview / Featured Snippet」が全部カバーできる。** Ahrefs 撤退は実用上問題なし。

---

## 1. SERP API

公式: https://docs.dataforseo.com/v3/serp/overview/

### 1.1 サポート検索エンジン
- **Google** (Organic / AI Mode / Maps / News / Images / Jobs / Events / Local Finder / Autocomplete / Trends / Shopping / Finance / Flights / Hotels / Scholar / Dataset 等)
- **Bing** (Organic / Maps / Local Pack)
- **YouTube** (Organic / Videos / Channels / Suggestions)
- **Yahoo** (Organic)
- **Baidu** (Organic)
- **Naver** (Organic)
- **Seznam** (Organic)

### 1.2 モード × プライオリティ
| モード | 説明 | レスポンス時間 |
|---|---|---|
| Standard Normal | POST → 待機 → GET。最安。 | ~5 分 |
| Standard High | 同上、優先度高め。 | ~1 分 |
| Live | POST 1発で即時 JSON。 | ~6 秒 |
| HTML | 生 HTML を返す (Regular/Advanced はパース済み JSON) | モード依存 |

### 1.3 価格 (Google Organic)
- Standard Normal: **$0.60 / 1000 SERP** ($0.0006/req)
- Standard High: **$1.20 / 1000 SERP** ($0.0012/req)
- Live Regular/Advanced: **$2.00 / 1000 SERP** ($0.002/req)
- 追加パラメータ (load_resources / enable_javascript 等) で 5倍ずつ加算
- **AI Overview トラッキング**: +$0.60 / 1000 KW (アドオン)
- Google AI Mode Live Advanced: $0.004/task (rectangle 有効化で 2倍)

### 1.4 日本サポート
- `location_code=2392` (Japan), `language_code=ja` ともに完全対応。
- デバイス: desktop / mobile (iOS/Android) 切替可。

### 1.5 取得可能フィールド (Google Organic Live Advanced)
公式: https://docs.dataforseo.com/v3/serp/google/organic/live/advanced/

**メタ:** `keyword`, `type`, `se_domain`, `location_code`, `language_code`, `check_url`, `datetime`, `spell`, `item_types`, `se_results_count`, `pages_count`, `items_count`

**SERP 要素 (item_types):**
`organic`, `paid`, `carousel`, `multi_carousel`, `answer_box`, `featured_snippet`, `google_flights`, `google_reviews`, `third_party_reviews`, `google_posts`, `images`, `jobs`, `knowledge_graph`, `local_pack`, `hotels_pack`, `map`, `people_also_ask`, `related_searches`, `people_also_search`, `shopping`, `top_stories`, `twitter`, `video`, `events`, `recipes`, `scholarly_articles`, `popular_products`, `podcasts`, `local_services`, `google_hotels`, **`ai_overview`**

**organic 各要素のフィールド:**
`rank_group`, `rank_absolute`, `page`, `position`, `xpath`, `domain`, `title`, `url`, `cache_url`, `breadcrumb`, `description`, `images[]`, `rating`, `price`, `links[]`, `timestamp`, `rectangle` (ピクセル座標)

**ai_overview / Google AI Mode 専用 (https://docs.dataforseo.com/v3/serp/google/ai_mode/live/advanced/):**
- `markdown` — AI Overview 本文 (Markdown)
- `text` — 本文プレーンテキスト
- `title`
- `links[]` — 引用先 URL リスト
- `images[]` — 画像と alt
- `references[]` — 引用元ページ (source name / domain / url / title / **AI 生成元として使われたテキストスニペット**)

**Japan の AI Overview:** Google AI Mode のドキュメントでは「Japan は明記されていない」(要確認)。ただし通常の Organic SERP に含まれる `ai_overview` element は location=Japan でも返る可能性あり (要実測)。

### 1.6 KW評価への応用
- **実 SERP TOP10〜100** が取れるので競合ドメイン抽出・占有度判定 (現 `competitionAnalyzer` を Brave/CSE から差し替え可)。
- **AI Overview の有無 + references** が取れる = **LLMO 評価**の中核データに直結 (Geminiの引用元に自分のサイトが入っているかチェック可)。
- People Also Ask / Related Searches で**サブKW自動展開**。
- Featured Snippet / Knowledge Graph 占有確認 → 「ゼロクリックリスク」評価指標に。

---

## 2. Keywords Data API

公式: https://docs.dataforseo.com/v3/keywords_data/overview/

### 2.1 サブカテゴリ
1. **Google Ads** (本家 Keyword Planner 系)
2. **Bing Ads**
3. **Google Trends**
4. **DataForSEO Trends** (独自クリックストリーム合成)
5. **Clickstream Data** (匿名ユーザー行動データ)

### 2.2 Google Ads / Search Volume Live
公式: https://docs.dataforseo.com/v3/keywords_data/google_ads/search_volume/live/

**取れるフィールド:**
- `search_volume` — 月間平均検索ボリューム
- `monthly_searches[]` — 直近12ヶ月の月次ボリューム配列
- `cpc` — Cost Per Click (USD)
- `low_top_of_page_bid`, `high_top_of_page_bid` — 入札レンジ
- `competition` — HIGH / MEDIUM / LOW
- `competition_index` — 0-100 スケール
- `spell` — スペル補正後KW
- `keyword`, `location_code`, `language_code`, `search_partners` フラグ

**制限:**
- 1リクエストあたり最大 **1000 KW**
- レート: 12 req/min (API全体は 2000 req/min)
- 履歴: 過去 **24ヶ月** まで

**日本サポート:** 完全対応。location_code=2392, language_code=ja。

**注意:** 武器・タバコ・薬物等のポリシー違反KWが1つでも混じるとバッチ全体が NULL になる。

### 2.3 Google Trends Explore Live
公式: https://docs.dataforseo.com/v3/keywords_data/google_trends/explore/live/

**type:** `web` / `news` / `youtube` / `images` / `froogle` (Shopping)

**time_range:** `past_hour`, `past_4_hours`, `past_day`, `past_7_days`, `past_30_days`, `past_90_days`, `past_12_months`, `past_5_years`, `2004_present` (web), `2008_present` (他)

**返却データ:**
- `interest_over_time` — タイムスタンプ + values(0-100)
- `interest_by_subregion` — 地域別ヒートマップ
- `related_topics` — 関連トピック (topic_id / title / popularity)
- `related_queries` — top + rising クエリ

**コスト:** 公式記載 ~$1.00 / 1000 task
**制限:** 250 live task/分、Google Trends系合計で 500K req/日
**日本サポート:** 完全対応。

### 2.4 DataForSEO Trends Explore Live
公式: https://docs.dataforseo.com/v3/keywords_data/dataforseo_trends/explore/live/

- Google Trends の**代替/補完**版。独自にクリックストリーム+Search+News+Shoppingを合成。
- 最大 **5KW** / req
- 週次集計の `dataforseo_trends_graph` (timestamp / values 0-100)
- Google Trends より広い対象期間・データ密度が利点。

### 2.5 Clickstream Search Volume Live
公式: https://docs.dataforseo.com/v3/keywords_data/clickstream_data/dataforseo_search_volume/live/

- `use_clickstream=true` で **Bing検索ボリューム + クリックストリームデータ正規化** された SV を返す
- Google Ads 値の代替・補完として有効 (Google Ads データが偏っているニッチKWで実態に近い値)
- 1000 KW / req

### 2.6 Bing Ads (補助)
- Bing 側の SV / CPC / Competition。日本市場では補助指標。

### 2.7 KW評価への応用
- **核となる SV / CPC** は Google Ads Search Volume Live で取る (バッチで安い)。
- **季節性判定** → Google Trends `past_12_months` の interest_over_time の標準偏差/最大値で判定。
- **クリックストリーム** = Google Ads が0返す主婦系ニッチKW (例: "離乳食 ストック 100均") の SV 取得に有効。

---

## 3. DataForSEO Labs API

公式: https://docs.dataforseo.com/v3/dataforseo_labs/overview/

**特徴:** Live のみ。data freshness は週次更新。最安・最強の組み合わせ。

**価格モデル (Google API のほぼ全エンドポイント共通):**
- task setup: **$0.01**
- per item: **$0.0001**
- 1000 KW を 1 req で投げて **$0.11**
- `include_clickstream_data=true` で 2倍課金

### 3.1 Keyword Overview Live
公式: https://docs.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live/

**返却フィールド (1KWあたり超リッチ):**

| グループ | フィールド |
|---|---|
| `keyword_info` | `search_volume`, `cpc`, `competition`, `competition_level`, `monthly_searches[]`, `categories[]`, `low_top_of_page_bid`, `high_top_of_page_bid`, `last_updated_time` |
| `keyword_properties` | `keyword_difficulty` (0-100), `detected_language`, `core_keyword`, `synonym_clustering_algorithm` |
| `serp_info` | `se_results_count`, `serp_item_types[]`, `last_updated_time` |
| `avg_backlinks_info` | TOP10 平均の `backlinks`, `dofollow`, `referring_pages`, `referring_domains`, `referring_main_domains`, `rank` |
| `search_intent_info` | `main_intent`, `foreign_intent[]` |
| `keyword_info_normalized_with_bing` | Bing正規化SV |
| `keyword_info_normalized_with_clickstream` | クリックストリーム正規化SV |
| `clickstream_keyword_info` | 性別・年齢分布 |

**コスト:** 1KW で **$0.0101** (task $0.01 + item $0.0001)
**最大:** 1 req で **1000 KW** 一括 → $0.11

**日本サポート:** 「locations_and_languages」エンドポイントで一覧取得。Japan (2392/ja) 対応 (要確認だが他 Labs エンドポイント同様対応の見込み)。

### 3.2 Keyword Suggestions Live
公式: https://docs.dataforseo.com/v3/dataforseo_labs/google/keyword_suggestions/live/

- seed KW から autocomplete 系の suggestion を最大 **1000件**。
- 各候補に Overview と同じフルメトリクス (SV/CPC/KD/intent/backlinks) が付く。
- フィルター8個 + ソート3個。

### 3.3 Related Keywords Live
公式: https://docs.dataforseo.com/v3/dataforseo_labs/google/related_keywords/live/

- "他の人はこちらも検索" 系。
- `depth` パラメータ:
  - 0: seed のみ
  - 1: ~8 KW
  - 2: ~72 KW
  - 3: ~584 KW
  - 4: ~4680 KW (上限)
- 各 KW に SV / KD / intent / SERP / backlinks フル付き。

### 3.4 Keyword Ideas Live
公式: https://docs.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live/

- 最大 **200 seed KW** を投げて、同カテゴリの新規 KW アイデア。
- Suggestions と違って autocomplete ではなく**カテゴリベース類似性**マッチング。

### 3.5 Bulk Keyword Difficulty Live
公式: https://docs.dataforseo.com/v3/dataforseo_labs/google/bulk_keyword_difficulty/live/

- **1000 KW** を 1 req で投げて KD だけ返す = 最安の KD バルク取得。
- `keyword_difficulty` (0-100、対数スケール = TOP10 入り難易度)
- KD 単体で良ければ Overview より安い。

### 3.6 Historical Search Volume Live
公式: https://docs.dataforseo.com/v3/dataforseo_labs/google/historical_search_volume/live/

- **2019年以降** の月次 SV 履歴。
- `search_volume_trend` で monthly / quarterly / yearly の%変化。
- 季節性判定に直結。

### 3.7 SERP Competitors Live
公式: https://docs.dataforseo.com/v3/dataforseo_labs/google/serp_competitors/live/

- 最大 **200 KW** を投げて、上位に出てくる**競合ドメイン**を集計。
- 返却: `domain`, `avg_position`, `median_position`, `visibility` (1.0=TOP10, 0.05=11-20, 0=20+), `etv` (推定流入), `keywords_count`, `intersections`
- ニッチでの強い競合ドメインを一発で洗い出せる。

### 3.8 Ranked Keywords Live
公式: https://docs.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live/

- ドメインを投げて、そのドメインが**ランクインしている全 KW** を取得。
- 各 KW について position / SV / etv / 変動 (is_new/is_up/is_down/is_lost)
- **AI Overview reference** に出ているかも別カラムで返る → LLMO 評価で必須。

### 3.9 Domain Rank Overview Live
公式: https://docs.dataforseo.com/v3/dataforseo_labs/google/domain_rank_overview/live/

- ドメインの SERP プレゼンス全体像。
- pos_1 / pos_2_3 / pos_4_10 ... pos_91_100 の分布
- organic / paid 別 etv, estimated_paid_traffic_cost
- 競合ドメインの全体力を一発判定。

### 3.10 Search Intent Live
公式: https://docs.dataforseo.com/v3/dataforseo_labs/google/search_intent/live/

- 1000 KW 一括で 4分類 intent + 確率(0-1)。
- **38言語サポートに日本語含む** (公式明記)。
- 価格: task $0.001 + KW $0.0001 (他より task setup 安い)

### 3.11 その他 Labs 系
- **Categories For Domain / For Keywords** — 商品カテゴリ分類
- **Top Searches** — トップ検索KW
- **Domain Intersection** — 2ドメインのKW共通集合
- **Subdomains / Relevant Pages** — ドメインの中で強いページ
- **Historical Rank / Historical SERPs** — 過去 SERP スナップショット ($0.0001/SERP = 1000 で $0.10)
- **Bulk Traffic Estimation / Bulk Backlinks Rank / Bulk SERP Volume** — 1000ドメイン一括メトリクス
- **App Store / Amazon 系 Labs** — アプリストア・Amazon内検索の同等機能

### 3.12 KW評価への応用 (本命)
**Brave + Gemini 五軸評価を完全置換できる構成案:**

1. **Step 0** (種KW入力): `keyword_expander` (Gemini) で関連KW膨張
2. **Step 1**: **Bulk Keyword Difficulty Live** で 1000KW 一括 KD 取得 → $0.11/1000KW = **円換算 17円**で振るい分け
3. **Step 2**: KD 低 + SV 中の上位 100KW について **Keyword Overview Live** でフルメトリクス取得 → $0.021 = 約 3円
4. **Step 3**: 残った候補 10KW について **SERP / Google / Organic Live Advanced** で実 SERP + AI Overview チェック → $0.02 = 約 3円
5. **季節性確認**: **Historical Search Volume Live** で 2019〜現在の SV カーブ → $0.0101/KW

**実コスト試算 (1KW評価あたり):** 全部回しても **5〜10円**程度。Ahrefs Lite ($129/月固定) と比べて**変動費型で柔軟**。

---

## 4. Backlinks API

公式: https://docs.dataforseo.com/v3/backlinks/overview/

### 4.1 エンドポイント
- `summary` — プロファイル要約
- `backlinks` — 個別バックリンクリスト
- `anchors` — アンカーテキスト統計
- `referring_domains` — リンク元ドメイン
- `referring_networks` — IP/subnet
- `history` — 履歴推移
- `domain_pages` / `domain_pages_summary` — ページ別
- `competitors` — リンクプロファイル類似ドメイン
- `domain_intersection` / `page_intersection` — 共通リンク元
- `timeseries_*` — 時系列指標
- `bulk_*` (ranks, spam_score, new_lost_backlinks, new_lost_referring_domains, pages_summary, traffic) — 1000target 一括

### 4.2 Summary フィールド主要
- 総 backlinks / referring_domains / referring_main_domains
- `rank` (0-1000 スケール or 0-100)
- `backlinks_spam_score`, `referring_domains_spam_score`
- `broken_backlinks`, `broken_pages`
- `referring_links_tld[]`, `referring_links_types[]`, `referring_links_attributes[]` (nofollow/sponsored/ugc)
- `anchor` 分布
- 地理的分布、プラットフォーム種別

### 4.3 制限
- 2000 req/min, 30 simultaneous
- カスタムフィルター無料。

### 4.4 KW評価への応用
- 競合上位ドメインの被リンク強度測定 → SERP上位入りの「現実的な壁」評価。
- 自サイトの内部測定にも使える。
- Ahrefs の完全代替候補 (Ahrefs Lite 撤退判断材料)。

### 4.5 価格
- 公式 pricing ページ未取得 (要確認)。一般的に Summary は安価、Backlinks 詳細は target 数で従量。

---

## 5. On-Page API

公式: https://docs.dataforseo.com/v3/on_page/overview/

### 5.1 機能
- カスタマイズ可能なクローラ。
- ページ別: SEO 監査 / 重複検出 / リダイレクトチェーン / 内部・外部リンク / non-indexable / ページスピード / キーワード密度 / リソース別 (img/css/js)
- Lighthouse 統合あり。

### 5.2 オプション (追加課金)
- `load_resources`, `enable_javascript`, `enable_browser_rendering`, `custom_js`, `calculate_keyword_density` 等で価格倍率増加。

### 5.3 価格
- ベース ~**$0.125 / 1000 page**

### 5.4 KW評価への応用
- 直接的な KW 評価ではなく、**自サイト内記事の品質チェック**で活用 (公開後の最適化)。

---

## 6. Content Analysis API

公式: https://docs.dataforseo.com/v3/content_analysis/overview/

### 6.1 エンドポイント
1. **Search** — 引用 (citation) を検索
2. **Summary** — 引用統計サマリー
3. **Sentiment Analysis** — positive/negative/neutral + 感情カテゴリ (anger, happiness, love, sadness, share desire, fun)
4. **Rating Distribution** — レーティング分布
5. **Phrase Trends** — フレーズの時系列引用データ
6. **Category Trends** — カテゴリ別時系列

### 6.2 用途
- ブランドモニタリング / 競合分析 / センチメント。
- 主婦KWの**情緒的訴求パターン**抽出に応用可。

### 6.3 価格
- 公式は未掲載 (Live のみ、req 単位)。

---

## 7. Merchant API

公式: https://docs.dataforseo.com/v3/merchant/overview/

### 7.1 プラットフォーム
- **Google Shopping** — 商品・価格・出品者・URL パラメータ
- **Amazon** — Organic + Paid 商品リスト、ASIN, バリエーション

### 7.2 機能
- Advanced (構造化JSON) + HTML
- Standard モードのみ (POST→GET 分離)
- Normal / High Priority

### 7.3 日本サポート
- Amazon Japan (amazon.co.jp) location 対応 (要 location_code 確認)。

### 7.4 KW評価への応用
- **amazon_affiliate kind プロジェクトの主軸**:
  - KW で Amazon を引いて「ベストセラー上位の競合度」を測る
  - 商品 ASIN → レビュー数・価格帯 → アフィリエイト記事ネタの「売れ筋確証」
- PA-API 補完にも使える (Step 3 タスク #65 と連動可能)。

---

## 8. Domain Analytics API

公式: https://docs.dataforseo.com/v3/domain_analytics/overview/

### 8.1 サブ API
1. **Whois API** — 登録情報 + 被リンク統計 + organic/paid ranking + traffic
2. **Technologies API** — 使用技術検出 (CMS / アナリティクス / 広告ネットワーク等) を domain / technology / category / group で集計

### 8.2 仕様
- Live only。
- KW評価への直接利用は限定的。競合サイトの技術スタック調査・買収候補リサーチ向け。

---

## 9. App Data API

公式: https://docs.dataforseo.com/v3/app_data/overview/

### 9.1 プラットフォーム
- Google Play
- Apple App Store

### 9.2 機能
- Advanced (構造化) / HTML (Google のみ)
- KW / app_id / collection によるリサーチ
- ランキング・レビュー・カテゴリ・featured collection

### 9.3 KW評価
- 主婦アプリ系の競合調査に応用可だが、note 自動投稿の本筋ではない。

---

## 10. Business Data API

公式: https://docs.dataforseo.com/v3/business_data/overview/

### 10.1 サポートプラットフォーム
- Google (My Business / Hotels / Reviews / Q&A)
- Trustpilot
- Tripadvisor
- Pinterest
- Reddit
- Business Listings Database

### 10.2 機能
- Live / Standard 両対応
- 日本対応は要 endpoint 別確認

### 10.3 KW評価
- ローカル系・店舗系KW評価で利用可。主婦note向けには限定的。
- **Reddit 取得**は LLMO 評価 (Gemini AI Overview が Reddit を引用する傾向強) に有効。

---

## 11. AI Optimization API (LLMO)

公式: https://docs.dataforseo.com/v3/ai_optimization/overview/

> **これが MultiPostAI で最も注目すべき新カテゴリ。LLM の検索結果に対する自サイト露出を測れる。**

### 11.1 サブ API
1. **LLM Responses API** — ChatGPT / Claude / Gemini / Perplexity に対してリアルタイムにプロンプトを投げて構造化レスポンスを取得
2. **LLM Scraper API** — ChatGPT 検索結果を KW ベースで取得
3. **AI Keyword Data API** — LLM 内での KW 使用頻度 (AI 検索ボリューム + intent)
4. **LLM Mentions API** — KW / ブランド / サイトが LLM でどう言及されるかをトラッキング (AI 検索ボリューム、インプレッション、言及頻度)

### 11.2 メソッド
- LLM Responses / Scraper: Live + Standard
- AI Keyword Data / LLM Mentions: **Live only**

### 11.3 価格
- 公式 pricing ページ参照: https://dataforseo.com/pricing/ai-optimization (要確認)

### 11.4 KW評価への応用 (重要)
- **「Gemini AI Overview に自分の note が引用されているか」を自動測定**できる = LLMO スコアの根拠データ。
- 主婦KW に対して ChatGPT/Gemini が何を答えるかを取得 → 「AI が既に答えているKW」(=ゼロクリック寄り) を回避する判定材料。
- これはコード改修 (#73 周辺) で SERP API の AI Overview と組み合わせて使うと強力。

---

## 12. Databases (補足)

事前構築データセット (Backlinks / SERPs / Keywords / E-commerce) を一括ダウンロード可能。
リアルタイム性は不要だが大量のオフラインデータが欲しい場合に有効。MultiPostAI では当面不要。

---

# KW評価ロジック構築用の推奨組み合わせ

## A. 「とにかく安く広く」プラン (種KW → ロングテール100候補)
1. seed KW を `keywordExpander` (Gemini) で30個程度に展開
2. **Bulk Keyword Difficulty Live** (Labs) で 1000KW までまとめて KD 取得 → $0.11
3. KD ≤ 30 のものに絞り込み
4. その結果に対して **Google Ads Search Volume Live** で SV/CPC バッチ取得 → 12 req/min 制限注意

**1サイクル: ~$0.15 (約23円)**

## B. 「上位候補を精査」プラン (Top10候補 → 採用判断)
各 KW について:
1. **Keyword Overview Live** で全メトリクス取得 → KD/SV/CPC/intent/avg_backlinks
2. **SERP / Google / Organic Live Advanced** で実 SERP TOP100 + AI Overview/PAA/Featured Snippet → 競合占有度判定
3. **Historical Search Volume Live** で2019〜のトレンドカーブ → 季節性判定
4. (任意) **SERP Competitors Live** で競合ドメイン洗い出し

**1KWあたり: ~$0.03 (約5円)**

## C. 「LLMO 評価まで含める」フルプラン
B に加えて:
5. **AI Optimization / LLM Mentions API** で対象 KW の Gemini 言及をチェック
6. **Content Analysis / Sentiment** で主婦市場の情緒トーン分析

**1KWあたり: ~$0.05〜$0.10 (約8〜15円)**

## D. 競合ドメイン精査 (任意・スカウト時)
- **Backlinks Summary Live** + **Domain Rank Overview Live** で TOP10 サイトの「資産力」を計測 → 勝てる戦か判定

---

# 日本市場サポート確認状況

| API カテゴリ | location_code=2392 / language_code=ja 動作 |
|---|---|
| SERP / Google Organic | ✅ 公式明記 |
| SERP / Google AI Mode | ⚠️ 要確認 (公式に Japan 明記なし) |
| SERP / Bing, YouTube, Yahoo | ✅ (Yahoo Japan は別途要確認) |
| Keywords Data / Google Ads | ✅ 公式明記 |
| Keywords Data / Google Trends | ✅ |
| Keywords Data / DataForSEO Trends | ✅ (location_code で指定) |
| Keywords Data / Clickstream | ✅ (Bing 経由) |
| Labs / Google 系 | ✅ (locations_and_languages 経由で確認可) |
| Labs / Search Intent | ✅ 38言語に日本語明記 |
| Backlinks | ✅ (グローバル) |
| On-Page | ✅ (URL ベースなので国非依存) |
| Merchant / Amazon | ✅ Amazon JP 対応 |
| Merchant / Google Shopping | ✅ |
| Business Data | ⚠️ プラットフォーム別に要確認 |
| Domain Analytics | ✅ (グローバル) |
| App Data | ✅ |
| AI Optimization | ⚠️ 要確認 (新カテゴリ) |
| Content Analysis | ⚠️ 要確認 |

---

# 価格まとめ (確認済みのみ)

> 最終的な見積もりは公式 pricing ページで再確認すること。記載値は2026年6月時点。

| API | 価格 |
|---|---|
| SERP / Google Organic Standard Normal | $0.60 / 1000 SERP |
| SERP / Google Organic Standard High | $1.20 / 1000 SERP |
| SERP / Google Organic Live | $2.00 / 1000 SERP |
| SERP / Google AI Mode Live Advanced | $4.00 / 1000 task |
| SERP / AI Overview Tracking add-on | +$0.60 / 1000 KW |
| Keywords Data / Google Trends Explore | ~$1.00 / 1000 task |
| Keywords Data / Google Ads Search Volume | 要 pricing ページ確認 |
| Labs / 大半のエンドポイント | task $0.01 + item $0.0001 = $0.11 / 1000 items |
| Labs / Search Intent | task $0.001 + item $0.0001 = $0.101 / 1000 items |
| Labs / Historical Rank | task $0.1 + item $0.001 = $1.10 / 1000 items |
| Labs / Historical SERPs | $0.0001 / SERP = $0.10 / 1000 |
| On-Page | ~$0.125 / 1000 page (オプションで増額) |
| Clickstream | use_clickstream=true で 2倍課金 |
| 最低支払額 | $50 |

---

# 結論

DataForSEO 一本で MultiPostAI の KW 評価ロジック (SV / CPC / KD / SERP / 関連KW / トレンド / Intent / 競合 / AI Overview) は **完全網羅可能**。Ahrefs を撤退しても情報量は減らない。むしろ AI Mode / AI Optimization 系で **LLMO 評価という新軸**を得られるので、note の「Gemini AI Overview に拾われる記事を狙う」戦略と相性が良い。

**実装優先順位 (推奨):**
1. `lib/dataforseo.ts` を Bulk Keyword Difficulty + Keyword Overview 中心に再構成
2. `competitionAnalyzer.ts` を SERP / Google / Organic Live Advanced に置換 (AI Overview 取得を含める)
3. Historical Search Volume を「季節性」軸として追加
4. (将来) AI Optimization API で LLMO 軸を追加

---

# 主要参照 URL

- API トップ: https://docs.dataforseo.com/v3/
- SERP API: https://docs.dataforseo.com/v3/serp/overview/
- Google Organic Live Advanced: https://docs.dataforseo.com/v3/serp/google/organic/live/advanced/
- Google AI Mode: https://docs.dataforseo.com/v3/serp/google/ai_mode/live/advanced/
- Keywords Data: https://docs.dataforseo.com/v3/keywords_data/overview/
- Google Ads Search Volume Live: https://docs.dataforseo.com/v3/keywords_data/google_ads/search_volume/live/
- Google Trends Explore: https://docs.dataforseo.com/v3/keywords_data/google_trends/explore/live/
- DataForSEO Trends: https://docs.dataforseo.com/v3/keywords_data/dataforseo_trends/explore/live/
- Clickstream Search Volume: https://docs.dataforseo.com/v3/keywords_data/clickstream_data/dataforseo_search_volume/live/
- Labs Overview: https://docs.dataforseo.com/v3/dataforseo_labs/overview/
- Labs / Keyword Overview: https://docs.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live/
- Labs / Keyword Suggestions: https://docs.dataforseo.com/v3/dataforseo_labs/google/keyword_suggestions/live/
- Labs / Related Keywords: https://docs.dataforseo.com/v3/dataforseo_labs/google/related_keywords/live/
- Labs / Keyword Ideas: https://docs.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live/
- Labs / Bulk Keyword Difficulty: https://docs.dataforseo.com/v3/dataforseo_labs/google/bulk_keyword_difficulty/live/
- Labs / Historical Search Volume: https://docs.dataforseo.com/v3/dataforseo_labs/google/historical_search_volume/live/
- Labs / SERP Competitors: https://docs.dataforseo.com/v3/dataforseo_labs/google/serp_competitors/live/
- Labs / Ranked Keywords: https://docs.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live/
- Labs / Domain Rank Overview: https://docs.dataforseo.com/v3/dataforseo_labs/google/domain_rank_overview/live/
- Labs / Search Intent: https://docs.dataforseo.com/v3/dataforseo_labs/google/search_intent/live/
- Backlinks Overview: https://docs.dataforseo.com/v3/backlinks/overview/
- Backlinks Summary: https://docs.dataforseo.com/v3/backlinks/summary/live/
- On-Page Overview: https://docs.dataforseo.com/v3/on_page/overview/
- Content Analysis: https://docs.dataforseo.com/v3/content_analysis/overview/
- Merchant Overview: https://docs.dataforseo.com/v3/merchant/overview/
- Domain Analytics: https://docs.dataforseo.com/v3/domain_analytics/overview/
- App Data: https://docs.dataforseo.com/v3/app_data/overview/
- Business Data: https://docs.dataforseo.com/v3/business_data/overview/
- AI Optimization: https://docs.dataforseo.com/v3/ai_optimization/overview/
- 価格トップ: https://dataforseo.com/pricing
