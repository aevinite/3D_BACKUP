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
| Paper | appendix below | appendix below | appendix below |
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

The reference-reel screenshots that used to sit in `inspo/` (backend checklist, request path,
security list, scale-forever, production tools, big-company layers) were removed 2026-09-27 — the
design they inspired was built 2026-07-21. `git log --diff-filter=D -- docs/runtime-support/inspo` finds them.

---

## Appendix — the four option papers, folded in 2026-09-27

These were separate files (`structure-1-black-box.md`, `structure-2-watchtower.md`,
`structure-3-mission-control.md`, `repair-kit-and-auto-fix-agent.md`) written 2026-07-21 BEFORE the
build. Structures 1+2 and the Repair Kit were built; Structure 3 is deferred. They are kept here word
for word, so the "why" survives in one file. (The Repair Kit paper's "nothing built yet" line is
from before the build — it IS built: `app/aevinite/repair/`, `scripts/nightly-repair.sh`.)

---

<!-- was structure-1-black-box.md -->
### Structure 1 — "Black Box" (the aeroplane recorder)

**One line:** the app writes a diary of everything important, you read it in a
new Admin → Everything Log tab, entries auto-delete after 7 days (changeable).
Built 100% inside what we already have (Vercel + Supabase). Cost: ₹0.

#### The story of how it works (like you're 10)

An aeroplane has a black box. It doesn't stop crashes — but after ANY problem,
investigators open it and know exactly what happened, second by second, without
asking the pilot to remember. We give the app a black box.

From then on, when a restaurant says "the bill button didn't work at 8:42", you
don't interrogate them. You open Admin → Everything Log, filter to that
restaurant + that time, and see:

```
8:42:10  tablet  Raju    tapped "Generate Bill" table 12
8:42:11  api     —       ERROR: bill failed — session already settled
8:42:15  tablet  Raju    tapped "Generate Bill" table 12 (again)
8:42:16  api     —       ERROR: same
```

Now I (Claude) instantly know: it's the double-settle case, not the printer,
not the internet. Ten minutes to a real fix instead of an hour of guessing.

#### What exactly gets recorded (and what deliberately does NOT)

