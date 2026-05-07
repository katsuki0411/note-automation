# note自動化システム（Phase 1〜2）

主婦層向けnote記事を **AIで量産** するためのWebアプリ。

## 構成

```
[1] ネタ収集（Gemini 2.5 Pro + Google Search Grounding）
     ↓
[2] 記事生成（Claude Sonnet 4.6） + アイキャッチ画像生成（Imagen 3）
     ↓
[3] ライブラリで確認・コピー → noteへ手動貼り付け（Phase 3で自動化予定）
```

## セットアップ

### 1. 環境変数を設定

`.env.example` をコピーして `.env.local` を作成し、APIキーを記入:

```bash
cp .env.example .env.local
```

```
GEMINI_API_KEY=...    # https://aistudio.google.com/apikey
ANTHROPIC_API_KEY=... # https://console.anthropic.com
```

### 2. 起動

```bash
npm run dev
```

→ http://localhost:3000

## 使い方

1. **① ネタ収集** にテーマ（例「AI時短術 主婦」）を入力 → 10件のネタが提案される
2. 採用するネタにチェック → 「記事生成へ」
3. **② 記事生成** で「一括生成スタート」 → 記事Markdown ＋ アイキャッチ画像が生成
4. **③ ライブラリ** でMarkdownコピー / 画像DL → noteへ貼り付け

## 保存先

- 記事: `data/articles.json`
- 画像: `public/generated-images/{articleId}.png`

両方とも `.gitignore` 済み。

## Phase 3 以降の予定

- browser-use でnoteへ自動投入（下書き＋予約投稿）
- Threads公式API連携（共感投稿の自動予約）
