import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listProjectsForUser } from "@/lib/projects";
import SelectProjectClient from "./SelectProjectClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SelectProjectPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const projects = await listProjectsForUser(user.id);
  return <SelectProjectClient userEmail={user.email ?? ""} projects={projects} />;
}
