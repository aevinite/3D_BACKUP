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
    SORTS: SORTS,
    DEFAULT_SORT: DEFAULT_SORT,
    sortById: sortById,
    sortRows: sortRows,
    kindCounts: kindCounts,
    matches: matches,
    view: view,
    sumAmount: sumAmount,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof globalThis !== "undefined") globalThis.LFH_AUDITSORT = API;
  else if (typeof window !== "undefined") window.LFH_AUDITSORT = API;
})();
