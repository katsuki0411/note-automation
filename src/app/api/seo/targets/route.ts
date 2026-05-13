import { NextRequest } from "next/server";
import { createTarget, listTargetsWithLatest, type CreateTargetInput } from "@/lib/seoRank";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const targets = await listTargetsWithLatest();
  return Response.json({ targets });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateTargetInput;
    if (!body?.kw || !body?.targetUrlPrefix) {
      return Response.json({ error: "kw, targetUrlPrefix は必須です" }, { status: 400 });
    }
    const target = await createTarget(body);
    return Response.json({ target });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ error: msg }, { status: 400 });
  }
}
