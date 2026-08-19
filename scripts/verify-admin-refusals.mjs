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

// ── 5 · THE CONSOLE GETS A SENTENCE, NOT POSTGRES PROSE ──────────────────────────────────────────
// lib/adminFail was written on 2026-08-14 for exactly this: forty-odd handlers under /api/admin
// answered `{ error: r.error.message }`, so the console's red toast read
// `duplicate key value violates unique constraint "settings_pkey"`. That is the right sentence for a
// developer and the wrong one for the screen he runs his platform from. adminFail keeps BOTH halves —
// a plain sentence in `error` (what lib/adminFetch surfaces) and the raw text in `detail` and the
// server log, where it is actually useful.
//
// The rollout was never finished and nothing was watching, so it had drifted back to being a habit
// rather than a rule. This makes it a rule.
//
// NOT_YET is the honest state of the OTHER half of the admin API, which belongs to a different
// territory in this sweep and is not mine to edit. Each line is a file and how many sites it has;
// DELETE YOUR LINE when you convert it. The list can only shrink — a file that is not on it and sends
// raw prose fails this check.
const NOT_YET = new Map([
  ["app/api/admin/attention/route.ts", 1],
  ["app/api/admin/billing/route.ts", 6],
  ["app/api/admin/custlog/route.ts", 1],
  ["app/api/admin/dashboard/route.ts", 1],
  ["app/api/admin/health/route.ts", 1],
  ["app/api/admin/notifications/route.ts", 1],
  ["app/api/admin/owners/route.ts", 16],
  ["app/api/admin/panels-health/route.ts", 1],
  // DELIBERATE, not a miss: these two write the database's words INTO THE BACKUP FILE, next to the
  // table that failed, so whoever rebuilds a restaurant can see which table came back empty and why.
  // They never reach a toast. `_meta.failed` names them at the top of the same file.
  ["app/api/admin/restaurants/export/route.ts", 2],
  // ensureCodes() is an internal helper that RETURNS the words to its caller; the caller wraps them
  // in adminFail, so the screen never sees them. Counted here so the number stays honest.
  ["app/api/admin/restaurants/settings/route.ts", 2],
]);
{
  const walk = (rel, out = []) => {
    for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      const p = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(p, out); else if (e.name === "route.ts") out.push(p);
    }
    return out;
  };
  const routes = existsSync(join(ROOT, "app/api/admin")) ? walk("app/api/admin").sort() : [];
  const RAW = /error:\s*[A-Za-z_.]*(?:error|Err)\.message|bad\(\s*[A-Za-z_.]*error\.message/g;
  const offenders = [];
  const stale = [];
  for (const rel of routes) {
    const src = code(rel);
    if (!src) continue;
    const n = (src.match(RAW) || []).length;
    const allowed = NOT_YET.get(rel) ?? 0;
    if (n > allowed) offenders.push(`${rel} (${n} site${n === 1 ? "" : "s"}${allowed ? `, ${allowed} allowed` : ""})`);
    else if (allowed && n < allowed) stale.push(`${rel} now has ${n}, NOT_YET says ${allowed}`);
  }
  check("no admin route hands the database's own sentence to the console",
    offenders.length === 0,
    offenders.length ? `${offenders.join("; ")} — use adminFail(what, error, { action }) so the screen gets words and the log keeps the detail` : "");
  check("the NOT_YET list is not stale (a converted file must delete its line)",
    stale.length === 0, stale.join("; "));
}

// ── 6 · AN ANSWER THAT COULD NOT BE COMPLETE SAYS SO AT THE TOP ──────────────────────────────────
// The recovery backup is offered as the thing you rebuild a restaurant from, and it is downloaded
// before a permanent purge. A table that failed to read already left `{ error: … }` in place of its
// rows — correct — but `_meta` said nothing, so the file looked complete: a 200, a filename, and a
// table's worth of the restaurant quietly missing unless you scrolled to that key in a
// hundred-thousand-line JSON. Same rule as `truncated`, which was already there.
{
  const rel = "app/api/admin/restaurants/export/route.ts";
  const src = code(rel);
  check(`${rel} exists`, !!src);
  if (src) {
    check("the recovery backup still records which tables hit the row cap", /meta\.truncated\s*=|truncated\s*=\s*\[\]/.test(src));
    check("…and which tables could not be READ at all", /failed\.push\(/.test(src) && /meta\.failed\s*=/.test(src),
      "a failed table is invisible unless the reader scrolls to that key — the file looks complete and is not");
    check("…and it carries one flag a restore script can branch on", /meta\.complete\s*=/.test(src));
    check("…and the staff table is counted too, not just the looped ones", /staffQ\.error\)\s*failed\.push/.test(src));
  }
}

// ── 7 · A PAGED WHOLE-PLATFORM READ HAPPENS ONCE PER REQUEST, NOT ONCE PER TILE ───────────────────
// `scopedRestaurantIds()` pages the whole `restaurants` table a thousand rows at a time. On the
// admin's all-restaurants dashboard two tiles each resolved the scope for themselves, so the same
// paged read ran twice on every recompute — and the two awaits sat one after another, so the second
// waited on the first. One call site per file is the property; more than one means a tile is paying
// for a list another tile already has.
{
  const rel = "app/api/owner/analytics/route.ts";
  const src = code(rel);
  check(`${rel} exists`, !!src);
  if (src) {
    const calls = (src.match(/scopedRestaurantIds\(scope\)/g) || []).length;
    check("the owner dashboard resolves the whole-platform restaurant list at most once per request",
      calls <= 1, `${calls} call site(s) — memoise it (see tileIds()) rather than asking again per tile`);
    check("…and the two expense tiles are fetched together, not one after the other",
      /Promise\.all\(\[staffPayExpense\(\), foodLossExpense\(\)\]\)/.test(src),
      "awaiting them in sequence inside the returned object makes the second wait on the first");
  }
}

console.log(`\n${fails ? `FAILED — ${fails} check(s)` : "PASS — no admin route answers a refusal, or a save, more optimistically than it knows"}\n`);
process.exit(fails ? 1 : 0);
