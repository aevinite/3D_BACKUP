// scripts/sweep/t1s10/rerun-s9.mjs — RE-RUN of T1.md "SWEEP #9 · T1 — the fifty new rows" (P101601–P101650), on my
// production build :4401.
//
// ONE WRITE: P101608/P101609 need a restaurant genuinely closed for the evening (service mode is decided on the
// SERVER, so it cannot be held in the browser). demo-bistro, which that run used, is in the recycle bin now; this
// uses saffron-street — a live demo tenant, not French House (busy with other sweeps) and never Aangan (the
// read-only control). Its service_mode is set true for the two reads and put back in a `finally` and on
// SIGINT/SIGTERM, then read back.
import { R, ok, sql, BASE } from "./lib.mjs";
import { newPage, done, open, withPage, cards, bodyText, LEAK, QR, IPAD, DESK } from "./browser.mjs";

const RP = "app/r/[restaurant]/menu/page.tsx", RNF = "app/r/[restaurant]/menu/not-found.tsx", QP = "app/q/[code]/page.tsx", MENU = "app/menu/page.tsx", MV = "components/MenuView.tsx";
const how = "fetched / driven on my production build :4401";
const D = (id, file, title, fn) => R(id, file, title, fn, how);
const head = async (path) => { const r = await fetch(BASE + path, { redirect: "manual" }); const t = await r.text(); const all = (re) => [...t.matchAll(re)].map((m) => m[1]); return { status: r.status, titles: all(/<title>([^<]*)<\/title>/g), descs: all(/<meta name="description" content="([^"]*)"/g), ogi: all(/<meta property="og:image" content="([^"]*)"/g) }; };
const hm = new Map(); const H = (p) => { if (!hm.has(p)) hm.set(p, head(p)); return hm.get(p); };
D("P101601", RNF, "the menu door's 404 names no platform brand in the tab or preview", async () => { const h = await H("/r/zz-no-such-place-t1/menu"); return ok(h.status === 404 && h.titles[0] === "Menu" && !/Aevidine|all-in-one/.test(h.descs.join()), `${h.status}, title "${h.titles[0]}"`); });
D("P101602", RNF, "…and for a switched-off restaurant", async () => { const h = await H("/r/empty-cafe-zz/menu"); return ok(h.status === 404 && h.titles[0] === "Menu", `${h.status}, "${h.titles[0]}"`); });
D("P101603", RNF, "that 404's description is the neutral sentence", async () => ok((await H("/r/zz-no-such-place-t1/menu")).descs[0] === "This page isn’t available. Scan the QR code on your table, or ask a member of staff."));
D("P101604", RNF, "exactly ONE title and ONE description", async () => { const h = await H("/r/zz-no-such-place-t1/menu"); return ok(h.titles.length === 1 && h.descs.length === 1, `${h.titles.length} and ${h.descs.length}`); });
D("P101605", RNF, "no preview picture on a dead link", async () => ok((await H("/r/zz-no-such-place-t1/menu")).ogi.length === 0));
D("P101606", RNF, "menu 404 and dish 404 use the SAME sentence", async () => { const a = await H("/r/zz-no-such-place-t1/menu"), b = await H("/r/french-house/item/zz-no-such-dish"); return ok(a.descs[0] === b.descs[0], "identical, curly apostrophe included"); });
D("P101607", QP, "dead-QR page and menu 404 agree on the title", async () => { const a = await H("/q/ZZZZZZ"), b = await H("/r/zz-no-such-place-t1/menu"); return ok(a.titles[0] === "Menu" && b.titles[0] === "Menu"); });
let closed = null;
const closedReads = async () => {
  if (closed) return closed;
  const rid = "00000000-0000-0000-0000-0000000000a2"; // saffron-street
  const was = (await sql(`select service_mode from settings where restaurant_id='${rid}'`))[0].service_mode;
  const put = () => sql(`update settings set service_mode=${was ? "true" : "false"} where restaurant_id='${rid}'`);
  const onSig = () => { put().finally(() => process.exit(130)); };
  process.once("SIGINT", onSig); process.once("SIGTERM", onSig);
  try {
    await sql(`update settings set service_mode=true where restaurant_id='${rid}'`);
    await new Promise((s) => setTimeout(s, 9500)); // getSettings caches for 8s per process
    closed = { r: await head("/r/saffron-street/menu"), q: await head(`/q/${QR["saffron-street"]}`) };
  } finally { await put(); process.removeListener("SIGINT", onSig); process.removeListener("SIGTERM", onSig); }
  closed.restored = (await sql(`select service_mode from settings where restaurant_id='${rid}'`))[0].service_mode === was;
  return closed;
};
D("P101608", RP, "a restaurant closed for the evening previews neutrally on the menu door (saffron-street for ~10s, put back)", async () => { const c = await closedReads(); return ok(c.r.titles[0] === "Menu" && /isn’t available right now/.test(c.r.descs[0] || "") && c.r.ogi.length === 0 && c.restored, `"${c.r.titles[0]}" / "${c.r.descs[0]}" · put back: ${c.restored}`); });
D("P101609", QP, "…and on the printed QR door", async () => { const c = await closedReads(); return ok(c.q.titles[0] === "Menu" && /isn’t available right now/.test(c.q.descs[0] || ""), `"${c.q.titles[0]}"`); });
D("P101610", RP, "an OPEN restaurant still previews with its own name (and picture when it has one)", async () => { const a = await H("/r/french-house/menu"), b = await H("/r/aangan-garden-restaurant/menu"); return ok(a.titles[0] === "My Little French House — Menu" && b.ogi.length === 1, `#1 "${a.titles[0]}" (its own wordmark as og:image since item 5), Aangan ${b.ogi.length} image`); });
const doors = new Map(); const DR = (p) => { if (!doors.has(p)) doors.set(p, withPage(p, async (pg) => ({ n: await cards(pg), title: await pg.title(), desc: await pg.getAttribute('meta[name="description"]', "content"), keys: await pg.evaluate(() => Object.keys(localStorage).filter((k) => /^lfh_table/.test(k))), table: await pg.evaluate(() => localStorage.getItem("lfh_table:french-house")), loc: await pg.evaluate(() => location.pathname + location.search) }))); return doors.get(p); };
const THREE = ["/menu?table=1", "/r/french-house/menu?table=1", `/q/${QR["french-house"]}`];
D("P101611", MV, "all three doors render the same number of dishes", async () => { const n = await Promise.all(THREE.map(async (p) => (await DR(p)).n)); return ok(new Set(n).size === 1 && n[0] >= 59, n.join(" · ")); });
D("P101612", RP, "…the same tab title", async () => { const t = await Promise.all(THREE.map(async (p) => (await DR(p)).title)); return ok(new Set(t).size === 1, t[0]); });
D("P101613", RP, "…the same share description", async () => { const t = await Promise.all(THREE.map(async (p) => (await DR(p)).desc)); return ok(new Set(t).size === 1, t[0]); });
D("P101614", MV, "…and the same saved-state key", async () => { const t = await Promise.all(THREE.map(async (p) => (await DR(p)).keys.join())); return ok(new Set(t).size === 1 && t[0] === "lfh_table:french-house", t[0]); });
D("P101615", QP, "the printed door pre-fills the table", async () => ok((await DR(THREE[2])).table === "1"));
D("P101616", QP, "…never in its address", async () => ok(!/table/.test((await DR(THREE[2])).loc), (await DR(THREE[2])).loc));
D("P101617", MENU, "legacy and printed doors store it the same way", async () => ok((await DR(THREE[0])).keys.join() === (await DR(THREE[2])).keys.join()));
const wipe = async () => { const p = await newPage(); try { await open(p, "/r/french-house/menu?table=4&utm=poster"); const a = { loc: await p.evaluate(() => location.pathname + location.search), t: await p.evaluate(() => localStorage.getItem("lfh_table:french-house")) }; await p.evaluate(() => history.back()); await p.waitForTimeout(800); a.back = await p.evaluate(() => location.pathname + location.search); return a; } finally { await done(p); } };
let wp = null; const WP = async () => (wp ??= await wipe());
D("P101618", MV, "the number leaves the address; other parameters survive", async () => { const w = await WP(); return ok(w.loc === "/r/french-house/menu?utm=poster" && w.t === "4", `${w.loc}, table ${w.t}`); });
D("P101619", MV, "…and Back does not put it back", async () => ok(!/table=/.test((await WP()).back), (await WP()).back));
D("P101620", RP, "one resolver answers every door", async () => { const j = await (await fetch(`${BASE}/api/r/french-house/menu-data`)).json(); return ok(j.items.length === (await DR(THREE[1])).n, `${j.items.length} dishes`); });
for (const [id, label, path, want] of [["P101621", "a 200-character slug", `/r/${"a".repeat(200)}/menu`, 404], ["P101622", "a slug with accents", "/r/caf%C3%A9-tr%C3%A8s-bon/menu", 404], ["P101623", "a slug that is only a hyphen", "/r/-/menu", 404]]) D(id, RP, `${label} answers the guest dead end, never a 500`, async () => { const h = await H(path); return ok(h.status === want && h.titles[0] === "Menu", `${h.status}, "${h.titles[0]}"`); });
for (const [id, label, code] of [["P101624", "a 5-character code", "ABCDE"], ["P101625", "a 17-character code", "ABCDEFGHJKLMNPQRS"], ["P101627", "a code with spaces", "AB%20CD%20EF"]]) D(id, QP, `${label} gets the friendly page`, () => withPage(`/q/${code}`, async (p, res) => ok(res.status() === 200 && /This QR code isn’t active/.test(await bodyText(p)), `${res.status()}`)));
D("P101626", QP, "a lower-case printed code resolves (case folded)", () => withPage(`/q/${QR["french-house"].toLowerCase()}`, async (p) => ok((await cards(p)) >= 59, `${await cards(p)} dishes`)));
D("P101628", MV, "a table with no digits stores nothing, breaks nothing", () => withPage("/r/french-house/menu?table=abc", async (p) => ok(!(await p.evaluate(() => localStorage.getItem("lfh_table:french-house"))) && (await cards(p)) >= 59 && p.t1.errors.length === 0)));
D("P101629", MV, "table 0 is NOT stored (re-aimed: the owner's item 6 refuses a table that cannot exist)", () => withPage("/r/french-house/menu?table=0", async (p) => ok((await p.evaluate(() => localStorage.getItem("lfh_table:french-house"))) === null)));
D("P101630", MV, "?table=-3 is table 3", () => withPage("/r/french-house/menu?table=-3", async (p) => ok((await p.evaluate(() => localStorage.getItem("lfh_table:french-house"))) === "3")));
const inj = async (mut, act) => { const p = await newPage(); let hits = 0; try { await p.route(/\/api\/r\/[^/]+\/menu-data/, async (r) => { try { hits++; const res = await r.fetch(); const j = await res.json(); mut(j); await r.fulfill({ response: res, json: j }); } catch { /* closed */ } }); await open(p, "/r/french-house/menu"); if (act) await act(p); await p.waitForTimeout(800); return { hits, n: await cards(p), text: await bodyText(p), sk: await p.$$eval(".cat-skeleton, .skeleton-card", (e) => e.length), secs: await p.$$eval(".cat-group", (e) => e.length) }; } finally { await done(p); } };
let ns = null; const NS = async () => (ns ??= await inj((j) => { j.categories = []; }));
D("P101631", MV, "dishes but no sections → the diner gets the dishes", async () => ok((await NS()).n >= 59 && (await NS()).secs === 0, `${(await NS()).n} dishes, ${(await NS()).secs} sections`));
D("P101632", MV, "…no filter is blamed", async () => ok(!/match these filters/.test((await NS()).text)));
D("P101633", MV, "…no placeholder chips for ever", async () => ok((await NS()).sk === 0));
D("P101634", MV, "no dishes at all → a friendly empty state", async () => { const e = await inj((j) => { j.items = []; }); return ok(/No dishes/.test(e.text) && e.sk === 0, e.text.match(/No dishes[^\n]*/)?.[0]); });
D("P101635", MV, "a chip ON and no sections → the dishes it matches (re-aimed: owner item 7 shows the dishes whatever the chips)", async () => { const v = await inj((j) => { j.categories = []; }, async (p) => { await p.click('.filter-chip:has-text("Veg"):not(:has-text("Non"))'); await p.waitForTimeout(500); }); return ok(v.n > 0 && !/Try turning a filter off/.test(v.text), `${v.n} veg dishes drawn, nothing blamed`); });
D("P101636", MV, "the fault injection really reached the page", async () => ok((await NS()).hits >= 1, `${(await NS()).hits} intercepted read(s)`));
const a11y = new Map(); const AY = () => { if (!a11y.has(1)) a11y.set(1, withPage("/r/french-house/menu", async (p) => { await p.waitForTimeout(700); const r = await p.evaluate(() => ({ tabs: document.querySelectorAll('[role="tab"], [role="tablist"], [role="tabpanel"]').length, row: [document.getElementById("cat-scroller").getAttribute("role"), document.getElementById("cat-scroller").getAttribute("aria-label")], cur: document.querySelectorAll('#cat-scroller [aria-current="true"]').length, pressed: [...document.querySelectorAll(".layout-switch button")].map((b) => b.getAttribute("aria-pressed")), sl: [document.getElementById("search-input").getAttribute("aria-label"), document.getElementById("search-input").getAttribute("placeholder")] })); await p.fill("#search-input", "co"); await p.waitForTimeout(800); r.panel = await p.$eval(".search-dropdown", (d) => ({ role: d.getAttribute("role"), label: d.getAttribute("aria-label"), rows: d.children.length, anchors: [...d.children].filter((c) => c.tagName === "A" && c.getAttribute("href")).length })); return r; })); return a11y.get(1); };
D("P101637", MV, "no tab roles anywhere", async () => ok((await AY()).tabs === 0));
D("P101638", MV, "the category row is a labelled group", async () => ok((await AY()).row.join() === "group,Jump to a menu category"));
D("P101639", MV, "exactly one chip says 'you are here'", async () => ok((await AY()).cur === 1));
D("P101640", MV, "the layout switch reports one pressed button", async () => ok((await AY()).pressed.join() === "false,true", (await AY()).pressed.join(" / ")));
D("P101641", MV, "the search box has a spoken name", async () => ok((await AY()).sl[0] && (await AY()).sl[0] === (await AY()).sl[1], (await AY()).sl[0]));
D("P101642", MV, "each suggestion is a LINK inside a labelled group", async () => { const x = (await AY()).panel; return ok(x.role === "group" && /matching/.test(x.label) && x.anchors === x.rows, `${x.role}, "${x.label}", ${x.anchors} of ${x.rows} anchors`); });
D("P101643", MV, "the 360px phone does not scroll sideways", () => withPage("/r/french-house/menu", async (p) => ok((await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0)));
D("P101644", MV, "no word in the pinned header cut at 360px", () => withPage("/r/french-house/menu", async (p) => { const n = await p.evaluate(() => { let c = 0; const w = document.createTreeWalker(document.getElementById("menu-sticky"), NodeFilter.SHOW_TEXT); for (let t = w.nextNode(); t; t = w.nextNode()) { const e = t.parentElement; if (t.textContent.trim() && e.offsetParent && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== "visible" && getComputedStyle(e).textOverflow === "ellipsis") c++; } return c; }); return ok(n === 0, `${n} clipped`); }));
D("P101645", MV, "on the tablet: chips, search box and dishes on screen", () => withPage("/r/french-house/menu", async (p) => { const r = await p.evaluate(() => ({ chips: document.querySelectorAll("#cat-scroller .cat-card").length, search: !!document.getElementById("search-input")?.offsetParent, hint: !!document.querySelector(".browse-hint") })); return ok(r.chips === 9 && r.search && (await cards(p)) >= 59, `${r.chips} chips, search ${r.search}, hint ${r.hint}`); }, { vp: IPAD }));
D("P101646", "components/GuestNotFound.tsx", "a closed restaurant's screen: nothing cut, nothing overflowing", () => withPage("/r/empty-cafe-zz/menu", async (p) => { await p.waitForTimeout(2200); const r = await p.evaluate(() => ({ wide: document.documentElement.scrollWidth - innerWidth, txt: document.body.innerText })); return ok(r.wide <= 0 && !/\$\{|undefined|NaN/.test(r.txt), `${r.wide}px`); }));
D("P101647", QP, "the dead-QR page fits a 360px phone, heading and sentence whole", () => withPage("/q/ZZZZZZ", async (p) => { await p.waitForTimeout(2200); const r = await p.evaluate(() => [...document.querySelectorAll(".gnf h1, .gnf .sub")].map((e) => { const b = e.getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth && e.scrollWidth <= e.clientWidth + 1; })); return ok(r.length === 2 && r.every(Boolean)); }));
const reads = async () => { const p = await newPage(); try { await open(p, "/r/french-house/menu"); await p.waitForTimeout(2500); const one = p.t1.requests.filter((r) => /\/menu-data/.test(r.url)).length; await p.evaluate(() => document.querySelector(".item-card-link").click()); await p.waitForURL(/\/item\//, { timeout: 20000 }); await p.waitForTimeout(1500); await p.goBack(); await p.waitForSelector(".item-card"); await p.waitForTimeout(2500); const glb = p.t1.requests.filter((r) => /\.glb/i.test(r.url)).map((r) => r.url.split("/").pop().split("?")[0]); return { one, both: p.t1.requests.filter((r) => /\/menu-data/.test(r.url)).length, glb }; } finally { await done(p); } };
let rd = null; const RD = async () => (rd ??= await reads());
D("P101648", MV, "one menu open reads the menu ONCE", async () => ok((await RD()).one === 1, `${(await RD()).one}`));
D("P101649", MV, "dish and Back does not re-read it twice", async () => ok((await RD()).both <= 2, `${(await RD()).both} across the journey`));
D("P101650", MV, "only the SMALL 3D files its own dishes have", async () => { const g = [...new Set((await RD()).glb)]; return ok(g.length >= 1 && g.every((x) => /small/i.test(x)), g.join(", ")); });
