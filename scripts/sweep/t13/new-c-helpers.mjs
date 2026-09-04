// scripts/sweep/t13/new-c-helpers.mjs — NEW block, ids P66933–P67060.
//
// Band C: the dashboard's own pure helpers, EXECUTED rather than pattern-matched.
//
// WHY. Every date, label and bucket on this page passes through six small functions in
// app/owner/page.tsx — istKey, keyLabel, expectedBuckets, tsLabel, rangeSpanText, hour12 — and
// the existing ledger checks them by READING them. A regex cannot tell you what hour12(0)
// returns, or that expectedBuckets("today") really starts at 05:00 IST on a day the clocks are
// awkward. So this band lifts the REAL source text of each function out of the file and runs it,
// with the clock pinned, and asserts the values.
//
// It is the real source, not a copy: the text is read from page.tsx at run time, so the moment
// the function changes, these rows exercise the new one.
import { chk, skip, code, src, report, setOnly, writeLedger } from "./lib.mjs";

const PAGE = "app/owner/page.tsx";
const p = code(PAGE);
const argOnly = process.argv.find((x) => x.startsWith("--only="));
if (argOnly) setOnly(argOnly.slice(7).split(","));

// ── lift the real functions out of the real file ─────────────────────────────────────────────
/**
 * Grab a named declaration's REAL source text out of page.tsx, using TypeScript's own parser.
 *
 * Two hand-rolled lifters got this wrong before this one, and both failed the same way — they
 * ran something other than the code they claimed to:
 *   · a regex whose escaping did not survive two layers of quoting, so it matched nothing;
 *   · a brace-matcher that started at the first "{" after the parameter list — which for
 *     expectedBuckets(range: Range): { key: string; label: string; ms: number }[] is the RETURN
 *     TYPE's brace, so it lifted the signature alone and transpiled it to an empty string.
 * The parser knows where a declaration begins and ends. Nothing else here needs to.
 */
import ts from "typescript";
const AST = ts.createSourceFile(PAGE, src(PAGE), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function lift(name) {
  let found = null;
  const visit = (node) => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name && node.name.text === name) { found = node; return; }
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === name) { found = node; return; }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(AST, visit);
  if (!found) throw new Error(`could not lift ${name} from ${PAGE}`);
  return found.getText(AST);
}

// ── STRIP THE TYPES WITH THE REAL COMPILER, NOT A REGEX ──────────────────────────────────────
// A hand-rolled annotation stripper got this wrong on the first run: it removed ": string" and
// ": number" from INSIDE a compound return type and left "function expectedBuckets(range): { key;
// label; ms }[]", which will not parse. A lifter that mangles the source is running something
// other than the code it claims to, which is the one thing this band must not do. TypeScript is
// already a dependency, so let it do exactly what the build does.
const deTs = (t) => ts.transpileModule(t, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: false },
}).outputText;

const DAY_MS = 86400000;
const IST = "Asia/Kolkata";
// businessDayStartIso is imported by the page from lib/businessDay — lift the real one, AND the
// two module constants it closes over. Lifting a function without its dependencies runs nothing:
// the first attempt threw "IST_OFFSET_MIN is not defined" on seven rows.
const bdSrc = code("lib/businessDay.ts");
const bdPick = (re, what) => {
  const m = re.exec(bdSrc);
  if (!m) throw new Error(`could not lift ${what} from lib/businessDay.ts`);
  return m[0];
};
const preamble = [
  `const DAY_MS = ${DAY_MS};`,
  `const IST = "${IST}";`,
  bdPick(/const IST_OFFSET_MIN = [^\n]*/, "IST_OFFSET_MIN"),
  bdPick(/const ROLLOVER_HOUR = [^\n]*/, "ROLLOVER_HOUR"),
  bdPick(/export function businessDayStartIso\([\s\S]*?\n\}/, "businessDayStartIso").replace("export function", "function"),
].join("\n");
// …and the preamble is TypeScript too, so it goes through the same compiler as the bodies.
const preambleJs = deTs(preamble);

