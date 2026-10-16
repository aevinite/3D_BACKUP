// scripts/sweep/t1s10/rerun-r3s.mjs — the nine round-3 sabotage rows that need a REBUILD, reported from the result
// file sab-r3.mjs writes (it rebuilds the app with the breaks in, runs verify:notfound, and puts every file back).
//   node scripts/sweep/t1s10/sab-r3.mjs <out.json>   then   T1_SAB_JSON=<out.json> node run.mjs --suite rerun-r3s
import { readFileSync, existsSync } from "node:fs";
import { R, ok, oldRows } from "./lib.mjs";
const J = process.env.T1_SAB_JSON;
const res = J && existsSync(J) ? JSON.parse(readFileSync(J, "utf8")) : null;
const FILE = { P97737: "app/not-found.tsx", P97738: "app/not-found.tsx", P97739: "components/GuestNotFound.tsx", P97740: "app/not-found.tsx", P97741: "app/not-found.tsx", P97768: "middleware.ts", P97769: "middleware.ts", P97770: "middleware.ts", P97778: "middleware.ts" };
for (const id of Object.keys(FILE)) R(id, FILE[id], oldRows(id, id)[0]?.check || id, () => {
  if (!res) return "skip: run scripts/sweep/t1s10/sab-r3.mjs first (it rebuilds the app with the sabotage in)";
  const r = res[id];
  return ok(r && r.code > 0 && r.hit && res.restored, r ? `exit ${r.code}, the named check failed; every file put back: ${res.restored}` : "no result");
}, id.startsWith("P977") && Number(id.slice(1)) >= 97768 ? "sabotage the middleware, run verify:notfound, restore (the guard reads the file itself)" : "sabotage, REBUILD, run verify:notfound --base :4401, restore — scripts/sweep/t1s10/sab-r3.mjs");
