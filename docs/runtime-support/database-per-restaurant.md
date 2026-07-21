# "One database per restaurant?" — the honest answer (2026-07-21)

Someone told you: *"later, when you have your own database, give every restaurant
its OWN database — so if one fails, the others keep running."* Here's what that
really means, what big companies actually do, and what we should do.

## The idea, like you're 10

Today all restaurants share **one big notebook** (our Supabase database). Every
page has the restaurant's name stamped on it (`restaurant_id`), and a guard (RLS
+ the API) makes sure French House can never read Pizza Palace's pages.

The suggestion is: give every restaurant **its own separate notebook**. Then if
one notebook catches fire, only that one restaurant is affected.

It sounds obviously better. It mostly isn't — at our size.

## The "if one fails, others keep running" promise — mostly a myth for us

Think about what ACTUALLY fails:

| What breaks | Does per-restaurant DB help? |
|---|---|
| A bug in our code (bad deploy) | ❌ No — all restaurants run the SAME app on Vercel. A broken bill button is broken for everyone either way. |
| Vercel is down | ❌ No — the app is the shared part, not the notebook. |
| Supabase region (Mumbai) has an outage | ❌ No — all the little databases would sit in the same building anyway. |
| One restaurant hammers the DB so hard others slow down ("noisy neighbour") | ✅ **Yes — this is the one real benefit.** |
| We corrupt one restaurant's data with a bad manual edit | ✅ Partly — blast radius is smaller. |

So the promise is really about ONE failure type (noisy neighbour), which we
haven't hit and won't at 2–20 restaurants with scoped, indexed, limited queries
(our egress rules exist exactly for this).

## What it would COST us today

- **Money:** Supabase free tier = 2 projects. Separate DB per restaurant means a
  paid project each (~$10/month × restaurants). 20 restaurants = $200/month on
  notebooks alone, before a single feature.
- **Migrations ×N:** we're at 160+ numbered migrations. Every schema change would
  have to run on EVERY restaurant's database, tracked separately, with some
  succeeding and some failing halfway. This is the single biggest pain in
  per-tenant setups.
- **The admin panel breaks conceptually:** "show me all restaurants' health/usage
  tiles" is one cheap query today. Across 20 databases it's 20 connections and
  hand-stitched results.
- **Backups, keys, connection pools, realtime channels — all ×N.**

## What big companies actually do (the part nobody puts in reels)

- **Almost everyone STARTS like us:** one database, tenant column, row-level
  guards. Shopify, Slack, Stripe all began there.
- **When they outgrow it, they don't go one-DB-per-customer** — they go to
  **"pods" / "cells"**: groups of, say, 100 customers per stack (Shopify calls
  them pods, Slack calls them shards). Cell 3 failing takes out cell 3's
  customers only. It's per-GROUP isolation, not per-customer.
- **True one-database-per-customer** exists mostly in enterprise B2B (banks,
  hospitals) where the customer PAYS for that isolation as a feature.

## The verdict + what we do about it

**Not now. Design for it, don't build it.** The good news: the ONE thing that
makes per-restaurant (or per-pod) databases possible later is something we
already enforce everywhere — **every table and every query is scoped by
`restaurant_id`**. Because of that, moving a restaurant (or a group) to its own
database later is "copy their rows + point their connection there", not a
rewrite.

Rules that keep the door open (all already our habits — now written down):

1. Every new table carries `restaurant_id` + RLS. No exceptions.
2. No feature ever JOINs across restaurants, except admin/platform pages —
   and those keep their cross-restaurant queries in clearly separate files.
3. Migrations stay numbered, idempotent, and small — so one day they can be
   replayed onto a fresh per-pod database.
4. Per-restaurant kill switches, maintenance mode, health tiles (all built) —
   these give us "one restaurant can be isolated" TODAY at the app level, which
   is 80% of the operational benefit for ₹0.

**When to revisit (write-down triggers):** the future SaaS stack exists (own API
server), AND either (a) one tenant's load measurably slows others, or (b) a big
client demands data isolation and pays for it. Then we do **pods** (e.g. 10–20
restaurants per database), not one-per-restaurant.
