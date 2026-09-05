// Round 2 · Band H — THE SWITCHED-OFF STATES.  ids P67301–P67380.
//
// Round 1 had ONE row that so much as mentioned this state, and yet it is where two of round 1's
// five faults lived. When Aevidine takes the Reports section away from a restaurant, or takes
// Audit & logs away from an owner, the dashboard must read as OFF — never as broken, never as a
// confident zero. Every figure, every card, every popup, both skins, both widths, one restaurant
// and five.
import { chk, skip, report, setOnly, writeLedger, executedIds } from "./lib.mjs";
import { openWith, closeBrowser, refuse, setRange, screenText, pageErrors, ESTATE, BASE, idFor } from "./r2lib.mjs";

const id = idFor(67300);
const EXPECT_ROWS = 80;
const argOnly = process.argv.find((x) => x.startsWith("--only="));
if (argOnly) setOnly(argOnly.slice(7).split(","));

const OFF_ONE = "Reports aren't enabled for this restaurant — contact Aevidine.";
const OFF_ALL = "Reports aren't enabled for your restaurant — contact Aevidine.";

// ══ 1 · Reports switched off for the WHOLE account, one restaurant ════════════════════════════
const A = await openWith({ rules: [["/api/owner/analytics", refuse(OFF_ALL)]] });
const aTxt = await screenText(A.pg);

await chk(id(1), "the page still renders — a withheld section is not a crash", async () =>
  (await A.pg.locator(".ow2-kpi").count()) === 5 ? true : `${await A.pg.locator(".ow2-kpi").count()} tiles`);
await chk(id(2), "…with no console error and no failed request from the page itself", () => {
  const real = pageErrors(A.errs).filter((e) => !/403/.test(e) && !/status of 403/.test(e));
  return real.length === 0 ? true : `${JSON.stringify(real.slice(0, 3))}`;
});
await chk(id(3), "the refusal is shown as a calm note, never the red 'Couldn't load' card", async () => {
  const red = await A.pg.locator('.adm-card[style*="adm-danger"]').count();
  const calm = await A.pg.locator(".fa-eye-slash").count();
  return red === 0 && calm >= 1 ? true : `redCards=${red} calmNotes=${calm}`;
});
await chk(id(4), "…and it says figures are not SHOWN, not that something failed", () =>
  /aren’t shown here|aren't shown here/i.test(aTxt) && !/Couldn’t load|Couldn't load/i.test(aTxt)
    ? true : `screen says: ${JSON.stringify(aTxt.slice(0, 140))}`);
await chk(id(5), "…and it repeats the server's own sentence, so he knows who to ask", () =>
  aTxt.includes("contact Aevidine") ? true : "the 'contact Aevidine' sentence never reached the screen");
await chk(id(6), "all five tiles print an em dash rather than a figure", async () => {
  const vals = (await A.pg.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim());
  const bad = vals.filter((v) => v !== "—");
  return bad.length === 0 ? true : `tiles showing a figure: ${JSON.stringify(vals)}`;
});
await chk(id(7), "…including 'Today so far', which reads a DIFFERENT payload and once stayed live", async () => {
  const t = A.pg.locator(".ow2-kpi").nth(2);
  return (await t.locator(".v").innerText()).trim() === "—"
    ? true : `Today so far still prints ${JSON.stringify((await t.locator(".v").innerText()).trim())}`;
});
await chk(id(8), "…and the '● live' pill is gone with it — there is nothing live to point at", async () =>
  (await A.pg.locator(".ow2-kpi .ow2-live").count()) === 0 ? true : "a tile still claims to be live");
await chk(id(9), "every tile says WHY, in the same words", async () => {
  const subs = (await A.pg.locator(".ow2-kpi .ow2-sub").allInnerTexts()).map((s) => s.trim());
  const same = subs.filter((s) => s === "Reports are switched off");
  return subs.length === 5 && same.length === 5 ? true : `captions: ${JSON.stringify(subs)}`;
});
await chk(id(10), "no tile opens a popup in this state", async () => {
  const before = await A.pg.locator(".ow2-tile").count();
  for (let i = 0; i < 5; i++) { await A.pg.locator(".ow2-kpi").nth(i).click({ force: true }); await A.pg.waitForTimeout(200); }
  const after = await A.pg.locator(".ow2-tile").count();
  return before === 0 && after === 0 ? true : `${after} popups opened`;
});
await chk(id(11), "…and none of them is a clickable button any more", async () => {
  const tags = await A.pg.locator(".ow2-kpi").evaluateAll((els) => els.map((e) => e.tagName));
  return tags.every((t) => t === "DIV") ? true : `tile tags: ${JSON.stringify(tags)}`;
});
await chk(id(12), "no delta chip survives — there is nothing to compare", async () =>
  (await A.pg.locator(".ow2-kpi .adm-delta, .ow2-kpi [class*=delta]").count()) === 0
    ? true : "a comparison chip is still drawn over withheld figures");
