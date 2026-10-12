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
  // 4 since 2026-10-12: three unused switch doors that cloned it were retired (T29 round 2, item 13).
  check("every admin route that clones a settings template was found", cloners.length >= 4, `${cloners.length}: ${cloners.map((c) => c.split("/").slice(-2)[0]).join(", ")}`);
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
//
// SEVEN LINES DELETED when this branch was merged with T19's (attention, billing, custlog,
// dashboard, notifications, owners, panels-health): that territory converted them in the same
// sweep, so the list was describing a state that no longer existed and the staleness check —
// which is here precisely so the list can never flatter the code — went red on the merged tree.
// Only health/route.ts is still genuinely unconverted; the last two entries are deliberate and
// their reasons are on them.
const NOT_YET = new Map([
  ["app/api/admin/health/route.ts", 1],
  // DELIBERATE, not a miss: these two write the database's words INTO THE BACKUP FILE, next to the
  // table that failed, so whoever rebuilds a restaurant can see which table came back empty and why.
  // They never reach a toast. `_meta.failed` names them at the top of the same file.
  // WAS 2, NOW 1 (sweep #10 T29, item 12): every table — staff included — is now read through ONE
  // paging helper, readAll(), which is the single place that hands the words on.
  ["app/api/admin/restaurants/export/route.ts", 1],
  // ensureCodes() is an internal helper that RETURNS the words to its caller; the caller wraps them
  // in adminFail, so the screen never sees them. Counted here so the number stays honest.
  //
  // WAS 2, NOW 3 (T30 sweep, 2026-08-22). A third `return { error: … }` was added inside the SAME
  // helper — the "the other request created these" path, a scoped re-read of exactly the rows we
  // lack (docs/SAAS-EFFICIENCY-PLAYBOOK.md) — and nobody bumped this number, so the guard went red
  // on a route that is correct. Checked before changing it: all three sites are inside
  // ensureCodes(), and its ONE caller is
  //   `if ("error" in codes) return adminFail("this restaurant's table QR codes", { message: codes.error }, …)`
  // so the database's words reach the log and the `detail`, never the console's red toast. The
  // allowance is the honest count of an exemption that already existed — not a new one.
  ["app/api/admin/restaurants/settings/route.ts", 3],
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
    check("…and the staff table is counted too, not just the looped ones", /staffQ\.error(?: !== undefined)?\)\s*failed\.push/.test(src));
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

// ── 8 · A REMOVAL THAT DID NOT HAPPEN IS NEVER RECORDED (sweep #10 T29, item 3) ──────────────────
// The Repair Kit's "Delete an order" read the order WITHOUT its deleted_at and never looked at the
// count softDeleteOrders() hands back, so deleting an already-deleted order wrote a second
// `order_deleted` row — full amount — into the Removals record the owner totals. The void branch two
// blocks up has refused its own twin since T20 (2026-09-01); this holds the delete branch to it.
{
  const rel = "app/api/admin/repair/route.ts";
  const src = code(rel);
  check(`${rel} exists`, !!src);
  if (src) {
    const del = src.slice(src.indexOf('op === "delete_order"'), src.indexOf('op === "refire_order"'));
    check("Repair → Delete an order reads the order's deleted_at before deleting it",
      /readOne<[^>]*deleted_at[^>]*>\(\s*"orders",\s*"[^"]*\bdeleted_at\b/.test(del), "an already-deleted order is indistinguishable from a live one");
    check("…and an already-deleted order returns BEFORE anything is written",
      /if \(cur\.deleted_at\) return/.test(del) && del.indexOf("if (cur.deleted_at) return") < del.indexOf("softDeleteOrders("),
      "a second press would record the same removal twice");
    check("…and it believes the delete's own count, not its own earlier read",
      /\)\)\.deleted;/.test(del) && /if \(deleted === 0\) return/.test(del),
      "another device can delete it between the read and the write");
    check("…and the Removals row is written only after both of those",
      del.indexOf("if (deleted === 0) return") > -1 && del.indexOf("recordRemoval(") > del.indexOf("if (deleted === 0) return"));
  }
}

