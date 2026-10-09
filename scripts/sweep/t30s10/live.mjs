// scripts/sweep/t30s10/live.mjs — sweep #10 · terminal 30 · the checks that DRIVE the real app.
//
//   node scripts/sweep/t30s10/live.mjs --base http://localhost:4430
//
// Ids P199671–P199720 (append only), plus the re-run of P20018 / P07456 (whoami's discount cap), plus
// round 3's P167701+ (the order allergy line — the only section that writes; see it below).
// Signs in ONCE per role through scripts/sweep/login.mjs (manager, waiter tablet, owner — all French
// House, the restaurant that is written to; Aangan is never touched). Apart from round 3's allergy section
// (which adds a test allergy to one ARCHIVED order and takes it off again), every write it sends is one the
// app REFUSES — a stale expectation, a table with nothing to settle, a split that is the wrong shape,
// an out-of-range setting — so nothing is created. The one value it could change (the floor's tables
// per row) is read first and put back in a finally, and on SIGINT/SIGTERM.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { loginAs } from "../login.mjs";
import { requireUp } from "../appUp.mjs";
import { refuseUnlessDevTestDb } from "../devStacks.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://localhost:4430");
const LEDGER = process.argv.includes("--ledger");
const FH = "00000000-0000-0000-0000-000000000001";

const env = Object.fromEntries(readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "sweep #10 T30 live checks");
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const sql = async (q) => {
  if (!/^\s*(select|with)\b/i.test(q)) throw new Error("read-only");
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
  if (!r.ok) throw new Error(`SQL ${r.status}`); return r.json();
};

await requireUp(BASE, "the T30 sweep-10 live checks");
const rows = [];
let n = 199671;
const rec = (id, file, what, ok, note = "") => { rows.push({ id, file, what, mark: ok ? "✅" : "❌", note }); if (!LEDGER) console.log(`${ok ? "✅" : "❌"} ${id}  [${file}] ${what}${note ? "  → " + note : ""}`); };
const N = (file, what, ok, note) => rec(`P${n++}`, file, what, ok, note);

const browser = await chromium.launch();
const ctxOf = async (role) => { const c = await browser.newContext(); await loginAs(c, role, BASE); return c; };
const call = async (ctx, method, path, body, headers = {}) => {
  const r = await ctx.request.fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...headers }, data: body === undefined ? undefined : JSON.stringify(body), failOnStatusCode: false, timeout: 60000 });
  let j = null; const t = await r.text(); try { j = JSON.parse(t); } catch { /* not JSON */ }
  return { status: r.status(), j, t };
};

let floorBefore = null;
const restoreFloor = async (mgr) => {
  if (floorBefore == null) return;
  const now = (await sql(`select floor_per_row from settings where restaurant_id='${FH}'`))[0]?.floor_per_row;
  if (now !== floorBefore) await call(mgr, "POST", "/api/editor/settings", { restaurant_id: FH, floor_per_row: floorBefore });
};
let mgrCtx = null;
let cleanupAllergy = async () => {};
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { try { await cleanupAllergy(); if (mgrCtx) await restoreFloor(mgrCtx); } finally { process.exit(130); } });

