# WhatsApp Code (OTP) — Setup Guide

Plain-English guide to turning the **one-time phone code** from a test stub into
real codes that arrive on the guest's WhatsApp.

---

## 1. What this is, in one line

When the dining-session system is ON and **"Require a phone code"** is ON (both are
switches in the editor → **General**), the first time a guest orders, the app asks for
their phone number and a 6-digit code.

- **Right now (stub):** the code is shown on the screen, so you can test the flow. This
  is fine for trying it out — **not** for real customers.
- **After this guide:** the code is sent to the guest's **WhatsApp** instead.

---

## 2. Read this first — three honest facts

Sending automated WhatsApp messages is **not** the same as texting from your phone.
Three things to know before you spend any time:

1. **It is not 100% free.** There's a tiny per-message cost (roughly ₹0.10–0.35, or a
   few US cents, per code). For a café that's pennies a day — but it isn't zero. (You'd
   mentioned it might be free; that's only partly true — there's a small free allowance,
   but codes are normally billed.)

2. **Use a SEPARATE number, not your personal WhatsApp.** A phone number connected to
   the WhatsApp *Business Platform* can **no longer be used in the normal WhatsApp app**
   on your phone. So please use a spare SIM / second number — not the WhatsApp you use
   with friends and family.

3. **A code message needs a pre-approved "template."** WhatsApp requires business
   messages that start a chat (like a code) to use an approved "authentication" template.
   Approval is usually fast (minutes to a day). One of the options below does this part
   for you.

---

## 3. You might not even need this

The phone code is **optional**. The location check (guest must physically be at the café)
already stops most abuse. If you'd rather skip the hassle and cost:

> In the editor → **General** → turn **"Require a phone code (OTP)"** OFF.

Then guests are gated by location only, and you can ignore the rest of this guide. You
can always turn it back on later. Totally your call.

---

## 4. Pick one provider

| Option | Best if… | Setup effort | Cost |
|---|---|---|---|
| **A. Twilio Verify** | you want it working with the least fuss | **Lowest** — Twilio handles the code + the template for you | Slightly higher per message; free trial credit to start |
| **B. Meta WhatsApp Cloud API** | you want the cheapest and don't mind more steps | Medium — you create the number + an OTP template yourself | Cheapest; small free monthly allowance |
| **C. An Indian "BSP" (Interakt / AiSensy / Gupshup)** | you want a simple dashboard + local support | Medium — they guide template approval | Monthly plan + per-message |

**My recommendation for you:** start with **A (Twilio Verify)** — it's the fastest to get
working and it skips the template-approval headache. If the per-message cost ever matters
at higher volume, we can switch to **B** later. The app doesn't care which one you pick.

---

## 5A. Option A — Twilio Verify (recommended, fastest)

1. Go to **twilio.com** and create a free account (you get trial credit).
2. In the Twilio Console, search for **"Verify"** and create a **Verify Service**
   (give it a name like "Little French House"). Enable the **WhatsApp** channel on it.
   (Twilio provides the approved WhatsApp code template — you don't make one.)
3. From the Console **Dashboard**, copy these three values:
   - **Account SID** (starts with `AC…`)
   - **Auth Token**
   - **Verify Service SID** (starts with `VA…`)
4. Hand them to me **safely** — see section 6.

That's it on your side. Twilio generates the code, sends it on WhatsApp, and checks it.

---

## 5B. Option B — Meta WhatsApp Cloud API (cheapest)

1. Create a **Meta Business** account, then a **Meta for Developers** app
   (developers.facebook.com → My Apps → Create App → "Business").
2. Add the **WhatsApp** product to the app. Add and verify your **dedicated** phone
   number (the spare one, not personal).
3. Create a message **template**: category **Authentication**, with a one-time-code body.
   Submit it for approval (usually quick).
4. Copy these values:
   - **Phone Number ID** (a long number, from the WhatsApp → API setup page)
   - a **permanent Access Token** (System User token — not the temporary 24-hour one)
   - the **Template name** you created (e.g. `lfh_otp`)
5. Hand them to me **safely** — see section 6.

---

## 6. How to give me the keys (safely)

⚠️ These values are **secrets** — like passwords. **Don't paste them into chat, a
screenshot, or anywhere public.** (We've had a key leak before — let's not repeat it.)

Instead, put them in your **`.env.local`** file — the same private file where your
Supabase keys already live — using exactly these names, then just tell me "they're in":

**If you chose Twilio (Option A):**
```
TWILIO_ACCOUNT_SID=AC....................
TWILIO_AUTH_TOKEN=........................
TWILIO_VERIFY_SERVICE_SID=VA.............
```

**If you chose Meta (Option B):**
```
WHATSAPP_PHONE_NUMBER_ID=...............
WHATSAPP_ACCESS_TOKEN=..................
WHATSAPP_TEMPLATE_NAME=lfh_otp
```

`.env.local` is git-ignored, so these never get uploaded anywhere. When the site goes
live on the host (Vercel), I'll show you where to paste the same values in its settings.

---

## 7. What I'll do once the keys are in (no work for you)

- Add a small **server-side** "send code" function (a Next.js API route) so the secret
  key lives on the server, **never** in the guest's browser or phone.
- Switch the app from "show the code on screen" → "send the code to WhatsApp."
- Keep the "type the code to confirm" step working.
- Test it end-to-end by sending a real code to your phone before we rely on it.

---

## 8. Quick cost reality check

- **Twilio:** about US $0.005–0.05 per WhatsApp message + a small Twilio fee; trial credit
  covers your testing.
- **Meta Cloud API:** a free monthly allowance, then roughly ₹0.11–0.35 per code in India.
- At, say, 50 codes a day, you're looking at small change per day either way.

---

## 9. TL;DR

1. Decide if you even want the code step (or just use location — section 3).
2. If yes: pick **Twilio Verify** (easy) or **Meta Cloud API** (cheap).
3. Use a **separate** phone number, not your personal WhatsApp.
4. Put the keys in **`.env.local`** (section 6) and tell me — I wire it up and we test.