// ── 9 · THE SETTINGS TEMPLATE READ ANSWERS FOR ITSELF, EVERYWHERE (sweep #10 T29, item 4) ───────────
// Four admin routes (seven until 2026-10-12, when three unused doors were retired) build a settings row from restaurant #1's (`cleanClonedSettings(template.data)`).
// Only the access-tree route checked that read; the other six — the CREATE-A-RESTAURANT path among
// them, which runs on every create — handed a failed read's `null` on, and the restaurant was born
// half-configured with a success answer. Matched by SHAPE, so an eighth clone site is held to it too.
{
  const dir = join(ROOT, "app/api/admin");
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : e.name === "route.ts" ? [join(d, e.name)] : []);
  let sites = 0;
  for (const abs of walk(dir)) {
    const rel = abs.slice(ROOT.length + 1);
    const src = code(rel);
    // The read itself goes through lib/readRetry (owner, 2026-10-12: "make sure that this never
    // happen"): one quiet second try for a dropped connection, so a passing blip never reaches the
    // admin. The `.error` refusal below it stays as the safety net for anything that is still wrong.
    for (const m of src.matchAll(/const (\w+) = \(await retryRead\(\(\) => sb\.from\("settings"\)\.select\("\*"\)\.eq\("restaurant_id", DEFAULT_\w+\)\.maybeSingle\(\)\)\)\.result;/g)) {
      sites++;
      const after = src.slice(m.index + m[0].length, src.indexOf(`cleanClonedSettings(${m[1]}.data)`, m.index));
      check(`${rel}: the settings template read is checked before a row is built from it`,
        new RegExp(`if \\(${m[1]}\\.error\\)`).test(after), "a failed read builds a half-configured settings row and still answers success");
    }
  }
  check("…and the clone sites were found at all, every one read through the one-retry helper (a shape change would otherwise pass in silence)", sites >= 4, `${sites} found`);
  // …and no clone site reads the template WITHOUT the retry (an eighth site added the old way).
  const bare = walk(dir).filter((abs) => /await sb\.from\("settings"\)\.select\("\*"\)\.eq\("restaurant_id", DEFAULT_\w+\)/.test(code(abs.slice(ROOT.length + 1))));
  check("…and no route reads the settings template without that retry", bare.length === 0, bare.map((a) => a.slice(ROOT.length + 1)).join(", "));
}

