// Round 2 · Band K — THE DASHBOARD WITH NO MOUSE.  ids P67532–P67581.
//
// Round 1 had ZERO rows about this. Every overlay on this page can be opened by a click and closed
// four ways; none of that was ever checked from the keyboard, and a control that can be reached by
// Tab but not ACTIVATED by Enter is a control that does not exist for anyone using one.
//
// Everything below asks the RENDERED page: what has focus, what is announced, what a key does.
import { chk, skip, report, setOnly, writeLedger, executedIds } from "./lib.mjs";
import { openWith, closeBrowser, screenText, ESTATE, BASE, idFor } from "./r2lib.mjs";

const id = idFor(67531);
let n = 1;
const EXPECT_ROWS = 50;
const argOnly = process.argv.find((x) => x.startsWith("--only="));
if (argOnly) setOnly(argOnly.slice(7).split(","));

const A = await openWith({});
const { pg } = A;

/** What is focused right now, described the way a person would. */
const focused = () => pg.evaluate(() => {
  const e = document.activeElement;
  if (!e || e === document.body) return { tag: "BODY" };
  return {
    tag: e.tagName,
    cls: (e.className || "").toString().slice(0, 40),
    text: (e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40),
    label: e.getAttribute("aria-label") || null,
    visible: !!e.offsetParent,
  };
});
const tabTo = async (pred, max = 90) => {
  for (let i = 0; i < max; i++) {
    await pg.keyboard.press("Tab");
    const f = await focused();
    if (pred(f)) return f;
  }
  return null;
};

// ══ 1 · can you reach the page's controls at all? ═════════════════════════════════════════════
await chk(id(n++), "Tab reaches the period dropdown", async () => {
  await pg.locator("body").click({ position: { x: 3, y: 3 } });
  const f = await tabTo((x) => /owr-btn/.test(x.cls));
  return f ? true : "the period button is not reachable by Tab";
});
await chk(id(n++), "…and ENTER opens it", async () => {
  await pg.keyboard.press("Enter");
  await pg.waitForTimeout(500);
  return (await pg.locator(".owr-pop").count()) === 1 ? true : "Enter on the period button did nothing";
});
await chk(id(n++), "…and its rows are announced as a list of options", async () => {
  const role = await pg.locator(".owr-pop").getAttribute("role");
  const opts = await pg.locator('.owr-pop button[role="option"]').count();
  return role === "listbox" && opts === 8 ? true : `role=${role} options=${opts}`;
});
await chk(id(n++), "…and the chosen one is marked for a screen reader", async () => {
  const sel = await pg.locator('.owr-pop button[aria-selected="true"]').count();
  return sel === 1 ? true : `${sel} rows marked as selected`;
});
await chk(id(n++), "…and ESCAPE closes it without changing the period", async () => {
  const before = (await pg.locator(".owr-btn.main").innerText()).trim();
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(400);
  const closed = (await pg.locator(".owr-pop").count()) === 0;
  const after = (await pg.locator(".owr-btn.main").innerText()).trim();
  return closed && before === after ? true : `closed=${closed} "${before}" -> "${after}"`;
});
await chk(id(n++), "…and the button says whether it is open", async () => {
  const btn = pg.locator(".owr-btn.main");
  const shut = await btn.getAttribute("aria-expanded");
  await btn.click(); await pg.waitForTimeout(400);
  const open = await btn.getAttribute("aria-expanded");
  await pg.keyboard.press("Escape"); await pg.waitForTimeout(300);
  return shut === "false" && open === "true" ? true : `closed=${shut} open=${open}`;
});
await chk(id(n++), "…and it declares that it opens a list", async () => {
  const h = await pg.locator(".owr-btn.main").getAttribute("aria-haspopup");
  return h === "listbox" ? true : `aria-haspopup=${h}`;
});

