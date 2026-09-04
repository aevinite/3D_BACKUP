// ⬛ NEW — T11 of sweep #8 · BANK D · P65241–P65340
// WHAT A PERSON ACTUALLY READS: the admin's Printing screen rendered in a real browser, at two
// widths and in both skins, in each state a restaurant can be in — and the three documents that
// tell a restaurant how to set a printer up.
//
// This is where four of this run's twelve findings came from, and every one of them was prose:
// a sentence pointing at a control that had been deleted, three "go to step N" pointers naming the
// wrong step, and a green tick asserting the opposite of the line under it. None of them could
// have been found by reading a source file for correctness — they had to be READ AS SENTENCES.
//
// SAFETY: it writes only to French House and only the printing routes, snapshotted and put back.
import { row, skipRow, read, ROOT } from "./lib.mjs";
import { adminCookie, adminHeaders } from "../login.mjs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.T11_BASE || "http://localhost:4311";
const RID = "00000000-0000-0000-0000-000000000001";
const HDRS = { ...adminHeaders(BASE), "content-type": "application/json" };
const post = (p, b) => fetch(BASE + "/api/admin/printing" + p, { method: "POST", headers: HDRS, body: JSON.stringify(b) }).then((r) => r.json().catch(() => null));
const getState = () => fetch(BASE + `/api/admin/printing/state?rid=${RID}`, { headers: HDRS }).then((r) => r.json()).catch(() => null);

let n = 65241;
const id = () => "P" + n++;

// ── is anything there? ──────────────────────────────────────────────────────────────────────
let pw = null, browser = null, ctx = null, SNAP = null;
const reachable = await fetch(BASE + `/api/admin/printing/state?rid=${RID}`, { headers: HDRS }).then((r) => r.status === 200).catch(() => false);
if (reachable) {
  pw = await import("playwright").catch(() => null);
  if (pw) {
    browser = await pw.chromium.launch();
    ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await ctx.addCookies([adminCookie(BASE)]);
    SNAP = JSON.parse(JSON.stringify((await getState())?.routes ?? {}));
  }
}
const R = (what, fn) => (browser ? row(id(), what, fn)
  : skipRow(id(), what, `needs a running server at ${BASE} and playwright — start the dev server and re-run`));

const SHOTS = join(ROOT, ".claude/sweep/shots/T11");
try { mkdirSync(SHOTS, { recursive: true }); } catch { /* already there */ }

/** open the Printing screen for French House and hand back what it RENDERS */
const openPrinting = async (opts = {}) => {
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 200)));
  if (opts.width) await page.setViewportSize({ width: opts.width, height: opts.height || 900 });
  if (opts.skin) await page.addInitScript((s) => { try { localStorage.setItem("aevidine_skin", s); } catch { /* nothing */ } }, opts.skin);
  await page.goto(`${BASE}/aevinite/printing?rid=${RID}`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(1800);
  const text = await page.evaluate(() => document.body.innerText);
  return { page, errs, text };
};
let base = null;   // the default state, opened once and reused by the read-only checks
if (browser) base = await openPrinting();

