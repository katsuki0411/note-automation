import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Sidebar from "@/components/Sidebar";
import { GenerationProvider } from "@/components/GenerationProvider";
import GenerationStatusBar from "@/components/GenerationStatusBar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "note自動化システム",
  description: "主婦層向けnote記事をAIで量産",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex">
        <GenerationProvider>
          <Sidebar />
          <div className="flex-1 min-w-0 flex flex-col">
            <main className="flex-1 max-w-[1400px] mx-auto w-full px-8 py-10">{children}</main>
          </div>
          <GenerationStatusBar />
        </GenerationProvider>
      </body>
    </html>
  );
}