try {
  // ── the manager panel ───────────────────────────────────────────────────────────────────────
  const mgr = mgrCtx = await ctxOf("manager");
  const who = await call(mgr, "GET", "/api/editor/whoami");
  const cap = (await sql(`select (access_config->'give_discounts'->'limit'->>'manager')::int m from restaurants where id='${FH}'`))[0].m;
  rec("P20018", "lib/discountCap.ts", "watched running: whoami sends discountCapPct so the modal stops offering a refused number", who.status === 200 && typeof who.j?.discountCapPct === "number", `discountCapPct ${who.j?.discountCapPct}`);
  rec("P07456", "lib/discountCap.ts", "the discount cap reads the same on the screen's source (whoami) and in the stored config — French House", who.j?.discountCapPct === cap, `whoami ${who.j?.discountCapPct} · stored ${cap}`);
  N("lib/discountCap.ts", "driven: the manager's whoami answers 200 and carries the cap as a NUMBER (not a string the modal would mis-compare)", who.status === 200 && Number.isFinite(who.j?.discountCapPct), `status ${who.status}`);
  N("lib/idempotency.ts", "driven: whoami sends no password, PIN, token or setup code to the browser", !/"(password|pin|token|setup_code|pin_hash|password_hash)"\s*:/.test(who.t), `${who.t.length} bytes read`);

  // a stale expectation on a category — the gate item 9 made real
  const cat = (await sql(`select slug, name from categories where restaurant_id='${FH}' order by sort_order nulls last, slug limit 1`))[0];
  if (cat) {
    const stale = await call(mgr, "POST", "/api/editor/categories", { slug: cat.slug, name: cat.name },
      { "X-LFH-Expect": JSON.stringify({ table: "categories", id: cat.slug, fields: { name: cat.name + " (as another manager saw it)" } }) });
    N("lib/clash.ts", "driven (item 9): saving a category another manager changed meanwhile is REFUSED with 409 clash_changed_elsewhere", stale.status === 409 && stale.j?.error === "clash_changed_elsewhere", `status ${stale.status} ${stale.t.slice(0, 120)}`);
    // A category's name is a multilingual OBJECT, so the gate takes its quiet form (no blob is quoted).
    const objectName = cat.name && typeof cat.name === "object";
    N("lib/clash.ts", "…the sentence names the field in plain words (and, because a category name is a multilingual object, does not quote a blob)", objectName ? /^Someone else changed the name while you had it open\.$/.test(stale.j?.clash?.plain || "") : /it now says “/.test(stale.j?.clash?.plain || ""), (stale.j?.clash?.plain || "").slice(0, 120));
    N("lib/clash.ts", "…and says the change was NOT saved, and that resending will not help (retryable:false)", stale.j?.clash?.retryable === false && /NOT saved/.test(stale.j?.clash?.todo || ""));
    const after = (await sql(`select name from categories where restaurant_id='${FH}' and slug='${cat.slug.replace(/'/g, "''")}'`))[0];
    N("lib/clash.ts", "…and the category is exactly as it was — nothing was written", JSON.stringify(after?.name) === JSON.stringify(cat.name), `name ${JSON.stringify(after?.name).slice(0, 80)}`);
    const fresh = await call(mgr, "POST", "/api/editor/categories", { slug: cat.slug, name: cat.name },
      { "X-LFH-Expect": JSON.stringify({ table: "categories", id: cat.slug, fields: { name: cat.name + " (stale)" } }), "X-LFH-Replay": "1", "X-LFH-Queued-At": new Date().toISOString() });
    N("lib/clash.ts", "driven: a just-queued change (seconds old) still meets the expectation gate — the replay window only adds the table check", fresh.status === 409, `status ${fresh.status}`);
  } else { N("lib/clash.ts", "driven: category clash", false, "French House has no category"); n += 4; }

  // Pay in parts — refusals only, so nothing is ever settled
  const FREE = "97";
  const busyT = (await sql(`select count(*)::int c from sessions where restaurant_id='${FH}' and table_number='${FREE}' and status='open'`))[0].c;
  const legsBefore = (await sql(`select count(*)::int c from session_payments where restaurant_id='${FH}'`))[0].c;
  const nothing = await call(mgr, "POST", `/api/editor/tables/${FREE}/pay-split`, { splits: [{ amount: 1.23, method: "Cash" }, { amount: 1.23, method: "UPI" }] });
  N("lib/paySplit.ts", `driven: Pay in parts on a table with nothing on it (T${FREE}) answers 409 "Nothing to settle"`, busyT === 0 && nothing.status === 409 && /Nothing to settle/.test(nothing.t), `status ${nothing.status} ${nothing.t.slice(0, 100)}`);
  const one = await call(mgr, "POST", `/api/editor/tables/${FREE}/pay-split`, { splits: [{ amount: 5, method: "Cash" }] });
  N("lib/paySplit.ts", "driven: one part is refused 400 'Give at least two parts'", one.status === 400 && /at least two parts/.test(one.t), `status ${one.status}`);
  const coin = await call(mgr, "POST", `/api/editor/tables/${FREE}/pay-split`, { splits: [{ amount: 5, method: "Bitcoin" }, { amount: 5, method: "Cash" }] });
  N("lib/paySplit.ts", "driven: an unknown payment method is refused 400", coin.status === 400 && /payment method/.test(coin.t), `status ${coin.status}`);
  const nobody = await call(mgr, "POST", `/api/editor/tables/${FREE}/pay-split`, { splits: [{ amount: 5, method: "Cash" }, { amount: 5, method: "Pay later" }] });
  N("lib/paySplit.ts", "driven: a pay-later part with no person is refused (400 needs a person, or 403 if the book is switched off)", [400, 403].includes(nobody.status) && /person|isn't enabled|not allowed|permission/i.test(nobody.t), `status ${nobody.status} ${nobody.t.slice(0, 90)}`);
  const badT = await call(mgr, "POST", "/api/editor/tables/abc/pay-split", { splits: [{ amount: 5, method: "Cash" }, { amount: 5, method: "UPI" }] });
  N("lib/paySplit.ts", "driven: a table that is not a number is refused 400", badT.status === 400, `status ${badT.status}`);
  const negative = await call(mgr, "POST", `/api/editor/tables/${FREE}/pay-split`, { splits: [{ amount: -5, method: "Cash" }, { amount: 10, method: "UPI" }] });
  N("lib/paySplit.ts", "driven: a negative part is refused 400", negative.status === 400 && /above zero/.test(negative.t), `status ${negative.status}`);
  const legsAfter = (await sql(`select count(*)::int c from session_payments where restaurant_id='${FH}'`))[0].c;
  N("lib/paySplit.ts", "…and after all six refusals not one payment part was recorded for French House", legsAfter === legsBefore, `${legsBefore} → ${legsAfter}`);
  N("lib/dbRefusal.ts", "driven: none of those refusals carried the database's own words", ![nothing, one, coin, nobody, badT, negative].some((r) => /violates|constraint|PGRST|syntax for type/i.test(r.t)));

  // the once-only id on a refusal: NOT remembered, so the next try runs for real
  const aid = randomUUID();
  const r1 = await call(mgr, "POST", `/api/editor/tables/${FREE}/pay-split`, { splits: [{ amount: 1.23, method: "Cash" }, { amount: 1.23, method: "UPI" }] }, { "X-LFH-Action-Id": aid });
  const r2 = await call(mgr, "POST", `/api/editor/tables/${FREE}/pay-split`, { splits: [{ amount: 1.23, method: "Cash" }, { amount: 1.23, method: "UPI" }] }, { "X-LFH-Action-Id": aid });
  N("lib/idempotencyRule.ts", "driven: the same action id sent twice for a REFUSED settle is answered twice by the handler (409 both times), never 'duplicate'", r1.status === 409 && r2.status === 409 && !r2.j?.duplicate, `${r1.status}/${r2.status}`);
  const claim = (await sql(`select count(*)::int c from action_idempotency where action_id='${aid}'`))[0].c;
  N("lib/idempotency.ts", "…and the claim was released — no row is left under that id", claim === 0, `${claim} row(s)`);

  // a value the database refuses is a sentence, not a 500 the outbox would retry for ever
  floorBefore = (await sql(`select floor_per_row from settings where restaurant_id='${FH}'`))[0]?.floor_per_row ?? null;
  const floor = await call(mgr, "POST", "/api/editor/settings", { restaurant_id: FH, floor_per_row: 999 });
  N("lib/dbRefusal.ts", "driven: Tables per row = 999 is refused with a 4xx (never a 500 that would be queued and retried)", floor.status >= 400 && floor.status < 500, `status ${floor.status} ${floor.t.slice(0, 120)}`);
  N("lib/dbRefusal.ts", "…in a plain sentence, not Postgres prose", !/violates|constraint "|new row for relation/i.test(floor.t), floor.t.slice(0, 120));
  const floorNow = (await sql(`select floor_per_row from settings where restaurant_id='${FH}'`))[0]?.floor_per_row ?? null;
  N("lib/dbRefusal.ts", "…and the floor setting is unchanged", floorNow === floorBefore, `${floorBefore} → ${floorNow}`);

  // ── the waiter tablet: the same library through the other door ─────────────────────────────
  const tab = await ctxOf("tablet");
  const tn = await call(tab, "POST", `/api/tablet/tables/${FREE}/pay-split`, { splits: [{ amount: 1.23, method: "Cash" }, { amount: 1.23, method: "UPI" }] });
  N("lib/paySplit.ts", "driven (waiter tablet): Pay in parts on an empty table answers the same 409 'Nothing to settle' — one money path, two doors", tn.status === 409 && /Nothing to settle/.test(tn.t), `status ${tn.status} ${tn.t.slice(0, 100)}`);
  const t1 = await call(tab, "POST", `/api/tablet/tables/${FREE}/pay-split`, { splits: [{ amount: 5, method: "Cash" }] });
  N("lib/paySplit.ts", "driven (waiter tablet): one part is refused 400 with the same sentence as the manager's", t1.status === 400 && /at least two parts/.test(t1.t), `status ${t1.status}`);
  const tcoin = await call(tab, "POST", `/api/tablet/tables/${FREE}/pay-split`, { splits: [{ amount: 5, method: "cash" }, { amount: 5, method: "UPI" }] });
  N("lib/payments.ts", "driven (waiter tablet): 'cash' in lower case is refused — the method list is exact", tcoin.status === 400, `status ${tcoin.status}`);

  // ── the owner's Tax report: the filing split, live ──────────────────────────────────────────
  const own = await ctxOf("owner");
  const rep = await call(own, "GET", `/api/owner/reports?type=tax&range=30d&rid=${FH}`);
  const comps = rep.j?.tax?.components || [];
  const totalTax = Number(rep.j?.totals?.tax ?? NaN);
  N("lib/taxFiling.ts", "driven: the owner's Tax report answers 200 with a tax block", rep.status === 200 && !!rep.j?.tax, `status ${rep.status}`);
  N("lib/taxFiling.ts", "…its CGST + SGST lines add up to the total tax to the paisa", comps.length >= 2 && Math.round(comps.reduce((a, c) => a + Number(c.amount || 0), 0) * 100) === Math.round(totalTax * 100), `${comps.map((c) => `${c.label} ${c.amount}`).join(" + ")} = ${totalTax}`);
  N("lib/tax.ts", "…French House has no named components, so the lines are the 50/50 halves of 5% (2.5 + 2.5)", comps.length === 2 && comps.every((c) => Number(c.rate) === 2.5) && rep.j?.tax?.configured === false, comps.map((c) => `${c.label}@${c.rate}`).join(", "));
  N("lib/tax.ts", "…and the report's effective rate is 5, the same figure lfh_effective_tax_rate gives", Number(rep.j?.tax?.effectivePct) === 5, `effectivePct ${rep.j?.tax?.effectivePct}`);
  N("lib/money.ts", "…no NaN / undefined / Infinity anywhere in the reply", !/NaN|undefined|Infinity/.test(rep.t));
  const day = await call(own, "GET", "/api/owner/reports?type=daysummary&range=today");
  N("lib/taxFiling.ts", "driven: the owner's day summary answers 200 with finite money", day.status === 200 && !/NaN|Infinity/.test(day.t), `status ${day.status}`);
  const ov = await call(own, "GET", "/api/owner/overview");
  N("lib/readGuard.ts", "driven: the owner overview answers 200 and declares any part it could not read (partial is a list)", ov.status === 200 && (ov.j?.partial === undefined || Array.isArray(ov.j?.partial)), `status ${ov.status}`);
  N("lib/idempotency.ts", "driven: no owner reply carries a password or a token", ![rep, day, ov].some((r) => /"(password|token|pin)"\s*:/.test(r.t)));

  // ── whoami for the waiter: it is the PERSON's cap that applies, and it is never sent unasked ──
  const tw = await call(tab, "GET", "/api/tablet/whoami");
  N("lib/discountCap.ts", "driven (waiter tablet): whoami answers without leaking any secret", [200, 404].includes(tw.status) && !/"(password|pin|token)"\s*:/.test(tw.t), `status ${tw.status}`);

  // ── ROUND 3 (P167701+): an order's allergy line, driven end to end on BOTH routes (items 16, 24) ──
  // The ONE section of this file that really writes: it adds a test allergy to an ARCHIVED French House
  // order (no live floor moves), checks every dish got it, takes it off again and checks every dish is
  // exactly as it started. The name says what it is if a run ever dies half-way, and the finally below
  // takes it off whatever happened.
  let m3 = 167701; const R3 = (file, what, ok, note) => rec(`P${m3++}`, file, what, ok, note);
  const TEST_ALG = "t30 round-3 check (remove me)";
  const ord3 = (await sql(`select o.id, o.allergies from orders o where o.restaurant_id='${FH}' and o.archived and o.status <> 'cancelled' and coalesce(o.allergies::text,'') not ilike '%t30 round-3%' and (select count(*) from order_items i where i.order_id = o.id and i.restaurant_id = o.restaurant_id) >= 2 order by o.created_at desc limit 1`))[0];
  const dishes = async () => (await sql(`select id, added_allergens, removed_flag from order_items where order_id='${ord3.id}' and restaurant_id='${FH}' order by id`)).map((d) => JSON.stringify([d.id, [...(d.added_allergens || [])].sort(), d.removed_flag]));
  const lineOf = async () => (await sql(`select allergies from orders where id='${ord3.id}'`))[0].allergies || [];
  const base = ord3 ? (Array.isArray(ord3.allergies) ? ord3.allergies : []).map((x) => String(x).toLowerCase()) : [];
  cleanupAllergy = async () => { if (ord3 && (await lineOf()).includes(TEST_ALG)) await call(mgr, "POST", `/api/editor/orders/${ord3.id}/allergies`, { allergies: base, reason_note: "T30 round 3: taking the test allergy off again" }); };
  R3("lib/orderAllergies.ts", "an archived French House order with at least two dishes exists to drive the allergy line on (none of the floor moves)", !!ord3, ord3 ? `${(await dishes()).length} dishes` : "no such order");
  if (ord3) {
    const start = await dishes();
    for (const [ctx, pre, who] of [[mgr, "/api/editor", "manager"], [tab, "/api/tablet", "waiter tablet"]]) {
      const noWhy = await call(ctx, "POST", `${pre}/orders/${ord3.id}/allergies`, { allergies: [...base, TEST_ALG] });
      R3("lib/orderAllergies.ts", `${who}: adding an allergy WITHOUT a reason is refused (400, "Say why…") and nothing moves`, noWhy.status === 400 && /Say why the allergy is changing/.test(noWhy.t) && JSON.stringify(await dishes()) === JSON.stringify(start) && !(await lineOf()).includes(TEST_ALG), `status ${noWhy.status}`);
      const t0 = (await sql("select now()::text t"))[0].t;
      const add = await call(ctx, "POST", `${pre}/orders/${ord3.id}/allergies`, { allergies: [...base, TEST_ALG], reason_note: "T30 round 3 check" });
      const afterAdd = await sql(`select added_allergens from order_items where order_id='${ord3.id}' and restaurant_id='${FH}'`);
      R3("lib/orderAllergies.ts", `${who}: with a reason it saves (200), and the order's line carries the allergy`, add.status === 200 && add.j?.ok === true && (await lineOf()).includes(TEST_ALG), `status ${add.status} ${add.t.slice(0, 80)}`);
      R3("lib/orderAllergies.ts", `${who}: …and EVERY dish on the order is marked with it (${afterAdd.length} dishes)`, afterAdd.length >= 2 && afterAdd.every((d) => (d.added_allergens || []).includes(TEST_ALG)), JSON.stringify(afterAdd.map((d) => (d.added_allergens || []).length)));
      const log3 = await sql(`select count(*) n from staff_actions where order_id='${ord3.id}' and action='order_allergies' and detail ilike '%added ${TEST_ALG.replace(/'/g, "''")}%' and created_at >= '${t0}'`);
      R3("lib/orderAllergies.ts", `${who}: …and the Activity log says what was added — exactly one new line, written by this save`, Number(log3[0].n) === 1, `${log3[0].n} rows`);
      const marked = await dishes();
      const again = await call(ctx, "POST", `${pre}/orders/${ord3.id}/allergies`, { allergies: [...base, TEST_ALG] });
      R3("lib/orderAllergies.ts", `${who}: saving the same line again needs no reason (nothing is changing) and moves nothing`, again.status === 200 && JSON.stringify(await dishes()) === JSON.stringify(marked), `status ${again.status}`);
      const off = await call(ctx, "POST", `${pre}/orders/${ord3.id}/allergies`, { allergies: base, reason_note: "T30 round 3: taking the test allergy off again" });
      R3("lib/orderAllergies.ts", `${who}: taking it off (with a reason) saves, and every dish is EXACTLY as it started — same marks, same removed-flag`, off.status === 200 && JSON.stringify(await dishes()) === JSON.stringify(start) && !(await lineOf()).includes(TEST_ALG), `status ${off.status}`);
    }
  }

  // ── ROUND 3: a tap sent twice runs ONCE (lib/idempotency.ts), driven on the same allergy line ──
  // Same archived order, same test allergy, taken off again at the end (and by the finally).
  if (ord3) {
    const start = await dishes();
    const aid = `t30-r3-${randomUUID()}`;
    const t1 = (await sql("select now()::text t"))[0].t;
    const h = { "X-LFH-Action-Id": aid };
    const first = await call(mgr, "POST", `/api/editor/orders/${ord3.id}/allergies`, { allergies: [...base, TEST_ALG], reason_note: "T30 round 3: a tap sent twice" }, h);
    const second = await call(mgr, "POST", `/api/editor/orders/${ord3.id}/allergies`, { allergies: [...base, TEST_ALG], reason_note: "T30 round 3: a tap sent twice" }, h);
    const lines = await sql(`select count(*) n from staff_actions where order_id='${ord3.id}' and action='order_allergies' and created_at >= '${t1}'`);
    R3("lib/idempotency.ts", "driven: the same tap sent twice (one action id) — the first saves, the second answers ok with duplicate:true", first.status === 200 && first.j?.ok === true && second.status === 200 && second.j?.duplicate === true, `${first.status}/${second.status} ${second.t.slice(0, 60)}`);
    R3("lib/idempotency.ts", "…and the change ran ONCE: exactly one Activity line, not two", Number(lines[0].n) === 1, `${lines[0].n} lines`);
    const other = await call(tab, "POST", `/api/tablet/orders/${ord3.id}/allergies`, { allergies: [...base, TEST_ALG], reason_note: "T30 round 3: a tap sent twice" }, h);
    R3("lib/idempotency.ts", "…a DIFFERENT person sending that action id is told it is done — and is handed nothing of the first reply", other.status === 200 && (other.j?.duplicate === true || other.j?.ok === true) && Object.keys(other.j || {}).every((k) => ["ok", "duplicate"].includes(k)), other.t.slice(0, 80));
    const back = await call(mgr, "POST", `/api/editor/orders/${ord3.id}/allergies`, { allergies: base, reason_note: "T30 round 3: taking the test allergy off again" }, { "X-LFH-Action-Id": `t30-r3-${randomUUID()}` });
    R3("lib/idempotency.ts", "…and a NEW action id is a new tap: taking the allergy off runs, and every dish is exactly as it started", back.status === 200 && JSON.stringify(await dishes()) === JSON.stringify(start), `status ${back.status}`);
    const bid = `t30-r3-${randomUUID()}`;
    const refused = await call(mgr, "POST", `/api/editor/orders/${ord3.id}/allergies`, { allergies: [...base, TEST_ALG] }, { "X-LFH-Action-Id": bid });
    const retry = await call(mgr, "POST", `/api/editor/orders/${ord3.id}/allergies`, { allergies: [...base, TEST_ALG], reason_note: "T30 round 3: the retry after a refusal" }, { "X-LFH-Action-Id": bid });
    R3("lib/idempotency.ts", "driven: a REFUSED tap does not use up its action id — the same id, sent again with the reason, really saves (not a stale 'duplicate')", refused.status === 400 && retry.status === 200 && retry.j?.duplicate !== true && (await lineOf()).includes(TEST_ALG), `${refused.status} then ${retry.status} ${retry.t.slice(0, 60)}`);
    await call(mgr, "POST", `/api/editor/orders/${ord3.id}/allergies`, { allergies: base, reason_note: "T30 round 3: taking the test allergy off again" });
    R3("lib/orderAllergies.ts", "…and after all of it the order and every dish are exactly as they started", JSON.stringify(await dishes()) === JSON.stringify(start) && !(await lineOf()).includes(TEST_ALG));
  }

  // ── ROUND 3: the owner's GST report, every period, rebuilt with the real buildFiling ───────────
  // The report page builds its filing table in the browser from the reply's rows (app/owner/reports
  // page.tsx → buildFiling). The same function is run here on the same reply, for every period the
  // route accepts, and every way the table can fail to add up is checked.
  const TF = await import(pathToFileURL(join(root, "lib/taxFiling.ts")).href);
  for (const range of ["today", "yesterday", "week", "7d", "30d", "month", "lastmonth", "12m", "fy", "all"]) {
    const rr = await call(own, "GET", `/api/owner/reports?type=tax&range=${range}&rid=${FH}`);
    const tt = rr.j?.totals || {}; const comps = rr.j?.tax?.components || []; const rws = Array.isArray(rr.j?.rows) ? rr.j.rows : [];
    const lines = comps.map((c) => ({ label: c.label, rate: Number(c.rate) }));
    const f = TF.buildFiling(lines.length ? rws.filter((r) => r.tax > 0) : [], lines, (r) => r.tax);
    const cents = (x) => Math.round(Number(x) * 100);
    R3("lib/taxFiling.ts", `GST report "${range}": answers 200 with finite money, ${rws.length} period rows`, rr.status === 200 && !!rr.j?.tax && !/NaN|Infinity/.test(rr.t), `status ${rr.status}`);
    R3("lib/taxFiling.ts", `GST report "${range}": the CGST + SGST amounts add up to the total tax, to the paisa`, comps.length >= 2 && cents(comps.reduce((a, c) => a + Number(c.amount || 0), 0)) === cents(tt.tax), `${comps.map((c) => c.amount).join(" + ")} vs ${tt.tax}`);
    R3("lib/taxFiling.ts", `GST report "${range}": the period rows' tax adds up to the total (nothing lost between the rows and the tile)`, Math.abs(cents(rws.reduce((a, r) => a + Number(r.tax || 0), 0)) - cents(tt.tax)) <= 1, `${rws.reduce((a, r) => a + Number(r.tax || 0), 0).toFixed(2)} vs ${tt.tax}`);
    R3("lib/taxFiling.ts", `GST report "${range}": the filing table's grand total is the tax tile rounded to the rupee, and its rows add up to it`, f.total === Math.round(Number(tt.tax) || 0) && f.rows.reduce((a, r) => a + r.tax, 0) === f.total, `filing ${f.total} · tile ${tt.tax}`);
    R3("lib/taxFiling.ts", `GST report "${range}": every row's CGST + SGST equals that row, and the columns add up to the grand total — none negative`, f.rows.every((r) => cents(r.parts.reduce((a, x) => a + x, 0)) === cents(r.tax) && r.parts.every((x) => x >= 0)) && cents(f.columnTotals.reduce((a, x) => a + x, 0)) === cents(f.total), `${f.rows.length} rows`);
  }
} finally {
  await cleanupAllergy().catch(() => {});
  if (mgrCtx) await restoreFloor(mgrCtx).catch(() => {});
  await browser.close();
}

if (LEDGER) {
  const esc = (x) => String(x).replace(/\|/g, "\\|").replace(/\n/g, " ");
  for (const r of rows) console.log(`| ${r.id} | \`${r.file}\` — ${esc(r.what)} | driven on ${BASE.replace(/^https?:\/\//, "")} · scripts/sweep/t30s10/live.mjs | ${r.mark} | ${esc(r.note)} |`);
}
const bad = rows.filter((r) => r.mark === "❌");
if (!LEDGER) console.log(`\n${bad.length ? "✗ FAIL" : "✓ PASS"} — ${rows.length} driven checks · ${bad.length} ❌`);
process.stdout.write("", () => process.exit(bad.length ? 1 : 0));
