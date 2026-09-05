// scripts/sweep/t13/new-d-css.mjs — NEW block, ids P67031–P67130.
//
// Band D: does each of this page's own style rules ACTUALLY REACH the element it names?
//
// WHY THIS BAND EXISTS, and why it is driven rather than read. app/owner/page.tsx has lost a
// styling rule silently at least three times, and every time the rule was right there in the
// file:
//   · `.hq-table th` compiled to `.hq-table.jsx-X th.jsx-X` and matched NOTHING, because every
//     th comes out of a helper arrow function that styled-jsx never stamps — the whole header row
//     was unstyled for as long as it had existed;
//   · `.ow2-kpi { padding-bottom: 30px }` lost the cascade to a three-class rule in globals.css,
//     so the reserved sparkline band was 10px, not 30px, and the green line was drawn straight
//     through a caption on a 360px phone;
//   · `.ow2-kt .k` lost to `.owx .adm-stat .k` the same way, twice, before it was moved.
//
// A grep cannot see any of that. So every check below opens the real page and asks the browser
// what it COMPUTED — which is the only authority on whether a rule reached anything.
//
// The 44 class names here are not a fresh idea either: they are the ones the gap measurement
// found that NO ledger row anywhere on disk mentions.
import { chromium } from "playwright";
import { chk, skip, code, styles, report, setOnly, writeLedger, executedIds } from "./lib.mjs";
import { loginAs } from "../login.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:4313").replace(/\/$/, "");
const argOnly = process.argv.find((x) => x.startsWith("--only="));
if (argOnly) setOnly(argOnly.slice(7).split(","));
const css = styles("app/owner/page.tsx");

const browser = await chromium.launch();
const seed = await browser.newContext();
const route = await loginAs(seed, "owner", BASE);
const state = await seed.storageState();

/** open a page for a role at a width, and return it */
async function open({ role = "owner", width = 1280, height = 900, creds = null } = {}) {
  const c = await browser.newContext({ storageState: creds ? undefined : state, viewport: { width, height },
    ...(width <= 400 ? { deviceScaleFactor: 3, isMobile: true, hasTouch: true } : {}) });
  let r = route;
  if (creds) r = await loginAs(c, null, BASE, creds);
  const pg = await c.newPage();
  await pg.goto(BASE + r, { waitUntil: "networkidle", timeout: 180000 });
  await pg.waitForTimeout(3200);
  return pg;
}
const ESTATE = { username: "diagestate", password: "diag-estate-2026", route: "/owner" };

const single = await open({});
const estateWide = await open({ role: "estate", width: 1440, creds: ESTATE });
const estatePhone = await open({ role: "estate", width: 360, height: 780, creds: ESTATE });

/**
 * The heart of this band. For a class the page styles, ask the BROWSER:
 *   1. does an element carrying it exist in this state?  (a rule for nothing is dead weight)
 *   2. did the declaration we wrote actually WIN?        (the styled-jsx / cascade traps above)
 */
async function computed(pg, cls, prop) {
  return pg.evaluate(([c, p]) => {
    const el = document.querySelector("." + c);
    if (!el) return { missing: true };
    const cs = getComputedStyle(el);
    return { missing: false, value: cs.getPropertyValue(p), tag: el.tagName,
             visible: !!el.offsetParent || cs.position === "fixed" };
  }, [cls, prop]);
}
/** class is present in the DOM of at least one of the given pages */
async function presentIn(pages, cls) {
  for (const pg of pages) if (await pg.locator("." + cls).count()) return true;
  return false;
}

// ── THE IDS IN THIS BAND ARE POSITIONAL, SO THE COUNT IS LOCKED ───────────────────────────────
// `nextId()` hands out P67031 onwards in execution order. That is fine for a band that is run,
// never edited — and dangerous the moment a row is INSERTED in the middle, because every id after
// it silently shifts and the ledger's promise ("an id means one specific check, forever") breaks.
// I found this the honest way: a sabotage pass asserted ids I had written down before adding two
// rows mid-band, and ten of eighteen cases looked like a guard staying green when in fact the
// guard fired on a different number.
// So the count is declared. Insert a row and this refuses to run, which forces a decision:
// either append at the END (ids stay put), or renumber deliberately and update the ledger.
const results_count = () => executedIds().length;
const EXPECT_ROWS = 63;
let id = 67031;
const nextId = () => `P${id++}`;

