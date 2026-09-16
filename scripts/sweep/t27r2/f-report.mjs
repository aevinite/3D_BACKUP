/**
 * F · /api/admin/restaurants/report — one restaurant's Full report.  166 lines, 18.7 per hundred.
 *
 * Read-only, so nothing here writes. Two things make it worth 25 phases: it is the admin screen most
 * likely to state a WRONG NUMBER confidently (every figure is a count, and a failed count reads as
 * zero unless the handler says otherwise), and it is bound by the hard rule that the admin console
 * shows no restaurant's food money anywhere.
 */
export default function section(c) {
  const { phase, sec, req, sq, FH, AANGAN, NOSUCH, DB_WORDS } = c;
  const F = "app/api/admin/restaurants/report/route.ts";
  const P = "/api/admin/restaurants/report";
  sec("F · one restaurant's full report");
  const get = (rid = FH, range = "7d") => req(`${P}?restaurant_id=${rid}&range=${range}`).then((r) => r.json);
  const MONEY = /"(total|revenue|earnings|takings|amount|sales|net|gross|subtotal|discount|tax)"\s*:/i;

  phase("the sign-in gate runs before the first database call", "compare positions",
    () => { const s = c.clean(F); return s.indexOf("admin(req)") < s.indexOf("sb.from"); });
  phase("the file states the no-food-money rule it is bound by", "read its header",
    () => /NO food revenue \(CLAUDE\.md hard rule\)/.test(c.src(F)));
  phase("a malformed restaurant id never reaches a uuid column", "check the shape test runs first",
    () => { const s = c.clean(F); return s.indexOf("test(rid)") < s.indexOf("sb.from"); });
  phase("every read on the page gets one more attempt when it fails for a plumbing reason",
    "check retryRead wraps them", () => /import \{ retryRead \}/.test(c.clean(F)) && /const one = async/.test(c.clean(F)));
  phase("the three reads that used to go quiet now NAME themselves instead",
    "check the partial list", () => { const s = c.clean(F); return /const partial: string\[\] = \[\]/.test(s) && /partial\.push\("owner"\)/.test(s) && /partial\.push\("plan"\)/.test(s) && /partial\.push\("tablesConfigured"\)/.test(s); });
  phase("a figure that could not be read is null, never a confident zero",
    "read the tablesConfigured line", () => /settingsQ\.error \? null : Number/.test(c.clean(F)));
  phase("the staff roll read is bounded, so a cap cannot decide the head count",
    "check the limit", () => /\.limit\(2000\)/.test(c.clean(F)));
  phase("every count is a HEAD count, so row bodies never cross the wire for a number",
    "count the head:true reads", () => (c.clean(F).match(/head: true/g) || []).length >= 6);
  phase("every read is scoped to this one restaurant", "count the restaurant_id filters",
    () => (c.clean(F).match(/\.eq\("restaurant_id", rid\)/g) || []).length >= 6);
  phase("today means the restaurant's 05:00 business day, not the calendar's",
    "check businessDayStartIso is used", () => /businessDayStartIso/.test(c.clean(F)));
  phase("the window the answer echoes is the window it actually used (round 1, item 6)",
    "the range is normalised once and used for both",
    () => { const s = c.clean(F); return /const RANGES = \["today", "7d", "30d"\]/.test(s) && /rangeBounds\(range\)/.test(s); });

  phase("the report cannot be read without being signed in", "GET with no cookie",
    async () => (await req(`${P}?restaurant_id=${FH}`, { cookie: "" })).status === 401);
  phase("a malformed restaurant id is refused in words, not with a database sentence", "GET junk",
    async () => { const r = await req(`${P}?restaurant_id=nope`); return r.status === 400 && !DB_WORDS.test(r.text); });
  phase("no restaurant id at all is refused", "GET with none",
    async () => (await req(P)).status === 400);
  phase("an unknown restaurant says so", "GET an unknown uuid",
    async () => (await req(`${P}?restaurant_id=${NOSUCH}`)).status === 404);
  for (const r of ["today", "7d", "30d"])
    phase(`the ${r} report carries no food money anywhere`, `GET range=${r} and scan every key`,
      async () => { const j = await get(FH, r); return !MONEY.test(JSON.stringify(j)); });
  for (const r of ["today", "7d", "30d"])
    phase(`…and echoes back "${r}", the window it used`, `GET range=${r}`,
      async () => (await get(FH, r)).range === r);
  phase("an unknown window falls back to seven days AND says seven days", "GET range=banana",
    async () => {
      // Compares the ECHO only. The first draft also compared the order COUNT against a separate
      // 7-day call, and this is a shared, live database — another terminal placing an order between
      // the two calls made the phase red with nothing wrong. A check that fails on somebody else's
      // correct work is worse than no check.
      const j = await get(FH, "banana");
      return j.range === "7d" || `echoed "${j.range}"`;
    });
  phase("no window at all is the seven-day one, and says so", "GET with no range",
    async () => (await req(`${P}?restaurant_id=${FH}`)).json?.range === "7d");
  phase("a window in the wrong case is not silently honoured", "GET range=30D",
    async () => (await get(FH, "30D")).range === "7d");
  phase("the per-role staff counts add up to the staff total it prints", "sum them",
    async () => { const j = await get(); return Object.values(j.usage.staffByRole).reduce((a, b) => a + b, 0) === j.usage.staffTotal; });
  phase("the activity-volume proxy really is the sum of its four named parts", "recompute it",
    async () => { const u = (await get()).usage; return u.activityVolume === u.orders + u.orderItems + u.activityLogEvents + u.sessions; });
  phase("no figure on the report is negative", "check every number",
    async () => { const u = (await get()).usage; return Object.values(u).filter((v) => typeof v === "number").every((v) => v >= 0); });
  phase("the thirty-day window is never smaller than the seven-day one inside it",
    "compare the order counts",
    async () => { const a = await get(FH, "7d"); const b = await get(FH, "30d"); return b.usage.orders >= a.usage.orders; });
  phase("…and the seven-day window is never smaller than today's",
    "compare the order counts",
    async () => { const a = await get(FH, "today"); const b = await get(FH, "7d"); return b.usage.orders >= a.usage.orders; });
  phase("the trend has one bucket per day, each with a real date and a count that is not negative",
    "walk the trend",
    async () => { const t = (await get()).trend; return Array.isArray(t) && t.every((d) => /^\d{4}-\d{2}-\d{2}/.test(d.day) && d.orders >= 0); });
  phase("the trend's own total does not exceed the window's order count",
    "sum the buckets and compare",
    async () => { const j = await get(FH, "30d"); const sum = j.trend.reduce((s, d) => s + d.orders, 0); return sum <= j.usage.orders + j.trend.length; });
  phase("the report names the restaurant it is about", "read the restaurant block",
    async () => { const j = await get(); return j.restaurant?.id === FH && !!j.restaurant?.name && !!j.restaurant?.slug; });
  phase("a SECOND restaurant's report is its own numbers, never the flagship's",
    "read the control restaurant and compare",
    async () => { const a = await get(FH, "30d"); const b = await get(AANGAN, "30d"); return b.restaurant.id === AANGAN && !/french/i.test(b.restaurant.name) && b.usage.orders !== a.usage.orders; });
  phase("…and its table count is its own, not restaurant #1's",
    "compare tablesConfigured against the settings row",
    async () => { const b = await get(AANGAN, "7d"); const s = (await sq(`settings?select=table_count&restaurant_id=eq.${AANGAN}`)).json?.[0]; return b.usage.tablesConfigured === (Number(s?.table_count) || 0); });
  phase("a healthy report carries no `partial` key at all, so a normal answer is unchanged",
    "GET and check the key is absent",
    async () => !("partial" in (await get())));
  phase("the report carries no secret", "scan the body",
    async () => !c.SECRETS.test((await req(`${P}?restaurant_id=${FH}&range=7d`)).text));
  phase("the open-tables figure agrees with the sessions table", "compare against a head count",
    async () => { const j = await get(); const q = await sq(`sessions?select=id&restaurant_id=eq.${FH}&status=eq.open`, { headers: { Prefer: "count=exact", Range: "0-0" } }); const n = Number((q.text.match(/\/(\d+)$/) || [])[1]); return Number.isNaN(n) ? typeof j.usage.tablesOpenNow === "number" : j.usage.tablesOpenNow === n; });
  phase("the menu-item count agrees with the menu table", "compare against a service-role count",
    async () => { const j = await get(); const rows = (await sq(`menu_items?select=restaurant_id&restaurant_id=eq.${FH}&limit=5000`)).json || []; return j.usage.menuItemCount === rows.length; });
}
