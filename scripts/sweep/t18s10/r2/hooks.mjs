// scripts/sweep/t18s10/r2/hooks.mjs — load the REAL lib/*.ts files of sweep #10 terminal 18's territory
// in Node, with no bundle, so V8 coverage offsets are offsets into the files a person reads (Node strips
// TypeScript types by blanking them — every character keeps its position).
//
//   node --import ./scripts/sweep/t18s10/r2/hooks.mjs scripts/sweep/t18s10/r2/run.mjs
//
// Swapped for in-memory stand-ins (driven through globalThis.__t18): the database client, the admin
// cookie check, the payroll ladder, and lib/features.ts's two neighbours (./menu, ./tenant). Nothing
// else is faked. `fetch` is refused so nothing can leave the Mac.
//
// MUTATION RUNS: when T18_LIB_DIR is set, `@/lib/<name>` resolves to <T18_LIB_DIR>/<name>.ts if that
// copy exists — so one mutated file (and its siblings, copied beside it) replaces the real one.
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";

const root = fileURLToPath(new URL("../../../..", import.meta.url)).replace(/\/$/, "");
const here = dirname(fileURLToPath(import.meta.url));
const COPY = process.env.T18_LIB_DIR || "";
const STUB = {
  "@/lib/supabaseAdmin": join(here, "stubs/sb.mjs"),
  "@/lib/staffAuth": join(here, "stubs/staffAuth.mjs"),
  "@/lib/tableTags": join(here, "stubs/tableTags.mjs"),
};
const LOCAL_STUB = { "./menu": join(here, "stubs/menu.mjs"), "./tenant": join(here, "stubs/tenant.mjs"), react: join(here, "stubs/react.mjs") };
const pick = (p) => { if (existsSync(p)) return p; for (const e of [".ts", ".tsx", ".js", ".mjs"]) if (existsSync(p + e)) return p + e; return p; };
registerHooks({
  resolve(spec, ctx, next) {
    if (STUB[spec]) return { url: pathToFileURL(STUB[spec]).href, shortCircuit: true };
    if (LOCAL_STUB[spec] && ctx.parentURL && /\/features\.ts$/.test(ctx.parentURL)) return { url: pathToFileURL(LOCAL_STUB[spec]).href, shortCircuit: true };
    if (spec.startsWith("@/")) {
      const rel = spec.slice(2);
      if (COPY && rel.startsWith("lib/")) { const c = pick(join(COPY, rel.slice(4))); if (existsSync(c)) return { url: pathToFileURL(c).href, shortCircuit: true }; }
      return next(pathToFileURL(pick(join(root, rel))).href, ctx);
    }
    try { return next(spec, ctx); } catch (e) {
      for (const suf of [".ts", ".js", "/index.ts", "/index.js"]) { try { return next(spec + suf, ctx); } catch { /* next */ } }
      throw e;
    }
  },
});
// The in-memory blocks must never reach the network. Only block G (driven on purpose) takes it back.
globalThis.__t18RealFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("t18 r2: the network is refused in this harness"); };