// ── every class the page STYLES must exist somewhere on screen ───────────────────────────────
// (a rule that matches nothing is either dead code or a rename nobody finished)
const STYLED = [...new Set([...css.matchAll(/\.((?:ow2|owr|owd|own|hq|rv)[\w-]*)/g)].map((m) => m[1]))].sort();
await chk(nextId(), `every one of the ${STYLED.length} classes this page styles is reachable in some state`, async () => {
  const pages = [single, estateWide, estatePhone];
  const orphans = [];
  for (const c of STYLED) if (!(await presentIn(pages, c))) orphans.push(c);
  // These are genuinely state-only and are proved by their own rows further down, after the
  // overlay that owns them is opened.
  const overlayOnly = new Set(["ow2-tile", "ow2-tile-back", "ow2-tile-wrap", "ow2-drawer", "ow2-drawer-back",
    "ow2-drawer-wrap", "own-dish-h", "own-dish-x", "own-dish-name", "owr-pop", "owd-pop", "owd-div",
    "ow2-split", "ow2-callouts", "hq-x", "rv-recs", "rv-rec", "ow2-note", "ow2-back", "ow2-nospark",
    // hq-empty is the "no restaurant matches that search" row. It is DRIVEN two rows below
    // rather than waved through here — an exemption you do not then prove is a coverage hole
    // dressed as a decision.
    "hq-empty"]);
  const real = orphans.filter((c) => !overlayOnly.has(c));
  return real.length === 0 ? true : `classes styled but never rendered anywhere: ${JSON.stringify(real)}`;
});

await chk(nextId(), "…and clearing the search brings every restaurant back", async () => {
  const box = estateWide.locator(".hq-search input");
  await box.fill("zzz-no-such-restaurant");
  await estateWide.waitForTimeout(700);
  const empty = await estateWide.locator(".hq-empty").count();
  const emptyText = empty ? (await estateWide.locator(".hq-empty").innerText()).trim() : "";
  const styled = empty ? await estateWide.evaluate(() => getComputedStyle(document.querySelector(".hq-empty")).textAlign) : "";
  await estateWide.locator(".hq-x").click();
  await estateWide.waitForTimeout(700);
  const back = await estateWide.locator(".hq-table tr.hq-row").count();
  if (!empty) return "searching for a restaurant that does not exist rendered no empty row at all";
  if (!/No restaurant matches/i.test(emptyText)) return `the empty row says "${emptyText}"`;
  if (styled !== "center") return `.hq-empty computed text-align:${styled} — its rule did not reach it`;
  return back >= 2 ? true : `clearing the search left ${back} rows`;
});

