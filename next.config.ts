import type { NextConfig } from "next";
import type { Configuration } from "webpack";

const nextConfig: NextConfig = {
  // iCloud Drive 配下 (`com~apple~CloudDocs`) で .next/dev/cache/webpack/*.pack.gz が
  // iCloud 同期に巻き込まれて ENOENT を頻発させる問題への対策:
  // dev のみ webpack のキャッシュをディスク → メモリに切り替えてファイル書き込み自体を発生させない。
  // (本番ビルドはディスクキャッシュのほうが速いので prod では維持)
  webpack(config: Configuration, { dev }) {
    if (dev) {
      config.cache = { type: "memory" };
    }
    return config;
  },
};

export default nextConfig;
