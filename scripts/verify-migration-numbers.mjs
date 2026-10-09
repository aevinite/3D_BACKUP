// verify-migration-numbers.mjs — the migrations FOLDER, judged with no database (sweep #10 T39 item 49).
//
// Two sessions working at once can each write "the next" migration under the same number. On
// 2026-10-08 sweep #10's T17 and T39 both took 411; the second to merge renamed theirs, and the hole
// it left (412) was noticed only because somebody ran verify:grants by hand — that file talks to the
// database, so no automatic step can run it. The folder rules themselves need nothing but the files,
// so this runs exactly those, from verify-db-grants.mjs (one copy of the rules, not two):
//   · no NEW pair of files sharing a number (the known historical pairs are listed, with reasons);
//   · a pair that declares the same function/trigger/table/view must say why that is safe;
//   · no NEW hole in the sequence (the known ones are listed, with reasons).
// Part of verify:static, so it runs on every change.
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const r = spawnSync(process.execPath, [join(here, "verify-db-grants.mjs"), "--files-only", ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
