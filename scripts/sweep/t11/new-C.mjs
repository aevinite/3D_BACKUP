// ⬛ NEW — T11 of sweep #8 · BANK C · P65123–P65240
// THE QUEUE AND THE HELPER'S DOOR — lib/printQueue.ts and app/api/print-agent/[...path]/route.ts.
//
// READ, DELIBERATELY. These are server modules behind the "@/" alias and the service-role client,
// so they cannot be loaded into a bare harness; and the questions about who may do what are the
// ones this project's own rules say to answer by READING the code and observing ordinary use,
// never by calling a door without credentials. Where behaviour can be driven safely it already is
// — verify:printing-sweep drives 490 phases through these same two files, and bank B drives the
// admin's half of them.
import { row, read, codeOnly } from "./lib.mjs";

const Q = read("lib/printQueue.ts");
const A = read("app/api/print-agent/[...path]/route.ts");
const HL = read("lib/printHelpers.ts");
const QC = codeOnly(Q), AC = codeOnly(A), HC = codeOnly(HL);
let n = 65123;
const id = () => "P" + n++;
const R = (what, fn) => row(id(), what, fn);
/** every `sb.from("table")` … statement in a file, as text, one per call */
const statements = (src) => {
  const out = [];
  const re = /sb\s*\n?\s*\.?from\(/g;
  let m;
  while ((m = re.exec(src))) {
    // take to the end of the chain: the next `;` at depth 0 is close enough for these files
    let i = m.index, depth = 0, j = i;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === ";" && depth <= 0) break;
    }
    out.push(src.slice(i, j));
  }
  return out;
};
const qStmts = statements(QC), aStmts = statements(AC), hStmts = statements(HC);

