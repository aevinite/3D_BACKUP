// scripts/sweep/t39s10/round2-checks.mjs — sweep #10 T39 round 2, Bands H and I (read-only).
//
//   node scripts/sweep/t39s10/round2-checks.mjs --out <rows.json>
//
// H · the automatic checker (.github), the packages and the settings files — each a real assertion.
// I · the DEV database is left clean by the tests: no stale open tables, no fake order counting as a
//     sale, no test account or test restaurant left switched on, every test switch put back.
//     SELECT only, on the dev database only (refuses anything else).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { refuseUnlessDevTestDb } from "../devStacks.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const require = createRequire(join(ROOT, "package.json"));
const yaml = require("js-yaml");
const argv = process.argv.slice(2);
const OUT = argv[argv.indexOf("--out") + 1];
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const rows = [];
const add = (band, file, check, how, ok, note = "") => rows.push({ band, file, check, how, result: ok === null ? "⏭" : ok ? "✅" : "❌", note: String(note).slice(0, 220) });

// ══ H · CI, packages, settings ═════════════════════════════════════════════════════════════════
const pkg = JSON.parse(read("package.json"));
const S = pkg.scripts;
const ciText = read(".github/workflows/checks.yml");
let ci = null; try { ci = yaml.load(ciText, { schema: yaml.JSON_SCHEMA }); } catch { /* recorded below */ }
add("H", ".github/workflows/checks.yml", "the CI workflow is valid YAML", "js-yaml load", !!ci);
const steps = ci ? Object.values(ci.jobs || {}).flatMap((j) => j.steps || []) : [];
add("H", ".github/workflows/checks.yml", "CI has an install step with an id, and real check steps after it", "count steps", steps.some((s) => s.id === "install") && steps.length >= 10, `${steps.length} steps`);
const after = steps.slice(steps.findIndex((s) => s.id === "install") + 1);
add("H", ".github/workflows/checks.yml", "every CI step after install still runs when an earlier one fails", "each step's if:", after.every((s) => /!cancelled\(\) && steps\.install\.outcome == 'success'/.test(String(s.if || ""))), after.filter((s) => !/!cancelled/.test(String(s.if || ""))).map((s) => s.name).join(", "));
const runs = after.map((s) => String(s.run || ""));
const npmRuns = runs.flatMap((r) => [...r.matchAll(/npm run -s ([\w:-]+)/g)].map((m) => m[1]));
add("H", ".github/workflows/checks.yml", "every npm entry CI runs exists in package.json", "match each `npm run -s X`", npmRuns.every((k) => S[k]), npmRuns.filter((k) => !S[k]).join(", ") || `${npmRuns.length} entries`);
const nodeRuns = runs.flatMap((r) => [...r.matchAll(/node ([\w./-]+\.mjs)/g)].map((m) => m[1]));
add("H", ".github/workflows/checks.yml", "every script CI runs directly exists", "existsSync each `node X`", nodeRuns.every((f) => existsSync(join(ROOT, f))), nodeRuns.join(", "));
const nodeVer = String((steps.find((s) => s.with && s.with["node-version"]) || {}).with?.["node-version"] || "");
add("H", "package.json", "CI tests on the Node major the site builds on (engines.node)", "compare node-version with engines", nodeVer && String(pkg.engines?.node || "").startsWith(nodeVer), `CI ${nodeVer} · engines ${pkg.engines?.node}`);
add("H", ".github/workflows/checks.yml", "CI pins its actions to a major version, never a branch", "every uses: …@vN", steps.filter((s) => s.uses).every((s) => /@v\d+/.test(s.uses)), steps.filter((s) => s.uses).map((s) => s.uses).join(", "));
const push = String(S["verify:push"] || "");
const ciNpm = new Set(npmRuns);
const pushNpm = new Set([...push.matchAll(/npm run -s ([\w:-]+)/g)].map((m) => m[1]));
const missingFromPush = [...ciNpm].filter((k) => !pushNpm.has(k) && k !== "verify:deps");
add("H", "package.json", "verify:push runs everything CI runs (bar verify:deps, which needs the network)", "compare entry lists", missingFromPush.length === 0, missingFromPush.join(", ") || `${pushNpm.size} entries`);
const lintCap = Number((String(S.lint).match(/--max-warnings[= ](\d+)/) || [])[1]);
let lintNow = NaN;
try { execFileSync("npx", ["eslint", ".", "--max-warnings", "100000", "-f", "json", "-o", "/dev/null"], { cwd: ROOT, stdio: "ignore", timeout: 600000 }); } catch {}
try { const j = JSON.parse(execFileSync("npx", ["eslint", ".", "-f", "json"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28, timeout: 600000 }).toString() || "[]"); lintNow = j.reduce((a, f) => a + f.warningCount, 0); }
catch (e) { try { const j = JSON.parse(e.stdout || "[]"); lintNow = j.reduce((a, f) => a + f.warningCount, 0); } catch {} }
add("H", "package.json", "the lint warning cap is today's real count (a ratchet that is tight, not slack)", "eslint . vs --max-warnings", lintCap === lintNow, `cap ${lintCap} · now ${lintNow}`);
let mineWarn = NaN;
try { const j = JSON.parse(execFileSync("npx", ["eslint", "scripts", "tests", ".github", "-f", "json"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28, timeout: 600000 })); mineWarn = j; }
catch (e) { try { mineWarn = JSON.parse(e.stdout || "[]"); } catch {} }
const others = /^scripts\/(t17-harness|t30-harness|sweep\/t24-new-[ade]\.mjs|sweep\/t34\/run\.mjs|sweep\/t9s10\/)/;
const minesLeft = Array.isArray(mineWarn) ? mineWarn.filter((f) => f.warningCount && !others.test(f.filePath.slice(ROOT.length + 1))).map((f) => f.filePath.slice(ROOT.length + 1)) : ["(could not run)"];
add("H", "scripts/ · tests/ · .github/", "zero lint warnings in this area, outside files another session was editing", "eslint scripts tests .github", minesLeft.length === 0, minesLeft.join(", ") || "0");
add("H", "package.json", "no dependency is pinned to *, latest or x", "scan the versions", !Object.values({ ...pkg.dependencies, ...pkg.devDependencies }).some((v) => /^\*|latest|^x/.test(v)));
const majors = { next: 16, react: 19, "react-dom": 19, tailwindcss: 4 };
for (const [n, maj] of Object.entries(majors)) {
  const v = String((pkg.dependencies || {})[n] || (pkg.devDependencies || {})[n] || "");
  add("H", "package.json", `${n} stays on major ${maj} (a major bump needs the panels driven first)`, "read the range", new RegExp(`^[\\^~]?${maj}(\\.|$)`).test(v), v);
}
let lsOk = true, lsNote = "";
try { execFileSync("npm", ["ls", "--depth=0"], { cwd: ROOT, stdio: "pipe", timeout: 120000 }); } catch (e) { lsOk = false; lsNote = String(e.stdout || e.message).split("\n").filter((l) => /missing|invalid|ERR/.test(l)).slice(0, 3).join(" · "); }
add("H", "package-lock.json", "every declared package is installed at a version the lock allows (npm ls)", "npm ls --depth=0", lsOk, lsNote);
const lock = JSON.parse(read("package-lock.json"));
const lockRoot = lock.packages?.[""] || {};
const sameDeps = (a = {}, b = {}) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
add("H", "package-lock.json", "the lock's own copy of the dependency list matches package.json", "compare packages[''] with package.json", sameDeps(lockRoot.dependencies, pkg.dependencies) && sameDeps(lockRoot.devDependencies, pkg.devDependencies));
add("H", "package-lock.json", "the lock carries the same Node engine as package.json", "compare engines", JSON.stringify(lockRoot.engines || {}) === JSON.stringify(pkg.engines || {}), JSON.stringify(lockRoot.engines));
const src = execFileSync("git", ["ls-files", "app", "components", "lib", "scripts", "tests", "middleware.ts", "next.config.ts", "instrumentation.ts", "instrumentation-client.ts", "sentry.server.config.ts", "sentry.edge.config.ts", "postcss.config.mjs", "eslint.config.mjs"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
const corpus = src.map((f) => { try { return readFileSync(join(ROOT, f), "utf8"); } catch { return ""; } }).join("\n");
for (const n of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
  const used = corpus.includes(`"${n}"`) || corpus.includes(`'${n}'`) || corpus.includes(`"${n}/`) || corpus.includes(`'${n}/`) || /^(typescript|eslint|eslint-config-next|tailwindcss|@tailwindcss\/postcss|@types\/.+)$/.test(n) || JSON.stringify(S).includes(n);
  add("H", "package.json", `the package "${n}" is actually used by the code (or is a build tool)`, "search the tracked source for its import", used);
}
const dep = yaml.load(read(".github/dependabot.yml"), { schema: yaml.JSON_SCHEMA });
const npmUp = (dep.updates || []).find((u) => u["package-ecosystem"] === "npm");
add("H", ".github/dependabot.yml", "Dependabot watches npm weekly, at most 5 PRs, with grouped minor/patch updates", "read the config", !!npmUp && npmUp.schedule?.interval === "weekly" && npmUp["open-pull-requests-limit"] <= 5 && !!npmUp.groups);
add("H", ".github/dependabot.yml", "Dependabot leaves MAJOR updates to a person", "read ignore / update-types", JSON.stringify(npmUp || {}).includes("major"), "");
// Asked of git itself (git check-ignore), not of the file's spelling — `/.next/`, `.next` and
// `.next/` all mean the same thing, and a literal reading of the file got that wrong.
for (const probe of [".env.local", "node_modules/x", ".next/x", ".next-8093/x", ".claude/sweep/x"]) {
  let ignored = false; try { execFileSync("git", ["check-ignore", "-q", probe], { cwd: ROOT }); ignored = true; } catch {}
  add("H", ".gitignore", `git ignores ${probe.replace(/\/x$/, "/")}`, "git check-ignore", ignored);
}
const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n");
add("H", "(the repo)", "no .env file is tracked", "git ls-files", !tracked.some((f) => /(^|\/)\.env(\.|$)/.test(f) && !/\.example$/.test(f)), tracked.filter((f) => /(^|\/)\.env/.test(f)).join(", "));
let keyHits = [];
// git grep exits 1 when it finds nothing — that is the good answer, not an error.
try { keyHits = execFileSync("git", ["grep", "-lE", "sbp_[A-Za-z0-9]{20,}|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\\.eyJ[A-Za-z0-9_-]{40,}", "--", "scripts", "tests", ".github"], { cwd: ROOT, encoding: "utf8" }).trim().split("\n").filter(Boolean); }
catch (e) { if (e.status !== 1) keyHits = ["(git grep failed: " + String(e.message).slice(0, 80) + ")"]; }
add("H", "scripts/ · tests/ · .github/", "no access key or service key is written into a tracked script", "git grep for key shapes", keyHits.length === 0, keyHits.join(", "));

// ══ I · the dev database, left clean ═══════════════════════════════════════════════════════════
const env = {}; for (const l of read(".env.local").split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
refuseUnlessDevTestDb(env.NEXT_PUBLIC_SUPABASE_URL, "this reads the dev database");
const ref = env.NEXT_PUBLIC_SUPABASE_URL.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/)[1];
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: sql, read_only: true }) });
  const t = await r.text(); if (!r.ok) throw new Error(t.slice(0, 200)); return JSON.parse(t);
};
const one = async (sql) => Object.values((await q(sql))[0] || {})[0];
const I = async (check, sql, want, note = (v) => String(v)) => {
  try { const v = await one(sql); add("I", "(dev database)", check, "SELECT: " + sql.replace(/\s+/g, " ").slice(0, 150), want(v), note(v)); }
  catch (e) { add("I", "(dev database)", check, "SELECT", false, "could not read: " + e.message); }
};
const FH = "00000000-0000-0000-0000-000000000001";
const LIVE_R = "r.deleted_at is null";
await I("no LIVE restaurant carries an open table untouched for over a week (billed ones excepted — they end in the app)",
  `select count(*) from sessions s join restaurants r on r.id=s.restaurant_id where ${LIVE_R} and s.status='open' and s.invoice_no is null and coalesce(s.last_activity_at,s.opened_at,s.created_at) < now()-interval '7 days'`, (v) => Number(v) === 0);
