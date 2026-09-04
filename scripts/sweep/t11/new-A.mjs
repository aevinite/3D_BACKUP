// ⬛ NEW — T11 of sweep #8 · BANK A · P64701–P64800
// THE SIX FILES A RESTAURANT ACTUALLY TYPES: print-helper and print-station, on Mac, Windows and
// Linux. Chosen because it is the thinnest-checked ground in this territory and the most expensive
// to get wrong — the text IS the installer, nobody reviews it, and a restaurant only finds out by
// nothing printing. This run's item 12 (a checksum comparison that could never pass, so a Windows
// helper could never install its PDF printer) came from exactly here.
//
// Every check asks the GENERATED text, not the template.
import { row, skipRow, read } from "./lib.mjs";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pjoin } from "node:path";
const { helperScript, HELPER_FILENAME, HELPER_AUTOSTART } = await import("../../../lib/printHelperScript.ts");
const { stationScript, STATION_FILENAME, STATION_FIRST_RUN } = await import("../../../lib/printStationScript.ts");

const ARGS = { origin: "https://backup.example.test", label: "Front desk PC" };
const OSES = ["mac", "windows", "linux"];
const H = Object.fromEntries(OSES.map((o) => [o, helperScript(o, ARGS)]));
const S = Object.fromEntries(OSES.map((o) => [o, stationScript(o, { ...ARGS, panel: "kitchen" })]));
const ALL = { ...Object.fromEntries(OSES.map((o) => [`helper/${o}`, H[o]])), ...Object.fromEntries(OSES.map((o) => [`station/${o}`, S[o]])) };
let n = 64701;
const id = () => "P" + n++;
const each = (what, fn) => { for (const [k, txt] of Object.entries(ALL)) row(id(), `${k}: ${what}`, () => fn(txt, k)); };
const eachHelper = (what, fn) => { for (const o of OSES) row(id(), `helper/${o}: ${what}`, () => fn(H[o], o)); };
const eachStation = (what, fn) => { for (const o of OSES) row(id(), `station/${o}: ${what}`, () => fn(S[o], o)); };
const isBat = (k) => /windows/.test(k);
// THE CODE LINES ONLY. These files are half explanation by design — every rule in them carries the
// measurement that put it there — so a check about what the SCRIPT does must not read the prose.
// (Three checks in this bank failed on their first run for exactly that: one matched the word
// "undefined" inside a REM line explaining cmd.exe's parser, one matched a shell parameter
// expansion `${dims%% *}` as a leftover template hole.)
const codeLines = (t) => t.split("\n").filter((l) => !/^\s*(#|REM\b|::)/i.test(l)).join("\n");
// SITE is declared as  SITE="…"  in a shell file and  set "SITE=…"  in a .bat.
const siteOf = (t) => {
  const m = /SITE="([^"]*)"/.exec(t) || /set\s+"SITE=([^"]*)"/.exec(t);
  return m ? m[1] : null;
};

// ── 1 · the file is a file at all (6) ──────────────────────────────────────────────────────────
each("has real content, not an empty template", (t) => t.trim().length > 400 || `${t.trim().length} chars`);
// ── 2 · it starts with the right thing for its shell (6) ──────────────────────────────────────
each("opens with the right first line for its interpreter", (t, k) =>
  isBat(k) ? /^@echo off/.test(t) || `starts "${t.slice(0, 20)}"`
    : /^#!\/bin\/(zsh|sh)\n/.test(t) || `starts "${t.split("\n")[0]}"`);
// ── 3 · no TypeScript leaked into the shipped text (6) ────────────────────────────────────────
each("carries no un-interpolated ${…} left over from the template", (t, k) => {
  // A shell file legitimately uses ${VAR}, ${VAR%%…}, ${VAR##…} — those are the SHELL's own
  // expansions, not a hole the template failed to fill. A .bat has no ${…} of its own at all.
  const hits = [...codeLines(t).matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1])
    .filter((v) => isBat(k) ? true : !/^[A-Za-z_][A-Za-z0-9_]*([%#:].*)?$/.test(v));
  return hits.length === 0 || `found \${${hits[0]}}`;
});
each("carries no 'undefined' / 'NaN' / '[object Object]'", (t) => {
  const bad = ["undefined", "NaN", "[object Object]"].filter((x) => codeLines(t).includes(x));
  return bad.length === 0 || `found ${bad.join(", ")}`;
});
// ── 4 · the site it talks to (6) ──────────────────────────────────────────────────────────────
each("names the site it was generated for, exactly once as a variable", (t) => {
  const v = siteOf(t);
  return v === ARGS.origin || `SITE is ${v === null ? "(absent)" : v}`;
});
each("never hard-codes a DIFFERENT site anywhere in the body", (t) => {
  const hosts = [...new Set([...t.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase()))]
    .filter((h) => h !== "backup.example.test" && !/apple\.com|sumatrapdfreader\.org|www\.w3\.org/.test(h));
  return hosts.length === 0 || `also points at ${hosts.join(", ")}`;
});
// ── 5 · a typed value cannot add a line (12) ──────────────────────────────────────────────────
for (const [maker, kind] of [[helperScript, "helper"], [stationScript, "station"]]) {
  for (const os of OSES) {
    row(id(), `${kind}/${os}: a computer NAME carrying a newline cannot add a line to the file`, () => {
      const t = maker(os, { origin: ARGS.origin, label: "PC\nsay 'added from a name'\n# ", panel: "kitchen" });
      return !/say 'added from a name'/.test(t.split("\n").filter((l) => !/^\s*(#|REM)/.test(l)).join("\n"))
        || "a name became a line of the script";
    });
    row(id(), `${kind}/${os}: an ORIGIN carrying shell punctuation cannot break out of its quotes`, () => {
      const t = maker(os, { origin: 'https://x"; say hi; echo "', label: "PC", panel: "kitchen" });
      const v = siteOf(t);
      return (v !== null && !/[";`$\\%^&|<>]/.test(v)) || `SITE=${v}`;
    });
  }
}
// ── 6 · the token it stores (3 + 3) ───────────────────────────────────────────────────────────
eachHelper("writes its token to a file of its own, not into the script", (t) =>
  /TOKEN_FILE|TOKENFILE/.test(t) || "no token file is named");
eachHelper("carries NO secret of its own, so one file works for every restaurant", (t) =>
  !/lfhp_[A-Za-z0-9_-]{10,}/.test(t) || "a real-looking printing code is baked into the file");
eachStation("carries no password and no token at all", (t) =>
  (!/lfhp_/.test(t) && !/password/i.test(t.replace(/^\s*(#|REM).*$/gm, ""))) || "the station file carries a credential");
// ── 7 · one at a time (6) ─────────────────────────────────────────────────────────────────────
each("says so rather than starting a second copy on top of a running one", (t, k) => {
  if (/ALREADY RUNNING/i.test(t) || /already running/i.test(t)) return true;
  // station/windows is the one that still has none. A batch file cannot hold a lock across its own
  // exit (this one starts Chrome and returns), so the honest guard is "is a Chrome already on this
  // profile?" — which cannot be written or tested from macOS. Carried as an item in the report.
  return k === "station/windows"
    ? "reported, not fixed: no guard, and the right one (is a Chrome already on this profile?) needs a Windows machine to write and test — report item 17"
    : `no "already running" guard (${k})`;
});
// ── 8 · it keeps the machine awake (3 + 3) ────────────────────────────────────────────────────
eachHelper("keeps the computer awake, or says why it cannot", (t, o) =>
  o === "mac" ? /caffeinate|LaunchAgent|KeepAlive/.test(t) || "nothing keeps a Mac awake"
    : o === "windows" ? /powercfg|Startup/.test(t) || "nothing keeps a PC awake or restarts it"
      : /autostart|X-GNOME-Autostart/.test(t) || "nothing restarts it on a Pi");
eachStation("keeps the computer awake", (t, o) =>
  o === "mac" ? /caffeinate/.test(t) || "no caffeinate"
    : o === "windows" ? /powercfg/.test(t) || "no powercfg"
      : true);
// ── 9 · it starts itself again (3) ────────────────────────────────────────────────────────────
eachHelper("writes its OWN auto-start rather than asking a person to", (t, o) => {
  const writes = o === "mac" ? /install_autostart|LaunchAgents/.test(t)
    : o === "windows" ? /CreateShortcut|Startup/.test(t) : /install_autostart|autostart/.test(t);
  return writes || "auto-start is an instruction again, and a skipped step means nothing prints";
});
row(id(), "HELPER_AUTOSTART says 'nothing to do' for every OS, because the file does it", () => {
  const bad = OSES.filter((o) => !/nothing to do/i.test(HELPER_AUTOSTART[o] || ""));
  return bad.length === 0 || `${bad.join(", ")} still asks the person to do something`;
});
// ── 10 · the three verbs, and only those (3) ──────────────────────────────────────────────────
eachHelper("talks to /api/print-agent and to nothing else on the site", (t) => {
  const paths = [...new Set([...t.matchAll(/\$?\{?SITE\}?%?\/(api\/[a-z0-9/_$%{}.:-]+)/gi)].map((m) => m[1]))];
  const off = paths.filter((p) => !/^api\/print-agent\//.test(p));
  return off.length === 0 || `also calls ${off.join(", ")}`;
});
eachHelper("uses exactly the verbs the route implements", (t) => {
  const verbs = [...new Set([...t.matchAll(/api\/print-agent\/([a-z-]+)/g)].map((m) => m[1]))];
  const known = ["pair", "hello", "next", "job"];
  const off = verbs.filter((v) => !known.includes(v));
  return off.length === 0 || `unknown verb(s): ${off.join(", ")}`;
});
eachHelper("sends its token on every authenticated call, never in a URL", (t) => {
  const calls = [...t.matchAll(/curl[^\n]*api\/print-agent\/(?!pair)[^\n]*/g)].map((m) => m[0]);
  const naked = calls.filter((c) => !/x-lfh-agent/i.test(c));
  const inUrl = calls.filter((c) => /[?&](token|code)=/.test(c));
  return (calls.length > 0 && naked.length === 0 && inUrl.length === 0)
    || `${calls.length} call(s), ${naked.length} without the header, ${inUrl.length} with it in the URL`;
});
// ── 11 · "queued" is not "printed" (3) ────────────────────────────────────────────────────────
eachHelper("does not report 'done' merely because the print command returned 0", (t, o) => {
  if (o === "windows") {
    return /Get-PrintJob|WaitForJob/.test(t)
      || "reported, not fixed: it trusts SumatraPDF's exit code, so a printer that is switched off is reported as PRINTED — the exact fault the Mac path had measured and fixed on 2026-08-20. The fix needs Get-PrintJob and a Windows machine to test — report item 16";
  }
  return /lpstat -W completed/.test(t) || "the job is no longer followed to completion";
});
eachHelper("cancels a queued copy it could not confirm, so a woken printer cannot print it twice", (t, o) =>
  o === "windows" ? "reported, not fixed: nothing to cancel because nothing is followed — same root as the check above, report item 16"
    : /cancel "\$CUPSID"/.test(t) || "a stuck copy is left in the queue AND handed back for a retry");
// ── 12 · it says what happened (6) ────────────────────────────────────────────────────────────
each("writes a log a person can read afterwards", (t) => {
  // A WRITE, not merely a variable. My first version accepted the declaration, so a file that made
  // a log folder and never put a line in it counted as logging — which is what station/windows was
  // actually doing, and the question a restaurant is asked ("did it ever start on that PC?") had no
  // answer anywhere on the machine.
  // …and `tee -a "$LOG"` is an append too, which the mac station uses and my first regex missed.
  const code = codeLines(t);
  const writes = /(?:>>|tee -a)\s*"?[^"\n]*(?:LOG|log)[^"\n]*"?/.test(code);
  return writes || "nothing is ever appended to a log file";
});
each("its own messages are plain sentences, not error codes", (t) => {
  const shouts = [...t.matchAll(/echo\s+"?\s*(E\d{3}|ERR[_A-Z]*|[A-Z_]{6,}:)\s/g)].map((m) => m[1]);
  return shouts.length === 0 || `machine-shaped message(s): ${shouts.join(", ")}`;
});
// ── 13 · it does not fight the person's own machine (3 + 3) ───────────────────────────────────
eachHelper("uses its own browser profile, so it cannot disturb anybody's tabs", (t) => /user-data-dir/.test(t) || "no separate profile");
eachStation("uses its own browser profile", (t) => /user-data-dir/.test(t) || "no separate profile");
eachStation("prints silently, and is NOT full-screen kiosk", (t) =>
  (/--kiosk-printing/.test(t) && !/--kiosk\b(?!-)/.test(t)) || "either silent printing is gone or it went full-screen kiosk again");
eachStation("carries the three flags that stop a hidden window being throttled", (t) => {
  const want = ["--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"];
  const miss = want.filter((f) => !t.includes(f));
  return miss.length === 0 || `missing ${miss.join(", ")} — a throttled panel stops polling and the tickets just queue`;
});
// ── 14 · the file a person is told to save (6) ────────────────────────────────────────────────
row(id(), "every helper filename has the extension its OS needs to double-click", () => {
  const want = { mac: ".command", windows: ".bat", linux: ".sh" };
  const bad = OSES.filter((o) => !HELPER_FILENAME[o].endsWith(want[o]));
  return bad.length === 0 || `${bad.join(", ")}`;
});
row(id(), "…and every station filename does too", () => {
  const want = { mac: ".command", windows: ".bat", linux: ".sh" };
  const bad = OSES.filter((o) => !STATION_FILENAME[o].endsWith(want[o]));
  return bad.length === 0 || `${bad.join(", ")}`;
});
row(id(), "the two files are never given the same name on any OS", () => {
  const clash = OSES.filter((o) => HELPER_FILENAME[o] === STATION_FILENAME[o]);
  return clash.length === 0 || `same name on ${clash.join(", ")} — one would overwrite the other on the Desktop`;
});
row(id(), "STATION_FIRST_RUN tells the person to sign in, on every OS", () => {
  const bad = OSES.filter((o) => !/sign in/i.test(STATION_FIRST_RUN[o] || ""));
  return bad.length === 0 || `${bad.join(", ")} does not mention signing in`;
});
each("mentions no downloaded starter file — the standing by-hand-only decision", (t) => {
  const bad = /print-station\/|api\/print-station|Download the|⬇/.test(t);
  return !bad || "the file points at a download, which macOS blocks outright";
});
// ── 15 · the pairing flow (3) ─────────────────────────────────────────────────────────────────
eachHelper("pairs itself: describes the machine, opens a page, waits for Allow", (t) => {
  const has = /pair\/start/.test(t) && /pair\/poll/.test(t) && /ALLOW/i.test(t);
  return has || "the zero-typing pairing flow is incomplete";
});
eachHelper("gives up pairing after a bounded wait rather than looping for ever", (t) =>
  /200/.test(t) && /(expired|Nobody pressed Allow)/i.test(t) || "the pairing loop has no ceiling or no expiry message");
eachHelper("reports its own printers so nobody types a printer name", (t) =>
  /printers/.test(t) && /(lpstat|Get-Printer)/.test(t) || "the machine no longer reports its printers");
eachHelper("…and asks the machine for the PAPER SIZE where it can", (t) =>
  /(PaperDimension|PaperSizeWidth)/.test(t) || "the paper size is no longer read from the machine");

// ── 16 · THE DISCOVERY, RUN FOR REAL (4) ──────────────────────────────────────────────────────
// Not read — EXECUTED. This machine has two real POS-80 thermal queues in CUPS, so the Mac and
// Linux printers_json() bodies can be pulled out of the generated script and run as themselves.
// No sweep had done this: every previous row about printer discovery read the source.
const runDiscovery = (os) => {
  const t = H[os];
  const i = t.indexOf("printers_json() {");
  const j = t.indexOf("\n}", i) + 2;
  const f = pjoin(tmpdir(), `t11-pj-${os}.sh`);
  writeFileSync(f, t.slice(i, j) + "\nprinters_json\n");
  return execFileSync("/bin/sh", [f], { encoding: "utf8" }).trim();
};
let discovered = null;
row(id(), "the Mac helper's printer discovery, RUN on this machine, emits valid JSON", () => {
  const out = runDiscovery("mac");
  discovered = JSON.parse(out);   // throws → the row fails with the parse error, which is the point
  return Array.isArray(discovered) || `parsed to ${typeof discovered}`;
});
row(id(), "…and every printer it found carries a name and a paper size in millimetres", () => {
  if (!discovered || !discovered.length) return "no printers on this machine — re-run where there are some";
  const bad = discovered.filter((p) => !p.name || !p.paper || !(p.paper.wMm > 0) || !(p.paper.hMm > 0));
  return bad.length === 0 || `${bad.length} of ${discovered.length} incomplete: ${JSON.stringify(bad[0])}`;
});
row(id(), "…and the LINUX script reports exactly the same thing against the same CUPS", () => {
  const mac = runDiscovery("mac"), linux = runDiscovery("linux");
  return mac === linux || `mac  ${mac}\n        linux ${linux}`;
});
row(id(), "…and the server ACCEPTS what the machine reported (asPaper's sanity range)", async () => {
  if (!discovered || !discovered.length) return "no printers to offer the server";
  const { helperScript: _ } = { helperScript };   // keep the import used
  // asPaper refuses anything outside 20-500mm wide and 20-3600mm long: a real roll must pass.
  const bad = discovered.filter((p) => !(p.paper.wMm >= 20 && p.paper.wMm <= 500 && p.paper.hMm >= 20 && p.paper.hMm <= 3600));
  return bad.length === 0 || `the server would DISCARD ${bad.length} real printer(s): ${JSON.stringify(bad[0].paper)}`;
});
