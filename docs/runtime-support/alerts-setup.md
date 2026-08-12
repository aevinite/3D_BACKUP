# Phone alerts + uptime — 15-minute setup (owner)

*(Do this once. Until you do, the app runs fine — it just won't ping your phone.)*

When something breaks during service, the app can buzz your phone within a minute so you
often know before the restaurant calls. It sends to **two** places (so one being down never
silences the other): **ntfy** (instant push) and a **Telegram** message. Plus a free outside
watchdog (**UptimeRobot**) that tells you if the whole app goes down.

You'll paste a few values into two places: the app's secret settings file (`.env.local`, on your
computer) and the Vercel dashboard (so it works on the live site too). None of these are shown to
customers; they're keys only your app uses.

---

## 1) ntfy — instant push (2 min, free, no account)

1. Install the **ntfy** app (App Store / Play Store).
2. Make up a LONG random topic name — treat it like a password, e.g.
   `french-house-alerts-7hK92xQ`. Anyone who knows it can read your alerts, so keep it secret.
3. In the ntfy app: **Subscribe to topic** → type that exact name.
4. Add this line to `.env.local`:
   ```
   NTFY_TOPIC=french-house-alerts-7hK92xQ
   ```

## 2) Telegram — a message from your own bot (5 min, free)

1. In Telegram, message **@BotFather** → send `/newbot` → follow prompts. It gives you a
   **bot token** (looks like `123456:AA...`). Copy it.
2. Open a chat with your new bot and send it any message (say "hi") — this lets it message you back.
3. Get your **chat id**: open this URL in a browser (paste your token in):
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` — find `"chat":{"id":123456789…}`.
4. Add these two lines to `.env.local`:
   ```
   TELEGRAM_BOT_TOKEN=123456:AA...
   TELEGRAM_CHAT_ID=123456789
   ```

## 3) Put the same values in Vercel (so the LIVE site alerts too)

The `.env.local` file only works on your computer. For the deployed app:
1. Go to the Vercel project **3-d-backup** → **Settings → Environment Variables**.
2. Add the same names/values: `NTFY_TOPIC`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
3. Redeploy (or just push any change) so they take effect.

## 4) UptimeRobot — "is the whole app up?" (5 min, free)

The alerts above need the app to be alive to send them. This outside watchdog catches the case
where the app itself is down.
1. Sign up free at uptimerobot.com.
2. **Add New Monitor** → type **HTTP(s)** → URL: `https://<your-live-domain>/api/health` →
   check interval **5 minutes** → add your email/phone for its alerts.
3. That page answers "ok" when the app + database are healthy, and fails when they're not — so
   UptimeRobot notices an outage within ~5 minutes.

## 5) A SECOND monitor — "which part is broken?" (2 min, free)

The one above only ever asks *"can the app reach the database?"*. That is the right question to ask
every five minutes, but it means two real problems go unnoticed:

- **file storage** fails while the database is fine → restaurant logos and photo attachments stop
  loading, and monitor 4 still cheerfully says "ok". (Ordering, billing and the kitchen are
  unaffected — they never touch storage.)
- **the live-updates settings go missing from the deployment** → every panel silently stops
  refreshing on its own. Nobody is told; a manager eventually says "the kitchen screen is stuck".

So add a second monitor pointing at the deeper check:

1. **Add New Monitor** → **HTTP(s)** → URL: `https://<your-live-domain>/api/health/deep`
2. check interval **60 minutes** — deliberately slower than the first one, because this check does
   real work and the cheap 5-minute probe already covers "is it alive at all?"
3. It answers "ok" only when **all three** parts are healthy, and fails otherwise.

When it fails, open the URL in a browser: it names the broken part in a plain sentence, e.g.
*"File storage isn't answering — logos and photo attachments won't load. Ordering and billing are
unaffected."* That tells you whether to stop what you're doing or deal with it in the morning.

---

## What you'll receive

- A short message like **"⚠️ tablet screen error: Cannot read …"** or
  **"⚠️ tablet/route_error: …"** — restaurant + a short label only, never customer data or money.
- Repeats of the **same** error are grouped: one ping per 15 minutes, not fifty.
- In the admin panel, the **bell** also shows "App errors (24h)" and the **Activity log →
  Errors** filter shows every one in red, with the button-taps that led up to it.

When you get one: open **Admin → Repair kit** to calm it (turn the feature off, re-fire the
order, unstick the table), then tell Claude — or tap **Send to Claude** on the error row and the
overnight robot fixes the real cause.
