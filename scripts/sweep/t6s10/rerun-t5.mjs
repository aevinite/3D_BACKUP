// scripts/sweep/t6s10/rerun-t5.mjs — re-running T5.md's manager-panel rows (sweeps #6, #7 and the
// owner's own run: P02001–P02500, P17101–P17600, P35101–P35200) whose SUBJECT is MY half of
// editor/app.js.
//
// T5.md's own header says how a row is re-run: a `read the shipped file · <expression>` row is a
// text assertion against the file named in it. This evaluates every such expression with the same
// variable names the rows use (the shape scripts/sweep/t7/rerun-t5.mjs established), and decides
// WHOSE row it is by where its pattern lands today: a pattern that first matches before
// printZReport() is mine; one that matches later is terminal 7's or 8's. A pattern that matches
// NOWHERE is reported for a person to judge — it is either a deliberate removal (an obituary says
// so) or a regression.
//
// The driven rows (headless / screenshot / judgment) are listed by the SCREEN they drove; the ones
// on screens my half draws are re-driven in rerun-t5-live.mjs.
//
//   node scripts/sweep/t6s10/rerun-t5.mjs [--json file] [--all]
import fs from "node:fs";
import { join } from "node:path";
import { ROOT, APP, MY_END_AT, lineAt } from "./lib.mjs";

const rd = (p) => { try { return fs.readFileSync(join(ROOT, p), "utf8"); } catch { return ""; } };
const has = (s, re) => re.test(s);
const hasNot = (s, re) => !re.test(s);
const count = (s, re) => (s.match(re) || []).length;
const app = APP;
const html = rd("public/panels/editor/index.html"), css = rd("public/panels/editor/style.css"), fl = rd("public/panels/floor-layouts.js");
const inv = rd("public/panels/editor/inventory.js"), undobar = rd("public/panels/undobar.js"), editorRoute = rd("app/api/editor/[...path]/route.ts");
const route = editorRoute, kit = rd("public/panels/kitchen/app.js"), tab = rd("public/panels/tablet/app.js"), mgrPage = rd("app/manager/page.tsx");
const mgrLayout = rd("app/manager/layout.tsx"), edPage = rd("app/editor/page.tsx"), doc = rd("public/panels/billdoc.js");
const noCommentsFn = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\n)\s*\/\/[^\n]*/g, "$1");
const noComments = noCommentsFn(app);
const rej = rd("docs/REJECTED-IDEAS.md"), floorLay = rd("lib/floorLayout.ts"), bell = rd("public/panels/guestbell.js"), outbox = rd("public/panels/outbox.js");
const sortmod = rd("public/panels/auditsort.js"), logTrail = rd("lib/logTrail.ts"), adminShared = rd("components/admin/shared.tsx");
const boardIvs = [...app.matchAll(/setInterval\([^,]*,\s*(\d+)\)/g)].map((m) => Number(m[1])).filter((v) => v >= 20000);
const printIv = 20000;
const VARS = { rd, has, hasNot, count, app, html, css, fl, inv, undobar, editorRoute, route, kit, tab, mgrPage, mgrLayout, edPage, doc, noComments, boardIvs, printIv, rej, floorLay, bell, outbox, sortmod, logTrail, adminShared, noCommentsFn };

const A = process.argv.slice(2);
const lines = rd(".claude/sweep/LEDGER/T5.md").split("\n");
const out = [];
for (let i = 0; i < 1636 && i < lines.length; i++) {
  const L = lines[i];
  const m = L.match(/^\| (P\d{5,6}) \| (.*?) \| (.*?) \| (✅|❌|⏭)[^|]*\|(.*)\|\s*$/);
  if (!m) continue;
  const [, id, title, how, prev, note] = m;
  const dsl = how.match(/^read the shipped files? · (.*)$/);
  if (!dsl) { out.push({ id, line: i + 1, title, how, prev, kind: "driven" }); continue; }
  let expr = dsl[1].replace(/¦/g, "|").replace(/noComments\(app\)/g, "noCommentsFn(app)");
  // Which file does it assert about? Only rows whose FIRST argument is app.js can be mine.
  const target = (expr.match(/^(?:!?\s*)?(?:has|hasNot|count)\(\s*([A-Za-z]+)/) || [])[1]
    || (expr.match(/^([A-Za-z]+)\.(?:indexOf|includes|match|split)/) || [])[1] || "";
  if (target !== "app" && target !== "noCommentsFn" && !/^app\b/.test(expr)) { out.push({ id, line: i + 1, title, how, prev, kind: "other-file", target }); continue; }
  let ok, err = null;
  try { ok = Function(...Object.keys(VARS), "return (" + expr + ");")(...Object.values(VARS)); } catch (e) { err = e.message; }
  // Where does it land? The first regex literal in the expression, searched in app.js.
  let at = -1;
  const rx = expr.match(/\/((?:\\.|\[(?:\\.|[^\]])*\]|[^/\n])+)\/([gimsuy]*)/);
  if (rx) { try { at = app.search(new RegExp(rx[1], rx[2].replace("g", ""))); } catch { at = -1; } }
  const owner = at < 0 ? "nowhere" : at < MY_END_AT ? "mine" : "theirs";
  out.push({ id, line: i + 1, title, how, prev, kind: "dsl", ok: err ? false : !!ok, err, owner, at: at >= 0 ? lineAt(at) : null, expr });
}
const dsl = out.filter((x) => x.kind === "dsl");
const by = (k) => dsl.filter((x) => x.owner === k);
console.log(`T5.md manager rows: ${out.length} · DSL against app.js: ${dsl.length} (mine ${by("mine").length} · theirs ${by("theirs").length} · pattern found nowhere ${by("nowhere").length}) · other files ${out.filter((x) => x.kind === "other-file").length} · driven ${out.filter((x) => x.kind === "driven").length}`);
const show = A.includes("--all") ? dsl : dsl.filter((x) => x.owner !== "theirs" && (!x.ok || x.owner === "nowhere"));
for (const x of show) console.log(`  ${x.ok ? "PASS" : "FAIL"} ${x.owner.padEnd(7)} ${x.id} (T5.md:${x.line}) ${x.title.slice(0, 70)}${x.at ? " @" + x.at : ""}${x.err ? " [" + x.err + "]" : ""}`);
const ji = A.indexOf("--json"); if (ji >= 0) fs.writeFileSync(A[ji + 1], JSON.stringify(out, null, 1));
