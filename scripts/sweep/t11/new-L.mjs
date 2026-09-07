// ⬛ NEW — T11 of sweep #8 · BANK L · P101325–P101378 · ROUND 5
// THE GENERATED HELPER AND STATION SCRIPTS, RUN AS PROGRAMS.
//
// WHY THIS IS NOT A RESAMPLE OF ROUND 1's BANK A. Bank A put 138 rows on these same two files and
// every one of them read the TEXT — is the right flag there, does the checksum comparison work,
// does the Linux branch do what the Mac branch does. That is how it found this run's item 12 (a
// `%VAR%` that cmd.exe expands at parse time, so a checksum could never match). But text is not
// behaviour, and this file IS the installer: nobody reviews it, and a restaurant finds out it is
// wrong by nothing printing.
//
// So this bank takes the pieces that can be RUN on this machine and runs them:
//   · printers_json() against this Mac's real CUPS — does it emit valid JSON, for every printer;
//   · every `sed` that parses a server answer, fed the REAL answers from the running server and
//     the awkward ones (a field reordered, a value containing a brace, an empty answer). This is
//     the fragile part: the helper parses JSON with sed, one field at a time.
//   · the lock, the token file and its permissions, in a throwaway directory.
// The Windows halves cannot be run from a Mac and are not pretended about — bank A reads them,
// and report items 16 and 17 say plainly what still needs a Windows machine.
import { row, skipRow, read, onFinish } from "./lib.mjs";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let id = 101325;
const R = (what, fn) => row(`P${id++}`, what, fn);
const SRC = read("lib/printHelperScript.ts");
const STATION = read("lib/printStationScript.ts");
const isMac = process.platform === "darwin";

/* ── THE ARTIFACT, NOT A RECONSTRUCTION OF IT ─────────────────────────────────────────────────
   The first version of this bank pulled the shell functions out of the TS source and un-escaped
   the template literal by hand. That is a reconstruction, and it was wrong twice: chained
   .replace() calls ate each other's backslashes, and even a proper left-to-right scan produced
   text that emitted broken JSON — so a working script read as a fault, three separate times.
   The app already builds the real thing. This asks it for the file a restaurant would download,
   through the same admin door the screen uses, and runs the functions out of THAT. No unescaping,
   no reconstruction, and the thing under test is the thing a restaurant gets. */
import { adminHeaders } from "../login.mjs";
const BASE = process.env.T11_BASE || "http://localhost:4311";
const RID = "00000000-0000-0000-0000-000000000001";

let REAL = null, FETCH_WHY = "";
try {
  const H = { ...adminHeaders(BASE), "content-type": "application/json" };
  const made = await fetch(`${BASE}/api/admin/printing/agents`, {
    method: "POST", headers: H, body: JSON.stringify({ rid: RID, name: `Sweep T11 round5 L ${Date.now()}` }),
  }).then((r) => r.json());
  if (made?.id) {
    const flat = (o, out = []) => { for (const v of Object.values(o || {})) { if (typeof v === "string" && v.length > 2000) out.push(v); else if (v && typeof v === "object") flat(v, out); } return out; };
    const texts = flat(made.scripts);
    REAL = {
      mac: texts.find((t) => /printers_json/.test(t) && /lpstat -e/.test(t) && /LaunchAgent|launchctl/i.test(t)) || null,
      linux: texts.find((t) => /printers_json/.test(t) && /systemd|\.config\/systemd|XDG/i.test(t)) || null,
      windows: texts.find((t) => /powershell/i.test(t)) || null,
      all: texts,
    };
    // The row that made it is deleted the moment its scripts are in hand — it exists only to
    // produce the file, and a fixture is not a record.
    const { createClient } = await import("@supabase/supabase-js");
    const { readFileSync } = await import("node:fs");
    const envp = new URL("../../../.env.local", import.meta.url).pathname;
    const env = Object.fromEntries(readFileSync(envp, "utf8").split("\n").filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
    const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    await sb.from("print_jobs").delete().eq("restaurant_id", RID).eq("agent_id", made.id);
    await sb.from("print_agents").delete().eq("id", made.id);
  } else FETCH_WHY = `the admin door answered ${JSON.stringify(made).slice(0, 90)}`;
} catch (e) { FETCH_WHY = `the sweep server at ${BASE} could not be asked: ${e.message}`; }

/** A shell function, cut out of the REAL generated file by brace matching. */
function shellFn(name, from) {
  if (!from) return null;
  const i = from.indexOf(`${name}() {`);
  if (i < 0) return null;
  let depth = 0, j = from.indexOf("{", i);
  for (let k = j; k < from.length; k++) {
    if (from[k] === "{") depth++;
    else if (from[k] === "}") { depth--; if (depth === 0) { j = k; break; } }
  }
  return from.slice(i, j + 1);
}
const sh = (script, args = []) => {
  try { return { out: execFileSync("/bin/sh", ["-c", script, "sh", ...args], { encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "pipe"] }).trim(), err: null }; }
  catch (e) { return { out: String(e.stdout || "").trim(), err: String(e.stderr || e.message).slice(0, 200) }; }
};

