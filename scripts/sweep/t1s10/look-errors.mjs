// scripts/sweep/t1s10/look-errors.mjs — draw the two REAL error screens (react-dom/server → Chromium) in both skins
// at 360px, screenshot them for an eye-read, and measure the button's contrast. Used for item 5.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { ROOT } from "./lib.mjs";
import { newPage, done, closeAll } from "./browser.mjs";
const require = createRequire(import.meta.url);
const esbuild = require(join(ROOT, "node_modules/esbuild"));
const dir = join(ROOT, ".claude/sweep/shots/S10-T1"); mkdirSync(dir, { recursive: true });
const entry = `import { createElement } from "react"; import { renderToStaticMarkup } from "react-dom/server"; import AppError from "@/app/error"; import GlobalError from "@/app/global-error";
  export const app = renderToStaticMarkup(createElement(AppError, { error: new Error("boom"), reset() {} }));
  export const glob = renderToStaticMarkup(createElement(GlobalError, { error: new Error("boom"), reset() {} }));`;
const out = await esbuild.build({ stdin: { contents: entry, resolveDir: ROOT, loader: "tsx" }, bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent", jsx: "automatic", alias: { "@": ROOT }, banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }, define: { "process.env.NODE_ENV": '"production"' } });
const f = join(dir, "render-errors.mjs"); writeFileSync(f, out.outputFiles[0].text); const m = await import(f + "?" + Date.now());
const lum = (c) => { const v = c.match(/[\d.]+/g).slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const res = {};
for (const [name, html] of [["error", `<!doctype html><html><head><meta name="color-scheme" content="light dark"></head><body style="margin:0">${m.app}</body></html>`], ["global-error", "<!doctype html>" + m.glob]]) for (const scheme of ["light", "dark"]) {
  const p = await newPage(); try { await p.emulateMedia({ colorScheme: scheme }); await p.setContent(html); const r = await p.evaluate(() => { const b = document.querySelector("button"), cs = getComputedStyle(b), page = getComputedStyle(document.querySelector("main") || document.body); return { bg: cs.backgroundColor, fg: cs.color, page: page.backgroundColor }; }); res[`${name}-${scheme}`] = { ...r, text: +cr(r.bg, r.fg).toFixed(1), edge: +cr(r.bg, r.page).toFixed(1) }; await p.screenshot({ path: join(dir, `item5-${name}-${scheme}.png`) }); } finally { await done(p); } }
console.log(JSON.stringify(res, null, 1)); await closeAll(); process.exit(0);
