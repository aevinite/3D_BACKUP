// lib/adminJump.ts — an alert's button lands on the CONTROL, not on the page it lives on.
//
// ── THE OWNER'S ASK, 2026-09-02 ──────────────────────────────────────────────────────────────────
//
//   "there is one red thing showing menu is in maintenance — if I click manage it should take me to
//    the toggle where I can turn on menu, it takes to the restaurant. Make sure you do it for all
//    alert and notification and everything."
//
// The red banner on the admin Dashboard said "1 guest menu is in maintenance — Demo Bistro" and its
// Manage button went to `/aevinite/restaurants` — the LIST of nine. He then had to find Demo Bistro,
// open it, scroll, and spot which of that card's buttons the alert had meant. Three steps between
// being told about a problem and being able to do something about it.
//
// An alert that names a problem must land on the switch that ends it. That is one rule with two
// halves, and both have to hold or the promise is broken:
//
//   1. GET TO THE RIGHT SCREEN, ALREADY NARROWED — the link carries which restaurant, which
//      section, and (where the screen has one) which tab. Nothing left to pick.
//   2. SAY WHICH CONTROL — a card holds several buttons. The one the alert meant gets scrolled
//      into view and ringed for a moment (`data-adm-flash`, styled in app/globals.css).
//
// ── WHY A SHARED HELPER AND NOT A HANDLER PER BANNER ─────────────────────────────────────────────
//
// There are several alert surfaces (the Dashboard banner, the notification bell, the Repair board's
// quick levers, System health) and they all want the same three lines. Written per banner they
// would drift: one would scroll but not flash, one would flash the card instead of the button, one
// would forget to clear the attribute and leave a permanent ring. The measured version of that
// mistake is on record — the panel's own label map covered 19 of ~130 action codes because it was a
// second copy (see components/admin/shared.tsx → ACT_LABEL's header).
//
// So: the LINK is built by one function (jumpUrl) and the LANDING is handled by one function
// (flashTarget). A banner supplies only the two facts it actually knows — where, and what.

/** A place inside the console that an alert can point at. */
export type JumpTarget = {
  /** The page, e.g. "/aevinite/restaurants". */
  path: string;
  /** Which restaurant this is about — the page's own focus/rid parameter. */
  restaurantId?: string | null;
  /** Some screens focus by slug (the restaurants page), some by id (repair, access). */
  restaurantSlug?: string | null;
  /** Which card to scroll to — the `?section=` value the target page already understands. */
  section?: string;
  /** Which control inside that card to ring, e.g. "maintenance". */
  control?: string;
};

/** The query-string name each page uses for "show me this one restaurant". */
const FOCUS_PARAM: Record<string, "focus-slug" | "focus-id" | "rid"> = {
  "/aevinite/restaurants": "focus-slug",  // ?focus=<slug>
  "/aevinite/repair": "focus-id",         // ?focus=<uuid>
  "/aevinite/access": "rid",              // ?rid=<uuid>
  "/aevinite/logs": "focus-id",           // ?focus=<uuid> — the log filter is by id
  "/aevinite/printing": "focus-id",
};

/**
 * jumpUrl — the href an alert's action button should carry.
 *
 * Only ever emits parameters the destination actually READS. A parameter nobody reads is worse
 * than none: the link looks like it narrows the screen and doesn't, so the admin trusts a filter
 * that isn't applied. (That is why `?focus=` on the Repair board was given a reader in the same
 * change that started sending it.)
 */
export function jumpUrl(t: JumpTarget): string {
  const qs = new URLSearchParams();
  const kind = FOCUS_PARAM[t.path];
  // The restaurants page matches `?focus=` against the slug OR the id (see its focus effect:
  // `r.slug === focusSlug || r.id === focusSlug`), so a caller that only holds one of the two
  // still gets a working link. Slug is preferred because it is the readable one in the address
  // bar and the one the page writes itself when a row is clicked.
  if (kind === "focus-slug" && (t.restaurantSlug || t.restaurantId)) qs.set("focus", t.restaurantSlug || t.restaurantId!);
  else if (kind === "focus-id" && t.restaurantId) qs.set("focus", t.restaurantId);
  else if (kind === "rid" && t.restaurantId) qs.set("rid", t.restaurantId);
  if (t.section) qs.set("section", t.section);
  // `control` travels as a HASH, not a query parameter. Two reasons: the browser restores it on a
  // Back, so returning to the screen still shows what he was pointed at; and the target pages
  // already strip `?section` from the URL once they have used it (see the restaurants page), which
  // would take a query-string control down with it.
  const hash = t.control ? `#ctl-${t.control}` : "";
  const q = qs.toString();
  return `${t.path}${q ? `?${q}` : ""}${hash}`;
}

