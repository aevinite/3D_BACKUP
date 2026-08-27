// GET /api/admin/health — read-only platform diagnostics for the System Health
// page. Deliberately cheap: a trivial round-trip for latency, planner ROW
// ESTIMATES (pg_class.reltuples via migration 119's RPC — zero table scan) for
// the big tables instead of exact COUNT(*), and small bounded queries for
// everything else. No food revenue, no secrets. Admin-gated.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { shippedSwVersion } from "@/lib/swVersion";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";

export const dynamic = "force-dynamic";

// Only devices seen this recently count toward the offline-layer figure — see the note below.
const SW_WINDOW_MS = 24 * 60 * 60 * 1000; // a day
// How many un-uploaded 3D models this page asks for. Named, because a list that comes back exactly
// this long is a TRUNCATED list and the screen has to say so.
const BROKEN_3D_LIMIT = 200;
const admin = (req: NextRequest) => tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const t0 = Date.now();
  const pingQ = await sb.from("settings").select("restaurant_id").limit(1);
  const latencyMs = Date.now() - t0;
  if (pingQ.error) {
    return NextResponse.json({ latencyMs, dbOk: false, error: pingQ.error.message }, { status: 200 });
  }

  const [estimatesQ, restQ, staffQ, issuesQ, broken3dQ] = await Promise.all([
    sb.rpc("lfh_admin_table_estimates"),
    // Live restaurants only (bug H4/#6, 2026-07-06): binned restaurants must not be
    // counted as "suspended". With deleted_at excluded, suspended = live-but-inactive.
    sb.from("restaurants").select("id, active").is("deleted_at", null).limit(2000),
    // Bounded read — this page auto-refreshes every 60s, so cap it so it can't grow
    // into a full-table pull as staff count climbs across all tenants (egress guard).
    //
    // `restaurant_id` rides along so this count can be narrowed to LIVE restaurants below. Two
    // admin screens were answering the same question differently: System health said "2 / 58",
    // Usage & cost said 49 (T17 follow-up, 2026-08-20). Measured: 58 active staff rows exist, 49 of
    // them belong to live restaurants and NINE to binned ones. Usage filters to live tenants (it
    // reads lfh_admin_usage, which is `WHERE r.deleted_at IS NULL`); this read did not, so people
    // attached to a deleted restaurant were counted here and nowhere else. One number, one meaning.
    // sw_version rides along on this SAME read — no extra query for the offline-layer check
    // below (mig 366). One more column on a slice this route already scans.
    sb.from("staff_users").select("id, last_seen_at, restaurant_id, sw_version").eq("active", true).limit(5000),
    sb.from("issues").select("id", { count: "exact", head: true }).eq("status", "open"),
    // A DISH THAT PROMISES 3D AND CANNOT DELIVER IT (owner, 2026-08-12: *"whenever the 3-D is not
    // available, it should show me as a problem also notification"*).
    //
    // Three things have to be true for a diner to get a 3D view: the dish is ticked "4D", the
    // restaurant has the feature on, and the model FILES exist. The guest card now checks all three
    // so it stops advertising a view that can't open (see components/FoodCard.tsx → has3d) — but the
    // owner still needs to KNOW, otherwise the dish just quietly stops being special.
    //
    // Deliberately reported HERE rather than by the diner's browser or as an `issues` row:
    //   · a browser report would go through /api/log/client-error, which files at level 'error',
    //     caps at 5 per device per 10 minutes and can raise an alert — three un-uploaded models
    //     would push real crashes off the Repair board;
    //   · raiseIssue() pings the owner's phone, and a file that hasn't been uploaded is not a
    //     middle-of-service emergency;
    //   · and both of those only notice if a diner happens to open that menu.
    // This is a plain indexed read on a page that is already open in front of an admin.
    //
    // `.or()` = either file missing (null or empty). Capped like every other read on this page.
    sb.from("menu_items")
      .select("slug, title, restaurant_id, model_small_url, model_optimized_url")
      .eq("is4d", true)
      .or("model_small_url.is.null,model_small_url.eq.,model_optimized_url.is.null,model_optimized_url.eq.")
      .limit(BROKEN_3D_LIMIT),
  ]);

  const restaurants = restQ.data || [];
  const activeRestaurants = restaurants.filter((r) => r.active).length;
  const suspendedRestaurants = restaurants.length - activeRestaurants;

  const now = Date.now();
  // Live-restaurant staff only, so this agrees with Usage & cost (see the read above). Filtering
  // here rather than in the query keeps both reads parallel — no extra round-trip. If the
  // restaurants read itself failed we cannot tell live from binned, so we count them all rather
  // than under-report; `staffError`/`restaurantsError` is what tells the page the figure is shaky.
  const liveIds = new Set(restaurants.map((r) => r.id));
  const staffRows = restQ.error ? (staffQ.data || []) : (staffQ.data || []).filter((u) => u.restaurant_id && liveIds.has(u.restaurant_id));
  const staffOnlineNow = staffRows.filter((u) => u.last_seen_at && now - new Date(u.last_seen_at).getTime() < 180_000).length;

  // WHICH OFFLINE LAYER IS EACH DEVICE ON? (owner asked, 2026-08-26.)
  //
  // Counted over the people seen RECENTLY, not everyone who has ever signed in: a device nobody
  // has touched for a fortnight is not "behind", it is simply not in use, and counting it would
  // make this figure permanently alarming — which is how a warning stops being read (the same
  // lesson as the quiet-panels bar on this page).
  //
  // NULL is its own answer. A browser with no service-worker support, or a first visit not yet
  // controlled, has nothing to report — that is "hasn't told us", NOT "behind". Reporting it as
  // behind would invent a fault.
  const shippedSw = shippedSwVersion();
  const swSeen = staffRows.filter((u) => u.last_seen_at && now - new Date(u.last_seen_at).getTime() < SW_WINDOW_MS);
  const swCurrent = shippedSw ? swSeen.filter((u) => u.sw_version === shippedSw).length : 0;
  const swBehind = shippedSw ? swSeen.filter((u) => u.sw_version && u.sw_version !== shippedSw).length : 0;
  const swUnknown = swSeen.length - swCurrent - swBehind;

  let supaHost = "";
  try { supaHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").host; } catch {}

  // `restaurants` is a tiny, rarely-ANALYZEd table — pg_class.reltuples can sit at
  // 0 for it even though rows exist (a known reltuples quirk for small/low-churn
  // tables). We already have restQ's EXACT count for free, so use that instead of
  // the estimate for this one row only; the other (large, hot) tables keep using
  // the cheap planner estimate as intended.
  const tableEstimates = estimatesQ.error
    ? []
    : (estimatesQ.data || []).map((r: { table_name: string; est_rows: number }) =>
        r.table_name === "restaurants" ? { table: r.table_name, estRows: restaurants.length } : { table: r.table_name, estRows: Number(r.est_rows) || 0 }
      );

  return NextResponse.json({
    dbOk: true,
    latencyMs,
    tableEstimates,
    tableEstimatesError: estimatesQ.error?.message || null,
    restaurants: { active: activeRestaurants, suspended: suspendedRestaurants, total: restaurants.length },
    restaurantsError: restQ.error?.message || null, // so the page shows "unreadable", not a green "0 live"
    staffOnlineNow,
    staffTotal: staffRows.length,
    staffError: staffQ.error?.message || null,
    // The offline layer, per device (mig 366). `shipped` is null when the file could not be
    // read, and the screen then says "unknown" rather than calling every device behind.
    offlineLayer: { shipped: shippedSw, current: swCurrent, behind: swBehind, unknown: swUnknown, windowMins: SW_WINDOW_MS / 60000 },
    realtime: { configuredHost: supaHost || null },
    openIssues: issuesQ.error ? null : (issuesQ.count || 0),
    issuesFeedWired: !issuesQ.error,
    // Dishes ticked "4D" whose model file was never uploaded — the 3D view cannot open for them.
    // A restaurant with the 3D feature switched OFF is not a fault, so the page groups by
    // restaurant and the admin reads it next to that restaurant's switch. `null` means the read
    // itself failed, so the page can say "unreadable" instead of a reassuring zero.
    broken3d: broken3dQ.error ? null : {
      count: (broken3dQ.data || []).length,
      // A CAPPED COUNT MUST SAY IT IS CAPPED (T17 sweep #7, 2026-08-27). The read above stops at
      // 200 like every other read on this page, so with more than 200 un-uploaded models the
      // page would print a confident "200" and read as the whole story — the same fault the
      // Repair board's 50 and the log's 200 were both fixed for. Zero today, so this is the
      // rainy-day half of a rule the rest of this territory already follows.
      capped: (broken3dQ.data || []).length >= BROKEN_3D_LIMIT,
      dishes: (broken3dQ.data || []).slice(0, 20).map((d: { slug: string; title: string; restaurant_id: string; model_small_url: string | null; model_optimized_url: string | null }) => ({
        slug: d.slug,
        title: d.title,
        restaurantId: d.restaurant_id,
        missing: [!d.model_small_url && "small", !d.model_optimized_url && "optimized"].filter(Boolean).join(" + "),
      })),
    },
    broken3dError: broken3dQ.error?.message || null,
    checkedAt: new Date().toISOString(),
  });
}
