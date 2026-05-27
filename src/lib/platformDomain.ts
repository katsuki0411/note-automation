import type { Platform } from "./posters/types";

// 各プラットフォームを判定するためのホストパターン定数。
// Brave 上位30件の URL のホスト名と照合して「そのプラットフォームに既に競合記事があるか」を判定する。

const PLATFORM_HOSTS: { platform: Platform; hosts: string[] }[] = [
  { platform: "note", hosts: ["note.com"] },
  {
    platform: "hatena",
    hosts: ["hatenablog.com", "hatenadiary.jp", "hatenablog.jp", "hateblo.jp"],
  },
  {
    platform: "livedoor",
    hosts: ["livedoor.blog", "livedoor.jp", "blog.livedoor.jp"],
  },
  { platform: "fc2", hosts: ["blog.fc2.com", "fc2.com"] },
  { platform: "seesaa", hosts: ["seesaa.net", "blog.seesaa.jp"] },
  { platform: "ameba", hosts: ["ameblo.jp"] },
  { platform: "blogger", hosts: ["blogspot.com", "blogspot.jp", "blogger.com"] },
];

function matchesHost(host: string, candidates: string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return candidates.some((c) => h === c || h.endsWith(`.${c}`));
}

// 上位 URL リストから、各 platform に該当するヒット数を返す。
// 例: 上位30件に note.com の記事が3本あれば → { note: 3 }
export function detectPlatformOccupancy(urls: string[]): Partial<Record<Platform, number>> {
  const counts: Partial<Record<Platform, number>> = {};
  for (const url of urls) {
    try {
      const u = new URL(url);
      for (const p of PLATFORM_HOSTS) {
        if (matchesHost(u.hostname, p.hosts)) {
          counts[p.platform] = (counts[p.platform] ?? 0) + 1;
          break;
        }
      }
    } catch {
      // invalid url skip
    }
  }
  return counts;
}
