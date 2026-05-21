import { notFound } from "next/navigation";
import { getDestination } from "@/lib/destinations";
import { requireProjectContext } from "@/lib/auth";
import { PLATFORM_LABELS, type Platform } from "@/lib/posters/types";
import PromptEditClient from "./PromptEditClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DestinationPromptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireProjectContext();
  const destination = await getDestination(ctx.projectId, id);
  if (!destination) {
    notFound();
  }
  const platformLabel = PLATFORM_LABELS[destination.platform as Platform] ?? destination.platform;
  return (
    <PromptEditClient
      destinationId={destination.id}
      destinationLabel={destination.label}
      platformLabel={platformLabel}
      initialPromptConfig={
        (destination.prompt_config ?? {}) as Record<string, string>
      }
      projectKind={(ctx as unknown as { kind?: string }).kind ?? null}
    />
  );
}
