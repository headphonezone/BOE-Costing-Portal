import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Session refresh and the sign-in gate.
 *
 * `proxy.ts`, not `middleware.ts`: the middleware convention is deprecated in
 * Next 16 and renamed, though the behaviour is identical.
 *
 * Two jobs, and the order matters. Supabase access tokens are short-lived, so
 * the session is refreshed here, before any page renders — a server component
 * cannot set cookies, so if the refresh did not happen here it could not
 * happen at all, and a signed-in user would be logged out the moment their
 * token aged out.
 *
 * Then the gate: no session, no page. Next's own guidance is that proxy suits
 * optimistic checks and should not be a system's authorization solution, and
 * this obeys that — the boundary is the database. The policies grant to
 * `authenticated`, so a route that forgot this check would still be refused
 * every row. What the gate adds is that the reader gets a sign-in screen
 * rather than an empty one.
 */
const PUBLIC_PATHS = ["/sign-in", "/auth"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser, not getSession: it verifies the token with the auth server rather
  // than trusting whatever the cookie claims.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    // Carries the reader back to what they were trying to open, so a session
    // expiring mid-task does not also lose their place.
    url.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  if (user && path === "/sign-in") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Everything except Next's own assets and the favicon. The matcher has to
  // let the auth cookie be refreshed on ordinary navigations, so it cannot be
  // narrowed to the protected pages alone.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
