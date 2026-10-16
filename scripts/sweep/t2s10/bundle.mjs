// scripts/sweep/t2s10/bundle.mjs — bundle one of this territory's lib files for an in-process test,
// with lib/supabaseAdmin replaced by a stand-in the check controls. Nothing real is ever called.
import { build } from "esbuild";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, OUT } from "./lib.mjs";
export async function load(rel) {
  const out = join(OUT, "bundles", rel.replace(/\W/g, "_") + ".mjs");
  await build({
    entryPoints: [join(ROOT, rel)], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "error",
    plugins: [{ name: "stub", setup(b) {
      b.onResolve({ filter: /^@\/lib\/supabaseAdmin$/ }, () => ({ path: join(ROOT, "scripts/sweep/t2s10/stubs/supabaseAdmin.ts") }));
      b.onResolve({ filter: /^@\// }, (a) => ({ path: join(ROOT, a.path.slice(2)) + (/\.\w+$/.test(a.path) ? "" : ".ts") }));
    } }],
  });
  return import(pathToFileURL(out).href + "?t=" + Date.now() + Math.random());
}
