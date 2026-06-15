# KW スカウト 実行フロー詳細 (2026-06-15 版、6段パイプライン)

このドキュメントは **「KWスカウト開始ボタンを押してから採用 KW が表示されるまで」** に何が起きているかを時系列で詳述します。

> 関連: 評価スコアの数式・根拠は [`docs/SCOUT_SCORING.md`](./SCOUT_SCORING.md) 参照。
> 関連: 用語の意味は [`docs/GLOSSARY.md`](./GLOSSARY.md) 参照。

---

## 0. トリガー (ユーザーが何をすると始まるか)

### UI 操作
1. サイドバー → **KWスカウト** をクリック
2. **新規スカウト** タブを選択
3. 「商品名 / お題 / フリーKW」 入力欄に subject を入力 (例: 「ピジョン 母乳実感」)
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
| `kwCandidateCount` | 1000 | Stage 1 の Gemini #1 が生成する KW 数 (「漏れなく」 スカウト方針) |
| `minSv` | 100 | Stage 3 の Gemini #2 が落とす SV 下限 |
| `minCpc` | $0.2 (¥30) | Stage 3 が落とす CPC 下限 |
| `maxFinalCount` | 10 | Stage 5 に回す候補数の上限 |
| `excludeKws` | [] | 全 Stage で除外する KW リスト |
| `promptKwGen / promptStage3 / promptFinal` | デフォルト | 3つの Gemini プロンプト |

---

## 1. パイプライン全体図 (6段構造)

```
[ subject 入力 ] 例: "ピジョン 母乳実感"
        │
        ▼
 ┌──────────────────────────────────────────────────────┐
 │ Stage 0    DFS Related + Suggestions  (シード KW 取得)   │
 │ Stage 1    Gemini #1                   (100 KW 生成)     │
 │ Stage 2    DFS Search Volume Bulk      (SV/CPC/季節性)  │
 │ Stage 3    Gemini #2                   (30件に絞り込み)  │
 │ Stage 3.5  DFS Search Intent           (Google公式intent) │
 │ Stage 4    DFS SERP Advanced + お宝スコア計算            │
 │ Stage 5    Gemini #3                   (最終判定)         │
 └──────────────────────────────────────────────────────┘
        │
        ▼
[ 採用 KW 1-5件 (rationale 付き) + 落選 KW 詳細 ]
```

**1スカウトのコスト**: 約 ¥200 (Gemini × 3 + DFS API × 4) — 1000 KW モード時
**所要時間**: 約 60-120 秒

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
| コスト | 約 ¥3.5 |

**評価**: このステージは**評価しない**。後段に渡すシード集合を作るだけ。

### Stage 1: KW 候補 100件生成 (Gemini #1)

**目的**: subject から「実際に検索されそうな関連 KW」 を 100件生成する。

| 項目 | 内容 |
|---|---|
| 使用 AI | Gemini 2.5 Pro |
| 入力 | subject + Stage 0 シード KW + 除外 KW |
| 出力 | KW 配列 + intent + reason + category |
| 失敗時 | エラーで停止 |
| コスト | 約 ¥10 |

**プロンプト指示の核**:
- **CVKW 比率 70% 以上** を強制
  - 強CVKW (購入直前) 40% 以上: 「○○ 価格」「○○ amazon」「○○ クーポン」 等
  - 中CVKW (比較検討) 30% 以上: 「○○ おすすめ」「○○ 比較」「○○ 口コミ」 等
- **商標入り KW を必ず含める**
- 単一語ではなく 2〜4語の複合フレーズ

### Stage 2: 検索ボリューム取得 (DFS Search Volume Bulk)

**目的**: 100件の各 KW に対して SV / CPC / 競合度 / 月別12ヶ月SV を取得。

| 項目 | 内容 |
|---|---|
| 使用 API | `/keywords_data/google_ads/search_volume/live` |
| 入力 | Stage 1 で生成された 100 KW |
| 出力 | KW + SV + CPC + competition + competitionLevel + monthlySearches[12] |
| 失敗時 | 個別 KW で null フォールバック |
| コスト | 約 ¥11 |

**評価**: ここでは絞り込みしない。データを取得して overviewMap に保持するだけ。
**注意**: SV は Google Ads データ。一部 KW では SV=null になる。

### Stage 3: 1次絞り込み (Gemini #2)

**目的**: 100件を **最大30件** に絞り込む。

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
5. 同義 KW の重複排除
6. 商品名と無関係なジャンル混入は除外

通過した KW = `stage3Pass`。落選した KW は `rejected[]` に `stage: "stage3_rejected"` で記録。

### Stage 3.5: Google 公式 Search Intent 取得 (DFS Search Intent)

**目的**: stage3Pass の各 KW に対して Google 公式の検索意図ラベルを取得。

| 項目 | 内容 |
|---|---|
| 使用 API | `/keywords_data/google_ads/search_intent/live` |
| 入力 | stage3Pass の KW (~30件) |
| 出力 | KW + intent (transactional / commercial / navigational / informational) + 確信度 (0-1) |
| 失敗時 | 空配列でフォールバック |
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
| コスト | 約 ¥17 |

