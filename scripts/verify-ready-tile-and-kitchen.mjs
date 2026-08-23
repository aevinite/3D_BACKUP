// Proves two changes:
//  (A) Manager floor tile turns "ready" (pink) when ANY dish is ready — not only
//      when EVERY dish is ready. Mirrors editor tableTileState precedence.
//  (B) Kitchen "mark ready" is optimistic+merged: a dish the cook just tapped stays
//      "ready" even if a mid-rush refetch lands before the server caught up.
// Also guards that the tablet was ALREADY correct (ready before preparing).
//   node scripts/verify-ready-tile-and-kitchen.mjs

let pass = true;
const check = (label, cond) => { console.log((cond ? "✓ " : "✗ ") + label); if (!cond) pass = false; };

// (A) Manager tile-state precedence ----------------------------------------------
const mgrStOld = ({ anyReceived, anyReady, anyPreparing }) =>            // buggy order
  anyReceived ? "new" : anyPreparing ? "prep" : anyReady ? "ready" : "done";
const mgrStNew = ({ anyReceived, anyReady, anyPreparing }) =>            // fixed order
  anyReceived ? "new" : anyReady ? "ready" : anyPreparing ? "prep" : "done";

check("OLD manager: 1 ready + others preparing → 'prep' (bug)", mgrStOld({ anyReady: true, anyPreparing: true }) === "prep");
check("FIXED manager: 1 ready + others preparing → 'ready' (pink)", mgrStNew({ anyReady: true, anyPreparing: true }) === "ready");
check("FIXED manager: only preparing → 'prep'", mgrStNew({ anyPreparing: true }) === "prep");
check("FIXED manager: all ready → 'ready' (still pink)", mgrStNew({ anyReady: true }) === "ready");
check("FIXED manager: a brand-new order still wins → 'new'", mgrStNew({ anyReceived: true, anyReady: true }) === "new");

// (B) Tablet tile precedence (must already be ready-before-prep) ------------------
const tabSt = ({ nw = 0, rd = 0, ck = 0, sv = 0 }) =>
  nw > 0 ? "new" : rd > 0 ? "ready" : ck > 0 ? "prep" : sv > 0 ? "served" : "free";
check("tablet already pink on any ready (1 ready + 3 preparing)", tabSt({ rd: 1, ck: 3 }) === "ready");

// (C) Kitchen optimistic merge guard (mirror load()'s pendingReady merge) ---------
const kitchenMerge = (serverItems, pendingReady) =>
  pendingReady.size ? serverItems.map((i) => (pendingReady.has(i.id) && i.status !== "served" ? { ...i, status: "ready" } : i)) : serverItems;

{ // server snapshot still says "preparing" but the cook just tapped i1 ready
  const merged = kitchenMerge([{ id: "i1", status: "preparing" }, { id: "i2", status: "preparing" }], new Set(["i1"]));
  check("kitchen: just-tapped dish stays ready when server lags", merged.find((i) => i.id === "i1").status === "ready");
  check("kitchen: untouched dish unaffected", merged.find((i) => i.id === "i2").status === "preparing");
}
{ // never un-serve: a served dish stays served even if in pendingReady
  const merged = kitchenMerge([{ id: "i1", status: "served" }], new Set(["i1"]));
  check("kitchen: never downgrades a SERVED dish to ready", merged[0].status === "served");
}
{ // no pending → straight passthrough (no churn)
  const src = [{ id: "i1", status: "preparing" }];
  check("kitchen: no pending → passthrough", kitchenMerge(src, new Set()) === src);
}

// ── (D) A REFUSED WRITE MUST NOT LEAVE AN OPTIMISTIC OVERLAY BEHIND (T6 sweep, 2026-08-17) ──────
// The overlay above is what keeps a just-tapped dish showing "ready" while the server catches up.
// It was cleared ONLY on the success path, so when the server refused the write — the manager had
// cancelled the KOT, the device was blocked, a 400 — the cook got a four-second toast and the board
// then painted the dish ready FOR EVER: every later /board read re-applied the overlay, the ticket
// had already slid into the Ready lane, and the ✓ was gone so there was no way to try again.
// Nothing had been saved, so the waiter was never told and the guest waited on a finished dish.
// Watched happening on the running board before the fix, and watched reverting after it.
{
  // The model: what the board shows after a refused tap, then a fresh read from the server.
  const afterRefusal = (serverItems, pendingReady, clearOnFailure, tappedId) => {
    const pend = new Set(pendingReady);
    if (clearOnFailure) pend.delete(tappedId);
    return kitchenMerge(serverItems, pend);
  };
  const server = [{ id: "i1", status: "preparing" }];
  check("OLD kitchen: a refused ✓ still painted the dish ready (bug reproduced)",
    afterRefusal(server, new Set(["i1"]), false, "i1")[0].status === "ready");
  check("FIXED kitchen: a refused ✓ shows the dish as the server has it",
    afterRefusal(server, new Set(["i1"]), true, "i1")[0].status === "preparing");
  check("FIXED kitchen: another cook's in-flight ✓ is not dropped by this one's failure",
    afterRefusal([{ id: "i1", status: "preparing" }, { id: "i2", status: "preparing" }], new Set(["i1", "i2"]), true, "i1")
      .find((i) => i.id === "i2").status === "ready");
}

