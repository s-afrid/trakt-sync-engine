import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Harbor · Trakt Sync Engine",
  description:
    "Unified sync engine bridging your watch history across Trakt.tv, Letterboxd, and MyAnimeList. Built for Vercel Serverless.",
  applicationName: "Harbor",
  icons: {
    icon: [
      { url: "/harbor-icon.png", type: "image/png", sizes: "any" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: "/harbor-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#111213",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Harbor typography: Switzer (sans) + Sentient (wordmark/display) */}
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="" />
        <link rel="preconnect" href="https://cdn.fontshare.com" crossOrigin="" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=sentient@400,500,600,700&f[]=switzer@400,500,600,700&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body
        className="antialiased bg-canvas text-ink min-h-screen"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}

