# MultiPostAI 機能解説 & 投稿完了までのフロー

> 作成: 2026-06-09
> 対象読者: 小社長 / 開発パートナー / 運用スタッフ
> 関連: 専門用語の意味は `docs/GLOSSARY.md` を参照

---

## 0. このツールが何をするか (1行サマリ)

**「Amazon商品から関連キーワードを発掘 → 各サイト用に専用記事を自動生成 → 5媒体に一括投稿」を 1人で回せるツール。**

---

## 1. 全体フロー (7ステップ)

```
[① 商品リサーチ]    Amazon から日用品・消耗品のネタを抽出
        ↓
[② KW選定]         Gemini が 100件の関連KWを自動生成
        ↓
[③ KWスカウト]      DataForSEO の数値で「狙うべきKW」に絞り込み (Gemini×4 + DFS×4 の8段)
        ↓
[④ 競合調査]        SERP上位10件 + AI Overview の引用元を分析
        ↓ (採用KWが決定)
        ↓
[⑤ 記事生成]        各媒体の3段プロンプトで「サイトごとに別記事」を並列生成
        ↓
[⑥ ライブラリで確認]  生成記事を編集 / 画像生成 / コピー等
        ↓
[⑦ マルチポスト]    各媒体に「自分用の記事」を1ボタンで一括投稿
```

各ステップで **何が起きるか / どんなボタンを押すと何が動くか** を順に解説します。

---

## 2. ① 商品リサーチ (`/research` または `/bestsellers`)

### ユーザーが見る画面
- 商品リサーチタブ (6タブ構造: ベストセラー / 売れ筋 / 新着 / セール / 高評価 / 検索)
- 各タブに Amazon 商品が並ぶ。スコアと商品情報。

### 裏で動いていること
- **データ源**: Amazon (PA-API 本承認待ち、現在はスクレイピング)
  - `lib/amazonBestseller.ts` がカテゴリ別にスクレイプ
  - 結果は `bestseller_products` テーブルに保存 (再取得時のキャッシュ)

### ユーザーの操作
- 商品カードを見て「この商品で KW を発掘したい」と思ったら、その商品名をクリック
- → KWスカウト画面に商品名が subject として渡される

### 例
- 「メリーズ Merries テープ 新生児用 オムツ さらさらエアスルー」を選ぶ
- → KWスカウト画面で subject 欄に自動入力された状態で開く

---

## 3. ② + ③ + ④ KWスカウト (`/products`)

ここが MultiPostAI の心臓部。1スカウトで「Gemini が 4回 / DFS が 4回」呼ばれます。

### ユーザーが見る画面
- タブ構造: `新規スカウト | スカウト履歴 | 採用KW | 保留KW | スカウト設定`
- 「新規スカウト」タブで subject (商品名 / お題) を入力 → 「スカウト開始」ボタン

### スカウト開始すると裏で何が動くか (8段パイプライン)

```
[Stage 1] Gemini #1  ── 100件のKW候補を生成
  入力: subject + 設定の除外KW + KW生成プロンプト
  処理: 「商標+購入直前KWを100件出して。intent も付けて」と Gemini に指示
  出力: 100件 KW (例: 「メリーズ 新生児 価格」「Merries Amazon 在庫」など)
  コスト: 約 ¥1

[Stage 2] DFS #1     ── 各KWの難易度 (KD) を一括取得
  API: DataForSEO Labs / Bulk Keyword Difficulty Live
  入力: 100件のKW
  出力: 各KWに KD (0-100、低いほど狙いやすい)
  コスト: 約 ¥1.7

[Stage 3] Gemini #2  ── KD閾値で1次絞り込み + 重複/不適切除外
  入力: 100件 + 各KDスコア + 設定のKD閾値 (デフォルト30)
  処理: 「KD<=30 のものだけ残して、重複や不適切なものは除外して」
  出力: 30〜50件に絞られる
  コスト: 約 ¥2

[Stage 4] DFS #2     ── 各KWの主要指標を一括取得
  API: DataForSEO Labs / Keyword Overview Live
  入力: 30〜50件のKW
  取得: SV / CPC / 競合度 / 12ヶ月SV履歴 / intent / 上位サイトの平均被リンク数
  コスト: 約 ¥30-80

[Stage 5] Gemini #3  ── 数値ベースで2次絞り込み
  入力: 30〜50件 + 全数値 + 設定の SV最低/CPC最低/最終件数
  処理: 「SV>=100 AND CPC>=$0.2 のうち上位 5-10件を選んで」
  出力: 5〜10件に絞られる
  コスト: 約 ¥3

[Stage 6] DFS #3     ── 採用候補のSERP情報を全取得
  API: DataForSEO SERP / Google Organic Live Advanced
  入力: 5〜10件のKW (1KWずつ)
  取得: 上位10件URL + PAA + AI Overview引用元 + Featured Snippet 等
  コスト: 約 ¥2-3

[Stage 7] Gemini #4  ── 最終判定 + 根拠出力
  入力: 全情報 (数値 + SERP + AI Overview + PAA)
  処理: 「adopt / borderline / reject を判定して、必ず具体的根拠を80-200字で書け」
  出力: 採用KW 3-5件 (finalScore 0-100 + rationale)
  コスト: 約 ¥3

──────────────────────────
1スカウト合計コスト: 約 ¥50 (100KW中、3-5件採用)
```

