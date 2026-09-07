// ⬛ NEW — T11 of sweep #8 · BANK M · P101379–P101491 · ROUND 5
// PRINTING UNDER A RUSH, AND WHAT EVERY READ IN THIS TERRITORY COSTS.
//
// WHY. "A rush slows the app, never takes it down" is one of this project's standing rules, and
// printing is the surface most exposed to it: every helper polls every two seconds, per machine,
// for ever, and a KOT is the one document that must never wait. Round 1 read the queue's logic and
// round 5's bank J drives it — but neither asked what happens when the DATABASE is the thing that
// is struggling, and neither costed the reads.
//
// Two halves, and the second is the one the owner calls "cost":
//   · a rush — a 5xx is queued like being offline, a 4xx tells the person, every write has a
//     deadline and a jittered backoff, and nothing polls faster while reads are failing;
//   · egress — every read is SCOPED to one restaurant, names its columns, and is capped. One id
//     per statement, generated from the source, so a failure names the exact query.
import { row, read, codeOnly } from "./lib.mjs";

let id = 101379;
const R = (what, fn) => row(`P${id++}`, what, fn);

const FILES = {
  "lib/printQueue.ts": read("lib/printQueue.ts"),
  "lib/printHelpers.ts": read("lib/printHelpers.ts"),
  "lib/printBoard.ts": read("lib/printBoard.ts"),
  "app/api/print-agent/[...path]/route.ts": read("app/api/print-agent/[...path]/route.ts"),
  "app/api/admin/printing/[...path]/route.ts": read("app/api/admin/printing/[...path]/route.ts"),
};

/* ── EVERY READ, ONE ID EACH ──────────────────────────────────────────────────────────────────
   A statement is found by walking from `.from("table")` to the `;` that ends it — with the
   caveat this project has already been bitten by: a read inside a Promise.all has NO semicolon
   of its own, so a window that stops at the first `;` borrows the NEXT read's ceiling and a
   deleted `.limit()` stays green. So each statement is cut at whichever comes first of `;` and
   the next `.from(` — never at the semicolon alone. */
