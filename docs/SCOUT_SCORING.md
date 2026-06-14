# KW スカウト評価指標ガイド (2026-06-14 版)

`/products` の **KW スカウト機能** で、各 Stage がどんな数値で KW を評価しているか、
その**算出方法**と**根拠**をまとめたドキュメント。

> 実装ファイル: `src/lib/scoutPipeline.ts` / `src/lib/cvKw.ts` / `src/lib/dataforseo.ts` / `src/lib/keywordExpander.ts`

---

## 0. 全体フロー (7段パイプライン)

```
[ subject 入力 ] 例: "ピジョン 母乳実感"
   │
   ▼
Stage 0    DFS Related + Suggestions  → 実検索シード 約 30 件
Stage 1    Gemini #1                  → 100 KW 生成
Stage 2    DFS Search Volume Bulk     → SV / CPC / 競合 / 月別12ヶ月
Stage 2.5  DFS Bulk Keyword Difficulty → KD 取得 + KD 閾値で機械フィルタ ⭐NEW
Stage 3    Gemini #2                  → 30 件に絞り込み
Stage 3.5  DFS Search Intent          → Google 公式 intent ラベル
Stage 4    DFS SERP + CVKW スコア計算  → SERP / Top3 / CVKW スコア
Stage 5    Gemini #3                  → 最終判定 (adopt/borderline/reject)
   │
   ▼
[ 採用 KW 3-5 件 (rationale 付き) ]
```

**1スカウトのコスト**: 約 ¥45 (Gemini × 3 + DFS API × 5)
※ Stage 2.5 のコストは ¥1.65/100KW と非常に安価。Backlinks サブスク基本料は別途月 ¥17,800 (FastSpring 経由)。

---

## 1. Stage 0: 実検索シード取得

### 機能

入力商品名から「実際に Google で検索されている関連 KW」を取得して、Gemini #1 のハルシ抑制に使う。

### 使用 API

| API | エンドポイント | コスト |
|---|---|---|
| Related Keywords Live | `/dataforseo_labs/google/related_keywords/live` | ¥1.7 |
| Keyword Suggestions Live | `/dataforseo_labs/google/keyword_suggestions/live` | ¥1.8 |

### 評価指標

このステージは**評価しない**。後段に渡すシード集合を作るだけ。

### 出力例

```
seedKws (27件):
  - ピジョン 母乳実感 SS
  - ピジョン 母乳実感 違い
  - ピジョン 母乳実感 おすすめ
  ...
```

---

## 2. Stage 1: KW 候補生成 (Gemini #1)

### 機能

Stage 0 のシードを参考に、Gemini が**100 個の関連 KW**を生成する。

### 使用 API

| API | コスト |
|---|---|
| Gemini 2.5 Pro | ¥10 |

### 評価指標

Gemini 内部で「**CVKW 比率 70% 以上**」を強制 (プロンプト指示)。

| 比率 | 例 |
|---|---|
| 強CVKW 40% 以上 | "○○ 価格" / "○○ 最安" / "○○ amazon" / "○○ 楽天" / "○○ 通販" |
| 中CVKW 30% 以上 | "○○ おすすめ" / "○○ 比較" / "○○ 違い" / "○○ 口コミ" |
| 残り 30% | 派生・情報系 |

### 出力フィールド (1 KW あたり)

| フィールド | 例 | 意味 |
|---|---|---|
| `kw` | "ピジョン 母乳実感 価格" | KW 文字列 |
| `intent` | "purchase" | Gemini 推定 intent (purchase / comparison / how-to / info / review / trouble) |
| `reason` | "購入直前KW" | なぜこの KW を選んだか (記事化時に reason として再利用可能) |

### 根拠

- Gemini に「**Google で実際に検索されているデータ**」(seedKws) を参考にさせることで、検索されない造語 KW が混じるのを抑制。
- 「**CVKW 比率 70% 以上**」を強制することで、後段 Stage 5 で採用される KW の CV 直結度を担保。

