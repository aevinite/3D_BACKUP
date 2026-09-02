// lib/plainError.ts — an error row, said in the words a person uses.
//
// ── THE OWNER'S ASK, 2026-09-02 ──────────────────────────────────────────────────────────────────
//
//   "why the logs are in the code supabase language it should be in the human language — make sure
//    every possible log and stuff in human language so I can understand easily"
//
// He was looking at admin → Audit & logs → Operations → Errors, and every red row on the screen
// was a browser's own words:
//
//   Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.
//   GET summary — TimeoutError: The operation was aborted due to timeout
//   Invalid count value: -1 @ /owner/issues [Safari · Mac]
//   Cannot read properties of undefined (reading 'length') @ /aevinite/revenue
//   Failed to load chunk /_next/static/chunks/1g1jwpgiikpwc.js from module 64893 @ /signup
//
// Those sentences are written for whoever wrote the engine, not for whoever runs the restaurant.
// This file turns each of them into one plain sentence about what a PERSON would have experienced.
//
// ── WHY IT TRANSLATES AT DISPLAY TIME, NOT AT WRITE TIME ─────────────────────────────────────────
//
// The exact message is the only thing that can fix the bug. "Send to Claude", the Fix-now ticket,
// the repeat-grouping on the Repair board (lib/errorSignature → errorSig) and any support question
// all need it character-for-character, and 30,000-odd rows are ALREADY in the table written the
// old way. So nothing is rewritten in the database: the row keeps its exact text, the LIST LINE
// shows the plain sentence, and the opened row shows both — plain sentence first, exact message
// underneath under "Exact message". Same shape as detailForList / formatActionDetail in
// components/admin/shared.tsx, for the same reason: a list is for reading, a detail is for fixing.
//
// HIDES NOTHING. Every branch below either recognises a message and explains it, or hands the
// message back untouched. An error we have never seen still prints in full — it just prints under
// a heading that says we don't have plain words for it yet, rather than silently looking translated.
//
// ── THE RULE FOR ADDING TO THIS FILE ─────────────────────────────────────────────────────────────
//
// One entry = one MEASURED message. Every pattern here was taken from real rows in the dev
// database (60 newest level:'error' rows + a 3,000-row sweep of every distinct action, 2026-09-02),
// never invented from imagination. If you are adding a rule, read the real row first. A rule that
// matches nothing is worse than no rule: it looks like coverage.
//
// This file is CLIENT-SAFE (no server imports) — the admin screens, the owner screens and the
// alert layer all call it. Same constraint as lib/logTrail.ts; see its header for what breaks
// otherwise.

/**
 * legacyJsonDetail — the two stored-JSON shapes that predate the sentences, said in words.
 *
 * Two call sites used to stringify their patch object straight into a log row's `detail`, so the
 * record of a change read as the change's machine shape — and one of them sat on the admin
 * DASHBOARD, in "Latest activity", which is the first thing the console shows:
 *
 *   rate_limit_edit  → rate limit "guest_order" updated: {"enabled":true,"updated_at":…}
 *   platform_toggle  → {"platform_in_bills":true}
 *
 * Both now write a sentence (lib/rateLimit.ts → rateEditWords, and the editor route's
 * TOGGLE_WORDS). But NOTHING IN THIS APP EDITS A LOG ROW AFTER THE FACT — that is the compliance
 * rule, not a limitation — so the old rows are in the table for good and the DISPLAY has to keep
 * understanding them. The two translations are written to produce the SAME sentence the new
 * writers produce, so a list mixing old and new rows reads as one thing.
 *
 * Returns "" when this row is not one of the two (the overwhelmingly common case), so the caller
 * falls straight through to the raw string and an unfamiliar shape is never hidden.
 *
 * Deliberately narrow: it recognises exactly the two writers that did this and nothing else. A
 * THIRD one appearing is a bug at the WRITE site and belongs fixed there — npm run
 * verify:plain-logs fails on any `detail:` built with JSON.stringify.
 *
 * It lives HERE rather than beside formatActionDetail (its only caller) so the guard can import
 * and ASK it: components/admin/shared.tsx is a .tsx, and Node cannot strip JSX, so anything the
 * guard needs to run has to sit in a plain .ts. Same reason lib/logTrail.ts is client-safe.
 */
