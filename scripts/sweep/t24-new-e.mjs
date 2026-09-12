// t24-new-e.mjs — sweep #8 T24, block E: the day-close sheet (Z-report) and the monthly GST
// filing — the two documents a manager signs and an inspector reads.
import { check, nid, F } from "./t24-run.mjs";

const { src, endpointBlock, live, needLive, J, panel, sql, FRENCH_HOUSE } = F;
const code = (t) => t.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const Z = code(endpointBlock("zreport"));
const G = code(endpointBlock("gst-report"));
const PANEL = code(panel);
const count = (t, re) => (t.match(re) || []).length;


// ── the Z-report ───────────────────────────────────────────────────────────────────────────────
check(nid(), "the day-close sheet needs the Dashboard permission", "read GET /zreport", () => /managerCan\(g, rid, "view_dashboard"\)/.test(Z));
check(nid(), "the day is the RESTAURANT's business day (05:00 IST), not midnight", "read GET /zreport", () => /const since = businessDayStartIso\(\)/.test(Z));
check(nid(), "the day's orders are PAGED, so a busy day is not silently truncated at ~1000 rows", "read GET /zreport",
  () => /\.range\(from, from \+ 999\)/.test(Z) && /if \(page\.length === 0\) break;/.test(Z));
check(nid(), "…advancing by the rows actually returned, so a smaller server cap cannot undercount", "read GET /zreport",
  () => /from \+= page\.length;/.test(Z));
check(nid(), "…with a hard loop cap as a safety belt", "read GET /zreport", () => /guard < 500/.test(Z));
check(nid(), "the takings read does NOT filter deleted bills — a delete may never shrink the day", "read GET /zreport",
  () => !/deleted_at/.test(Z.slice(0, Z.indexOf("const [invQ"))));
check(nid(), "…and payment_method is ASKED for, because the code below reads it four times", "read GET /zreport",
  () => /select\("id,session_id,subtotal,taxable_base,nontax_amount,mrp_amount,tax_rate,discount,status,payment_status,tip,payment_method"\)/.test(Z));
check(nid(), "orders are grouped into BILLS by session, so tax matches the printed receipt to the penny", "read GET /zreport",
  () => /const key = o\.session_id \|\| \("solo:" \+ o\.id\)/.test(Z));
check(nid(), "cancellations are reported by VALUE, not merely counted", "read GET /zreport", () => /cancelledNet \+=/.test(Z));
check(nid(), "…and a cancelled order is kept out of the money groups", "read GET /zreport", () => /if \(o\.status === "cancelled"\)[\s\S]{0,200}?continue;/.test(Z));
check(nid(), "the taxable figure is the taxable BASE, never the whole subtotal", "read GET /zreport",
  () => /o\.taxable_base == null \? \(Number\(o\.subtotal\) \|\| 0\) : \(Number\(o\.taxable_base\) \|\| 0\)/.test(Z));
check(nid(), "…MRP / nil-rated turnover gets its own line, so the day still adds up", "read GET /zreport", () => /mrp: r2\(mrp\)/.test(Z));
check(nid(), "each bill's tax comes from billTaxOf — the one definition shared with the paper", "read GET /zreport",
  () => /const \{ disc: d, taxable: tx, tax: t \} = billTaxOf\(g, rate\)/.test(Z));
check(nid(), "…and the till list uses the SAME rule, so 'how the money came in' cannot total differently", "read GET /zreport",
  () => /const \{ disc: d2, tax: t2 \} = billTaxOf\(g, rate\)/.test(Z));
