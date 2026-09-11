import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { hasServiceKey, supabaseServer } from "@/lib/supabase-server";
import { NOT_PERMITTED } from "@/lib/auth-errors";

/**
 * Email-only sign-in.
 *
 * Temporary, and deliberately weak: an address on the allowlist is the whole
 * of the check. Nothing proves the person typing it owns that address, so
 * anyone who knows or guesses one gets in as that person -- administrators
 * included. It exists so the portal stops depending on a Google OAuth client
 * shared with another project. Put a real proof of identity back (Google, a
 * password, an emailed code) before relying on this for anything that matters.
 *
 * How a session is issued without one: the service key generates a magic-link
 * token for the address -- generateLink only returns it, no email is sent --
 * and the token is redeemed here at once. That issues the session and sets
 * the cookie exactly as following the link would have.
 */
export async function POST(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const next = safeNext(String(form.get("next") ?? "/"));

  const back = (message: string) =>
    NextResponse.redirect(
      `${origin}/sign-in?error=${encodeURIComponent(message)}&next=${encodeURIComponent(next)}`,
      303
    );

  // A form posted from another site would otherwise sign this browser in as
  // whichever address that site chose.
  const from = request.headers.get("origin");
  if (from && from !== origin) {
    return back("That sign-in request did not come from this site.");
  }

  if (!email.includes("@")) return back("Enter your work email address.");

  // Without the service key the lookup below runs as anon, sees an empty
  // allowlist, and turns everyone away as "not permitted" -- wrong, and
  // impossible to diagnose from the screen.
  if (!hasServiceKey) {
    return back("Sign-in is not configured on this server. Tell an administrator.");
  }

  const { data: member, error: lookupError } = await supabaseServer
    .from("app_users")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  if (lookupError) return back("Could not check access just now. Try again.");
  if (!member) return back(NOT_PERMITTED);

  // The first sign-in creates the account. After that it already exists,
  // which is the normal case rather than an error.
  const { error: createError } = await supabaseServer.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (
    createError &&
    createError.code !== "email_exists" &&
    !/already/i.test(createError.message)
  ) {
    return back("Could not set up your account. Tell an administrator.");
  }

  const { data: link, error: linkError } = await supabaseServer.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) return back("Could not sign you in just now. Try again.");

  const store = await cookies();
  const response = NextResponse.redirect(`${origin}${next}`, 303);
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (cookiesToSet) =>
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          ),
      },
    }
  );

  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (verifyError) return back("Could not sign you in just now. Try again.");

  return response;
}

/** A path on this site only: to a browser, "//host" and "/\host" are other sites. */
function safeNext(raw: string): string {
  return raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : "/";
}
