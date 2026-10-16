// Assembles terminal 20's re-run results from what the harnesses PRINTED — never typed by hand.
//
//   node scripts/sweep/t20s10/collect-reruns.mjs --out=<results.json> <harness-output.txt>… [--after=<output.txt>]… [--override=<json>]…
//
// --after= outputs are the SAME bands run again after this run's fixes. For an id they cover, the
// after-result stands, and a row that was red before and green after says so in its note.
//
// Each harness output (sweep #8 T13's scripts, run with T13_DUMP_IDS=1) lists every executed id as a
// `MAP` line and every failure / skip under it. An id run twice (live.mjs as the one- and the
// two-restaurant owner) is ✅ only if every run passed. An --override file (the re-proofs, written by
// reprove-*.mjs) replaces a harness result for the ids it names, and says why in its own note.
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const outFile = args.find((a) => a.startsWith("--out="))?.slice(6);
const overrides = args.filter((a) => a.startsWith("--override=")).map((a) => a.slice(11));
const inputs = args.filter((a) => !a.startsWith("--"));
const afters = args.filter((a) => a.startsWith("--after=")).map((a) => a.slice(8));
const res = new Map();
const put = (id, ok, note) => {
  const prev = res.get(id);
  if (!prev) return res.set(id, { id, ok, note });
  if (prev.ok === false) return;                     // a failure in any run stands
  if (ok === false || (ok === null && prev.ok === true)) res.set(id, { id, ok, note });
  else if (ok === true && prev.ok === true && !prev.note.includes(note)) prev.note = `${prev.note}; ${note}`;
};
function parse(f, put) {
  const t = readFileSync(f, "utf8");
  const label = (t.match(/\n([^\n]*): \d+ passed · \d+ failed/) || [, f.split("/").pop()])[1].trim();
  const bad = new Map();
  for (const m of t.matchAll(/^\s+(❌|⏭)\s+(P\d+)\s+[^\n]*\n\s+([^\n]*)/gm)) bad.set(m[2], { ok: m[1] === "❌" ? false : null, why: m[3].trim() });
  const ran = [...t.matchAll(/^MAP\t(P\d+)\t/gm)].map((m) => m[1]);
  if (!ran.length) { console.error(`no MAP lines in ${f} — was it run with T13_DUMP_IDS=1?`); process.exit(2); }
  for (const id of new Set(ran)) {
    const b = bad.get(id);
    put(id, b ? b.ok : true, b ? `${b.why} [${label}]` : `passes on today's code [${label}]`);
  }
}
for (const f of inputs) parse(f, put);
if (afters.length) {
  const before = new Map([...res].map(([k, v]) => [k, { ...v }]));
  const after = new Map();
  const putA = (id, ok, note) => { const p = after.get(id); if (!p || (p.ok !== false && ok === false)) after.set(id, { id, ok, note }); };
  for (const f of afters) parse(f, putA);
  for (const [id, a] of after) {
    const b = before.get(id);
    const note = b && b.ok === false && a.ok === true
      ? `red on the first re-run today (${b.note.slice(0, 140)}); GREEN after this run's fixes [${a.note.replace(/^passes on today's code /, "")}]`
      : a.note;
    res.set(id, { id, ok: a.ok, note });
  }
}
for (const o of overrides) for (const r of JSON.parse(readFileSync(o, "utf8"))) res.set(r.id, { id: r.id, ok: r.ok, note: r.note });
const all = [...res.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
writeFileSync(outFile, JSON.stringify(all, null, 1));
console.log(`${all.length} ids · ${all.filter((r) => r.ok === true).length} ✅ · ${all.filter((r) => r.ok === false).length} ❌ · ${all.filter((r) => r.ok === null).length} ⏭`);
for (const r of all.filter((x) => x.ok === false)) console.log(`  ❌ ${r.id} ${r.note.slice(0, 150)}`);
