// "Is anything actually answering?" — the one preflight every guard that needs a running app uses.
//
// WHY (T10 sweep, 2026-08-12). Nine guards need something answering on a base URL. With nothing
// running, they behaved nine different ways. Two examples, both real:
//
//   verify:cache      →  Verdict: FAIL
//                        ⚠️  Driver exception: page.goto: net::ERR_CONNECTION_REFUSED …
//   verify:skin-ink   →  node:internal/modules/run_main:107
//                            triggerUncaughtException(
//                        page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:4000/aevinite
//
// The second reads as "this guard is broken", not "start the dev server" — so the honest reaction
// to it is to stop trusting the tooling, which is the opposite of what a guard is for. A person
// should never have to know which of nine scripts words it which way.
//
// Use it as the first line of any script that drives a browser or fetches a page:
//
//     import { requireAppUp } from "./sweep/appUp.mjs";
//     const BASE = await requireAppUp(process.argv);   // exits 2 with a plain message if nothing is up
//
// It exits 2 — not 1 — so a runner can tell "could not run" apart from "ran and found a fault".
// That distinction matters: a chain treating "no server" as a failure is how a green suite and a
// suite that never ran look identical.

const DEFAULT_LOCAL = "http://localhost:4000";
const DEPLOYED = "https://3-d-backup.vercel.app";

/** The base URL a script should use: `--base <url>`, then $LFH_BASE, then localhost:4000. */
export function baseFrom(argv = process.argv) {
  const i = argv.indexOf("--base");
  if (i >= 0 && argv[i + 1]) return argv[i + 1].replace(/\/$/, "");
  if (process.env.LFH_BASE) return process.env.LFH_BASE.replace(/\/$/, "");
  return DEFAULT_LOCAL;
}

/** True if something answers at all — any HTTP status counts; we are asking "is it listening". */
export async function isUp(base, ms = 4000) {
  try {
    const r = await fetch(base + "/api/health", { signal: AbortSignal.timeout(ms) });
    return r.status > 0;
  } catch {
    try {
      const r = await fetch(base, { signal: AbortSignal.timeout(ms) });
      return r.status > 0;
    } catch { return false; }
  }
}

/**
 * Resolve the base URL and refuse, in plain words, if nothing is answering.
 * Returns the base so the caller can use it directly.
 */
export async function requireAppUp(argv = process.argv, what = "this check drives the real app") {
  const base = baseFrom(argv);
  if (await isUp(base)) return base;

  const local = base === DEFAULT_LOCAL;
  console.error(
    `\nNothing is answering at ${base}, so ${what} cannot run.\n` +
      (local
        ? `  · start it:      npm run dev        (it serves on 4000, not 3000)\n` +
          `  · or point it at the deployed site:\n` +
          `                   npm run <this script> -- --base ${DEPLOYED}\n`
        : `  · check the URL, or use the deployed site: --base ${DEPLOYED}\n`) +
      `\nThis is NOT a fault in the app and NOT a fault in this guard — nothing was checked.\n`,
  );
  process.exit(2);
}