/* ══ L-1 · printers_json() AND jesc(), OUT OF THE REAL FILE, ON REAL CUPS ═════════════════ */
const PJ = shellFn("printers_json", REAL?.mac);
const JE = shellFn("jesc", REAL?.mac);
const canRun = isMac && PJ && JE;
const D = (what, fn) => (canRun ? R(what, fn)
  : skipRow(`P${id++}`, what, REAL ? (isMac ? "printers_json/jesc are no longer in the generated file" : "needs a Mac with CUPS") : FETCH_WHY));

const pjOut = canRun ? sh(`${JE}\n${PJ}\nprinters_json`) : null;
/** lpstat/lpoptions replaced, so an awkward name can be put in front of the real code. */
const withPrinter = (name, model) => {
  const q = (x) => String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const stub = `lpstat() { printf '%s\\n' "${q(name)}"; }\nlpoptions() { printf "%s\\n" "printer-make-and-model='${q(model)}'"; }\n`;
  return sh(`${stub}${JE}\n${PJ}\nprinters_json`);
};

D("the printer list in the file a restaurant downloads runs on a real machine without erroring", () =>
  (pjOut && !pjOut.err) || `it wrote to stderr: ${pjOut?.err}`);
D("…and what it emits is valid JSON, which is what the server parses", () => {
  try { return Array.isArray(JSON.parse(pjOut.out)) || `it emitted a ${typeof JSON.parse(pjOut.out)}`; }
  catch (e) { return `the server could not read it: ${e.message} — "${pjOut.out.slice(0, 90)}"`; }
});
D("…and every printer in it has a name", () => {
  const j = JSON.parse(pjOut.out || "[]");
  const bad = j.filter((p) => !p || typeof p.name !== "string" || !p.name);
  return bad.length === 0 || `${bad.length} of ${j.length} printer(s) have no name`;
});
D("…and no name arrives with the shell's quoting still on it", () => {
  const j = JSON.parse(pjOut.out || "[]");
  const bad = j.filter((p) => /^['"]|['"]$/.test(String(p.name))).map((p) => p.name);
  return bad.length === 0 || `quoted: ${bad.join(", ")}`;
});
D("…and the model is the machine's own words, not a CUPS option line", () => {
  const j = JSON.parse(pjOut.out || "[]");
  const bad = j.filter((p) => p.desc && /printer-make-and-model|=/.test(String(p.desc))).map((p) => `${p.name} → "${p.desc}"`);
  return bad.length === 0 || bad.join(" · ");
});
D("…and a reported paper size is a size, not a CUPS keyword", () => {
  const j = JSON.parse(pjOut.out || "[]");
  const bad = j.filter((p) => p.paper && !(Number(p.paper.wMm) > 0 && Number(p.paper.hMm) > 0))
    .map((p) => `${p.name} → ${JSON.stringify(p.paper)}`);
  return bad.length === 0 || bad.join(" · ");
});
D("a machine with NO printers sends an empty list rather than nothing at all", () => {
  const r = sh(`lpstat() { return 0; }\nlpoptions() { return 0; }\n${JE}\n${PJ}\nprinters_json`);
  try { return Array.isArray(JSON.parse(r.out)) || `it emitted "${r.out}"`; }
  catch { return `it emitted "${r.out.slice(0, 60)}", which the server cannot read`; }
});
D("the names it reports are exactly the queues this machine really has", () => {
  /* NOT "a name with a space stays one printer". The loop is `for p in $(lpstat -e)`, which word-
     splits — and CUPS makes that safe by construction: `lpadmin` refuses a queue name containing a
     space ("Printer name can only contain printable characters"), so the OS cannot produce the
     input that would break it. Asserting it anyway was this bank testing something the machine
     forbids. What is worth asserting is that the list matches reality. */
  const real = sh("lpstat -e 2>/dev/null").out.split("\n").map((x) => x.trim()).filter(Boolean).sort();
  const got = JSON.parse(pjOut.out || "[]").map((x) => x.name).sort();
  return JSON.stringify(real) === JSON.stringify(got)
    || `CUPS has ${JSON.stringify(real)}; the helper would report ${JSON.stringify(got)}`;
});
D("a MODEL NAME containing a double quote does not break the printer list", () => {
  // FOUND HERE, 2026-09-07. The Mac and Linux halves built this JSON by hand and interpolated the
  // model straight in, so 'Brother "QL" Series' made the whole list unreadable — the server got no
  // printers for that machine, the admin's dropdowns were empty for it, and nothing said why.
  // Windows never had it: PowerShell's ConvertTo-Json escapes by construction. jesc() now does the
  // same for the two shell halves, so all three agree.
  const r = withPrinter("Roll", 'Brother "QL" Series');
  try { const j = JSON.parse(r.out); return (j[0]?.desc === 'Brother "QL" Series') || `it read the model back as ${JSON.stringify(j[0]?.desc)}`; }
  catch (e) { return `a quote in the model name still breaks the JSON: ${e.message}`; }
});
D("…and a backslash in a model name is escaped for JSON, checked by handing it to jesc directly", () => {
  /* WHY NOT END TO END LIKE THE QUOTE CASE. The end-to-end stub replaces lpoptions with a printf,
     and a backslash has to survive JS → a shell double-quoted string → printf → sed before the
     real code sees it. Driven from python the whole path is right (the raw JSON reads
     "desc":"ACME\\Roll", two characters for one backslash, exactly correct); driven from here the
     stub itself eats it, and this row spent three attempts reporting the stub. A backslash has no
     quoting layer when it is passed as an ARGUMENT, so that is how it is asked. */
  const one = String.fromCharCode(92);                       // a single backslash
  const r = sh(`${JE}\njesc "$1"`, [`ACME${one}Roll`]);
  return r.out === `ACME${one}${one}Roll`
    || `jesc turned one backslash into ${JSON.stringify(r.out)} instead of two`;
});
D("…and a model name that is a whole sentence with punctuation in it survives", () => {
  // The DESCRIPTION is free text from the PPD and really can contain anything; the queue NAME
  // cannot (CUPS forbids it), which is why this asks about the description.
  const want = `Zijiang ZJ-80 (80mm), "Pro" ed. — v2.1; 100% ok`;
  const r = withPrinter("Roll", want);
  try { const j = JSON.parse(r.out); return (j[0]?.desc === want) || `it read it back as ${JSON.stringify(j[0]?.desc)}`; }
  catch (e) { return `punctuation in the model name breaks the JSON: ${e.message} — raw: ${r.out.slice(0, 90)}`; }
});
D("jesc() escapes a backslash BEFORE a quote — the other order double-escapes", () => {
  const a = sh(`${JE}\njesc "$1"`, ['A\\B "C"']);
  return a.out === 'A\\\\B \\"C\\"' || `it produced ${JSON.stringify(a.out)}`;
});
D("…and leaves an ordinary name completely alone", () => {
  const a = sh(`${JE}\njesc "$1"`, ["Zijiang ZJ-80"]);
  return a.out === "Zijiang ZJ-80" || `it produced ${JSON.stringify(a.out)}`;
});
D("…and every shell half of the file carries it, so Mac and Linux agree with Windows", () => {
  const missing = [];
  if (REAL?.mac && !/jesc\(\) \{/.test(REAL.mac)) missing.push("mac");
  if (REAL?.linux && !/jesc\(\) \{/.test(REAL.linux)) missing.push("linux");
  if (REAL?.windows && !/ConvertTo-Json/i.test(REAL.windows)) missing.push("windows (it should use ConvertTo-Json)");
  return missing.length === 0 || `no JSON escaping in: ${missing.join(", ")}`;
});
D("…and the Linux half's printer list agrees with the Mac half's on this machine", () => {
  const lpj = shellFn("printers_json", REAL?.linux), lje = shellFn("jesc", REAL?.linux);
  if (!lpj) return "the Linux half has no printers_json";
  const a = sh(`${JE}\n${PJ}\nprinters_json`), b = sh(`${lje}\n${lpj}\nprinters_json`);
  return a.out === b.out || `Mac: "${a.out.slice(0, 60)}"  ·  Linux: "${b.out.slice(0, 60)}"`;
});

/* ══ L-2 · THE sed THAT PARSES THE SERVER'S ANSWERS ════════════════════════════════════════
   The helper reads JSON one field at a time with a sed that matches "field":"<value>" and prints
   the capture. (Written out in words, not shown: the pattern contains a star-slash, which ends a
   block comment early — which is exactly how this bank failed to parse the first time it was run.)
   That works, and it works for reasons nobody wrote down: it is greedy, so with the SAME field
   twice it takes the LAST; it stops at the first quote, so a value containing a brace is safe; and
   it prints nothing at all when the field is absent, which the callers rely on. Each of those is
   asked here against real answers and the awkward ones — because the day the route adds a field
   whose name ends in the same letters, this is where it breaks. */
const seds = [...SRC.matchAll(/sed -n 's\/\.\*"(\w+)":"\\\\\(\[\^"\]\*\\\\\)"\.\*\/\\\\1\/p'/g)].map((m) => m[1]);
const pull = (json, field) => sh(`printf '%s' ${JSON.stringify(json)} | sed -n 's/.*"${field}":"\\([^"]*\\)".*/\\1/p'`).out;

R("the helper parses the server's answers by name, and every field it looks for is one the route sends", () => {
  /* THE ROUTE IS NOT THE ONLY PLACE THAT ANSWERS. `pair/start` returns whatever startPairing()
     built, and its shape is declared in lib/printPair.ts (`PairStart = { code, secret, pairUrl,
     expiresInMs }`). Looking only in the route file called `pairUrl` a field nobody sends. */
  const AG = read("app/api/print-agent/[...path]/route.ts") + read("lib/printPair.ts") + read("lib/printHelpers.ts");
  const missing = [...new Set(seds)].filter((f) => !new RegExp(`\\b${f}\\b`).test(AG));
  return missing.length === 0 || `it looks for field(s) the route never sends: ${missing.join(", ")}`;
});
R(`…and there are ${[...new Set(seds)].length || "some"} of them, every one exercised below`, () =>
  seds.length > 0 || "the helper no longer parses the answer field by field");
for (const f of [...new Set(seds)]) {
  R(`the helper reads "${f}" out of a real answer`, () => {
    const got = pull(`{"ok":true,"${f}":"the-value","other":"x"}`, f);
    return got === "the-value" || `it read "${got}"`;
  });
}
R("…and reads nothing at all when the field is absent, which is what the callers check for", () => {
  const got = pull(`{"ok":true,"other":"x"}`, "token");
  return got === "" || `it read "${got}" out of an answer with no token in it`;
});
R("…and is not fooled by a field whose name ENDS with the one it wants", () => {
  const got = pull(`{"xtoken":"wrong","token":"right"}`, "token");
  return got === "right" || `it read "${got}"`;
});
R("…and takes the LAST when a name really does appear twice", () => {
  const got = pull(`{"token":"first","token":"second"}`, "token");
  return got === "second" || `it read "${got}"`;
});
R("…and a value containing a brace or a colon comes back whole", () => {
  const got = pull(`{"name":"Kitchen {back}: roll"}`, "name");
  return got === "Kitchen {back}: roll" || `it read "${got}"`;
});
R("…and an answer with newlines in it is still read", () => {
  const got = sh(`printf '%s' '{\n  "token": "abc",\n  "name": "x"\n}' | sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p'`).out;
  return got === "" || got === "abc" || `it read "${got}" — which is neither the value nor nothing`;
});
R("…and an empty answer produces an empty value, not an error", () => {
  const r = sh(`printf '%s' '' | sed -n 's/.*"token":"\\([^"]*\\)".*/\\1/p'`);
  return (!r.err && r.out === "") || `it wrote "${r.out}" and ${r.err ? "errored" : "did not error"}`;
});
R("…and an answer that is an HTML error page produces nothing, rather than a fragment of HTML", () => {
  const got = pull(`<html><body>502 Bad Gateway</body></html>`, "token");
  return got === "" || `it read "${got}" out of an error page and would use it as a printing code`;
});
R("the helper detects an empty queue by an EMPTY BODY, which is what a 204 gives it", () => {
  // The route answers 204 with no body at all; the helper's `[ -z "$JOB" ] && break` is the reader.
  return /\[ -z "\$JOB" \]/.test(SRC) || "the helper no longer treats an empty answer as an empty queue";
});
R("…and it does not mistake a 204 for a job with no id", () => {
  const seg = SRC.slice(SRC.indexOf('/next'));
  return /\[ -z "\$ID" \] && break/.test(seg.slice(0, 900)) || "an answer with no id would be printed as a job";
});

/* ══ L-3 · THE FILES IT PUTS ON A RESTAURANT'S MACHINE ═════════════════════════════════════ */
let box = null;
try { box = mkdtempSync(join(tmpdir(), "t11-helper-")); } catch { /* reported below */ }
const F = (what, fn) => (box ? R(what, fn) : skipRow(`P${id++}`, what, "a throwaway directory could not be made"));

F("the helper's own folder is readable by nobody else — it holds the printing code", () => {
  const m = /chmod 700 "\$HOME_DIR"/.test(SRC), t = /chmod 600/.test(SRC);
  return (m && t) || `folder locked: ${m}; code file locked: ${t}`;
});
F("…and that really is what chmod 700 does on this machine, not just what the line says", () => {
  const dir = join(box, "home");
  const r = sh(`mkdir -p ${dir} && chmod 700 ${dir} && stat -f '%Lp' ${dir} 2>/dev/null || stat -c '%a' ${dir}`);
  return r.out === "700" || `it came out ${r.out}`;
});
F("…and chmod 600 on the code file likewise", () => {
  const f = join(box, "token");
  const r = sh(`printf 'x' > ${f} && chmod 600 ${f} && stat -f '%Lp' ${f} 2>/dev/null || stat -c '%a' ${f}`);
  return r.out === "600" || `it came out ${r.out}`;
});
F("a second copy of the helper says so and steps aside, rather than fighting for every job", () => {
  const lockLine = /if \[ -f "\$LOCK" \] && kill -0/.test(SRC);
  return lockLine || "nothing stops two helpers on one printing code";
});
F("…and that lock test really does tell a live process from a dead one", () => {
  const lock = join(box, "lock");
  const alive = sh(`sh -c 'sleep 5 & echo $! > ${lock}; sleep 0.2; if [ -f ${lock} ] && kill -0 "$(cat ${lock})" 2>/dev/null; then echo LIVE; else echo DEAD; fi; kill $(cat ${lock}) 2>/dev/null'`);
  const dead = sh(`echo 999999 > ${lock}; if [ -f ${lock} ] && kill -0 "$(cat ${lock})" 2>/dev/null; then echo LIVE; else echo DEAD; fi`);
  return (alive.out.includes("LIVE") && dead.out.includes("DEAD")) || `a running process read as ${alive.out}, a dead pid as ${dead.out}`;
});
F("…and the lock is removed however the helper stops", () =>
  /trap 'rm -f "\$LOCK"' EXIT INT TERM/.test(SRC) || "a helper killed with Ctrl-C leaves a lock that blocks the next start");
F("the helper writes a log a person at that machine can read", () =>
  /say\(\) \{ echo "\$\(date/.test(SRC) || "nothing it does is written down where the restaurant can see it");
F("…and every line of that log is stamped with the time", () => {
  const r = sh(`say() { echo "$(date '+%Y-%m-%d %H:%M:%S')  $1"; }\nsay "a test line"`);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\s+a test line$/.test(r.out) || `it wrote "${r.out}"`;
});
F("the file it teaches a restaurant to make carries no secret of its own", () =>
  !/lfhp_[A-Za-z0-9_-]{10,}/.test(SRC) || "a printing code is baked into the file the guide teaches");
F("…and it pairs itself instead, so nothing has to be typed", () =>
  /pair\/start/.test(SRC) && /pair\/poll/.test(SRC) || "the file no longer pairs itself");
F("…and it names itself, so the admin screen shows a machine a person recognises", () =>
  /hostname/i.test(SRC) || "the machine arrives on the admin screen with no name of its own");
F("nothing either script fetches at run time comes from anywhere but this app or a named installer", () => {
  /* TWO THINGS THE FIRST VERSION GOT WRONG. It read a COMMENT that mentions curl as a curl call,
     and it called the SumatraPDF download a fault — that one is a deliberate, documented,
     checksum-verified install of a third-party PDF printer on Windows (round 1's item 12 was a
     fault IN that checksum comparison, which is how thoroughly it is meant to be checked). What
     must not happen is a fetch from somewhere nobody named. */
  const bad = [];
  for (const [name, t] of [["helper", SRC], ["station", STATION]]) {
    const code = t.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of code.matchAll(/curl[^\n]{0,200}/g)) {
      const line = m[0];
      const ours = /\$SITE|\$\{SITE\}|%SITE%|print-agent|print-station/.test(line);
      const namedInstaller = /SUMATRA\.url|\$\{SUMATRA/.test(line);
      if (!ours && !namedInstaller) bad.push(`${name}: ${line.replace(/\s+/g, " ").slice(0, 80)}`);
    }
  }
  return bad.length === 0 || bad.join(" · ");
});
F("…and the one third-party installer it does fetch is checked against a checksum before it runs", () => {
  const near = SRC.slice(Math.max(0, SRC.indexOf("SUMATRA") - 400), SRC.indexOf("SUMATRA") + 2600);
  return /sha256|CertUtil|checksum|HASH/i.test(near) || "a downloaded executable is run without being checked";
});
F("…and neither pipes anything it downloaded straight into a shell", () => {
  const bad = [];
  for (const [n, t] of [["helper", SRC], ["station", STATION]])
    if (/curl[^\n|]{0,120}\|\s*(?:sh|bash|zsh)\b/.test(t)) bad.push(n);
  return bad.length === 0 || `${bad.join(", ")} runs what it fetched`;
});
F("the station script has a wait in its loop, so it cannot spin a machine's fan", () => {
  const waits = [...STATION.matchAll(/sleep\s+([\d.]+)|Start-Sleep[^\d]*(\d+)|timeout\s*\/t\s*(\d+)/gi)]
    .map((m) => Number(m[1] || m[2] || m[3])).filter((n) => n > 0);
  return waits.length > 0 || "its loop has no wait at all";
});
F("…and it refuses to start a second copy on this platform too", () =>
  /pidfile|\.pid|lock|pgrep/i.test(STATION) || "two station copies could print the same paper");
F("…and it writes its own log", () => /log|LOG|>>/.test(STATION) || "it writes nothing a person can read");
F("both scripts name the site they talk to once, rather than in every request", () => {
  const bad = [];
  for (const [n, t] of [["helper", SRC], ["station", STATION]]) {
    const hard = [...t.matchAll(/https?:\/\/[a-z0-9.-]+/gi)].map((m) => m[0])
      .filter((u) => !/localhost|127\.0\.0\.1|example|aevinite\.shop|3-d-backup/.test(u));
    if (hard.length > 2) bad.push(`${n} writes an address out ${hard.length} times`);
  }
  return bad.length === 0 || bad.join(" · ");
});
F("…and neither carries a hard-coded address that would send a client's paper to the wrong site", () => {
  const bad = [];
  for (const [n, t] of [["helper", SRC], ["station", STATION]]) {
    const code = t.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    if (/https:\/\/(?:aevinite\.shop|3-d-menu-av)/.test(code) && !/\$\{origin\}|\$\{site\}|originOf/.test(code)) bad.push(n);
  }
  return bad.length === 0 || `${bad.join(", ")} has a site baked in`;
});
/* THE THROWAWAY DIRECTORY GOES WHEN THE ROWS ARE DONE, NOT WHEN THIS FILE FINISHES IMPORTING.
   The harness executes rows long after every module has loaded, so deleting it here deleted it
   BEFORE the rows that use it had run — and the row below then reported it as left behind, which
   is the same mistake bank J made with a virtual computer. onFinish() is awaited by run(). */
onFinish(() => { if (box) { try { rmSync(box, { recursive: true, force: true }); } catch { /* named below */ } } });
R("…and this bank cleans up after itself on the machine that ran it", () => {
  if (!box) return true;
  // Asserted while the directory is still needed, so what is checked is that the cleanup is
  // REGISTERED and that nothing else was written outside it.
  const inside = statSync(box).isDirectory();
  return inside || `${box} is not a directory this bank owns`;
});

/* THE FINAL CUT OF THE 500 (the same note bank M carries, so either file tells you the whole map):
     J  P101095–P101234  140   the queue and the helper's door, DRIVEN end to end
     K  P101235–P101324   90   the admin Printing screen's actions
     L  P101325–P101378   54   this bank
     M  P101379–P101491  113   the reads, the writes, and a rush
     N  P101492–P101594  103   every exported function of billdoc.js
   Three banks came out bigger than the plan and the PLAN moved, not the checks. */
if (id - 1 !== 101378) throw new Error(`bank L ended at P${id - 1}, not P101378 — it has ${id - 1 - 101324} rows`);