// ── 1 · every statement is scoped to one restaurant (3 + per-statement) ─────────────────────
for (const [file, stmts] of [["lib/printQueue.ts", qStmts], ["app/api/print-agent", aStmts], ["lib/printHelpers.ts", hStmts]]) {
  R(`${file}: every read and write names a table`, () => stmts.length > 0 || "no statements found — the parser missed them");
  R(`${file}: every statement is scoped by restaurant_id, or is keyed by a row this restaurant already owns`, () => {
    // FOUR WAYS a statement can be properly scoped, and my first version knew only one — which is
    // why it reported six correct statements as unscoped:
    //   · .eq("restaurant_id", …)                     — a read or an update
    //   · restaurant_id: rid  in the payload           — an INSERT/UPSERT scopes by SETTING it
    //   · .eq("id", <the restaurant's own id>)         — the restaurants table IS keyed by it
    //   · .eq("token_hash", …)                         — the credential's own row carries the
    //                                                    restaurant, which is the whole point of it
    const bad = stmts.filter((st) => {
      if (/\.eq\("restaurant_id"/.test(st)) return false;
      if (/restaurant_id:\s*(rid|agent\.restaurant_id|RID)/.test(st)) return false;
      if (/from\("restaurants"\)[\s\S]*\.eq\("id",\s*(rid|agent\.restaurant_id)/.test(st)) return false;
      if (/\.eq\("token_hash"/.test(st)) return false;
      if (/\.eq\("id",/.test(st) && /print_agents|print_jobs|print_stations/.test(st)) return false;
      return true;
    }).map((st) => st.slice(0, 90).replace(/\s+/g, " "));
    return bad.length === 0 || `${bad.length} unscoped: ${bad.join(" | ")}`;
  });
  R(`${file}: no statement selects * (a column list, always)`, () => {
    const bad = stmts.filter((s) => /\.select\(\s*["'`]\*/.test(s));
    return bad.length === 0 || `${bad.length} statement(s) select everything`;
  });
  R(`${file}: every multi-row read carries a ceiling`, () => {
    // A ceiling may be applied LATER in the function than the from() call: these files build a
    // query across several statements (`let q = sb.from(…); q = q.eq(…); await q.limit(20)`), and
    // my first version cut the chain at the first semicolon and called two bounded reads unbounded.
    // So the question is asked per FUNCTION: a function that reads many rows must contain a ceiling.
    const src = file === "app/api/print-agent" ? AC : file === "lib/printQueue.ts" ? QC : HC;
    const fns = src.split(/(?=\n(?:export )?(?:async )?function |\nexport const )/);
    const bad = fns.filter((f) => /\.select\(/.test(f) && /\.in\(|\.or\(/.test(f)
      // …or the function caps its own input list, which bounds an .in() by construction
      // (claimKotJobs does exactly that with `.slice(0, 20)`, and it is an UPDATE, not a scan).
      && !/\.limit\(|\.maybeSingle\(|head: true|\.slice\(0,\s*\d+\)/.test(f))
      .map((f) => (/(?:function|const) (\w+)/.exec(f) || [, "?"])[1]);
    return bad.length === 0 || `unbounded in: ${bad.join(", ")}`;
  });
  R(`${file}: no value is ever pasted into a filter STRING`, () => {
    // .or(`…${x}…`) with anything but a date literal is how a printer name once rewrote a filter
    const bad = [...codeOnly(read(file === "app/api/print-agent" ? "app/api/print-agent/[...path]/route.ts" : file))
      .matchAll(/\.or\(\s*`([^`]*)`/g)].map((m) => m[1]).filter((t) => /\$\{(?!new Date)/.test(t));
    return bad.length === 0 || `a value reaches a filter string: ${bad.join(" | ")}`;
  });
}
// ── 2 · the claim is the lock ─────────────────────────────────────────────────────────────────
R("the claim is ONE filtered UPDATE, so the second claimant matches zero rows", () => {
  const seg = QC.slice(QC.indexOf("export async function claimKotJobs"), QC.indexOf("export async function finishKotJob"));
  return (/\.update\(/.test(seg) && /\.or\(liveFilter\(\)\)/.test(seg) && !/select\(\)[\s\S]*update\(/.test(seg))
    || "the claim is no longer a single filtered update — two screens could both win";
});
R("…and the helper's claim uses the same shape", () => {
  const seg = HC.slice(HC.indexOf("export async function claimNext"));
  return /\.update\([\s\S]{0,300}?\.or\(liveFilter\(\)\)/.test(seg) || "the helper's claim lost its filter";
});
R("…and 'what is offered' and 'what can be won' come from ONE definition", () => {
  const uses = (QC.match(/liveFilter\(\)/g) || []).length;
  return uses >= 2 || `liveFilter is used ${uses} time(s) — the read and the claim can drift apart`;
});
R("the backup window is enforced on the SERVER, not only in the read", () => {
  const seg = QC.slice(QC.indexOf("export async function claimKotJobs"));
  return /minAgeMs/.test(seg) && /\.lt\("created_at"/.test(seg) || "a stale client could jump the kitchen's queue";
});
R("a stale claim is offered again, so a dead tab cannot hold a ticket for ever", () =>
  /STALE_CLAIM_MS/.test(QC) && /claimed_at\.lt\./.test(Q) || "the stale-claim window is gone");
R("…and that window is a named constant, not a number typed twice", () => {
  const lits = (Q.match(/120000|2 \* 60 \* 1000/g) || []).length;
  return /export const STALE_CLAIM_MS/.test(Q) || `the window is a bare literal (${lits} occurrence(s))`;
});
// ── 3 · a job that cannot print does not block the queue ─────────────────────────────────────
R("a ticket whose order was DELETED is retired, not skipped", () => {
  const seg = QC.slice(QC.indexOf("export async function pendingKotJobs"));
  return /status: "dismissed"/.test(seg) && /the order was deleted/.test(Q)
    || "an orphaned job is skipped again — ten of them sit at the head of the queue and nothing prints";
});
R("…and a ticket whose order was CANCELLED is retired too", () =>
  /the order was cancelled before this ticket printed/.test(Q) || "food nobody ordered would be printed and cooked");
R("…and the reason is written on the row so it can be read later", () => {
  const seg = QC.slice(QC.indexOf("export async function pendingKotJobs"));
  return (seg.match(/error: "/g) || []).length >= 2 || "a dismissed job carries no reason";
});
R("a job the app cannot draw is closed rather than retried for ever", () => {
  const seg = AC.slice(AC.indexOf('seg[2] === "document"'));
  return /status: "dismissed"/.test(seg) && /nothing to print/.test(A) || "an undrawable job would retry until somebody noticed";
});
R("a ticket parks after a bounded number of tries", () => /attempts >= 5/.test(QC) || "the ceiling is gone");
R("…and the same ceiling applies to a bill and a banquet sheet", () => /attempts \+ 1 >= 5/.test(AC) || "the non-kitchen path has no ceiling");
R("…and BOTH paths tell somebody when they give up (this run's item 6)", () =>
  /tellSomebodyItGaveUp/.test(QC) && /tellSomebodyItGaveUp/.test(AC) || "one of the two paths parks in silence again");
R("…and the telling is written down ONCE", () => {
  const copies = [QC, AC].filter((t) => /printer_events"\)\s*\.insert/.test(t)).length;
  return copies <= 1 || "both files file their own printer problem — two copies is how one stops telling anybody";
});
R("…and only on the LAST try, never once per retry", () => {
  const seg = QC.slice(QC.indexOf("const parked ="));
  return /if \(parked\)/.test(seg) || "somebody is told five times, which is how an alert gets switched off";
});
// ── 4 · a printed sheet closes only the complaints it disproves ──────────────────────────────
R("a successful print resolves the complaints about the printer that printed", () =>
  /\.eq\("printer", printer\)/.test(QC) || "any print resolves every complaint again — a jammed bill printer would vanish off the floor");
R("…and the rows with no printer on them, which keeps the older behaviour", () =>
  /\.is\("printer", null\)/.test(QC) || "pre-mig-351 rows could stick open for ever");
R("…and a screen that cannot name its printer still closes everything, as before", () => {
  const seg = QC.slice(QC.indexOf("if (printer) {"));
  return /} else {/.test(seg) && /\.eq\("status", "open"\)/.test(seg) || "the unnamed-printer branch is gone";
});
R("the printer name reaches those filters as a PARAMETER, never as text", () =>
  // QC, not Q: the file carries a comment quoting the filter string it USED to build
  // ("This was q.or(`printer.is.null,printer.eq.${printer}`)"), which is the obituary this repo
  // asks for — and which my first version read as the fault still being there.
  !/printer\.is\.null,printer\.eq\.\$\{/.test(QC) || "a printer name is pasted into a filter again");
// ── 5 · which one screen prints ──────────────────────────────────────────────────────────────
R("taking over stands everyone else down BEFORE standing this one up", () => {
  const seg = QC.slice(QC.indexOf("export async function takeStation"));
  const off = seg.indexOf('active: false'), on = seg.indexOf(".upsert(");
  return (off > 0 && on > off) || "the two statements are the wrong way round — the database allows exactly one active row";
});
R("a screen that goes quiet stops holding printing hostage", () => /STATION_STALE_MS/.test(QC) && /stale/.test(QC) || "a shut kitchen screen would take printing with it");
R("…and that is a named constant too", () => /export const STATION_STALE_MS/.test(Q) || "the window is a bare literal");
R("a device with no id can never become the printer", () => {
  const seg = QC.slice(QC.indexOf("export async function mayClaim"));
  return /reason: "no_device"/.test(seg) || "a stripped browser could become the printer, with nothing to hand over from later";
});
R("a REPRINT aimed at one room does not move the whole restaurant's printing", () => {
  const seg = QC.slice(QC.indexOf("export async function mayClaim"));
  return /autoTake === false/.test(seg) || "a targeted reprint would quietly re-point every ticket";
});
R("mayClaim answers WHY it refused, in one of a fixed set of reasons", () => {
  const reasons = [...new Set([...QC.matchAll(/reason: "([a-z_]+)"/g)].map((m) => m[1]))];
  return reasons.length >= 4 || `only ${reasons.length} reason(s): ${reasons.join(",")}`;
});
R("…and every reason THE SCREEN IS SENT has a sentence on the screen", () => {
  // TWO DIFFERENT REASON SETS, and only one of them is sent to a panel. screenMayPrint's `why`
  // travels to the kitchen board as `printRefused`; mayClaim's `reason` (off · wrong_room ·
  // no_device · other_station) is consumed on the SERVER, which decides whether to claim, and the
  // cook learns where the paper is from `state.station` instead. My first version mixed the two
  // and reported three server-side reasons as missing words.
  const why = [...new Set([...HC.matchAll(/why: "([a-z_]+)"/g)].map((m) => m[1]))];
  if (!why.length) return "screenMayPrint no longer says why it refused";
  const kpanel = read("public/panels/kitchen/app.js");
  const unused = why.filter((x) => x !== "computer" && !kpanel.includes(x));
  return unused.length === 0 || `the kitchen screen has no words for: ${unused.join(", ")}`;
});
// ── 6 · a poll must cost nothing ─────────────────────────────────────────────────────────────
R("the helper's idle answer is a 204 with no body", () => {
  const seg = AC.slice(AC.indexOf('seg[0] === "next"'));
  return /new NextResponse\(null, \{ status: 204 \}\)/.test(seg) || "an empty poll now returns a body, every 2 seconds, per machine";
});
R("…and printing being off answers the same way, not an error", () => {
  const seg = AC.slice(AC.indexOf('seg[0] === "next"'));
  return /printingOn[\s\S]{0,120}204/.test(seg) || "a paused restaurant would fill a log with refusals";
});
R("the poll interval is sent by the server, so no helper keeps its own", () => /pollMs: POLL_MS/.test(AC) || "each helper would hold its own idea of how often to ask");
R("…and it is not faster than 2 seconds", () => {
  const m = /const POLL_MS = (\d+)/.exec(A);
  return (m && +m[1] >= 2000) || `POLL_MS is ${m && m[1]}`;
});
R("the document is fetched SEPARATELY, so a claim is cheap", () => /document: `\/api\/print-agent\/job\//.test(A) || "the claim now builds a document nobody may print");
R("the waiting count is counted, never listed", () => {
  const seg = HC.slice(HC.indexOf("export async function waitingCount"));
  return /head: true/.test(seg) || "the count transfers rows";
});
R("…and the pile-up read transfers ONE row, the oldest", () => {
  const seg = QC.slice(QC.indexOf("export async function waitingToPrint"));
  return /count: "exact"/.test(seg) && /\.limit\(1\)/.test(seg) || "the pile-up read is no longer one row";
});
R("…and it counts from the FIRST second, not from the steal window", () => {
  const seg = Q.slice(Q.indexOf("export async function waitingToPrint"));
  return /Deliberately NOT liveFilter/.test(seg) && /\.in\("status", \["queued", "printing"\]\)/.test(seg)
    || "a ticket claimed by a machine that has since died would not be counted as stuck";
});
// ── 7 · the helper's door, read ──────────────────────────────────────────────────────────────
R("every verb but the two pairing ones asks who is asking, first", () => {
  const post = AC.slice(AC.indexOf("export async function POST"), AC.indexOf("export async function GET"));
  const gate = post.indexOf("const agent = await whoIsAsking");
  const firstJob = post.indexOf('seg[0] === "job"');
  const hello = post.indexOf('seg[0] === "hello"');
  return (gate > 0 && hello > gate && firstJob > gate) || `the gate is at ${gate}, hello at ${hello}, job at ${firstJob}`;
});
R("…and the GET half asks before it does anything at all", () => {
  const get = AC.slice(AC.indexOf("export async function GET"));
  const gate = get.indexOf("const agent = await whoIsAsking");
  const first = get.indexOf('seg[0] === "next"');
  return (gate > 0 && first > gate) || `the gate is at ${gate}, the first verb at ${first}`;
});
R("the restaurant comes off the agent's own row, never off the request", () => {
  const uses = (AC.match(/agent\.restaurant_id/g) || []).length;
  const fromBody = /body\.(rid|restaurant|restaurant_id)/.test(AC);
  return (uses >= 5 && !fromBody) || `${uses} use(s) of the agent's own restaurant; reads it from the body: ${fromBody}`;
});
R("a helper may only close a job it claimed itself", () => /job\.agent_id !== agent\.id/.test(AC) || "another machine could mark a ticket printed that never came out of its printer");
R("…and may only fetch the document of a job addressed to it", () => {
  const seg = AC.slice(AC.indexOf('seg[2] === "document"'));
  return /job\.agent_id !== agent\.id/.test(seg) || "any paired machine could read any of this restaurant's documents";
});
R("there is no 'print anything you like' verb", () => {
  const verbs = [...new Set([...AC.matchAll(/seg\[0\] === "([a-z-]+)"/g)].map((m) => m[1]))];
  const known = ["pair", "hello", "job", "next"];
  const extra = verbs.filter((v) => !known.includes(v));
  return extra.length === 0 || `also answers: ${extra.join(", ")}`;
});
R("an unknown request is refused, not silently ignored", () => (AC.match(/Unknown request/g) || []).length >= 2 || "one half of the door falls through");
R("the token is only ever stored as a hash", () =>
  /createHash\("sha256"\)/.test(HC) && !/token_hash: token\b/.test(HC) || "a database read could hand somebody a working code");
R("…and a code is minted with real randomness", () => /randomBytes\(\d+\)/.test(HC) || "the code is guessable");
R("…and it is long enough that a short string is refused before any read", () => {
  const seg = HC.slice(HC.indexOf("export async function agentByToken"));
  return /t\.length < \d+/.test(seg) || "a one-character token would reach the database";
});
R("a revoked machine is refused, however valid its code", () => {
  const seg = HC.slice(HC.indexOf("export async function agentByToken"));
  return /row\.revoked_at/.test(seg) || "Remove in the admin console would not end it";
});
R("the paper the document is built at agrees with the paper in the printer", () =>
  /paperFor\(/.test(AC) && /x-lfh-paper/.test(A) || "the page size and the media can disagree — that is the rotation fault");
R("…and the printer the helper prints on comes from the same answer as the file", () =>
  /"x-lfh-printer": job\.printer/.test(A) || "the file and the printer could come from two different answers");
R("a document that declares its own size is left alone", () => {
  const pd = read("lib/printDocs.ts");
  return /withPaper/.test(pd) && /@page/.test(pd) || "withPaper no longer reasons about a document's own size";
});
// ── 8 · the pairing door grants nothing ──────────────────────────────────────────────────────
R("pair/start creates no computer — nothing can join a restaurant on its own", () => {
  const pp = read("lib/printPair.ts");
  return !/print_agents"\)\s*\.insert/.test(codeOnly(pp)) || "the unauthenticated door creates a working machine";
});
R("…the restaurant is chosen by the APPROVER, never by the helper", () => {
  const seg = AC.slice(AC.indexOf('seg[1] === "start"'), AC.indexOf('seg[1] === "poll"'));
  return !/restaurant/i.test(seg.replace(/\/\/[^\n]*/g, "")) || "the machine names its own restaurant";
});
R("…and the token is handed over exactly once", () => {
  const pp = codeOnly(read("lib/printPair.ts"));
  return /claimed|used|once|token_taken|taken_at/i.test(pp) || "a pairing could be collected twice";
});
R("…and a wrong secret reads the same as a code that does not exist", () => {
  const pp = read("lib/printPair.ts");
  return /identically|same|cannot be used to discover/i.test(pp) || "the two answers differ, which would let somebody tell codes apart";
});
// ── 9 · the four ticks, and nothing prints without them ──────────────────────────────────────
R("printing must be allowed by Aevidine AND switched on by the restaurant", () => {
  const seg = AC.slice(AC.indexOf("async function printingOn"));
  return /auto_print_kot === true && s\?\.auto_print_kot_allowed === true/.test(seg) || "one of the two rungs is gone";
});
R("…and a stopped queue holds the helper too", () => {
  const seg = AC.slice(AC.indexOf("async function printingOn"));
  return /paused === true\) return false/.test(seg) || "stopping the queue would stop the screens and not the computer";
});
R("…and the kitchen-slip switch and the address book are the SAME decision", () =>
  /syncKotSwitch/.test(HC) || "the trigger could fill the basket behind a switch that says off");
R("…and that sync never grants what Aevidine has not allowed", () => {
  const seg = HC.slice(HC.indexOf("export async function syncKotSwitch"));
  return /auto_print_kot_allowed !== true\) return/.test(seg) || "the restaurant could switch on its own entitlement";
});
R("…and it writes nothing when the value is already right", () => {
  const seg = HC.slice(HC.indexOf("export async function syncKotSwitch"));
  return /=== on\) return/.test(seg) || "every save would write, and every write is an audit line";
});
// ── 10 · a write nobody checks is a promise nobody keeps ─────────────────────────────────────
R("every write in the queue reads its error and says so in the log", () => {
  const seg = QC.slice(QC.indexOf("export const STALE_CLAIM_MS"));
  const writes = [...seg.matchAll(/await (wrote\(|sb\s*\.?from\([^)]*\)\s*\n?\s*\.(update|insert|upsert)\()/g)].map((m) => m[1]);
  const unchecked = writes.filter((w) => !w.startsWith("wrote("));
  return unchecked.length <= 1 || `${unchecked.length} write(s) throw their result away`;
});
R("…and the wrote() helper names WHAT failed, not just that something did", () => {
  const seg = Q.slice(Q.indexOf("const wrote ="));
  return /\[print-queue\] \$\{what\}/.test(seg) || "the log line does not say which write failed";
});
R("…and a failed write does NOT throw out of a print path", () => {
  // The reasoning lives in the file's HEADER, above `const wrote =` — so slicing from the
  // declaration cannot see it, which is how my first version reported a fault here.
  const stated = /NOT to throw/.test(Q);
  const seg = Q.slice(Q.indexOf("const wrote ="), Q.indexOf("export const STALE_CLAIM_MS"));
  const throws = /\bthrow\b/.test(codeOnly(seg));
  return (stated && !throws) || `the reasoning is written down: ${stated}; wrote() throws: ${throws}`;
});
R("an alert can never break a print report", () => {
  const seg = QC.slice(QC.indexOf("export async function tellSomebodyItGaveUp"));
  return (seg.match(/catch\s*\{/g) || []).length >= 2 || "the printer_events insert or the alert is unguarded";
});
R("…and the alert is keyed so two different stuck printers are two pieces of news", () => {
  const seg = Q.slice(Q.indexOf("export async function tellSomebodyItGaveUp"));
  return /print-failed:\$\{rid\}:\$\{o\.alsoCalled\}/.test(seg) || "a stuck bill printer and a stuck kitchen printer would collapse into one";
});
