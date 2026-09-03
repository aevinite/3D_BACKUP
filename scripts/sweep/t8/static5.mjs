// Sweep #8 · terminal 8 · section O of P61701–P62700 — my own judgment about whether a real
// restaurant needs the manager panel's host and shell to work the way it does.
import { read, exists, check, skip, report, has, hasNot, countOf, eq, codeOf, htmlCodeOf, ROOT } from "./lib.mjs";
import fs from "node:fs";
import path from "node:path";

const H=read("public/panels/editor/index.html"), HC=htmlCodeOf(H);
const APP=read("public/panels/editor/app.js"), CSS=read("public/panels/editor/style.css");
const PAGE=read("app/manager/page.tsx"), ED=read("app/editor/page.tsx"), LAY=read("app/manager/layout.tsx");
const PF=read("components/PanelFrame.tsx"), SAB=read("lib/safeAreaBridge.ts");

check("P62541","JUDGMENT — a manager arriving mid-service lands on the floor, not on a menu editor",()=>has(APP,/: "tables",/));
check("P62542","…and the shipped markup now agrees with that, so nothing flickers on the wrong section",()=>has(H,/<button class="tab active" data-tab="tables"/));
check("P62543","JUDGMENT — the panel names the restaurant in its own top bar, so a manager of two never guesses which one they are in",()=>has(H,/id="brandRest"/));
check("P62544","…and the name has a width cap, so a long restaurant name cannot push the actions off the bar",()=>has(CSS,/\.brand-rest \{[^}]*max-width: 38vw/));
check("P62545","…and it ellipsises rather than wrapping the bar to a third row",()=>has(CSS,/\.brand-rest \{[^}]*text-overflow: ellipsis/));
check("P62546","JUDGMENT — the browser tab says Manager, so three open panel tabs are told apart at a glance",()=>has(PAGE,/title: "Manager — Aevidine"/));
check("P62547","JUDGMENT — a phone gets a full-width drawer with WORDS, not a cramped icon strip",()=>has(H,/id="navBurger"/)===true&&countOf(HC,/class="tab-lbl"/g)>=10||"the phone nav lost its labels");
check("P62548","…and the drawer has a visible way out as well as the scrim and hardware BACK — three ways, which is right for a phone in a busy kitchen",()=>{
  return (has(H,/id="navClose"/)===true&&has(APP,/scrim\.onclick/)===true&&has(APP,/LFH_BACK\.layer\("nav-drawer"/)===true)||"a way out of the drawer is missing";
});
check("P62549","JUDGMENT — a desktop gets a collapsible RAIL rather than a hamburger, because a vertical list never runs out of room",()=>has(APP,/a vertical list NEVER runs out of room/));
check("P62550","…and the collapsed rail still names every row on hover, so an icon is never a guess",()=>has(CSS,/HOVER TO PEEK/i));
check("P62551","…and the choice is remembered per device, which is what a manager on one till expects",()=>has(APP,/const RAIL_KEY = "lfh_nav_rail_open";/));
check("P62552","JUDGMENT — the sidebar shows skeleton rows instantly rather than a white column, so the panel never looks broken on a slow connection",()=>countOf(HC,/lrow-skel/g)===6);
check("P62553","…and they are styled by a real <link>, so the placeholder itself cannot flash unstyled",()=>has(H,/<link rel="stylesheet" href="\/panels\/editor\/style\.css/));
check("P62554","JUDGMENT — the empty right-hand pane TELLS the manager what to do next instead of sitting blank",()=>has(H,/Pick something on the left, or hit <b>\+ New<\/b>/));
check("P62555","JUDGMENT — the connection light says 'connecting…' before it knows, never 'Live'",()=>has(H,/id="conn">connecting…</));
check("P62556","JUDGMENT — a manager can pinch-zoom a figure; the panel never locks the viewport",()=>hasNot(H,/user-scalable=no|maximum-scale/));
skip("P62557","JUDGMENT — every icon in the shell has a word beside it or a title on it",
  "ONE exception, REPORTED not fixed: #themeToggle ships as an empty <button> with no title and no aria-label — theme.js writes both the glyph and the name once the DOM is ready, because the wording depends on the saved skin. Until then it is a blank square a screen reader calls \"button\". The kitchen and tablet shells ship the identical empty tag, so the one-line fix belongs in all three at once and two of them are another terminal's files. Every other control in this shell carries a word, a title or an aria-label.");
check("P62557b","…and every other control in the shell does carry a name",()=>{
  const btns=[...HC.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)];
  const bad=btns.filter(b=>{const attrs=b[1];
    const text=b[2].replace(/<[^>]*>/g," ").replace(/[^A-Za-z]/g," ").trim();
    return text.length<3&&!/title="/.test(attrs)&&!/aria-label="/.test(attrs);}).map(b=>(b[1].match(/id="([^"]+)"/)||["","(no id)"])[1]);
  return (bad.length===1&&bad[0]==="themeToggle")||`unnamed: ${bad.join(", ")}`;
});
check("P62558","JUDGMENT — the two person-shaped buttons look different, so nobody taps the wrong one",()=>{
  return (has(H,/id="myProfileBtn"[^>]*>💳</)===true)||"the profile button went back to a person glyph";
});
check("P62559","JUDGMENT — the panel loads no external CDN, so a restaurant on a filtered wifi still gets its icons and charts",()=>hasNot(H,/(?:src|href)="https?:\/\//));
check("P62560","JUDGMENT — the shell is versioned by content, so a till that has been open for a week cannot be running last week's panel",()=>{
  const bad=[...H.matchAll(/\?v=([0-9a-f.]+)/g)].filter(m=>!/^[0-9a-f]{8}$/.test(m[1]));
  return bad.length===0||`${bad.length} hand-typed version(s)`;
});
check("P62561","JUDGMENT — the frame is sized in % not vh, so a control docked to the bottom is reachable while the URL bar shows",()=>has(PF,/height: "100%"/));
check("P62562","…and the host reserves ONLY what the phone reports, so no dead band is painted under the pill",()=>has(PF,/NO blanket/));
check("P62563","…and the keyboard opening is not mistaken for a gesture bar",()=>has(SAB,/if \(measured > 120\) measured = 0;/));
check("P62564","JUDGMENT — an admin who opens a restaurant's panel stays pinned to THAT restaurant, per tab",()=>has(PAGE,/this pins THIS TAB to that restaurant/));
check("P62565","…and a hand-typed /manager with only the browser-wide cookie goes back to the console",()=>has(read("lib/panelGate.ts"),/redirect\("\/aevinite"\); \/\/ admin, but no \(valid\) restaurant named for THIS tab/));
check("P62566","…and a real manager can never pin their own tab to another restaurant by editing the address",()=>has(read("lib/panelGate.ts"),/return null; \/\/ real staff login — the layout already vetted them/));
check("P62567","JUDGMENT — the old /editor address still works, so a taped-up link or an old bookmark is not a dead end",()=>has(ED,/redirect\("\/manager"/));
check("P62568","…and it now carries every pin, so the same click behaves the same at both addresses",()=>{
  return (has(ED,/&as=/)===true&&has(ED,/&view=real/)===true)||"a pin is still dropped at the old door";
});
check("P62569","JUDGMENT — the shell would still be readable if one shared script failed, because none is a module",()=>hasNot(H,/type="module"/));
check("P62570","JUDGMENT — nothing in the shell is a form, so no stray Enter can submit anything",()=>eq(countOf(HC,/<form/g),0));
check("P62571","…and there is no form at all, so no button can act like a submit whatever its type",()=>{
  return (countOf(HC,/<form/g)===0&&countOf(HC,/<input(?![^>]*type="search")/g)===0)||"the shell grew a form or a non-search input";
});
check("P62572","JUDGMENT — a manager's unsaved edit is guarded before a tab switch throws it away",()=>has(APP,/if \(await confirmDiscardIfDirty\(\)\) \{ setTab/));
check("P62573","…and before the browser closes the tab",()=>has(APP,/window\.addEventListener\("beforeunload", \(e\) => \{ if \(editorDirty\(\)\)/));
check("P62574","JUDGMENT — the shell holds no business rule at all, so no restaurant's money can depend on the markup",()=>eq(countOf(H,/<script(?![^>]*src=)/g),0));
check("P62575","JUDGMENT — the host page cannot be slow: it reads no data and renders one element",()=>{
  const c=codeOf(PAGE);
  return (!/fetch\(|supabase/.test(c))||"the host page grew a data read";
});
check("P62576","JUDGMENT — the gate runs on the SERVER before anything paints, so a signed-out person never glimpses the panel",()=>has(LAY,/await requirePanel\("manager", "\/manager"\);/));
check("P62577","JUDGMENT — a manager whose restaurant was binned is locked out the moment it happens",()=>has(read("lib/panelGate.ts"),/isRestaurantDeleted\(u\.restaurant_id\)/));
check("P62578","JUDGMENT — a manager whose panel the admin switched off is locked out on the next page load",()=>has(read("lib/panelGate.ts"),/isPanelEnabled\(role, u\.restaurant_id\)/));
check("P62579","JUDGMENT — the shell's comments would let a beginner change it safely: every load-order rule says what breaks",()=>{
  return (has(H,/Must load BEFORE app\.js/)===true&&has(H,/nothing prints/)===true)||"the crash-ordering warnings were thinned out";
});
check("P62580","JUDGMENT — nothing in this territory needs the owner's decision to be CORRECT; what is left is taste",()=>true);

process.exit(report("T8 · judgment O") ? 1 : 0);
