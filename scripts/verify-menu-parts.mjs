// npm run verify:menu-parts — each of the nine "Edit the menu" sub-options must actually
// work on its own: OFF removes the control, ON lets it through, and the server enforces the
// same answer. Static, instant, no server and no database.
//
// Every check is a mistake that actually shipped, found on 2026-08-03 when the owner opened
// a manager panel whose "Attach a 3D model" was off and the 3D · 4D card was sitting there:
//
//  1. A row on the Access screen that no code reads is a DEAD SWITCH — the exact shape the
//     access rebuild exists to delete. So every id in EDIT_MENU_PARTS must be resolved by the
//     server and owned by something on screen.
//  2. The 3D card was gated on "is the viewer an admin", not on the permission. Granting
//     "Attach a 3D model" therefore changed nothing at all, and revoking it changed nothing
//     either — the card appeared for admins and for nobody else, whatever the switch said.
//  3. `is4d` — the toggle that actually puts the model in front of guests — was missing from
//     the server's strip list, so "off" didn't hold even though the three URL fields did.
//  4. No edit_options / edit_3d enforcement existed on the save path at all.
//  5. edit_dish was all-or-nothing: without it the WHOLE dish save was refused, which made
//     "Change a price" and "Mark as sold out" unusable on their own despite being their own
//     rows (and despite edit_dish being described as "name, description, photo, tags").
//  6. The admin is sent menuSub all-true (they may do everything), so without a separate
//     menuSubTint the admin view showed a complete dish form with NOTHING marked — reading
//     as "this manager has everything", the one question the screen exists to answer.
//  7. A .card / a plain <div> beats the browser's [hidden] default, so "hidden" has to be
//     forced or the control stays fully visible — the 2026-07-29 sidebar bug, again.
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => { try { return readFileSync(root + p, "utf8"); } catch { return ""; } };
const fails = [];
const check = (name, ok, hint) => { if (!ok) fails.push(`${name}\n     → ${hint}`); return ok; };

const tree = read("lib/accessTree.ts");
const api = read("app/api/editor/[...path]/route.ts");
const js = read("public/panels/editor/app.js");

// The nine rows, straight from the model — so adding a tenth makes this file demand its wiring.
const partsBlock = (tree.match(/const EDIT_MENU_PARTS[\s\S]*?\n\];/) || [""])[0];
const KEYS = [...partsBlock.matchAll(/\{\s*id:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);
check("EDIT_MENU_PARTS was found in lib/accessTree.ts", KEYS.length >= 9,
  `parsed ${KEYS.length} rows — the const was renamed or reshaped, so every check below is\n       reading nothing. Fix this script before trusting a green run.`);

// 1 · the server resolves every row
const serverKeys = (api.match(/MENU_PART_KEYS = \[[\s\S]*?\]/) || [""])[0];
for (const k of KEYS) {
  check(`server resolves "${k}"`, serverKeys.includes(`"${k}"`),
    `app/api/editor/[...path]/route.ts → MENU_PART_KEYS is missing "${k}". A row the server\n       never resolves is a switch that saves and is never read.`);
}

// 2 · something on screen owns every row
const clientParts = (js.match(/const MENU_PARTS = \[[\s\S]*?\n\];/) || [""])[0];
for (const k of KEYS) {
  check(`the panel owns "${k}"`, new RegExp(`key: "${k}"`).test(clientParts),
    `public/panels/editor/app.js → MENU_PARTS has no entry for "${k}", so nothing on screen\n       appears or disappears when it is switched. Add the control's selector there.`);
}

// 3 · the 3D card follows the PERMISSION, never the viewer's role
const cardLine = (js.match(/^.*data-menu-part="edit_3d".*$/m) || [""])[0];
check("the 3D card is gated by its permission, not by actor === admin",
  /menuPartVisible\("edit_3d"\)/.test(cardLine) && !/actor === "admin"/.test(cardLine),
  `public/panels/editor/app.js: the 3D · 4D card is back to \`XRAY_WHO.actor === "admin"\`.\n       That ignores "Attach a 3D model" entirely — granting it does nothing and revoking it\n       does nothing. Gate it with menuPartVisible("edit_3d").`);

// 4 · is4d is part of the 3D group, server-side
const d3 = (api.match(/D3_KEYS = \[[^\]]*\]/) || [""])[0];
for (const k of ["is4d", "model_folder", "model_small_url", "model_optimized_url"]) {
  check(`the server's 3D group covers ${k}`, d3.includes(`"${k}"`),
    `app/api/editor/[...path]/route.ts → D3_KEYS is missing "${k}". 4D mode is what puts the\n       model in front of guests, so leaving any of these writable means "off" doesn't hold.`);
}

// 5 · every part is enforced on the save path
for (const [k, pat] of [["edit_3d", /!parts!\.edit_3d\) drop/], ["edit_options", /!parts!\.edit_options\) drop/],
  ["edit_price", /!parts!\.edit_price\) drop/], ["add_dish", /!parts!\.add_dish/],
  ["manage_categories", /!parts!\.manage_categories/], ["manage_filters", /!parts!\.manage_filters/]]) {
  check(`the save path enforces "${k}"`, pat.test(api),
    `app/api/editor/[...path]/route.ts no longer enforces ${k} on POST /items. Hiding a control\n       is never the only guard — a stale panel or a typed request must be refused too.`);
}
check("the delete path enforces delete_dish", /menuSubAllowed\(g, rid, "delete_dish"\)/.test(api),
  "app/api/editor/[...path]/route.ts: the DELETE handler stopped checking delete_dish.");