---

## 3. Stage 2: SV/CPC 一括取得 (DFS Search Volume)

### 機能

100 KW すべての SV (検索数) / CPC (広告単価) / 競合度 / 月別12ヶ月SV を一括取得。

### 使用 API

| API | エンドポイント | コスト |
|---|---|---|
| Google Ads Search Volume Bulk | `/keywords_data/google_ads/search_volume/live` | ¥11 (100 KW分) |

### 取得指標と算出方法

| 指標 | 例 | 算出方法 | 根拠 |
|---|---|---|---|
| **search_volume** | 1,200 | Google Ads が記録した過去12ヶ月の月平均検索数 | Google Ads の広告主向け実データ |
| **cpc** | $0.07 (≒ ¥10) | 広告のクリック単価平均 | 広告主が実際に支払っている金額の中央値 |
| **competition_index** | 0-100 | 広告出稿者数の正規化値 | 100 に近いほど広告需要が高い |
| **competition** | HIGH / MEDIUM / LOW | competition_index の階級分け | HIGH ≒ 商業価値が高い (= アフィリ向き) |
| **monthly_searches** | [{year:2025, month:6, sv:1300}, ...] × 12 | 過去 12ヶ月分の月別 SV | 季節性算出に使用 |

### 派生計算: 季節性 (peakMonths / troughMonths)

```typescript
// src/lib/scoutPipeline.ts: calcSeasonality()
平均 = (12ヶ月のSV合計) / 12
peakMonths = SV が 平均 * 1.2 以上の月
troughMonths = SV が 平均 * 0.8 以下の月
```

#### 例

```
ベビーカー 軽量:
  4月 1000, 5月 1300, 6月 1300, 7月 1300, 8月 1300, 9月 1300
  10月 1000, 11月 880, 12月 720, 1月 880, 2月 880, 3月 1000

  平均 ≒ 1059
  peakMonths: [5, 6, 7, 8, 9] (春-夏ピーク = 出産シーズン)
  troughMonths: [11, 12, 1, 2] (冬底)
```

### 評価指標

このステージは**評価しない**。Stage 3/5 の Gemini が判断材料として使用。

### 根拠

- Google Ads は「広告主が実際に支払う料金」のため、**商業価値の絶対指標**。
- 月別12ヶ月で季節性を把握 → 公開タイミング戦略に活用。

---

## 4. Stage 3: 1次絞り込み (Gemini #2)

### 機能

100 KW を ~30 件 (`maxFinalCount`) に絞り込み。

### 使用 API

| API | コスト |
|---|---|
| Gemini 2.5 Pro | ¥4 |

### 評価基準 (Gemini プロンプト)

```
1. SV >= 100 (検索数が一定以上ある)
2. CPC >= ¥30 (広告出稿価値 = 商業意図)
3. dfs_intent が commercial / transactional 寄り
4. 「比較」「おすすめ」「口コミ」「使い方」など購入直前KW を優先
5. 同じ意味の重複 (例: "○○ 価格" と "○○ 値段") は片方だけ
6. 商品名と無関係なジャンル混入は除外
```

### 出力

- `selected`: 通過 KW リスト (~30 件)
- `rationale`: 全体の絞り込み方針説明

落選した KW は `rejectedCandidates[].stage = "stage3_rejected"` として記録 → UI の「①Gemini全候補」タブで確認可能。

### 根拠

- 単純な閾値ではなく Gemini が**「複合的な判断」**(SV低くても CVKW なら通す等) を行うことで、ロングテール KW を取りこぼさない。

---

## 5. Stage 3.5: Google 公式 intent 取得 (DFS Search Intent)

### 機能

Stage 3 通過した ~30 KW に対して、**Google AI が公式に判定した検索意図**を取得。

### 使用 API

