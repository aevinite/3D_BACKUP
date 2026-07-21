# Runtime Support Plan — "fix problems WHILE the restaurant is running"

*(Written 2026-07-20 as the idea. BUILT 2026-07-21 on branch
`feat/runtime-support-2026-07-21` — Structures 1+2 + the Repair Kit + the
Send-to-Claude flow + the nightly repair agent. See:*
- `alerts-setup.md` — turn on phone alerts (ntfy + Telegram) + UptimeRobot.
- `nightly-agent-setup.md` — turn on the overnight fixer (needs a 1-min macOS
  Full Disk Access grant — which also revives your existing audit jobs).
- `live-fix-popup.md` — "look at it NOW": a request typed in admin pops a
  working Claude terminal on the Mac (built 2026-07-21).
- `database-per-restaurant.md` — for the FUTURE own-server stack: how
  "separate database per restaurant" really works (pods/cells), the two pieces
  the future API server needs from day one (directory + migration runner),
  and the triggers for splitting (added 2026-07-21).

*Structure 3 (separate always-on server) is deliberately deferred to the future
SaaS stack.)*

## The problem we are solving (in your words)

The product is almost ready. Real restaurants will use it during real dinner rush.
Things WILL go wrong at 8pm on a Saturday — printer not printing, a KOT stuck, a
button doing nothing, a bill wrong. At that moment:

1. **You** need to calm the restaurant down with a quick temporary fix (turn a
   feature off, switch to manual, etc.).
2. **I (Claude)** need enough information to find the real cause FAST — without
   you having to describe everything from memory. You just say "table 12, bill
   button, 8:42pm" or send a screenshot, and the system already recorded what
   happened.
3. Then I fix it permanently and we ship.

That "already recorded what happened" part is the **Everything Log** you asked
for. The three structures below are three sizes of the same idea.

---

## First, plain-language dictionary (read once, everything else makes sense)

- **Frontend** = the screens people touch (waiter tablet, kitchen screen, guest
  menu). It lives in the customer's/staff's browser.
- **API** = the waiter between the screen and the database. When someone taps
  "SEND ORDER", the screen doesn't touch the database directly. It sends a small
  message ("please create this order") to our API. The API checks *who is
  asking* and *is this allowed*, does the work, and replies "done" or "no".
  **In our project the API already exists** — it's every file under `app/api/...`.
  Vercel runs those little programs for us every time a request comes in.
- **Database (Supabase)** = the notebook where everything is written down:
  dishes, orders, bills, settings. It lives in Mumbai now.
- **Hosting (Vercel)** = the company that keeps our app awake on the internet
  24/7 so we don't need our own computer running.
- **A "log"** = a diary the app writes about itself. "8:42:13pm — waiter Raju
  tapped SEND on table 12 — order created — took 0.4s." When something breaks,
  we read the diary instead of guessing.
- **Monitoring** = a robot that reads the diary non-stop and rings a bell
  (notification on your phone) when it sees the word "ERROR", so you know
  before the restaurant even calls you.
- **Kill switch / feature flag** = a light switch for each feature. Printer
  module misbehaving? Flip its switch OFF from the admin panel; restaurant keeps
  running without it; flip ON when fixed. (We ALREADY have this pattern —
  `settings.features` — we just extend it.)

## How a request flows in OUR app today (the picture from your reel, mapped to us)

```
Waiter taps "SEND ORDER" on the tablet
        │
        ▼
Vercel  (runs our API file: app/api/tablet/... )
        │   1. who is this? (login cookie)          ← Authentication
        │   2. is the data sane? (table exists?)    ← Validation
        │   3. do the work (create order, KOT no.)  ← Business logic
        ▼
Supabase in Mumbai  (writes the order row)
        │
        ▼
Realtime "breadcrumb" goes out → kitchen screen updates instantly
        │
        ▼
Reply goes back to the tablet: "order sent ✓"
```

