// This file sets up our one connection to Supabase (the cloud database that
// stores the menu, orders, settings, etc.). Everything in the app that needs to
// read or write data uses the single `supabase` object created at the bottom.

// `createClient` is Supabase's helper that builds that connection for us.
import { createClient } from "@supabase/supabase-js";

// The web address of our Supabase project. It comes from an environment
// variable (set in .env.local) so the secret isn't hard-coded in the source.
// The trailing "!" tells TypeScript "trust me, this value definitely exists".
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// The PUBLIC ("anon") key — safe to ship to the browser. It only allows the
// limited reads/writes the database's security rules permit. The powerful
// service-role key is NEVER used here; it lives only on the server.
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// The shared client. Import this anywhere in the app to talk to the database.
export const supabase = createClient(url, anon);
