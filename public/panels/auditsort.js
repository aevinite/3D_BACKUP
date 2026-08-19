/* auditsort.js — HOW THE AUDIT (removals) RECORD IS SORTED AND SLICED, written down ONCE.
 *
 * WHY THIS FILE EXISTS (owner, 2026-08-11): "in audit section make something like sort thing where
 * everything can be sorted, like what is list of what." The Audit was a single flat feed with a
 * free-text search: to answer "how many bills were deleted this week, and which were the biggest?"
 * you had to read every row. Now it carries a chip per TYPE with a live count, and a sort control.
 *
 * IT LIVES HERE, NOT IN THE SCREENS, because the Audit exists in THREE panels — the owner console,
 * the manager panel and the admin console — and the owner's rule for it is one name in all three
 * ('docs/CLAUDE-DETAIL.md', and verify:audit already enforces that the KIND LABELS cannot drift).
 * Three copies of a sort order is how the same record starts answering three different ways. The
 * labels are already shared via KIND_LABEL in components/admin/RemovalDetail.tsx; this is the
 * behaviour beside them.
 *
 * LOADED FROM THREE WORLDS, so it is deliberately plain JavaScript with no imports — exactly the
 * shape public/panels/billdoc.js uses, and for the same reason:
 *   · the manager panel — <script src="/panels/auditsort.js">  → window.LFH_AUDITSORT
 *   · React (owner + admin) — import AUDITSORT from "@/public/panels/auditsort.js"
 *   · a Node guard script — the same import (module.exports)
 *
 * PURE: rows in, rows out. It reads no panel state, fetches nothing, and every comparator is
 * TOTAL (it falls back to the row id) so a sort can never shuffle equal rows between renders.
 */
