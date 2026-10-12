#!/usr/bin/env node
/**
 * verify-admin-routes-t29.mjs — sweep #10, TERMINAL 29: 500 new checks over the admin server routes
 * 27-to-the-end (`find app/api/admin -name route.ts | sort | sed -n '27,$p'` — 25 files today).
 *
 * ── WHY IT IS A SCRIPT AND NOT A TYPED TABLE ────────────────────────────────────────────────────
 * The same reason as verify-admin-api-b.mjs (sweep #9 T27 round 2): five hundred typed rows drift from
 * the checks within days, and then "re-run P198042" stops meaning anything. So this file IS the ledger:
 * it runs the phases, prints them, and `--ledger` writes `LEDGER/T29-S10.md` from the same source.
 *
 *   node scripts/verify-admin-routes-t29.mjs --base http://localhost:4429
 *   node scripts/verify-admin-routes-t29.mjs --base http://localhost:4429 --ledger
 *   node scripts/verify-admin-routes-t29.mjs --base http://localhost:4429 --from 198120 --to 198160
 *
 * ── THE IDS ─────────────────────────────────────────────────────────────────────────────────────
 * Pre-allocated block `P198001`–`P199000` (sweep #10, terminal 29). Ids are assigned in declaration
 * order from P198001, so a NEW phase goes at the END of its section file's list only if that section
 * is last — otherwise append a new section. Never reorder: the ids are what the ledger is keyed on.
 *
 * ── WHERE THE 500 WENT (measured, not imagined — S10-RULES rule 3) ──────────────────────────────
 * Rows per 100 lines BY SUBJECT across all 62 ledgers, before planning: credentials 1.8, repair 1.8,
 * access-tree 1.9, restaurants/settings 2.1, users 2.2, resolve-error 2.3 (2 of its 5 rows ever
 * DROVE the app), report 3.0, users/photo 3.6, admin settings 3.7 … against usage 22.6 and
 * create-defaults 20.0. So the big, money-adjacent, write-heavy routes lead, and every file gets a
 * CROSS-CHECK the old ledgers never ran: the route's answer compared with the database's own count.
 *
 * ── WHAT IT WRITES ──────────────────────────────────────────────────────────────────────────────
 * Almost nothing, on purpose. Every driven write phase is a path that must REFUSE (a bad input, an
 * already-done action, a covered password door), so it changes no row. The two reads that log
 * themselves (the recovery backup, the uncover gate's wrong-password counter is NOT touched here)
 * have their `staff_actions` rows deleted by id at the end. **Aangan is only ever READ** — it is the
 * read-only control. No phase calls a route signed out or with a doctored cookie (sweep #10 rule 7):
 * the sign-in gate is proved by READING the code.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { requireUp } from "./sweep/appUp.mjs";
import { adminHeaders, adminCookie } from "./sweep/login.mjs";

const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://localhost:4000").replace(/\/$/, "");
const WRITE_LEDGER = process.argv.includes("--ledger");
const FROM = Number(arg("--from", 0)) || 0;
const TO = Number(arg("--to", 0)) || 0;
const ROOT = new URL("..", import.meta.url).pathname;
const env = readFileSync(`${ROOT}.env.local`, "utf8");
const envv = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "") || "";
const SB_URL = envv("NEXT_PUBLIC_SUPABASE_URL"), SRK = envv("SUPABASE_SERVICE_ROLE_KEY");
if (!SB_URL || !SRK) { console.error(".env.local must carry the dev Supabase URL and service-role key"); process.exit(2); }
// THE DEV DATABASE ONLY. This file deletes the diary rows it causes; it must never point anywhere else.
if (!/wnsfcizclkbobwzcxqsf/.test(SB_URL)) { console.error("refusing: this guard runs against the dev database only"); process.exit(2); }

await requireUp(BASE, "the admin server routes 27-to-the-end (sweep #10 T29)");

const FH = "00000000-0000-0000-0000-000000000001";
const AANGAN = "6c6fadb6-da23-4ab3-9f90-d164773f60b3";
const T0 = new Date().toISOString();
const H = adminHeaders(BASE);

/** One read of the dev database with the service key — used to CROSS-CHECK a route's answer. */
async function sq(path, opts = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...opts, headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "content-type": "application/json", Prefer: opts.prefer || "return=representation", ...(opts.headers || {}) } });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* not json */ }
  return { status: r.status, json: j, text: t, range: r.headers.get("content-range") };
}
/** A head count, so a cross-check moves a number and no rows. */
async function count(table, filter) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?select=*&${filter}`, { method: "HEAD", headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, Prefer: "count=exact" } });
  return Number((r.headers.get("content-range") || "*/0").split("/")[1]);
}
/** The app, signed in as the admin (one cookie for the whole run — never a sign-in request). */
async function req(path, { method = "GET", body, headers = {}, form } = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...H, ...(form ? {} : { "content-type": "application/json" }), ...headers }, body: form || (body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* html / empty */ }
  return { status: r.status, json, text, headers: r.headers };
}
/** A route file's source with comments stripped — a fix leaves the old code quoted in prose. */
const raw = (rel) => readFileSync(join(ROOT, rel), "utf8");
const clean = (rel) => raw(rel)
  .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/([^:"'`])\/\/[^\n"'`]*$/gm, "$1");
const ROUTES = (() => {
  const walk = (d) => readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : e.name === "route.ts" ? [`${d}/${e.name}`] : []);
  return walk("app/api/admin").sort().slice(26);
})();
/** Each exported handler's body, so "the gate runs before the first database call" is checked per verb. */
function handlers(rel) {
  const src = clean(rel);
  const out = {};
  for (const m of src.matchAll(/export (?:async )?function (GET|POST|PATCH|PUT|DELETE)\s*\(/g)) {
    let i = src.indexOf("{", m.index), depth = 0, j = i;
    for (; j < src.length; j++) { if (src[j] === "{") depth++; else if (src[j] === "}" && --depth === 0) break; }
    out[m[1]] = src.slice(i, j + 1);
  }
  for (const m of src.matchAll(/export const (GET|POST|PATCH|DELETE) = \w+\((\w+)/g)) {
    // withIdempotency(fn) — follow one hop (and one more if that is itself a wrapper).
    let name = m[2];
    for (let hop = 0; hop < 3; hop++) {
      const f = src.match(new RegExp(`async function ${name}\\s*\\([^)]*\\)[^{]*\\{`));
      if (!f) break;
      let i = f.index + f[0].length - 1, depth = 0, j = i;
      for (; j < src.length; j++) { if (src[j] === "{") depth++; else if (src[j] === "}" && --depth === 0) break; }
      const body = src.slice(i, j + 1);
      const inner = body.match(/await (\w+)\(req\)/);
      if (/tokenIsValid|requireAdmin|admin\(req\)|gate\(req\)/.test(body.slice(0, 400)) || !inner) { out[m[1]] = body; break; }
      name = inner[1];
    }
  }
  return out;
}

// THE FILED LIST (round 2, item 13): three routes were retired on 2026-10-12. Their phases keep their
// ids — every id in LEDGER/T29-S10.md stays where it was — and answer ⏭ with the reason; the live
// questions are asked of every route that still exists.
const RETIRED = {
  "app/api/admin/restaurants/google-review/route.ts": ["GET", "POST"],
  "app/api/admin/restaurants/platform-channels/route.ts": ["GET", "POST"],
  "app/api/admin/restaurants/staff-features/route.ts": ["GET", "POST"],
};
const GONE = "skip:route retired 2026-10-12 — Access & permissions does this job (a new way replaces the old one)";
const FILED = [...new Set([...ROUTES, ...Object.keys(RETIRED)])].sort();
const isGone = (rel) => rel in RETIRED && !ROUTES.includes(rel);

const PHASES = [];
let section = "";
const ctx = {
  BASE, FH, AANGAN, T0, ROOT, ROUTES, RETIRED, GONE, FILED, isGone, sq, count, req, raw, clean, handlers, adminCookie,
  sec: (name) => { section = name; },
  phase: (check, how, fn) => PHASES.push({ id: `P${198001 + PHASES.length}`, section, check, how, fn }),
  cache: {},
  idem: [],   // once-only action ids this run sent — their rows are deleted at the end
  /** A POST carrying a fresh once-only id (the Repair and handover routes are wrapped in it). */
  post: async (path, body) => { const id = crypto.randomUUID(); ctx.idem.push(id); return req(path, { method: "POST", body, headers: { "X-LFH-Action-Id": id } }); },
};

// ── the sections, in a fixed order (the ids depend on it) ────────────────────────────────────────
for (const f of ["a-gate-and-separation", "b-repair", "c-resolve-error", "d-restaurants", "e-users", "f-access-and-settings", "g-credentials-and-reveal", "h-reports-and-money", "i-small-routes", "j-screens",
  // round 2 (2026-10-12, the owner: "check every single bit … dead code … unoptimized thing")
  "k-dead-code", "l-efficiency", "m-responses", "n-bad-input", "o-every-restaurant", "p-speed"]) {
  (await import(`./sweep/t29s10/${f}.mjs`)).default(ctx);
}

// ── run ──────────────────────────────────────────────────────────────────────────────────────────
let pass = 0, fail = 0, skip = 0;
const fails = [];
console.log(`\nADMIN SERVER ROUTES 27-TO-THE-END · SWEEP #10 T29 — ${PHASES.length} phases, ${BASE}\n`);
let lastSec = "";
try {
  for (const p of PHASES) {
    const n = Number(p.id.slice(1));
    if ((FROM && n < FROM) || (TO && n > TO)) { p.result = "—"; continue; }
    if (p.section !== lastSec) { console.log(`\n── ${p.section}`); lastSec = p.section; }
    let r;
    try { r = await p.fn(ctx); } catch (e) { r = `threw: ${e instanceof Error ? e.message : String(e)}`; }
    if (r === true || (r && typeof r === "object" && r.ok === true)) { p.result = "✅"; p.note = typeof r === "object" ? r.note : ""; pass++; console.log(`  ✓  ${p.id}  ${p.check}`); }
    else if (typeof r === "string" && r.startsWith("skip:")) { p.result = "⏭"; p.note = r.slice(5); skip++; console.log(`  ⏭  ${p.id}  ${p.check} — ${p.note}`); }
    else { p.result = "❌"; p.note = typeof r === "string" ? r : r && r.note ? r.note : ""; fail++; fails.push(p); console.log(`  ✗  ${p.id}  ${p.check}${p.note ? `\n         ${p.note}` : ""}`); }
  }
} finally {
  // ONLY the diary rows THIS run can cause — the recovery backup logs every download, and nothing else
  // a phase here does writes one. NEVER "every admin row since the run began": other terminals share
  // this database and write admin rows of their own at the same moment (sweep #10 T29 did that once,
  // on its first run, and removed nine of another terminal's test rows — recorded in its report).
  const rows = (await sq(`staff_actions?select=id&panel=eq.admin&action=eq.restaurant_export&detail=eq.${encodeURIComponent("recovery backup downloaded (contains financials)")}&restaurant_id=in.(${[FH, AANGAN].join(",")})&created_at=gte.${T0}&limit=50`)).json || [];
  for (const x of rows) await sq(`staff_actions?id=eq.${x.id}`, { method: "DELETE" });
  let idem = 0;
  for (const id of ctx.idem) { const d = await sq(`action_idempotency?action_id=eq.${id}`, { method: "DELETE" }); idem += (d.json || []).length; }
  console.log(`\n── putting things back: ${rows.length} admin diary row(s) and ${idem} once-only row(s) this run caused, deleted by their own ids`);
}

console.log("\n" + "═".repeat(94));
console.log(`  ADMIN ROUTES 27-END · SWEEP #10 T29 — ${PHASES.length} planned: ${pass} ✅  ${fail} ❌  ${skip} ⏭`);
for (const f of fails) console.log(`    ${f.id}  ${f.check}\n           ${f.note || "(no note)"}`);
console.log("═".repeat(94));

if (WRITE_LEDGER) {
  const bySec = new Map();
  for (const p of PHASES) { if (!bySec.has(p.section)) bySec.set(p.section, []); bySec.get(p.section).push(p); }
  const esc = (t) => String(t == null ? "" : t).replace(/\|/g, "\\|").replace(/\n/g, " ");
  let md = `# T29 of SWEEP #10 — the admin server routes, 27 to the end\n\n`;
  md += `> **GENERATED. A row is never re-typed here by hand.** Regenerate with\n`;
  md += `> \`node scripts/verify-admin-routes-t29.mjs --base <url> --ledger\`.\n\n`;
  md += `**Territory:** \`find app/api/admin -name route.ts | sort | sed -n '27,$p'\` — ${ROUTES.length} files, re-derived\n`;
  md += `on every run. **Block:** \`P198001\`–\`P199000\`, pre-allocated (the *Next free ID* line was never read).\n\n`;
  md += `**Aimed by measurement** (rows per 100 lines by subject): credentials 1.8 · repair 1.8 · access-tree 1.9 ·\n`;
  md += `restaurants/settings 2.1 · users 2.2 · resolve-error 2.3 — against usage 22.6. Every file also gets a\n`;
  md += `CROSS-CHECK against the database's own count, which no earlier ledger ran.\n\n`;
  md += `**Run:** \`${BASE}\` · **Result: ${pass} ✅ · ${fail} ❌ · ${skip} ⏭**\n\n`;
  md += `**Writes.** None that change a row: every driven write is a path that must refuse. The diary rows the\n`;
  md += `recovery-backup downloads write are deleted by id. Aangan is only ever read. No route is called signed\n`;
  md += `out or with a doctored cookie (sweep #10 rule 7) — the sign-in gate is proved by reading the code.\n\n`;
  md += `**Result key:** ✅ pass · ❌ fail · ⏭ unanswered, with a written reason.\n\n---\n`;
  for (const [name, list] of bySec) {
    md += `\n## ${name} · \`${list[0].id}\`–\`${list[list.length - 1].id}\` (${list.length})\n\n`;
    md += `| id | check | how to verify | result | note |\n|---|---|---|---|---|\n`;
    for (const p of list) md += `| ${p.id} | ${esc(p.check)} | ${esc(p.how)} | ${p.result} | ${esc(p.note)} |\n`;
  }
  mkdirSync(`${ROOT}.claude/sweep/LEDGER`, { recursive: true });
  writeFileSync(`${ROOT}.claude/sweep/LEDGER/T29-S10.md`, md);
  console.log(`  ledger written: .claude/sweep/LEDGER/T29-S10.md (${PHASES.length} rows)\n`);
}
process.stdout.write("", () => process.exit(fail ? 1 : 0));