### 例: subject=「メリーズ 新生児」

```
Stage 1 結果 (100件抜粋):
  "メリーズ 新生児 価格"
  "メリーズ Merries Amazon"
  "メリーズ さらさらエアスルー レビュー"
  "メリーズ パンパース 違い"
  ... 他96件

Stage 3 結果 (KD<30 で残った):
  30件
  ("メリーズ パンパース 違い" は KD=45 で落選など)

Stage 5 結果 (数値で絞った):
  8件
  "メリーズ 新生児 価格" (SV 480, CPC $0.42)
  "メリーズ Merries Amazon" (SV 1200, CPC $0.85)
  ... 他6件

Stage 7 結果 (最終判定):
  ✅ 採用: 4件
   - "メリーズ Merries Amazon" finalScore=82
     理由: kd=18 低、sv=1200で需要十分、上位10件中5件が個人ブログ、
           AI Overview引用元にkakaku.comあり解説需要明確
   ⚠ borderline: 1件
   ❌ 却下: 3件
```

### ユーザーの操作
- 採用KW候補のカードに 3ボタン:
  - **🔬 Ahrefs精査** — オプション (Ahrefs使う場合)
  - **保留** — `feed.ideas` テーブルに溜める (後でまとめて記事化)
  - **✍ 記事生成** — 全 destination に並列で記事生成キュー投入

### スカウト履歴
- 過去のスカウト結果は `product_scout_history` テーブルに保存
- 「スカウト履歴」タブから再表示可能

---

## 4. ⑤ 記事生成 (`/api/generate`)

### きっかけ
- **「✍ 記事生成」ボタン押下** (KWスカウト候補カード)
- **「✨このサイト用に生成」ボタン押下** (ライブラリ右下、未生成 destination 用)

### 並列生成の仕組み (2026-06-09 実装)
KWスカウトの「✍記事生成」を押すと、**プロンプト設定済みの全 destination に並列で**生成キュー投入されます。

```
[「✍ 記事生成」 1クリック]
   ↓
[note は 3段プロンプト設定済] → /api/generate (destinationId=noteDest)
[はてな は 3段プロンプト設定済] → /api/generate (destinationId=hatenaDest)
[livedoor はプロンプト未設定]   → スキップ
[FC2 は 3段プロンプト設定済]    → /api/generate (destinationId=fc2Dest)
[Blogger は 3段プロンプト設定済] → /api/generate (destinationId=bloggerDest)

→ 4記事が並列に生成される (各 destination 用に別記事)
```

### `/api/generate` の中身

#### 1. システムプロンプト解決 (どんな立場で書くか)
- destination の `prompt_config` (役割 / 著者プロフィール / ターゲット読者 等 10項目) から system prompt 構築
- または、destination の3段プロンプト (新)
- 主婦プロジェクトはデフォルトテンプレあり

#### 2. 3段プロンプトチェーン (どう書くか)
優先順位:
```
[A] destination.prompt_config.stages   (媒体別、設定→投稿先→[プロンプト])
    ↓ なければ
[B] project.article_gen_config.prompts (全媒体共通、ライブラリ→記事生成プロンプト)
    ↓ なければ
[C] 従来通り 1段で生成
```

#### 3. 段階生成 (A or B が設定済の場合)

