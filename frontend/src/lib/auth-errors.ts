/**
 * What the reader is told when sign-in fails.
 *
 * An address that is not on the allowlist is refused by a trigger on
 * auth.users, and the auth service reports every database-side refusal the
 * same way: "Database error saving new user". That is true and useless — it
 * reads as a fault in the portal, so the person tries again, then asks a
 * colleague why the site is broken. The refusal is not a fault, so it is
 * named as what it is.
 *
 * Everything else passes through unchanged. Flattening every failure into one
 * friendly sentence would hide the real ones: a misconfigured provider and a
 * declined consent screen need different answers, and only the message
 * distinguishes them.
 */
export function readableAuthError(raw: string): string {
  if (/database error (saving|creating) new user/i.test(raw)) {
    return "You are not permitted to use this portal. Access is granted by an administrator — ask to be added, then sign in again.";
  }
  if (/provider is not enabled/i.test(raw)) {
    return "Google sign-in is not switched on for this portal yet. Tell an administrator.";
  }
  if (/access_denied|consent|cancell?ed/i.test(raw)) {
    return "Sign-in was cancelled.";
  }
  return raw;
}
