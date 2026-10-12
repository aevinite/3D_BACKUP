// Bank H · app/aevinite/printing/page.tsx — the admin Printing screen, read and then DRIVEN in a real
// browser on my port: the overview and French House, desktop 1280 · iPad 1194×834 · Samsung A35
// 360×780 dpr3 (with touch, or the phone layout never applies), both skins. The rendered text is
// what is asserted, never the source. One setup code is shown and deleted again by its own hash.
import { createHash } from "node:crypto";
import { chk, skip, assert, eq, src, codeOnly, onFinish } from "./lib.mjs";
import { sb as service, BASE } from "./env.mjs";
import { adminCookie } from "../login.mjs";

const F = "app/aevinite/printing/page.tsx";
const R = "read today's code (comments stripped)";
const D = `driven in Chromium on ${BASE} as the admin`;
const code = codeOnly(src(F));
const db = await service();
const FH = (await db.from("restaurants").select("id").eq("slug", "french-house").maybeSingle()).data?.id;
const sha = (s) => createHash("sha256").update(s).digest("hex");

await chk("P184393", F, "every write on the board goes through adminFetch to /api/admin/printing (no other door)", R, () => {
  const urls = [...code.matchAll(/adminFetch<[^>]*>\(`([^`]+)`|adminFetch<[^>]*>\("([^"]+)"/g)].map((m) => m[1] || m[2]); assert(urls.every((u) => /^\/api\/admin\/(printing|restaurants)/.test(u)), urls.join(","));
});
await chk("P184394", F, "no raw fetch() at all — every call carries the admin session the same way", R, () => assert(!/[^.\w]fetch\(/.test(code)));
await chk("P184395", F, "a failed load is said on screen ('could not be read' + Try again), never drawn as an empty board", R, () => assert(/This page could not be read\./.test(code) && /This could not be read\./.test(code)));
await chk("P184396", F, "the overview polls every 12 s and the restaurant view every 10 s — and only while it is the one on screen", R, () => {
  assert(/if \(rid\) return;\s*const t = setInterval\(\(\) => \{ void loadOver\(\); \}, 12000\)/.test(code) && /if \(!rid\) return;\s*const t = setInterval\(\(\) => \{ void load\(\); \}, 10000\)/.test(code));
});
await chk("P184397", F, "every route save sends what the line said when the board loaded (first save wins, lib/clash)", R, () => {
  const at = [...code.matchAll(/post\("routes", /g)].map((m) => code.slice(m.index, m.index + 160)); assert(at.length >= 5 && at.every((p) => /was: wasFor\(/.test(p)), at.filter((p) => !/was: wasFor\(/.test(p)).join(" | "));
});
await chk("P184398", F, "Rename sends the clash header with the name it had when the box opened", R, () => assert(/table: "print_agents", id: a\.id, fields: \{ name: a\.name \}/.test(code)));
await chk("P184399", F, "Unlink and Clear-the-queue both ask first, and say what will happen", R, () => assert(/confirm\(`Unlink/.test(code) && /confirm\(`Clear \$\{st\.waiting\} waiting ticket/.test(code)));
await chk("P184400", F, "the ⓘ popover is registered with the back-button manager", R, () => assert(/useBackClose\("admin-printing-info", info, \(\) => setInfo\(false\)\)/.test(code)));
await chk("P184401", F, "times in the log are Indian time with the day, not the reader's laptop clock", R, () => assert(/whenWords\(j\.created_at\)/.test(code) && !/toLocale(Time|Date)?String\(/.test(code)));
await chk("P184402", F, "there is no stored printing MODE toggle on the board (mig 372) — the two tabs are a mirror", R, () => assert(!/printing\.mode|setMode\(|writeMode\(/.test(code)));
await chk("P184403", F, "a sleeping printer CAN be chosen (owner 2026-09-14) — no option is disabled for being asleep", R, () => assert(!/disabled=\{!a\.connected\}/.test(code)));

let pw = null;
try { pw = await import("playwright"); } catch { /* skipped below with the reason */ }
const up = await fetch(BASE + "/print-setup.html").then((r) => r.ok).catch(() => false);
if (!pw || !up || !FH) { for (let n = 404; n <= 445; n++) skip(`P184${n}`, F, "driven row", D, `needs Playwright and the app on ${BASE}`); }
else {
  const browser = await pw.chromium.launch();
  onFinish(() => browser.close());
  const ac = adminCookie(BASE);
  const host = new URL(BASE).hostname;
  const open = async ({ width = 1280, height = 900, skin = "dark", phone = false, path = `/aevinite/printing?rid=${FH}` } = {}) => {
    const ctx = await browser.newContext(phone ? { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width, height } });
    await ctx.addCookies([{ name: ac.name, value: ac.value, domain: host, path: "/" }, { name: "aevidine_skin", value: skin, domain: host, path: "/" }]);
    const page = await ctx.newPage(); const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message || e)));
    await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 90000 });
    // WAIT FOR THE BOARD ITSELF, not for a word: the heading and the sidebar carry the same words
    // before the restaurant's data has landed, and a read taken then measured a half-built page.
    const ready = path.includes("rid=") ? "main.adm-main .adm-waycard, main.adm-main .adm-over-row" : "main.adm-main .adm-over-row";
    await page.waitForSelector(ready, { timeout: 90000 }).catch(() => {});
    if (path.includes("rid=")) await page.waitForFunction(() => /Is it working right now|Printing is switched off|Every restaurant/.test(document.querySelector("main.adm-main")?.innerText || ""), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(700);
    return { ctx, page, errors };
  };
  const text = (page) => page.evaluate(() => (document.querySelector("main.adm-main") || document.body).innerText);
  const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  const leaked = (t) => (t.match(/undefined|NaN|\[object Object\]|\$\{|-->/g) || []);

  // ── the overview ──
  const ov = await open({ path: "/aevinite/printing" });
  const ovText = await text(ov.page);
  await chk("P184404", F, "the overview opens on 'Every restaurant', one row per restaurant", D, () => { assert(/Every restaurant/.test(ovText), `the screen said: ${ovText.slice(0, 160).replace(/\n/g, " | ")}`); });
  await chk("P184405", F, "…French House is on it, with a plain verdict word", D, () => { assert(/My Little French House/.test(ovText) && /(printing|no computer|not routed|asleep|stuck|not switched on)/.test(ovText)); });
  await chk("P184406", F, "…a restaurant printing is not allowed for reads 'not switched on', never a red alarm", D, () => assert(/not switched on/i.test(ovText)));   // innerText applies the tag's text-transform
  await chk("P184407", F, "…no code text leaks onto the overview", D, () => eq(leaked(ovText), []));
  await chk("P184408", F, "…and it throws nothing", D, () => eq(ov.errors, []));
  await chk("P184409", F, "clicking a row opens that restaurant and writes ?rid= into the address (a refresh stays there)", D, async () => {
    await ov.page.locator("button.adm-over-row", { hasText: "My Little French House" }).first().click();
    await ov.page.waitForSelector("main.adm-main .adm-waycard", { timeout: 60000 }); assert(ov.page.url().includes(`rid=${FH}`), ov.page.url());
  });
  await chk("P184410", F, "…and the browser's Back returns to the overview", D, async () => {
    await ov.page.goBack(); await ov.page.waitForFunction(() => /Every restaurant/.test(document.body.innerText), null, { timeout: 30000 }); assert(!ov.page.url().includes("rid="), ov.page.url());
  });
  await ov.ctx.close();

  // ── French House, desktop, dark ──
  const fh = await open();
  const fhText = await text(fh.page);
  await chk("P184411", F, "French House opens with its name in the heading", D, () => assert(/Printing · My Little French House/.test(fhText), fhText.slice(0, 120)));
  await chk("P184412", F, "…the two ways are on top, each with ON/OFF in WORDS, not only colour", D, () => assert(/A computer prints[\s\S]{0,40}(ON|OFF)/.test(fhText) && /A screen prints[\s\S]{0,40}(ON|OFF)/.test(fhText)));
  await chk("P184413", F, "…'Is it working right now' lists the papers with a state word each", D, () => assert(/Is it working right now/.test(fhText) && /(LIVE|ASLEEP|OFF|SCREEN|WINDOW|STOPPED)/.test(fhText)));
  await chk("P184414", F, "…the owner's own linked PC (INFINITE) is listed with its last-seen time, not 'never'", D, () => assert(/INFINITE/.test(fhText) && /last seen/.test(fhText), "the linked computer is missing"));
  await chk("P184415", F, "…the helper file's code is SHUT until somebody asks (owner 2026-09-14)", D, async () => {
    eq(await fh.page.locator("main.adm-main pre").count(), 0); assert(/Show the code/.test(fhText));
  });
  await chk("P184416", F, "…'Show the code' opens it and 'Hide the code' shuts it again", D, async () => {
    await fh.page.getByRole("button", { name: /Show the code/ }).first().click(); await fh.page.waitForTimeout(200); eq(await fh.page.locator("main.adm-main pre").count(), 1);
    const t = await fh.page.locator("main.adm-main pre").innerText(); assert(t.startsWith("#!/bin/zsh") || t.startsWith("@echo off") || t.startsWith("#!/bin/sh"), t.slice(0, 30));
    await fh.page.getByRole("button", { name: /Hide the code/ }).first().click(); await fh.page.waitForTimeout(200); eq(await fh.page.locator("main.adm-main pre").count(), 0);
  });
  await chk("P184417", F, "…the file it shows points at THIS site's address", D, async () => {
    await fh.page.getByRole("button", { name: /Show the code/ }).first().click(); const t = await fh.page.locator("main.adm-main pre").innerText(); assert(t.includes(`SITE="${BASE}"`) || t.includes(`SITE=${BASE}`), "another site's address");
    await fh.page.getByRole("button", { name: /Hide the code/ }).first().click();
  });
  await chk("P184418", F, "…the three OS buttons switch the file (Mac → Windows → Linux)", D, async () => {
    for (const [lbl, head] of [["Windows", "@echo off"], ["Linux / Raspberry Pi", "#!/bin/sh"], ["Mac", "#!/bin/zsh"]]) {
      await fh.page.getByRole("button", { name: lbl, exact: true }).first().click(); await fh.page.getByRole("button", { name: /Show the code/ }).first().click();
      const t = await fh.page.locator("main.adm-main pre").innerText(); assert(t.startsWith(head), `${lbl}: ${t.slice(0, 20)}`); await fh.page.getByRole("button", { name: /Hide the code/ }).first().click();
    }
  });
  await chk("P184419", F, "the ⓘ opens a popover that explains the way and the whole-feature switch", D, async () => {
    await fh.page.locator("button.adm-ibtn").click(); await fh.page.waitForSelector("#print-way-info"); assert(/The whole feature/.test(await fh.page.locator("#print-way-info").innerText()));
  });
  await chk("P184420", F, "…Escape closes it", D, async () => { await fh.page.keyboard.press("Escape"); await fh.page.waitForTimeout(150); eq(await fh.page.locator("#print-way-info").count(), 0); });
  await chk("P184421", F, "…the × closes it", D, async () => { await fh.page.locator("button.adm-ibtn").click(); await fh.page.locator("#print-way-info button.x").click(); await fh.page.waitForTimeout(150); eq(await fh.page.locator("#print-way-info").count(), 0); });
  await chk("P184422", F, "…a click outside closes it", D, async () => { await fh.page.locator("button.adm-ibtn").click(); await fh.page.locator("h1.adm-page-h").click(); /* an empty spot — not the sidebar, which is full of links */ await fh.page.waitForTimeout(150); eq(await fh.page.locator("#print-way-info").count(), 0); });
  await chk("P184423", F, "…and the browser's Back closes it WITHOUT leaving the page", D, async () => {
    await fh.page.locator("button.adm-ibtn").click(); await fh.page.waitForSelector("#print-way-info"); const before = fh.page.url(); await fh.page.goBack(); await fh.page.waitForTimeout(400);
    eq(await fh.page.locator("#print-way-info").count(), 0); eq(fh.page.url(), before);
  });
  await chk("P184424", F, "choosing the screen tab shows the screen setup and hides the helper file", D, async () => {
    await fh.page.getByRole("tab", { name: /A screen prints/ }).click(); await fh.page.waitForTimeout(300); const t = await text(fh.page);
    assert(!/The helper file/.test(t), "the helper file is still on the screen tab"); assert(/Kitchen slips/.test(t));
  });
  await chk("P184425", F, "…and back on the computer tab the screen's person picker is gone", D, async () => {
    await fh.page.getByRole("tab", { name: /A computer prints/ }).click(); await fh.page.waitForTimeout(300); assert(!/The person/.test(await text(fh.page)));
  });
  await chk("P184426", F, "the tabs are reachable and pressable from the keyboard alone", D, async () => {
    await fh.page.getByRole("tab", { name: /A screen prints/ }).focus(); await fh.page.keyboard.press("Enter"); await fh.page.waitForTimeout(250);
    eq(await fh.page.getByRole("tab", { name: /A screen prints/ }).getAttribute("aria-selected"), "true"); await fh.page.getByRole("tab", { name: /A computer prints/ }).click();
  });
  let shown = null;
  await chk("P184427", F, "'Show a setup code' shows six characters in two groups with a countdown", D, async () => {
    await fh.page.getByRole("button", { name: /Show a (new )?setup code/ }).click(); await fh.page.waitForSelector(".adm-setupcode-digits", { timeout: 20000 });
    shown = (await fh.page.locator(".adm-setupcode-digits").innerText()).trim(); assert(/^[A-Z2-9]{3} [A-Z2-9]{3}$/.test(shown), shown);
    assert(/\d:\d\d left/.test(await fh.page.locator(".adm-setupcode-left").innerText()));
  });
  onFinish(async () => { if (shown) await db.from("print_setup_codes").delete().eq("code_hash", sha(shown.replace(" ", ""))).eq("restaurant_id", FH); });
  await chk("P184428", F, "…the database holds only the hash of the code on screen", D, async () => {
    const row = (await db.from("print_setup_codes").select("id, issued_by_kind").eq("code_hash", sha(shown.replace(" ", ""))).eq("restaurant_id", FH).maybeSingle()).data; eq(row?.issued_by_kind, "admin");
  });
  await chk("P184429", F, "…its Copy button says 'Copied ✓' on the button itself, not only in a toast", D, async () => {
    await fh.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE }); await fh.page.locator(".adm-setupcode-side button").click(); await fh.page.waitForTimeout(150);
    assert(/Copied/.test(await fh.page.locator(".adm-setupcode-side button").innerText()));
  });
  await chk("P184430", F, "…a reload loses the digits (shown once) but the board still says a code is live", D, async () => {
    const before = fh.page.url().replace(BASE, "");
    await fh.page.reload({ waitUntil: "domcontentloaded" });
    // the BOARD, not the words: the overview's subtitle says "A computer prints" too, and for a moment after a reload the overview IS on screen
    await fh.page.waitForSelector("main.adm-main .adm-waycard", { timeout: 60000 }); await fh.page.waitForTimeout(500);
    eq(await fh.page.locator(".adm-setupcode-digits").count(), 0); const t = await text(fh.page);
    assert(/A code is already live for another/.test(t), `[url before reload ${before}, after ${fh.page.url().replace(BASE, "")}] the card said: ${(t.match(/Set a computer up[\s\S]{0,260}/) || ["(no setup card)"])[0].replace(/\n/g, " | ")}`);
  });
  await chk("P184431", F, "the log table names each paper in words and never shows a raw status code", D, async () => {
    const t = await text(fh.page); const log = t.slice(t.indexOf("What has printed") >= 0 ? t.indexOf("What has printed") : 0); assert(!/\b(queued|kot)\b · try/.test(log)); return "log read";
  });
  await chk("P184432", F, "nothing on the board reads undefined / NaN / [object Object] / ${", D, async () => eq(leaked(await text(fh.page)), []));
  await chk("P184433", F, "the board throws no page error", D, () => eq(fh.errors, []));
  await chk("P184434", F, "nothing scrolls sideways at 1280", D, async () => assert(await fits(fh.page)));
  const counts = await fh.page.evaluate(() => {
    const root = document.querySelector("main.adm-main"); const vis = (el) => el.getBoundingClientRect().width > 0;
    const all = [...root.querySelectorAll("button, select, input, a")].filter(vis); const inLog = all.filter((el) => el.closest("table")).length;
    return { all: all.length, inLog, setup: all.length - inLog };
  });
  await chk("P184435", F, "the computer tab's SETUP is not a wall of controls (≤ 40, the log table's per-row buttons apart)", D, () => {
    assert(counts.setup <= 40, JSON.stringify(counts)); return `${counts.setup} setup controls + ${counts.inLog} in the log table (today: two computers linked)`;
  });
  await fh.ctx.close();

  // ── the other sizes and skins ──
  for (const [id, opts, label] of [["P184436", { skin: "light" }, "light skin at 1280"], ["P184437", { width: 1194, height: 834 }, "iPad 1194×834"], ["P184438", { phone: true }, "Samsung A35 360×780 dpr3"], ["P184439", { phone: true, skin: "light" }, "A35, light skin"]]) {
    await chk(id, F, `French House renders, fits the width and leaks no code text — ${label}`, D, async () => {
      const s = await open(opts); const t = await text(s.page); const ok = await fits(s.page); const errs = s.errors; await s.ctx.close();
      assert(/Printing · My Little French House/.test(t), `did not render — it said: ${t.slice(0, 160).replace(/\n/g, " | ")}`); assert(ok, "scrolls sideways"); eq(leaked(t), []); eq(errs, []);
    });
  }
  await chk("P184440", F, "on the A35 the Refresh button and the restaurant picker are both on screen (the 2026-09-04 fix holds)", D, async () => {
    const s = await open({ phone: true }); const r = await s.page.evaluate(() => { const b = [...document.querySelectorAll("main.adm-main button")].find((x) => /Refresh/.test(x.innerText)); const sel = document.querySelector("main.adm-main select"); const w = innerWidth;
      return [b, sel].map((el) => el ? el.getBoundingClientRect().right <= w + 1 : false); }); await s.ctx.close(); eq(r, [true, true]);
  });
  await chk("P184441", F, "on the A35 every button on the board is at least 32 px tall", D, async () => {
    const s = await open({ phone: true }); const small = await s.page.evaluate(() => [...document.querySelectorAll("main.adm-main .adm-waycard button")].filter((b) => b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 32).map((b) => b.innerText.trim().slice(0, 30)));
    await s.ctx.close(); eq(small, []);
  });
  await chk("P184442", F, "a ?rid= written as a SLUG is normalised to the id in place", D, async () => {
    const s = await open({ path: "/aevinite/printing?rid=french-house" }); await s.page.waitForTimeout(600); const u = s.page.url(); await s.ctx.close(); assert(u.includes(`rid=${FH}`), u);
  });
  await chk("P184443", F, "a ?rid= that matches nothing falls back to the overview and cleans the address", D, async () => {
    const s = await open({ path: "/aevinite/printing?rid=00000000-0000-4000-8000-00000000dead" }); await s.page.waitForTimeout(800); const t = await text(s.page); const u = s.page.url(); await s.ctx.close();
    assert(/Every restaurant/.test(t), "not the overview"); assert(!u.includes("rid="), u);
  });
  // Aangan: the read-only control restaurant, LOOKED AT only. Its printing is off at factory defaults.
  const offRid = async () => { const r = (await db.from("restaurants").select("id").eq("slug", "aangan-garden-restaurant").limit(1).maybeSingle()).data?.id;
    const st = r && (await db.from("settings").select("auto_print_kot_allowed").eq("restaurant_id", r).maybeSingle()).data; return st && st.auto_print_kot_allowed === false ? r : null; };
  await chk("P184444", F, "a restaurant that may NOT print shows the red 'switched off' line and greys the setup", D, async () => {
    const off = await offRid(); if (!off) return "no restaurant with printing off to look at";
    const s = await open({ path: `/aevinite/printing?rid=${off}` }); const t = await text(s.page); const fs = await s.page.locator("main.adm-main fieldset[disabled]").count(); await s.ctx.close();
    assert(/Printing is switched off for this restaurant/.test(t)); eq(fs, 1);
  });
  await chk("P184445", F, "…and neither way reads ON there", D, async () => {
    const off = await offRid(); if (!off) return "nothing to look at";
    const s = await open({ path: `/aevinite/printing?rid=${off}` }); const ons = await s.page.locator(".adm-waybar .w").allInnerTexts(); await s.ctx.close(); assert(ons.every((x) => x.trim() === "OFF"), ons.join(","));
  });
}
