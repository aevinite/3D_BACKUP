// scripts/sweep/t13s10/hooks.mjs — COVERAGE MODE for terminal 13's harness (round 2).
//
// The normal harness bundles each file with esbuild, so V8's coverage would land on the bundle, not on
// the source. Here the REAL .ts files are imported (Node strips the types in place, so a character
// offset is an offset into the file) and the same four stand-ins are swapped in by name.
//   T13_COVERAGE=1 node --import ./scripts/sweep/t13s10/hooks.mjs scripts/sweep/t13s10/run.mjs
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join } from "node:path";
import { existsSync } from "node:fs";

const root = fileURLToPath(new URL("../../..", import.meta.url)).replace(/\/$/, "");
const STUB = {
  "@/lib/supabaseAdmin": join(root, "scripts/sweep/t13s10/stubs/sb.mjs"),
  "@/lib/userAuth": join(root, "scripts/sweep/t13s10/stubs/userAuth.mjs"),
  "@/lib/oplog": join(root, "scripts/sweep/t13s10/stubs/oplog.mjs"),
  "@/lib/alerts": join(root, "scripts/sweep/t13s10/stubs/alerts.mjs"),
};
registerHooks({
  resolve(spec, ctx, next) {
    if (STUB[spec]) return { url: pathToFileURL(STUB[spec]).href, shortCircuit: true };
    if (spec.startsWith("@/")) {
      let q = join(root, spec.slice(2));
      if (!existsSync(q)) for (const e of [".ts", ".tsx", ".js", ".mjs"]) if (existsSync(q + e)) { q += e; break; }
      return next(pathToFileURL(q).href, ctx);
    }
    try { return next(spec, ctx); } catch (e) {
      for (const suf of [".js", ".ts", "/index.ts", "/index.js"]) { try { return next(spec + suf, ctx); } catch { /* next suffix */ } }
      throw e;
    }
  },
});
