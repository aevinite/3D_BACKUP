// BLOCK D · app/api/owner/reports/route.ts — 55 phases, P160701–P160755.
//
// WHY ONLY 55 FOR THE SECOND-BIGGEST FILE. It already carries 202 ledger rows — by far the most in
// this territory — but 182 of those are ONE generated matrix: seventeen report types crossed with
// ten ranges, each asking "does it answer, and does it label its own range". That matrix is
// re-run every sweep and it is green. What it has never touched is everything INSIDE those answers:
// the tax split's arithmetic, the day sheet's business-day edge, the inventory and staff-pay
// branches, the list caps, and the `partial` naming. That is where these 55 go.
import { FH, PP, GET, sb, undo, block, of_, code, read , sameStamp } from "./harness.mjs";

const S = of_("app/api/owner/reports/route.ts");
export const D = block(160701, "D · the owner's Reports — inside the answers the matrix never opened");
const { row } = D;
const IST = 5.5 * 3600e3;
const istParts = (iso) => { const d = new Date(Date.parse(iso) + IST); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours() }; };
const today = () => new Date(Date.now() + IST).toISOString().slice(0, 10);

// ── THE FIXTURE CAN CHANGE UNDER YOU, SO READ THE STATE YOU DEPEND ON ───────────────────────────
// Forty terminals share this database. Halfway through this block, French House's `price_tax_mode`
// became "composition" (its `tax_label` reads "T27R2b", so another round-2 set it), and five tax
// checks started reporting "split 0 vs total 814992.35" — which looks exactly like a GST table of
// zeroes beside real money, and is the OPPOSITE: on the composition scheme the restaurant cannot
// legally pass GST to the diner, so 0% and NO tax lines is the only correct answer, and the route
// ships `composition: true` so the screen can say the true thing.
//
// So the split checks read the flag rather than assuming a rate. A check that assumes a fixture is
// a check that will one day call correct behaviour a fault.
const splitAddsUp = (j) => {
  if (!j?.tax) return "SKIP: no tax model for this restaurant";
  if (j.tax.composition) {
    // Composition: no lines at all, and nothing that implies taxable supplies.
    return j.tax.components.length === 0 && j.tax.effectivePct === 0
      ? true : `on the composition scheme, yet pct=${j.tax.effectivePct} with ${j.tax.components.length} line(s)`;
  }
  const sum = Math.round(j.tax.components.reduce((a, x) => a + x.amount, 0) * 100) / 100;
  return sum === Math.round(j.totals.tax * 100) / 100 ? true : `split ${sum} vs total ${j.totals.tax}`;
};