/**
 * What a person calls each rate limit. THE ONE LIST — the phone alert (lib/rateLimit.ts), the
 * diary line written when one is edited (rateEditWords) and the translation of the old JSON rows
 * below all read it, so a limit cannot be called three different things on three screens.
 *
 * It lives in THIS file, not next to the limit logic, because this file is client-safe and
 * lib/rateLimit.ts is not (it imports supabaseAdmin). A shared list has to sit on the side that
 * both can reach, and the alternative — a copy here — is the drift this codebase has been bitten
 * by twice (see components/admin/shared.tsx → ACT_LABEL's header).
 */
export const RATE_LABELS: Record<string, string> = {
  guest_order: "Guest orders", staff_login: "Staff / owner login", admin_login: "Admin login",
  manager_pin: "Manager PIN", waiter_call: "Waiter calls", join_session: "Join table",
  otp_request: "OTP requests",
  // mig 277 — the "change my password" box, the one credential check that had no wall.
  password_change: "Change-password attempts",
};
const PLATFORM_WORDS: Record<string, [string, string]> = {
  kitchen_can_accept_platform: ["the kitchen can now accept delivery-app orders", "the kitchen can no longer accept delivery-app orders"],
  platform_in_bills: ["delivery-app orders now show in the bills", "delivery-app orders no longer show in the bills"],
};
export function legacyJsonDetail(action: string, detail: string): string {
  if (action === "rate_limit_edit") {
    const m = detail.match(/^rate limit "([^"]+)" updated:\s*(\{[\s\S]*\})\s*$/);
    if (!m) return "";
    let patch: Record<string, unknown>;
    try { patch = JSON.parse(m[2]); } catch { return ""; }
    const name = RATE_LABELS[m[1]] || m[1].replace(/_/g, " ");
    const parts: string[] = [];
    if (patch.enabled !== undefined) parts.push(patch.enabled ? "switched on" : "switched off");
    // `updated_at` / `updated_by` are deliberately dropped: the log row's own timestamp and panel
    // already say when and by whom, so printing them again was saying nothing twice.
    const count = patch.max_count === undefined ? null : Number(patch.max_count);
    const secs = patch.window_seconds === undefined ? null : Number(patch.window_seconds);
    const per = secs === null ? "" : secs % 60 === 0 ? `${secs / 60} min` : `${secs} sec`;
    if (count !== null && per) parts.push(`now ${count} tries per ${per}`);
    else if (count !== null) parts.push(`now ${count} tries per window`);
    else if (per) parts.push(`window now ${per}`);
    return `${name} — ${parts.length ? parts.join(", ") : "settings changed"}`;
  }
  if (action === "platform_toggle" && detail.trim().startsWith("{")) {
    let patch: Record<string, unknown>;
    try { patch = JSON.parse(detail); } catch { return ""; }
    const said = Object.entries(patch)
      .map(([k, v]) => PLATFORM_WORDS[k]?.[v ? 0 : 1] ?? `${k.replace(/_/g, " ")} turned ${v ? "on" : "off"}`)
      .join("; ");
    return said || "";
  }
  return "";
}

/** The browser/OS tag the client-error endpoint appends, e.g. " [Safari · Mac]". */
const BROWSER_TAG = /\s*\[([^\]]{1,40})\]\s*$/;

/** " @ /owner/issues" / " @ app.js@e5b15272:13942 <- app.js@e5b15272:2676" — WHERE it happened. */
const AT_WHERE = /\s+@\s+(.+?)\s*$/;

/** The de-dupe hash the guest menu appends to a lookup failure, e.g. " #2220843683". */
const NOISE_HASH = /\s+#\d{6,}\s*$/;