await chk(id(13), "no sparkline survives either", async () =>
  (await A.pg.locator(".ow2-kpi .ow2-spark").count()) === 0 ? true : "a sparkline is still drawn");
await chk(id(14), "every chart card says it is not shown, rather than claiming to load", async () => {
  const empties = (await A.pg.locator(".adm-empty").allInnerTexts()).map((e) => e.trim());
  const loading = empties.filter((e) => /Loading/i.test(e));
  return loading.length === 0 ? true : `${loading.length} cards still say Loading: ${JSON.stringify(empties)}`;
});
await chk(id(15), "…and they all say the same short thing", async () => {
  const empties = (await A.pg.locator(".adm-empty").allInnerTexts()).map((e) => e.trim()).filter((e) => /switched off/i.test(e));
  return new Set(empties).size <= 1 ? true : `${new Set(empties).size} different wordings: ${JSON.stringify([...new Set(empties)])}`;
});
await chk(id(16), "the dish list says it too, rather than 'Loading…'", async () => {
  const c = A.pg.locator(".adm-card", { hasText: "Every dish" });
  const t = (await c.innerText()).replace(/\s+/g, " ");
  return /switched off/i.test(t) ? true : `the dish card reads: ${JSON.stringify(t.slice(0, 100))}`;
});
await chk(id(17), "no figure with a currency mark is left anywhere on the page", () => {
  const money = (aTxt.match(/₹[\d,]+/g) || []).filter((m) => m !== "₹0");
  return money.length === 0 ? true : `money still on screen: ${JSON.stringify(money.slice(0, 6))}`;
});
await chk(id(18), "…and no percentage either", () => {
  const pct = aTxt.match(/\b\d+%/g) || [];
  return pct.length === 0 ? true : `percentages still on screen: ${JSON.stringify(pct.slice(0, 6))}`;
});
await chk(id(19), "the age line stops claiming the page is fresh", async () => {
  const t = await A.pg.locator(".ow2-tools").innerText();
  return !/updated just now/i.test(t) || /your last view/i.test(t)
    ? true : `the toolbar says: ${JSON.stringify(t.replace(/\s+/g, " ").slice(0, 120))}`;
});
await chk(id(20), "nothing on the page leaks code text in this state", () => {
  const bad = ["[object Object]", "undefined", "NaN", "${", "-->", "Infinity"].filter((b) => aTxt.includes(b));
  return bad.length === 0 ? true : `${JSON.stringify(bad)}`;
});
await chk(id(21), "the hero still names the restaurant — identity is not a figure", async () =>
  (await A.pg.locator(".own-hero-name").innerText()).trim().length > 2
    ? true : "the restaurant's own name went with the figures");
