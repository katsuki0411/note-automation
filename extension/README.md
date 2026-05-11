# note-automation Poster (Chrome 拡張)

note-automation で生成した記事を note.com に自動投稿するための内部 Chrome 拡張。

## 配布方針

- 社内特定メンバーのみが使用（Chrome Web Store 公開なし）
- 開発者モードで「パッケージ化されていない拡張機能を読み込む」で導入

## インストール手順

1. Chrome のアドレスバーに `chrome://extensions` を開く
2. 右上の「デベロッパーモード」を ON
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. このリポジトリの `extension/` フォルダを選択
5. note.com に普通にログインしておく

## 動作確認（単体テスト）

1. Chrome 右上のパズルアイコンから「note-automation Poster」をピン留め
2. アイコンをクリックしてポップアップを開く
3. タイトルと本文を貼り付けて「下書き保存で投稿テスト」を押す
4. note.com の新規投稿ページが開いて、自動でフォームに入力される

## 現状の制約（初版）

- **下書き保存まで**。`publish:true` は未実装（DOM 確認後に追加）
- セレクタは推定値で書いてある（`content.js` 内に `TODO` マーク）。実機の note 投稿ページに合わせて差し替える必要あり
- タグ・有料/無料・コメント可否・マガジン未対応
- アイキャッチ画像未対応

## Webアプリ連携（未実装）

`externally_connectable` に以下を登録済み：
- `http://localhost:3000/*`
- `https://note-automation-rho.vercel.app/*`

Webアプリ側から `chrome.runtime.sendMessage(EXTENSION_ID, { type: 'POST_ARTICLE', payload: { title, body, publish } }, cb)` を叩けば同じ動作になる予定。Webアプリ側ボタン実装は次フェーズ。

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `manifest.json` | MV3 マニフェスト |
| `background.js` | ポップアップ/Webアプリからの指示を受け、note 投稿ページのタブを開いて content.js に渡す |
| `content.js` | note 投稿ページ上で DOM 操作してタイトル・本文を入力 |
| `popup.html` / `popup.js` | 単体テスト用 UI |
