import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 16 では本番ビルドが Turbopack デフォルト。
  // 下の webpack() フックは dev (`next dev --webpack`) でのみ使われる。
  // 空の turbopack: {} を置いて「webpack 設定と Turbopack を併用」エラーを silence する。
  turbopack: {},

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