**このステージで計算する派生指標**:

#### A. 季節性 (peakMonths / troughMonths)
- Stage 2 の月別 SV から算出
- 平均 ±20% (`平均 × 1.2 以上` = ピーク / `平均 × 0.8 以下` = 谷)

#### B. CVKW スコア (cvKwScore, 0-100)
- `intentScore (0-40)` + `tokenScore (0-30)` + `brandScore (0-15)` の合算
- 4 段階分類: 70-100 強CVKW / 50-69 中CVKW / 30-49 弱CVKW / 0-29 非CVKW

#### C. **お宝スコア (treasureScore, 0-70)** ★ 採用判定の中核

| 軸 | 加点ルール | 最大点 |
|---|---|---|
| SV | ≥5000:+30 / ≥1000:+20 / ≥500:+10 / ≥100:+5 | 30 |
| CVKW | cvKwScore × 0.2 | 20 |
| SERP個人ブログ含有 | 4件+:+15 / 2-3件:+10 / 1件:+5 / 0件:0 | 15 |
| AI Overview個人サイト引用 | あり:+5 | 5 |

→ **ランク判定**: 50+ 💎💎💎超お宝 / 35+ 💎💎お宝 / 25+ 💎準お宝 / <25 通常

#### D. 競合 Top3 構造 (topPageStructures)
SERP organic 上位3件の URL + ドメイン + タイトル + スニペット を抽出。
「Top3 がどんな切り口で書いているか」 をUIで表示。

#### E. SERP ドメイン分類 (お宝スコアの SERP 軸計算用)
- `domainClassifier.classifyDomain(url, subject)` で各 URL を分類
  - `personal_blog`: note.com / hatenablog.com / ameblo.jp / livedoor.blog / fc2.com / blogspot.com / qiita.com / zenn.dev 等
  - `major_media`: mybest.com / kakaku.com / amazon.co.jp / rakuten.co.jp / mynavi.jp 等
  - `official`: subject の商標トークンが URL に含まれる
  - `unknown`: それ以外の独自ドメイン
- Top10 の中の `personal_blog` 件数を集計 → お宝スコアの SERP 軸加点に使用

### Stage 5: 最終判定 (Gemini #3)

**目的**: stage4Candidates 全件について「採用 / 要検討 / 却下」 と最終スコア + rationale を出す。

| 項目 | 内容 |
|---|---|
| 使用 AI | Gemini 2.5 Pro |
| 入力 | 全 KW の全評価指標 (お宝スコア + SV + CVKW + 季節性 + Top10ドメイン + AI Overview + PAA + Top3 構造) |
| 出力 | KW + finalScore + decision (adopt/borderline/reject) + rationale |
| 失敗時 | 全件を `borderline` でマーク (フォールバック) |
| コスト | 約 ¥3 |

**プロンプト指示の核**:
- **お宝スコア順を最優先**
- **adopt**: treasureTotal ≥ 35 (💎💎 お宝以上は必ず採用)
- **borderline**: treasureTotal 25-34 (Top10 状況次第で判断)
- **reject**: treasureTotal < 25
- **保証ルール**: 候補全体で最大 treasureTotal が 25 以上なら**最低 1件は adopt**
- **SERP の中身判断**: Top10 に個人ブログ 2件以上なら勝てる可能性高い

---

## 3. 採用までの判定ロジック (まとめ)