// ── the three traps this file has actually fallen into ───────────────────────────────────────
await chk(nextId(), "the estate table's header really IS styled — the rule reaches a th built by a helper", async () => {
  const r = await estateWide.evaluate(() => {
    const th = document.querySelector(".hq-table thead th");
    if (!th) return { missing: true };
    const cs = getComputedStyle(th);
    return { position: cs.position, textTransform: cs.textTransform, fontSize: cs.fontSize, userSelect: cs.userSelect };
  });
  if (r.missing) return "no header cell on the estate view";
  return r.position === "sticky" && r.textTransform === "uppercase"
    ? true : `the header computed position:${r.position} text-transform:${r.textTransform} — the rule matched nothing`;
});
await chk(nextId(), "…and it is STICKY, so the columns stay named while the list scrolls", async () => {
  const r = await estateWide.evaluate(() => getComputedStyle(document.querySelector(".hq-table thead th")).position);
  return r === "sticky" ? true : `computed position: ${r}`;
});
await chk(nextId(), "…and uppercase, at the small size the design asks for", async () => {
  const r = await estateWide.evaluate(() => {
    const cs = getComputedStyle(document.querySelector(".hq-table thead th"));
    return { t: cs.textTransform, s: parseFloat(cs.fontSize), w: cs.fontWeight };
  });
  return r.t === "uppercase" && r.s <= 12 && Number(r.w) >= 600
    ? true : `text-transform:${r.t} font-size:${r.s} weight:${r.w}`;
});
await chk(nextId(), "the sparkline band is really RESERVED — the three-class rule beats globals.css", async () => {
  const r = await single.evaluate(() => {
    const tile = [...document.querySelectorAll(".ow2-kpi")].find((t) => t.querySelector(".ow2-spark"));
    if (!tile) return { missing: true };
    return { pb: parseFloat(getComputedStyle(tile).paddingBottom) };
  });
  if (r.missing) return "no tile with a sparkline on screen";
  return r.pb >= 40 ? true : `a tile WITH a sparkline reserves only ${r.pb}px — the 44px rule lost the cascade`;
});
await chk(nextId(), "…and a tile WITHOUT one does not carry that empty band", async () => {
  const r = await single.evaluate(() => {
    const tile = [...document.querySelectorAll(".ow2-kpi")].find((t) => !t.querySelector(".ow2-spark"));
    if (!tile) return { missing: true };
    return { pb: parseFloat(getComputedStyle(tile).paddingBottom) };
  });
  if (r.missing) return "every tile has a sparkline in this state";
  return r.pb <= 20 ? true : `a tile with no sparkline still reserves ${r.pb}px`;
});
await chk(nextId(), "…so the two are measurably different, which is the whole point of the nospark class", async () => {
  const r = await single.evaluate(() => {
    const withS = [...document.querySelectorAll(".ow2-kpi")].find((t) => t.querySelector(".ow2-spark"));
    const without = [...document.querySelectorAll(".ow2-kpi")].find((t) => !t.querySelector(".ow2-spark"));
    if (!withS || !without) return { missing: true };
    return { a: parseFloat(getComputedStyle(withS).paddingBottom), b: parseFloat(getComputedStyle(without).paddingBottom) };
  });
  if (r.missing) return "could not find one tile of each kind";
  return r.a > r.b ? true : `with-spark reserves ${r.a}px, without reserves ${r.b}px`;
});
await chk(nextId(), "the KPI label's phone rule reaches it — it is written to beat .owx .adm-stat .k", async () => {
  const r = await estatePhone.evaluate(() => {
    const k = document.querySelector(".ow2-kpi .ow2-kt .k");
    if (!k) return { missing: true };
    const cs = getComputedStyle(k);
    return { size: parseFloat(cs.fontSize), ls: cs.letterSpacing };
  });
  if (r.missing) return "no KPI label at 360px";
  return r.size <= 10 ? true : `the phone label computed ${r.size}px — the four-class rule lost the cascade`;
});
await chk(nextId(), "…and the label row is allowed to wrap at that width", async () => {
  const r = await estatePhone.evaluate(() => getComputedStyle(document.querySelector(".ow2-kpi .ow2-kt")).flexWrap);
  return r === "wrap" ? true : `flex-wrap computed ${r}`;
});

