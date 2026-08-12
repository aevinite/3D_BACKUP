// lib/personalData.ts — EVERY place a guest's name or phone number is stored, in one list.
//
// ── WHY (improvement I15, owner 2026-08-12: "don't we have that already? what's now and what
//    changes?") ──────────────────────────────────────────────────────────────────────────────────
//
// What existed: `/api/owner/customers` DELETE named its tables by hand — three of them, then four
// after the T9 fix added `khata_customers`. That list was right only because somebody had just gone
// looking. It had already been wrong once: `khata_customers` held a name and a phone number from the
// day pay-later shipped, and the erase never knew, so an "erased" guest stayed searchable on the
// floor staff's screen for months.
//
// What changes: the knowledge moves out of one route's function body and into a declared list, and
// `scripts/verify-personal-data.mjs` fails the build when a table gains a `phone`/`name` column
// without appearing here. The erase stops depending on anyone's memory.
//
// ── AND IT FOUND TWO MORE (which is the actual point) ────────────────────────────────────────────
//
// Writing the list down turned up two places nobody had counted: `sessions.cust_name/cust_phone`
// (the bill's own copy of who it was made out to, mig 227) and
// `aggregator_orders.customer_name/customer_phone` (a Zomato/Swiggy order, mig 071).
//
// Both are ISSUED SALES DOCUMENTS, and that changes the answer rather than lengthening the delete
// list. Migration 227 is explicit about why the bill keeps its own copy: "so that editing or
// deleting a customer later can never rewrite an issued invoice." Wiping the name off a tax invoice
// after the fact is altering a filed document — the CGST §132 territory this project is built to
// stay out of (docs/COMPLIANCE-GUARDRAILS.md).
//
// So each place gets a POLICY, not a blanket delete:
//
//   erase      — the row exists only to remember this person. It goes.
//   anonymise  — a sales record points at the row, so the ROW must survive; the PERSON is cleared
//                out of it. (`khata_customers`: `orders.khata_customer_id` is a foreign key, so a
//                delete is refused outright — proved by the fixture test before it ever shipped.)
//   keep       — the field is part of an issued document. It stays, and the owner is TOLD it stayed
//                and why, which is the honest half that was missing entirely before.
//
// A "keep" is not the app quietly ignoring a legal request: an erasure that cannot be complete has
// to say so out loud, so the owner can answer the guest accurately instead of promising something
// the books never did.

export type ErasurePolicy = "erase" | "anonymise" | "keep";

export type PersonalDataPlace = {
  table: string;
  /** How this table names the guest's phone. The erase matches on it. */
  phoneColumn: string;
  /** The columns that carry the person, for an `anonymise`. */
  personColumns: string[];
  policy: ErasurePolicy;
  /** Plain words for the owner, used when the erase reports what it did. */
  what: string;
  /** For a `keep`: WHY it survived. Shown to the owner verbatim. */
  why?: string;
  /** For an `anonymise`: what the person's fields become. */
  anonymiseTo?: Record<string, string | null>;
  /**
   * HOW TO LIMIT THE ERASE TO THIS OWNER'S RESTAURANT — which matters more than it looks.
   *
   * An owner asking to erase a guest is asking about THEIR restaurant. The same phone number may
   * also be a guest at a different restaurant on this platform, and that owner has no right to
   * touch it. So every place says how it is narrowed:
   *
   *   "restaurant" — the table has its own `restaurant_id`. Simple and exact.
   *   "session"    — no `restaurant_id`, but it hangs off a session, so the erase resolves that
   *                  restaurant's session ids first and matches within them.
   *   "phone"      — genuinely global, and only allowed where a row is transient and carries
   *                  nothing but the number (see `otp_codes`, which self-expires).
   */
  scopeBy: "restaurant" | "session" | "phone";
};