const statements = [];
for (const [file, src] of Object.entries(FILES)) {
  const code = codeOnly(src);
  const re = /\.from\("([a-z_]+)"\)/g;
  let m;
  while ((m = re.exec(code))) {
    const rest = code.slice(m.index);
    const semi = rest.indexOf(";");
    const next = rest.indexOf('.from("', 1);
    let end = Math.min(semi < 0 ? Infinity : semi, next < 0 ? Infinity : next);
    if (!Number.isFinite(end)) end = Math.min(rest.length, 600);
    /* A QUERY BUILT IN STAGES HAS ITS CEILING SEVERAL STATEMENTS LATER.
         let q = sb.from("print_jobs").select(...).eq(...);
         if (!includeAuto) q = q.eq("reprint", true);
         const jobs = (await q.order("created_at").limit(20)).data;
       Stopping at the first `;` sees no `.limit()` and calls a capped read uncapped — the mirror
       image of the trap this project already recorded, where a window that ran PAST its own
       semicolon borrowed the NEXT read's ceiling. So when the read is assigned to a name, the
       window runs to the end of the enclosing function and that name is followed. */
    const before = code.slice(Math.max(0, m.index - 120), m.index);
    const named = /(?:let|const|var)\s+(\w+)\s*=\s*(?:await\s+)?sb\s*$|(?:let|const|var)\s+(\w+)\s*=\s*(?:await\s+)?sb\s*\.?\s*$/.exec(before);
    let stmt = rest.slice(0, Math.min(end, 600));
    if (named) {
      const v = named[1] || named[2];
      const fnEnd = rest.search(/\n(?:export |\}\n)/);
      const wide = rest.slice(0, fnEnd > 0 ? Math.min(fnEnd, 2000) : Math.min(rest.length, 2000));
      /* The statement's OWN window, plus the later lines that speak about that variable — so a
         later unrelated read is not borrowed, and the `.select(` this read carries on its own
         second line is not thrown away either. Keeping only the variable lines dropped five
         reads out of this bank entirely. */
      const ownLines = stmt.split("\n");
      const laterVar = wide.split("\n").slice(ownLines.length).filter((l) => new RegExp(`\\b${v}\\b`).test(l));
      stmt = [...ownLines, ...laterVar].join("\n");
    }
    /* THE LINE NUMBER MUST BE THE ONE IN THE FILE. Counting newlines in `code` counts them in the
       COMMENT-STRIPPED copy, and these files are heavily commented — so every line this bank
       reported was tens of lines off, and two "findings" pointed at prose. The statement text is
       found in the stripped copy (comments contain code-shaped examples); the line is looked up by
       finding that statement's opening in the original. */
    const anchor = `.from("${m[1]}")`;
    let at = -1, seen = 0, want = code.slice(0, m.index).split(anchor).length - 1;
    while (seen <= want) { at = src.indexOf(anchor, at + 1); if (at < 0) break; seen++; }
    const line = at >= 0 ? src.slice(0, at).split("\n").length : 0;
    /* A WRITE THAT SELECTS BACK IS STILL A WRITE. The queue's whole safety rests on one atomic
       `.update(...).in("id", …).select(...)` — the single filtered UPDATE that stops two machines
       claiming one ticket — and reading it as a query asked it for a row ceiling it neither needs
       nor could have. What bounds a write is its filter, which the write rows below check. */
    const writes_ = /\.update\(|\.insert\(|\.upsert\(|\.delete\(/.test(stmt);
    statements.push({ file, table: m[1], line, stmt, isRead: !writes_ && /\.select\(/.test(stmt) });
  }
}
const reads = statements.filter((s) => s.isRead);

// The tables that are ONE row per restaurant by construction, so a cap on them says nothing.
const SINGLETON = new Set(["settings", "restaurants"]);
/* TWO KINDS OF READ THAT LOOK UNSCOPED AND ARE NOT.
   · The admin console's `/overview` answers ONE question — "which of my restaurants is printing,
     and which has paper stuck?" — so it reads ACROSS restaurants by design. Every one of its
     reads is capped instead. Calling it unscoped was this bank's own error, not a fault: an
     admin-wide screen that filtered to one restaurant could not exist.
   · A helper is identified by its own secret, and `token_hash` is unique across the table, so a
     lookup by it returns exactly one machine and therefore exactly one restaurant. The scope IS
     the key. */
const ADMIN_WIDE = (s) => s.file.includes("admin/printing") && /overview/.test(
  FILES[s.file].slice(0, FILES[s.file].split("\n").slice(0, s.line).join("\n").length).slice(-2400));
const KEYED_BY_SECRET = (s) => /\.eq\("token_hash"|\.eq\("pair_code"|\.eq\("code",/.test(s.stmt);
// A read this territory makes that is deliberately a single row.
const isSingle = (s) => /\.maybeSingle\(\)|\.single\(\)/.test(s.stmt);

/* ONE ROW PER READ, ASKING ALL THREE THINGS. The first version asked them as three rows each —
   129 ids for 43 reads — which is the right granularity in the abstract and the wrong call here:
   it crowded two whole banks (the admin screen's actions, the generated station script) out of a
   claimed 500. The question a row is answering is "does this read cost what it should?", and the
   message names WHICH of the three it broke, so a failure is still precise. */
for (const s of reads) {
  R(`${s.file}:${s.line} — the read of ${s.table} is scoped, names its columns, and cannot come back unbounded`, () => {
    const wrong = [];
    const scoped = (SINGLETON.has(s.table) && /\.eq\("id",/.test(s.stmt))
      || /\.eq\("restaurant_id"|restaurant_id:|\.eq\(\s*"id",\s*agent\.restaurant_id/.test(s.stmt)
      || KEYED_BY_SECRET(s) || ADMIN_WIDE(s);
    if (!scoped) wrong.push("it names no restaurant");
    if (/\.select\(\s*["'`]\s*\*/.test(s.stmt)) wrong.push(`it asks for every column of ${s.table}`);
    const bounded = isSingle(s) || SINGLETON.has(s.table) || /\.limit\(/.test(s.stmt)
      || /head:\s*true|count:\s*["'`]exact/.test(s.stmt);
    if (!bounded) wrong.push("nothing caps how many rows come back");
    return wrong.length === 0 || `${wrong.join(" · ")} — ${s.stmt.replace(/\s+/g, " ").slice(0, 100)}`;
  });
}

/* ── EVERY WRITE, ONE ID EACH ─────────────────────────────────────────────────────────────────
   A write's cost is not how many rows come back — it is how many rows it can TOUCH. Ten of the
   statements above are writes that select their result back (the queue's atomic claim is one), and
   for those the question is the filter, not a ceiling. Each gets its own id so a failure names the
   exact statement rather than "a write is unscoped somewhere". */
const writeStmts = statements.filter((x) => /\.update\(|\.insert\(|\.upsert\(|\.delete\(/.test(x.stmt));
for (const w of writeStmts) {
  R(`${w.file}:${w.line} — the write to ${w.table} can only reach this restaurant's rows`, () => {
    const wrong = [];
    const scoped = /\.eq\("restaurant_id"|restaurant_id:/.test(w.stmt);
    const keyed = /\.eq\("id",|\.in\("id",/.test(w.stmt);
    if (!scoped && !keyed) wrong.push("it names neither a restaurant nor a row id");
    if (/\.neq\("restaurant_id"|\.not\("restaurant_id"/.test(w.stmt)) wrong.push("it writes to every restaurant BUT one");
    // An UPDATE with no filter at all is the shape that rewrites a whole table in one statement.
    const anyFilter = /\.eq\(|\.in\(|\.or\(|\.match\(|\.is\(/.test(w.stmt);
    if (!anyFilter && !/\.insert\(|\.upsert\(/.test(w.stmt)) wrong.push("it carries no filter at all");
    return wrong.length === 0 || `${wrong.join(" · ")} — ${w.stmt.replace(/\s+/g, " ").slice(0, 100)}`;
  });
}

/* ── A RUSH ───────────────────────────────────────────────────────────────────────────────── */
const Q = codeOnly(FILES["lib/printQueue.ts"]);
const AG = codeOnly(FILES["app/api/print-agent/[...path]/route.ts"]);
const HL = codeOnly(FILES["lib/printHelpers.ts"]);
const SCRIPT = read("lib/printHelperScript.ts");
const STATION = read("lib/printStationScript.ts");

R("the helper is told how often to come back, so a thousand machines cannot each choose", () =>
  /const POLL_MS/.test(AG) && /pollMs: POLL_MS/.test(AG) || "the poll interval is not sent by the server");
R("…and that interval is never faster than two seconds", () => {
  const ms = Number((/const POLL_MS = (\d+)/.exec(AG) || [])[1]);
  return (ms >= 2000) || `it is ${ms}ms`;
});
R("…and the helper it generates really does wait that long between asks", () => {
  const waits = [...SCRIPT.matchAll(/sleep\s+(\d+)|Start-Sleep[^\d]*(\d+)|timeout\s*\/t\s*(\d+)/gi)]
    .map((m) => Number(m[1] || m[2] || m[3])).filter((n) => Number.isFinite(n) && n > 0);
  return (waits.length > 0 && Math.min(...waits) >= 1) || `the shortest wait it takes is ${Math.min(...waits)}s`;
});
R("…and the interval the server sends is REPORTED, because the helper does not read it", () => {
  /* A HALF-KEPT PROMISE, RECORDED RATHER THAN PAPERED OVER (T11, sweep #8, 2026-09-07).
     The route sends `pollMs` on every hello, and round 1 asserted that — but it asserted the
     SENDING. The generated helper's empty-basket wait is a hard-coded `sleep 2`. The two agree
     today (POLL_MS is 2000), so no restaurant feels anything; but raising POLL_MS to shed load
     would change nothing until every restaurant re-installed the file. That is the same shape as
     the `backupFor` field this terminal deleted in round 1: a value the server sends that nothing
     reads. It is NOT fixed here, on purpose — the same file's Windows half cannot be tested from
     this Mac (report items 16 and 17), and shipping the Unix half alone would make the two
     platforms behave differently. Carried to the owner as a decision.
     What this row asserts is that the situation has not got WORSE: the server still sends it, and
     the helper's own wait is still no faster than the server's. */
  const ms = Number((/const POLL_MS = (\d+)/.exec(AG) || [])[1]);
  /* THE EMPTY-BASKET WAIT, not every sleep in the file. The others do different jobs — "let the
     last bytes land before we take the file" is a 1-second sleep INSIDE a job, and reading it as
     the poll interval said the helper polls three times faster than it does. */
  const loop = SCRIPT.slice(SCRIPT.indexOf("the sleep below is only for when the basket is empty"));
  const sleeps = [...loop.matchAll(/^\s*sleep\s+([\d.]+)\s*(?:#[^\n]*)?$/gm)].map((m) => Number(m[1])).filter((n) => n >= 1);
  const shortest = sleeps.length ? Math.max(...sleeps) : 0;
  if (/pollMs/.test(SCRIPT)) return true;                      // somebody wired it — better still
  return (shortest * 1000 >= ms) || `the server asks for ${ms}ms between polls; the helper waits ${shortest}s`;
});
R("an empty poll transfers no body at all — this is the request that happens most in the product", () =>
  /new NextResponse\(null, \{ status: 204 \}\)/.test(AG) || "an idle poll now returns a body, every two seconds, per machine");
R("…and printing being switched off answers the same cheap way, not as an error", () => {
  const seg = AG.slice(AG.indexOf('seg[0] === "next"'));
  return /204/.test(seg.slice(0, 1200)) || "a restaurant with printing off pays for an error body every two seconds";
});
R("the queue's own claim is ONE filtered UPDATE, so a rush cannot hand one ticket to two machines", () => {
  const seg = Q.slice(Q.indexOf("export async function claimKotJobs"), Q.indexOf("export async function finishKotJob"));
  return (/\.update\(/.test(seg) && /\.or\(liveFilter\(\)\)/.test(seg)) || "the claim is no longer a single filtered update";
});
R("…and the offer and the claim ask the same question, so what is shown equals what can be won", () =>
  (Q.match(/liveFilter\(\)/g) || []).length >= 2 || "the read and the claim can drift apart under load");
R("a ticket nobody could print parks after a fixed number of tries", () => {
  const m = /attempts >= (\d+)/.exec(Q);
  return (m && Number(m[1]) > 0 && Number(m[1]) <= 10) || `the ceiling reads ${JSON.stringify(m && m[1])}`;
});
R("…so a dead printer cannot fill the queue for the tickets behind it", () =>
  /parked \? "failed"/.test(Q) || "a failing ticket is no longer parked");
R("the pile-up warning COUNTS rather than listing, so a backlog does not cost more to notice than to fix", () =>
  /head:\s*true|count:\s*["'`]exact/.test(Q) || "the backlog is measured by transferring the backlog");
R("…and it is kitchen slips only, deliberately — a bill waits for a person, so it is not a pile-up", () => {
  const seg = Q.slice(Q.indexOf("pendingKotJobs"));
  return /kind[^\n]{0,40}kot|"kot"/.test(seg.slice(0, 900)) || "the pile-up count now includes paper nobody is waiting on";
});
R("the backstop that catches a missed ticket is no faster than a minute", () => {
  const nums = [...(Q + HL).matchAll(/(\d{4,6})\s*(?:\/\/[^\n]*)?(?:ms|milliseconds)?/g)].map((m) => Number(m[1]));
  const fast = nums.filter((n) => n >= 1000 && n < 60000 && /setInterval|backstop/i.test(Q));
  return fast.length === 0 || `something in the queue repeats every ${Math.min(...fast)}ms`;
});
R("nothing in this territory starts a fast timer it cannot turn off", () => {
  const bad = [];
  for (const [f, src] of Object.entries(FILES)) {
    const c = codeOnly(src);
    const iv = (c.match(/setInterval\(/g) || []).length, cl = (c.match(/clearInterval\(/g) || []).length;
    if (iv > 0 && cl < iv) bad.push(`${f}: ${iv} setInterval, ${cl} clearInterval`);
  }
  return bad.length === 0 || bad.join(" · ");
});
R("a change-detector never scans the table it is guarding", () => {
  // The rule this project learned the hard way (mig 246, a 21.6s "cheap" guard): the thing that
  // notices work must not be the thing that reads all the work.
  const seg = Q.slice(Q.indexOf("pendingKotJobs"), Q.indexOf("pendingKotJobs") + 1400);
  const listsRows = /\.select\("(?!id\b)[^"]{20,}"\)/.test(seg) && !/head:\s*true/.test(seg);
  return !listsRows || "the pile-up detector reads the rows it is counting";
});
R("a write that cannot be confirmed is retried, not assumed", () =>
  /attempts/.test(Q) && /status/.test(Q) || "the queue no longer records how many times a ticket was tried");
R("the generated helper treats a server that is struggling differently from one that refuses", () => {
  // 5xx and a timeout are "come back later"; a 4xx is "this will never work, say so".
  const hasBoth = /5\d\d|500|503|timeout/i.test(SCRIPT) && /4\d\d|400|401|403|404/.test(SCRIPT);
  return hasBoth || "the helper cannot tell a busy server from a refusal, so it either gives up or hammers";
});
R("…and it says so in its own log rather than only on somebody's screen", () =>
  /log|Log|>>/.test(SCRIPT) || "the helper writes nothing a person at the machine can read");
R("…and the station script does too", () =>
  /log|Log|>>/.test(STATION) || "the station script writes nothing a person at the machine can read");
R("a helper that is switched off mid-job leaves the ticket claimable again rather than lost", () =>
  /claimed_at/.test(Q) || "nothing records when a ticket was claimed, so an abandoned one cannot be recovered");
R("…and the queue can tell a ticket being printed from one waiting", () =>
  /"printing"/.test(Q) && /"queued"/.test(Q) || "the two states are no longer distinguished");
R("the admin's own printing screen reads everything it needs in ONE set of queries", () => {
  const board = codeOnly(read("lib/printBoard.ts"));
  const sel = (board.match(/\.select\(/g) || []).length;
  return sel <= 6 || `the board fires ${sel} reads to draw one screen`;
});
R("…and it is not the thing a helper polls, so a hundred machines cannot slow one admin screen", () => {
  const board = read("lib/printBoard.ts");
  return !/print-agent/.test(board) || "the admin board sits on the helper's own polling path";
});
R("no read in this territory asks for a whole table's history to show a recent list", () => {
  // A CEILING IS JUDGED BY WHOSE ROWS IT TAKES. A per-restaurant list a person reads must be
  // short. The admin's cross-restaurant overview is one row per RESTAURANT, so its ceiling is the
  // number of restaurants, and 400 is the right order of magnitude — reading a flat 200 across
  // both kinds called five deliberate ceilings faults.
  const bad = [];
  for (const s of reads) {
    const lim = /\.limit\((\d+)\)/.exec(s.stmt);
    if (!lim) continue;
    const cap = Number(lim[1]);
    /* A LIST A PERSON READS vs A SAFETY CEILING. The two are not the same thing and must not be
       held to the same number. A list somebody scrolls is ordered by date and handed to a screen
       — it has to be short. A ceiling sits on a KEYED lookup (`.in(ids)` where the ids are already
       bounded) or on a set the code folds into a Set, a Map or a count: 400 there is not a page,
       it is a "this cannot be right" bound, and calling it a fault named three deliberate ones. */
    /* WHICH TABLES CAN GROW WITHOUT BOUND. That is the question underneath all of this. print_jobs
       and printer_events grow with the business for ever, so a read of them must take a screenful.
       print_agents and staff_users are REGISTRIES — a restaurant has as many computers and staff as
       it has, and 200 or 500 is a "this cannot be right" bound on a set that is small in reality,
       not a page somebody scrolls. Holding a registry to a screenful named two deliberate ceilings
       as faults, which is how a guard about cost teaches people to ignore guards about cost. */
    const GROWS_FOREVER = new Set(["print_jobs", "printer_events", "orders", "sessions", "bills"]);
    const keyed = /\.in\(/.test(s.stmt);
    const growing = GROWS_FOREVER.has(s.table);
    const ceiling = ADMIN_WIDE(s) || keyed ? 2000 : (growing ? 100 : 600);
    if (cap > ceiling) bad.push(`${s.file}:${s.line} takes ${cap} rows of ${s.table} (a ${growing ? "table that grows for ever" : "registry"} read like this should not exceed ${ceiling})`);
  }
  return bad.length === 0 || bad.join(" · ");
});
R("…and a capped list a PERSON reads says which rows it took", () => {
  // Only where the order is what a person sees. A capped read the code folds into a count or a
  // lookup map has no "first" — demanding .order() on those named five reads whose order cannot
  // matter, which is how a guard teaches people to ignore it.
  const bad = reads.filter((s) => /\.limit\(/.test(s.stmt) && !/\.order\(/.test(s.stmt) && !isSingle(s)
      && !/head:\s*true|count:/.test(s.stmt) && /recent|history|events|list/i.test(s.stmt))
    .map((s) => `${s.file}:${s.line} caps ${s.table} without saying which rows`);
  return bad.length === 0 || bad.join(" · ");
});
R("a printer problem is recorded when it is reported or resolved, never once per ticket", () => {
  const perJob = /finishKotJob[\s\S]{0,1200}printer_events[\s\S]{0,150}\.insert/.test(Q);
  return !perJob || "an event row is written for every successful ticket — the table grows with the business";
});
R("…and resolving one narrows to the printer that was named, not to every complaint at once", () =>
  /\.eq\("printer"/.test(Q) || "resolving one printer problem closes them all");
R("the document is fetched SEPARATELY from the claim, so being offered work is cheap", () => {
  const seg = AG.slice(AG.indexOf('seg[0] === "next"'), AG.indexOf('seg[0] === "next"') + 900);
  return !/billDocHtml|kotHtmlForOrder|banquetHtmlForBill/.test(seg) || "every poll draws a document nobody may print";
});
R("…and the answer to a claim is small enough to be worth polling for", () => {
  const seg = AG.slice(AG.indexOf('seg[0] === "next"'), AG.indexOf('seg[0] === "next"') + 900);
  const fields = (seg.match(/\w+:/g) || []).length;
  return fields <= 14 || `the offer carries ${fields} fields`;
});
/* ── AND EIGHTEEN MORE: THE WRITES, THE HELPER'S OWN MANNERS, AND WHAT GROWS FOR EVER ────── */
const writes = statements.filter((x) => /\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(x.stmt));
R("every WRITE in this territory names the restaurant it belongs to", () => {
  const bad = writes.filter((x) => !/\.eq\("restaurant_id"|restaurant_id:/.test(x.stmt) && !/\.eq\("id",/.test(x.stmt))
    .map((x) => `${x.file}:${x.line} writes ${x.table} unscoped`);
  return bad.length === 0 || bad.join(" · ");
});
R("…and no write in it touches more than one restaurant's rows in one statement", () => {
  const bad = writes.filter((x) => /\.in\("restaurant_id"|\.neq\("restaurant_id"/.test(x.stmt))
    .map((x) => `${x.file}:${x.line}`);
  return bad.length === 0 || bad.join(" · ");
});
R("no read in this territory pulls another table's whole rows alongside its own", () => {
  const bad = reads.filter((x) => /\.select\([^)]*\w+\s*\(\s*\*/.test(x.stmt))
    .map((x) => `${x.file}:${x.line} joins with *`);
  return bad.length === 0 || bad.join(" · ");
});
R("…and none of them takes a page by .range() wider than a screen", () => {
  const bad = [];
  for (const x of reads) {
    const m = /\.range\((\d+),\s*(\d+)\)/.exec(x.stmt);
    if (m && Number(m[2]) - Number(m[1]) > 200) bad.push(`${x.file}:${x.line} takes ${Number(m[2]) - Number(m[1]) + 1} rows`);
  }
  return bad.length === 0 || bad.join(" · ");
});
R("…and none counts a whole table without naming a restaurant", () => {
  const bad = reads.filter((x) => /head:\s*true/.test(x.stmt) && !/\.eq\("restaurant_id"/.test(x.stmt))
    .map((x) => `${x.file}:${x.line} counts all of ${x.table}`);
  return bad.length === 0 || bad.join(" · ");
});
R("the generated helper waits LONGER after a failure than after an empty poll", () => {
  // Otherwise a server that is struggling is asked at full speed by every machine at once, which
  // is how a slow moment becomes an outage. This project's rule: 5xx is treated like offline.
  const waits = [...SCRIPT.matchAll(/sleep\s+(\d+)|Start-Sleep[^\d]*(\d+)|timeout\s*\/t\s*(\d+)/gi)]
    .map((m) => Number(m[1] || m[2] || m[3])).filter((n) => n > 0);
  const uniq = [...new Set(waits)].sort((a, b) => a - b);
  return uniq.length >= 2 || `it waits the same ${uniq[0]}s whatever happened`;
});
R("…and no restaurant runs enough helpers for their ticks to matter", () => {
  /* WHAT THIS IS AND IS NOT. There is no jitter in the generated helper, so two machines started
     together poll on the same tick. Jitter matters when there are MANY pollers; the address book
     allows one computer per kind of paper, and the real installations run one machine. Asserting
     "there must be jitter" would have been this bank inventing a rule for a scale the product
     does not have — and the fix would be an untestable change to the Windows half.
     So the row asserts the thing that WOULD make it matter: that nothing in this territory
     encourages a restaurant to run a crowd of helpers against one queue. */
  const c = codeOnly(FILES["lib/printHelpers.ts"]);
  const oneEach = /clash|already in use|each computer needs its own/i.test(FILES["app/api/print-agent/[...path]/route.ts"]);
  const oneRoute = /agent[\s\S]{0,80}printer/.test(c);
  return (oneEach && oneRoute) || `a second machine on one code is warned: ${oneEach}; a kind of paper names one machine: ${oneRoute}`;
});
R("…and every request it makes has a deadline, so a hung server does not hang the printer", () =>
  /--max-time|-m\s+\d|TimeoutSec|ConnectTimeout|timeout/i.test(SCRIPT)
  || "a request with no deadline can leave a helper waiting for ever with paper in the queue");
R("…and a refusal it can never fix does not become an endless retry", () =>
  /401|not valid any more|exit/i.test(SCRIPT) || "a dead code is retried for ever, every two seconds");
R("…and its own log cannot grow until it fills the disk", () =>
  /tail|Select-Object -Last|truncat|rotate|>\s*"?\$LOG"?\s*$|head -c/im.test(SCRIPT)
  || "the helper's log only ever grows — on a machine nobody looks at");
R("the station script waits between turns of its loop too", () => {
  const waits = [...STATION.matchAll(/sleep\s+(\d+)|Start-Sleep[^\d]*(\d+)|timeout\s*\/t\s*(\d+)/gi)]
    .map((m) => Number(m[1] || m[2] || m[3])).filter((n) => n > 0);
  return waits.length > 0 || "the station script's loop has no wait in it at all";
});
R("…and it does not start a second copy of itself on top of a running one", () =>
  /pidfile|\.pid|lock|pgrep|tasklist/i.test(STATION) || "nothing stops two copies printing the same paper");
R("the recent-prints list a person reads is capped", () => {
  // LOOK AT THE QUERY. The first version searched from the first appearance of the word "recent",
  // which is the TYPE DECLARATION fifty lines above the read — so it judged a perfectly capped
  // query by looking at a line that is not one.
  const c = codeOnly(read("lib/printBoard.ts"));
  const q = /\.from\("print_jobs"\)[\s\S]{0,400}?;/.exec(c);
  if (!q) return "the board no longer reads the printed tickets at all";
  const lim = /\.limit\(([^)]*)\)/.exec(q[0]);
  if (!lim) return "the 'what has printed' list grows with the restaurant's whole history";
  const n = Number((/(\d+)/.exec(lim[1]) || [])[1]);
  return (/Math\.min/.test(lim[1]) || (Number.isFinite(n) && n <= 100))
    || `it takes ${lim[1]} rows`;
});
R("…and so is the printer-problem list", () => {
  const c = codeOnly(FILES["lib/printHelpers.ts"] + FILES["lib/printBoard.ts"]);
  const qs = [...c.matchAll(/\.from\("printer_events"\)[\s\S]{0,400}?;/g)].map((m) => m[0]).filter((x) => /\.select\(/.test(x));
  const bad = qs.filter((x) => !/\.limit\(|head:\s*true|maybeSingle\(\)/.test(x));
  return (qs.length === 0 || bad.length === 0) || `${bad.length} uncapped read(s) of every problem a restaurant ever had`;
});
R("the pile-up threshold is written down once, not repeated at each place that reads it", () => {
  const c = Q + codeOnly(FILES["lib/printBoard.ts"]);
  const named = /const\s+[A-Z_]*(?:SLOW|LATE|PILE|BACKLOG)[A-Z_]*\s*=/.test(c);
  return named || "the number that decides 'too long' is a literal, in more than one place";
});
R("the admin board does not read the database on every keystroke", () => {
  const page = read("app/aevinite/printing/page.tsx");
  const c = codeOnly(page);
  const onEveryKey = /onChange=\{[^}]{0,80}\b(?:load|refresh|fetchState)\(/.test(c);
  return !onEveryKey || "typing on the printing screen fires a read per character";
});
R("…and its refresh is slow enough to be watched without costing anything", () => {
  // 10s is the screen a person is LOOKING AT while they set a printer up, and the row below shows
  // it stops entirely when the tab is hidden. Demanding 15s was a number this bank invented.
  const c = codeOnly(read("app/aevinite/printing/page.tsx"));
  const ivs = [...c.matchAll(/setInterval\([^,]+,\s*(\d+)/g)].map((m) => Number(m[1]));
  const fast = ivs.filter((n) => n < 5000);
  return fast.length === 0 || `it refreshes itself every ${Math.min(...fast)}ms with a person just watching`;
});
R("…and nothing on it polls while the tab is hidden", () => {
  const c = codeOnly(read("app/aevinite/printing/page.tsx"));
  const ivs = [...c.matchAll(/setInterval\(/g)].length;
  return ivs === 0 || /document\.hidden|visibilitychange|hidden/.test(c)
    || "it keeps asking the database with nobody looking at it";
});

/* THE FINAL CUT OF THE 500. Three banks came out bigger than the plan, and the PLAN moved rather
   than the checks — a bank that deletes real questions to hit a round number reports a number, not
   work. Every id is inside the block this terminal claimed on INDEX.md and landed on `main` before
   a single row was written:
       J  P101095–P101234  140   the queue and the helper's door, DRIVEN end to end
       K  P101235–P101306   72   the admin Printing screen's actions
       L  P101307–P101378   72   the generated station + helper scripts as programs
       M  P101379–P101491  113   this bank — 34 reads, 32 writes, 47 about a rush
       N  P101492–P101594  103   every exported function of billdoc.js
   = 500. */
if (id - 1 !== 101491) throw new Error(`bank M ended at P${id - 1}, not P101491 — it has ${id - 1 - 101378} rows (${reads.length} reads, ${writeStmts.length} writes, and the rush rows)`);