await I("…and the billed ones still open are exactly the two at Aangan, left for the app's own close (invoices 30, 31)",
  `select string_agg(s.invoice_no::text, ',' order by s.invoice_no) from sessions s join restaurants r on r.id=s.restaurant_id where ${LIVE_R} and s.status='open' and s.invoice_no is not null and coalesce(s.last_activity_at,s.opened_at,s.created_at) < now()-interval '7 days'`, (v) => String(v) === "30,31");
await I("no BINNED restaurant still has an open table",
  `select count(*) from sessions s join restaurants r on r.id=s.restaurant_id where r.deleted_at is not null and s.status='open'`, (v) => Number(v) === 0);
await I("no week-old ticket is on any kitchen board, outside those two billed Aangan tables",
  `select count(*) from orders o left join sessions s on s.id=o.session_id where o.archived=false and o.deleted_at is null and o.status in ('received','preparing','served') and o.created_at < now()-interval '7 days' and not (s.invoice_no is not null and s.status='open')`, (v) => Number(v) === 0);
for (const tag of ["speed run", "sweep", "stuck-test"]) {
  await I(`no '${tag}' test order counts as a sale anywhere (each is cancelled)`,
    `select count(*) from orders where placed_by='${tag}' and status <> 'cancelled' and payment_status <> 'paid'`, (v) => Number(v) === 0);
}
await I("no table-ownership (OWNCHK) or verify:customers fixture order counts as a sale or an order (the 260 were cancelled)",
  `select count(*) from orders where status <> 'cancelled' and (delete_reason = 'verify:customers fixture' or table_number='OWNCHK' or items::text like '%own-check%')`, (v) => Number(v) === 0);
