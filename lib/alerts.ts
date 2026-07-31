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

// SILENT alerts (owner 2026-07-29): some pings are "good to know", not "run to the kitchen" —
// a rate limit being reached hurts nobody (the person just waits a few minutes). Those must still
// ARRIVE and stay readable in the notification list, but with NO sound and NO vibration.
//   • ntfy   → Priority "min" = it lands in the notification drawer and the ntfy list, with NO
//              sound, NO vibration and no pop-over. ("low" was tried first and STILL vibrated the
//              owner's phone on 2026-07-29 — Android's per-channel vibration overrode it.)
//   • Telegram → disable_notification: true = the message appears in the chat silently.
// Nothing is ever hidden or dropped — silent means quiet, not invisible.
// WHICH ALERTS MAY BUZZ — the owner's final rule (2026-07-29). LOUD is the default, because a thing
// that is actually BROKEN on the website must be felt during service.
//   • SILENT — EXACTLY ONE alert in the whole app: the **staff/owner login** limit
//     (`silent: true` → ntfy "min", Telegram silent: it lands in the notification drawer with no
//     sound and no vibration). Nothing is broken when that wall is hit; the person waits a few
//     minutes. It is also the one that fires most often during our own testing.
//   • LOUD — EVERYTHING else: something went wrong, screen errors, new complaints, the admin-login
//     warning, and the OTHER limits (guest orders, manager PIN, waiter calls, join table, OTP),
//     since those can mean real trouble on the floor.
// (Two earlier passes got this wrong — one made everything loud, one made everything quiet. Do not
// widen the silent list again without asking him.)
// Silent still means quiet, never hidden: every alert also lands in the notification list, the
// admin bell and the Everything Log.
type AlertOpts = { silent?: boolean; title?: string; tags?: string };

// ── ONE shape for every alert (owner 2026-07-29: "structure it, one long plain line is hard to
// read"): one "Label: value" per fact, then an optional closing note. Empty facts are dropped, so
// a caller can pass everything it might know and the message stays tight.
//
// Deliberately PLAIN text, not Markdown: the ntfy Android app shows markdown syntax literally, so
// **bold** would arrive as asterisks. Newlines are the formatting.
//
// NO HEADLINE HERE ON PURPOSE (owner 2026-07-29: "it already says limit reached at the top, why
// again at the bottom?"). The SUMMARY lives in `opts.title` — which ntfy shows as the bold first
// line — so the body carries only the details, each fact exactly once. Telegram has no title
// field, so sendOwnerAlert puts the summary on top of the text there instead.
export type AlertField = [label: string, value: string | number | null | undefined];

export function alertText(fields: AlertField[], note?: string | null): string {
  const lines: string[] = [];
  for (const [label, value] of fields) {
    const v = value === null || value === undefined ? "" : String(value).trim();
    if (v) lines.push(`${label}: ${v}`);
  }
  if (note && note.trim()) lines.push("", note.trim());
  return lines.join("\n");
}

// WHICH STACK IS TALKING — the first thing on every alert (owner, 2026-07-31: "it is error
// from AV live or it is error from backup, it should note on the top"). A ping that doesn't say
// where it came from is a ping you can't act on: our own test load and a real restaurant in
// trouble looked identical on his phone.
// Derived from the database the app is pointed at, so neither deployment needs a new setting.
// Kept ASCII — it goes in an HTTP header (see headerSafe below).
const STACK_BY_REF: Record<string, string> = {
  kclqkmdxnwlhtyrducku: "AV live",       // the paying clients
  wnsfcizclkbobwzcxqsf: "Backup (test)", // our dev/demo stack
};
export function alertStack(): string {
  const override = (process.env.ALERT_STACK || "").trim();
  if (override) return override;
  try {
    const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").hostname.split(".")[0];
    return STACK_BY_REF[ref] || `Stack ${ref.slice(0, 6)}`;
  } catch {
    return "Unknown stack";
  }
}

// ntfy headers are HTTP headers = ASCII only. A "·", a curly quote or a Hindi restaurant name in
// the TITLE arrives as mojibake (seen 2026-07-29), so anything non-ASCII is sent RFC-2047 encoded,
// which ntfy understands and decodes back to the real characters.
function headerSafe(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

// Loud unless the caller explicitly asks for quiet with `silent: true` (see AlertOpts above).
const isQuiet = (o?: AlertOpts) => o?.silent === true;

// A "quiet" ping means LOW, never MIN. ntfy's `min` can be dropped from the notification
// list entirely, so the one alert we deliberately deliver quietly (the staff/owner login
// limit) could vanish instead of waiting to be read — the opposite of the intent, and it
// contradicted the rule already written down in CLAUDE.md. `low` arrives, sits in the list,
// and makes no sound or vibration.
const QUIET_PRIORITY = "low";
const LOUD_PRIORITY = "high";

// An alert must NEVER hold up the request that triggered it. Both pushes are outbound HTTP
// to someone else's server, and they used to be awaited with no upper bound — so on a
// restaurant's flaky wifi (or if ntfy is slow) a staff action could sit there waiting for a
// notification nobody is looking at. Caught 2026-07-31: an invoice POST took 30s while the
// shared test database was saturated and errors were being alerted.
// 4s is generous for a notification and short enough that a waiter never notices.
const ALERT_TIMEOUT_MS = 4000;
const alertFetch = (url: string, init: RequestInit) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(ALERT_TIMEOUT_MS) });

async function pushNtfy(text: string, o?: AlertOpts): Promise<void> {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  const server = process.env.NTFY_SERVER || "https://ntfy.sh";
  await alertFetch(`${server}/${topic}`, {
    method: "POST",
    headers: {
      Title: headerSafe(o?.title || "Restaurant alert"),
      Priority: isQuiet(o) ? QUIET_PRIORITY : LOUD_PRIORITY,
      Tags: o?.tags || (isQuiet(o) ? "traffic_light" : "warning"),
      Markdown: "no", // the body is plain text on purpose — see alertText()
    },
    body: text,
  });
}

async function pushTelegram(text: string, o?: AlertOpts): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  await alertFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chat,
      text: o?.title ? `${o.title}\n\n${text}` : text,
      disable_notification: isQuiet(o),
    }),
  });
}

// sendOwnerAlert — fire-and-forget. `text` is the human message, `key` is the grouping id
// (e.g. "tablet:place_order"). `opts.silent` delivers it quietly (see above); `opts.title` sets
// the ntfy notification title. Safe to await; it never throws.
export async function sendOwnerAlert(text: string, key: string, opts?: AlertOpts): Promise<void> {
  try {
    if (!process.env.NTFY_TOPIC && !(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)) {
      return; // no channel configured → no-op
    }
    if (await recentlyAlerted(key)) return; // grouped: same alert within 15 min → skip
    // Stamp the stack on the title and the first line, so a glance at the phone answers
    // "is this my restaurant, or our test site?" before anything else is read.
    const stack = alertStack();
    const body = `[${stack}]\n${text}`;
    const withStack: AlertOpts = { ...(opts || {}), title: `${stack}: ${opts?.title || "Restaurant alert"}` };
    // Record the send FIRST so a burst of concurrent errors doesn't all slip past the window check.
    try {
      await sb.from("staff_actions").insert({ panel: "admin", action: "alert_sent", detail: key, level: "info", restaurant_id: null });
    } catch {
      /* logging the send is best-effort */
    }
    // Each channel independently; one failing must not stop the other.
    await Promise.allSettled([pushNtfy(body, withStack), pushTelegram(body, withStack)]);
  } catch {
    /* alerts are best-effort; never break the caller */
  }
}
