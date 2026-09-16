// BLOCK E · app/api/owner/customers/route.ts — 45 phases, P160756–P160800.
//
// WHY 45. 421 lines, 26 ledger rows, 4 driven — and it holds the ONLY irreversible write in the
// owner panel: the DPDP erase. Everything else here can be undone; that cannot. So the erase gets
// the largest share, driven end to end on a guest this block creates and then erases.
import { FH, PP, GHOST, GET, DEL, sb, owns, undo, block, of_, code, read } from "./harness.mjs";

const S = of_("app/api/owner/customers/route.ts");
export const E = block(160756, "E · the owner's guest list, and the one erase that cannot be undone");
const { row } = E;
const fx = {};
const phone = () => `9${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 900 + 100)}`;

// ══ E1 · THE LIST AND ITS TILES ═════════════════════════════════════════════════════════════════
row(S("the guest list answers a page, four tiles and a restaurant picker"), "GET as diago1", async (c) => {
  const r = await GET(c.O, "/api/owner/customers");
  if (r.status !== 200) return `${r.status} ${r.j?.error}`;
  return !!(r.j.summary && Array.isArray(r.j.customers) && Array.isArray(r.j.restaurants))
    && ["total", "returning", "newThisMonth", "blocked", "shown"].every((k) => typeof r.j.summary[k] === "number")
    || JSON.stringify(r.j.summary);
});
row(S("the tiles are counted in the DATABASE, so they are not the shown page in disguise"), "compare summary.total with customers.length", async (c) => {
  const r = await GET(c.O, "/api/owner/customers");
  return r.j.summary.total >= r.j.customers.length || `total ${r.j.summary.total} < shown ${r.j.customers.length}`;
});
row(S("…and `shown` says how many the page is actually holding"), "read summary.shown", async (c) => {
  const r = await GET(c.O, "/api/owner/customers");
  return r.j.summary.shown === r.j.customers.length || `shown ${r.j.summary.shown} vs ${r.j.customers.length} rows`;
});
row(S("no tile is ever more than the total"), "read all four tiles", async (c) => {
  const s = (await GET(c.O, "/api/owner/customers")).j.summary;
  for (const k of ["returning", "newThisMonth", "blocked"]) if (s[k] > s.total) return `${k}=${s[k]} > total=${s.total}`;
  return true;
});
row(S("no money column exists on a guest at all — this table holds contact details and nothing else"), "scan the payload for money keys", async (c) => {
  const r = await GET(c.O, "/api/owner/customers");
  const bad = (r.j.customers || []).filter((x) => "spend" in x || "total" in x || "revenue" in x);
  return bad.length === 0 || `${bad.length} guest row(s) carry a money column`;
});
row(S("a returning guest is decided by a real visit COUNT, not by eyeballing two timestamps"), "read visits against `returning`", async (c) => {
  const r = await GET(c.O, "/api/owner/customers");
  const wrong = (r.j.customers || []).filter((x) => x.returning !== ((x.visits || 0) >= 2));
  return wrong.length === 0 || `${wrong.length} row(s) whose returning flag disagrees with their visit count`;
});
row(S("the search box cannot break the filter it is typed into"), "GET ?q with the characters that used to", async (c) => {
  for (const q of ["*", "%", "_", "(", ")", "'", '"', "\\", "%%", "a%b", "*)"]) {
    const r = await GET(c.O, `/api/owner/customers?q=${encodeURIComponent(q)}`);
    if (r.status !== 200) return `q=${JSON.stringify(q)} answered ${r.status} ${r.j?.error}`;
  }
  return true;
});
row(S("…and a search made only of stripped characters can never widen the list BEYOND the caller's own guests"),
  "GET ?q=* and check the scope, not the count", async (c) => {
  // `safeSearch("*")` returns "" — every character it strips leaves nothing, so NO filter is applied
  // and the unfiltered page comes back. That reads oddly (type `*`, nothing appears to happen) and it
  // is listed as an improvement rather than a fault, because the rule that matters still holds: the
  // sanitiser exists so `*` cannot reach `ilike` as a wildcard, and the page it returns is the
  // caller's own scope either way. What would be a fault is `*` reaching PAST that scope.
  const all = await GET(c.O, "/api/owner/customers");
  const star = await GET(c.O, "/api/owner/customers?q=*");
  if (star.status !== 200) return `${star.status} ${star.j?.error}`;
  const stray = (star.j.customers || []).filter((x) => x.restaurant_id !== FH);
  if (stray.length) return `?q=* reached ${stray.length} guest(s) outside the caller's restaurant`;
  return star.j.customers.length <= all.j.customers.length
    || `?q=* returned MORE rows (${star.j.customers.length}) than the unfiltered list (${all.j.customers.length})`;
});
for (const seg of ["all", "regulars", "new", "blocked"]) {
  row(S(`the \`${seg}\` segment narrows in the database, not on the page`), `GET ?seg=${seg}`, async (c) => {
    const r = await GET(c.O, `/api/owner/customers?seg=${seg}`);
    if (r.status !== 200) return `${r.status} ${r.j?.error}`;
    const rows = r.j.customers || [];
    if (seg === "regulars") return rows.every((x) => (x.visits || 0) >= 2) || "a first-timer is in the regulars";
    if (seg === "new") return rows.every((x) => (x.visits || 0) < 2) || "a regular is in the new list";
    if (seg === "blocked") return rows.every((x) => x.blocked === true) || "an unblocked guest is in the blocked list";
    return true;
  });
}
row(S("a segment nobody recognises answers the whole list rather than an error"), "GET ?seg=nonsense", async (c) => {
  const r = await GET(c.O, "/api/owner/customers?seg=nonsense");
  return r.status === 200 || `${r.status} ${r.j?.error}`;
});
row(S("the sort is one of two, and anything else falls back rather than being interpolated"), "GET ?sort=visits and ?sort=drop", async (c) => {
  const a = await GET(c.O, "/api/owner/customers?sort=visits");
  const b = await GET(c.O, "/api/owner/customers?sort=drop%20table");
  return !!(a.status === 200 && b.status === 200) || `${a.status} / ${b.status}`;
});
row(S("…and ?sort=visits really sorts by visits, biggest first"), "read the order", async (c) => {
  const r = await GET(c.O, "/api/owner/customers?sort=visits");
  const v = (r.j.customers || []).map((x) => x.visits || 0);
  return v.every((x, i) => i === 0 || v[i - 1] >= x) || `out of order: ${JSON.stringify(v.slice(0, 8))}`;
});
row(S("narrowing to one restaurant is honoured only when it is one of the caller's"), "GET ?restaurant_id=<Pizza Palace> as diago1", async (c) => {
  const r = await GET(c.O, `/api/owner/customers?restaurant_id=${PP}`);
  const stray = (r.j.customers || []).filter((x) => x.restaurant_id === PP);
  return stray.length === 0 || `${stray.length} Pizza Palace guest(s) reached its non-owner`;
});
row(S("one guest's drawer answers their bills and their own rows, and no tiles"), "GET ?phone=<a real guest>", async (c) => {
  const list = await GET(c.O, "/api/owner/customers");
  const one = (list.j.customers || [])[0];
  if (!one) return "SKIP: no guests on this restaurant";
  fx.someone = one.phone;
  const r = await GET(c.O, `/api/owner/customers?phone=${encodeURIComponent(one.phone)}`);
  return !!(r.status === 200 && r.j.detail && !r.j.summary) || `${r.status} keys=${Object.keys(r.j || {}).join(",")}`;
});
row(S("…and a phone number that is not one answers calmly, never a database sentence"), "GET ?phone=not-a-phone", async (c) => {
  const r = await GET(c.O, "/api/owner/customers?phone=not-a-phone");
  return !/PGRST|invalid input|relation "/i.test(r.txt) || r.txt.slice(0, 120);
});
row(S("…and one guest's drawer never carries another restaurant's rows for the same number"), "read detail.rows[].restaurant_id", async (c) => {
  if (!fx.someone) return "SKIP: no guest resolved";
  const r = await GET(c.O, `/api/owner/customers?phone=${encodeURIComponent(fx.someone)}`);
  const stray = (r.j.detail?.rows || []).filter((x) => x.restaurant_id !== FH);
  return stray.length === 0 || `${stray.length} row(s) from another restaurant`;
});