Every arrow in the reels (Frontend → API → Auth → Validation → Logic → DB →
Response) — **we already have all of it.** What we're missing is the last two
boxes big companies have: **Logging + Monitoring**. That's what this plan adds.

## What big companies actually do (and who replaces whom for us)

| Big company has | What it does | Our version |
|---|---|---|
| Structured logs (Datadog, Grafana) | Diary of every action | The **Everything Log** (this plan) |
| Error tracker (Sentry) | Catches every crash with details | Structure 1 catches them ourselves / Structure 2 uses a free tracker |
| Alerting (PagerDuty) | Phones the on-call engineer at 3am | Free push notification to YOUR phone |
| On-call engineer | Human who fixes it live | **Me (Claude)** — you paste the log/screenshot, I diagnose |
| Feature flags (LaunchDarkly) | Kill switches per feature | Our `settings.features` — already built |
| Status page | "We know, we're on it" | Later, one simple page |
| Load balancer, Redis, many servers | Handle millions of users | **NOT needed yet** — that's the future SaaS stack; adding it now is cost with zero benefit at our size |

Big companies have more LAYERS because they have more USERS, not because the
idea is different. The idea is always: **record everything → get alerted →
switch the broken part off → fix → switch back on.**

## The three structures (each has its own file)

| | 1. Black Box | 2. Watchtower | 3. Mission Control |
|---|---|---|---|
| File | `structure-1-black-box.md` | `structure-2-watchtower.md` | `structure-3-mission-control.md` |
| One-liner | Everything Log inside what we already have | Black Box + robots that watch it and ping your phone | A separate small server that watches, alerts, and can remote-fix |
| New platforms | none | ntfy/Telegram (free), UptimeRobot (free) | + Railway/Render/Fly (~$0–5/mo) |
| Monthly cost | ₹0 | ₹0 | ₹0–₹450 |
| You find out a restaurant has a problem… | when they call you | your phone pings within a minute | your phone pings + you have remote switches ready |
| Effort to build | small | medium | big |
| Fits current Vercel+Supabase | 100% | 100% | new moving part |

## My recommendation (honest)

**Build Structure 1 now, add Structure 2's phone alerts right after (it's one
small step), and DON'T build Structure 3 until the real SaaS server exists.**

Why: Structure 3's separate server is exactly what your future "full SaaS stack"
(load balancer, Redis, API server) will contain — building a small throwaway
version now means building it twice. Structures 1+2 are 90% of the value
(full diary + instant phone alert + kill switches you already have) for ₹0 and
they live entirely inside Vercel+Supabase, so NOTHING gets thrown away later —
the log table and alerts move into the big stack unchanged.

Trade-off you should know: logging has a cost. Every log line is a database
write. That's why (see structure 1) we log every WRITE and every ERROR but we
do NOT log every harmless button tap individually — we batch those. Logging
literally everything raw would eat the Supabase quota the same way the egress
bug did in June.

## What's left (owner's 2 setup steps + a fire drill)

Everything above is built and merged. Before the first real restaurant night:

1. **Turn on phone alerts** (~15 min): follow `alerts-setup.md` — ntfy app +
   Telegram bot + the same keys in Vercel + UptimeRobot on `/api/health`.
2. **Grant Full Disk Access** (~1 min): follow `nightly-agent-setup.md` so the
   overnight fixer (and the older audit jobs) can run.
3. **Fire drill** (~20 min, strongly recommended): on a test restaurant, break
   something on purpose (flip a feature off, delete a bill via Repair Kit,
   throw an error). Watch the whole chain fire: phone pings → Logs shows red
   rows → Repair Kit calms it → Send to Claude files the report → night robot
   picks it up. Practising once in peace is what makes 8pm-on-Saturday calm.

## Inspiration screenshots

Your reference reels are saved in `inspo/` (backend checklist, request path,
security list, scale-forever, production tools, big-company layers).