export const PERSONAL_DATA: PersonalDataPlace[] = [
  {
    table: "customers",
    phoneColumn: "phone",
    personColumns: ["phone", "name"],
    policy: "erase",
    what: "their entry in your guest list",
    scopeBy: "restaurant",
  },
  {
    table: "customer_visits",
    phoneColumn: "phone",
    personColumns: ["phone"],
    policy: "erase",
    what: "their visit history",
    scopeBy: "restaurant",
  },
  {
    table: "customer_devices",
    phoneColumn: "phone",
    personColumns: ["phone"],
    policy: "erase",
    what: "the devices linked to them",
    scopeBy: "restaurant",
  },
  {
    table: "khata_customers",
    phoneColumn: "phone",
    personColumns: ["name", "phone", "note"],
    policy: "anonymise",
    anonymiseTo: { name: "Erased at their request", phone: null, note: null },
    what: "their name and number in the pay-later book",
    why: "The row itself has to stay — a pay-later bill points at it — so the person is cleared out of it instead.",
    scopeBy: "restaurant",
  },
  // ── The four the GUARD found, which is the whole argument for having written it ────────────────
  // None of these were in anyone's head. `scripts/verify-personal-data.mjs` read the schema and
  // listed them on its first run — after the erase had already been "fixed" twice by hand.
  {
    table: "session_members",
    phoneColumn: "phone",
    personColumns: ["name", "phone"],
    policy: "erase",
    what: "their name and number from tables they sat at",
    scopeBy: "session",
  },
  {
    table: "requests",
    phoneColumn: "phone",
    personColumns: ["name", "phone"],
    policy: "erase",
    what: "their old requests to join a table",
    scopeBy: "session",
  },
  {
    table: "otp_codes",
    phoneColumn: "phone",
    personColumns: ["phone"],
    policy: "erase",
    what: "any verification codes sent to them",
    // The one genuinely global place, and it is safe: a one-time code expires on its own and holds
    // nothing but the number. Clearing another restaurant's pending code costs that guest one tap to
    // ask for a new one — which is a very different thing from erasing their history there.
    scopeBy: "phone",
  },
  {
    table: "blocklist",
    phoneColumn: "phone",
    personColumns: ["phone"],
    policy: "keep",
    what: "the record that they are banned from ordering",
    why: "If this went too, a banned guest could clear their ban by asking to be erased — so it stays. It holds a number and a reason, nothing else.",
    // `blocklist` has no restaurant column, but it is a KEEP, so nothing is written to it and the
    // scope never comes into play. Recorded as "restaurant" because that is what it would be.
    scopeBy: "restaurant",
  },
  {
    table: "sessions",
    phoneColumn: "cust_phone",
    personColumns: ["cust_name", "cust_phone"],
    policy: "keep",
    what: "the name and number printed on their past bills",
    why: "Those are issued bills. Changing a bill after it has been given to a customer and counted in the tax return is not something this system will do.",
    scopeBy: "restaurant",
  },
  {
    table: "aggregator_orders",
    phoneColumn: "customer_phone",
    personColumns: ["customer_name", "customer_phone"],
    policy: "keep",
    what: "their details on past delivery orders",
    why: "Delivery orders are sales records too, and the delivery app holds its own copy either way.",
    scopeBy: "restaurant",
  },
];

/** The places the erase actually writes to. */
export const ERASABLE = PERSONAL_DATA.filter((p) => p.policy !== "keep");
/** The places that survive, and must be disclosed. */
export const RETAINED = PERSONAL_DATA.filter((p) => p.policy === "keep");

/**
 * What the owner should be told after an erase.
 *
 * Deliberately says the kept things out loud. "Erased" with a silent asterisk is how the original
 * `khata_customers` gap survived so long — nobody was ever shown a list to check.
 */
export function erasureSummary(): { removed: string[]; kept: { what: string; why: string }[] } {
  return {
    removed: ERASABLE.map((p) => p.what),
    kept: RETAINED.map((p) => ({ what: p.what, why: p.why || "" })),
  };
}
