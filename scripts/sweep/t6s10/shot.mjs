// scripts/sweep/t6s10/shot.mjs — open one screen of my half in the real panel and save a picture
// of it, so a finding is LOOKED AT before it is filed.
//   node scripts/sweep/t6s10/shot.mjs <name> <light|dark> <width>x<height> "<js to run in the frame first>"
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, panel, closeLive } from "./lib.mjs";
const [name = "shot", skin = "light", size = "1280x800", js = ""] = process.argv.slice(2);
const [w, h] = size.split("x").map(Number);
const dir = join(ROOT, ".claude/sweep/shots/S10-T6"); mkdirSync(dir, { recursive: true });
const p = await panel({ viewport: { width: w, height: h }, ctx: w < 500 ? { deviceScaleFactor: 3, isMobile: true, hasTouch: true } : {} });
await p.frame.evaluate(`(() => { try { localStorage.setItem('lfh_panel_theme', '${skin}'); } catch {} document.documentElement.setAttribute('data-theme', '${skin}'); })()`);
if (js) await p.frame.evaluate(`(async () => { ${js} })()`);
await p.page.waitForTimeout(2500);
const file = join(dir, `${name}-${skin}-${w}.png`);
await p.page.screenshot({ path: file });
console.log(file);
await closeLive();
