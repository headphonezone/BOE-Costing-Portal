import type { Metadata } from "next";
import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";
import { currentUser, isAdmin, isMember } from "@/lib/supabase-rsc";
import "./globals.css";

export const metadata: Metadata = {
  title: "BOE Costing Portal",
  description:
    "Look up any Bill of Entry by reference and model what-if costing scenarios against the actual import record.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Null on the sign-in page, which is the only route the proxy lets through
  // without a session. Everywhere else this is a real user.
  const user = await currentUser();
  // Signed in is not the same as allowed: removing an address does not end the
  // sessions already issued to it, so a session can outlive its access.
  const member = user ? await isMember() : true;
  const admin = member && user ? await isAdmin() : false;

  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="text-base font-semibold tracking-tight">BOE Costing Portal</span>
              <span className="text-xs text-muted">Ferrari Video</span>
            </Link>
            {user && (
              <nav className="flex items-center gap-5 text-sm text-muted">
                <Link href="/" className="hover:text-foreground">
                  Records
                </Link>
                <Link href="/upload" className="hover:text-foreground">
                  Upload BOE
                </Link>
                {admin && (
                  <Link href="/admin" className="hover:text-foreground">
                    Admin
                  </Link>
                )}
                <SignOutButton email={user.email ?? ""} />
              </nav>
            )}
          </div>
        </header>
        {user && !member ? (
          <main className="mx-auto max-w-md px-6 py-24 text-center">
            <h1 className="text-lg font-semibold">This account has no access</h1>
            <p className="mt-2 text-sm text-muted">
              You are signed in as <span className="font-medium">{user.email}</span>,
              but that address has not been granted access to the portal.
            </p>
            <p className="mt-4 text-sm text-muted">
              Ask an administrator to add it.
            </p>
          </main>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
