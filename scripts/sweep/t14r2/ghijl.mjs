// Round 2 · G — LOYALTY LEAVES NO TRACE WHEN OFF (P214361–P214400) · H — EVERY PRINT BUILDER × SIX REAL
// RESTAURANTS (P214401–P214470) · I — THE PRINTING BOARD (P214471–P214500) · J — LOGINS AND SEPARATION
// (P214501–P214540) · L — DATABASE GRANTS (P214541–P214560). SELECTs only; builders only READ.
import { sec, imp, sql, read, NO_DB } from "../t14s10/lib.mjs";

const env = Object.fromEntries(read(".env.local").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
const { refuseUnlessDevTestDb } = await imp("scripts/sweep/devStacks.mjs");
refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "T14 round 2 G–L (read-only)");
process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const B = (await imp("public/panels/billdoc.js")).default;
const BP = await imp("lib/billPreview.ts");
const PD = await imp("lib/printDocs.ts");
const LOY = await imp("lib/loyalty.ts");
const W = await imp("lib/printBoardWords.ts");
const db = (fn) => async () => (NO_DB ? { skip: "--no-db" } : fn());
const SLUGS = ["french-house", "aangan-garden-restaurant", "pizza-palace", "saffron-street", "copper-kettle", "aevidine", "green-bowl", "empty-cafe-zz", "demo-bistro", "burger-barn", "spice-route", "sakura-sushi", "taco-fiesta", "og-s-cafe", "hi"];
const R = NO_DB ? {} : Object.fromEntries((await sql(`select r.slug, r.id, to_jsonb(s) st from restaurants r join settings s on s.restaurant_id=r.id where r.slug in (${SLUGS.map((x) => `'${x}'`).join(",")})`)).map((x) => [x.slug, x]));

// ── G · loyalty ──────────────────────────────────────────────────────────────────────────────────
const g = sec(214360);
let gn = 1;
for (const slug of SLUGS) {
  const a = gn++, b2 = gn++;
  g(a, "public/panels/billdoc.js", `${slug}: what its screens SAY about loyalty (moduleOn on its own settings) = what the server's ladder decides`, "billdoc moduleOn vs lib/loyalty loyaltyOn", db(async () => { const r = R[slug]; if (!r) return { skip: "absent" }; const s = B.moduleOn(r.st, "loyalty"), v = await LOY.loyaltyOn(r.id); return s === v ? { ok: true, note: v ? "on" : "off" } : `screen ${s}, server ${v}`; }));
  g(b2, "lib/billPreview.ts", `${slug}: the admin's bill preview shows the points lines exactly when loyalty is on — and not a word of it when off`, "billPreviewHtml on its real settings", db(async () => { const r = R[slug]; if (!r) return { skip: "absent" }; const on = await LOY.loyaltyOn(r.id); const h = BP.billPreviewHtml(r.st, "bill", { slug }); const has = /Points on this bill/.test(h); const anyWord = /points|loyalty|reward/i.test(h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, "")); return (on ? has : (!has && !anyWord)) || `on=${on}, points shown=${has}, any loyalty word=${anyWord}`; }));
}
// gn = 31
for (const slug of ["french-house", "aevidine", "saffron-street", "copper-kettle"]) {
  const id = gn++;
  g(id, "lib/printDocs.ts", `${slug}: the TEST-print bill carries the points lines only if loyalty is on`, "sampleBillHtml vs the server ladder", db(async () => { const r = R[slug]; const on = await LOY.loyaltyOn(r.id); const h = await PD.sampleBillHtml(r.id); return (/Points on this bill/.test(h) === on) || `on=${on} but points ${/Points on this bill/.test(h) ? "shown" : "missing"}`; }));
}

