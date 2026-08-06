// lib/partialRead.ts — "this ONE figure couldn't be read", in words. CLIENT-SAFE ON PURPOSE.
//
// ── WHY THIS FILE EXISTS AND NOT JUST lib/ownerScope ──────────────────────────────────────────────
// These three exports lived in lib/ownerScope for a few hours on 2026-08-06 and that BROKE the
// owner's Pay Later page in production. `app/owner/khata/page.tsx` is a "use client" component, so
// importing `partialNote` from lib/ownerScope pulled that whole module into the BROWSER bundle — and
// lib/ownerScope imports lib/supabaseAdmin, which calls createClient() with the service-role key at
// module scope. In a browser that env var does not exist, so the page threw
// "supabaseKey is required." before it rendered anything.
//
// Nothing leaked: Next.js only inlines NEXT_PUBLIC_* variables, so the key was `undefined` — which is
// exactly why it threw rather than shipping. Verified against the deployed chunk (the service-role
// value and even its variable NAME are absent). But the page was down, and the lesson is the general
// one: a module a client component imports must not, anywhere in its import graph, reach a
// server-only client.
//
// So the WORDS live here, with ZERO imports, and lib/ownerScope re-exports them for server callers.
// `npm run verify:server-only` (scripts/verify-server-only-imports.mjs) now fails the build if any
// "use client" file imports a module that leads to supabaseAdmin, so this cannot come back quietly.

// Which parts of a multi-read screen may be reported as unread. Several owner screens are built from
// SEVERAL reads at once: Pay Later is outstanding + collected today + collected this month; the day
// sheet is sales + settlement + tips + wages + stock; the hub is the restaurant list + a module probe.
// A failed piece used to have only two endings, and both were dishonest in their own way:
//   · a silent ZERO — "collected today ₹0" when nobody read it. That is a claim, and it is the shape
//     that starts an argument with the till.
//   · the WHOLE page as a retryable 503 — which throws away the figures that were perfectly fine.
//
// The rule for using it: a key belongs in `partial` when the value is ABSENT (null/undefined), never
// when it is a real zero. If a caller cannot tell the two apart, it must not use this — it should fail
// the request instead.
export type PartialKey =
  | "collectedToday" | "collectedMonth"              // Pay Later
  | "payments" | "tips" | "staffPay" | "inventory"   // the day sheet's optional lines
  | "categories"                                     // the dashboard's revenue-by-category chart
  | "modules";                                       // the hub's payroll/inventory card probes
// NOTE: the staff roster deliberately does NOT use this. A list is better served by a per-ROW marker
// (`payUnread` on each person) than by one note at the top of the page, because the owner needs to
// know WHICH people's figures are missing, not just that some are.

const PARTIAL_LABELS: Record<PartialKey, string> = {
  collectedToday: "money collected today",
  collectedMonth: "money collected this month",
  payments: "how the money arrived",
  categories: "revenue by category",
  tips: "tips",
  staffPay: "staff pay",
  inventory: "stock figures",
  modules: "which features are on",
};

/** Plain words for one unread part, for a screen to put in front of a person. */
export function partialLabel(k: string): string {
  return PARTIAL_LABELS[k as PartialKey] ?? k;
}

/** The one sentence every screen uses, so they cannot word it eight different ways. */
export function partialNote(keys: string[]): string {
  if (!keys.length) return "";
  const words = keys.map(partialLabel);
  const list = words.length === 1 ? words[0]
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  return `Couldn't read ${list} just now — everything else on this page is up to date.`;
}
