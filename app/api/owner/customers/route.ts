// GET /api/owner/customers — the OWNER's guest list (the `customers` table, mig 014),
// scoped to their restaurants + gated by the admin-controlled "customers" entitlement.
// READ-ONLY and money-free (the table holds only contact info + first/last seen). A
// "returning" guest = last_seen meaningfully after first_seen. Egress-safe: explicit
// columns, .in(restaurant_id), .limit, one cheap head-count for the true total.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScopeOr503, scopedRestaurantIds, RestaurantListIncomplete, incompleteListResponse, dbFail, ownerLogPanel, ownerActorName } from "@/lib/ownerScope";
import { entitledSubset } from "@/lib/ownerEntitlements";
import { cachedOwnerPayload, scopeKeyOf } from "@/lib/ownerCache";
import { logAction } from "@/lib/oplog";
import { rd, ReadSet, ReadFailed } from "@/lib/readGuard";
import { restaurantNames } from "@/lib/restaurantNames";
import { safeSearch, safePhone } from "@/lib/searchText";
import { ERASABLE, RETAINED, erasureSummary } from "@/lib/personalData";
// ONE definition of what a bill was worth, shared with the admin's bill ledger and the audit's
// money detail. See the khata balance below for why this is imported rather than re-derived.
import { netOf, type BillOrder } from "@/lib/billLedger";

export const dynamic = "force-dynamic";
// visits/consent added by Customer CRM (mig 212): a REAL repeat count + the DPDP
// opt-in flag. Still money-free (no spend column exists).
const COLS = "restaurant_id, phone, name, blocked, visits, consent, first_seen_at, last_seen_at";
const REPEAT_MIN = 2; // visits >= 2 = a returning customer (real count, not a time heuristic)

// The concrete id list for this scope. Shared helper (lib/ownerScope) because the
// admin all-restaurants read must be PAGED — three local copies each dropped restaurants
// past PostgREST's row cap (found 2026-08-04).
const scopedIds = scopedRestaurantIds;

