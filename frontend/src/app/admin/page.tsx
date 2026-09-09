import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminPanel } from "@/components/AdminPanel";
import { currentUser, supabaseServerComponent } from "@/lib/supabase-rsc";
import type { AppUser, LockedScenario } from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * Administration.
 *
 * The redirect below is a courtesy, not the guard: every function this page
 * calls re-checks `is_admin()` in the database, and `admin_locked_scenarios`
 * returns nothing to a non-administrator whatever route they reach it by.
 * A signed-in user who types /admin gets sent home rather than shown an
 * apologetic empty screen.
 */
export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in?next=/admin");

  const supabase = await supabaseServerComponent();
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) redirect("/");

  const [{ data: users }, { data: locks }] = await Promise.all([
    supabase.from("app_users").select("*").order("role").order("email"),
    supabase.rpc("admin_locked_scenarios"),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Import records
      </Link>

      <h1 className="mt-3 text-2xl font-bold tracking-tight">Administration</h1>
      <p className="mt-1.5 text-sm text-muted">
        Signed in as {user.email}
      </p>

      <div className="mt-8">
        <AdminPanel
          initialUsers={(users ?? []) as AppUser[]}
          initialLocks={(locks ?? []) as LockedScenario[]}
          currentEmail={(user.email ?? "").toLowerCase()}
        />
      </div>
    </main>
  );
}