await chk(id(22), "…and its open-table count survives, because it is not money", async () => {
  const t = await A.pg.locator(".own-hero").innerText();
  return /tables? open now/.test(t) ? true : `the hero reads: ${JSON.stringify(t.replace(/\s+/g, " ").slice(0, 90))}`;
});
await chk(id(23), "the Refresh button still works rather than being dead", async () => {
  // Measured by what it DOES, not by catching its spinner. The first version waited 400ms and
  // looked for .fa-spin — and the spinner's own floor is 400ms, so the check was racing the thing
  // it measured and reported a working button as dead. A refresh means new requests.
  const before = A.reqs.length;
  await A.pg.locator("button", { hasText: "Refresh" }).first().click();
  await A.pg.waitForTimeout(3500);
  const fired = A.reqs.length - before;
  return fired >= 2 ? true : `Refresh fired ${fired} request(s)`;
});
await chk(id(24), "…and refreshing does not turn the calm note into a red one", async () => {
  const red = await A.pg.locator('.adm-card[style*="adm-danger"]').count();
  return red === 0 ? true : "a refresh turned the refusal into a breakage";
});
await chk(id(25), "the period dropdown still opens — he can still move around", async () => {
  await A.pg.locator(".owr-btn.main").click();
  await A.pg.waitForSelector(".owr-pop", { timeout: 8000 });
  const n = await A.pg.locator(".owr-pop button").count();
  await A.pg.locator("body").click({ position: { x: 3, y: 3 } });
  await A.pg.waitForTimeout(300);
  return n === 8 ? true : `${n} periods offered`;
});
await chk(id(26), "…and changing the period keeps the state calm rather than breaking it", async () => {
  await setRange(A.pg, "Today");
  const red = await A.pg.locator('.adm-card[style*="adm-danger"]').count();
  const loading = (await A.pg.locator(".adm-empty").allInnerTexts()).filter((e) => /Loading/i.test(e));
  await setRange(A.pg, "Last 30 days");
  return red === 0 && loading.length === 0 ? true : `redCards=${red} loadingCards=${loading.length}`;
});
await chk(id(27), "the Report menu is still reachable", async () => {
  const btn = A.pg.locator("button", { hasText: /Report/ }).first();
  const enabled = await btn.isEnabled();
  return enabled ? true : "the Report button is dead in this state";
});
await chk(id(28), "the connection pill is NOT dropped to a warning — a permission is not a network fault", async () => {
  const t = await A.pg.locator(".adm-top, header").first().innerText().catch(() => "");
  return /Connected/i.test(t) ? true : `the connection pill reads: ${JSON.stringify(t.replace(/\s+/g, " ").slice(0, 80))}`;
});
await A.pg.screenshot({ path: ".claude/sweep/shots/T13/r2-off-desktop-dark.png" });
await A.ctx.close();

// ══ 2 · the same state on the LIGHT skin and on a phone ═══════════════════════════════════════
for (const [n, skin, width, mobile] of [[29, "light", 1440, false], [37, "dark", 360, true], [45, "light", 360, true]]) {
  const V = await openWith({ skin, width, mobile, height: mobile ? 780 : 950, rules: [["/api/owner/analytics", refuse(OFF_ALL)]] });
  const t = await screenText(V.pg);
  const tag = `${skin}/${width}px`;
  await chk(id(n + 0), `${tag}: the switched-off page renders with no console error`, () => {
    const real = pageErrors(V.errs).filter((e) => !/403/.test(e) && !/status of 403/.test(e));
    return real.length === 0 ? true : JSON.stringify(real.slice(0, 2));
  });
  await chk(id(n + 1), `${tag}: all five tiles print an em dash`, async () => {
    const vals = (await V.pg.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim());
    return vals.length === 5 && vals.every((v) => v === "—") ? true : JSON.stringify(vals);
  });
  await chk(id(n + 2), `${tag}: no card is left claiming to load`, async () => {
    const loading = (await V.pg.locator(".adm-empty").allInnerTexts()).filter((e) => /Loading/i.test(e));
    return loading.length === 0 ? true : `${loading.length} cards`;
  });
  await chk(id(n + 3), `${tag}: the calm note is readable, not the red card`, async () => {
    const red = await V.pg.locator('.adm-card[style*="adm-danger"]').count();
    const calm = /aren’t shown here|aren't shown here/i.test(t);
    return red === 0 && calm ? true : `redCards=${red} calmNotePresent=${calm} screen=${JSON.stringify(t.slice(0, 110))}`;
  });
  await chk(id(n + 4), `${tag}: every ink on the withheld page still clears 3:1`, async () => {
    const bad = await V.pg.evaluate(() => {
      const lum = (c) => {
        if (!c) return null;
        const mo = /^color\(srgb\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)(?:\s*\/\s*([\d.eE+-]+%?))?\s*\)/.exec(c);
        let r, g, b, a;
        if (mo) { r = parseFloat(mo[1]) * 255; g = parseFloat(mo[2]) * 255; b = parseFloat(mo[3]) * 255; a = mo[4] === undefined ? 1 : (String(mo[4]).endsWith("%") ? parseFloat(mo[4]) / 100 : parseFloat(mo[4])); }
        else { const m = c.match(/[\d.]+/g); if (!m) return null; [r, g, b] = m.map(Number); a = m[3] === undefined ? 1 : Number(m[3]); }
        if (![r, g, b].every(Number.isFinite) || a < 0.5) return null;
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const bgOf = (el) => { let e = el; while (e) { const l = lum(getComputedStyle(e).backgroundColor); if (l !== null) return l; e = e.parentElement; } return 1; };
      const out = [];
      document.querySelectorAll(".adm-main *").forEach((el) => {
        if (!el.offsetParent && getComputedStyle(el).position !== "fixed") return;
        const txt = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("");
        if (!txt) return;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || Number(cs.opacity) < 0.3) return;
        const fl = lum(cs.color), bl = bgOf(el);
        if (fl === null || bl === null) return;
        const ratio = (Math.max(fl, bl) + 0.05) / (Math.min(fl, bl) + 0.05);
        if (ratio < 3) out.push({ text: txt.slice(0, 34), ratio: Math.round(ratio * 100) / 100 });
      });
      return out.slice(0, 6);
    });
    return bad.length === 0 ? true : JSON.stringify(bad);
  });
  await chk(id(n + 5), `${tag}: nothing runs off the right edge in this state`, async () => {
    const off = await V.pg.evaluate(() => {
      const vw = document.documentElement.clientWidth, out = [];
      document.querySelectorAll(".adm-card, .ow2-kpi, .own-hero").forEach((el) => {
        if (el.getBoundingClientRect().right > vw + 1) out.push(el.className.toString().slice(0, 30));
      });
      return out;
    });
    return off.length === 0 ? true : JSON.stringify(off);
  });
  await chk(id(n + 6), `${tag}: no code text leaks`, () => {
    const bad = ["[object Object]", "undefined", "NaN", "${", "-->"].filter((b) => t.includes(b));
    return bad.length === 0 ? true : JSON.stringify(bad);
  });
  await chk(id(n + 7), `${tag}: the page is not left scrollable past its own content`, async () => {
    const g = await V.pg.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }));
    return g.sh <= g.ch + 2 ? true : `document ${g.sh}px against ${g.ch}px`;
  });
  if (n === 45) await V.pg.screenshot({ path: ".claude/sweep/shots/T13/r2-off-phone-light.png" });
  await V.ctx.close();
}