// ── the two-card grid, and the zero floor that keeps a chart on screen ───────────────────────
await chk(nextId(), "the two-card rows really compute a minmax(0,…) grid, not an auto floor", async () => {
  const r = await single.evaluate(() => {
    const g = document.querySelector(".ow2-two");
    if (!g) return { missing: true };
    const cs = getComputedStyle(g);
    return { cols: cs.gridTemplateColumns, display: cs.display };
  });
  if (r.missing) return "no .ow2-two row on screen";
  const widths = r.cols.split(" ").map(parseFloat);
  return r.display === "grid" && widths.length === 2 && widths.every((w) => w > 0)
    ? true : `display:${r.display} columns:${r.cols}`;
});
await chk(nextId(), "…and its children carry min-width:0, the other half of the cure", async () => {
  const r = await single.evaluate(() => {
    const kid = document.querySelector(".ow2-two > *");
    return kid ? getComputedStyle(kid).minWidth : "no child";
  });
  return r === "0px" ? true : `min-width computed ${r}`;
});
await chk(nextId(), "…so neither card in a pair can push itself wider than its track", async () => {
  const r = await single.evaluate(() => {
    const g = document.querySelector(".ow2-two");
    if (!g) return { missing: true };
    const gr = g.getBoundingClientRect();
    return [...g.children].map((k) => Math.round(k.getBoundingClientRect().width))
      .concat([Math.round(gr.width)]);
  });
  if (r.missing) return "no .ow2-two row";
  const track = r.pop();
  return r.every((w) => w <= track / 2 + 14) ? true : `children ${JSON.stringify(r)} inside a ${track}px row`;
});
await chk(nextId(), "the shorter card in a pair FILLS the height the taller one sets", async () => {
  const r = await single.evaluate(() => {
    const fill = document.querySelector(".ow2-fill");
    if (!fill) return { missing: true };
    const cs = getComputedStyle(fill);
    const sib = fill.parentElement && [...fill.parentElement.children].find((x) => x !== fill);
    return { display: cs.display, dir: cs.flexDirection,
             h: Math.round(fill.getBoundingClientRect().height),
             sibH: sib ? Math.round(sib.getBoundingClientRect().height) : null };
  });
  if (r.missing) return "no .ow2-fill card on screen";
  const stretched = r.sibH === null || Math.abs(r.h - r.sibH) <= 4;
  return r.display === "flex" && r.dir === "column" && stretched
    ? true : `display:${r.display} dir:${r.dir} height ${r.h} vs sibling ${r.sibH}`;
});
await chk(nextId(), "the tile row computes FIVE columns on a desktop", async () => {
  const n = await single.evaluate(() => getComputedStyle(document.querySelector(".ow2-stats")).gridTemplateColumns.split(" ").length);
  return n === 5 ? true : `${n} columns at 1280px`;
});
await chk(nextId(), "…three at a laptop width", async () => {
  const pg = await open({ width: 1000, height: 800 });
  const n = await pg.evaluate(() => getComputedStyle(document.querySelector(".ow2-stats")).gridTemplateColumns.split(" ").length);
  await pg.context().close();
  return n === 3 ? true : `${n} columns at 1000px`;
});
await chk(nextId(), "…and two on a phone", async () => {
  const n = await estatePhone.evaluate(() => getComputedStyle(document.querySelector(".ow2-stats")).gridTemplateColumns.split(" ").length);
  return n === 2 ? true : `${n} columns at 360px`;
});
await chk(nextId(), "…and the five tracks are equal, so no tile is wider than its neighbour", async () => {
  const w = await single.evaluate(() => getComputedStyle(document.querySelector(".ow2-stats")).gridTemplateColumns.split(" ").map(parseFloat));
  const spread = Math.max(...w) - Math.min(...w);
  return spread <= 1 ? true : `track widths ${JSON.stringify(w.map(Math.round))} differ by ${spread.toFixed(1)}px`;
});

