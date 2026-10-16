// scripts/sweep/t2s10/classify.mjs — sweep #10 T2: sort every older ledger row on this territory into
// "its code is untouched since it was last proved" and "its code moved, re-check it by hand".
//
// WHY. T2.md alone holds ~3,600 rows, all last proved green against main 6b8ae9dc (sweep #9 T2,
// 2026-09-15). Since then three of the files changed (ViewerClient +360, ItemClient +49, PMV +15) and
// app/globals.css took 874 lines. A row is only "still true by construction" if NONE of the code it
// names sits in a changed hunk. This finds, per row, the backticked identifiers it names, locates
// each in the BASELINE version of its subject file, and asks whether any of those lines changed.
//   node scripts/sweep/t2s10/classify.mjs   → node_modules/.cache/t2s10/classify.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LEDGER = process.env.T2_LEDGER_DIR || join(ROOT, ".claude/sweep/LEDGER");
const BASE = "6b8ae9dc";
const git = (...a) => execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8", maxBuffer: 64 << 20 });
export const OWNED = {
  "lib/modelLoader.ts": /modelLoader|model loader|loader's|the loader|\bloader\b|MAX_BYTES|evict|retryFailedOnReconnect|stopAll|prioritize|setQueue/i,
  "components/PublicModelViewer.tsx": /PublicModelViewer|PMV|model-viewer|<model-viewer>|hotspot|hs-|data-position|crossOrigin/i,
  "app/view/[folder]/ViewerClient.tsx": /ViewerClient|3D screen|viewer|\/view\/|runFullSequence|reveal|AR VIEW|ar-status|dbl-hint|#bar|try-again/i,
  "app/view/[folder]/page.tsx": /view\/\[folder\]\/page|lfh_tab_tenant|3D View —|generateMetadata.*view/i,
  "app/item/[slug]/ItemClient.tsx": /ItemClient|dish page|detail-|item-addbar|lightbox|review|favou?rite|related|dish-nav-strip/i,
  "app/item/[slug]/page.tsx": /app\/item\/\[slug\]\/page|legacy \/item|restaurant #1's door|\/item\/</i,
  "app/r/[restaurant]/item/[slug]/page.tsx": /r\/\[restaurant\]\/item|tenant door|\/r\/<slug>\/item|slugMovedTo/i,
  "app/item/[slug]/not-found.tsx": /not-found|404/i,
  "components/ModelToastHost.tsx": /ModelToastHost|ready to view|3D unavailable/i,
  "lib/modelWatchlist.ts": /modelWatchlist|watchlist/i,
  "lib/mediaLinks.ts": /mediaLinks|signRows|signOne|pathOf/i,
};
const CHANGED = ["app/view/[folder]/ViewerClient.tsx", "app/item/[slug]/ItemClient.tsx", "components/PublicModelViewer.tsx", "app/globals.css", "public/content/items/Croissant/config.json", "public/content/items/Waffle/config.json"];
// Lines of the BASELINE file that a later commit deleted or rewrote.
function touchedLines(file) {
  const d = git("diff", "-U0", BASE, "HEAD", "--", file);
  const s = new Set();
  for (const m of d.matchAll(/^@@ -(\d+)(?:,(\d+))? /gm)) {
    const a = +m[1], n = m[2] === undefined ? 1 : +m[2];
    for (let i = a; i < a + n; i++) s.add(i);
    if (n === 0) { s.add(a); s.add(a + 1); } // a pure insertion next to these lines
  }
  return s;
}
const baseSrc = {}, touched = {}, nowSrc = {};
for (const f of [...Object.keys(OWNED), "app/globals.css"]) {
  try { baseSrc[f] = git("show", `${BASE}:${f}`).split("\n"); } catch { baseSrc[f] = []; }
  try { nowSrc[f] = readFileSync(join(ROOT, f), "utf8"); } catch { nowSrc[f] = ""; }
  touched[f] = CHANGED.includes(f) ? touchedLines(f) : new Set();
}
export function rows(file) {
  return readFileSync(join(LEDGER, file), "utf8").split("\n").map((l, i) => ({ l, i })).filter(({ l }) => /^\| P\d+ \|/.test(l)).map(({ l, i }) => {
    const c = l.split(/(?<!\\)\|/).slice(1, -1).map((x) => x.trim());
    return { ledger: file, line: i, id: c[0], check: c[1] || "", how: c[2] || "", result: c[3] || "", note: c.slice(4).join(" | ") };
  });
}
const tokensOf = (r) => [...new Set([...(r.check + " " + r.how).matchAll(/`([^`]{3,80})`/g)].map((m) => m[1].trim()))];
export function classify(r) {
  const text = `${r.check} ${r.how}`;
  const subjects = Object.keys(OWNED).filter((f) => text.includes(f.split("/").pop().replace(/\.tsx?$/, "")) || OWNED[f].test(text));
  const toks = tokensOf(r);
  const hits = [];
  const cssy = /stylesheet|CSS|class|rule|selector|globals\.css/i.test(text);
  for (const f of [...subjects, ...(cssy ? ["app/globals.css"] : [])]) {
    for (const t of toks) {
      if (f === "app/globals.css" && !/^[.#]?[a-z][a-z0-9-]*-[a-z0-9-]+$|^[.#][a-z][a-z0-9-]+$/i.test(t)) continue;
      if (t.length < 4) continue;
      const probe = t.replace(/^\./, "").slice(0, 60);
      baseSrc[f].forEach((ln, k) => { if (probe.length >= 3 && ln.includes(probe)) hits.push({ f, t, line: k + 1, touched: touched[f].has(k + 1), alive: nowSrc[f].includes(probe) }); });
    }
  }
  const moved = hits.filter((h) => h.touched);
  const gone = toks.filter((t) => hits.some((h) => h.t === t) && !hits.some((h) => h.t === t && h.alive));
  const onChangedFile = subjects.some((f) => CHANGED.includes(f));
  let cls;
  if (gone.length) cls = "GONE";          // a token it names no longer exists in its file
  else if (moved.length) cls = "MOVED";   // a token it names sits on a line a later commit rewrote
  else if (onChangedFile && !toks.length) cls = "CHANGED-FILE-NO-TOKENS";
  else cls = "UNTOUCHED";
  return { id: r.id, ledger: r.ledger, subjects, toks: toks.length, cls, moved: moved.slice(0, 4).map((h) => `${h.f.split("/").pop()}:${h.line} ${h.t}`), gone };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = (process.argv[2] || "T2.md").split(",");
  const out = files.flatMap((f) => rows(f).map(classify));
  const tally = {}; for (const o of out) tally[o.cls] = (tally[o.cls] || 0) + 1;
  mkdirSync(join(ROOT, "node_modules/.cache/t2s10"), { recursive: true });
  writeFileSync(join(ROOT, "node_modules/.cache/t2s10/classify.json"), JSON.stringify(out, null, 1));
  console.log(out.length, "rows", JSON.stringify(tally));
}