(function () {
  "use strict";

  /* THE WORDS AND THE GLYPH FOR EVERY REMOVAL TYPE — the ONE set, for all three panels.
     WHY (T7 pass 2, 2026-08-12): there were THREE hand-written maps and SIX of the eleven types were
     named differently in each. An owner rang about "the Bill reopened on table 6" while the manager
     was looking at a screen calling it "Invoice voided" — one database row, three names. verify:audit
     had already fixed this once for the owner's row-versus-card pair; the three PANELS were never
     brought together, and adding a type CHIP to each of them made it impossible to miss.

     WHICH word won, per type — taken from what the product's own buttons say and from the owner's own
     vocabulary, not from whichever panel shouted loudest:
       · "KOT cancelled" — KOT is his word (mig 251 quotes him: "every KOT which has been deleted")
         and the panel says KOT 152 times to Kitchen ticket's 6. The row already prints "KOT #17".
       · "Bill reopened" — the manager panel's OWN button reads "Reopen bill" and the Access screen
         says "Reopening a bill that was already closed… it is recorded that it was reopened". The old
         "Invoice voided" contradicted the button beside it.
       · "Dish removed from an order" / "Menu item deleted" — a bare "Dish removed" cannot be told
         apart from taking a dish off the MENU, which is a different row entirely.
       · "Settled on the house" — a bare "On the house" reads like a label, not something that happened.
     Anything the three already agreed on is left exactly as it was. */
  var KIND_LABEL = {
    order_cancelled: "KOT cancelled",
    order_deleted: "Bill deleted",
    dish_removed: "Dish removed from an order",
    qty_reduced: "Quantity reduced",
    menu_item_deleted: "Menu item deleted",
    invoice_voided: "Bill reopened",
    discount_given: "Discount given",
    payment_reverted: "Payment reverted",
    on_the_house: "Settled on the house",
    bill_changed_after_reopen: "Bill changed after a reopen",
    order_restored: "Bill put back",
    /* NEW 2026-08-13 (owner: "you can edit after the bill, but it will go in the audit — minor
       section, not the risky one, no money one"). A note or an allergy changed on a bill that was
       ALREADY settled. It moves no money at all — see KIND_RISK below, which is what keeps it out
       of the money figures. */
    bill_annotated: "Note or allergy changed after settling",
    /* Not a removal — the append-only answer to "was the food made?" on an earlier cancellation, or a
       correction of that answer. Recorded so the record shows the history of the answer, not just the
       answer (owner, 2026-08-18; migration 337). */
    removal_classified: "Cancellation answered: was the food made?",
  };
  /* The glyph each type wears, beside the words so the two cannot drift. Plain text symbols only —
     the manager panel renders these into its own markup and a couple of its rows print to paper. */
  var KIND_ICON = {
    order_cancelled: "\uD83C\uDFAB", order_deleted: "\uD83E\uDDFE", dish_removed: "\uD83C\uDF7D",
    qty_reduced: "\u2796", menu_item_deleted: "\uD83D\uDCD5", invoice_voided: "\u21A9\uFE0F",
    discount_given: "\uFF05", payment_reverted: "\u21BA", on_the_house: "\uD83C\uDF81",
    bill_changed_after_reopen: "\u21C4", order_restored: "\u267B\uFE0F",
    bill_annotated: "\u270E", removal_classified: "\u2753",
  };
  /* HOW RISKY IS THIS ROW — the ONE answer, for all three panels (owner, 2026-08-13:
     "it should also show whole risk like money wise and all that, how much money is there which
     reverted and all everything … editing after a bill, that goes in the minor section, not the
     risky one, no money one").
     Three levels, and the difference is not severity-by-feeling — it is whether MONEY MOVED:
       · "money"  — the restaurant collected less, or nothing, than the food was worth. These are the
                    rows that add up to a number an owner can be angry about, and the only ones the
                    money summary counts (SQL: lfh_audit_money_summary).
       · "record" — the RECORD changed but not the money: a KOT voided before anything was charged,
                    a dish taken off a live (unpaid) order, a menu dish deleted, a bill reopened or
                    put back, a note changed after settling. Worth keeping, never worth alarming.
       · "data"   — someone's personal information was erased on request. Not money, not a bill; it
                    has its own level because it is the one thing that cannot be undone.
     Kept in step with lfh_audit_risk() in the database by npm run verify:audit — two answers to
     "is this row about money" is exactly how a summary starts disagreeing with the list above it. */
  var KIND_RISK = {
    discount_given: "money",             // money taken off a bill
    on_the_house: "money",               // settled with nothing collected
    payment_reverted: "money",           // collected, then un-collected
    order_deleted: "money",              // a bill taken off the working list (it stays in the reports)
    bill_changed_after_reopen: "money",  // what the bill was worth before vs after — the amount moved
    order_cancelled: "record",           // a KOT voided: nothing was charged to the guest
    dish_removed: "record",              // one dish off a LIVE order, before it was ever billed
    qty_reduced: "record",               // same, one plate fewer
    menu_item_deleted: "record",         // the menu changed, no bill involved
    invoice_voided: "record",            // reopened FOR editing; what actually moved is recorded as bill_changed_after_reopen
    order_restored: "record",            // the reversal of a removal — it puts money back, never takes it
    bill_annotated: "record",            // a note / allergy after settling: touches no total, tax or discount
    customer_erased: "data",             // a person's details, erased on request, irreversibly
    removal_classified: "record",        // the ANSWER to a cancellation, not a removal — it moves nothing
  };
  /* WHAT KIND OF THING IS THIS ROW — the tags (owner, 2026-08-18: "make tags for all kind of audit
     and stuff"). The database half is lfh_audit_tags() in migration 337 and verify:audit asserts the
     two agree, exactly as it already does for KIND_RISK — two answers to "what is this row" is how
     one screen's chips start disagreeing with another's.

     Tags are ADDITIVE labels a person can filter by. They are deliberately NOT a second risk model:
     risk answers "did money move", a tag answers "what area of the restaurant is this about". */
  var KIND_TAGS = {
    order_cancelled: ["cancellation", "kitchen"],
    order_deleted: ["bill", "money"],
    dish_removed: ["order", "kitchen"],
    qty_reduced: ["order", "kitchen"],
    menu_item_deleted: ["menu"],
    invoice_voided: ["bill", "reopen"],
    discount_given: ["money", "discount"],
    payment_reverted: ["money", "payment"],
    on_the_house: ["money", "discount"],
    bill_changed_after_reopen: ["bill", "reopen", "money"],
    order_restored: ["order", "restored"],
    bill_annotated: ["bill", "note"],
    customer_erased: ["guest", "privacy"],
    removal_classified: ["correction"],
  };
  /* The words a person reads for each tag, and the glyph beside them. One spelling everywhere, for the
     same reason the kind labels are shared. */
  var TAG_LABEL = {
    cancellation: "Cancellations", kitchen: "Kitchen", bill: "Bills", money: "Money moved",
    order: "Orders", menu: "Menu", reopen: "Reopened", discount: "Discounts", payment: "Payments",
    restored: "Put back", note: "Notes", guest: "Guest data", privacy: "Privacy",
    correction: "Answer corrected", other: "Other",
    loss: "Food lost", "no-loss": "Nothing lost", unanswered: "Not answered yet",
    "cost-unknown": "Cost unknown",
  };
  var TAG_ICON = {
    cancellation: "\uD83C\uDFAB", kitchen: "\uD83D\uDC68\u200D\uD83C\uDF73", bill: "\uD83E\uDDFE",
    money: "\uD83D\uDCB8", order: "\uD83C\uDF7D", menu: "\uD83D\uDCD5", reopen: "\u21A9\uFE0F",
    discount: "\uFF05", payment: "\u21BA", restored: "\u267B\uFE0F", note: "\u270E",
    guest: "\uD83D\uDC64", privacy: "\uD83E\uDDF9", correction: "\u2753", other: "\u2022",
    loss: "\uD83D\uDD25", "no-loss": "\u2705", unanswered: "\u2754", "cost-unknown": "\u2696\uFE0F",
  };
  /* The tags for ONE row — its kind's tags, plus, for a cancellation, whether the food was made. That
     second part is the answer he asked to be able to see and filter by: an unanswered cancellation is
     its own state, never guessed at. Mirrors lfh_audit_tags() exactly. */
  function tagsOf(row) {
    var r = row || {}, meta = r.meta || {};
    var out = (KIND_TAGS[r.kind] || ["other"]).slice();
    if (r.kind === "order_cancelled") {
      var made = meta.made;
      out.push(made === true ? "loss" : made === false ? "no-loss" : "unanswered");
      if (made === true && num(meta.loss_cost) === 0) out.push("cost-unknown");
    }
    return out;
  }
  /* Every tag present in a set of rows, with how many carry it — for the chip strip. Built from the
     WHOLE feed like the kind chips, so a chip's count does not change when you tap it. */
  function tagCountsFrom(rows) {
    var seen = {};
    (rows || []).forEach(function (r) {
      tagsOf(r).forEach(function (t) { seen[t] = (seen[t] || 0) + 1; });
    });
    return Object.keys(seen).sort().map(function (t) {
      return { tag: t, count: seen[t], label: TAG_LABEL[t] || t, icon: TAG_ICON[t] || "\u2022" };
    });
  }
  /* The one-tap reasons, for the same reason — the search matches on the WORDS a screen shows, so a
     third spelling of "By mistake" would make typing it find nothing on one panel and rows on another. */
  var REASON_LABEL = {
    mistake: "By mistake",
    guest_changed: "Guest changed their mind",
    wrong_table: "Wrong table",
    sold_out: "Not available / sold out",
    kitchen_error: "Kitchen error",
    other: "Other reason",
  };

  var num = function (v) { var n = parseFloat(String(v == null ? "" : v)); return isFinite(n) ? n : 0; };
  var txt = function (v) { return String(v == null ? "" : v).trim().toLowerCase(); };
  var when = function (r) { var t = Date.parse(r && r.at); return isFinite(t) ? t : 0; };

  /* THE SORT ORDERS, in the order they are offered. 'id' is what a screen stores, 'label' is what
     a person reads — the same five words in all three panels.

     Every comparator ends in a tie-break on 'id' (descending, i.e. newest row first) so two rows
     that genuinely match never swap places between two renders of the same list. A list that
     reorders under the cursor is the sort feeling broken even when the order is right. */
  var tie = function (a, b) { return num(b.id) - num(a.id); };
  var SORTS = [
    { id: "new", label: "Newest first", cmp: function (a, b) { return (when(b) - when(a)) || tie(a, b); } },
    { id: "old", label: "Oldest first", cmp: function (a, b) { return (when(a) - when(b)) || tie(a, b); } },
    // Biggest MONEY first — the one an owner actually reaches for ("what were the big ones?").
    // A row with no amount (a dish off the menu) sorts below every row that has one rather than
    // being treated as ₹0 mixed in among real figures.
    { id: "amount", label: "Biggest amount", cmp: function (a, b) {
      var A = a.amount == null ? -1 : num(a.amount), B = b.amount == null ? -1 : num(b.amount);
      return (B - A) || tie(a, b);
    } },
    { id: "person", label: "Person (A–Z)", cmp: function (a, b) {
      return txt(a.actor).localeCompare(txt(b.actor)) || (when(b) - when(a)) || tie(a, b);
    } },
    { id: "restaurant", label: "Restaurant (A–Z)", cmp: function (a, b) {
      return txt(a.restaurant_name).localeCompare(txt(b.restaurant_name)) || (when(b) - when(a)) || tie(a, b);
    } },
  ];
  var DEFAULT_SORT = "new";
  var sortById = function (id) {
    for (var i = 0; i < SORTS.length; i++) if (SORTS[i].id === id) return SORTS[i];
    return SORTS[0];
  };

  /** Sort a COPY — never in place. A screen holds its rows in state; sorting them where they lie
   *  mutates that state and React then has no way to know the list changed. */
  function sortRows(rows, sortId) {
    return (rows || []).slice().sort(sortById(sortId).cmp);
  }

  /* WHICH TYPES ARE ON SCREEN, AND HOW MANY OF EACH — "what is list of what".
     Counted from the rows themselves rather than from a fixed list of kinds, so a chip only ever
     appears when there is something behind it: a restaurant that has never voided an invoice is not
     offered a "Voided invoices 0" chip to tap. 'label' and 'icon' are passed in by the caller from
     the ONE shared KIND_LABEL/KIND_ICON map, so this file never gets a second opinion on the words.
     Ordered by count, biggest first, so the busiest type is the nearest chip. */
  /* THE SAME LIST, BUT COUNTED IN THE DATABASE (owner, 2026-08-12).
     Once the Audit is PAGED, counting the rows in hand describes one page — and a chip reading
     "Bill deleted 10" that really means "10 on this page" is a number that reads as authoritative and
     is not. 'dbCounts' is mig 311's grouped read ([{kind, n, amount}]). When it is present it wins,
     and every type it names gets a chip even if none of its rows are on this page — that is the whole
     point: you can reach a type from page 1. When it is absent (an older server, or a failed count)
     this falls back to counting the rows and the caller says the counts are for this page only. */
  function kindCountsFrom(rows, dbCounts, label, icon) {
    var page = kindCounts(rows, label, icon);
    if (!dbCounts || !dbCounts.length) return page;
    return dbCounts
      .map(function (c) {
        var k = String(c.kind || "");
        return {
          kind: k,
          count: Number(c.n) || 0,
          amount: Number(c.amount) || 0,
          label: (label && label[k]) || k,
          icon: (icon && icon[k]) || "\u2022",
        };
      })
      .filter(function (c) { return c.kind && c.count > 0; })
      .sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label); });
  }

  function kindCounts(rows, label, icon) {
    var seen = {}, order = [];
    (rows || []).forEach(function (r) {
      var k = String((r && r.kind) || "");
      if (!k) return;
      if (seen[k] == null) { seen[k] = 0; order.push(k); }
      seen[k] += 1;
    });
    return order
      .map(function (k) {
        return {
          kind: k,
          count: seen[k],
          label: (label && label[k]) || k,
          icon: (icon && icon[k]) || "•",
        };
      })
      .sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label); });
  }

  /* THE SEARCH, stated once so all three panels match the same words.
     Every field a person might type is included — the numbers they have in front of them (KOT, bill,
     invoice, table), the dish, the person, the reason (both the code's WORDS and any free text), the
     type, and the restaurant. 'reasonLabel' maps a stored code to what the screen shows, so typing
     "by mistake" finds rows whose column reads "By mistake" while the database holds "mistake". */
  function matches(r, needle, kindLabel, reasonLabel) {
    var q = txt(needle);
    if (!q) return true;
    var bits = [
      r.kot_no != null ? "kot " + r.kot_no : "",
      r.bill_no != null ? "bill " + r.bill_no : "",
      r.invoice_no ? "invoice " + r.invoice_no : "",
      r.table_number ? "table " + r.table_number : "",
      r.item_title, r.actor, r.actor_role, r.reason_note,
      r.reason_code ? ((reasonLabel && reasonLabel[r.reason_code]) || r.reason_code) : "",
      (kindLabel && kindLabel[r.kind]) || r.kind,
      r.restaurant_name,
      r.amount != null ? String(Math.round(num(r.amount))) : "",
    ];
    for (var i = 0; i < bits.length; i++) {
      if (bits[i] && txt(bits[i]).indexOf(q) >= 0) return true;
    }
    return false;
  }

  /** Filter by type + search, then sort — the whole pipeline in one call, so a screen cannot get
   *  the ORDER of those three steps wrong (sorting before filtering is free work on a long feed).
   *  'kind' of "" (or absent) means every type. */
  function view(rows, opts) {
    var o = opts || {};
    var out = (rows || []).filter(function (r) {
      if (o.kind && String(r && r.kind) !== o.kind) return false;
      return matches(r, o.q, o.kindLabel, o.reasonLabel);
    });
    return sortRows(out, o.sort);
  }

  /** The total money on a set of rows — what the visible slice adds up to, so a chip can say
   *  "12 deleted bills · ₹22,180" instead of leaving an owner to add them up by eye. Rows with no
   *  amount contribute nothing. */
  function sumAmount(rows) {
    var t = 0;
    (rows || []).forEach(function (r) { if (r && r.amount != null) t += num(r.amount); });
    return Math.round(t * 100) / 100;
  }

  /* ═══════════════════════════════════════════════════════════════════════════════════════════
     THE ACTIVITY LOG'S HALF — "sort it like the audit, so I can see just the printer" (owner,
     2026-08-14, after the T17 sweep).
     ═══════════════════════════════════════════════════════════════════════════════════════════
     The Audit (removals) got chips and a sort order on 2026-08-11. The ACTIVITY log — the much
     bigger feed of who-did-what — did not: it had a severity filter and a search box, so answering
     "did the printer play up during Saturday service?" meant reading a thousand rows or knowing to
     type a word that happens to appear in them.
     It lives beside the Audit's half, in this same file, for the SAME reason: the Activity log is on
     THREE screens (manager panel, owner console, admin console) and three copies of a grouping is
     how one feed starts answering three different ways.
     GROUPS, NOT A PER-ACTION MAP. There are ~140 action names and more arrive with every feature, so
     a hand-written list of all of them would be out of date the week after it was written — and a
     row whose action nobody had listed would silently fall out of every chip. Each group instead
     owns a TEST, first match wins, and 'other' catches whatever is new. So a feature shipped next
     month lands in a sensible group on the day it is written, and this file only names exceptions.
     The order below IS the priority order: printer before orders (a print job mentions an order),
     money before tables (a settle names a table). */
  var ACTIVITY_GROUPS = [
    { id: "printer", label: "Printer", icon: "🖨️",
      test: function (a) { return /^(kot_print|bill_print|print_|printer_)/.test(a); } },
    { id: "access", label: "Sign-in & access", icon: "🔑",
      test: function (a) { return /^(login|logout|password|pin_set|rate_limit|admin_(block|unblock|lockout)|access_change|user_set_(permissions|access|pin|role)|staff_set_permissions|module_toggle|quick_feature|staff_feature)/.test(a); } },
    { id: "money", label: "Bills & money", icon: "💳",
      test: function (a) { return /(bill_|discount|payment|invoice|khata|on_the_house|close_unpaid|credit_note|order_delete|order_item_delete|order_item_qty|banquet|billing_|staff_payment)/.test(a); } },
    { id: "orders", label: "Orders & kitchen", icon: "🍽️",
      test: function (a) { return /^(order_|item_status|parcel_|platform_status|sold_out)/.test(a); } },
    { id: "tables", label: "Tables & guests", icon: "🪑",
      test: function (a) { return /^(table_|auto_approve|member_|call_|customer_|maintenance_)/.test(a); } },
    { id: "menu", label: "Menu", icon: "📖",
      test: function (a) { return /^(menu_|google_review)/.test(a); } },
    { id: "stock", label: "Stock & expenses", icon: "📦",
      test: function (a) { return /^(inv_|expense_)/.test(a); } },
    { id: "people", label: "People", icon: "👤",
      test: function (a) { return /^(staff_|user_|owner_|profile_)/.test(a); } },
    { id: "setup", label: "Restaurant setup", icon: "🏪",
      test: function (a) { return /^(restaurant_|platform_channel|retention_|logs_cleanup|error_memory|fix_request|issue_)/.test(a); } },
    { id: "problem", label: "Problems", icon: "⚠️",
      test: function (a) { return /(error|failed|denied|blocked)/.test(a); } },
    { id: "other", label: "Everything else", icon: "•", test: function () { return true; } },
  ];

  /** Which group one action belongs to. Total: 'other' matches everything, so this always answers. */
  function activityGroupOf(action) {
    var a = txt(action);
    for (var i = 0; i < ACTIVITY_GROUPS.length; i++) if (ACTIVITY_GROUPS[i].test(a)) return ACTIVITY_GROUPS[i].id;
    return "other";
  }
  var GROUP_BY_ID = {};
  ACTIVITY_GROUPS.forEach(function (g) { GROUP_BY_ID[g.id] = g; });

  /* A row's severity is its own thing — the screens already colour by it — but a PROBLEM row must
     land in the Problems chip even when its action name says nothing (route_error does, 'ui_taps'
     at level error does not). So the level wins when it is an error. */
  function groupOfRow(r) {
    if (r && r.level === "error") return "problem";
    return activityGroupOf(r && r.action);
  }

  /* The chips, counted from the rows in hand. Same shape and same ordering rule as the Audit's
     kindCounts (biggest first) so the two strips behave identically — but the GROUP order is kept
     stable rather than sorted by size, because these are categories a person learns the position of
     ("printer is second"), not a leaderboard. */
  function activityCounts(rows) {
    var seen = {};
    (rows || []).forEach(function (r) {
      var g = groupOfRow(r);
      seen[g] = (seen[g] || 0) + 1;
    });
    return ACTIVITY_GROUPS
      .filter(function (g) { return seen[g.id] > 0; })
      .map(function (g) { return { group: g.id, count: seen[g.id], label: g.label, icon: g.icon }; });
  }

  /* The sorts offered on the Activity log. No "biggest amount" — an activity row has no amount —
     and a PANEL sort instead, which is the one an owner asks for after "printer": "show me
     everything the kitchen screen did". Every comparator ends in the same total tie-break. */
  var ACTIVITY_SORTS = [
    { id: "new", label: "Newest first", cmp: function (a, b) { return (whenA(b) - whenA(a)) || tieA(a, b); } },
    { id: "old", label: "Oldest first", cmp: function (a, b) { return (whenA(a) - whenA(b)) || tieA(a, b); } },
    { id: "person", label: "Person (A–Z)", cmp: function (a, b) {
      return txt(a.actor).localeCompare(txt(b.actor)) || (whenA(b) - whenA(a)) || tieA(a, b); } },
    { id: "panel", label: "Panel (A–Z)", cmp: function (a, b) {
      return txt(a.panel).localeCompare(txt(b.panel)) || (whenA(b) - whenA(a)) || tieA(a, b); } },
    { id: "kind", label: "Type (A–Z)", cmp: function (a, b) {
      var A = (GROUP_BY_ID[groupOfRow(a)] || {}).label || "", B = (GROUP_BY_ID[groupOfRow(b)] || {}).label || "";
      return txt(A).localeCompare(txt(B)) || (whenA(b) - whenA(a)) || tieA(a, b); } },
    { id: "restaurant", label: "Restaurant (A–Z)", cmp: function (a, b) {
      return txt(a.restaurant_name).localeCompare(txt(b.restaurant_name)) || (whenA(b) - whenA(a)) || tieA(a, b); } },
  ];
  /* An activity row's time is 'created_at', not 'at' — one field name apart from the Audit's, which
     is exactly the kind of thing that makes a shared comparator quietly sort by nothing. */
  var whenA = function (r) { var t = Date.parse((r && (r.created_at || r.at)) || ""); return isFinite(t) ? t : 0; };
  var tieA = function (a, b) { return num(b.id) - num(a.id); };
  var activitySortById = function (id) {
    for (var i = 0; i < ACTIVITY_SORTS.length; i++) if (ACTIVITY_SORTS[i].id === id) return ACTIVITY_SORTS[i];
    return ACTIVITY_SORTS[0];
  };

  /** Search across what an activity row SHOWS — the action, the detail, the person, the panel, the
   *  table, the restaurant, and the group's own words (so typing "printer" finds the printer rows
   *  even though no row contains that word). */
  function activityMatches(r, needle) {
    var q = txt(needle);
    if (!q) return true;
    var g = GROUP_BY_ID[groupOfRow(r)] || {};
    var bits = [
      r.action, String(r.action || "").replace(/_/g, " "), r.detail, r.actor, r.panel,
      r.table_number ? "table " + r.table_number : "", r.restaurant_name, g.label,
    ];
    for (var i = 0; i < bits.length; i++) if (bits[i] && txt(bits[i]).indexOf(q) >= 0) return true;
    return false;
  }

  /** Filter by group + search, then sort — the same one-call pipeline as the Audit's view(). */
  function activityView(rows, opts) {
    var o = opts || {};
    var out = (rows || []).filter(function (r) {
      if (o.group && groupOfRow(r) !== o.group) return false;
      return activityMatches(r, o.q);
    });
    return out.slice().sort(activitySortById(o.sort).cmp);
  }

  var API = {
    KIND_LABEL: KIND_LABEL,
    KIND_RISK: KIND_RISK,
    riskOf: function (kind) { return KIND_RISK[kind] || "record"; },
    KIND_ICON: KIND_ICON,
    // ── the TAGS (owner, 2026-08-18) — the client half of lfh_audit_tags() ─────────────────────
    KIND_TAGS: KIND_TAGS,
    TAG_LABEL: TAG_LABEL,
    TAG_ICON: TAG_ICON,
    tagsOf: tagsOf,
    tagCountsFrom: tagCountsFrom,
    tagLabel: function (t) { return TAG_LABEL[t] || t; },
    tagIcon: function (t) { return TAG_ICON[t] || "\u2022"; },
    REASON_LABEL: REASON_LABEL,
    SORTS: SORTS,
    DEFAULT_SORT: DEFAULT_SORT,
    sortById: sortById,
    sortRows: sortRows,
    kindCounts: kindCounts,
    kindCountsFrom: kindCountsFrom,
    matches: matches,
    view: view,
    sumAmount: sumAmount,
    // ── the ACTIVITY log's half (owner, 2026-08-14) ────────────────────────────────────────────
    ACTIVITY_GROUPS: ACTIVITY_GROUPS,
    ACTIVITY_SORTS: ACTIVITY_SORTS,
    ACTIVITY_DEFAULT_SORT: "new",
    activityGroupOf: activityGroupOf,
    activityGroupOfRow: groupOfRow,
    activityGroupLabel: function (id) { return (GROUP_BY_ID[id] || {}).label || id; },
    activityCounts: activityCounts,
    activityMatches: activityMatches,
    activityView: activityView,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof globalThis !== "undefined") globalThis.LFH_AUDITSORT = API;
  else if (typeof window !== "undefined") window.LFH_AUDITSORT = API;
})();
