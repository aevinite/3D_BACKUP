// build-vendor.mjs — bundles the pinned @supabase/supabase-js into a SINGLE
// self-hosted ESM file at public/vendor/supabase.js, so the static staff panels
// (kitchen/tablet/manager) import realtime from OUR origin instead of the public
// jsdelivr CDN at runtime.
//
// WHY: relying on an external CDN at runtime is a liability for a product we sell —
// a restaurant's wifi can be slow or block jsdelivr, which made the panel hang or
// silently drop to slow polling. A same-origin file removes that whole class of
// failure and loads faster. The version is whatever package.json has installed, so
// the bundle stays in lock-step with the npm dep the rest of the app uses.
//
// RE-RUN THIS after bumping @supabase/supabase-js:  npm run build:vendor
// (The output IS committed so deploys don't depend on this step running.)

import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(root, "public/vendor/supabase.js");
mkdirSync(resolve(root, "public/vendor"), { recursive: true });

await build({
  entryPoints: [resolve(root, "node_modules/@supabase/supabase-js/dist/index.mjs")],
  bundle: true,
  format: "esm",        // panels import it with a dynamic `import()`
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "none",
  outfile,
});

console.log("✓ wrote", outfile);
