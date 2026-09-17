// BLOCK J · the seven remaining owner routes — 15 phases, P160936–P160950.
//   overview · oplog · audit · issues · khata · ratings · printing.
// WHY ONLY 15. These are the BEST-covered files per line in the territory — 103 to 159 ledger rows
// per thousand lines each, against 26 for owner/staff — and block C already drove all thirteen at
// every scope shape. So these fifteen go only where those two passes did not: the paging arithmetic,
// the counted chips, and the one write each of them has.
import { FH, PP, GET, POST, PATCH, sb, owns, block, of_, code, read } from "./harness.mjs";
export const J = block(160936, "J · the seven best-covered routes, where the other passes did not go");
const { row } = J;
const OV = of_("app/api/owner/overview/route.ts"), OP = of_("app/api/owner/oplog/route.ts"),
      AU = of_("app/api/owner/audit/route.ts"), IS = of_("app/api/owner/issues/route.ts"),
      KH = of_("app/api/owner/khata/route.ts"), RA = of_("app/api/owner/ratings/route.ts"),
      PR = of_("app/api/owner/printing/route.ts");

row(OV("the top-line totals are summed from the cards below them, so the header cannot drift"), "sum restaurants[] against totals", async (c) => {
  const r = await GET(c.M, "/api/owner/overview");
  if (r.status !== 200) return `${r.status} ${r.j?.error}`;
  const rev = Math.round((r.j.restaurants || []).reduce((a, x) => a + (x.revenueToday || 0), 0) * 100) / 100;
  const ord = (r.j.restaurants || []).reduce((a, x) => a + (x.ordersToday || 0), 0);
  const tab = (r.j.restaurants || []).reduce((a, x) => a + (x.openTables || 0), 0);
  return !!(Math.abs(rev - r.j.totals.revenueToday) < 0.02 && ord === r.j.totals.ordersToday && tab === r.j.totals.openTables
    && r.j.totals.restaurantCount === (r.j.restaurants || []).length)
    || `cards ${rev}/${ord}/${tab}/${(r.j.restaurants || []).length} vs header ${JSON.stringify(r.j.totals)}`;
});
row(OV("a restaurant whose Reports the admin has withheld stays in the list, with its money ZEROED and flagged"), "read reportsOff against the revenue", async (c) => {
  const r = await GET(c.O, "/api/owner/overview");
  const off = (r.j.restaurants || []).filter((x) => x.reportsOff);
  if (!off.length) return true;                      // nothing withheld on this stack
  const leak = off.filter((x) => x.revenueToday !== 0 || x.revenueAll !== 0 || x.ordersToday !== 0);
  return leak.length === 0 || `${leak.length} withheld restaurant(s) still carry their money`;
});
row(OP("page 2 is a different page of the SAME total, not a second answer"), "GET page=1 and page=2", async (c) => {
  const a = await GET(c.O, "/api/owner/oplog?limit=200&page=1");
  const b = await GET(c.O, "/api/owner/oplog?limit=200&page=2");
  if (a.status !== 200 || b.status !== 200) return `${a.status}/${b.status}`;
  if (a.j.total !== b.j.total) return `totals differ: ${a.j.total} vs ${b.j.total}`;
  if (a.j.total <= 200) return (b.j.actions || []).length === 0 || `only ${a.j.total} rows exist, yet page 2 has ${(b.j.actions || []).length}`;
  const overlap = new Set((a.j.actions || []).map((x) => x.id));
  const dupes = (b.j.actions || []).filter((x) => overlap.has(x.id));
  return dupes.length === 0 || `${dupes.length} row(s) appear on both pages`;
});
row(OP("…and the page count divides the total it reports, so the footer cannot promise an empty page"), "read total and pages", async (c) => {
  const r = await GET(c.O, "/api/owner/oplog?limit=200&page=1");
  return r.j.pages === Math.max(1, Math.ceil(r.j.total / r.j.pageSize)) || `total=${r.j.total} pageSize=${r.j.pageSize} pages=${r.j.pages}`;
});
row(OP("a page past the end is an EMPTY page that still knows the real total — never a retryable error"),
  "GET page=9999 on both paged screens", async (c) => {
  for (const [name, path, key] of [["the Activity log", "/api/owner/oplog", "actions"], ["the Removals record", "/api/owner/audit", "removals"]]) {
    const real = await GET(c.O, `${path}?limit=200&page=1`);
    if (real.status !== 200) return `SKIP: ${name} answered ${real.status}`;
    const r = await GET(c.O, `${path}?limit=200&page=9999`);
    if (r.status !== 200) return `${name} answered ${r.status} ${r.j?.error} — a "please try again" that never can`;
    if ((r.j[key] || []).length !== 0) return `${name} returned ${(r.j[key] || []).length} rows for page 9999`;
    if (r.j.total !== real.j.total) return `${name} past the end says total=${r.j.total}, but there are ${real.j.total} — that reads as "nothing here"`;
    if (r.j.pastEnd !== true) return `${name} does not say the page is past the end, so the screen cannot tell it from a quiet day`;
  }
  return true;
});
row(OP("…and the count behind that answer asks the SAME question the page asks"), "read: the three standing exclusions are applied to both", async () => {
  // EXPECTATION MOVED 2026-09-17, same id, same claim. This counted mentions of three local
  // consts named EXCLUDE_PANELS / EXCLUDE_LEVEL / EXCLUDE_ACTION. Owner-picked item 12 moved the
  // three exclusions into lib/logVisibility.ts as `withoutHiddenKinds()` — precisely so the page
  // and the count CANNOT be narrowed differently, which is what this row is about. Counting a
  // spelling that the fix deliberately deleted made this go red on correct code.
  //
  // The claim is unchanged and is now asserted where it actually lives: the declaration holds all
  // three, and this route applies it to the page AND to the head count.
  const lib = code(read("lib/logVisibility.ts"));
  for (const [what, frag] of [["the admin's own rows", "(admin,db)"],
                              ["app faults", "level.is.null,level.neq.error"],
                              ["the raw button taps", "ui_taps"]]) {
    if (!lib.includes(frag)) return `lib/logVisibility.ts no longer excludes ${what}`;
  }
  const src = code(read("app/api/owner/oplog/route.ts"));
  const uses = (src.match(/withoutHiddenKinds\(/g) || []).length;
  if (uses < 2) return `withoutHiddenKinds is applied ${uses} time(s) — the count and the list can disagree`;
  // …and no copy of the filter has crept back in beside it.
  if (/\(admin,db\)/.test(src) || /level\.is\.null,level\.neq\.error/.test(src)) {
    return "the exclusion strings are hand-written in the route again, so the two can drift apart";
  }
  return true;
});
row(OP("every row carries the trail that says WHERE the person was standing, not just what they did"), "read actions[].trail", async (c) => {
  const r = await GET(c.O, "/api/owner/oplog?limit=50");
  const rows = r.j.actions || [];
  if (!rows.length) return "SKIP: no activity on this restaurant";
  const bare = rows.filter((a) => !a.trail);
  return bare.length === 0 || `${bare.length} row(s) with no trail`;
});
row(AU("the chips count the WHOLE record, never just the page they sit above"), "compare kindCounts with the rows shown", async (c) => {
  const r = await GET(c.O, "/api/owner/audit?limit=200");
  if (r.status !== 200) return `${r.status} ${r.j?.error}`;
  if (!r.j.kindCounts) return "SKIP: the counts could not be read, and the screen is told so";
  const shown = {};
  for (const x of (r.j.removals || [])) shown[x.kind] = (shown[x.kind] || 0) + 1;
  for (const k of r.j.kindCounts) {
    if ((shown[k.kind] || 0) > k.n) return `${k.kind}: ${shown[k.kind]} on the page but the chip says ${k.n}`;
  }
  return true;
});
row(AU("…and no chip offers a filter that would come back empty"), "cross-check every chip against the list it filters", async (c) => {
  const r = await GET(c.O, "/api/owner/audit?limit=200");
  if (!r.j.kindCounts) return "SKIP: no counts";
  const zero = r.j.kindCounts.filter((k) => k.n === 0);
  if (zero.length) return `${zero.length} chip(s) would filter to nothing: ${zero.map((z) => z.kind).join(", ")}`;
  const classified = r.j.kindCounts.find((k) => k.kind === "removal_classified");
  return !classified || "the answer-to-a-cancellation is offered as a chip on a screen headed \"what was removed\"";
});
row(AU("a removal can be opened in full, and the owner can never put it back"), "GET ?detail=<a real id>", async (c) => {
  const l = await GET(c.O, "/api/owner/audit?limit=5");
  const one = (l.j.removals || [])[0];
  if (!one) return "SKIP: no removals on this restaurant";
  const r = await GET(c.O, `/api/owner/audit?detail=${one.id}`);
  return !!(r.status === 200 && r.j.removal && r.j.canRestore === false) || `${r.status} canRestore=${r.j?.canRestore}`;
});
row(IS("the open-complaint badge is counted in the database, so it cannot undercount past the page"), "compare openCount with the page", async (c) => {
  const r = await GET(c.O, "/api/owner/issues");
  if (r.status !== 200) return `${r.status} ${r.j?.error}`;
  const shown = (r.j.issues || []).filter((i) => i.status === "open").length;
  return r.j.openCount >= shown || `badge ${r.j.openCount} < the ${shown} open on the page`;
});
row(IS("resolving a complaint records who did it, by name, and can be reopened"), "PATCH resolved then open again", async (c) => {
  const l = await GET(c.O, "/api/owner/issues");
  const one = (l.j.issues || [])[0];
  if (!one) return "SKIP: no complaints on this restaurant";
  const was = one.status;
  const before = new Date().toISOString();
  const r = await PATCH(c.O, "/api/owner/issues", { id: one.id, status: was === "open" ? "resolved" : "open" });
  if (r.status !== 200) return `${r.status} ${r.j?.error}`;
  const mid = await sb.from("issues").select("status, resolved_by").eq("id", one.id).maybeSingle();
  await PATCH(c.O, "/api/owner/issues", { id: one.id, status: was });
  const back = await sb.from("issues").select("status").eq("id", one.id).maybeSingle();
  const q = await sb.from("staff_actions").select("id, panel, actor").in("action", ["issue_resolved", "issue_reopened"]).gte("created_at", before).limit(4);
  for (const x of (q.data || [])) owns("staff_actions", x.id);
  if (back.data?.status !== was) return `it did not go back to ${was} (now ${back.data?.status})`;
  const named = (q.data || []).every((x) => x.actor && !/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(String(x.actor)));
  return !!(mid.data?.status !== was && named) || `status went ${was}→${mid.data?.status}, log actors=${JSON.stringify((q.data || []).map((x) => x.actor))}`;
});
row(KH("the total owed comes from an aggregate over EVERY open bill, never from the people shown"), "compare the headline with the rows, and with the cap", async (c) => {
  const r = await GET(c.O, "/api/owner/khata");
  if (r.status !== 200) return r.j?.moduleOff ? "SKIP: pay later is not switched on here" : `${r.status} ${r.j?.error}`;
  if (r.j.moduleOff) return "SKIP: pay later is not switched on here";
  const summed = Math.round((r.j.customers || []).reduce((a, x) => a + x.outstanding, 0) * 100) / 100;
  if (r.j.summary.totalOutstanding + 0.01 < summed) return `the headline (${r.j.summary.totalOutstanding}) is LESS than the people shown add up to (${summed})`;
  if (r.j.listCapped && !r.j.peopleShown) return "the list is capped and does not say how many it is showing";
  return r.j.summary.peopleCount >= (r.j.customers || []).length
    || `it counts ${r.j.summary.peopleCount} people but shows ${(r.j.customers || []).length}`;
});
row(RA("the star distribution has five entries and adds up to the total"), "read summary.dist against summary.total", async (c) => {
  const r = await GET(c.O, "/api/owner/ratings");
  if (r.status !== 200) return `${r.status} ${r.j?.error}`;
  const d = r.j.summary.dist || [];
  const sum = d.reduce((a, x) => a + x, 0);
  return !!(d.length === 5 && sum === r.j.summary.total) || `dist=${JSON.stringify(d)} sums to ${sum}, total=${r.j.summary.total}`;
});
row(PR("the printing card answers for the restaurant it NAMES, and for every row the page draws"), "read restaurantId and perRestaurant", async (c) => {
  const r = await GET(c.O, "/api/owner/printing");
  if (r.status !== 200) return `${r.status} ${r.j?.error}`;
  if (r.j.allowed === false) return !("computers" in r.j) || "it says printing is withheld and still describes the hardware";
  if (!r.j.restaurantId) return "it answered about a restaurant without saying which";
  const keys = Object.keys(r.j.perRestaurant || {});
  const stray = keys.filter((k) => k !== FH && k !== PP);
  return stray.length === 0 || `it answered for ${stray.length} restaurant(s) this owner does not own`;
});
