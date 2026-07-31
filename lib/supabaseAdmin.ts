// SERVER-ONLY Supabase client — uses the powerful SERVICE-ROLE key.
//
// IMPORTANT: never import this from a client component or anything that ships to
// the browser. It must only be used inside server route handlers (app/api/**).
// The service-role key bypasses row-level security, so it can call the staff-only
// "brain" functions like lfh_floor_state(). It is read from the root .env.local
// and never sent to the browser — this is the "secrets live in one place" rule.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// EVERY database request gets a deadline. Without one, a hanging TLS handshake never rejects, so
// the handler never returns and the request burns to the platform's function wall — measured
// 2026-07-31, when this project's database dropped out for ~40 minutes: /api/health, which exists
// to answer 503 FAST so a watchdog notices, instead returned nothing for 70s and later took 19.5s.
// Every panel spun, the offline bar never tripped, and four separate errors were recorded with no
// clear cause (238 statement-timeouts + 69 "upstream request timeout") instead of one honest one.
//
// 8 seconds because that is PostgREST's own statement ceiling here: past it the database has
// already given up, so waiting longer can only turn a fast honest error into a hang. It is PER
// REQUEST, not per page — a cold analytics compute is many short calls, so this doesn't cut
// legitimate work short. A caller that passes its own signal always wins, so a deliberately long
// job can still opt out.
//
// The same lesson was already learned for phone alerts (lib/alerts.ts uses AbortSignal.timeout) —
// it just never reached the database client, which is the one every screen depends on.
export const DB_TIMEOUT_MS = 8000;
const withDeadline: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(DB_TIMEOUT_MS) });

// One shared admin client. `persistSession: false` because the server is
// stateless — it doesn't keep a logged-in user around between requests.
export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false },
  global: { fetch: withDeadline },
});
