// クライアント/サーバー双方で安全に import できる型・定数のみを定義する。
// 投稿アダプタ本体 (node:crypto などサーバー専用 API を使う) は
// `./hatena` 等で実装し、`./index.ts` 経由でサーバーからのみ import する。

// マルチポスト対応プラットフォーム。
// note は Chrome 拡張経由で投稿するが、prompt_config を持つために
// destination として登録する。各 project に1個自動投入される。
// ameba は Amazon/A8 等の外部ASP禁止だが、マルチ投稿枠組みには含める。
export type Platform =
  | "hatena"
  | "note"
  | "livedoor"
  | "fc2"
  | "seesaa"
  | "blogger"
  | "ameba";

export type PostingDestinationRow = {
  id: string;
  platform: Platform;
  label: string;
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
  prompt_config?: Record<string, unknown>;
};

export type PostArticleInput = {
  title: string;
  bodyMarkdown: string;
  tags?: string[];
  draft?: boolean;
  imageUrl?: string;
};

export type PostArticleResult = {
  ok: boolean;
  url?: string;
  editUrl?: string;
  error?: string;
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  hatena: "はてなブログ",
  note: "note",
  livedoor: "livedoor Blog",
  fc2: "FC2ブログ",
  seesaa: "Seesaaブログ",
  blogger: "Blogger",
  ameba: "Amebaブログ",
};

// 各プラットフォームのアフィリエイト対応状況。
// マルチポスト UI / DestinationsTab 表示で「Amazon/A8 対応」バッジに使う。
// note: 商業利用ガイドラインで概ねOKだが Amazon リンクは note 公式機能経由が推奨
// ameba: 2020年4月から外部ASP全面禁止 (Ameba Pick のみ可)
export type AffiliateSupport = {
  amazon: boolean;
  a8: boolean;
  notes?: string; // 制約や注意事項
};

export const PLATFORM_AFFILIATE_SUPPORT: Record<Platform, AffiliateSupport> = {
  hatena: {
    amazon: true,
    a8: true,
    notes: "個人営利利用ガイドラインに従い連絡先 (メアド/問合せフォーム) 明記必須",
  },
  note: {
    amazon: true,
    a8: true,
    notes: "商業利用ガイドライン要確認。Amazonは note 公式の商品紹介機能経由が推奨",
  },
  livedoor: {
    amazon: true,
    a8: true,
    notes: "スマホ版は PURE プラン以外OK。アダルト広告・300px超オーバーレイ広告NG",
  },
  fc2: {
    amazon: true,
    a8: true,
    notes: "公式 Amazon連携あり (最大8%)。広告掲載のみが目的のブログは削除対象",
  },
  seesaa: {
    amazon: true,
    a8: true,
    notes: "ステマ規制 (景表法 2023/10〜) で「PR」表記必須",
  },
  blogger: {
    amazon: true,
    a8: true,
    notes: "Google ポリシー的にスパム的利用はNG。Amazonアソシエイトに blogspot.com サブドメインの登録要",
  },
  ameba: {
    amazon: false,
    a8: false,
    notes:
      "⚠ 2020年4月から外部ASP全面禁止。Ameba Pick 経由のみ。違反 → 記事削除/凍結リスク",
  },
};

// プラットフォーム別の config に必要なフィールド (UI フォーム描画用のメタ情報)。
// false / undefined は「不要」、true は「必須」。
export type PlatformConfigSchema = {
  fields: {
    key: string;
    label: string;
    type: "text" | "password" | "url";
    placeholder?: string;
    hint?: string;
  }[];
  // 投稿実装が現状未対応な場合 true (UI 上「枠組みのみ」表示)
  notImplementedYet?: boolean;
  // OAuth フロー専用 (フォーム入力ではなく「連携」ボタンで埋める)。
  // 現状 blogger のみ true。UI 側で fields の代わりに OAuth 開始ボタンを描画。
  oauthOnly?: boolean;
};

export const PLATFORM_CONFIG_SCHEMA: Record<Platform, PlatformConfigSchema> = {
  hatena: {
    fields: [
      {
        key: "hatenaId",
        label: "はてなID",
        type: "text",
        placeholder: "例: 〇〇〇",
        hint: "ログイン時の本来のはてなID。AtomPub URL の /xxx/yyy.hatenablog.com/atom の xxx 部分",
      },
      {
        key: "blogDomain",
        label: "ブログURL",
        type: "text",
        placeholder: "例: 〇〇〇.hatenablog.com",
        hint: "ホスト名のみ。https:// や末尾スラッシュは自動で除去",
      },
      {
        key: "apiKey",
        label: "APIキー",
        type: "password",
        placeholder: "例: xxxxxxxxxxxx",
        hint: "アカウント設定→APIキー欄に表示の値 (投稿用メアドの「.」より左側と同じ)",
      },
    ],
  },
  note: {
    fields: [],
    // note は Chrome 拡張経由のため、destination 側で接続情報なし
  },
  livedoor: {
    fields: [
      {
        key: "livedoorId",
        label: "livedoor ID",
        type: "text",
        placeholder: "例: 〇〇〇",
        hint: "livedoor のログインID",
      },
      {
        key: "blogId",
        label: "ブログID",
        type: "text",
        placeholder: "例: 〇〇〇",
        hint: "ブログURL https://blog.livedoor.jp/<ここ>/ の部分",
      },
      {
        key: "apiKey",
        label: "AtomPub API キー",
        type: "password",
        placeholder: "例: xxxxxxxxxxxx",
        hint: "管理画面 → ブログ設定 → API Key で発行",
      },
    ],
  },
  fc2: {
    fields: [
      {
        key: "blogId",
        label: "ブログID",
        type: "text",
        placeholder: "例: 〇〇〇",
        hint: "FC2ブログのサブドメイン部分 (xxx.blog.fc2.com の xxx)。情報は保存できますが現状投稿不可",
      },
      {
        key: "username",
        label: "FC2 ID",
        type: "text",
        placeholder: "例: 〇〇〇",
      },
      {
        key: "password",
        label: "パスワード",
        type: "password",
        placeholder: "例: xxxxxxxxxxxx",
        hint: "現状の AtomPub 実装は FC2 で動作しません。XML-RPC 切替検討中",
      },
    ],
    // FC2 は AtomPub 提供がなく XML-RPC API のみ。投稿は別途実装が必要 → 準備中マーク
    notImplementedYet: true,
  },
  seesaa: {
    fields: [
      {
        key: "blogId",
        label: "ブログID (数字)",
        type: "text",
        placeholder: "例: 123456",
        hint: "Seesaa の管理画面 URL の数字部分",
      },
      {
        key: "email",
        label: "ログインメアド",
        type: "text",
        placeholder: "例: 〇〇〇@example.com",
      },
      {
        key: "password",
        label: "パスワード",
        type: "password",
        placeholder: "例: xxxxxxxxxxxx",
      },
    ],
  },
  blogger: {
    // OAuth フロー専用: フォーム入力なし。ラベルだけ入力 → 「Google で連携」ボタンを押すと
    // /api/destinations/blogger/oauth/start にリダイレクトし、戻りで OAuth トークンと
    // blog 情報が config に保存される。
    fields: [],
    oauthOnly: true,
  },
  ameba: {
    fields: [],
    // Ameba は Chrome 拡張経由 (将来実装)
    notImplementedYet: true,
  },
};
