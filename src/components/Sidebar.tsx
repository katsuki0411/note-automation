"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NoteLogoFull } from "./NoteLogo";
import { logout } from "@/app/login/actions";

const NAV = [
  { href: "/", num: "01", label: "ネタ収集 ＆ 生成", desc: "Research & Generate" },
  { href: "/library", num: "02", label: "ライブラリ", desc: "Library" },
  { href: "/keywords", num: "03", label: "キーワード戦略", desc: "Keywords" },
  { href: "/platforms", num: "04", label: "情報源", desc: "Sources" },
  { href: "/settings", num: "05", label: "設定", desc: "Settings" },
];

export default function Sidebar({
  isMobileOpen = false,
  onCloseMobile,
}: {
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}) {
  const pathname = usePathname();
  return (
    <>
      {/* モバイル用バックドロップ */}
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
      <div className="px-6 pt-7 pb-5">
        <NoteLogoFull />
      </div>

      <nav className="px-3 flex-1 space-y-0.5">
        {NAV.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
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
                className={`text-[10px] font-mono tracking-widest ${
                  active ? "text-[color:var(--accent-dark)]" : "text-[color:var(--fg-muted)]"
                }`}
              >
                {item.num}
              </span>
              <span className="flex-1 leading-tight">
                <span
                  className={`block text-[14px] font-semibold ${
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
                <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--accent)]" />
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
    </>
  );
}
