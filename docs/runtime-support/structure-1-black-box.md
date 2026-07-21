# Structure 1 — "Black Box" (the aeroplane recorder)

**One line:** the app writes a diary of everything important, you read it in a
new Admin → Everything Log tab, entries auto-delete after 7 days (changeable).
Built 100% inside what we already have (Vercel + Supabase). Cost: ₹0.

## The story of how it works (like you're 10)

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

## What exactly gets recorded (and what deliberately does NOT)

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

## The pieces we'd build (all inside the current app)

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

## How a live restaurant problem gets fixed with this

1. Restaurant calls / sends screenshot → you tell me the restaurant + time.
2. I read the Everything Log for that window → identify the cause.
3. **Temporary fix in minutes:** flip the feature's kill switch off in admin
   (we already have `settings.features`), or use maintenance mode, or a data
   correction. Restaurant keeps serving.
4. **Permanent fix:** I fix the code, we ship via PR, flip the switch back on.

## Honest limits of Structure 1

- **Nobody rings your phone.** You find out when the restaurant tells you.
  The diary makes fixing fast, but discovery is still human. (Structure 2
  fixes exactly this, cheaply.)
- If Vercel or Supabase themselves are down, the diary can't be written — but
  then the whole app is down anyway and their own status pages tell us.

## Cost

- Platforms: none new. Vercel + Supabase as today.
- Money: ₹0.
- Database load: small if we batch taps and index properly; the 7-day
  auto-delete keeps the table from growing forever.
