import "server-only";
import { postToHatena, type HatenaConfig } from "./hatena";
import { postToLivedoor, type LivedoorConfig } from "./livedoor";
import { postToFc2, type Fc2Config } from "./fc2";
import { postToSeesaa, type SeesaaConfig } from "./seesaa";
import type { PostArticleInput, PostArticleResult, PostingDestinationRow } from "./types";

export type {
  Platform,
  PostingDestinationRow,
  PostArticleInput,
  PostArticleResult,
  AffiliateSupport,
  PlatformConfigSchema,
} from "./types";
export {
  PLATFORM_LABELS,
  PLATFORM_AFFILIATE_SUPPORT,
  PLATFORM_CONFIG_SCHEMA,
} from "./types";

/** プラットフォーム横断の投稿関数。destination.platform を見て適切なアダプタを呼ぶ */
export async function postToDestination(
  destination: PostingDestinationRow,
  input: PostArticleInput,
): Promise<PostArticleResult> {
  switch (destination.platform) {
    case "hatena":
      return postToHatena(destination.config as unknown as HatenaConfig, input);
    case "note":
      return {
        ok: false,
        error: "note は Chrome 拡張経由で投稿するため、サーバーAPIからは投稿できません",
      };
    case "livedoor":
      return postToLivedoor(destination.config as unknown as LivedoorConfig, input);
    case "fc2":
      return postToFc2(destination.config as unknown as Fc2Config, input);
    case "seesaa":
      return postToSeesaa(destination.config as unknown as SeesaaConfig, input);
    case "blogger":
      // Phase 4-3 で実装予定 (Google OAuth2)
      return {
        ok: false,
        error: "Blogger 投稿はまだ実装されていません (OAuth2 対応中)",
      };
    case "ameba":
      // Phase 4-4 で実装予定 (Chrome 拡張経由)
      return {
        ok: false,
        error: "Ameba 投稿はまだ実装されていません (Chrome 拡張対応中)",
      };
    default:
      return {
        ok: false,
        error: `未対応のプラットフォーム: ${destination.platform}`,
      };
  }
}