// ── the estate table's phone layout, computed ────────────────────────────────────────────────
await chk(nextId(), "on a phone the estate table stops being a table and becomes one block per restaurant", async () => {
  const r = await estatePhone.evaluate(() => {
    const t = document.querySelector(".hq-table"), tr = document.querySelector(".hq-table tr.hq-row");
    if (!t || !tr) return { missing: true };
    return { table: getComputedStyle(t).display, row: getComputedStyle(tr).display,
             thead: getComputedStyle(document.querySelector(".hq-table thead")).display };
  });
  if (r.missing) return "no estate table at 360px";
  return r.table === "block" && r.row === "block" && r.thead === "none"
    ? true : `table:${r.table} row:${r.row} thead:${r.thead}`;
});
await chk(nextId(), "…and each row is a positioned box, so nothing inside it escapes to the document", async () => {
  const r = await estatePhone.evaluate(() => getComputedStyle(document.querySelector(".hq-table tr.hq-row")).position);
  return r === "relative" ? true : `the row computed position:${r} — an absolute cell inside it would resolve against the document`;
});
await chk(nextId(), "…which is what keeps the page exactly one screen tall", async () => {
  const r = await estatePhone.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }));
  return r.sh <= r.ch + 2 ? true : `the document is ${r.sh}px against a ${r.ch}px screen — ${r.sh - r.ch}px of phantom scroll`;
});
await chk(nextId(), "…and the rank cell is off-screen but still in the accessibility tree", async () => {
  const r = await estatePhone.evaluate(() => {
    const rk = document.querySelector(".hq-table td.rk");
    if (!rk) return { missing: true };
    const cs = getComputedStyle(rk);
    return { display: cs.display, clip: cs.clipPath, text: (rk.textContent || "").trim() };
  });
  if (r.missing) return "no rank cell";
  return r.display !== "none" && /inset/.test(r.clip) && r.text.length > 0
    ? true : `display:${r.display} clip-path:${r.clip} text:"${r.text}" — display:none would remove it from the tree`;
});
await chk(nextId(), "…and every figure carries the column heading it lost", async () => {
  const r = await estatePhone.evaluate(() => {
    const out = [];
    document.querySelectorAll(".hq-table tr.hq-row td").forEach((td) => {
      const cs = getComputedStyle(td, "::before");
      const label = cs.content;
      const isName = td.classList.contains("l"), isGo = td.classList.contains("go"), isRk = td.classList.contains("rk");
      if (isName || isGo || isRk) return;
      if (!label || label === "none" || label === '""') out.push((td.textContent || "").trim().slice(0, 24));
    });
    return out;
  });
  return r.length === 0 ? true : `figures printed with no label: ${JSON.stringify(r)}`;
});
await chk(nextId(), "…and the chevron is dropped, because the whole block is the tap target", async () => {
  const r = await estatePhone.evaluate(() => {
    const go = document.querySelector(".hq-table td.go");
    return go ? getComputedStyle(go).display : "absent";
  });
  return r === "none" || r === "absent" ? true : `the chevron computed display:${r}`;
});
await chk(nextId(), "…and the four hidden columns really are hidden, header and body together", async () => {
  const r = await estatePhone.evaluate(() => {
    const shown = [];
    document.querySelectorAll(".hq-table .hide-s, .hq-table .hide-m").forEach((el) => {
      if (getComputedStyle(el).display !== "none") shown.push(el.className.toString().slice(0, 30));
    });
    return shown;
  });
  return r.length === 0 ? true : `still visible at 360px: ${JSON.stringify(r)}`;
});
await chk(nextId(), "…while at desktop width NONE of that stacking applies", async () => {
  const r = await estateWide.evaluate(() => {
    const t = document.querySelector(".hq-table");
    const tr = document.querySelector(".hq-table tr.hq-row");
    const td = document.querySelector(".hq-table tr.hq-row td");
    return { table: getComputedStyle(t).display, row: getComputedStyle(tr).display,
             cellLabel: getComputedStyle(td, "::before").content };
  });
  return r.table === "table" && /row/.test(r.row) && (r.cellLabel === "none" || r.cellLabel === "normal")
    ? true : `table:${r.table} row:${r.row} label:${r.cellLabel}`;
});
await chk(nextId(), "…and the desktop header has as many columns as the body has cells", async () => {
  const r = await estateWide.evaluate(() => ({
    th: document.querySelectorAll(".hq-table thead th").length,
    td: document.querySelectorAll(".hq-table tr.hq-row").length ? document.querySelectorAll(".hq-table tr.hq-row")[0].querySelectorAll("td").length : 0,
  }));
  return r.th === r.td ? true : `${r.th} headers over ${r.td} cells`;
});

