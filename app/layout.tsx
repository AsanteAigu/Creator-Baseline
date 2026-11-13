import type { Metadata, Viewport } from "next";
import { PRODUCT_NAME } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: "Instagram post performance against each creator's own baseline.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
