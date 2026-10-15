// scripts/sweep/t3s10/r3/hooks.mjs — load the REAL .ts files of terminal 3's territory in Node, no bundle.
//
//   node --import ./scripts/sweep/t3s10/r3/hooks.mjs scripts/sweep/t3s10/r3/run.mjs …
//
// Round 3 (2026-10-15) loads the files themselves instead of an esbuild bundle, for two reasons:
//   · COVERAGE — Node strips TypeScript by blanking the types, so every character keeps its place and
//     V8's coverage offsets are offsets into the file a person reads (pattern: scripts/sweep/t9s10).
//   · MUTATION — T3R3_SWAP=<repo-relative file>=<absolute copy> makes every import of that file load
//     the copy instead. The copy's OWN imports are resolved as if it still sat where the original
//     does, so "./menu" from lib/orderStatus.ts still finds lib/menu.ts. Copies live in .t3mut/ at
//     the repo root, never under node_modules (Node will not strip types there — scripts/sweep/t9s10
//     learned that the hard way: every copy failed to load and read as "caught").
//
// What is NOT real, and why: the SERVER's database client (./stubs — nothing may open a socket), the
// floor snapshot, the clash lookup and the owner-alert sender (they reach other systems), and React
// (lib/guestOutbox.ts needs only useSyncExternalStore from it). Everything else — the idempotency
// door, the floor-plan check, the token lookup, the tax rules, tenant storage, and the BROWSER's
// supabase client (its requests are answered by the fake phone's network — ../phone.mjs) — is real.
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join } from "node:path";
import { existsSync } from "node:fs";

const root = fileURLToPath(new URL("../../../..", import.meta.url)).replace(/\/$/, "");
const S = join(root, "scripts/sweep/t3s10/stubs");
const STUB = {
  "@/lib/supabaseAdmin": join(S, "sb.mjs"),
  "@/lib/floorSummary": join(S, "floor.mjs"),
  "@/lib/clash": join(S, "clash.mjs"),
  "@/lib/rateLimit": join(S, "rate.mjs"),
  react: join(S, "react.mjs"),
};
// T3R3_SWAP="lib/guestOutbox.ts=/abs/.t3mut/w0/guestOutbox.ts"
const swap = (() => { const v = process.env.T3R3_SWAP || ""; const i = v.indexOf("="); return i > 0 ? { rel: v.slice(0, i), copy: v.slice(i + 1) } : null; })();
const swapOrigUrl = swap ? pathToFileURL(join(root, swap.rel)).href : "";
const swapCopyUrl = swap ? pathToFileURL(swap.copy).href : "";
const withExt = (q) => { if (existsSync(q) && !q.endsWith("/")) return q; for (const e of [".ts", ".tsx", ".js", ".mjs", "/index.ts"]) if (existsSync(q + e)) return q + e; return q; };

registerHooks({
  resolve(spec, ctx, next) {
    // the copy resolves its imports from the ORIGINAL's folder
    if (swap && ctx.parentURL && ctx.parentURL.split("?")[0] === swapCopyUrl) ctx = { ...ctx, parentURL: swapOrigUrl };
    if (STUB[spec]) return { url: pathToFileURL(STUB[spec]).href, shortCircuit: true };
    let r;
    if (spec.startsWith("@/")) r = next(pathToFileURL(withExt(join(root, spec.slice(2)))).href, ctx);
    else {
      try { r = next(spec, ctx); } catch (e) {
        r = null;
        for (const suf of [".js", ".ts", "/index.ts", "/index.js"]) { try { r = next(spec + suf, ctx); break; } catch { /* next suffix */ } }
        if (!r) throw e;
      }
    }
    if (swap && r.url.split("?")[0] === swapOrigUrl) return { ...r, url: swapCopyUrl + (r.url.includes("?") ? "?" + r.url.split("?")[1] : ""), shortCircuit: true };
    return r;
  },
});
