// swipehint.js — "there is more this way" on a row that scrolls sideways.
//
// WHY (T12 phone sweep, 2026-08-13; owner: "we can impliment 2nd one"). Several rows in the panels
// slide sideways and at 360px the next item is sliced off with a hard straight edge — the take-order
// category strip shows 3 of 9 categories and says nothing about the other 6. A straight cut reads as
// a rendering fault, not as an invitation to swipe. This adds two honest signals:
//
//   · a soft FADE on whichever edge has more content behind it (both edges once you're mid-row);
//   · an optional COUNT chip — "→ 6 more" — for a row that asks for it with data-swipe-count,
//     matching the floor grid's own "→ 15 more tables" chip, which is the pattern he already has.
//
// It is deliberately dumb about layout: it only sets data-more="start|end|both" on the row and lets
// CSS do the painting, so a row can opt out of the fade and keep the count, or the other way round.
//
//   <div class="cats" data-swipe-hint data-swipe-count>…</div>
//
// Rows are found by attribute, re-scanned when the panel re-renders (MutationObserver), and each
// row is measured on scroll/resize with rAF coalescing — no polling, no layout thrash on a rush.
(function () {
  "use strict";
  if (window.LFH_SWIPE) return;

  var EPS = 2;            // sub-pixel slack: a row scrolled to its end can be 0.5px short
  var watched = new WeakSet();

  function countChip(row) {
    if (row.dataset.swipeCount == null) return null;
    var chip = row.__lfhChip;
    if (chip && chip.parentNode) return chip;
    chip = document.createElement("button");
    chip.type = "button";
    chip.className = "lfh-swipe-more";
    chip.setAttribute("aria-hidden", "true");   // the row itself is already reachable by swipe/keys
    chip.tabIndex = -1;
    // Built as nodes, not innerHTML: the count is our own integer, but this file is loaded by four
    // panels and "it was only a number" is how an innerHTML habit spreads to somewhere it matters.
    chip.append(document.createTextNode("→ "), document.createElement("b"), document.createTextNode(" more"));
    // Tapping it scrolls one screenful, which is what the floor's own "more" chip does.
    chip.addEventListener("click", function () {
      try { row.scrollBy({ left: Math.max(120, row.clientWidth * 0.8), behavior: "smooth" }); } catch (e) { row.scrollLeft += 160; }
    });
    row.__lfhChip = chip;
    // The chip is a SIBLING, not a child: inside the scroller it would scroll away with the content.
    if (row.parentNode) {
      if (getComputedStyle(row.parentNode).position === "static") row.parentNode.style.position = "relative";
      row.parentNode.appendChild(chip);
    }
    return chip;
  }

  // How many whole children are still off the right-hand edge — the number the chip prints.
  function hiddenAtEnd(row) {
    var right = row.scrollLeft + row.clientWidth + EPS, n = 0;
    for (var i = 0; i < row.children.length; i++) {
      var c = row.children[i];
      if (c === row.__lfhChip) continue;
      if (c.offsetLeft + c.offsetWidth > right) n++;
    }
    return n;
  }

  function measure(row) {
    // A row that CANNOT scroll gets neither signal. The take-order category box is a grid with
    // overflow:hidden on desktop (it fits every category by design) and a sideways strip only on a
    // phone — a fade there would promise a swipe that does nothing, and the chip's own tap would be
    // a silent no-op, which is the one thing the tap rule forbids.
    var ox = getComputedStyle(row).overflowX;
    if (ox !== "auto" && ox !== "scroll") { row.removeAttribute("data-more"); if (row.__lfhChip) row.__lfhChip.hidden = true; return; }
    var over = row.scrollWidth - row.clientWidth;
    if (over <= EPS) { row.removeAttribute("data-more"); if (row.__lfhChip) row.__lfhChip.hidden = true; return; }
    var atStart = row.scrollLeft <= EPS;
    var atEnd = row.scrollLeft >= over - EPS;
    row.setAttribute("data-more", atStart ? "end" : atEnd ? "start" : "both");
    var chip = countChip(row);
    if (chip) {
      var n = hiddenAtEnd(row);
      chip.hidden = n <= 0;
      if (n > 0) chip.querySelector("b").textContent = String(n);
    }
  }

  function watch(row) {
    if (!row || watched.has(row)) return;
    watched.add(row);
    var queued = false;
    var run = function () {
      queued = false;
      try { measure(row); } catch (e) { /* a row that vanished mid-frame is not a problem */ }
    };
    var kick = function () { if (!queued) { queued = true; requestAnimationFrame(run); } };
    row.addEventListener("scroll", kick, { passive: true });
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(kick).observe(row);
    // The content itself changes (a category list arrives, a filter chip is added) — remeasure.
    if (typeof MutationObserver !== "undefined") new MutationObserver(kick).observe(row, { childList: true });
    kick();
  }

  function scan(root) {
    var host = root && root.querySelectorAll ? root : document;
    var rows = host.querySelectorAll("[data-swipe-hint]");
    for (var i = 0; i < rows.length; i++) watch(rows[i]);
  }

  window.LFH_SWIPE = { watch: watch, scan: scan, measure: measure };

  function start() {
    scan(document);
    // The panels re-render whole tabs, so new rows appear without a page load.
    if (typeof MutationObserver !== "undefined") {
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (n.nodeType !== 1) continue;
            if (n.hasAttribute && n.hasAttribute("data-swipe-hint")) watch(n);
            if (n.querySelectorAll) scan(n);
          }
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    }
    window.addEventListener("orientationchange", function () { scan(document); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
