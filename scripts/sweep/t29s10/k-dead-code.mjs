// Section K (round 2) — DEAD CODE and leftovers, one row per route file. The owner, 2026-10-12: "there
// shouldn't be any error any dead code or any kind of thing … or any kind of unoptimized thing".
// Asked of every file in the FILED list; a retired route answers ⏭ so no id ever moves.
import { execFileSync } from "node:child_process";

export default function section(c) {
  let unused = null;   // the compiler's own list, computed once for the whole section
  const unusedFor = (rel) => {
    if (unused === null) {
      let out = "";
      try { out = execFileSync("npx", ["tsc", "--noEmit", "-p", ".", "--noUnusedLocals", "--noUnusedParameters"], { cwd: c.ROOT, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 }).toString(); }
      catch (e) { out = String(e.stdout || ""); }
      unused = out.split("\n").filter((l) => /error TS6133|error TS6192|error TS6196|error TS6198/.test(l));
    }
    return unused.filter((l) => l.startsWith(rel + "("));
  };
  const short = (rel) => rel.replace("app/api/admin/", "").replace("/route.ts", "");

  c.sec("K · dead code — the compiler finds no unused import, variable or parameter");
  for (const rel of c.FILED) c.phase(`${short(rel)} — no unused import, variable or parameter`,
    "tsc --noUnusedLocals --noUnusedParameters, filtered to this file",
    () => c.isGone(rel) ? c.GONE : (unusedFor(rel).length === 0 || unusedFor(rel).map((l) => l.replace(/^[^:]*: /, "")).slice(0, 3).join(" | ")));

  c.sec("K · dead code — a route file exports only its handlers and its route settings");
  for (const rel of c.FILED) c.phase(`${short(rel)} — exports nothing but GET/POST/PATCH/DELETE and route config`,
    "read every top-level export", () => {
      if (c.isGone(rel)) return c.GONE;
      const extra = (c.clean(rel).match(/^export [^\n]*/gm) || []).filter((l) => !/^export (async )?function (GET|POST|PATCH|PUT|DELETE)\b|^export const (GET|POST|PATCH|PUT|DELETE|dynamic|runtime|maxDuration|revalidate)\b/.test(l));
      return extra.length === 0 || extra.map((l) => l.slice(0, 60)).join(" | ");
    });

  c.sec("K · leftovers — no TODO / FIXME / HACK left in the code");
  for (const rel of c.FILED) c.phase(`${short(rel)} — no TODO, FIXME, HACK or XXX marker left behind`,
    "grep the raw file", () => c.isGone(rel) ? c.GONE : (!/\b(TODO|FIXME|HACK|XXX)\b/.test(c.raw(rel)) || (c.raw(rel).match(/[^\n]*\b(TODO|FIXME|HACK|XXX)\b[^\n]*/) || [""])[0].trim().slice(0, 90)));

  c.sec("K · leftovers — no debugging print; failures go to console.error with a label");
  for (const rel of c.FILED) c.phase(`${short(rel)} — no console.log / console.debug left in`,
    "grep the code (comments stripped)", () => c.isGone(rel) ? c.GONE : (!/console\.(log|debug|info)\(/.test(c.clean(rel)) || "a debugging print is still in"));

  c.sec("K · leftovers — no code left commented out");
  for (const rel of c.FILED) c.phase(`${short(rel)} — no line of CODE sitting commented out`,
    "look for comment lines that are statements (const … = await, return …;, sb.from(…))", () => {
      if (c.isGone(rel)) return c.GONE;
      const hits = c.raw(rel).split("\n").filter((l) => /^\s*\/\/\s*(const|let|await|return|if \(|sb\.|supabaseAdmin\.)[^\n]*[;{]\s*$/.test(l) && !/[A-Z][a-z]+ [a-z]+ [a-z]+/.test(l.replace(/`[^`]*`/g, "")));
      return hits.length === 0 || hits.slice(0, 2).map((l) => l.trim().slice(0, 80)).join(" | ");
    });
}
