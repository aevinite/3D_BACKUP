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

// One shared admin client. `persistSession: false` because the server is
// stateless — it doesn't keep a logged-in user around between requests.
export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false },
});
