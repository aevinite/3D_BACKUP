#!/usr/bin/env node
// verify-print-documents.mjs — THE PAPER, AND EVERY SENTENCE THAT DESCRIBES IT.
//
// Owner, 2026-09-04, after twenty items were found on the printing feature by a separate pass:
// *"plan 500 phases test within your boundaries … test everything again if any error left and check
// every possiblity if any error is remaining which can cause problem latter."*
//
// WHY A SECOND SWEEP RATHER THAN MORE PHASES IN THE FIRST ONE. verify:printing-sweep (501 phases)
// tests the PLUMBING: who may print, what the queue does, whether paper reaches a printer. Almost
// every one of those twenty items was somewhere else entirely:
//
//   · a FIGURE on the paper that was right in total and wrong in its parts (a ₹0 tax component)
//   · two DATE formats and two RATE formats on one sheet
//   · SENTENCES describing controls that had been deleted — in the app, in the engineering record,
//     and in the page a paying client opens while standing at a printer
//   · a generated LAUNCHER whose check could never be true, on an operating system nobody here has
//   · a control off the side of a PHONE screen
//   · DEAD code and dead fields that still read as handled
//
// Those are six different classes and none of them is "does printing work". So this file asks the
// questions that class of fault answers to, and it is deliberately blunt about its limits: it proves
// properties of the GENERATED TEXT and of the RENDERED DOCUMENT, both of which are things this
// machine can hold. It cannot watch a Windows shop print. Where that is the honest answer, the phase
// says so out loud rather than passing quietly (see §D).
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; } };
// Judge CODE, not the note about the code. Every fix in this repo leaves a dated obituary quoting the
// string it removed, so a plain grep for an old string matches the record of its own removal — which
// is how four of this sweep's own findings were first mis-read as "not done".
// KEEP THE LINE COUNT. Collapsing a /* … */ block to one space shifts every line number after it, so
// a phase that reports "line 182 writes and never looks" names a line that is a comment in the real
// file — which is how the first run of §E accused seven type declarations of being database writes.
// Blanking the block but keeping its newlines means a reported number is the number a person can open.
const blankKeepingLines = (src, re) => String(src).replace(re, (m) => m.replace(/[^\n]/g, " "));
const code = (s) => {
  let out = String(s);
  out = blankKeepingLines(out, /\{\/\*[\s\S]*?\*\/\}/g);
  out = blankKeepingLines(out, /\/\*[\s\S]*?\*\//g);
  return out.split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "").replace(/^\s*#(?!!).*$/, "")).join("\n");
};
// Prose files (.md/.html) keep their comments — the prose IS the thing under test — but an explicitly
// dated "this used to say" note is evidence of a decision, not a live claim, so it is excused.
// A DATED NOTE IS A BLOCK, NOT A LINE. The first version dropped only the line carrying the ⚠️, so
// the note's CONTINUATION lines survived — and the guard then reported the engineering record as
// still naming two deleted controls when the record was correct and saying so. It drops from the
// marker to the end of that paragraph now.
const liveProse = (s) => {
  const out = [];
  let inNote = false;
  for (const l of String(s).split("\n")) {
    /* THE MARKER SET IS DELIBERATELY BROAD, because a narrow one reports the RECORD of a removal as
       the removal not having happened — which it did twice on its first run: "…AND IT NO LONGER
       POINTS AT A TOGGLE THAT IS NOT THERE" and "It used to ask every screen …" were both read as
       live claims. "used to" and "no longer" are about as strong a signal of an obituary as prose
       gets, and a dated sweep stamp is stronger still. */
    if (/⚠️|used to\b|no longer\b|NONE of that exists|was retired|obituary|it said "|this said|\b(deleted|removed|retired)\b[^.\n]{0,40}\b20\d\d-\d\d-\d\d/i.test(l)) { inNote = true; continue; }
    if (inNote) { if (l.trim() === "") inNote = false; continue; }
    out.push(l);
  }
  return out.join("\n");
};

let n = 0, pass = 0, fail = 0, skip = 0;
const fails = [];
const P = (label, fn) => {
  n++;
  let r;
  try { r = fn(); } catch (e) { r = "threw " + e.message; }
  if (r === true) { pass++; return; }
  if (typeof r === "string" && r.startsWith("skip:")) { skip++; console.log(`  ⃘  ${n}  ${label} — ${r.slice(5).trim()}`); return; }
  fail++; const msg = `${n} · ${label} → ${r}`; fails.push(msg); console.log(`  ❌ ${msg}`);
};

const BILLDOC = (() => {
  const g = { console, Date, Math, Number, String, JSON, Intl, Object, Array, RegExp, isNaN, parseFloat, parseInt };
  g.globalThis = g;
  try { new Function("globalThis", "console", read("public/panels/billdoc.js")).call(g, g, console); } catch (e) { return { __err: e.message }; }
  return g.LFH_BILLDOC || { __err: "billdoc exported nothing" };
})();

console.log("\nverify:print-documents · the paper, and every sentence that describes it");
console.log("─".repeat(78));

// ══ §A · THE MONEY ON THE PAPER ══════════════════════════════════════════════════════════════
// The ₹0 tax component was right in total and wrong in its parts, and the column footing is exactly
// what hid it. So every check here asks BOTH questions: does it foot, AND is every part honest.
console.log("\n§A · the money on the paper");
P("billdoc.js loads and exports its documents", () =>
  !BILLDOC.__err || `it did not load: ${BILLDOC.__err}`);

const COMPSETS = [
  ["CGST+SGST 5%",   [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }]],
  ["CGST+SGST 12%",  [{ label: "CGST", rate: 6 },   { label: "SGST", rate: 6 }]],
  ["CGST+SGST 18%",  [{ label: "CGST", rate: 9 },   { label: "SGST", rate: 9 }]],
  ["CGST+SGST 28%",  [{ label: "CGST", rate: 14 },  { label: "SGST", rate: 14 }]],
  ["IGST alone",     [{ label: "IGST", rate: 5 }]],
  ["with a cess",    [{ label: "CGST", rate: 14 }, { label: "SGST", rate: 14 }, { label: "CESS", rate: 12 }]],
  ["three equal",    [{ label: "A", rate: 1 }, { label: "B", rate: 1 }, { label: "C", rate: 1 }]],
];
const foots = (rows, t) => Math.abs(rows.reduce((a, r) => a + Number(r.amt), 0) - t) < 1e-9;

for (const [name, comps] of COMPSETS) {
  // the small end, one rupee at a time — this is where the fault lived and nowhere else
  P(`${name}: every tax ₹0–40 foots exactly`, () => {
    for (let t = 0; t <= 40; t++) if (!foots(BILLDOC.splitTax(t, comps), t))
      return `₹${t} does not foot: ${JSON.stringify(BILLDOC.splitTax(t, comps))}`;
    return true;
  });
  P(`${name}: no component prints ₹0 while it collected something`, () => {
    for (let t = 1; t <= 40; t++) {
      const rows = BILLDOC.splitTax(t, comps);
      const sum = comps.reduce((a, c) => a + c.rate, 0);
      for (let i = 0; i < rows.length; i++) {
        const exact = t * (comps[i].rate / sum);
        if (Number(rows[i].amt) <= 0 && exact > 0) return `₹${t}: ${rows[i].label} prints ${rows[i].amt} on ${exact.toFixed(4)} collected`;
      }
    }
    return true;
  });
  P(`${name}: no component ever claims MORE than it collected`, () => {
    for (let t = 1; t <= 400; t++) {
      const rows = BILLDOC.splitTax(t, comps);
      const sum = comps.reduce((a, c) => a + c.rate, 0);
      for (let i = 0; i < rows.length; i++) {
        const exact = t * (comps[i].rate / sum);
        if (Number(rows[i].amt) - exact > 1.0001) return `₹${t}: ${rows[i].label} claims ${rows[i].amt} on ${exact.toFixed(2)} collected`;
      }
    }
    return true;
  });
  P(`${name}: an ordinary bill (₹2–3000 of tax) still prints WHOLE rupees`, () => {
    if (comps.length === 1) return true;                        // nothing to share, never paise
    for (let t = 2; t <= 3000; t++) {
      const rows = BILLDOC.splitTax(t, comps);
      const sum = comps.reduce((a, c) => a + c.rate, 0);
      // REPLICATE THE WHOLE-RUPEE ALGORITHM, do not approximate it. splitTax rounds every component
      // except the LAST and gives the last the remainder, so with three equal parts at ₹2 the last
      // one lands on 0 — genuinely unrepresentable, and paise is the right answer there. Rounding
      // each component independently (the first version of this line) says ₹2 is fine and then
      // condemns the code for doing the correct thing.
      let wr = 0;
      const wholeAlg = comps.map((c, i) => {
        const amt = i === comps.length - 1 ? (t - wr) : Math.round(t * (c.rate / sum));
        wr += amt; return amt;
      });
      const unrepresentable = wholeAlg.some((amt, i) => amt <= 0 && t * (comps[i].rate / sum) > 0);
      if (!unrepresentable && rows.some((r) => r.paise))
        return `₹${t} switched to paise when whole rupees could have carried it`;
    }
    return true;
  });
  P(`${name}: the big end (₹5k–₹500k of tax) foots and stays whole`, () => {
    for (let t = 5000; t <= 500000; t += 977) {
      const rows = BILLDOC.splitTax(t, comps);
      if (!foots(rows, t)) return `₹${t} does not foot`;
      if (rows.some((r) => r.paise)) return `₹${t} printed paise, which no large bill should`;
    }
    return true;
  });
}
// the PAPER, not just the numbers — a rendered bill has to agree with its own rows
const renderBill = (sub, disc, taxRows, total) => String(BILLDOC.billDocHtml({
  name: "T", lines: [{ title: "X", qty: 1, price: sub }],
  subtotal: sub, discount: disc, taxable: Math.max(0, sub - disc), total, taxRows,
}) || "");
const taxCellsOf = (html) => [...html.matchAll(/<div class="t"><span>([^<]*)<\/span><span>₹([^<]*)<\/span><\/div>/g)]
  .filter((m) => /CGST|SGST|IGST|CESS|\bA\b|\bB\b|\bC\b/.test(m[1]))
  .map((m) => Number(String(m[2]).replace(/,/g, "")));
for (const [name, comps] of COMPSETS) {
  P(`${name}: the printed rows sum to the printed tax, for 30 real bills`, () => {
    for (let sub = 19; sub < 19 + 30 * 37; sub += 37) {
      const rate = comps.reduce((a, c) => a + c.rate, 0) / 100;
      const t = Math.round(sub * rate);
      const rows = BILLDOC.splitTax(t, comps);
      const cells = taxCellsOf(renderBill(sub, 0, rows, sub + t));
      if (cells.length !== rows.length) return `₹${sub}: printed ${cells.length} tax lines for ${rows.length} components`;
      if (Math.abs(cells.reduce((a, v) => a + v, 0) - t) > 0.001) return `₹${sub}: printed lines sum to ${cells.reduce((a,v)=>a+v,0)} not ${t}`;
    }
    return true;
  });
  P(`${name}: and NO printed tax line reads ₹0`, () => {
    for (let sub = 5; sub < 5 + 40 * 11; sub += 11) {
      const rate = comps.reduce((a, c) => a + c.rate, 0) / 100;
      const t = Math.round(sub * rate);
      if (t <= 0) continue;
      const cells = taxCellsOf(renderBill(sub, 0, BILLDOC.splitTax(t, comps), sub + t));
      if (cells.some((v) => v === 0)) return `a ₹${sub} bill printed a ₹0 tax line: ${JSON.stringify(cells)}`;
    }
    return true;
  });
}
// discounts, every percentage he offers, before tax
for (const pct of [5, 10, 15, 20, 25, 30, 50]) {
  P(`a ${pct}% discount: the bill still foots at every subtotal ₹100–₹900`, () => {
    const comps = COMPSETS[0][1];
    for (let sub = 100; sub <= 900; sub += 7) {
      const disc = Math.round(sub * pct / 100);
      const taxable = sub - disc;
      const t = Math.round(taxable * 0.05);
      const rows = BILLDOC.splitTax(t, comps);
      if (!foots(rows, t)) return `₹${sub} −${pct}%: tax rows do not foot`;
      const cells = taxCellsOf(renderBill(sub, disc, rows, taxable + t));
      if (cells.length && Math.abs(cells.reduce((a, v) => a + v, 0) - t) > 0.001)
        return `₹${sub} −${pct}%: printed ${cells.reduce((a,v)=>a+v,0)} not ${t}`;
    }
    return true;
  });
}

// ══ §B · ONE FORMAT PER DOCUMENT ═════════════════════════════════════════════════════════════
// Two date formats and two rate formats sat on the banquet sheet for as long as it existed. Nothing
// broke, which is why nothing caught it — so these ask the question a reader asks, not the compiler.
console.log("\n§B · one format per document");
const BD = code(read("public/panels/billdoc.js"));
P("the sheet has ONE date separator, not dashes in one place and slashes in another", () => {
  const dash = /toLocaleDateString\([^)]*\)\s*\.replace\(\/\\\/\/g,\s*"-"\)/.test(BD);
  return !dash || "a date is being re-punctuated to dashes while the sheet's other dates use slashes";
});
P("a RATE is not formatted with the money formatter", () =>
  !/\$\{bq2\((?:c\.)?rate\)\}%/.test(BD) || "bq2() is the 2-decimal MONEY formatter — on a rate it prints \"2.50%\" beside a money box saying \"2.5%\"");
