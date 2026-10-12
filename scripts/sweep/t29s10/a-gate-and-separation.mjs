// Section A — does every request require the admin login before it touches data, and does every query
// say which restaurant (or which one row) it is about? Proved by READING the code — never by calling a
// route signed out (sweep #10 rule 7). One phase per exported handler, one per file.
export default function section(c) {
  const { RETIRED, GONE, FILED, isGone } = c;   // the filed list (round 2, item 13) — defined in the main script
  c.sec("A · the admin login comes first, in every handler of every route (read, not probed)");
  const GATE = /tokenIsValid\(|requireAdmin\(req\)|await admin\(req\)|await gate\(req\)/;
  const DB = /\bsb\.(from|rpc|storage)\(|supabaseAdmin\.(from|rpc)\(|softDeleteOrders\(|closeSession\(|recordRemoval\(|logAction\(|pageAll</;
  for (const rel of FILED) {
    const hs = isGone(rel) ? Object.fromEntries(RETIRED[rel].map((v) => [v, null])) : c.handlers(rel);
    for (const verb of Object.keys(hs).sort()) {
      const short = rel.replace("app/api/admin/", "").replace("/route.ts", "");
      c.phase(`${short} · ${verb} checks the admin sign-in before anything touches the database`,
        `read ${rel}: the first gate call sits before the first database / storage / audit call in the ${verb} body`,
        () => {
          if (isGone(rel)) return GONE;
          const b = hs[verb];
          const g = b.search(GATE), d = b.search(DB);
          if (g < 0) return `no admin gate found in ${verb}`;
          return d < 0 || g < d || `the first database call (offset ${d}) comes before the gate (offset ${g})`;
        });
    }
  }

  c.sec("A · every query names its restaurant or its one row — read per file");
  // A chain that touches a TENANT table must carry a filter (eq/in/is/not/neq/range on a key), or be
  // an insert/upsert carrying the restaurant id, or be one of the console's deliberate WHOLE-PLATFORM
  // reads — the admin is the one reader who sees every restaurant, and each of those is named here
  // with its reason, so a new unfiltered read cannot hide among them.
  const PLATFORM_WIDE = new Map([
    ["restaurants", "the console's restaurant list, bin and name lookups are platform-wide by design (paged)"],
    ["restaurant_billing", "the platform's own subscription ledger, read whole for MRR"],
    ["restaurant_owners", "the owner-membership map for the Restaurants list (paged)"],
    ["settings", "the panel-chip map for the Restaurants list, and the platform-wide retention write"],
    ["staff_users", "the People list and the owner picker, both platform-wide by design"],
    ["staff_actions", "the Repair board's bulk resolve, scoped to one restaurant when the picker names one"],
    ["app_config", "platform-wide keys (the remembered create form, the retention lock)"],
  ]);
  for (const rel of FILED) {
    const short = rel.replace("app/api/admin/", "").replace("/route.ts", "");
    c.phase(`${short} — every table query names a restaurant or a row, or is a declared platform-wide read`,
      `read ${rel}: each sb.from(...) chain up to its semicolon`,
      () => {
        if (isGone(rel)) return GONE;
        const src = c.clean(rel);
        const bad = [];
        for (const m of src.matchAll(/sb\.from\("([a-z_]+)"\)/g)) {
          const end = src.indexOf(";", m.index);
          const chain = src.slice(m.index, end > -1 ? end : m.index + 600);
          const filtered = /\.(eq|in|is|not|neq|match|or)\(/.test(chain) || /\.(insert|upsert)\(/.test(chain);
          if (!filtered && !PLATFORM_WIDE.has(m[1])) bad.push(m[1]);
        }
        return bad.length === 0 || `unfiltered read of ${[...new Set(bad)].join(", ")}`;
      });
  }

  c.sec("A · no restaurant, person or session is taken from a header or a cookie the screen controls");
  for (const rel of FILED) {
    const short = rel.replace("app/api/admin/", "").replace("/route.ts", "");
    c.phase(`${short} — the restaurant it acts on comes from the request body / query it validates, never from a header`,
      `grep ${rel} for headers.get("x-…restaurant…") / cookies.get(…rid…)`,
      () => isGone(rel) ? GONE : !/headers\.get\("x-[a-z-]*(restaurant|rid|tenant)/i.test(c.clean(rel)) && !/cookies\.get\("[^"]*(rid|restaurant)/i.test(c.clean(rel)) || "reads a restaurant from a header or cookie");
  }

  c.sec("A · secrets never leave the server");
  c.phase("no route in the territory imports the client-side Supabase helper — every one uses the service role on the server only",
    "grep the 25 files for lib/supabaseClient / createBrowserClient", () => {
      const bad = c.ROUTES.filter((r) => /supabaseClient|createBrowserClient/.test(c.raw(r)));
      return bad.length === 0 || bad.join(", ");
    });
  c.phase("no route prints a password, a PIN, a channel key or the reveal password to the server log",
    "read every console.* call in the 25 files and what it is handed", () => {
      const bad = [];
      for (const r of c.ROUTES) for (const m of c.clean(r).matchAll(/console\.(log|error|warn)\(([^;]*)\);/g))
        if (/password(?!Fields)|pin\b|pin_hash|\.key\b|REVEAL|typed/.test(m[2]) && !/could not|failed|refused/.test(m[2])) bad.push(`${r}: ${m[2].slice(0, 60)}`);
      return bad.length === 0 || bad.join(" · ");
    });
  c.phase("no audit line in the territory carries a password value — only that one was set, and for whom",
    "read every logAction detail in reveal/password, credentials and users", () => {
      const bad = [];
      for (const r of ["app/api/admin/reveal/password/route.ts", "app/api/admin/restaurants/credentials/route.ts", "app/api/admin/users/route.ts"])
        for (const m of c.clean(r).matchAll(/logAction\([\s\S]*?\}\);/g)) if (/\$\{\s*(password|pw|typed|pin)\s*\}/.test(m[0])) bad.push(r);
      return bad.length === 0 || bad.join(", ");
    });
  c.phase("the readable password copy (`password_shown`) is selected by exactly the two routes that hand it over, behind the uncover window",
    "grep the 25 files for password_shown in a select", () => {
      const who = c.ROUTES.filter((r) => /select\([^)]*password_shown/.test(c.clean(r))).map((r) => r.replace("app/api/admin/", "").replace("/route.ts", ""));
      return JSON.stringify(who.sort()) === JSON.stringify(["restaurants/credentials", "reveal/password"]) || `selected by: ${who.join(", ")}`;
    });
  c.phase("…and both of them check the uncover window before opening it",
    "read both routes: revealUnlocked(…) precedes openPassword(…) on every path that returns a password", () => {
      const a = c.clean("app/api/admin/reveal/password/route.ts"), b = c.clean("app/api/admin/restaurants/credentials/route.ts");
      return a.indexOf("revealUnlocked(") > -1 && a.indexOf("revealUnlocked(") < a.indexOf("openPassword(")
        && /password: unlocked \? pw : null/.test(b) || "a path opens a stored password without the window";
    });
  c.phase("no route in the territory selects password_hash at all",
    "grep the 25 files", () => c.ROUTES.filter((r) => /password_hash/.test(c.clean(r).replace(/passwordFields/g, ""))).length === 0 || "a route selects password_hash");
  c.phase("pin_hash is read only to answer yes/no (hasPin), and stripped before the answer is built",
    "read users/route.ts: every select of pin_hash is followed by a destructure that drops it", () => {
      const s = c.clean("app/api/admin/users/route.ts");
      return /const \{ pin_hash, \.\.\.safe \} = u;/.test(s) && /map\(\(\{ pin_hash, \.\.\.u \}/.test(s) || "pin_hash could reach the answer";
    });
  c.phase("the recovery backup strips the delivery-app keys from settings and every hash from staff",
    "read export/route.ts: panelSafeSettings on settings, a named column list (no hash) on staff_users", () => {
      const s = c.clean("app/api/admin/restaurants/export/route.ts");
      // Since item 12 every table is paged through readAll(), the staff list with its own named columns.
      return /panelSafeSettings\(/.test(s) && /readAll\("staff_users", "id, username, name, role, restaurant_id, phone, active, profile_confirmed, permissions, created_at"\)/.test(s) || "the backup could carry a secret";
    });
  // The delivery-channel door was RETIRED in round 2 (item 13); Access & permissions is its one home now.
  c.phase("Access & permissions shows each delivery channel's on/off and never a key value",
    "GET the French House state; read channels and search for a stored key", async () => {
      const r = await c.req(`/api/admin/restaurants/access-tree?restaurant_id=${c.FH}`);
      const ch = r.json?.state?.channels || {};
      return ["zomato", "swiggy", "website"].every((k) => typeof ch[k] === "boolean") && !/"(key|api_key)"\s*:\s*"[^"]/.test(r.text) || "a key value, or a channel missing";
    });
  c.phase("the uncover cookie is HttpOnly, path /, and Secure in production",
    "read reveal/route.ts cookies.set", () => /res\.cookies\.set\(REVEAL_COOKIE, value, \{\s*httpOnly: true, sameSite: "lax", path: "\/",\s*maxAge: [^,]+, secure: secure\(\),?\s*\}\)/.test(c.clean("app/api/admin/reveal/route.ts")) || "cookie flags changed");
  c.phase("re-covering clears the cookie with the SAME flags it was set with, so the browser really drops it",
    "read reveal/route.ts DELETE", () => /cookies\.set\(REVEAL_COOKIE, "", \{ httpOnly: true, sameSite: "lax", path: "\/", maxAge: 0, secure: secure\(\) \}\)/.test(c.clean("app/api/admin/reveal/route.ts")) || "the clearing cookie differs");

  c.sec("A · every new Postgres function these routes call is limited to the server");
  c.phase("every RPC the territory calls is in the migrations' grant record (verify:grants owns the detail)",
    "list sb.rpc names in the 25 files and find each one's REVOKE/GRANT in supabase/migrations", () => {
      const names = new Set();
      for (const r of c.ROUTES) for (const m of c.clean(r).matchAll(/\.rpc\("([a-z_0-9]+)"/g)) names.add(m[1]);
      const migs = readdirSyncSafe(c.ROOT);
      const missing = [...names].filter((n) => !migs.some((t) => new RegExp(`revoke[^;]*${n}[^;]*from\\s+(public|anon)`, "i").test(t)));
      return missing.length === 0 || { ok: false, note: `no REVOKE found for: ${missing.join(", ")}` };
    });
}

import { readdirSync, readFileSync } from "node:fs";
function readdirSyncSafe(root) {
  const dir = `${root}supabase/migrations`;
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(`${dir}/${f}`, "utf8"));
}
