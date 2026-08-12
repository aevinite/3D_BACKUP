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
  };
  /* The glyph each type wears, beside the words so the two cannot drift. Plain text symbols only —
     the manager panel renders these into its own markup and a couple of its rows print to paper. */
  var KIND_ICON = {
    order_cancelled: "\uD83C\uDFAB", order_deleted: "\uD83E\uDDFE", dish_removed: "\uD83C\uDF7D",
    qty_reduced: "\u2796", menu_item_deleted: "\uD83D\uDCD5", invoice_voided: "\u21A9\uFE0F",
    discount_given: "\uFF05", payment_reverted: "\u21BA", on_the_house: "\uD83C\uDF81",
    bill_changed_after_reopen: "\u21C4", order_restored: "\u267B\uFE0F",
  };
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

  var API = {
    KIND_LABEL: KIND_LABEL,
    KIND_ICON: KIND_ICON,
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
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof globalThis !== "undefined") globalThis.LFH_AUDITSORT = API;
  else if (typeof window !== "undefined") window.LFH_AUDITSORT = API;
})();