P("there is a single rate formatter, and it drops a pointless trailing zero", () =>
  /bqRate\s*=/.test(BD) || "no one rule for a percentage, so two places can format it differently again");
for (const [v, want] of [[5, "5"], [2.5, "2.5"], [9, "9"], [18, "18"], [2.25, "2.25"], [0, "0"]]) {
  P(`a rate of ${v} prints as "${want}%"`, () => {
    const f = (nn) => { const p = Math.round((Number(nn) || 0) * 100) / 100; return p % 1 === 0 ? p.toFixed(0) : String(p); };
    return f(v) === want || `it prints "${f(v)}%"`;
  });
}
// every document must be pinned to the restaurant's clock, not the reader's
for (const [what, file] of [["the bill and banquet sheet", "public/panels/billdoc.js"], ["the admin print log", "app/aevinite/printing/page.tsx"]]) {
  P(`${what} formats dates in the restaurant's own time zone`, () => {
    const src = code(read(file));
    // toLocaleString() on a NUMBER is the money formatter and has no business with a time zone; the
    // first version matched it and reported five money calls as unpinned dates.
    const calls = [...src.matchAll(/toLocale(?:Date|Time)String\(([^;]*?)\)/g)].map((m) => m[1]);
    const naked = calls.filter((c) => !/timeZone/.test(c));
    return naked.length === 0 || `${naked.length} date/time call(s) let the reader's laptop choose the zone: ${naked[0].slice(0, 70)}`;
  });
}

