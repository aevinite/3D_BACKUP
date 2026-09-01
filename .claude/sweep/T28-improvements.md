# T28 — THE REPO'S OWN TESTS · improvement ideas

🟢 = built in this branch (see `T28-findings.md` items 14–17).
🟡 = NOT built. Either it needs a decision from him, or it lives in another terminal's files.

---

## 🟢 BUILT

1. **A stopped dev server says so** — one plain sentence + exit 2 across 17 guards, instead of a raw
   ECONNREFUSED stack that reads as "this guard is broken". `baseFrom()` reads all three base env
   names that were already in use. (item 14)
2. **`verify:guards-alive`** — the seven checks that stop a guard from quietly dying. (item 15)
3. **`verify:fixtures`** — no test may leave a table on a manager's floor. (item 16)
4. **A test write must name its restaurant** — added to `verify:test-safety`, which already runs as a
   hook on any `scripts/` or `tests/` edit. (item 17)
5. **The kitchen tickets our tests queue get dismissed** — one shared helper, always by order id,
   using lib/printQueue's own wording; plus a check for any queued ticket whose order is already
   cancelled or archived, whatever table it was on. (item 20)
6. **A guard that needs a party seats one** — `verify:sweep-extras` no longer depends on another
   guard's litter to have anything to click. (item 23)

---

## 🟡 NEEDS A DECISION FROM HIM (or lives in another terminal's territory)

### I8 · Should `verify:manager-live-rush` write to Aangan at all? — 🟡 · his call
**Where:** backend only, nothing on screen — but it places and cancels real orders on Aangan Garden.
**What it is:** the rush deliberately drives BOTH restaurants, because "does one restaurant's rush
bleed onto another" is half of what it proves. The standing rule says Aangan is the read-only control
at factory defaults. It touches no switches and now cleans up only its own tables, so I have left the
design alone — but the rule and the guard disagree on paper and only he can say which wins.
**If yes (scope it to French House):** the rule holds without an exception anyone has to remember.
**If no:** the guard keeps its second restaurant, and the rule needs a sentence saying it means
switches, not orders.
**Effort:** 20 minutes either way.
**Risk:** low, but it removes half of what the guard proves, so it is not mine to decide.

### I1 · Shared fixture setup + teardown for the guards that place real orders — 🟡
**Where:** backend only, nothing on screen (but a mistake here shows up as a phantom table on the
manager's Tables floor).
**What it is:** ten guards each hand-roll their own "open a table, put food on it, tidy up". They now
all follow the same rule, but they each write it out again, and four of them got it wrong in a
different way. One shared `scripts/sweep/fixture.mjs` — `withTable(name, async (t) => …)` that opens,
hands you the ids, and always retires them — would make the next one correct by construction.
**If yes:** the next guard cannot invent a fifth way to leave a live order behind.
**If no:** nothing breaks; `verify:fixtures` catches the leftovers after the fact instead of
preventing them.
**Effort:** 2–3 hours, plus re-running each of the ten guards.
**Risk:** medium — it edits ten working guards at once, which is exactly the change I would not make
at the end of a sweep.

### I2 · One throwaway table name per guard, registered in one place — 🟡
**Where:** backend only, nothing on screen.
**What it is:** tables 9, 11, 21, 22, 27, 28 are each used by two or three different guards, and they
are real tables on the plan. Two lanes running at once can genuinely collide on one. The off-plan
names (288, ALGTEST, 9931, 9932, E2E-TAX, OWNCHK) cannot collide with a real party and are already
listed in `verify:fixtures`. Moving every guard onto its own off-plan name would end the class.
**If yes:** two guards can never fight over a table, and a leftover can never look like a real party.
**If no:** occasional flakes when lanes overlap — I saw two on this run
(`verify:merged-floor` and `verify:write-paths` each failed once and passed on a re-run).
**Effort:** 1–2 hours.
**Risk:** medium. Some guards check on-plan behaviour deliberately (the floor's occupied count, the
seat number), so it is not a blanket rename — each one needs reading.

### I3 · `verify:db-parity` should compare COLUMNS, not only functions — 🟡
**Where:** backend only, nothing on screen. It would have caught today's "Saved ✓ over a 500".
**What it is:** the parity guard compares the migrations' FUNCTIONS against the database. It does not
compare columns. A route that writes a column the database has not got answers 500, and — separately
— the panel says "Saved ✓" anyway. That is exactly what a dish save does on this dev database right
now, because one lane's column-drop migration is applied and its panel change is not merged.
**If yes:** the next half-landed schema change is named before anyone meets it as a broken screen.
**If no:** it stays findable only by driving the real UI, which is how I found it.
**Effort:** 2 hours.
**Risk:** low-to-medium — it will be noisy while ten lanes are mid-flight, which is an argument for
building it after the sweep merges, not during.

### I4 · A "Saved ✓" must never appear over a 500 — 🟡 · another terminal's file
**Where:** owner console → Menu (and the manager panel's Edit menu) → add a dish → Save. He would see
a green "Saved ✓" and then no dish.
**What it is:** the editor panel reports success without reading the response status. Measured today
on `POST /api/editor/items`. The cause of the 500 is another lane's unmerged work (see H4/notes in
findings) — but the panel lying about it is its own fault and survives the cause being fixed.
**If yes:** a save that fails says so, which is the panel's own "a tap must never vanish in silence"
rule.
**If no:** any future write that a route refuses will be reported as saved.
**Effort:** 30 minutes.
**Risk:** low. **Not mine:** `public/panels/editor/app.js`.

### I5 · Retire `verify:heatmap-parity` or give it a way to stage its own baseline — 🟡
**Where:** backend only, nothing on screen.
**What it is:** it needs `lfh_owner_heatmap_old` to exist alongside the live function before it can
compare anything, and nothing creates that. So it exits 2 on every run, forever. It is honest about
it — but a check that can never run is a line in the suite nobody reads.
**If yes:** either it captures the old definition itself, or it goes and the suite is shorter and
truer.
**If no:** two permanent exit-2s in the list (this and `verify:summary-parity`, which is the same
shape but IS how migration 238 was proved, so that one has earned its place).
**Effort:** 45 minutes either way.
**Risk:** low, but it is a judgment call about whether the check has value — his to make.

### I6 · `npm run dev` should honour `PORT` — 🟡 · another terminal's file
**Where:** backend only, nothing on screen — but the consequence lands on HIS window.
**What it is:** `"dev": "next dev -p 4000"`. Every parallel terminal is told to use its own port, and
`PORT=4128 npm run dev` silently takes 4000. It happened on this run; I killed it within seconds.
**If yes:** a parallel lane cannot take the port he verifies on.
**If no:** it will happen again, and the next time it may not be noticed for an hour.
**Effort:** 2 minutes. **Risk:** none. **Not mine:** the non-`verify:*` half of `package.json`.

### I7 · A guard that fails should print the one command that re-runs just it — 🟡
**Where:** backend only, nothing on screen.
**What it is:** several guards end with a wall of failures and no reminder of how to re-run them
alone. `verify:everything` learned this lesson the hard way with `--only`. A one-line footer on
failure ("re-run: npm run verify:x -- --base …") is cheap.
**If yes:** less re-running of whole suites to re-check three checks.
**If no:** nothing breaks.
**Effort:** 1 hour across the ~20 guards that have real failure output.
**Risk:** low, but it touches twenty working files for a convenience — a taste call.
