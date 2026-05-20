import { NextRequest } from "next/server";
import {
  loadDestinations,
  createDestination,
} from "@/lib/destinations";
import type { Platform } from "@/lib/posters/types";
import { withProjectContext } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withProjectContext(async (ctx) => {
    const destinations = await loadDestinations(ctx.projectId);
    return Response.json({ destinations });
  });
}

export async function POST(req: NextRequest) {
  return withProjectContext(async (ctx) => {
    try {
      const body = (await req.json()) as {
        platform: Platform;
        label: string;
        config: Record<string, unknown>;
        enabled?: boolean;
      };
      if (!body.platform || !body.label || !body.config) {
        return Response.json(
          { error: "platform / label / config が必要です" },
          { status: 400 },
        );
      }
      const dest = await createDestination(ctx.projectId, ctx.userId, body);
      return Response.json({ destination: dest });
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
