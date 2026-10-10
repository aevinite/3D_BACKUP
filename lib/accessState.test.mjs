// lib/accessState.test.mjs — the ONE reader of a restaurant's permission state, driven for real against
// an in-memory database (nothing leaves the process). Run by `npm run test:units`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { join } from "node:path";
import { existsSync } from "node:fs";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const STUB = "data:text/javascript," + encodeURIComponent(
  "export const supabaseAdmin = { from(t) { const q = { t }; const c = new Proxy({}, { get(_, k) { if (k === 'then') return (r, j) => Promise.resolve(globalThis.__as(q)).then(r, j); return () => c; } }); return c; } };");
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "@/lib/supabaseAdmin") return { url: STUB, shortCircuit: true };
    if (spec.startsWith("@/")) { let p = join(root, spec.slice(2)); if (!existsSync(p)) p += ".ts"; return next(pathToFileURL(p).href, ctx); }
    return next(spec, ctx);
  },
});
const { accessStateFor } = await import("./accessState.ts");
const read = (rest, set) => { globalThis.__as = (q) => ({ data: q.t === "restaurants" ? rest : set, error: null }); return accessStateFor("r"); };

// ── A DELIVERY-APP KEY NEVER LEAVES THIS READER (sweep #10 T18, item 24) ──────────────────────────
// It went out whole inside `settings.platform_channels` — to the admin's browser on every Access
// screen load, and to the owner's inside a staff profile — while every comment promised a mask.
test("no stored channel key appears anywhere in the state, in either field name", async () => {
  const st = await read({}, { platform_channels: { zomato: { on: true, key: "ZOMATO-SECRET-0001" }, swiggy: { on: false, api_key: "SWIGGY-SECRET-0002" } } });
  const all = JSON.stringify(st);
  assert.equal(all.includes("ZOMATO-SECRET"), false, "the Zomato key reached the state");
  assert.equal(all.includes("SWIGGY-SECRET"), false, "the Swiggy key reached the state");
  assert.equal("platform_channels" in st.settings, false);
});

test("the channel still reads right without the raw object: on/off and a four-character hint", async () => {
  const st = await read({}, { platform_channels: { zomato: { on: true, key: "ZOMATO-SECRET-0001" } } });
  assert.equal(st.channels.zomato, true);
  assert.equal(st.creds.zomato, "••••0001");
});

test("a failed settings read is null, never 'at its defaults' (sweep #9 T35)", async () => {
  globalThis.__as = (q) => (q.t === "restaurants" ? { data: {}, error: null } : { data: null, error: { message: "down" } });
  assert.equal(await accessStateFor("r"), null);
});