| API | エンドポイント | コスト |
|---|---|---|
| Search Intent Bulk | `/dataforseo_labs/google/search_intent/live` | ¥2 |

### 取得指標

| ラベル | 意味 | 例 KW |
|---|---|---|
| **transactional** | 「買う直前」(購入クリック直結) | "○○ 価格", "○○ amazon", "○○ クーポン" |
| **commercial** | 「比較・検討中」 | "○○ おすすめ", "○○ 違い", "○○ 比較" |
| **navigational** | 「特定サイトに行く」 | "○○ 公式", "amazon ログイン" |
| **informational** | 「情報収集」 | "○○ とは", "○○ 使い方" |

加えて `probability` (確信度 0-1) も取得。

### 算出方法

Google 自身が学習データ (検索クエリ + クリック後の行動) から intent を推定したラベル。**ブラックボックスだが Google 公式の判定**。

### 根拠

- Gemini の推定よりも**実データに基づいた客観判定**。
- これ以降の Stage で「CV直結度の最重要因子」として使う。

---

## 6. Stage 4: SERP取得 + CVKW スコア計算

### A. SERP Top10 取得 (DFS)

#### 使用 API

| API | エンドポイント | コスト |
|---|---|---|
| SERP Organic Live Advanced | `/serp/google/organic/live/advanced` | ¥3 (30 KW分) |

#### 取得指標

| 項目 | 例 | 意味 |
|---|---|---|
| `items[].url` | https://bg-note.com/... | Top10 ページの URL |
| `items[].title` | "ピジョン母乳実感の比較" | Google が表示するタイトル |
| `items[].description` | "実際に使った感想..." | SERP スニペット |
| `features.hasAiOverview` | true | AI 要約が表示されているか |
| `features.hasPaa` | true | 関連質問枠があるか |
| `aiOverviewReferences[].domain` | support.pigeon.co.jp | AI 要約の引用元ドメイン |
| `paaQuestions` | ["どっちがいい?"] | 関連質問の質問文 |

#### 評価指標

このステージでは評価せず、Stage 5 の Gemini #3 が SERP 中身を見て判定。

#### 根拠

- 「**Top10 にどんなサイトが入っているか**」が「個人で食い込めるか」の最重要判断材料。
- mybest.com / Amazon / 楽天 が独占 = 個人ブログでは厳しい。
- bg-note.com / ameblo.jp 等の個人ブログ混じり = 食い込める可能性大。

---

### B. CVKW スコア計算 (ルールベース、API 不要) ⭐

各 KW に **`cvKwScore` (0-100)** を計算。

#### 算出方法 (`src/lib/cvKw.ts: calcCvKwScore()`)

```typescript
合計スコア = intentScore + tokenScore + brandScore  (上限 100)
```

| 要素 | 加点 | 根拠 |
|---|---|---|
| Google公式 intent = **transactional** | +40 | 「買う直前」だから |
| Google公式 intent = **commercial** | +25 | 「比較検討中」だから |
| Google公式 intent = navigational | +5 | 「サイト探し」(購入意図弱) |
| Google公式 intent = informational | 0 | 「情報収集」(購入意図最小) |
| **強CVKW 語**含む (「価格」「最安」「amazon」「楽天」「クーポン」等) | +30 | 購入直前の検索パターン |
| 中CVKW 語含む (「おすすめ」「比較」「違い」「口コミ」等) | +15 | 比較検討の検索パターン |
| 商標含む (subject から抽出した語) | +15 | ブランド狙い撃ち = CV直結 |

#### 例

| KW | intent | 強CV | 中CV | 商標 | **cvKwScore** | 分類 |
|---|---|---|---|---|---|---|
| ピジョン 母乳実感 価格 | transactional (40) | 価格 (30) | - | ピジョン (15) | **85** | 💰 強CVKW |
| ピジョン 母乳実感 違い | commercial (25) | - | 違い (15) | ピジョン (15) | **55** | 中CVKW |
| ピジョン 母乳実感 使い方 | informational (0) | - | - | ピジョン (15) | **15** | 非CVKW |

