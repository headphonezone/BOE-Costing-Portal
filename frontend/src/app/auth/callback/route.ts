import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { readableAuthError } from "@/lib/auth-errors";

/**
 * Where Google sends the reader back.
 *
 * OAuth returns a one-time code on the URL; this exchanges it for a session
 * and sets the cookie. It has to be a route handler rather than a page,
 * because only a handler can write cookies on the way through — the same
 * reason token refresh lives in proxy.ts.
 *
 * Anything that goes wrong here lands back on sign-in with a reason, rather
 * than on a blank page: a failed exchange and a cancelled consent screen look
 * identical to the reader otherwise.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/";

  // Google's own refusal — the reader cancelled, or consent was declined.
  const oauthError = searchParams.get("error_description") || searchParams.get("error");
  if (oauthError) {
    return NextResponse.redirect(
      `${origin}/sign-in?error=${encodeURIComponent(readableAuthError(oauthError))}`
    );
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/sign-in?error=No+sign-in+code+was+returned`);
  }

  const store = await cookies();
  const response = NextResponse.redirect(`${origin}${next}`);

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

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      `${origin}/sign-in?error=${encodeURIComponent(readableAuthError(error.message))}`
    );
  }

  return response;
}
