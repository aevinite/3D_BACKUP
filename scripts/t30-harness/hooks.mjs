// scripts/t30-harness/hooks.mjs — sweep #10 · T30 round 2. Loads the REAL money libraries with the
// database client replaced by the in-memory stand-in in ./sb.mjs, so every branch of lib/clash.ts,
// lib/idempotency.ts, lib/discountCap.ts and lib/paySplit.ts can be run with nothing leaving the Mac.
// (The pattern is scripts/t17-harness/hooks.mjs's; the stand-in is our own because a PostgREST UPDATE
// returns the rows it matched BEFORE the patch, which lib/paySplit.ts's first-save-wins rule reads.)
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join } from "node:path";
import { existsSync } from "node:fs";
export const root = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const STUB = new URL("./sb.mjs", import.meta.url).href;
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "@/lib/supabaseAdmin") return { url: STUB, shortCircuit: true };
    if (spec.startsWith("@/")) {
      let q = join(root, spec.slice(2));
      if (!existsSync(q)) for (const e of [".ts", ".tsx", ".js", ".mjs"]) if (existsSync(q + e)) { q += e; break; }
      return next(pathToFileURL(q).href, ctx);
    }
    if (ctx.parentURL && /\/t30-(harness|equiv)\//.test(ctx.parentURL) && !/^(\.|\/|file:|node:)/.test(spec)) ctx = { ...ctx, parentURL: pathToFileURL(join(root, "package.json")).href };
    try { return next(spec, ctx); } catch (e) {
      for (const suf of [".js", ".ts", "/index.js"]) { try { return next(spec + suf, ctx); } catch {} }
      throw e;
    }
  },
});
// Nothing in a suite may reach the network: the database is the stand-in, and any fetch is refused.
export const NET = [];
globalThis.fetch = async (u) => { NET.push(String(u)); throw new Error("t30-harness: network refused (" + String(u).slice(0, 60) + ")"); };