// ══ 3 · Reports off for ONE restaurant on an estate of five ═══════════════════════════════════
// The hardest version of this state: the group view must stay whole while ONE restaurant is
// withheld — and drilling into that one must not blank the estate he returns to.
const E = await openWith({ creds: ESTATE, rules: [] });
await chk(id(53), "the estate view itself is unaffected when nothing is withheld", async () =>
  (await E.pg.locator(".hq-table tr.hq-row").count()) === 5 ? true : "the estate table changed shape");
await E.ctx.close();

const F = await openWith({
  creds: ESTATE,
  rules: [["/api/owner/analytics", async (rt) => {
    const u = new URL(rt.request().url());
    // refuse ONLY the drill into one restaurant; the group request answers normally
    if (u.searchParams.get("rid")) return rt.fulfill({ status: 403, contentType: "application/json",
      body: JSON.stringify({ error: OFF_ONE, disabled: true }) });
    return rt.continue();
  }]],
});
await chk(id(54), "the ESTATE view still shows every figure while one restaurant is withheld", async () => {
  const vals = (await F.pg.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim());
  const dashes = vals.filter((v) => v === "—");
  return dashes.length === 0 ? true : `${dashes.length} estate tiles went blank: ${JSON.stringify(vals)}`;
});
await chk(id(55), "…and the estate table still lists all five", async () =>
  (await F.pg.locator(".hq-table tr.hq-row").count()) === 5 ? true : `${await F.pg.locator(".hq-table tr.hq-row").count()} rows`);
