// scripts/sweep/t7/rerun-t5.mjs — sweep #8 · T7 · re-running T5.md's 675 text assertions
// against public/panels/editor/app.js.
//
// T5.md's own header says how its rows are re-run: "a `read the shipped file · <expression>` row
// is a text assertion against the file named in it". Nobody had ever executed them as a batch, so
// this does: it parses the table, evaluates each expression with the same variable names the rows
// use, and prints every row that no longer passes.
//
// app.js is SHARED BY LINE RANGE between terminals 6 and 7 in sweep #8, so this file only REPORTS.
// Which of the reds belong to which half is a judgement each terminal makes about its own rows —
// see the pass log at the top of .claude/sweep/LEDGER/T7.md.
//
//     node scripts/sweep/t7/rerun-t5.mjs
import fs from "node:fs";
const rd = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const has = (s, re) => re.test(s);
const count = (s, re) => (s.match(re) || []).length;

const app        = rd("public/panels/editor/app.js");
const html       = rd("public/panels/editor/index.html");
const css        = rd("public/panels/editor/style.css");
const fl         = rd("public/panels/floor-layouts.js");
const inv        = rd("public/panels/editor/inventory.js");
const undobar    = rd("public/panels/undobar.js");
const editorRoute= rd("app/api/editor/[...path]/route.ts");
const route      = editorRoute;
const kit        = rd("public/panels/kitchen/app.js");
const tab        = rd("public/panels/tablet/app.js");
const mgrPage    = rd("app/manager/page.tsx");
const mgrLayout  = rd("app/manager/layout.tsx");
const edPage     = rd("app/editor/page.tsx");
const doc        = rd("public/panels/billdoc.js");
const noComments = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\n)\s*\/\/[^\n]*/g, "$1");
const rej        = rd("docs/REJECTED-IDEAS.md");
const floorLay   = rd("lib/floorLayout.ts");
const bell       = rd("public/panels/guestbell.js");
const outbox     = rd("public/panels/outbox.js");
const sortmod    = rd("public/panels/auditsort.js");
const logTrail   = rd("lib/logTrail.ts");
const adminShared= rd("components/admin/shared.tsx");
const noCommentsFn = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\n)\s*\/\/[^\n]*/g, "$1");
const boardIvs = [...app.matchAll(/setInterval\([^,]*,\s*(\d+)\)/g)].map((m) => Number(m[1])).filter((v) => v >= 20000);
const printIv = 20000;

const md = rd(".claude/sweep/LEDGER/T5.md");
const lines = md.split("\n");
let ran = 0, pass = 0, fail = 0, err = 0;
const results = [];
for (let i = 0; i < lines.length; i++) {
  const L = lines[i];
  const m = L.match(/^\| (P\d{5}) \| (.*?) \| read the shipped files? · (.*?) \| (✅|❌|⏭|[^|]*) \|(.*)\|\s*$/);
  if (!m) continue;
  const [, id, title, exprRaw, prev] = m;
  if (!/\bapp\b/.test(exprRaw)) continue;           // only rows asserting against app.js
  let expr = exprRaw.replace(/¦/g, "|");
  expr = expr.replace(/noComments\(app\)/g, "noCommentsFn(app)");
  ran++;
  let ok, e = null;
  try {
    // eslint-disable-next-line no-new-func
    ok = Function("rd,has,count,app,html,css,fl,inv,undobar,editorRoute,route,kit,tab,mgrPage,mgrLayout,edPage,doc,noComments,boardIvs,printIv,rej,floorLay,bell,outbox,sortmod,logTrail,adminShared,noCommentsFn",
      "return (" + expr + ");")(rd,has,count,app,html,css,fl,inv,undobar,editorRoute,route,kit,tab,mgrPage,mgrLayout,edPage,doc,noComments,boardIvs,printIv,rej,floorLay,bell,outbox,sortmod,logTrail,adminShared,noCommentsFn);
  } catch (ex) { e = ex.message; }
  const verdict = e ? "ERR" : (ok ? "PASS" : "FAIL");
  if (verdict === "PASS") pass++; else if (verdict === "FAIL") fail++; else err++;
  results.push({ id, line: i + 1, title: title.trim(), verdict, prev: prev.trim(), e, expr });
}
console.log(`rows asserting app.js: ${ran}   PASS ${pass}   FAIL ${fail}   ERR ${err}`);
for (const r of results) if (r.verdict !== "PASS") console.log(`  ${r.verdict}  ${r.id} (T5.md:${r.line})  ${r.title}${r.e ? "  [" + r.e + "]" : ""}`);
fs.writeFileSync((process.env.TMPDIR || "/tmp") + "/t7-rerun-t5.json", JSON.stringify(results, null, 1));