```
[Stage 1: 骨組み作成]
  Gemini ← システムプロンプト + 「お題: メリーズ Merries Amazon」 + 1段目プロンプト
  例: 「この記事の骨組みを箇条書きで作って」
  出力: 章立てとポイント列挙 (中間テキスト)

[Stage 2: 本文展開]
  Gemini ← システムプロンプト + 「前段の出力」 + 2段目プロンプト
  例: 「上の骨組みから本文を800-1200字で書いて。実体験含めて」
  出力: 本文ドラフト (中間テキスト)

[Stage 3: 最終整形 + JSON出力]
  Gemini ← システムプロンプト + 「前段の出力」 + 3段目プロンプト + JSON フォーマット指示
  例: 「上の本文を、見出し/CTA/タグ整えた最終形にして」
  出力: { title_candidates, best_title, body_markdown, image_prompt_subject, image_alt_text }
```

#### 4. Article として DB 保存
- `articles` テーブルに INSERT
- KW (idea), destinationId, bestTitle, bodyMarkdown 等保存
- 記事タイトル裏側: idea.targetKeywordId と紐付け (KW単位グルーピングのため)

### 例
- KW: 「メリーズ Merries Amazon」 採用
- ✍記事生成押下
- → note 用記事 / はてな用記事 / Blogger 用記事 / FC2 用記事 が並列生成 (4記事)
- → ライブラリの該当KWに 4記事 が並ぶ (サイトタブで切り替え表示)

---

## 5. ⑥ ライブラリで確認・編集 (`/library`)

### ユーザーが見る画面
- タブ: `生成記事 | 記事生成プロンプト`
- 「生成記事」タブで:
  - 左カラム: KW一覧 (ジャンルプルダウン + KW検索でフィルタ)
  - 右カラム上部: サイトタブ (note / はてな / livedoor / FC2 / Blogger)
  - 右カラム本体: 該当 KW × 選択中サイト の記事プレビュー

### 操作可能なボタン
- **📤 マルチポスト** — モーダル開いて投稿
- **🔄 画像を再生成** — Nano Banana (Gemini Flash Image) で見出し画像生成 (¥6/枚)
- **🙈 画像を隠す/表示** — プレビュー上の見出し画像 toggle
- **↳ 派生案** — 同じテーマの派生 KW 5件をフィードに追加
- **✏️ 編集** — タイトル / 本文 を直接編集 → 保存
- **📋 コピー** — タイトル / 本文 をコピー
- **✨ このサイト用に生成** — まだ記事が無い destination に対して個別生成

### 編集機能の裏側
- タイトル/本文編集: `PATCH /api/articles/[id]` で DB 更新
- 画像生成: Gemini 2.5 Flash Image で生成 → Supabase Storage に upload → URL 返す
- 派生案: 既存記事を起点に Gemini が派生 KW を5件生成 → feed.ideas に追加

---

## 6. ⑦ マルチポスト (📤マルチポストボタン → モーダル)

### モーダルの構造
- タイトル (現在開いている記事のタイトル)
- 本文編集 (textarea でプレビュー編集可能)
- 投稿先選択 (チェックボックス):
  - note (拡張) — Chrome 拡張経由
  - はてなブログ ✓プロンプト有
  - livedoor Blog ⚠プロンプト無
  - FC2ブログ ⚠プロンプト無
  - Blogger ⚠プロンプト無
- タグ入力 (5個まで)
- 公開/下書き トグル

### 初期チェック状態
- note: 常時 ON
- 外部 destination: プロンプト設定済の destination のみ ON、未設定は OFF

### 「投稿実行」ボタン押下時 (2026-06-09 実装)

「同じKWの destination 別記事を集めて、各 destination が自分用の記事で投稿」する仕組み:

```
[ステップ1: KW識別]
  postModalArticle (開いている記事) から KW を識別
  
[ステップ2: 兄弟記事を集める]
  同じ KW の 全 destination 記事を articles[] から filter
  destinationId → Article のマップを作る
  
[ステップ3: チェックを入れた destination ごとに「自分用の記事」を投稿]
  各 destination について:
    - 自分用記事あり: その記事を投稿
    - 自分用記事なし: 開いている記事をフォールバックで投稿 (※注記付き)
  外部 destination は並列実行 (Promise.all)
```

### 投稿の裏側 (destination ごとの違い)

#### note 拡張経由
- Chrome 拡張機能が起動
- note.com の編集画面に自動入力 (タイトル / 本文 / タグ)
- 公開モードなら「公開」ボタン押下まで自動
- 下書きモードなら下書き保存で停止