// ══ D1 · THE TAX SPLIT — it must add back to the merged figure, exactly ═════════════════════════
row(S("the tax split adds back to the tax total, to the paisa"), "GET ?type=sales&rid=<FH>, sum the components", async (c) => {
  const r = await GET(c.O, `/api/owner/reports?type=sales&range=30d&rid=${FH}`);
  if (r.status !== 200) return `${r.status} ${r.j?.error}`;
  return splitAddsUp(r.j);
});
for (const rg of ["today", "7d", "month", "lastmonth", "fy"]) {
  row(S(`…and at \`range=${rg}\` too, because rounding each line apart drifts by a paisa`), `GET ?type=tax&range=${rg}&rid=<FH>`, async (c) => {
    const r = await GET(c.O, `/api/owner/reports?type=tax&range=${rg}&rid=${FH}`);
    if (r.status !== 200) return `${r.status} ${r.j?.error}`;
    return splitAddsUp(r.j);
  });
}
row(S("the split is offered for ONE restaurant only — tax settings are per restaurant and cannot be merged"), "GET ?type=tax with no rid", async (c) => {
  const r = await GET(c.A, "/api/owner/reports?type=tax&range=30d&scope=all");
  return r.j.tax === null || `an all-restaurants scope answered a tax split: ${JSON.stringify(r.j.tax).slice(0, 110)}`;
});
row(S("a restaurant on the composition scheme is told it has no tax lines, not shown a table of zeroes"), "read the composition flag's effect", async (c) => {
  const r = await GET(c.O, `/api/owner/reports?type=tax&range=30d&rid=${FH}`);
  if (!r.j.tax) return "SKIP: no tax model for this restaurant";
  if (r.j.tax.composition) return r.j.tax.components.length === 0 || `composition, yet ${r.j.tax.components.length} component(s)`;
  return r.j.tax.components.length > 0 || "not composition, yet no components at all";
});
row(S("…and whether the restaurant has NAMED its own tax lines is answered separately from having them"), "read tax.configured", async (c) => {
  const r = await GET(c.O, `/api/owner/reports?type=tax&range=30d&rid=${FH}`);
  if (!r.j.tax) return "SKIP";
  return typeof r.j.tax.configured === "boolean" || `configured=${JSON.stringify(r.j.tax.configured)}`;
});
row(S("no component carries a negative or a NaN amount"), "read every component at four ranges", async (c) => {
  for (const rg of ["today", "30d", "fy", "all"]) {
    const r = await GET(c.O, `/api/owner/reports?type=tax&range=${rg}&rid=${FH}`);
    for (const x of (r.j.tax?.components || [])) {
      if (!Number.isFinite(x.amount) || x.amount < 0) return `range=${rg} ${x.label}=${x.amount}`;
    }
  }
  return true;
});