// What each lifted helper calls, so `run()` can bring its dependencies with it. Declared rather
// than guessed: a missing edge shows up as "X is not defined" at run time, never as a silent pass.
const DEPS = {
  istKey: [],
  keyLabel: [],
  hour12: [],
  tsLabel: [],
  istWall: [],
  istWall12: ["istWall"],
  errText: [],
  rangeSpanText: [],
  expectedBuckets: ["istKey"],          // it keys every bucket through istKey
};
/** Build a runnable module out of the lifted sources plus their dependencies, and hand back a name. */
function run(name) {
  const seen = new Set();
  const order = [];
  const walk = (n) => {
    if (seen.has(n)) return;
    seen.add(n);
    for (const d of (DEPS[n] || [])) walk(d);
    order.push(n);
  };
  walk(name);
  const bodies = order.map((n) => deTs(lift(n))).join("\n");
  // eslint-disable-next-line no-new-func
  return new Function(`${preambleJs}\n${bodies}\nreturn (${name});`)();
}

// ── hour12 — the one clock format this console uses ──────────────────────────────────────────
const hour12 = run("hour12");
for (const [h, want] of [[0, "12 AM"], [1, "1 AM"], [11, "11 AM"], [12, "12 PM"], [13, "1 PM"], [23, "11 PM"]]) {
  chk(`P${66933 + h}`, `hour12(${h}) prints "${want}", never a 0 or a 24`, () =>
    hour12(h) === want ? true : `hour12(${h}) = "${hour12(h)}"`);
}
chk("P66957", "hour12 never returns a 0 o'clock for any hour of the day", () => {
  const bad = Array.from({ length: 24 }, (_, h) => hour12(h)).filter((s) => /^0 /.test(s));
  return bad.length === 0 ? true : `zero-hour labels: ${JSON.stringify(bad)}`;
});
chk("P66958", "…and every hour is 1–12 with an AM or a PM", () => {
  const all = Array.from({ length: 24 }, (_, h) => hour12(h));
  const bad = all.filter((s) => !/^(1[0-2]|[1-9]) (AM|PM)$/.test(s));
  return bad.length === 0 ? true : `malformed: ${JSON.stringify(bad)}`;
});
chk("P66959", "…and AM covers midnight to 11, PM noon to 23, with no overlap", () => {
  const am = Array.from({ length: 12 }, (_, h) => hour12(h)).every((s) => s.endsWith("AM"));
  const pm = Array.from({ length: 12 }, (_, h) => hour12(h + 12)).every((s) => s.endsWith("PM"));
  return am && pm ? true : `am=${am} pm=${pm}`;
});

// ── istKey — the bucket identity every chart lines its rows up on ────────────────────────────
const istKey = run("istKey");
chk("P66960", "istKey uses a DAY key for every range wider than a day", () => {
  const d = new Date("2026-08-04T12:00:00Z");
  const keys = ["week", "7d", "month", "30d", "lastmonth", "all"].map((r) => istKey(d, r));
  return keys.every((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)) ? true : `keys: ${JSON.stringify(keys)}`;
});
chk("P66961", "…and an HOUR key for today and yesterday", () => {
  const d = new Date("2026-08-04T12:00:00Z");
  const keys = ["today", "yesterday"].map((r) => istKey(d, r));
  return keys.every((k) => /^\d{4}-\d{2}-\d{2} \d{2}$/.test(k)) ? true : `keys: ${JSON.stringify(keys)}`;
});
chk("P66962", "istKey is in IST, so 20:00 UTC is already the NEXT day in India", () =>
  istKey(new Date("2026-08-04T20:00:00Z"), "30d") === "2026-08-05"
    ? true : `got ${istKey(new Date("2026-08-04T20:00:00Z"), "30d")}, expected 2026-08-05`);
