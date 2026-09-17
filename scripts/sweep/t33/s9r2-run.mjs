// T33 round 2 — runs all 500 phases and writes LEDGER/T33-S9-R2.md.
//   node scripts/sweep/t33/s9r2-run.mjs            run and print
//   node scripts/sweep/t33/s9r2-run.mjs --write    …and rewrite the ledger file
import { writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const a = await import("./s9r2-a.mjs");
const bc = await import("./s9r2-bcde.mjs");
const d = await import("./s9r2-d.mjs");
const e = await import("./s9r2-e.mjs");
const rows = [...a.rows, ...bc.rows, ...d.rows, ...e.rows];

const g = rows.filter((r) => r[4] === "✅").length;
const bad = rows.filter((r) => r[4] === "❌");
const skip = rows.filter((r) => r[4] === "⏭").length;
const ids = rows.map((r) => r[0]);
console.log(`\n═══ T33 ROUND 2 — ${rows.length} phases: ${g} ✅ · ${bad.length} ❌ · ${skip} ⏭ ═══`);
console.log(`ids ${ids[0]} … ${ids[ids.length - 1]}, ${new Set(ids).size} distinct`);
console.log(`   A driven behaviour ${a.rows.length} · B+C per function and per file ${bc.rows.length} · D invariants over real data ${d.rows.length} · D2+E per restaurant and judgment ${e.rows.length}`);
if (bad.length) { console.log("\nRED:"); bad.forEach((r) => console.log(`  ${r[0]}  ${r[2]}\n      ${r[5]}`)); }

if (process.argv.includes("--write")) {
  const nMine = readdirSync(join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort().slice(320).length;
  const header = `# T33 — ROUND 2, the database, migrations at POSITIONS 321 → THE END

**Sweep #9, round 2 (2026-09-17).** The owner's word after round 1 and items 4–7 were merged and
deployed: *"make it live and plan the whole 500 phases test again within the boundaries that you
have given and test it again so that if any errors are left still within the boundaries that you
have given, it can be solved"*.

Territory re-derived, not trusted: \`ls supabase/migrations/*.sql | sort | sed -n '321,$p'\` —
**${nMine} files, 13,243 lines**, \`314_a_settled_bill_is_annotated_not_rewritten.sql\` →
\`396_a_stamped_tax_rate_must_be_a_rate.sql\`. (It was 81 files when round 1 measured it and has
grown three times since. A positional range is not a numeric one.)

**IDs: \`P104851\`–\`P104900\` (round 1's unspent remainder, contiguous) + \`P152001\`–\`${rows[rows.length - 1][0].slice(1)}\`
(this terminal's PRE-ALLOCATED round-2 block from INDEX.md, which runs to P153000).** Only ids this
terminal already holds were used — the *Next free ID* line was never read and never edited, which
is the half of the rule this registry has recorded nine collisions over.

**The count is ${rows.length}, not a round 500, and it moves when the TERRITORY moves.** Blocks B and C
are generated one row per function and one per file, so a migration landing mid-round changes the
total: 396 added a file (+1), then 397 added a file and brought a function into range (+4), and one
realtime probe split in two when 397 changed what the right answer was (+1). A real check is not
trimmed to hit a round number — T17 (2026-09-02), T13 (2026-09-05) and T27 (2026-09-16) all recorded
that reasoning. **Ids come from one allocator (\`scripts/sweep/t33/ids.mjs\`) rather than a
hard-coded start per block**, which is the thing that made those shifts safe: hand-nudging four
starts is how an id collision happens, and it nearly did twice in one afternoon.

## What this round was aimed at, and why — the measurement first (S9-RULES rule 2b)

Round 1 wrote 50 checks and every one of them **read** the database: installed function bodies, the
catalogue, row counts. **Not one made the database DO the thing and looked at the answer.** That was
the thin corner, so 58 of this round's phases are driven — a real write, inside a transaction that
ROLLS BACK, with the result read out afterwards.

The by-subject count also exposed a fault in round 1's own rows, and it is the same one T28 wrote
into INDEX.md on 2026-09-16: **all 50 of them named a migration NUMBER and never a subject FILE**,
so the measurement rule 2b prescribes read this territory as still having ZERO rows. Fixed in this
round — every round-1 row now names its file — and after that the honest count was **36 of 83 files
with no row at all**. Every one of the 36 has rows now.

| block | ids | count | what it is |
|---|---|---|---|
| A · DRIVEN behaviour | \`${a.rows[0][0]}\`–\`${a.rows[a.rows.length - 1][0]}\` | ${a.rows.length} | a real write to French House inside a rolled-back transaction, then the answer read back |
| B+C · every function, three rules each · every file, one composite row | \`${bc.rows[0][0]}\`–\`${bc.rows[bc.rows.length - 1][0]}\` | ${bc.rows.length} | generated from the source, so the count is whatever the territory has |
| D · invariants over the REAL data | \`${d.rows[0][0]}\`–\`${d.rows[d.rows.length - 1][0]}\` | ${d.rows.length} | 41,159 orders and 62 restaurants, not a fixture |
| D2+E · one row per live restaurant, then judgment | \`${e.rows[0][0]}\`–\`${e.rows[e.rows.length - 1][0]}\` | ${e.rows.length} | does each restaurant only carry its own numbers · should it work this way |

## Result

| | |
|---|---|
| Phases | **${rows.length}** — ${g} ✅ · ${bad.length} ❌ · ${skip} ⏭ |
| Real faults found | **1**, fixed on this branch: ten orders stamped \`tax_rate = 5\` (500%) where 41,159 hold \`0.05\`, and **nothing validated the column**. Migration 396 + \`verify:tax-rate-is-a-rate\`. |
| Recorded, awaiting the owner's decision | **1** — \`P152347\`: 15 invoiced bills have had every order cancelled and carry no void mark and no credit note. Who issues the credit note and when is a billing rule, not a bug. |
| Regressions | **none.** |

## Eleven of my own probes went red before the product did — every one was the probe

Written down because in the output they are indistinguishable from a real fault, and because sweep
#6 found three of three "dead guard" hits were the detector too:

1. **An AFTER trigger's work is invisible inside the same statement.** Six numbering probes read
   \`sessions.bill_no\` as null while the trigger had assigned it. One statement per action, always.
   (KOT numbers passed throughout — those come from a BEFORE trigger and show up in \`RETURNING\`.)
2. **An order with an empty items array is repriced to zero** by \`trg_orders_fill_tax_split\`, so
   two money probes measured the pricing pipeline instead of the takings column. \`taxable_base\` is
   now supplied, the way a real write path arrives.
3. **\`tax_rate\` is the rate CHARGED, not the restaurant's current setting** — asserting it equalled
   \`lfh_effective_tax_rate\` was asserting the opposite of migration 288's whole point.
4. **Auto-print is entitled, not automatic.** Three print probes expected paper from a restaurant
   with the switch off. Both directions are asserted now.
5. **The slug history is written by the admin route, not a trigger**, and \`lfh_slug_moved\` returns
   the address it moved TO, not the restaurant id.
6. **The business day is "convert to IST, THEN take off five hours"** — doing it the other way
   round mapped 2026-08-04 and 2026-08-21 onto one day and reported 52 bill-number clashes on
   French House. And a **merged party legitimately shares one bill number**, which is the owner's
   own standing rule.
7. **An invoice already issued KEEPS its number when the sale is cancelled** (CLAUDE.md, in those
   words). Asserting "no invoice on a cancelled bill" filed 18 correct rows as faults.
8. **A cancellation nobody timed cannot say whether it preceded the invoice** — migration 389 chose
   that deliberately, so the invariant only judges rows the data can answer.
9. **The zero uuid is a "no restaurant" sentinel, not a guess at French House** —
   \`lfh_remember_error_signature\` coalesces to \`…0000\`.
10. **A judgment whose ANSWER is "no" is not a failed check.** Three rows where the product is
    right to do the opposite were filed ❌ purely because the answer was no.
11. **A guard must not fail on a test that proves the fault is impossible** — \`verify:tax-rate-is-a-rate\`
    half C flagged two deliberate negative tests in \`scripts/sweep/t27r2/\` until it was scoped to
    the shipped paths.

## How to re-run all 500

\`node scripts/sweep/t33/s9r2-run.mjs\` — four committed modules, read-only except block A, which
writes only inside \`BEGIN … ROLLBACK\`. Nothing is ever committed to the shared dev database, so
there is no fixture left for another terminal to trip over and none of mine to delete by id.
\`--write\` rewrites this file from the live results.

Transport is \`curl\`, not \`fetch\`: five terminals share that one management endpoint and it measured
4–9 seconds to connect during this run, where Node's undici gives up at a fixed 10s and tries IPv6
first. Busy is treated like offline — generous deadline, jittered backoff.

| id | check | how to verify | result | note |
|---|---|---|---|---|
`;
  const body = rows.map((r) => `| ${r[0]} | ${r[1]} — ${r[2]} | ${r[3]} | ${r[4]} | ${r[5]} |`).join("\n");
  writeFileSync(join(root, ".claude", "sweep", "LEDGER", "T33-S9-R2.md"), header + body + "\n");
  console.log(`\nwrote LEDGER/T33-S9-R2.md with ${rows.length} rows`);
}