/**
 * The admin console's screens, in the words the sidebar uses for them
 * (components/admin/AdminShell.tsx is the source these names are copied from — if you rename a
 * nav item, rename it here too, or the log will call the screen something the sidebar doesn't).
 */
const ADMIN_SCREENS: Record<string, string> = {
  "": "Dashboard",
  floor: "Live floor",
  analytics: "Analytics",
  "bill-audit": "Bills",
  repair: "Repair & support",
  logs: "Audit & logs",
  restaurants: "Restaurants",
  owners: "Owners",
  customers: "Customers",
  recycle: "Recycle bin",
  access: "Access & permissions",
  printing: "Printing",
  users: "Users",
  revenue: "Revenue",
  usage: "Usage & cost",
  billing: "Billing & plans",
  health: "System health",
  "rate-limits": "Rate limits",
  settings: "Settings",
  issues: "Reported problems",
  attention: "Needs attention",
  "staff-online": "Who's working now",
};

/** The owner dashboard's pages, in the words its own sidebar uses. */
const OWNER_SCREENS: Record<string, string> = {
  "": "Home",
  issues: "Feedback & problems",
  staff: "Staff",
  activity: "Audit & logs",
  reports: "Reports",
  menu: "Menu",
  tables: "Tables",
  settings: "Settings",
  inventory: "Stock",
  expenses: "Expenses",
  customers: "Guests",
  billing: "Billing",
  banquet: "Banquet",
  parcel: "Parcel & delivery",
  printing: "Printing",
  access: "Who can do what",
};

/** Turn one URL path into "<panel> › <screen>", so no address prints as a raw path. */
export function screenName(where: string | null | undefined): string {
  const raw = String(where ?? "").trim();
  if (!raw) return "";
  // A panel file + line number ("app.js@e5b15272:13942 <- app.js@e5b15272:2676") is not an
  // address a person can visit — it is a place in the code. Say so, and keep it: it is exactly
  // what the fix needs. Only the FIRST frame matters for a headline; the chain stays in the
  // exact message.
  if (/^app\.js@/.test(raw)) {
    const line = raw.match(/^app\.js@[0-9a-f]+:(\d+)/)?.[1];
    return line ? `inside the panel's own code (line ${line})` : "inside the panel's own code";
  }
  if (!raw.startsWith("/")) return raw; // not a path we know how to name — print it as-is
  const segs = raw.split("?")[0].split("#")[0].split("/").filter(Boolean);
  const pretty = (s: string) => s.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

  if (segs[0] === "aevinite") {
    const key = segs[1] ?? "";
    return `Admin console › ${ADMIN_SCREENS[key] ?? pretty(key)}`;
  }
  if (segs[0] === "owner") {
    const key = segs[1] ?? "";
    return `Owner dashboard › ${OWNER_SCREENS[key] ?? pretty(key)}`;
  }
  if (segs[0] === "manager" || segs[0] === "editor") return "Manager panel";
  if (segs[0] === "kitchen") return "Kitchen screen";
  if (segs[0] === "tablet") return "Waiter tablet";
  // The three guest menu doors (/menu, /r/<slug>/menu, /q/<code>) — a guest's phone, whichever
  // door they came through. See docs: every guest rule must hold in all three.
  if (segs[0] === "q") return "Guest menu (QR code)";
  if (segs[0] === "r") {
    // /r/<slug>/menu — segs[1] IS the restaurant, and naming it is the whole point of this door.
    // Titling the slug ("aangan-garden-restaurant" → "Aangan Garden Restaurant") is a guess at
    // its real display name, but a close one, and it beats printing the slug or saying "Menu"
    // twice. The sub-page after /menu is added only when there IS one worth naming.
    const name = segs[1] ? segs[1].replace(/-/g, " ").replace(/\b./g, (c) => c.toUpperCase()) : "";
    const sub = segs.slice(3).filter((s) => s !== "menu")[0] ?? "";
    const base = name ? `Guest menu (${name})` : "Guest menu";
    return sub ? `${base} › ${pretty(sub)}` : base;
  }
  if (segs[0] === "menu" || segs.length === 0) return "Guest menu";
  if (segs[0] === "item" || segs[0] === "view") return "Guest menu › a dish page";
  if (segs[0] === "login" || segs[0] === "staff-login") return "Sign-in page";
  return `${pretty(segs[0])}${segs[1] ? ` › ${pretty(segs[1])}` : ""}`;
}

