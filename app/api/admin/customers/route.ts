// GET /api/admin/customers — the platform-wide guest list for the admin's Customers page.
// Every restaurant's customers in one view, each row tagged with the restaurant it belongs
// to, plus the cross-restaurant picture only the admin can see (one mobile number that eats
// at several of our restaurants).
//
// DELIBERATELY MONEY-FREE. The admin panel never shows a restaurant's earnings (owner's
// standing rule), so this route returns counts and dates only — no spend, no bill totals.
// The OWNER's own Customers page is where money appears, for their own restaurants.
//
// Egress discipline: explicit column list, server-side search, hard limit + offset paging,
// one cheap head-count for the true total, and the per-restaurant name map read once.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
// Plain words for the console; the database's own words stay in the body + the log.
import { adminFail } from "@/lib/adminFail";
// ONE ANSWER TO "DID EVERY ONE OF THESE READS WORK?" — lib/readGuard (item 15, owner-approved
// 2026-09-01). One retry on a transient connection failure, one log line naming WHICH read went, and
// a tolerated read that says so at the call site.
import { ReadSet, rd } from "@/lib/readGuard";
import { cachedOwnerPayload } from "@/lib/ownerCache";
import { safeSearch } from "@/lib/searchText";

export const dynamic = "force-dynamic";

const COLS = "restaurant_id, phone, name, blocked, visits, consent, first_seen_at, last_seen_at";
const PAGE = 50;                 // rows per page — the table paginates rather than dumping thousands
const REPEAT_MIN = 2;            // visits >= 2 = a guest who came back
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

type Row = {
  restaurant_id: string; phone: string; name: string | null; blocked: boolean;
  visits: number; consent: boolean; first_seen_at: string; last_seen_at: string;
};

