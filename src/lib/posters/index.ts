import "server-only";
import { postToHatena, type HatenaConfig } from "./hatena";
import { postToLivedoor, type LivedoorConfig } from "./livedoor";
import { postToFc2, type Fc2Config } from "./fc2";
import { postToSeesaa, type SeesaaConfig } from "./seesaa";
import { postToBlogger, type BloggerConfig } from "./blogger";
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

/**
 * プラットフォーム横断の投稿関数。destination.platform を見て適切なアダプタを呼ぶ。
 * ctx は token refresh 時に DB 更新が必要なアダプタ (現状 blogger) のために使う。
 */
export async function postToDestination(
  destination: PostingDestinationRow,
  input: PostArticleInput,
  ctx?: { projectId: string },
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
      // FC2 は AtomPub 非対応 (XML-RPC のみ)。XML-RPC 実装は別タスクで対応予定
      return {
        ok: false,
        error: "FC2 への自動投稿は現状未対応です (FC2 が AtomPub を提供していないため、XML-RPC 実装が必要)",
      };
    case "seesaa":
      return postToSeesaa(destination.config as unknown as SeesaaConfig, input);
    case "blogger": {
      if (!ctx) {
        return {
          ok: false,
          error: "Blogger 投稿には projectId コンテキストが必要です (内部エラー)",
        };
      }
      return postToBlogger(
        destination.config as unknown as BloggerConfig,
        input,
        { projectId: ctx.projectId, destinationId: destination.id },
      );
    }
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
