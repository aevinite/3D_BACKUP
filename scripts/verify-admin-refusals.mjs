// verify-admin-refusals.mjs — an admin route must never answer OPTIMISTICALLY.
//
// Two properties, both of them faults this sweep found in the admin console, both of them the same
// mistake in opposite directions:
//
//   1. A REFUSAL MUST FAIL CLOSED. A gate that decides whether something is still allowed has to
//      answer "I couldn't check" as a refusal, never as a yes. The banquet bill-number lock read
//      `Number(issued.count) || 0` with the count's error unchecked — so a passing database hiccup
//      made it "no bills have been issued yet" and let the starting number of a live series be moved
//      after bills had gone out on it. That is exactly what an audit looks at.
//
//   2. A SAVE THAT LANDED NOWHERE MUST NOT SAY "Saved". The Access & permissions endpoint drops any
//      key its allow-lists don't recognise. Two of its four branches counted what survived and left
//      the column alone when nothing did; the other two wrote the column back with its own current
//      value, so the handler's own "did anything land?" test said yes and the screen went green for a
//      change it had thrown away — and purged the guest menu cache on the way.
//
// Static, instant, no server and no database. Comments are stripped before anything is matched: every
// fix here leaves the old wrong code quoted in prose right above the right code, and a guard that
// cannot tell an explanation from a call punishes writing the reason down.
//
//   node scripts/verify-admin-refusals.mjs        (or npm run verify:admin-refusals)
//   node scripts/verify-admin-refusals.mjs --repo /path/to/other/checkout
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const ROOT = args.includes("--repo") ? args[args.indexOf("--repo") + 1]
  : join(dirname(fileURLToPath(import.meta.url)), "..");

let fails = 0;
const check = (name, pass, detail = "") => {
  if (!pass) fails++;
  console.log(`  ${pass ? "ok  " : "FAIL"} ${name}${detail ? `  — ${detail}` : ""}`);
};
const raw = (rel) => { const p = join(ROOT, rel); return existsSync(p) ? readFileSync(p, "utf8") : null; };
const code = (rel) => {
  const t = raw(rel);
  return t === null ? null : t
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
};

console.log(`\nADMIN ROUTES · NO OPTIMISTIC ANSWERS — ${ROOT}\n`);

// ── 1 · the banquet bill-number lock fails closed ────────────────────────────────────────────────
{
  const rel = "app/api/admin/restaurants/settings/route.ts";
  const src = code(rel);
  check(`${rel} exists`, !!src);
  if (src) {
    const i = src.indexOf('"banquet_bill_next" in body');
    const block = i < 0 ? "" : src.slice(i, i + 1800);
    check("the banquet starting-number lock is still there at all",
      /banquet_bills[\s\S]{0,200}count:\s*"exact"/.test(block) && /status:\s*409/.test(block),
      block ? "" : "could not find the banquet_bill_next branch — if it moved, update this guard");
    check("…and it REFUSES when it could not count the bills already issued",
      /if\s*\(\s*issued\.error\s*\|\|\s*cur\.error\s*\)/.test(block) || /issued\.error[\s\S]{0,120}return /.test(block),
      "with the count's error unchecked, `Number(issued.count) || 0` is 0 and the lock opens — a live bill series could be renumbered because a read hiccuped");
    check("…and the refusal still names how many bills exist, so the person knows why",
      /already\s*[><=]/.test(block) && /already\s*===\s*1\s*\?\s*"bill has"/.test(block));
  }
}

