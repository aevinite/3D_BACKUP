// Auto-fit big numbers — vanilla-panel sibling of components/FitNumber.tsx (owner rule
// 2026-07-26): a figure must never clip or spill out of its tile; when it outgrows the
// space its OWN font shrinks to fit, and it grows back when the value gets shorter.
//
// Usage: <script src="/panels/fitnums.js" data-fit=".extra,.selectors"></script> (load it
// like maint.js/realtime.js). Everything with class fit-num / attribute data-fit-num is
// always covered; the script tag's data-fit adds panel-specific selectors on top. Re-fits
// happen automatically after every re-render (MutationObserver) and on window resize;
// LFH_FITNUM.scan() forces a manual pass.
(function () {
  var extra = (document.currentScript && document.currentScript.getAttribute("data-fit")) || "";
  var SEL = ".fit-num,[data-fit-num]" + (extra ? "," + extra : "");

  function fit(el) {
    // Remember any inline font-size the template set, so the reset restores THAT, not "" —
    // wiping it would permanently shrink the element.
    if (el.dataset.lfhFitBase == null) el.dataset.lfhFitBase = el.style.fontSize || "";
    var cs = getComputedStyle(el);
    // clientWidth = available width, scrollWidth = full text width; their ratio is the
    // shrink factor. Inline elements report clientWidth 0 — make them measurable, capped
    // by their container. Single line only: wrapping would hide the overflow we measure.
    if (cs.display === "inline") { el.style.display = "inline-block"; el.style.maxWidth = "100%"; }
    // Single-line ONLY for pure-text numbers. A composite box (number + trend chip +
    // sparkline) keeps its normal wrapping so fixed-size decorations can drop to the next
    // line when tight — decorations can't shrink with the font, so forcing them onto the
    // number's line would either clip or crush the number for no gain. The font-shrink
    // below still kicks in when the NUMBER itself (one unbreakable token) is the wide part.
    if (el.childElementCount === 0 && cs.whiteSpace !== "nowrap") el.style.whiteSpace = "nowrap";
    el.style.fontSize = el.dataset.lfhFitBase; // reset so a shorter value grows back
    // Shrink by the OVERFLOW DELTA, not the content ratio: a box can hold fixed-size
    // decorations (trend chip, sparkline) next to the number — those never shrink with the
    // font, so a ratio-of-total loop grinds the number toward zero (the 3.8px-crush bug).
    // Removing just the missing pixels each pass converges on "number exactly small enough
    // that number + decorations fit". Up to 5 passes because the available width itself can
    // move in flex/grid layouts; +1 forgives sub-pixel rounding so a perfectly-fitting
    // number never jitters. MIN_PX is the readability floor — below ~9px a figure is
    // unreadable anyway, so clipping becomes the lesser evil and we stop.
    // A VALUE WE SHORTENED GOES BACK TO FULL BEFORE WE RE-MEASURE — BUT ONLY IF IT IS STILL OURS
    // (T9 sweep, 2026-08-17). This used to restore data-lfh-full whenever the attribute existed,
    // with no check that the text on screen was still the short form we wrote. So the moment a
    // panel updated that same element in place, the next scan pasted the OLD figure back over the
    // NEW one and re-shortened it — measured on a 70px tile: written "12", left reading "123 Cr",
    // permanently, and the font never grew back either. Comparing against the short form we
    // actually wrote means a value the panel has since changed is left exactly as the panel
    // wrote it.
    if (el.dataset.lfhFull) {
      if (el.textContent === el.dataset.lfhShort) setText(el, el.dataset.lfhFull);
      delete el.dataset.lfhFull; delete el.dataset.lfhShort; el.removeAttribute("title");
    }
    for (var pass = 0; pass < 5; pass++) {
      var over = el.scrollWidth - el.clientWidth;
      if (over <= 1) return;
      var w = el.getBoundingClientRect().width || 1;
      var cur = parseFloat(cs.fontSize) || 16; // cs is live — reads the current size
      var next = Math.max(MIN_PX, Math.floor(cur * ((w - over) / w) * 10) / 10);
      if (next >= cur) return;
      el.style.fontSize = next + "px";
      if (next === MIN_PX) break;
    }
  // WHEN SHRINKING RUNS OUT, SHORTEN THE NUMBER — do not crush it (owner, 2026-08-15).
  // The floor used to be 9px and the loop simply stopped there and let the figure clip: the
  // BIGGEST number on the page became the smallest text in the product, which is backwards.
  // Now the floor is a readable 11px, and a figure that still does not fit is rewritten in the
  // Indian short form (₹84.5 L, ₹3.08 Cr) with the exact value kept on the title attribute and
  // in data-lfh-full, so nothing is lost and hovering still shows it.
  //
  // SAFE BECAUSE OF WHERE THIS RUNS: the selector list is opt-in classes plus DASHBOARD stat
  // tiles. A bill is never in that net and MUST NEVER BE — on a bill the exact figure is the
  // law, and an abbreviated total is not a rounding preference, it is a wrong document. If a
  // bill selector is ever added here, this abbreviation has to be gated off first.
    if (el.scrollWidth - el.clientWidth > 1 && el.childElementCount === 0 && !isExact(el)) {
      var full = el.textContent, sh = shortIndian(full);
      if (sh && sh.length < full.length) {
        el.dataset.lfhFull = full; el.dataset.lfhShort = sh; el.title = full; setText(el, sh);
      }
    }
  }

  // WHERE THE EXACT FIGURE IS THE LAW (T9 sweep, 2026-08-17).
  //
  // The note above says a bill is never in this net and MUST NEVER BE, and that if a bill
  // selector were ever added the abbreviation would have to be gated off first. Four of them had
  // been added and the gate had not: measured on the manager's Bills tab, an order total renders
  // in a 64-pixel box, and a total of ₹1,23,45,678 came out of this function reading "₹1.2 Cr".
  // A rounded total is not a tidier bill, it is a different bill.
  //
  // So money that IS a document — an order total, a bill amount, a cart total, a khata balance —
  // shrinks to the 11px floor and then stops, clipping if it must, because a clipped exact figure
  // is recoverable (the person can widen, zoom, or open the bill) and a rounded one is not.
  // Dashboard stat tiles are untouched: those are summaries, and shortening them is the behaviour
  // the owner asked for on 2026-08-15. `data-fit-exact` is the escape hatch, so a panel added
  // later can say "mine is a document too" without editing this file.
  var EXACT_SEL = "[data-fit-exact],.bill-amt,.ks-val,.ordtotal,.ctotal,.ord-total,.inv-money";
  function isExact(el) {
    try { return !!(el.closest && el.closest(EXACT_SEL)); } catch (e) { return false; }
  }

  // OUR OWN TEXT WRITES MUST NOT FEED THE OBSERVER (T9 sweep, 2026-08-17).
  //
  // The observer watches childList + characterData, and the note by boot() says our writes never
  // re-trigger it because we only touch style and data-* — which stopped being true the day this
  // file learned to rewrite the text. One abbreviated figure therefore kept a full scan running on
  // EVERY animation frame for as long as the panel was open: measured at 482 text mutations in two
  // seconds on one element, on a kitchen tablet that is left on all shift. `writing` makes the
  // observer ignore the change we made ourselves, which is what the comment always claimed.
  // The observer delivers its records on a LATER microtask, so a plain in-progress flag would
  // already be back to false by then. Instead we remember which elements WE wrote to, and the
  // callback ignores a batch that contains nothing else. A batch that also carries the panel's
  // own changes still schedules a scan — dropping those would be the opposite fault.
  var selfNodes = new Set();
  function setText(el, s) { selfNodes.add(el); el.textContent = s; }
  function shortIndian(txt) {
    var m = String(txt).match(/^(\D*)([\d,]+(?:\.\d+)?)(.*)$/);
    if (!m) return null;
    var n = parseFloat(m[2].replace(/,/g, ""));
    if (!isFinite(n) || n < 1000) return null;
    var v, suf;
    if (n >= 1e7) { v = n / 1e7; suf = " Cr"; }
    else if (n >= 1e5) { v = n / 1e5; suf = " L"; }
    else { v = n / 1e3; suf = "K"; }
    var s = v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
    return m[1] + s + suf + m[3];
  }
  var MIN_PX = 11;

  function scan(root) {
    var host = root && root.querySelectorAll ? root : document;
    var list = host.querySelectorAll(SEL);
    for (var i = 0; i < list.length; i++) fit(list[i]);
  }

  // One scan per frame at most — panels re-render whole boards via innerHTML, so mutations
  // arrive in bursts. We write style/data-* (attributes), which the observer does not watch, and
  // the ONE place we write text goes through setText(), which raises `writing` so the change we
  // made ourselves is ignored here. Without that this file feeds itself a mutation every frame,
  // for ever — see the note on setText().
  var raf = 0;
  function queue(records) {
    var mine = records && records.length && records.every(function (r) {
      var t = r.target && r.target.nodeType === 3 ? r.target.parentNode : r.target;
      return t && selfNodes.has(t);
    });
    selfNodes.clear();
    if (mine) return;                       // our own rewrite — scanning it again is the loop
    if (!raf) raf = requestAnimationFrame(function () { raf = 0; scan(); });
  }

  function boot() {
    new MutationObserver(queue).observe(document.body, {
      childList: true, subtree: true, characterData: true,
    });
    scan();
  }
  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot);
  window.addEventListener("resize", queue);

  window.LFH_FITNUM = { scan: scan, fit: fit };
})();
