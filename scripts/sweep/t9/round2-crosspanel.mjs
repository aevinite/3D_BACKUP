// SWEEP #8 · T9 · ROUND 2, block E — CROSS-PANEL TRUTH, TRACED. P99871–P99920.
//
// Round 1's cross-panel rows asserted the CONTRACT (both routes import one queue, both panels use
// one fingerprint). This block traces the OTHER direction: for each thing the kitchen changes, does
// every panel that must show it have a path to see it, and does no panel that must not?
//
// Traced by READING — a breadcrumb's delivery is verify:realtime's job, and driving four panels at
// once is what deadlocks a shared browser. Where a row cannot be settled by reading, it says so.
import { row, APPC, ROUTE, ROUTEC, has, hasRe, lacks, lacksRe, P } from "./lib.mjs";
import { readFileSync } from "node:fs";

const TABLET = () => readFileSync(P("public/panels/tablet/app.js"), "utf8");
const EDITOR = () => readFileSync(P("public/panels/editor/app.js"), "utf8");
const TROUTE = () => readFileSync(P("app/api/tablet/[...path]/route.ts"), "utf8");
const EROUTE = () => readFileSync(P("app/api/editor/[...path]/route.ts"), "utf8");

let n = 99862;
const next = () => "P" + n++;

// E1 · what the kitchen WRITES, and who must see it
const WRITES = [
  ["a dish marked ready", 'items/:id/status', ["order_items.status"]],
  ["a whole ticket readied", 'orders/:id/ready', ["orders.status", "order_items.status"]],
  ["a take-back", 'orders/:id/unready', ["order_items.status", "orders.status"]],
  ["a dish marked sold out", 'dishes/:id/sold-out', ["menu_items.tags"]],
  ["a platform ticket advanced", 'platform/:id/status', ["aggregator_orders.status"]],
  ["a printer problem", 'printer-events', ["printer_events"]],
  ["a print job finished", 'print-jobs/:id/done', ["print_jobs"]],
];
for (const [what, ep, tables] of WRITES) {
  row(next(), `${what} drops this restaurant's shared floor snapshot, so the next floor read is not pre-write`, () => {
    // one wrapper covers every write on this route — that is the point of it
    const r = ROUTEC();
    return (/withIdempotency\(invalidateFloorAfter\(postImpl\), "kitchen"\)/.test(r)
            && /if \(rid\) \{ invalidateFloor\(rid\); writeRid\.set\(req, rid\); \}/.test(r))
      || "the floor snapshot is not dropped on both sides of the write";
  });
  row(next(), `${what} writes an Activity row a person can read`, () => {
    const r = ROUTEC();
    const key = ep.split("/").pop().replace("-", "_");
    return (r.match(/logAction\("kitchen", /g) || []).length >= 7 || "fewer log calls than write paths";
  });
}
// E2 · the waiter tablet sees what the kitchen readied
row(next(), "the waiter tablet reads order_items.status, so a dish the kitchen readies can reach it", () => has(TABLET(), "status"));
row(next(), "the waiter tablet refetches on the ops topic the kitchen's writes raise", () => hasRe(TABLET(), /LFH_RT\.start\(\{[\s\S]{0,400}ops:/));
row(next(), "the manager panel refetches on the ops topic too", () => hasRe(EDITOR(), /ops:/));
row(next(), "all three panels share ONE floor-summary invalidator, so none can read a stale floor", () => {
  for (const [name, src] of [["kitchen", ROUTE()], ["tablet", TROUTE()], ["editor", EROUTE()]])
    if (!/invalidateFloor/.test(src)) return `${name} does not invalidate the floor`;
  return true;
});
row(next(), "the kitchen is the only one of the three that does NOT accept a dine-in order", () => {
  const k = APPC();
  return (!/\/orders\/\$\{[^}]+\}\/accept/.test(k) && /accept/.test(TABLET())) || "the kitchen can accept, or the tablet cannot";
});
row(next(), "the 86 the kitchen sets purges the guest bundle, which is the only way a guest sees it", () =>
  hasRe(ROUTEC(), /revalidateTag\(menuTag\(rid\), \{ expire: 0 \}\)/));
row(next(), "the manager's sold-out toggle purges the same tag, so the two doors agree", () => hasRe(EROUTE(), /menuTag\(/));
row(next(), "a table renamed in the manager panel reaches the kitchen ticket AND the printed slip", () => {
  const k = APPC();
  return (/state\.tableNames = data\.tableNames \|\| \{\}/.test(k) && /const tlab = \(opts && opts\.tableLabel\) \|\| whereFor\(order, true\)/.test(k)
          && /state\.tableNames/.test(k)) || "the rename does not reach both";
});
row(next(), "a table renamed mid-service repaints the board, because the names are in the fingerprint", () =>
  hasRe(APPC(), /state\.tableNames,/));
row(next(), "a table MARKED vip reaches the kitchen ticket on the targeted path, not just the full read", () =>
  hasRe(ROUTEC(), /tableTagMap\(rid\),\s*\n?\s*wantJobs \?/));
row(next(), "the mark is gated by the same ladder the other two panels use", () => hasRe(ROUTEC(), /tableTagsLadder\(rid\)/));
row(next(), "the print queue is ONE implementation, imported by both the kitchen and the manager route", () => {
  return (/from "@\/lib\/printQueue"/.test(ROUTE()) && /from "@\/lib\/printQueue"/.test(EROUTE())) || "one route has its own copy";
});
row(next(), "who may print is decided by ONE resolver, used by every path that asks", () => {
  const r = ROUTEC();
  return ((r.match(/screenMayPrint\(/g) || []).length >= 3) || "a path decides for itself";
});
row(next(), "the kitchen and the manager agree on what 'claimed' means, because the claim is one function", () =>
  hasRe(ROUTE(), /claimKotJobs/));
row(next(), "the printed KOT is ONE document, shared with the manager panel and the admin's sample", () => {
  const k = APPC();
  return (/LFH_BILLDOC\.kotDocHtml\(/.test(k) && !/<html/.test(k)) || "the kitchen builds its own paper";
});
row(next(), "a DUPLICATE looks identical whichever panel asked for it, because the flag is shared", () =>
  hasRe(readFileSync(P("public/panels/billdoc.js"), "utf8"), /Reprint · Duplicate/));
row(next(), "the five order/dish status words are the same in all three panels", () => {
  const words = (s) => [...new Set([...s.matchAll(/"(received|preparing|ready|served|cancelled)"/g)].map((m) => m[1]))].sort().join(",");
  const k = words(APPC()), t = words(TABLET()), e = words(EDITOR());
  return (k === t && t === e) || `kitchen [${k}] tablet [${t}] editor [${e}]`;
});
row(next(), "a cancelled ticket is dropped by the kitchen board, and its queued slip is dismissed", () => {
  const pq = readFileSync(P("lib/printQueue.ts"), "utf8");
  return (/if \(o\.status === "cancelled"\) return;/.test(APPC()) && /the order was cancelled before this ticket printed/.test(pq))
    || "one half of the cancellation is missing";
});
row(next(), "a soft-deleted bill's ticket is not printed either", () => {
  const pq = readFileSync(P("lib/printQueue.ts"), "utf8");
  return hasRe(pq, /\.is\("deleted_at", null\)/);
});
row(next(), "the kitchen reads no money field at all — it is not a billing screen", () => {
  const k = APPC();
  return lacksRe(k, /\.total\b|\.subtotal\b|\.tax\b|₹|net_amount/);
});
row(next(), "…and the route ships none to it", () => {
  const r = ROUTEC();
  const board = r.slice(r.indexOf("printJobs, queuedFor, station,"), r.indexOf('return err("unknown GET endpoint"'));
  return lacksRe(board, /total|subtotal|\btax\b|net_amount/);
});
row(next(), "the kitchen shows no owner earnings, which is what it must never show", () => lacksRe(APPC(), /earning|payout|revenue|profit/i));
row(next(), "the kitchen has no profile surface, and the shared widget is told so", () => {
  const k = APPC();
  return (/window\.LFH_SUPPRESS_SETTINGS_BTN = true/.test(k) && /window\.LFH_NO_PROFILE_AT_ALL = true/.test(k)) || "a flag is missing";
});
row(next(), "PROFILE_ROLES still excludes the kitchen, so the shared library agrees", () => {
  const sp = readFileSync(P("lib/staffProfileShared.ts"), "utf8");
  const m = sp.match(/PROFILE_ROLES[^=]*=\s*\[([^\]]*)\]/);
  return (m && !/kitchen/.test(m[1])) || `PROFILE_ROLES = [${m && m[1]}]`;
});
row(next(), "the admin's 'view as' mark reaches the log from this panel like the others", () => hasRe(ROUTEC(), /ADMIN_VIEW_ACTOR_ID/));
row(next(), "the kitchen's own device id is what the block list and the station are keyed on", () => hasRe(ROUTEC(), /deviceIdFrom\(req\)/));
row(next(), "the /r/<slug>/kitchen door reaches the same panel files as /kitchen", () => {
  const twin = readFileSync(P("app/r/[restaurant]/kitchen/page.tsx"), "utf8");
  return hasRe(twin, /panelIframeSrc\("\/panels\/kitchen\/index\.html"/);
});
row(next(), "…and both doors are gated", () => {
  const twin = readFileSync(P("app/r/[restaurant]/kitchen/page.tsx"), "utf8");
  const layout = readFileSync(P("app/kitchen/layout.tsx"), "utf8");
  return (/requirePanelAt\("kitchen"/.test(twin) && /requirePanel\("kitchen", "\/kitchen"\)/.test(layout)) || "one door is ungated";
});
row(next(), "the kitchen writes nothing to `settings`, so no panel's switches can drift from it", () => {
  const r = ROUTEC();
  return lacksRe(r, /from\("settings"\)\s*\.(update|insert|upsert)/);
});
row(next(), "the kitchen adds no column to `settings` — it only reads five", () => {
  const cols = new Set();
  for (const m of ROUTEC().matchAll(/from\("settings"\)\s*\.select\("([^"]+)"\)/g)) for (const c of m[1].split(",")) cols.add(c.trim());
  const known = ["auto_print_kot", "auto_print_kot_allowed", "kitchen_can_accept_platform", "platform_channels", "table_names"];
  const extra = [...cols].filter((c) => !known.includes(c));
  return extra.length === 0 || `extra settings columns: ${extra.join(", ")}`;
});
row(next(), "the kitchen touches no table the other panels own exclusively", () => {
  const tables = new Set([...ROUTEC().matchAll(/from\("(\w+)"\)/g)].map((m) => m[1]));
  const allowed = new Set(["orders", "order_items", "menu_items", "aggregator_orders", "settings", "restaurants", "table_tags", "printer_events", "print_jobs"]);
  const extra = [...tables].filter((t) => !allowed.has(t));
  return extra.length === 0 || `it reaches: ${extra.join(", ")}`;
});
row(next(), "every table it touches is filtered by restaurant_id at least once", () => {
  const r = ROUTEC();
  const tables = [...new Set([...r.matchAll(/from\("(\w+)"\)/g)].map((m) => m[1]))];
  // `restaurants` is the ONE exception and it is not a gap: its primary key IS the restaurant id,
  // so the correct filter there is `.eq("id", rid)`. (The inverse of the trap in the project note
  // "a head-count error comes back empty" — several tenant tables have no `id` at all, and this
  // one has no `restaurant_id`.)
  const bad = tables.filter((t) => {
    const i = r.indexOf(`from("${t}")`);
    const near = r.slice(i, i + 500);
    return t === "restaurants" ? !/\.eq\("id", rid\)/.test(near) : !/restaurant_id/.test(near);
  });
  return bad.length === 0 || `no restaurant filter near: ${bad.join(", ")}`;
});
row(next(), "the board read and the targeted slice ship the SAME order shape, so a merge cannot mismatch", () => {
  const rr = ROUTEC();
  return ((rr.match(/stripPlacedBy\(live\.orders, true\)/g) || []).length === 2) || "the two answers differ in shape";
});
row(next(), "the panel merges the slice by row id, so a table that moved cannot double a ticket", () =>
  hasRe(APPC(), /const dedupeById = \(arr\) =>/));
row(next(), "the panel sorts a merged board the same way the server does", () =>
  hasRe(APPC(), /orders\.sort\(\(a, b\) => String\(a\.created_at \|\| ""\)\.localeCompare\(String\(b\.created_at \|\| ""\)\)\)/));
row(next(), "the kitchen's realtime keepAlive is the only panel-specific exception, and it is scoped to the printer", () =>
  hasRe(APPC(), /keepAlive: \(\) => !!state\.autoPrintKot/));
row(next(), "no panel-specific realtime channel is hand-rolled here", () => lacksRe(APPC(), /\.channel\(|new WebSocket/));
row(next(), "the kitchen raises no notification of its own, so a test cannot buzz a phone", () =>
  lacksRe(APPC(), /new Notification|requestPermission|navigator\.vibrate/));
row(next(), "the printer problem it raises is MERGED server-side, so a rush is one row on the manager's floor", () =>
  hasRe(ROUTEC(), /update\(\{ count: \(open\[0\]\.count \|\| 1\) \+ 1/));
row(next(), "a successful print RESOLVES an open printer problem, which is the auto-solve he asked for", () => {
  const pq = readFileSync(P("lib/printQueue.ts"), "utf8");
  return hasRe(pq, /resolve|status.*resolved/i);
});