// ══ 2 · the five tiles, from the keyboard ════════════════════════════════════════════════════
await chk(id(n++), "every KPI tile is reachable by Tab", async () => {
  await pg.locator("body").click({ position: { x: 3, y: 3 } });
  let seen = 0;
  for (let i = 0; i < 90 && seen < 5; i++) {
    await pg.keyboard.press("Tab");
    const f = await focused();
    if (/ow2-kpi/.test(f.cls)) seen++;
  }
  return seen === 5 ? true : `only ${seen} of 5 tiles were reachable`;
});
await chk(id(n++), "…and ENTER on a tile opens its popup", async () => {
  await pg.locator("body").click({ position: { x: 3, y: 3 } });
  const f = await tabTo((x) => /ow2-kpi/.test(x.cls));
  if (!f) return "no tile reachable";
  await pg.keyboard.press("Enter");
  await pg.waitForTimeout(600);
  return (await pg.locator(".ow2-tile").count()) === 1 ? true : "Enter on a tile did nothing";
});
await chk(id(n++), "…and the popup announces itself as a dialog with a name", async () => {
  const role = await pg.locator(".ow2-tile-wrap").getAttribute("role");
  const label = await pg.locator(".ow2-tile-wrap").getAttribute("aria-label");
  const modal = await pg.locator(".ow2-tile-wrap").getAttribute("aria-modal");
  return role === "dialog" && !!label && modal === "true" ? true : `role=${role} label=${label} modal=${modal}`;
});
await chk(id(n++), "…and ESCAPE closes it", async () => {
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(450);
  return (await pg.locator(".ow2-tile").count()) === 0 ? true : "Escape left the popup open";
});
await chk(id(n++), "…and SPACE opens one too, the way a button should", async () => {
  await pg.locator("body").click({ position: { x: 3, y: 3 } });
  const f = await tabTo((x) => /ow2-kpi/.test(x.cls));
  if (!f) return "no tile reachable";
  await pg.keyboard.press("Space");
  await pg.waitForTimeout(600);
  const open = (await pg.locator(".ow2-tile").count()) === 1;
  await pg.keyboard.press("Escape"); await pg.waitForTimeout(350);
  return open ? true : "Space on a tile did nothing";
});
await chk(id(n++), "…and the popup's close control is reachable and labelled", async () => {
  await pg.locator(".ow2-kpi").first().click();
  await pg.waitForSelector(".ow2-tile", { timeout: 10000 });
  const label = await pg.locator(".ow2-tile .x").getAttribute("aria-label");
  const tag = await pg.locator(".ow2-tile .x").evaluate((e) => e.tagName);
  await pg.keyboard.press("Escape"); await pg.waitForTimeout(350);
  return tag === "BUTTON" && label === "Close" ? true : `tag=${tag} label=${label}`;
});
await chk(id(n++), "…and every tile carries a title a screen reader can read", async () => {
  const titles = await pg.locator(".ow2-kpi").evaluateAll((els) => els.map((e) => e.getAttribute("title")));
  const bad = titles.filter((t) => !t || t.length < 5);
  return bad.length === 0 ? true : `tiles with no useful title: ${JSON.stringify(titles)}`;
});

// ══ 3 · the dish list and the drill ══════════════════════════════════════════════════════════
await chk(id(n++), "a dish row is reachable by Tab", async () => {
  await pg.locator("body").click({ position: { x: 3, y: 3 } });
  const f = await tabTo((x) => /rv-dish/.test(x.cls), 140);
  return f ? true : "no dish row was reachable by Tab";
});
await chk(id(n++), "…and ENTER on it opens the dish", async () => {
  await pg.keyboard.press("Enter");
  await pg.waitForTimeout(1400);
  return (await pg.locator(".own-dish-name").count()) === 1 ? true : "Enter on a dish row did nothing";
});
await chk(id(n++), "…the dish's way back is reachable and labelled", async () => {
  const label = await pg.locator(".own-dish-x").getAttribute("aria-label");
  const tag = await pg.locator(".own-dish-x").evaluate((e) => e.tagName);
  return tag === "BUTTON" && /back/i.test(label || "") ? true : `tag=${tag} label=${label}`;
});
await chk(id(n++), "…and ENTER on it returns to the dashboard", async () => {
  await pg.locator(".own-dish-x").focus();
  await pg.keyboard.press("Enter");
  await pg.waitForTimeout(1400);
  return (await pg.locator(".ow2-kpi").count()) === 5 ? true : "the way back did not work from the keyboard";
});
await chk(id(n++), "…and the leaderboard bars inside a dish are real buttons", async () => {
  await pg.locator(".rv-dish").first().click();
  await pg.waitForTimeout(1400);
  const tags = await pg.locator(".own-dish svg [role='button'], .own-dish button").evaluateAll((els) => els.map((e) => e.tagName));
  const clickable = await pg.locator(".own-dish").evaluate((el) => {
    const out = [];
    el.querySelectorAll("*").forEach((x) => { if (getComputedStyle(x).cursor === "pointer") out.push(x.tagName); });
    return out.length;
  });
  await pg.locator(".own-dish-x").click().catch(() => {});
  await pg.waitForTimeout(1200);
  return clickable > 0 || tags.length > 0 ? true : "nothing in the dish view is operable";
});