// ── (E) THE WALL IS ONE QUEUE, NOT TWO (T6 sweep, 2026-08-17) ───────────────────────────────────
// The wall board exists to be first-come-first-served. Dine-in tickets were sorted among
// themselves, platform tickets among themselves, and the two lists then glued together — so every
// delivery ticket sat behind every dine-in ticket whatever the clock said, at the bottom of a grid
// a cook reads top-left first. The food most likely to be late was drawn last.
{
  const orderTime = (ts) => { const t = ts == null || ts === "" ? NaN : new Date(ts).getTime(); return Number.isFinite(t) ? t : Infinity; };
  const cmpTime = (x, y) => { const a = orderTime(x), b = orderTime(y); return a < b ? -1 : a > b ? 1 : 0; };
  const wallOld = (dine, plat) => dine.slice().sort((a, b) => ((a.ready) - (b.ready)) || cmpTime(a.at, b.at))
    .concat(plat.slice().sort((a, b) => ((a.ready) - (b.ready)) || cmpTime(a.at, b.at))).map((x) => x.id);
  const wallNew = (dine, plat) => dine.concat(plat).sort((a, b) => (a.ready - b.ready) || cmpTime(a.at, b.at)).map((x) => x.id);
  const dine = [{ id: "d-new", at: "2026-08-17T10:59:00Z", ready: false }];
  const plat = [{ id: "p-old", at: "2026-08-17T10:00:00Z", ready: false }];
  check("OLD wall: an hour-old delivery ticket sat behind a one-minute dine-in ticket (bug reproduced)",
    wallOld(dine, plat).join(",") === "d-new,p-old");
  check("FIXED wall: the oldest ticket comes first whatever channel it arrived on",
    wallNew(dine, plat).join(",") === "p-old,d-new");
  check("FIXED wall: a finished ticket still sinks below an unfinished one, whatever its age",
    wallNew([{ id: "d-old-ready", at: "2026-08-17T09:00:00Z", ready: true }], [{ id: "p-new", at: "2026-08-17T11:00:00Z", ready: false }])
      .join(",") === "p-new,d-old-ready");
  check("FIXED wall: an undateable webhook ticket sorts LAST, never first",
    wallNew(dine, [{ id: "p-bad", at: "not-a-date", ready: false }]).join(",") === "d-new,p-bad");
}

// ── DRIFT CHECK — everything above is written out in THIS file, so read the shipped panel too ────
// (the same reasoning as scripts/verify-board-sig.mjs: a model that passes proves the design is
// sound and proves nothing about the product).
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = process.argv[2] && !process.argv[2].startsWith("-")
  ? process.argv[2]
  : join(dirname(fileURLToPath(import.meta.url)), "..");
const readIf = (rel) => { const f = join(ROOT, rel); return existsSync(f) ? readFileSync(f, "utf8") : null; };

