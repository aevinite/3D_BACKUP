// Round 3 · H — NOTHING DEAD IN TERMINAL 3'S FILES: no export nobody imports, no style rule for a class
// nothing renders, no debugging left behind, and the linter has nothing to say.
import { check, ROOT, rd } from "./h.mjs";
import { execFileSync } from "node:child_process";

const MINE = [
  "app/api/guest/call-waiter/route.ts", "app/api/guest/leave/route.ts", "app/api/guest/limit-hit/route.ts", "app/api/guest/place-order/route.ts",
  "components/CartPanel.tsx", "components/ChefCallButton.tsx", "components/ChefPopup.tsx", "components/GuestOutboxChip.tsx", "components/MiniCart.tsx",
  "components/OrderConfirmModal.tsx", "components/OrderTracker.tsx", "components/StarRating.tsx",
  "lib/guestOutbox.ts", "lib/orderStatus.ts", "lib/guestTokenRestaurant.ts",
];
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" });
const tracked = git("ls-files", "app", "components", "lib", "public", "scripts", "tests").split("\n").filter((f) => /\.(tsx?|mjs|js|cjs)$/.test(f));
const ALL = new Map(tracked.map((f) => { try { return [f, rd(f)]; } catch { return [f, ""]; } }));
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");

// DEAD = declared and referenced nowhere. An export used only inside its own file is not dead — three are on
// purpose: GuestTrack and ACTIVE_ORDERS_KEY are the declared shapes older guards assert, and
// noteServerRetryAfter is exported so the queue can be tested in memory.
check("R3-H01", "H", "every exported name in terminal 3's files is used — in its own file, by the app, or by a check (a route's POST and a component's default are its doors)", async () => {
  const unused = [];
  for (const f of MINE) {
    const src = strip(rd(f));
    const names = [...src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class|interface|type)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    for (const n of names) {
      if (n === "POST" || n === "GET" || n === "dynamic") continue;   // a route's own doors, read by Next
      const all = new RegExp(`\\b${n}\\b`, "g"), one = new RegExp(`\\b${n}\\b`);   // never .test() with a "g" regex
      const inOwn = (src.match(all) || []).length > 1;   // the declaration itself is one mention
      const elsewhere = inOwn || [...ALL.entries()].some(([g, t]) => g !== f && one.test(strip(t)));
      if (!elsewhere) unused.push(`${f.split("/").pop()}:${n}`);
    }
  }
  return { ok: !unused.length, note: unused.join(", ") || "every exported name is used" };
});
check("R3-H02", "H", "no console.log and no debugger left in terminal 3's files", async () => {
  const hits = []; for (const f of MINE) { const s = strip(rd(f)); for (const m of s.matchAll(/console\.log\(|\bdebugger\b/g)) hits.push(`${f.split("/").pop()}@${s.slice(0, m.index).split("\n").length}`); }
  return { ok: !hits.length, note: hits.join(", ") || `${MINE.length} files clean` };
});
check("R3-H03", "H", "every style rule for terminal 3's screens names a class something actually renders (no dead CSS)", async () => {
  const css = strip(rd("app/globals.css"));
  const PREFIX = /^(cart-|bill-|mini-cart|gob-|order-tracker|ot-|chef-|order-confirm|oc-|sr-|live-order|pairing-|allergy-|remove-item|stb-)/;
  const classes = new Set([...css.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]).filter((c) => PREFIX.test(c)));
  const code = [...ALL.entries()].filter(([g]) => !g.startsWith("scripts/")).map(([, t]) => t).join("\n");
  // a class can be written whole ("cart-item") or built (`cart-item ${…}` / "status-" + s) — accept any literal mention
  const dead = [...classes].filter((c) => !new RegExp(`(["'\`\\s.]|^)${c.replace(/-/g, "\\-")}(?![\\w-])`).test(code));
  return { ok: !dead.length, note: dead.length ? `${dead.length}: ${dead.slice(0, 12).join(", ")}` : `${classes.size} classes, all rendered` };
});
check("R3-H04", "H", "the linter has nothing to say about terminal 3's files (no unused variable, import or argument)", async () => {
  let out = ""; try { out = execFileSync("npx", ["eslint", "--format", "unix", ...MINE], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { out = String(e.stdout || e); }
  const lines = out.split("\n").filter((l) => /:\d+:\d+:/.test(l));
  return { ok: !lines.length, note: lines.slice(0, 4).map((l) => l.replace(ROOT + "/", "").slice(0, 110)).join(" · ") || `${MINE.length} files, 0 warnings` };
});
