// Round 2 · bank B — THE REAL DATABASE (P214101–P214160). SELECTs only, dev project only. Fifteen named
// restaurants (a fixed list, so ids never move) × four questions.
import { sec, imp, sql, read, NO_DB } from "../t14s10/lib.mjs";

const env = Object.fromEntries(read(".env.local").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
const { refuseUnlessDevTestDb } = await imp("scripts/sweep/devStacks.mjs");
refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "sweep #10 T14 round 2 bank B (read-only)");
process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const B = (await imp("public/panels/billdoc.js")).default;
const TAX = await imp("lib/tax.ts");
const PD = await imp("lib/printDocs.ts");
const b = sec(214100);
const SLUGS = ["french-house", "aangan-garden-restaurant", "pizza-palace", "saffron-street", "copper-kettle", "aevidine", "green-bowl", "empty-cafe-zz", "demo-bistro", "burger-barn", "spice-route", "sakura-sushi", "taco-fiesta", "og-s-cafe", "hi"];
const rows = NO_DB ? [] : await sql(`select r.slug, r.id, s.tax_rate, s.tax_components, s.price_tax_mode, s.gstin, s.banquet_tax_components,
  lfh_effective_tax_rate(r.id)::text db_rate, lfh_banquet_tax_rate(r.id)::text db_bq, lfh_guest_settings(r.id) guest
  from restaurants r join settings s on s.restaurant_id = r.id where r.slug in (${SLUGS.map((x) => `'${x}'`).join(",")})`);
const by = Object.fromEntries(rows.map((r) => [r.slug, r]));
const db = (fn) => async () => (NO_DB ? { skip: "--no-db" } : fn());
let n = 1;
for (const slug of SLUGS) {
  const F1 = "lib/tax.ts", F2 = "public/panels/billdoc.js", F3 = "lib/printDocs.ts";
  const st = () => { const r = by[slug]; return { tax_rate: r.tax_rate == null ? null : Number(r.tax_rate), tax_components: r.tax_components, price_tax_mode: r.price_tax_mode, gstin: r.gstin }; };
  b(n++, F1, `${slug}: the database's rate (lfh_effective_tax_rate) = the code's (effectiveTaxRate), GSTIN rule included`, "SQL vs lib/tax.ts on its own settings row", db(() => { const r = by[slug]; if (!r) return { skip: "no such restaurant" }; const app = TAX.effectiveTaxRate(st()); return Math.abs(app - Number(r.db_rate)) < 1e-12 || `app ${app} vs db ${r.db_rate}`; }));
  b(n++, F2, `${slug}: the banquet rate in the database (lfh_banquet_tax_rate) = the bill file's (bqTaxModel)`, "SQL vs billdoc.js", db(() => { const r = by[slug]; if (!r) return { skip: "no such restaurant" }; const app = B.bqTaxModel({ ...st(), banquet_tax_components: r.banquet_tax_components }).rate; return Math.abs(app - Number(r.db_bq)) < 1e-9 || `app ${app} vs db ${r.db_bq}`; }));
  b(n++, F3, `${slug}: on 40 of its real orders printed as bills (1–3 orders each, the panels' path), every TOTAL = the database's own figure`, "billData → billDocHtml on real rows vs SUM(net_amount); plus the print computer's path on its newest closed bills", db(async () => {
    const r = by[slug]; if (!r) return { skip: "no such restaurant" };
    const full = (await sql(`select to_jsonb(s) j from settings s where restaurant_id='${r.id}'`))[0]?.j || {};
    const os = await sql(`select id, status, subtotal, taxable_base, nontax_amount, mrp_amount, discount, tax_rate, items, tip, deleted_at, net_amount from orders where restaurant_id='${r.id}' and deleted_at is null and status<>'cancelled' order by created_at desc limit 40`);
    if (!os.length) return { skip: "no live order at all" };
    const bad = []; let bills = 0;
    for (let i = 0; i < os.length; ) {
      const k = 1 + (i % 3); const grp = os.slice(i, i + k); i += k; bills++;
      const h = B.billDocHtml(B.billData({ orders: grp, settings: full }));
      const shown = Number(((h.match(/TOTAL<\/span><span>₹([\d,]+)</) || [])[1] || "NaN").replace(/,/g, ""));
      const dbt = Math.round(grp.reduce((t, o) => t + Number(o.net_amount || 0), 0));
      if (shown !== dbt) bad.push(`[${grp.map((o) => o.id.slice(0, 6)).join(",")}] paper ₹${shown} db ₹${dbt}`);
    }
    // …and where it has closed table bills, the print computer's own builder on the newest ten
    const ss = await sql(`select s.id from sessions s where s.restaurant_id='${r.id}' and s.status='closed' and exists (select 1 from orders o where o.session_id=s.id and o.deleted_at is null and o.status<>'cancelled') order by s.closed_at desc nulls last limit 10`);
    for (const { id } of ss) {
      const h = await PD.billHtmlForSession(r.id, id);
      const shown = Number(((h || "").match(/TOTAL<\/span><span>₹([\d,]+)</) || [])[1]?.replace(/,/g, ""));
      const dbt = (await sql(`select round(coalesce(sum(net_amount),0))::int t from orders where session_id='${id}' and deleted_at is null and status<>'cancelled'`))[0].t;
      if (shown !== dbt) bad.push(`session ${id.slice(0, 8)} paper ₹${shown} db ₹${dbt}`);
    }
    return bad.length === 0 ? { ok: true, note: `${bills} bills from real orders + ${ss.length} print-computer bills, paper = database` } : bad.slice(0, 3).join(" · ");
  }));
  b(n++, "docs/NUMBERING.md", `${slug}: the guest menu is told whether it may charge GST — and never sees the GSTIN itself`, "lfh_guest_settings payload", db(() => { const r = by[slug]; if (!r) return { skip: "no such restaurant" }; const g = r.guest || {}; return (g.gst_registered === !!String(r.gstin || "").trim() && !("gstin" in g)) || `gst_registered ${g.gst_registered}, gstin exposed: ${"gstin" in g}`; }));
}