export async function GET(req: NextRequest) {
  // A SCOPE WE COULD NOT READ IS NOT "YOU ARE NOBODY" (T20 sweep, 2026-08-19). `ownerScope()` throws
  // OwnerScopeUnavailable when the act-as widen read fails — deliberately, so a blip can never
  // silently shrink the view — and `ownerScopeOr503()` was written in the same change to turn that
  // into a retryable 503 with a sentence a person can act on. It had NO callers: all twelve owner
  // routes still called `ownerScope()` bare, so the throw reached Next unhandled and the owner got a
  // blank 500 with no retry. Same 401 as before for a real "not you"; the only new answer is the 503.
  const sc = await ownerScopeOr503(req);
  if (sc.resp) return sc.resp;
  let scope = sc.scope;
  // A real owner is limited to restaurants whose "customers" section the admin still
  // allows; the admin's own session is never gated (admin = top power).
  if (!scope.all && !scope.admin) {
    const allowed = await entitledSubset(scope.ids, "customers");
    if (!allowed.length) return NextResponse.json({ error: "Customers isn't enabled for your restaurant — contact Aevidine.", disabled: true }, { status: 403 });
    scope = { ...scope, ids: allowed };
  }
  // Retryable failure beats an undercounted guest list (T9 sweep, 2026-08-05 — see the note on
  // scopedRestaurantIds).
  let ids: string[];
  try { ids = await scopedIds(scope); }
  catch (e) { if (e instanceof RestaurantListIncomplete) return incompleteListResponse(); throw e; }
  if (!ids.length) return NextResponse.json({ summary: { total: 0, returning: 0, newThisMonth: 0, blocked: 0, shown: 0 }, customers: [] });

  // Sanitised search (their own data; strip chars that would break the PostgREST or() filter).
  // One shared sanitiser for every owner search box (T9 finding F15) — see lib/searchText.ts.
  const search = safeSearch(req.nextUrl.searchParams.get("q"));
  // Narrowing controls (owner, 2026-07-30): one restaurant, a segment, and the sort —
  // all applied in the DATABASE so the payload stays small however many guests exist.
  const sp = req.nextUrl.searchParams;
  const onlyRid = sp.get("restaurant_id") || "";
  const seg = sp.get("seg") || "all";
  const sort = sp.get("sort") === "visits" ? "visits" : "last_seen_at";
  let q = sb.from("customers").select(COLS)
    .in("restaurant_id", onlyRid && ids.includes(onlyRid) ? [onlyRid] : ids)
    .order(sort, { ascending: false }).limit(300);
  if (search) q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
  if (seg === "regulars") q = q.gte("visits", REPEAT_MIN);
  if (seg === "new") q = q.lt("visits", REPEAT_MIN);
  if (seg === "blocked") q = q.eq("blocked", true);
  const { data, error } = await q;
  if (error) return dbFail("owner/customers", error, { message: "Couldn't load your guest list just now — please try again." });
  const list = (data || []) as Array<{ restaurant_id: string; phone: string; name: string | null; blocked: boolean; visits: number; consent: boolean; first_seen_at: string; last_seen_at: string }>;

  // Restaurant names (multi-restaurant owner tells brands apart). This file's local copy was the
  // only one of the five that handled a JSONB name correctly — so that reading is what moved into
  // lib/restaurantNames, and now every screen gets it (T9 finding F17 + idea I9). Ask for the WHOLE
  // scope, not just the ids on this page, so the restaurant picker below is complete.
  const names = await restaurantNames(ids);

  const monthAgo = Date.now() - 30 * 86_400_000;
  const monthAgoIso = new Date(monthAgo).toISOString();
  const customers = list.map((c) => ({ ...c, restaurantName: names.get(c.restaurant_id) ?? "—", returning: (c.visits || 0) >= REPEAT_MIN }));

  // Summary counts are TRUE scoped head-counts, not derived from the 300-row display page —
  // before this, "Blocked"/"New" undercounted for a restaurant with >300 guests (a guest
  // blocked long ago, or a busy month, fell outside the recent-300 window). `total`,
  // `blocked` and `newThisMonth` are plain column filters, so each is one cheap indexed
  // COUNT(head) scoped by restaurant_id — no extra rows fetched. `returning` needs a
  // per-row comparison of two timestamps (last_seen vs first_seen), which a column filter
  // can't express, so it stays derived from the shown page and can undercount on very busy
  // restaurants; making it exact needs a small scoped DB function (see OVERNIGHT note).
  // `returning` is now an EXACT scoped head-count (visits >= 2) — the real visit
  // counter (mig 212) lets us count it in the DB instead of eyeballing timestamps on
  // the shown page, so it no longer undercounts busy restaurants.
  // ── ONE guest's bills, with money. Their own restaurants only: the id list passed to
  // the function is the ALREADY-authorised scope, never a raw request parameter. Deliberately
  // per-guest (indexed on sessions(restaurant_id, cust_phone)) rather than a spend column on
  // every row, which would aggregate every bill on every page load.
  const detailPhone = safePhone(req.nextUrl.searchParams.get("phone"));
  if (detailPhone) {
    const { data: hist, error: hErr } = await sb.rpc("lfh_owner_customer_bills", {
      p_restaurant_ids: ids, p_phone: detailPhone, p_limit: 20,
    });
    if (hErr) return dbFail("owner/customers.bills", hErr, { message: "Couldn't load this guest's bills just now — please try again." });
    // Read this guest's rows directly — the list above is a filtered page and may not
    // contain them (searching for someone, then opening an older guest).
    // A FAILED READ HERE SHOWED A GUEST WITH NO RECORD AT ALL (T9 finding F13). `mineRaw` was taken
    // with no `.error` check, so a blip rendered the drawer as an existing guest who has never been
    // anywhere — indistinguishable from a data problem the owner would then go hunting for.
    const mineRead = await rd("guestRows", () => sb.from("customers").select(COLS).in("restaurant_id", ids).eq("phone", detailPhone).limit(20));
    if (mineRead.error) {
      return dbFail("owner/customers.detail", mineRead.error, { message: "Couldn't open that guest just now — please try again." });
    }
    const mineRows = (mineRead.data || []) as typeof list;
    // `names` already covers the whole scope, so there is nothing left to fill in.
    const mine = mineRows.map((c) => ({ ...c, restaurantName: names.get(c.restaurant_id) ?? "—" }));
    return NextResponse.json({ detail: { ...(hist || {}), rows: mine } });
  }

  // The four tiles are AGGREGATES over every guest row, so they ride the compute-on-view
  // snapshot cache (standing rule) instead of counting on every open and every 60s backstop.
  // The change-detector is the newest customer write (mig 229) — an index-only peek — so the
  // counting only re-runs when a guest was actually added or seen again. The LIST above stays
  // live: it's a paged, indexed read, not an aggregate. Placed AFTER the drawer's early return,
  // so opening one guest's record doesn't pay for the tiles at all.
  const scopeIds = onlyRid && ids.includes(onlyRid) ? [onlyRid] : ids;
  // The tiles compute now THROWS rather than printing a fabricated zero (finding F13), so the
  // caller has to answer for it: a retryable "try again", never four confident zeroes.
  let counted;
  try {
  counted = await cachedOwnerPayload({
    key: `ownercust:v1:${scopeKeyOf(scopeIds.length === 1 ? scopeIds[0] : null, false, scopeIds)}`,
    force: sp.get("refresh") === "1",
    fingerprint: async () => {
      const { data } = await sb.rpc("lfh_customers_fingerprint", { p_restaurant_id: scopeIds.length === 1 ? scopeIds[0] : null });
      return typeof data === "string" ? data : null;
    },
    compute: async () => {
      // A COUNT THAT FAILED IS NOT A COUNT OF ZERO (T9 finding F13, fixed 2026-08-12). These four
      // were read as `cnt.count ?? 0`, so a failed count printed a confident "Blocked 0" /
      // "Returning 0" — and because this compute is inside `cachedOwnerPayload` and declared no
      // `partial`, the invented zeros were STORED and served long after the blip.
      // All four are fatal: they are the entire content of the four tiles, so there is nothing left
      // to show if they fail. `rows()` throws, the caller turns it into a retryable answer.
      const head = () => sb.from("customers").select("phone", { count: "exact", head: true }).in("restaurant_id", scopeIds);
      const set = new ReadSet("owner/customers.tiles", await Promise.all([
        rd("all", () => head()),
        rd("blocked", () => head().eq("blocked", true)),
        rd("new", () => head().gte("first_seen_at", monthAgoIso)),
        rd("returning", () => head().gte("visits", REPEAT_MIN)),
      ]));
      // `.count()` throws on a failed read instead of falling back to 0 — the whole point.
      return {
        total: set.count("all"), blocked: set.count("blocked"),
        newThisMonth: set.count("new"), returning: set.count("returning"),
      };
    },
  });
  } catch (e) {
    return dbFail("owner/customers.tiles", e instanceof ReadFailed ? e.cause : e, {
      message: "Couldn't count your guests just now — please try again.",
    });
  }
  const summary = {
    total: counted.total,
    returning: counted.returning,
    newThisMonth: counted.newThisMonth,
    blocked: counted.blocked,
    shown: list.length,
    cachedAt: counted.cachedAt,
  };
  const restaurantList = ids.map((id) => ({ id, name: names.get(id) || "" })).filter((r) => r.name);
  return NextResponse.json({ summary, customers, restaurants: restaurantList,
    ...(names.partial ? { partial: ["restaurantNames"] } : {}) });
}

