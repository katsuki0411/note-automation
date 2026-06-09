# DataForSEO で取れる情報 ガイド (ユーザー向け)

> 作成: 2026-06-09
> 対象読者: 小社長 / 開発パートナー / 運用スタッフ
> 補足: 技術詳細版は `DFS_API_INVENTORY.md` に網羅 (602行)。
> こちらは「**何が取れて、どう使えるか**」を例付きでまとめた読み物版です。

---

## 0. 全体マップ

DataForSEO は次の12カテゴリに分かれています。MultiPostAI で関係するのは上6つ、下6つは将来の選択肢として頭の片隅に置いておく感じで OK。

**主要 (KW評価に直結):**
- SERP — Google上位N件と SERP feature の取得
- Keywords Data — 検索ボリューム / CPC / Trends
- DataForSEO Labs — KD / 関連KW / 競合分析 (一番の主力)
- Backlinks — 被リンク量 / ドメイン強度
- Content Analysis — 言及・引用追跡
- AI Optimization — ChatGPT/Gemini/Claude/Perplexity への露出測定 (LLMO)

**補助系 (将来必要になれば):**
- On-Page — 技術 SEO 監査
- Merchant — Amazon / Google Shopping データ
- Domain Analytics — Whois / テクノロジー検出
- App Data — App Store / Google Play
- Business Data — Google My Business / Trustpilot
- Databases — 過去データのバルク取得

---

## 1. いま MultiPostAI で稼働中 (3つ)

### 1-1. Bulk Keyword Difficulty (一括 KD 取得)

「100個の KW を、いきなり安く KD だけ調べる」用途。

**何が取れるか**: KD (キーワード難易度、0-100、低いほど狙いやすい) のみ
**1リクエスト**: 最大100KW
**価格**: $0.011 / 100KW (約 1.7円)
**用途**: スカウト初期段 → 「100KW中 KD<30 の30件だけ次段に」

**レスポンス例 (抜粋)**:
```json
{
  "items": [
    { "keyword": "ベビーカー 軽量", "keyword_difficulty": 18 },
    { "keyword": "ベビーカー 折りたたみ", "keyword_difficulty": 24 },
    { "keyword": "ベビーカー 比較", "keyword_difficulty": 56 }
  ]
}
```

**ここから分かること**:
- 「ベビーカー 軽量」KD=18 → 個人ブログでも上位狙える
- 「ベビーカー 比較」KD=56 → 大手強い、避けた方が無難

公式: https://docs.dataforseo.com/v3/dataforseo_labs/google/bulk_keyword_difficulty/live/

---

### 1-2. Keyword Overview (KW の全指標を一発取得)

「絞り込んだ KW について、本気で評価するための数値を全部取る」用途。

**何が取れるか**:
- search_volume — 月間検索数
- cpc — Google広告のクリック単価 (USD)
- competition — 広告競合度 (0-1)
- competition_level — LOW / MEDIUM / HIGH
- keyword_difficulty — KD (0-100)
- search_intent — informational / navigational / commercial / transactional
- monthly_searches — 過去12ヶ月のSV履歴
- serp_info — SERP に何が出るか (organic / shopping / video など)
- avg_backlinks_info — 上位サイトの平均被リンク数

**1リクエスト**: 最大1000KW
**価格**: $0.0101 / 1KW (約 1.5円)
**用途**: Stage 4 = 数値による2次絞り込みの根拠

**レスポンス例 (抜粋)**:
```json
{
  "keyword": "ベビーカー 軽量",
  "keyword_info": {
    "search_volume": 2400,
    "cpc": 0.85,
    "competition": 0.42,
    "competition_level": "MEDIUM",
    "monthly_searches": [
      { "year": 2026, "month": 5, "search_volume": 2200 },
      { "year": 2026, "month": 4, "search_volume": 2900 },
      { "year": 2026, "month": 3, "search_volume": 3100 }
    ]
  },
  "keyword_properties": { "keyword_difficulty": 18 },
  "search_intent_info": { "main_intent": "commercial" },
  "avg_backlinks_info": { "backlinks": 142, "referring_domains": 38 },
  "serp_info": { "item_types": ["organic", "people_also_ask", "shopping"] }
}
```