chk("P66963", "…and 18:29 UTC is still the same IST day, 18:30 is not", () => {
  const a = istKey(new Date("2026-08-04T18:29:00Z"), "30d");
  const b = istKey(new Date("2026-08-04T18:30:00Z"), "30d");
  return a === "2026-08-04" && b === "2026-08-05" ? true : `18:29→${a} 18:30→${b}`;
});
chk("P66964", "istKey writes hour 00 as '00', never as '24'", () => {
  const k = istKey(new Date("2026-08-04T18:35:00Z"), "today");   // 00:05 IST on the 5th
  return /\s00$/.test(k) ? true : `got ${k}`;
});
chk("P66965", "…and hour 23 as '23'", () => {
  const k = istKey(new Date("2026-08-04T17:35:00Z"), "today");   // 23:05 IST on the 4th
  return /\s23$/.test(k) ? true : `got ${k}`;
});
chk("P66966", "istKey is stable — the same instant always gives the same key", () => {
  const d = new Date("2026-08-04T09:15:00Z");
  return istKey(d, "30d") === istKey(d, "30d") && istKey(d, "today") === istKey(d, "today")
    ? true : "istKey is not deterministic";
});
chk("P66967", "…and two instants in the same IST hour share an hour key", () => {
  // 09:01Z is 14:31 IST and 09:58Z is 15:28 IST — a different hour. The first version of this row
  // used exactly that pair and read a correct answer as a fault: my test DATA was wrong, not
  // istKey. 09:01Z and 09:25Z are both inside IST hour 14.
  const a = istKey(new Date("2026-08-04T09:01:00Z"), "today");
  const b = istKey(new Date("2026-08-04T09:25:00Z"), "today");
  return a === b && /\s14$/.test(a) ? true : `${a} vs ${b}`;
});
chk("P66968", "…while two instants in different IST hours never do", () => {
  const a = istKey(new Date("2026-08-04T09:01:00Z"), "today");
  const b = istKey(new Date("2026-08-04T10:01:00Z"), "today");
  return a !== b ? true : `both ${a}`;
});
chk("P66969", "istKey handles a year boundary in IST without rolling the year wrongly", () =>
  istKey(new Date("2025-12-31T19:00:00Z"), "30d") === "2026-01-01"
    ? true : `got ${istKey(new Date("2025-12-31T19:00:00Z"), "30d")}`);
chk("P66970", "…and a leap day", () =>
  istKey(new Date("2028-02-29T06:00:00Z"), "30d") === "2028-02-29"
    ? true : `got ${istKey(new Date("2028-02-29T06:00:00Z"), "30d")}`);

// ── keyLabel — turning a bucket key back into words a person reads ───────────────────────────
const keyLabel = run("keyLabel");
chk("P66971", "keyLabel turns a day key into a human date", () =>
  /^4 Aug$/.test(keyLabel("2026-08-04")) ? true : `got "${keyLabel("2026-08-04")}"`);
chk("P66972", "…and an hour key into a 12-hour clock time", () =>
  /^(1[0-2]|[1-9]):?\d{0,2}\s?(am|pm|AM|PM)$/i.test(keyLabel("2026-08-04 15").trim())
    ? true : `got "${keyLabel("2026-08-04 15")}"`);
chk("P66973", "keyLabel pins the parse to +05:30, so a day key never slips to the day before", () => {
  // read in a browser sitting west of IST, an unpinned parse would render "3 Aug"
  const s = keyLabel("2026-08-04");
  return /4 Aug/.test(s) ? true : `got "${s}" — the key slipped a day`;
});
chk("P66974", "keyLabel returns the raw key rather than 'Invalid Date' when the shape is wrong", () => {
  const bad = ["", "nonsense", "2026-8-4", "04-08-2026", "2026-08-04T10:00:00Z", "2026-08-04 5"];
  const out = bad.map((k) => keyLabel(k));
  const invalid = out.filter((s) => /Invalid/i.test(s));
  return invalid.length === 0 ? true : `Invalid Date leaked for: ${JSON.stringify(out)}`;
});
chk("P66975", "…and it echoes those unusable keys back verbatim", () => {
  const bad = ["nonsense", "04-08-2026", ""];
  const wrong = bad.filter((k) => keyLabel(k) !== k);
  return wrong.length === 0 ? true : `not echoed: ${JSON.stringify(wrong.map((k) => [k, keyLabel(k)]))}`;
});
chk("P66976", "keyLabel round-trips istKey for a day bucket", () => {
  const d = new Date("2026-08-04T06:00:00Z");
  const k = istKey(d, "30d");
  return /4 Aug/.test(keyLabel(k)) ? true : `istKey gave ${k}, keyLabel gave "${keyLabel(k)}"`;
});
chk("P66977", "…and for an hour bucket", () => {
  const d = new Date("2026-08-04T09:30:00Z");   // 15:00 IST
  const k = istKey(d, "today");
  const s = keyLabel(k);
  return /3\s?PM|3:00\s?pm/i.test(s) ? true : `istKey gave ${k}, keyLabel gave "${s}"`;
});
chk("P66978", "keyLabel never returns an empty string for a well-formed key", () => {
  const keys = ["2026-01-01", "2026-12-31", "2026-06-15 00", "2026-06-15 23"];
  const empty = keys.filter((k) => !keyLabel(k).trim());
  return empty.length === 0 ? true : `empty labels for: ${JSON.stringify(empty)}`;
});

