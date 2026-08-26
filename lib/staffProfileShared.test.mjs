import { test } from "node:test";
import assert from "node:assert/strict";
import { completeness, hasProfile, mergeProfilePatch, PROFILE_FIELDS, PROFILE_ROLES } from "./staffProfileShared.ts";

// Everything a person's record can hold, filled in.
const FULL = {
  phone: "9876500000",
  profile: {
    full_name: "Ramesh Patel", dob: "1994-04-02", email: "r@example.com",
    address: "12 Market Road", city: "Ahmedabad",
    emg_name: "Meera", emg_phone: "9876511111",
    id_type: "Aadhaar", id_last4: "4821",
  },
  joined_on: "2025-06-01", designation: "Floor manager", employment_type: "full_time",
  shift_label: "Evening", pay_type: "monthly", pay_amount: 28000,
};
// The same record on a restaurant with no pay card: every OTHER detail filled, no rate set.
// Built by omission rather than destructured, so lint has no unused bindings to complain about.
const NO_PAY = Object.fromEntries(Object.entries(FULL).filter(([k]) => k !== "pay_type" && k !== "pay_amount"));

test("a full record reads as complete when there IS a pay card", () => {
  const c = completeness(FULL);
  assert.equal(c.total, 14);
  assert.equal(c.filled, 14);
  assert.deepEqual(c.missing, []);
});

// THE FAULT THIS LOCKS DOWN (sweep T15, 2026-08-18). The Pay card only appears for a non-owner, in
// a role that has a profile, at a restaurant whose payroll module is ON — and that module ships
// OFF. So on most restaurants, and for every cook and every owner, the rail counted a "pay setup"
// nobody could enter: the meter could never reach the end and the record read "13 of 14" for ever,
// asking for something the screen refuses to take.
test("with no pay card, pay setup is not asked for at all", () => {
  const c = completeness(NO_PAY, { pay: false });
  assert.equal(c.total, 13, "the denominator must drop with the question");
  assert.equal(c.filled, 13);
  assert.deepEqual(c.missing, [], 'a record with everything fillable filled must not still say "pay setup"');
});

test("the option defaults to the old behaviour, so the two API routes are unchanged", () => {
  assert.equal(completeness(NO_PAY).total, 14);
  assert.deepEqual(completeness(NO_PAY).missing, ["pay setup"]);
  assert.equal(completeness(NO_PAY, {}).total, 14);
  assert.equal(completeness(NO_PAY, { pay: true }).total, 14);
});

test("a person's own count never included pay setup, and still does not", () => {
  assert.equal(completeness(FULL).selfTotal, 8);
  assert.equal(completeness(NO_PAY, { pay: false }).selfTotal, 8);
});

// REJECTED (owner, 2026-07-29 · re-confirmed 2026-08-05 and 2026-08-07) — docs/REJECTED-IDEAS.md R7.
// Kitchen has no profile and must never be added to this list.
test("kitchen has no profile, and the three that do are unchanged", () => {
  assert.deepEqual([...PROFILE_ROLES], ["owner", "manager", "tablet"]);
  assert.equal(hasProfile("kitchen"), false);
  for (const r of ["owner", "manager", "tablet"]) assert.equal(hasProfile(r), true, r);
});

// ── "LAST 4 DIGITS" MEANS THE LAST FOUR (sweep #7 T15, 2026-08-27) ───────────────────────────
// Both fields are labelled "last 4" and both used to keep the FIRST four, so pasting a whole
// Aadhaar or account number stored the wrong digits with nothing on screen to say so — the
// record then identified no document at all, and looked perfectly filled in. Typing exactly
// four is the same either way, which is why nobody ever caught it by hand.
test("a last-4 field keeps the LAST four digits, whatever length is pasted", () => {
  const of = (v) => mergeProfilePatch({}, { id_last4: v }, PROFILE_FIELDS).id_last4;
  assert.equal(of("4821"), "4821", "four digits are unchanged");
  assert.equal(of("123456789012"), "9012", "a full 12-digit Aadhaar keeps its LAST four");
  assert.equal(of("50100123456789"), "6789", "a bank account keeps its LAST four");
  assert.equal(of("1234 5678 9012"), "9012", "spaces are stripped before the last four are taken");
  assert.equal(of("12"), "12", "fewer than four is kept as typed, not padded");
});

test("the bank tail follows the same rule as the ID tail", () => {
  const of = (v) => mergeProfilePatch({}, { bank_last4: v }, PROFILE_FIELDS).bank_last4;
  assert.equal(of("000123456789"), "6789");
  assert.equal(of("6789"), "6789");
});

test("an empty last-4 clears the field rather than storing an empty string", () => {
  const out = mergeProfilePatch({ id_last4: "4821" }, { id_last4: "" }, PROFILE_FIELDS);
  assert.equal("id_last4" in out, false);
});