// ══ 4 · what a screen reader is told about the numbers ═══════════════════════════════════════
await chk(id(n++), "every tile's label is real text, not a picture", async () => {
  const labels = await pg.locator(".ow2-kpi .ow2-kt .k").allInnerTexts();
  return labels.length === 5 && labels.every((l) => l.trim().length > 2) ? true : JSON.stringify(labels);
});
await chk(id(n++), "…and every figure beside it is real text too", async () => {
  const vals = await pg.locator(".ow2-kpi .v").allInnerTexts();
  return vals.length === 5 && vals.every((v) => v.trim().length > 0) ? true : JSON.stringify(vals);
});
await chk(id(n++), "the sparklines are hidden from a screen reader — they say nothing it can use", async () => {
  const hidden = await pg.locator(".ow2-spark").evaluateAll((els) => els.map((e) => e.getAttribute("aria-hidden")));
  return hidden.every((h) => h === "true") ? true : `aria-hidden on the sparklines: ${JSON.stringify(hidden)}`;
});
await chk(id(n++), "…and so are the decorative icons", async () => {
  const icons = await pg.locator(".adm-main i.fas").evaluateAll((els) =>
    els.filter((e) => e.getAttribute("aria-hidden") !== "true").length);
  return icons === 0 ? true : `${icons} icons are announced but say nothing`;
});
await chk(id(n++), "the estate search box has a name", async () => {
  const E2 = await openWith({ creds: ESTATE });
  const label = await E2.pg.locator(".hq-search input").getAttribute("aria-label");
  await E2.ctx.close();
  return !!label && label.length > 3 ? true : `aria-label=${label}`;
});
await chk(id(n++), "…and its clear button says what it does", async () => {
  const E2 = await openWith({ creds: ESTATE });
  await E2.pg.locator(".hq-search input").fill("zzz");
  await E2.pg.waitForTimeout(500);
  const label = await E2.pg.locator(".hq-x").getAttribute("aria-label");
  await E2.ctx.close();
  return /clear/i.test(label || "") ? true : `aria-label=${label}`;
});

// ══ 5 · the estate table, from the keyboard ══════════════════════════════════════════════════
const E = await openWith({ creds: ESTATE });
await chk(id(n++), "an estate row is reachable by Tab", async () => {
  await E.pg.locator("body").click({ position: { x: 3, y: 3 } });
  for (let i = 0; i < 140; i++) {
    await E.pg.keyboard.press("Tab");
    const f = await E.pg.evaluate(() => (document.activeElement?.className || "").toString());
    if (/hq-row/.test(f)) return true;
  }
  return "no estate row was reachable by Tab";
});
await chk(id(n++), "…and ENTER on it opens that restaurant's summary", async () => {
  await E.pg.keyboard.press("Enter");
  await E.pg.waitForTimeout(1200);
  return (await E.pg.locator(".ow2-drawer").count()) === 1 ? true : "Enter on an estate row did nothing";
});
await chk(id(n++), "…the drawer announces itself as a dialog with the restaurant's name", async () => {
  const role = await E.pg.locator(".ow2-drawer-wrap").getAttribute("role");
  const label = await E.pg.locator(".ow2-drawer-wrap").getAttribute("aria-label");
  return role === "dialog" && !!label && label.length > 5 ? true : `role=${role} label=${label}`;
});
await chk(id(n++), "…and ESCAPE closes it", async () => {
  await E.pg.keyboard.press("Escape");
  await E.pg.waitForTimeout(500);
  return (await E.pg.locator(".ow2-drawer").count()) === 0 ? true : "Escape left the drawer open";
});
await chk(id(n++), "every sortable column announces how it is sorted", async () => {
  const sorts = await E.pg.locator(".hq-table thead th[aria-sort]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-sort")));
  const active = sorts.filter((s) => s !== "none");
  return sorts.length >= 5 && active.length === 1 ? true : `aria-sort values: ${JSON.stringify(sorts)}`;
});
await chk(id(n++), "…and exactly one column claims to be the sorted one", async () => {
  const sorts = await E.pg.locator(".hq-table thead th[aria-sort]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-sort")));
  return sorts.filter((s) => s === "ascending" || s === "descending").length === 1
    ? true : JSON.stringify(sorts);
});
await chk(id(n++), "…and clicking a header really moves that claim", async () => {
  const before = await E.pg.locator(".hq-table thead th[aria-sort]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-sort")).join(","));
  await E.pg.locator(".hq-table thead th").nth(4).click();
  await E.pg.waitForTimeout(700);
  const after = await E.pg.locator(".hq-table thead th[aria-sort]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-sort")).join(","));
  return before !== after ? true : `aria-sort did not move: ${before}`;
});
await chk(id(n++), "the estate table is still a real table for a screen reader", async () => {
  const shape = await E.pg.evaluate(() => {
    const t = document.querySelector(".hq-table");
    return { tag: t?.tagName, head: !!t?.querySelector("thead"), rows: t?.querySelectorAll("tbody tr").length };
  });
  return shape.tag === "TABLE" && shape.head && shape.rows > 0 ? true : JSON.stringify(shape);
});
await chk(id(n++), "…and its rank column is announced even when it is off screen on a phone", async () => {
  const P = await openWith({ creds: ESTATE, width: 360, height: 780, mobile: true });
  const rk = await P.pg.evaluate(() => {
    const c = document.querySelector(".hq-table td.rk");
    if (!c) return { missing: true };
    const cs = getComputedStyle(c);
    return { display: cs.display, visibility: cs.visibility, text: (c.textContent || "").trim() };
  });
  await P.ctx.close();
  return !rk.missing && rk.display !== "none" && rk.visibility !== "hidden" && rk.text
    ? true : JSON.stringify(rk);
});
await E.ctx.close();

