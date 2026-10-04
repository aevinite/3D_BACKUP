// verify-launch-risks.mjs — the five ways a small app gets a lawsuit or a surprise bill.
//
// WHY THIS EXISTS. On 2026-10-03 the owner sent a short video listing five things that sink
// vibe-coded apps, and asked for each one to be checked and kept true: *"If any of this is not
// being done by us, then do it … so we don't mess up anytime soon."* They are rows 29–33 of
// docs/SECURITY-CHECKLIST.md. This file is the part of those rows that a script can honestly check
// from the code alone, with no database and no network, so it runs in CI on every push.
//
//   29 · A traffic spike can't run up a hosting bill   → no scheduled jobs on Vercel, the 3D
//        models are cached for a year, and no server code calls the app's own web address.
//        (The real cap is the PLAN: Vercel Hobby and Supabase Free cannot bill overage. That is a
//        dashboard fact, not a code fact — the checklist row says so.)
//   30 · A keyboard or screen-reader user can use the guest menu → every image says what it is
//        (alt), every clickable box on a guest, owner or admin screen is a real button or answers
//        the keyboard, and the page declares its language.
//   31 · The public key can't read anyone's table      → NOT here. It needs the database:
//        `npm run verify:grants` (row security on every table, open reads on an allow-list).
//   32 · Nobody is texted without their written consent → the app sends NO message to a guest
//        today. This is a tripwire: the day an SMS / WhatsApp / email sender is added, it fails
//        until that sender is listed below WITH the consent check it makes.
//   33 · Nothing can call itself forever and bill us   → no server route fetches the app's own
//        address (the A-calls-B-calls-A loop), no scheduled Vercel job exists.
//
// READ-ONLY. Reads files, writes nothing.   node scripts/verify-launch-risks.mjs [--quiet]
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const QUIET = process.argv.includes("--quiet");
let failed = 0;
const pass = (m) => { if (!QUIET) console.log("  ✓ " + m); };
const fail = (m) => { console.log("  ✗ " + m); failed++; };
const head = (m) => { if (!QUIET) console.log("\n" + m); };

