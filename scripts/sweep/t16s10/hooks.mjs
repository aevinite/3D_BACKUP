// scripts/sweep/t16s10/hooks.mjs — load MY route files in Node with no bundle, for coverage.
//
//   T16_NODE_ROUTES=1 node --import ./scripts/sweep/t16s10/hooks.mjs scripts/sweep/t16s10/run.mjs …
//
// routes.mjs normally bundles each route with esbuild; under T16_NODE_ROUTES it imports the .ts file
// itself through these hooks instead, so V8's coverage offsets are offsets into the file a person
// reads (Node strips types by blanking them). The aliases are EXACTLY the bundle's (routes.mjs), so a
// check means the same thing either way. Nothing leaves the Mac. Pattern: scripts/sweep/t9s10/hooks.mjs.
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join } from "node:path";
import { existsSync } from "node:fs";

const root = fileURLToPath(new URL("../../..", import.meta.url)).replace(/\/$/, "");
const STUB = {
  "@/lib/supabaseAdmin": "scripts/panel-stubs/sb.mjs",
  "@/lib/userAuth": "scripts/sweep/t16s10/stubs/userAuth.mjs",
  "@/lib/oplog": "scripts/panel-stubs/oplog.mjs",
  "@/lib/alerts": "scripts/sweep/t16s10/stubs/alerts.mjs",
  "@/lib/tenant": "scripts/sweep/t16s10/stubs/tenant.mjs",
  "@/lib/panelAccess": "scripts/sweep/t16s10/stubs/panelAccess.mjs",
  "@/lib/ownerScope": "scripts/sweep/t16s10/stubs/ownerScope.mjs",
  "@/lib/ownerEntitlements": "scripts/sweep/t16s10/stubs/ownerEntitlements.mjs",
  "next/server": "scripts/sweep/t16s10/stubs/next-server.mjs",
};
registerHooks({
  resolve(spec, ctx, next) {
    if (STUB[spec]) return { url: pathToFileURL(join(root, STUB[spec])).href, shortCircuit: true };
    // A mutation run (./mutate.mjs) of a lib file: "@/lib/x" resolves to the broken copy.
    if (process.env.T16_MUT_REL && spec.startsWith("@/") && process.env.T16_MUT_REL.replace(/\.ts$/, "") === spec.slice(2))
      return { url: pathToFileURL(process.env.T16_MUT).href, shortCircuit: true };
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
