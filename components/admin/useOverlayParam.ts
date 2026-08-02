"use client";
// ============================================================================
// useOverlayParam — "a refresh must leave me exactly where I am."
//
// Owner, 2026-08-02, looking at a staff profile on /aevinite/users: "I refresh —
// why do I go back to the main thing? I should be staying here. It's simple as
// that." The profile was React state only, so a reload threw it away and dropped
// him back on the list. This is the same rule the Access screen already follows
// for its open dropdowns; this hook is so the next screen gets it in one line.
//
// The open thing lives in the URL (?staff=<id>), which buys three things at once:
//   • a refresh reopens it,
//   • the address bar is a link straight to that person.
// No extra reads: the id was already in memory, and the page loads the same data
// either way.
//
// NO FLASH, NO MISMATCH. The first render must match what the server sent (which
// knows nothing about the address bar), so the id is read in a LAYOUT effect —
// after the DOM exists but BEFORE the browser paints. Reading it in the state
// initialiser instead makes the client's first render disagree with the server's,
// and React answers a mismatch by re-rendering the whole page (in dev it also
// complains about the root layout's theme <script>). Reading it in a plain effect
// would be safe but paints the list first and then the overlay on top of it —
// exactly the flicker this is meant to remove.
// ============================================================================

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// useLayoutEffect does nothing on the server and React says so, loudly. Same hook
// on the client, the harmless one during SSR.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const read = (key: string): string | null => {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get(key);
  return v && v.trim() ? v : null;
};

/**
 * `const [openId, setOpenId] = useOverlayParam("staff")`
 *
 * IT ONLY RECORDS, IT NEVER NAVIGATES. The overlay's Back behaviour already belongs to
 * `useAdminModal` (the admin twin of the guest `useBackClose`), which pushes its own entry
 * so a phone's Back peels one layer at a time. Pushing a SECOND entry here for the same
 * overlay put two managers on one Back press: the first press ate this hook's entry, the
 * sheet stayed open and the URL never changed — a Back that did nothing. So this uses
 * `replaceState` only, and the URL is a note of where you are, nothing more.
 * (The project rule this is a case of: don't hand-roll history next to a manager.)
 */
export function useOverlayParam(key: string): [string | null, (id: string | null) => void] {
  const [id, setId] = useState<string | null>(null);

  // Read the address bar ONCE, before the first paint: if it names something, open it.
  useIsoLayoutEffect(() => { const v = read(key); if (v) setId(v); }, [key]);

  // From then on the URL only ever FOLLOWS the state, never the other way round. That
  // direction matters: the modal's back-stack pushes its own history entry when it opens,
  // so a close ends with a `history.back()` onto the entry underneath — and that entry was
  // stamped with ?staff=… when the profile opened. Reading the URL on `popstate` therefore
  // read its own old stamp and re-opened the profile the person had just closed (× did
  // nothing, twice in a row). Re-stamping on every popstate instead keeps the address bar
  // honest wherever Back lands.
  const idRef = useRef<string | null>(null);
  idRef.current = id;

  const sync = useCallback(() => {
    const url = new URL(window.location.href);
    const want = idRef.current;
    if (url.searchParams.get(key) === (want ?? null)) return;
    if (want) url.searchParams.set(key, want);
    else url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", url.toString());
  }, [key]);

  useEffect(() => { sync(); }, [id, sync]);
  useEffect(() => {
    const onPop = () => sync();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [sync]);

  return [id, setId];
}

/**
 * Remember how far down a scrolling element was, per key, and put it back when the
 * element reappears. Session-scoped: it is about THIS visit, not a stored preference.
 */
export function useScrollMemory(ref: { current: HTMLElement | null }, key: string, ready: boolean) {
  // Restore once the content that gives the element its height has actually rendered —
  // `ready` is what re-runs this effect after the data lands, which is also when ref.current
  // is populated. (Reading ref.current directly as an argument would capture null forever.)
  useEffect(() => {
    const el = ref.current;
    if (!el || !ready) return;
    const saved = Number(sessionStorage.getItem(key) || "0");
    if (saved > 0) {
      // Two frames: one for layout, one for images/late cards that change the height.
      requestAnimationFrame(() => {
        el.scrollTop = saved;
        requestAnimationFrame(() => { if (el.scrollTop < saved) el.scrollTop = saved; });
      });
    }
    let t: number | undefined;
    const onScroll = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => sessionStorage.setItem(key, String(Math.round(el.scrollTop))), 150);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.clearTimeout(t); el.removeEventListener("scroll", onScroll); };
  }, [ref, key, ready]);
}