await chk(id(56), "drilling into the withheld restaurant reads as OFF, not as broken", async () => {
  await F.pg.locator(".hq-table tr.hq-row").first().click();
  await F.pg.waitForSelector(".ow2-drawer", { timeout: 12000 });
  await F.pg.locator(".ow2-drawer .full").click();
  await F.pg.waitForTimeout(6000);
  const t = await screenText(F.pg);
  const red = await F.pg.locator('.adm-card[style*="adm-danger"]').count();
  return red === 0 && /aren’t shown here|aren't shown here/i.test(t)
    ? true : `redCards=${red} screen=${JSON.stringify(t.slice(0, 110))}`;
});
await chk(id(57), "…and its tiles all print an em dash", async () => {
  const vals = (await F.pg.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim());
  return vals.every((v) => v === "—") ? true : JSON.stringify(vals);
});
await chk(id(58), "…and no card there claims to load", async () => {
  const loading = (await F.pg.locator(".adm-empty").allInnerTexts()).filter((e) => /Loading/i.test(e));
  return loading.length === 0 ? true : `${loading.length} cards`;
});
await chk(id(59), "GOING BACK to the estate restores every figure — the refusal was SCOPED", async () => {
  await F.pg.goBack();
  await F.pg.waitForTimeout(6000);
  const vals = (await F.pg.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim());
  const dashes = vals.filter((v) => v === "—");
  return dashes.length === 0
    ? true : `after returning to the estate, ${dashes.length} tiles are still blank: ${JSON.stringify(vals)}`;
});
await chk(id(60), "…and the estate table is whole again", async () =>
  (await F.pg.locator(".hq-table tr.hq-row").count()) === 5 ? true : "the estate lost rows on the way back");
await chk(id(61), "…and no red card was left behind by the round trip", async () =>
  (await F.pg.locator('.adm-card[style*="adm-danger"]').count()) === 0 ? true : "a red card survived the return");
await F.pg.screenshot({ path: ".claude/sweep/shots/T13/r2-off-one-of-five.png" });
await F.ctx.close();

// ══ 4 · Audit & logs taken away — the activity card must be ABSENT, not spinning ══════════════
const G = await openWith({ rules: [["/api/owner/oplog", refuse("Audit & logs isn't enabled for you — contact Aevidine.")]] });
await chk(id(62), "the Recent activity card is left out entirely, not rendered disabled", async () =>
  (await G.pg.locator(".adm-card", { hasText: "Recent activity" }).count()) === 0
    ? true : "the card is still on screen when the log is switched off");
await chk(id(63), "…and nothing anywhere says 'Loading…' because of it", async () => {
  const loading = (await G.pg.locator(".adm-empty").allInnerTexts()).filter((e) => /Loading/i.test(e));
  return loading.length === 0 ? true : JSON.stringify(loading);
});
await chk(id(64), "…and the dish list beside it simply takes the room", async () => {
  const dish = G.pg.locator(".adm-card", { hasText: "Every dish" });
  const w = await dish.evaluate((el) => Math.round(el.getBoundingClientRect().width));
  const pane = await G.pg.locator(".adm-main").evaluate((el) => Math.round(el.getBoundingClientRect().width));
  return w > pane * 0.55 ? true : `the dish card is ${w}px inside a ${pane}px pane — it did not take the space`;
});
await chk(id(65), "…and the rest of the dashboard is untouched", async () => {
  const vals = (await G.pg.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim());
  return vals.length === 5 && vals.filter((v) => v === "—").length === 0 ? true : JSON.stringify(vals);
});
await chk(id(66), "…and no console error is raised by the refusal", () => {
  const real = pageErrors(G.errs).filter((e) => !/403/.test(e) && !/status of 403/.test(e));
  return real.length === 0 ? true : JSON.stringify(real.slice(0, 3));
});
await chk(id(67), "the tile popup's 'Open Audit & logs' link follows the OVERVIEW's entitlement, not the log route's answer", async () => {
  // The first version of this row asked the wrong question. It refused /api/owner/oplog and then
  // expected the popup's link to vanish — but that link is gated on `ov.entitlements.logs`, which
  // comes from /api/owner/overview, and the two are deliberately different things: one is "may he
  // open this section at all", the other is "did this particular read work". Refusing the read
  // must NOT hide the door, or a blip would look like a permission.
  await G.pg.locator(".ow2-kpi").first().click();
  await G.pg.waitForSelector(".ow2-tile", { timeout: 10000 });
  const link = await G.pg.locator(".ow2-tile .nlink").count();
  await G.pg.keyboard.press("Escape");
  await G.pg.waitForTimeout(300);
  return link === 1 ? true : `the door was withheld because ONE read failed (links=${link})`;
});
await chk(id(68), "…but the sentence explaining cancellations still stands on its own", async () => {
  await G.pg.locator(".ow2-kpi").first().click();
  await G.pg.waitForSelector(".ow2-tile", { timeout: 10000 });
  const t = await G.pg.locator(".ow2-tile").innerText();
  await G.pg.keyboard.press("Escape");
  await G.pg.waitForTimeout(300);
  return /cancelled bill is not money you lost/i.test(t) ? true : "the explanation went with the link";
});
await G.ctx.close();