// ── 1 · the screen is a screen (8) ───────────────────────────────────────────────────────────
R("Admin → Printing renders real content, not an empty shell", () => (base.text.length > 1500) || `${base.text.length} characters`);
R("…and throws nothing while it does", () => {
  const real = base.errs.filter((e) => !/hydrat/i.test(e) && !/did not match/i.test(e));
  return real.length === 0 || real.slice(0, 2).join(" | ");
});
R("…and it is wrapped in the admin console's own shell", () => /Aevidine/.test(base.text) && /Restaurants/.test(base.text) || "the console shell is missing");
R("…and it names WHICH restaurant it is about", () => /French House/.test(base.text) || "the restaurant is not named — this screen is per restaurant");
R("…and every one of its five steps is on screen, in order", () => {
  const want = ["1 · Is printing switched on", "2 · The computer that prints", "3 · Which printer gets which paper", "4 · The kitchen screen", "5 ·"];
  const at = want.map((w) => base.text.indexOf(w));
  const missing = want.filter((w, i) => at[i] < 0);
  if (missing.length) return `missing: ${missing.join(" / ")}`;
  const sorted = at.every((v, i) => i === 0 || v > at[i - 1]);
  return sorted || `the steps render out of order: ${at.join(",")}`;
});
R("…and no two of them carry the same number", () => {
  const nums = [...base.text.matchAll(/^\s*(\d) · /gm)].map((m) => m[1]);
  const dup = nums.filter((x, i) => nums.indexOf(x) !== i);
  return dup.length === 0 || `two cards called ${[...new Set(dup)].join(",")}`;
});
R("…and the numbers run 1,2,3,4,5 with no gap", () => {
  const nums = [...new Set([...base.text.matchAll(/^\s*(\d) · /gm)].map((m) => +m[1]))].sort();
  return JSON.stringify(nums) === "[1,2,3,4,5]" || `the steps are ${nums.join(",")}`;
});
R("…and it links the restaurant's own guide, in a new tab", () => /own guide/.test(base.text) || "the guide link is gone");

// ── 2 · no machine language reaches the screen (10) ─────────────────────────────────────────
// …EXCEPT INSIDE THE <pre> BOXES, which exist to show a shell script and therefore legitimately
// contain "${dims%% *}" and "2>/dev/null". My first version scanned the whole page and reported the
// installer text as leaked code — a fault in a feature whose entire point is showing that text.
// …and <script>/<style>, or innerText hands back Next's own inline bootstrap, in which "null"
// legitimately appears ("null!==e.parentNode"). My first version reported the framework's
// bootstrap as leaked machine language on the page.
const prose = browser
  ? await base.page.evaluate(() => {
    const c = document.body.cloneNode(true);
    c.querySelectorAll("pre, script, style, template, noscript").forEach((x) => x.remove());
    document.body.appendChild(c);
    const t = c.innerText;
    c.remove();
    return t;
  })
  : "";
for (const junk of ["undefined", "NaN", "[object Object]", "${", "-->", "null", "Infinity", "TypeError", "PGRST", "duplicate key"]) {
  R(`the screen's own words show no "${junk}"`, () => !prose.includes(junk) || `it does: …${prose.slice(Math.max(0, prose.indexOf(junk) - 45), prose.indexOf(junk) + 25)}…`);
}
// ── 3 · every "step N" it quotes names the step that holds it (4) ───────────────────────────
R("every 'set a/the computer up in step N' names the step the COMPUTER is on", () => {
  const bad = [...base.text.matchAll(/[Ss]et (?:a|the) computer up in step (\d)/g)].map((m) => m[1]).filter((x) => x !== "2");
  return bad.length === 0 || `it says step ${bad.join(",")} — the computer is step 2`;
});
R("every 'the dropdowns in step N' names the step the DROPDOWNS are on", () => {
  const bad = [...base.text.matchAll(/dropdowns in step (\d)/g)].map((m) => m[1]).filter((x) => x !== "3");
  return bad.length === 0 || `it says step ${bad.join(",")} — the dropdowns are step 3`;
});
R("every 'the Kitchen slips line in step N' names the step that holds it", () => {
  const bad = [...base.text.matchAll(/Kitchen slips[^.]{0,20}line in step (\d)/g)].map((m) => m[1]).filter((x) => x !== "3");
  return bad.length === 0 || `it says step ${bad.join(",")} — the Kitchen slips line is step 3`;
});
R("no sentence sends the reader to the step they are already reading", () => {
  const bad = [];
  for (const m of base.text.matchAll(/step (\d)/g)) {
    const before = base.text.slice(0, m.index);
    const card = [...before.matchAll(/^\s*(\d) · /gm)].pop();
    if (card && card[1] === m[1] && /set (a|the) computer up|dropdowns in/i.test(base.text.slice(Math.max(0, m.index - 60), m.index))) bad.push(m[1]);
  }
  return bad.length === 0 || `a sentence inside card ${bad.join(",")} points at card ${bad.join(",")}`;
});
// ── 4 · it points at no control that does not exist (6) ─────────────────────────────────────
for (const ghost of ["the toggle below picks one", "Which screen prints the ticket", "both — the counter is the backup",
  "Should this screen print the kitchen tickets", "the strip above the Tables grid", "🖨 KOT printing → \"Which screen"]) {
  R(`the screen does not send anybody to "${ghost.slice(0, 42)}…"`, () =>
    !base.text.includes(ghost) || "that control does not exist any more");
}
// ── 5 · the three states of a paper line, DRIVEN (12) ───────────────────────────────────────
const asPatch = (r) => !r ? null : r.via === "off" ? { via: "off" }
  : (r.agent && r.printer) ? { via: "computer", agent: r.agent, printer: r.printer }
  : (r.via === "screen" && r.panel) ? { via: "screen", panel: r.panel, person: r.person || undefined } : null;