// ══ D2 · THE DAY SHEET AND ITS BUSINESS-DAY EDGE ════════════════════════════════════════════════
row(S("the day sheet is a 05:00-IST business day, not a calendar day"), "GET ?type=daysummary&range=day&date=<today IST>", async (c) => {
  const r = await GET(c.O, `/api/owner/reports?type=daysummary&range=day&date=${today()}&rid=${FH}`);
  if (r.status !== 200) return `${r.status} ${r.j?.error}`;
  const p = istParts(r.j.window.from);
  return !!(r.j.range === "day" && p.h === 5) || `range=${r.j.range} starts ${p.h}:00 IST`;
});
row(S("…and it agrees with what \"today\" means everywhere else"), "compare range=day&date=today with range=today", async (c) => {
  const d = await GET(c.O, `/api/owner/reports?type=daysummary&range=day&date=${today()}&rid=${FH}`);
  const t = await GET(c.O, `/api/owner/reports?type=sales&range=today&rid=${FH}`);
  return d.j.window.from === t.j.window.from || `day sheet starts ${d.j.window?.from}, "today" starts ${t.j.window?.from}`;
});
row(S("…and a past day sheet is a whole 24 hours, 05:00 to 05:00"), "GET a date a week ago", async (c) => {
  const d = new Date(Date.now() - 7 * 86400e3 + IST).toISOString().slice(0, 10);
  const r = await GET(c.O, `/api/owner/reports?type=daysummary&range=day&date=${d}&rid=${FH}`);
  const span = Date.parse(r.j.window.to) - Date.parse(r.j.window.from);
  return Math.abs(span - 86400e3) < 1000 || `it spans ${(span / 3600e3).toFixed(1)}h`;
});
row(S("a day sheet for a date that is not a date falls back to today, and says so"), "GET ?range=day&date=zzz", async (c) => {
  const r = await GET(c.O, `/api/owner/reports?type=daysummary&range=day&date=zzz&rid=${FH}`);
  const t = await GET(c.O, `/api/owner/reports?type=sales&range=today&rid=${FH}`);
  return !!(r.status === 200 && r.j.window.from === t.j.window.from) || `${r.status} ${r.j.window?.from}`;
});
row(S("…and a date in the future does not answer a window that has not happened"), "GET ?date=2099-01-01", async (c) => {
  const r = await GET(c.O, `/api/owner/reports?type=daysummary&range=day&date=2099-01-01&rid=${FH}`);
  return Date.parse(r.j.window.to) <= Date.now() + 60_000 || `it answered a window ending ${r.j.window.to}`;
});
row(S("the day sheet's settlement split is OMITTED when it could not be read, never shown as an empty table"), "read: payUnreadable answers undefined, not []", async () => {
  const src = code(read("app/api/owner/reports/route.ts"));
  return !!(/payUnreadable[\s\S]{0,200}\?\s*undefined/.test(src) && /partialKeys\.push\("payments"\)/.test(src))
    || "a failed settlement read no longer omits the block and names itself";
});
row(S("…and when it IS read, each row is a method with a real amount"), "GET the day sheet and read payments[]", async (c) => {
  const r = await GET(c.O, `/api/owner/reports?type=daysummary&range=day&date=${today()}&rid=${FH}`);
  for (const p of (r.j.payments || [])) {
    if (typeof p.method !== "string" || !Number.isFinite(p.revenue)) return JSON.stringify(p);
  }
  return true;
});
row(S("…sorted biggest first, so the main way money arrived is at the top"), "read the order of payments[]", async (c) => {
  const r = await GET(c.O, `/api/owner/reports?type=daysummary&range=day&date=${today()}&rid=${FH}`);
  const v = (r.j.payments || []).map((x) => x.revenue);
  return v.every((x, i) => i === 0 || v[i - 1] >= x) || `out of order: ${JSON.stringify(v)}`;
});
row(S("tips are kept OUT of revenue — they are the staff's, on top of the bill"), "read tips against totals", async (c) => {
  const r = await GET(c.O, `/api/owner/reports?type=daysummary&range=day&date=${today()}&rid=${FH}`);
  if (!r.j.tips) return true;                              // no tips line at all is the normal state
  const sum = Math.round((r.j.totals.subtotal + r.j.totals.tax - r.j.totals.discount) * 100) / 100;
  return Math.abs(sum - r.j.totals.revenue) < 0.05 || `revenue ${r.j.totals.revenue} vs subtotal+tax−discount ${sum} — a tip may have entered it`;
});
row(S("…and a restaurant that takes no tips shows no tips line at all, rather than a fake zero"), "read tips when there are none", async (c) => {
  const r = await GET(c.O, `/api/owner/reports?type=daysummary&range=day&date=${today()}&rid=${FH}`);
  return (r.j.tips === null || (r.j.tips && r.j.tips.collected > 0)) || `tips=${JSON.stringify(r.j.tips)}`;
});
row(S("the staff-pay line is absent for a restaurant without the module, rather than printing ₹0"), "read staffPay on the day sheet", async (c) => {
  const r = await GET(c.O, `/api/owner/reports?type=daysummary&range=day&date=${today()}&rid=${FH}`);
  const on = (await GET(c.O, "/api/owner/staff")).j.restaurants?.find((x) => x.id === FH)?.modules?.payroll;
  if (!on) return r.j.staffPay === null || `the module is off but staffPay=${JSON.stringify(r.j.staffPay)}`;
  return (r.j.staffPay === null || typeof r.j.staffPay.paidOut === "number") || JSON.stringify(r.j.staffPay);
});