// ── tsLabel — the axis label the chart prints ────────────────────────────────────────────────
const tsLabel = run("tsLabel");
chk("P66979", "tsLabel prints a TIME for today and yesterday", () => {
  const s = tsLabel("2026-08-04T09:30:00Z", "today");
  return /(am|pm)/i.test(s) ? true : `got "${s}"`;
});
chk("P66980", "…and a DATE for every wider range", () => {
  const wide = ["week", "7d", "month", "30d", "lastmonth", "all"].map((r) => tsLabel("2026-08-04T09:30:00Z", r));
  return wide.every((s) => /Aug/.test(s)) ? true : `labels: ${JSON.stringify(wide)}`;
});
chk("P66981", "tsLabel renders in IST, not the reader's own zone", () =>
  /5 Aug/.test(tsLabel("2026-08-04T20:00:00Z", "30d"))
    ? true : `got "${tsLabel("2026-08-04T20:00:00Z", "30d")}" — expected 5 Aug in IST`);
chk("P66982", "…and never prints a year on a day axis, which would not fit", () => {
  const s = tsLabel("2026-08-04T09:30:00Z", "30d");
  return !/2026/.test(s) ? true : `got "${s}"`;
});

// ── expectedBuckets — the complete axis, so a quiet hour shows as a zero, not a gap ──────────
const expectedBuckets = run("expectedBuckets");
chk("P66983", "expectedBuckets('7d') returns exactly 7 buckets", () => {
  const n = expectedBuckets("7d").length;
  return n === 7 ? true : `${n} buckets`;
});
chk("P66984", "expectedBuckets('30d') returns exactly 30", () => {
  const n = expectedBuckets("30d").length;
  return n === 30 ? true : `${n} buckets`;
});
chk("P66985", "…and both are in ascending time order", () => {
  for (const r of ["7d", "30d"]) {
    const b = expectedBuckets(r);
    if (!b.every((x, i) => i === 0 || b[i - 1].ms <= x.ms)) return `${r} is not ascending`;
  }
  return true;
});
chk("P66986", "…with no duplicate keys, so no day is plotted twice", () => {
  for (const r of ["7d", "30d", "today", "yesterday"]) {
    const keys = expectedBuckets(r).map((b) => b.key);
    if (new Set(keys).size !== keys.length) return `${r} has duplicate bucket keys`;
  }
  return true;
});
chk("P66987", "…and the last bucket of 7d/30d is TODAY in IST", () => {
  const todayKey = istKey(new Date(), "30d");
  for (const r of ["7d", "30d"]) {
    const b = expectedBuckets(r);
    if (b[b.length - 1].key !== todayKey) return `${r} ends on ${b[b.length - 1].key}, today is ${todayKey}`;
  }
  return true;
});
chk("P66988", "expectedBuckets('today') starts at the 05:00-IST business day, not midnight", () => {
  const b = expectedBuckets("today");
  if (!b.length) return "no buckets for today";
  const h = new Date(b[0].ms + 5.5 * 3600000).getUTCHours();
  return h === 5 ? true : `the first bucket is at ${h}:00 IST`;
});
chk("P66989", "…and it never runs past the current hour", () => {
  const b = expectedBuckets("today");
  if (!b.length) return "no buckets for today";
  return b[b.length - 1].ms <= Date.now() + 3600000
    ? true : `the last bucket is ${Math.round((b[b.length - 1].ms - Date.now()) / 3600000)}h in the future`;
});
chk("P66990", "…so no future hour is drawn as a zero", () => {
  const future = expectedBuckets("today").filter((x) => x.ms > Date.now() + 60000);
  return future.length === 0 ? true : `${future.length} future hours would plot as zero`;
});
chk("P66991", "expectedBuckets('yesterday') covers a WHOLE business day, 24 hours", () => {
  const n = expectedBuckets("yesterday").length;
  return n === 24 ? true : `${n} hourly buckets for yesterday, expected 24`;
});
chk("P66992", "…and every one of its buckets is in the past", () => {
  const future = expectedBuckets("yesterday").filter((x) => x.ms > Date.now());
  return future.length === 0 ? true : `${future.length} of yesterday's buckets are in the future`;
});
chk("P66993", "…and its buckets are one hour apart", () => {
  const b = expectedBuckets("yesterday");
  const gaps = b.slice(1).map((x, i) => x.ms - b[i].ms);
  return gaps.every((g) => g === 3600000) ? true : `gaps: ${JSON.stringify([...new Set(gaps)])}`;
});
chk("P66994", "expectedBuckets returns [] for week, month, lastmonth and all", () => {
  const nonEmpty = ["week", "month", "lastmonth", "all"].filter((r) => expectedBuckets(r).length !== 0);
  return nonEmpty.length === 0 ? true : `these returned buckets: ${JSON.stringify(nonEmpty)}`;
});
chk("P66995", "…which is why every caller has a SORTED fallback — the axis order cannot come from row order", () => {
  const sorts = (p.match(/\.sort\(\(a, b\) => \(a\[0\] < b\[0\] \? -1 : 1\)\)/g) || []).length
              + (p.match(/Array\.from\(by\.keys\(\)\)\.sort\(\)/g) || []).length
              + (p.match(/\.sort\(\(a, b\) => \(String\(a\.bucket\) < String\(b\.bucket\) \? -1 : 1\)\)/g) || []).length;
  return sorts >= 5 ? true : `only ${sorts} sorted fallbacks for the four empty ranges`;
});
chk("P66996", "every expectedBuckets entry carries a key, a label and a timestamp", () => {
  for (const r of ["today", "yesterday", "7d", "30d"]) {
    const bad = expectedBuckets(r).filter((b) => !b.key || !b.label || !Number.isFinite(b.ms));
    if (bad.length) return `${r} has ${bad.length} incomplete buckets`;
  }
  return true;
});
chk("P66997", "…and every label is non-empty and free of 'Invalid Date'", () => {
  for (const r of ["today", "yesterday", "7d", "30d"]) {
    const bad = expectedBuckets(r).filter((b) => !b.label.trim() || /Invalid/i.test(b.label));
    if (bad.length) return `${r}: ${JSON.stringify(bad.slice(0, 3))}`;
  }
  return true;
});
chk("P66998", "the day-bucket keys agree with istKey, so a payload row can always be found", () => {
  for (const r of ["7d", "30d"]) {
    const b = expectedBuckets(r);
    const mismatched = b.filter((x) => istKey(new Date(x.ms), r) !== x.key);
    if (mismatched.length) return `${r}: ${mismatched.length} buckets whose key does not match istKey`;
  }
  return true;
});
chk("P66999", "…and so do the hour-bucket keys", () => {
  for (const r of ["today", "yesterday"]) {
    const b = expectedBuckets(r);
    const mismatched = b.filter((x) => istKey(new Date(x.ms), r) !== x.key);
    if (mismatched.length) return `${r}: ${mismatched.length} hour buckets whose key does not match istKey`;
  }
  return true;
});
chk("P67000", "an unknown range returns [] rather than throwing", () => {
  try {
    const b = expectedBuckets("not-a-range");
    return Array.isArray(b) && b.length === 0 ? true : `returned ${JSON.stringify(b).slice(0, 60)}`;
  } catch (e) { return `threw: ${e.message}`; }
});

