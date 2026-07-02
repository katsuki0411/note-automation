import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // iCloud Drive (com~apple~CloudDocs) 配下のため、dev のビルド成果物 (.next) が
  // iCloud 同期に巻き込まれて「.next 2」等の重複ファイルが作られ、manifest 破損 →
  // CSS 404 / ChunkLoadError / 素HTML表示 を起こす。
  // 対策: dev のみ distDir を末尾 .nosync にする (macOS iCloud は .nosync 終端を同期対象外にする)。
  // 本番 (Vercel, NODE_ENV=production) は通常の .next のまま。
  distDir: process.env.NODE_ENV === "development" ? ".next.nosync" : ".next",

  // Next.js 16 では本番ビルドが Turbopack デフォルト。
  // 下の webpack() フックは dev (`next dev --webpack`) でのみ使われる。
  // 空の turbopack: {} を置いて「webpack 設定と Turbopack を併用」エラーを silence する。
  turbopack: {},

  // /manual ページは docs/*.md をサーバー側で fs 読み込みして表示する。
  // Vercel のサーバーレス関数バンドルに docs/ を確実に含めるためトレースに追加。
  outputFileTracingIncludes: {
    "/manual": ["./docs/**/*"],
    // 見出し画像のタイトル合成で使う日本語フォントを関数バンドルに含める。
    "/api/image": ["./assets/fonts/**/*"],
  },

  // @napi-rs/canvas はネイティブ(.node)モジュール。webpack/turbopack でバンドルせず
  // 実行時に require させる (見出し画像のタイトル文字合成で使用)。
  serverExternalPackages: ["@napi-rs/canvas"],

  // 旧URLからのリダイレクト (2026-06-01: /bestsellers → /research に統合)
  async redirects() {
    return [
      {
        source: "/bestsellers",
        destination: "/research",
        permanent: true,
      },
    ];
  },

  // iCloud Drive 配下 (`com~apple~CloudDocs`) で .next/dev/cache/webpack/*.pack.gz が
  // iCloud 同期に巻き込まれて ENOENT を頻発させる問題への対策:
  // dev のみ webpack のキャッシュをディスク → メモリに切り替えてファイル書き込み自体を発生させない。
  // (本番ビルドは Turbopack を使うのでこの関数は呼ばれない)
  webpack(config, { dev }) {
    if (dev) {
      config.cache = { type: "memory" };
    }
    return config;
  },
};

export default nextConfig;