// ══ D3 · THE MONEY ADDS UP ══════════════════════════════════════════════════════════════════════
row(S("the sales rows add up to the totals printed above them"), "sum rows[] against totals, four ranges", async (c) => {
  for (const rg of ["today", "7d", "30d", "month"]) {
    const r = await GET(c.O, `/api/owner/reports?type=sales&range=${rg}&rid=${FH}`);
    if (r.status !== 200) return `range=${rg} answered ${r.status}`;
    for (const k of ["subtotal", "tax", "discount", "revenue"]) {
      const sum = Math.round((r.j.rows || []).reduce((a, x) => a + (x[k] || 0), 0) * 100) / 100;
      if (Math.abs(sum - r.j.totals[k]) > 0.05) return `range=${rg} ${k}: rows ${sum} vs total ${r.j.totals[k]}`;
    }
  }
  return true;
});
row(S("…and so do the order counts"), "sum rows[].orders and paidOrders", async (c) => {
  for (const rg of ["today", "30d"]) {
    const r = await GET(c.O, `/api/owner/reports?type=sales&range=${rg}&rid=${FH}`);
    for (const k of ["orders", "paidOrders", "cancelledOrders"]) {
      const sum = (r.j.rows || []).reduce((a, x) => a + (x[k] || 0), 0);
      if (sum !== r.j.totals[k]) return `range=${rg} ${k}: rows ${sum} vs total ${r.j.totals[k]}`;
    }
  }
  return true;
});
row(S("paid orders are never more than all orders"), "read the totals", async (c) => {
  for (const rg of ["today", "30d", "fy"]) {
    const r = await GET(c.O, `/api/owner/reports?type=sales&range=${rg}&rid=${FH}`);
    if (r.j.totals.paidOrders > r.j.totals.orders) return `range=${rg}: paid ${r.j.totals.paidOrders} > all ${r.j.totals.orders}`;
  }
  return true;
});
row(S("a discount never exceeds the subtotal it came off"), "read the totals", async (c) => {
  for (const rg of ["today", "30d", "fy", "all"]) {
    const r = await GET(c.O, `/api/owner/reports?type=sales&range=${rg}&rid=${FH}`);
    if (r.j.totals.discount > r.j.totals.subtotal + 0.01) return `range=${rg}: discount ${r.j.totals.discount} > subtotal ${r.j.totals.subtotal}`;
  }
  return true;
});
row(S("cancelled money is reported apart from revenue, never inside it"), "compare cancellations against sales for one window", async (c) => {
  const s = await GET(c.O, `/api/owner/reports?type=sales&range=30d&rid=${FH}`);
  const x = await GET(c.O, `/api/owner/reports?type=cancellations&range=30d&rid=${FH}`);
  if (!s.j?.totals || !x.j?.totals) return `sales=${s.status}/${!!s.j?.totals} cancellations=${x.status}/${!!x.j?.totals}`;
  // Cancelled money is reported in its own column, so the revenue figure must be IDENTICAL in both.
  //
  // ── AND THIS DATABASE IS BEING TRADED ON WHILE THE SUITE RUNS ─────────────────────────────────
  // Forty terminals share it and one of them (`verify:live-rush`) places real orders. The two
  // reports are two separately-saved snapshots, so a full run can read one at minute 3 and the other
  // at minute 8 with real revenue arriving in between — which is how this first reported "the two
  // reports disagree on revenue: 242974.6 vs 241042.6" about two correct answers. Re-reading the
  // FIRST one tells a moving fixture apart from a real disagreement: if it has caught up, the gap
  // was trade; if the two still differ after both are current, they genuinely disagree.
  if (s.j.totals.revenue !== x.j.totals.revenue) {
    const again = await GET(c.O, `/api/owner/reports?type=sales&range=30d&rid=${FH}&refresh=1`);
    const x2 = await GET(c.O, `/api/owner/reports?type=cancellations&range=30d&rid=${FH}&refresh=1`);
    if (!again.j?.totals || !x2.j?.totals) return `re-read failed: ${again.status}/${x2.status}`;
    if (again.j.totals.revenue !== x2.j.totals.revenue) {
      return `both re-read fresh and they STILL disagree on revenue: ${again.j.totals.revenue} vs ${x2.j.totals.revenue}`;
    }
  }
  // …and the cancelled value must never have been counted as revenue.
  return x.j.totals.cancelledValue >= 0 || `cancelledValue=${x.j.totals.cancelledValue}`;
});
row(S("the payments report's money matches the sales report's revenue for the same window"), "compare type=payments with type=sales", async (c) => {
  const p = await GET(c.O, `/api/owner/reports?type=payments&range=30d&rid=${FH}`);
  const s = await GET(c.O, `/api/owner/reports?type=sales&range=30d&rid=${FH}`);
  if (!s.j?.totals || !Array.isArray(p.j?.rows)) return `payments=${p.status} sales=${s.status}`;
  const sum = Math.round((p.j.rows || []).reduce((a, x) => a + x.revenue, 0) * 100) / 100;
  const rev = Math.round(s.j.totals.revenue * 100) / 100;
  // The two need not be identical to the paisa — "Not recorded" is itself a method and the split is
  // paid-only — but money that ARRIVED can never exceed money EARNED, and the gap must be small.
  if (sum > rev + 0.05) return `the settlement split (${sum}) is MORE than the revenue it settles (${rev})`;
  return rev === 0 || (rev - sum) / rev < 0.05 || `the split accounts for only ${((sum / rev) * 100).toFixed(1)}% of revenue (${sum} of ${rev})`;
});
row(S("the by-restaurant leaderboard adds up to the same money for a one-restaurant owner"), "compare byrestaurant with sales", async (c) => {
  const b = await GET(c.O, "/api/owner/reports?type=byrestaurant&range=30d");
  const s = await GET(c.O, `/api/owner/reports?type=sales&range=30d&rid=${FH}`);
  if (!s.j?.totals || !Array.isArray(b.j?.rows)) return `leaderboard=${b.status} sales=${s.status}`;
  const sum = Math.round((b.j.rows || []).reduce((a, x) => a + x.revenue, 0) * 100) / 100;
  if (Math.abs(sum - s.j.totals.revenue) < 0.05) return true;
  // Two saved snapshots, minutes apart, on a database other terminals are trading on — re-read both
  // fresh before calling it a disagreement. (See the note on the cancellations check above.)
  const b2 = await GET(c.O, "/api/owner/reports?type=byrestaurant&range=30d&refresh=1");
  const s2 = await GET(c.O, `/api/owner/reports?type=sales&range=30d&rid=${FH}&refresh=1`);
  const sum2 = Math.round((b2.j?.rows || []).reduce((a, x) => a + x.revenue, 0) * 100) / 100;
  return Math.abs(sum2 - (s2.j?.totals?.revenue ?? NaN)) < 0.05
    || `both re-read fresh and they still differ: leaderboard ${sum2} vs sales ${s2.j?.totals?.revenue}`;
});
row(S("…and it is sorted biggest first"), "read the order", async (c) => {
  const r = await GET(c.A, "/api/owner/reports?type=byrestaurant&range=30d&scope=all");
  const v = (r.j.rows || []).map((x) => x.revenue);
  return v.every((x, i) => i === 0 || v[i - 1] >= x) || "out of order";
});
row(S("no report at any range or type carries a NaN"), "scan every type at three ranges", async (c) => {
  const types = ["sales", "tax", "discounts", "cancellations", "daysummary", "dishes", "categories", "hourly", "payments", "byrestaurant"];
  for (const t of types) for (const rg of ["today", "30d", "all"]) {
    const r = await GET(c.O, `/api/owner/reports?type=${t}&range=${rg}&rid=${FH}`);
    if (/:\s*(NaN|"NaN"|Infinity|null,"revenue")/.test(r.txt)) return `type=${t} range=${rg} carries a NaN`;
  }
  return true;
});