// ══ §C · NO SENTENCE DESCRIBES A CONTROL THAT WAS DELETED ════════════════════════════════════
// Four of the twenty items were this, in four different files, and one of them is the page a paying
// client opens while standing at a printer. Prose outlives decisions unless something asks.
console.log("\n§C · no sentence describes a deleted control");
const GONE = [
  ["a mechanism toggle",            /the toggle below picks one|toggle below|pick one[\s\S]{0,40}mode/i],
  ["the retired coarse setting",    /Which screen prints the ticket\?/i],
  ["\"both — the counter is the backup\"", /counter is the backup/i],
  ["a 30-second backup",            /30\s*(?:s|sec|seconds)\)?\s*backup|backup[^.]{0,20}30\s*second/i],
  ["the per-device Tables strip",   /strip on the manager'?s Tables|Should this screen print the kitchen tickets\?/i],
  ["\"MODE B\"",                    /\bMODE B\b/],
];
const PROSE = [
  ["the admin Printing screen", "app/aevinite/printing/page.tsx", true],
  ["the manager panel",         "public/panels/editor/app.js",   true],
  ["the kitchen panel",         "public/panels/kitchen/app.js",  true],
  ["the station launcher",      "lib/printStationScript.ts",     true],
  ["the helper launcher",       "lib/printHelperScript.ts",      true],
  ["the engineering record",    "docs/KITCHEN-PRINT-SETUP.md",   false],
  ["the print-helper record",   "docs/PRINT-HELPER.md",          false],
  ["the client's own guide",    "public/print-setup.html",       false],
];
/* ⚠️ A CODE FILE'S COMMENTS ARE ALSO UNDER TEST, and the first version of this loop missed the very
   item that prompted it. It judged code files by their COMMENT-STRIPPED source, so a file header
   saying "MODE B: the restaurant's own Chrome does the printing" — item 24, a stale self-description
   on a live file — sailed through. Sabotage proved it: appending `// MODE B` changed nothing.

   So a code file is asked twice. Its LIVE CODE must not name a deleted control (a rendered sentence,
   a branch), and its PROSE must not either — with dated obituaries excluded, because "this used to
   say X" is the record of a decision and is the one place X is supposed to appear. */
for (const [where, file, isCode] of PROSE) {
  const raw = read(file);
  if (!raw) { P(`${where} exists`, () => `skip: ${file} is not in this tree`); continue; }
  const asCode = isCode ? code(raw) : liveProse(raw);
  const asProse = isCode ? liveProse(raw) : "";
  for (const [what, re] of GONE) {
    P(`${where} does not name ${what}`, () =>
      !re.test(asCode) || `it still does, in live code: ${(asCode.match(re) || [""])[0].slice(0, 60)}`);
    if (isCode) {
      P(`…and ${where} does not DESCRIBE itself with ${what}`, () =>
        !re.test(asProse) || `a comment still says it, outside any dated note: ${(asProse.match(re) || [""])[0].slice(0, 60)}`);
    }
  }
}
// dead FIELDS, which is how item 8 survived four days after the feature went
for (const dead of ["backupPanel", "backupPrinter", "backupAgent", "backupAfterMs", "kot_print_target", "printing.mode", "printerStripHtml", "printStationStripHtml"]) {
  P(`no live code reads or writes \`${dead}\``, () => {
    const hits = [];
    for (const [where, file, isCode] of PROSE) {
      if (!isCode) continue;
      if (new RegExp(dead.replace(".", "\\.")).test(code(read(file)))) hits.push(where);
    }
    for (const f of ["lib/printHelpers.ts", "lib/printQueue.ts", "lib/printBoard.ts", "app/api/editor/[...path]/route.ts",
                     "app/api/kitchen/[...path]/route.ts", "app/api/admin/printing/[...path]/route.ts", "app/api/owner/settings/route.ts"]) {
      if (new RegExp(dead.replace(".", "\\.")).test(code(read(f)))) hits.push(f);
    }
    return hits.length === 0 || `still live in: ${hits.join(", ")}`;
  });
}
// every "step N" the screen quotes must name the step that really holds it
P("every \"step N\" on the Printing screen points at the right card", () => {
  const words = read("lib/printBoardWords.ts");
  const steps = Object.fromEntries([...words.matchAll(/(\w+):\s*"(\d+)\s*·\s*([^"]+)"/g)].map((m) => [m[1], { no: m[2], title: m[3] }]));
  const src = read("app/aevinite/printing/page.tsx");
  const refs = [...code(src).matchAll(/in step (\d+)|up in step (\d+)/g)].map((m) => m[1] || m[2]);
  if (!refs.length) return true;
  const computerNo = steps.two?.no, dropdownNo = steps.three?.no;
  const bad = refs.filter((r) => r !== computerNo && r !== dropdownNo);
  return bad.length === 0 || `points at step(s) ${bad.join(", ")} while the computer is step ${computerNo} and the dropdowns are step ${dropdownNo}`;
});
// a numbered checklist that goes 1,2,3,4,5,6,6 (item 10's own symptom)
for (const doc of ["docs/KITCHEN-PRINT-SETUP.md", "docs/PRINT-HELPER.md", "docs/PRINT-HELPER.md"]) {
  P(`${doc}'s numbered lists count without repeating`, () => {
    const src = read(doc);
    if (!src) return `skip: not in this tree`;
    const runs = [];
    let cur = [];
    for (const l of src.split("\n")) {
      const m = l.match(/^\s{0,3}(\d+)[.)]\s/);
      if (m) cur.push(Number(m[1]));
      else if (cur.length) { runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
    for (const r of runs.filter((x) => x.length >= 3)) {
      for (let i = 1; i < r.length; i++) if (r[i] === r[i - 1]) return `a list repeats ${r[i]}: ${r.join(",")}`;
    }
    return true;
  });
}

// ══ §D · EVERY LAUNCHER, EVERY OPERATING SYSTEM ══════════════════════════════════════════════
// Item 12 was a Windows comparison that could never be true, found by walking the GENERATED FILE for
// a pattern — no Windows machine involved. That is the boundary this section works inside, and it
// says so: these are properties of the text, and a property of the text is a real thing to hold.
console.log("\n§D · every launcher, every operating system");
const HELPER = read("lib/printHelperScript.ts");
const STATION = read("lib/printStationScript.ts");
P("both launcher builders exist", () => (!!HELPER && !!STATION) || "one of the two generators is missing");
for (const [what, src] of [["the helper", HELPER], ["the print station", STATION]]) {
  for (const os of ["mac", "windows", "linux"]) {
    P(`${what} has a ${os} branch`, () =>
      new RegExp(`${os}\\s*[:(]`).test(src) || `no ${os} branch — that shop has no file to type`);
  }
  P(`${what}'s Windows file compares no variable it expands too early`, () => {
    /* THE ITEM-12 FAULT, STATED EXACTLY. cmd.exe expands `%X%` when it PARSES a statement, and a
       parenthesised block is parsed as ONE statement — so a `%X%` compare INSIDE a block that also
       SETS X compares against the value from before the block ran, always. That is what made a
       Windows shop's PDF check fail every time and delete its own download.

       "Same block" is the whole rule and the first version of this phase ignored it: it flagged any
       compare of any variable set anywhere in the file, which condemned two lines that are correct —
       `if "%ID%"==""` and `if "%PC%"==""` are both TOP-LEVEL statements after their `for /f ... do
       set` lines, and a top-level `%VAR%` is parsed fresh. A guard that cries wolf on right code gets
       switched off, so it counts brackets now. */
    const win = (src.match(/const windows[\s\S]*?`;/) || [""])[0];
    if (!win) return true;
    const lines = win.split("\n");
    const depthBefore = [];
    let d = 0;
    for (const l of lines) {
      depthBefore.push(d);
      d += (l.match(/\(/g) || []).length - (l.match(/\)/g) || []).length;
    }
    const offenders = [];
    lines.forEach((l, i) => {
      const m = l.match(/if\s+"%([A-Za-z_]+)%"\s*==/);
      if (!m || depthBefore[i] <= 0) return;                 // top level: parsed fresh, so it is fine
      // walk back to the line that opened the block this compare sits in
      let j = i, want = depthBefore[i];
      while (j > 0 && depthBefore[j] >= want) j--;
      const block = lines.slice(j, i).join("\n");
      if (new RegExp(`set\\s+"?${m[1]}=`, "i").test(block)) offenders.push(m[1]);
    });
    return offenders.length === 0
      || `%${offenders[0]}% is compared with plain %..% inside the same block that SETS it — cmd.exe expands that at parse time, so it can never be true. Use !${offenders[0]}! with delayed expansion.`;
  });
  P(`${what}'s Windows file turns delayed expansion ON if it needs it`, () => {
    const win = (src.match(/const windows[\s\S]*?`;/) || [""])[0];
    if (!/![A-Za-z_]+!/.test(win)) return true;                    // does not use it, does not need it
    return /enabledelayedexpansion/i.test(win) || "it uses !VAR! without `setlocal enabledelayedexpansion`, so the ! is printed literally";
  });
  P(`${what} names the ONE line a shop may edit, on every system`, () =>
    (src.match(/may change|YOU MAY CHANGE|change this/gi) || []).length >= 1
    || "nothing tells a shop where the web address is, so pointing it at another site means remaking the file");
  P(`${what} writes a log somewhere on every system`, () => {
    const missing = ["mac", "windows", "linux"].filter((os) => {
      const branch = (src.match(new RegExp(`const ${os}[\\s\\S]*?\`;`)) || [""])[0];
      return branch && !/LOG|log/.test(branch);
    });
    return missing.length === 0 || `${missing.join(", ")} write no log, so "did it ever start on that PC?" has no answer on the machine`;
  });
}
P("the station steps aside when one is already running (mac and linux at least)", () => {
  const have = ["mac", "linux"].filter((os) => {
    const b = (STATION.match(new RegExp(`const ${os}[\\s\\S]*?\`;`)) || [""])[0];
    return /already|pgrep|lock/i.test(b);
  });
  return have.length === 2 || `only ${have.join(", ") || "none"} guard against a second copy, and two copies on one profile means Chrome raises a window`;
});
P("…and Windows' lack of that guard is a WRITTEN limit, not an oversight", () => {
  const b = (STATION.match(/const windows[\s\S]*?`;/) || [""])[0];
  const guarded = /already|tasklist|lock/i.test(b);
  const written = /batch file cannot|cannot hold a lock|no guard|deliberately/i.test(STATION);
  return guarded || written || "Windows has no already-running guard and nothing says why — so it reads as forgotten rather than known";
});
P("the helper discovers the paper size on Linux, not only on the Mac", () =>
  /lpoptions[^\n]*PageSize|PageSize[^\n]*lpoptions/.test(HELPER) || /sed -n 's\/\^PageSize/.test(HELPER)
  || "Linux reports no paper size, so a Pi shop has to type its own millimetres — and a page that disagrees with the paper prints sideways");
P("…and it reports the printer's WHOLE model name, not the first word", () =>
  /printer-make-and-model/.test(HELPER) || "the model is being split on spaces, so \"Zijiang ZJ-80\" arrives as \"Zijiang\"");
P("a Windows shop's PDF step cannot silently delete its own download", () => {
  const win = (STATION.match(/const windows[\s\S]*?`;/) || [""])[0] + (HELPER.match(/const windows[\s\S]*?`;/) || [""])[0];
  if (!/del\s|erase\s/i.test(win)) return true;
  return /!.*!|enabledelayedexpansion/i.test(win)
    || "it deletes the download inside a block whose test uses parse-time expansion — the check fails, the file goes, and the shop is told to check the internet forever";
});
P("no launcher carries a password or a token", () => {
  // THE GENERATED FILE, NOT THE SOURCE'S PROSE. Both builders carry a comment saying "what is NOT in
  // this file, on purpose: any password" — and the first version of this check read that sentence and
  // reported a leak. What a shop actually types out is the template literals.
  const templates = [HELPER, STATION].flatMap((src) =>
    [...String(src).matchAll(/`([\s\S]*?)`/g)].map((m) => m[1])).join("\n");
  const bad = ["service_role", "sbp_", "Bearer "].filter((w) => templates.includes(w));
  if (/password\s*[:=]/i.test(templates)) bad.push("a password assignment");
  return bad.length === 0 || `a generated launcher contains ${bad.join(", ")} — these are files that sit on a shop counter`;
});
P("Windows print-completion is either followed or its absence is written down", () => {
  const win = (HELPER.match(/const windows[\s\S]*?`;/) || [""])[0];
  const follows = /Get-PrintJob|wmic[^\n]*printjob|queue/i.test(win);
  const written = /WINDOWS DOES NOT FOLLOW THE JOB TO COMPLETION/i.test(HELPER);
  if (follows) return true;
  return written
    ? "skip: Windows does not follow the job to completion and the file says so — it needs a Windows machine with a printer to fix honestly"
    : "Windows trusts an exit code and reports PRINTED with no paper, and nothing says so";
});

