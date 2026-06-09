# MultiPostAI 専門用語集

> 作成: 2026-06-09
> 対象読者: ツールを使う全員 (小社長 / 開発パートナー / スタッフ)
> 関連: 機能解説は `docs/PRODUCT_FLOW.md` を参照

ジャンル別 (SEO/LLMO指標 → ツール内部用語 → 投稿API用語 → 技術用語) で並べています。

---

## A. SEO / LLMO 指標

### KD (Keyword Difficulty / キーワード難易度)
- 範囲: 0〜100
- 意味: そのキーワードで上位表示するのがどれだけ難しいか
- 低いほど狙いやすい (個人ブログでも上位入りできる)
- 目安:
  - 0〜20: 簡単 (個人で十分戦える)
  - 20〜40: 中程度 (記事の質次第で勝てる)
  - 40〜60: 難しい (大手と戦う覚悟が必要)
  - 60〜100: 非常に難しい (個人参入はおすすめしない)
- 取得元: DataForSEO / Ahrefs
- 例: 「メリーズ 価格」KD=18 → 狙う / 「ベビーカー 比較」KD=56 → 避ける

### SV (Search Volume / 検索ボリューム)
- 意味: そのKWが Google で月にどれだけ検索されているか
- 単位: 月間検索数
- 目安:
  - 100未満: 需要薄、CV狙いなら可
  - 100〜1,000: 個人ブログに向く
  - 1,000〜10,000: 美味しい層
  - 10,000以上: 大手の主戦場、難易度高い
- 取得元: DataForSEO / Ahrefs / Google Keyword Planner
- 例: 「メリーズ 新生児 価格」SV=480 → 検索される

### CPC (Cost Per Click / クリック単価)
- 範囲: USD (ドル)、円換算は ×150 程度
- 意味: Google広告でそのKWに1クリックいくら払われているか
- 高いほど「広告主が金を出している = ニーズあり = 収益化しやすい」
- 目安:
  - $0.00〜$0.10: 広告主興味薄、AFFも厳しい
  - $0.10〜$0.50: そこそこ
  - $0.50〜$2.00: 旨味あり (アフィ向き)
  - $2.00以上: 高単価ジャンル (保険・転職・買取など)
- 取得元: DataForSEO Keyword Overview / Google Ads Keyword Planner
- 例: CPC=$0.85 → 1クリック ¥125 程度の広告価値あり

### SERP (Search Engine Results Page / 検索結果ページ)
- 意味: Google で検索した時に表示されるページ全体のこと
- 「SERP上位10件」= 検索結果のトップ10位までの記事
- SERPには色んな枠 (= SERP features) が出る (下記)

### SERP features (SERP内に出る特殊枠)
具体的には以下のもの:

- **AI Overview** (=旧 SGE): Gemini が要約を生成して表示する枠。引用元の URL が見える。**ここに自分の記事が拾われれば露出激増**。
- **Featured Snippet** (強調スニペット / 0位枠): 検索結果の最上部に出る「答え枠」。1位より目立つ。
- **Knowledge Panel** / **Knowledge Graph**: 右側に Wikipedia 風の枠。公式情報。
- **People Also Ask (PAA / 他の人はこちらも質問)**: 関連質問が折りたたみ式で並ぶ枠。**ここの質問は記事の見出しに使える**。
- **Shopping**: 商品ボックス枠。Amazon/楽天等の商品が並ぶ。
- **Top Stories**: 最新ニュース枠。
- **Video**: YouTube などの動画枠。
- **Image**: 画像横並び枠。

### Intent (検索意図)
- 意味: ユーザーがそのKWを検索する時に「何を求めているか」
- 種類 (DataForSEO の分類):
  - **informational** (情報探し): 「○○ とは」「○○ 仕組み」など
  - **navigational** (サイト探し): 「Amazon ログイン」「楽天 マイページ」など
  - **commercial** (検討中): 「○○ おすすめ」「○○ 比較」など
  - **transactional** (購入直前): 「○○ 価格」「○○ クーポン」「○○ Amazon」など