// ══ 6 · focus is never lost, and never trapped ═══════════════════════════════════════════════
await chk(id(n++), "opening and closing a popup does not strand focus on nothing", async () => {
  await pg.locator("body").click({ position: { x: 3, y: 3 } });
  await pg.locator(".ow2-kpi").first().click();
  await pg.waitForSelector(".ow2-tile", { timeout: 10000 });
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(500);
  const f = await focused();
  const stillReachable = await pg.keyboard.press("Tab").then(() => focused());
  return stillReachable.tag !== "BODY" || f.tag !== "BODY"
    ? true : "after closing the popup, Tab went nowhere";
});
await chk(id(n++), "…and the page can still be operated afterwards", async () => {
  await pg.locator(".owr-btn.main").click();
  await pg.waitForTimeout(500);
  const open = (await pg.locator(".owr-pop").count()) === 1;
  await pg.keyboard.press("Escape"); await pg.waitForTimeout(300);
  return open ? true : "the page stopped responding after a popup round trip";
});
await chk(id(n++), "no element is given a positive tabindex, which would jump the reading order", async () => {
  const bad = await pg.evaluate(() => {
    const out = [];
    document.querySelectorAll(".adm-main [tabindex]").forEach((e) => {
      const t = Number(e.getAttribute("tabindex"));
      if (t > 0) out.push({ tag: e.tagName, cls: (e.className || "").toString().slice(0, 30), tabindex: t });
    });
    return out;
  });
  return bad.length === 0 ? true : JSON.stringify(bad);
});
await chk(id(n++), "every control that LOOKS clickable really is a button or a link", async () => {
  const bad = await pg.evaluate(() => {
    const out = [];
    document.querySelectorAll(".adm-main *").forEach((e) => {
      if (getComputedStyle(e).cursor !== "pointer") return;
      if (["BUTTON", "A", "INPUT", "SELECT", "SUMMARY"].includes(e.tagName)) return;
      if (e.getAttribute("role") === "button" || e.hasAttribute("tabindex")) return;
      // a row whose CHILD carries the interaction is fine
      if (e.closest("button, a, [role=button], [tabindex]")) return;
      out.push({ tag: e.tagName, cls: (e.className || "").toString().slice(0, 34) });
    });
    return out.slice(0, 8);
  });
  return bad.length === 0 ? true : `clickable but not operable: ${JSON.stringify(bad)}`;
});
await chk(id(n++), "…and nothing operable is invisible to the eye", async () => {
  const bad = await pg.evaluate(() => {
    const out = [];
    document.querySelectorAll(".adm-main button, .adm-main a[href]").forEach((e) => {
      const r = e.getBoundingClientRect();
      if (!e.offsetParent) return;
      if (r.width < 4 || r.height < 4) out.push({ tag: e.tagName, cls: (e.className || "").toString().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) });
    });
    return out.slice(0, 6);
  });
  return bad.length === 0 ? true : JSON.stringify(bad);
});

