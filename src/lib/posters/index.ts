import { postToHatena, type HatenaConfig, type PostArticleInput, type PostArticleResult } from "./hatena";

export type Platform = "hatena"; // 今後 'livedoor' | 'blogger' | 'wordpress' を追加

export type PostingDestinationRow = {
  id: string;
  platform: Platform;
  label: string;
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
};

export type { PostArticleInput, PostArticleResult } from "./hatena";

/** プラットフォーム横断の投稿関数。destination.platform を見て適切なアダプタを呼ぶ */
export async function postToDestination(
  destination: PostingDestinationRow,
  input: PostArticleInput,
): Promise<PostArticleResult> {
  switch (destination.platform) {
    case "hatena":
      return postToHatena(destination.config as unknown as HatenaConfig, input);
    default:
      return {
        ok: false,
        error: `未対応のプラットフォーム: ${destination.platform}`,
      };
  }
}

/** プラットフォーム別のラベル */
export const PLATFORM_LABELS: Record<Platform, string> = {
  hatena: "はてなブログ",
};
