/**
 * Administration: who has access, with what role, and which simulations are
 * locked.
 *
 * Every call goes through a database function rather than writing a table.
 * `app_users` is readable but not writable from a browser, so the checks --
 * administrators only, valid role, never remove the last administrator, never
 * remove yourself -- live where they cannot be skipped by calling PostgREST
 * directly.
 */
import { supabase } from "./supabase";

export type AppRole = "admin" | "user";

export type AppUser = {
  email: string;
  role: AppRole;
  added_by: string | null;
  added_at: string;
};

export type LockedScenario = {
  scenario_id: string;
  be_no: string;
  name: string;
  set_by_email: string | null;
  set_at: string;
};

export async function listAppUsers(): Promise<AppUser[]> {
  const { data, error } = await supabase
    .from("app_users")
    .select("*")
    .order("role")
    .order("email");
  if (error) throw error;
  return (data ?? []) as AppUser[];
}

export async function grantAccess(email: string, role: AppRole): Promise<void> {
  const { error } = await supabase.rpc("admin_grant_access", {
    p_email: email,
    p_role: role,
  });
  if (error) throw new Error(error.message);
}

export async function setRole(email: string, role: AppRole): Promise<void> {
  const { error } = await supabase.rpc("admin_set_role", {
    p_email: email,
    p_role: role,
  });
  if (error) throw new Error(error.message);
}

export async function revokeAccess(email: string): Promise<void> {
  const { error } = await supabase.rpc("admin_revoke_access", { p_email: email });
  if (error) throw new Error(error.message);
}

/** Every locked simulation across every BOE. Never the password itself. */
export async function listLockedScenarios(): Promise<LockedScenario[]> {
  const { data, error } = await supabase.rpc("admin_locked_scenarios");
  if (error) throw error;
  return (data ?? []) as LockedScenario[];
}
