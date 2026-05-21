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
    case "note":
      // note は Chrome 拡張経由で投稿するため、サーバー側からは投稿しない。
      // destination として登録しているのは prompt_config を持たせるため。
      return {
        ok: false,
        error: "note は Chrome 拡張経由で投稿するため、サーバーAPIからは投稿できません",
      };
    default:
      return {
        ok: false,
        error: `未対応のプラットフォーム: ${destination.platform}`,
      };
  }
}
