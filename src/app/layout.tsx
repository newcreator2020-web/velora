import type { Metadata } from "next";
import { publicEnv } from "@/config/env";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: publicEnv.NEXT_PUBLIC_APP_NAME,
    template: `%s | ${publicEnv.NEXT_PUBLIC_APP_NAME}`,
  },
  description: "VELORA — Piattaforma SaaS multi-tenant",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
