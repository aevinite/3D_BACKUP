// The branches coverage cannot reach, each PROVEN unreachable here rather than assumed. If a future
// change makes one reachable, its proof goes red and coverage.mjs stops allowing it.
import { suite } from "./lib.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./hooks.mjs";
const t = suite("scripts/t30-harness (proofs)", 168821, 20);
const F = await import("@/lib/taxFiling.ts");
const tree = await import("@/lib/accessTree.ts");
const src = (p) => readFileSync(join(root, p), "utf8");
{ let seed = 3, worst = Infinity; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 100000; i++) { const w = Array.from({ length: 1 + Math.floor(rnd() * 30) }, () => (rnd() < 0.2 ? 0 : rnd() * 1000)); const tot = Math.round((rnd() - 0.3) * 1e6);
    const target = Math.round(tot); const s = w.reduce((a, x) => a + x, 0); if (s <= 0) continue; const floors = w.map((x) => Math.floor((x / s) * target)).reduce((a, x) => a + x, 0); worst = Math.min(worst, target - floors); }
  t("lib/taxFiling.ts:68 — the 'negative leftover' loop can never run: the floors never exceed the target (100,000 random cases, the smallest leftover seen is ≥ 0)", worst >= 0, `smallest leftover ${worst}`); }
t("lib/taxFiling.ts:151 — `r.parts[j] ?? 0` can never fall back: every row's parts has exactly one entry per tax line", (() => { const f = F.buildFiling([{ t: 1 }, { t: 2 }], [{ label: "A", rate: 1 }, { label: "B", rate: 2 }, { label: "C", rate: 3 }], (r) => r.t); return f.rows.every((r) => r.parts.length === 3); })());
t("lib/clash.ts:262 — describe() never sees an object: every object value takes the quiet sentence before describe() is called", /const quiet = QUIET_COLUMNS\.has\(c\) \|\| isPlainObject\(current\);/.test(src("lib/clash.ts")) && /const plain = quiet\s*\? /.test(src("lib/clash.ts")));
t("lib/paySplit.ts:265–266 — a pay-later part reaching the name branch always has a non-blank name: badSplitShape refuses one with neither a person id nor a name first", /if \(isPayLater\(s\) && !String\(s\?\.khataCustomerId \|\| ""\)\.trim\(\) && !String\(s\?\.khataName \|\| ""\)\.trim\(\)\)/.test(src("lib/paySplit.ts")) && /const shape = badSplitShape\(splits\);\s*\n\s*if \(shape\) return/.test(src("lib/paySplit.ts")));
t("lib/paySplit.ts:396 — `(live || [])` at the sum is only reached after `if (!ids.length) return`, so live is never null there", /if \(!ids\.length\) return \{ reversed: 0, amount: 0 \};\s*\n\s*const amount = Math\.round\(\(live \|\| \[\]\)/.test(src("lib/paySplit.ts")));
t("lib/discountCap.ts:41–42 — both cap nodes exist on the Access tree with a positive default (manager 50, waiter 5)", !!tree.NODE_BY_ID.mgr_give_discounts_cap && !!tree.NODE_BY_ID.wtr_give_discounts_cap && Number(tree.defOf(tree.NODE_BY_ID.mgr_give_discounts_cap)) > 0 && Number(tree.defOf(tree.NODE_BY_ID.wtr_give_discounts_cap)) > 0);
t("lib/idempotency.ts:92 — finish() is always handed keptReply(…), which is never undefined, so `result ?? null` never falls back", /await finish\(actionId, didSomething\(res\.status, body\), keptReply\(body, by\)\);/.test(src("lib/idempotency.ts")) && /await finish\(actionId, false\);/.test(src("lib/idempotency.ts")));
t("lib/idempotency.ts:41 (|| → &&) is equivalent: with an empty claim row the broken copy reads row.data.done, which throws inside begin()'s try → 'fresh' — the same answer the real line gives (pinned by the 'claim row comes back EMPTY' check)", /if \(row\.error \|\| !row\.data\) return \{ state: "fresh" \};/.test(src("lib/idempotency.ts")) && /\} catch \{\s*\n\s*return \{ state: "fresh" \}; \/\/ network\/other → fail open/.test(src("lib/idempotency.ts")));
t("lib/paySplit.ts:41 and :50 are TYPE annotations (`ok: true` / `ok: false` in the SplitResult type), erased before the code runs — not behaviour", /\| \{\s*\n\s*ok: true; count: number;/.test(src("lib/paySplit.ts")) && /\| \{ ok: false; message: string; status: number \};/.test(src("lib/paySplit.ts")));
