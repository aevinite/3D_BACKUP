// Does raising the tile floors CLIP anything? Measured, not guessed — five sizes, both skins.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable } from "./lib.mjs";
const T = ["17", "18"];
const SIZES = [[1194, 834], [834, 1194], [1024, 768], [360, 780], [430, 932]];
await retireTables(T); await seatParty(T);
const s = await open();
for (const skin of ["light", "dark"]) {
  await s.fr.evaluate((sk) => { document.documentElement.dataset.theme = sk; }, skin);
  for (const [w, h] of SIZES) {
    await s.page.setViewportSize({ width: w, height: h });
    await s.page.waitForTimeout(1100);
    const r = await s.fr.evaluate(() => {
      const out = { clipped: [], sizes: [], overflow: 0 };
      for (const e of document.querySelectorAll(".tile, .tile *")) {
        if (e.children.length) continue;
        const t = e.innerText.trim(); if (!t) continue;
        const fs = parseFloat(getComputedStyle(e).fontSize);
        out.sizes.push(fs);
        // is the text wider/taller than the box that holds it, with no ellipsis to save it?
        const cs = getComputedStyle(e);
        const ell = cs.textOverflow === "ellipsis" || getComputedStyle(e.parentElement).textOverflow === "ellipsis";
        if ((e.scrollWidth > e.clientWidth + 1 && !ell) || e.scrollHeight > e.clientHeight + 2) out.clipped.push({ t: t.slice(0, 14), fs, sw: e.scrollWidth, cw: e.clientWidth, sh: e.scrollHeight, ch: e.clientHeight });
      }
      const doc = document.documentElement;
      out.overflow = [...document.querySelectorAll(".tile")].filter((e) => e.getBoundingClientRect().right > doc.clientWidth + 1).length;
      out.min = out.sizes.length ? Math.min(...out.sizes) : null;
      out.tileW = Math.round((document.querySelector(".tile") || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width);
      return out;
    });
    console.log(`${skin} ${w}x${h}: tile ${r.tileW}px · smallest text ${r.min}px · clipped ${r.clipped.length} · tiles past the edge ${r.overflow}` +
      (r.clipped.length ? ` → ${r.clipped.slice(0, 3).map((c) => `"${c.t}" ${c.fs}px ${c.sw}>${c.cw}`).join(" | ")}` : ""));
  }
}
await s.browser.close();
await retireTables(T);
