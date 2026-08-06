// verify-owner-clash.mjs — "can two owners still silently overwrite the same value?"
//
//   node scripts/verify-owner-clash.mjs                 # static checks only (no DB, no login)
//   node scripts/verify-owner-clash.mjs --base <url>    # + a REAL first-save-wins write test
//
// WHY THIS FILE EXISTS (T9 sweep, 2026-08-05)
// "First save wins, and the loser is told" reached the three vanilla panels in 2026-07-30 and the
// ADMIN's staff profile in 2026-08-04. It had NOT reached the OWNER panel — which has its own
// profile page writing the SAME staff_users columns, pay_amount included. So one door protected a
// person's salary and the other did not, and scripts/verify-clash-coverage.mjs reported green
// because the owner panel sat under its "not covered by design" footnote.
//
// verify-clash-coverage.mjs now walks those screens, but it can only see that an expectation is
// SENT and that the route CALLS expectClash. This file checks the things a text scan cannot:
//   · the gate sits where every branch of the handler passes through it, not just one action;
//   · `feedback` is on the comparable-tables allowlist, or the ratings note's expectation is
//     silently ignored (an unknown table returns null, which reads as "nothing to protect");
//   · and with --base, that a stale expectation is genuinely REFUSED with a plain sentence.
//
// The live test writes ONE value and then attempts ONE stale overwrite, and it RESTORES the
// original value in the same run — see restore() below. It signs in ONCE via the shared cached
// helper (never in a loop), so it cannot raise a login limit alert.
import fs from "node:fs";
import path from "node:path";

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const BASE = arg("--base");
let fail = 0, pass = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const read = (f) => { try { return fs.readFileSync(path.resolve(f), "utf8"); } catch { return null; } };

console.log("Owner-panel clash protection\n");

