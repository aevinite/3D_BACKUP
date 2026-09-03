// Replay of the PANEL ↔ ROUTE CONTRACT rows of LEDGER/T6.md block 5 (P02964–P02975) and the
// log/floor rows of the same block that are decided by reading code (P02951–P02958).
//
// These are the rows worth the most per line: a panel and its route drifting apart is invisible
// until a cook taps something and nothing happens.
import { row, APPC, ROUTE, ROUTEC, has, hasRe, lacks, lacksRe, P } from "./lib.mjs";
import { readFileSync } from "node:fs";

const aslice = (from, to) => { const a = APPC(); const i = a.indexOf(from); const j = a.indexOf(to); return i < 0 || j < 0 ? "" : a.slice(i, j); };

// ── the Activity log (P02951–P02957) ────────────────────────────────────────
const ACTIONS = () => [...ROUTEC().matchAll(/logAction\("kitchen", ("?\w+"?|[^,]+),/g)].map((m) => m[1]);
row("P02951", "the kitchen's ✓ writes an Activity row a person can read", () =>
  hasRe(ROUTEC(), /logAction\("kitchen", "item_status", \{ \.\.\.adminMark, order_id: item\.order_id \?\? null, detail: status/));
row("P02952", "the kitchen's ALL READY writes an Activity row", () => hasRe(ROUTEC(), /logAction\("kitchen", "order_ready"/));
row("P02953", "the kitchen's take-back writes an Activity row saying how many dishes", () =>
  hasRe(ROUTEC(), /logAction\("kitchen", "order_unready", \{ \.\.\.adminMark, order_id: b, detail: `\$\{moved\} \$\{moved === 1 \? "dish" : "dishes"\} taken back`/));
row("P02954", "the kitchen's sold-out toggle writes an Activity row", () =>
  hasRe(ROUTEC(), /logAction\("kitchen", value \? "sold_out_on" : "sold_out_off"/));
row("P02955", "a ticket printing writes an Activity row that names the KOT", () =>
  hasRe(ROUTEC(), /logAction\("kitchen", "kot_printed", \{[\s\S]{0,200}printed"\} KOT\$\{r\.kotNo != null \? ` #\$\{r\.kotNo\}` : ""\}/));
row("P02956", "every one of those rows names WHO acted, not just \"kitchen\"", () => {
  const r = ROUTEC();
  const calls = [...r.matchAll(/logAction\("kitchen",[^;]*?\{([\s\S]*?)\}\s*\)/g)];
  const bad = calls.filter((c) => !/\.\.\.adminMark/.test(c[1]));
  return bad.length === 0 || `${bad.length} kitchen log call(s) with no actor`;
});
row("P02957", "an admin viewing this panel is marked in the log rather than hidden", () =>
  hasRe(ROUTEC(), /const adminMark = g\.user\s*\n?\s*\? \{ actor: g\.user\.name \|\| g\.user\.username, actor_id: g\.user\.id \}\s*\n?\s*: \{ actor_id: ADMIN_VIEW_ACTOR_ID \}/));
row("P02958", "the kitchen's writes drop the shared floor snapshot, before AND after the write", () => {
  const r = ROUTEC();
  return (/if \(rid\) \{ invalidateFloor\(rid\); writeRid\.set\(req, rid\); \}/.test(r) &&
          /function invalidateFloorAfter\(fn:[\s\S]*?finally \{[\s\S]{0,200}if \(rid\) invalidateFloor\(rid\);/.test(r) &&
          /withIdempotency\(invalidateFloorAfter\(postImpl\), "kitchen"\)/.test(r)) || "one of the two drops is missing";
});

// ── panel ↔ route contracts (P02964–P02975) ─────────────────────────────────
row("P02964", "the server refuses a kitchen accept of a `new` platform order when the toggle is off", () =>
  hasRe(ROUTEC(), /if \(owns\.status === "new"\) \{[\s\S]{0,400}kitchen isn't allowed to accept platform orders[\s\S]{0,40}403/));
row("P02965", "the panel and the route agree on which statuses a platform ticket can take", () => {
  const routeSet = (ROUTEC().match(/if \(!\["accepted", "preparing", "ready", "handed_over"\]\.includes\(status\)\)/) || [])[0];
  if (!routeSet) return "the route's platform status allow-list has changed shape";
  const sent = [...APPC().matchAll(/platAct\([^,]+, "(\w+)"\)/g)].map((m) => m[1]);
  const bad = sent.filter((s) => !["accepted", "preparing", "ready", "handed_over"].includes(s));
  return bad.length === 0 || `the panel sends a platform status the route refuses: ${bad.join(", ")}`;
});
row("P02966", "the panel and the route agree on which dish statuses exist", () => {
  if (!/\["received", "preparing", "ready", "served"\]\.includes\(status\)/.test(ROUTEC())) return "the route's dish status allow-list has changed shape";
  const sent = [...APPC().matchAll(/\/items\/\$\{[^}]+\}\/status`, \{ status: ("(\w+)"|[\w.]+) \}/g)].map((m) => m[2] || m[1]);
  const literal = sent.filter((s) => /^\w+$/.test(s) && !["received", "preparing", "ready", "served"].includes(s) && !/prev|status/.test(s));
  return literal.length === 0 || `the panel sends a dish status the route refuses: ${literal.join(", ")}`;
});
row("P02967", "the panel's unready body shape matches what the route validates", () => {
  const panel = /\/orders\/\$\{orderId\}\/unready`, \{ dishes: snap\.map\(\(s\) => \(\{ id: s\.id, prev: s\.prev \}\)\) \}/.test(APPC());
  const route = /const raw = Array\.isArray\(body\?\.dishes\) \? body\.dishes : \[\]/.test(ROUTEC()) &&
                /id: String\(d\?\.id \?\? ""\), prev: String\(d\?\.prev \?\? ""\)/.test(ROUTEC());
  return (panel && route) || `panel sends the right shape: ${panel}; route reads it: ${route}`;
});
row("P02968", "the panel's sold-out body shape matches the route", () => {
  const panel = /\/dishes\/\$\{id\}\/sold-out`, \{ value: (nowOut|wasOut) \}/.test(APPC());
  const route = /const value = !!\(body && body\.value === true\)/.test(ROUTEC());
  return (panel && route) || `panel: ${panel}; route: ${route}`;
});
row("P02969", "the panel's printer-event kinds match the route's allow-list", () => {
  const allow = (ROUTEC().match(/const kinds = \[([^\]]+)\]/) || [])[1];
  if (!allow) return "the route's kind allow-list is gone";
  const routeKinds = new Set(allow.split(",").map((s) => s.trim().replace(/"/g, "")));
  // Read the panel's own KINDS table (the four rows of the 🖨 sheet) plus any literal kind it
  // posts. NOT "any array of three strings" — that also matched the pointerdown/keydown/touchstart
  // gesture list, so the row failed on words that have nothing to do with printers.
  const kindsTable = (APPC().match(/const KINDS = \[([\s\S]*?)\];/) || [])[1] || "";
  const sent = [...kindsTable.matchAll(/\["(\w+)",/g)].map((m) => m[1])
    .concat([...APPC().matchAll(/"\/printer-events", \{ kind: "(\w+)"/g)].map((m) => m[1]));
  const bad = sent.filter((k) => !routeKinds.has(k));
  return bad.length === 0 || `the panel can send a kind the route refuses: ${bad.join(", ")}`;
});
row("P02970", "the panel's print-job claim body matches the route", () => {
  const panel = /body: JSON\.stringify\(\{ ids \}\)/.test(APPC());
  const route = /const ids = Array\.isArray\(body\?\.ids\) \? \(body\.ids as unknown\[\]\)\.map\(String\)\.slice\(0, 20\) : \[\]/.test(ROUTE());
  return (panel && route) || `panel: ${panel}; route: ${route}`;
});
row("P02971", "the panel's print-job done body matches the route", () => {
  const panel = /\/print-jobs\/\$\{j\.id\}\/done`, \{ ok: okPrint, error: okPrint \? undefined : "[^"]*" \}/.test(APPC());
  const route = /const okPrint = !!\(body && body\.ok === true\)/.test(ROUTEC()) && /body\?\.error \? String\(body\.error\)/.test(ROUTEC());
  return (panel && route) || `panel: ${panel}; route: ${route}`;
});
row("P02972", "every field the panel draws is actually shipped by the board route", () => {
  const shipped = new Set();
  const r = ROUTEC();
  const i = r.indexOf("printJobs, queuedFor, station,");
  const okBlock = i < 0 ? "" : r.slice(r.lastIndexOf("return ok({", i), r.indexOf('return err("unknown GET endpoint"'));
  if (!okBlock) return "the board reply block could not be found";
  // Field names appear as `name,` (shorthand) or `name:` (renamed) at any indent.
  for (const m of okBlock.matchAll(/(?:^|[\s{])(\w+)\s*[,:]/g)) shipped.add(m[1]);
  // what loadImpl() reads off the reply
  const read = new Set([...APPC().matchAll(/\bdata\.(\w+)/g)].map((m) => m[1]));
  const missing = [...read].filter((k) => !shipped.has(k));
  return missing.length === 0 || `the panel reads fields the board never sends: ${missing.join(", ")}`;
});
row("P02973", "the panel reads no field the route dropped for egress", () => {
  const a = APPC();
  // `payload` and `status_history` are the two big JSON columns the route deliberately does not select.
  return lacksRe(a, /\bp\.payload\b|\bstatus_history\b|placed_by_id|\bplaced_by\b/);
});
row("P02974", "the kitchen and the waiter tablet share the same redraw-guard design", () => {
  const tab = readFileSync(P("public/panels/tablet/app.js"), "utf8");
  return (/RT_VOLATILE/.test(tab) && /stableRow/.test(tab)) || "the tablet no longer uses the same fingerprint design";
});
row("P02975", "the kitchen's twin panel routes have not drifted on the shared print queue", () => {
  // Both the kitchen and the editor/manager route claim from ONE implementation, so "claimed"
  // cannot mean two different things (the whole reason lib/printQueue.ts exists).
  const k = ROUTEC();
  const e = readFileSync(P("app/api/editor/[...path]/route.ts"), "utf8");
  return (/from "@\/lib\/printQueue"/.test(k) && /from "@\/lib\/printQueue"/.test(e)) || "one of the two routes has its own copy of the queue";
});

// ── judgment rows decided by reading code (block 6) ──────────────────────────
row("P02986", "a cook is never asked to confirm anything mid-rush", () =>
  lacksRe(APPC(), /\bconfirm\(|window\.confirm/));
row("P02988", "a cook is told when the printer is not working, once, not twelve times", () =>
  hasRe(aslice("function notePrintTrouble()", "const jobsInFlight"), /if \(Date\.now\(\) - lastPrintTroubleAt < 60000\) return;/));
row("P02995", "a wall display left on all day does not quietly cost the restaurant money", () => {
  const a = APPC();
  // printedIds and knownIds are both bounded; nothing else grows per tick.
  return (/if \(printedIds\.size > 500\)/.test(a) && /state\.knownIds = ids;/.test(a)) || "an unbounded set grows for the life of the tab";
});
