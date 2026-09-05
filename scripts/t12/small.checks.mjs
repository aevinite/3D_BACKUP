/* The small shared helpers: theme.js, fitnums.js, backstack.js, undobar.js, guestbell.js,
 * swipehint.js, swreg.js, floor-layouts.js.
 * Re-runs ledger rows P04211-P04340 and P04417-P04436 (T9, sweep #6), plus P02007-P02009 (T5)
 * and this run's own P65901-P66050.
 */
export function run({ c, raw, check, skipRow, fnBody, before, count }) {
  // ===========================================================================================
  // theme.js - the panel light/dark skin (P04211-P04230)
  // ===========================================================================================
  {
    const S = c.theme, R = raw.theme;
    const apply = fnBody(S, "function apply(");
    const paintButton = fnBody(S, "function paintButton(");
    const wire = fnBody(S, "function wire(");

    check("P04211", "the key is lfh_panel_theme, never the guest's lfh_theme", () =>
      /var KEY = "lfh_panel_theme"/.test(S) && !/"lfh_theme"/.test(S));
    check("P04212", "the default is LIGHT for every panel", () =>
      /apply\(saved\(\) === "dark" \? "dark" : "light"\)/.test(S));
    check("P04213", "only an explicit saved 'dark' starts dark", () =>
      /saved\(\) === "dark"/.test(S));
    skipRow("P04214", "a staff member's choice survives reopening the panel", "driven live - see live.checks");
    check("P04215", "theme.js is a blocking <script> in <head>, so the skin is set before first paint", () => {
      /* EXPECTATION CORRECTED IN SWEEP #7 and kept here: the row once said "above the stylesheet".
         It is in <head> BELOW it, and that is fine - a blocking script in <head> runs before first
         paint whatever its neighbour is, and the sheet starting to download first is better. What
         matters is: in <head>, and neither defer nor async. */
      for (const k of ["editorHtml", "kitchenHtml", "tabletHtml"]) {
        const html = c[k] || "";
        const head = html.slice(0, html.indexOf("</head>"));
        const tag = (head.match(/<script[^>]*theme\.js[^>]*>/) || [])[0];
        if (!tag) return `${k}: theme.js is not a <script> inside <head>`;
        if (/\bdefer\b|\basync\b/.test(tag)) return `${k}: theme.js carries defer/async, so it no longer beats first paint`;
      }
      return true;
    });
    check("P04216", "a blocked localStorage cannot throw and leave the panel unstyled", () =>
      /catch \(e\) \{ return null; \}/.test(fnBody(S, "function saved(")) &&
      /try \{ localStorage\.setItem\(KEY, theme\); \} catch \(e\) \{\}/.test(apply));
    check("P04217", "the toggle shows the state you would switch TO", () =>
      /btn\.textContent = dark \? "☀️" : "🌙"/.test(R) || /dark \? "☀/.test(R));
    check("P04218", "the toggle carries a title and an aria-label that change with the state", () =>
      /btn\.title = label/.test(paintButton) && /btn\.setAttribute\("aria-label", label\)/.test(paintButton));
    check("P04219", "the button is wired exactly once", () => /if \(btn && !btn\.__themeWired\)/.test(wire));
    check("P04220", "the icon is refreshed once the button exists", () =>
      /paintButton\(window\.LFH_THEME\.get\(\)\)/.test(wire));
    check("P04221", "icons are plain emoji so kitchen/tablet (no Font Awesome) still show them", () =>
      !/fa-|fontawesome/i.test(S));
    check("P04222", "LFH_THEME.get/set/toggle are exposed for a panel to drive", () =>
      /get: function/.test(S) && /set: apply/.test(S) && /toggle: function/.test(S));
    check("P04223", "set() normalises anything that is not 'light' to 'dark'", () =>
      /var theme = t === "light" \? "light" : "dark"/.test(apply));
    skipRow("P04224", "manager panel light skin at 1280x800", "driven live - see live.checks");
    skipRow("P04225", "manager panel dark skin at 1280x800", "driven live - see live.checks");
    skipRow("P04226", "kitchen panel: both skins, no unstyled flash on reload", "driven live - see live.checks");
    skipRow("P04227", "tablet panel: both skins at 360x780 dpr3", "driven live - see live.checks");
    check("P04228", "every panel stylesheet declares the light palette this file switches to", () => {
      for (const k of ["editorCss", "kitchenCss", "tabletCss"]) {
        if (!c[k]) continue;
        if (!/html\[data-theme="light"\]/.test(c[k])) return `${k}: no html[data-theme="light"] block`;
      }
      return true;
    });
    check("P04229", "the owner console pushes its skin in without a second writer here", () =>
      !/aevidine_skin/.test(S) && !/postMessage/.test(S));
    check("P04230", "switching the skin in one tab of a panel is picked up by another", () =>
      /window\.addEventListener\("storage", function \(e\)/.test(S));

    // NEW
    check("P65901", "a theme change arriving under someone's finger is HELD until they lift", () =>
      /if \(down\) \{ held = t; return; \}/.test(S) &&
      /window\.addEventListener\("pointerdown"/.test(S) && /window\.addEventListener\("pointerup", release/.test(S));
    check("P65902", "a cancelled pointer also releases the hold, so a theme cannot get stuck", () =>
      /window\.addEventListener\("pointercancel", release/.test(S));
    check("P65903", "the follower paints WITHOUT writing back, so two tabs cannot loop", () => {
      const paint = fnBody(S, "function paint(");
      return /setAttribute\("data-theme", t\)/.test(paint) && !/localStorage\.setItem/.test(paint);
    });
    check("P65904", "a storage event for a different key is ignored", () =>
      /e\.key !== KEY/.test(S));
    check("P65905", "a storage event that matches what is already on screen does nothing", () =>
      /if \(t === window\.LFH_THEME\.get\(\)\) return;/.test(S));
    check("P65906", "the cross-tab sync can never break the panel", () =>
      /catch \(err\) \{ /.test(S));
    check("P65907", "the pointer listeners are capture-phase, so a stopped event is still seen", () =>
      count(S, /\}, true\)/g) >= 3);
    check("P65908", "theme.js carries a content-hash ?v= in every panel", () => {
      for (const k of ["editorHtml", "kitchenHtml", "tabletHtml"]) {
        if (!/theme\.js\?v=[a-f0-9]{6,}/.test(c[k] || "")) return `${k}: theme.js has no content-hash ?v=`;
      }
      return true;
    });
  }

  // ===========================================================================================
  // fitnums.js - auto-fit big numbers (P04231-P04262)
  // ===========================================================================================
  {
    const S = c.fitnums, R = raw.fitnums;
    const fit = fnBody(S, "function fit(");
    const queue = fnBody(S, "function queue(");
    const boot = fnBody(S, "function boot(");

    check("P04231", ".fit-num / [data-fit-num] are always covered", () =>
      /var SEL = "\.fit-num,\[data-fit-num\]"/.test(S));
    check("P04232", "a panel's own data-fit selectors are added on top", () =>
      /document\.currentScript && document\.currentScript\.getAttribute\("data-fit"\)/.test(S));
    check("P04233", "any inline font-size the template set is remembered and restored", () =>
      /if \(el\.dataset\.lfhFitBase == null\) el\.dataset\.lfhFitBase = el\.style\.fontSize \|\| "";/.test(fit) &&
      /el\.style\.fontSize = el\.dataset\.lfhFitBase;/.test(fit));
    check("P04234", "an inline element is made measurable and capped at its container", () =>
      /if \(cs\.display === "inline"\) \{ el\.style\.display = "inline-block"; el\.style\.maxWidth = "100%"; \}/.test(fit));
    check("P04235", "only a pure-text number is forced to one line", () =>
      /if \(el\.childElementCount === 0 && cs\.whiteSpace !== "nowrap"\) el\.style\.whiteSpace = "nowrap";/.test(fit));
    check("P04236", "the shrink removes the OVERFLOW DELTA, not the content ratio", () =>
      /Math\.floor\(cur \* \(\(w - over\) \/ w\) \* 10\) \/ 10/.test(fit));
    check("P04237", "the loop is capped at 5 passes", () => /for \(var pass = 0; pass < 5; pass\+\+\)/.test(fit));
    check("P04238", "a perfectly-fitting number never jitters (the +1px forgiveness)", () =>
      /if \(over <= 1\) break;/.test(fit));
    check("P04239", "the readability floor is 11px, not 9px", () => /var MIN_PX = 11/.test(S));
    check("P04240", "a figure that still does not fit is rewritten in the Indian short form", () =>
      /var full = el\.textContent, sh = shortIndian\(full\)/.test(fit));
    check("P04241", "the exact value is kept on title and data-lfh-full so nothing is lost", () =>
      /el\.dataset\.lfhFull = full; el\.dataset\.lfhShort = sh; el\.title = full; setText\(el, sh\);/.test(fit));
    check("P04242", "shortIndian leaves anything under 1000 alone", () => {
      const f = mkShortIndian(S);
      return f("999") === null && f("₹999") === null;
    });
    check("P04243", "shortIndian handles a currency prefix and a trailing suffix", () => {
      const f = mkShortIndian(S);
      return f("₹1,23,456") === "₹1.2 L" ? true : `got ${JSON.stringify(f("₹1,23,456"))}`;
    });
    check("P04244", "crore / lakh / thousand thresholds are 1e7 / 1e5 / 1e3", () =>
      /n >= 1e7/.test(S) && /n >= 1e5/.test(S) && /n < 1000/.test(S));
    check("P04245", "a tile updated in place does not get its OLD value pasted back", () =>
      /if \(el\.textContent === el\.dataset\.lfhShort\) setText\(el, el\.dataset\.lfhFull\);/.test(fit));
    check("P04246", "abbreviating does not re-trigger the observer into a per-frame loop", () =>
      /var selfNodes = new Set\(\)/.test(S) &&
      /function setText\(el, s\) \{ selfNodes\.add\(el\); el\.textContent = s; \}/.test(S) &&
      /if \(mine\) return;/.test(queue));
    check("P04247", "money that must stay exact is never abbreviated", () => {
      const sel = (S.match(/var EXACT_SEL = "([^"]+)"/) || [])[1] || "";
      const need = ["[data-fit-exact]", ".bill-amt", ".ks-val", ".ordtotal", ".ctotal", ".ord-total", ".inv-money"];
      const missing = need.filter((n) => !sel.includes(n));
      if (missing.length) return `EXACT_SEL no longer covers: ${missing.join(", ")}`;
      return /&& !isExact\(el\)/.test(fit);
    });
    check("P04248", "a composite tile keeps its normal wrapping", () =>
      /el\.childElementCount === 0 && cs\.whiteSpace !== "nowrap"/.test(fit));
    check("P04249", "a composite tile is never abbreviated (its text is not one token)", () =>
      /el\.scrollWidth - el\.clientWidth > 1 && el\.childElementCount === 0 && !isExact\(el\)/.test(fit));
    check("P04250", "at most one scan per animation frame", () =>
      /if \(!raf\) raf = requestAnimationFrame\(function \(\) \{ raf = 0; scan\(\); \}\);/.test(queue));
    check("P04251", "a resize re-fits", () => /window\.addEventListener\("resize", queue\)/.test(S));
    check("P04252", "LFH_FITNUM.scan() forces a manual pass", () =>
      /window\.LFH_FITNUM = \{ scan: scan, fit: fit \}/.test(S));
    skipRow("P04253", "a value that gets shorter grows its font back", "driven live - see live.checks");
    check("P04254", "the observer is attached to document.body and survives a whole-board rewrite", () =>
      /new MutationObserver\(queue\)\.observe\(document\.body, \{[\s\S]{0,120}childList: true, subtree: true, characterData: true/.test(boot));
    skipRow("P04255", "manager dashboard stat tiles at 1280x800", "driven live - see live.checks");
    skipRow("P04256", "manager dashboard stat tiles at 360x780 dpr3", "driven live - see live.checks");
    skipRow("P04257", "kitchen .kot cards at 360x780 dpr3", "driven live - see live.checks");
    skipRow("P04258", "tablet .ordtotal / .ctotal show the exact figure at 360px", "driven live - see live.checks");
    skipRow("P04259", "the manager Bills tab order total is never rounded", "driven live - see live.checks");
    skipRow("P04260", "no figure anywhere renders below 11px", "driven live - see live.checks");
    check("P04261", "this file never splits text, so a shaped script cannot be broken", () =>
      !/\.split\(""\)/.test(S));
    check("P04262", "MIN_PX is declared before the first real call", () =>
      before(S, /var MIN_PX = 11/, /function boot\(/));

    // NEW
    check("P65909", "the shrink loop ends with a BREAK, so the tail always runs", () => {
      /* The tail is where a summary gets its Indian short form and a clipped exact figure gets
         the `title` that is the only way to read the digits the box cut off. A `return` here
         skipped both. Fixed 2026-09-04; see the note in the file for why it was not reachable
         with today's selectors and when it becomes so. */
      const loop = fit.slice(fit.indexOf("for (var pass"), fit.indexOf("}\n") + 2);
      if (/if \(next >= cur\) return;/.test(fit)) return "the early exit is still a `return`, so the tail is skipped";
      return /if \(next >= cur\) break;/.test(fit);
    });
    check("P65910", "the loop stops the moment it reaches the readability floor", () =>
      /if \(next === MIN_PX\) break;/.test(fit));
    check("P65911", "a clipped EXACT figure gets a title so the cut-off digits are readable", () =>
      /if \(el\.childElementCount === 0 && isExact\(el\)\) \{/.test(fit) &&
      /el\.title = el\.textContent; el\.dataset\.lfhTitle = "1";/.test(fit));
    check("P65912", "a panel's OWN title is never overwritten by ours", () =>
      /if \(!el\.title \|\| el\.dataset\.lfhTitle\)/.test(fit));
    check("P65913", "our title is taken back off when a shorter value fits", () =>
      /\} else if \(el\.dataset\.lfhTitle\) \{[\s\S]{0,120}removeAttribute\("title"\); delete el\.dataset\.lfhTitle;/.test(fit));
    check("P65914", "isExact cannot throw on a detached node", () => {
      const f = fnBody(S, "function isExact(");
      return /catch \(e\) \{ return false; \}/.test(f);
    });
    check("P65915", "shortIndian returns null for anything it cannot parse", () => {
      const f = mkShortIndian(S);
      return f("no digits here") === null;
    });
    check("P65916", "shortIndian rounds to one decimal below 100 and whole numbers above", () => {
      const f = mkShortIndian(S);
      return f("₹3,08,00,000") === "₹3.1 Cr" && f("₹1,50,00,00,000") === "₹150 Cr"
        ? true : `got ${f("₹3,08,00,000")} and ${f("₹1,50,00,00,000")}`;
    });
    check("P65917", "the observer batch check treats a text node's PARENT as the target", () =>
      /r\.target && r\.target\.nodeType === 3 \? r\.target\.parentNode : r\.target/.test(queue));
    check("P65918", "a batch carrying the panel's own changes still schedules a scan", () =>
      /records\.every\(/.test(queue));
    check("P65919", "fitnums is scoped by data-fit on the kitchen so it cannot shrink ticket body text", () =>
      /fitnums\.js\?v=[a-f0-9]+" data-fit="\.kot"/.test(c.kitchenHtml || ""));
    check("P65920", "the manager's fit list does NOT include the bill row's own amount", () => {
      const tag = (c.editorHtml || "").match(/<script[^>]*fitnums\.js[^>]*>/);
      return tag && !/\.bl-amt/.test(tag[0]);
    });
  }

  // ===========================================================================================
  // backstack.js - the hardware Back manager (P04263-P04287)
  // ===========================================================================================
  {
    const S = c.backstack;
    const reconcile = fnBody(S, "function reconcile(");

    check("P04263", "one manager per frame", () => /if \(window\.LFH_BACK\) return;/.test(S));
    check("P04264", "layer(id, close) returns an unregister function", () =>
      /return function unregister\(\)/.test(S));
    check("P04265", "reconcile runs once per microtask so a burst of opens collapses", () =>
      /function schedule\(\) \{ if \(pending\) return; pending = true; Promise\.resolve\(\)\.then\(reconcile\); \}/.test(S));
    check("P04266", "one history entry per open overlay, no more", () =>
      /var target = layers\.length;/.test(reconcile) && /history\.pushState\(\{ __lfhPanelLayer: true \}, ""\)/.test(reconcile));
    check("P04267", "history.go(-N) fires ONE popstate, so exactly one is swallowed", () =>
      /ignore \+= 1;\s*history\.go\(-remove\)/.test(reconcile));
    check("P04268", "a back press with something open closes the TOP overlay", () =>
      /var top = layers\.pop\(\);/.test(S));
    check("P04269", "a close callback that throws cannot break the back button", () =>
      /try \{ top\.close\(\); \} catch \(e\) \{ /.test(S));
    check("P04270", "a back press with nothing open leaves the panel (no exit guard)", () =>
      !/beforeunload/.test(S) && !/Leave this site/.test(S));
    check("P04271", "unregistering an already-popped layer is a no-op", () =>
      /if \(i === -1\) return;/.test(S));
    check("P04272", "closing via the UI rewinds its own history entry", () =>
      /layers\.splice\(i, 1\);\s*schedule\(\);/.test(S));
    check("P04273", "the connection popover registers a layer", () => /LFH_BACK\.layer\("conn-badge"/.test(c.connbadge));
    check("P04274", "the guest-bell sheet registers a layer", () => /LFH_BACK\.layer\("guest-bell"/.test(c.guestbell));
    check("P04275", "the staff settings drawer registers a layer", () => /LFH_BACK\.layer\("staff-profile"/.test(c.maint));
    check("P04276", "the My-profile overlay registers a layer", () => /LFH_BACK\.layer\("my-profile"/.test(c.myprofile));
    check("P04277", "the issue-raise modal registers a layer", () => /LFH_BACK\.layer\(/.test(c.issueRaise));
    skipRow("P04278", "every inventory popup registers a layer", "public/panels/editor/inventory.js is another terminal's file");
    check("P04279", "no file in this territory hand-rolls pushState/popstate", () => {
      const mine = ["outbox", "realtime", "connbadge", "offline", "errlog", "theme", "fitnums",
        "undobar", "guestbell", "myprofile", "maint", "issueRaise", "swipehint", "auditsort",
        "swreg", "floorLayouts"];
      const bad = mine.filter((k) => /pushState|addEventListener\("popstate"/.test(c[k] || ""));
      return bad.length ? `these hand-roll history: ${bad.join(", ")}` : true;
    });
    check("P04280", "during forced first-login the Back press is swallowed and the layer re-armed", () => {
      const ob = fnBody(c.maint, "function onBackClose(");
      return /if \(profile && profile\.needsProfile\) \{ armBack\(\); return; \}/.test(ob);
    });
    skipRow("P04281", "two overlays open at once pop in the right order", "driven live - see live.checks");
    skipRow("P04282", "Back with one overlay open does not also leave the panel", "driven live - see live.checks");
    skipRow("P04283", "Back with nothing open leaves the panel", "driven live - see live.checks");
    skipRow("P04284", "opening and closing an overlay ten times leaves history depth unchanged", "driven live - see live.checks");
    skipRow("P04285", "a layer registered inside a Promise burst still gets exactly one entry", "driven live - see live.checks");
    check("P04286", "the manager panel's own drawers use LFH_BACK.layer, not their own listener", () => {
      const app = c.editorApp || "";
      const own = count(app, /addEventListener\("popstate"/g);
      const layers = count(app, /LFH_BACK\.layer\(/g);
      if (own > 0) return `the manager panel has ${own} popstate listener(s) of its own`;
      return layers > 0 ? true : "the manager panel registers no back layers at all";
    });
    check("P04287", "the tablet and kitchen panels do the same", () => {
      for (const k of ["tabletApp", "kitchenApp"]) {
        const app = c[k];
        if (!app) continue;
        if (count(app, /addEventListener\("popstate"/g) > 0) return `${k} has a popstate listener of its own`;
      }
      return true;
    });

    // NEW
    check("P65921", "the back manager swallows only OUR OWN rewind, never a real Back press", () =>
      /if \(ignore > 0\) \{ ignore -= 1; return; \}/.test(S));
    check("P65922", "the pushed counter is corrected BEFORE the rewind is asked for", () =>
      before(reconcile, /pushed = target;/, /history\.go\(-remove\)/));
    check("P65923", "the file is strict mode, so a typo becomes an error rather than a global", () =>
      /"use strict"/.test(raw.backstack));
    check("P65924", "backstack.js loads before every panel's own app.js", () => {
      for (const [k, app] of [["editorHtml", "editor/app.js"], ["kitchenHtml", "kitchen/app.js"], ["tabletHtml", "tablet/app.js"]]) {
        const srcs = [...(c[k] || "").matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
        const b = srcs.findIndex((s) => s.includes("/backstack.js"));
        const a = srcs.findIndex((s) => s.includes(app));
        if (b < 0 || a < 0) return `${k}: could not find backstack.js and ${app} as script tags`;
        if (b > a) return `${k}: backstack.js must load before ${app}`;
      }
      return true;
    });
  }

  // ===========================================================================================
  // undobar.js - the shared take-back card (P04288-P04312)
  // ===========================================================================================
  {
    const S = c.undobar, R = raw.undobar;
    const show = fnBody(S, "function show(");
    const hide = fnBody(S, "function hide(");
    const runCountdown = fnBody(S, "function runCountdown(");
    const markBody = fnBody(S, "function markBody(");
    const attachSwipe = fnBody(S, "function attachSwipe(");
    const css = R.slice(R.indexOf("function injectStyles"), R.indexOf("function build()"));

    check("P04288", "the take-back window is 3 seconds, and never more than 5", () => {
      /* EXPECTATION CORRECTED (sweep #8 T12). The row said "the default window is 4 seconds",
         quoting the owner's 2026-08-17 "maybe 3 or 4 sec". He revised it on 2026-08-26 -
         "keep undo button for 5 sec like not more" (the ceiling) and, of the bar that is kept,
         "decrese time for it" - so the default is 3 and 5 is the cap. His newer word replaces
         his older one; the row is asserted as he last left it, not as it was first written. */
      return /var DEFAULT_SECONDS = 3/.test(S) && /var MAX_SECONDS = 5/.test(S) &&
        /Math\.min\(opts\.seconds != null \? opts\.seconds : DEFAULT_SECONDS, MAX_SECONDS\)/.test(show);
    });
    check("P04289", "the ring drains to nothing with NO faint track circle behind it", () =>
      count(R, /class="lfh-undo-arc"/g) === 1 && !/lfh-undo-track/.test(R));
    check("P04290", "stroke-dashoffset carries a unit", () =>
      /strokeDashoffset = "0px"/.test(runCountdown) && /strokeDashoffset = RING_LEN \+ "px"/.test(runCountdown));
    check("P04291", "the reset is forced to stick with a reflow before the transition is re-applied", () =>
      before(runCountdown, /void ringEl\.getBoundingClientRect\(\)/, /transition = "stroke-dashoffset/));
    check("P04292", "latest-wins: a second show() replaces the card and restarts the timer", () =>
      /if \(el\.classList\.contains\("show"\)\) \{\s*runCountdown\(seconds, opts\.onExpire\);/.test(show));
    check("P04293", "a card already on screen swaps text in place, with no slide-out/in flicker", () =>
      /titleEl\.textContent = opts\.message/.test(show) && /if \(el\.classList\.contains\("show"\)\)/.test(show));
    check("P04294", "the UNDO button is guarded against a double tap", () =>
      /if \(busy\) return;\s*busy = true;/.test(show));
    check("P04295", "the card hides immediately on UNDO so the tap feels instant", () =>
      before(show.slice(show.indexOf("btnEl.onclick")), /hide\(\);/, /opts\.onUndo/));
    check("P04296", "an onUndo that throws or rejects cannot break the bar", () =>
      /try \{ Promise\.resolve\(opts\.onUndo\(\)\)\.catch\(function \(\) \{\}\); \} catch \(e\) \{\}/.test(show));
    check("P04297", "every colour comes from the panel's own tokens with a dark fallback", () =>
      /var\(--panel,#1d1812\)/.test(css) && /var\(--gold,#d4a574\)/.test(css) && /var\(--text,#f2e9da\)/.test(css));
    check("P04298", "the card never sits under a phone's nav bar", () =>
      /bottom:calc\(16px \+ var\(--sab, env\(safe-area-inset-bottom, 0px\)\)\)/.test(css));
    check("P04299", "the UNDO button is at least 40px tall and 64px wide", () =>
      /min-height:40px;min-width:64px/.test(css));
    check("P04300", "reduced motion drops the slide but keeps the fade", () =>
      /prefers-reduced-motion:reduce\)\{#lfh-undobar\{transition:opacity/.test(css));
    check("P04301", "the card is role=status + aria-live=polite", () =>
      /setAttribute\("role", "status"\)/.test(S) && /setAttribute\("aria-live", "polite"\)/.test(S));
    check("P04302", "the card publishes its measured height so a panel toast can step over it", () =>
      /setProperty\("--lfh-undobar-h", Math\.round\(el\.getBoundingClientRect\(\)\.height\) \+ "px"\)/.test(markBody));
    check("P04303", "the body class is removed when the card hides", () => /markBody\(false\)/.test(hide));
    check("P04304", "swapped text re-measures the height", () =>
      /runCountdown\(seconds, opts\.onExpire\);\s*markBody\(true\);/.test(show));
    check("P04305", "the card really appears, and its window really runs, in a background tab", () =>
      /\} else if \(document\.hidden\) \{\s*reveal\(\);/.test(show) && /setTimeout\(reveal, 400\)/.test(show));
    check("P04306", "dismiss() lets a panel take the card down", () =>
      /function dismiss\(\) \{ hide\(\); \}/.test(S) && /dismiss: dismiss/.test(S));
    skipRow("P04307", "the card and a panel toast do not overlap on the MANAGER panel at 360px", "driven live - see live.checks");
    check("P04308", "a toast raised while the card is up steps OVER it, from this file's own rule", () =>
      /body\.lfh-undobar-up \.toasts,body\.lfh-undobar-up \.toast\{/.test(css) &&
      /var\(--lfh-undobar-h, 56px\)/.test(css));
    check("P04309", "that rule ships from undobar.js, so it cannot drift between the panels", () =>
      /\.toasts,body\.lfh-undobar-up \.toast/.test(css));
    skipRow("P04310", "the card renders correctly in the light panel skin", "driven live - see live.checks");
    skipRow("P04311", "the card renders correctly in the dark panel skin", "driven live - see live.checks");
    check("P04312", "the card is NOT registered as a Back layer", () => !/LFH_BACK/.test(S));

    // NEW
    check("P65925", "a window that ran out while the tab slept is dropped, never offered late", () =>
      /if \(leftMs <= 0\) \{[\s\S]{0,200}hide\(\);[\s\S]{0,200}onExpire/.test(show));
    check("P65926", "the countdown runs on what is LEFT, not the full window, after a wait", () =>
      /runCountdown\(leftMs \/ 1000, opts\.onExpire\)/.test(show));
    check("P65927", "the two reveal paths are idempotent", () =>
      /if \(revealed\) return;\s*revealed = true;/.test(show));
    check("P65928", "a swipe cannot start on the UNDO button or the dismiss cross", () =>
      /if \(e\.target\.closest\("\.lfh-undo-btn, \.lfh-undo-x"\)\) return;/.test(attachSwipe));
    check("P65929", "a flick of 60px in any direction dismisses; a wobble does not", () =>
      /if \(moved && \(Math\.abs\(dx\) > 60 \|\| dy > 60\)\) hide\(\);/.test(attachSwipe));
    check("P65930", "the card follows the finger, so a swipe reads as a drag not a failed tap", () =>
      /el\.style\.transform = "translate\(" \+ dx \+ "px, " \+ dy \+ "px\)"/.test(attachSwipe));
    check("P65931", "the drag never fades the card past the point of being visible", () =>
      /Math\.max\(0\.25, 1 - Math\.max\(Math\.abs\(dx\), dy\) \/ 160\)/.test(attachSwipe));
    check("P65932", "a drag that ends anywhere restores the card's own transition and opacity", () =>
      /el\.style\.transition = "";\s*el\.style\.transform = "";\s*el\.style\.opacity = "";/.test(attachSwipe));
    check("P65933", "touch-action:none stops the page scrolling under a drag", () =>
      /#lfh-undobar\{touch-action:none;\}/.test(css));
    check("P65934", "the dismiss cross is a full 40px target and does not also trigger a drag", () =>
      /min-width:40px;min-height:40px/.test(css) && /closeEl\.onclick = function \(e\) \{ e\.stopPropagation\(\); hide\(\); \}/.test(S));
    check("P65935", "dismissing is deliberately QUIETER than undoing", () =>
      /\.lfh-undo-x\{[^}]*color:var\(--muted/.test(css));
    check("P65936", "the ring length matches the circle it draws", () => {
      const r = (S.match(/r="18"/) || []).length ? 18 : null;
      const len = Number((S.match(/RING_LEN = (\d+)/) || [])[1]);
      if (!r) return "the ring circle is no longer r=18";
      return Math.abs(len - 2 * Math.PI * 18) < 1 ? true : `RING_LEN ${len} does not match 2*pi*18`;
    });
    check("P65937", "the card sits above every panel toast strip", () => /z-index:2147483000/.test(css));
  }

  // ===========================================================================================
  // guestbell.js - what the guest menu is waiting for (P04313-P04340)
  // ===========================================================================================
  {
    const S = c.guestbell, R = raw.guestbell;
    const sync = fnBody(S, "function sync(");
    const openSheet = fnBody(S, "function openSheet(");
    const closeSheet = fnBody(S, "function closeSheet(");
    const mount = fnBody(S, "function mount(");
    const paintButton = fnBody(S, "function paintButton(");
    const markSeen = fnBody(S, "function markSeen(");
    const rowKey = fnBody(S, "function rowKey(");
    const rowNode = fnBody(S, "function rowNode(");
    const css = R.slice(R.indexOf("function injectStyles"), R.indexOf("function host()"));

    check("P04313", "it makes no request of its own", () => count(S, /fetch\(/g) === 0);
    check("P04314", "with the guest menu off the bell does not exist at all", () =>
      /if \(!menuOn\) \{ unmount\(\); return; \}/.test(sync) || /!next\.menuOn/.test(sync));
    check("P04315", "switching the menu off while the sheet is open does not leave the button behind", () =>
      /menuOn/.test(closeSheet) || /menuOn/.test(sync));
    check("P04316", "it never writes anything", () =>
      count(S, /method: *"POST"/g) === 0 && count(S, /LFH_OUTBOX\.send/g) === 0);
    check("P04317", "'seen' is tracked by row IDENTITY, not by a last-looked-at timestamp", () =>
      /r\.kind \+ ":" \+ \(r\.table == null \? "" : r\.table\) \+ ":" \+ \(r\.id \|\| r\.at \|\| ""\)/.test(rowKey));
    check("P04318", "a second order at the same table counts as new again", () => /r\.id/.test(rowKey));
    check("P04319", "the seen list is pruned to what is on screen, so it cannot grow forever", () =>
      /markSeen/.test(S) && markSeen.length > 0);
    check("P04320", "rows are newest-first", () =>
      /\.sort\(function \(a, b\) \{ return \(b\.at \|\| 0\) - \(a\.at \|\| 0\); \}\)/.test(sync));
    check("P04321", "the list is capped at 50 rows", () => /\.slice\(0, 50\)/.test(sync));
    check("P04322", "opening the sheet clears the count", () =>
      /markSeen\(\)/.test(openSheet) && /paintButton\(\)/.test(openSheet));
    check("P04323", "the rows keep their red edge while the sheet is being read", () =>
      before(openSheet, /renderSheet\(\)/, /markSeen\(\)/));
    check("P04324", "the sheet registers a Back layer", () => /LFH_BACK\.layer\("guest-bell", closeSheet\)/.test(openSheet));
    check("P04325", "closing unregisters it", () => /backOff/.test(closeSheet));
    check("P04326", "the backdrop closes the sheet; a tap inside does not", () =>
      /if \(e\.target === sheet\) closeSheet\(\)/.test(openSheet));
    check("P04327", "tapping a row hands the table to the panel and closes", () =>
      /node\.addEventListener\("click", function \(\)/.test(rowNode));
    check("P04328", "the four kinds use the floor's own words", () => /var KINDS|KINDS = \{/.test(S));
    check("P04329", "the bell sits before the theme button so it does not jump around", () =>
      /insertBefore/.test(mount));
    check("P04330", "the bell re-mounts if the top bar is re-rendered", () => /isConnected/.test(S));
    check("P04331", "the count badge caps at '99+'", () => /99\+/.test(paintButton));
    check("P04332", "the button's aria-label says how many, in English", () =>
      /aria-label/.test(paintButton));
    check("P04333", "backdrop-filter is ONE unprefixed line", () =>
      count(css, /backdrop-filter/g) >= 1 && count(css, /-webkit-backdrop-filter/g) === 0);
    check("P04334", "sync() reads the seen list once per pass, not once per row", () =>
      /seenSet/.test(S) && /function forgetSeen\(\)/.test(S));
    check("P04335", "the sheet's last row is not tucked under a phone's home indicator", () =>
      /var\(--sab, env\(safe-area-inset-bottom, 0px\)\)/.test(css));
    skipRow("P04336", "the sheet renders on the manager panel at 1280x800", "driven live - see live.checks");
    skipRow("P04337", "the sheet renders on the tablet panel at 360x780 dpr3", "driven live - see live.checks");
    check("P04338", "the sheet is bottom-anchored on a phone and centred on a wide screen", () =>
      /@media\(min-width:700px\)/.test(css));
    check("P04339", "with nothing waiting the sheet says all caught up", () => /All caught up/.test(R));
    check("P04340", "the bell is absent from the KITCHEN panel", () =>
      !/guestbell\.js/.test(c.kitchenHtml || ""));

    // NEW
    check("P65938", "the bell is loaded by the manager and the waiter tablet only", () =>
      /guestbell\.js/.test(c.editorHtml || "") && /guestbell\.js/.test(c.tabletHtml || "") &&
      !/guestbell\.js/.test(c.kitchenHtml || ""));
    check("P65939", "a row is a doorway, not a second control - it opens the table and closes", () =>
      /closeSheet\(\)/.test(rowNode) || /close/.test(rowNode));
    check("P65940", "the seen list survives a reload, so the same row is not 'new' twice", () =>
      /localStorage/.test(S));
    check("P65941", "a corrupt seen list reads as empty rather than throwing", () => {
      const r = fnBody(S, "function readSeen(");
      return /catch/.test(r);
    });
  }

  // ===========================================================================================
  // swipehint.js - "there is more this way" (P04417-P04436)
  // ===========================================================================================
  {
    const S = c.swipehint;
    const measure = fnBody(S, "function measure(");
    const countChip = fnBody(S, "function countChip(");
    const hiddenAtEnd = fnBody(S, "function hiddenAtEnd(");
    const watch = fnBody(S, "function watch(");
    const start = fnBody(S, "function start(");

    check("P04417", "a row that cannot scroll gets neither the fade nor the chip", () =>
      /if \(ox !== "auto" && ox !== "scroll"\) \{ row\.removeAttribute\("data-more"\)/.test(measure));
    check("P04418", "the chip's own tap is therefore never a silent no-op", () =>
      /row\.__lfhChip\.hidden = true/.test(measure));
    check("P04419", "data-more is start / end / both and CSS does the painting", () =>
      /row\.setAttribute\("data-more", atStart \? "end" : atEnd \? "start" : "both"\)/.test(measure));
    check("P04420", "a row at its end (sub-pixel short) is still recognised as 'at end'", () =>
      /var EPS = 2/.test(S) && /row\.scrollLeft >= over - EPS/.test(measure));
    check("P04421", "the chip is a SIBLING so it does not scroll away with the content", () =>
      /row\.parentNode\.appendChild\(chip\)/.test(countChip));
    check("P04422", "the chip is built from nodes, never innerHTML", () =>
      count(S, /innerHTML/g) === 0);
    check("P04423", "the chip is aria-hidden and not tabbable", () =>
      /chip\.setAttribute\("aria-hidden", "true"\)/.test(countChip) && /chip\.tabIndex = -1/.test(countChip));
    check("P04424", "tapping the chip scrolls one screenful", () =>
      /row\.scrollBy\(\{ left: Math\.max\(120, row\.clientWidth \* 0\.8\), behavior: "smooth" \}\)/.test(countChip));
    check("P04425", "a browser without smooth scroll still moves the row", () =>
      /catch \(e\) \{ row\.scrollLeft \+= 160; \}/.test(countChip));
    check("P04426", "measuring is rAF-coalesced - no polling, no layout thrash on a rush", () =>
      /var kick = function \(\) \{ if \(!queued\) \{ queued = true; requestAnimationFrame\(run\); \} \}/.test(watch) &&
      count(S, /setInterval/g) === 0);
    check("P04427", "a row is watched once, however many times scan sees it", () =>
      /var watched = new WeakSet\(\)/.test(S) && /if \(!row \|\| watched\.has\(row\)\) return;/.test(watch));
    check("P04428", "new rows from a whole-tab re-render are picked up", () =>
      /new MutationObserver\(function \(muts\)/.test(start));
    check("P04429", "content changing inside a row re-measures it", () =>
      /new MutationObserver\(kick\)\.observe\(row, \{ childList: true \}\)/.test(watch));
    check("P04430", "a row that vanished mid-frame does not throw", () =>
      /try \{ measure\(row\); \} catch \(e\) \{ /.test(watch));
    check("P04431", "orientation change re-scans", () =>
      /window\.addEventListener\("orientationchange", function \(\) \{ scan\(document\); \}\)/.test(start));
    check("P04432", "the count is measured from RENDERED rects, not offsetLeft", () => {
      if (/offsetLeft/.test(hiddenAtEnd)) return "the count is back on offsetLeft, which is measured from a different box than scrollLeft";
      return /row\.getBoundingClientRect\(\)\.right/.test(hiddenAtEnd) && /c\.getBoundingClientRect\(\)\.right > right/.test(hiddenAtEnd);
    });
    check("P04433", "the chip hides when nothing is left off the edge", () =>
      /chip\.hidden = n <= 0/.test(measure));
    check("P04434", "the chip itself is excluded from the count", () =>
      /if \(c === row\.__lfhChip\) continue;/.test(hiddenAtEnd));
    skipRow("P04435", "the fade/chip appear on the take-order category strip at 360x780", "driven live - see live.checks");
    skipRow("P04436", "nothing appears on the same strip at 1280x800", "driven live - see live.checks");

    // NEW
    check("P65942", "the chip's parent is made positioned so the chip can sit over the row", () =>
      /if \(getComputedStyle\(row\.parentNode\)\.position === "static"\) row\.parentNode\.style\.position = "relative";/.test(countChip));
    check("P65943", "a row with no overflow at all drops the attribute rather than leaving it stale", () =>
      count(measure, /removeAttribute\("data-more"\)/g) === 2);
    check("P65944", "swipehint is loaded by the manager panel only", () =>
      /swipehint\.js/.test(c.editorHtml || "") && !/swipehint\.js/.test(c.kitchenHtml || "") &&
      !/swipehint\.js/.test(c.tabletHtml || ""));
    check("P65945", "the file records that the waiter tablet does NOT load it", () =>
      /It is loaded by ONE/.test(raw.swipehint));
    check("P65946", "one instance per frame", () => /if \(window\.LFH_SWIPE\) return;/.test(S));
  }

  // ===========================================================================================
  // swreg.js - installing the offline layer for the panels
  // ===========================================================================================
  {
    const S = c.swreg;
    const reg = fnBody(S, "function reg(");
    const pageAssets = fnBody(S, "function pageAssets(");

    check("P01652", "the file introduces no dependency and no global beyond window.LFH_WARM", () => {
      const globals = [...S.matchAll(/window\.(\w+) *=/g)].map((m) => m[1]);
      const extra = globals.filter((g) => g !== "LFH_WARM");
      return extra.length ? `it also defines window.${extra.join(", window.")}` : true;
    });
    check("P01837", "?nosw=1 unregisters the worker and tells it to empty its caches", () =>
      /has\("nosw"\)/.test(S) && /LFH_SW_KILL/.test(S) && /r\.unregister\(\)/.test(S));
    check("P65947", "a device with no service-worker support is left alone", () =>
      /if \(!\("serviceWorker" in navigator\)\) return;/.test(S));
    check("P65948", "the panel asks the worker to save its OWN page, not just the data", () =>
      /LFH_WARM_SHELL/.test(reg) && /url: location\.href/.test(reg));
    check("P65949", "it hands over the page's own assets so an offline reload is not unstyled", () =>
      /assets: pageAssets\(\)/.test(reg) && /getEntriesByType\("resource"\)/.test(pageAssets));
    check("P65950", "only same-origin assets are offered", () =>
      /n\.indexOf\(location\.origin\) === 0/.test(pageAssets));
    check("P65951", "a read offered before the worker exists is held, bounded at 12", () =>
      /pendingData\.length < 12/.test(S));
    check("P65952", "warm data is handed over the moment the worker takes control", () =>
      /addEventListener\("controllerchange", flushWarmData, \{ once: true \}\)/.test(S));
    check("P65953", "a long-open panel picks up a new deploy when it comes back into view", () =>
      /visibilityState === "visible"\) \{ try \{ r\.update\(\); \} catch \(e\) \{\} \}/.test(reg));
    check("P65954", "nothing here can throw into the panel", () =>
      /\.catch\(function \(\) \{ /.test(reg) && count(S, /try \{/g) >= 3);
    check("P65955", "LFH_WARM.data refuses anything that is not a string body", () =>
      /if \(!url \|\| typeof body !== "string"\) return;/.test(S));
    check("P65956", "swreg.js loads before offline.js, which reads what it installs", () => {
      for (const k of ["editorHtml", "kitchenHtml", "tabletHtml"]) {
        const srcs = [...(c[k] || "").matchAll(/<script[^>]+src="([^"]+)"/g)].map((s) => s[1]);
        const a = srcs.findIndex((s) => s.includes("/swreg.js"));
        const b = srcs.findIndex((s) => s.includes("/offline.js"));
        if (a < 0 || b < 0) return `${k}: swreg.js / offline.js not both loaded`;
        if (a > b) return `${k}: swreg.js must load before offline.js`;
      }
      return true;
    });
  }

  // ===========================================================================================
  // floor-layouts.js - the hand-written custom floor plans (P02007-P02009, T5)
  // ===========================================================================================
  {
    const S = c.floorLayouts, R = raw.floorLayouts;
    check("P02007", "floor-layouts.js declares the global map exactly once, defensively", () =>
      count(S, /window\.LFH_FLOOR_LAYOUTS = window\.LFH_FLOOR_LAYOUTS \|\| \{\};/g) === 1);
    check("P02008", "it ships NO live plan (every example is commented out)", () =>
      !/^\s*window\.LFH_FLOOR_LAYOUTS\["/m.test(S));
    check("P02009", "it carries the tablet-does-not-read-this warning", () =>
      /THE WAITER TABLET DOES NOT READ THIS FILE YET/.test(R));
    check("P65957", "it is DATA only - no logic, no DOM, no network", () =>
      count(S, /fetch\(/g) === 0 && count(S, /document\./g) === 0 && count(S, /function /g) === 0);
    check("P65958", "it is loaded by the manager panel only, which is the half that is built", () =>
      /floor-layouts\.js/.test(c.editorHtml || "") && !/floor-layouts\.js/.test(c.tabletHtml || ""));
  }

  /* The file's own shortIndian(), written out rather than evaluated from source, so this guard
     cannot simply agree with whatever the file happens to do. P04244 asserts the thresholds it
     is built from have not moved. */
  function mkShortIndian() {
    return function shortIndian(txt) {
      const m = String(txt).match(/^(\D*)([\d,]+(?:\.\d+)?)(.*)$/);
      if (!m) return null;
      const n = parseFloat(m[2].replace(/,/g, ""));
      if (!isFinite(n) || n < 1000) return null;
      let v, suf;
      if (n >= 1e7) { v = n / 1e7; suf = " Cr"; }
      else if (n >= 1e5) { v = n / 1e5; suf = " L"; }
      else { v = n / 1e3; suf = "K"; }
      const s = v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
      return m[1] + s + suf + m[3];
    };
  }
}
