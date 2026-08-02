// npm run verify:xray — the admin view MARKS what someone lacks; it never hides it.
//
// Static, instant, no server and no database. Every check below is a mistake that actually
// shipped, so each one is a regression test rather than a style opinion:
//
//  1-2. A person pin used to imply ?view=real, so opening a manager's profile and pressing
//       "Visit their panel" jumped straight to their STRIPPED panel with nothing marked —
//       throwing away the comparison the admin opened it for (owner corrected this
//       2026-08-02, hours after it merged). Two places chained it: the console redirect and
//       the iframe src builder.
//  3.   whoami must not derive `simulate` from the person either, or the server strips the
//       panel again regardless of what the URL says.
//  4-5. The mark was grey + grayscale + .55 opacity, which read as "disabled/broken" and was
//       nearly invisible on the light skin. It is cyan now, from one variable per panel.
//  6.   Both skins need a value. The default in these panels is NOT dark — the panel sets
//       data-theme from the restaurant's own settings — so a single value silently leaves one
//       skin unreadable, the recurring fixed-colour bug in this codebase.
//  7.   tabsTint/settingsTint are what let a switched-off MENU be marked for the admin, who
//       is deliberately sent an EMPTY tabsOff. Without them the admin sees a restaurant's
//       missing menus rendering perfectly normally — the one thing the screen exists to answer.
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => { try { return readFileSync(root + p, "utf8"); } catch { return ""; } };
const fails = [];
const check = (name, ok, hint) => { if (!ok) fails.push(`${name}\n     → ${hint}`); return ok; };

const go = read("app/api/admin/act-as/go/route.ts");
check("act-as/go does not force ?view=real for a person",
  !/view=real/.test(go.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")),
  "app/api/admin/act-as/go/route.ts appends &view=real again. Naming a person says WHOSE\n       permissions the cyan marks describe — it must not strip the panel. Only the ribbon\n       toggle does that.");

const gate = read("lib/panelGate.ts");
check("panelIframeSrc keeps `as` and `view` independent",
  /pins\?\.view === "real"/.test(gate) && !/pins\?\.view === "real" \|\| as/.test(gate),
  "lib/panelGate.ts chains them again (`view === \"real\" || as`), so a person pin strips the\n       panel inside the iframe even when the outer URL is right.");

for (const [panel, file] of [["manager", "app/api/editor/[...path]/route.ts"], ["waiter", "app/api/tablet/[...path]/route.ts"], ["kitchen", "app/api/kitchen/[...path]/route.ts"]]) {
  const src = read(file);
  const line = (src.match(/const simulate = [^;]+;/) || [""])[0];
  check(`${panel} whoami: simulate comes only from ?view=real`,
    line.includes("view") && !/person|asPerson/.test(line),
    `${file} derives simulate from the pinned person again — the server then strips the panel\n       whatever the URL asks for. Expected: !g.user && …searchParams.get("view") === "real".`);
}

for (const [panel, file] of [["manager", "public/panels/editor/app.js"], ["waiter", "public/panels/tablet/app.js"]]) {
  const src = read(file);
  const block = (src.match(/\.xray-off \{[^}]*\}/) || [""])[0];
  check(`${panel} panel marks in cyan, not grey`,
    /var\(--xray-c\)/.test(block) && !/grayscale\(1\)/.test(block) && !/#8b919c/.test(block),
    `${file}: .xray-off is back to grey/grayscale. It must paint from var(--xray-c) — grey read\n       as "broken" and vanished on the light skin.`);
  check(`${panel} panel defines --xray-c for BOTH skins`,
    /:root\s*\{[^}]*--xray-c\b/.test(src) && /html\[data-theme="light"\]\s*\{[^}]*--xray-c\b/.test(src),
    `${file}: --xray-c is missing one skin. These panels take data-theme from the restaurant's\n       own settings, so one value leaves some restaurants with an unreadable mark.`);
}

const editorApi = read("app/api/editor/[...path]/route.ts");
check("whoami sends tabsTint + settingsTint",
  /tabsTint:/.test(editorApi) && /settingsTint:/.test(editorApi),
  "app/api/editor/[...path]/route.ts stopped sending them. The admin gets tabsOff:[] on\n       purpose, so without these a switched-off menu renders as if the restaurant had it.");

const editorJs = read("public/panels/editor/app.js");
check("the manager panel applies tabsTint (marks, keeps visible)",
  /XRAY_WHO\.tabsTint/.test(editorJs) && /xraySetHidden\(btn, false\)/.test(editorJs),
  "public/panels/editor/app.js ignores tabsTint, so the list is sent and never drawn.");

if (fails.length) {
  console.error(`\n✗ ${fails.length} check(s) failed — the admin view can hide what it should mark:\n`);
  fails.forEach((f, i) => console.error(`  ${i + 1}. ${f}\n`));
  process.exit(1);
}
console.log("✓ all 10 checks passed — a person pin marks in cyan and never strips the panel on its own");
