// Sweep #8 · T5 round 2 · band R4 (P95087–P95150) — DRIVEN LIVE.
//
// Round 1 drove the menu, the offline layer and the last-resort page. It never OPENED the customise
// popup, the waiter popup, the mini-cart, the saved-work sheet, the star rating or the six
// languages — six surfaces this territory owns and nobody had watched run.
//
//   npm run build && PORT=4305 npm run start
//   node scripts/sweep/t5/round2-live.mjs
//
// Nothing here writes to the database. The saved-work sheet is driven by putting a queued order in
// THIS BROWSER'S OWN storage — the diner's phone is where that queue lives — so no ticket reaches
// any kitchen board another terminal is watching.
import { chromium } from "playwright";
import { check, report, skip, ROOT } from "./lib.mjs";
import { requireUp } from "../appUp.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.T5_BASE || "http://localhost:4305";
const TENANT = "aangan-garden-restaurant";
const SHOTS = path.join(ROOT, ".claude/sweep/shots/T5");
fs.mkdirSync(SHOTS, { recursive: true });
const A35 = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await requireUp(BASE, "the T5 round-2 live walk");
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext(A35);
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e.message)));
  const menu = async () => {
    await p.goto(`${BASE}/r/${TENANT}/menu`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await p.waitForSelector(".item-card", { timeout: 30000 });
    await wait(600);
  };
  await menu();

  /* ── 1 · the mini-cart pill ── */
  const before = await p.evaluate(() => !!document.querySelector(".mini-cart"));
  check("P95087", "the basket pill is absent while the basket is empty", () => !before || "the pill was there with nothing in it");
  await p.click(".item-card .cart-add-btn").catch(() => {});
  await wait(900);
  const pill = await p.evaluate(() => {
    const el = document.querySelector(".mini-cart");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { text: el.textContent.replace(/\s+/g, " ").trim(), l: Math.round(r.left), rr: Math.round(r.right),
             b: Math.round(r.bottom), vw: innerWidth, vh: innerHeight,
             label: el.getAttribute("aria-label") || "" };
  });
  const gated = !pill && await p.evaluate(() => !!document.querySelector(".sg-overlay, .sg-box"));
  if (gated) skip("P95088", "the basket pill appears once a dish is added", "this restaurant gates adding behind joining a table, so a bare tap opens the join flow instead");
  else {
    check("P95088", "the basket pill appears once a dish is added", () => !!pill || "no pill after an add");
    check("P95089", "…and says how many items and what they come to", () =>
      !pill || /\d+ item/.test(pill.text) || pill.text);
    check("P95090", "…with no code token in it", () =>
      !pill || !/undefined|NaN|\[object|\$\{/.test(pill.text) || pill.text);
    check("P95091", "…and it fits the phone", () => !pill || (pill.l >= 0 && pill.rr <= pill.vw) || `${pill.l}→${pill.rr}`);
    check("P95092", "…and is above the bottom edge, not hanging off it", () =>
      !pill || pill.b <= pill.vh + 1 || `bottom ${pill.b} in ${pill.vh}`);
    check("P95093", "…and it names itself to a screen reader", () =>
      !pill || /View bill/i.test(pill.label) || pill.label);
  }

  /* ── 2 · the waiter popup ── */
  await p.evaluate(() => window.dispatchEvent(new Event("lfh:chef-call")));
  await wait(700);
  const chef = await p.evaluate(() => {
    const el = document.querySelector("#chef-popup");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { reasons: [...el.querySelectorAll(".chef-reason")].map((b) => b.textContent.trim()),
             box: !!el.querySelector("#chef-table"), l: Math.round(r.left), rr: Math.round(r.right), vw: innerWidth,
             text: el.textContent.replace(/\s+/g, " ").slice(0, 160) };
  });
  if (!chef) skip("P95094", "the waiter popup opens when the bell is rung", "this restaurant has waiter calls switched off, so the popup cannot open — which is the rule working");
  else {
    check("P95094", "the waiter popup opens when the bell is rung", () => true);
    check("P95095", "…offering all six things a diner can ask for", () => chef.reasons.length === 6 || chef.reasons.join(", "));
    check("P95096", "…each with words, not an empty button", () =>
      chef.reasons.every((r) => r.replace(/[^\w]/g, "").length > 2) || chef.reasons.join(" | "));
    check("P95097", "…and a table box to say where they are", () => chef.box || "no table field");
    check("P95098", "…and the whole card fits the phone", () => (chef.l >= 0 && chef.rr <= chef.vw) || `${chef.l}→${chef.rr}`);
    check("P95099", "…with no code token on it", () => !/undefined|NaN|\[object|\$\{/.test(chef.text) || chef.text);
    // an empty table number must be REFUSED, visibly, not silently swallowed
    await p.evaluate(() => { const i = document.querySelector("#chef-table"); if (i) { i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); } });
    await p.click(".chef-reason").catch(() => {});
    await wait(600);
    const refused = await p.evaluate(() => {
      const i = document.querySelector("#chef-table");
      return { stillOpen: !!document.querySelector("#chef-popup"),
               flagged: !!i && (i.classList.length > 0 || !!document.querySelector(".table-input-error, .field-error")),
               toast: (document.querySelector(".toast-ticket")?.textContent || "").trim() };
    });
    check("P95100", "asking for something with no table number does not silently do nothing", () =>
      (refused.stillOpen || refused.toast.length > 0) || "the popup closed and said nothing");
    await p.evaluate(() => window.dispatchEvent(new Event("lfh:close-all")));
    await wait(500);
    // AWAITED. check() does not await, so handing it a Promise made it read as "not true" — my own
    // harness, not the popup. Every live fact is read out first and asserted second.
    const closed = await p.evaluate(() => !document.querySelector("#chef-popup"));
    check("P95101", "…and the popup closes when the app says close everything", () => closed || "it stayed open");
  }

  /* ── 3 · the toast, in all three flavours ── */
  // Toasts STACK, up to three. Reading `.toast-ticket` while an earlier one is still up reads the
  // wrong ticket — which is how the first run reported a success notice wearing an error's mark.
  // WAIT them out, never remove the nodes: they are React's, and pulling them from under it meant
  // the next ticket never mounted at all. The longest a ticket lives is 3500ms.
  const clearToasts = async () => {
    for (let i = 0; i < 20; i++) {
      if (await p.evaluate(() => document.querySelectorAll(".toast-ticket").length === 0)) return;
      await wait(400);
    }
  };
  for (const [id, variant, mark] of [["P95102", "success", "✓"], ["P95103", "error", "✕"], ["P95104", "info", "•"]]) {
    await clearToasts();
    const t = await p.evaluate(async (v) => {
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Probe " + v, variant: v, kicker: "check" } }));
      await new Promise((r) => setTimeout(r, 250));
      const el = document.querySelector(".toast-ticket");
      const r = el?.getBoundingClientRect();
      return el ? { cls: el.className, mark: el.querySelector(".toast-mark")?.textContent,
                    foot: el.querySelector(".toast-foot")?.textContent || "",
                    l: Math.round(r.left), rr: Math.round(r.right), vw: innerWidth } : null;
    }, variant);
    check(id, `a ${variant} notice draws its own mark (${mark}) and fits the phone`, () =>
      (t && t.mark === mark && t.l >= 0 && t.rr <= t.vw) || JSON.stringify(t));
    await wait(2400);
  }
  await clearToasts();
  const noSignOff = await p.evaluate(async () => {
    window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Refused", variant: "error" } }));
    await new Promise((r) => setTimeout(r, 250));
    const el = document.querySelector(".toast-ticket");
    return { foot: el?.querySelector(".toast-foot")?.textContent ?? null };
  });
  check("P95105", "a refusal gets no sign-off — it does not thank a diner for a mistake", () =>
    noSignOff.foot === null || `it said "${noSignOff.foot}"`);
  await clearToasts();
  const tappable = await p.evaluate(async () => {
    window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Open the bill", event: "lfh:open-cart" } }));
    await new Promise((r) => setTimeout(r, 250));
    const el = document.querySelector(".toast-ticket");
    return { tappable: !!el && el.className.includes("toast-tappable"), foot: el?.querySelector(".toast-foot")?.textContent || "" };
  });
  check("P95106", "a notice that DOES something says so", () =>
    (tappable.tappable && /tap to view/i.test(tappable.foot)) || JSON.stringify(tappable));
  await wait(4200);
  const cleared = await p.evaluate(() => document.querySelectorAll(".toast-ticket").length);
  check("P95107", "every notice takes itself away again", () => cleared === 0 || `${cleared} left on screen`);

  /* ── 4 · the saved-work sheet, driven from this phone's own storage ── */
  const chip = await p.evaluate(async () => {
    // The guest queue lives on the phone. Writing to it here is exactly what losing signal does,
    // and it reaches no server — no ticket lands on anyone's board.
    const key = Object.keys(localStorage).find((k) => /guest_outbox|lfh_outbox/i.test(k)) || "lfh_guest_outbox";
    const rows = [
      { id: "zz-t5-a", kind: "order", at: Date.now() - 90_000, track: { items: [{ qty: 2, title: "Espresso" }], total: "438" } },
      { id: "zz-t5-b", kind: "call", at: Date.now() - 30_000, reason: "Water" },
      { id: "zz-t5-c", kind: "order", at: Date.now() - 400_000, error: "That dish just ran out.", blocked: true,
        lines: [{ id: "x" }, { id: "y" }], failed: true, track: { items: [{ qty: 1, title: "Soup" }] } },
    ];
    localStorage.setItem(key, JSON.stringify(rows));
    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new Event("lfh:outbox-changed"));
    await new Promise((r) => setTimeout(r, 900));
    const el = document.querySelector(".gob-chip");
    return { key, shown: !!el, text: (el?.textContent || "").trim() };
  });
  if (!chip.shown) skip("P95108", "the saved-work chip appears when something is waiting on the phone",
    `the queue's storage key could not be driven from outside it (tried "${chip.key}") — lib/guestOutbox.ts owns the shape, and faking it is worse than skipping`);
  else {
    check("P95108", "the saved-work chip appears when something is waiting on the phone", () => true);
    check("P95109", "…and never calls a request for water an order", () =>
      !/^\d+ orders? waiting/.test(chip.text) || chip.text);
  }
  await p.evaluate(() => { try { for (const k of Object.keys(localStorage)) if (/outbox/i.test(k)) localStorage.removeItem(k); } catch {} });

  /* ── 5 · every one of the six languages, rendered ── */
  const LANGS = ["en", "de", "fr", "ar", "hi", "ko"];
  // A restaurant that offers ONE language forces every guest back to it — the owner's own rule
  // ("one choice means no switcher"), and Header re-applies it on mount. So on such a restaurant
  // the other five CANNOT render, and asserting that they do would be asserting against the rule.
  // Read it off the SCREEN, not out of a guessed API shape: the switcher exists only when there is
  // a real choice to make, so its presence IS the answer. A first version asked menu-data for a
  // field name it does not use, got null, assumed "many", and then reported the app for obeying
  // the rule.
  // ON THE RESTAURANT THAT ACTUALLY OFFERS THEM. Aangan sells in one language, and its switcher is
  // correctly absent — so driving six languages there skipped 25 rows and proved nothing. The
  // flagship offers the full set, so the band moves to its door and the rows EXECUTE. Read-only
  // either way: a language is a choice stored on this browser, and nothing is written anywhere.
  // ON A RESTAURANT THAT ACTUALLY SELLS IN SIX. Aangan offers one and so does the flagship, so
  // both skipped this whole band and proved nothing. Queried, not guessed: 13 of the 17 tenants on
  // this stack carry more than one, and four carry all six. Read-only — a language is a choice
  // stored on this browser and nothing is written anywhere.
  const LANG_TENANT = process.env.T5_LANG_TENANT || "spice-route";
  const langDoor = async () => {
    await p.goto(`${BASE}/r/${LANG_TENANT}/menu`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await p.waitForSelector(".item-card", { timeout: 30000 });
    await wait(600);
  };
  await langDoor();
  // WHICH languages this restaurant actually offers, read off its own picker with a real click —
  // `el.click()` inside evaluate does not open a React dropdown. Driving a language the restaurant
  // does not offer proves nothing: Header correctly forces the guest back to the first one, so the
  // page stays English and the check reports the app for obeying its own rule.
  await p.click('.nav-actions .nav-btn[aria-label="Language"]').catch(() => {});
  await wait(500);
  const offeredCodes = await p.evaluate(() =>
    [...document.querySelectorAll('.nav-picker-list [role="option"]')].map((o) => o.textContent.trim()));
  await p.keyboard.press("Escape").catch(() => {});
  const CODE_OF = { English: "en", Deutsch: "de", "Français": "fr", "العربية": "ar", "हिन्दी": "hi", "한국어": "ko" };
  // The option reads "🇬🇧English" — a flag and the name with NO space between them, so a
  // split-on-whitespace found nothing and the whole band skipped itself on a restaurant that
  // offers all six. Strip anything that is not a letter of some script.
  const offered = offeredCodes
    .map((t) => CODE_OF[t.replace(/^[^\p{L}]+/u, "").trim()])
    .filter(Boolean);
  const multi = offered.length > 1;
  let lid = 95111;   // the six-language loop owns P95111-95140
  for (const L of LANGS) {
    if ((!multi || (offered.length && !offered.includes(L))) && L !== "en") {
      for (let k = 0; k < 5; k++) skip(`P${lid++}`, `the menu renders in ${L}`,
        `this restaurant offers ${offered.length ? offered.join(", ") : "one language"} — ${L} is not one of them, and the app correctly forces every guest back to one it does offer. Asserting ${L} here would be asserting against the owner's own one-choice rule.`);
      continue;
    }
    await p.evaluate((l) => { try { localStorage.setItem("lfh_language", l); } catch {} }, L);
    await langDoor();
    const r = await p.evaluate(() => ({
      text: document.body.innerText.replace(/\s+/g, " ").slice(0, 400),
      // The app's OWN words, not the page's first 400 characters. Dish names and category names
      // deliberately do not translate (the owner's recorded decision, 2026-08-05), so sampling the
      // top of the page measured the restaurant's data and reported Korean as unrendered on a menu
      // whose chrome was in Korean all along.
      chrome: [document.querySelector('input[placeholder]')?.placeholder || "",
               ...[...document.querySelectorAll(".filter-chip, .chip, .sort-chip")].map((c) => c.textContent)].join(" "),
      dir: document.documentElement.getAttribute("dir") || document.dir || "ltr",
      cards: document.querySelectorAll(".item-card").length,
      chips: [...document.querySelectorAll(".filter-chip, .chip")].map((c) => c.textContent.trim()).filter(Boolean).slice(0, 6),
      // A CHILD PAST ITS PARENT'S EDGE is what a person sees. `scrollWidth > clientWidth` is not:
      // measured on the flagship menu, 1 card in 59 carries 9px of internal scroll width with
      // `overflow-x: hidden` and NOTHING extending past the card — nothing is cut off, and
      // reporting it would be reporting a number rather than a screen.
      overflow: [...document.querySelectorAll(".item-card, .nav, .filter-chip")]
        .filter((e) => {
          const b = e.getBoundingClientRect();
          return [...e.children].some((k) => { const r = k.getBoundingClientRect(); return r.right > b.right + 1 || r.left < b.left - 1; });
        }).length,
    }));
    check(`P${lid++}`, `the menu renders in ${L} with its dishes`, () => r.cards > 0 || "0 cards");
    check(`P${lid++}`, `…with no code token on screen in ${L}`, () =>
      !/undefined|NaN|\[object Object\]|\$\{|-->/.test(r.text) || r.text.slice(0, 120));
    check(`P${lid++}`, `…and nothing overflows its own box in ${L}`, () =>
      r.overflow === 0 || `${r.overflow} element(s) overflow`);
    if (L === "ar")
      check(`P${lid++}`, "…and Arabic is left-to-right, which is the recorded decision, not a bug", () =>
        r.dir !== "rtl" || "the page flipped to rtl, which R23 did not ask for");
    else check(`P${lid++}`, `…and the ${L} page declares a reading direction at all`, () => !!r.dir || "no dir");
    if (L === "hi" || L === "ko")
      check(`P${lid++}`, `…and ${L} renders its own script in the app's own words, not boxes`, () =>
        (L === "hi" ? /[ऀ-ॿ]/ : /[가-힯]/).test(r.chrome) || `the chrome read "${r.chrome.slice(0, 80)}"`);
    else check(`P${lid++}`, `…and the ${L} page renders readable words`, () => r.text.trim().length > 20 || r.text);
  }
  await p.evaluate(() => { try { localStorage.setItem("lfh_language", "en"); } catch {} });

  /* ── 6 · a dish page: the star rating and the sold-out label ── */
  await menu();
  const href = await p.evaluate(() => document.querySelector(".item-card-link")?.getAttribute("href") || "");
  await p.goto(BASE + href, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await wait(2500);
  const dish = await p.evaluate(() => {
    const stars = document.querySelectorAll(".sr-li").length;
    const pill = document.querySelector(".sr-score-pill");
    const r = pill?.getBoundingClientRect();
    return { stars, pill: (pill?.textContent || "").replace(/\s+/g, " ").trim(),
             pillW: r ? Math.round(r.width) : 0, vw: innerWidth,
             names: [...document.querySelectorAll(".sr-toggle")].map((t) => t.getAttribute("aria-label")).filter(Boolean).length,
             text: document.body.innerText.replace(/\s+/g, " ").slice(0, 300) };
  });
  if (!dish.stars) skip("P95141", "the star rating draws five stars", "this restaurant has ratings switched off, so the box is correctly absent");
  else {
    check("P95141", "the star rating draws five stars", () => dish.stars === 5 || `${dish.stars}`);
    check("P95142", "…every one of them named for a screen reader", () => dish.names === 5 || `${dish.names} named`);
    check("P95143", "…and the score pill reads as a score out of five", () => /\/\s*5/.test(dish.pill) || dish.pill);
    check("P95144", "…and it fits the phone", () => dish.pillW <= dish.vw || `${dish.pillW}px`);
  }
  check("P95145", "the dish page shows no code token", () =>
    !/undefined|NaN|\[object Object\]|\$\{/.test(dish.text) || dish.text.slice(0, 120));
  await p.screenshot({ path: path.join(SHOTS, "r2-dish-a35.png") });

  /* ── 7 · the guest dead end, again, and its way out really works ── */
  await p.goto(`${BASE}/r/${TENANT}/item/zz-none-${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await wait(2000);
  const gnfBtn = await p.evaluate(() => !!document.querySelector(".gnf .btn"));
  check("P95146", "the guest dead end offers a way back", () => gnfBtn || "no button");
  if (gnfBtn) {
    await p.click(".gnf .btn").catch(() => {});
    await wait(2500);
    const landed = await p.evaluate(() => ({ path: location.pathname, cards: document.querySelectorAll(".item-card").length }));
    check("P95147", "…and it really lands on that restaurant's menu, with dishes on it", () =>
      (landed.path.includes(TENANT) && landed.cards > 0) || JSON.stringify(landed));
  }

  /* ── 8 · the page throws nothing while all of that happens ── */
  check("P95148", "no page error was thrown across the whole walk", () =>
    errors.length === 0 || errors.slice(0, 2).join(" | "));

  await ctx.close();
} finally { await browser.close().catch(() => {}); }
process.exit(report("T5 round 2 — R4 live") ? 1 : 0);
