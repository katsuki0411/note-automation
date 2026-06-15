# KW スカウト 実行フロー詳細 (2026-06-15 版)

このドキュメントは **「KWスカウト開始ボタンを押してから採用 KW が表示されるまで」** に何が起きているかを時系列で詳述します。

> 関連: 評価スコアの数式・根拠は [`docs/SCOUT_SCORING.md`](./SCOUT_SCORING.md) 参照。
> 関連: 用語の意味は [`docs/GLOSSARY.md`](./GLOSSARY.md) 参照。

---

## 0. トリガー (ユーザーが何をすると始まるか)

### UI 操作
1. サイドバー → **KWスカウト** をクリック
2. **新規スカウト** タブを選択
3. 「商品名 / お題 / フリーKW」 入力欄に subject を入力
   - 例: 「ピジョン 母乳実感」 / 「ベビーカー 軽量」
4. 「**スカウト開始**」 ボタンクリック

### 起動する API
- `POST /api/products/scout`
- body: `{ subject: string, config: ScoutConfig }`
- 内部で `runScoutPipeline(subject, mergedConfig)` を呼び出す

### 設定値の解決順
```
リクエスト body.config (一時オーバーライド)
  > プロジェクト保存値 (scout_config テーブル)
  > scoutPipeline.ts のデフォルト
```

設定可能な項目 (設定 → KWスカウト設定 タブで保存):
| 項目 | デフォルト | 役割 |
|---|---|---|
| `kwCandidateCount` | 100 | Stage 1 の Gemini #1 が生成する KW 数 |
| `minSv` | 100 | Stage 3 の Gemini #2 が落とす SV 下限 |
| `minCpc` | $0.2 (¥30) | Stage 3 が落とす CPC 下限 |
| `maxKd` | 100 (実質無効) | Stage 2.5 が機械的に落とす KD 上限 |
| `maxFinalCount` | 10 | Stage 5 に回す候補数の上限 |
| `excludeKws` | [] | 全 Stage で除外する KW リスト |
| `promptKwGen / promptStage3 / promptFinal` | デフォルト | 3つの Gemini プロンプト |

---

## 1. パイプライン全体図 (7段構造)

```
[ subject 入力 ] 例: "ピジョン 母乳実感"
        │
        ▼
 ┌──────────────────────────────────────────────────────┐
 │ Stage 0    DFS Related + Suggestions  (シード KW 取得)   │
 │ Stage 1    Gemini #1                   (100 KW 生成)     │
 │ Stage 2    DFS Search Volume Bulk      (SV/CPC/季節性)  │
 │ Stage 2.5  DFS Bulk Keyword Difficulty (KD取得+フィルタ)  │
 │ Stage 3    Gemini #2                   (30件に絞り込み)  │
 │ Stage 3.5  DFS Search Intent           (Google公式intent) │
 │ Stage 4    DFS SERP Advanced + お宝スコア計算            │
 │ Stage 5    Gemini #3                   (最終判定)         │
 └──────────────────────────────────────────────────────┘
        │
        ▼
[ 採用 KW 3-5件 (rationale 付き) + 落選 KW 詳細 ]
```

**1スカウトのコスト**: 約 ¥45 (Gemini × 3 + DFS API × 5)
**所要時間**: 約 30-60 秒

---

## 2. 各 Stage 詳細

### Stage 0: 実検索シード KW 取得 (DFS Related + Suggestions)

**目的**: 実際に Google で検索されている関連 KW を取得し、Gemini #1 のハルシ抑制に使う。