**ここから分かること**:
- 月2400検索 × CPC 0.85 → 広告主が払ってる = ニーズあり
- intent=commercial → 比較・購入意欲ある層が検索
- 上位サイトの被リンク 142本 → そこそこ評価された記事を書く必要あり
- SERP に shopping が出る → 商品紹介系が刺さる

公式: https://docs.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live/

---

### 1-3. SERP Organic Live Advanced (上位N件 + 全 feature)

「実際の Google 検索結果ページを丸ごと取って、AI Overview や PAA も全部読む」用途。

**何が取れるか**:
- 上位N件の URL / タイトル / ディスクリプション / 順位
- AI Overview の本文 + 引用元 (LLMO評価の中核)
- Featured Snippet (0位枠)
- Knowledge Panel (右側の Wikipedia 風枠)
- People Also Ask (他の人はこちらも質問)
- Shopping (商品ボックス)
- Top Stories (ニュース枠)
- Video (動画枠)
- Image (画像枠)

**価格**: $2.00 / 1000 SERP (約 0.3円/KW)
**用途**: Stage 6 = 採用候補 KW について SERP全要素を取得

**レスポンス例 (抜粋)**:
```json
{
  "items": [
    {
      "type": "ai_overview",
      "references": [
        { "url": "https://kakaku.com/...", "title": "ベビーカー 軽量 おすすめ" },
        { "url": "https://mybest.com/...", "title": "軽量ベビーカー 2026年版" }
      ]
    },
    {
      "type": "featured_snippet",
      "url": "https://example.com/...",
      "title": "軽量ベビーカーの選び方"
    },
    {
      "type": "people_also_ask",
      "items": [
        { "title": "軽量ベビーカーのデメリットは?" },
        { "title": "ベビーカーは何キロから重い?" }
      ]
    },
    {
      "type": "organic",
      "rank_absolute": 1,
      "url": "https://mybest.com/...",
      "title": "【2026年】軽量ベビーカーのおすすめ人気10選"
    }
  ]
}
```

**ここから分かること**:
- AI Overview に kakaku.com / mybest.com が引用されている → Gemini がこの2つを「信頼している」
- PAA 「ベビーカーは何キロから重い?」 → そのまま記事の見出しに使える
- 上位1位が mybest → 大手比較メディアと戦うことになる

公式: https://docs.dataforseo.com/v3/serp/google/organic/live/advanced/

---

## 2. すぐ追加できる API 群 (DFS契約だけで使える)

### 2-A. KW拡張系 — Gemini が思いつかない KW を補完

**Keyword Suggestions** — 「ベビーカー」と入れたら、Google autocomplete で出る系の KW を数千件
```json
{
  "items": [
    { "keyword": "ベビーカー おすすめ", "search_volume": 49500 },
    { "keyword": "ベビーカー 軽量", "search_volume": 2400 },
    { "keyword": "ベビーカー ベビーザらス", "search_volume": 1300 }
  ]
}
```
公式: https://docs.dataforseo.com/v3/dataforseo_labs/google/keyword_suggestions/live/

**Related Keywords** — 「他の人はこちらも検索」の連鎖。depth=4 で4680KWまで展開可能
公式: https://docs.dataforseo.com/v3/dataforseo_labs/google/related_keywords/live/

**Keyword Ideas** — カテゴリ単位で関連KW (Google Ads と同じ発想)
公式: https://docs.dataforseo.com/v3/dataforseo_labs/google/keyword_ideas/live/

**Search Intent Bulk** — KW群を一括で intent 分類
公式: https://docs.dataforseo.com/v3/dataforseo_labs/google/search_intent/live/

**MultiPostAI での使い道**:
Gemini #1 で出した100件に加えて、DFS Related で取った関連KWを合体させる → Gemini が思いつかない実検索KWを拾える。「確からしさ」UP。

---

### 2-B. トレンド/季節性系 — 「いつ狙うか」を見る

