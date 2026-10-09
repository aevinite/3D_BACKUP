// scripts/sweep/t30s10/live.mjs — sweep #10 · terminal 30 · the checks that DRIVE the real app.
//
//   node scripts/sweep/t30s10/live.mjs --base http://localhost:4430
//
// Ids P199671–P199720 (append only), plus the re-run of P20018 / P07456 (whoami's discount cap).
// Signs in ONCE per role through scripts/sweep/login.mjs (manager, waiter tablet, owner — all French
// House, the restaurant that is written to; Aangan is never touched). Every write it sends is one the
// app REFUSES — a stale expectation, a table with nothing to settle, a split that is the wrong shape,
// an out-of-range setting — so nothing is created. The one value it could change (the floor's tables
// per row) is read first and put back in a finally, and on SIGINT/SIGTERM.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { try { if (mgrCtx) await restoreFloor(mgrCtx); } finally { process.exit(130); } });

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
} finally {
  if (mgrCtx) await restoreFloor(mgrCtx).catch(() => {});
  await browser.close();
}

if (LEDGER) {
  const esc = (x) => String(x).replace(/\|/g, "\\|").replace(/\n/g, " ");
  for (const r of rows) console.log(`| ${r.id} | \`${r.file}\` — ${esc(r.what)} | driven on ${BASE.replace(/^https?:\/\//, "")} · scripts/sweep/t30s10/live.mjs | ${r.mark} | ${esc(r.note)} |`);
}
const bad = rows.filter((r) => r.mark === "❌");
if (!LEDGER) console.log(`\n${bad.length ? "✗ FAIL" : "✓ PASS"} — ${rows.length} driven checks · ${bad.length} ❌`);
process.exit(bad.length ? 1 : 0);