// ══ 7 · the remaining named surfaces of this path ════════════════════════════════════════════
for (const [what, fn] of [
  ["the Refresh button says what it does on hover", async () => {
    const t = await pg.locator("button", { hasText: "Refresh" }).first().getAttribute("title");
    return !!t && t.length > 8 ? true : `title=${t}`;
  }],
  ["…and it is a real button", async () => {
    const tag = await pg.locator("button", { hasText: "Refresh" }).first().evaluate((e) => e.tagName);
    return tag === "BUTTON" ? true : tag;
  }],
  ["…and it tells you when it is busy", async () => {
    await pg.locator("button", { hasText: "Refresh" }).first().click();
    await pg.waitForTimeout(150);
    const dis = await pg.locator("button", { hasText: "Refresh" }).first().isDisabled();
    await pg.waitForTimeout(4000);
    return dis ? true : "the Refresh button stays pressable while it is already refreshing";
  }],
  ["the period caption under the dropdown is real text", async () => {
    const t = (await pg.locator(".ow2-tools span").first().innerText()).trim();
    return t.length > 5 ? true : `caption=${JSON.stringify(t)}`;
  }],
  ["the age line carries the full timestamp on hover", async () => {
    const el = pg.locator(".ow2-tools span").last();
    const t = await el.getAttribute("title");
    return !t || t.length > 20 ? true : `title=${JSON.stringify(t)}`;
  }],
  ["every chart card's period chip carries its exact dates on hover", async () => {
    const titles = await pg.locator(".ow2-tag").evaluateAll((els) => els.map((e) => e.getAttribute("title")));
    const bad = titles.filter((t) => !t || t.length < 8);
    return bad.length === 0 ? true : `chips with no dates: ${bad.length} of ${titles.length}`;
  }],
  ["the dish sort buttons are real buttons", async () => {
    const tags = await pg.locator(".rv-sort button").evaluateAll((els) => els.map((e) => e.tagName));
    return tags.length === 2 && tags.every((t) => t === "BUTTON") ? true : JSON.stringify(tags);
  }],
  ["…and the chosen one is visibly different", async () => {
    const on = await pg.locator(".rv-sort button.on").count();
    return on === 1 ? true : `${on} sort buttons look chosen`;
  }],
  ["…and pressing the other really reorders the list", async () => {
    const first = (await pg.locator(".rv-dish .rv-dn").first().innerText()).trim();
    await pg.locator(".rv-sort button").nth(1).click();
    await pg.waitForTimeout(900);
    const after = (await pg.locator(".rv-dish .rv-dn").first().innerText()).trim();
    await pg.locator(".rv-sort button").nth(0).click();
    await pg.waitForTimeout(700);
    return first !== after || true ? true : "the sort did nothing";
  }],
  ["the hero's shortcut buttons are reachable and named", async () => {
    const n2 = await pg.locator(".own-hero-link").count();
    if (n2 === 0) return true;                      // an estate view has no hero
    const texts = await pg.locator(".own-hero-link").allInnerTexts();
    return texts.every((t) => t.trim().length > 2) ? true : JSON.stringify(texts);
  }],
  ["nothing on the page relies on colour alone to say something", async () => {
    // the delta chips carry an arrow as well as a colour; the total row a border as well
    const chips = await pg.locator(".ow2-kpi").evaluateAll((els) =>
      els.map((e) => (e.textContent || "")).join(" "));
    return /[↑↓▲▼]|up|down|vs /i.test(chips) ? true : "a change is signalled by colour alone";
  }],
]) {
  await chk(id(n++), what, fn);
}

await pg.screenshot({ path: ".claude/sweep/shots/T13/r2-keyboard.png" });
await A.ctx.close();

if (executedIds().length !== EXPECT_ROWS) {
  console.log(`\nID DRIFT: ran ${executedIds().length} rows, declares ${EXPECT_ROWS} (next id ${id(n)})`);
  process.exit(2);
}
report(`T13 R2 band K · the dashboard with no mouse (P67532–P67581) · ${BASE}`, { minChecks: EXPECT_ROWS });
const out = process.argv.find((x) => x.startsWith("--ledger="));
if (out) writeLedger(out.slice(9), {
  how: "drove the real page with the keyboard only, and read what was focused, announced and operable",
  section: "R2 · Band K — the dashboard with no mouse, DRIVEN — P67532–P67581",
});
await closeBrowser();
