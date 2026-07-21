# Multiple databases per restaurant — for the FUTURE own-server stack (2026-07-21)

The suggestion you got: *"when you have your own server and own API (the full
SaaS stack — load balancer, many backend servers, Redis, database), give
restaurants separate databases, so if one fails the others keep running."*

This doc is about THAT day — after we leave Vercel+Supabase-only and run our
own API server. Not about today. (Today's job is only: keep every table and
query scoped by `restaurant_id` — which we already do — so all doors below
stay open.)

## Like you're 10: three ways to "give everyone their own notebook"

Right now: one big notebook, every page stamped with the restaurant's name.
On our own stack, "separate databases" can mean three very different things:

| | What it physically is | If something fails… | Cost |
|---|---|---|---|
| **A. Separate notebooks, same shelf** — one Postgres machine, one logical database per restaurant | same computer, many notebooks | the computer dies → **ALL restaurants still die together.** Only protects against pages getting mixed up | almost free |
| **B. Pods / cells** — one machine per GROUP (10–20 restaurants), app servers grouped the same way | a few computers, each serving its own group | pod 2's machine dies → **only pod 2's restaurants are down**, pods 1 and 3 keep serving ✅ | one server per pod (~$10–25/mo each) |
| **C. One machine per restaurant** | a computer each | truly independent ✅ | full server price × every restaurant 💸 |

**The key insight: "if one fails, others keep running" comes from separate
MACHINES, not separate notebooks.** Option A sounds like isolation but gives
almost none. Option C is what banks/hospitals buy (and pay enterprise money
for). Option B — pods — is what real companies at scale actually run: Shopify
calls them pods, Slack calls them shards. One pod having a bad night takes out
1/10th of customers, never all of them.

And one honest catch: the database is only half the story. If ALL pods still
share ONE API server, that API server dying kills everyone anyway. A real
"cell" = its own app servers + its own database. That's why this design only
makes sense on the own-server stack — it IS that stack, multiplied.

## The two pieces the future API server must have FROM DAY ONE

These are the design decisions to bake in when we build the own stack — cheap
to include at the start, painful to retrofit:

1. **The directory (router).** A tiny lookup the API does first on every
   request: *"French House? → lives in pod 2, address X."* Day one it returns
   the same address for everyone (because there's only one database). But
   because every request already asks the directory, splitting into pods later
   is: copy a restaurant's rows to the new pod + change one directory row.
   No code rewrite. This is the real meaning of "build once, scale forever."
2. **The migration runner.** We're at 160+ numbered migrations. With pods,
   every schema change must run on EVERY pod, and the runner must remember
   which pod has which version and retry the one that failed halfway.
   This is the biggest ongoing tax of multiple databases — accept it
   knowingly, and only when pods actually exist.

## When to actually split into pods (write-down triggers)

Start the own stack with **one database + the directory from day one**. Split
when any of these happens:

- one restaurant's load measurably slows the others (noisy neighbour), or
- restaurant count makes one database genuinely big (think 50+, not 5), or
- a paying client demands physical data isolation (then THEY fund option C
  for themselves — isolation as a paid feature, like enterprise SaaS does).

## What this means for the app we write TODAY

Nothing new — just keep the habits that keep the door open:

1. Every table carries `restaurant_id` + RLS. No exceptions.
2. No feature JOINs across restaurants except admin/platform pages, and those
   keep their cross-restaurant queries in clearly separate files (they'll need
   to fan out across pods one day).
3. Migrations stay numbered, small, idempotent — replayable onto a fresh pod.
4. Per-restaurant kill switches, maintenance mode, health tiles (all built)
   already give "isolate one restaurant" at the app level — 80% of the
   day-to-day benefit, ₹0, available right now.
