// T33 round 2 · BLOCKS B–E. 442 phases, P152009–P152450.
//   B  every function these 83 files install, asked of the live catalogue, three rules each (240)
//   C  every file, one composite conformance row each (83)
//   D  invariants over the REAL data, not a fixture (60)
//   E  judgment — should a real restaurant work this way (59)
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { q, one, tx1, RID } from "./tx.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MIG = join(root, "supabase", "migrations");
const all = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const MINE = all.slice(320);
const read = (f) => readFileSync(join(MIG, f), "utf8");
const code = (t) => t.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");

export const rows = [];
let next = 152009;
const add = (subject, check, how, pass, note) => {
  const id = `P${next++}`;
  if (next > 152451) throw new Error("blocks B-E ran past P152450");
  rows.push([id, subject, check, how, pass ? "✅" : "❌", String(note).replace(/\|/g, "／").slice(0, 300)]);
  return pass;
};
const F = (s) => `\`${s}\``;

// the project's OWN allow-list, never a second copy
const ANON_ALLOWED = (() => {
  const src = readFileSync(join(root, "scripts", "verify-db-grants.mjs"), "utf8");
  const b = src.slice(src.indexOf("const ANON_ALLOWED = {"));
  return new Set([...b.slice(0, b.indexOf("\n};")).matchAll(/^\s{2}([a-z0-9_]+):/gm)].map((m) => m[1]));
})();

// one read of the live catalogue
const live = new Map();
for (const r of q(`SELECT p.proname nm, pg_get_functiondef(p.oid) def, p.proacl::text acl,
                          p.provolatile vol, p.prosecdef secdef, p.prokind kind
                     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.prokind = 'f'`)) live.set(r.nm, r);

const liveTables = new Set(q(`SELECT table_name t FROM information_schema.tables
                               WHERE table_schema='public' AND table_type='BASE TABLE'`).map((r) => r.t));
const liveTrg = new Set(q(`SELECT t.tgname n FROM pg_trigger t WHERE NOT t.tgisinternal`).map((r) => r.n));
const liveIdx = new Set(q(`SELECT indexname n FROM pg_indexes WHERE schemaname='public'`).map((r) => r.n));

// ══════════════════ BLOCK B — every function these files install, three rules each ══════════════════
// WHICH FUNCTION BELONGS TO WHICH FILE is decided by the NEWEST file in this range that declares it,
// because that is the definition a re-seed leaves standing.
const owner = new Map();
for (const f of MINE)
  for (const m of code(read(f)).matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z0-9_]+)/gi))
    owner.set(m[1].toLowerCase(), f);
