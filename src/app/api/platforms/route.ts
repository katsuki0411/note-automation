import { NextRequest } from "next/server";
import { createPlatform, loadPlatforms, type CreatePlatformInput } from "@/lib/platforms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const platforms = await loadPlatforms();
  return Response.json({ platforms });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreatePlatformInput;
    if (!body?.domain || !body?.label || !body?.category) {
      return Response.json(
        { error: "domain, label, category は必須です" },
        { status: 400 },
      );
    }
    const p = await createPlatform(body);
    return Response.json({ platform: p });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: msg }, { status: 500 });
  }
}
