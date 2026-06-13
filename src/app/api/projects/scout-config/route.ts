import { NextRequest } from "next/server";
import { withProjectContext } from "@/lib/auth";
import {
  loadScoutConfig,
  saveScoutConfig,
  type ScoutConfig,
} from "@/lib/projectConfigs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/projects/scout-config
// → 現プロジェクトの scout_config を返す
export async function GET() {
  return withProjectContext(async (ctx) => {
    try {
      const config = await loadScoutConfig(ctx.projectId);
      return Response.json({ config });
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "unknown" },
        { status: 500 },
      );
    }
  });
}

// PUT /api/projects/scout-config
// body: ScoutConfig
// → 現プロジェクトの scout_config を保存
export async function PUT(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    try {
      const body = (await req.json()) as ScoutConfig;
      // 簡易バリデーション (型と範囲)
      const sanitized: ScoutConfig = {
        kwCandidateCount: clampInt(body.kwCandidateCount, 1, 500),
        maxFinalCount: clampInt(body.maxFinalCount, 1, 50),
        minSv: clampInt(body.minSv, 0, 1_000_000),
        minCpc: clampFloat(body.minCpc, 0, 1000),
        excludeKws: Array.isArray(body.excludeKws)
          ? body.excludeKws
              .map((s) => (typeof s === "string" ? s.trim() : ""))
              .filter((s) => s.length > 0)
              .slice(0, 1000)
          : undefined,
        promptKwGen: stringOrUndefined(body.promptKwGen, 20_000),
        promptStage3: stringOrUndefined(body.promptStage3, 20_000),
        promptFinal: stringOrUndefined(body.promptFinal, 20_000),
      };
      // undefined を除去
      const cleaned: ScoutConfig = Object.fromEntries(
        Object.entries(sanitized).filter(([, v]) => v !== undefined),
      );
      await saveScoutConfig(ctx.projectId, cleaned);
      return Response.json({ ok: true, config: cleaned });
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "unknown" },
        { status: 500 },
      );
    }
  });
}

function clampInt(v: unknown, min: number, max: number): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(min, Math.min(max, Math.round(n)));
}
function clampFloat(v: unknown, min: number, max: number): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(min, Math.min(max, n));
}
function stringOrUndefined(v: unknown, maxLen: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}
