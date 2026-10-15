// scripts/sweep/t3s10/r3/contrast.mjs — IS EVERY PIECE OF TEXT READABLE AGAINST WHAT IS BEHIND IT? (WCAG AA)
//
// Run INSIDE the page (page.evaluate(AUDIT, selector)). For every element under the selector that holds
// its own text: its colour (with every ancestor's opacity) over the real background behind it — every
// background colour up to the first opaque one, composited, and when a GRADIENT is in that stack each of
// its colour stops is a candidate and the WORST counts. 4.5:1 for ordinary text, 3:1 for large (24 px,
// or bold 18.66 px). A disabled control is exempt, as the standard says. Written for sweep #10 T3 round 3
// (item 27 — line prices measured 2.2:1 on the light bill).
// In-page: every visible text element under `root` → its colour against the real background behind it.
export const AUDIT = (rootSel) => {
  const parse = (c) => {
    let m = c.match(/^rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
    m = c.match(/^color\(srgb ([^)]+)\)/); if (m) { const p = m[1].split(/[ /]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; }
    return null; };
  const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); if (!a) return [0, 0, 0, 0]; return [0, 1, 2].map((i) => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat(a); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  // The colours behind `el`: every background-colour up to the first opaque one, composited — and if a
  // GRADIENT sits in that stack, each of its colour stops is a candidate; the WORST one is what counts.
  const stopsOf = (img) => { const cs = []; for (const m of img.matchAll(/(rgba?\([^)]+\)|color\(srgb [^)]+\))/g)) { const c = parse(m[1]); if (c) cs.push(c); } return cs; };
  const bgsOf = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); const grad = /gradient/.test(cs.backgroundImage) ? stopsOf(cs.backgroundImage) : []; const c = parse(cs.backgroundColor);
      if (grad.length) { layers.push(grad); if (grad.every((g) => g[3] >= 1)) break; }
      if (c && c[3] > 0) layers.push([c]); if (c && c[3] >= 1) break; }
    let cands = [[255, 255, 255, 1]];
    for (const layer of layers.reverse()) { const next = []; for (const top of layer) for (const bot of cands) next.push(over(top, bot)); cands = next.slice(0, 64); }
    return { bgs: cands, image: layers.some((l) => l.length > 1) }; };
  const out = []; const roots = [...document.querySelectorAll(rootSel)];
  for (const root of roots) for (const el of [root, ...root.querySelectorAll("*")]) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(" ");
    if (!own) continue; const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    // WCAG exempts inactive controls: a disabled button (the − at quantity 1) is not text to read.
    if (el.closest("button:disabled, [aria-disabled='true']")) continue;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity;
    const fg0 = parse(cs.color); if (!fg0) continue; const { bgs, image } = bgsOf(el);
    let ratio = Infinity; for (const bg of bgs) { const fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * op], bg); const L1 = lum(fg), L2 = lum(bg); ratio = Math.min(ratio, (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)); }
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700; const large = size >= 24 || (bold && size >= 18.66);
    const need = large ? 3 : 4.5;
    out.push({ text: own.slice(0, 50), cls: String(el.className || el.tagName).slice(0, 40), ratio: Math.round(ratio * 100) / 100, need, size, image, ok: ratio >= need });
  }
  return out; };