/**
 * ONE measured message shape → one plain sentence.
 *
 * `test` is matched against the message with the browser tag, the address and the noise hash
 * already stripped, so a rule never has to think about those. `say` may use the regex groups.
 * Order matters: the FIRST match wins, so put the specific rule above the general one.
 */
// `say` is the LIST LINE and has to be short. `then` is extra context shown only in the opened
// card. Measured in the browser on 2026-09-02: the first version put the whole explanation in
// `say`, and the log row is one line — so "Part of the app didn't finish downloading, so the
// screen couldn't open. Usually a dropped connection, or a page that was left open from before
// the last update — reloading it fixes it." rendered as
//
//     Screen error · Part of the app didn't finish downloading, so the screen cou…
//
// and the two things worth reading — WHERE it happened and on which browser — were cut off the
// end entirely. A longer sentence in a one-line box is less readable than a short one, not more.
// So: `say` states what happened in one clause, `then` carries the "why / what to do", and the
// card shows both. Same division as everything else here — a list is for reading, a detail is
// for fixing.
type Rule = { test: RegExp; say: (m: RegExpMatchArray) => string; then?: string };

const RULES: Rule[] = [
  // ── The app's own code failing to arrive ──────────────────────────────────────────────────────
  // Measured: "Failed to load chunk /_next/static/chunks/1g1jwpgiikpwc.js from module 64893".
  // Overwhelmingly the most common row in the table. It is almost never a bug in the app: it is a
  // page that was left open across a deploy (the file it wants no longer exists under that name)
  // or a connection that dropped mid-load. Saying that outright stops it reading like a crash.
  {
    test: /^(?:Loading chunk|Failed to load chunk|ChunkLoadError)/i,
    say: () => "Part of the app didn't finish downloading, so the screen couldn't open.",
    then: "Almost never a fault in the app itself: it is a dropped connection, or a page left open from before the last update, which is asking for a file that no longer exists under that name. Reloading the page fixes it.",
  },
  {
    test: /^Failed to (?:fetch|load) dynamically imported module/i,
    say: () => "Part of the app didn't finish downloading, so the screen couldn't open.",
    then: "Usually a dropped connection, or a page left open from before the last update. Reloading it fixes it.",
  },

  // ── Something took too long ───────────────────────────────────────────────────────────────────
  // Measured: "GET summary — TimeoutError: The operation was aborted due to timeout".
  {
    test: /\b(?:TimeoutError|ETIMEDOUT)\b|\baborted due to timeout\b|\btimed?\s?out\b/i,
    say: () => "The app waited for the server and gave up.",
    then: "The server took longer than the app is willing to wait. One of these on a busy evening is normal; a run of them means the database or the connection was struggling.",
  },
  {
    test: /\bAbortError\b|\bThe (?:user|operation) aborted a request\b/i,
    say: () => "The request was stopped before it finished.",
    then: "Usually the screen was closed, or somebody moved on, while it was still loading. Harmless on its own.",
  },

  // ── Couldn't reach the server at all ──────────────────────────────────────────────────────────
  // Measured: 'Couldn\'t look up restaurant "french-house": TypeError: fetch failed'.
  {
    test: /^Couldn't look up restaurant "([^"]+)"/i,
    say: (m) => `The app couldn't reach the server to look up the restaurant "${m[1]}".`,
  },
  {
    test: /\bfetch failed\b|\bFailed to fetch\b|\bNetworkError\b|\bLoad failed\b|\bECONNREFUSED\b|\bENOTFOUND\b|\bEAI_AGAIN\b/i,
    say: () => "The app couldn't reach the server at all.",
    then: "Either the internet dropped at that moment or the server did not answer. If the staff panels were working at the same time, it was that one device's connection.",
  },
  {
    test: /\berror page instead of data\b/i, // readableError() already wrote this half in English
    say: () => "The database answered with an error page instead of data.",
    then: "It was refusing requests at that moment. This comes from the service in front of the database, not from anything the restaurant did.",
  },

  // ── The screen expected data and got nothing ──────────────────────────────────────────────────
  // Measured: "Cannot read properties of undefined (reading 'length')" and "(reading 'tone')".
  {
    test: /Cannot read propert(?:y|ies) of (?:undefined|null) \(reading '([^']+)'\)/i,
    say: (m) =>
      m[1] === "length"
        ? "The screen expected a list of things and got nothing at all."
        : `The screen expected a value called "${m[1]}" and got nothing at all.`,
    then: "So it stopped drawing at that point. A genuine mistake in the app's own code — something was read before it had arrived.",
  },
  {
    test: /^Cannot read propert(?:y|ies) '?([^' ]+)'? of (?:undefined|null)/i, // older Safari wording
    say: (m) => `The screen expected a value called "${m[1]}" and got nothing at all.`,
    then: "So it stopped drawing at that point. A genuine mistake in the app's own code.",
  },
  {
    test: /Cannot convert undefined or null to object/i,
    say: () => "The screen expected some data and got nothing at all.",
    then: "A genuine mistake in the app's own code — something was read before it had arrived.",
  },
  {
    test: /\b(?:undefined|null) is not an object\b|\bis not iterable\b/i,
    say: () => "The screen got data in a shape it didn't expect.",
    then: "A genuine mistake in the app's own code.",
  },

  // ── Something in the code doesn't exist ───────────────────────────────────────────────────────
  // Measured: "mode is not defined @ app.js@e5b15272:13942" — a real bug in the manager panel.
  {
    test: /^(?:Can't find variable: )?([A-Za-z_$][\w$]*) is not defined$/,
    say: (m) => `The code asked for something called "${m[1]}" that doesn't exist.`,
    then: "A genuine mistake in the app's own code — not anything the restaurant or the staff did, and not something they can work around. It needs a fix.",
  },
  {
    test: /^Can't find variable: ([A-Za-z_$][\w$]*)/,
    say: (m) => `The code asked for something called "${m[1]}" that doesn't exist.`,
    then: "A genuine mistake in the app's own code. It needs a fix.",
  },
  {
    test: /^([\w.$]+) is not a function$/,
    say: (m) => `The code tried to use "${m[1]}" as an action, and it isn't one.`,
    then: "A genuine mistake in the app's own code. It needs a fix.",
  },

  // ── Redrawing the screen went wrong ───────────────────────────────────────────────────────────
  // Measured: "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child
  // of this node." — the exact row in his screenshot.
  {
    test: /Failed to execute 'removeChild' on 'Node'|The node (?:to be removed|before which)/i,
    say: () => "The screen tried to take away something that had already gone.",
    then: "Two updates landed at the same moment while it was redrawing. Usually harmless — the screen recovers on the next update — but a lot of these means two things are fighting over the same part of the page.",
  },
  {
    test: /Failed to execute 'insertBefore' on 'Node'/i,
    say: () => "The screen tried to add something in a place that had already changed.",
    then: "Two updates landed at the same moment while it was redrawing.",
  },
  {
    test: /\bhydrat(?:e|ion)\b/i,
    say: () => "The page the server sent and the page the browser drew didn't match.",
    then: "The browser threw its version away and drew the page again from scratch. The screen ends up correct, but it flickers, and anything half-typed can be lost.",
  },
  // Measured: "Invalid count value: -1 @ /owner/issues" — a count went below zero and the screen
  // was asked to repeat something a negative number of times.
  {
    test: /^Invalid count value:?\s*(-?\d+)/i,
    say: (m) => `A count on the screen came out as ${m[1]}, which can't be right.`,
    then: "Something was counted as less than nothing. A genuine mistake in the app's own code — a total that was allowed to go below zero.",
  },
  {
    test: /^Invalid array length|Maximum call stack size exceeded/i,
    say: () => "The screen got stuck repeating itself and had to stop.",
    then: "A genuine mistake in the app's own code — something counted round in a circle.",
  },

  // ── Permission and sign-in ────────────────────────────────────────────────────────────────────
  {
    test: /\bpermission denied for (?:table|relation|function) ([\w.]+)/i,
    say: (m) => `The app wasn't allowed to read "${m[1]}" from the database.`,
    then: "A permission is missing on the server side — nothing to do with the permission switches on the Access screen, and nothing that can be fixed from there.",
  },
  {
    test: /\brow-level security\b|\bviolates row-level security policy\b/i,
    say: () => "The database refused the change by its own protection rules.",
    then: "The app asked for something outside this restaurant's own data. The protection worked; the request should not have been made.",
  },
  {
    test: /\bJWT expired\b|\binvalid (?:JWT|token)\b|\bnot authenticated\b/i,
    say: () => "The sign-in had run out, so the server refused the request.",
    then: "Signing in again clears it. Normal after a device has been left alone for a long time.",
  },

  // ── The database refusing a write ─────────────────────────────────────────────────────────────
  {
    test: /\bduplicate key value violates unique constraint\b/i,
    say: () => "The app tried to save something that already exists.",
    then: "The database keeps one of each, so it refused the second copy. Nothing was lost — the first one is still there.",
  },
  {
    test: /\bviolates foreign key constraint\b/i,
    say: () => "The app pointed at a record that isn't there any more.",
    then: "So the database refused it. Usually something was removed in one place while another screen still had it open.",
  },
  {
    test: /\bnull value in column "([^"]+)"[\s\S]*?violates not-null\b/i,
    say: (m) => `A required field ("${m[1]}") was left empty.`,
    then: "So the database refused to save it. Nothing was saved half-way.",
  },
  {
    test: /\binvalid input syntax for type uuid\b/i,
    say: () => "The app sent a made-up id where the database expected a real one.",
    then: "Usually a missing value passed along as text. A genuine mistake in the app's own code.",
  },
  {
    test: /\bcould not serialize access\b|\bdeadlock detected\b/i,
    say: () => "Two changes tried to touch the same record at the same moment.",
    then: "The database made one of them wait and then gave up on it. That change did not happen and needs doing again.",
  },
  {
    test: /\btoo many connections\b|\bremaining connection slots\b/i,
    say: () => "The database had no room for another connection at that moment.",
    then: "The request was turned away. If this comes in bursts during service, the app is opening more connections than it should.",
  },
];

