"use client";

import Link from "next/link";
import { useState, useRef, useEffect, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { NoteLogoFull } from "./NoteLogo";
import { logout } from "@/app/login/actions";
import { selectProject } from "@/app/select-project/actions";
import { getNavItemsForKind } from "@/lib/navItems";
import { PROJECT_KIND_LABEL, type ProjectKind, type ProjectMembership } from "@/lib/projects-types";
import ProjectManagerModal from "./ProjectManagerModal";

const KIND_ICON: Record<ProjectKind, string> = {
  research_based: "📰",
  amazon_affiliate: "🛒",
  a8_affiliate: "💰",
};

export default function Sidebar({
  isMobileOpen = false,
  onCloseMobile,
  currentProject,
  allProjects,
}: {
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
  currentProject: ProjectMembership;
  allProjects: ProjectMembership[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    if (pickerOpen) {
      document.addEventListener("mousedown", onDocClick);
      return () => document.removeEventListener("mousedown", onDocClick);
    }
  }, [pickerOpen]);

  function switchTo(slug: string) {
    if (slug === currentProject.slug) {
      setPickerOpen(false);
      return;
    }
    startTransition(async () => {
      await selectProject(slug);
      router.refresh();
    });
    setPickerOpen(false);
  }

  return (
    <>
      <div
        className={`md:hidden fixed inset-0 z-40 bg-black/40 transition-opacity ${
          isMobileOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onCloseMobile}
        aria-hidden
      />
      <aside
        className={`fixed md:static z-50 top-0 left-0 w-64 shrink-0 h-screen md:h-screen md:sticky md:top-0 flex flex-col bg-white border-r border-[var(--border-subtle)] transition-transform md:transform-none ${
          isMobileOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0`}
      >
        <div className="px-6 pt-7 pb-3">
          <NoteLogoFull />
        </div>

        {/* プロジェクト切替ピッカー */}
        <div className="px-3 pb-4" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            disabled={pending}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-white hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span
                className="text-[14px] shrink-0"
                title={PROJECT_KIND_LABEL[currentProject.kind] ?? currentProject.kind}
              >
                {KIND_ICON[currentProject.kind] ?? "📁"}
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[color:var(--accent-soft)] text-[color:var(--accent-dark)] shrink-0">
                {currentProject.slug}
              </span>
              <span className="text-[12px] font-semibold text-[color:var(--fg-primary)] truncate">
                {currentProject.display_name}
              </span>
            </span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`text-[color:var(--fg-muted)] shrink-0 transition-transform ${
                pickerOpen ? "rotate-180" : ""
              }`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {pickerOpen && (
            <div className="mt-1.5 rounded-lg border border-[var(--border-subtle)] bg-white shadow-md max-h-72 overflow-y-auto">
              {allProjects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => switchTo(p.slug)}
                  className={`w-full text-left px-3 py-2 hover:bg-[color:var(--accent-soft)] flex items-center gap-2 ${
                    p.slug === currentProject.slug ? "bg-[color:var(--accent-soft)]" : ""
                  }`}
                >
                  <span
                    className="text-[12px] shrink-0"
                    title={PROJECT_KIND_LABEL[p.kind] ?? p.kind}
                  >
                    {KIND_ICON[p.kind] ?? "📁"}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 shrink-0">
                    {p.slug}
                  </span>
                  <span className="text-[12px] truncate">{p.display_name}</span>
                </button>
              ))}
              <Link
                href="/select-project"
                className="block w-full text-left px-3 py-2 text-[11px] text-[color:var(--accent-dark)] hover:bg-[color:var(--accent-soft)] border-t border-[var(--border-subtle)]"
                onClick={() => setPickerOpen(false)}
              >
                + 新規 / 一覧へ
              </Link>
            </div>
          )}
        </div>

        <nav className="px-3 flex-1 space-y-0.5">
          {getNavItemsForKind(currentProject.kind).map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                  active
                    ? "bg-[color:var(--accent-soft)]"
                    : "hover:bg-gray-50"
                }`}
              >
                <span
                  className={`shrink-0 flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
                    active
                      ? "bg-white text-[color:var(--accent-dark)] ring-1 ring-[color:var(--accent)]/30"
                      : "bg-gray-50 text-[color:var(--fg-secondary)] group-hover:text-[color:var(--fg-primary)]"
                  }`}
                >
                  <Icon size={18} />
                </span>
                <span className="flex-1 leading-tight min-w-0">
                  <span
                    className={`block text-[14px] font-semibold truncate ${
                      active ? "text-[color:var(--accent-dark)]" : "text-[color:var(--fg-primary)]"
                    }`}
                  >
                    {item.label}
                  </span>
                  <span
                    className={`block text-[10px] uppercase tracking-[0.18em] mt-0.5 ${
                      active ? "text-[color:var(--accent)]" : "text-[color:var(--fg-muted)]"
                    }`}
                  >
                    {item.desc}
                  </span>
                </span>
                {active && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--accent)] shrink-0" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="px-6 py-5 border-t border-[var(--border-subtle)] space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--fg-muted)] mb-1.5">
              Phase
            </div>
            <div className="text-[12px] text-[color:var(--fg-secondary)]">
              1 / 2 — Research & Generate
            </div>
          </div>
          <button
            type="button"
            onClick={() => setProjectSettingsOpen(true)}
            className="block text-[11px] text-[color:var(--fg-muted)] hover:text-[color:var(--fg-primary)] transition-colors"
          >
            ⚙ プロジェクト設定
          </button>
          <form action={logout}>
            <button
              type="submit"
              className="text-[11px] text-[color:var(--fg-muted)] hover:text-[color:var(--fg-primary)] transition-colors"
            >
              ログアウト →
            </button>
          </form>
        </div>
      </aside>

      {projectSettingsOpen && (
        <ProjectManagerModal
          projects={allProjects}
          currentSlug={currentProject.slug}
          onClose={() => setProjectSettingsOpen(false)}
        />
      )}
    </>
  );
}