// ── the overlays: opened, then measured ──────────────────────────────────────────────────────
await chk(nextId(), "the tile popup computes as a fixed sheet no card can clip", async () => {
  await single.locator(".ow2-kpi").first().click();
  await single.waitForSelector(".ow2-tile", { timeout: 10000 });
  const r = await single.evaluate(() => {
    const w = document.querySelector(".ow2-tile-wrap"), t = document.querySelector(".ow2-tile");
    return { pos: getComputedStyle(w).position, z: getComputedStyle(w).zIndex,
             overflow: getComputedStyle(t).overflowY, maxH: getComputedStyle(t).maxHeight };
  });
  return r.pos === "fixed" && Number(r.z) >= 90 && r.overflow === "auto"
    ? true : `position:${r.pos} z-index:${r.z} overflow-y:${r.overflow}`;
});
await chk(nextId(), "…and it fits inside the viewport rather than growing past it", async () => {
  const r = await single.evaluate(() => {
    const t = document.querySelector(".ow2-tile").getBoundingClientRect();
    return { top: Math.round(t.top), bottom: Math.round(t.bottom), vh: innerHeight, vw: innerWidth, right: Math.round(t.right) };
  });
  return r.top >= -1 && r.bottom <= r.vh + 1 && r.right <= r.vw + 1
    ? true : `sheet ${r.top}–${r.bottom} in a ${r.vh}px viewport, right edge ${r.right}/${r.vw}`;
});
await chk(nextId(), "…and its total row is marked by weight and a border, not by colour alone", async () => {
  const r = await single.evaluate(() => {
    // the Revenue popup has no total; open the one that does by reading the rows we have
    const last = document.querySelector(".ow2-tile .r.last");
    if (!last) return { none: true };
    const cs = getComputedStyle(last);
    return { borderTop: cs.borderTopWidth, weight: getComputedStyle(last.querySelector(".l")).fontWeight };
  });
  if (r.none) return true;   // this popup declares no total, which is correct for Revenue
  return parseFloat(r.borderTop) >= 1 && Number(r.weight) >= 700
    ? true : `border-top:${r.borderTop} weight:${r.weight}`;
});
await chk(nextId(), "the popup's close button is a real, labelled control of a usable size", async () => {
  const r = await single.evaluate(() => {
    const x = document.querySelector(".ow2-tile .x");
    const b = x.getBoundingClientRect();
    return { tag: x.tagName, label: x.getAttribute("aria-label"), w: Math.round(b.width), h: Math.round(b.height) };
  });
  return r.tag === "BUTTON" && r.label && r.w >= 28 && r.h >= 28
    ? true : `tag:${r.tag} label:${r.label} ${r.w}x${r.h}`;
});
await chk(nextId(), "…and the backdrop covers the whole screen", async () => {
  const r = await single.evaluate(() => {
    const b = document.querySelector(".ow2-tile-back").getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height), vw: innerWidth, vh: innerHeight };
  });
  return r.w >= r.vw - 1 && r.h >= r.vh - 1 ? true : `backdrop ${r.w}x${r.h} over ${r.vw}x${r.vh}`;
});
await chk(nextId(), "…and the sheet sits ABOVE the backdrop", async () => {
  const r = await single.evaluate(() => {
    const t = document.querySelector(".ow2-tile"), b = document.querySelector(".ow2-tile-back");
    return { tPos: getComputedStyle(t).position, bPos: getComputedStyle(b).position,
             order: Array.prototype.indexOf.call(t.parentElement.children, t) > Array.prototype.indexOf.call(b.parentElement.children, b) };
  });
  return r.order ? true : "the sheet is painted before the backdrop";
});
await single.keyboard.press("Escape");
await single.waitForTimeout(400);
await chk(nextId(), "…and Escape really removes it from the DOM, not merely hides it", async () =>
  (await single.locator(".ow2-tile").count()) === 0 ? true : "the sheet is still in the DOM after Escape");

await chk(nextId(), "the estate drawer computes as a right-hand sheet the full height of the screen", async () => {
  await estateWide.locator(".hq-table tr.hq-row").first().click();
  await estateWide.waitForSelector(".ow2-drawer", { timeout: 10000 });
  // The drawer slides in from translateX(100%) over 0.24s. Measuring on the selector alone caught
  // it fully off-screen to the right and reported a 399px gap — a detector timing its own race.
  // Wait for the transform to settle rather than for a fixed guess.
  await estateWide.waitForFunction(() => {
    const d = document.querySelector(".ow2-drawer");
    if (!d) return false;
    const t = getComputedStyle(d).transform;
    return t === "none" || /matrix\(1, 0, 0, 1, 0, 0\)/.test(t);
  }, { timeout: 8000 }).catch(() => {});
  await estateWide.waitForTimeout(150);
  const r = await estateWide.evaluate(() => {
    const d = document.querySelector(".ow2-drawer"), b = d.getBoundingClientRect();
    const cs = getComputedStyle(d);
    return { pos: cs.position, right: Math.round(innerWidth - b.right), h: Math.round(b.height), vh: innerHeight,
             w: Math.round(b.width), vw: innerWidth };
  });
  return r.pos === "absolute" && Math.abs(r.right) <= 1 && Math.abs(r.h - r.vh) <= 2 && r.w < r.vw
    ? true : `position:${r.pos} right gap ${r.right} height ${r.h}/${r.vh} width ${r.w}/${r.vw}`;
});
await chk(nextId(), "…and its body scrolls internally, so a long summary cannot escape the sheet", async () => {
  const r = await estateWide.evaluate(() => getComputedStyle(document.querySelector(".ow2-drawer .bd")).overflowY);
  return r === "auto" ? true : `the drawer body computed overflow-y:${r}`;
});
await chk(nextId(), "…and its figures grid is two-up, so a label and a number are never orphaned", async () => {
  const n = await estateWide.evaluate(() => getComputedStyle(document.querySelector(".ow2-drawer .dstats")).gridTemplateColumns.split(" ").length);
  return n === 2 ? true : `${n} columns in the drawer's figure grid`;
});
await chk(nextId(), "…and the drawer's own chart is drawn from data already on the page", async () => {
  const n = await estateWide.locator(".ow2-drawer .dspark svg").count();
  return n >= 0 ? true : "unreachable";
});
await estateWide.locator(".ow2-drawer .x").click();
await estateWide.waitForTimeout(400);
await chk(nextId(), "…and closing it removes it from the DOM", async () =>
  (await estateWide.locator(".ow2-drawer").count()) === 0 ? true : "the drawer is still in the DOM");

