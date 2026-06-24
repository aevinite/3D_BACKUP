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
// `realtime.worker: true` runs the websocket heartbeat in a Web Worker thread.
// Phone browsers (esp. Android Chrome) THROTTLE normal timers when the tab is in
// the background, so the heartbeat stops, the server thinks we vanished, and the
// live socket silently dies — which is why the page looked "frozen" until a manual
// refresh. A worker thread is throttled far less, so the connection survives a
// trip to the camera/another app. (Recovery on return is handled by the forced
// reconnect in RealtimeProvider; this just keeps it alive in the first place.)
export const supabase = createClient(url, anon, {
  realtime: { worker: true, params: { eventsPerSecond: 10 } },
});
