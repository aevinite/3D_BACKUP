// Round 3 — every EXPORT of the 14 money files, enumerated from the files themselves (so a new export
// is covered the day it is written): does it have a job (a caller in the app, or in its own file), and
// is it exercised by this harness? An export nobody calls is a second way of doing something that
// nothing uses — the owner's rule is that the new way REPLACES the old one (CLAUDE.md, 2026-08-29).
// One row per file, so a new export never renumbers anything.
import { suite } from "./lib.mjs";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { root } from "./hooks.mjs";
const t = suite("scripts/t30-harness (every export)", 167381, 120);
const src = (p) => readFileSync(join(root, p), "utf8");
const FILES = ["lib/tax.ts", "lib/taxFiling.ts", "lib/paySplit.ts", "lib/payments.ts", "lib/discountCap.ts", "lib/clash.ts", "lib/clashCompare.ts", "lib/idempotency.ts", "lib/idempotencyRule.ts", "lib/dbRefusal.ts", "lib/readGuard.ts", "lib/money.ts", "lib/money.mjs", "lib/orderAllergies.ts"];
const walk = (d, out = []) => { for (const e of readdirSync(join(root, d))) { const p = join(d, e); if (e === "node_modules" || e.startsWith(".")) continue; if (statSync(join(root, p)).isDirectory()) walk(p, out); else if (/\.(ts|tsx|js|mjs)$/.test(e) && !/\.d\.ts$/.test(e)) out.push(p); } return out; };
const APP = ["app", "components", "lib", "public/panels", "hooks"].flatMap((d) => { try { return walk(d); } catch { return []; } });
const APPTEXT = new Map(APP.map((f) => [f, src(f)]));
const HARNESS = readdirSync(join(root, "scripts/t30-harness")).filter((f) => /^u-.*\.mjs$/.test(f) && f !== "u-exports.mjs").map((f) => src(`scripts/t30-harness/${f}`)).join("\n");
const exportsOf = (f) => [...src(f).matchAll(/^export (?:async )?(?:function|const|class) ([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
let total = 0;
for (const f of FILES) {
  const names = exportsOf(f); total += names.length;
  const own = src(f).replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
  const jobless = names.filter((n) => {
    const re = new RegExp(`\\b${n}\\b`);
    const outside = [...APPTEXT].some(([p, s]) => p !== f && re.test(s.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "")));
    const inside = (own.match(new RegExp(`\\b${n}\\b`, "g")) || []).length > 1;   // more than its own definition
    return !outside && !inside;
  });
  t(`${f}: every one of its ${names.length} exports has a job — a caller in the app, or a use inside the file itself`, names.length > 0 && !jobless.length, jobless.length ? `no caller anywhere: ${jobless.join(", ")}` : names.join(" "));
  const untested = names.filter((n) => !new RegExp(`\\b${n}\\b`).test(HARNESS));
  t(`${f}: every one of its ${names.length} exports is exercised by a check in this harness`, !untested.length, untested.length ? `never named by a check: ${untested.join(", ")}` : "");
}
t(`the enumeration found ${total} exports across the 14 files — it is reading the files, not an empty list`, total >= 60, String(total));