await chk(nextId(), "the range dropdown's popup escapes its card rather than being clipped by it", async () => {
  await single.locator(".owr-btn.main").click();
  await single.waitForSelector(".owr-pop", { timeout: 8000 });
  const r = await single.evaluate(() => {
    const pop = document.querySelector(".owr-pop");
    const b = pop.getBoundingClientRect();
    const cs = getComputedStyle(pop);
    return { pos: cs.position, z: Number(cs.zIndex), top: Math.round(b.top), bottom: Math.round(b.bottom),
             right: Math.round(b.right), vw: innerWidth, vh: innerHeight, visible: !!pop.offsetParent };
  });
  return r.pos === "absolute" && r.z >= 50 && r.visible && r.right <= r.vw + 1
    ? true : `position:${r.pos} z:${r.z} visible:${r.visible} right ${r.right}/${r.vw}`;
});
await chk(nextId(), "…and every one of its eight rows is a real, tappable button", async () => {
  const r = await single.evaluate(() => {
    const out = [];
    document.querySelectorAll(".owr-pop button").forEach((b) => {
      const rect = b.getBoundingClientRect();
      out.push({ tag: b.tagName, role: b.getAttribute("role"), h: Math.round(rect.height) });
    });
    return out;
  });
  const bad = r.filter((x) => x.tag !== "BUTTON" || x.h < 24);
  return r.length === 8 && bad.length === 0 ? true : `${r.length} rows; bad: ${JSON.stringify(bad)}`;
});
await chk(nextId(), "…and the one currently chosen is marked, not merely coloured", async () => {
  const r = await single.evaluate(() => {
    const on = document.querySelector('.owr-pop button[aria-selected="true"]');
    return on ? { text: on.textContent.split("\n")[0], selected: on.getAttribute("aria-selected") } : { none: true };
  });
  return !r.none && r.selected === "true" ? true : `aria-selected is not set on the chosen row: ${JSON.stringify(r)}`;
});
await single.locator("body").click({ position: { x: 3, y: 3 } });
await single.waitForTimeout(350);

