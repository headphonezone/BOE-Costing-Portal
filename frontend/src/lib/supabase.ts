import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, anonKey);

/**
 * The parser service. It ships in the same Vercel deployment as this app
 * (see frontend/api/), so the default is same-origin and needs no host, no
 * CORS and no environment variable.
 *
 * Local development is the exception: the parser runs as its own process on
 * port 8000, so `frontend/.env.local` overrides this. Needed only for PDF
 * upload and the two Excel downloads.
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api";
