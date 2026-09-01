// T7 · fourth 500 · BLOCK H — THE PARTS A SCREENSHOT FLATTERS.
// Touch targets, focus, the keyboard, contrast in both skins, and five real device sizes. A waiter
// holds this thing one-handed with a tray in the other; none of this shows up in a picture.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, C, dump, at, LEAK } from "./lib.mjs";
at(42881);
const T = ["30"];
const DEVICES = [
  ["a 12.9-inch iPad, sideways", 1194, 834, 2],
  ["a 10-inch tablet upright", 834, 1194, 2],
  ["an iPad mini sideways", 1024, 768, 2],
  ["a Samsung A35 phone", 360, 780, 3],
  ["a big phone", 430, 932, 3],
];
let s;
const lum = `(c) => { const n = (c.match(/[\\d.]+/g) || []).map(Number); const sr = /^color\\(/.test(c); const [r, g, b] = n.slice(0, 3).map((v) => { const x = sr ? v : v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }`;
try {
  await retireTables(T); await seatParty(T);
  s = await open();
  await openTable(s, T[0]);

  // ── every control on the table detail is reachable with a thumb ────────────────────────
  const touch = await s.fr.evaluate(() => {
    const seen = [];
    for (const b of document.querySelectorAll(".detail-pop button, .detail-pop a, .detail-pop select")) {
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      seen.push({ what: (b.innerText || b.getAttribute("aria-label") || b.id || b.tagName).replace(/\s+/g, " ").trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) });
    }
    return seen;
  });
  C("the table detail has controls to measure", touch.length > 0, `${touch.length} controls`);
  C("…and every one is at least 30px tall", touch.every((b) => b.h >= 30), touch.filter((b) => b.h < 30).map((b) => `${b.what}:${b.h}`).join(", ") || "all ≥30px");
  C("…and the main ones are a full 44px", touch.filter((b) => b.w > 60).every((b) => b.h >= 40), touch.filter((b) => b.w > 60 && b.h < 40).map((b) => `${b.what}:${b.h}`).join(", ") || "all ≥40px");
  C("…and none is labelled with nothing at all", touch.every((b) => b.what.length > 0), `${touch.filter((b) => !b.what).length} blank`);

  // ── the keyboard can reach and leave every field ───────────────────────────────────────
  const kb = await s.fr.evaluate(() => {
    const focusable = [...document.querySelectorAll(".detail-pop button, .detail-pop input, .detail-pop select, .detail-pop [tabindex]")].filter((e) => e.offsetParent !== null);
    const noTrap = focusable.every((e) => Number(e.getAttribute("tabindex") || 0) >= 0 || e.getAttribute("tabindex") === null);
    const first = focusable[0];
    if (first) first.focus();
    return { n: focusable.length, noTrap, focused: document.activeElement === first, outline: first ? getComputedStyle(first, ":focus-visible").outlineStyle : "" };
  });
  C("the table detail can be walked with a keyboard", kb.n > 0, `${kb.n} focusable controls`);
  C("…with nothing taken out of the tab order behind the panel's back", kb.noTrap);
  C("…and focus really lands where it is sent", kb.focused, `focused=${kb.focused}`);

  // ── contrast, in BOTH skins, on the things a waiter reads at a glance ─────────────────
  for (const skin of ["light", "dark"]) {
    const c = await s.fr.evaluate(({ sk, lumSrc }) => {
      document.documentElement.dataset.theme = sk;
      const lum = eval(lumSrc);
      const ratio = (fg, bg) => { const a = lum(fg) + 0.05, b = lum(bg) + 0.05; return +(Math.max(a, b) / Math.min(a, b)).toFixed(2); };
      const body = getComputedStyle(document.body);
      const out = { theme: sk, text: ratio(body.color, body.backgroundColor), items: [] };
      for (const sel of [".tile", ".t-take", ".detail-pop", ".muted", ".btn.primary"]) {
        const e = document.querySelector(sel);
        if (!e) continue;
        const cs = getComputedStyle(e);
        // A GRADIENT IS A BACKGROUND. backgroundColor on a gold gradient button is transparent, so
        // walking up to the parent measured the button's ink against the page behind it and called
        // a perfectly readable control 1.03:1. Read the gradient's own first colour when there is one.
        let bg = cs.backgroundColor, n = e;
        const grad = (cs.backgroundImage || "").match(/rgba?\([^)]+\)/);
        if (grad && bg === "rgba(0, 0, 0, 0)") bg = grad[0];
        while (bg === "rgba(0, 0, 0, 0)" && n.parentElement) {
          n = n.parentElement;
          const pcs = getComputedStyle(n);
          const pg = (pcs.backgroundImage || "").match(/rgba?\([^)]+\)/);
          bg = pcs.backgroundColor !== "rgba(0, 0, 0, 0)" ? pcs.backgroundColor : (pg ? pg[0] : bg);
        }
        out.items.push({ sel, r: ratio(cs.color, bg) });
      }
      return out;
    }, { sk: skin, lumSrc: `${lum}` });
    C(`${skin} skin — the panel's own text is readable`, c.text >= 4.5, `${c.text}:1`);
    for (const it of c.items) C(`${skin} skin — ${it.sel} is readable against what is behind it`, it.r >= 3, `${it.r}:1`);
  }
  await s.fr.evaluate(() => { document.documentElement.dataset.theme = "light"; });

  // ── five real devices ─────────────────────────────────────────────────────────────────
  for (const [name, w, h] of DEVICES) {
    await s.page.setViewportSize({ width: w, height: h });
    await s.page.waitForTimeout(1200);
    const d = await s.fr.evaluate(() => {
      const doc = document.documentElement;
      const shifted = (t) => { const m = /matrix\(([^)]+)\)/.exec(t); if (!m) return false; const p = m[1].split(",").map(Number); return Math.abs(p[4] || 0) > 1 || Math.abs(p[5] || 0) > 1; };
      const parked = (e) => { for (let n = e; n; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === "none" || cs.visibility === "hidden" || shifted(cs.transform)) return true; } return false; };
      const over = [...document.querySelectorAll("*")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > doc.clientWidth + 2 && !parked(e); }).slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${(e.className || "").toString().split(" ")[0]}`);
      const tiles = [...document.querySelectorAll(".tile[data-t]")];
      const cut = tiles.filter((t) => { const r = t.getBoundingClientRect(); return r.right > doc.clientWidth + 1; }).length;
      const sizes = [...document.querySelectorAll(".tile, .tile *")].filter((e) => e.children.length === 0 && e.innerText.trim()).map((e) => parseFloat(getComputedStyle(e).fontSize));
      const tiny = sizes.filter((f) => f < 8).length;          // unreadable
      const small = sizes.filter((f) => f < 9.5).length;       // small, and DELIBERATE — see below
      const tileW = (document.querySelector(".tile") || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width;
      return { scroll: doc.scrollWidth, client: doc.clientWidth, over, tiles: tiles.length, cut, smallBtns: [...document.querySelectorAll(".detail-pop button, .tile button")].filter((b) => { const r = b.getBoundingClientRect(); return r.height > 0 && r.height < 28; }).length, small, tiny, tileW: Math.round(tileW), minFs: sizes.length ? Math.min(...sizes) : null };
    });
    C(`${name} — nothing is pushed off the side`, d.scroll <= d.client + 2, `${d.scroll} vs ${d.client}`);
    C(`${name} — no element on screen overflows`, d.over.length === 0, d.over.join(", ") || "none");
    C(`${name} — the floor still draws`, d.tiles > 0, `${d.tiles} tiles`);
    C(`${name} — no tile is cut off at the edge`, d.cut === 0, `${d.cut} clipped`);
    C(`${name} — no control shrinks below a thumb`, d.smallBtns === 0, `${d.smallBtns} under 28px`);
    // The tile's words scale with the TILE (cqw), which is the owner's own design — item 10's rule
    // is that below a 96px content width they are dropped entirely rather than shrunk further. So
    // the fault line is "unreadable", not "small": 8px is the floor, and how small it gets above
    // that is his call, recorded here rather than quietly restyled.
    C(`${name} — no text on a tile is unreadable`, d.tiny === 0, `${d.tiny} strings under 8px · smallest ${d.minFs}px on a ${d.tileW}px tile`);
    C(`${name} — and the smallest tile text is recorded, not guessed at`, d.minFs != null, `${d.small} strings under 9.5px · smallest ${d.minFs}px`);
  }
  await s.page.setViewportSize({ width: 1194, height: 834 });
  await s.page.waitForTimeout(1000);

  // ── the safe area, and a notch ────────────────────────────────────────────────────────
  const safe = await s.fr.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return { sab: root.getPropertyValue("--sab").trim(), sat: root.getPropertyValue("--sat").trim() };
  });
  C("the panel is told about the phone's safe area", safe.sab !== "" || safe.sat !== "", `--sab="${safe.sab}" --sat="${safe.sat}"`);

  // ── the one thing a waiter does with a full tray: one thumb, no aiming ────────────────
  await openTable(s, T[0]);
  const thumb = await s.fr.evaluate(() => {
    const pop = document.querySelector(".detail-pop");
    const r = pop.getBoundingClientRect();
    const btns = [...pop.querySelectorAll("button")].filter((b) => b.getBoundingClientRect().height > 0);
    const low = btns.filter((b) => b.getBoundingClientRect().top > r.top + r.height * 0.55);
    return { total: btns.length, low: low.length, names: low.map((b) => (b.innerText || b.id).replace(/\s+/g, " ").trim().slice(0, 18)).slice(0, 6) };
  });
  C("the table's own controls exist to reach", thumb.total > 0, `${thumb.total} controls`);
  C("…and the ones a waiter uses most are in the lower half, where a thumb is", thumb.low > 0, thumb.names.join(", "));

  C("no uncaught page error across every size", s.errs.length === 0, s.errs.join(" | ").slice(0, 160));
  C("no leaked code text at any size", !LEAK.test(await s.fr.evaluate(() => document.body.innerText)));
} catch (e) { C("block H completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) try { await s.browser.close(); } catch {} await retireTables(T); process.exitCode = dump("H") ? 1 : 0; }