| 項目 | 内容 |
|---|---|
| 使用 API | `/dataforseo_labs/google/related_keywords/live` + `/keyword_suggestions/live` |
| 入力 | subject (商品名) |
| 出力 | 関連 KW 配列 (重複排除後 最大 100件) |
| 失敗時 | 空配列でフォールバック (Gemini #1 が単独で動作) |
| コスト | 約 ¥3.5 (Related + Suggestions の 2リクエスト) |

**評価**: このステージは**評価しない**。後段に渡すシード集合を作るだけ。

### Stage 1: KW 候補 100件生成 (Gemini #1)

**目的**: subject から「実際に検索されそうな関連 KW」 を 100件生成する。

| 項目 | 内容 |
|---|---|
| 使用 AI | Gemini 2.5 Pro |
| 入力 | subject + Stage 0 シード KW + 除外 KW |
| 出力 | KW 配列 + intent (info/how-to/comparison/trouble/review/purchase) + reason + category |
| 失敗時 | エラーで停止 (空ならパイプライン途中終了) |
| コスト | 約 ¥10 |

**プロンプト指示の核**:
- **CVKW 比率 70% 以上** を強制
  - 強CVKW (購入直前) 40% 以上: 「○○ 価格」「○○ amazon」「○○ クーポン」 等
  - 中CVKW (比較検討) 30% 以上: 「○○ おすすめ」「○○ 比較」「○○ 口コミ」 等
- **商標入り KW を必ず含める**
- 単一語ではなく 2〜4語の複合フレーズ
- 質 > 数 (無理に 100件出さない)

### Stage 2: 検索ボリューム取得 (DFS Search Volume Bulk)

**目的**: 100件の各 KW に対して SV / CPC / 競合度 / 月別12ヶ月SV を取得。

| 項目 | 内容 |
|---|---|
| 使用 API | `/keywords_data/google_ads/search_volume/live` |
| 入力 | Stage 1 で生成された 100 KW |
| 出力 | KW + SV + CPC + competition + competitionLevel + monthlySearches[12] |
| 失敗時 | 個別 KW で null フォールバック |
| コスト | 約 ¥11 (100KW で $0.07) |

**評価**: ここでは絞り込みしない。データを取得して overviewMap に保持するだけ。
**注意**: SV は Google Ads データ。一部 KW では SV=null になる (= Google Ads の検索クエリ DB に無い)。

### Stage 2.5: KD 取得 + 機械フィルタ (DFS Bulk Keyword Difficulty)

**目的**: 100件の KW に対して KD (キーワード難易度 0-100) を取得し、maxKd 超過を機械的に除外。

| 項目 | 内容 |
|---|---|
| 使用 API | `/dataforseo_labs/google/bulk_keyword_difficulty/live` |
| 入力 | Stage 1 で生成された 100 KW |
| 出力 | KW + KD (0-100 or null) |
| 失敗時 | 全 KW を通過扱い (Backlinks 未契約フォールバック) |
| コスト | 約 ¥1.65 (100KW で $0.011) |

**評価**:
- `kd === null || kd === undefined || kd <= maxKd` → 通過
- それ以外 → 落選 (rejectionNote: 「KD X が上限 Y を超過」)

**🚨 重要 (2026-06-15 判明)**: DFS Labs の日本語ロングテール KW カバレッジは薄く、CV系 (「○○ おすすめ」 等) は KD=null になることが大半。実質的には **maxKd フィルタはほぼ機能しない** 状態。`KD=0` は「データなし」 を意味するため `null` に正規化済 (詳細 [GLOSSARY.md](./GLOSSARY.md))。

### Stage 3: 1次絞り込み (Gemini #2)

**目的**: 100件 (Stage 2.5 通過分) を **最大30件** に絞り込む。

| 項目 | 内容 |
|---|---|
| 使用 AI | Gemini 2.5 Pro |
| 入力 | KW + intent + SV + CPC + 競合 + reason |
| 出力 | 採用 KW の文字列配列 (selected) + 全体方針 (rationale) |
| 失敗時 | SV/CPC 閾値だけで絞る (フォールバック) |
| コスト | 約 ¥5 |

**プロンプト指示の核**:
1. SV >= minSv (デフォルト 100)
2. CPC >= minCpc (デフォルト $0.2 = ¥30)
3. dfs_intent が commercial / transactional 寄り
4. 「比較」「おすすめ」「口コミ」 等の購入直前 KW
5. 同義 KW の重複排除 (「○○ 価格」 と「○○ 値段」 は片方だけ)
6. 商品名と無関係なジャンル混入は除外

通過した KW = `stage3Pass`。落選した KW は `rejected[]` に `stage: "stage3_rejected"` で記録。

### Stage 3.5: Google 公式 Search Intent 取得 (DFS Search Intent)

**目的**: stage3Pass の各 KW に対して Google 公式の検索意図ラベルを取得。

| 項目 | 内容 |
|---|---|
| 使用 API | `/keywords_data/google_ads/search_intent/live` |
| 入力 | stage3Pass の KW (~30件) |
| 出力 | KW + intent (transactional / commercial / navigational / informational) + 確信度 (0-1) |
| 失敗時 | 空配列でフォールバック (CVKW スコア計算で intent=0点扱い) |
| コスト | 約 ¥5 |

**Intent の意味**:
| 値 | 例 | CVKW intentScore |
|---|---|---|
| transactional | 「○○ 価格」 「○○ amazon」 | +40点 |
| commercial | 「○○ おすすめ」 「○○ 比較」 | +25点 |
| navigational | 「amazon ログイン」 「○○ 公式」 | +5点 |
| informational | 「○○ とは」 「○○ やり方」 | 0点 |

### Stage 4: SERP取得 + CVKW + お宝スコア計算 (DFS SERP Advanced)

**目的**: stage3Pass の各 KW について、実際の Google 検索結果ページ (SERP) を取得し、全評価指標を計算する。

| 項目 | 内容 |
|---|---|
| 使用 API | `/serp/google/organic/live/advanced` |
| 入力 | stage3Pass の KW |
| 出力 | SERP organic 結果 + AI Overview + SERP features + PAA |
| 失敗時 | null フォールバック (KW 単位) |
| コスト | 約 ¥17 (10件で $0.11) |

**このステージで計算する派生指標**:

#### A. 季節性 (peakMonths / troughMonths)
- Stage 2 で取得した 月別 SV から算出
- 平均 ±20% (`平均 × 1.2 以上` = ピーク / `平均 × 0.8 以下` = 谷)

#### B. CVKW スコア (cvKwScore, 0-100)
詳細は [SCOUT_SCORING.md 第 6章](./SCOUT_SCORING.md)。算出:
- `intentScore (0-40)` + `tokenScore (0-30)` + `brandScore (0-15)` の合算
- 4 段階分類: 70-100 強CVKW / 50-69 中CVKW / 30-49 弱CVKW / 0-29 非CVKW

#### C. **お宝スコア (treasureScore, 0-110)** ★ 採用判定の中核
詳細は [SCOUT_SCORING.md 第 11章](./SCOUT_SCORING.md)。算出:

| 軸 | 加点ルール | 最大点 |
|---|---|---|
| KD | ≤10:+40 / ≤20:+30 / ≤30:+15 / >30:0 / null:0 | 40 |
| SV | ≥5000:+30 / ≥1000:+20 / ≥500:+10 / ≥100:+5 | 30 |
| CVKW | cvKwScore × 0.2 | 20 |
| SERP個人ブログ含有 | 4件+:+15 / 2-3件:+10 / 1件:+5 / 0件:0 | 15 |
| AI Overview個人サイト引用 | あり:+5 | 5 |

→ **ランク判定**: 80+ 💎💎💎超お宝 / 60+ 💎💎お宝 / 40+ 💎準お宝 / <40 通常

**KD が取れない日本語ロングテール KW** では実質 70点満点運用。「SV ≥500 + CVKW ≥50 + SERP個人ブログ ≥2件」 で 💎💎 お宝判定 (60点) に到達可能。

#### D. 競合 Top3 構造 (topPageStructures)
SERP organic 上位3件の URL + ドメイン + タイトル + スニペット (description) を抽出。
「Top3 がどんな切り口で書いているか」 をUIで表示 → 自分が違う角度で書く差別化戦略の根拠に。

#### E. SERP ドメイン分類 (お宝スコアの SERP 軸計算用)
- `domainClassifier.classifyDomain(url, subject)` で各 URL を分類
  - `personal_blog`: note.com, hatenablog.com, ameblo.jp, livedoor.blog, fc2.com, blogspot.com, qiita.com, zenn.dev 等
  - `major_media`: mybest.com, kakaku.com, amazon.co.jp, rakuten.co.jp, mynavi.jp 等
  - `official`: subject の商標トークンが URL に含まれる (例: ピジョン → pigeon.co.jp)
  - `unknown`: それ以外の独自ドメイン (保守的に「個人ブログとして数えない」)
- Top10 の中の `personal_blog` 件数を集計 → お宝スコアの SERP 軸加点に使用

### Stage 5: 最終判定 (Gemini #3)

**目的**: stage4Candidates 全件について「採用 / 要検討 / 却下」 と最終スコア + rationale を出す。

| 項目 | 内容 |
|---|---|
| 使用 AI | Gemini 2.5 Pro |
| 入力 | 全 KW の全評価指標 (お宝スコア + KD + SV + CVKW + 季節性 + Top10 ドメイン + AI Overview + PAA + Top3 構造) |
| 出力 | KW + finalScore + decision (adopt/borderline/reject) + rationale |
| 失敗時 | 全件を `borderline` でマーク (フォールバック) |
| コスト | 約 ¥3 |

**プロンプト指示の核 (2026-06-15 改定)**:
- **お宝スコア順を最優先**
- **adopt**: treasureTotal ≥ 60 (💎💎 お宝以上は必ず採用)
  - お宝スコア60以上なら、Top3 が大手でも切り口次第で勝てるので必ず採用
  - Top3 ページの「切り口」 を見て、自分が違う角度で書けるなら強加点
- **borderline**: treasureTotal 40-59 (Top10 状況次第で判断)
- **reject**: treasureTotal < 40
- **保証ルール**: 候補全体で最大 treasureTotal が 40 以上なら**最低 1件は adopt** にする
  (= 1スカウト最低1件のお宝発掘がスカウトの本質目的)
- **KD=null 時の代替判定**: 「SV ≥500 + CVKW ≥50 + Top10 個人ブログ 1件以上」 で adopt 可

---

## 3. 採用までの判定ロジック (まとめ)

```
[100 KW (Stage 1)]
        │
        ▼  Stage 2.5: KD > maxKd は除外 (実運用ではほぼ機能しない、null フォールバック)
[~100 KW]
        │
        ▼  Stage 3: Gemini #2 が SV/CPC/重複排除で絞る
[~30 KW (stage3Pass)]
        │
        ▼  Stage 3.5: Google公式 intent 取得
        ▼  Stage 4: SERP取得 + CVKW計算 + お宝スコア計算
[~30 KW + 全評価指標]
        │
        ▼  Stage 5: Gemini #3 がお宝スコア順に判定
[ ✅ adopt (採用) ] ★最低1件保証
[ △ borderline (要検討) ]
[ × reject (却下) ]
```

### 採用 (adopt) の条件
1. **お宝スコア ≥ 60** (基本ライン、💎💎 お宝以上)
2. もしくは **保証ルール**: 全体最大が 40+ なら最低 1件は adopt
3. もしくは KD=null 時の代替: **SV ≥500 + CVKW ≥50 + Top10個人ブログ ≥1件**

### 却下 (reject) の条件
1. お宝スコア < 40 (通常採用ライン下回り)
2. かつ Top10 大手独占で勝ち目薄
3. ハズレ回 (全候補 < 40) なら全件 reject も可

---

## 4. 結果データの保存 (DB)

スカウト完了後、`scout_history` テーブルに以下を保存:

| カラム | 内容 |
|---|---|
| `id` | スカウト履歴 ID (UUID) |
| `project_id` | プロジェクト ID |
| `subject` | 入力した商品名 |
| `category` | Gemini #1 が判定したジャンル |
| `candidates` | 採用 KW 配列 (JSON、各 KW の全評価指標込) |
| `rejected_candidates` | 落選 KW 配列 (落選理由 + Stage 2 取得値付き) |
| `stats` | 各 Stage の通過数集計 |
| `created_at` | スカウト実行日時 |

→ 履歴 タブからいつでも再閲覧可能。

---

## 5. UI に表示される内容 (採用カードの構成)

```
┌────────────────────────────────────────────────────────────┐
│ [✓ 採用]  総合 85  購入意欲    ← Stage 5 が決めた decision バッジ│
│                                                            │
│ ピジョン 母乳実感 8ヶ月 サイズ          ← KW タイトル        │
│ 子育て中の主婦の検索意図に合致...        ← Stage 1 reason   │
│                                                            │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ [💎💎 お宝 64/110]  ▼ 評価の内訳                       │ │
│ │ ─────────────────────                                  │ │
│ │ +30  🔧 KD=18: 個人ブログで2-4ヶ月で勝てる現実的ライン   │ │
│ │ +10  📊 SV=800: アクセス取れる最低限                    │ │
│ │ +14  💰 CVKW=70 → 中CVKW (比較検討段階)                │ │
│ │ +10  🌐 SERP Top10 に個人ブログ 3件 = 勝てる可能性高い   │ │
│ │ + 0  ✨ AI Overview 未表示                              │ │
│ │ ─────────────────────                                  │ │
│ │ =64  💎💎 お宝判定                                      │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                            │
│ 🔧 KD 18  月Vol 800  CPC ¥45  広告競合 中  💰今すぐ購入 75%  │
│ 📈 ピーク 3/4月                                            │
│                                                            │
│ ▼ ✏️ 上位3記事の「切り口」 ← Top3 の SERP title + snippet  │
│   1位 bg-note.com 「ピジョン 母乳実感の選び方」              │
│   2位 hoge.com    「サイズ早見表」                           │
│   3位 fuga.com    「先輩ママの口コミ」                       │
│                                                            │
│ 投稿先: ✓ note 隙間あり / ✗ hatenablog 同ドメイン投稿済     │
│                                                            │
│ [📰 記事生成]  [🔖 保留]  [🗑 却下]                          │
└────────────────────────────────────────────────────────────┘
```

### バッジの色分けと意味

| バッジ | 色分け基準 |
|---|---|
| 採用/要検討/却下 | adopt=緑 / borderline=黄 / reject=赤 |
| 総合スコア | finalScore (Gemini #3 が決めた 0-100) |
| お宝ランク | 💎💎💎超お宝=紫グラデ / 💎💎お宝=エメラルド / 💎準お宝=黄色 |
| KD | ≤30: 緑 / ≤50: 黄 / >50: 赤 / null: 灰 |
| 月Vol | 数値のみ (色分けなし) |
| CPC | 数値のみ (¥換算) |
| 広告競合 | HIGH=赤 / MEDIUM=黄 / LOW=灰 |
| 今すぐ購入 (intent) | transactional=緑強 / commercial=ティール / navi=青 / info=黄 |
| CV直結 (CVKW) | ≥70: 緑強 / ≥50: ティール / ≥30: 黄 / <30: 灰 |
| ピーク月 | オレンジ (季節性ありの時のみ) |

---

## 6. 落選 KW の保存と表示

Stage 2.5 / Stage 3 で落選した KW も `rejected_candidates` に保存:

| stage 値 | 意味 | 表示タブ |
|---|---|---|
| `stage2_5_kd_rejected` | KD が maxKd 超過で機械的に落選 | ②生成過程 |
| `stage3_rejected` | Gemini #2 が数値/重複/不適切と判定して除外 | ②生成過程 |

各落選 KW には `rejectionNote` が付く:
- 「KD 45 が上限 30 を超過」
- 「Gemini #2 が数値/重複/不適切と判定して除外」

履歴の **②生成過程** タブで「100KW → 30KW → 5件」 の絞り込みが時系列で見える。

---

## 7. 所要時間とコスト内訳

### 時間 (1スカウト 100KW モード)
| Stage | 所要時間 |
|---|---|
| Stage 0 | 約 2-3秒 (DFS 2件並列) |
| Stage 1 | 約 8-15秒 (Gemini #1) |
| Stage 2 | 約 2-3秒 (DFS bulk) |
| Stage 2.5 | 約 1-2秒 (DFS bulk) |
| Stage 3 | 約 5-10秒 (Gemini #2) |
| Stage 3.5 | 約 1-2秒 (DFS bulk) |
| Stage 4 | 約 10-20秒 (SERP advanced 10件並列) |
| Stage 5 | 約 5-10秒 (Gemini #3) |
| **合計** | **約 35-65秒** |

### コスト (1スカウト 100KW モード)
| Stage | コスト |
|---|---|
| Stage 0 | ¥3.5 |
| Stage 1 (Gemini) | ¥10 |
| Stage 2 | ¥11 |
| Stage 2.5 | ¥1.65 |
| Stage 3 (Gemini) | ¥5 |
| Stage 3.5 | ¥5 |
| Stage 4 | ¥17 |
| Stage 5 (Gemini) | ¥3 |
| **合計** | **約 ¥56/スカウト** |

→ 月50スカウト想定で **¥2,800/月** (Backlinks 解約後)

---

## 8. デバッグ用ログ (dev サーバーターミナル)

スカウト実行中、dev サーバーに以下のログが順次出ます:

```
[scoutPipeline] Stage0 seed: related=50, suggestions=50, unique=87
[scoutPipeline] Stage2 overview: requested=100, returned=100, matched=100
[scoutPipeline] Stage2.5 KD: requested=100, returned=100, real=12, null=88
[scoutPipeline] Stage2.5 KD filter: maxKd=100, passed=100/100
[scoutPipeline] Stage3.5 intent: requested=30, returned=30
```

特に `Stage2.5 KD: real=X, null=Y` の比率を見ると DFS の日本語 KW カバレッジが把握できます。

---

## 9. 関連ファイル

| ファイル | 役割 |
|---|---|
| `src/app/api/products/scout/route.ts` | API エントリ (config 解決 + パイプライン起動) |
| `src/lib/scoutPipeline.ts` | 7段パイプライン本体 |
| `src/lib/keywordExpander.ts` | Stage 1 (Gemini #1) のプロンプトとパース |
| `src/lib/dataforseo.ts` | DFS API クライアント (全 Stage 共通) |
| `src/lib/cvKw.ts` | CVKW スコア計算 |
| `src/lib/treasureScore.ts` | お宝スコア計算 |
| `src/lib/domainClassifier.ts` | SERP ドメイン分類 (個人/大手/公式/不明) |
| `src/lib/scoutHistory.ts` | スカウト履歴 DB 保存・取得 |
| `src/app/(main)/products/ProductsClient.tsx` | UI 表示 |
| `src/app/(main)/settings/ScoutConfigTab.tsx` | 設定 UI |
| `scripts/test-bulk-kd.ts` | DFS Bulk KD 動作確認スクリプト |

---

## 10. ユーザー視点まとめ (5行で言うと)

1. 商品名を入力して **スカウト開始** を押すと、約 1分間、7段パイプラインが内部で動く
2. Gemini が 100 KW を生成 → DFS が SV/KD/SERP の実データを取得 → Gemini が最終判定
3. 各 KW には **お宝スコア (0-110)** が付き、60点超え (💎💎 お宝) を**最低1件は採用**
4. 採用カードには **「なぜ採用したか」 の評価内訳が全部見える** (KD/SV/CVKW/SERP個人ブログ含有/AIO)
5. 落選 KW も**理由付き**で保存される → 受注デモで「ここまで根拠出せます」 と説明できる
