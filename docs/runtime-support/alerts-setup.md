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
