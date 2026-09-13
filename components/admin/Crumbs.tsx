"use client";
// components/admin/Crumbs.tsx — ONE breadcrumb for the whole admin console.
//
// ── WHY (owner, 2026-09-13) ────────────────────────────────────────────────────────────────────
// He opened Printing from the sidebar, picked My Little French House, and the path above the
// heading read "Restaurants › My Little French House › Printing":
//
//   *"there is first of all restaurants. I have never gone to that. I'm in printing section …
//    path should be formed from where I have gone. If I go to access and permission directly,
//    then why the fuck the path is [four long]."*
//
// Three faults in one line, and they were in FIVE different hand-written breadcrumbs:
//
//   1. THE TRAIL WAS FICTION. Each page hard-coded an imaginary journey ("Restaurants › X ›
//      Printing", "Dashboard › Restaurants › X › Access") regardless of how you actually arrived.
//      Sidebar sections are SIBLINGS — Restaurants is not the parent of Printing — so a path that
//      starts at another section is describing a walk nobody took.
//   2. NOT EVERY CRUMB WAS A LINK. On Printing the restaurant name and the word "Printing" were
//      bare <span>s, so the one thing a path is for — stepping back up — did not work.
//   3. THE COLOURS DIDN'T MATCH. `.adm.adx .adm-crumbs` paints the path with a blue→violet→red
//      gradient, but it can only reach elements it names: `a`, `.cur` and `.sep`. Printing's last
//      two crumbs were class-less <span>s, so the gradient skipped them and they rendered grey —
//      exactly the difference he screenshotted between the two screens.
//
// ── THE RULE THIS FILE ENFORCES ────────────────────────────────────────────────────────────────
// The path is `[...parents, ...sectionChain, ...tail]`:
//   • the SECTION comes from the address bar (components/admin/nav.ts) — never typed by a page, so
//     it can never disagree with the sidebar;
//   • PARENTS are only added when the page can PROVE you drilled in from somewhere else, and the
//     proof lives in the URL (`?from=…`), so it survives a refresh and a shared link;
//   • the TAIL is what you chose ON this screen — the restaurant you opened, the report you
//     opened — and the page passes it because only the page knows the name.
// Everything except the last crumb is a real link. The last crumb is `.cur`. Separators are
// `.sep`. That markup is the whole reason the gradient now covers the line end to end.
//
// ── A NEW WAY REPLACES THE OLD ONE (owner, 2026-08-29, STANDING) ───────────────────────────────
// The five hand-written <nav className="adm-crumbs"> blocks are GONE — access, printing, recycle,
// restaurants and RestaurantReport. Do not add a sixth: a page declares its crumbs with
// `useCrumbs()` and the shell draws them, once, in one place. (The amber act-as ribbon inside the
// OWNER panel keeps its own crumb: it is a different surface, on a different shell, and describes
// a journey the owner specified himself on 2026-08-26.)
import { Fragment, createContext, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { sectionChain } from "@/components/admin/nav";

export type Crumb = {
  label: string;
  /** Omit on the final crumb — the shell drops the href of the last one anyway. */
  href?: string;
  /** For crumbs that step back INSIDE a page (closing a detail view) rather than navigating. */
  onClick?: () => void;
  /** Says what the click DOES, on hover and to a screen reader ("Back to all restaurants"). */
  title?: string;
};

export type CrumbSpec = {
  /** Crumbs ABOVE this section, because you genuinely drilled in from there (proved by `?from=`). */
  parents?: Crumb[];
  /** Crumbs BELOW this section — the restaurant you opened, the sub-view you opened. */
  tail?: Crumb[];
  /**
   * What tapping the SECTION crumb should do, when going back to the top of a section is a step
   * INSIDE the page rather than a navigation.
   *
   * The Restaurants screen is one page that swaps its own view: the list and a restaurant's detail
   * share the address /aevinite/restaurants, and which one you see is React state. A plain <Link>
   * to that address therefore changed the address bar and left the detail sitting open — measured
   * in Chrome on 2026-09-13, the path read "Restaurants › AANGAN GARDEN RESTAURANT" while the URL
   * had already dropped ?focus. Next does not remount a page for a same-route navigation, so the
   * page has to be told. (The old hand-written crumb did this with its own onClick; this is that
   * behaviour kept, not a new idea.)
   */
  onSection?: () => void;
  /** What tapping the section crumb does, in words — shown on hover, read out by a screen reader. */
  sectionTitle?: string;
  /**
   * The section crumb names the place you are ALREADY at, so it must not pretend to be a way out.
   *
   * Access & permissions is the case: it is always scoped to one restaurant and there is no
   * all-restaurants view of it, so `/aevinite/access` and `/aevinite/access?rid=…` are the same
   * screen. As a link it moved the address bar and changed nothing on screen — measured
   * 2026-09-13. A link that goes nowhere is worse than no link, so it renders as location text.
   * (Printing is the opposite: its section crumb really does lead back to the overview.)
   */
  sectionIsHere?: boolean;
};

const EMPTY: CrumbSpec = {};
const Ctx = createContext<{ spec: CrumbSpec; set: (s: CrumbSpec) => void }>({ spec: EMPTY, set: () => {} });

export function CrumbProvider({ children }: { children: React.ReactNode }) {
  const [spec, set] = useState<CrumbSpec>(EMPTY);
  const path = usePathname();
  // Leaving a page drops whatever it declared. Without this, opening Printing's French House and
  // then clicking Analytics in the sidebar would leave "› My Little French House" hanging off a
  // screen that has nothing to do with it — the exact class of fault he is complaining about.
  useEffect(() => { set(EMPTY); }, [path]);
  const value = useMemo(() => ({ spec, set }), [spec]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Declare the crumbs around this screen's section crumb. Pass nothing and the page still gets its
 * section name for free — which is why seventeen screens needed no edit at all.
 *
 * The spec is compared by VALUE (serialised), not by identity, so a page can build the object
 * inline in its render without looping: a re-render that produces the same crumbs is a no-op.
 */
export function useCrumbs(spec: CrumbSpec) {
  const { set } = useContext(Ctx);
  // onClick handlers are functions — JSON.stringify drops them, so a spec whose ONLY change is a
  // new closure identity (every render) correctly compares equal. THE COST OF THAT: a handler is
  // captured when the LABELS last changed, so it must not close over a value that moves
  // independently of them. Call stable functions (a setState, a useCallback) from inside it, which
  // is what every caller does today.
  const key = JSON.stringify(spec);
  useEffect(() => {
    set(spec);
    // Clearing on unmount matters for the views that swap in place (restaurant detail → full
    // report → back): the one going away must not leave its tail behind.
    return () => set(EMPTY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/**
 * The standard "I walked in from the Restaurants list" parent pair, written once so the two
 * screens that offer that door (Access, and anything added later) cannot spell it differently.
 * Only call it when the URL actually says so — `?from=rest`.
 */
export function restaurantParents(rest: { name: string; slug: string } | undefined | null): Crumb[] {
  return [
    { label: "Restaurants", href: "/aevinite/restaurants" },
    ...(rest ? [{ label: rest.name, href: `/aevinite/restaurants?focus=${encodeURIComponent(rest.slug)}` }] : []),
  ];
}

/** Drawn once by AdminShell, directly above every page's own content. */
export function AdminCrumbs() {
  const path = usePathname();
  const { spec } = useContext(Ctx);

  const chain = sectionChain(path);
  const crumbs: Crumb[] = [
    ...(spec.parents ?? []),
    // onSection / sectionIsHere apply to the LAST section crumb — the one this page belongs to.
    ...chain.map((s, i) => {
      const own = i === chain.length - 1;
      if (own && spec.sectionIsHere) return { label: s.label };
      return {
        label: s.label,
        href: s.href,
        ...(own && spec.onSection ? { onClick: spec.onSection } : {}),
        ...(own && spec.sectionTitle ? { title: spec.sectionTitle } : {}),
      };
    }),
    ...(spec.tail ?? []),
  ];
  // An address with no registered section (should not happen — every /aevinite page is in nav.ts)
  // gets no invented path. Better a missing line than a wrong one.
  if (crumbs.length === 0) return null;

  return (
    <nav className="adm-crumbs adx-noprint" aria-label="Breadcrumb" style={{ marginBottom: 14 }}>
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <Fragment key={`${c.label}-${i}`}>
            {i > 0 && <span className="sep" aria-hidden="true">›</span>}
            {last || (!c.href && !c.onClick) ? (
              // aria-current marks the page you are on, so a screen reader announces the line as a
              // position and not as a row of links that all sound the same.
              <span className="cur" {...(last ? { "aria-current": "page" as const } : {})}>{c.label}</span>
            ) : c.onClick ? (
              // A step back INSIDE the page (closing a detail) is still written as an <a> with a
              // real href, so middle-click and "open in new tab" land somewhere sensible and the
              // gradient — which is keyed on `a` — reaches it.
              <a href={c.href || path} title={c.title} onClick={(e) => { e.preventDefault(); c.onClick!(); }}>{c.label}</a>
            ) : (
              <Link href={c.href!} title={c.title}>{c.label}</Link>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