**Recorded — every one of these is one diary line:**
1. **Every WRITE action** — anything that changes data: order placed, bill made,
   dish edited, discount given, setting flipped, staff login. (Much of this
   already exists as `staff_actions` — we widen it, we don't start from zero.)
2. **Every ERROR** — a screen crashes, an API says no, a save fails, the
   printer call fails. The line stores the error text + which screen + which
   button, automatically. **This is the most valuable line type for fixing.**
3. **Manual database edits** — if you (or I) change a row directly in Supabase,
   a database trigger writes a diary line too ("row X in table Y changed from
   A to B, by service key"). So even hand-edits leave footprints.
4. **Button taps that matter** — taps on action buttons, recorded in cheap
   BATCHES: the tablet collects taps for ~30 seconds, then sends one bundle.
   One database write per bundle, not per tap.

**Deliberately NOT recorded:** every scroll, every harmless tap on a dish photo,
guest browsing. Recording those would multiply our database writing 100× for
almost zero detective value — this is exactly the "cost-aware by default" rule.

#### The pieces we'd build (all inside the current app)

1. **One new table** `event_log` in Supabase: time, restaurant, panel, who,
   action, details, level (info / warning / ERROR). Indexed by
   (restaurant_id, created_at) so reading it is cheap.
2. **A tiny "log()" helper** in each panel + in the API files. One line of code
   at each important spot. Errors get caught by ONE global net per panel (so we
   don't have to remember to log each error by hand).
3. **A database trigger** on important tables that records direct edits.
4. **Admin → Everything Log tab**: filter by restaurant / panel / person / level
   / time, big red rows for errors, search box. Scoped queries with limits —
   never "load the whole diary".
5. **Auto-cleaner**: a scheduled database job (pg_cron, already available in
   Supabase) deletes lines older than 7 days. The number 7 lives in settings so
   admin can change it (errors could keep 30 days, taps 7).

#### How a live restaurant problem gets fixed with this

1. Restaurant calls / sends screenshot → you tell me the restaurant + time.
2. I read the Everything Log for that window → identify the cause.
3. **Temporary fix in minutes:** flip the feature's kill switch off in admin
   (we already have `settings.features`), or use maintenance mode, or a data
   correction. Restaurant keeps serving.
4. **Permanent fix:** I fix the code, we ship via PR, flip the switch back on.

#### Honest limits of Structure 1

- **Nobody rings your phone.** You find out when the restaurant tells you.
  The diary makes fixing fast, but discovery is still human. (Structure 2
  fixes exactly this, cheaply.)
- If Vercel or Supabase themselves are down, the diary can't be written — but
  then the whole app is down anyway and their own status pages tell us.

#### Cost

- Platforms: none new. Vercel + Supabase as today.
- Money: ₹0.
- Database load: small if we batch taps and index properly; the 7-day
  auto-delete keeps the table from growing forever.

---

<!-- was structure-2-watchtower.md -->
### Structure 2 — "Watchtower" (Black Box + robots that watch it)

**One line:** everything from Structure 1, PLUS free robots that read the diary
non-stop and ping YOUR PHONE the moment an error appears — so you often know
about a problem before the restaurant does. Cost: still ₹0.

#### The story of how it works (like you're 10)

Structure 1 gave the aeroplane a black box. Structure 2 adds a watchtower guard
who reads the black box live and blows a whistle the second something looks
wrong. You're eating dinner; your phone buzzes: *"French House · 3 errors on
the bill button in 2 minutes."* You message the restaurant FIRST: "I saw it,
turning that feature off, use manual bills for 10 minutes." That flip — from
them discovering it to YOU announcing it — is the difference between a company
that looks broken and one that looks professional.

#### The three watchers (all free)

1. **Error watcher → phone push.** When the app writes an ERROR line into the
   Everything Log, it also sends a push notification to your phone.
   - How: a free push service — **ntfy.sh** (dead simple: sending a
     notification is literally one small internet request; you install the ntfy
     app and subscribe to your private channel) or a **Telegram bot** (free
     forever, you get messages in Telegram).
   - Smart, not spammy: it groups repeats — "same error ×12 in 5 min" is ONE
     ping, not twelve. Warnings don't ping at all; only errors do. Quiet hours
     possible.

2. **Heartbeat watcher ("is the app even up?").** A free outside service —
   **UptimeRobot** (free plan: checks every 5 minutes) — visits a tiny
   `/api/health` page of our app. If the app stops answering (Vercel down,
   deploy broken), UptimeRobot emails/pings you. This catches the disasters the
   app can't report about itself (because it's the one that died).

3. **(Optional) Crash-detail tracker.** A free-tier error tracker (e.g. Sentry
   free plan, 5k errors/month) auto-captures crashes with the exact line of
   code. Honest note: it's a third-party seeing error data, one more account to
   manage, and we removed a Sentry integration once before by choice — the
   Everything Log + push already covers 90% of it. I'd SKIP this one until the
   log proves insufficient. Listed only so you know it exists.

#### What gets built on top of Structure 1

- One small "notify" helper in the API: when a log line has level=ERROR →
  also send the push. (A few lines of code; ntfy/Telegram need no library.)
- A grouping rule so bursts become one message.
- `/api/health` route (tiny: answers "ok" + can check it can reach the
  database) + an UptimeRobot free account pointed at it.
- Admin toggle for which restaurants/levels ping you.

#### How a live problem gets fixed with this

Same as Structure 1, except step 1 changes from "restaurant calls you" to
"your phone pings within ~1 minute". Then: read log → kill switch → I fix
permanently → switch back on.

#### Honest limits

- Your phone is the whole alert chain. If you're asleep, nobody else is on
  call. (Big companies rotate humans; you have one human + me. Acceptable at
  this stage — Indian restaurant hours also mostly match your waking hours.)
- Push services are third parties: ntfy/Telegram see the alert TEXT. So alerts
  say "bill error at French House", never customer data or keys.
- UptimeRobot free = a check every 5 minutes, so a total outage can take up to
  5 minutes to be noticed. Fine for us.

#### Cost

- ntfy.sh / Telegram bot: ₹0.
- UptimeRobot free plan: ₹0 (50 monitors, 5-min interval).
- Sentry free tier (optional, recommend skip): ₹0.
- Extra database/Vercel load: basically none (alerts piggyback on log writes).

---

<!-- was structure-3-mission-control.md -->
### Structure 3 — "Mission Control" (a separate little server of our own)

**One line:** everything from Structures 1+2, but the watching/alerting brain
moves OUT of the app into a small always-on server we run ourselves — the first
real piece of your future full SaaS stack (API server, Redis, load balancer).
Cost: ₹0–₹450/month. **Recommended LATER, not now.**

#### The story of how it works (like you're 10)

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

#### Where it would run (hosting for beginners)

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

#### Why I say NOT NOW (honest reasoning)

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

#### What would trigger building it (write this down)

- 10–20+ live restaurants, OR
- log writing starts to strain Supabase quotas (batching needed), OR
- you start the real SaaS API-server build — then this is designed IN from day
  one, not bolted on.

#### Cost

- Hosting: ₹0 (with sleep-risk) to ~₹450–600/month for always-on.
- Build effort: the largest of the three by far.
- Ongoing: it's a pet — needs feeding (updates, restarts, monitoring).

---

<!-- was repair-kit-and-auto-fix-agent.md -->
### Repair Kit + Auto-Fix Agent (owner's addition, 2026-07-20)

*(Doc only — nothing built yet. Extends the Black Box / Watchtower plan.)*

The owner's live "temporary fix" is NOT code — it's data surgery from the admin
panel: permanently delete a broken bill/KOT, re-create the same order fresh,
change a time/date, unstick a table. Then Claude fixes the root cause
permanently. Two pieces make that real:

---

#### Part A — The Repair Kit (buttons in admin, zero coding needed)

A "Fix It" section in the admin panel, per restaurant. Each tool is one button
with a confirm step:

1. **Delete a bill / KOT permanently** (with a required one-line reason).
2. **Re-fire an order** — clones a broken order into a fresh one and sends it
   to the kitchen again (same dishes, new KOT number).
3. **Unstick a table** — force-closes a session that's wedged (e.g. the
   head-left-pending case) so the table is usable again.
4. **Edit time/date** on an order or bill (for when a re-made order must carry
   the original dinner time so reports stay right).
5. **Kill switches** — already exist (`settings.features`); linked from here.
6. **Maintenance mode** — already exists; linked from here.

**Guardrails (non-negotiable, protects the owner from himself at 8pm):**
- Every Repair Kit action writes a loud line into the Everything Log
  ("ADMIN REPAIR: deleted bill #142, reason: stuck at print"). That line is
  what tells Claude later exactly what surgery was done — and what the
  permanent fix must handle.
- Deletes are **soft** with an undo window (the 30-min bill-undo pattern
  already in the app) wherever possible; "permanent" happens after the window.
- Admin-only, confirm dialog, and the reason field is mandatory. Trade-off:
  one extra tap when you're stressed — worth it, because these buttons can
  genuinely wreck a night's numbers if fat-fingered.

#### Part B — The agent workflow (how Claude gets the permanent fix, 3 levels)

**Level 1 — "Send to Claude" button (build first).**
Next to every red error row in the Everything Log: one button that bundles the
error + the last ~20 log lines around it + device/panel info into a report file
(a row in a `fix_requests` table, or a GitHub issue). You tap it, done. Next
Claude session starts by reading open reports — no describing, no screenshots
needed (screenshots still welcome). This is the cheapest piece and removes the
whole "you explaining the bug" step.

**Level 2 — Scheduled repair agent (semi-automatic, recommended).**
Same pattern as the existing 4am nightly audit: a scheduled Claude Code run
(local LaunchAgent or a cloud routine) that, every night:
1. reads new fix-requests + error log lines,
2. reproduces the problem,
3. writes the fix on a branch in an isolated worktree,
4. verifies it, opens a PR, and leaves a plain-language note for the owner.
The overnight-autonomous-loop pattern already proved this works in this repo.
The owner wakes up to "3 errors from last night are fixed, PRs ready" —
merge is one click (or auto-merge once verified, same as the overnight loop).

**Level 3 — Instant auto-fix (agent ships code the moment an error appears).**
DELIBERATELY NOT RECOMMENDED. Code written and shipped in panic-minutes with
nobody glancing at it can turn one broken button into a broken panel during
service. The honest division of labour: the **Repair Kit handles the next 10
minutes** (owner), the **night agent handles the permanent fix by morning**
(Claude). Revisit only if a real gap shows up after months of Level 2.

#### Build order (when owner says go)

1. Everything Log (Structure 1) — the foundation everything above reads/writes.
2. Repair Kit tools (each one small; re-fire order + unstick table first, they
   cover the most common live incidents).
3. Phone alerts (Structure 2).
4. "Send to Claude" button (Level 1).
5. Nightly repair agent (Level 2) — extend the existing 4am audit machinery.

Cost: all of it ₹0 (inside Vercel+Supabase + existing local scheduling; the
nightly agent uses Claude usage the same way the current audits do).
