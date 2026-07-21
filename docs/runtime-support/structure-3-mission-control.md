# Structure 3 — "Mission Control" (a separate little server of our own)

**One line:** everything from Structures 1+2, but the watching/alerting brain
moves OUT of the app into a small always-on server we run ourselves — the first
real piece of your future full SaaS stack (API server, Redis, load balancer).
Cost: ₹0–₹450/month. **Recommended LATER, not now.**

## The story of how it works (like you're 10)

Structures 1 and 2 are like a school where the teachers also take attendance
and also watch the CCTV. Works fine while the school is small. Structure 3
hires a separate security office (its own building) that ONLY watches: every
classroom sends it a copy of events, it keeps the recordings, rings alarms,
and has a control desk with switches for the whole school.

Concretely, a small program of ours runs 24/7 on a rented computer. Every panel
and API sends its diary lines THERE instead of straight into Supabase. That
server:

1. **Collects & batches** all logs (cheaper for the database — it writes them
   to Supabase in big bundles, or even keeps them in its own storage).
2. **Watches patterns live**: "5 bill errors in 2 min at one restaurant" or
   "orders per minute suddenly dropped to zero at dinner time" (that second one
   catches problems where nothing ERRORS but something is silently wrong —
   the hardest kind).
3. **Pings your phone** (same ntfy/Telegram as Structure 2).
4. **Mission-control desk**: a page where you see all restaurants' health as
   green/yellow/red tiles and have remote switches — feature kill switches,
   maintenance mode, "reload all tablets at restaurant X", "clear cached menu".
   (Some of these exist in admin already; here they get one dashboard.)

## Where it would run (hosting for beginners)

Vercel can't do this job: Vercel functions wake up, answer ONE request, and go
back to sleep. A watcher must stay awake 24/7. So Structure 3 needs a second
kind of hosting — a rented always-on computer:

| Platform | Free? | Catch |
|---|---|---|
| **Railway** | ~$5/mo credit | easiest, credit can run out |
| **Render** | free tier | free version SLEEPS after 15 idle min — a sleeping watchman misses alarms; the awake version is ~$7/mo |
| **Fly.io** | small free allowance | slightly more technical |
| **Oracle Cloud free VM** | genuinely free forever | most setup work, you manage the machine yourself |

Realistic pick when the day comes: Railway or Fly, ~₹400–600/month.

## Why I say NOT NOW (honest reasoning)

1. **You'd build it twice.** Your planned SaaS stack (own API server + Redis +
   queues) IS a Mission Control building. Making a mini version now, then the
   real one later, means doing the wiring twice. When the real API server
   exists, the watcher becomes just one room inside it.
2. **New single point of failure.** Today: Vercel + Supabase, two very reliable
   companies. Add our own server and now OUR server can crash, needs updates,
   needs its own monitoring (who watches the watchman?).
3. **The cheap versions sleep.** A watchman that dozes off after 15 minutes is
   worse than the always-awake free robots of Structure 2 (UptimeRobot + push
   live on THEIR servers, always on, ₹0).
4. **Structures 1+2 already give ~90%**: full diary, phone alerts, kill
   switches, health tiles. The extra 10% here (pattern-watching, one-click
   remote actions, log batching) matters at 20+ restaurants, not at 2–3.

## What would trigger building it (write this down)

- 10–20+ live restaurants, OR
- log writing starts to strain Supabase quotas (batching needed), OR
- you start the real SaaS API-server build — then this is designed IN from day
  one, not bolted on.

## Cost

- Hosting: ₹0 (with sleep-risk) to ~₹450–600/month for always-on.
- Build effort: the largest of the three by far.
- Ongoing: it's a pet — needs feeding (updates, restarts, monitoring).
