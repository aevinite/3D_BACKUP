// t29r2/lib.mjs — shared parsing + database access for sweep #9 T29's round 2.
// Territory: positions 1-80 of `ls supabase/migrations/*.sql | sort`. READ-ONLY against the database.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const MIG = join(ROOT, "supabase", "migrations");
export const FILES = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
export const MINE = FILES.slice(0, 80);
export const ALL_MIG = FILES;

const _cache = new Map();
export const raw = (f) => { if (!_cache.has(f)) _cache.set(f, readFileSync(join(MIG, f), "utf8")); return _cache.get(f); };
export const code = (f) => raw(f).split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

// ── what each file DECLARES ──────────────────────────────────────────────────────────────────
export function declares(f) {
  const s = code(f);
  const one = (re, pick = (m) => m[1].toLowerCase()) => [...new Set([...s.matchAll(re)].map(pick))];
  const col = [];
  for (const m of s.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?([\s\S]*?);/gi))
    for (const x of m[2].matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s+([a-zA-Z0-9_\[\]() ]+?)(?=,|$|\s+DEFAULT|\s+NOT\s+NULL|\s+REFERENCES|\s+CHECK|\s+UNIQUE)/gi))
      col.push({ key: `${m[1].toLowerCase()}.${x[1].toLowerCase()}`, table: m[1].toLowerCase(), name: x[1].toLowerCase(), type: x[2].trim().toLowerCase() });
  return {
    tbl: one(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi),
    col,
    fn: one(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?/gi),
    view: one(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi),
    trg: one(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+"?(\w+)"?/gi),
    idx: one(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s+ON\b/gi).filter((n) => n !== "if" && n !== "exists"),
    pol: [...s.matchAll(/CREATE\s+POLICY\s+"?([\w ]+?)"?\s+ON\s+(?:public\.)?"?(\w+)"?/gi)].map((m) => `${m[2].toLowerCase()}.${m[1].toLowerCase()}`),
    grants: [...s.matchAll(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\([^)]*\)\s*TO\s+([^;]+);/gi)]
      .map((m) => ({ fn: m[1].toLowerCase(), to: m[2].split(",").map((r) => r.trim().toLowerCase()) })),
    revokes: [...s.matchAll(/REVOKE\s+(?:ALL|EXECUTE)[^;]*?ON\s+FUNCTION\s+(?:public\.)?"?(\w+)"?[^;]*?FROM\s+([^;]+);/gi)]
      .map((m) => ({ fn: m[1].toLowerCase(), from: m[2].split(",").map((r) => r.trim().toLowerCase()) })),
  };
}

// ── the database, read-only ──────────────────────────────────────────────────────────────────
export async function connect() {
  const envPath = join(ROOT, ".env.local");
  if (!existsSync(envPath)) return null;
  const env = Object.fromEntries(readFileSync(envPath, "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_ACCESS_TOKEN) return null;
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  return async (sql) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ read_only: true, query: sql }),
    });
    if (!r.ok) throw new Error((await r.text()).slice(0, 300));
    return r.json();
  };
}

// ── the result recorder: every check is a permanent numbered row ──────────────────────────────
export class Phases {
  constructor(start) { this.ids = start.slice(); this.i = 0; this.rows = []; this.failed = 0; this.quiet = process.argv.includes("--quiet"); }
  next() { if (this.i >= this.ids.length) throw new Error("ID BLOCK EXHAUSTED — stop and report, never take another terminal's range"); return this.ids[this.i++]; }
  add(check, how, ok, note) {
    const id = this.next();
    if (ok === false) this.failed++;
    this.rows.push({ id, check, how, result: ok === null ? "⏭" : ok ? "✅" : "❌", note: note || "" });
    if (!this.quiet || ok === false) console.log(`  ${ok === null ? "⏭" : ok ? "✓" : "✗"} ${id}  ${check}${note ? " — " + note : ""}`);
    return ok;
  }
  get used() { return this.i; }
  table() {
    return ["| id | check | how to verify | result | note |", "|----|-------|---------------|--------|------|",
      ...this.rows.map((r) => `| ${r.id} | ${r.check.replace(/\|/g, "\\|")} | ${r.how.replace(/\|/g, "\\|")} | ${r.result} | ${r.note.replace(/\|/g, "\\|")} |`)].join("\n");
  }
}

// P104451-P104500 are this terminal's UNUSED round-1 ids; P148001-P148450 its pre-allocated
// round-2 block. 50 + 450 = 500, and nothing is claimed from the registry for either.
export const ID_BLOCK = [
  ...Array.from({ length: 50 }, (_, i) => `P${104451 + i}`),
  ...Array.from({ length: 450 }, (_, i) => `P${148001 + i}`),
];
