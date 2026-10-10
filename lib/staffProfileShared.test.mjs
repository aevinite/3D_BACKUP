import { test } from "node:test";
import assert from "node:assert/strict";
import { completeness, hasProfile, jobPatchFrom, mergeProfilePatch, paymentFrom, PROFILE_FIELDS, PROFILE_ROLES, todayIST } from "./staffProfileShared.ts";

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

// ── A PAY PERIOD MUST NAME A MONTH THAT EXISTS (sweep #9 T35, item 2) ────────────────────────
// `paymentFrom` tested the SHAPE of the month and not its value, so "2026-13" and "2026-00"
// walked past the one refusal written for them and became the dates 2026-13-01 / 2026-00-01.
// Postgres refuses those, so the whole payment was lost behind "That payment didn't save." with
// nothing on screen saying which field was wrong — from a function whose contract is that nothing
// else reaches the database.
test("a pay period outside January–December is refused, with the message written for it", () => {
  const period = (p) => paymentFrom({ amount: 100, for_period: p }).for_period;
  assert.equal(period("2026-01"), "2026-01-01", "January is the first month");
  assert.equal(period("2026-12"), "2026-12-01", "December is the last one");
  assert.equal(period("2026-03-17"), "2026-03-01", "a full date still lands on the 1st of its month");
  assert.equal(paymentFrom({ amount: 100 }).for_period, null, "no period at all is still fine");
  for (const bad of ["2026-00", "2026-13", "2026-99", "2026-1"]) {
    assert.throws(() => period(bad), /pay period isn't a valid month/, `"${bad}" must be refused`);
  }
});

// ── A DATE HAS TO BE A DAY THAT EXISTS (sweep #10 T18, item 3) ───────────────────────────────
// Shape alone let "1990-02-30" through: a birth date was stored as written, and a joining, leaving
// or payment date was handed to Postgres, which refused it with no field named. A mis-shaped
// payment date also turned into TODAY in silence.
test("an impossible birth date is never stored, and never erases the good one", () => {
  const keep = mergeProfilePatch({ dob: "1994-04-02" }, { dob: "1990-02-30" }, PROFILE_FIELDS);
  assert.equal(keep.dob, "1994-04-02", "a typo must not wipe a real date");
  assert.equal("dob" in mergeProfilePatch({}, { dob: "2026-13-01" }, PROFILE_FIELDS), false);
  assert.equal(mergeProfilePatch({}, { dob: "1992-02-29" }, PROFILE_FIELDS).dob, "1992-02-29", "a real leap day stays");
  assert.equal("dob" in mergeProfilePatch({ dob: "1994-04-02" }, { dob: "" }, PROFILE_FIELDS), false, "empty still clears");
});

test("a joining or leaving date that is not a real day is refused in words", () => {
  for (const bad of ["2026-02-30", "2026-13-01", "2025-00-10", "0000-01-01", "01-06-2025"]) {
    assert.throws(() => jobPatchFrom({ joined_on: bad }), /joining date isn't a real date/, bad);
    assert.throws(() => jobPatchFrom({ left_on: bad }), /leaving date isn't a real date/, bad);
  }
  assert.equal(jobPatchFrom({ joined_on: "2024-02-29" }).joined_on, "2024-02-29");
  assert.equal(jobPatchFrom({ left_on: "" }).left_on, null, "empty still means 'still working'");
});

test("a payment date that is not a real day is refused, not quietly made today", () => {
  for (const bad of ["2026-02-30", "2026-09-31", "9/10/2026"]) assert.throws(() => paymentFrom({ amount: 100, paid_on: bad }), /payment date isn't a real date/, bad);
  assert.equal(paymentFrom({ amount: 100 }).paid_on, todayIST(), "no date at all still means today");
  assert.equal(paymentFrom({ amount: 100, paid_on: "2026-01-31" }).paid_on, "2026-01-31");
});

// ── TEXT MEANS TEXT (sweep #10 T18, item 5) ──────────────────────────────────────────────────
// String(value) turned an object into "[object Object]" and a list into "Surat,Pune", and both
// were stored as somebody's name or city. A non-text value is now never stored as words.
test("a profile field sent an object or a list keeps what it had", () => {
  const out = mergeProfilePatch({ full_name: "Asha", city: "Surat" }, { full_name: { a: 1 }, city: ["Surat", "Pune"], email: "a@b.in" }, PROFILE_FIELDS);
  assert.equal(out.full_name, "Asha");
  assert.equal(out.city, "Surat");
  assert.equal(out.email, "a@b.in", "the good field in the same patch still saves");
  assert.equal(mergeProfilePatch({}, { pincode: 380015 }, PROFILE_FIELDS).pincode, "380015", "a number is still text");
});

test("a job or payment field sent something that is not text is refused in words", () => {
  assert.throws(() => jobPatchFrom({ designation: { x: 1 } }), /designation isn't plain text/);
  assert.throws(() => jobPatchFrom({ pay_extras: [{ label: ["a"], amount: 5 }] }), /allowance name isn't plain text/);
  assert.throws(() => paymentFrom({ amount: 100, note: { x: 1 } }), /note isn't plain text/);
  assert.equal(jobPatchFrom({ designation: "Captain" }).designation, "Captain");
  assert.equal(jobPatchFrom({ designation: null }).designation, null, "null still clears");
});

// ── A PAYMENT IS AT LEAST ONE PAISA (sweep #10 T18, item 13) ─────────────────────────────────
test("a payment that rounds to ₹0.00 is refused; one paisa is not", () => {
  for (const tiny of [0.004, "0.001", 0.0049]) assert.throws(() => paymentFrom({ amount: tiny }), /greater than zero/, String(tiny));
  assert.equal(paymentFrom({ amount: 0.005 }).amount, 0.01);
  assert.equal(paymentFrom({ amount: "0.01" }).amount, 0.01);
});
