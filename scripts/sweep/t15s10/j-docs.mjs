// Bank J · the three printing documents, checked against TODAY's code: every path and script they name
// exists, the numbers they quote are the numbers in the code, and nothing retired is taught as current.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chk, assert, src, ROOT } from "./lib.mjs";

const DOCS = ["docs/KITCHEN-PRINT-SETUP.md", "docs/PRINT-HELPER.md", "docs/PRINT-TEST-PLAN.md"];
const H = "read the document against the tree and package.json";
const pkg = JSON.parse(src("package.json")).scripts;
const text = Object.fromEntries(DOCS.map((d) => [d, src(d)]));
// A retired thing may be NAMED (the documents are histories) — it must not be taught in the present
// tense. A line counts as historical if it, or the heading it sits under, says so.
const linesOf = (d) => text[d].split("\n");
const HIST = /deleted|retired|gone|removed|used to|was |were |replaced|no longer|until 20|before 20|old |obituary|REJECTED|instead of|not "|never|history|HISTORY|~~|dropped|there is no|isn't|is not|did not|didn't|(19|20)\d\d-\d\d-\d\d/i;

const pathsIn = (d) => [...new Set([...text[d].matchAll(/`((?:app|lib|scripts|public|docs|supabase|components)\/[^`\s*]+?)`/g)].map((m) => m[1].replace(/[:#].*$/, "").replace(/[),.;]+$/, "")))];
let n = 481;
for (const d of DOCS) {
  await chk(`P184${n++}`, d, "every code path it names in backticks exists, or is named as deleted on its own line", H, () => {
    const missing = pathsIn(d).filter((p) => !existsSync(join(ROOT, p)) && !existsSync(join(ROOT, p.replace(/\/$/, ""))))
      .filter((p) => !linesOf(d).some((l) => l.includes(p) && HIST.test(l)));
    assert(missing.length === 0, missing.join(", ")); return `${pathsIn(d).length} paths resolved`;
  });
  await chk(`P184${n++}`, d, "every npm script it names is in package.json", H, () => {
    const named = [...new Set([...text[d].matchAll(/npm run ([a-z][\w:-]+)/g)].map((m) => m[1]).concat([...text[d].matchAll(/`(verify:[\w-]+)`/g)].map((m) => m[1])))];
    const missing = named.filter((s) => !pkg[s]).filter((s) => !linesOf(d).some((l) => l.includes(s) && HIST.test(l)));
    assert(missing.length === 0, missing.join(", ")); return `${named.length} scripts named`;
  });
}
// A line is HISTORY when its paragraph says so, or when it sits under a dated / migration heading
// (the documents are changelogs: "## 2026-09-13 — …" sections describe what was true THEN). Only the
// undated reference sections are held to "describes today".
const teach = (d, re) => {
  const out = []; let head = "", top = "", para = [];
  const flush = () => { const p = para.join("\n"); for (const l of para) if (re.test(l) && !HIST.test(p) && !/(19|20)\d\d-\d\d-\d\d|\(mig \d+\)|mig \d+/.test(head + " " + top)) out.push(l); para = []; };
  for (const l of linesOf(d)) { if (/^#{1,4} /.test(l)) { flush(); head = l; if (/^#{1,2} /.test(l)) top = l; continue; } if (!l.trim()) { flush(); continue; } para.push(l); }
  flush(); return out;
};
for (const d of ["docs/KITCHEN-PRINT-SETUP.md", "docs/PRINT-HELPER.md"]) {
  await chk(`P184${n++}`, d, "it does not teach the retired printing MODE toggle as current (mig 372)", H, () => { const t = teach(d, /mode toggle|printing\.mode|pick(s)? (a|the) mode|switch(ing)? modes?\b/i); assert(!t.length, t.join(" ⏎ ").slice(0, 300)); });
  await chk(`P184${n++}`, d, "it does not teach the Allow-page handshake (pair/start, pair/poll, /pair) as current (mig 380)", H, () => { const t = teach(d, /pair\/start|pair\/poll|press(es)? Allow/i); assert(!t.length, t.join(" ⏎ ").slice(0, 300)); });
  await chk(`P184${n++}`, d, "it does not teach a backup printer as current (owner, 2026-08-30)", H, () => { const t = teach(d, /backup printer|backupFor|the counter is the backup/i); assert(!t.length, t.join(" ⏎ ").slice(0, 300)); });
}
const PH = text["docs/PRINT-HELPER.md"];
await chk(`P184${n++}`, "docs/PRINT-HELPER.md", "the poll interval it quotes (2 s) is the route's POLL_MS", H, () => assert(/POLL_MS = 2000/.test(src("app/api/print-agent/[...path]/route.ts")) && /\b2 ?s(econds?)?\b|two seconds|every 2/i.test(PH)));
await chk(`P184${n++}`, "docs/PRINT-HELPER.md", "the setup code's life it quotes (ten minutes) is SETUP_CODE_TTL_MS", H, () => assert(/SETUP_CODE_TTL_MS = 10 \* 60_000/.test(src("lib/printSetupCode.ts")) && /ten minutes|10 min/i.test(PH)));
await chk(`P184${n++}`, "docs/PRINT-HELPER.md", "'connected = heard from in 30 s' matches HELPER_STALE_MS", H, () => assert(/HELPER_STALE_MS = 30_000/.test(src("lib/printHelpers.ts")) && /thirty seconds|30 ?s/i.test(PH)));
await chk(`P184${n++}`, "docs/PRINT-HELPER.md", "'gives up after five tries' matches both failure paths", H, () => assert(/attempts >= 5/.test(src("lib/printQueue.ts")) && /attempts \+ 1 >= 5/.test(src("app/api/print-agent/[...path]/route.ts")) && /five|5 tries|5 attempts/i.test(PH)));
await chk(`P184${n++}`, "docs/PRINT-HELPER.md", "the verbs it lists are the route's verbs (hello · next · document · done · failed · pair/claim)", H, () => {
  for (const v of ["hello", "next", "document", "done", "failed", "pair/claim"]) assert(PH.includes(v), v);
});
await chk(`P184${n++}`, "docs/PRINT-HELPER.md", "it says the token is stored only as a hash, which is what the code does", H, () => assert(/hash/i.test(PH) && /token_hash: hash/.test(src("lib/printHelpers.ts"))));
await chk(`P184${n++}`, "docs/PRINT-HELPER.md", "it still explains the four ticks (the whole mental model)", H, () => assert(/four ticks/i.test(PH)));
const KS = text["docs/KITCHEN-PRINT-SETUP.md"];
await chk(`P184${n++}`, "docs/KITCHEN-PRINT-SETUP.md", "it tells nobody to DOWNLOAD a setup script (the standing by-hand rule)", H, () => { const t = teach("docs/KITCHEN-PRINT-SETUP.md", /download (the|a|this) (setup |starter )?(script|file|launcher)/i); assert(!t.length, t.join(" ⏎ ").slice(0, 300)); });
await chk(`P184${n++}`, "docs/KITCHEN-PRINT-SETUP.md", "it points at the guide the app actually links (/print-setup.html)", H, () => assert(KS.includes("/print-setup.html")));
await chk(`P184${n++}`, "docs/KITCHEN-PRINT-SETUP.md", "it keeps the AV-live section (a printing change is never assumed to be on the client site)", H, () => assert(/## 6\. AV LIVE/.test(KS)));
const TP = text["docs/PRINT-TEST-PLAN.md"];
await chk(`P184${n++}`, "docs/PRINT-TEST-PLAN.md", "every guard in its section C exists today", H, () => {
  const named = [...TP.matchAll(/verify:([\w-]+)/g)].map((m) => "verify:" + m[1]); const missing = [...new Set(named)].filter((s) => !pkg[s]); assert(!missing.length, missing.join(", "));
});
await chk(`P184${n++}`, "docs/PRINT-TEST-PLAN.md", "it says plainly it is dated (2026-08-19) so nobody reads its 26/26 as today's result", H, () => assert(/\(2026-08-19\)/.test(TP.split("\n")[0])));