/** How long the ring stays on. Three pulses of 0.9s in globals.css, plus a little slack. */
const FLASH_MS = 3000;

/**
 * flashTarget — the landing half. Call it once on the destination screen, after the thing it
 * points at exists.
 *
 * Reads `#ctl-<name>` off the URL, finds `[data-adm-ctl="<name>"]`, scrolls it into view and rings
 * it. Returns a cleanup function, so a component can call it from an effect and cancel the timer
 * if it unmounts first — otherwise the timer fires against a removed node.
 *
 * SILENT WHEN THERE IS NOTHING TO DO, and deliberately so: a hash for a control this screen does
 * not have (an old bookmark, a renamed control) leaves the screen exactly as it would have been.
 * The alternative — a message saying "couldn't find that button" — would be a warning about our
 * own link, shown to the one person who can't act on it.
 */
export function flashTarget(): () => void {
  if (typeof window === "undefined") return () => {};
  const name = (window.location.hash || "").replace(/^#ctl-/, "");
  if (!name || name === window.location.hash) return () => {};
  // ── WAIT FOR THE CONTROL TO EXIST, DON'T GUESS HOW LONG THAT TAKES ────────────────────────────
  //
  // Measured in the browser, 2026-09-02, and it failed twice before this shape:
  //
  //   • ONE PASS on the next frame — too early. The cards on the restaurants page fetch their own
  //     data, so a control can appear after the first paint, and one that exists can still MOVE.
  //   • A 2-SECOND POLL — still too early, and flaky in the worst way. On that page the detail is
  //     only rendered once the restaurant LIST has arrived, so on a cold page nothing carrying
  //     data-adm-ctl exists for longer than the window: the maintenance link rang on a warm page
  //     and the credentials link silently did nothing on a cold one. A deep-link that works when
  //     you have already used the app and not when you have just opened it is worse than one that
  //     never works, because nobody believes the bug report.
  //
  // So it OBSERVES instead of guessing. A MutationObserver fires when the node actually appears,
  // however long the fetches take, and disconnects the moment it lands — so there is no polling
  // and no arbitrary deadline to be wrong about. The cap is only a leak guard for the case where
  // the control never arrives at all (a renamed control, an old bookmark), and at that point
  // doing nothing is the right answer anyway.
  let clear = 0;
  let cap = 0;
  let settle = 0;
  let done = false;
  const land = (el: HTMLElement) => {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.setAttribute("data-adm-flash", "");
    clear = window.setTimeout(() => el.removeAttribute("data-adm-flash"), FLASH_MS);
    // One re-scroll after things settle: the page can keep growing for a beat after the control
    // appears (a sibling card's fetch landing), which would carry it back off screen.
    settle = window.setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 600);
  };
  const find = () => document.querySelector<HTMLElement>(`[data-adm-ctl="${CSS.escape(name)}"]`);
  const hit = find();
  const observer = new MutationObserver(() => {
    if (done) return;
    const el = find();
    if (!el) return;
    done = true;
    observer.disconnect();
    land(el);
  });
  if (hit) { done = true; land(hit); }
  else {
    observer.observe(document.body, { childList: true, subtree: true });
    // 20s: long enough for a cold page with a slow fetch, short enough that the observer is never
    // a permanent cost. Nothing depends on this number being exactly right.
    cap = window.setTimeout(() => { done = true; observer.disconnect(); }, 20000);
  }
  return () => {
    done = true;
    observer.disconnect();
    if (clear) clearTimeout(clear);
    if (cap) clearTimeout(cap);
    if (settle) clearTimeout(settle);
  };
}