// ── H · every builder × six real restaurants ──────────────────────────────────────────────────────
const h = sec(214400);
const SIX = ["french-house", "aangan-garden-restaurant", "pizza-palace", "saffron-street", "aevidine", "empty-cafe-zz"];
const clean = (x) => !/undefined|NaN|\[object Object\]|\$\{/.test(x);
let hn = 1;
for (const slug of SIX) {
  const id0 = hn; hn += 8;
  const rid = () => R[slug]?.id;
  h(id0, "lib/printDocs.ts", `${slug}: the test kitchen ticket renders, carries the TEST band, is not DUPLICATE, and has no stray value`, "sampleKotHtml", db(async () => { const x = await PD.sampleKotHtml(rid()); return (/TEST PRINT/.test(x) && !/Duplicate/.test(x) && clean(x)) || "wrong"; }));
  h(id0 + 1, "lib/printDocs.ts", `${slug}: the test bill carries no number, adds up, and has no stray value`, "sampleBillHtml", db(async () => { const x = await PD.sampleBillHtml(rid()); const t = x.slice(x.indexOf('<div class="totals">'), x.indexOf('class="g"><span>TOTAL')); const sum = [...t.matchAll(/<div class="t(?: tx)?"><span>([^<]+)<\/span><span>([−+]?\s*)₹([\d,.]+)/g)].filter((m) => m[1] !== "Taxable value").reduce((a, m) => a + (m[2].includes("−") ? -1 : 1) * Number(m[3].replace(/,/g, "")), 0); const tot = Number((x.match(/TOTAL<\/span><span>₹([\d,]+)/) || [])[1]?.replace(/,/g, "")); return (!/<span>(Invoice|Bill no)<\/span>/.test(x) && sum === tot && clean(x)) || `rows ${sum} vs total ${tot}`; }));
  h(id0 + 2, "lib/printDocs.ts", `${slug}: the test banquet sheet renders with this restaurant's own banquet rate and heading`, "sampleBanquetHtml vs bqTaxModel", db(async () => { const x = await PD.sampleBanquetHtml(rid()); const tm = B.bqTaxModel(R[slug].st); const head = (x.match(/<div class="doct"><b>([^<]+)/) || [])[1]; const want = R[slug].st.price_tax_mode === "composition" ? "Bill of Supply" : (String(R[slug].st.gstin || "").trim() ? "Tax Invoice" : "Bill"); return (head === want && (tm.pct > 0 ? !/GST 0%/.test(x) : true) && clean(x)) || `heading ${head} (want ${want}), rate ${tm.pct}`; }));
  h(id0 + 3, "lib/printDocs.ts", `${slug}: a real ticket from one of its orders (an hour old or more) prints its own KOT number`, "kotHtmlForOrder", db(async () => { const o = (await sql(`select id, kot_no from orders where restaurant_id='${rid()}' and deleted_at is null and status<>'cancelled' and kot_no is not null and created_at < now() - interval '1 hour' order by created_at desc limit 1`))[0]; if (!o) return { skip: "no such order" }; const x = await PD.kotHtmlForOrder(rid(), o.id, false); return (x && x.includes(`KOT #${o.kot_no}<`) && clean(x)) || "wrong ticket"; }));
  h(id0 + 4, "lib/printDocs.ts", `${slug}: a real delivery ticket prints CHANNEL · customer`, "kotHtmlForAggregator", db(async () => { const a = (await sql(`select id, source from aggregator_orders where restaurant_id='${rid()}' and status<>'cancelled' order by created_at desc limit 1`))[0]; if (!a) return { skip: "no platform order here" }; const x = await PD.kotHtmlForAggregator(rid(), a.id, false); const lbl = { zomato: "ZOMATO", swiggy: "SWIGGY", takeaway: "WEBSITE", parcel: "PARCEL" }[a.source] || "PLATFORM"; return (x && x.includes(lbl) && clean(x)) || "label missing"; }));
  h(id0 + 5, "lib/printDocs.ts", `${slug}: a real banquet sheet renders from its frozen figures`, "banquetHtmlForBill", db(async () => { const b = (await sql(`select id from banquet_bills where restaurant_id='${rid()}' order by created_at desc limit 1`))[0]; if (!b) return { skip: "no banquet sheet here" }; const x = await PD.banquetHtmlForBill(rid(), b.id); return (x && /INVOICE TOTAL/.test(x) && clean(x)) || "no sheet"; }));
  h(id0 + 6, "lib/printDocs.ts", `${slug}: a 58mm roll narrows its test bill to 48mm, centred, the rule placed last`, "withPaper on sampleBillHtml", db(async () => { const x = PD.withPaper(await PD.sampleBillHtml(rid()), { wMm: 57.8, hMm: 64.2 }); return (x.lastIndexOf("width:48mm !important") > x.lastIndexOf("width:66mm !important")) || "not narrowed last"; }));
  h(id0 + 7, "lib/printDocs.ts", `${slug}: none of its builders will print another restaurant's row`, "its id with French House's / Aangan's rows", db(async () => {
    const other = slug === "french-house" ? R["aangan-garden-restaurant"].id : R["french-house"].id;
    const o = (await sql(`select id from orders where restaurant_id='${other}' limit 1`))[0], s = (await sql(`select id from sessions where restaurant_id='${other}' limit 1`))[0], b = (await sql(`select id from banquet_bills where restaurant_id='${other}' limit 1`))[0], a = (await sql(`select id from aggregator_orders where restaurant_id='${other}' limit 1`))[0];
    const got = [o && await PD.kotHtmlForOrder(rid(), o.id, false), s && await PD.billHtmlForSession(rid(), s.id), b && await PD.banquetHtmlForBill(rid(), b.id), a && await PD.kotHtmlForAggregator(rid(), a.id, false)].filter((x) => x !== undefined && x !== null && x !== false && x !== 0 && x !== "");
    return got.length === 0 || `${got.length} foreign document(s) built`;
  }));
}
// hn = 49
const PRESETS = [["80mm roll", { wMm: 79.7, hMm: 64.2 }, false], ["58mm roll", { wMm: 57.8, hMm: 64.2 }, true], ["A4", { wMm: 210, hMm: 297 }, false], ["A5", { wMm: 148, hMm: 210 }, false], ["A6", { wMm: 105, hMm: 148 }, false], ["as the printer says", null, false]];
for (const [name, paper, narrows] of PRESETS) for (const [doc, html] of [["bill", B.billDocHtml({ lines: [{ title: "x", qty: 1, price: 1 }] })], ["ticket", B.kotDocHtml({ kot: 1 })], ["banquet sheet", B.banquetDocHtml({ bill: {}, lines: [] })]]) {
  const id = hn++;
  h(id, "lib/printDocs.ts", `${name} paper on the ${doc}: the right page size, and a narrower column only on 58mm`, "withPaper", () => {
    const x = PD.withPaper(html, paper);
    if (!paper) return x === html || "changed with no paper";
    if (doc === "banquet sheet") return x === html || "the banquet sheet's own size was overridden";
    return (x.includes(`@page{size:${paper.wMm}mm ${paper.hMm}mm;margin:0}`) && x.includes("html body{width:") === narrows) || "wrong rule";
  });
}

// ── I · the printing board ────────────────────────────────────────────────────────────────────────
const i = sec(214470);
const PBM = await imp("lib/printBoard.ts");
let inn = 1;
for (const slug of SIX) {
  const id = inn; inn += 4;
  const st = async () => PBM.printBoardState(R[slug].id);
  i(id, "lib/printBoard.ts", `${slug}: its printing board loads with the documented shape and no stored 'mode'`, "printBoardState", db(async () => { const s = await st(); return (Array.isArray(s.agents) && typeof s.paused === "boolean" && !("mode" in s) && s.stuck && typeof s.stuck.afterMs === "number") || Object.keys(s).join(","); }));
  i(id + 1, "lib/printBoard.ts", `${slug}: WAITING equals the per-printer rows beneath it`, "waiting vs waitingBy", db(async () => { const s = await st(); return s.waiting === s.waitingBy.reduce((n, q) => n + q.n, 0) || `${s.waiting} vs rows`; }));
  i(id + 2, "lib/printBoard.ts", `${slug}: every recent job shown is this restaurant's own, at most twelve`, "recent ids vs SQL", db(async () => { const s = await st(); if (s.recent.length > 12) return `${s.recent.length} rows`; if (!s.recent.length) return { ok: true, note: "no jobs" }; const r = await sql(`select count(*)::int n from print_jobs where id in (${s.recent.map((j) => `'${j.id}'`).join(",")}) and restaurant_id<>'${R[slug].id}'`); return r[0].n === 0 || "a job from another restaurant"; }));
  i(id + 3, "lib/printBoard.ts", `${slug}: the board never carries the setup code itself — only whether one is live`, "setupCode keys", db(async () => { const s = await st(); return JSON.stringify(Object.keys(s.setupCode || {}).sort()) === JSON.stringify(["expiresAt", "live", "oldFileAt"]) || Object.keys(s.setupCode || {}).join(","); }));
}
// inn = 25
const WAIT = [[45e3, "under a minute"], [60e3, "1 minute"], [3_570_000, "1 hour"], [7_200_000, "2 hours"], [84_600_000, "a whole day"], [3 * 86_400_000, "3 days"]];
for (const [ms, want] of WAIT) { const id = inn++; i(id, "lib/printBoardWords.ts", `waiting ${ms}ms reads "${want}" (item 9)`, "waitedWords", () => W.waitedWords(ms) === want || W.waitedWords(ms)); }

// ── J · logins and restaurant separation ──────────────────────────────────────────────────────────
const j = sec(214500);
const GATES = [
  ["app/api/print-agent/[...path]/route.ts", /whoIsAsking\(req\)/, "the print helper's own token (whoIsAsking)"],
  ["app/api/admin/printing/[...path]/route.ts", /tokenIsValid/, "the admin login (tokenIsValid)"],
  ["app/api/admin/restaurants/bill-preview/route.ts", /tokenIsValid/, "the admin login (tokenIsValid)"],
  ["app/api/owner/printing/route.ts", /ownerScope/, "the owner's scope (ownerScope)"],
  ["app/api/editor/[...path]/route.ts", /requireRole/, "the staff login (requireRole)"],
  ["app/api/tablet/[...path]/route.ts", /requireRole|tabletGate|gate\(/, "the staff login"],
];
let jn = 1;
for (const [f, re, what] of GATES) {
  const id = jn++;
  j(id, f, `every request here is checked against ${what} before it reaches the bill/print code`, "read the route: the gate exists and comes before the first database read", () => { const t = read(f); if (!t) return `${f} missing`; const gi = t.search(re), di = t.search(/\.from\(["'`]/); return (gi >= 0 && (di < 0 || gi < di)) || `gate at ${gi}, first read at ${di}`; });
}
// jn = 7
j(7, "lib/billCustomer.ts", "the manager route confirms the table's session is THIS restaurant's before saving its customer", "ownsGen precedes saveBillCustomer", () => { const t = read("app/api/editor/[...path]/route.ts"); const s = t.indexOf("saveBillCustomer(sb, rid"); const o = t.lastIndexOf('.eq("restaurant_id", rid)', s); return (s > 0 && o > 0 && s - o < 1500) || "no ownership check before the save"; });
j(8, "lib/billCustomer.ts", "…and the waiter-tablet route too", "the same order of checks", () => { const t = read("app/api/tablet/[...path]/route.ts"); const s = t.indexOf("saveBillCustomer(sb, rid"); const o = t.lastIndexOf('.eq("restaurant_id", rid)', s); return (s > 0 && o > 0 && s - o < 1500) || "no ownership check"; });
j(9, "lib/billCustomer.ts", "the save sends only the session's restaurant and the cleaned phone + name — nothing the body names", "rpc arguments in lib/billCustomer.ts", () => /p_restaurant_id: rid,\s*p_session: sessionId,\s*p_phone: phone,\s*p_name: name,/.test(read("lib/billCustomer.ts")) || "changed");
j(10, "public/panels/billcustomer.js", "both customer searches are scoped to the login's restaurant, with a capped answer", "editor + tablet customer-search", () => [read("app/api/editor/[...path]/route.ts"), read("app/api/tablet/[...path]/route.ts")].every((t) => /lfh_customer_phone_search", \{ p_restaurant_id: rid/.test(t)) || "unscoped");
j(11, "lib/printDocs.ts", "every read inside the paper builders is scoped to the restaurant asked for", "each .from() in printDocs.ts", () => { const t = read("lib/printDocs.ts"); const reads = [...t.matchAll(/sb\.from\("([a-z_]+)"\)\.select\([^)]*\)([^;]*?)(?:\.maybeSingle\(\)|\.limit\(\d+\))/g)]; const bad = reads.filter((m) => !(m[1] === "restaurants" ? /\.eq\("id", rid\)/.test(m[2]) : /\.eq\("restaurant_id", rid\)/.test(m[2]))); return (reads.length >= 14 && bad.length === 0) || `unscoped: ${bad.map((m) => m[1]).join(",")}`; });
j(12, "lib/printDocs.ts", "the print helper's route passes the helper's OWN restaurant to every builder", "first argument of each builder call", () => { const t = read("app/api/print-agent/[...path]/route.ts"); const calls = [...t.matchAll(/(kotHtmlForOrder|billHtmlForSession|banquetHtmlForBill|sampleHtmlFor|kotHtmlForAggregator)\(([^,]+),/g)]; return (calls.length >= 5 && calls.every((m) => m[2].trim() === "agent.restaurant_id")) || "a builder is handed another restaurant"; });
j(13, "lib/billPreview.ts", "the preview route draws only the restaurant named — a garbled id is refused", "isUuid in the route", () => /isUuid/.test(read("app/api/admin/restaurants/bill-preview/route.ts")) || "no id check");
j(14, "lib/printBoard.ts", "the board's two callers each hand it the restaurant their own login decides (manager: the session's; admin: the one the admin opened, after tokenIsValid)", "printBoardState(rid…) in both routes; nothing else imports it", () => { const e = read("app/api/editor/[...path]/route.ts"), a = read("app/api/admin/printing/[...path]/route.ts"), o = read("app/api/owner/printing/route.ts"); return (/printBoardState\(rid, \{ deviceId: dv \}\)/.test(e) && /printBoardState\(rid, \{ recent: 12 \}\)/.test(a) && !/printBoardState/.test(o) && a.indexOf("tokenIsValid") < a.indexOf("printBoardState(rid")) || "a caller changed"; });
j(15, "public/panels/billdoc.js", "the paper never contains a server key, the access token or the admin password", "a real French House bill and a test print, compared with the keys (never printed)", db(async () => { const s = (await sql("select id from sessions where restaurant_id='00000000-0000-0000-0000-000000000001' and status='closed' and exists (select 1 from orders o where o.session_id=sessions.id and o.deleted_at is null) order by closed_at desc limit 1"))[0]; const docs = [s ? await PD.billHtmlForSession("00000000-0000-0000-0000-000000000001", s.id) : "", await PD.sampleBillHtml("00000000-0000-0000-0000-000000000001")].join(""); const keys = [env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_ACCESS_TOKEN, env.ADMIN_PASSWORD].filter((k) => k && k.length > 8); return (keys.length >= 2 && !keys.some((k) => docs.includes(k))) || "a secret is on the paper"; }));
j(16, "lib/tax.ts", "the guest menu learns only yes/no about GST registration, never the GSTIN", "lfh_guest_settings for French House", db(async () => { const g = (await sql("select lfh_guest_settings('00000000-0000-0000-0000-000000000001') g"))[0].g; return (typeof g.gst_registered === "boolean" && !("gstin" in g)) || "GSTIN exposed or flag missing"; }));
j(17, "lib/billCustomer.ts", "a customer's phone number is never written to the server log", "every console.error in billCustomer.ts", () => [...read("lib/billCustomer.ts").matchAll(/console\.error\(([^;]+)\);/g)].every((m) => !/phone|name\b/.test(m[1])) || "logs a phone");
j(18, "public/panels/billcustomer.js", "the sheet stores nothing on the device and logs nothing", "no localStorage / console", () => !/localStorage|sessionStorage|console\./.test(read("public/panels/billcustomer.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")) || "found");
j(19, "public/panels/billdoc.js", "the paper file makes no network request of its own", "no fetch / XHR", () => !/fetch\(|XMLHttpRequest/.test(read("public/panels/billdoc.js")) || "found");
j(20, "lib/printBoardWords.ts", "the words file is safe to ship to a browser — no imports, no addresses, no keys", "scan", () => !/^\s*import\s|https?:\/\/|sbp_|service_role/m.test(read("lib/printBoardWords.ts").replace(/\/\*[\s\S]*?\*\//g, "")) || "found");

// ── L · database grants ───────────────────────────────────────────────────────────────────────────
const l = sec(214540);
const FNS = [
  ["lfh_effective_tax_rate", true], ["lfh_guest_settings", true], ["lfh_banquet_tax_rate", false], ["lfh_generate_invoice", false],
  ["lfh_next_seq", false], ["lfh_next_counter", false], ["lfh_bill_customer_save", false], ["lfh_customer_phone_search", false],
  ["lfh_loyalty_state", false], ["lfh_business_day", null], ["lfh_phone10", null],
];
FNS.forEach(([fn, browser], k) => l(k + 1, "docs/NUMBERING.md", `${fn}: ${browser === true ? "callable by the guest menu's public key, as designed" : browser === false ? "callable by the server only, never by a browser's key" : "carries no money or personal data — its grant is recorded"}`, "has_function_privilege for anon / authenticated / service_role", db(async () => {
  const r = await sql(`select bool_or(has_function_privilege('anon',p.oid,'execute')) a, bool_or(has_function_privilege('authenticated',p.oid,'execute')) u, bool_or(has_function_privilege('service_role',p.oid,'execute')) s from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname='${fn}'`);
  const x = r[0]; if (x.s === null) return { skip: "no such function" };
  if (browser === null) return { ok: true, note: `anon=${x.a} auth=${x.u}` };
  return (x.s === true && x.a === browser && x.u === browser) || `anon=${x.a} auth=${x.u} service=${x.s}`;
})));
const TBL = [["deletion_audit", "delete"], ["invoice_events", "update"], ["sessions", "update"], ["orders", "delete"], ["print_jobs", "insert"], ["seq_counters", "update"], ["loyalty_config", "update"], ["customers", "select"], ["settings", "update"]];
TBL.forEach(([t, priv], k) => l(12 + k, "docs/NUMBERING.md", `${t}: a browser's key cannot ${priv} it`, `has_table_privilege anon + authenticated '${priv}'`, db(async () => { const r = await sql(`select to_regclass('public.${t}') is not null e, case when to_regclass('public.${t}') is null then null else has_table_privilege('anon','public.${t}','${priv}') or has_table_privilege('authenticated','public.${t}','${priv}') end p`); if (!r[0].e) return { skip: "no such table" }; return r[0].p === false || `a browser key may ${priv} ${t}`; })));