#### 4段階分類

| スコア | 分類 | UI バッジ色 | 採用判断 |
|---|---|---|---|
| 70-100 | **strong (強CVKW)** | emerald 強調 | adopt 優先 |
| 50-69 | **mid (中CVKW)** | teal | borderline 候補 |
| 30-49 | **weak (弱CVKW)** | amber | 場合により採用 |
| 0-29 | **none (非CVKW)** | gray | 原則 reject |

### 根拠

- **Google 公式 intent (実データ)** + **キーワードパターン (ルールベース)** + **商標含有 (確実な購入意図)** の3軸組合せ。
- KGI (個人開発受注獲得) のため、「CV直結度」を採用判定の最重要因子に据える。

---

## 7. Stage 5: 最終判定 (Gemini #3)

### 機能

すべての情報を総合して **adopt / borderline / reject** を判定。

### 使用 API

| API | コスト |
|---|---|
| Gemini 2.5 Pro | ¥8 (最も重い) |

### 評価基準 (Gemini プロンプト, CVKW 強化版)

```
【最重要: CV直結度を最優先に判定する】
- このプロジェクトは「主婦に CV (購入クリック) を促す」のが目的
- CVスコア (0-100) は KW の購入意図の強さを示す
- CVスコア >= 60 を強く優先
- CVスコア < 30 は原則 reject

【判定基準】
- adopt: CVスコア >= 60 + Top10 個人ブログ食い込み可能
       + Top3 が薄い (差別化容易) なら優先
- borderline: CVスコア 40-59、または CVスコア >= 60 だが Top10 大手中心
- reject: CVスコア < 40 or Top10 大手独占
```

### 出力指標

| フィールド | 範囲 | 意味 |
|---|---|---|
| `decision` | adopt / borderline / reject | 最終判定 |
| `finalScore` | 0-100 | 総合スコア (UI で「総合 85」と表示) |
| `rationale` | テキスト | 採用/却下の根拠 (説明用、記事生成にも転用) |

### 根拠

- **CVKW スコア (購入意図)** × **SERP 中身 (上位表示可能性)** × **Top3 ページ構造 (差別化容易性)** の3軸総合判断。
- 単純な閾値判定ではなく Gemini に「複合判断」を任せることで、エッジケースをカバー。

---

## 8. Stage 2.5: KD (Keyword Difficulty) フィルタ

### 現状

**Backlinks サブスク (Active trial 〜2026-06-28) により KD 実数値を取得**。
Stage 2.5 で機械的に高 KD KW を除外し、Stage 3 Gemini #2 のトークン削減 + 採用品質向上を実現。

### 使用 API

| API | 取得内容 | コスト |
|---|---|---|
| Bulk Keyword Difficulty Live | 100 KW の KD (0-100) 一発取得 | ¥1.65/100 KW |
| **エンドポイント** | `/dataforseo_labs/google/bulk_keyword_difficulty/live` | |

### 評価指標

| KD | Top10 の様子 | 個人ブログの勝率 | スカウトの扱い (maxKd=30 デフォルト) |
|---|---|---|---|
| 0-20 | 個人ブログ中心 | ◎ 1-3 ヶ月で上位 | ✅ 強推奨で通過 |
| 21-30 | 中堅ブログ混じる | ○ 6 ヶ月で勝負 | ✅ 通過 |
| 31-50 | 大手メディア混じる | △ 1 年戦略要 | ❌ 機械的に除外 |
| 51-70 | 大手中心 | ✗ 個人では厳しい | ❌ 機械的に除外 |
| 71+ | 巨大ドメイン独占 | ✗✗ 無理ゲー | ❌ 機械的に除外 |

### KD の算出根拠 (DataForSEO 仕様)

