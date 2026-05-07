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

### 1. clone & install

```bash
git clone https://github.com/katsuki0411/note-automation.git
cd note-automation
npm install
```

> Node.js 20 以上推奨。

### 2. 環境変数

`.env.example` を `.env.local` にコピーしてAPIキーを入れます。

```bash
cp .env.example .env.local
```

| 変数 | 必須 | 用途 | 取得先 |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | ✅ | ネタ収集・ホットキーワード発掘 | https://aistudio.google.com/apikey |
| `ANTHROPIC_API_KEY` | ✅ | Claude Sonnet 4.6 で記事生成 | https://console.anthropic.com |
| `GOOGLE_CSE_ID` | 推奨 | Custom Search の検索エンジンID | https://programmablesearchengine.google.com/ |
| `GOOGLE_CSE_API_KEY` | 推奨 | Custom Search の APIキー | Google Cloud Console |
| `BRAVE_SEARCH_API_KEY` | 任意 | CSEのフォールバック検索 | https://api.search.brave.com/app/keys |

> APIキーはオーナーから1Password等で安全に受け取ってください。Gemini と CSE のAPIキーは別キー必須（同じキー内で両方の制限を満たせない）。

### 3. 起動

```bash
npm run dev
```

→ http://localhost:3000

## 開発フロー（Collaborator向け）

```bash
# 最新を取得
git pull

# ブランチ切る
git checkout -b feature/your-task

# 変更してコミット
git add -p && git commit -m "..."

# push & PR
git push -u origin feature/your-task
gh pr create --fill   # or GitHub UI から
```

> `data/` 配下（articles.json / keywords.json / hot-keywords.json 等）と `.env.local` は `.gitignore` 済みでrepoには入りません。各自ローカルで個別管理になります。

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
