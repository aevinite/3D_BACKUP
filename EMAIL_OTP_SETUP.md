# Email Code (OTP) — Setup Guide (free)

How to turn the one-time code from a test stub into a real **6-digit code emailed to
the guest** — at **zero cost**.

---

## 1. What this is

When sessions are ON and **"Require a code"** is ON (switches in editor → **General**),
the first time a guest orders they enter their **email** and a 6-digit code we email them.

- **Now (stub):** the code shows on screen (for testing).
- **After this:** the code is emailed to the guest. Still free.

> Reminder: this is an *extra* layer. The **location** check already stops people
> ordering from outside the café. If email turns out to be fussy, you can switch the
> code off in the editor and rely on location alone.

---

## 2. The free options (pick one)

Sending email needs a free "sender" account + a password/key. Two easy free choices:

| Option | Best if… | Free limit | Domain needed? |
|---|---|---|---|
| **A. Gmail App Password** | you already have a Gmail | ~500 emails/day | **No** |
| **B. Brevo** (brevo.com) | you want better delivery (less spam) | 300 emails/day | No (just verify your sender email) |

**My recommendation:** start with **A (Gmail)** — fastest, you probably already have one.
If too many codes land in guests' spam folders, switch to **B (Brevo)** for better delivery.
The app doesn't care which — both just give me an SMTP host/user/password.

---

## 3A. Option A — Gmail App Password (easiest)

1. Use a Gmail account for the café (ideally a dedicated one, e.g. `mylittlefrenchhouse@gmail.com`).
2. Turn on **2-Step Verification** on that Google account (Google Account → Security).
   (App Passwords only exist once 2-Step is on.)
3. Go to **Google Account → Security → App passwords**, create one named "Menu", and copy
   the **16-character password** it shows.
4. Put these in `.env.local` (section 4) and tell me.

---

## 3B. Option B — Brevo (better delivery, still free)

1. Sign up at **brevo.com** (free plan = 300 emails/day).
2. **Senders & Domains → Senders →** add and verify the email you'll send from (they email
   you a confirm link — no domain purchase needed).
3. **SMTP & API → SMTP →** copy your **SMTP login** and **SMTP key (master password)**.
4. Put these in `.env.local` (section 4) and tell me.

---

## 4. What to put in `.env.local` (and tell me "it's in")

⚠️ These are secrets — **don't paste them into chat or a screenshot.** Put them in your
private `.env.local` file (same place your Supabase keys live), then just say it's done.

**Gmail (Option A):**
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=yourcafe@gmail.com
SMTP_PASS=the16charAppPassword
OTP_FROM=Little French House <yourcafe@gmail.com>
```

**Brevo (Option B):**
```
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your-brevo-smtp-login
SMTP_PASS=your-brevo-smtp-key
OTP_FROM=Little French House <the-verified-sender@youremail.com>
```

`.env.local` is git-ignored, so this never gets uploaded. When the site goes live on the
host, I'll show you where to paste the same values there.

---

## 5. What I'll do once it's in (no work for you)

- Add a small **server-side** "send code" function (a Next.js API route) so the email
  password stays on the server, never in the guest's browser.
- Switch the code step from **"phone"** to **"email"**, and from "show on screen" to
  "email it."
- Keep the "type the code to confirm" step.
- Lock it down so the code can only be gotten by receiving the email (not by poking the API).
- Test it by emailing a code to your own address before we rely on it.

---

## 6. Honest notes

- **Spam folder:** transactional emails sometimes land in spam, especially from a plain
  Gmail. Tell guests "check your spam if you don't see it." Brevo (Option B) reduces this.
- **Speed:** email codes can take a few seconds to a minute. Usually fine, occasionally slow.
- **Limits:** ~500/day (Gmail) or 300/day (Brevo) — plenty for a café; we can raise it later.
- **It stays optional:** you can switch the code off anytime in the editor and use location only.

---

## 7. TL;DR

1. Make/choose a café **Gmail**, turn on 2-Step, create an **App Password**.
2. Put the 5 `SMTP_*` lines in **`.env.local`** (section 4) and tell me.
3. I wire it up and we email you a test code. $0.
