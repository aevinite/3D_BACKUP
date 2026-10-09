// Round-5 loader: @/ paths, extensionless imports, BOTH database clients → the in-memory stub, next/headers +
// next/navigation → fakes, and .tsx compiled on the fly by esbuild so the screens run here too. Nothing leaves the Mac.
import { registerHooks, createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
export const root = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const esbuild = createRequire(join(root, "package.json"))("esbuild");
const STUB = new URL("./sb.mjs", import.meta.url).href, ANON = new URL("./anon.mjs", import.meta.url).href;
const fix = (r) => (/\/lib\/supabaseAdmin\.ts$/.test(r.url) && !process.env.R4_REAL_ADMIN ? { url: STUB, shortCircuit: true } : /\/lib\/supabase\.ts$/.test(r.url) ? { url: ANON, shortCircuit: true } : r);
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "@sentry/nextjs" && process.env.R4_FAKE_SENTRY) return { url: new URL("./fake-sentry.mjs", import.meta.url).href, shortCircuit: true };
    if (spec === "next/headers") return { url: new URL("./fake-headers.mjs", import.meta.url).href, shortCircuit: true };
    if (spec === "next/navigation") return { url: new URL("./fake-navigation.mjs", import.meta.url).href, shortCircuit: true };
    if (spec === "@/lib/supabaseAdmin" && !process.env.R4_REAL_ADMIN) return { url: STUB, shortCircuit: true };
    if (spec.startsWith("@/")) { let q = join(root, spec.slice(2)); if (!existsSync(q)) for (const e of [".ts", ".tsx", ".js", ".mjs"]) if (existsSync(q + e)) { q += e; break; } return fix(next(pathToFileURL(q).href, ctx)); }
    if (ctx.parentURL && ctx.parentURL.includes("/t17-harness/") && !spec.startsWith(".") && !spec.startsWith("/") && !spec.startsWith("file:") && !spec.startsWith("node:")) ctx = { ...ctx, parentURL: pathToFileURL(join(root, "package.json")).href };
    try { return fix(next(spec, ctx)); } catch (e) {
      for (const suf of [".js", ".ts", ".tsx", "/index.ts", "/index.js"]) { try { return fix(next(spec + suf, ctx)); } catch {} }
      throw e;
    }
  },
  load(url, ctx, next) {
    if (url.startsWith("file:") && /\.tsx(\?.*)?$/.test(url)) {
      const file = fileURLToPath(url.replace(/\?.*$/, ""));
      const out = esbuild.transformSync(readFileSync(file, "utf8"), { loader: "tsx", format: "esm", jsx: "automatic", sourcemap: "inline", sourcefile: file, target: "es2022" });
      return { format: "module", source: out.code, shortCircuit: true };
    }
    return next(url, ctx);
  },
});
