// Outbound owner alerts — a phone ping when something breaks during service.
//
// Sends to BOTH channels the owner chose (ntfy + Telegram); each is independent so one being
// down never silences the other. Both are OPTIONAL: when their env vars are unset this module
// no-ops silently, so the app runs fine with no alerting configured (e.g. in dev).
//
// Setup for the owner lives in docs/runtime-support/alerts-setup.md. Env vars:
//   NTFY_TOPIC          — a long, secret, random topic string (subscribe to it in the ntfy app)
//   NTFY_SERVER         — optional, defaults to https://ntfy.sh
//   TELEGRAM_BOT_TOKEN  — from @BotFather
//   TELEGRAM_CHAT_ID    — the owner's chat id with the bot
//
// GROUPING: identical alerts (same `key`) are suppressed for 15 minutes, so a burst of the same
// error pings once, not fifty times. The suppression memory is the staff_actions log itself — we
// record an 'alert_sent' row on every send and check for a recent one before sending again. That
// means no new table, and it survives a serverless cold start (unlike an in-memory cache).
//
// NEVER put customer data, order contents, or money in an alert — restaurant name + a short
// error label only. (Third-party push services see this text.)
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

const ALERT_WINDOW_MS = 15 * 60 * 1000;

async function recentlyAlerted(key: string): Promise<boolean> {
  try {
    const sinceIso = new Date(Date.now() - ALERT_WINDOW_MS).toISOString();
    const { data } = await sb
      .from("staff_actions")
      .select("id")
      .eq("panel", "admin")
      .eq("action", "alert_sent")
      .eq("detail", key)
      .gte("created_at", sinceIso)
      .limit(1);
    return !!(data && data.length);
  } catch {
    return false; // fail-open: if the check fails, we'd rather send than swallow a real alert
  }
}

async function pushNtfy(text: string): Promise<void> {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  const server = process.env.NTFY_SERVER || "https://ntfy.sh";
  await fetch(`${server}/${topic}`, {
    method: "POST",
    headers: { Title: "Restaurant alert", Priority: "high", Tags: "warning" },
    body: text,
  });
}

async function pushTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text }),
  });
}

// sendOwnerAlert — fire-and-forget. `text` is the human message, `key` is the grouping id
// (e.g. "tablet:place_order"). Safe to await; it never throws.
export async function sendOwnerAlert(text: string, key: string): Promise<void> {
  try {
    if (!process.env.NTFY_TOPIC && !(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)) {
      return; // no channel configured → no-op
    }
    if (await recentlyAlerted(key)) return; // grouped: same alert within 15 min → skip
    // Record the send FIRST so a burst of concurrent errors doesn't all slip past the window check.
    try {
      await sb.from("staff_actions").insert({ panel: "admin", action: "alert_sent", detail: key, level: "info", restaurant_id: null });
    } catch {
      /* logging the send is best-effort */
    }
    // Each channel independently; one failing must not stop the other.
    await Promise.allSettled([pushNtfy(text), pushTelegram(text)]);
  } catch {
    /* alerts are best-effort; never break the caller */
  }
}