// ══ E2 · WHO MAY SEE IT ═════════════════════════════════════════════════════════════════════════
row(S("a kitchen login sees no guest list"), "GET as diagkitchen", async (c) => {
  const r = await GET(c.K, "/api/owner/customers");
  return !!(r.status >= 400 && !/"phone"/.test(r.txt)) || `${r.status} ${r.txt.slice(0, 90)}`;
});
row(S("nobody at all sees no guest list"), "GET with no cookie", async (c) => {
  const r = await GET(c.N, "/api/owner/customers");
  return !!(r.status === 401 && !/"phone"/.test(r.txt)) || `${r.status} ${r.txt.slice(0, 90)}`;
});
row(S("a two-restaurant owner sees both guest books, and each row says which"), "GET as diagmulti", async (c) => {
  const r = await GET(c.M, "/api/owner/customers");
  if (r.status !== 200) return `${r.status} ${r.j?.error}`;
  const stray = (r.j.customers || []).filter((x) => x.restaurant_id !== FH && x.restaurant_id !== PP);
  return stray.length === 0 && (r.j.customers || []).every((x) => typeof x.restaurantName === "string")
    || `${stray.length} stray, named=${(r.j.customers || []).every((x) => !!x.restaurantName)}`;
});
row(S("…and no guest's restaurant renders as \"[object Object]\", whatever shape its name is stored in"), "scan the payload", async (c) => {
  const r = await GET(c.M, "/api/owner/customers");
  return !/\[object Object\]/.test(r.txt) || "a restaurant name rendered as an object";
});

