// The fixed set of payment methods staff pick from when marking a bill paid
// (owner, 2026-07-01). "Other" carries a free-text payment_note; the others don't.
// Shared by the editor and tablet API routes so the two never drift.
export const PAYMENT_METHODS = ["UPI", "Cash", "Card", "Other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
