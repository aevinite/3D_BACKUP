// scripts/sweep/t1s10/run.mjs — runs sweep #10 T1's checks and prints (or saves) one result per ledger id.
//
//   node scripts/sweep/t1s10/run.mjs                       every suite
//   node scripts/sweep/t1s10/run.mjs --suite rerun-a       one suite (file name without .mjs)
//   node scripts/sweep/t1s10/run.mjs --only P00001,P00002  only these ids
//   node scripts/sweep/t1s10/run.mjs --json out.json       also write [{ id, file, title, mark, note, ms }]
//
// A check returns true/false, { ok, note }, or "skip: <why>". Throwing is red, with the message as the note.
// Browser suites need the app on T1_BASE (default http://localhost:4401 — never :4000, the owner's window).
import { writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ROWS } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : null; };
const suiteArg = arg("suite"), onlyArg = arg("only"), jsonArg = arg("json");
const only = onlyArg ? new Set(onlyArg.split(",").map((s) => s.trim())) : null;

const suites = readdirSync(HERE).filter((f) => /^(rerun|new)-.*\.mjs$/.test(f)).sort()
  .filter((f) => !suiteArg || suiteArg.split(",").includes(f.replace(/\.mjs$/, "")));
for (const f of suites) await import(pathToFileURL(join(HERE, f)).href);

// A browser route handler left running after its page closed must not take the whole run down with it.
process.on("unhandledRejection", (e) => console.log(`  (an unawaited browser callback failed and was ignored: ${String(e?.message || e).slice(0, 90)})`));
const out = [];
let pass = 0, fail = 0, skip = 0;
const seen = new Set();
for (const r of ROWS) {
  if (only && !only.has(r.id)) continue;
  if (seen.has(r.id)) { console.log(`  ⚠ duplicate id in the harness: ${r.id}`); fail++; continue; }
  seen.add(r.id);
  const t0 = Date.now();
  let mark = "❌", note = "";
  try {
    const v = await r.fn();
    if (typeof v === "string" && v.startsWith("skip:")) { mark = "⏭"; note = v.slice(5).trim(); }
    else if (v && typeof v === "object" && "ok" in v) { mark = v.ok ? "✅" : "❌"; note = v.note || ""; }
    else { mark = v ? "✅" : "❌"; }
  } catch (e) { mark = "❌"; note = `threw: ${String(e?.message || e).slice(0, 240)}`; }
  if (mark === "✅") pass++; else if (mark === "⏭") skip++; else fail++;
  out.push({ id: r.id, file: r.file, title: r.title, how: r.how || "", mark, note: String(note).replace(/\s+/g, " ").slice(0, 300), ms: Date.now() - t0 });
  if (mark !== "✅") console.log(`  ${mark} ${r.id}  ${r.file} — ${r.title}${note ? `  ‖ ${note}` : ""}`);
}
console.log(`\n${pass} ✅ · ${fail} ❌ · ${skip} ⏭   (${out.length} checks, suites: ${suites.join(", ")})`);
if (jsonArg) writeFileSync(jsonArg, JSON.stringify(out, null, 1));
process.exitCode = fail ? 1 : 0;
// browser suites keep a Chromium open; let them close it
const { closeAll } = await import("./browser.mjs").catch(() => ({}));
if (closeAll) await closeAll();
// a page promise left in a cache can hold the event loop open — end the run explicitly
process.exit(process.exitCode ?? 0);
