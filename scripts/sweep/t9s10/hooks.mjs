// scripts/sweep/t9s10/hooks.mjs — load the REAL app/api/editor/[...path]/route.ts in Node, no bundle.
//
//   node --import ./scripts/sweep/t9s10/hooks.mjs …
//
// Why not the esbuild bundle the rest of this harness uses: coverage has to point at the lines of
// the file a person reads. Node strips TypeScript types by blanking them, so every character keeps
// its position and V8's coverage offsets ARE offsets into route.ts. (Pattern from
// scripts/t17-harness/hooks.mjs; this one maps the database, sign-in and diary to the SAME panel
// stubs the bundle uses, so a check means the same thing either way.) Nothing leaves the Mac.
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join } from "node:path";
import { existsSync } from "node:fs";

const root = fileURLToPath(new URL("../../..", import.meta.url)).replace(/\/$/, "");
const STUB = {
  "@/lib/supabaseAdmin": join(root, "scripts/panel-stubs/sb.mjs"),
  "@/lib/userAuth": join(root, "scripts/panel-stubs/userAuth.mjs"),
  "@/lib/oplog": join(root, "scripts/panel-stubs/oplog.mjs"),
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