// ── 1 · the routes read an expectation, on every branch that writes a typed value ──────────────
{
  const staff = read("app/api/owner/staff/route.ts");
  if (!staff) bad("app/api/owner/staff/route.ts not found (if it moved, update this guard)");
  else {
    const gates = (staff.match(/expectClash\s*\(/g) || []).length;
    // TWO gates are required, not one: patchImpl resolves the target restaurant in two different
    // places — the profile/pay branch via target(), and the account branch (`edit`) via its own
    // row read — and each returns before reaching the other. One gate would leave a branch open.
    if (gates >= 2) ok(`owner/staff calls expectClash on both write branches (${gates} gates)`);
    else bad(`owner/staff has ${gates} expectClash gate(s) — the profile/pay branch and the "edit" branch each need one`);
    // The gate must come BEFORE the update, or it is decoration.
    const firstGate = staff.indexOf("expectClash");
    const firstUpdate = staff.indexOf('.update({ profile');
    if (firstGate > -1 && firstUpdate > -1 && firstGate < firstUpdate) ok("the gate runs before the profile write");
    else bad("the profile write is not behind the gate");
  }

  const ratings = read("app/api/owner/ratings/route.ts");
  if (!ratings) bad("app/api/owner/ratings/route.ts not found");
  else if (/expectClash\s*\(/.test(ratings)) ok("owner/ratings calls expectClash (the reply note)");
  else bad("owner/ratings never calls expectClash — a note can be silently overwritten");
}

// ── 2 · the tables those expectations name are actually comparable ─────────────────────────────
// lib/clash.ts returns null for a table it does not know, and null reads as "nothing to protect".
// So a screen can send a perfectly-formed expectation naming `feedback` and be ignored entirely.
{
  const clash = read("lib/clash.ts");
  if (!clash) bad("lib/clash.ts not found");
  else {
    for (const t of ["staff_users", "feedback"]) {
      if (new RegExp(`^\\s*${t}:\\s*"id"`, "m").test(clash)) ok(`${t} is on the comparable-tables allowlist`);
      else bad(`${t} is NOT on COMPARABLE_TABLES — an expectation naming it is silently ignored`);
    }
  }
}

// ── 3 · the screens send it, and show the refusal in words ────────────────────────────────────
// A 409 the person never sees is the same as a silent overwrite from their point of view.
{
  // ── CHECK WHERE THE WRITE ACTUALLY LIVES, NOT WHERE IT USED TO (T9 sweep, 2026-08-06) ───────────
  // The owner's staff profile stopped being a screen of its own on 2026-08-06: it is now a ~38-line
  // mount point (app/owner/staff/[id]/page.tsx) that renders the SAME component Aevidine opens,
  // pointed at the owner's endpoint — one shape, per docs/STAFF-PROFILE.md. The fetch that carries
  // X-LFH-Expect and words the 409 moved with it, into components/owner/ownerProfileHost.ts. This
  // check still grepped the page file, so it reported "sends no X-LFH-Expect" for a protection that
  // was fully present two files away — a guard gone red for a refactor rather than a regression, and
  // a red guard nobody can act on is one people learn to ignore.
  //
  // Each entry is now a LIST of the files that together own that screen's write; the check passes if
  // the header and the plain wording are found across them. `verify:clash` independently confirms the
  // same two call sites (ownerProfileHost.ts:63, StaffProfile.tsx:100).
  for (const [files, what] of [
    [["components/owner/ownerProfileHost.ts", "components/admin/StaffProfile.tsx", "app/owner/staff/[id]/page.tsx"],
      "the owner's staff profile"],
    [["app/owner/staff/page.tsx"], "the owner's staff roster"],
    [["app/owner/issues/page.tsx"], "the rating reply note"],
  ]) {
    const sources = files.map((f) => read(f)).filter(Boolean);
    if (!sources.length) { bad(`${what}: none of ${files.join(", ")} found`); continue; }
    const src = sources.join("\n");
    if (/X-LFH-Expect/.test(src)) ok(`${what} sends what it was editing from`);
    else bad(`${what} sends no X-LFH-Expect — the server has nothing to compare`);
    // clash.plain is the plain sentence lib/clash.ts writes for a person to read.
    if (/clash[\s\S]{0,120}plain/.test(src)) ok(`${what} shows the refusal in plain words`);
    else bad(`${what} throws a bare code on 409 — the person is not told what happened`);
  }
}

// ── 4 · a stale save is REALLY refused (only with --base) ─────────────────────────────────────
if (!BASE) {
  console.log("\n  (skipped the live first-save-wins test — pass --base <url> to run it)");
} else {
  const { chromium } = await import("playwright");
  const { loginAs } = await import("./sweep/login.mjs");
  const br = await chromium.launch();
  const ctx = await br.newContext();
  let original = null, target = null, restored = false;
  const api = async (method, path, body, headers = {}) => {
    const r = await ctx.request.fetch(BASE + path, {
      method, headers: { "Content-Type": "application/json", ...headers },
      ...(body ? { data: body } : {}),
    });
    let j = null; try { j = await r.json(); } catch { /* non-JSON */ }
    return { status: r.status(), j };
  };
  // Put the value back whatever happens, including on a crash — a test that leaves a real
  // restaurant's data changed is worse than no test (CLAUDE.md test-safety rules).
  const restore = async () => {
    if (restored || !target || original === null) return;
    restored = true;
    await api("PATCH", "/api/owner/staff", { id: target, action: "set_job", designation: original });
    console.log(`  ↩︎  restored designation to ${JSON.stringify(original)}`);
  };
  process.on("exit", () => { /* best-effort marker only; the awaited restore below is the real one */ });
  try {
    await loginAs(ctx, "owner", BASE);            // ONE login, cached by the helper
    const roster = await api("GET", "/api/owner/staff");
    if (roster.status !== 200) throw new Error(`couldn't read the roster (${roster.status})`);
    // Pick a WAITER/KITCHEN row — never a manager, and never anybody's pay: `designation` is a
    // harmless text field that goes through the identical set_job gate as pay_amount does.
    const person = (roster.j?.staff || []).find((s) => s.profileEligible && s.role === "tablet")
      || (roster.j?.staff || []).find((s) => s.profileEligible);
    if (!person) { console.log("  ⏭  no profile-eligible person on this stack — live test skipped"); }
    else {
      target = person.id;
      original = person.designation ?? "";
      const mine = `t9-clash-${Date.now()}`;
      // (a) first save, with a TRUE expectation → must be accepted
      const first = await api("PATCH", "/api/owner/staff",
        { id: target, action: "set_job", designation: mine },
        { "X-LFH-Expect": JSON.stringify({ table: "staff_users", id: target, fields: { designation: original } }) });
      if (first.status === 200) ok("first save wins (a true expectation is accepted)");
      else bad(`the first save was refused (${first.status}) — ${JSON.stringify(first.j).slice(0, 160)}`);

      // (b) second save from a screen that still believes the OLD value → must be REFUSED
      const second = await api("PATCH", "/api/owner/staff",
        { id: target, action: "set_job", designation: "t9-should-never-land" },
        { "X-LFH-Expect": JSON.stringify({ table: "staff_users", id: target, fields: { designation: original } }) });
      if (second.status === 409) ok("a stale save is refused with 409, not silently applied");
      else bad(`a stale save was ACCEPTED (${second.status}) — this is the silent overwrite`);
      if (second.j?.clash?.plain) ok(`the refusal carries a plain sentence: "${String(second.j.clash.plain).slice(0, 80)}"`);
      else bad("the 409 carries no plain sentence for the person to read");

      // (c) and the value on the server is still the FIRST person's, not the loser's
      const after = await api("GET", "/api/owner/staff");
      const now = (after.j?.staff || []).find((s) => s.id === target)?.designation;
      if (now === mine) ok("the first writer's value is what the server holds");
      else bad(`the server holds ${JSON.stringify(now)} — expected the first writer's value`);
    }
  } catch (e) {
    bad(`live test could not run: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await restore();
    await ctx.close(); await br.close();
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log("\n❌ FAIL — see CLAUDE.md → NEW-FEATURE CHECKLIST item 11 (no silent overwrites).");
else console.log("\n✅ PASS — the owner panel's typed values cannot be silently overwritten");
process.exit(fail ? 1 : 0);
