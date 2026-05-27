"use client";

import { createContext, useContext } from "react";
import type { ProjectMembership } from "@/lib/projects-types";

const Ctx = createContext<ProjectMembership | null>(null);

export function ProjectProvider({
  value,
  children,
}: {
  value: ProjectMembership;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// 現在の project (membership 込み) を取得。MainShell 配下からのみ呼び出し可。
export function useProject(): ProjectMembership {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProject must be used inside ProjectProvider (MainShell)");
  return v;
}
