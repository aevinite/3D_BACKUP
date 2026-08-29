// scripts/sweep/repoRoot.mjs — WHICH FOLDER IS THE REPO? (never "the first thing on the command line")
//
// WHY (T28, sweep #7, 2026-08-29). Eight static guards took `process.argv[2]` as the repo to scan,
// so they could be pointed at another checkout — a genuinely useful thing, and the release script
// uses it. But every sweep lane hands EVERY guard its own port:
//
//     npm run verify:taps -- --base http://localhost:4228
//
// …and those eight then scanned a folder called "--base", found nothing, and exited 1. Watched it
// happen on verify:taps: `path: '--base/public/panels/editor/app.js'`. A guard that goes red
// because of an argument it does not even use is a guard people learn to scroll past — and this
// suite's whole value is that a red means something.
//
// The fix is not to ban the argument. It is to ask the DISK which of the arguments is a repo,
// because that cannot be argued with: a repo root is a folder with `scripts/` in it.
//
//     import { repoRootFrom } from "./sweep/repoRoot.mjs";
//     const ROOT = repoRootFrom(import.meta.url);
//
// Every existing use keeps working — `node scripts/verify-taps.mjs /some/other/checkout` still
// scans that checkout, because that path IS a folder with scripts/ in it.
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** A folder is a repo root if it has a scripts/ directory. */
export const isRepoRoot = (p) => { try { return !!p && existsSync(join(p, "scripts")); } catch { return false; } };

/**
 * The repo to work on: the first command-line argument that really is one, else the repo this
 * script lives in. `metaUrl` is `import.meta.url` from the calling guard.
 */
export function repoRootFrom(metaUrl, argv = process.argv) {
  for (const a of argv.slice(2)) {
    if (a.startsWith("-")) continue;          // a flag is never a folder
    if (isRepoRoot(a)) return a;
  }
  return join(dirname(fileURLToPath(metaUrl)), "..");
}
