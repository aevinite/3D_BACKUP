// scripts/sweep/t4s10/lab/build.mjs — bundle the screen lab for a browser with esbuild.
//
// The REAL files (components + lib) with exactly one stand-in: next/navigation (./nav.mjs). The database
// client is the real lib/supabase.ts pointed at https://lab-db.test, which ./page.mjs answers. When a
// deliberate-break run names a file (T4_MUT_FILE / T4_MUT_SRC, see ../lib.mjs), that file's broken copy
// is bundled in its place. The bundle always carries an inline source map, so V8 coverage of it maps back
// to the lines of the real files (../covmap.mjs).
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { ROOT, MUT } from "../lib.mjs";

export const LAB_DIR = join(ROOT, "node_modules/.cache/t4lab");
let cached = null;
export async function buildLab() {
  if (cached) return cached;
  mkdirSync(LAB_DIR, { recursive: true });
  const esbuild = (await import("esbuild")).default;
  const r = await esbuild.build({
    entryPoints: [join(ROOT, "scripts/sweep/t4s10/lab/entry.tsx")], bundle: true, platform: "browser", format: "iife",
    outfile: join(LAB_DIR, "lab.js"), write: false, logLevel: "silent", jsx: "automatic", target: "es2022",
    sourcemap: "inline", sourcesContent: false, tsconfig: join(ROOT, "tsconfig.json"), loader: { ".js": "jsx" },
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.NEXT_PUBLIC_SUPABASE_URL": '"https://lab-db.test"',
      "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"lab-anon-key"',
      "process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY": '""',
      "process.env": "{}",
    },
    plugins: [{ name: "t4lab", setup(b) {
      b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: join(ROOT, "scripts/sweep/t4s10/lab/nav.mjs") }));
      if (MUT) b.onLoad({ filter: /\.(tsx?|mjs|js)$/ }, (a) => {
        if (a.path !== join(ROOT, MUT.file)) return undefined;
        return { contents: MUT.src, loader: a.path.endsWith(".tsx") ? "tsx" : a.path.endsWith(".ts") ? "ts" : "js", resolveDir: dirname(a.path) };
      });
    } }],
  });
  const text = r.outputFiles[0].text;
  const file = join(LAB_DIR, `lab-${createHash("sha1").update(text).digest("hex").slice(0, 10)}.js`);
  writeFileSync(file, text);
  cached = { text, file };
  return cached;
}