// ══ §E · NOTHING DEAD, AND NO WRITE NOBODY LOOKS AT ══════════════════════════════════════════
console.log("\n§E · nothing dead, and no write nobody looks at");
P("the Printing screen has no unused import or value", () => {
  try {
    const out = execFileSync("npx", ["eslint", "app/aevinite/printing/page.tsx", "-f", "json"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const msgs = JSON.parse(out).flatMap((f) => f.messages || []).filter((m) => /no-unused-vars/.test(m.ruleId || ""));
    return msgs.length === 0 || `${msgs.length} unused: ${msgs.map((m) => m.message).join("; ").slice(0, 120)}`;
  } catch { return "skip: eslint could not run here"; }
});
for (const f of ["lib/printQueue.ts", "lib/printHelpers.ts"]) {
  P(`${f}: every database write reads its own error`, () => {
    const src = code(read(f));
    const lines = src.split("\n");
    const bare = [];
    lines.forEach((l, i) => {
      if (!/\.(update|insert|upsert|delete)\(/.test(l)) return;
      // NOT EVERY .update() IS A DATABASE WRITE. createHash(…).update(…) is a hash being fed, and the
      // first run of this phase reported one as an unchecked write.
      if (/createHash|createHmac|\bhash\b/i.test(l)) return;
      // FOUR LEGITIMATE WAYS TO LOOK, all of them in this codebase already, and the first version of
      // this phase knew only one of them — so it condemned four correct writes:
      //   · wrote(…)            the shared teller
      //   · assigned + .error   `const ins = await …insert(); if (ins.error) …`
      //   · .select(…)          the write RETURNS its rows and the caller uses them (a claim)
      //   · inside a try{}      best-effort on purpose, e.g. a breadcrumb that must never break a print
      /* THE WINDOW MUST NOT LEAVE THE FUNCTION, and the first version did — which made this phase
         useless for the one write it was written for. syncKotSwitch's write is the last line of its
         function, and eight lines later sits `waitingCount`, whose `.select(` the check happily read
         as "somebody looked". Sabotage caught it: removing wrote() changed nothing.
         So the window stops at the closing brace, and the backward one stops at the declaration. */
      let end = i + 1;
      while (end < lines.length && end < i + 12 && !/^\}/.test(lines[end])) end++;
      const after = lines.slice(i, end).join(" ");
      let start = i;
      while (start > 0 && start > i - 25 && !/^(export\s+)?(async\s+)?function|^const\s+\w+\s*=/.test(lines[start])) start--;
      const before = lines.slice(start, i + 1).join(" ");
      if (/wrote\(/.test(before + " " + after)) return;
      if (/\.select\(/.test(after)) return;
      if (/(const|let|var)\s+\w+\s*=\s*await/.test(before) && /\.error/.test(after)) return;
      if (/\.error/.test(after)) return;
      // an enclosing try{} — scan back for one that is still open at this line
      let depth = 0, inTry = false;
      for (let j = i; j >= 0 && j > i - 60; j--) {
        depth += (lines[j].match(/\}/g) || []).length - (lines[j].match(/\{/g) || []).length;
        if (/\btry\s*\{/.test(lines[j]) && depth <= 0) { inTry = true; break; }
      }
      if (inTry) return;
      bare.push(i + 1);
    });
    return bare.length === 0
      || `line(s) ${bare.join(", ")} write and never look — a failed write there means a board says something untrue and nothing says why`;
  });
}
P("the one write-checker is shared, not copied", () => {
  const q = read("lib/printQueue.ts"), h = read("lib/printHelpers.ts");
  const both = /const wrote = async/.test(q) && /const wrote = async/.test(h);
  return !both || "each file grew its own wrote() — two tellers drift in what they report";
});

// ══ §F · THE NARROW SCREEN ═══════════════════════════════════════════════════════════════════
// Item 15 was a control at 381→480 in a 360-wide screen, with the page reporting no sideways scroll,
// so there was nothing to scroll to it and nothing hinting it existed.
console.log("\n§F · the narrow screen");
const CSS = read("app/globals.css");
P("the Printing screen's heading controls are allowed to wrap", () =>
  /adm-print-head|\.adm-head[^{]*\{[^}]*flex-wrap/.test(CSS) || /flexWrap/.test(read("app/aevinite/printing/page.tsx"))
  || "the control group cannot wrap, so on a phone the last control sits off the side of the screen with no way to reach it");

// ══ §H · THE KITCHEN TICKET, EVERY SHAPE A REAL SERVICE PRODUCES ═════════════════════════════
// The bill gets most of the attention because it carries money. The ticket is the paper a cook
// actually works from, and a ticket that renders wrong is food cooked wrong — so every shape a real
// service produces is built here and read.
console.log("\n§H · the kitchen ticket, every shape");
const KOTS = [
  ["a plain dine-in ticket",        { rname: "R", kot: 1, table: "6", lines: [{ qty: 2, title: "Dal" }] }],
  ["a single item",                 { rname: "R", kot: 2, table: "1", lines: [{ qty: 1, title: "Chai" }] }],
  ["twenty items",                  { rname: "R", kot: 3, table: "9", lines: Array.from({ length: 20 }, (_, i) => ({ qty: i + 1, title: "Dish " + (i + 1) })) }],
  ["a reprint",                     { rname: "R", kot: 4, table: "2", reprint: true, lines: [{ qty: 1, title: "Naan" }] }],
  ["a parcel",                      { rname: "R", kot: 5, parcel: true, lines: [{ qty: 3, title: "Biryani" }] }],
  ["a ZOMATO order",                { rname: "R", kot: 6, source: "zomato", lines: [{ qty: 1, title: "Roll" }] }],
  ["a SWIGGY order",                { rname: "R", kot: 7, source: "swiggy", lines: [{ qty: 1, title: "Wrap" }] }],
  ["a WEBSITE order",               { rname: "R", kot: 8, source: "website", lines: [{ qty: 1, title: "Pizza" }] }],
  ["a merged party",                { rname: "R", kot: 9, table: "6 + 7", lines: [{ qty: 4, title: "Thali" }] }],
  ["an item with a note",           { rname: "R", kot: 10, table: "3", lines: [{ qty: 1, title: "Paneer", note: "no chilli" }] }],
  ["an item with add-ons",          { rname: "R", kot: 11, table: "4", lines: [{ qty: 1, title: "Dosa", opts: ["extra chutney", "no onion"] }] }],
  ["an allergy warning",            { rname: "R", kot: 12, table: "5", allergies: ["peanut"], lines: [{ qty: 1, title: "Korma" }] }],
  ["a whole-ticket note",           { rname: "R", kot: 13, table: "8", note: "birthday — bring candle", lines: [{ qty: 1, title: "Cake" }] }],
  ["Hindi dish names",              { rname: "R", kot: 14, table: "2", lines: [{ qty: 1, title: "पनीर टिक्का" }, { qty: 2, title: "दाल मखनी" }] }],
  ["Gujarati dish names",           { rname: "R", kot: 15, table: "2", lines: [{ qty: 1, title: "ઢોકળા" }] }],
  ["a very long dish name",         { rname: "R", kot: 16, table: "7", lines: [{ qty: 1, title: "X".repeat(160) }] }],
  ["a very long table name",        { rname: "R", kot: 17, table: "Garden terrace table number twenty-two", lines: [{ qty: 1, title: "Tea" }] }],
  ["no table at all",               { rname: "R", kot: 18, lines: [{ qty: 1, title: "Walk-in" }] }],
  ["a qty of zero",                 { rname: "R", kot: 19, table: "1", lines: [{ qty: 0, title: "Cancelled dish" }] }],
  ["a large qty",                   { rname: "R", kot: 20, table: "1", lines: [{ qty: 250, title: "Thali" }] }],
  ["a KOT number of zero",          { rname: "R", kot: 0, table: "1", lines: [{ qty: 1, title: "Dal" }] }],
  ["a very large KOT number",       { rname: "R", kot: 999999, table: "1", lines: [{ qty: 1, title: "Dal" }] }],
  ["no KOT number at all",          { rname: "R", table: "1", lines: [{ qty: 1, title: "Dal" }] }],
  ["a dish with a quote in it",     { rname: "R", kot: 21, table: "1", lines: [{ qty: 1, title: 'Chef\'s "special"' }] }],
  ["a dish named like markup",      { rname: "R", kot: 22, table: "1", lines: [{ qty: 1, title: "<script>alert(1)</script>" }] }],
  ["an emoji dish",                 { rname: "R", kot: 23, table: "1", lines: [{ qty: 1, title: "🍛 Curry" }] }],
  ["several notes at once",         { rname: "R", kot: 24, table: "1", note: "rush", lines: [{ qty: 1, title: "Dal", note: "no salt" }, { qty: 1, title: "Rice", note: "extra" }] }],
  ["fifty items",                   { rname: "R", kot: 25, table: "1", lines: Array.from({ length: 50 }, (_, i) => ({ qty: 1, title: "Item " + i })) }],
];
// WHAT A PERSON READS ON PAPER, not what the file contains. Both documents embed a <script> (the
// thermal sheet measures its own zoom bar) and a <style>, and the first run of these phases matched
// `v == null` inside that script on eighteen otherwise-perfect bills. A junk check that reads the
// machinery reports the machinery.
const visible = (html) => String(html)
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<!--[\s\S]*?-->/g, " ")
  // <title> is the browser's tab and the print header, not the paper a person is handed. It is
  // excluded so these phases stay about the DOCUMENT; a junk value reaching a title is a caller
  // passing something absurd, and the paper itself is what this file is for.
  .replace(/<title>[\s\S]*?<\/title>/gi, " ");
const NEVER = [
  ["Invalid Date", /Invalid Date/],
  ["NaN",          /\bNaN\b/],
  ["undefined",    /\bundefined\b/],
  ["[object Object]", /\[object Object\]/],
  ["a raw null",   /(^|[>\s])null([<\s]|$)/],
];
const junkIn = (html) => { const v = visible(html); const hit = NEVER.find(([, re]) => re.test(v)); return hit ? hit[0] : null; };
for (const [what, input] of KOTS) {
  P(`${what}: the ticket builds`, () => {
    try { const h = String(BILLDOC.kotDocHtml(input) || ""); return h.length > 0 || "it produced nothing"; }
    catch (e) { return "it threw: " + e.message; }
  });
  P(`${what}: and prints none of ${NEVER.map((x) => x[0]).join(" / ")}`, () => {
    let h = ""; try { h = String(BILLDOC.kotDocHtml(input) || ""); } catch (e) { return "it threw: " + e.message; }
    const hit = junkIn(h);
    return !hit || `it printed ${hit}`;
  });
  P(`${what}: and leaks no unescaped markup`, () => {
    let h = ""; try { h = String(BILLDOC.kotDocHtml(input) || ""); } catch { return true; }
    // a dish called <script> must arrive as text; the only < in the output should open a real tag
    // `<!doctype html>` starts with "!", which the first version of this regex did not match — so
    // every well-formed document was reported as leaking an angle bracket.
    const stray = visible(h).replace(/<!?\/?[a-zA-Z][^>]*>/g, "");
    return !/[<>]/.test(stray) || "an angle bracket survived into the text";
  });
}
P("a reprint is branded, and a first print never is", () => {
  const r = String(BILLDOC.kotDocHtml({ rname: "R", kot: 1, lines: [], reprint: true }) || "");
  const f = String(BILLDOC.kotDocHtml({ rname: "R", kot: 1, lines: [] }) || "");
  if (!/class="rp"|DUPLICATE|Reprint/i.test(r)) return "a reprint carries no banner — a cook can cook the order twice";
  return !/class="rp"|DUPLICATE/i.test(f) || "a FIRST print is branded as a duplicate";
});
P("a ticket with no items says so rather than printing an empty sheet", () =>
  /\(no items\)|no items/i.test(String(BILLDOC.kotDocHtml({ rname: "R", kot: 1, lines: [] }) || "")) || "an empty ticket prints blank paper");

// ══ §I · JUNK IN, SENSE OUT — every document against hostile input ═══════════════════════════
// Every one of these has been a real fault in this product at least once: an unparseable date, a
// number that arrived as a string, a name long enough to break a column. A document is the last
// place a fault can be caught, so it must degrade rather than print nonsense.
console.log("\n§I · junk in, sense out");
const JUNK = [
  ["null", null], ["undefined", undefined], ["an empty string", ""], ["a space", " "],
  ["NaN", NaN], ["Infinity", Infinity], ["minus Infinity", -Infinity],
  ["a negative", -250], ["zero", 0], ["a huge number", 9e15],
  ["a numeric string", "250"], ["a junk string", "abc"], ["a date-ish string", "2026-13-45"],
  ["an object", { a: 1 }], ["an array", [1, 2]], ["true", true], ["false", false],
  ["an emoji", "🍛"], ["right-to-left text", "مرحبا"], ["500 characters", "z".repeat(500)],
  ["a script tag", "<script>alert(1)</script>"], ["an HTML entity", "&amp;"], ["a quote", '"' ],
];
/* FIGURES AND TEXT ARE HELD TO DIFFERENT STANDARDS, on purpose.

   A FIGURE — money, a quantity, a tax rate, a date — genuinely arrives broken: a nullable column, a
   half-configured tax component, an unparseable date string from an import. Those must be sanitised,
   and holding them to it is what found two real faults this run: "KOT #undefined" on the sheet a cook
   works from, and "CGST undefined% ₹0" on a tax invoice.

   A TEXT field — the restaurant's name, a dish title — is a string in every column it comes from. A
   NaN or a bare object landing there is a CALLER passing something impossible, not data going wrong,
   and chasing it would mean coercing every string on every document to defend against a bug that
   would be obvious the moment anyone looked. So text is held to what actually matters: it must not
   throw, and it must not break out of its tag. */
for (const [what, v] of JUNK) {
  P(`a BILL sanitises ${what} in its FIGURES`, () => {
    let h = "";
    try {
      h = String(BILLDOC.billDocHtml({ name: "R", subtotal: v, discount: v, taxable: v, total: v,
        lines: [{ title: "X", qty: v, price: v }],
        taxRows: [{ label: "CGST", rate: v, amt: v }] }) || "");
    } catch (e) { return "it threw: " + e.message; }
    const hit = junkIn(h);
    return !hit || `it printed ${hit}`;
  });
  P(`a TICKET sanitises ${what} in its FIGURES`, () => {
    let h = "";
    try { h = String(BILLDOC.kotDocHtml({ rname: "R", kot: v, table: "4", lines: [{ qty: v, title: "Dal" }] }) || ""); }
    catch (e) { return "it threw: " + e.message; }
    const hit = junkIn(h);
    return !hit || `it printed ${hit}`;
  });
  P(`…and ${what} in a TEXT field neither throws nor breaks out of its tag`, () => {
    let a = "", b = "";
    try {
      a = String(BILLDOC.billDocHtml({ name: v, lines: [{ title: v, qty: 1, price: 10 }],
        subtotal: 10, discount: 0, taxable: 10, total: 10 }) || "");
      b = String(BILLDOC.kotDocHtml({ rname: v, kot: 1, table: v, note: v, lines: [{ qty: 1, title: v }] }) || "");
    } catch (e) { return "it threw: " + e.message; }
    for (const [which, h] of [["the bill", a], ["the ticket", b]]) {
      if (!h) return `${which} produced nothing`;
      const stray = visible(h).replace(/<!?\/?[a-zA-Z][^>]*>/g, "");
      if (/[<>]/.test(stray)) return `${which} let an angle bracket into its text — a dish called "<script>" would not be text`;
    }
    return true;
  });
}

// ══ §J · EVERY TAX SHAPE A RESTAURANT CAN BE ON ══════════════════════════════════════════════
console.log("\n§J · every tax shape a restaurant can be on");
const SHAPES = [
  ["prices with tax ADDED",   { taxRows: true, inclRows: false }],
  ["prices with tax INSIDE",  { taxRows: false, inclRows: true }],
  ["the old all-or-nothing inside flag", { taxRows: true, taxIncluded: true }],
  ["no tax at all (composition)", { taxRows: false, inclRows: false }],
];
for (const [what, shape] of SHAPES) {
  for (const sub of [19, 99, 250, 1340, 9999, 31, 100007]) {
    P(`${what} at ₹${sub}: the document builds and foots`, () => {
      const rate = 0.05;
      const t = Math.round(sub * rate);
      const rows = BILLDOC.splitTax(t, [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }]);
      const d = { name: "R", lines: [{ title: "X", qty: 1, price: sub }], subtotal: sub, discount: 0,
        taxable: sub, total: shape.inclRows ? sub : sub + t };
      if (shape.taxRows) d.taxRows = rows;
      if (shape.inclRows) d.inclRows = rows;
      if (shape.taxIncluded) d.taxIncluded = true;
      let h = ""; try { h = String(BILLDOC.billDocHtml(d) || ""); } catch (e) { return "it threw: " + e.message; }
      if (!h) return "it produced nothing";
      const hit = junkIn(h);
      if (hit) return `it printed ${hit}`;
      const cells = taxCellsOf(h);
      if (cells.length && Math.abs(cells.reduce((a, x) => a + x, 0) - t) > 0.001)
        return `the printed tax lines sum to ${cells.reduce((a, x) => a + x, 0)}, not ${t}`;
      return true;
    });
  }
}
for (const tip of [0, 1, 37, 500]) {
  P(`a tip of ₹${tip} appears on the paper without disturbing the tax`, () => {
    const rows = BILLDOC.splitTax(50, [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }]);
    let h = ""; try { h = String(BILLDOC.billDocHtml({ name: "R", lines: [{ title: "X", qty: 1, price: 1000 }],
      subtotal: 1000, discount: 0, taxable: 1000, total: 1050 + tip, taxRows: rows, tip }) || ""); }
    catch (e) { return "it threw: " + e.message; }
    const cells = taxCellsOf(h);
    return (Math.abs(cells.reduce((a, x) => a + x, 0) - 50) < 0.001) || `the tip moved the tax to ${cells.reduce((a,x)=>a+x,0)}`;
  });
}

// ══ §K · EVERY RESTAURANT'S OWN SETUP STILL PRODUCES A DOCUMENT ══════════════════════════════
// Paper is per-restaurant: its own name, address, GSTIN, paper width, tax mode. A shape that only
// one tenant has is exactly the shape nobody tests, so all of them are built.
console.log("\n§K · every restaurant's own setup");
const SETUPS = [
  ["no GSTIN configured",        { gstin: "" }],
  ["a GSTIN configured",         { gstin: "24AAAAA0000A1Z5" }],
  ["no address",                 { addr: "" }],
  ["a three-line address",       { addr: "Line one\nLine two\nLine three" }],
  ["no phone",                   { phone: "" }],
  ["58mm paper",                 { paper_w: 58 }],
  ["80mm paper",                 { paper_w: 80 }],
  ["A4 paper",                   { paper_w: 210 }],
  ["a very long restaurant name",{ name: "The " + "Very ".repeat(20) + "Long Restaurant" }],
  ["a name with an apostrophe",  { name: "Shop's Kitchen" }],
  ["a name in Hindi",            { name: "रसोई घर" }],
  ["a footer note",              { footer: "Thank you — visit again" }],
  ["a footer in two languages",   { footer: "Thank you · धन्यवाद" }],
  ["a name with an ampersand",    { name: "Tea & Co" }],
  ["a name with markup in it",    { name: "<b>Shop</b>" }],
  ["an address with an emoji",    { addr: "📍 Main Road" }],
  ["a GSTIN of the wrong length", { gstin: "24AAA" }],
  ["a phone with spaces",         { phone: "98765 43210" }],
  ["everything configured",       { name: "Full Shop", addr: "1 Road\nCity", phone: "9876543210", gstin: "24AAAAA0000A1Z5", footer: "Thanks" }],
  ["nothing configured at all",   { name: "", addr: "", phone: "", gstin: "", footer: "" }],
];
for (const [what, over] of SETUPS) {
  P(`${what}: a bill still builds and says nothing odd`, () => {
    const rows = BILLDOC.splitTax(50, [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }]);
    let h = "";
    try { h = String(BILLDOC.billDocHtml({ name: over.name || "R", ...over,
      lines: [{ title: "X", qty: 1, price: 1000 }], subtotal: 1000, discount: 0, taxable: 1000, total: 1050, taxRows: rows }) || ""); }
    catch (e) { return "it threw: " + e.message; }
    if (!h) return "it produced nothing";
    const hit = junkIn(h);
    return !hit || `it printed ${hit}`;
  });
  P(`${what}: and a ticket does too`, () => {
    let h = "";
    try { h = String(BILLDOC.kotDocHtml({ rname: over.name || "R", ...over, kot: 1, table: "4", lines: [{ qty: 1, title: "Dal" }] }) || ""); }
    catch (e) { return "it threw: " + e.message; }
    const hit = junkIn(h);
    return (h.length > 0 && !hit) || (hit ? `it printed ${hit}` : "it produced nothing");
  });
}
P("an unconfigured restaurant prints NO GSTIN line rather than inventing one", () => {
  const rows = BILLDOC.splitTax(50, [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }]);
  const h = String(BILLDOC.billDocHtml({ name: "R", gstin: "", lines: [{ title: "X", qty: 1, price: 1000 }],
    subtotal: 1000, discount: 0, taxable: 1000, total: 1050, taxRows: rows }) || "");
  return !/GSTIN\s*[:#]?\s*<\/?[^>]*>?\s*(?:undefined|null|—|-)\s*/i.test(h) || "it printed an empty GSTIN label on a tax invoice";
});

// ══ §L · THE PROSE IN EVERY PANEL THAT MENTIONS PRINTING ═════════════════════════════════════
// §C covers the files the twenty items touched. Printing is also described on the owner's screens and
// the waiter's, and those are the copies nobody remembers to update.
console.log("\n§L · printing's prose everywhere else");
const OTHER = [
  ["the owner's settings page", "app/owner/settings/page.tsx"],
  ["the owner settings route",  "app/api/owner/settings/route.tsx"],
  ["the owner settings API",    "app/api/owner/settings/route.ts"],
  ["the waiter tablet",         "public/panels/tablet/app.js"],
  ["the print board words",     "lib/printBoardWords.ts"],
  ["the shared print board",    "lib/printBoard.ts"],
];
for (const [where, file] of OTHER) {
  const src = code(read(file));
  if (!src) { P(`${where} is in this tree`, () => `skip: ${file} is not here`); continue; }
  for (const [what, re] of GONE) {
    P(`${where} does not name ${what}`, () => !re.test(src) || `it still does: ${(src.match(re) || [""])[0].slice(0, 50)}`);
  }
}

// ══ §M · EVERY DOCUMENT AT EVERY PAPER WIDTH ═════════════════════════════════════════════════
// A page that disagrees with the paper is what prints a ticket sideways or half-size — the fault he
// photographed. The width is a per-restaurant setting, so every document is built at every one.
console.log("\n§M · every document at every paper width");
const WIDTHS = [["58mm till roll", 58], ["80mm till roll", 80], ["A5", 148], ["A4", 210]];
const DOCS = [
  ["a bill",   (w) => BILLDOC.billDocHtml({ name: "R", paper_w: w, width: w,
      lines: [{ title: "X", qty: 2, price: 250 }], subtotal: 500, discount: 0, taxable: 500, total: 525,
      taxRows: BILLDOC.splitTax(25, [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }]) })],
  ["a ticket", (w) => BILLDOC.kotDocHtml({ rname: "R", paper_w: w, width: w, kot: 42, table: "6",
      lines: [{ qty: 2, title: "Dal" }, { qty: 1, title: "Naan" }] })],
];
for (const [dw, w] of WIDTHS) {
  for (const [dn, build] of DOCS) {
    P(`${dn} builds on ${dw}`, () => {
      let h = ""; try { h = String(build(w) || ""); } catch (e) { return "it threw: " + e.message; }
      return h.length > 0 || "it produced nothing";
    });
    P(`${dn} on ${dw} says nothing odd`, () => {
      let h = ""; try { h = String(build(w) || ""); } catch (e) { return "it threw: " + e.message; }
      const hit = junkIn(h);
      return !hit || `it printed ${hit}`;
    });
    /* ⚠️ THE WIDTH LIVES IN A DIFFERENT LAYER, and the first version of this phase measured the
       wrong one. The thermal document is deliberately ONE 66mm column — "the 80mm head only prints
       ~70mm, offset ~5mm", validated through the real CUPS/ESC-POS chain on 2026-07-21 — and it takes
       no width parameter at all. Narrow paper is handled where it can be: lib/printDocs.ts →
       withPaper() puts an @page size on the document and clamps the ink column to the roll
       (`Math.min(66, …)`), and verify:printing-sweep MEASURES the result through three virtual
       thermal printers. So this asks the only thing this layer can answer: is the column the one
       fixed value, everywhere, so the helper has a single thing to clamp. */
    P(`${dn} on ${dw} declares ONE fixed content column for the helper to clamp`, () => {
      let h = ""; try { h = String(build(w) || ""); } catch { return true; }
      const declared = [...new Set([...h.matchAll(/body\s*\{[^}]*width\s*:\s*([\d.]+)mm/g)].map((m) => Number(m[1])))];
      if (!declared.length) return true;
      const odd = declared.filter((d) => d !== 66 && d !== 72);      // 72 is the on-screen preview shell
      return odd.length === 0
        || `it declares ${odd.join("/")}mm — the helper clamps a KNOWN 66mm column, so a second value here is a ticket printed at the wrong size`;
    });
  }
}

// ══ §N · EVERY OTHER CALLER OF THESE DOCUMENTS ═══════════════════════════════════════════════
// billdoc.js is called by four things besides the two panels — the preview, the admin's own preview
// and the audit replay — and its comments say so. A caller that builds its own figures by hand is
// exactly the caller a document change breaks quietly.
console.log("\n§N · every other caller");
const CALLERS = [
  ["the bill preview",        "lib/billPreview.ts"],
  ["the audit replay",        "lib/auditDetail.ts"],
  ["the helper's documents",  "lib/printDocs.ts"],
  ["the waiter tablet",       "public/panels/tablet/app.js"],
  ["the kitchen panel",       "public/panels/kitchen/app.js"],
  ["the manager panel",       "public/panels/editor/app.js"],
];
for (const [who, file] of CALLERS) {
  const src = read(file);
  P(`${who} still reaches the ONE document builder`, () => {
    if (!src) return `skip: ${file} is not in this tree`;
    return /LFH_BILLDOC|billdoc|billDocHtml|kotDocHtml|banquetDocHtml/.test(src)
      || "it no longer goes through billdoc.js — a second assembler is how two descriptions of one bill start";
  });
  P(`…and ${who} builds no tax rows of its own`, () => {
    if (!src) return `skip: ${file} is not in this tree`;
    // splitTax is the one allocator; a caller doing its own CGST/SGST arithmetic is the drift
    const own = /CGST[\s\S]{0,60}(\/\s*2|rate\s*\/\s*2)/.test(code(src)) && !/splitTax/.test(src);
    return !own || "it halves a rate itself instead of calling splitTax — that is how one sheet foots and another does not";
  });
}
P("the type declaration keeps up with the builders it declares", () => {
  const d = read("public/panels/billdoc.d.ts");
  if (!d) return "skip: no .d.ts in this tree";
  const missing = ["billDocHtml", "kotDocHtml", "banquetDocHtml", "splitTax"].filter((f) => !d.includes(f));
  return missing.length === 0 || `the declaration omits ${missing.join(", ")}, so a caller in TypeScript cannot see them`;
});

// ══ §O · WHAT EACH PRINTING MIGRATION PROMISED IS STILL TRUE ══════════════════════════════════
// Nine migrations built this feature and each one promised a column or a table. A promise that has
// quietly stopped being kept is how `kot_print_target` and `printing.mode` both outlived their use.
console.log("\n§O · what each printing migration promised");
const MIGS = [
  ["269 · print reliability",      "print_jobs",     ["status", "attempts"]],
  ["335 · a ticket queues itself", "print_jobs",     ["order_id"]],
  ["338 · one screen is the printer", "print_stations", ["device_id", "panel"]],
  ["341 · a helper prints the paper", "print_agents",  ["printers", "last_seen_at"]],
  ["351 · a complaint knows its printer", "printer_events", ["printer"]],
  ["367 · a device sets up its own printer", "print_agents", ["owner_device"]],
  ["368 · a helper pairs itself",  "print_pairings", ["code", "secret_hash"]],
];
const MIGSRC = (() => {
  try {
    return readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql"))
      .map((f) => read("supabase/migrations/" + f)).join("\n");
  } catch { return ""; }
})();
for (const [what, table, cols] of MIGS) {
  P(`${what}: the migrations still create ${table}`, () =>
    new RegExp(`create table[^;]*${table}`, "i").test(MIGSRC) || `nothing creates ${table} any more`);
  for (const c of cols) {
    P(`${what}: …and ${table}.${c} is still declared`, () =>
      new RegExp(`${c}\\b`).test(MIGSRC) || `${c} is gone from every migration, so the code reading it reads nothing`);
  }
  P(`${what}: and the code actually reads ${table}`, () => {
    const files = ["lib/printQueue.ts", "lib/printHelpers.ts", "lib/printBoard.ts", "lib/printPair.ts"];
    return files.some((f) => read(f).includes(table)) || `no printing library mentions ${table} — either it is dead or something stopped using it`;
  });
}
/* A REMOVAL MIGRATION MUST NAME THE THING IT REMOVES, and the first version of these two phases
   read that as re-creating it: mig 372's whole body is `(modules -> 'printing') - 'mode'` and mig
   369's is about kot_print_target. So the migration that retires a thing is excluded from the search
   for it — everything else is fair game, which is what these are actually for. */
const migsExcept = (skip) => {
  try {
    return readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql"))
      .filter((f) => !skip.some((n) => f.startsWith(n)))
      .map((f) => read("supabase/migrations/" + f))
      .map((t) => t.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n"))
      .join("\n");
  } catch { return ""; }
};
P("372 · no LATER migration writes a printing mode back", () =>
  !/jsonb_set[^;]*'printing'[^;]*'mode'|'\{printing,mode\}'/.test(migsExcept(["372"]))
  || "a migration writes printing.mode again — mig 372 removed it and no code reads it");
P("369 · no LATER migration adds kot_print_target back", () =>
  !/add column[^\n;]*kot_print_target|kot_print_target\s+(?:text|varchar)/i.test(migsExcept(["369", "336", "338"]))
  || "a migration adds kot_print_target back — every screen derives the answer from the route now");

// ══ §P · EVERY KIND OF DISCOUNT, ON EVERY DOCUMENT ═══════════════════════════════════════════
// A discount is applied BEFORE tax (his rule, and the calc audit's), so it moves the tax on the
// paper. Each kind is printed and read.
console.log("\n§P · every kind of discount");
const DISCOUNTS = [
  ["no discount",        (sub) => 0],
  ["a flat ₹50",         (sub) => Math.min(50, sub)],
  ["10%",                (sub) => Math.round(sub * 0.10)],
  ["25%",                (sub) => Math.round(sub * 0.25)],
  ["50%",                (sub) => Math.round(sub * 0.50)],
  ["the whole bill",     (sub) => sub],
];
for (const [what, calc] of DISCOUNTS) {
  for (const sub of [19, 250, 1340]) {
    P(`${what} on a ₹${sub} bill: the tax follows the discount and the sheet foots`, () => {
      const disc = calc(sub);
      const taxable = Math.max(0, sub - disc);
      const t = Math.round(taxable * 0.05);
      const rows = BILLDOC.splitTax(t, [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }]);
      let h = "";
      try { h = String(BILLDOC.billDocHtml({ name: "R", lines: [{ title: "X", qty: 1, price: sub }],
        subtotal: sub, discount: disc, discLabel: BILLDOC.discPct(sub, disc), taxable, total: taxable + t, taxRows: rows }) || ""); }
      catch (e) { return "it threw: " + e.message; }
      const hit = junkIn(h);
      if (hit) return `it printed ${hit}`;
      if (!foots(rows, t)) return `the tax rows do not foot to ${t}`;
      const cells = taxCellsOf(h);
      if (cells.length && Math.abs(cells.reduce((a, x) => a + x, 0) - t) > 0.001)
        return `the printed lines sum to ${cells.reduce((a, x) => a + x, 0)}, not ${t}`;
      return true;
    });
  }
}
P("a bill discounted to nothing prints no tax rather than a ₹0 tax line", () => {
  const rows = BILLDOC.splitTax(0, [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }]);
  const h = String(BILLDOC.billDocHtml({ name: "R", lines: [{ title: "X", qty: 1, price: 500 }],
    subtotal: 500, discount: 500, taxable: 0, total: 0, taxRows: rows.filter((r) => Number(r.amt) > 0) }) || "");
  return taxCellsOf(h).length === 0 || "a fully discounted bill still prints a tax line";
});