/** What one error row means, said three ways. */
export type PlainProblem = {
  /** One plain sentence about what a person would have experienced. Never empty. */
  headline: string;
  /** Where it happened, in the words the sidebar uses. Empty when the row didn't say. */
  screen: string;
  /** The browser and machine it happened on, e.g. "Safari · Mac". Empty when unknown. */
  browser: string;
  /** The row's own text, character for character — what a fix is built from. */
  technical: string;
  /** false when we have no plain words for this message yet, so the UI can say so honestly. */
  translated: boolean;
  /**
   * The "why / what to do" half, shown ONLY in the opened card — never on the list line.
   * Empty when the matched rule has nothing more to add, or when we had no words at all.
   *
   * It is separate from `headline` because the log row is a single line: measured in the browser
   * on 2026-09-02, a three-sentence headline rendered as "…so the screen cou…" and cut the screen
   * name and the browser off the end.
   */
  advice: string;
};

/**
 * plainProblem — the one place that decides how an error row reads.
 *
 * Every admin/owner screen that shows an error, and the phone alert, goes through this. Two
 * copies of this judgement would drift, and drift is the bug this whole family of files exists
 * to prevent (see lib/errorSignature.ts's header).
 */
export function plainProblem(detail: string | null | undefined): PlainProblem {
  const raw = String(detail ?? "").trim();
  if (!raw) return { headline: "Something went wrong and the app didn't say what.", screen: "", browser: "", technical: "", translated: false, advice: "" };

  // Peel off the three decorations the writers add, so a rule only ever sees the MESSAGE.
  let rest = raw;
  const browser = rest.match(BROWSER_TAG)?.[1]?.trim() ?? "";
  if (browser) rest = rest.replace(BROWSER_TAG, "");
  rest = rest.replace(NOISE_HASH, "");
  const whereRaw = rest.match(AT_WHERE)?.[1]?.trim() ?? "";
  if (whereRaw) rest = rest.replace(AT_WHERE, "");

  // Our own prefix on a server-side row names the failing request: "GET summary — <message>".
  // Keep it as the WHERE (it is the only "where" such a row has) and translate the message after.
  let request = "";
  const ourPrefix = rest.match(/^((?:GET|POST|PATCH|PUT|DELETE)\s+[^\s—]*)\s+—\s+([\s\S]+)$/);
  if (ourPrefix) { request = ourPrefix[1]; rest = ourPrefix[2]; }

  // Strip the browser's own decoration on the message ("Uncaught TypeError: ", "(in promise) ") —
  // it names the reporter, not the bug. Same reasoning as stripBrowserPrefix in
  // lib/errorSignature.ts, kept separate here because that copy also feeds the GROUPING key and
  // must not change shape when a display rule is added.
  const msg = rest.replace(/^\s*(?:uncaught\s+)?(?:\(in\s+promise\)\s*:?\s*)?(?:[A-Za-z]*Error|DOMException)\s*:\s*/i, "").trim();

  let headline = "";
  let advice = "";
  for (const r of RULES) {
    const m = msg.match(r.test) ?? rest.match(r.test);
    if (m) { headline = r.say(m); advice = r.then ?? ""; break; }
  }

  const translated = headline !== "";
  if (!translated) {
    // NOT RECOGNISED — print the message, and say plainly that these are the app's own words so
    // he is never left wondering whether this line was meant to make sense to him.
    headline = `The app reported this in its own words: ${msg || rest}`;
  }

  // A server-side row's failing request, said as an action rather than a verb + path.
  const screen = request ? plainRequest(request) : screenName(whereRaw);
  return { headline, screen, browser, technical: raw, translated, advice };
}