**Historical Search Volume** — 2019年〜の月次SV履歴
```json
{
  "keyword": "海水浴 おすすめ",
  "monthly_searches": [
    { "year": 2025, "month": 7, "search_volume": 18000 },
    { "year": 2025, "month": 8, "search_volume": 22000 },
    { "year": 2025, "month": 12, "search_volume": 450 },
    { "year": 2026, "month": 2, "search_volume": 600 }
  ]
}
```
→ 「夏に向けて4月から仕込めば検索流入を取れる」と判断できる
公式: https://docs.dataforseo.com/v3/dataforseo_labs/google/historical_search_volume/live/

**Google Trends Explore** — interest_over_time / 関連トピック / 急上昇クエリ
公式: https://docs.dataforseo.com/v3/keywords_data/google_trends/explore/live/

**DataForSEO Trends Explore** — 独自トレンドデータ (より低コスト代替)
公式: https://docs.dataforseo.com/v3/keywords_data/dataforseo_trends/explore/live/

**Clickstream Search Volume** — Bingブラウザ拡張由来の「実クリック」データ
公式: https://docs.dataforseo.com/v3/keywords_data/clickstream_data/dataforseo_search_volume/live/

**MultiPostAI での使い道**:
「いま狙うべき季節KW」「3ヶ月後に書くべき先取りKW」を発掘する軸を追加できる。

---

### 2-C. 競合分析系 — 「誰と戦うか」を見る

**SERP Competitors** — 「これらのKW群で上位ランクしているドメインTop20」
```json
{
  "items": [
    {
      "domain": "mybest.com",
      "intersections": 28,
      "avg_position": 3.2,
      "etv": 145000
    },
    {
      "domain": "kakaku.com",
      "intersections": 19,
      "avg_position": 4.8,
      "etv": 82000
    }
  ]
}
```
→ 「ベビーカー周辺KWの実質的支配者は mybest と kakaku」と分かる
公式: https://docs.dataforseo.com/v3/dataforseo_labs/google/serp_competitors/live/

**Ranked Keywords** — 特定ドメインが上位ランクしている全KW (競合ドメイン分析用)
公式: https://docs.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live/

**Domain Rank Overview** — 競合ドメインの権威性 (Ahrefs DR 相当) / Organic Traffic
```json
{
  "metrics": {
    "organic": {
      "etv": 4250000,
      "count": 18000,
      "pos_1": 1200,
      "pos_2_3": 4100
    },
    "rank": 72
  }
}
```
→ 「DR=72 の強敵」「上位1位 1200個持ってる」と分かる
公式: https://docs.dataforseo.com/v3/dataforseo_labs/google/domain_rank_overview/live/

**Backlinks Summary** — 被リンク総数 / 参照ドメイン / spam score
公式: https://docs.dataforseo.com/v3/backlinks/summary/live/

**MultiPostAI での使い道**:
Ahrefs 完全置換が可能。SERP上位5ドメインの DR と被リンクを取れば「勝てる KW」判定できる。

---

### 2-D. LLMO系 — AI検索時代の評価軸 (note戦略の核)

**Google AI Mode** — AI Mode の引用元 + 回答テキスト
公式: https://docs.dataforseo.com/v3/serp/google/ai_mode/live/advanced/

**AI Optimization / LLM Mentions** — ChatGPT/Claude/Gemini/Perplexity がそのドメインを言及するか
```json
{
  "domain": "katsugram.com",
  "mentions": {
    "chatgpt": 12,
    "claude": 8,
    "gemini": 23,
    "perplexity": 15
  }
}
```
→ 「Gemini が一番拾ってくれてる」と分かる

**AI Optimization / LLM Responses** — LLM群に同じKWを投げた時の引用元
**AI Optimization / AI Keyword Data** — LLM 内での KW 露出スコア

公式: https://docs.dataforseo.com/v3/ai_optimization/overview/

**MultiPostAI での使い道**:
「Gemini AI Overview に拾われる記事を狙う」戦略の客観値が手に入る。これは MultiPostAI の差別化軸 (主婦向けKW で AI に拾われる記事) と直結。

---

### 2-E. その他カテゴリ — 参考まで

