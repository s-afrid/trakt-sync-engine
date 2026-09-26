import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trakt Sync Engine | Sync Trakt, Letterboxd & MyAnimeList",
  description:
    "Unified sync engine bridging your watch history across Trakt.tv, Letterboxd, and MyAnimeList. Built for Vercel Serverless.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png", sizes: "32x32" },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className="antialiased bg-[#07090E] text-slate-100 min-h-screen"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