// ── 2 · the Access endpoint counts what survived, in EVERY branch ────────────────────────────────
{
  const rel = "app/api/admin/restaurants/access-tree/route.ts";
  const src = code(rel);
  check(`${rel} exists`, !!src);
  if (src) {
    // The honesty test at the bottom is what all four branches feed. It must still be there.
    check("it still refuses to say \"Saved\" when nothing landed",
      /groups\.length\s*&&\s*!Object\.keys\(restUpdate\)\.length\s*&&\s*!Object\.keys\(setPatch\)\.length/.test(src),
      "without this the whole allow-list model is decoration — a dropped patch reads as a success");

    // Every branch that writes a whole COLUMN back must gate that write on a survivor count.
    // Named one by one, because each is a different allow-list and each was wrong or right separately.
    const BRANCHES = [
      ["grants",   /if \(patch\.grants\)[\s\S]{0,400}?if \(took\) restUpdate\.manager_permissions/,   "manager_permissions"],
      ["sections", /if \(patch\.sections\)[\s\S]{0,400}?if \(took\) restUpdate\.owner_entitlements/,  "owner_entitlements"],
      ["features", /if \(patch\.features\)[\s\S]{0,600}?if \(took\) setPatch\.features/,              "settings.features"],
      ["channels/creds", /if \(patch\.channels \|\| patch\.creds\)[\s\S]{0,2600}?if \(took\) setPatch\.platform_channels/, "settings.platform_channels"],
      ["config/tabs", /if \(cfg && cfgTook\) restUpdate\.access_config/,                              "access_config"],
    ];
    for (const [name, re, col] of BRANCHES) {
      check(`the ${name} branch only writes ${col} when a key survived its allow-list`, re.test(src),
        `a patch of only unknown ${name} keys would rewrite ${col} with its own value, and the handler would answer "Saved" for a change it dropped`);
    }

    // And the cache purge must hang off a real write, not off an empty patch.
    check("the guest menu cache is only purged when settings really changed",
      /if \(Object\.keys\(setPatch\)\.length\)\s*\{[\s\S]{0,400}?revalidateTag\(menuTag\(rid\)/.test(src),
      "a purge for a write that changed nothing costs every guest a cold read");
    check("…and it purges with `{ expire: 0 }`, not \"max\"",
      /revalidateTag\(menuTag\(rid\), \{ expire: 0 \}\)/.test(src),
      '"max" serves one more stale read, so a guest-facing switch appears to need saving twice (T13, 2026-08-05)');
  }
}

// ── 3 · the same shape, anywhere else in my half of the admin API ─────────────────────────────────
// A general sweep rather than a list: any `Number(x.count) || 0` whose `x.error` is never tested is
// this same fault waiting to happen, because a failed count is indistinguishable from a real zero.
{
  const FILES = [
    "app/api/admin/restaurants/settings/route.ts",
    "app/api/admin/restaurants/access-tree/route.ts",
    "app/api/admin/restaurants/route.ts",
    "app/api/admin/restaurants/quick-features/route.ts",
    "app/api/admin/restaurants/staff-features/route.ts",
    "app/api/admin/restaurants/google-review/route.ts",
    "app/api/admin/restaurants/platform-channels/route.ts",
    "app/api/admin/users/route.ts",
  ];
  const offenders = [];
  for (const rel of FILES) {
    const src = code(rel);
    if (!src) continue;
    for (const m of src.matchAll(/Number\((\w+)\.count\)\s*\|\|\s*0/g)) {
      const v = m[1];
      if (!new RegExp(`${v}\\.error`).test(src)) offenders.push(`${rel} :: ${v}.count`);
    }
  }
  check("no admin gate in my half decides from a count whose error it never checked",
    offenders.length === 0,
    offenders.length ? `${offenders.join(", ")} — a failed count reads as a real zero, so the gate opens` : "");
}

// ── 4 · A NEW settings ROW IS KEYED BY THE RESTAURANT ID, NEVER ITS SLUG ─────────────────────────
// The same optimism, one layer down: keying by slug assumes the NAME is free, and since migration 319
// it isn't a safe assumption — a binned restaurant gives its slug back in `restaurants` while KEEPING
// its settings row, so the name can be free in one table and taken in the other. `settings.id` is a
// PRIMARY KEY (mig 003) and these upserts conflict on `restaurant_id`, not on `id`, so the collision
// is not absorbed: it surfaces as `duplicate key value violates unique constraint "settings_pkey"` on
// the admin's screen for flipping a switch — the exact "database error on his screen, which is worse
// than the lock it replaces" that migration 319's own header says it exists to avoid.
//
// The create route and quick-features were fixed on 2026-08-16; four siblings were left behind and are
// fixed here. Discovered by scanning, not from a list, so the next route to clone a settings template
// is covered the day it is written.
{
  const walk = (rel, out = []) => {
    for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      const p = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(p, out); else if (e.name === "route.ts") out.push(p);
    }
    return out;
  };
  const routes = existsSync(join(ROOT, "app/api/admin")) ? walk("app/api/admin").sort() : [];
  check("app/api/admin could be walked, so this looks at every route", routes.length > 20, `${routes.length} route file(s)`);
  const offenders = [];
  const cloners = [];
  for (const rel of routes) {
    const src = code(rel);
    if (!src || !/cleanClonedSettings/.test(src)) continue;   // only the routes that clone a template
    cloners.push(rel);
    // Any `id:` in the row being written to `settings` must be the restaurant's uuid, never a slug.
    for (const m of src.matchAll(/\bid:\s*([A-Za-z0-9_.\[\]]+)/g)) {
      if (/slug/i.test(m[1])) offenders.push(`${rel} :: id: ${m[1]}`);
    }
  }
  check("every admin route that clones a settings template was found", cloners.length >= 5, `${cloners.length}: ${cloners.map((c) => c.split("/").slice(-2)[0]).join(", ")}`);
  check("none of them keys the new settings row by a SLUG", offenders.length === 0,
    offenders.length ? `${offenders.join(", ")} — a slug freed by the recycle bin can still be taken in settings, and the upsert conflicts on restaurant_id, so this becomes a raw settings_pkey error on his screen` : "");
}

console.log(`\n${fails ? `FAILED — ${fails} check(s)` : "PASS — no admin route answers a refusal, or a save, more optimistically than it knows"}\n`);
process.exit(fails ? 1 : 0);
