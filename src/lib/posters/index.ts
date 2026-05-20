import "server-only";
import { postToHatena, type HatenaConfig } from "./hatena";
import type { PostArticleInput, PostArticleResult, PostingDestinationRow } from "./types";

export type { Platform, PostingDestinationRow, PostArticleInput, PostArticleResult } from "./types";
export { PLATFORM_LABELS } from "./types";

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
