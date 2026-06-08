import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Operandi — Outreach Dashboard",
  description: "Live pipeline metrics, qualified leads, and what the system learned this week.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