// ══ 5 · BOTH switched off at once — the state nothing has ever driven ═════════════════════════
const H = await openWith({ rules: [
  ["/api/owner/analytics", refuse(OFF_ALL)],
  ["/api/owner/oplog", refuse("Audit & logs isn't enabled for you — contact Aevidine.")],
] });
const hTxt = await screenText(H.pg);
await chk(id(69), "with BOTH sections withheld the page still renders", async () =>
  (await H.pg.locator(".ow2-kpi").count()) === 5 ? true : "the dashboard did not survive both refusals");
await chk(id(70), "…with no console error", () => {
  const real = pageErrors(H.errs).filter((e) => !/403/.test(e) && !/status of 403/.test(e));
  return real.length === 0 ? true : JSON.stringify(real.slice(0, 3));
});
await chk(id(71), "…no red card", async () =>
  (await H.pg.locator('.adm-card[style*="adm-danger"]').count()) === 0 ? true : "a red card appeared");
await chk(id(72), "…no card claiming to load", async () => {
  const loading = (await H.pg.locator(".adm-empty").allInnerTexts()).filter((e) => /Loading/i.test(e));
  return loading.length === 0 ? true : JSON.stringify(loading);
});
await chk(id(73), "…the activity card absent AND the tiles dashed, at the same time", async () => {
  const card = await H.pg.locator(".adm-card", { hasText: "Recent activity" }).count();
  const vals = (await H.pg.locator(".ow2-kpi .v").allInnerTexts()).map((v) => v.trim());
  return card === 0 && vals.every((v) => v === "—") ? true : `activityCard=${card} tiles=${JSON.stringify(vals)}`;
});
await chk(id(74), "…and the screen still tells him what to do about it", () =>
  hTxt.includes("contact Aevidine") ? true : "nothing on the page says who to ask");
await chk(id(75), "…and there is still something on screen worth looking at", () =>
  hTxt.replace(/\s+/g, " ").trim().length > 120 ? true : "the page is effectively empty");
await chk(id(76), "…and the hero still names the restaurant and its open tables", async () => {
  const t = await H.pg.locator(".own-hero").innerText();
  return /tables? open now/.test(t) && t.trim().length > 20 ? true : JSON.stringify(t.slice(0, 80));
});
await chk(id(77), "…and the navigation is still there to leave by", async () =>
  (await H.pg.locator(".adm-side a, aside a, nav a").count()) > 3 ? true : "there is no way off this screen");
await chk(id(78), "…and no code text leaks in the doubly-withheld state", () => {
  const bad = ["[object Object]", "undefined", "NaN", "${", "-->"].filter((b) => hTxt.includes(b));
  return bad.length === 0 ? true : JSON.stringify(bad);
});
await chk(id(79), "…and no money figure survives anywhere", () => {
  const money = (hTxt.match(/₹[\d,]+/g) || []).filter((m) => m !== "₹0");
  return money.length === 0 ? true : JSON.stringify(money.slice(0, 5));
});
await chk(id(80), "…and the page is still exactly one screen wide", async () => {
  const g = await H.pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  return g.sw <= g.cw + 2 ? true : `document ${g.sw}px wide against ${g.cw}px`;
});
await H.pg.screenshot({ path: ".claude/sweep/shots/T13/r2-both-off.png" });
await H.ctx.close();

if (executedIds().length !== EXPECT_ROWS) {
  console.log(`\nID DRIFT: ran ${executedIds().length} rows, declares ${EXPECT_ROWS}.`);
  process.exit(2);
}
report(`T13 R2 band H · the switched-off states (P67301–P67380) · ${BASE}`, { minChecks: EXPECT_ROWS });
const out = process.argv.find((x) => x.startsWith("--ledger="));
if (out) writeLedger(out.slice(9), {
  how: "answered the page's own request with the route's real refusal, in the browser — nothing switched off in the database",
  section: "R2 · Band H — the switched-off states, DRIVEN — P67301–P67380",
});
await closeBrowser();
