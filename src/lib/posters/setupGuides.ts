// 各プラットフォームの API キー / 認証情報取得手順。
// SetupGuideModal で表示される。

import type { Platform } from "./types";

export type SetupStep = {
  title: string;
  body: string;         // 説明 (短文)
  hint?: string;        // 追加の注意・つまずきポイント
  codeSnippet?: string; // 入力例 / URL例 等を等幅で表示
  externalUrl?: { label: string; url: string };
};

export type SetupGuide = {
  intro?: string;       // 全体の冒頭文 (1〜2行)
  caveats?: string[];   // 全体注意事項
  steps: SetupStep[];
  officialDocs?: { label: string; url: string }[];
};

export const PLATFORM_GUIDES: Partial<Record<Platform, SetupGuide>> = {
  hatena: {
    intro:
      "はてなブログには AtomPub という公式 API があり、外部ツールから記事を投稿できます。下記3点を取得してください。",
    caveats: [
      "ブログの「編集モード」を必ず「Markdownモード」に設定 (基本設定 → 編集モード)。これがないと記事が崩れて表示されます。",
      "API キーは公開しないこと。設定で再発行可能 (投稿用メアドの再発行)。",
    ],
    steps: [
      {
        title: "はてなID を確認",
        body: "ログイン中のはてなアカウントの ID。ブログ管理画面の URL の `blog.hatena.ne.jp/<ここ>/...` 部分。",
        codeSnippet: "例: yourid",
        hint: "プロフィール画面 URL `hatena.ne.jp/<ここ>` でも確認可",
      },
      {
        title: "ブログURL を確認",
        body: "投稿対象ブログのドメイン。`xxxxx.hatenablog.com` 形式。",
        codeSnippet: "例: yourblog.hatenablog.com",
        hint: "https:// や末尾スラッシュは自動で除去されるので、コピペそのままで OK",
      },
      {
        title: "APIキーを取得",
        body: "ブログ管理画面 → 設定 → 詳細設定 → ページ最下部の AtomPub セクションに表示。「アカウント設定」の方からも参照可。",
        codeSnippet: "投稿用メアド: xxxxx.YYYYY@blog.hatena.ne.jp\n             ↑ここがAPIキー",
        hint: "投稿用メアドの「.」より左側 (xxxxx) がAPIキー。右側は無視",
        externalUrl: {
          label: "公式ヘルプ: AtomPub の使い方",
          url: "https://help.hatenablog.com/entry/atompub",
        },
      },
    ],
    officialDocs: [
      {
        label: "はてなブログ AtomPub 公式ドキュメント",
        url: "https://developer.hatena.ne.jp/ja/documents/blog/apis/atom",
      },
    ],
  },

  livedoor: {
    intro:
      "livedoor Blog には AtomPub API があります。管理画面で API キーを発行してください。",
    caveats: [
      "AtomPub API は無料プランでも利用可能ですが、PUREプランは投稿制限あり。",
    ],
    steps: [
      {
        title: "livedoor ID を確認",
        body: "ログイン用 ID。管理画面 URL `livedoor.blogcms.jp/blog/<ここ>/...` または マイページに表示。",
        codeSnippet: "例: yourname",
      },
      {
        title: "ブログ ID を確認",
        body: "ブログ URL `https://blog.livedoor.jp/<ここ>/` 部分。複数ブログを持っている場合は対象ブログのもの。",
        codeSnippet: "例: yourblog",
      },
      {
        title: "AtomPub API キーを発行",
        body: "管理画面 → ブログ設定 → API Key で発行ボタン。発行済みの場合は表示されているものをコピー。",
        codeSnippet: "例: abc123XYZdef456",
        hint: "発行ボタンを押すと既存キーは無効化されるので注意",
        externalUrl: {
          label: "livedoor Blog AtomPub の使い方",
          url: "https://help.livedoor.blog/archives/cat_50061077.html",
        },
      },
    ],
  },

  fc2: {
    intro:
      "FC2 ブログは AtomPub API に対応。Basic 認証 (ログインID + パスワード) で利用します。",
    caveats: [
      "パスワードを保存するため、専用アカウント or 2段階認証OFFの単一アカウントを用意するのが安全。",
      "FC2 は無料プランで自動投稿可。ただし広告掲載のみが目的のブログは削除対象。",
    ],
    steps: [
      {
        title: "ブログ ID を確認",
        body: "FC2ブログのサブドメイン。`xxxxx.blog.fc2.com` の xxxxx 部分。",
        codeSnippet: "例: yourblog",
      },
      {
        title: "FC2 ログイン ID を確認",
        body: "FC2 ID。ログイン画面に入力するもの。",
        codeSnippet: "例: yourname",
      },
      {
        title: "ログインパスワード",
        body: "FC2 ログインパスワードをそのまま入力。AtomPub の Basic 認証で使用。",
        hint: "現状 FC2 は AtomPub 用の別途 API キー発行に非対応。ログインパスワードを直接利用します",
        externalUrl: {
          label: "FC2 ブログ AtomPub マニュアル",
          url: "https://help.fc2.com/blog/manual/Etc/atompub/",
        },
      },
    ],
  },

  seesaa: {
    intro:
      "Seesaa ブログは AtomPub に対応。Basic 認証 (ログインメアド + パスワード) で利用します。",
    caveats: [
      "他社 ASP のアフィリエイトリンクは利用可。ただしアダルト・出会い系はNG。",
      "ステマ規制 (景表法 2023/10〜) で「PR」表記必須。",
    ],
    steps: [
      {
        title: "ブログ ID を確認 (数字)",
        body: "Seesaa の管理画面 URL に含まれる数字。",
        codeSnippet: "例: 487654321",
        hint: "管理画面の URL: blog.seesaa.jp/cms/article/list?blog_id=<ここの数字>",
      },
      {
        title: "ログインメアド",
        body: "Seesaa の登録メアド。AtomPub の Basic 認証に使用。",
        codeSnippet: "例: you@example.com",
      },
      {
        title: "ログインパスワード",
        body: "Seesaa ログインパスワード。専用 API キー機能はない。",
        externalUrl: {
          label: "Seesaaブログ AtomPub API について",
          url: "https://faq.seesaa.net/category/411232.html",
        },
      },
    ],
  },

  note: {
    intro:
      "note は公式 API がないため、専用 Chrome 拡張機能 (MultiPostAI Poster) 経由で投稿します。",
    caveats: [
      "拡張は note.com の DOM 操作で動くため、note 側のリニューアルで一時的に動かなくなる可能性があります。",
      "下書き保存まで。公開ボタンは現状ユーザーが手動で押す運用。",
    ],
    steps: [
      {
        title: "拡張機能をダウンロード",
        body: "投稿先一覧の note 行にある「📦 拡張DL」ボタンから zip を取得して展開。",
      },
      {
        title: "Chrome に読み込ませる",
        body: "chrome://extensions/ → 右上のデベロッパーモード ON → 「パッケージ化されていない拡張機能を読み込む」で展開したフォルダを選択。",
        hint: "MultiPostAI Poster (v0.2.0) が一覧に表示されれば成功",
      },
      {
        title: "サイトのアクセス権を許可",
        body: "拡張一覧で「MultiPostAI Poster」の「詳細」をクリック → 「サイトのアクセス」を「すべてのサイト」または現在の URL を許可。",
        hint: "「クリック時のみ」だと bridge.js が自動 inject されないので注意",
      },
      {
        title: "MultiPostAI を Hard Reload",
        body: "Cmd+Shift+R でアプリを再読み込みすると拡張が検出される。",
      },
    ],
  },
};