const restore = async () => { if (SNAP) for (const k of Object.keys(SNAP)) await post("/routes", { rid: RID, routes: { [k]: asPatch(SNAP[k]) } }); };
const inState = async (kind, val, fn) => {
  await post("/routes", { rid: RID, routes: { [kind]: val } });
  const { page, errs, text } = await openPrinting();
  const card = await page.evaluate(() => {
    const h = [...document.querySelectorAll("h2")].find((x) => /The kitchen screen/.test(x.textContent || ""));
    return h ? h.closest(".adm-card").innerText : "";
  });
  const out = await fn({ text, card, errs, page });
  await page.close();
  return out;
};
R("with kitchen slips switched OFF, the card says so", () =>
  inState("kot", { via: "off" }, ({ card }) => /switched off/i.test(card) || `the card reads: ${card.split("\n")[1]}`));
R("…and does NOT also claim they print on the kitchen screen", () =>
  inState("kot", { via: "off" }, ({ card }) => !/print on the\s*kitchen screen already/i.test(card.replace(/\n/g, " "))
    || "the card claims both at once"));
R("…and the sentence under the dropdown agrees with the sentence above it", () =>
  inState("kot", { via: "off" }, ({ card }) => {
    const off = /switched off/i.test(card), notby = /do not print by themselves/i.test(card);
    return (off && notby) || `above: ${off}, below: ${notby}`;
  }));
R("…and the dropdown itself shows Nobody as the chosen answer", () =>
  inState("kot", { via: "off" }, async ({ page }) => {
    const v = await page.evaluate(() => { const s = [...document.querySelectorAll("select")].find((x) => [...x.options].some((o) => /Nobody — kitchen slips/.test(o.textContent))); return s ? s.value : null; });
    return v === "off" || `the dropdown reads "${v}"`;
  }));
// A HYDRATION NOTICE HERE IS THE DEV SERVER, NOT THE SCREEN. This bank opens a page per state, and
// `next dev` hands out a stale chunk under concurrent loads — a stale chunk against fresh server
// HTML *is* a hydration mismatch. Measured: arriving once, as a person does, this page logs ZERO
// console errors. Three identical runs of the 360px check read the PREVIOUS build's layout in one
// of them, and clearing .next made all three agree. So the notice is filtered, with the reason, and
// everything else is still asserted — a real exception would not be a hydration warning.
const realErrs = (errs) => errs.filter((e) => !/hydrat/i.test(e) && !/did not match/i.test(e));
R("…and it throws nothing in that state", () => inState("kot", { via: "off" }, ({ errs }) => realErrs(errs).length === 0 || realErrs(errs).join(" | ")));
R("with kitchen slips UNSET, the card says the kitchen screen is doing it", () =>
  inState("kot", null, ({ card }) => /kitchen screen is doing it/i.test(card) || `the card reads: ${card.split("\n")[1]}`));
R("…and it does NOT say 'switched off'", () =>
  inState("kot", null, ({ card }) => !/switched off/i.test(card) || "an unset line reads as switched off"));
R("…and the dropdown shows 'the kitchen screen (anyone signed in there)'", () =>
  inState("kot", null, async ({ page }) => {
    const v = await page.evaluate(() => { const s = [...document.querySelectorAll("select")].find((x) => [...x.options].some((o) => /anyone signed in there/.test(o.textContent))); return s ? s.value : "(none)"; });
    return v === "" || `the dropdown reads "${v}"`;
  }));
