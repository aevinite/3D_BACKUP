// scripts/sweep/t7s10/shot.mjs — screenshot one state of my third's screens, to LOOK at.
//   node scripts/sweep/t7s10/shot.mjs <name> <width>x<height>[@dpr] <expr-file|-> [--dark] [--touch]
// The expression runs inside the panel (WITH() fixtures allowed) and must leave the screen drawn;
// a fixture's finally restores state, so the shot is taken INSIDE the expression via window.__shot().
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, panel, closeLive } from "./lib.mjs";
const [name, size, exprFile] = process.argv.slice(2);
const [wh, dpr] = size.split("@"); const [w, h] = wh.split("x").map(Number);
const dark = process.argv.includes("--dark"), touch = process.argv.includes("--touch");
const dir = join(ROOT, ".claude/sweep/shots/S10-T7"); mkdirSync(dir, { recursive: true });
const P = await panel({ fresh: true, viewport: { width: w, height: h }, ctx: { deviceScaleFactor: Number(dpr) || 1, hasTouch: touch, isMobile: touch } });
const expr = exprFile === "-" ? readFileSync(0, "utf8") : readFileSync(exprFile, "utf8");
await P.page.exposeFunction("__shot", async (n) => { await P.page.screenshot({ path: join(dir, `${name}${n ? "-" + n : ""}.png`) }); return true; });
try {
  await P.frame.evaluate(`(async () => { try { localStorage.setItem('lfh_panel_theme', '${dark ? "dark" : "light"}'); } catch {} document.documentElement.setAttribute('data-theme', '${dark ? "dark" : "light"}'); })()`);
  const r = await P.frame.evaluate(`(async () => (${expr}))()`);
  console.log(JSON.stringify(r).slice(0, 600));
} finally { await closeLive(); }