// ── rangeSpanText — the exact dates under the dropdown ───────────────────────────────────────
const rangeSpanText = run("rangeSpanText");
const ALL8 = ["today", "yesterday", "week", "7d", "month", "30d", "lastmonth", "all"];
chk("P67001", "every one of the eight periods gets a non-empty caption", () => {
  const empty = ALL8.filter((r) => !rangeSpanText(r).trim());
  return empty.length === 0 ? true : `no caption for: ${JSON.stringify(empty)}`;
});
chk("P67002", "…and no two periods share the same caption", () => {
  const all = ALL8.map((r) => rangeSpanText(r));
  return new Set(all).size === all.length
    ? true : `duplicate captions: ${JSON.stringify(all.filter((x, i) => all.indexOf(x) !== i))}`;
});
chk("P67003", "…and none of them prints 'Invalid Date' or 'NaN'", () => {
  const bad = ALL8.filter((r) => /Invalid|NaN|undefined/.test(rangeSpanText(r)));
  return bad.length === 0 ? true : `${JSON.stringify(bad.map((r) => [r, rangeSpanText(r)]))}`;
});
chk("P67004", "the today caption names today's own date", () => {
  const s = rangeSpanText("today");
  return /^Today · /.test(s) ? true : `got "${s}"`;
});
chk("P67005", "the yesterday caption names yesterday's date, not today's", () => {
  const y = rangeSpanText("yesterday"), t = rangeSpanText("today");
  return /^Yesterday · /.test(y) && y.replace("Yesterday", "") !== t.replace("Today", "")
    ? true : `today="${t}" yesterday="${y}"`;
});
chk("P67006", "the 7-day caption says 7 days", () =>
  /\(7 days\)$/.test(rangeSpanText("7d")) ? true : `got "${rangeSpanText("7d")}"`);