/** "GET summary" → "while loading the floor summary" — the few requests that actually appear. */
const REQUESTS: Record<string, string> = {
  summary: "the floor summary",
  orders: "the orders list",
  menu: "the menu",
  bills: "the bills list",
  tables: "the tables",
  staff: "the staff list",
  settings: "the settings",
  whoami: "the sign-in check",
};
function plainRequest(request: string): string {
  const [verb, path = ""] = request.split(/\s+/);
  const last = path.split("/").filter(Boolean).pop() ?? "";
  const what = REQUESTS[last] ?? (last ? `"${last}"` : "the server");
  const doing = verb === "GET" ? "loading" : verb === "DELETE" ? "deleting" : "saving";
  return `while ${doing} ${what}`;
}

/**
 * plainHeadline — the ONE line a list row shows. Headline, then where, then which browser.
 *
 * Kept short on purpose: the list is 34px of one line, and the opened row carries the rest
 * (see LogDetailModal). Same division of labour as detailForList vs formatActionDetail.
 */
export function plainHeadline(detail: string | null | undefined): string {
  const p = plainProblem(detail);
  const bits = [p.headline];
  if (p.screen) bits.push(p.screen.startsWith("while ") || p.screen.startsWith("inside ") ? p.screen : `on ${p.screen}`);
  if (p.browser) bits.push(p.browser);
  return bits.join(" · ");
}