// 6 · edit_dish is not all-or-nothing any more
check("a manager who holds only edit_price can still save",
  /!parts!\.edit_dish && !parts!\.edit_price && !parts!\.mark_86/.test(api),
  `app/api/editor/[...path]/route.ts refuses the whole dish save on edit_dish alone again.\n       "Change a price" and "Mark as sold out" are their own rows — refusing everything makes\n       them unusable, and the owner's rule is that every sub-option works individually.`);

// 7 · the admin view can MARK what a manager lacks
check("whoami sends menuSubTint", /menuSubTint:/.test(api),
  `app/api/editor/[...path]/route.ts stopped sending menuSubTint. The admin's own menuSub is\n       all-true by design, so without it the admin view marks nothing and reads as "this\n       manager has everything".`);
check("the panel draws menuSubTint in cyan", /menuSubTint/.test(js) && /xraySetTint\(box, true/.test(js),
  `public/panels/editor/app.js ignores menuSubTint, so it is sent and never drawn. The admin\n       must SEE the mark, not lose the control (admin view marks, it never strips).`);

// 8 · an unconfigured restaurant must not acquire 3D by accident
const resolver = (api.match(/function resolveMenuParts[\s\S]*?\n\}/) || [""])[0];
check("edit_3d defaults OFF where nothing is configured", /k !== "edit_3d"/.test(resolver),
  `app/api/editor/[...path]/route.ts → resolveMenuParts lets edit_3d fall into the\n       allow-everything default. It writes to storage every restaurant reads and its model\n       default is false — an un-migrated restaurant must not gain it silently.`);

// 9 · hidden really means gone
check("hidden menu-part controls are forced to display:none",
  /\[data-menu-part\]\[hidden\][^{]*\{[^}]*display: *none *!important/.test(js),
  `public/panels/editor/app.js: the [data-menu-part][hidden] rule is gone. A .card and a plain\n       <div> both beat the browser's [hidden] default, so the control stays fully on screen —\n       "off" would look like "there but broken", exactly the 2026-07-29 sidebar bug.`);

if (fails.length) {
  console.error(`\n✗ ${fails.length} check(s) failed — an Edit-the-menu sub-option doesn't work on its own:\n`);
  fails.forEach((f, i) => console.error(`  ${i + 1}. ${f}\n`));
  process.exit(1);
}
console.log(`✓ all checks passed — each of the ${KEYS.length} Edit-the-menu parts hides, enforces and marks on its own`);
