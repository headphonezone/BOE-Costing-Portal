import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "BOE Costing Portal",
  description:
    "Look up any Bill of Entry by reference and model what-if costing scenarios against the actual import record.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-base font-semibold tracking-tight">BOE Costing Portal</span>
              <span className="text-xs text-muted">Ferrari Video</span>
            </Link>
            <nav className="flex items-center gap-5 text-sm text-muted">
              <Link href="/" className="hover:text-foreground">
                Records
              </Link>
              <Link href="/upload" className="hover:text-foreground">
                Upload BOE
              </Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