// a function a LATER file in the range drops is not expected to exist
for (const f of MINE)
  for (const m of code(read(f)).matchAll(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?([a-z0-9_]+)\s*\([^)]*\)\s*;/gi)) {
    // a DROP immediately followed by a CREATE of the same name is a re-create, not a retirement
    const src = code(read(f));
    if (!new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${m[1]}\\b`, "i").test(src)) owner.delete(m[1].toLowerCase());
  }
const fnNames = [...owner.keys()].sort();
export const fnCount = fnNames.length;

for (const nm of fnNames) {
  const f = owner.get(nm), L = live.get(nm);
  add(F(f), `${nm} — the function this file declares is INSTALLED in the database`,
    "look it up in pg_proc", !!L, L ? "present" : "ABSENT from the live database");
  if (!L) {
    add(F(f), `${nm} — its search_path is pinned in the installed definition, if it is SECURITY DEFINER`,
      "read the installed definition", false, "cannot be checked: the function is absent");
    add(F(f), `${nm} — its live permissions are what the project wrote down`,
      "read proacl against the 49-entry allow-list in verify-db-grants.mjs", false, "cannot be checked: the function is absent");
    continue;
  }
  const header = L.def.slice(0, L.def.search(/\bAS\s+\$/i) > 0 ? L.def.search(/\bAS\s+\$/i) : 600);
  const defr = L.secdef === true;
  add(F(f), `${nm} — its search_path is pinned IN the definition (a separate ALTER would not survive the next rewrite)`,
    "read the installed header for SET search_path when it is SECURITY DEFINER",
    !defr || /SET\s+search_path/i.test(header),
    defr ? (/SET\s+search_path/i.test(header) ? "SECURITY DEFINER with search_path pinned" : "SECURITY DEFINER with NO search_path")
         : "SECURITY INVOKER — runs as the caller, so no pin is needed");
  const anonOpen = /(?:^|,|\{)(?:anon|PUBLIC)=[a-zA-Z]*X/.test(L.acl || "");
  add(F(f), `${nm} — it is reachable with the public menu key only if that is a written decision`,
    "read proacl and compare against the allow-list verify-db-grants.mjs keeps",
    !anonOpen || ANON_ALLOWED.has(nm),
    anonOpen ? (ANON_ALLOWED.has(nm) ? "guest-callable, and on the written allow-list" : "guest-callable and NOT on the allow-list")
             : "not reachable with the public key");
}

// ══════════════════ BLOCK C — one composite conformance row per file ══════════════════
for (const f of MINE) {
  const raw = read(f), c = code(raw);
  // 1 · safe to run a second time
  const unsafe = [];
  for (const m of c.matchAll(/\bCREATE\s+(TABLE|UNIQUE\s+INDEX|INDEX|TRIGGER|TYPE|POLICY|SEQUENCE)\b([^;]*)/gi)) {
    if (/IF\s+NOT\s+EXISTS/i.test(m[0])) continue;
    const nm = (m[0].match(/CREATE\s+(?:UNIQUE\s+)?[A-Z]+\s+([a-z0-9_."]+)/i) || [])[1];
    if (nm && new RegExp(`DROP\\s+[A-Z ]*IF EXISTS\\s+${nm.replace(/[.\"]/g, "\\$&")}`, "i").test(c)) continue;
    if (/DO\s+\$|duplicate_object|EXCEPTION\s+WHEN/i.test(c.slice(Math.max(0, m.index - 400), m.index))) continue;
    unsafe.push(m[0].slice(0, 40).replace(/\s+/g, " "));
  }
  // 2 · the header names this file's own number, or says it was renumbered
  const first4 = raw.split("\n").slice(0, 6).join(" ");
  const nums = [...first4.matchAll(/(?<![\w])(\d{3})(?![\d])/g)].map((x) => x[1]);
  const own = f.slice(0, 3);
  const headerOk = nums.length === 0 || nums.includes(own) || /RENUMBER/i.test(raw);
  // 3 · every object it declares is present live — UNLESS a LATER file in the sequence retired it.
  // `verify:migration-truth` allows exactly this (31 such objects across the whole folder) and the
  // first version of this block did not, so migration 368's print_pairings table read as missing
  // when migration 380 had deliberately replaced it with print_setup_codes.
  const retiredLater = (name) => {
    const after = all.slice(all.indexOf(f) + 1);
    const re = new RegExp(`DROP\\s+(?:TABLE|TRIGGER|INDEX)\\s+(?:IF\\s+EXISTS\\s+)?(?:public\\.)?${name}\\b`, "i");
    return after.some((x) => re.test(code(read(x))));
  };
  const missing = [], retired = [];
  const want = (kind, name, present) => {
    if (present) return;
    if (retiredLater(name)) retired.push(`${kind} ${name}`); else missing.push(`${kind} ${name}`);
  };
  for (const m of c.matchAll(/CREATE\s+TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?([a-z0-9_]+)/gi))
    want("table", m[1], liveTables.has(m[1].toLowerCase()) || new RegExp(`DROP\\s+TABLE[\\s\\S]{0,80}${m[1]}`, "i").test(c));
  for (const m of c.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+([a-z0-9_]+)/gi))
    want("trigger", m[1], liveTrg.has(m[1].toLowerCase()));
  // AN INDEX GOES WITH ITS TABLE. DROP TABLE takes every index on it, so a later file that retires
  // the table retires the index too without ever naming it — which is how print_pairings_expires_idx
  // read as missing after migration 380 replaced print_pairings with print_setup_codes.
  for (const m of c.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF NOT EXISTS\s+)?([a-z0-9_]+)([\s\S]{0,120}?)\bON\s+(?:public\.)?([a-z0-9_]+)/gi)) {
    const [, idxName, , tbl] = m;
    if (liveIdx.has(idxName.toLowerCase())) continue;
    if (retiredLater(idxName) || !liveTables.has(tbl.toLowerCase()) && retiredLater(tbl)) retired.push(`index ${idxName} (with its table ${tbl})`);
    else missing.push(`index ${idxName}`);
  }
  const pass = unsafe.length === 0 && headerOk && missing.length === 0;
  add(F(f), "this file is safe to run a SECOND time, its header names its own number, and every object it declares is really in the database",
    "read every DDL statement for re-runnability; read the first six lines for the number; match declared tables, triggers and indexes against the catalogue",
    pass,
    pass ? `re-seed safe · header ${nums.length ? "names " + [...new Set(nums)].join(",") : "carries no number"} · ${retired.length ? `every declared object present except ${retired.join(", ")}, retired by a LATER migration` : "every declared object present"}`
         : [unsafe.length ? `not re-runnable: ${unsafe.join(" | ")}` : "",
            headerOk ? "" : `header names ${nums.join(",")} but not ${own}`,
            missing.length ? `absent live: ${missing.join(", ")}` : ""].filter(Boolean).join(" · "));
}
export const fileRows = MINE.length;