R("with BILLS switched off, the bill line says the print window opens for whoever presses Print", () =>
  inState("bill", { via: "off" }, ({ text }) => /ordinary print window opens/i.test(text) || "the bill line does not say what happens instead"));
R("…and the KITCHEN SLIPS line's own words are different, because the consequence is different", () =>
  inState("kot", { via: "off" }, ({ text }) => /Orders still reach the kitchen screen/i.test(text) || "both papers say the same thing when off"));
R("…and switching a paper off never makes the screen throw", () =>
  inState("banquet", { via: "off" }, ({ errs }) => realErrs(errs).length === 0 || realErrs(errs).join(" | ")));
R("EVERY route this bank touched is restored, and re-read", async () => {
  await restore();
  const now = (await getState())?.routes ?? {};
  const diffs = Object.keys(SNAP || {}).filter((k) => JSON.stringify(SNAP[k]) !== JSON.stringify(now[k]));
  return diffs.length === 0 || `NOT RESTORED: ${diffs.join(", ")}`;
});
// ── 6 · the phone, and both skins (8) ───────────────────────────────────────────────────────
R("it is usable at 360px — nothing scrolls sideways", async () => {
  const { page } = await openPrinting({ width: 360, height: 780 });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const shot = join(SHOTS, "printing-360.png");
  await page.screenshot({ path: shot, fullPage: true });
  await page.close();
  return over <= 1 || `${over}px of sideways scroll`;
});
R("…and every step heading is still readable there", async () => {
  const { page, text } = await openPrinting({ width: 360, height: 780 });
  await page.close();
  const want = ["1 ·", "2 ·", "3 ·", "4 ·", "5 ·"];
  const missing = want.filter((w) => !text.includes(w));
  return missing.length === 0 || `missing at 360px: ${missing.join(" ")}`;
});
R("…and no control is clipped OUT OF REACH at 360px", async () => {
  // "Past the edge" is not the same as "unreachable": step 5's table sits in an overflow-x
  // container, so its buttons are reached by scrolling it. What matters is a control past the edge
  // with NO scroller to bring it back and no page scroll either — which is what the header row was
  // doing (↻ Refresh at 381..480 in a 360px viewport, and scrollWidth exactly 360, so nothing on
  // screen hinted it was there). My first version could not tell the two apart.
  // ⚠️ ONE RETRY, AND THE REASON IS NOT THE PRODUCT. Measured three identical runs of this exact
  // check against the dev server: two read the current layout and one read the PREVIOUS build's
  // (getComputedStyle said flexWrap "nowrap" where the source says "wrap"). `next dev` hands out a
  // stale chunk under concurrent page loads, and this bank opens ~15 pages in a row — the same
  // trap this repo already records as "a red row can come from your own mid-edit build". A real
  // overflow fails every attempt; a stale chunk does not, so the retry tells them apart instead of
  // hiding either.
  const look = async () => {
    const { page } = await openPrinting({ width: 360, height: 780 });
    const out = await page.evaluate(() => {
      const cw = document.documentElement.clientWidth;
      const out2 = [];
      for (const el of document.querySelectorAll("select, button, a, input")) {
        const r = el.getBoundingClientRect();
        if (!(r.width > 0)) continue;
        if (r.left >= -1 && r.right <= cw + 1) continue;
        let sc = el.parentElement, reachable = false;
        while (sc) {
          const cs = getComputedStyle(sc);
          if (/auto|scroll/.test(cs.overflowX) && sc.scrollWidth > sc.clientWidth + 1) { reachable = true; break; }
          sc = sc.parentElement;
        }
        // An off-canvas drawer is not "clipped": the admin shell parks its whole nav at a negative
        // x on a phone and slides it in from ☰. Anything entirely to the LEFT of the viewport is
        // that, and my first version reported all nineteen nav links as unreachable.
        if (r.right <= 0) continue;
        if (!reachable) out2.push(`${(el.textContent || el.tagName).trim().slice(0, 26)} @${Math.round(r.left)}..${Math.round(r.right)}/${cw}`);
      }
      return out2;
    });
    await page.close();
    return out;
  };
  let bad = await look();
  if (bad.length) bad = await look();
  return bad.length === 0 || `unreachable: ${bad.join(" | ")}`;
});
for (const skin of ["dark", "light"]) {
  R(`it renders in the ${skin} skin with no unreadable text`, async () => {
    const { page, text, errs } = await openPrinting({ skin });
    // A NARROW, HONEST CHECK. A full contrast audit needs to resolve gradients, background images
    // and the pill/badge styles this console uses, and a crude luminance walk gets those wrong — my
    // first version flagged the "Live" connection pill and the "Restaurants" breadcrumb, both of
    // which are fine and both of which sit on a painted background it could not see. So this asks
    // only the thing a heuristic CAN answer: is any text painted the same colour as the thing
    // directly behind it (a true invisible), ignoring anything with its own background image.
    const bad = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("body *")) {
        if (el.children.length || !(el.textContent || "").trim()) continue;
        const cs = getComputedStyle(el);
        if (cs.backgroundImage !== "none") continue;
        let bg = cs.backgroundColor, p = el;
        while (p && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent")) {
          p = p.parentElement;
          if (!p) break;
          const pcs = getComputedStyle(p);
          if (pcs.backgroundImage !== "none") { bg = null; break; }
          bg = pcs.backgroundColor;
        }
        if (!bg) continue;
        if (cs.color === bg) out.push((el.textContent || "").trim().slice(0, 40));
      }
      return out.slice(0, 5);
    });
    const shot = join(SHOTS, `printing-${skin}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    await page.close();
    // A THEME HYDRATION NOTICE IS NOT THIS SCREEN'S FAULT, and it is not even a fault. Measured:
    // arriving as a person does, with no skin forced, this page logs ZERO console errors in either
    // skin. The notice only appears because THIS CHECK writes `aevidine_skin` before hydration, so
    // the server renders the default and the client switches — which is how the console-wide skin
    // has always worked, on every admin page, and is the deliberate alternative to a blocking
    // script or a flash of the wrong theme. Reporting it here would be reporting my own fixture.
    const real = errs.filter((e) => !/hydrat/i.test(e));
    if (real.length) return real.join(" | ");
    return bad.length === 0 || `text painted the same colour as its background: ${bad.join(" | ")}`;
  });
  R(`…and the ${skin} skin shows the same five steps`, async () => {
    const { page, text } = await openPrinting({ skin });
    await page.close();
    const nums = [...new Set([...text.matchAll(/^\s*(\d) · /gm)].map((m) => +m[1]))].sort();
    return JSON.stringify(nums) === "[1,2,3,4,5]" || `the ${skin} skin shows ${nums.join(",")}`;
  });
}
R("the helper file's own text is on the page, so it can be copied", async () => {
  const has = await base.page.evaluate(() => [...document.querySelectorAll("pre")].some((p) => /#!\/bin\/zsh|@echo off|#!\/bin\/sh/.test(p.textContent || "")));
  return has || "no script text is shown — the whole design is that a person types it by hand";
});
R("…and there is a Copy button beside it", async () => {
  const has = await base.page.evaluate(() => [...document.querySelectorAll("button")].some((b) => /^Copy$/.test((b.textContent || "").trim())));
  return has || "no Copy button";
});
R("…and no shown script carries an un-filled template hole", async () => {
  const holes = await base.page.evaluate(() => [...document.querySelectorAll("pre")].map((p) => p.textContent || "").filter((t) => /\$\{[a-zA-Z.]+\}/.test(t)).length);
  return holes === 0 || `${holes} script(s) on screen show a template hole`;
});

// ── 7 · the three documents a restaurant reads (30) ─────────────────────────────────────────
const DOCS = {
  "docs/PRINT-HELPER.md": read("docs/PRINT-HELPER.md"),
  "docs/KITCHEN-PRINT-SETUP.md": read("docs/KITCHEN-PRINT-SETUP.md"),
  "docs/NUMBERING.md": read("docs/NUMBERING.md"),
  "public/print-setup.html": read("public/print-setup.html"),
};
// the controls that no longer exist, and which each doc must not teach as current
const GHOSTS = [
  ["kot_print_target", /kot_print_target/],
  ["a \"Which screen prints the ticket?\" dropdown", /Which screen prints the ticket\?/],
  ["\"both — the counter is the backup\"", /both\s*[—-]\s*the counter is the backup/i],
  ["a 30-second backup", /30-second backup|backup as a 30/i],
  ["a per-device \"Should this screen print\" strip", /Should this screen print the kitchen tickets/],
  ["a printing MODE toggle", /the toggle below picks one/],
];
for (const [file, txt] of Object.entries(DOCS)) {
  for (const [what, re] of GHOSTS) {
    row(id(), `${file} does not teach ${what} as current`, () => {
      // AN OBITUARY CAN SPAN LINES. "This step used to describe … / options including *both — the
      // counter is the backup (30s)*" puts the dead thing on the line AFTER the word that retires
      // it, so a line-by-line scan reads the second line as the feature still being taught. My
      // first version reported four correct obituaries — three of them written by this very run.
      // So the window is the sentence: three lines either side.
      const lines = txt.split("\n");
      const DEAD = /RETIRED|no longer|is gone|was removed|used to|deleted|DELETED|CORRECTED|Corrected|⚠️|not exist|NONE of that|do not re-|~~/i;
      const live = [];
      lines.forEach((l, i) => {
        if (!re.test(l)) return;
        const around = lines.slice(Math.max(0, i - 3), i + 4).join(" ");
        if (!DEAD.test(around)) live.push([i + 1, l]);
      });
      return live.length === 0 || `line(s) ${live.map(([i]) => i).join(",")}: ${live[0][1].trim().slice(0, 90)}`;
    });
  }
}
for (const [file, txt] of Object.entries(DOCS)) {
  row(id(), `${file}: every backticked code path it names either exists, or is named as deleted`, () => {
    // The repo's own rule: "an obituary is worth keeping; a path written as though it were still
    // there sends the next session looking for a file that is not coming." So a path is fine when
    // the sentence around it says it is gone — which is exactly what KITCHEN-PRINT-SETUP.md does
    // for the three deleted print-station files, and what my first version reported as missing.
    // THE PROPERTY THAT MATTERS is that a reader is never sent hunting for a file that is not
    // coming — so a path missing from disk is fine when THE DOCUMENT records it as gone, wherever
    // it does so. KITCHEN-PRINT-SETUP.md names lib/printStation.ts inside a section headed "The
    // first fix was WRONG" and lists the deletion in its own table thirty lines earlier; a ±2-line
    // window could not see that, and my first version reported the obituary as the fault.
    const bad = [];
    for (const m of txt.matchAll(/`((?:lib|app|components|public|scripts|supabase|docs)\/[A-Za-z0-9_./[\]-]+)`/g)) {
      const path = m[1];
      try { read(path); continue; } catch { /* not on disk */ }
      const name = path.split("/").pop();
      const recorded = new RegExp(`(DELETED|deleted|do not re-create|was removed|were removed|no longer|is gone|retired|did not work|WRONG)[\\s\\S]{0,600}${name.replace(/[.[\]]/g, "\\$&")}|${name.replace(/[.[\]]/g, "\\$&")}[\\s\\S]{0,600}(DELETED|deleted|do not re-create|was removed|were removed|no longer|is gone|retired|did not work)`, "i").test(txt);
      if (!recorded) bad.push(path);
    }
    return bad.length === 0 || `named as though present: ${[...new Set(bad)].slice(0, 4).join(", ")}`;
  });
  row(id(), `${file}: it names no npm script that package.json does not have`, () => {
    const pkg = JSON.parse(read("package.json"));
    const named = [...new Set([...txt.matchAll(/npm run ([a-z0-9:-]+)/g)].map((m) => m[1]))];
    const missing = named.filter((x) => !pkg.scripts[x]);
    return missing.length === 0 || `missing: ${missing.join(", ")}`;
  });
}
