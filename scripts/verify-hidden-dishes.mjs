#!/usr/bin/env node
// verify-hidden-dishes.mjs — A DISH TAKEN OFF THE MENU IS REALLY OFF THE MENU.
//
//   node scripts/verify-hidden-dishes.mjs
//
// THE FEATURE (owner, 2026-08-06). A dish now has three states, and two of them are different
// promises to a diner:
//
//   on the menu   nothing set
//   SOLD OUT      still SHOWS, wearing its badge — "we have this, just not today"
//   HIDDEN        not on the guest menu at all — "as far as you're concerned it doesn't exist"
//
// STAFF ARE DELIBERATELY UNAFFECTED: a waiter may still put a hidden dish on a bill (an off-menu
// special, a staff meal, something served on request). So "hidden" must be enforced on the GUEST
// side only — and enforced in more than one place, because CLAUDE.md's rule is that hiding is
// never the only guard: the grid filter, the dish page, AND the two ordering functions.
//
// ⚠ THE REASON THIS FILE EXISTS AT ALL is the recreate trap. Migration 306 had to CREATE OR
// REPLACE both guest ordering functions to add its check, and this codebase has already been
// bitten once: mig 264's first draft silently dropped mig 253's open-price guard because the body
// had been copied from the wrong ancestor. Every check in section 3 asserts an OLDER guard is
// still standing in the recreated body. If you recreate either function again, run this.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
let fail = 0;
const check = (name, ok) => { console.log((ok ? "  ok   " : "  FAIL ") + name); if (!ok) fail++; };

// Find the migration by CONTENT, never by number — parallel branches get renumbered on merge.
const migWith = (needle) => {
  const dir = join(root, "supabase/migrations");
  return readdirSync(dir).filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .filter((sql) => sql.includes(needle)).join("\n");
};
const mig = migWith("'hidden' = ANY(m.tags)");
const menu = read("lib/menu.ts");
const editor = read("public/panels/editor/app.js");
const tablet = read("public/panels/tablet/app.js");
const outbox = read("lib/guestOutbox.ts");

console.log("\n1) The GUEST never receives a hidden dish (not 'receives it and hides it')");
check("the grid read drops hidden dishes server-side",
  /\.filter\(\(it\) => !it\.openPrice && !isHidden\(it\.tags\)\)/.test(menu));
check("the dish PAGE refuses one too (a kept link must not walk past the grid filter)",
  /if \(isHidden\(mapped\.tags\)\) return null;/.test(menu));
check("there is ONE name for the tag, not a string typed in four places",
  /export const HIDDEN_TAG = "hidden";/.test(menu) && /export const isHidden/.test(menu));

console.log("\n2) …and the server refuses it even if a basket somehow carries one");
check("the migration exists and names the reason",
  /hidden_item/.test(mig) && /'hidden' = ANY\(m\.tags\)/.test(mig));
check("BOTH guest ordering functions carry the guard (session AND QR)",
  (mig.match(/'hidden' = ANY\(m\.tags\)/g) || []).length >= 2);
check("the diner is given WORDS for it, never the code",
  /case "hidden_item":/.test(outbox) && /isn't on the menu/.test(outbox));
check("…and it does NOT reuse the sold-out sentence (that would promise it is coming back)",
  !/case "hidden_item": return[\s\S]{0,120}sold out/i.test(outbox));

console.log("\n3) THE RECREATE KEPT EVERY OLDER GUARD (the mig 264 trap)");
for (const [what, re] of [
  ["mig 253's open-price guest guard (staff_priced_item)", /staff_priced_item/],
  ["mig 206's per-table ordering limit (rate_limited)", /rate_limited/],
  ["mig 164's auto-accept for follow-up orders", /v_auto/],
  ["the OTP requirement", /otp_required/],
  ["the block-list check", /lfh_is_blocked/],
  ["the closed-session refusal", /session_closed/],
  ["server-side pricing (never the caller's price)", /lfh_price_order\(p_items/],
]) check(`still there: ${what}`, re.test(mig));

console.log("\n4) STAFF can still order it — that is the whole point");
check("the waiter's tile is labelled OFF MENU rather than silently normal",
  /const offMenu = \(d\.tags \|\| \[\]\)\.includes\("hidden"\)/.test(tablet) && /OFF MENU/.test(tablet));
check("…and it is NOT disabled (only sold-out disables a tile)",
  !/offMenu \? "disabled"/.test(tablet));
check("the live tile patcher keeps the mark in step with a mid-order menu change",
  /btn\.classList\.toggle\("offmenu"/.test(tablet));

console.log("\n5) The manager can set it, and can see it without opening every dish");
check("the editor has the toggle",
  /data-action="toggleHidden"/.test(editor) && /action === "toggleHidden"/.test(editor));
check("the dish list shows an off-menu badge",
  /badge-hidden">off menu/.test(editor));
check("the two states are explained in plain words, not left to guess",
  /avail-note/.test(editor) && /takes it off the menu completely/.test(editor));

console.log(fail ? `\n${fail} hidden-dish check(s) FAILED` : "\nAll hidden-dish checks passed — off the menu means off the menu, and staff can still serve it.");
process.exit(fail ? 1 : 0);
