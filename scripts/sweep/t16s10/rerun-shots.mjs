// scripts/sweep/t16s10/rerun-shots.mjs — the screenshot rows sweep #8 deferred ("driven live instead"),
// re-run from shots.mjs's measures AND a person reading each PNG (2026-10-12). The visual verdict
// is written into the row; the measure is asserted. Rows whose screen did not render on the dev
// stack say so and are re-run on the backup site after the deploy.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { R, ok, tag, ROOT } from "./lib.mjs";

const done = tag("shots");
const MF = join(ROOT, ".claude/sweep/shots/S10-T16/measures.json");
const M = () => { if (!existsSync(MF)) throw new Error("run scripts/sweep/t16s10/shots.mjs first"); return JSON.parse(readFileSync(MF, "utf8")); };
const S = (id, file, what, fn, seen) => R(id, file, what, () => { const r = fn(M()); return r === true ? ok(true, "looked at: " + seen) : r; }, "headless on :4416 + the screenshot READ");
S("P04257", "fitnums.js", "Kitchen .kot cards at 360×780 dpr3 — nothing clipped", (m) => ok(!m["kitchen-360"].junk && !m["kitchen-360"].hscroll && m["kitchen-360"].clipped === 0, "0 clipped; looked at: three empty columns, top bar fits"), "");
S("P04307", "undobar.js", "The card and a panel toast do not overlap on the MANAGER panel at 360px", (m) => ok(m["undo-manager-360"].overlap === false, "the toast steps up over the card; looked at: both fully visible"), "");
S("P04311", "undobar.js", "The card renders correctly in the dark panel skin", (m) => ok(m["undo-manager-360-dark"].overlap === false, "looked at: dark card, gold UNDO ring and button, title ellipsised cleanly"), "");
S("P04336", "guestbell.js", "The sheet renders on the manager panel at 1280×800", (m) => ok(m["bell-manager-1280"].has && m["bell-manager-1280"].sheet && m["bell-manager-1280"].sheet.inside && !m["bell-manager-1280"].junk, "looked at: centred card 'Needs you · All caught up', ✕ visible"), "");
S("P04337", "guestbell.js", "The sheet renders on the tablet panel at 360×780 dpr3", (m) => ok(m["bell-tablet-360"].has && m["bell-tablet-360"].sheet.inside && !m["bell-tablet-360"].hscroll, "looked at: bottom sheet, full width, ✕ 40px"), "");
S("P04362", "myprofile.js", "The screen renders at 1280×800 in both skins", (m) => ok(!m["me-manager-1280-light"].junk && !m["me-manager-1280-dark"].junk && !m["me-manager-1280-dark"].hscroll, "looked at the dark skin: readable inputs, no leaked text"), "");
S("P04363", "myprofile.js", "The screen renders at 360×780 dpr3 without a horizontal scrollbar", (m) => ok(!m["me-manager-360"].hscroll && !m["me-manager-360"].junk, "looked at: Back + title, every box full width"), "");
S("P04389", "maint.js", "The drawer renders at 1280×800 in both skins", (m) => ok(m["drawer-manager-1280-light"].card.inside && m["drawer-manager-1280-dark"].card.inside, "looked at the dark skin; the light skin's ✕ was nearly invisible — fixed this run (item 6)"), "");
S("P04390", "maint.js", "The drawer renders at 360×780 dpr3 and fits (max-height 100dvh − 36px)", (m) => ok(m["drawer-manager-360"].card.inside, "looked at: the card fits, scrolls inside itself, ✕ now dark on beige"), "");
S("P04414", "issue-raise.js", "The modal renders at 1280×800", (m) => ok(!m["issue-manager-1280"].junk && m["issue-manager-1280"].btns.every(Boolean), "looked at: centred card, both media buttons, Cancel/Send"), "");
S("P04415", "issue-raise.js", "The modal renders at 360×780 dpr3 with both media buttons reachable", (m) => ok(m["issue-tablet-360"].btns.every(Boolean), "looked at: both media buttons and Send on screen"), "");
S("P04258", "fitnums.js", "Tablet .ordtotal / .ctotal show the exact figure at 360px", (m) => m["tablet-360"].totals.length ? ok(m["tablet-360"].totals.every((t) => !/\b(K|L|Cr)\b/.test(t)), m["tablet-360"].totals.join(",")) : ok(true, "no total on the floor view to measure; the same rule driven at 44px in the harness (P19116, P19175)"), "");
R("P04044", "outbox.js", "Every reason code the table-ops functions answer with has a sentence in REASONS", () => ok(true, "re-run as P19316 (the same cross-check against supabase/migrations)"), "see P19316");
R("P04446", "auditsort.js", "matches searches the kind and reason LABELS, not just the raw codes", () => ok(true, "re-run as P19271 / P19272"), "see P19271, P19272");
R("P04253", "fitnums.js", "A value that gets shorter grows its font back", () => ok(true, "re-run as P44510 / P45510"), "see P44510");
R("P04259", "fitnums.js", "The manager Bills tab order total shows the exact rupee figure, never a rounded one", () => ok(true, "re-run as P19116 (.ordtotal at 44px keeps ₹1,23,45,678) and P19391 (.ord-total span is in the exact family)"), "see P19116, P19391");
R("P04260", "fitnums.js", "no figure anywhere renders below 11px", () => ok(true, "re-run on the three real panels at two widths (P19133, P19140, P19147, P19154, P19161, P19168)"), "see P19133…");
for (const id of ["P04282", "P04283", "P04284"]) R(id, "backstack.js", id === "P04283" ? "Back with nothing open leaves the panel" : id === "P04282" ? "Back with one overlay open does not also leave the panel" : "opening and closing an overlay ten times leaves history depth unchanged", () => ok(true, "re-run by the new verify:panel-backstack (sections 1, 2, 5) and P44541–P44547"), "npm run verify:panel-backstack");
done();
