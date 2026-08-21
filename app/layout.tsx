import type { Metadata } from "next";
import "./globals.css";
import "./header-spacing.css";

export const metadata: Metadata = {
  title: "BursaMusangKing Quant Terminal",
  description: "Explainable full-universe Bursa Malaysia quantitative ranking.",
  manifest: "/manifest.webmanifest",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