```
[100 KW (Stage 1)]
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
1. **お宝スコア ≥ 35** (💎💎 お宝以上)
2. もしくは **保証ルール**: 全体最大が 25+ なら最低 1件は adopt
3. SERP Top10 に個人ブログ 2件以上があれば「勝てる証拠」 として加点

### 却下 (reject) の条件
1. お宝スコア < 25
2. かつ Top10 大手独占で勝ち目薄

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
│ [✓ 採用]  総合 75  購入意欲    ← Stage 5 が決めた decision バッジ│
│                                                            │
│ ピジョン 母乳実感 8ヶ月 サイズ          ← KW タイトル        │
│ 子育て中の主婦の検索意図に合致...        ← Stage 1 reason   │
│                                                            │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ [💎💎 お宝 44/70]  ▼ 評価の内訳                        │ │
│ │ ─────────────────────                                  │ │
│ │ +20  📊 SV=1,200: 本物のお宝ボリューム                  │ │
│ │ +14  💰 CVKW=70 → 中CVKW (比較検討段階)                │ │
│ │ +10  🌐 SERP Top10 に個人ブログ 3件 = 勝てる可能性高い   │ │
│ │ + 0  ✨ AI Overview 未表示                              │ │
│ │ ─────────────────────                                  │ │
│ │ =44  💎💎 お宝判定                                      │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                            │
│ 月Vol 1,200  CPC ¥45  広告競合 中  💰今すぐ購入 75%        │
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
| 月Vol | 数値のみ (色分けなし) |
| CPC | 数値のみ (¥換算) |
| 広告競合 | HIGH=赤 / MEDIUM=黄 / LOW=灰 |
| 今すぐ購入 (intent) | transactional=緑強 / commercial=ティール / navi=青 / info=黄 |
| CV直結 (CVKW) | ≥70: 緑強 / ≥50: ティール / ≥30: 黄 / <30: 灰 |
| ピーク月 | オレンジ (季節性ありの時のみ) |

---

## 6. 落選 KW の保存と表示

Stage 3 で落選した KW も `rejected_candidates` に保存:

| stage 値 | 意味 | 表示タブ |
|---|---|---|
| `stage3_rejected` | Gemini #2 が数値/重複/不適切と判定して除外 | ②生成過程 |

各落選 KW には `rejectionNote` が付く:
- 「Gemini #2 が数値/重複/不適切と判定して除外」

履歴の **②生成過程** タブで「100KW → 30KW → 5件」 の絞り込みが時系列で見える。

---

## 7. 所要時間とコスト内訳

### 時間 (1スカウト 1000KW モード、2026-06-15 デフォルト)
| Stage | 所要時間 |
|---|---|
| Stage 0 | 約 3-5秒 (DFS 2件並列、limit=500) |
| Stage 1 | 約 30-60秒 (Gemini #1 が 1000件出力) |
| Stage 2 | 約 5-10秒 (DFS bulk 1000件) |
| Stage 3 | 約 15-30秒 (Gemini #2 が 1000件入力 → 30件) |
| Stage 3.5 | 約 1-2秒 (DFS bulk 30件) |
| Stage 4 | 約 10-20秒 (SERP advanced 10件並列) |
| Stage 5 | 約 5-10秒 (Gemini #3) |
| **合計** | **約 60-120秒** |

### コスト (1スカウト 1000KW モード)
| Stage | コスト | 内訳 |
|---|---|---|
| Stage 0 | ¥7 | Related + Suggestions の limit=500 |
| Stage 1 (Gemini) | ¥40 | Gemini #1 出力 1000 KW (出力トークン10倍) |
| Stage 2 | ¥110 | Search Volume Bulk 1000 KW |
| Stage 3 (Gemini) | ¥20 | Gemini #2 入力 1000 KW (入力トークン10倍) |
| Stage 3.5 | ¥5 | Search Intent 30件 |
| Stage 4 | ¥17 | SERP Advanced 10件 |
| Stage 5 (Gemini) | ¥3 | Gemini #3 評価 |
| **合計** | **約 ¥200/スカウト** | |

→ 月20スカウト想定で **¥4,000/月** / 月50スカウトで **¥10,000/月**

### 100KW モード (kwCandidateCount=100 に変更時) のコスト比較
| Stage | コスト |
|---|---|
| 合計 | **約 ¥55/スカウト** |

→ ユーザーは「漏れなく」 派なのでデフォルトは 1000。コスト感重視なら設定画面で 100-500 に変更可。

---

## 8. デバッグ用ログ (dev サーバーターミナル)

スカウト実行中、dev サーバーに以下のログが順次出ます:

```
[scoutPipeline] Stage0 seed: related=50, suggestions=50, unique=87
[scoutPipeline] Stage2 overview: requested=100, returned=100, matched=100
[scoutPipeline] Stage3.5 intent: requested=30, returned=30
```

---

## 9. 関連ファイル

| ファイル | 役割 |
|---|---|
| `src/app/api/products/scout/route.ts` | API エントリ (config 解決 + パイプライン起動) |
| `src/lib/scoutPipeline.ts` | 6段パイプライン本体 |
| `src/lib/keywordExpander.ts` | Stage 1 (Gemini #1) のプロンプトとパース |
| `src/lib/dataforseo.ts` | DFS API クライアント (全 Stage 共通) |
| `src/lib/cvKw.ts` | CVKW スコア計算 |
| `src/lib/treasureScore.ts` | お宝スコア計算 (KD軸撤廃済、70点満点) |
| `src/lib/domainClassifier.ts` | SERP ドメイン分類 (個人/大手/公式/不明) |
| `src/lib/scoutHistory.ts` | スカウト履歴 DB 保存・取得 |
| `src/app/(main)/products/ProductsClient.tsx` | UI 表示 |
| `src/app/(main)/settings/ScoutConfigTab.tsx` | 設定 UI |

---

## 10. ユーザー視点まとめ (5行で言うと)

1. 商品名を入力して **スカウト開始** を押すと、約 30-60 秒、6段パイプラインが内部で動く
2. Gemini が 100 KW を生成 → DFS が SV/SERP の実データを取得 → Gemini が最終判定
3. 各 KW には **お宝スコア (0-70)** が付き、35点超え (💎💎 お宝) を**最低1件は採用**
4. 採用カードには **「なぜ採用したか」 の評価内訳が全部見える** (SV/CVKW/SERP個人ブログ含有/AIO)
5. 落選 KW も**理由付き**で保存される → 受注デモで「ここまで根拠出せます」 と説明できる
