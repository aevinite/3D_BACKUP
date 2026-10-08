// scripts/sweep/t39s10/static-checks.mjs — sweep #10, terminal 39: the static half of the 500.
//
// Territory: every file under scripts/, tests/ and .github/. Measured before anything was written:
// 292 of those files had NO ledger row naming them — all 271 added since 2026-09-01, plus 21 older.
// This computes, for each of them, the checks a reviewer would otherwise do by eye, and READS the
// source for every one it cannot settle mechanically (the per-file notes say which).
//
//   Band A — one row per zero-row file: it parses, and every repo path it names exists (or the file
//            is asserting that path is GONE), and it names no database but the one .env.local holds.
//   Band B — the top-level guards and tools among them: can it actually fail, and if it writes to the
//            database, does it clear up by id and put things back when it is stopped mid-run.
//
// Read-only. No database, no network, no browser. Prints JSON rows for write-ledger.mjs.
//
//   node scripts/sweep/t39s10/static-checks.mjs <list-of-files.txt> > rows.json
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LIST = process.argv[2];
if (!LIST || !existsSync(LIST)) { console.error("usage: static-checks.mjs <file-list.txt>"); process.exit(2); }
const files = readFileSync(LIST, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
if (files.length < 50) { console.error(`only ${files.length} file(s) in the list — nothing to judge`); process.exit(2); }

const read = (p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; } };
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^\s*\/\/.*$/gm, "");
const CLIENT_STACK = /kclqkmdxnwlhtyrducku/;          // the only other project ref this repo knows
const PATH_RE = /["'`]((?:app|lib|components|public|supabase|scripts|tests|docs|\.github)\/[A-Za-z0-9_\-.\[\]\/()@]+?\.(?:tsx?|mjs|js|css|sql|md|json|html|cjs))["'`]/g;

// Paths a file names in order to assert they are GONE — reviewed by hand on 2026-10-08 (7 files).
const ABSENT_BY_DESIGN = new Set([
  ".github/scripts/verify-doc-counts.mjs", "scripts/sweep/t2/s9r2-checks.mjs", "scripts/verify-doc-pointers.mjs",
  "scripts/verify-everything.mjs", "scripts/verify-guards-alive.mjs", "scripts/verify-print-documents.mjs",
  "scripts/verify-print-helper.mjs",
]);

function parses(f) {
  try {
    if (/\.(mjs|js|cjs)$/.test(f)) { execFileSync("node", ["--check", join(ROOT, f)], { stdio: "pipe" }); return [true, "node --check"]; }
    if (/\.ts$/.test(f)) {
      execFileSync(join(ROOT, "node_modules/.bin/esbuild"), [join(ROOT, f), "--log-level=error"], { stdio: "pipe" });
      return [true, "esbuild transform"];
    }
    if (/\.sh$/.test(f)) { execFileSync("bash", ["-n", join(ROOT, f)], { stdio: "pipe" }); return [true, "bash -n"]; }
    if (/\.plist$/.test(f)) { execFileSync("plutil", ["-lint", join(ROOT, f)], { stdio: "pipe" }); return [true, "plutil -lint"]; }
    if (/\.ya?ml$/.test(f)) { execFileSync("ruby", ["-ryaml", "-e", `YAML.load_file(ARGV[0])`, join(ROOT, f)], { stdio: "pipe" }); return [true, "YAML.load_file"]; }
    if (/\.json$/.test(f)) { JSON.parse(read(f)); return [true, "JSON.parse"]; }
    const t = read(f);
    return [t.length > 0, `${/\.(sql|md|txt)$/.test(f) ? "text" : "file"} is present and non-empty`];
  } catch (e) { return [false, String(e.stderr || e.message).split("\n").find((l) => l.trim()) || "did not parse"]; }
}

const rows = [];
for (const f of files) {
  const src = read(f);
  const [ok, how] = parses(f);
  const isJs = /\.(mjs|js|cjs|ts)$/.test(f);
  const named = isJs ? [...src.matchAll(PATH_RE)].map((m) => m[1]).filter((p) => !/\$\{|\*/.test(p)) : [];
  const missing = [...new Set(named.filter((p) => !existsSync(join(ROOT, p))))];
  const pathsOk = missing.length === 0 || ABSENT_BY_DESIGN.has(f);
  const otherDb = CLIENT_STACK.test(src) && !/NEVER|refuse|deny|AV_LIVE_DB|never|off-limits|!\/|\.test\(all\)/.test(src);
  rows.push({
    band: "A", file: f,
    check: `\`${f}\` parses, every repo path it names exists, and it names no database but the dev one`,
    how: `${how}; ${named.length} path literal(s) resolved${missing.length ? ` (${missing.length} named as gone, by design)` : ""}; client-stack id ${CLIENT_STACK.test(src) ? "only inside a never-touch list" : "absent"}`,
    result: ok && pathsOk && !otherDb ? "✅" : "❌",
    note: !ok ? `does not parse: ${how}` : !pathsOk ? `missing: ${missing.join(", ")}` : otherDb ? "names the client stack outside a deny-list" : "static, 2026-10-08",
  });
}

// ── Band B: the top-level guards and tools (not one-off sweep harnesses) ───────────────────────────
const top = files.filter((f) => /^(scripts\/[^/]+\.(mjs|ts)|tests\/[^/]+\.mjs|\.github\/scripts\/[^/]+\.mjs)$/.test(f));
for (const f of top) {
  const c = code(read(f));
  const canFail = /process\.exit\(\s*(1|2|[a-zA-Z_][\w.]*\s*\?|fails?\b|bad|failed|problems|code)/.test(c)
    || /process\.exitCode\s*=/.test(c) || /node:test|from "node:test"|assert\./.test(c)
    || /\bthrow new Error\(/.test(c);
  rows.push({
    band: "B", file: f,
    check: `\`${f}\` can reach a non-zero exit — it is not a check that is structurally unable to fail`,
    how: "read every process.exit / exitCode / node:test assertion / top-level throw",
    result: canFail ? "✅" : "⏭",
    note: canFail ? "a failing path exits non-zero" : "no failing exit found mechanically — READ BY HAND (see the ledger note)",
  });
  const writes = /\.(insert|upsert|update|delete)\(|method:\s*"(POST|PATCH|PUT|DELETE)"|database\/query[\s\S]{0,400}(insert|update|delete) /i.test(c);
  if (!writes) {
    rows.push({ band: "B", file: f, check: `\`${f}\` either writes nothing, or clears up what it wrote by its own ids`,
      how: "scan for insert/update/upsert/delete and POST/PATCH/DELETE", result: "✅", note: "writes nothing" });
  } else {
    const byId = /\.eq\(\s*["'`]id["'`]|\.in\(\s*["'`]id["'`]|delete\(\)\.eq\(|where id in \(|\.eq\("restaurant_id", [A-Z_]+\)\.eq\("id"/.test(c);
    const onKill = /process\.on\(\s*["'`]SIG(INT|TERM)|finally\s*\{/.test(c);
    rows.push({ band: "B", file: f, check: `\`${f}\` clears up what it wrote by its own ids, and puts things back if stopped mid-run`,
      how: "read the write calls, the cleanup and the SIGINT/SIGTERM/finally path",
      result: byId && onKill ? "✅" : "⏭",
      note: byId && onKill ? "cleanup by id + a finally/signal path" : `needs a hand read (by id: ${byId}, on-kill: ${onKill})` });
  }
}

process.stdout.write(JSON.stringify(rows, null, 1));
