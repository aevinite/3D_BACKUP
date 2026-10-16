// scripts/sweep/t1s10/rerun-n3.mjs — RE-RUN of T1.md N3 (P15161–P15259): every guest door on every restaurant the
// old run found, and odd input, driven headless on :4401. Where the DATA moved since (demo-bistro was binned; the
// printed code W5QRFWZU was regenerated), the row is re-asked of today's equivalent and says so.
import { R, ok } from "./lib.mjs";
import { newPage, done, open, withPage, cards, bodyText, LEAK, QR } from "./browser.mjs";

const RP = "app/r/[restaurant]/menu/page.tsx", QP = "app/q/[code]/page.tsx", MENU = "app/menu/page.tsx", MV = "components/MenuView.tsx", GNF = "components/GuestNotFound.tsx";
const how = "headless Chromium on my production build :4401, a first-time diner at 360×780";
const D = (id, file, title, fn) => R(id, file, title, fn, how);
const memo = new Map();
const visit = (path) => { if (!memo.has(path)) memo.set(path, (async () => { const p = await newPage(); try { const res = await open(p, path); await p.waitForTimeout(800); return { status: res.status(), url: p.url(), n: await cards(p), title: await p.title(), desc: await p.getAttribute('meta[name="description"]', "content").catch(() => null), text: await bodyText(p), errors: [...p.t1.errors], bad: p.t1.bad.filter((x) => !/favicon/.test(x)), store: await p.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })), state: await p.evaluate(() => JSON.stringify(history.state || {})) }; } finally { await done(p); } })()); return memo.get(path); };
const FAMILY = [
  ["P15161", "french-house", /French House/], ["P15167", "aangan-garden-restaurant", /AANGAN GARDEN/], ["P15173", "burger-barn", /Burger Barn/],
  ["P15179", "demo-bistro", null], ["P15185", "green-bowl", /Green Bowl/], ["P15191", "pizza-palace", /Pizza Palace/],
  ["P15197", "sakura-sushi", /Sakura Sushi/], ["P15203", "spice-route", /Spice Route/], ["P15209", "taco-fiesta", /Taco Fiesta/],
];
const nextId = (id, k) => "P" + (Number(id.slice(1)) + k);
for (const [id, slug, name] of FAMILY) {
  const path = `/r/${slug}/menu`;
  if (!name) {
    // demo-bistro was a live menu in sweep #7 and is in the recycle bin today: every one of its six rows is
    // re-asked as "a binned restaurant is refused with the guest page".
    D(id, RP, `${slug} (binned since — re-aimed: refused)`, async () => { const v = await visit(path); return ok(v.status === 404, `${v.status} — in the recycle bin today`); });
    D(nextId(id, 1), RP, `${slug}: tab title is the neutral one`, async () => { const v = await visit(path); return ok(v.title === "Menu", JSON.stringify(v.title)); });
    D(nextId(id, 2), GNF, `${slug}: no flagship wordmark`, async () => { const v = await visit(path); return ok(!/little french house/i.test(v.text)); });
    D(nextId(id, 3), GNF, `${slug}: no page errors or failed requests beyond the 404 itself`, async () => { const v = await visit(path); const bad = v.bad.filter((x) => !/^404 .*\/r\/demo-bistro\/menu/.test(x) && !/menu-data/.test(x)); return ok(v.errors.length === 0 && bad.length === 0, `${v.errors.length} errors, ${bad.join(" | ") || "0 other failures"}`); });
    D(nextId(id, 4), GNF, `${slug}: no leaked code markers`, async () => { const v = await visit(path); return ok(!LEAK.test(v.text)); });
    D(nextId(id, 5), GNF, `${slug}: "undefined" never on screen`, async () => { const v = await visit(path); return ok(!/undefined/.test(v.text)); });
    continue;
  }
  D(id, RP, `${slug}: 200 with dishes`, async () => { const v = await visit(path); return ok(v.status === 200 && v.n > 0, `${v.status}, ${v.n} cards`); });
  D(nextId(id, 1), RP, `${slug}: tab title names it`, async () => { const v = await visit(path); return ok(name.test(v.title) && !/Aevidine/.test(v.title), v.title); });
  D(nextId(id, 2), MV, `${slug}: no flagship wordmark leaked`, async () => { const v = await visit(path); return ok(slug === "french-house" || !/little french house/i.test(v.text)); });
  D(nextId(id, 3), MV, `${slug}: 0 page errors, 0 failed requests`, async () => { const v = await visit(path); return ok(v.errors.length === 0 && v.bad.length === 0, `${v.errors.length} errors, ${v.bad.length} failures ${v.bad.join(" | ")}`); });
  D(nextId(id, 4), MV, `${slug}: no leaked code markers`, async () => { const v = await visit(path); const m = v.text.match(/\$\{|\[object Object\]|-->|(^|\s)NaN(\s|$)/); return ok(!m, m ? m[0] : "none"); });
  D(nextId(id, 5), MV, `${slug}: "undefined" never on screen`, async () => { const v = await visit(path); return ok(!/\bundefined\b/.test(v.text)); });
}
for (const [id, slug] of [["P15215", "empty-cafe-zz"], ["P15218", "og-s-cafe"], ["P15221", "zz-recycle-test"]]) {
  const path = `/r/${slug}/menu`;
  D(id, RP, `${slug} (switched off / binned): 404`, async () => { const v = await visit(path); return ok(v.status === 404, String(v.status)); });
  D(nextId(id, 1), GNF, `${slug}: the refusal carries no platform brand`, async () => { const v = await visit(path); return ok(!/aevidine/i.test(v.text + v.title)); });
  D(nextId(id, 2), GNF, `${slug}: refusal text is clean`, async () => { const v = await visit(path); return ok(!LEAK.test(v.text) && /available|exist/.test(v.text), v.text.replace(/\s+/g, " ").slice(0, 70)); });
}
const CODE = QR["french-house"];
const qv = () => visit(`/q/${CODE}`);
D("P15224", QP, `/q/<French House table 1 code>: 200 (W5QRFWZU was regenerated; today's code)`, async () => { const v = await qv(); return ok(v.status === 200, `${CODE}: ${v.status}`); });
D("P15225", QP, "the address stays /q/<code>", async () => { const v = await qv(); return ok(new URL(v.url).pathname === `/q/${CODE}`, v.url); });
D("P15226", QP, "the table number never appears in the address bar", async () => { const v = await qv(); return ok(!/table=|[?&]t=/.test(v.url), v.url); });
D("P15227", QP, "the server-resolved table reached storage", async () => { const v = await qv(); return ok(v.store.local["lfh_table:french-house"] === "1", JSON.stringify(Object.fromEntries(Object.entries(v.store.local).filter(([k]) => /table/.test(k))))); });
D("P15228", QP, "and under THIS restaurant's scope", async () => { const v = await qv(); return ok(Object.keys(v.store.local).filter((k) => /^lfh_table/.test(k)).every((k) => k.endsWith(":french-house"))); });
D("P15229", QP, "the tab's tenant is pinned", async () => { const v = await qv(); return ok(v.store.session.lfh_tab_tenant === "french-house", v.store.session.lfh_tab_tenant); });
D("P15230", QP, "the exit guard is armed on /q", async () => { const v = await qv(); return ok(/__lfhExitGuard":true/.test(v.state), v.state.slice(0, 80)); });
D("P15231", QP, "dish cards drawn", async () => { const v = await qv(); return ok(v.n >= 50, `${v.n} cards`); });
D("P15232", QP, "white-labelled tab title", async () => { const v = await qv(); return ok(/French House — Menu/.test(v.title), v.title); });
D("P15233", QP, "description is the restaurant's own", async () => { const v = await qv(); return ok(/view the menu and order at My Little French House/.test(v.desc || ""), v.desc); });
D("P15234", QP, "a lower-case code resolves identically", async () => { const v = await visit(`/q/${CODE.toLowerCase()}`); return ok(v.status === 200 && v.n >= 50 && v.store.local["lfh_table:french-house"] === "1", `${v.status}, ${v.n} cards`); });
D("P15235", MENU, "repeated ?table= survives the legacy redirect", async () => { const p = await newPage(); const nav = []; p.on("request", (r) => { if (r.isNavigationRequest()) nav.push(r.url()); }); try { await open(p, "/menu?table=1&table=2"); const hop = nav.find((u) => /\/r\/french-house\/menu/.test(u)) || ""; return ok(/table=1&table=2/.test(hop), hop); } finally { await done(p); } });
D("P15236", MV, "…and the FIRST value is the one stored", async () => { const v = await visit("/menu?table=1&table=2"); return ok(v.store.local["lfh_table:french-house"] === "1", v.store.local["lfh_table:french-house"]); });
D("P15237", MENU, "every unrelated parameter survives too", async () => { const p = await newPage(); const nav = []; p.on("request", (r) => { if (r.isNavigationRequest()) nav.push(r.url()); }); try { await open(p, "/menu?utm_source=qr&table=3"); const hop = nav.find((u) => /\/r\/french-house\/menu/.test(u)) || ""; return ok(/utm_source=qr/.test(hop) && /table=3/.test(hop), hop); } finally { await done(p); } });
D("P15238", MV, "a non-numeric table is not saved", async () => { const v = await visit("/r/french-house/menu?table=abc"); return ok(!Object.keys(v.store.local).some((k) => /^lfh_table/.test(k)), JSON.stringify(Object.keys(v.store.local).filter((k) => /table/.test(k)))); });
D("P15239", MV, "digits kept verbatim, not parsed to a number", async () => { const v = await visit("/r/french-house/menu?table=007"); return ok(v.store.local["lfh_table:french-house"] === "007", v.store.local["lfh_table:french-house"]); });
D("P15240", MV, "a 400-digit table cannot blank the menu", async () => { const v = await visit(`/r/french-house/menu?table=${"9".repeat(400)}`); return ok(v.status === 200 && v.n >= 50, `${v.status}, ${v.n} cards`); });
D("P15241", MV, "…and it is NOT stored (re-aimed: the 1…500 rule, 2026-09-14)", async () => { const v = await visit(`/r/french-house/menu?table=${"9".repeat(400)}`); return ok(!v.store.local["lfh_table:french-house"], `stored: ${v.store.local["lfh_table:french-house"] ?? "nothing"}`); });
for (const [id, label, path, want] of [
  ["P15242", "all capitals", "/r/FRENCH-HOUSE/menu", 200], ["P15244", "a trailing encoded space", "/r/french-house%20/menu", 200],
  ["P15246", "an emoji slug", "/r/%F0%9F%8D%95/menu", 404], ["P15248", "a 300-character slug", `/r/${"a".repeat(300)}/menu`, 404],
]) {
  // A trailing %20 is TRIMMED by getRestaurantBySlug since sweep #8 and then canonicalised, so today it lands on the
  // real menu (200) where sweep #7 recorded a 404 — the same "one restaurant, one address" rule, applied to a space.
  D(id, RP, `${label}: answered ${want}${id === "P15244" ? " (re-aimed: trimmed + canonicalised since sweep #8)" : ""}`, async () => { const v = await visit(path); return ok(v.status === want, `${v.status} → ${new URL(v.url).pathname.slice(0, 40)}`); });
  D(nextId(id, 1), GNF, `${label}: no platform brand shown to a diner`, async () => { const v = await visit(path); return ok(!/aevidine/i.test(v.text + v.title)); });
}
D("P15250", RP, "a path-traversal-shaped slug: 404", async () => { const v = await visit("/r/..%2F..%2Fetc/menu"); return ok(v.status === 404, String(v.status)); });
D("P15251", GNF, "…and no platform brand to a diner", async () => { const v = await visit("/r/..%2F..%2Fetc/menu"); return ok(!/aevidine/i.test(v.text), v.text.replace(/\s+/g, " ").slice(0, 60)); });
for (const [id, label, code] of [["P15252", "too short", "AB1"], ["P15254", "too long", "A".repeat(40)], ["P15256", "a hyphen", "ABC-DEF"], ["P15258", "angle brackets", "%3Cb%3Ehi%3C%2Fb%3E"]]) {
  D(id, QP, `/q code ${label}: friendly page, status 200`, async () => { const v = await visit(`/q/${code}`); return ok(v.status === 200 && /This QR code isn’t active/.test(v.text), String(v.status)); });
  D(nextId(id, 1), QP, `/q code ${label}: nothing typed is echoed`, async () => { const v = await visit(`/q/${code}`); const typed = decodeURIComponent(code); return ok(!v.text.includes(typed) && !/<b>/.test(v.text), "not echoed"); });
}