- このツール (MultiPostAI) は **transactional (購入直前) 系を最優先**で狙う
- ツール内では「purchase」と表記している場合もある (Gemini プロンプト由来)

### LLMO (Large Language Model Optimization / LLM最適化)
- 意味: SEO の AI時代版
- 「**ChatGPT / Claude / Gemini / Perplexity に拾われる記事を書くこと**」が目的
- 従来 SEO = Google 検索結果で上位を狙う
- LLMO = AI が引用元として選んでくれる記事を書く
- 評価軸: AI Overview に引用される / LLM Mentions が多い / 解説が明快

### DR (Domain Rating / ドメインランク)
- 範囲: 0〜100
- 意味: そのドメイン全体の権威性
- 「mybest.com の DR=72」= 強い、「個人ブログの DR=12」= 弱い
- 取得元: Ahrefs (主) / DataForSEO Domain Rank Overview
- 個人ブログで戦うなら、DR 低いサイトと並んでる KW を狙うのがコツ

---

## B. ツール内部用語

### subject (お題)
- スカウト開始時の入力値 (商品名 / お題 / フリーKW)
- 例: 「メリーズ Merries テープ 新生児用」
- これを元に Gemini が関連KWを100件生成

### 候補KW / Candidate
- Gemini が Stage 1 で生成した 100件のKW
- まだ評価前のリスト

### 採用KW / Adopted KW
- スカウト8段パイプライン後、Gemini #4 が「adopt」判定した KW
- これが実際に記事化される対象
- KWスカウトの「採用KW」タブで確認可能
- ライブラリの「📖 記事を見る」で該当記事に飛べる

### 保留KW / Pending KW
- 「✍記事生成」せず「保留」ボタンで一時保管したKW
- 後でまとめて記事化したい時に使う
- KWスカウトの「保留KW」タブで確認可能

### CVキーワード / 購入直前KW
- CV = Conversion (コンバージョン、=購入や成果)
- 「ユーザーが買おうとしている瞬間に検索するKW」
- 例: 「メリーズ Merries Amazon」「○○ 価格」「○○ クーポン」
- このツールは特にこの種類のKWを狙う方針 (MTG 2026-06-07 決定)

### 商標KW
- 商品名そのものを含むKW
- 例: 「Merries 新生児」「メリーズ さらさらエアスルー」
- このツールは商標KWを必ず含めて出力する方針

### 除外KW
- スカウト結果に含めたくないKW
- 例: 競合商標 / 偽物 / 自分の他商品名
- KWスカウト > スカウト設定 タブで設定可能 (1行1KW)
- Gemini #1 にも除外指示が伝わる + Stage1 後にもフィルタ

### 8段パイプライン
- KWスカウトの内部処理。Gemini が4回、DataForSEO が4回、交互に呼ばれる
- 1スカウト ¥50 程度のコストで 100KW → 採用 3〜5件に絞り込み
- 詳細は `PRODUCT_FLOW.md` 参照

### 3段プロンプトチェーン
- 記事生成の精度向上テクニック
- 1段目で骨組み → 2段目で本文 → 3段目で最終整形 と段階的に Gemini を呼ぶ
- 各段で別のプロンプトを使うことで品質が上がる (MTG 2026-06-07 決定)
- destination 単位 (= 各サイト別) と project 単位 (= 全媒体共通) の2層構造

### destination (投稿先サイト)
- 設定→投稿先 で登録する各サイトのこと
- 例: note / はてなブログ / livedoor Blog / FC2ブログ / Blogger
- 各 destination は独自の prompt_config (記事生成プロンプト) と config (認証情報) を持つ

### マルチポスト
- 1回の操作で複数の destination に投稿する仕組み
- ライブラリの「📤マルチポスト」ボタンから実行
- 2026-06-09 改修: 同じ KW の「各 destination 用の記事」をそれぞれ該当 destination に投稿する仕組みに変更