const walk = (dir, exts, skip = []) => {
  const out = [];
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const rel = join(dir, name);
    if (skip.some((s) => rel.startsWith(s)) || name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel, exts, skip));
    else if (exts.some((e) => name.endsWith(e))) out.push(rel);
  }
  return out;
};
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const lineOf = (src, i) => src.slice(0, i).split("\n").length;
// A match inside a // line comment or a /* … */ block is prose, not markup.
const inComment = (src, i) => {
  const ls = src.lastIndexOf("\n", i) + 1;
  const before = src.slice(ls, i);
  if (/^\s*(\/\/|\*|\/\*)/.test(before)) return true;
  if (/(^|[^:"'])\/\/(?![^"'`]*["'`]\s*[+,;)])/.test(before)) return true; // a trailing `// …` after code
  const open = src.lastIndexOf("/*", i), close = src.lastIndexOf("*/", i);
  return open > close;
};

// The opening tag from its `<` to the `>` that closes it — skipping any `>` inside {…} (an arrow
// function's `=>`) or inside quotes.
const openingTag = (src, at) => {
  let depth = 0, q = "";
  for (let i = at; i < src.length && i < at + 4000; i++) {
    const c = src[i];
    if (q) { if (c === q && src[i - 1] !== "\\") q = ""; continue; }
    if (c === '"' || c === "'" || c === "`") { if (depth || src[i - 1] === "=") q = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(at, i + 1);
  }
  return src.slice(at, at + 700);
};

const TSX = [...walk("app", [".tsx"]), ...walk("components", [".tsx"])];
const PANEL_JS = walk("public/panels", [".js"]);

// ── 29 + 33 · cost and loops ──────────────────────────────────────────────────────────────────
head("29/33 · a traffic spike or a loop can't run up a bill");
const vercel = JSON.parse(read("vercel.json"));
if (vercel.crons?.length) fail(`vercel.json schedules ${vercel.crons.length} job(s). A scheduled job runs whether anyone uses the app or not — say why in docs/SECURITY-CHECKLIST.md row 33, then remove this check's objection.`);
else pass("no scheduled jobs on Vercel (the database's own pg_cron jobs are listed by verify:grants)");
const models = (vercel.headers || []).find((h) => h.source === "/models/(.*)");
const cc = models?.headers?.find((h) => h.key === "Cache-Control")?.value || "";
if (/max-age=31536000/.test(cc) && /immutable/.test(cc)) pass("the 3D models are cached for a year, so a returning phone downloads nothing");
else fail(`/models/ must be served with "public, max-age=31536000, immutable" (found: "${cc || "nothing"}") — a model is the biggest file a guest fetches, and re-sending it is the bandwidth bill`);

const SELF = /fetch\(\s*[`'"]?[^)]{0,80}\b(VERCEL_URL|NEXT_PUBLIC_SITE_URL|SITE_URL|APP_URL|BASE_URL|localhost:4000|req(?:uest)?\.nextUrl\.origin)\b/;
const serverFiles = [...walk("app/api", [".ts"]), ...walk("lib", [".ts"])];
const selfCalls = serverFiles.flatMap((f) => {
  const s = read(f); const m = SELF.exec(s);
  return m && !inComment(s, m.index) ? [`${f}:${lineOf(s, m.index)}`] : [];
});
if (selfCalls.length) fail(`server code fetches the app's own address — one route calling another over HTTP is how a loop bills by the second: ${selfCalls.join(", ")}. Call the function directly instead.`);
else pass(`no server code fetches the app's own address (${serverFiles.length} files read)`);

// ── 30 · accessibility ────────────────────────────────────────────────────────────────────────
head("30 · a keyboard or screen-reader user can use the guest menu");
const noAlt = [];
for (const f of [...TSX, ...PANEL_JS]) {
  const s = read(f); const re = /<img\b[^>]*>/g; let m;
  while ((m = re.exec(s))) if (!inComment(s, m.index) && !/\balt\s*=/.test(m[0])) noAlt.push(`${f}:${lineOf(s, m.index)}`);
}
if (noAlt.length) fail(`${noAlt.length} image(s) have no alt text (alt="" is right for decoration): ${noAlt.join(", ")}`);
else pass(`every <img> says what it is (${TSX.length + PANEL_JS.length} files read)`);

// EVERY React screen — guest, owner and the admin console. It started guest-only (2026-10-03);
// the next day the owner/admin screens were read too: 19 of their 20 hits were pop-up backdrops
// styled inline (which the first version could not recognise) and ONE was real — the owner's
// Customers rows opened a guest's detail on click only. Fixed, so the whole React app is now held
// to it. The plain-JS panels (manager, kitchen, tablet) are NOT read here: they are touch-first
// staff tools with ~600 click handlers, parked on purpose (docs/SECURITY-CHECKLIST.md §3.6).
//
// A tag that is clickable but is not a button is fine when it is one of:
//   · it answers the keyboard itself — role="button" or tabIndex, AND an onKeyDown;
//   · a dimmed backdrop behind a pop-up (closing by tapping outside; the pop-up has its own ✕ and
//     Esc): a backdrop class, aria-hidden, or an inline full-screen `position:fixed/absolute; inset:0`;
//   · a click-catcher that only stops a tap reaching what is underneath.
const OK_BACKDROP = /className=["'{`][^"'}`]*\b(overlay|backdrop|lightbox|scrim|tile-back|drawer-back|owrp-back)\b|aria-hidden=|position:\s*["'](fixed|absolute)["'],\s*inset:\s*0/;
const OK_CATCHER = /onClick=\{\s*\(e\)\s*=>\s*\{?\s*(e\.preventDefault\(\);?\s*)?e\.stopPropagation\(\)/;
const bad = [];
for (const f of TSX) {
  const s = read(f); const re = /<(div|span|li|section|article|tr|td)\b[^>]*?\sonClick=/g; let m;
  while ((m = re.exec(s))) {
    if (inComment(s, m.index)) continue;
    const opening = openingTag(s, m.index);
    const where = `${f}:${lineOf(s, m.index)}`;
    // Reachable by Tab = any tabIndex that is not negative (tabIndex={-1} is focus-by-script only,
    // and `tabIndex={open ? 0 : undefined}` counts as reachable). Reachable boxes must answer
    // Enter/Space; a role="button" that Tab can't reach is still a dead end.
    const reachable = /\btabIndex=/.test(opening) && !/\btabIndex=\{?\s*["']?-\d/.test(opening);
    if (reachable) {
      if (!/onKeyDown=/.test(opening)) bad.push(`${where} (focusable but no onKeyDown — Enter/Space do nothing)`);
      continue;
    }
    if (/\brole=["'](dialog|alertdialog|presentation|none)/.test(opening)) continue; // a pop-up's own frame
    if (OK_BACKDROP.test(opening) || OK_CATCHER.test(opening)) continue;
    bad.push(where);
  }
}
if (bad.length) fail(`a screen has a clickable box a keyboard can't reach — use a <button>, or add role="button" tabIndex={0} and an onKeyDown for Enter/Space: ${bad.join(", ")}`);
else pass(`every clickable box on a guest, owner or admin screen is a button, answers the keyboard, or is a backdrop (${TSX.length} files)`);

const layout = read("app/layout.tsx");
if (/<html[^>]*\blang=/.test(layout)) pass("the page declares its language (screen readers pick the right voice)");
else fail("app/layout.tsx: <html> has no lang attribute");

// ── 32 · messages to guests ───────────────────────────────────────────────────────────────────
head("32 · nobody is sent a message they didn't agree to");
// Each entry: a file allowed to send messages, and the consent it checks. Adding a line is a
// decision someone wrote down. Today the list is EMPTY: the only sender in the app is
// lib/alerts.ts, which messages the platform owner's own Telegram/ntfy — no customer ever.
//
// Before adding a guest sender, the rule (India: DPDP Act 2023 + TRAI's DLT registration for SMS
// + WhatsApp's opt-in policy; US: TCPA, $500–1,500 per text): an order update the guest asked for
// is transactional; an offer is MARKETING and needs its own opt-in (separate from
// customers.consent, which only covers storing the number — mig 212), an opt-out in every
// message, and a record of when they agreed.
const ALLOWED_SENDERS = {};
const SENDER = /\b(twilio|msg91|gupshup|fast2sms|textlocal|kaleyra|sendgrid|nodemailer|mailgun|postmark|api\.resend\.com|from\(["']resend["']\)|graph\.facebook\.com\/v[\d.]+\/\d+\/messages|web-push|sendNotification\()/i;
const senderHits = [];
for (const f of [...serverFiles, ...TSX, ...PANEL_JS]) {
  const s = read(f); const m = SENDER.exec(s);
  if (m && !inComment(s, m.index) && !(f in ALLOWED_SENDERS)) senderHits.push(`${f}:${lineOf(s, m.index)} (${m[1]})`);
}
const pkg = JSON.parse(read("package.json"));
const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) => SENDER.test(d));
if (senderHits.length || deps.length) fail(`a message sender appeared: ${[...senderHits, ...deps.map((d) => "package.json → " + d)].join(", ")}. Before it ships, it needs the consent check described above this list, and a line in ALLOWED_SENDERS naming that check.`);
else pass("the app sends no SMS, WhatsApp, email or push message to any guest");

console.log(failed ? `\n✗ ${failed} launch-risk check(s) failed` : "\n✓ launch risks: all clear (row 31, the database, is verify:grants)");
process.exit(failed ? 1 : 0);