// ── 10 · ASSIGNING AN OWNER IS ONLY "SAVED" ONCE THEY CAN GET IN (sweep #10 T29, item 5) ─────────
// The Restaurants list's owner picker wrote the name (`owner_user_id`) and then the membership row —
// the one that decides what an owner SEES (mig 097) — with that second write's error dropped. Every
// restaurant_owners write in the restaurants route must answer for itself.
{
  const rel = "app/api/admin/restaurants/route.ts";
  const src = code(rel);
  check(`${rel} exists`, !!src);
  if (src) {
    const writes = [...src.matchAll(/(?:const (\w+) = )?await sb\.from\("restaurant_owners"\)\.(?:upsert|insert|delete)\(/g)];
    check("the restaurants route still writes owner membership (a rename would otherwise pass in silence)", writes.length >= 3, `${writes.length} found`);
    for (const w of writes) {
      const ok = !!w[1] && new RegExp(`${w[1]}\\.error`).test(src.slice(w.index, w.index + 900));
      check(`Restaurants → owner membership write '${w[1] || "(unnamed)"}' looks at its own error`, ok, "a failed write answers Saved and the owner signs in to nothing");
    }
  }
}

// ── 11 · THE BILL PREVIEW DRAWS THE RESTAURANT ASKED FOR, OR NOTHING (sweep #10 T29, item 6) ──────
// Access & permissions → "Format of …" → Preview / Print. A missing id fell back to restaurant #1 (the
// flagship's header under another restaurant's screen) and a failed read drew a bill with a blank
// header, both with a 200.
{
  const rel = "app/api/admin/restaurants/bill-preview/route.ts";
  const src = code(rel);
  check(`${rel} exists`, !!src);
  if (src) {
    check("Access → bill preview: no silent fall-back to restaurant #1 for a missing id",
      !/DEFAULT_RESTAURANT_ID|DEFAULT_RID/.test(src), "the flagship's bill would be drawn under another restaurant's name");
    check("…and both reads are checked before a bill is drawn",
      /if \(setQ\.error \|\| restQ\.error\)/.test(src) && src.indexOf("setQ.error || restQ.error") < src.indexOf("billPreviewHtml("),
      "a failed read draws a bill with no name, no address and no tax lines");
    check("…and an unknown restaurant is said in words, not drawn as an empty bill",
      /if \(!restQ\.data\) return/.test(src));
  }
}

// ── 12 · "COULDN'T READ THE LOCK" IS NOT "UNLOCKED" (sweep #10 T29, item 7) ──────────────────────
// Admin console → Settings → the log-retention lock. A failed read of app_config showed the lock OFF
// while the manager panel's read of the same row fails CLOSED. The admin route must not fold an error
// into the missing-row answer.
{
  const rel = "app/api/admin/settings/route.ts";
  const src = code(rel);
  check(`${rel} exists`, !!src);
  if (src) {
    check("Settings → the retention lock: a failed read is not answered as 'never locked'",
      !/if \(r\.error \|\| !r\.data\) return \{ locked: false/.test(src) && /if \(r\.error\) return \{ error: r\.error \}/.test(src),
      "a hiccup shows every restaurant as unlocked while the manager panel says locked");
    check("…and the GET refuses in words rather than drawing a guessed lock",
      /if \("error" in lock\) return adminFail\(/.test(src));
  }
}

// ── 13 · A MALFORMED ID IS "NOT FOUND", NEVER "TRY AGAIN" (sweep #10 T29, item 8) ────────────────
// /api/admin/users let a malformed id reach a uuid column on four doors; Postgres refused it and the
// console said "please try again" (500) to a request that could never work.
{
  const rel = "app/api/admin/users/route.ts";
  const src = code(rel);
  check(`${rel} exists`, !!src);
  if (src) {
    check("People → a person's profile (GET ?id) shape-checks the id before reading", /if \(one\) return UUID\.test\(one\)/.test(src));
    const patch = src.slice(src.indexOf("export async function PATCH"), src.indexOf("export async function DELETE"));
    const del = src.slice(src.indexOf("export async function DELETE"));
    const post = src.slice(src.indexOf("export async function POST"), src.indexOf("export async function PATCH"));
    check("…and every profile write (PATCH) does too, before its first read",
      /if \(!UUID\.test\(id\)\) return bad\("User not found\.", 404\)/.test(patch) && patch.indexOf("UUID.test(id)") < patch.indexOf("sb.from("));
    check("…and Delete this person (DELETE) does too, before its first read",
      /if \(!UUID\.test\(id\)\) return bad\("User not found\.", 404\)/.test(del) && del.indexOf("UUID.test(id)") < del.indexOf("sb.from("));
    check("…and Add a person (POST) shape-checks the restaurant before reading it",
      /if \(!UUID\.test\(restaurantId\)\)/.test(post) && post.indexOf("UUID.test(restaurantId)") < post.indexOf("sb.from("));
  }
}

// ── 14 · RESOLVING A PROBLEM THAT IS ALREADY RESOLVED RECORDS NOTHING (sweep #10 T29, item 9) ────
// Repair → a problem tile → Resolve, pressed on a stale board. The tapped row was pushed into the
// update unconditionally, so a row another tab had resolved got its resolved_at re-stamped and a
// second "Resolved: …" line went into the Activity log.
{
  const rel = "app/api/admin/resolve-error/route.ts";
  const src = code(rel);
  check(`${rel} exists`, !!src);
  if (src) {
    check("Repair → Resolve reads whether the tapped problem is still open",
      /\.select\("panel, action, detail, restaurant_id, level, resolved_at"\)/.test(src));
    check("…and only adds it to the update while it is still in the state being acted on",
      /if \(!ids\.includes\(actionId\) && inSourceState\) ids\.push\(actionId\)/.test(src) && !/if \(!ids\.includes\(actionId\)\) ids\.push\(actionId\)/.test(src),
      "an already-resolved problem is re-stamped and logged as resolved a second time");
    check("…and an empty set answers before anything is written or logged",
      /if \(!ids\.length\) \{/.test(src) && src.indexOf("if (!ids.length) {") < src.indexOf('.in("id", ids)'));
  }
}

// ── 15 · …AND NOT BY THE BACK DOOR EITHER: A CAUGHT THROW (sweep #10 T29, item 10) ───────────────
// Rule 5's pattern looks for `error: x.message`. The Repair Kit threw `new Error(error.message)` and its
// catch answered `err(e.message, 500)`, the recycle bin's purge answered `bad(m, 500)` with the
// database's words in `m`, and "New restaurant" printed the raw seed error after "Menu seed failed:".
// None matched rule 5. This looks for a caught error's message going into a response instead.
// ALLOWED, with the reason: the two /api/admin/users throws come from lib helpers whose messages are
// written FOR the screen (newWaiterTables — "Pick at least one table"; jobPatchFrom — "throws a
// user-safe message"), not from the database.
{
  const ALLOWED_CAUGHT = new Map([["app/api/admin/users/route.ts", 2]]);
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : e.name === "route.ts" ? [join(d, e.name)] : []);
  const bad = [];
  for (const abs of walk(join(ROOT, "app/api/admin"))) {
    const rel = abs.slice(ROOT.length + 1);
    const src = code(rel);
    const n = (src.match(/(?:return\s+\w+|NextResponse\.json)\(\s*(?:\{\s*error:\s*)?e instanceof Error \? e\.message/g) || []).length
      + (src.match(/return bad\(m, 5\d\d\)/g) || []).length
      + (src.match(/seedError = e instanceof Error \? e\.message/g) || []).length;
    if (n > (ALLOWED_CAUGHT.get(rel) || 0)) bad.push(`${rel} (${n})`);
  }
  check("no admin route hands a CAUGHT database error's words to the console", bad.length === 0,
    bad.length ? `${bad.join("; ")} — wrap it in adminFail(what, { message }, { action })` : "");
}

// ── 16 · USAGE COUNTS THE WINDOW ASKED FOR, OR REFUSES (sweep #10 T29, item 11) ──────────────────
// Admin console → Usage → a custom date range. "2026-02-31" passed the shape test and Date.parse, so the
// counts started on 3 March while the answer echoed 31 February; an impossible or half-given range fell
// back to the default view without a word. Same round trip as Billing (S10 T28 item 8).
{
  const rel = "app/api/admin/usage/route.ts";
  const src = code(rel);
  check(`${rel} exists`, !!src);
  if (src) {
    check("Usage → a typed date must survive a round trip (no 31 February)",
      /new Date\(ms\)\.toISOString\(\)\.slice\(0, 10\) === v/.test(src) && !/!isNaN\(Date\.parse\(v\)\)/.test(src));
    check("…and an impossible or half-given range is refused, not swapped for the default view",
      /Pick both a start date and an end date\./.test(src) && /That isn't a real date/.test(src));
  }
}

// ── 17 · THE RECOVERY BACKUP HOLDS EVERY ROW, OR SAYS IT DOES NOT (sweep #10 T29, item 12) ──────
// Recycle bin → "download a backup first". Each table was ONE read with .limit(100000), and PostgREST
// answers at most 1,000 rows per request — so French House's file held 1,000 of 20,561 orders and
// still said `complete: true`. Every table must now be paged in a fixed key order.
{
  const rel = "app/api/admin/restaurants/export/route.ts";
  const src = code(rel);
  check(`${rel} exists`, !!src);
  if (src) {
    check("Recovery backup → no table is read in one request (PostgREST cuts every answer at 1,000)",
      !/\.limit\(CAP\)/.test(src) && /\.range\(from, Math\.min\(from \+ PAGE, CAP\) - 1\)/.test(src));
    check("…every page is read in the table's own key order, so no row repeats or goes missing",
      /q = q\.order\(k, \{ ascending: true \}\)/.test(src) && /const ORDER_KEY: Record<string, string> = \{/.test(src));
    check("…and the staff logins go through the same pager",
      /const staffQ = await readAll\("staff_users"/.test(src));
  }
}

// ── 18 · A LINK A GUEST WILL TAP MUST BE A WEB ADDRESS (sweep #10 T29 round 2, item 23) ──────────
// Access & permissions → Ratings → "Google review link" is the one text a guest acts on (the menu's
// "Review us on Google" card links to it). It took any text, so a link pasted without https:// sent a
// happy guest to an error page on our own site. Since the google-review door was retired (item 13),
// this screen is its only writer.
{
  const rel = "app/api/admin/restaurants/access-tree/route.ts";
  const src = code(rel);
  check(`${rel} exists`, !!src);
  if (src) {
    check("Access → the Google review link must be a full https:// web address (empty = no link)",
      /if \(k === "google_review_url" && t && !\/\^https\?:\\\/\\\//.test(src) && /must be a full web address starting with https:\/\//.test(src),
      "a link without https:// sends a guest to an error page on our own site");
  }
}

// ── 19 · NO READ ASKS FOR MORE THAN 1,000 ROWS (sweep #10 T29 round 2, item 14) ──────────────────
// PostgREST answers at most 1,000 rows per request whatever .limit() says, so `.limit(2000)` is a
// silent 1,000 — the People list, a report's staff count and a void's Removals amount all leaned on it.
// A read that must be complete pages (lib/pageAll or a keyset loop). Checked over the admin routes
// from position 27 to the end of the sorted list — the territory this rule was written for; the other
// half of the admin API is its own territory's to bring in.
{
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : e.name === "route.ts" ? [join(d, e.name)] : []);
  const mine = walk(join(ROOT, "app/api/admin")).map((a) => a.slice(ROOT.length + 1)).sort().slice(26);
  const bad = [];
  for (const rel of mine) {
    for (const m of code(rel).matchAll(/\.limit\((\d[\d_]*)\)/g)) if (Number(m[1].replace(/_/g, "")) > 1000) bad.push(`${rel} .limit(${m[1]})`);
  }
  check("no admin route from position 27 on asks for more than 1,000 rows in one read", bad.length === 0,
    bad.length ? `${bad.join("; ")} — PostgREST returns 1,000; page it` : "");
}

// ── 20 · ONE READABLE-PASSWORD MAKER (sweep #10 T29 round 2, item 15) ─────────────────────────────
// Six routes carried their own copy of "make a password with no l/o/0/1". A copy that drifts prints a
// handover sheet that reads two ways. app/ must hold no second copy of the alphabet.
{
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : /\.tsx?$/.test(e.name) ? [join(d, e.name)] : []);
  const copies = walk(join(ROOT, "app")).filter((a) => /abcdefghijkmnpqrstuvwxyz23456789|function genPassword/.test(readFileSync(a, "utf8"))).map((a) => a.slice(ROOT.length + 1));
  check("every screen that mints a password uses lib/readablePassword — no route keeps its own copy", copies.length === 0, copies.join(", "));
}

// ── 21 · THE ACCESS LOG LINE SAYS WHAT WAS SAVED, NOT WHAT WAS ASKED (sweep #10 T29 r2, item 17) ──
{
  const rel = "app/api/admin/restaurants/access-tree/route.ts";
  const src = code(rel);
  check(`${rel} exists`, !!src);
  if (src) {
    check("Access → the Activity line is written from what LANDED (a clamped ceiling is logged clamped)",
      /const changed = describeAccessPatch\(landed\)/.test(src) && !/describeAccessPatch\(patch\)/.test(src),
      "the line would describe values the allow-lists dropped or clamped");
    check("…and the clamped ceiling is what gets recorded", /\.limit = \{ \.\.\.\(landed\.config\[permId\]\.limit \|\| \{\}\), \[sd\]: dest\[sd\] \}/.test(src));
  }
}

console.log(`\n${fails ? `FAILED — ${fails} check(s)` : "PASS — no admin route answers a refusal, or a save, more optimistically than it knows"}\n`);
process.exit(fails ? 1 : 0);