// ══ D4 · THE BRANCHES THE MATRIX NEVER OPENED ══════════════════════════════════════════════════
row(S("a report type nobody recognises is refused by name, not answered as sales"), "GET ?type=bogus", async (c) => {
  const r = await GET(c.O, "/api/owner/reports?type=bogus&range=30d");
  return !!(r.status === 400 && /unknown report type/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("…and so is one that only looks like a real type"), "GET ?type=Sales and ?type=sales%20", async (c) => {
  for (const t of ["Sales", "sales ", "sales;drop", "invstockX"]) {
    const r = await GET(c.O, `/api/owner/reports?type=${encodeURIComponent(t)}&range=30d`);
    if (r.status === 200) return `${JSON.stringify(t)} was answered`;
  }
  return true;
});
row(S("stock cannot be summed across kitchens, so an all-restaurants scope must pick one first"), "GET ?type=invstock with no rid, as the admin", async (c) => {
  const r = await GET(c.A, "/api/owner/reports?type=invstock&range=30d&scope=all");
  return !!(r.status === 400 && /pick one restaurant/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("…and a restaurant without the Inventory module is told so, calmly, not shown a page of zeroes"), "GET ?type=invstock&rid=<FH>", async (c) => {
  const r = await GET(c.O, `/api/owner/reports?type=invstock&range=30d&rid=${FH}`);
  if (r.status === 403) return /isn't enabled/i.test(r.j?.error || "") || `403 but: ${r.j?.error}`;
  return !!(r.status === 200 && r.j.summary) || `${r.status} ${r.j?.error}`;
});
for (const t of ["invpurchases", "invusage", "invwaste", "invexpenses"]) {
  row(S(`\`type=${t}\` answers its own sub-tab, or refuses in words`), `GET ?type=${t}&rid=<FH>`, async (c) => {
    const r = await GET(c.O, `/api/owner/reports?type=${t}&range=30d&rid=${FH}`);
    if (r.status === 403) return /isn't enabled|contact Aevidine/i.test(r.j?.error || "") || `403 but: ${r.j?.error}`;
    if (r.status === 400) return /pick one restaurant/i.test(r.j?.error || "") || `400 but: ${r.j?.error}`;
    return !!(r.status === 200 && r.j.summary) || `${r.status} ${r.j?.error}`;
  });
}
row(S("Team & pay is owner-only money, so a manager is refused"), "GET ?type=staffpay as diagm1", async (c) => {
  const r = await GET(c.G, `/api/owner/reports?type=staffpay&range=month&rid=${FH}`);
  return !!(r.status >= 400 && !/"paidOut"/.test(r.txt)) || `${r.status} ${r.txt.slice(0, 100)}`;
});
row(S("…and so is the team leaderboard"), "GET ?type=staffperf as diagm1", async (c) => {
  const r = await GET(c.G, `/api/owner/reports?type=staffperf&range=month&rid=${FH}`);
  return !!(r.status >= 400 && !/"value"/.test(r.txt)) || `${r.status} ${r.txt.slice(0, 100)}`;
});
row(S("Team & pay answers the two money truths side by side — what left the till, and what is still owed"), "GET ?type=staffpay&rid=<FH>", async (c) => {
  const r = await GET(c.O, `/api/owner/reports?type=staffpay&range=month&rid=${FH}`);
  if (r.status === 403) return /isn't enabled/i.test(r.j?.error || "") || `403 but: ${r.j?.error}`;
  if (r.status !== 200) return `${r.status} ${r.j?.error}`;
  return !!(Array.isArray(r.j.cashRows) && Array.isArray(r.j.monthRows) && r.j.totals
    && typeof r.j.totals.paidOut === "number" && typeof r.j.totals.owed === "number") || JSON.stringify(r.j.totals);
});
row(S("…and its per-person table adds up to the paid-out total"), "sum people[].paid against totals.paidOut", async (c) => {
  const r = await GET(c.O, `/api/owner/reports?type=staffpay&range=month&rid=${FH}`);
  if (r.status !== 200) return `SKIP: ${r.status}`;
  const sum = Math.round((r.j.people || []).reduce((a, x) => a + x.paid, 0) * 100) / 100;
  const paid = Math.round(r.j.totals.paidOut * 100) / 100;
  // ── THESE TWO ANSWER DIFFERENT QUESTIONS, AND THAT IS DELIBERATE ──────────────────────────────
  // Asserted as EQUAL first, and it failed with "people ₹0 vs paidOut ₹50" — which looked like the
  // two halves of one report disagreeing and is not. `paidOut` is cash truth: money that really left
  // the till on the day it left. The per-person table is the CURRENT pay list. Take somebody off the
  // pay list after paying them — which block A's P160551 proves keeps every entry they were ever
  // paid — and the cash figure rightly still counts it while they are no longer a row.
  //
  // So the rule is the direction, not equality: the people shown can never account for MORE than
  // actually left the till. Reproduced deliberately before weakening this: recording ₹777 and then
  // cancelling it takes it out of BOTH, so a voided entry is not what causes a gap.
  return sum <= paid + 0.05 || `the per-person table claims ₹${sum} but only ₹${paid} left the till`;
});
row(S("…and nobody on it is named by a uuid"), "read people[].name", async (c) => {
  const r = await GET(c.O, `/api/owner/reports?type=staffpay&range=month&rid=${FH}`);
  if (r.status !== 200) return `SKIP: ${r.status}`;
  const uuid = (r.j.people || []).filter((x) => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(String(x.name)));
  return uuid.length === 0 || `${uuid.length} person(s) named by their id`;
});
row(S("the team leaderboard shows only managers and waiters — a cook has no numbers on it"), "read rows[].role", async (c) => {
  const r = await GET(c.O, `/api/owner/reports?type=staffperf&range=month&rid=${FH}`);
  if (r.status !== 200) return `SKIP: ${r.status} ${r.j?.error}`;
  const bad = (r.j.rows || []).filter((x) => x.role !== "manager" && x.role !== "tablet");
  return bad.length === 0 || `it listed ${JSON.stringify([...new Set(bad.map((b) => b.role))])}`;
});
row(S("…and an empty leaderboard is never presented as a team that did nothing"), "read: the staff read is fatal so it cannot silently filter everyone out", async () => {
  const src = code(read("app/api/owner/reports/route.ts"));
  const perf = src.slice(src.indexOf('if (type === "staffperf")'));
  return !!(/reads\.rows<any>\("staff"\)/.test(perf) && /rd\("staff"/.test(perf))
    || "the staff read is back to a swallowed .data, so a failure would render an empty leaderboard";
});
row(S("a detail list that is capped says so, so it cannot quietly stop adding up to the band above it"), "read: listCap and the more-flags ride along, Inventory switched on", async (c) => {
  // ── THIS USED TO SKIP ON A 403, AND A SKIP PROVES NOTHING (owner picked item 10, 2026-09-17) ──
  // French House has `inventory_allowed: false`, so every run answered *"Inventory isn't enabled
  // for this restaurant"* and the check reported "⏭ 403" instead of testing anything. Switch the
  // admin rung on for the length of one read, then put it back.
  const COL = "inventory_allowed";
  const before = await sb.from("settings").select(COL).eq("restaurant_id", FH).maybeSingle();
  if (before.error) return `SKIP: could not read ${COL} (${before.error.message})`;
  const was = before.data?.[COL] === true;
  if (!was) {
    undo(async () => { await sb.from("settings").update({ [COL]: false }).eq("restaurant_id", FH); }, `French House ${COL} back to false`);
    await sb.from("settings").update({ [COL]: true }).eq("restaurant_id", FH);
  }
  try {
    // `&refresh=1` IS LOAD-BEARING, and finding out why is the best thing this check did.
    // Inventory reports ride the compute-on-view snapshot cache. Without forcing a recompute this
    // reads whatever was STORED earlier — so when I sabotaged the route to stop sending `listCap`
    // at all, the check stayed green on a payload computed by the previous build. Measured, both
    // in one run: cached answered `listCap: 300` stamped 02:43, `?refresh=1` answered `listCapX`.
    // A check that reads a cached report is testing the snapshot, not the code.
    const r = await GET(c.O, `/api/owner/reports?type=invexpenses&range=30d&rid=${FH}&refresh=1`);
    if (r.status !== 200) return `${r.status} ${r.j?.error} — Inventory was switched on for this read, so a 403 here is a real refusal`;
    return !!(typeof r.j.listCap === "number" && "expensesMore" in r.j)
      || `listCap=${r.j.listCap} expensesMore=${r.j.expensesMore} — a capped list that does not say it is capped stops adding up to the band above it`;
  } finally {
    if (!was) await sb.from("settings").update({ [COL]: false }).eq("restaurant_id", FH);
  }
});
row(S("a healthy report names nothing as unread"), "GET six types and check for `partial`", async (c) => {
  for (const t of ["sales", "tax", "daysummary", "dishes", "payments", "byrestaurant"]) {
    const r = await GET(c.O, `/api/owner/reports?type=${t}&range=30d&rid=${FH}`);
    if (r.status === 200 && r.j.partial) return `type=${t} reports partial=${JSON.stringify(r.j.partial)}`;
  }
  return true;
});
row(S("dishes from two restaurants stay two dishes, even when they share a name"), "GET ?type=dishes as the admin all-view", async (c) => {
  const r = await GET(c.A, "/api/owner/reports?type=dishes&range=all&scope=all");
  if (r.status !== 200) return `SKIP: ${r.status}`;
  const titles = (r.j.rows || []).map((x) => String(x.title));
  return titles.length === new Set(titles).size || `${titles.length - new Set(titles).size} dish name(s) merged across restaurants`;
});
row(S("…and each one is labelled with the restaurant it belongs to"), "the same call, read the labels", async (c) => {
  const r = await GET(c.A, "/api/owner/reports?type=dishes&range=all&scope=all");
  if (r.status !== 200 || !(r.j.rows || []).length) return "SKIP";
  return (r.j.rows || []).some((x) => String(x.title).includes(" · ")) || "no dish row names its restaurant";
});
row(S("…and none of them is labelled with a dash where a name should be"), "the same call", async (c) => {
  const r = await GET(c.A, "/api/owner/reports?type=dishes&range=all&scope=all");
  const dash = (r.j.rows || []).filter((x) => / · —$/.test(String(x.title)));
  return dash.length === 0 || `${dash.length} dish(es) labelled with a dash instead of a restaurant`;
});
row(S("a second identical report open is served from the saved copy"), "GET twice, compare cachedAt", async (c) => {
  const a = await GET(c.O, `/api/owner/reports?type=sales&range=30d&rid=${FH}`);
  const b = await GET(c.O, `/api/owner/reports?type=sales&range=30d&rid=${FH}`);
  return !!(b.j.cachedAt && sameStamp(a.j.cachedAt, b.j.cachedAt)) || `${a.j?.cachedAt} vs ${b.j?.cachedAt}`;
});
row(S("…and Refresh recomputes it"), "GET ?refresh=1", async (c) => {
  const a = await GET(c.O, `/api/owner/reports?type=sales&range=30d&rid=${FH}`);
  const b = await GET(c.O, `/api/owner/reports?type=sales&range=30d&rid=${FH}&refresh=1`);
  return !sameStamp(a.j.cachedAt, b.j.cachedAt) || `refresh returned the same stamp`;
});
row(S("an owner cannot ask for a report about a restaurant they do not own"), "GET ?rid=<Pizza Palace> as diago1", async (c) => {
  const r = await GET(c.O, `/api/owner/reports?type=sales&range=30d&rid=${PP}`);
  return !!(r.status === 403 && !/"revenue"/.test(r.txt)) || `${r.status} ${r.txt.slice(0, 100)}`;
});
row(S("a kitchen login gets no report of any type"), "GET four types as diagkitchen", async (c) => {
  for (const t of ["sales", "staffpay", "invstock", "byrestaurant"]) {
    const r = await GET(c.K, `/api/owner/reports?type=${t}&range=30d`);
    if (r.status === 200) return `type=${t} answered a kitchen login`;
  }
  return true;
});
row(S("the report window is always named in the answer, so the screen labels its own columns from the server"), "read window on nine types", async (c) => {
  for (const t of ["sales", "tax", "discounts", "cancellations", "daysummary", "dishes", "categories", "hourly", "payments"]) {
    const r = await GET(c.O, `/api/owner/reports?type=${t}&range=30d&rid=${FH}`);
    if (r.status === 200 && !(r.j.window?.from && r.j.window?.to)) return `type=${t} named no window`;
  }
  return true;
});
