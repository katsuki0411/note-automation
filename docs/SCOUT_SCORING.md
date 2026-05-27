# 商品スカウト スコアリング設計書

`/products` の **商品スカウト機能** がキーワード候補に対して出す各種スコアの算出方法と根拠をまとめる。
ソースコードでの実装: `src/lib/competitionAnalyzer.ts` / `src/lib/keywordExpander.ts` / `src/app/api/products/scout/route.ts`

---

## 1. 全体フロー

商品名やお題 (例:「ワイヤレスイヤホン 寝るとき」) を入力すると、以下の3段階で評価する。

```
[入力] subject (商品名 or お題)
   │
   ▼
[Step 1] Gemini で関連KW を 8〜12個 自動生成 (intent付き)
   │     例: 「○○ おすすめ」「○○ 寝るとき」「○○ 比較」「○○ デメリット」
   ▼
[Step 2] 各 KW を Brave Search で上位30件取得
   │
   ├─ (A) 固定ドメインリストで分類 → SEO難易度 + opportunityScore
   │
   └─ (B) Gemini に上位30件 + intent を渡して 5軸評価
          → AI overall (加重平均) + 判断理由
   │
   ▼
[Step 3] AI overall (なければ opportunityScore) 降順でソートしてUIに表示
```

各 KW につき **Gemini × 1〜2 req + Brave × 1〜2 req** が消費される。

---

## 2. なぜ「競合判定」が必要か

> Amazon の売れ筋を取ってきて全部記事化しても意味がない。
> SEO/LLMO で**勝てる KW か事前判定**してから書く方が効率的。

判定の本質は「**この KW で個人ブログが上位入りできる可能性があるか**」を多角的に推定すること。

---

## 3. 2系統の評価を並列実行

スカウト機能は2つの独立した評価系統を持ち、両方を UI に並べて表示する。
ユーザーは見比べて最終判断する。

| 系統 | 仕組み | 強み | 弱み |
|---|---|---|---|
| **(A) 固定分類** | Brave 上位30 → ドメインリストで4バケットに分類 → 比率でスコア | 高速・確定的・無料 | 新興ドメイン取りこぼし / intent 整合性 / LLMO 観点ナシ |
| **(B) Gemini 五軸評価** | Brave 上位30 + intent → Gemini に投げて 5観点で評価 | 動的判定 / LLMO 観点 / intent整合 / 判断理由テキストあり | Gemini × 1req コスト / ハルシネーション可能性 |

---

## 4. 系統 (A) 固定ドメイン分類ベースの評価

### 4-1. ドメインを4バケットに分類

`src/lib/competitionAnalyzer.ts` 内のハードコードされたリストで判定。

| バケット | 代表ドメイン |
|---|---|
| **big_ec** | amazon.co.jp / rakuten.co.jp / shopping.yahoo.co.jp / mercari / qoo10 / askul / lohaco / biccamera / yodobashi |
| **big_media** | kakaku.com / my-best.com / mybest.tokyo / monomag / the360.life / limia / lifehacker / ranking.goo.ne.jp / fumufumunews / thebest-1.com |
| **individual_blog** | hatenablog / hatenadiary / livedoor.blog / livedoor.jp / blog.fc2 / fc2.com / ameblo / seesaa.net / note.com / blog.jp / blogspot / wordpress.com / naver / exblog |
| **other** | 上記以外 (公式メーカーサイト / 業界メディア / 個人独自ドメイン等) |

### 4-2. 比率を計算

```
ecRatio    = big_ec / 30
mediaRatio = big_media / 30
blogRatio  = individual_blog / 30
```

### 4-3. SEO 難易度 `seoDifficulty` の判定

| 条件 | 判定 | 根拠 |
|---|---|---|
| `mediaRatio ≥ 40%` | ✕ **hard** | 大手比較メディアが SERP を占有 → ドメイン権威性で個人は勝てない |
| `blogRatio ≥ 50%` かつ `mediaRatio < 20%` | ✕ **hard** | 個人ブロガーが既に飽和 → 先発組とのコンテンツ量・被リンク戦争 |
| `ecRatio ≥ 40%` かつ `mediaRatio < 20%` | ◎ **easy** | EC ばかり = 解説記事が SERP に少ない = 個人ブログの解説が入る隙間あり |
| それ以外 | △ **medium** | ミックス。やってみる価値あり |

### 4-4. 機会スコア `opportunityScore` の計算式

```
opportunityScore =
    50 (中立スタート)
  + ecRatio    × 50    (+加点: 商品ページが多い = 解説の余地)
  − mediaRatio × 60    (-減点: 大手メディアは最強の壁、係数重め)
  − blogRatio  × 20    (-減点: 飽和市場、係数軽め)

   結果を [0, 100] にクランプ
```

#### 係数の意図

- **メディアの減点係数 (60) > 個人ブログの減点係数 (20)** にしているのは、**1サイトあたりの強さがケタ違い**だから (mybest 1サイトで個人ブログ20サイト分の権威)
- **EC の加点係数 (50)** は中庸。EC が多いだけでは決め手にならないが、確実に好材料

---

