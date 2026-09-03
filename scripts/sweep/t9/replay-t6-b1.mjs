// ITEM 10 · batch 1 — P02836, P02864, P17601–P17660.
// The blocked-device wall, the ☰ drawer, the ⚙️ Settings sheet. One line per replayed check.
import { t6, t6skip } from "./replay-t6-harness.mjs";

// ── the two strays from block 3 that also named the dead harness ──
t6("P02836", "the theme toggle switches the skin and the choice survives a reload", "TH", /localStorage\.setItem\(KEY, theme\)/);
t6("P02864", "muting hides the nudge and is remembered", "A", /localStorage\.setItem\("kds_muted", state\.muted \? "1" : "0"\)/);

// ── the ticket a cook can act on, found by its own id ──
t6("P17601", "a ticket is found by ITS OWN order id, never 'the first tile'", "A", /\.ticket\[data-ticket="\$\{/);
t6("P17602", "a cooking dish gets a ✓ and the ticket gets one ALL READY", "A", (a) =>
  (/data-item-ready="\$\{esc\(r\.id\)\}"/.test(a) && /<button class="big ready" data-ready="\$\{esc\(o\.id\)\}">ALL READY<\/button>/.test(a)) || "one of the two controls is gone");
t6("P17603", "the take-back puts the ✓ back ON SCREEN on a multi-dish ticket", "A", /for \(const id of touched\) forgetCardHtml\(id\);/);
t6("P17604", "…and the ticket is back in Cooking with ALL READY offered again", "A", /const allCooked = rows\.length > 0 && rows\.every/);
t6("P17605", "nothing on the board is laid out wider than its container", "C", (c) =>
  !/width:\s*\d{4,}px/.test(c) || "a four-digit fixed width would force a sideways scroll");
t6skip("P17606", "LIGHT skin: the table mark badge is readable", "a contrast reading on a rendered pixel — driven by scripts/sweep/t9/round2-overlays.mjs and verify:look-ink, not settleable from source");
t6skip("P17607", "LIGHT skin: the small print under a dish is readable", "same — a pixel contrast reading, covered live by verify:look-ink");
t6("P17608", "the ☰ button is on the bar and finger-sized", "Craw", /\.hamburger \{[^}]*min-width: 44px; height: 44px/);
t6("P17609", "the drawer's search box is a real tap target too", "Craw", /\.dish-search \{[^}]*min-height: 44px/);
t6("P17610", "☰ opens a drawer with Settings, Printer and Report an issue", "A", (a) => {
  const rows = [...a.matchAll(/data-kdw="(\w+)"/g)].map((m) => m[1]);
  // EXPECTATION CHANGED 2026-08-31: the setup guide MOVED to the 🖨 sheet when it came back
  // (docs/REJECTED-IDEAS.md reversal). Three rows here, and the guide is asserted at P17643.
  return (rows.join(",") === "settings,printer,issue") || `the drawer offers: ${rows.join(", ")}`;
});
t6("P17611", "every ☰ row is finger-sized", "Craw", /\.dw-row \{[^}]*min-height: 4[4-9]px/);
t6("P17612", "the ☰ drawer names WHICH restaurant this screen belongs to", "A", '<div class="dw-sub">${esc(rest)}</div>');
t6("P17613", "the build tag is read from the running file, not typed in", "A", /document\.querySelectorAll\('script\[src\*="app\.js"\]'\)/);
t6("P17614", "the word Profile appears NOWHERE in the drawer (R7)", "A", (a) => {
  const i = a.indexOf("function openKitchenMenu()"), j = a.indexOf("let kdsSetOff");
  return !/Profile|profile/.test(a.slice(i, j)) || "the drawer mentions a profile";
});
t6("P17615", "the ☰ drawer is width-capped so it cannot hang off a 360px phone", "Craw", /\.kds-dw \{[^}]*width: min\(86vw, 320px\)/);
t6("P17616", "⚙️ Settings offers Sign out", "A", /Sign out<\/button>/);
t6("P17617", "…and it POSTs to _top, so it signs the PERSON out and not the panel frame", "A", /action="\/api\/panel-logout" target="_top"/);
t6("P17618", "the three device preferences are CLICKED THROUGH to the real bar buttons", "A", /const el = document\.getElementById\(b\.dataset\.ksetClick\);\s*\n?\s*if \(el\) el\.click\(\);/);
t6("P17619", "Settings shows no profile either (R7)", "A", (a) => {
  const i = a.indexOf("function renderKitchenSettings()"), j = a.indexOf("function waitingWords()");
  return !/Profile|profile|payroll|pay record/i.test(a.slice(i, j)) || "Settings mentions a profile";
});
t6("P17620", "Settings says where tickets print and who is printing now", "A", (a) =>
  (/<span>Tickets print on<\/span>/.test(a) && /<span>Printing right now<\/span>/.test(a)) || "one of the two lines is gone");

// ── the blocked-device wall ──
t6("P17621", "the panel branches on the server's CODE, never on its wording", "A", /j\.reason === "device_blocked"/);
t6("P17622", "the wall is painted once and never taken down", "A", (a) =>
  (/if \(blockedWallUp\) return;/.test(a) && (a.match(/blockedWallUp = false/g) || []).length === 1) || "the wall can be repainted or reset");
t6("P17623", "the wall's styles are INLINE, so it goes dark even if the stylesheet failed", "A", /w\.style\.cssText = "position:fixed;inset:0/);
t6("P17624", "the wall covers the whole viewport at the top of the stacking order", "A", /inset:0;z-index:2147483647/);
t6("P17625", "the wall carries a role and an accessible name", "A", (a) =>
  (/setAttribute\("role", "alertdialog"\)/.test(a) && /setAttribute\("aria-label", "This device has been blocked"\)/.test(a)) || "one of the two is missing");
t6("P17626", "the wall says WHO to ask and nothing about why", "A", (a) => {
  const i = a.indexOf("function showBlockedWall()"), j = a.indexOf("const blockedError");
  const w = a.slice(i, j);
  return (/Ask a manager to unblock it\./.test(w) && !/because|reason|why/i.test(w)) || "the wall explains itself";
});
t6("P17627", "a blocked device stops talking to the server entirely", "A", /if \(blockedWallUp\) throw blockedError\(\);/);
t6("P17628", "…and that refusal is the FIRST line of api(), before any network", "A", (a) => {
  const f = a.slice(a.indexOf("const api = async (method, path, body, opts) => {"));
  return f.indexOf("if (blockedWallUp)") < f.indexOf("fetch(") || "api() reaches the network first";
});
t6("P17629", "the wall re-asserts itself only when something genuinely lands on top", "A", /if \(document\.body\.lastElementChild !== w\)/);
t6("P17630", "…and that re-assert is a 3s tick, not a repaint every frame", "A", /\}, 3000\);/);
t6("P17631", "the blocked error carries a 403 and a flag a caller can branch on", "A", /e\.status = 403; e\.blocked = true;/);
t6("P17632", "the wall text is set with textContent, never innerHTML", "A", (a) => {
  const i = a.indexOf("function showBlockedWall()"), j = a.indexOf("const blockedError");
  const w = a.slice(i, j);
  return !/innerHTML/.test(w) || "the wall builds itself with innerHTML";
});
t6("P17633", "the wall cannot be selected or dragged off by a curious finger", "A", /user-select:none/);

// ── the ☰ drawer, in detail ──
t6("P17634", "☰ exists in the markup with an accessible name", "H", /id="hamburger"[^>]*aria-label="Menu &amp; settings"/);
t6("P17635", "☰ is wired to open the drawer", "A", /ham\.onclick = openKitchenMenu/);
t6("P17636", "the ☰ drawer refuses to open twice", "A", /if \(document\.querySelector\("\.kds-dw"\)\) return;/);
t6("P17637", "the ☰ drawer registers a back layer the moment it opens", "A", /LFH_BACK\.layer\("kitchen-menu", close\)/);
t6("P17638", "…and unregisters it exactly once on close", "A", /if \(kdsDrawerOff\) \{ const o = kdsDrawerOff; kdsDrawerOff = null; o\(\); \}/);
t6("P17639", "the ☰ drawer closes on the backdrop and on ✕", "A", (a) =>
  (/back\.onclick = close;/.test(a) && /dw\.querySelector\("\.dw-close"\)\.onclick = close;/.test(a)) || "one of the two exits is gone");
t6("P17640", "the ☰ drawer escapes the restaurant name it prints", "A", "${esc(rest)}");
t6("P17641", "the ☰ drawer names the restaurant, so a cook knows whose board this is", "A", /const rest = restDisplayName\(state\.restaurant\)/);
t6("P17642", "every ☰ row closes the drawer before it does its thing", "A", /const what = b\.dataset\.kdw; close\(\);/);
t6("P17643", "the setup guide is a LINK that opens in a new tab, not a button", "A", /<a class="btn prsheet-row prsheet-help" href="\/print-setup\.html#station" target="_blank"/);
t6("P17644", "…and it carries rel=noopener", "A", /href="\/print-setup\.html#station" target="_blank" rel="noopener"/);
t6("P17645", "the build tag READS the running file's own hash rather than a typed string", "A", /searchParams\.get\("v"\)/);
t6("P17646", "the build tag says so honestly when it cannot read one", "A", '"kitchen (unknown)"');
t6("P17647", "reading the build tag cannot break the drawer", "A", (a) => {
  const i = a.indexOf("#kdsBuild");
  return /catch \(e\) \{\}/.test(a.slice(i - 400, i + 400)) || "the build-tag read is unwrapped";
});
t6("P17648", "the ☰ drawer offers no profile of any kind (R7)", "A", (a) => {
  const i = a.indexOf('dw.innerHTML = `<button class="dw-close"'), j = a.indexOf("document.body.appendChild(back)");
  return !/profile/i.test(a.slice(i, j)) || "a profile row is in the drawer markup";
});
t6("P17649", "🚩 Report an issue goes through the shared widget, not a second copy", "A", /LFH_ISSUE\.open\(\{ api, rid: PANEL_RID, notify: \(m\) => toast\(m\) \}\)/);

// ── ⚙️ Settings, in detail ──
t6("P17650", "Settings refuses to open twice", "A", /if \(document\.querySelector\("\.kset-ov"\)\) return;/);
t6("P17651", "Settings registers its own back layer", "A", /LFH_BACK\.layer\("kitchen-settings", close\)/);
t6("P17652", "Settings closes on the backdrop only, never on a click inside it", "A", /ov\.onclick = \(e\) => \{ if \(e\.target === ov\) close\(\); \};/);
t6("P17653", "Settings marks itself open so a board read can keep it truthful", "A", "window.__kdsSettingsOpen = true");
t6("P17654", "…and a board read DOES re-render it while it is open", "A", /if \(window\.__kdsSettingsOpen\) renderKitchenSettings\(\);/);
t6("P17655", "Settings has a dialog role and an accessible name", "A", /class="kset" role="dialog" aria-label="Kitchen settings"/);
t6("P17656", "printing is ABSENT, not greyed, when it is off for this restaurant", "A", /const printSection = \(!auto && tgt !== "counter" && !hlp\) \? "" :/);
t6("P17657", "a counter-only restaurant gets one explanation, not controls it can never use", "A", /Kitchen tickets print on <b>the counter screen<\/b> for this restaurant/);
t6("P17658", "…and it still says the 🖨 button on a ticket works here", "A", /The 🖨 button on a ticket still prints here if this screen has a printer of its own\./);
t6("P17659", "Settings answers 'who is printing right now' in plain words", "A", /printingHere \? "THIS screen"/);
t6("P17660", "a station that has gone quiet is labelled as such rather than shown as live", "A", '" (gone quiet)"');