#### 外部 destination (`/api/multipost`)
- 各 destination の platform に応じてアダプタが選ばれる:
  - **hatena**: AtomPub (XML POST、`/atom/entry` エンドポイント)
  - **livedoor**: AtomPub
  - **blogger**: Google API (OAuth2 アクセストークン)
  - **seesaa**: AtomPub
  - **FC2**: 未実装 (XML-RPC 切替予定)
- 投稿成功すると公開 URL を返す
- `article_postings` テーブルに記録 (記事ID / destination / status / URL / 時刻)

### 結果表示例
```
✅ note: 公開ボタン押下まで送信
✅ はてなブログ: 投稿完了 → https://katsugram.hatenablog.com/entry/2026/06/09/123456
✅ livedoor Blog: 投稿完了 → ... (※ 専用記事未生成のため別記事で代替)
❌ Blogger: 認証エラー (再連携が必要)
```

---

## 7. 設定面 (どこで何を設定するか)

### 設定タブ (`/settings`)
- **投稿先**: destination の登録・編集・削除・接続確認
- **記事生成モデル**: Claude or Gemini を選択 (ブラウザ単位、現在は Gemini デフォルト)
- **API連携**: DataForSEO / Ahrefs / Google Sheets / 各種ASP の認証情報
- **アカウント**: スタッフ用サブアカウントの発行

### KWスカウトタブ (`/products`)
- **スカウト設定**: KWスカウト の挙動を制御
  - 件数 (KW候補生成数 / 最終件数)
  - 閾値 (KD上限 / SV下限 / CPC下限)
  - 除外KW (改行区切り)
  - Gemini プロンプト4段 (Stage 1/3/5/7 — 上級者向けカスタマイズ)

### ライブラリタブ (`/library`)
- **記事生成プロンプト**: 全媒体共通の3段プロンプト
- (フォールバック用、各 destination のプロンプトが優先)

### destination 個別 (`/settings/destinations/[id]/prompt`)
- **媒体専用 3段プロンプト** (Stage 1/2/3) — 媒体ごとに異なる文章を書きたい時用
- 全 5媒体登録なら、5つの専用プロンプトを設定可能

---

## 8. データの流れ (DB スキーマ簡易図)

```
projects                       — プロジェクト (主婦/Amazon AFF/A8 AFF)
  scout_config                 — KWスカウト設定 (閾値・除外KW・プロンプト4段)
  article_gen_config           — 記事生成3段プロンプト (project共通)
  persona_config               — 著者ペルソナ (主婦プロジェクトのみ)
   ↓
posting_destinations           — 投稿先サイト (note / はてな / livedoor / FC2 / Blogger)
  prompt_config                — destination の 3段プロンプト (媒体別)
  config                       — 認証情報 (API key 等)
   ↓
product_scout_history          — KWスカウト履歴 (subject 単位)
  candidates                   — 採用KW候補リスト (JSON で保存)
   ↓
ideas (feed_ideas)             — ネタフィード (保留KW含む)
  idea.targetKeywordId         — KW識別子
   ↓
articles                       — 生成記事
  destinationId                — どのサイト用に生成された記事か
  idea                         — どのネタから生まれたか
  postedAt                     — 投稿完了時刻
   ↓
article_postings               — 投稿履歴 (記事 × destination × 結果)
  external_url                 — 公開URL
  status                       — success / failed
```

---

## 9. コスト感まとめ

| 操作 | 概算コスト |
|---|---|
| 1スカウト (KWスカウト 1回実行) | 約 ¥50 |
| 1記事生成 (Gemini 3段チェーン) | 約 ¥1〜3 |
| 1サイト分の見出し画像生成 | 約 ¥6 |
| 採用1KW × 5媒体並列生成 | 約 ¥5〜15 + 画像 ¥30 |
| 投稿 (API) | 無料 |
| AI Overview tracking (追加) | 採用1KW につき ¥0.1 |

→ **採用KW 5本 / 月 = 約 ¥300 (記事+画像+スカウト含む)**

---

## 10. 補足: 関連ドキュメント

- 専門用語の意味: `docs/GLOSSARY.md`
- DataForSEO 全エンドポイント技術詳細・取得可能情報: `docs/DFS_API_INVENTORY.md`
- Amazon アソシエイト申請手順: `docs/AMAZON_ASSOCIATE_SETUP.md`