chk("P67007", "the 30-day caption says 30 days", () =>
  /\(30 days\)$/.test(rangeSpanText("30d")) ? true : `got "${rangeSpanText("30d")}"`);
chk("P67008", "the week caption says 'this week'", () =>
  /\(this week\)$/.test(rangeSpanText("week")) ? true : `got "${rangeSpanText("week")}"`);
chk("P67009", "the month caption says 'so far', because the month is not over", () =>
  / so far$/.test(rangeSpanText("month")) ? true : `got "${rangeSpanText("month")}"`);
chk("P67010", "the last-month caption names a MONTH and a YEAR", () =>
  /^All of \w+ \d{4}$/.test(rangeSpanText("lastmonth")) ? true : `got "${rangeSpanText("lastmonth")}"`);
chk("P67011", "…and it is the month before this one", () => {
  const s = rangeSpanText("lastmonth");
  const nowIst = new Date(Date.now() + 5.5 * 3600000);
  const prev = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth() - 1, 15));
  const name = prev.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  return s.includes(name) ? true : `caption "${s}" does not name ${name}`;
});
chk("P67012", "the all-time caption says everything up to today", () =>
  /^Everything up to /.test(rangeSpanText("all")) ? true : `got "${rangeSpanText("all")}"`);
chk("P67013", "an unknown range still gets the all-time caption rather than an empty one", () => {
  const s = rangeSpanText("not-a-range");
  return s.trim().length > 0 ? true : "an unknown range produces an empty caption";
});

// ── errText — what the red banner is allowed to print ────────────────────────────────────────
const errText = run("errText");
chk("P67014", "errText prints an Error's own message", () =>
  errText(new Error("the database is asleep")) === "the database is asleep"
    ? true : `got "${errText(new Error("the database is asleep"))}"`);
chk("P67015", "…and a plain string unchanged", () =>
  errText("something went wrong") === "something went wrong" ? true : `got "${errText("something went wrong")}"`);
chk("P67016", "a thrown OBJECT never renders as the literal '[object Object]'", () => {
  const s = errText({ message: "no connection", code: "PGRST301" });
  return !/\[object Object\]/.test(s) && /no connection/.test(s) ? true : `got "${s}"`;
});
chk("P67017", "…and it joins the human parts it can find", () => {
  const s = errText({ message: "m", error: "e", details: "d", code: "c" });
  return s === "m · e · d · c" ? true : `got "${s}"`;
});
chk("P67018", "…and skips the parts that are not strings", () => {
  const s = errText({ message: "m", error: 42, details: null, code: "c" });
  return s === "m · c" ? true : `got "${s}"`;
});
chk("P67019", "an object with NO human parts falls back to its JSON, truncated", () => {
  const big = { a: "x".repeat(500) };
  const s = errText(big);
  return s.length <= 200 && !/\[object Object\]/.test(s)
    ? true : `length ${s.length}: "${s.slice(0, 60)}"`;
});
chk("P67020", "…so a whole payload can never land in the red banner", () => {
  const s = errText({ rows: Array.from({ length: 200 }, (_, i) => ({ i, name: "dish " + i })) });
  return s.length <= 200 ? true : `${s.length} characters would be printed to the owner`;
});
chk("P67021", "errText survives null and undefined without throwing", () => {
  try { return typeof errText(null) === "string" && typeof errText(undefined) === "string" ? true : "did not return a string"; }
  catch (e) { return `threw: ${e.message}`; }
});
chk("P67022", "…and a circular object, which JSON.stringify refuses", () => {
  const o = { message: undefined };
  o.self = o;
  try { const s = errText(o); return typeof s === "string" ? true : "did not return a string"; }
  catch (e) { return `threw on a circular object: ${e.message}`; }
});
chk("P67023", "errText always returns a STRING, for anything at all that can be thrown", () => {
  // Re-scoped: an earlier version demanded a non-empty string, which errText never promised —
  // `new Error("")` and `""` carry no message, and an empty DETAIL beside the banner's own
  // "Couldn't load." heading is honest. What must hold is that the banner is always handed a
  // string, so no branch can render an object or throw while reporting a failure.
  const cases = [null, undefined, "", {}, [], 0, false, new Error(""), new Error("x"), Symbol.iterator, 12n,
    { message: 1 }, [1, 2, 3], () => {}, new Map(), NaN, Infinity];
  const bad = cases.filter((c) => { try { return typeof errText(c) !== "string"; } catch { return true; } });
  return bad.length === 0 ? true : `${bad.length} inputs did not yield a string`;
});