// DELETE /api/owner/customers — erase a customer (DPDP right-to-erasure, mig 212).
// Removes the customers row + their visit ledger + device links, scoped to a
// restaurant the owner actually owns AND still has the "customers" section for.
// Admin (top power) is never gated. Body: { restaurant_id, phone }.
export async function DELETE(req: NextRequest) {
  const sc = await ownerScopeOr503(req);
  if (sc.resp) return sc.resp;
  const scope = sc.scope;
  let body: { restaurant_id?: string; phone?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad body" }, { status: 400 }); }
  const restaurantId = String(body?.restaurant_id || "");
  const phone = String(body?.phone || "");
  if (!restaurantId || !phone) return NextResponse.json({ error: "restaurant_id and phone required" }, { status: 400 });

  // The restaurant must be in the owner's own, still-entitled set (never trust the
  // client's restaurant_id beyond that). Admin bypasses the entitlement gate only.
  // Never let a half-read list decide an erase is allowed OR refused — retry instead.
  let ownIds: string[];
  try { ownIds = await scopedIds(scope); }
  catch (e) { if (e instanceof RestaurantListIncomplete) return incompleteListResponse(); throw e; }
  if (!ownIds.includes(restaurantId)) return NextResponse.json({ error: "not your restaurant" }, { status: 403 });
  if (!scope.all && !scope.admin) {
    const allowed = await entitledSubset([restaurantId], "customers");
    if (!allowed.length) return NextResponse.json({ error: "Customers isn't enabled for your restaurant.", disabled: true }, { status: 403 });
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════════
  //  ERASE MEANS ERASE — AND IT MEANS EVERY TABLE (T9 findings F26 + F14, fixed 2026-08-12)
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  //
  // TWO things were wrong here, and the first one is the serious one.
  //
  // 1. THERE ARE TWO CUSTOMER TABLES. This erased `customers`, `customer_visits` and
  //    `customer_devices` — and never touched **`khata_customers`**, the pay-later person book
  //    (mig 166), which holds a NAME and a PHONE NUMBER. Nothing anywhere in the app or the
  //    migrations has ever deleted a row from it. So a guest exercised their right to erasure, this
  //    route answered `{ok:true}`, wrote an Activity line saying their record and devices were
  //    erased — and their name and number were still one search away in the manager's "Collect
  //    later" person picker (app/api/tablet/[...path] → `khata/customers?q=`).
  //
  // 2. THE FIRST TWO DELETES NEVER CHECKED `.error`. Only the third did. So a partial erasure —
  //    visits gone, devices left, or the reverse — still reported complete success, with no trace
  //    anywhere that half of it had not happened.
  //
  // ── WHAT AN UNPAID DEBT DOES (owner's call, 2026-08-12) ────────────────────────────────────────
  // The owner's answer to "what if they still owe money": *"why is there an erase button? there
  // should be a paid button."* Exactly right — the settle flow already exists in the manager panel,
  // and erasing someone mid-debt destroys the only record of who owes it. So the erase REFUSES while
  // a pay-later bill is outstanding and says how much and what to do, rather than either silently
  // keeping their data (what it used to do) or silently destroying a live receivable. Once the debt
  // is collected or written off, the erase goes through and takes the khata row with it.
  //
  // ── ASK ABOUT THIS ONE PERSON, NOT ABOUT THE TOP 500 DEBTORS (T20 sweep, 2026-08-19) ───────────
  // This check used to call `lfh_khata_outstanding(p_restaurant_ids, p_limit: 500)` and filter the
  // rows in JS. That function is bounded BY PERSON — `WHERE r.rn <= p_limit` over a
  // `row_number() OVER (ORDER BY sum(bill_amount) DESC)` (mig 309) — so it returns the 500 BIGGEST
  // debtors and nobody else. A guest ranked 501st came back with no rows, read as owing ₹0, and the
  // erase went through: their pay-later record was anonymised while the debt stood, leaving a
  // receivable on the books that nobody is attached to. That is the same "never decide from the
  // shown page" fault this area has been corrected for twice (T7 F13 on the khata headline, T9 F19
  // on the complaints badge) — and here it does not merely misreport a number, it authorises an
  // irreversible erase.
  //
  // A cap cannot be raised out of this: the question is not "who owes the most", it is "does THIS
  // person owe anything", and that has an exact answer. It is read straight from `orders` with mig
  // 309's own predicate and mig 301's own arithmetic (`total - disc_gross`, the discount as it
  // really reduces the bill — never re-derived from tax/subtotal), on the index that exists for
  // exactly this shape: `orders_khata_open_live_ix (restaurant_id, khata_customer_id)`. Bounded,
  // one round trip, and it cannot be truncated.
  //
  // The old `lfh_khata_outstanding_summary` call above it is gone with it. Its `.data` was never
  // read — it existed only as a "can we reach the khata data at all?" probe — and the exact read
  // below does that job better, by failing on the very question being asked.
  const khataRow = await rd("khataPerson", () => sb.from("khata_customers")
    .select("id, name, phone").eq("restaurant_id", restaurantId).eq("phone", phone).maybeSingle());
  if (khataRow.error) {
    return dbFail("owner/customers.erase", khataRow.error, { message: "Couldn't check their pay-later record just now — please try again." });
  }
  const person = khataRow.data as { id: string; name: string | null } | null;
  if (person) {
    // Every LIVE, unpaid, uncancelled pay-later order of THIS person at THIS restaurant. The 2000
    // cap is a runaway guard, not a business bound — it is orders-per-person, and a person with
    // 2000 open pay-later bills is a different conversation.
    //
    // THE FIGURE IS READ THROUGH `netOf()`, NOT RE-DERIVED HERE (sweep #7, T30, 2026-08-28).
    // This used to add up `total − disc_gross` inline. That gave the right answer — `net_amount` is
    // `GENERATED ALWAYS AS (total − disc_gross)` on the database, so the two agree by construction —
    // but it was a SECOND copy of a money rule, and every duplicated money rule in this codebase's
    // history has eventually drifted from the original (the printed bill, the KOT, the banquet
    // sheet, the filing tax split and "the rate this order was charged at" were each consolidated
    // after a copy went its own way). `net_amount` is selected so netOf() returns the database's own
    // stored figure and does no arithmetic at all; `total`/`disc_gross` stay in the column list as
    // its fallbacks. Same definition as the admin's bill ledger and the audit's money detail.
    const bal = await rd("khataBalance", () => sb.from("orders")
      .select("id, session_id, total, discount, disc_gross, net_amount, tax_rate")
      .eq("restaurant_id", restaurantId)
      .eq("khata_customer_id", person.id)
      .not("khata_at", "is", null)
      .neq("payment_status", "paid")
      .neq("status", "cancelled")
      .is("deleted_at", null)
      .limit(2000));
    if (bal.error) {
      // Cannot check whether they owe → refuse. Erasing on doubt is irreversible; waiting is not.
      return dbFail("owner/customers.erase", bal.error, { message: "Couldn't check their pay-later balance just now — please try again." });
    }
    const theirs = (bal.data || []) as Array<Pick<BillOrder, "id" | "session_id" | "total" | "discount" | "disc_gross" | "net_amount" | "tax_rate">>;
    const owed = Math.round(theirs.reduce((a, o) => a + netOf(o as BillOrder), 0) * 100) / 100;
    // BILLS, not order rows — one sitting can be several orders, and the sentence says "bills".
    // Same key the RPC uses for a bill: the session, or the order id when there is no session.
    const bills = new Set(theirs.map((o) => o.session_id ?? o.id)).size;
    if (owed > 0) {
      return NextResponse.json({
        error: `${person.name || "This guest"} still owes ₹${owed} on ${bills} pay-later ${bills === 1 ? "bill" : "bills"}. Collect or write that off first, then erase them.`,
        reason: "khata_outstanding",
        owed, bills,
      }, { status: 409 });
    }
  }

  // ── THE PAY-LATER ROW IS ANONYMISED, NOT DELETED — AND THAT IS NOT A COMPROMISE ────────────────
  // Found by the fixture test (2026-08-12) before this ever shipped: `orders.khata_customer_id` is a
  // FOREIGN KEY onto `khata_customers` with no cascade, so DELETING that row fails outright for any
  // guest who has ever actually used pay-later — i.e. for exactly the people this is meant to cover.
  // And the referencing orders must NOT be removed to make room: an issued bill is a sales record,
  // the database refuses to hard-delete one, and doing so is the CGST §132 offence
  // (docs/COMPLIANCE-GUARDRAILS.md).
  //
  // So the row stays and the PERSON is removed from it: name, phone and note cleared. Their personal
  // data is gone — which is what was asked for and all that was ever asked for — while the bill it
  // is attached to keeps a valid reference and stays in the books. This is the standard shape for
  // erasing someone who appears on a financial document, and it is genuinely better than a delete:
  // a delete would either fail or take a sale with it.
  // ── DRIVEN BY THE DECLARED LIST, NOT BY THIS FUNCTION'S MEMORY (improvement I15) ───────────────
  // These tables used to be typed out here. That list was wrong for months — `khata_customers` held
  // a name and a number from the day pay-later shipped and nothing here knew — and it was only right
  // afterwards because somebody had just gone looking. lib/personalData.ts is the declared list, and
  // `npm run verify:personal-data` fails the build if a new table gains a phone column without
  // joining it. `customers` itself is handled below, after these, so a failure part-way leaves the
  // guest findable rather than half-gone.
  // THIS OWNER'S RESTAURANT ONLY. The same phone can be a guest somewhere else on the platform, and
  // that restaurant's data is not this owner's to touch — so the two tables that hang off a session
  // rather than a restaurant are narrowed through that restaurant's sessions first.
  let sessionIds: string[] | null = null;
  if (ERASABLE.some((p) => p.scopeBy === "session")) {
    const s = await rd("theirSessions", () => sb.from("sessions")
      .select("id").eq("restaurant_id", restaurantId).eq("cust_phone", phone).limit(1000));
    if (s.error) {
      return dbFail("owner/customers.erase", s.error, { message: "Couldn't finish erasing that guest — nothing was removed. Please try again." });
    }
    sessionIds = ((s.data || []) as { id: string }[]).map((r) => r.id);
  }

  const wipes = ERASABLE.filter((p) => p.table !== "customers").map((p) => ({
    table: p.table,
    run: (): PromiseLike<{ error: unknown }> => {
      // A session-scoped table with NO matching sessions has nothing to erase — and an unfiltered
      // `.in("session_id", [])` would be a no-op anyway, but saying so here keeps it obvious.
      if (p.scopeBy === "session" && !sessionIds?.length) return Promise.resolve({ error: null });
      const base = sb.from(p.table);
      const q = p.policy === "anonymise" ? base.update(p.anonymiseTo || {}) : base.delete();
      const scoped = p.scopeBy === "restaurant" ? q.eq("restaurant_id", restaurantId)
        : p.scopeBy === "session" ? q.in("session_id", sessionIds as string[])
        : q;                                     // "phone" — global, and documented as safe
      return scoped.eq(p.phoneColumn, phone);
    },
  }));
  for (const w of wipes) {
    const r = await rd(w.table, () => w.run().then((x) => ({ data: null, error: x.error })));
    if (r.error) {
      return dbFail("owner/customers.erase", r.error, {
        message: "Couldn't finish erasing that guest — nothing was reported as removed. Please try again.",
      });
    }
  }
  const del = await sb.from("customers").delete().eq("restaurant_id", restaurantId).eq("phone", phone).select("phone");
  if (del.error) return dbFail("owner/customers.erase", del.error, { message: "Couldn't erase that guest — please try again." });
  // THE ONLY IRREVERSIBLE ERASE IN THE OWNER PANEL, AND IT WAS UNRECORDED (sweep 2026-08-04). This
  // hard-deletes the guest, their visit history and their devices — three tables, no tombstone, no
  // restore. (That is correct for a "erase my data" request under DPDP; sales rows are untouched and
  // stay under the CGST soft-delete rule.) But the FACT that it happened has to be traceable, or a
  // guest vanishing from the list is indistinguishable from a bug — and with several co-owners
  // nobody could say who did it. Only the last 4 digits are recorded: the log must not become a
  // second copy of the number the owner just asked us to erase.
  const who = ownerActorName(scope);
  const last4 = phone.slice(-4);
  await logAction(ownerLogPanel(scope), "customer_erase", {
    restaurant_id: restaurantId,
    actor: who,
    detail: `erased guest record ending ${last4} (${(del.data || []).length} ${(del.data || []).length === 1 ? "row" : "rows"}) + their visits, devices and pay-later record`,
  });
  // ── AND INTO THE REMOVALS RECORD (owner, 2026-08-12: "delete — it will go in audit and stuff") ──
  // The Activity log is a feed of what people DID; `deletion_audit` is the owner's "what was taken
  // out of the system" screen, and it is where anyone would actually go looking for a vanished
  // guest. This is the only irreversible erase in the owner panel — three tables, no tombstone, no
  // restore — so it belongs on the screen built for exactly that question.
  // Only the last 4 digits are recorded, here as in the Activity line: the audit of an erasure must
  // not become a fresh copy of the number we were just asked to erase.
  await sb.from("deletion_audit").insert({
    restaurant_id: restaurantId,
    kind: "customer_erased",
    reason_code: "data_erasure_request",
    reason_note: "Guest asked for their personal data to be erased",
    actor: who,
    actor_role: (scope.all || scope.admin) ? "admin" : "owner",
    item_title: `Guest ending ${last4}`,
    meta: {
      phone_last4: last4,
      customers_rows: (del.data || []).length,
      also_erased: ["customer_visits", "customer_devices"],
      // Named separately and honestly: this row was emptied of the person, not removed, because a
      // sales record points at it. Anyone auditing an erasure should see that distinction rather
      // than a blanket "all gone".
      anonymised: ["khata_customers"],
    },
  }).then(({ error }) => {
    // A failed audit line must not un-erase the guest (the data is already gone and that was the
    // point), but it must be shouted about our side — an erasure nobody recorded is the gap this
    // whole change exists to close.
    if (error) console.error("[owner/customers.erase] the erase SUCCEEDED but its audit row failed:", error.message);
  });
  // WHAT SURVIVED, SAID OUT LOUD (improvement I15). An erasure that cannot be complete has to say
  // so — the guest's details stay on their issued bills, and the owner needs to know that when they
  // answer the guest, rather than promising something the books never did.
  return NextResponse.json({ ok: true, erased: (del.data || []).length, ...erasureSummary() });
}