### platform
- destination の種類 (=どのブログサービスか)
- 値: `note`, `hatena`, `livedoor`, `fc2`, `seesaa`, `blogger`, `ameba`

### project / kind
- MultiPostAI 全体の中で複数の「サイト運営プロジェクト」を持てる
- kind は3種類:
  - `research_based`: ネタ収集型 (主婦専用テンプレあり)
  - `amazon_affiliate`: Amazon AFF 案件
  - `a8_affiliate`: A8.net 案件

### KW識別子 / targetKeywordId
- 同じKWの「destination 別記事」をグルーピングするための識別子
- ライブラリで「左カラム=KW / 右カラム=サイトタブ」表示を可能にする鍵

---

## C. 投稿 API / 投稿方式の用語

### AtomPub (Atom Publishing Protocol)
- ブログプラットフォームへの投稿用 API 仕様
- XML 形式で記事をPOST → 公開
- 対応: はてなブログ / livedoor Blog / Seesaa
- このツールでは `lib/posters/atompub.ts` で共通アダプタを実装

### XML-RPC (XML Remote Procedure Call)
- 古い投稿API仕様 (Movable Type系)
- FC2ブログは AtomPub 非対応で XML-RPC のみ
- このツールでは未実装 (タスク #61)

### OAuth2
- Google系API (Blogger等) で使う認証方式
- 「Googleで連携」ボタンを押す → Google でログイン → アクセストークンが destination に保存
- 期限切れたら「再連携」ボタンで再認証

### Chrome 拡張
- note は AtomPub も XML-RPC も非対応で、公式APIもない
- → ブラウザの Chrome 拡張機能 (`note-poster.zip`) で note.com の編集画面を自動操作
- 設定→投稿先→note行 の「📦拡張DL」でダウンロード可能

### 下書き / 公開 トグル
- マルチポストで OFF にすると下書き保存で停止
- 公開判断は人間が後でやりたい時に使う

---

## D. データソース / 外部API用語

### DataForSEO (DFS)
- KW評価 + SERP取得 のメインAPI
- 12カテゴリ (SERP / Keywords Data / Labs / Backlinks / Content Analysis / Merchant 等)
- このツールでは Labs (KD/SV/CPC/Intent) と SERP Advanced を中心に使う
- 詳細: `docs/DFS_CAPABILITIES.md`

### Ahrefs
- KW評価 + 競合分析の業界標準 SaaS
- このツールでは「Ahrefs精査」ボタンでオプション利用可能
- 現状は DataForSEO 中心方針 (Ahrefs は補助)

### Gemini (Google AI)
- Google の大規模言語モデル (LLM)
- このツールでは Gemini 2.5 Pro / Gemini 2.5 Flash / Gemini 2.5 Flash Image を使う
- KW生成 / 段階判定 / 記事生成 / 見出し画像生成 などで活躍

### Claude
- Anthropic 社の LLM (Claude Sonnet 4.6 など)
- 記事生成のオプションモデル (現在は Gemini デフォルト)

### Brave Search (旧採用、現在撤退済)
- かつて SERP取得に使っていた検索API
- 2026-06-03 に DataForSEO に完全移行

### PA-API (Product Advertising API)
- Amazon が提供する商品情報取得API
- アソシエイト登録 + 売上発生で本承認 → アクセス可能になる
- 現状: 承認待ち、暫定でスクレイピング (`lib/amazonBestseller.ts`) 使用

---

## E. 技術用語 (開発・運用関係)

### Supabase
- DB / 認証 / ストレージを提供する SaaS (Postgres ベース)
- このツールのデータは全部 Supabase に保存

### Vercel
- フロントエンドのデプロイ先 SaaS
- main ブランチへの push で自動デプロイ
- 本番URL: https://note-automation-rho.vercel.app

### Next.js 16
- フレームワーク。このツールが使ってる版は新しいので、訓練データと挙動が違う点あり
- 詳細: `web/AGENTS.md`

### マイグレーション
- DB スキーマの変更履歴ファイル (`supabase/migrations/0001_initial.sql` 〜)
- 新フィールド追加時は新マイグレーション作成 → Supabase Dashboard で手動実行
- 最新: `0016_project_configs.sql` (2026-06-09)

### mock モード
- DataForSEO や Ahrefs の API契約前に動作確認するための、偽データを返すモード
- `.env.local` に `DATAFORSEO_USE_MOCK=true` で有効化
- 契約後はこの行を消すと本番APIに切替

### env / 環境変数
- 認証情報・モード切替などの設定
- `.env.local` (ローカル) と Vercel 環境変数 (本番) に同じ内容を入れる
- 主な変数: `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` / Supabase 系 / `DATAFORSEO_LOGIN` 等

### Chain-of-Thought (CoT / 思考の連鎖)
- LLM の精度を上げるために「考えるステップを順番に踏ませる」テクニック
- 3段プロンプトチェーンも CoT の一種

### Placeholder (プレースホルダー)
- プロンプトテンプレ内で `{subject}` などの形で書く可変部分
- 実行時に subject の実値で置換される
- KWスカウト設定の Gemini プロンプト4段で使える (実装中)

### token (トークン)
- LLM が文字数を測る単位 (日本語1文字 ≒ 1.5 token、英語1単語 ≒ 1.3 token)
- 課金もこの単位

### responseSchema
- Gemini に「必ず指定 JSON 形式で返せ」と強制する仕組み
- このツールの KW判定はこれで rationale (根拠) を必須出力にしている

---

## F. よくある誤解 / 混同しやすい用語

### 「Intent」 と 「カテゴリ」の違い
- Intent = ユーザーの検索意図 (informational / commercial / transactional 等)
- カテゴリ = 商品ジャンル (家電 / ベビー・キッズ / 食品 等)
- 似てるけど別物

### 「採用KW」 と 「保留KW」の違い
- 採用KW = ✍記事生成ボタンを押して「記事化された」KW
- 保留KW = 保留ボタンで「とりあえず溜めた、まだ記事化していない」KW

### 「project」 と 「destination」の違い
- project = サイト運営プロジェクト全体 (例: 主婦専用 / Amazon AFF)
- destination = そのプロジェクト配下の各投稿先サイト (例: note / はてな / livedoor)

### 「最強KW」 と 「採用KW」
- かつての通称「最強KW」 = 正式名称「採用KW」 (同じもの)

### 「ネタ化」 と 「保留」
- 旧称「ネタ化」 → 2026-06-04 に「保留」にリネーム済み (同じ動作)

---

## G. 略語一覧 (ABC 順)

| 略語 | 正式名称 |
|---|---|
| AFF | Affiliate (アフィリエイト) |
| AI Overview | Google AI Overview (旧 SGE = Search Generative Experience) |
| API | Application Programming Interface |
| ASP | Affiliate Service Provider (アフィリエイトサービス会社) |
| CPC | Cost Per Click (クリック単価) |
| CV | Conversion (コンバージョン、成果) |
| DFS | DataForSEO |
| DR | Domain Rating |
| FAQ | Frequently Asked Questions |
| HTML | HyperText Markup Language |
| JSON | JavaScript Object Notation |
| KD | Keyword Difficulty (キーワード難易度) |
| KW | Keyword (キーワード) |
| LLM | Large Language Model |
| LLMO | Large Language Model Optimization |
| MTG | Meeting (ミーティング) |
| OAuth | Open Authorization |
| PAA | People Also Ask (他の人はこちらも質問) |
| PA-API | Product Advertising API (Amazon) |
| PR | Pull Request |
| RPC | Remote Procedure Call |
| SaaS | Software as a Service |
| SDK | Software Development Kit |
| SEO | Search Engine Optimization |
| SERP | Search Engine Results Page |
| SGE | Search Generative Experience (旧称、現 AI Overview) |
| SV | Search Volume (検索ボリューム) |
| TS | TypeScript |
| UI | User Interface |
| URL | Uniform Resource Locator |
| UX | User Experience |
| XML | eXtensible Markup Language |
