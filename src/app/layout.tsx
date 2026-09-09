import type { Metadata } from "next";
import { publicEnv } from "@/config/env";
import { GLOBAL_FONT_CLASSES } from "@/lib/server/theme-fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: publicEnv.NEXT_PUBLIC_APP_NAME,
  description: "VELORA — Piattaforma SaaS multi-tenant",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={GLOBAL_FONT_CLASSES}>
      <body>{children}</body>
    </html>
  );
}