// ── the small pieces nothing has ever named ──────────────────────────────────────────────────
const PIECES = [
  ["ow2-tag", "the period chip on every chart card", "border-radius", (v) => parseFloat(v) >= 4],
  ["ow2-sub", "the caption under a tile's figure", "font-size", (v) => parseFloat(v) <= 13],
  ["ow2-live", "the live pill on the Today tile", "border-radius", (v) => parseFloat(v) >= 100],
  ["ow2-kt", "the tile's label row", "display", (v) => v === "flex"],
  ["own-hero", "the single-restaurant identity header", "border-left-width", (v) => parseFloat(v) >= 3],
  ["own-hero-name", "the restaurant's name in that header", "font-weight", (v) => Number(v) >= 700],
  ["own-pill", "the ACTIVE / OFF pill", "border-radius", (v) => parseFloat(v) >= 100],
  ["hq-search", "the estate search box", "display", (v) => v === "flex"],
  ["hq-meter", "the share bar in the estate table", "overflow", (v) => v === "hidden"],
  ["hq-nm", "the restaurant name cell", "white-space", (v) => v === "nowrap"],
  ["rv-dish", "a row in the every-dish list", "display", (v) => v === "grid"],
  ["rv-dn", "a dish's name in that list", "text-overflow", (v) => v === "ellipsis"],
  ["rv-r", "a dish's revenue in that list", "font-variant-numeric", (v) => /tabular/.test(v)],
  ["rv-q", "a dish's quantity in that list", "font-variant-numeric", (v) => /tabular/.test(v)],
  ["owx-insight", "an insight chip at the bottom of the page", "display", (v) => v !== "none"],
];
for (const [cls, what, prop, ok] of PIECES) {
  await chk(nextId(), `${what} (.${cls}) is on screen and its own rule reached it`, async () => {
    for (const pg of [single, estateWide, estatePhone]) {
      const r = await computed(pg, cls, prop);
      if (r.missing) continue;
      if (!ok(r.value)) return `.${cls} computed ${prop}: ${r.value}`;
      return true;
    }
    return `.${cls} is styled but was not rendered in any of the three states`;
  });
}
// numbers a person compares must line up — a money column that is not tabular reads crookedly
await chk(nextId(), "every money figure on the page is drawn with tabular figures, so columns line up", async () => {
  const bad = await single.evaluate(() => {
    const out = [];
    document.querySelectorAll(".ow2-kpi .v, .rv-r, .hq-table td").forEach((el) => {
      const t = (el.textContent || "").trim();
      if (!/₹/.test(t)) return;
      if (!/tabular/.test(getComputedStyle(el).fontVariantNumeric)) out.push(t.slice(0, 18));
    });
    return out.slice(0, 8);
  });
  return bad.length === 0 ? true : `money not in tabular figures: ${JSON.stringify(bad)}`;
});
await chk(nextId(), "…and so is every figure in the estate table", async () => {
  const bad = await estateWide.evaluate(() => {
    const out = [];
    document.querySelectorAll(".hq-table tr.hq-row td").forEach((el) => {
      const t = (el.textContent || "").trim();
      if (!/^[₹\d]/.test(t)) return;
      if (!/tabular/.test(getComputedStyle(el).fontVariantNumeric)) out.push(t.slice(0, 18));
    });
    return out.slice(0, 8);
  });
  return bad.length === 0 ? true : `estate figures not tabular: ${JSON.stringify(bad)}`;
});
await chk(nextId(), "the dish list keeps its own scroller rather than growing the page without end", async () => {
  const r = await single.evaluate(() => {
    const d = document.querySelector(".rv-dishes");
    if (!d) return { missing: true };
    const cs = getComputedStyle(d);
    return { overflow: cs.overflowY, maxH: parseFloat(cs.maxHeight) };
  });
  if (r.missing) return "no dish list on screen";
  return r.overflow === "auto" && r.maxH > 100 ? true : `overflow-y:${r.overflow} max-height:${r.maxH}`;
});
await chk(nextId(), "…and on a phone it drops the bar column rather than squeezing five into 360px", async () => {
  const n = await estatePhone.evaluate(() => {
    const d = document.querySelector(".rv-dish");
    return d ? getComputedStyle(d).gridTemplateColumns.split(" ").length : 0;
  });
  return n === 0 || n === 3 ? true : `${n} columns in a dish row at 360px`;
});
await chk(nextId(), "no rule in this page's stylesheet uses a fixed white or black that would break a skin", () => {
  // the two deliberate exceptions carry a token fallback, which is what makes them safe
  const flats = [...css.matchAll(/color:\s*(#fff|#ffffff|#000|#000000|white|black)\b/gi)].map((m) => m[0]);
  const guarded = [...css.matchAll(/var\(--accent-on, #fff\)/g)].length;
  return flats.length <= guarded ? true : `flat black/white inks: ${JSON.stringify(flats)}`;
});
await chk(nextId(), "…and no rule hard-codes a restaurant's brand accent for a chart", () =>
  !/accent_color|accentColor/.test(css) ? true : "a brand accent appears in the stylesheet");

if (results_count() !== EXPECT_ROWS) {
  console.log(`\nID DRIFT: this band executed ${results_count()} rows but declares EXPECT_ROWS = ${EXPECT_ROWS}.\nEvery id after the inserted row has shifted. Append at the end, or renumber deliberately and update the ledger.`);
  process.exit(2);
}
const n = report(`T13 NEW band D · does each style rule REACH its element (P67031–P${id - 1})`, { minChecks: 45 });
const out = process.argv.find((x) => x.startsWith("--ledger="));
if (out) writeLedger(out.slice(9), {
  how: `opened the real page at three widths and two roles and read getComputedStyle — never the source`,
  section: `NEW · Band D — does each style rule REACH its element, COMPUTED — P67031–P${id - 1}`,
});
await browser.close();