await I("French House has no unnamed, unbilled, removed order still counting (the 41 were cancelled)",
  `select count(*) from orders where restaurant_id='${FH}' and placed_by is null and status='received' and payment_status='pending' and deleted_at is not null and session_id is null`, (v) => Number(v) === 0);
await I("every zz-speed test restaurant is binned AND removed permanently",
  `select count(*) from restaurants where slug like 'zz-speed-%' and (deleted_at is null or purged_at is null)`, (v) => Number(v) === 0);
await I("every zz-scen test restaurant is binned",
  `select count(*) from restaurants where slug like 'zz-scen-%' and deleted_at is null`, (v) => Number(v) === 0);
await I("no zz test restaurant is left switched on and live",
  `select count(*) from restaurants where (slug like 'zz%' or name ilike 'zz %') and deleted_at is null and active`, (v) => Number(v) === 0, (v) => `${v} live`);
await I("no zztest staff account is left behind",
  `select count(*) from staff_users where username ilike 'zztest%'`, (v) => Number(v) === 0);
await I("no rate-limit row a test raised is left open",
  `select count(*) from rate_limit_events where (subject ilike '%zztest%' or subject_label ilike '%zztest%')`, (v) => Number(v) === 0);
await I("French House's dining sessions are back at the normal setting (off) after today's session checks",
  `select sessions_enabled from settings where restaurant_id='${FH}'`, (v) => v === false, (v) => `sessions_enabled=${v}`);
