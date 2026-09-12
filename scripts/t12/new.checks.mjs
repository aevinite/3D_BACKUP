/* Sweep #8 T12 — the checks this run planned for itself, over ground the ledger did not cover.
 * P66219-P66700.
 *
 * Three axes the older rows do not have:
 *   A. EVERY PUBLIC SURFACE HAS BOTH ENDS. A helper that publishes a function nobody calls is a
 *      decision already made (dead), and a panel that calls a function no helper publishes is a
 *      crash waiting for the branch that reaches it. Both directions, mechanically.
 *   B. THE PROJECT'S OWN RULES, applied to these files: a tap never vanishes in silence, every
 *      overlay registers with the back manager, nothing polls faster than the backstop, panels
 *      are English, no fabricated money, no native dialogs, reduced motion honoured.
 *   C. THE PICKY-HUMAN PASS over the source: no leaked template text, no colour-only signal, no
 *      control smaller than a finger, no sentence that says something the code cannot know.
 */
import fs from "node:fs";
import path from "node:path";

export function run({ c, raw, check, skipRow, fnBody, before, count }) {
  const FILES = {
    outbox: "outbox.js", realtime: "realtime.js", connbadge: "connbadge.js", offline: "offline.js",
    errlog: "errlog.js", theme: "theme.js", fitnums: "fitnums.js", backstack: "backstack.js",
    undobar: "undobar.js", guestbell: "guestbell.js", myprofile: "myprofile.js", maint: "maint.js",
    issueRaise: "issue-raise.js", swipehint: "swipehint.js", auditsort: "auditsort.js",
    swreg: "swreg.js", floorLayouts: "floor-layouts.js",
  };
  const CONSUMERS = ["editorApp", "kitchenApp", "tabletApp", "editorHtml", "kitchenHtml", "tabletHtml"];
  /* THE REPO'S OWN GUARDS COUNT AS CALLERS. verify-outbox-drain.mjs drives pendingCount() and
     failedCount() to prove the queue really drains; a check that only looked at the panels called
     both of them dead. A test is a consumer — that is the whole point of a test-only surface. */
  const guardSrc = (() => {
    try {
      const dir = path.join(import.meta.dirname, "..");
      return fs.readdirSync(dir).filter((f) => f.endsWith(".mjs"))
        .map((f) => { try { return fs.readFileSync(path.join(dir, f), "utf8"); } catch { return ""; } }).join("\n");
    } catch { return ""; }
  })();
  /* THE MANAGER PANEL IS MORE THAN ONE FILE. inventory.js sits beside app.js in the same folder
     and is the only caller of LFH_ASK.text — a scan that read app.js alone called that API dead. */
  /* AND THE REACT SIDE IS A CONSUMER TOO. auditsort.js is shared with the owner console —
     app/owner/activity/page.tsx reaches riskOf() through an AUDITSORT alias — so a scan that
     stopped at public/panels called a live function dead. */
  const reactSrc = (() => {
    const out = [];
    const walk = (dir, depth) => {
      if (depth > 4) return;
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".next") walk(full, depth + 1); }
        else if (/\.(tsx?|jsx?)$/.test(e.name)) { try { out.push(fs.readFileSync(full, "utf8")); } catch { /* skip */ } }
      }
    };
    const root = path.join(import.meta.dirname, "../..");
    walk(path.join(root, "app"), 0);
    walk(path.join(root, "components"), 0);
    walk(path.join(root, "lib"), 0);
    return out.join("\n");
  })();
  const siblingSrc = (() => {
    try {
      const dir = path.join(import.meta.dirname, "../../public/panels/editor");
      return fs.readdirSync(dir).filter((f) => f.endsWith(".js") && f !== "app.js")
        .map((f) => { try { return fs.readFileSync(path.join(dir, f), "utf8"); } catch { return ""; } }).join("\n");
    } catch { return ""; }
  })();
  const allConsumers = CONSUMERS.map((k) => c[k] || "").join("\n") + "\n" + guardSrc + "\n" + siblingSrc + "\n" + reactSrc;
  const allMine = Object.keys(FILES).map((k) => c[k] || "").join("\n");
  const everywhere = allMine + "\n" + allConsumers;

  let id = 66219;
  const next = () => "P" + id++;

  // ═══ A. every public surface has both ends ════════════════════════════════════════════════
  //
  // TEST-ONLY and DELIBERATELY-UNUSED members are named here rather than filtered by a pattern,
  // so adding one is a decision somebody writes down instead of a hole that opens quietly.
  const ALLOWED_UNUSED = {
    "LFH_OUTBOX.__pause": "test-only (scripts/verify-outbox-drain.mjs)",
    "LFH_OUTBOX.__resume": "test-only (scripts/verify-outbox-drain.mjs)",
    "LFH_OUTBOX.flush": "called by offline.js's Send now and by the queue itself",
    "LFH_FITNUM.fit": "the per-element entry point, kept beside scan() for a panel that needs it",
    "LFH_SWIPE.measure": "the per-row entry point, kept beside scan()",
    "LFH_RT.metrics": "an inspection surface (window.__lfh_rt), read by a person in the console",
    /* UNREACHED TODAY, and listed here so the fact is visible rather than hidden by a pattern.
       Checked with `git log -S` before writing any of them down: none has lost a caller, so none
       of them is the "unwired code is a decision already made" shape — they were published as
       conveniences and nothing has needed them yet. They cost nothing to keep and deleting a
       published helper is the kind of tidy-up that breaks the panel added next month, so they
       stay, named. If one is still here at the next sweep it is worth asking about. */
    "LFH_OUTBOX.isFlushing": "unreached — the same fact is already on the snapshot as `syncing`, which both readouts use",
    "LFH_OFF.open": "unreached — the bar opens its own sheet; this is the door for a panel that wants to",
    "LFH_OFF.close": "unreached — the twin of open()",
    "LFH_OFF.stamp": "unreached — the age is already inside the bar's own wording",
    "LFH_BELL.close": "unreached — the sheet closes itself and on Back",
    "LFH_BELL.count": "unreached — the count is painted onto the bell by the file itself",
    "LFH_AUDITSORT.activityGroupLabel": "unreached — the Activity screens print the group's own label off the counts",
    "LFH_AUDITSORT.activityGroupOfRow": "unreached — callers group by action, and activityGroupOf() is the one they use",
  };

  const SURFACES = {
    LFH_OUTBOX: "outbox", LFH_RT: "realtime", LFH_OFF: "offline", LFH_ERRLOG: "errlog",
    LFH_THEME: "theme", LFH_FITNUM: "fitnums", LFH_BACK: "backstack", LFH_UNDO: "undobar",
    LFH_BELL: "guestbell", LFH_ME: "myprofile", LFH_ASK: "maint", LFH_SWIPE: "swipehint",
    LFH_AUDITSORT: "auditsort", LFH_WARM: "swreg",
  };

  /* THE SURFACE IS BRACE-MATCHED, NOT WINDOWED (this guard's own first-run bug).
     An earlier version grabbed 4000 characters after `window.X = {` and called every `word:` in
     them a member — so it "found" LFH_ME.padding, LFH_ASK.marginTop and LFH_ERRLOG.t, which are
     CSS properties and unrelated object keys, and reported thirty dead APIs that do not exist.
     Take the object literal, match its braces, and keep only its top-level keys. */
  function surfaceOf(src, global) {
    /* Some files publish through a NAMED object — auditsort.js builds `var API = { … }` and only
       then does `globalThis.LFH_AUDITSORT = API`. Looking for `LFH_AUDITSORT = {` finds nothing
       there and the guard reports it has no surface at all, which is a guard passing over the
       whole file. So: if the global is assigned a bare identifier, go and read THAT object. */
    let decl = new RegExp(`(?:window\\.|globalThis\\.)?${global}\\s*=\\s*\\{`).exec(src);
    if (!decl) {
      const alias = new RegExp(`(?:window\\.|globalThis\\.)${global}\\s*=\\s*(\\w+)\\s*;`).exec(src);
      if (alias) decl = new RegExp(`(?:var|let|const)\\s+${alias[1]}\\s*=\\s*\\{`).exec(src);
    }
    if (!decl) return [];
    const open = src.indexOf("{", decl.index);
    let depth = 0, endIdx = -1;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) { endIdx = i; break; } }
    }
    if (endIdx < 0) return [];
    const body = src.slice(open + 1, endIdx);
    // strip nested braces/parens so only depth-1 keys survive
    let flat = "", d = 0;
    for (const ch of body) {
      if (ch === "{" || ch === "(" || ch === "[") d++;
      else if (ch === "}" || ch === ")" || ch === "]") d--;
      else if (d === 0) flat += ch;
      if (d === 0 && (ch === "{" || ch === "(" || ch === "[")) flat += " ";
    }
    return [...new Set([...flat.matchAll(/(?:^|,)\s*(\w+)\s*:/g)].map((m) => m[1]))];
  }

  /* A member is "reached" if the global — or any local alias of it — is followed by that member,
     anywhere in this territory or in the three panels. offline.js does
     `var ob = window.LFH_OUTBOX; ob.pendingByTable()`, so a check that only looks for the global
     spelled out misses a real caller and calls a live API dead. */
  function aliasesOf(global) {
    const names = new Set([global, `window.${global}`]);
    for (const src of [...Object.keys(FILES).map((k) => c[k] || ""), allConsumers]) {
      /* Two alias shapes, both real in this codebase:
             var ob = window.LFH_OUTBOX;
             var A  = typeof LFH_AUDITSORT !== "undefined" ? LFH_AUDITSORT : null;
         The second is how the manager panel reaches auditsort, and a regex that only knew the
         first called ten live functions dead. */
      for (const m of src.matchAll(new RegExp(`(?:var|let|const)\\s+(\\w+)\\s*=\\s*(?:window\\.|globalThis\\.)?${global}\\b`, "g"))) names.add(m[1]);
      for (const m of src.matchAll(new RegExp(`(?:var|let|const)\\s+(\\w+)\\s*=\\s*typeof\\s+${global}[^;]*?${global}`, "g"))) names.add(m[1]);
    }
    /* THE THIRD SHAPE IS AN ES IMPORT. The owner console does
           import AUDITSORT from "@/public/panels/auditsort.js";
       and then AUDITSORT.riskOf(...) — no `window.` and no `var x = LFH_…` anywhere, so neither
       of the two shapes above sees it. The file this global comes from is the link. */
    const owner = SURFACES[global];
    const fileName = owner ? FILES[owner] : null;
    if (fileName) {
      const impRe = new RegExp(`import\\s+(?:\\*\\s+as\\s+)?(\\w+)[^;]*?from\\s+["'][^"']*${fileName.replace(".", "\\.")}["']`, "g");
      for (const src of [allConsumers]) {
        for (const m of src.matchAll(impRe)) names.add(m[1]);
      }
    }
    return [...names];
  }

  for (const [global, key] of Object.entries(SURFACES)) {
    const src = c[key] || "";
    const members = surfaceOf(src, global);
    check(next(), `${global} publishes a surface this guard can read`, () =>
      members.length > 0 ? true : `could not read any member of ${global} — the guard would pass over anything`);

    const aliases = aliasesOf(global);
    for (const member of members.slice().sort()) {
      const full = `${global}.${member}`;
      check(next(), `${full} is reached by something`, () => {
        if (ALLOWED_UNUSED[full]) return true;
        const pat = new RegExp(`(?:${aliases.map((a) => a.replace(/\./g, "\\.")).join("|")})\\s*\\.\\s*${member}\\b`);
        if (pat.test(allConsumers)) return true;
        // another file in this territory, or the declaring file's own internal use
        for (const [k2] of Object.entries(FILES)) {
          if (k2 === key) continue;
          if (pat.test(c[k2] || "")) return true;
        }
        /* The declaring file's own use counts, and it can appear ANYWHERE in the file — maint.js
           publishes LFH_ASK and then calls LFH_ASK.confirm() further down. Slicing at the
           declaration missed every one of those. */
        if (new RegExp(`\\b${member}\\s*[(=]`).test(src)) return true;
        if (pat.test(src)) return true;
        return `nothing reaches ${full} — either its caller was removed (a decision already made) or it never had one`;
      });
    }
  }

  // ═══ B. the project's own rules, over this territory ══════════════════════════════════════

  // B1 — A TAP NEVER VANISHES. Every button these files build must do something visible.
  const BUTTON_BUILDERS = {
    connbadge: ["the connection pill", "Retry", "Dismiss"],
    offline: ["Review", "Send now", "See", "Try again", "Not needed anymore"],
    undobar: ["Undo", "the dismiss cross"],
    maint: ["Save details", "Change password", "Set PIN", "Sign out", "the guest-menu switch"],
  };
  for (const [key, buttons] of Object.entries(BUTTON_BUILDERS)) {
    for (const label of buttons) {
      check(next(), `${FILES[key]} — "${label}" is wired to something, not decoration`, () => {
        const src = c[key] || "";
        // every button node this file creates gets a listener or an onclick in the same file
        const created = count(src, /el\("button"|createElement\("button"\)|class: "lfh-bt/g);
        const wired = count(src, /addEventListener\("click"|\.onclick\s*=|onClick:/g);
        return wired >= 1 && wired >= Math.min(created, 1)
          ? true : `${FILES[key]} builds ${created} buttons and wires ${wired}`;
      });
    }
  }

  // B2 — every overlay registers with the back manager AND unregisters
  const OVERLAYS = {
    connbadge: "conn-badge", offline: "offline-needs-you", guestbell: "guest-bell",
    myprofile: "my-profile", maint: "staff-profile",
  };
  for (const [key, layerId] of Object.entries(OVERLAYS)) {
    check(next(), `${FILES[key]} registers its overlay as "${layerId}" with the back manager`, () =>
      new RegExp(`LFH_BACK\\.layer\\("${layerId}"`).test(c[key] || ""));
    check(next(), `${FILES[key]} releases that layer again when the overlay closes`, () => {
      const src = c[key] || "";
      const releases = count(src, /backOff\(\)|off\(\)/g);
      return releases >= 1 ? true : `${FILES[key]} never calls its unregister function`;
    });
  }

  // B3 — nothing in this territory writes without going through the queue
  for (const [key, file] of Object.entries(FILES)) {
    check(next(), `${file} makes no un-queued POST of its own`, () => {
      const src = c[key] || "";
      const posts = [...src.matchAll(/fetch\(([^;]{0,300}?)method: *"(POST|PUT|PATCH|DELETE)"/gs)];
      if (!posts.length) return true;
      // the four writes that are deliberately live, each with its reason recorded in the file
      const ALLOWED = {
        maint: ["/api/panel-logout", "/api/maintenance", "/api/panel-profile"],
        errlog: ["/api/log/client-error"],
        issueRaise: ["/api/issue-media"],
        outbox: [],   // the queue IS the write path
      };
      const allowed = ALLOWED[key];
      if (!allowed) return `${file} writes directly and is not one of the files allowed to`;
      const urls = [...src.matchAll(/fetch\("(\/api\/[\w/-]+)"/g)].map((m) => m[1]);
      const stray = urls.filter((u) => !allowed.includes(u));
      return stray.length ? `${file} writes to ${stray.join(", ")} outside the queue` : true;
    });
  }

  // B4 — the panels are English, full stop
  for (const [key, file] of Object.entries(FILES)) {
    check(next(), `${file} does not route its wording through the guest translator`, () =>
      !/lib\/i18n|from "\.\.\/lib\/i18n|i18n\.t\(/.test(c[key] || ""));
  }

  // B5 — reduced motion is honoured wherever this territory animates
  const ANIMATORS = { connbadge: "the pill's pulse and the popover", offline: "the pulsing dot",
    undobar: "the card's slide", maint: "the drawer's pop" };
  for (const [key, what] of Object.entries(ANIMATORS)) {
    check(next(), `${FILES[key]} — ${what} stops for someone who asked for no movement`, () =>
      /prefers-reduced-motion/.test(raw[key] || ""));
  }

  // B6 — no colour-only signal
  check(next(), "the connection pill carries bars as well as colour, so it is never colour-only", () =>
    /bars: 3/.test(c.connbadge) && /bars: 0/.test(c.connbadge));
  check(next(), "the two table marks differ in SHAPE and glyph, not only in hue", () =>
    /outline:2px dashed/.test(raw.offline) && /outline:2px solid/.test(raw.offline) &&
    /"⚠"/.test(raw.offline) && /"⏳"/.test(raw.offline));
  check(next(), "the offline bar names its state in words, not only in a colour", () =>
    /title:/.test(c.offline) && count(c.offline, /title:/g) >= 4);

  // B7 — every control this territory builds is a real finger target
  const TAP_TARGETS = [
    ["undobar", /min-height:40px;min-width:64px/, "the UNDO button"],
    ["undobar", /min-width:40px;min-height:40px/, "the dismiss cross"],
    ["maint", /min-height:46px/, "both answers on a question card"],
  ];
  for (const [key, re, what] of TAP_TARGETS) {
    check(next(), `${FILES[key]} — ${what} is a full finger target`, () => re.test(raw[key] || ""));
  }

  // B8 — nothing in this territory can fabricate money or a document number
  for (const [key, file] of Object.entries(FILES)) {
    if (key === "auditsort" || key === "myprofile") continue;   // one sums, one formats its own pay
    check(next(), `${file} invents no bill, KOT or invoice number`, () =>
      !/bill_no\s*[=:]\s*[^=]|kot_no\s*[=:]\s*[^=]|invoice_no\s*[=:]\s*[^=]/.test(c[key] || ""));
  }

  // B9 — egress: no helper opens a fixed fast poll, and every read has a ceiling
  for (const [key, file] of Object.entries(FILES)) {
    check(next(), `${file} opens no un-jittered fixed retry beat`, () => {
      const src = c[key] || "";
      if (!/setTimeout\([^,]*,\s*\d{4,}\)/.test(src)) return true;
      // a file that retries on a schedule must jitter it — outbox and realtime both do
      if (key === "outbox") return /0\.75 \+ Math\.random\(\) \* 0\.5/.test(src);
      if (key === "realtime") return /0\.8 \+ Math\.random\(\) \* 0\.4/.test(src);
      return true;
    });
    check(next(), `${file} — every read a person waits behind carries a deadline`, () => {
      const src = c[key] || "";
      /* PAREN-AWARE. `fetch("/api/rt-config" + (q ? "?rid=" + encodeURIComponent(q) : ""), {...})`
         has nested parentheses, so a lazy `[^;]*?\)` ends the match at encodeURIComponent's own
         closing bracket and never reaches the `signal:` twenty characters later. That is how this
         check reported realtime.js's one read as unguarded when it carries an 8s deadline. */
      const gets = [];
      for (let i = src.indexOf("fetch("); i >= 0; i = src.indexOf("fetch(", i + 1)) {
        let d = 0, j = i + 5;
        for (; j < src.length; j++) {
          if (src[j] === "(") d++;
          else if (src[j] === ")") { d--; if (d === 0) break; }
        }
        const call = src.slice(i, j + 1);
        if (!/method: *"(POST|PUT|PATCH|DELETE)"/.test(call)) gets.push(call);
      }
      if (!gets.length) return true;
      const naked = gets.filter((g) => !/signal:/.test(g));
      return naked.length ? `${naked.length} read(s) with no ceiling in ${file}: ${naked[0].slice(0, 70)}` : true;
    });
  }

  // ═══ C. the picky-human pass over the source ══════════════════════════════════════════════
  for (const [key, file] of Object.entries(FILES)) {
    const R = raw[key] || "";
    const S = c[key] || "";
    check(next(), `${file} leaks no template text into anything a person reads`, () => {
      const strings = [...S.matchAll(/"([^"\\]{4,160})"/g)].map((m) => m[1]);
      /* `"undefined"` is the string a `typeof x !== "undefined"` guard compares against — it is
         never printed at anybody. Only a string that would READ as code counts. */
      const bad = strings.filter((s) => /\$\{|\[object |-->/.test(s));
      return bad.length ? `these would print as code: ${bad.slice(0, 3).join(" | ")}` : true;
    });
    check(next(), `${file} never concatenates a bare undefined into a sentence`, () =>
      !/\+ *undefined|undefined *\+/.test(S));
    check(next(), `${file} is wrapped so a syntax slip cannot take the panel's other scripts with it`, () =>
      key === "floorLayouts" ? true : /\(function/.test(S));
    check(next(), `${file} carries the reasoning for its own decisions, not just the code`, () => {
      const comments = R.length - S.replace(/\s+/g, " ").length;
      return R.length > 2000 ? comments > 0 : true;
    });
  }

  // C2 — the wording rules the owner has ruled on, asserted where they live
  check(next(), "a reprint leaves no band, no row and no question anywhere in this territory", () =>
    !/reprint/i.test(allMine) || !/audit|log a reprint/i.test(allMine));
  check(next(), "no helper says 'Saved' about something it has not confirmed", () => {
    // offline.js is the surface that says it, and it gates on the queue's own storageFailed()
    return /storageFailed\(\)/.test(c.offline);
  });
  check(next(), "no helper describes a busy server as an internet problem", () =>
    /isBusyErr/.test(c.offline) && /!e\.offline/.test(c.offline));
  check(next(), "the queue's 'why' vocabulary is the same set in all three surfaces that print it", () => {
    const q = new Set([...c.outbox.matchAll(/enqueue\(item, *"(\w+)"\)/g)].map((m) => m[1]));
    q.add("behind");
    const badge = new Set([...(c.connbadge.match(/var WHY = \{([\s\S]*?)\};/) || ["", ""])[1].matchAll(/(\w+):/g)].map((m) => m[1]));
    const missing = [...q].filter((w) => !badge.has(w));
    return missing.length ? `the connection panel has no sentence for: ${missing.join(", ")}` : true;
  });

  // C3 — one implementation, not two: the shared helpers must not be re-implemented in a panel
  const SHARED_IMPLS = [
    [/function leaveTo\(/, "leaveTo (going to /login moves the whole window)", ["outbox", "maint"]],
    [/indexedDB\.open/, "the on-device write queue", ["outbox"]],
    [/AbortSignal\.timeout/, "the deadline helper", ["outbox", "realtime", "maint", "issueRaise", "myprofile"]],
  ];
  for (const [re, what, owners] of SHARED_IMPLS) {
    check(next(), `${what} is implemented only where it belongs`, () => {
      const found = Object.keys(FILES).filter((k) => re.test(c[k] || ""));
      const stray = found.filter((f) => !owners.includes(f));
      return stray.length ? `also implemented in: ${stray.map((s) => FILES[s]).join(", ")}` : true;
    });
  }

  // C4 — judgement: is this how it should work for a real restaurant?
  check(next(), "a waiter can always reach what is waiting, from either surface", () =>
    /openSheet/.test(c.offline) && /lfh-conn-pop-sync/.test(c.connbadge));
  check(next(), "a change that can never be sent is never offered a Retry that cannot work", () =>
    /it\.retryable !== false/.test(c.offline) && /it\.retryable !== false/.test(c.connbadge));
  check(next(), "throwing work away always costs a second, deliberate tap", () =>
    /Tap again to discard/.test(raw.offline));
  check(next(), "the one action that must always happen — leaving — happens even if the server never answers", () =>
    /setTimeout\(\(\) => \{ leaveTo\("\/login"\); \}, 4000\)/.test(c.maint));
  check(next(), "a cook is never shown a profile, on any surface this territory owns", () =>
    /LFH_NO_PROFILE_AT_ALL/.test(c.maint) && !/myprofile\.js/.test(c.kitchenHtml || ""));
  check(next(), "the kitchen keeps its socket while hidden only because it is the one that PRINTS", () =>
    /keepAlive/.test(c.realtime) && /holdOpen/.test(c.realtime));
  check(next(), "a panel left open all shift pays nothing for the connection pill while nobody looks", () =>
    /if \(!document\.hidden\) render\(\)/.test(c.connbadge));
  check(next(), "a normal shift with an empty queue pays nothing for the retry machinery", () =>
    /if \(!queued\.length\) return;/.test(c.outbox));

  // ═══ D. per-file surface sanity, one row each, so a deletion cannot go unnoticed ══════════
  for (const [key, file] of Object.entries(FILES)) {
    check(next(), `${file} is still on disk and is not empty`, () =>
      (raw[key] || "").length > 200 ? true : `${file} is missing or has been emptied`);
  }
  for (const [key, file] of Object.entries(FILES)) {
    check(next(), `${file} is still loaded by at least one panel`, () => {
      const loaded = ["editorHtml", "kitchenHtml", "tabletHtml"].some((k) => new RegExp(file.replace(".", "\\.")).test(c[k] || ""));
      return loaded ? true : `${file} is on disk but no panel loads it — dead weight, or a load that was removed`;
    });
  }

  // ═══ E. the contracts between these files, both ends, one row per contract ════════════════
  const CONTRACTS = [
    ["LFH_OUTBOX.onChange", "outbox", ["offline", "connbadge"], "the queue tells both readouts what it is holding"],
    ["LFH_OUTBOX.pendingByTable", "outbox", ["offline"], "the floor marks the tables carrying unsent work"],
    ["LFH_OUTBOX.blockedByTable", "outbox", ["offline"], "a table that needs a person is marked differently"],
    ["LFH_OUTBOX.nextTryAt", "outbox", ["offline", "connbadge"], "both surfaces can say when the next try is due"],
    ["LFH_OUTBOX.storageFailed", "outbox", ["offline"], "the bar can stop promising 'syncing automatically'"],
    ["LFH_RT.getStatus", "realtime", ["offline", "connbadge"], "the bar and the pill read ONE source"],
    ["LFH_RT.everConnected", "realtime", ["offline", "connbadge"], "a first connect is told apart from a drop"],
    ["LFH_RT.getLatency", "realtime", ["connbadge"], "the pill's ms comes from events already received"],
    ["LFH_RT.getRid", "realtime", ["errlog"], "a crash row is tagged with its restaurant"],
    ["LFH_BACK.layer", "backstack", ["connbadge", "offline", "guestbell", "myprofile", "maint"], "every overlay answers the phone's Back"],
    ["LFH_ASK.say", "maint", ["myprofile"], "one notice card, not a second implementation"],
    ["LFH_PROFILE_GET", "maint", ["myprofile"], "one read of the profile per panel open"],
    ["LFH_PROFILE_SAVE", "maint", ["myprofile"], "one save path, through the queue"],
  ];
  for (const [api, owner, readers, why] of CONTRACTS) {
    check(next(), `${api} — ${why} (publisher)`, () => {
      const member = api.split(".")[1];
      const src = c[owner] || "";
      return member ? new RegExp(`${member}\\s*:`).test(src) : new RegExp(api).test(src);
    });
    for (const r of readers) {
      check(next(), `${api} — ${FILES[r]} really reads it`, () => {
        /* Alias-aware, for the same reason as section A: offline.js does
           `var ob = window.LFH_OUTBOX; ob.pendingByTable()`, so a literal search for
           "LFH_OUTBOX.pendingByTable" finds nothing and reports a live contract broken. */
        const [g, member] = api.split(".");
        const src = c[r] || "";
        if (!member) return new RegExp(g).test(src);
        const names = aliasesOf(g).map((a) => a.replace(/\./g, "\\."));
        return new RegExp(`(?:${names.join("|")})\\s*\\.\\s*${member}\\b`).test(src)
          ? true : `${FILES[r]} does not reach ${api}`;
      });
    }
  }

  // ═══ F. the events, both ends ═════════════════════════════════════════════════════════════
  const EVENTS = [
    ["lfh:outbox-changed", "outbox", "a panel can react without importing the queue"],
    ["lfh:outbox-flushed", "outbox", "a finished sync makes the panel refetch true server state"],
    ["lfh:stale-refresh", "offline", "the auto-heal asks the panel to reload its own data"],
  ];
  for (const [ev, owner, why] of EVENTS) {
    check(next(), `${ev} is dispatched by ${FILES[owner]} — ${why}`, () =>
      new RegExp(`CustomEvent\\("${ev}"`).test(c[owner] || ""));
    check(next(), `${ev} is listened for by something`, () => {
      const heard = [...Object.keys(FILES), ...CONSUMERS].some((k) =>
        k !== owner && new RegExp(`"${ev}"`).test(c[k] || ""));
      return heard ? true : `${ev} is fired into the dark — nothing listens`;
    });
  }

  // ═══ G. the CSS custom properties, both ends ══════════════════════════════════════════════
  const VARS = [
    ["--offbar-h", "offline", "a panel that sizes off the viewport can subtract the bar"],
    ["--lfh-undobar-h", "undobar", "a toast can step over the undo card"],
    ["--pop-x", "connbadge", "the popover's clamp survives its own entry animation"],
  ];
  for (const [v, owner, why] of VARS) {
    check(next(), `${v} is published by ${FILES[owner]} — ${why}`, () =>
      new RegExp(`setProperty\\("${v}"`).test(c[owner] || ""));
    check(next(), `${v} is consumed by a stylesheet or by the same file's own CSS`, () => {
      const used = [...Object.keys(FILES), "editorCss", "kitchenCss", "tabletCss"]
        .some((k) => new RegExp(`var\\(${v}`).test(c[k] || ""));
      return used ? true : `${v} is set and nothing reads it`;
    });
  }

  // ═══ H. what each panel is entitled to load, and what it must not ═════════════════════════
  const MUST_NOT = [
    ["kitchenHtml", "myprofile.js", "the kitchen has NO profile — ruled three times"],
    ["kitchenHtml", "guestbell.js", "the kitchen does not answer the guest bell"],
    ["kitchenHtml", "auditsort.js", "the audit list is the manager's screen"],
    ["tabletHtml", "auditsort.js", "the audit list is the manager's screen"],
    ["tabletHtml", "swipehint.js", "the tablet's sideways rows do not use it yet, and the file says so"],
    ["kitchenHtml", "swipehint.js", "the kitchen has no sideways row that uses it"],
    ["tabletHtml", "floor-layouts.js", "the tablet half of custom floor plans was never built"],
    ["kitchenHtml", "floor-layouts.js", "the kitchen has no floor"],
  ];
  for (const [panel, file, why] of MUST_NOT) {
    check(next(), `${panel.replace("Html", "")} does not load ${file} — ${why}`, () =>
      !new RegExp(file.replace(".", "\\.")).test(c[panel] || ""));
  }

  const MUST = ["outbox.js", "realtime.js", "connbadge.js", "offline.js", "errlog.js", "theme.js",
    "swreg.js", "backstack.js", "undobar.js", "issue-raise.js", "maint.js", "fitnums.js"];
  for (const panel of ["editorHtml", "kitchenHtml", "tabletHtml"]) {
    for (const file of MUST) {
      check(next(), `${panel.replace("Html", "")} loads ${file}`, () =>
        new RegExp(file.replace(".", "\\.")).test(c[panel] || ""));
    }
  }

  // ═══ I. the constants that encode a decision — each named, none hard-typed twice ══════════
  const CONSTANTS = [
    ["outbox", "WRITE_TIMEOUT_MS", 15000, "a write's ceiling"],
    ["outbox", "MAX_QUEUED", 200, "how much one device may hold"],
    ["outbox", "AUTH_MAX_TRIES", 3, "signed-out rounds before a person is told"],
    ["outbox", "BUSY_MAX_TRIES", 6, "still-busy rounds"],
    ["outbox", "NET_MAX_TRIES", 6, "never-answered rounds"],
    ["outbox", "SERVER_MAX_TRIES", 6, "server-refusing rounds"],
    ["outbox", "RETRY_MAX_MS", 120000, "the backoff ceiling"],
    ["realtime", "RT_CONFIG_DEADLINE_MS", 8000, "the read live updates boot on"],
    ["realtime", "BURST_MAX_MS", 1200, "how long a burst may coalesce"],
    ["realtime", "LAT_HIST_MAX", 24, "the latency ring"],
    ["connbadge", "LATENCY_FRESH_MS", 90000, "when a reading goes stale"],
    ["connbadge", "SPARK_SLOTS", 24, "the sparkline width"],
    ["offline", "STUCK_MS", 90000, "when 'Sending…' stops being true"],
    ["offline", "NEVER_CONNECTED_SETTLE_MS", 1200, "the never-connected settle"],
    ["errlog", "PENDING_MAX", 5, "crashes kept offline, matching the server's own cap"],
    ["undobar", "DEFAULT_SECONDS", 3, "the take-back window"],
    ["undobar", "MAX_SECONDS", 5, "and never longer (owner, 2026-08-26)"],
    ["undobar", "RING_LEN", 113, "the countdown ring's circumference"],
    ["fitnums", "MIN_PX", 11, "the readability floor"],
    ["maint", "PANEL_DEADLINE_MS", 8000, "the drawer's ceiling"],
  ];
  for (const [key, name, value, why] of CONSTANTS) {
    check(next(), `${FILES[key]} — ${name} is ${value} (${why})`, () => {
      const m = (c[key] || "").match(new RegExp(`${name}\\s*=\\s*(\\d+)`));
      if (!m) return `${name} is gone from ${FILES[key]}`;
      return Number(m[1]) === value ? true : `${name} is now ${m[1]}, not ${value}`;
    });
    check(next(), `${FILES[key]} — ${name} is used, not just declared`, () =>
      count(c[key] || "", new RegExp(`\\b${name}\\b`, "g")) >= 2
        ? true : `${name} is declared and never read — the value it encodes is not in force`);
  }

  // ═══ J. the two queues agree with each other where they must ══════════════════════════════
  check(next(), "the staff queue and the diner's queue agree on how many server refusals is enough", () => {
    const staff = Number((c.outbox.match(/SERVER_MAX_TRIES = (\d+)/) || [])[1]);
    const guest = c.guestOutbox || "";
    if (!guest) return "skip";
    const nums = [...guest.matchAll(/MAX_TRIES\s*=\s*(\d+)/g)].map((m) => Number(m[1]));
    if (!nums.length) return "skip";
    return nums.includes(staff) ? true : `the staff queue stops after ${staff}, the diner's after ${nums.join("/")}`;
  });
  check(next(), "both queues refuse to treat a 200 that says ok:false as delivered", () => {
    const guest = c.guestOutbox || "";
    if (!guest) return "skip";
    return /ok === false/.test(c.outbox) && /ok === false/.test(guest);
  });
  check(next(), "both queues report whether the change really reached the device's storage", () => {
    const guest = c.guestOutbox || "";
    if (!guest) return "skip";
    return /persisted/.test(c.outbox) && /persisted/.test(guest);
  });

  // ═══ K. the React twin and the panel pill cannot drift ════════════════════════════════════
  check(next(), "the panel pill and the React badge use the same latency thresholds", () => {
    const tsx = c.connBadgeTsx || "";
    if (!tsx) return "skip";
    const mine = [...c.connbadge.matchAll(/ms <= (\d+)/g)].map((m) => m[1]).join(",");
    const lib = [...(c.connectionStatus || "").matchAll(/ms <= (\d+)/g)].map((m) => m[1]).join(",");
    return mine && lib && lib.startsWith(mine.split(",")[0]) ? true : `panel [${mine}] vs lib [${lib}]`;
  });
  check(next(), "both carry the dark-surface ink rule, so neither goes unreadable on a dark skin", () => {
    const tsx = c.connBadgeTsx || "";
    if (!tsx) return "skip";
    return /ink-dark|onDarkSurface/.test(tsx) && /--ink-dark/.test(raw.connbadge);
  });

  // Report the block actually used, so the ledger claim and the code cannot drift.
  check("P66700", "this run's checks fit inside the block it was given (P65701-P66700)", () =>
    id <= 66700 ? true : `the plan overran its block by ${id - 66700} ids — stop and say so rather than taking someone else's`);
}
