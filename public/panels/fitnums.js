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
    // a value that was shortened before must go back to full before we re-measure
    if (el.dataset.lfhFull) { el.textContent = el.dataset.lfhFull; delete el.dataset.lfhFull; el.removeAttribute("title"); }
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
    if (el.scrollWidth - el.clientWidth > 1 && el.childElementCount === 0) {
      var full = el.textContent, sh = shortIndian(full);
      if (sh && sh.length < full.length) { el.dataset.lfhFull = full; el.textContent = sh; el.title = full; }
    }
  }
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
  // arrive in bursts. We only write style/data-* (attributes) while the observer watches
  // childList/characterData, so our own writes never re-trigger it.
  var raf = 0;
  function queue() {
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
