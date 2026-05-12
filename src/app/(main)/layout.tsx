import Sidebar from "@/components/Sidebar";
import { GenerationProvider } from "@/components/GenerationProvider";
import GenerationStatusBar from "@/components/GenerationStatusBar";

export default function MainLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-full flex">
      <GenerationProvider>
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col">
          <main className="flex-1 max-w-[1400px] mx-auto w-full px-8 py-10">
            {children}
          </main>
        </div>
        <GenerationStatusBar />
      </GenerationProvider>
    </div>
  );
}