await I("no test print computer ('Speed PC') is left registered anywhere",
  `select count(*) from print_agents where name in ('Speed PC','Speed PC 2')`, (v) => Number(v) === 0);
await I("no print job for a LIVE order has been stuck queued or printing for over a day (a cancelled order's slip is set aside on read, never printed)",
  `select count(*) from print_jobs j left join orders o on o.id=j.order_id where j.status in ('queued','printing') and j.created_at < now()-interval '1 day' and (o.id is null or o.status <> 'cancelled')`, (v) => Number(v) === 0, (v) => `${v} stuck`);
await I("…and none at all is left queued for a cancelled order for over a day (tidied the app's own way)",
  `select count(*) from print_jobs j join orders o on o.id=j.order_id where j.status='queued' and o.status='cancelled' and j.created_at < now()-interval '1 day'`, (v) => Number(v) === 0);
await I("no platform/parcel order is stuck part-way for over a week",
  `select count(*) from aggregator_orders where status not in ('handed_over','cancelled') and created_at < now()-interval '7 days'`, (v) => Number(v) === 0);
await I("no restaurant has two settings rows",
  `select count(*) from (select restaurant_id from settings group by 1 having count(*) > 1) x`, (v) => Number(v) === 0);
await I("the four invoices yesterday's clean-up cancelled each carry their credit note (311–314)",
  `select count(distinct invoice_no) from credit_notes where invoice_no in (311,312,313,314)`, (v) => Number(v) === 4);
await I("migration 412 is live: the purge clears the loyalty points book",
  `select (prosrc ~ 'loyalty_ledger')::int from pg_proc where proname='admin_purge_restaurant'`, (v) => Number(v) === 1);
await I("migration 413 is live: the loyalty tables are not open to the public key",
  `select count(*) from information_schema.role_table_grants where table_schema='public' and table_name in ('loyalty_ledger','loyalty_config') and grantee in ('anon','authenticated')`, (v) => Number(v) === 0);
await I("Aangan (the untouched control) has no open UNbilled table left over from August",
  `select count(*) from sessions s join restaurants r on r.id=s.restaurant_id where r.slug='aangan-garden-restaurant' and s.status='open' and s.invoice_no is null and s.opened_at < '2026-09-01'`, (v) => Number(v) === 0);
await I("Green Bowl's five paid August–September orders are archived and still paid (a sale never disappears)",
  `select count(*) from orders o join restaurants r on r.id=o.restaurant_id where r.slug='green-bowl' and o.table_number='9' and o.payment_status='paid' and o.archived and o.created_at::date between '2026-08-31' and '2026-09-04'`, (v) => Number(v) === 5);

writeFileSync(OUT, JSON.stringify(rows, null, 1));
const c = (b, r) => rows.filter((x) => x.band === b && (!r || x.result === r)).length;
console.log(JSON.stringify({ H: c("H"), H_bad: c("H", "❌"), I: c("I"), I_bad: c("I", "❌") }));
for (const r of rows.filter((x) => x.result === "❌")) console.log("❌", r.band, r.check, "—", r.note);