| | 詳細 |
|---|---|
| 定義 | 検索結果 Top10 ページに食い込む難易度 (0-100) |
| 算出方法 | Top10 ページの被リンク数 (RD) + ドメイン権威 (DR) の中央値を正規化 |
| 根拠 | DataForSEO が自社の Backlinks データベース (数兆リンク) から算出 |

### maxKd 設定

| 設定 | 動作 | 推奨シーン |
|---|---|---|
| 30 (デフォルト) | KD ≤ 30 のみ通過。個人ブログで確実に勝てる範囲 | 通常運用 |
| 50 | KD ≤ 50 まで許容。中堅メディア競合も挑戦 | 大型サイト保有者 |
| 100 | 実質無効化 (フィルタなし) | Backlinks 失効時のフォールバック |

### 契約コスト

| 項目 | 金額 |
|---|---|
| Backlinks サブスク (月次コミット) | $100/月 ≒ ¥17,800 (FastSpring 経由) |
| ただし $100 は残高に積み上がり他 API でも使える | → 実質的には Backlinks アクセス権 + クレジット前払い |
| Stage 2.5 単体コスト (1スカウト) | ¥1.65/100KW |

---

## 9. 採用 KW の最終的な「根拠」を再構成

採用 KW (例: 「ピジョン 母乳実感 価格」) が `決定` される根拠は以下の階層で説明可能:

### Layer 1: 検索データ (Google 公式)
- SV = 1,200 (月間検索数あり)
- CPC = ¥45 (広告価値あり)
- intent = transactional (Google 自身が「買う直前」と判定)

### Layer 2: CV 直結度 (CVKW スコア)
- 強CVKW = 85/100 (transactional + 「価格」+ 商標「ピジョン」)

### Layer 3: 季節性 (12ヶ月分析)
- ピーク 3/4月 (出産シーズン)
- 公開時期戦略の根拠

### Layer 4: 競合状況 (SERP)
- Top10 に bg-note.com (個人ブログ) 等が複数 = 食い込める
- AI Overview 引用元に support.pigeon.co.jp (公式) のみ = 個人記事の AI 引用余地あり

### Layer 5: 差別化容易性 (Top3 構造)
- 1位 bg-note.com: タイトル + スニペットから「価格比較メイン」と判明
- 自分は「体験談 + 写真」で差別化可能

### Layer 6: AI 総合判断 (Gemini #3)
- rationale: 「CVスコア85の強CVKW。Top10にbg-note.com等の個人ブログ多数 + AI Overview引用元にも個人サイト多い。3-4月の出産シーズンに向けた記事として最適」

→ **6つのレイヤーで根拠を語れる** = 受注デモで反論不能。

---

## 10. デモ用キャッチコピー

> 「商品名を入れるだけで、Google 公式の検索データから:
> - 月間検索数 / 広告単価 / 検索意図 / 12ヶ月の季節性
> を全部取得。さらに**購入直前の KW (CVKW) だけ**に絞り込んで、上位サイトの中身まで分析した上で、**個人ブログでも食い込める KW** だけを採用します。AI に推測させるのではなく、**Google 自身のデータ**に基づいて判定するので、外しません。」

---

## 11. 関連ファイル

| ファイル | 内容 |
|---|---|
| `src/lib/scoutPipeline.ts` | 7段パイプライン本体 |
| `src/lib/cvKw.ts` | CVKW スコア計算ロジック |
| `src/lib/dataforseo.ts` | DFS API クライアント |
| `src/lib/keywordExpander.ts` | Stage 1 Gemini #1 プロンプト |
| `src/app/(main)/products/ProductsClient.tsx` | UI 表示 |
| `src/app/api/products/scout/route.ts` | API エントリ |
| `docs/PRODUCT_FLOW.md` | システム全体の機能フロー |
| `docs/GLOSSARY.md` | SEO 用語集 |
| `docs/DATAFORSEO_SETUP.md` | DFS 契約・設定手順 |