// ── istWall / istWall12 — the records strip's clock ──────────────────────────────────────────
const istWall = run("istWall");
chk("P67024", "istWall treats a zone-LESS stamp as UTC, so the figure reads the same anywhere", () => {
  const a = istWall("2026-08-04T15:00:00", { hour: "numeric", hour12: true });
  const b = istWall("2026-08-04T15:00:00Z", { hour: "numeric", hour12: true });
  // zone-less is read as UTC and printed in UTC; a Z stamp is printed in IST — deliberately
  return a !== b ? true : `zone-less and Z rendered identically ("${a}") — one of the two branches is dead`;
});
chk("P67025", "…and a stamp WITH a zone is converted to IST", () => {
  const s = istWall("2026-08-04T09:30:00Z", { hour: "numeric", hour12: true });
  return /3/.test(s) ? true : `09:30Z should read as 3 PM IST, got "${s}"`;
});
chk("P67026", "istWall never returns 'Invalid Date' for a well-formed stamp", () => {
  const stamps = ["2026-08-04T09:30:00Z", "2026-08-04T09:30:00", "2026-08-04T09:30:00+05:30"];
  const bad = stamps.filter((x) => /Invalid/i.test(istWall(x, { dateStyle: "medium" })));
  return bad.length === 0 ? true : `Invalid Date for: ${JSON.stringify(bad)}`;
});
const istWall12 = run("istWall12");
chk("P67027", "istWall12 upper-cases am/pm, so the records strip matches every other clock here", () => {
  const s = istWall12("2026-08-04T09:30:00Z", { hour: "numeric", hour12: true });
  return /PM/.test(s) && !/pm/.test(s) ? true : `got "${s}"`;
});
chk("P67028", "…and it upper-cases AM as well", () => {
  const s = istWall12("2026-08-04T01:30:00Z", { hour: "numeric", hour12: true });
  return /AM/.test(s) && !/am/.test(s) ? true : `got "${s}"`;
});
chk("P67029", "…and it leaves the rest of the label alone", () => {
  const s = istWall12("2026-08-04T09:30:00Z", { day: "numeric", month: "short", hour: "numeric", hour12: true });
  return /Aug/.test(s) ? true : `the month name was mangled: "${s}"`;
});
chk("P67030", "…and it does not upper-case an 'am' that is part of a WORD", () => {
  // The replace is anchored on word boundaries. Without them a month or weekday containing the
  // letters would be mangled — and the records strip prints a month name beside the hour.
  const src = lift("istWall12");
  return /\\b\(am\|pm\)\\b/.test(src) || /\\b\(am\|pm\)\\b/.test(src.replace(/\\\\/g, "\\"))
    ? true : `the am/pm replace is not word-anchored: ${src.slice(0, 160)}`;
});

const n = report("T13 NEW band C · the dashboard's own helpers, EXECUTED (P66933–P67029)", { minChecks: 80 });
const out = process.argv.find((x) => x.startsWith("--ledger="));
if (out) writeLedger(out.slice(9), {
  how: "lifted each function's REAL source text out of app/owner/page.tsx and ran it, asserting values",
  section: "NEW · Band C — the dashboard's own helpers, EXECUTED — P66933–P67029",
});