{
  const js = readIf("public/panels/kitchen/app.js");
  check("kitchen/app.js found", !!js);
  if (js) {
    // (D) both failure handlers must drop their overlay. Read the .catch that follows each write.
    const afterCall = (marker) => { const i = js.indexOf(marker); return i < 0 ? "" : js.slice(i, i + 2600); };
    const itemCatch = afterCall('api("POST", `/items/${id}/status`');
    const orderCatch = afterCall('api("POST", `/orders/${orderId}/ready`)');
    check("kitchen: a failed single ✓ removes the dish from pendingReady",
      /\.catch\(\([^)]*\)\s*=>\s*\{[\s\S]{0,2000}?pendingReady\.delete\(id\)/.test(itemCatch),
      "markItemReady's .catch must call pendingReady.delete(id) — otherwise every later /board read repaints the refused dish as ready, for ever.");
    check("kitchen: a failed single ✓ puts the dish back where it was",
      /\.catch\(\([^)]*\)\s*=>\s*\{[\s\S]{0,2000}?it\.status\s*=\s*prev/.test(itemCatch),
      "markItemReady's .catch must restore the snapshotted status.");
    check("kitchen: a failed ALL READY clears the order-level overlay",
      /\.catch\(\([^)]*\)\s*=>\s*\{[\s\S]{0,2000}?pendingReadyOrders\.delete\(orderId\)/.test(orderCatch),
      "markOrderReady's .catch must call pendingReadyOrders.delete(orderId) — a legacy ticket would otherwise stay in the Ready lane for ever.");
    check("kitchen: a failed ALL READY clears the per-dish overlay too",
      /\.catch\(\([^)]*\)\s*=>\s*\{[\s\S]{0,2000}?snap\.forEach\(\([^)]*\)\s*=>\s*pendingReady\.delete/.test(orderCatch),
      "markOrderReady's .catch must drop every dish it optimistically flipped.");
    // (D, offline half) a tap taken with no signal skips the reconcile, so the drain has to clear
    // the overlay — otherwise a replay the server REFUSES leaves the dish painted ready all shift.
    const flush = (js.match(/lfh:outbox-flushed[\s\S]{0,900}?\}\);/) || [])[0] || "";
    check("kitchen: the outbox drain clears the optimistic overlay",
      /pendingReady\.clear\(\)/.test(flush) && /pendingReadyOrders\.clear\(\)/.test(flush),
      "a queued ✓ keeps its dish painted ready and never schedules a reconcile; when the queue drains, the post-flush read is the moment the overlay has to go.");
    check("kitchen: it clears the overlay AFTER the post-flush read, not before",
      /load\(\)[\s\S]{0,80}?\.finally\(\(\)\s*=>\s*\{[^}]*pendingReady\.clear\(\)/.test(flush),
      "clearing first strips the protection during the very refresh most likely to be stale.");
    // (E) the wall must build ONE list and sort it once — not two private sorts glued together.
    const wall = (js.match(/function renderWall\(\)[\s\S]{0,2600}?\n\}/) || [])[0] || "";
    check("kitchen: the wall sorts dine-in and platform tickets in ONE pass",
      /desired\.sort\(/.test(wall) && !/state\.platform\s*\|\|\s*\[\]\)\.slice\(\)\.sort/.test(wall),
      "renderWall must concat both channels and sort the combined list — a private sort per channel puts every delivery ticket behind every dine-in ticket.");
    check("kitchen: the wall's sort still goes through the NaN-safe comparator",
      /desired\.sort\(\([^)]*\)\s*=>\s*\([^)]*\)\s*\|\|\s*cmpTime\(/.test(wall),
      "a bare date subtraction answers NaN for a webhook timestamp and silently un-FIFOs the board.");
    // (F5) the deferred print call must not fail in silence. Read ONLY the block between the
    // print call and the frame's own cleanup timer — a looser window reached printKot's bottom
    // catch further down the file and passed on the wrong `logKotPrintFailure`.
    const deferred = (js.match(/w\.print\(\);[\s\S]{0,900}?setTimeout\(cleanup, 60000\)/) || [])[0] || "";
    check("kitchen: the deferred print call does not sit in an empty catch",
      deferred !== "" && !/catch\s*\(\s*\w*\s*\)\s*\{\s*\}\s*\n?\s*setTimeout\(cleanup/.test(deferred),
      "printKot's deferred `w.print()` used to sit in an empty catch, so a print-first kitchen could work a whole service with nothing on paper and nothing anywhere saying so.");
    check("kitchen: a failed print CALL reaches the log and the manager",
      /logKotPrintFailure/.test(deferred) && /notePrintTrouble/.test(deferred),
      "the failure has to be written down and said out loud — that is the rule printKot's own bottom catch was written for.");
    check("kitchen: a ticket whose print call threw is un-recorded so it can be retried",
      /printedIds\.delete\(order\.id\)/.test(deferred),
      "otherwise the ticket counts as printed and the cook's genuine next 🖨 is branded DUPLICATE.");
  }
}
{
  const css = readIf("public/panels/kitchen/style.css");
  check("kitchen/style.css found", !!css);
  if (css) {
    // (F6) the 🖨 target must be finger-sized at EVERY width, not only on a phone.
    const base = (css.match(/\n\.reprint \{[^}]*\}/) || [])[0] || "";
    check("kitchen: the 🖨 reprint button is a 44px target at every width",
      /min-height:\s*44px/.test(base) && /min-width:\s*44px/.test(base),
      "it measured 38×22 on a 1194×834 kitchen tablet — the smallest control on the screen, and the one a print-first kitchen reaches for with wet hands after a jam.");
    check("kitchen: no later rule shrinks the 🖨 target back below 44px",
      !/\.reprint\s*\{[^}]*min-height:\s*(?:[0-3]?\d)px/.test(css.replace(base, "")),
      "the phone media block used to set 40px and win on cascade order.");
    // (F4) every green word on the light skin must have been deepened — measured 3.30:1 before.
    check("kitchen: the light skin deepens the 'served ✓' green",
      /html\[data-theme="light"\]\s*\.done\s*\{[^}]*color\s*:\s*#15803d/.test(css),
      "--green as INK on the white ticket measures 3.30:1 at 18px/900, under the 4.5:1 a word that size needs.");
    // Both indexes must EXIST — `indexOf` answers -1 for a missing rule, and -1 < anything, so a
    // naive `<` would have called a DELETED rule "correctly ordered".
    const iDone = css.indexOf('html[data-theme="light"] .done{'), iRdy = css.indexOf('html[data-theme="light"] .done.rdy{');
    check("kitchen: the light 'ready' pink still beats that rule on specificity",
      iDone >= 0 && iRdy >= 0 && iDone < iRdy,
      "if .done.rdy stops winning, a dish waiting to be carried out turns green and reads as already served.");
  }
}

// ── (G) A SURGICAL PATCH MUST TELL THE RECONCILER IT NO LONGER KNOWS THE CARD ────────────────────
// (T6 re-check, 2026-08-19.) reconcileList() decides whether to repaint a card by comparing the
// desired html to `__kdsHtml`, the html that card was last BUILT from. Two paths edit a card in
// place instead of rebuilding it — the ✓ turning a line into "ready", and that being taken back.
// Neither may re-stamp __kdsHtml (they never built the card), so both must CLEAR it. Miss that and
// the reconciler compares against a stamp older than the edit, matches, and reuses a node the edit
// already changed: the dish reads `preparing` on the server and everywhere else, and the cook has
// no ✓ to re-send it with. A single-dish ticket hides it (finishing moves the card to Ready, and
// moveCardToReady rebuilds it); a ticket with two cooking dishes does not.
{
  // The model: what the reconciler does with a stamp that predates a surgical edit.
  const reconcile = (node, desiredHtml) => (node.__kdsHtml === desiredHtml) ? node : { html: desiredHtml, __kdsHtml: desiredHtml };
  const built = { html: "<tick>", __kdsHtml: "<tick>" };
  const patched = { ...built, html: "<ready>" };                       // the ✓ edited the DOM only
  check("OLD: a restored dish reuses the node the tap had already changed (bug reproduced)",
    reconcile(patched, "<tick>").html === "<ready>");
  const forgotten = { ...patched, __kdsHtml: null };                   // …after forgetCardHtml()
  check("FIXED: forgetting the stamp forces the card to be repainted from the truth",
    reconcile(forgotten, "<tick>").html === "<tick>");
  check("FIXED: a card nobody patched is still reused, so nothing else starts churning",
    reconcile(built, "<tick>") === built);
}

// ── (H) THE TABLE MARKS MUST BE READABLE — computed, not a hard-coded hex ────────────────────────
// The marks are drawn with inline colours, so one value covers both skins and no stylesheet can
// rescue them. 👑 VIP measured 4.23:1 at 10px/800 — the only one of the three that missed, and the
// one that means "pull this forward". Computing the ratio here means a future colour change is
// checked too, instead of this guard pinning one hex nobody remembers the reason for.
{
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const L1 = lum(a), L2 = lum(b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); };
  check("the badge contrast maths is right (white on black is 21:1)", Math.round(ratio("#ffffff", "#000000")) === 21);
  check("OLD: the VIP violet was under the line (bug reproduced)", ratio("#ffffff", "#8b5cf6") < 4.5);
}

// ── DRIFT CHECKS for (G) and (H), plus the tablet-sized top bar ──────────────────────────────────
{
  const js = readIf("public/panels/kitchen/app.js");
  if (js) {
    check("kitchen: there is one helper that forgets a card's stamp",
      /function forgetCardHtml\(orderId\)[\s\S]{0,400}?card\.__kdsHtml = null/.test(js),
      "reconcileList compares against __kdsHtml; a path that patches a card in place has to invalidate it.");
    const mi = (js.match(/function markItemReady\([\s\S]*?\n\}/) || [])[0] || "";
    check("kitchen: a refused ✓ lets its card redraw",
      /\.catch\(\([^)]*\)\s*=>\s*\{[\s\S]{0,2600}?forgetCardHtml\(/.test(mi),
      "otherwise the dish is restored in the data and the ✓ never comes back on screen.");
    // …AND SO DOES A TAKE-BACK (T6 sweep #7, 2026-08-22). Same fault, different door: the ✓ tap
    // edits one line in place, so once undoReady() restores the status the desired html matches the
    // card's stale __kdsHtml stamp and reconcileList reuses the node that has no ✓ on it. Watched on
    // a TWO-dish ticket: the write landed, the server read `preparing` inside a second, and the
    // screen still said READY with no ✓ ten seconds later and after a forced whole-board read. A
    // single-dish ticket hides it, because finishing it moves the card to Ready and that rebuild
    // re-stamps — which is why the old note in that function claimed the call was unnecessary.
    const ur = (js.match(/async function undoReady\([\s\S]*?\n\}/) || [])[0] || "";
    check("kitchen: undoReady() collects every ticket the take-back touches",
      /const touched = new Set\(/.test(ur) && /touched\.add\(it\.order_id\)/.test(ur),
      "a per-dish take-back carries no order id, so the ticket has to be found from the dish's own row.");
    check("kitchen: a take-back lets its card redraw",
      /for \(const id of touched\) forgetCardHtml\(id\);/.test(ur),
      "otherwise the dish is put back in the data and the screen keeps showing READY with no ✓.");
    // ── A POST-WRITE REFRESH MUST NOT BECOME A ROW IN THE OWNER'S LOG ─────────────────────────
    // load() and freshLoad() REJECT when the read fails (backoffPoll and LFH_RT.catchUp back off on
    // exactly that), so every timer and listener in the panel writes `load().catch(() => {})`. Five
    // post-write refreshes did not, and nothing awaited them — so a failed read became an unhandled
    // rejection, and public/panels/errlog.js reports every one of those into the Everything Log.
    // Watched with the board answering 503: `REJECTION: the database is very busy` in the log and
    // nothing on screen. refreshQuietly() is freshLoad() with the file's own convention applied.
    check("kitchen: there is one quiet post-write refresh helper",
      /const refreshQuietly = \(\) => freshLoad\(\)\.catch\(\(\) => \{\}\);/.test(js),
      "the five fire-and-forget refreshes go through it, so a failed read cannot reject into nothing.");
    {
      // `await freshLoad();` inside a try/catch is handled — only a fire-and-forget one is bare
      const bare = (js.match(/(?<!await )(?<!return )(?<![.\w])freshLoad\(\);/g) || []).length;
      check("kitchen: no post-write refresh is left bare",
        bare === 0,
        `found ${bare} bare freshLoad(); call(s) — each one is an unhandled rejection when the board read fails, and errlog.js files it in the owner's Everything Log. Use refreshQuietly().`);
    }
    check("kitchen: refreshQuietly swallows only the READ, never a write",
      /toast\("Failed: " \+ e\.message\);\s*\n?\s*refreshQuietly\(\);/.test(js),
      "every refused write still says so to the person before the quiet refresh.");
    check("kitchen: the take-back forgets the stamp BEFORE it repaints",
      ur.indexOf("forgetCardHtml") >= 0 && ur.indexOf("forgetCardHtml") < ur.indexOf("render()"),
      "render() is what reads the stamp — clearing it afterwards would be a paint too late.");
    // ── THE SCREEN AND THE PAPER MUST AGREE ABOUT A TICKET WITH NO TABLE ──────────────────────
    // `orders.table_number` may be null (a banquet bill with the table left blank) and the
    // live-board query does not exclude it. tlong() has always answered "T?" for that; tshort(),
    // which is what the TICKET HEADER a cook reads goes through, used to answer the literal
    // "Tnull" — and "Tundefined", and a bare "T". The title attribute on that same span was
    // already guarded, so half the line was fixed and half was missed. Run both helpers, don't
    // read them: a raw null on a staff screen is on verify:live's own leaked-value list.
    {
      // stop at the semicolon even when a trailing // comment follows it — otherwise the lazy
      // match runs on and swallows the NEXT declaration, which is a syntax error, not a failure
      const pick = (n) => { const m = js.match(new RegExp("^const " + n + " = [\\s\\S]*?;(?=[ \\t]*(?://[^\\n]*)?$)", "m")); return m ? m[0] : null; };
      const parts = ["tname", "tshort", "tlong"].map(pick);
      check("kitchen: the three table-label helpers are still where this guard can run them", parts.every(Boolean));
      if (parts.every(Boolean)) {
        // eslint-disable-next-line no-new-func
        const { tshort, tlong } = new Function("state", parts.join("\n") + "\nreturn { tshort, tlong };")({ tableNames: {} });
        for (const [label, v] of [["null", null], ["an empty string", ""], ["undefined", undefined]]) {
          check(`kitchen: a ticket whose table is ${label} shows "T?" on SCREEN, never a raw value`,
            tshort(v) === "T?", `tshort(${label}) answered "${tshort(v)}" — that goes straight into the ticket header.`);
          check(`kitchen: …and the PAPER says the same thing for ${label}`,
            tlong(v) === "T?", `tlong(${label}) answered "${tlong(v)}".`);
        }
        check("kitchen: a real table number is still shown as T<n>", tshort(7) === "T7" && tlong(7) === "T7");
        check("kitchen: table 0 is still shown, not swallowed by a falsy test", tshort(0) === "T0" && tlong(0) === "T0");
      }
    }
    // the marks, as the panel actually ships them
    const m = js.match(/TAG_BADGE = \{ vip: \["[^"]*", "(#[0-9a-f]{6})"\], family: \["[^"]*", "(#[0-9a-f]{6})"\], guest: \["[^"]*", "(#[0-9a-f]{6})"\] \}/i);
    check("kitchen: the three table marks are still declared where this guard can read them", !!m);
    if (m) {
      const lum = (hex) => { const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const ratio = (a, b) => { const L1 = lum(a), L2 = lum(b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); };
      // guest is the one drawn with dark ink; the other two are white (see the tagBadge template)
      const marks = [["VIP", m[1], "#ffffff"], ["FAMILY", m[2], "#ffffff"], ["GUEST", m[3], "#1c2230"]];
      for (const [name, bg, ink] of marks) {
        const r = ratio(ink, bg);
        check(`kitchen: the ${name} mark is readable (${r.toFixed(2)}:1)`, r >= 4.5,
          `10px/800 is small text, so it needs 4.5:1 — ${ink} on ${bg} measures ${r.toFixed(2)}:1.`);
      }
    }
  }
  const css = readIf("public/panels/kitchen/style.css");
  if (css) {
    const btn = (css.match(/\n\.btn \{[^}]*\}/) || [])[0] || "";
    check("kitchen: a top-bar button is a 44px target at every width",
      /min-height:\s*44px/.test(btn),
      "measured 43px on a 1194x834 kitchen tablet — only the phone block ever set a minimum, and 🚫 Sold out and 🖨❗ printer problem are pressed during service.");
    // …and the way that 44px is reached must not set `display` on .btn. `.kds-more-btn{display:none}`
    // is what keeps the phone-only ⋯ button off a desktop bar; it has the same specificity and comes
    // EARLIER, so a `display` in .btn silently wins and ⋯ appears at every width. That happened while
    // making this very fix, and only a measurement at four widths caught it.
    check("kitchen: the base .btn rule sets no display, so it cannot unhide the phone-only ⋯",
      !/display\s*:/.test(btn),
      "a <button> is inline-block already — min-height alone is enough, and adding display here overrides .kds-more-btn.");
    const moreHide = css.indexOf(".kds-more-btn { display: none; }");
    check("kitchen: the ⋯ button is still hidden by default", moreHide >= 0);
    const tt = (css.match(/\.theme-toggle\{[^}]*\}/) || [])[0] || "";
    check("kitchen: the theme toggle matches the row it sits in",
      /width:44px;\s*height:44px/.test(tt), "it was 40x40 in a row of 44s.");
    // and nothing may quietly shrink them again
    const shrink = [...css.matchAll(/\.(?:top-actions \.btn|btn|theme-toggle)[^{]*\{[^}]*min-height:\s*(\d+)px/g)]
      .map((x) => +x[1]).filter((n) => n < 44);
    check("kitchen: no later rule shrinks a bar control back below 44px", shrink.length === 0, "found: " + shrink.join(", "));
  }
}

console.log("\n" + (pass ? "ALL PASS" : "SOME FAILED"));
process.exit(pass ? 0 : 1);