**Merchant** — Amazon商品データ / Google Shopping
- Amazon商品の売れ筋ランキング、レビュー数、価格推移
- 公式: https://docs.dataforseo.com/v3/merchant/overview/
- 使い道: 商品リサーチの自動化 (PA-API 補助)

**On-Page** — 技術 SEO 監査
- タイトル / メタ / 構造化データ / ページ速度
- 公式: https://docs.dataforseo.com/v3/on_page/overview/
- 使い道: 投稿後の記事品質チェック (将来の品質担保)

**Content Analysis** — ドメイン言及・センチメント
- 「katsugram.com」がどこから引用されているか追跡
- 公式: https://docs.dataforseo.com/v3/content_analysis/overview/

**Domain Analytics** — Whois / テクノロジー検出
- 公式: https://docs.dataforseo.com/v3/domain_analytics/overview/

**App Data** — App Store / Google Play
- 公式: https://docs.dataforseo.com/v3/app_data/overview/

**Business Data** — Google My Business / Trustpilot / Tripadvisor 等
- 公式: https://docs.dataforseo.com/v3/business_data/overview/

---

## 3. 価格まとめ (主要のみ)

- **Bulk Keyword Difficulty**: $0.011 / 100KW (約1.7円)
- **Keyword Overview**: $0.0101 / 1KW (約1.5円)
- **SERP Organic Live Advanced**: $2.00 / 1000 SERP (約0.3円/KW)
- **SERP + AI Overview tracking**: 追加 $0.60 / 1000 KW (約0.1円/KW)
- **Keyword Suggestions/Related/Ideas**: $0.11 / 1000 item (約0.02円/item)
- **Historical Search Volume**: $0.11 / 1000 KW (約0.02円/KW)
- **SERP Competitors**: $0.11 / 1000 KW (約0.02円/KW)
- **Domain Rank Overview**: $0.11 / 1000 ドメイン
- **Backlinks Summary**: $0.30 / 1000 ドメイン

最低支払い: **$50** (= 約7,500円、これを使い切ると追加チャージ)

**1スカウト (100KW スクリーニング → 10件精査 → 5件採用) の概算**:
- Bulk KD 100KW: ¥1.7
- Keyword Overview 30KW (KD通過): ¥45
- SERP Advanced 10KW: ¥3
- AI Overview 5KW: ¥0.5
- **合計: 約 ¥50 / スカウト**

---

## 4. 日本対応状況

公式で「日本対応」が明記されているもの (`location_code=2392`, `language_code=ja`):
- SERP / Google Organic
- Keywords Data / Google Ads
- Keywords Data / Google Trends
- Keywords Data / DataForSEO Trends
- Labs / Google 系すべて (Keyword Overview / Suggestions / Related / Ideas / Bulk KD / Historical SV / SERP Competitors / Ranked KW / Domain Rank / Search Intent)
- Merchant / Amazon JP

要確認 (公式に Japan 明記なし):
- SERP / Google AI Mode
- AI Optimization 系 (新カテゴリ)
- Business Data の各プラットフォーム

---

## 5. MultiPostAI への組み込み優先順位

「**確からしさ**」を上げる視点での優先順位:

1. 🥇 **Related Keywords + Keyword Suggestions** を Gemini #1 に補完
   - Gemini が思いつかない実検索KWを取り込み、スカウト初期母数の質を底上げ
2. 🥈 **Historical Search Volume** で季節性軸追加
   - 「今が旬」「3ヶ月後の旬」を可視化、記事仕込みタイミングが分かる
3. 🥉 **Domain Rank Overview + Backlinks Summary** を SERP上位5ドメインに適用
   - Ahrefs DR の完全置換、競合の本当の強さが見える
4. 🏅 **AI Optimization (LLMO)** を採用KWに適用
   - LLM 露出スコアという独自軸。MultiPostAI の戦略の核となる

---

## 6. 参照ドキュメント

- 技術詳細・全エンドポイント: `docs/DFS_API_INVENTORY.md` (602行)
- 公式トップ: https://docs.dataforseo.com/v3/
- 価格表: https://dataforseo.com/pricing