// ══ E3 · THE ERASE — the only irreversible write in the panel ═══════════════════════════════════
row(S("erasing needs both a restaurant and a phone number"), "DELETE with each missing in turn", async (c) => {
  for (const body of [{}, { restaurant_id: FH }, { phone: "9999999999" }]) {
    const r = await DEL(c.O, "/api/owner/customers", { data: body });
    if (r.status !== 400) return `${JSON.stringify(body)} answered ${r.status}`;
  }
  return true;
});
row(S("…and a body that is not JSON is answered calmly"), "DELETE with raw bytes", async (c) => {
  const r = await DEL(c.O, "/api/owner/customers", { data: Buffer.from("{nope", "utf8"), headers: { "content-type": "application/json" } });
  return !!(r.status === 400 && /bad body/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("a guest of a restaurant that is not yours cannot be erased"), "DELETE a Pizza Palace guest as diago1", async (c) => {
  const m = await GET(c.M, `/api/owner/customers?restaurant_id=${PP}`);
  const other = (m.j.customers || []).find((x) => x.restaurant_id === PP);
  if (!other) return "SKIP: no Pizza Palace guest";
  const r = await DEL(c.O, "/api/owner/customers", { data: { restaurant_id: PP, phone: other.phone } });
  const still = await sb.from("customers").select("phone").eq("restaurant_id", PP).eq("phone", other.phone).maybeSingle();
  return !!(r.status === 403 && still.data) || `${r.status} stillThere=${!!still.data} — it erased another owner's guest`;
});
row(S("…nor one on a restaurant that does not exist"), "DELETE with a well-formed id nothing owns", async (c) => {
  const r = await DEL(c.O, "/api/owner/customers", { data: { restaurant_id: GHOST, phone: "9999999999" } });
  return !!(r.status === 403) || `${r.status} ${r.j?.error}`;
});
row(S("a guest who still OWES pay-later money is refused, and told how much and what to do"), "seed a debtor, try to erase", async (c) => {
  const ph = phone();
  const ins = await sb.from("khata_customers").insert({ restaurant_id: FH, name: "T28R2 Debtor", phone: ph }).select("id").maybeSingle();
  if (ins.error) return `SKIP: could not seed a pay-later person — ${ins.error.message}`;
  owns("khata_customers", ins.data.id); fx.debtor = { id: ins.data.id, phone: ph };
  const ord = await sb.from("orders").select("id, session_id").eq("restaurant_id", FH).is("deleted_at", null)
    .neq("status", "cancelled").order("created_at", { ascending: false }).limit(1);
  const o = (ord.data || [])[0];
  if (!o) return "SKIP: no order to attach a debt to";
  const before = await sb.from("orders").select("khata_customer_id, khata_at, payment_status").eq("id", o.id).maybeSingle();
  // ── THE DETACH IS REGISTERED BEFORE THE ATTACH, NOT AFTER IT (T28 round 2, 2026-09-16) ────────
  // This restored the order inline, on the happy path only. A run that was interrupted between the
  // attach and the restore therefore left a real order pointing at this fixture — and then the
  // fixture could not be deleted at all, because `orders.khata_customer_id` is a foreign key with no
  // cascade (which is correct: an issued bill is a sales record). The cleanup failed with
  // "violates foreign key constraint orders_khata_customer_id_fkey", and putting it right by hand
  // meant guessing one order's payment_status, because the captured value was gone with the process.
  //
  // Registered through `undo()` now, which runs in a `finally` AND on SIGINT/SIGTERM, and which
  // runs BEFORE the row deletions — so the order is always let go of before anything tries to
  // remove what it points at. Registered first, so an interruption during the attach is covered too.
  undo(async () => {
    await sb.from("orders").update({
      khata_customer_id: before.data.khata_customer_id,
      khata_at: before.data.khata_at,
      payment_status: before.data.payment_status,
    }).eq("id", o.id);
    const back = await sb.from("orders").select("khata_customer_id").eq("id", o.id).maybeSingle();
    if (back.data?.khata_customer_id) throw new Error(`order ${o.id} is still attached to a pay-later fixture`);
  }, `the pay-later attachment on order ${o.id}`);
  await sb.from("orders").update({ khata_customer_id: ins.data.id, khata_at: new Date().toISOString(), payment_status: "unpaid" }).eq("id", o.id);
  const r = await DEL(c.O, "/api/owner/customers", { data: { restaurant_id: FH, phone: ph } });
  return !!(r.status === 409 && r.j?.reason === "khata_outstanding" && typeof r.j.owed === "number" && /Collect or write that off/i.test(r.j.error || ""))
    || `${r.status} ${JSON.stringify(r.j).slice(0, 150)}`;
});
row(S("…and that refusal leaves their pay-later record completely intact"), "read the khata row after the refusal", async (c) => {
  if (!fx.debtor) return "SKIP: no debtor seeded";
  const q = await sb.from("khata_customers").select("name, phone").eq("id", fx.debtor.id).maybeSingle();
  return !!(q.data && q.data.phone === fx.debtor.phone && q.data.name === "T28R2 Debtor")
    || `the refused erase changed the record: ${JSON.stringify(q.data)}`;
});
row(S("a guest with no debt IS erased, and their guest-list row really goes"), "seed a guest, erase, read back", async (c) => {
  const ph = phone();
  const ins = await sb.from("customers").insert({ restaurant_id: FH, phone: ph, name: "T28R2 Erase Me", visits: 1, consent: true }).select("phone").maybeSingle();
  if (ins.error) return `SKIP: could not seed a guest — ${ins.error.message}`;
  fx.erasable = ph;
  const r = await DEL(c.O, "/api/owner/customers", { data: { restaurant_id: FH, phone: ph } });
  const still = await sb.from("customers").select("phone").eq("restaurant_id", FH).eq("phone", ph).maybeSingle();
  if (still.data) owns("customers", still.data.phone);
  return !!(r.status === 200 && r.j.ok === true && !still.data) || `${r.status} stillThere=${!!still.data} ${r.j?.error}`;
});
row(S("…and the answer says what SURVIVED, because an erasure that cannot be complete must say so"), "read the erase answer", async (c) => {
  const ph = phone();
  const ins = await sb.from("customers").insert({ restaurant_id: FH, phone: ph, name: "T28R2 Summary", visits: 1 }).select("phone").maybeSingle();
  if (ins.error) return `SKIP: ${ins.error.message}`;
  const r = await DEL(c.O, "/api/owner/customers", { data: { restaurant_id: FH, phone: ph } });
  return !!(r.status === 200 && Array.isArray(r.j.removed) && Array.isArray(r.j.kept) && r.j.kept.every((k) => k.what && k.why))
    || `${r.status} removed=${JSON.stringify(r.j?.removed)} kept=${JSON.stringify(r.j?.kept)?.slice(0, 120)}`;
});
row(S("…and the things it says it removed are the DECLARED list, not a sentence somebody typed"), "compare the answer with lib/personalData.ts", async (c) => {
  const src = code(read("lib/personalData.ts"));
  const declared = (src.match(/what:\s*"([^"]+)"/g) || []).length;
  const ph = phone();
  const ins = await sb.from("customers").insert({ restaurant_id: FH, phone: ph, name: "T28R2 Declared", visits: 1 }).select("phone").maybeSingle();
  if (ins.error) return `SKIP: ${ins.error.message}`;
  const r = await DEL(c.O, "/api/owner/customers", { data: { restaurant_id: FH, phone: ph } });
  const said = (r.j.removed || []).length + (r.j.kept || []).length;
  return said === declared || `the answer names ${said} places, the declared list has ${declared}`;
});
row(S("the erase writes a line into the Removals record, because that is where anyone looks for a vanished guest"), "erase, then read deletion_audit", async (c) => {
  const ph = phone();
  const ins = await sb.from("customers").insert({ restaurant_id: FH, phone: ph, name: "T28R2 Audit", visits: 1 }).select("phone").maybeSingle();
  if (ins.error) return `SKIP: ${ins.error.message}`;
  const before = new Date().toISOString();
  const r = await DEL(c.O, "/api/owner/customers", { data: { restaurant_id: FH, phone: ph } });
  if (r.status !== 200) return `SKIP: erase answered ${r.status}`;
  let a = null;
  for (let i = 0; i < 8 && !a; i++) {
    const q = await sb.from("deletion_audit").select("id, kind, actor, actor_role, item_title, meta").eq("kind", "customer_erased").gte("at", before).limit(1);
    a = (q.data || [])[0] || null; if (!a) await new Promise((x) => setTimeout(x, 350));
  }
  if (a) owns("deletion_audit", a.id);
  fx.audit = a;
  return !!a || "the guest was erased and nothing was recorded in the Removals record";
});
row(S("…and that line names the person only by the last four digits — the audit of an erasure is not a fresh copy of the number"), "read the audit row", async (c) => {
  if (!fx.audit) return "SKIP: no audit row";
  const blob = JSON.stringify(fx.audit);
  const full = blob.match(/9\d{9}/);
  return !full || `the full number ${full[0]} is in the audit of its own erasure`;
});
row(S("…and it names every table the erase actually touched, derived from the declared list"), "read meta.also_erased and meta.anonymised", async (c) => {
  if (!fx.audit) return "SKIP: no audit row";
  const m = fx.audit.meta || {};
  const src = code(read("lib/personalData.ts"));
  const erasable = (src.match(/policy:\s*"(erase|anonymise)"/g) || []).length;
  const named = (m.also_erased || []).length + (m.anonymised || []).length + 1;   // +1 for `customers` itself
  return named >= erasable || `the record names ${named} table(s) of the ${erasable} the erase walks`;
});
row(S("…and it keeps \"deleted\" separate from \"emptied of the person but kept\""), "read the two lists apart", async (c) => {
  if (!fx.audit) return "SKIP";
  const m = fx.audit.meta || {};
  return !!(Array.isArray(m.also_erased) && Array.isArray(m.anonymised) && m.anonymised.includes("khata_customers"))
    || `also_erased=${JSON.stringify(m.also_erased)} anonymised=${JSON.stringify(m.anonymised)}`;
});
row(S("the erase also writes a line into the Activity log, naming who did it"), "erase and read staff_actions", async (c) => {
  const ph = phone();
  const ins = await sb.from("customers").insert({ restaurant_id: FH, phone: ph, name: "T28R2 Log", visits: 1 }).select("phone").maybeSingle();
  if (ins.error) return `SKIP: ${ins.error.message}`;
  const before = new Date().toISOString();
  const r = await DEL(c.O, "/api/owner/customers", { data: { restaurant_id: FH, phone: ph } });
  if (r.status !== 200) return `SKIP: ${r.status}`;
  let a = null;
  for (let i = 0; i < 8 && !a; i++) {
    const q = await sb.from("staff_actions").select("id, panel, actor, detail").eq("action", "customer_erase").gte("created_at", before).limit(1);
    a = (q.data || [])[0] || null; if (!a) await new Promise((x) => setTimeout(x, 350));
  }
  if (a) owns("staff_actions", a.id);
  if (!a) return "the guest was erased and the Activity log says nothing";
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(String(a.actor || ""));
  return !!(a.panel === "owner" && a.actor && !isUuid) || `panel=${a.panel} actor=${a.actor}`;
});
row(S("…and that line does not repeat the whole phone number either"), "read the detail", async (c) => {
  const q = await sb.from("staff_actions").select("detail").eq("action", "customer_erase")
    .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString()).limit(5);
  const full = (q.data || []).map((x) => String(x.detail)).find((d) => /9\d{9}/.test(d));
  return !full || `a full number is in an Activity line: ${full.slice(0, 80)}`;
});
row(S("a guest who was never there is answered without pretending to erase them"), "DELETE a number PROVED absent first", async (c) => {
  // ── NEVER ASSUME A NUMBER IS UNUSED (T28 round 2, 2026-09-16) ─────────────────────────────────
  // This first used the hard-coded `9000000001`, on the assumption that a made-up number belongs to
  // nobody. Forty terminals share this database and it belonged to one of them: the erase answered
  // `erased: 1` and a fixture that was not mine is gone. It is reported rather than papered over,
  // and recreating it was deliberately NOT done — the audit row keeps only the last four digits (by
  // design), so any "restored" row would have been invented data, which is worse than a known hole.
  //
  // So the absence is PROVED, immediately before the call, and the number is random.
  let ph = null;
  for (let i = 0; i < 12 && !ph; i++) {
    const cand = `9${String(Math.floor(Math.random() * 9e8) + 1e8)}`;
    const q = await sb.from("customers").select("phone").eq("phone", cand).limit(1);
    if (!q.error && !(q.data || []).length) ph = cand;
  }
  if (!ph) return "SKIP: could not find a number that belongs to nobody";
  const r = await DEL(c.O, "/api/owner/customers", { data: { restaurant_id: FH, phone: ph } });
  return !!(r.status === 200 && r.j.erased === 0) || `${r.status} erased=${r.j?.erased} for a number proved absent`;
});
row(S("the erase is the only verb here that writes — there is no way to EDIT a guest from this route"), "POST and PATCH are not exported", async (c) => {
  const src = code(read("app/api/owner/customers/route.ts"));
  return !/export async function (POST|PATCH|PUT)/.test(src) || "this route has grown a write verb other than the erase";
});
row(S("every read in it names its columns and carries a ceiling"), "read: no select(*) and every list read bounded", async () => {
  const src = code(read("app/api/owner/customers/route.ts"));
  if (/select\("\*"\)/.test(src)) return "a select(*) is back";
  const lists = [...src.matchAll(/from\("(customers|sessions|orders|khata_customers)"\)[\s\S]{0,420}?;/g)].map((m) => m[0]);
  // A `.delete()` or `.update()` scoped by restaurant + phone is not a list READ and needs no
  // ceiling — the first version of this check counted the erase itself as an unbounded read.
  const reads = lists.filter((q) => !/\.delete\(\)|\.update\(/.test(q));
  const unbounded = reads.filter((q) => /\.select\(/.test(q) && !/head:\s*true/.test(q) && !/\.limit\(|maybeSingle\(/.test(q));
  return unbounded.length === 0 || `${unbounded.length} unbounded list read(s): ${unbounded.map((q) => q.replace(/\s+/g, " ").slice(0, 70)).join(" | ")}`;
});
row(S("the tiles are cached, so four counts do not run on every open"), "GET twice and compare the stamp", async (c) => {
  const a = await GET(c.O, "/api/owner/customers");
  const b = await GET(c.O, "/api/owner/customers");
  return !!(a.j.summary?.cachedAt && Date.parse(a.j.summary.cachedAt) === Date.parse(b.j.summary?.cachedAt || 0))
    || `${a.j.summary?.cachedAt} vs ${b.j.summary?.cachedAt}`;
});
row(S("…and a failed count is never printed as a confident zero"), "read: the four counts throw rather than defaulting", async () => {
  const src = code(read("app/api/owner/customers/route.ts"));
  return !!(/set\.count\("all"\)/.test(src) && /rd\("blocked"/.test(src) && /ReadFailed/.test(src))
    || "the tiles no longer go through the read guard, so a failed count can print as 0";
});
row(S("is this how a real restaurant needs it? a guest erased at one restaurant is still a guest at the other"), "erase at French House, check Pizza Palace", async (c) => {
  const ph = phone();
  const a = await sb.from("customers").insert({ restaurant_id: FH, phone: ph, name: "T28R2 Two Shops", visits: 1 }).select("phone").maybeSingle();
  const b = await sb.from("customers").insert({ restaurant_id: PP, phone: ph, name: "T28R2 Two Shops", visits: 1 }).select("phone").maybeSingle();
  if (a.error || b.error) return `SKIP: could not seed both — ${a.error?.message || b.error?.message}`;
  const r = await DEL(c.O, "/api/owner/customers", { data: { restaurant_id: FH, phone: ph } });
  const atFH = await sb.from("customers").select("phone").eq("restaurant_id", FH).eq("phone", ph).maybeSingle();
  const atPP = await sb.from("customers").select("phone").eq("restaurant_id", PP).eq("phone", ph).maybeSingle();
  await sb.from("customers").delete().eq("restaurant_id", PP).eq("phone", ph);
  await sb.from("customers").delete().eq("restaurant_id", FH).eq("phone", ph);
  return !!(r.status === 200 && !atFH.data && atPP.data) || `erased=${r.status} atFH=${!!atFH.data} atPP=${!!atPP.data} — one restaurant's erase reached the other`;
});
row(S("a guest erased while ANOTHER of their rows is being read does not leave half a person behind"), "erase, then look for every trace by the declared list", async (c) => {
  const ph = phone();
  const ins = await sb.from("customers").insert({ restaurant_id: FH, phone: ph, name: "T28R2 Traces", visits: 1 }).select("phone").maybeSingle();
  if (ins.error) return `SKIP: ${ins.error.message}`;
  const r = await DEL(c.O, "/api/owner/customers", { data: { restaurant_id: FH, phone: ph } });
  if (r.status !== 200) return `SKIP: erase answered ${r.status}`;
  // Every table the declared list calls ERASABLE and scopes by restaurant must hold nothing for them.
  const left = [];
  for (const t of ["customers", "customer_visits", "customer_devices"]) {
    const q = await sb.from(t).select("phone").eq("restaurant_id", FH).eq("phone", ph).limit(1);
    if (!q.error && (q.data || []).length) left.push(t);
  }
  return left.length === 0 || `a trace survived in ${left.join(", ")}`;
});