export async function GET(req: NextRequest) {
  if (!(await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const rid = sp.get("restaurant_id") || "";
  if (rid && !isUuid(rid)) return NextResponse.json({ error: "invalid restaurant_id" }, { status: 400 });
  // strip the characters that would break PostgREST's or() filter grammar
  // Shared cleaner — this local copy also missed the backslash, PostgREST's pattern escape
  // (2026-08-16). Same helper the owner-side guest list uses, so the twins cannot drift again.
  const search = safeSearch(sp.get("q"), 60);
  const seg = sp.get("seg") || "all";                     // all | regulars | new | blocked
  const sort = sp.get("sort") === "visits" ? "visits" : "last_seen_at";
  const page = Math.max(0, Math.min(200, parseInt(sp.get("page") || "0", 10) || 0));
  const detail = (sp.get("phone") || "").replace(/\D/g, "").slice(0, 15);

  try {
    // Restaurant names for the row chips + the filter dropdown (small, read once).
    // CHECKED, because `|| []` is the whole bug (sweep #6, T19). This is the platform-wide guest
    // list, so the restaurant chip is the only thing telling one tenant's guests from another's, and
    // the same read fills the filter. With the failure swallowed, every chip fell back to "—" and the
    // dropdown came back empty: a page of anonymous phone numbers the admin can neither read nor
    // narrow, served with a confident 200.
    // `deleted_at` comes back too, because this ONE read feeds two different things and they need
    // different populations (T18 sweep handoff H3, approved 2026-08-20 — a restaurant in the
    // recycle bin "is not in execution, only like deleted, just info is there"):
    //   · the FILTER DROPDOWN offers restaurants that exist. It listed 17 where 9 were live, so the
    //     admin could narrow the platform guest list to a restaurant that has been deleted. Every
    //     other admin screen reads this table with `.is("deleted_at", null)`; this was the one that
    //     did not.
    //   · the NAME MAP keeps every restaurant, binned ones included. Filtering the read itself was
    //     the obvious fix and the wrong one: a guest row belonging to a binned restaurant would
    //     have lost its chip and read "—", which is the exact failure the comment above warns
    //     about. A deleted restaurant's guests are still real people with a real history.
    const reads = new ReadSet("admin/customers", [await rd("restaurants", () => sb.from("restaurants").select("id, name, slug, accent_color, deleted_at").order("slug").limit(2000))]);
    if (reads.failed("restaurants")) return adminFail("the restaurant list", reads.error("restaurants"), { action: "load" });
    const rests = reads.rows<{ id: string; name: unknown; slug: string; accent_color: string | null; deleted_at: string | null }>("restaurants");
    const liveRests = rests.filter((r) => r.deleted_at == null);
    // restaurants.name is a JSONB of translations ({ en: "…" }) on some rows and a plain
    // string on others — read both, fall back to the slug so a chip is never blank.
    const label = (r: { name: unknown; slug: string }) => {
      if (typeof r.name === "string" && r.name.trim()) return r.name;
      if (r.name && typeof r.name === "object") {
        const n = r.name as Record<string, unknown>;
        const en = typeof n.en === "string" ? n.en : "";
        if (en.trim()) return en;
      }
      return r.slug;
    };
    const nameOf = (id: string) => {
      const r = rests.find((x) => x.id === id);
      return r ? label(r) : "—";
    };

    // ── one customer's detail: the same number across every restaurant it appears in.
    // This is the admin-only view — "Meera has eaten at 3 of our restaurants".
    if (detail) {
      const one = new ReadSet("admin/customers:one", [await rd("guest", () => sb.from("customers").select(COLS).eq("phone", detail).limit(50))]);
      const { data, error } = { data: one.rowsOr<Row>("guest", []), error: one.failed("guest") ? one.error("guest") : null };
      // PLAIN WORDS, not the database's (sweep #6, T19). `throw new Error(error.message)` walked the
      // raw sentence out through the catch at the bottom and into the console's red toast — the same
      // fault lib/adminFail was written for, just wearing a throw. Answered here instead so the raw
      // text stays in the response `detail` and the server log, where it is actually read.
      if (error) return adminFail("this guest's record", error, { action: "load" });
      const rows = ((data || []) as Row[]).map((c) => ({ ...c, restaurantName: nameOf(c.restaurant_id) }));
      return NextResponse.json({
        detail: {
          phone: detail,
          name: rows.find((r) => r.name)?.name || null,
          restaurants: rows.sort((a, b) => (a.last_seen_at < b.last_seen_at ? 1 : -1)),
          totalVisits: rows.reduce((a, r) => a + (Number(r.visits) || 0), 0),
          blockedAnywhere: rows.some((r) => r.blocked),
        },
      });
    }

    // ── the list
    let q = sb.from("customers").select(COLS, { count: "exact" })
      .order(sort, { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (rid) q = q.eq("restaurant_id", rid);
    if (search) q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
    if (seg === "regulars") q = q.gte("visits", REPEAT_MIN);
    if (seg === "new") q = q.lt("visits", REPEAT_MIN);
    if (seg === "blocked") q = q.eq("blocked", true);
    // THE PAGED LIST READ STAYS AS IT IS, deliberately (item 15, 2026-09-01). lib/readGuard answers
    // one question — did it work — and this read has a THIRD answer: "that page is past the end"
    // (PGRST103), which the branch below turns into an empty page rather than a failure. Wrapping it
    // would mean unwrapping it again two lines later to reach the same three-way decision, so the
    // helper is used for the other two reads on this route and this one keeps its own shape.
    let { data, error, count } = await q;
    // A PAGE PAST THE END IS EMPTY, NOT BROKEN (T18 second 500, 2026-08-31). PostgREST answers an
    // offset beyond the last row with 416 / PGRST103 "Requested range not satisfiable", which came
    // back to the screen as a red "Couldn't load the guest list" — the same words a real database
    // failure gets, for a page that simply does not exist. Measured: 87 guests, and ?page=2 was a
    // 500. The Next button is disabled at the end so a person cannot reach it by tapping, but a
    // stale "Showing X of Y" or a typed address could, and "this page is empty" and "the guest list
    // is down" must not read the same. The count is re-taken here because the failed read carried
    // none, and only on this path, so the ordinary page costs nothing extra.
    if (error && (error as { code?: string }).code === "PGRST103") {
      let head = sb.from("customers").select("phone", { count: "exact", head: true });
      if (rid) head = head.eq("restaurant_id", rid);
      if (search) head = head.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
      if (seg === "regulars") head = head.gte("visits", REPEAT_MIN);
      if (seg === "new") head = head.lt("visits", REPEAT_MIN);
      if (seg === "blocked") head = head.eq("blocked", true);
      const h = await head;
      data = []; error = null; count = h.count ?? 0;
    }
    if (error) return adminFail("the guest list", error, { action: "load" });
    const customers = ((data || []) as Row[]).map((c) => ({
      ...c,
      restaurantName: nameOf(c.restaurant_id),
      returning: (Number(c.visits) || 0) >= REPEAT_MIN,
    }));

    // ── the tiles + the per-restaurant bar list are AGGREGATES over every customer row,
    // so they ride the compute-on-view snapshot cache (standing rule): a normal open reads
    // ONE stored JSON row, and the heavy counting only re-runs when the fingerprint shows a
    // customer actually changed. At 500 new guests a day this is the difference between
    // scanning the table every 60 seconds and scanning it a few times an hour.
    // The LIST itself stays live — it's a paged, indexed read, not an aggregate.
    const force = sp.get("refresh") === "1";
    const agg = await cachedOwnerPayload({
      key: `admincust:v1:${rid || "all"}`,
      force,
      fingerprint: async () => {
        // A fingerprint that cannot be read comes back NULL, and lib/ownerCache treats null as "I
        // cannot tell whether anything changed" — which makes it recompute rather than serve a
        // possibly-stale snapshot. That is the right way round, so this read stays tolerant on
        // purpose; the note is here because the line looks like the same omission as the tiles below,
        // and it is not (item 18, 2026-09-01).
        const { data } = await sb.rpc("lfh_customers_fingerprint", { p_restaurant_id: rid || null });
        return typeof data === "string" ? data : null;
      },
      compute: async () => {
        function baseCount() {
          let q0 = sb.from("customers").select("phone", { count: "exact", head: true });
          if (rid) q0 = q0.eq("restaurant_id", rid);
          return q0;
        }
        const since30 = new Date(Date.now() - 30 * 86400e3).toISOString();
        const tiles = new ReadSet("admin/customers:tiles", await Promise.all([
          rd("total", () => baseCount()),
          rd("regulars", () => baseCount().gte("visits", REPEAT_MIN)),
          rd("blocked", () => baseCount().eq("blocked", true)),
          rd("newThisMonth", () => baseCount().gte("first_seen_at", since30)),
          // Guests per restaurant — ONE grouped read in the database (mig 228), never
          // "fetch every customer row and count them here".
          rd("spread", () => sb.rpc("lfh_admin_customer_spread")),
        ]));
        // A FAILED COUNT MUST NOT BE STORED AS A ZERO (item 18, T19 sweep #7, 2026-09-01).
        //
        // These five read `c1.count || 0` and `spreadRaw || []`, with no `.error` test — so a blip
        // turned "we could not count" into "0 saved guests · 0 regulars · 0 blocked" and an empty
        // per-restaurant card. And this compute sits INSIDE cachedOwnerPayload, which stores what it
        // is given: the invented zeros would then be served from the snapshot for as long as the
        // fingerprint stayed still, which on a quiet evening is hours. lib/readGuard's own header
        // names this exact shape as the worst of the ten it was written for.
        //
        // THROWN, not zeroed: cachedOwnerPayload lets a synchronous failure reach the caller, so the
        // page gets a real error it can retry instead of a stored lie, and nothing is written under
        // the key. `count()` and `rows()` do the throwing, and ReadFailed names which read went.
        if (tiles.anyFailed) throw new Error(`[admin/customers] tile read(s) failed: ${tiles.failedNames.join(", ")}`);
        return {
          total: tiles.count("total"), regulars: tiles.count("regulars"),
          blocked: tiles.count("blocked"), newThisMonth: tiles.count("newThisMonth"),
          spreadRaw: tiles.rows<{ restaurant_id: string; guests: number; regulars: number; blocked: number }>("spread"),
        };
      },
    });
    const { total, regulars, blocked, newThisMonth: fresh } = agg;
    // The per-restaurant bars follow the dropdown: a bar you cannot then filter to, for a
    // restaurant that has been deleted, is the same fault one row down.
    const liveIds = new Set(liveRests.map((r) => r.id));
    const spreadAll = agg.spreadRaw
      .filter((s2) => liveIds.has(s2.restaurant_id))
      .map((s2) => ({ id: s2.restaurant_id, name: nameOf(s2.restaurant_id), count: s2.guests, regulars: s2.regulars }))
      .filter((s2) => s2.count > 0);
    const spread = spreadAll.slice(0, 8);
    // HOW MANY THERE REALLY ARE, so the card can say when it is hiding one (owner, 2026-08-31 —
    // item 9). The bars are capped at 8 and the page could not know that, so on a platform with a
    // ninth restaurant that has guests, that restaurant simply was not there — on the card whose
    // stated job is "how many saved guests each restaurant has". The sibling card on Platform
    // analytics ("Showing the busiest 8 of 9 restaurants that took an order") was given this on
    // 2026-08-20; this one was not. Sent as a count, not more rows: the cap is what keeps the read
    // small, and one number is enough to tell the truth about it.
    const spreadTotal = spreadAll.length;

    return NextResponse.json({
      summary: { total, regulars, blocked, newThisMonth: fresh, matched: count || 0, page, pageSize: PAGE },
      cachedAt: agg.cachedAt,
      restaurants: liveRests.map((r) => ({ id: r.id, name: label(r) })),
      spread,
      spreadTotal,
      customers,
    });
  } catch (e) {
    // The last door the database's own sentence could walk out of on this route (T19 sweep #7,
    // 2026-09-01): every read above answers through adminFail, and then the catch handed the raw text
    // to the console anyway. Logged in full, answered in words, with the raw text kept in `detail`
    // exactly as adminFail does it.
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin] unexpected failure in app/api/admin/customers/route.ts", msg);
    return NextResponse.json({ error: "Couldn't load the guest list just now. Please try again.", detail: msg }, { status: 500 });
  }
}