check(nid(), "ON THE HOUSE is not money in the till — it has its own line", "read GET /zreport",
  () => /if \(g\.some\(\(o\) => o\.payment_method === ON_THE_HOUSE_METHOD\)\) \{ onHouseCount\+\+/.test(Z));
check(nid(), "a bill counts as collected only when EVERY order on it is paid", "read GET /zreport",
  () => /g\.every\(\(o\) => o\.payment_status === "paid"\)/.test(Z));
check(nid(), "a bill settled in PARTS is spoken for by its legs, never counted twice", "read GET /zreport",
  () => /if \(method === "Split"\) continue;/.test(Z));
check(nid(), "a REVERSED payment leg is excluded from what was collected, and reported on its own line", "read GET /zreport",
  () => /if \(l\.reversed_at\) \{ reversedNet = r2\(reversedNet \+ amt\); reversedCount \+= 1; continue; \}/.test(Z));
check(nid(), "a leg on a table that is STILL SITTING is set aside, not counted as today's takings", "read GET /zreport",
  () => /if \(l\.session_id && openSessions\.has\(String\(l\.session_id\)\)\)/.test(Z));
check(nid(), "…and the test is the SESSION, not payment_status — a tab-settled bill's cash really was collected", "read GET /zreport",
  () => /is\("closed_at", null\)/.test(Z) && !/openSessions[\s\S]{0,300}payment_status/.test(Z));
check(nid(), "…and that money is still reported, on its own line, so the drawer reconciles", "read GET /zreport",
  () => /aside: r2\(asideNet\), asideCount/.test(Z));
check(nid(), "…and the manager's screen actually prints that line", "read the panel", () => /z\.payments\.aside > 0 \?/.test(PANEL));
check(nid(), "platform revenue excludes cancelled AND still-unaccepted tickets, like the dashboard", "read GET /zreport",
  () => /p2\.status !== "cancelled" && p2\.status !== "new"/.test(Z));
check(nid(), "tips are reported separately and never counted as revenue or taxed", "read GET /zreport", () => /const tips = r2\(orders\.filter/.test(Z));
check(nid(), "the range of bill numbers issued today comes from the COUNTER, never guessed from what we can see", "read GET /zreport",
  () => /from\("daily_counters"\)\.select\("n"\)\.eq\("restaurant_id", rid\)\.eq\("key", "bill"\)/.test(Z));
check(nid(), "…keyed exactly the way the business day is keyed", "read GET /zreport", () => /\.eq\("day", businessDayDate\(\)\)/.test(Z));
check(nid(), "…and parcel / delivery numbers are part of the SAME series, so they are not reported as gaps", "read GET /zreport",
  () => /from\("aggregator_orders"\)\.select\("bill_no,invoice_no,status,created_at,source"\)/.test(Z));
check(nid(), "…and `source` is the column that names the channel — there is no `channel` column", "read GET /zreport", () => !/"channel"/.test(Z));
check(nid(), "a session counts as today's if TODAY'S orders belong to it OR it was created today — the union", "read GET /zreport",
  () => /const \[byOrderQ, byDayQ\] = await Promise\.all\(\[/.test(Z) && /numById\.set\(r\.id, r\)/.test(Z));
check(nid(), "…which is what catches a table opened last night whose first order lands this morning", "read GET /zreport",
  () => /\.in\("id", daysSessionIds\)\.not\("bill_no", "is", null\)/.test(Z));
check(nid(), "only the states a person would ask about are flagged — an ordinary settled bill is not listed", "read GET /zreport",
  () => /if \(why\) numbered\.push/.test(Z));
check(nid(), "…and the reasons are deleted / cancelled / invoice voided, in that order of precedence", "read GET /zreport",
  () => /s\.deleted_at \? `deleted/.test(Z) && /"cancelled"/.test(Z) && /"invoice voided, number retired"/.test(Z));
check(nid(), "a bill whose every order was cancelled still shows its number", "read GET /zreport",
  () => /own\.length > 0 && own\.every\(\(o: any\) => o\.status === "cancelled"\)/.test(Z));
check(nid(), "the unaccounted list is stated as a COUNT plus the numbers, never as an accusation about money", "read GET /zreport",
  () => /unaccountedTotal: unaccounted\.length/.test(Z) && /unaccounted: unaccounted\.slice\(0, 200\)/.test(Z));
check(nid(), "the ledger verification is BEST-EFFORT — it can never fail the day-close", "read GET /zreport",
  () => /catch \{ return \{ ok: false, error: "could not be checked" \}; \}/.test(Z));
check(nid(), "…and a recorded, permitted act is a NOTE, not a problem — the sheet must not cry wolf", "read GET /zreport",
  () => /const REAL = new Set\(\["row_rewritten", "chain_broken", "bill_changed"\]\)/.test(Z));
check(nid(), "…with neither list dropped", "read GET /zreport", () => /problems: problems\.slice\(0, 20\), notes: notes\.slice\(0, 20\)/.test(Z));
check(nid(), "the GRAND TOTAL is money actually collected — paid bills only, plus platform", "read GET /zreport",
  () => /grandTotal: r2\(paidNet \+ platRevenue\)/.test(Z));
check(nid(), "every read on this endpoint says WHICH restaurant it is for", "read GET /zreport, statement by statement",
  () => { const st = F.chains(Z);
    const bad = st.filter((c) => !/restaurant_id/.test(c.flat) && !/\.in\("id", daysSessionIds\)/.test(c.flat));
    return { ok: bad.length === 0, note: bad.length ? bad.map((b) => b.flat.slice(0, 60)).join(" | ") : `${st.length} statements, all scoped` }; });
check(nid(), "the day-close answers live, with all six sections a manager reads", "driven live",
  () => needLive("zreport") || (live("zreport").status !== 200 ? { ok: live("zreport").status === 403, note: "refused, honestly" }
    : ["numbering", "dineIn", "payments", "platform", "chain"].every((k) => J("zreport")[k] != null)));
check(nid(), "…no figure on it reads as NaN", "driven live, every number in the payload read",
  () => { if (!live("zreport") || live("zreport").status !== 200) return "skip: no day-close answer";
    const bad = []; const walk = (o, p) => { for (const [k, v] of Object.entries(o || {})) {
      if (typeof v === "number" && !Number.isFinite(v)) bad.push(`${p}${k}`);
      else if (v && typeof v === "object") walk(v, `${p}${k}.`); } };
    walk(J("zreport"), ""); return { ok: bad.length === 0, note: bad.join(", ") }; });
check(nid(), "…the till list totals what it says it totals", "driven live, the arithmetic redone",
  () => { if (!live("zreport") || live("zreport").status !== 200) return "skip: no day-close answer";
    const p = J("zreport").payments; const sum = Math.round(p.rows.reduce((a, r) => a + r.amount, 0) * 100) / 100;
    return { ok: Math.abs(sum - p.total) < 0.011, note: `rows ${sum} vs total ${p.total}` }; });
check(nid(), "…and the day's own identity holds: taxable + tax + MRP = net", "driven live, the arithmetic redone",
  () => { if (!live("zreport") || live("zreport").status !== 200) return "skip: no day-close answer";
    const d = J("zreport").dineIn; const lhs = Math.round((d.taxable + d.tax + d.mrp) * 100) / 100;
    return { ok: Math.abs(lhs - d.net) < 0.05, note: `taxable+tax+mrp ${lhs} vs net ${d.net}` }; });
check(nid(), "…and gross − discount = taxable + MRP", "driven live, the arithmetic redone",
  () => { if (!live("zreport") || live("zreport").status !== 200) return "skip: no day-close answer";
    const d = J("zreport").dineIn; const lhs = Math.round((d.gross - d.discount) * 100) / 100;
    const rhs = Math.round((d.taxable + d.mrp) * 100) / 100;
    return { ok: Math.abs(lhs - rhs) < 0.05, note: `gross−disc ${lhs} vs taxable+mrp ${rhs}` }; });
check(nid(), "…and paid + unpaid + on-the-house bills = the number of bills the day had", "driven live, the arithmetic redone",
  () => { if (!live("zreport") || live("zreport").status !== 200) return "skip: no day-close answer";
    const d = J("zreport").dineIn;
    return { ok: d.paidCount + d.unpaidCount + d.onHouseCount === d.bills, note: `${d.paidCount}+${d.unpaidCount}+${d.onHouseCount} vs ${d.bills}` }; });
check(nid(), "…and no bill number in the range is on nothing at all", "driven live",
  () => { if (!live("zreport") || live("zreport").status !== 200) return "skip: no day-close answer";
    const n = J("zreport").numbering;
    return { ok: n.unaccountedTotal === 0, note: n.unaccountedTotal ? `${n.unaccountedTotal} numbers: ${n.unaccounted.slice(0, 8).join(", ")}` : `${n.issued} issued, all accounted for` }; });
check(nid(), "…and the signed bill ledger comes back verified", "driven live",
  () => { if (!live("zreport") || live("zreport").status !== 200) return "skip: no day-close answer";
    const c = J("zreport").chain;
    return { ok: c.ok === true, note: c.error || (c.problems || []).map((p) => p.kind).join(", ") }; });

// ── the monthly GST filing ─────────────────────────────────────────────────────────────────────
check(nid(), "the filing needs the Dashboard permission", "read GET /gst-report", () => /managerCan\(g, rid, "view_dashboard"\)/.test(G));
check(nid(), "the month is a CALENDAR month anchored to IST, because that is how GST is filed", "read GET /gst-report",
  () => /new Date\(`\$\{monthStr\}-01T00:00:00\+05:30`\)/.test(G));
check(nid(), "…a rubbish ?month= falls back to this month rather than erroring", "read GET /gst-report",
  () => /\/\^\\d\{4\}-\\d\{2\}\$\/\.test\(sp\.get\("month"\) \|\| ""\)/.test(G));
check(nid(), "…driven with ?month=banana it still answers this month", "driven live",
  () => needLive("gstBad") || ({ ok: live("gstBad").status === 200 && /^\d{4}-\d{2}$/.test(J("gstBad").month || ""), note: `status ${live("gstBad").status}` }));
check(nid(), "…December rolls into January of the next year, not month 13", "run the route's own expression over December",
  () => { const y = 2026, m = 12; const end = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01T00:00:00+05:30`;
    return end === "2027-01-01T00:00:00+05:30"; });
check(nid(), "paid, non-cancelled dine-in bills only — aggregator sales are somebody else's filing", "read GET /gst-report",
  () => /\.eq\("payment_status", "paid"\)\.neq\("status", "cancelled"\)/.test(G) && !/aggregator_orders/.test(G));
check(nid(), "the month is PAGED, so a busy month is not truncated", "read GET /gst-report", () => /\.range\(from, from \+ 999\)/.test(G));
check(nid(), "the taxable value is the taxable BASE, so no output tax is declared on MRP turnover", "read GET /gst-report",
  () => /b\.base \+= o\.taxable_base == null \? \(Number\(o\.subtotal\) \|\| 0\) : \(Number\(o\.taxable_base\) \|\| 0\)/.test(G));
check(nid(), "…and MRP / nil-rated turnover is reported on its own row", "read GET /gst-report", () => /mrp: r2\(mrp\)/.test(G));
check(nid(), "the discount is capped by the same rule as every discount door — inside billTaxOf, at each order's own rate", "read GET /gst-report",
  () => /billTaxOf\(b\.rows, rate\)/.test(G) && !/b\.cap \+= discountBaseOf/.test(G));
check(nid(), "CGST/SGST are split from the ACTUAL rounded total, so the parts sum to the tax exactly", "read GET /gst-report",
  () => /const amount = compRateSum > 0 && i < comps\.length - 1 \? r2\(taxR2 \* \(c\.rate \/ compRateSum\)\) : r2\(taxR2 - compAllocated\)/.test(G));
check(nid(), "…so a filing document can never be off by a few paise on its own split", "run the route's own allocation over a 5% split",
  () => { const taxR2 = 100.03, comps = [{ rate: 0.025 }, { rate: 0.025 }];
    const sum = comps.reduce((s, c) => s + c.rate, 0); let alloc = 0;
    const out = comps.map((c, i) => { const a = i < comps.length - 1 ? Math.round(taxR2 * (c.rate / sum) * 100) / 100 : Math.round((taxR2 - alloc) * 100) / 100; alloc += a; return a; });
    return Math.abs(out.reduce((a, b) => a + b, 0) - taxR2) < 0.0001; });
check(nid(), "THE RATE EACH ORDER WAS CHARGED AT decides its tax here too — not one rate borrowed from settings",
  "read GET /gst-report beside the Z-report, which was fixed for exactly this in 2026-08-11",
  () => ({ ok: /BILLDOC\.orderTaxRate|billTaxOf|rateOf\(/.test(G),
           note: /select\("[^"]*tax_rate/.test(G) && !/orderTaxRate|billTaxOf|rateOf\(/.test(G)
             ? "tax_rate is selected and never read; every bill is taxed at the settings rate" : "" }));
check(nid(), "…and the discount cap is worked out at that same per-order rate", "read GET /gst-report",
  // billTaxOf caps inside itself, at each order's own rate. What must NOT be here is a second copy
  // capping at the settings rate.
  () => ({ ok: !/discountBaseOf\(o, rate\)/.test(G), note: /discountBaseOf\(o, rate\)/.test(G) ? "capped at the settings rate instead" : "capped inside billTaxOf, per rate" }));
check(nid(), "the filing answers live with its totals, its per-day rows and its components", "driven live",
  () => needLive("gst") || (live("gst").status !== 200 ? { ok: live("gst").status === 403, note: "refused, honestly" }
    : (J("gst").totals && Array.isArray(J("gst").days) && Array.isArray(J("gst").components))));
check(nid(), "…and the month foots: taxable + tax + MRP = gross", "driven live, the arithmetic redone",
  () => { if (!live("gst") || live("gst").status !== 200) return "skip: no filing answer";
    const t = J("gst").totals; const lhs = Math.round((t.taxable + t.tax + t.mrp) * 100) / 100;
    return { ok: Math.abs(lhs - t.gross) < 0.05, note: `taxable+tax+mrp ${lhs} vs gross ${t.gross}` }; });
check(nid(), "…and the components add back to the tax shown", "driven live, the arithmetic redone",
  () => { if (!live("gst") || live("gst").status !== 200) return "skip: no filing answer";
    const j = J("gst"); if (!j.components.length) return { ok: true, note: "this restaurant declares no components" };
    const sum = Math.round(j.components.reduce((a, c) => a + c.amount, 0) * 100) / 100;
    return { ok: Math.abs(sum - j.totals.tax) < 0.011, note: `components ${sum} vs tax ${j.totals.tax}` }; });
check(nid(), "…and the day rows add back to the month", "driven live, the arithmetic redone",
  () => { if (!live("gst") || live("gst").status !== 200) return "skip: no filing answer";
    const j = J("gst"); const s = Math.round(j.days.reduce((a, d) => a + d.gross, 0) * 100) / 100;
    return { ok: Math.abs(s - j.totals.gross) < 0.5, note: `days ${s} vs month ${j.totals.gross}` }; });
check(nid(), "…and the note says out loud what the filing does and does not include", "driven live",
  () => needLive("gst") || (typeof J("gst").note === "string" && /Paid dine-in bills only/.test(J("gst").note)));
check(nid(), "the filing the SCREEN gets agrees with the month re-computed at each order's own rate", "drive GET /gst-report for a month that carries more than one rate, then redo it in SQL",
  async () => {
    // The month picked is the one this restaurant's rows actually mix rates in — otherwise the
    // check passes over the very fault it exists for (this terminal's first version did).
    const pick = await sql(`SELECT to_char(o.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS mon,
             count(DISTINCT coalesce(o.tax_rate, -1))::int AS rates
        FROM orders o WHERE o.restaurant_id = '${FRENCH_HOUSE}' AND o.payment_status = 'paid' AND o.status <> 'cancelled'
       GROUP BY 1 HAVING count(DISTINCT coalesce(o.tax_rate, -1)) > 1 ORDER BY 1 DESC LIMIT 1`);
    if (!pick.length) return "skip: no month on this restaurant carries more than one rate";
    const mon = pick[0].mon;
    const r = await F.api(`/gst-report?month=${mon}`);
    if (r.status !== 200) return { ok: false, note: `the filing answered ${r.status}` };
    const want = await sql(`
      WITH o AS (
        SELECT coalesce(o.session_id::text, 'solo:' || o.id::text) AS bill,
               coalesce(o.tax_rate, (SELECT lfh_effective_tax_rate('${FRENCH_HOUSE}'))) AS own_rate,
               coalesce(o.taxable_base, o.subtotal, 0) AS base, coalesce(o.discount, 0) AS disc
          FROM orders o
         WHERE o.restaurant_id = '${FRENCH_HOUSE}' AND o.payment_status = 'paid' AND o.status <> 'cancelled'
           AND to_char(o.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') = '${mon}'),
      per_rate AS (SELECT bill, own_rate, sum(base) AS base, sum(disc) AS disc FROM o GROUP BY 1,2)
      SELECT round(sum(round(greatest(base - least(disc, base), 0) * own_rate, 2)), 2) AS tax FROM per_rate`);
    const got = Number(r.json.totals.tax), expect = Number(want[0].tax);
    return { ok: Math.abs(got - expect) < 1.0,
             note: `${mon}: the filing says \u20b9${got}, each order's own rate says \u20b9${expect}` };
  });
check(nid(), "…and at least one month really does carry more than one rate, or the check above proves nothing", "the same statement, reading the rate count",
  async () => {
    const r = await sql(`SELECT count(DISTINCT coalesce(tax_rate, -1))::int AS n FROM orders
      WHERE restaurant_id = '${FRENCH_HOUSE}' AND payment_status = 'paid' AND status <> 'cancelled'`);
    return { ok: Number(r[0].n) > 1, note: `${r[0].n} distinct rates across this restaurant's paid bills` };
  });
