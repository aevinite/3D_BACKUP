// The public (anon-key) Supabase client, for guards: the same in-memory stub as the service-role one, so a file that
// reaches lib/supabase.ts through lib/tenant.ts can be loaded and run without a socket ever opening.
export { supabaseAdmin as supabase } from "./sb.mjs";
