# DataForSEO 登録・本番化 手順

> 作成: 2026-06-09
> 対象読者: 小社長 / 開発パートナー (実際に触る人)
> 関連: `docs/DFS_CAPABILITIES.md` (何が取れるか)
>       `docs/PRODUCT_FLOW.md` (どこで使われるか)

---

## 0. 全体像 (所要時間 = 約30分)

```
[1] アカウント登録      (3分、無料)
   ↓
[2] メール認証           (2分)
   ↓
[3] デポジット入金       (5分、最低 $50 / 約 7,500円)
   ↓
[4] API 認証情報取得     (1分、ダッシュボードから取得)
   ↓
[5] ローカル .env.local 設定 + dev サーバー再起動  (3分)
   ↓
[6] Vercel 環境変数設定 + Redeploy                (5分)
   ↓
[7] mock OFF + 動作確認                            (3分)
   ↓
[8] (任意) 設定画面でも個別保存                    (2分)
```

---

## 1. アカウント登録

### 1-1. サイトにアクセス
[https://dataforseo.com/](https://dataforseo.com/) を開く

### 1-2. Sign Up
- 右上の **「Sign Up」** または ページ中央の **「Get Started Free」** をクリック
- 入力項目:
  - **Email**: 業務用メアド推奨 (このメアド = ログイン名 にもなる)
  - **Password**: 強めのパスワード (これは管理画面ログイン用)
  - **Company / Use Case**: 任意。「Personal SEO research」等でOK
  - **利用規約に同意** にチェック

→ 「Create Account」 ボタン

---

## 2. メール認証

- 登録メアドに DataForSEO から確認メールが届く
- 件名: 「Confirm your email」 のような感じ
- メール内の **「Verify Email」 / 「Confirm」 ボタンをクリック**
- → DataForSEO のダッシュボードに自動ログイン

⚠ 届かない場合: 迷惑メールフォルダ確認 / `support@dataforseo.com` をホワイトリストに

---

## 3. デポジット入金

DataForSEO は **プリペイド方式** (先払い式)。最低 $50 から。

### 3-1. ダッシュボードから入金画面へ
- ダッシュボード上部 / サイドバー の **「Billing」** または **「Deposits」**

### 3-2. 支払い方法を選択
- **Credit Card** (Visa / Master / Amex / JCB)
- **PayPal**
- **Wire Transfer** (銀行振込、$5,000以上向け)
- **暗号通貨** (BTC / USDT / 等)

→ 個人なら **Credit Card が簡単**

### 3-3. 入金額
- 最低 **$50** (約 7,500円)
- 推奨: 最初は **$50 で試して、回ってきたら追加入金**
- $50 で 約150スカウト分 (1スカウト ¥50 換算)

### 3-4. 入金完了
- 数分以内に残高反映
- ダッシュボードの上部に残高表示 (例: `Balance: $50.00`)

⚠ **重要**: デポジット式なので「使った分だけ減る」モデル。残高 0 = API 停止 になるので低残高アラートを設定推奨 (Settings → Billing で閾値指定可能)

---

## 4. API 認証情報の取得

### 4-1. 認証情報ページへ
- ダッシュボード → **「Settings」** または **「API Dashboard」** → **「API Access」**
- (UI更新で名称が違う場合あり。「Credentials」「My APIs」も同じ意味)

### 4-2. 表示される情報
```
Login:        your-email@example.com    (= 登録時のメアドそのまま)
Password:     XXXXXXXXXXXXXXXX           (= API 専用パスワード)
```

⚠ **重要 — ログインパスワードと API パスワードは別物**
- 管理画面ログイン用パスワード = 自分で決めたもの
- **API パスワード = DataForSEO が自動生成した文字列**
- API リクエストには **API パスワード** を使う

### 4-3. メモる
両方コピーしてメモ:
- `DATAFORSEO_LOGIN` = メアド
- `DATAFORSEO_PASSWORD` = API パスワード

⚠ 漏らさない (環境変数経由のみ、Slack や メールに貼らない)

### 4-4. (任意) API パスワード再生成
- 漏洩した場合は「Regenerate Password」ボタンで作り直し可能
- ただし古いパスワードで動いてる API は全部停止するので注意

---

## 5. ローカル `.env.local` 設定

### 5-1. .env.local を編集
`web/.env.local` ファイルに以下を追記:

```bash
# DataForSEO API (本番)
DATAFORSEO_LOGIN=your-email@example.com
DATAFORSEO_PASSWORD=XXXXXXXXXXXXXXXX

# Mock モード を OFF (= 本物の DFS API を叩く)
# DATAFORSEO_USE_MOCK=true   ← この行をコメントアウト or 削除
```

### 5-2. dev サーバー再起動
**シングルトンクライアントを使っているので、env変更後は再起動が必須:**

```bash
# 動いている dev サーバーを Ctrl+C で止める
# その後:
cd web
npm run dev
```

→ http://localhost:3010 で起動

---

## 6. Vercel 環境変数設定 (本番用)

ローカルだけだと本番 (Vercel) では効かないので、Vercel 側にも設定が必要。

### 6-1. Vercel ダッシュボードへ
[https://vercel.com/](https://vercel.com/) → ログイン → `note-automation` プロジェクト

### 6-2. 環境変数追加
- **Settings** → **Environment Variables**
- 「Add New」 ボタンをクリック

#### 1個目
- Name: `DATAFORSEO_LOGIN`
- Value: `your-email@example.com`
- Environments: **Production / Preview / Development 全部にチェック**
- 「Save」

#### 2個目
- Name: `DATAFORSEO_PASSWORD`
- Value: `XXXXXXXXXXXXXXXX`
- Environments: 全部
- 「Save」

#### 3個目 (削除も必要)
- もし `DATAFORSEO_USE_MOCK` が `true` で設定されていたら **削除** (またはコメントアウト)
- 残ってると本番でも mock モードのまま動いてしまう

### 6-3. Redeploy
環境変数を変えても自動デプロイは走らないので、手動で再デプロイ:
- **Deployments** タブ → 最新の deployment → 「Redeploy」 ボタン
- 「Use existing Build Cache」 のチェックは **外す** (env 変更を確実に反映するため)

または、何か小さい変更を git push すれば auto-deploy が走る (こちらが安全)

---

## 7. 動作確認

### 7-1. ローカル
1. http://localhost:3010 を開く
2. **KWスカウト** に移動
3. **新規スカウト** タブで subject を入力 (例: 「ベビーカー 軽量」)
4. 「**スカウト開始**」ボタン押下
5. 8段パイプラインが走る (約30秒-1分)
6. 結果が表示される

**チェックポイント**:
- ✅ 結果カードに `KD` / `月Vol` / `CPC` の **実数値** が出ている
- ✅ 「📋 mock」のような表示が出ていない (= 本番データを取れている証拠)
- ✅ AI Overview 引用元が出ていれば、SERP Advanced も動いている
- ✅ DataForSEO ダッシュボードの「Usage」を見ると、リクエストが記録されている

### 7-2. 本番 (Vercel)
1. https://note-automation-rho.vercel.app を開く
2. 同じ手順でスカウト実行
3. ローカルと同じ動作なら成功

### 7-3. 残高消費確認
- DataForSEO ダッシュボード → **「Usage」** または **「API Statistics」**
- 1スカウト後に残高が **約 $0.05** 減っていれば正常 (¥50 / 100=$0.05)

---

## 8. (任意) 設定画面で個別保存

env 経由ではなく、UI から保存する方法もあります。
**メインの KWスカウト機能は env を読むので、env 設定が必須**ですが、個別機能 (Ahrefs精査ボタン等) は user_integrations テーブル経由でユーザー別に保存可能。

### 手順
1. http://localhost:3010 → **設定** → **API連携** タブ
2. **DataForSEO** の折り畳みを開く
3. Login / Password を入力
4. 「保存」ボタン

→ `user_integrations` テーブルに保存される (env が無くても動く一部機能のみ)

---

## 9. コスト管理

### 9-1. 概算消費
- **1スカウト** (100KW → 採用5件) ≒ **$0.34** (約 ¥50)
  - Bulk KD 100KW: $0.011
  - Keyword Overview 30KW: $0.30
  - SERP Advanced 10KW: $0.02
  - その他: 数 cent

### 9-2. 月50スカウト想定
- $0.34 × 50 = **約 $17/月** (約 ¥2,500)
- → $50 デポジットで 約3ヶ月分

### 9-3. 低残高アラート
- DataForSEO ダッシュボード → **「Billing」** → **「Alert Settings」**
- 例: 残高 $10 を下回ったらメール通知

### 9-4. オートチャージ (任意)
- 残高が閾値を下回ったら自動で再入金する設定もある
- 個人なら手動入金で十分

---

## 10. トラブルシューティング

### 認証エラー (401 Unauthorized)
```
Error: DataForSEO API error: 401
```

原因と対処:
- Login (メアド) のタイポ → 確認
- API Password が漏れててリセットされた → ダッシュボードで Regenerate → 環境変数更新
- API Password にスペース混入 → `.trim()` で対処してあるが、ダブルクオートで囲んでないか確認

### 残高不足 (402 Payment Required)
```
Error: DataForSEO API error: 402
```
→ ダッシュボードで残高確認 → 入金

### Rate Limit (429 Too Many Requests)
DataForSEO は 1秒 2,000req まで OK なので、通常は起きない。
起きた場合は: 1分待つ → 自動回復

### Mock データが返ってくる
ヒント:
- DATAFORSEO_USE_MOCK=true が残ってないか env を確認
- dev サーバーを再起動したか確認 (シングルトンクライアントのため)
- 本番 (Vercel) では Redeploy したか確認

### 地域 (location_code) が違うエリアの結果が返ってくる
- このツールは Japan (2392) + 日本語 (ja) でデフォルト固定済
- 問題ない

---

## 11. チェックリスト (完了確認用)

登録完了後、以下を全部確認:

- [ ] DataForSEO ダッシュボードにログインできる
- [ ] 残高が $50 以上ある
- [ ] API Login / Password をメモした
- [ ] ローカル `web/.env.local` に `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` を追加
- [ ] ローカル `web/.env.local` から `DATAFORSEO_USE_MOCK=true` を削除 (コメントアウト)
- [ ] ローカル dev サーバーを再起動
- [ ] http://localhost:3010 でスカウトが本番データで動く
- [ ] Vercel 環境変数に `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` を追加
- [ ] Vercel から `DATAFORSEO_USE_MOCK` を削除
- [ ] Vercel で Redeploy 実行
- [ ] 本番 (https://note-automation-rho.vercel.app) でスカウトが本番データで動く
- [ ] DataForSEO ダッシュボードの Usage に消費記録あり

---

## 12. 関連リンク

- DataForSEO 公式: https://dataforseo.com/
- API ドキュメント: https://docs.dataforseo.com/v3/
- 価格表: https://dataforseo.com/pricing
- サポート: support@dataforseo.com / ライブチャット (ダッシュボード右下)
- 当ツール側ドキュメント:
  - 何が取れるか: `docs/DFS_CAPABILITIES.md`
  - 全エンドポイント技術詳細: `docs/DFS_API_INVENTORY.md`
  - 投稿フローの中での使われ方: `docs/PRODUCT_FLOW.md`