// ══ §G · THE GUARDS THAT PROTECT ALL OF THIS ═════════════════════════════════════════════════
console.log("\n§G · the guards themselves");
// A NAME THAT DOES NOT EXIST LOOKS EXACTLY LIKE A FAILING GUARD, because `npm run <unknown>` exits 1
// with nothing on stdout. This list said "verify:doc-pointers" — the FILE's name — while the script
// is "verify:pointers", and the phase reported "it fails:" with an empty reason for a guard that
// passes. So the name is checked against package.json first, and a typo says so in those words.
const SCRIPTS = (() => { try { return JSON.parse(read("package.json")).scripts || {}; } catch { return {}; } })();
for (const g of ["verify:print-format", "verify:print-queue", "verify:print-helper", "verify:print-paper", "verify:pointers"]) {
  P(`${g} passes`, () => {
    if (!SCRIPTS[g]) return `there is no npm script called "${g}" — fix the NAME, not the code (npm exits 1 in silence for an unknown script, which reads as a failing guard)`;
    try { execFileSync("npm", ["run", "-s", g], { cwd: ROOT, stdio: "pipe" }); return true; }
    catch (e) {
      const why = String(e.stdout || e.message).split("\n").filter((l) => /FAIL|✗/.test(l)).slice(0, 1).join("").trim();
      return "it fails: " + (why || "(no reason printed — run it directly to see)");
    }
  });
}
P("this guard is itself in the guard map", () =>
  /verify:print-documents/.test(read("docs/GUARD-MAP.md")) || "add a row for it, or the next person will not find it");

console.log("─".repeat(78));
console.log(`${n} phases · ${pass} passed · ${fail} failed · ${skip} skipped`);
if (fails.length) { console.log("\nwhat failed:"); for (const f of fails) console.log("  · " + f); }
process.exit(fail ? 1 : 0);
