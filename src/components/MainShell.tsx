"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { GenerationProvider } from "@/components/GenerationProvider";
import GenerationStatusBar from "@/components/GenerationStatusBar";
import { NoteLogoFull } from "@/components/NoteLogo";

export default function MainShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  // ルート遷移時にドロワーを閉じる
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <GenerationProvider>
      {/* モバイル用ヘッダーバー（md以上で非表示） */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 bg-white border-b border-[var(--border-subtle)]">
        <button
          type="button"
          aria-label="メニューを開く"
          onClick={() => setDrawerOpen(true)}
          className="p-2 -ml-2 rounded hover:bg-gray-50"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <NoteLogoFull />
        <div className="w-9" aria-hidden />
      </header>

      <div className="md:flex md:min-h-full">
        {/* デスクトップ: 通常のサイドバー / モバイル: ドロワーオーバーレイ */}
        <Sidebar isMobileOpen={drawerOpen} onCloseMobile={() => setDrawerOpen(false)} />

        <div className="flex-1 min-w-0 flex flex-col">
          <main className="flex-1 max-w-[1400px] mx-auto w-full px-4 md:px-8 py-6 md:py-10">
            {children}
          </main>
        </div>
      </div>

      <GenerationStatusBar />
    </GenerationProvider>
  );
}
