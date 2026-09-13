// components/admin/nav.ts — THE ONE PLACE THAT KNOWS WHAT EVERY ADMIN SCREEN IS CALLED.
//
// WHY THIS FILE EXISTS (owner, 2026-09-13). The console had five hand-written breadcrumbs and
// seventeen screens with none at all, so the path above a page was whatever the person who wrote
// that page happened to type. The Printing screen said "Restaurants › My Little French House ›
// Printing" when you had walked in from the SIDEBAR and never opened Restaurants at all; the
// Access screen said "Dashboard › Restaurants › <name> › Access" for the same reason. His words:
// *"I have never gone to that. I'm in printing section… path should be formed from where I have
// gone."*
//
// So the sidebar list and the breadcrumb labels are now the SAME data. A screen cannot be called
// one thing in the sidebar and another in the path, and a new screen gets its path for free the
// moment it is added here. (Before this, `GROUPS` lived inside AdminShell.tsx and the crumbs were
// string literals scattered across five files.)
//
// ── THE PATH RULE, IN ONE LINE ─────────────────────────────────────────────────────────────────
// Sections are SIBLINGS, not parents. Dashboard is not above Printing; Restaurants is not above
// Access. So a path starts at the section you are in, and only grows when you actually drilled
// DOWN into something — either a real sub-page (`parent` below) or a restaurant you chose on that
// screen (the page passes those crumbs itself, see components/admin/Crumbs.tsx).

export type NavItem = { href: string; label: string; icon: string; exact?: boolean; soon?: boolean };
export type NavGroup = { label: string; items: NavItem[]; quiet?: boolean };

// Grouped nav: Operate (daily work) / Manage (tenants & access) / Platform /
// Coming soon (quiet — placeholders, no dead ends).
// (Owner 2026-07-04: "Command" reads wrong → Dashboard. The old global "Features"
// page confused him — per-restaurant features already live in each restaurant's
// detail + the Access-control hub, so the nav entry is gone; the page itself stays
// reachable by URL until we delete it.)
export const GROUPS: NavGroup[] = [
  {
    label: "Operate",
    items: [
      { href: "/aevinite", label: "Dashboard", icon: "fa-table-columns", exact: true },
      { href: "/aevinite/floor", label: "Live floor", icon: "fa-chair" },
      { href: "/aevinite/analytics", label: "Analytics", icon: "fa-chart-pie" },
      { href: "/aevinite/bill-audit", label: "Bills", icon: "fa-file-invoice-dollar" },
      { href: "/aevinite/repair", label: "Repair & support", icon: "fa-screwdriver-wrench" },
      { href: "/aevinite/logs", label: "Audit & logs", icon: "fa-scroll" },
    ],
  },
  {
    label: "Manage",
    items: [
      { href: "/aevinite/restaurants", label: "Restaurants", icon: "fa-store" },
      // ONE ENTRY FOR EVERY PERSON (owner, 2026-09-13: "merge 2 section name it user and owner").
      // "Owners" and "Users" were two sidebar entries answering the same question from two doors,
      // so you had to know the person's role before you could find them. Now it is one screen with
      // an Owner/User switch at the top. Both old addresses redirect into the right half of it.
      { href: "/aevinite/people", label: "Users & owners", icon: "fa-users-gear" },
      { href: "/aevinite/customers", label: "Customers", icon: "fa-user-group" },
      { href: "/aevinite/recycle", label: "Recycle bin", icon: "fa-trash-can" },
      // ONE NAME FOR THE SCREEN (sweep T6, 2026-08-10). The sidebar said "Access / Permissions"
      // and the page you land on says "Access & permissions" — and the docs, the deep links and
      // the owner all call it "Access". Two names for one screen is a small thing that makes
      // every instruction about it ambiguous.
      { href: "/aevinite/access", label: "Access & permissions", icon: "fa-key" },
      // Printing is hardware, and hardware is granted, not chosen: which computers may print and
      // what each of them prints lives here (owner, 2026-08-20: "maybe we can create whole new
      // printing menu in the admin panel for setup and all").
      { href: "/aevinite/printing", label: "Printing", icon: "fa-print" },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/aevinite/revenue", label: "Revenue", icon: "fa-chart-line" },
      { href: "/aevinite/usage", label: "Usage & cost", icon: "fa-gauge-high" },
      { href: "/aevinite/billing", label: "Billing & plans", icon: "fa-file-invoice" },
      { href: "/aevinite/health", label: "System health", icon: "fa-heart-pulse" },
      { href: "/aevinite/rate-limits", label: "Rate limits", icon: "fa-shield-halved" },
      { href: "/aevinite/settings", label: "Settings", icon: "fa-gear" },
    ],
  },
];

export type Section = { href: string; label: string; parent?: string };

// Screens that are NOT sidebar entries. Two kinds:
//   • a real sub-page of a section — it names its `parent`, and the path walks up to it;
//   • an address kept alive for bookmarks (the redirects) — listed so that if one ever stops
//     redirecting, it still has a name instead of falling back to a raw URL segment.
const OFF_NAV: Section[] = [
  { href: "/aevinite/bill-audit/changes", label: "Change log", parent: "/aevinite/bill-audit" },
  { href: "/aevinite/staff-online", label: "Staff online" },
  // /aevinite/attention and /aevinite/issues redirect into Repair & support; /aevinite/owners and
  // /aevinite/users redirect into Users & owners. They never render a page of their own, so they
  // never need a label — the screen you land on supplies it.
];

// href → section, longest match wins (so /aevinite/bill-audit/changes beats /aevinite/bill-audit,
// and the bare /aevinite dashboard only ever matches itself).
const BY_HREF = new Map<string, Section>();
for (const g of GROUPS) for (const n of g.items) BY_HREF.set(n.href, { href: n.href, label: n.label });
for (const s of OFF_NAV) BY_HREF.set(s.href, s);

/** The section a path belongs to — the longest registered address that is a prefix of it. */
export function sectionFor(pathname: string): Section | null {
  let best: Section | null = null;
  for (const [href, s] of BY_HREF) {
    if (pathname === href || pathname.startsWith(href + "/")) {
      if (!best || href.length > best.href.length) best = s;
    }
  }
  return best;
}

/** A section and everything above it, root first — e.g. Bills › Change log. */
export function sectionChain(pathname: string): Section[] {
  const chain: Section[] = [];
  let cur = sectionFor(pathname);
  // `seen` stops a typo'd `parent` loop from hanging the console.
  const seen = new Set<string>();
  while (cur && !seen.has(cur.href)) {
    seen.add(cur.href);
    chain.unshift(cur);
    cur = cur.parent ? BY_HREF.get(cur.parent) ?? null : null;
  }
  return chain;
}
