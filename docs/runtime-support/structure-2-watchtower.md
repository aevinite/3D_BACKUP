# Structure 2 — "Watchtower" (Black Box + robots that watch it)

**One line:** everything from Structure 1, PLUS free robots that read the diary
non-stop and ping YOUR PHONE the moment an error appears — so you often know
about a problem before the restaurant does. Cost: still ₹0.

## The story of how it works (like you're 10)

Structure 1 gave the aeroplane a black box. Structure 2 adds a watchtower guard
who reads the black box live and blows a whistle the second something looks
wrong. You're eating dinner; your phone buzzes: *"French House · 3 errors on
the bill button in 2 minutes."* You message the restaurant FIRST: "I saw it,
turning that feature off, use manual bills for 10 minutes." That flip — from
them discovering it to YOU announcing it — is the difference between a company
that looks broken and one that looks professional.

## The three watchers (all free)

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

## What gets built on top of Structure 1

- One small "notify" helper in the API: when a log line has level=ERROR →
  also send the push. (A few lines of code; ntfy/Telegram need no library.)
- A grouping rule so bursts become one message.
- `/api/health` route (tiny: answers "ok" + can check it can reach the
  database) + an UptimeRobot free account pointed at it.
- Admin toggle for which restaurants/levels ping you.

## How a live problem gets fixed with this

Same as Structure 1, except step 1 changes from "restaurant calls you" to
"your phone pings within ~1 minute". Then: read log → kill switch → I fix
permanently → switch back on.

## Honest limits

- Your phone is the whole alert chain. If you're asleep, nobody else is on
  call. (Big companies rotate humans; you have one human + me. Acceptable at
  this stage — Indian restaurant hours also mostly match your waking hours.)
- Push services are third parties: ntfy/Telegram see the alert TEXT. So alerts
  say "bill error at French House", never customer data or keys.
- UptimeRobot free = a check every 5 minutes, so a total outage can take up to
  5 minutes to be noticed. Fine for us.

## Cost

- ntfy.sh / Telegram bot: ₹0.
- UptimeRobot free plan: ₹0 (50 monitors, 5-min interval).
- Sentry free tier (optional, recommend skip): ₹0.
- Extra database/Vercel load: basically none (alerts piggyback on log writes).