## 5. 系統 (B) Gemini 五軸評価

### 5-1. Gemini に渡す情報

- 対象キーワード
- 検索意図 (intent: info / how-to / comparison / trouble / review / purchase)
- Brave 上位30件のタイトル + URL

### 5-2. 5つの評価軸 (各 0-100、高いほど個人ブログに有利)

| # | 軸 | 意味 |
|---|---|---|
| 1 | **authority** | 上位サイトの権威性が "低い" ほど高得点 (Wikipedia/政府/大手新聞/大手比較メディアが多い = 低、知らないドメイン = 高) |
| 2 | **intentGap** | SERP が intent を "満たせていない" ほど高得点 (例: 比較intent なのに上位が商品ページばかり = 高 = 隙間チャンス) |
| 3 | **blogRoom** | SERP に個人ブログの解説記事が "入る余地" がどれだけあるか (大手メディア独占 = 低、商品ページ多め = 高) |
| 4 | **llmoAffinity** | AI 検索 (ChatGPT/Perplexity/Gemini AI Overview) で "引用源になりやすい" KW か (情報網羅性・専門解説ニーズが強い = 高) |
| 5 | **mediaMix** | 動画(YouTube)・SNS が "少ない" ほど高得点 (文字記事に有利。動画ばかりだとテキスト記事の天井低い) |

### 5-3. AI overall (加重平均) の計算式

```
overall =
    intentGap    × 0.30   (最重視: ニーズに対する SERP のズレ = チャンス)
  + blogRoom     × 0.25   (個人ブログの参入余地)
  + authority    × 0.20   (権威性が低いほど勝てる)
  + llmoAffinity × 0.15   (LLMO 観点)
  + mediaMix     × 0.10   (動画/SNS 少なめのほうが文字記事有利)
```

#### 重みの意図

- **intentGap を最大重み (0.30)** にしたのは、「ニーズに合った記事が SERP に無い」状態が個人ブロガーには最大のチャンスだから
- **blogRoom (0.25)** は SERP 内の物理的な「空き枠」を見ている。これも重要
- **authority (0.20)** は権威性。固定分類とは独立した第三者視点
- **llmoAffinity (0.15)** は将来重要になる軸 (現状は AI 検索シェア小さい)
- **mediaMix (0.10)** は補助指標

### 5-4. Gemini が返す rationale (判断理由)

各 KW について、5軸の数値を出した理由を日本語1文で返す。UI に表示する。

例:
> 上位はAmazonと楽天が多く、解説記事が少ない。intent=comparison なら、解説の比較記事は隙間。大手メディア mybest 等は少なめで、個人ブログの参入余地あり。LLMO は中程度。

---

## 6. ソート順

```
sortedCandidates = candidates.sort((a, b) => {
  const scoreA = a.ai?.overall ?? a.opportunityScore;
  const scoreB = b.ai?.overall ?? b.opportunityScore;
  return scoreB - scoreA;
});
```

- Gemini 評価がある場合は **AI overall** を優先
- 失敗時 (Gemini エラー等) は固定分類の **opportunityScore** にフォールバック

---

## 7. 既知の弱点と改善余地

| # | 弱点 | 影響 | 改善案 |
|---|---|---|---|
| 1 | ドメインリストが固定 | 新興メディアを誤分類 | (B) 系統で動的判定済み → 解消 |
| 2 | 上位記事の中身は未評価 | 「同じ ◎ 易」でも質の差を区別できない | Phase 5-2-D-α: 上位3記事の HTML 取得 → 文字数/H2数/更新日 で深掘り |
| 3 | 被リンク数・年齢未考慮 | ドメイン権威の主要指標を使っていない | Ahrefs / Moz API (有料) を契約すれば追加可 |
| 4 | 検索ボリューム未考慮 | スコア高いのに月間検索数 0 のニッチ KW を見抜けない | Google Trends / Brave Suggest 等で代替 |
| 5 | Gemini ハルシネーション | 5軸の数値が実態と乖離する可能性 | 系統(A) を並べて表示することで人間の最終判断を残している |
| 6 | コスト | 1スカウトで Gemini × 8〜12 req + Brave × 16〜24 req | Brave Pro 課金 ($5/月 で 15kreq) + Gemini 課金で対応 |

---

## 8. 関連ファイル

| ファイル | 役割 |
|---|---|
| `src/lib/keywordExpander.ts` | 商品名/お題 → 関連KW 8〜12個生成 (Gemini) |
| `src/lib/competitionAnalyzer.ts` | Brave 上位30取得 + (A) 固定分類 + (B) Gemini五軸 |
| `src/app/api/products/scout/route.ts` | エンドポイント。expand → analyze → ソートして返す |
| `src/app/(main)/products/ProductsClient.tsx` | UI。各候補の (A)/(B) 評価を並べて表示、「ネタ化」「✍ 記事生成」ボタン |

---

## 9. 履歴

- **2026-05-27 Phase 5-2-A**: 固定分類 (A) のみ実装。`opportunityScore` 単体評価
- **2026-05-27 Phase 5-2-D**: Gemini 五軸評価 (B) を追加。両系統並列表示に
