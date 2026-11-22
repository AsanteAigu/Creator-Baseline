import type { Metadata, Viewport } from "next";
import { Inter, Outfit } from "next/font/google";
import { PRODUCT_NAME } from "@/lib/config";
import "./globals.css";

// Self-hosted by next/font at build time, so browsers never call Google for them.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap" });

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description: "Instagram post performance against each creator's own baseline.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5f5f7",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Browser extensions inject attributes on <html> before hydration; this suppresses only
    // that element's attribute diff, not mismatches deeper in the tree.
    <html lang="en-GB" suppressHydrationWarning className={`${inter.variable} ${outfit.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
