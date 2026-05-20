import { NextRequest } from "next/server";
import {
  loadDestinations,
  createDestination,
} from "@/lib/destinations";
import type { Platform } from "@/lib/posters/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const destinations = await loadDestinations();
  return Response.json({ destinations });
}

export async function POST(req: NextRequest) {
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
    const dest = await createDestination(body);
    return Response.json({ destination: dest });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: message }, { status: 500 });
  }
}
