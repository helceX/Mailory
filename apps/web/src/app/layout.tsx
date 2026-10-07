import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";

// Pages are rendered per request so each response can carry its own CSP nonce.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Mailory", template: "%s · Mailory" },
  description: "Modern, AI-assisted email marketing for teams and startups.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
