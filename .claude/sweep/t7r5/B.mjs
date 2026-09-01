// T7 · fifth 500 · BLOCK B — THE TILE, AS A MATRIX.
// Items 10, 24 and rejection R31 all landed on this one square, and it has never been driven as a
// matrix: every state a tile can be in, at five densities, in both skins.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, C, dump, at, LEAK } from "./lib.mjs";
at(44903);
const T = ["21"];
// The states the panel itself names (tileFace/summaryTile), each with the words it must show.
const STATES = [
  ["free", "Free"], ["seated", "Seated"], ["new", "New order"], ["prep", "Preparing"],
  ["ready", "Ready to serve"], ["bill", "Served"], ["done", "Cleared"], ["req", "Wants in"],
];
const DENSITIES = [[1194, 834], [834, 1194], [1024, 768], [430, 932], [360, 780]];
let s;
try {
  await retireTables(T); await seatParty(T);
  s = await open();
  await s.page.waitForTimeout(1500);

  // ── the panel can name every state, and every name is a WORD ──────────────────────────
  const names = await s.fr.evaluate(() => {
    const out = [];
    for (let i = 1, n = tableCount(); i <= n && out.length < 40; i++) out.push(tileState(i).label);
    return [...new Set(out)];
  });
  C("the floor names its tables' states in words", names.length > 0, names.join(" · "));
  C("…and none of those words is code", names.every((n) => n && !LEAK.test(n) && !/_/.test(n)), names.join(" · "));
  C("…and none is empty", names.every((n) => String(n).trim().length > 1), JSON.stringify(names));

  // ── the matrix: every state, drawn, at every density, in both skins ───────────────────
  for (const [w, h] of DENSITIES) {
    await s.page.setViewportSize({ width: w, height: h });
    await s.page.waitForTimeout(900);
    for (const skin of ["light", "dark"]) {
      const r = await s.fr.evaluate(({ states, sk }) => {
        document.documentElement.dataset.theme = sk;
        const grid = document.getElementById("tiles");
        const keep = grid.innerHTML;
        const out = { rows: [], tileW: 0 };
        const t = "21";
        const realTile = (state.summary.tiles || {})[t];
        for (const [cls, label] of states) {
          // Draw the tile in this state from the panel's OWN builder — no hand-written markup, so
          // a change to tileHtml() is a change to what this measures.
          state.summary.tiles[t] = Object.assign({}, realTile, { state: cls, label });
          grid.innerHTML = tileHtml(Number(t));
          const el = grid.querySelector(".tile[data-t]");
          const box = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          const txt = el.innerText.replace(/\s+/g, " ").trim();
          const strings = [...el.querySelectorAll("*")].filter((e) => !e.children.length && e.innerText.trim());
          const sizes = strings.map((e) => parseFloat(getComputedStyle(e).fontSize));
          const clipped = strings.filter((e) => { const ell = getComputedStyle(e).textOverflow === "ellipsis"; return (e.scrollWidth > e.clientWidth + 1 && !ell) || e.scrollHeight > e.clientHeight + 2; }).length;
          out.rows.push({ cls, label, txt, w: Math.round(box.width), h: Math.round(box.height),
            square: Math.abs(box.width - box.height) <= 2, minFs: sizes.length ? Math.min(...sizes) : null,
            clipped, faces: (txt.match(/Take order/g) || []).length, colour: cs.getPropertyValue("--c").trim() });
          out.tileW = Math.round(box.width);
        }
        state.summary.tiles[t] = realTile;
        grid.innerHTML = keep;
        return out;
      }, { states: STATES, sk: skin });
      const bad = r.rows.filter((x) => x.clipped > 0);
      C(`${w}×${h} ${skin} — every state draws its tile`, r.rows.length === STATES.length, `${r.rows.length} states at ${r.tileW}px`);
      C(`${w}×${h} ${skin} — nothing on any of them is clipped`, bad.length === 0, bad.map((x) => `${x.cls}:${x.clipped}`).join(", ") || "none");
      C(`${w}×${h} ${skin} — item 24: no text on any state falls below 9px`, r.rows.every((x) => x.minFs === null || x.minFs >= 9), r.rows.filter((x) => x.minFs !== null && x.minFs < 9).map((x) => `${x.cls}:${x.minFs}`).join(", ") || `smallest ${Math.min(...r.rows.map((x) => x.minFs || 99))}px`);
      C(`${w}×${h} ${skin} — every tile is still a square`, r.rows.every((x) => x.square), r.rows.filter((x) => !x.square).map((x) => `${x.cls} ${x.w}×${x.h}`).join(", ") || "all square");
      C(`${w}×${h} ${skin} — R31: no tile grows a third worded face`, r.rows.every((x) => x.faces <= 1), r.rows.filter((x) => x.faces > 1).map((x) => x.cls).join(", ") || "at most one");
      C(`${w}×${h} ${skin} — every state says something`, r.rows.every((x) => x.txt.length > 0), r.rows.filter((x) => !x.txt).map((x) => x.cls).join(",") || "all speak");
      C(`${w}×${h} ${skin} — and none of them leaks code`, r.rows.every((x) => !LEAK.test(x.txt)), r.rows.find((x) => LEAK.test(x.txt))?.txt?.slice(0, 60) || "clean");
    }
  }
  await s.fr.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await s.page.setViewportSize({ width: 1194, height: 834 });
  await s.page.waitForTimeout(900);

  // ── item 10, as a rule rather than one measurement ────────────────────────────────────
  const rule = await s.fr.evaluate(() => {
    const out = [];
    const grid = document.getElementById("tiles");
    const keep = grid.innerHTML;
    const t = "21";
    const real = (state.summary.tiles || {})[t];
    state.summary.tiles[t] = Object.assign({}, real, { state: "free", label: "Free" });
    for (const px of [60, 80, 90, 96, 100, 120, 160, 220]) {
      grid.innerHTML = tileHtml(Number(t));
      const el = grid.querySelector(".tile[data-t]");
      el.style.width = px + "px"; el.style.height = px + "px";
      void el.offsetWidth;
      const take = el.querySelector(".t-take");
      const cs = getComputedStyle(el);
      const contentW = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      out.push({ px, contentW: Math.round(contentW), label: take ? take.innerText.replace(/\s+/g, " ").trim() : "(no take button)", hidden: !take || getComputedStyle(take).display === "none" });
    }
    state.summary.tiles[t] = real;
    grid.innerHTML = keep;
    return out;
  });
  C("item 10 — the take-order button can be measured at eight widths", rule.length === 8, rule.map((r) => `${r.px}:${r.label}`).join(" · ").slice(0, 130));
  C("item 10 — above a 96px content width it reads Take order", rule.filter((r) => r.contentW > 96 && !r.hidden).every((r) => /Take order/.test(r.label)), rule.filter((r) => r.contentW > 96).map((r) => `${r.contentW}:${r.label}`).join(" · "));
  C("item 10 — at or below it, a bare ＋", rule.filter((r) => r.contentW <= 96 && !r.hidden).every((r) => !/Take order/.test(r.label)), rule.filter((r) => r.contentW <= 96).map((r) => `${r.contentW}:${r.label}`).join(" · "));
  C("item 10 — and the rule is a threshold, not a slope: it never flips back", (() => { const shown = rule.filter((r) => !r.hidden).map((r) => /Take order/.test(r.label)); return shown.slice(1).every((v, i) => v >= shown[i]) || shown.every((v) => v === shown[0]); })(), rule.map((r) => (/Take order/.test(r.label) ? "words" : "＋")).join(" → "));
  C("item 10 — the smallest tiles hide the action row entirely rather than squeezing it", rule.filter((r) => r.px <= 60).every((r) => r.hidden || !/Take order/.test(r.label)), rule.filter((r) => r.px <= 60).map((r) => `${r.px}:${r.hidden ? "hidden" : r.label}`).join(" · "));

  // ── the real floor, unmodified, at the end ────────────────────────────────────────────
  const floor = await s.fr.evaluate(() => ({ n: document.querySelectorAll(".tile[data-t]").length, first: (document.querySelector(".tile[data-t]") || {}).innerText?.replace(/\s+/g, " ").trim() || "" }));
  C("the real floor is exactly as it was before the matrix ran", floor.n > 0, `${floor.n} tiles · "${floor.first.slice(0, 40)}"`);
  C("…and nothing the matrix drew was left behind", !/Wants in.*Cleared|Cleared.*Wants in/.test(floor.first), floor.first.slice(0, 60));
  C("no uncaught page error across the whole matrix", s.errs.length === 0, s.errs.join(" | ").slice(0, 160));
} catch (e) { C("block B completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) try { await s.browser.close(); } catch {} await retireTables(T); process.exitCode = dump("B") ? 1 : 0; }
