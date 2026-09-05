/* auditsort.js (EXECUTED, not read), the vendor assets, and the cross-file rows.
 * Re-runs P04437-P04454, P04483-P04500 (T9), P02012-P02016 (T5), P02514-P02520 (T6),
 * P01595 / P01926 / P01928 / P01937 / P01940 / P01943 (T4), P13402-P13417 (T27),
 * P64557 (T10) and P14589 (T30), plus this run's own P66161-P66260.
 *
 * auditsort.js is pure logic and exports to CommonJS on purpose ("so a node test and the panel
 * share one implementation"), so its rows are RUN here rather than pattern-matched. A row that
 * says "node" in the ledger deserves node.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

export function run({ c, raw, check, skipRow, fnBody, before, count, P }) {
  // ── load the real module ────────────────────────────────────────────────────────────────
  let A = null, loadErr = "";
  try {
    const require = createRequire(import.meta.url);
    A = require(P("public/panels/auditsort.js"));
  } catch (e) { loadErr = e && e.message; }

  const S = c.auditsort, R = raw.auditsort;
  const rows = (n = 5) => Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    at: new Date(Date.UTC(2026, 0, 1 + i, 12)).toISOString(),
    kind: i % 2 ? "bill_delete" : "order_delete",
    actor: i % 2 ? "Asha" : "Bharat",
    actor_role: "manager",
    amount: (i + 1) * 100,
    restaurant_name: i % 2 ? "French House" : "Aangan",
    reason_code: "mistake",
    table_number: String(i + 1),
  }));

  check("P04437", "the file is pure logic - no DOM, no network, no storage", () =>
    count(S, /document\./g) === 0 && count(S, /fetch\(/g) === 0 && count(S, /localStorage/g) === 0);
  check("P04438", "it exports the same surface to CommonJS and to the panel's global", () =>
    /module\.exports = API/.test(S) && /globalThis\.LFH_AUDITSORT = API/.test(S));
  check("P04439", "auditsort.d.ts describes every exported function", () => {
    if (!A) return `could not load the module: ${loadErr}`;
    const dts = c.auditsortDts || "";
    const fns = Object.keys(A).filter((k) => typeof A[k] === "function");
    const missing = fns.filter((f) => !new RegExp(`\\b${f}\\b`).test(dts));
    return missing.length ? `the .d.ts does not describe: ${missing.join(", ")}` : true;
  });
  check("P04440", "sortRows is stable for equal keys", () => {
    if (!A) return "module not loaded";
    const same = [1, 2, 3, 4].map((id) => ({ id, at: "2026-01-01T00:00:00Z", kind: "x", actor: "a" }));
    const out = A.sortRows(same, "new");
    // equal `at` falls to the tie-break (id desc) - deterministic, which is what stability buys
    const twice = A.sortRows(A.sortRows(same, "new"), "new");
    return JSON.stringify(out.map((r) => r.id)) === JSON.stringify(twice.map((r) => r.id));
  });
  check("P04441", "sortRows handles every sort id the manager panel offers", () => {
    if (!A) return "module not loaded";
    const bad = [];
    for (const s of A.SORTS) {
      try { const out = A.sortRows(rows(), s.id); if (out.length !== 5) bad.push(s.id + " (lost rows)"); }
      catch (e) { bad.push(`${s.id} (threw: ${e.message})`); }
    }
    return bad.length ? bad.join(", ") : true;
  });
  check("P04442", "an unknown sort id falls back rather than throwing", () => {
    if (!A) return "module not loaded";
    const out = A.sortRows(rows(), "no-such-sort-id");
    return Array.isArray(out) && out.length === 5;
  });
  check("P04443", "kindCounts totals match the row count", () => {
    if (!A) return "module not loaded";
    const cs = A.kindCounts(rows());
    return cs.reduce((t, x) => t + x.count, 0) === 5;
  });
  check("P04444", "kindCountsFrom prefers the DB's own counts when given them", () => {
    if (!A) return "module not loaded";
    // The database hands back `n`, not `count` — reading the wrong key was this check's own bug
    // on its first run, and it produced an empty list that looked like the feature was broken.
    const out = A.kindCountsFrom(rows(), [{ kind: "order_delete", n: 99 }]);
    const od = out.find((x) => x.kind === "order_delete");
    if (!od) return `the DB counts were dropped entirely: ${JSON.stringify(out)}`;
    return od.count === 99 ? true : `it used its own count (${od.count}) instead of the database's 99`;
  });
  check("P04445", "matches is case-insensitive", () => {
    if (!A) return "module not loaded";
    const r = rows()[1];
    return A.matches(r, "asha") === A.matches(r, "ASHA") && A.matches(r, "AsHa") === true;
  });
  check("P04446", "matches searches the kind and reason LABELS, not just the raw codes", () => {
    if (!A) return "module not loaded";
    const r = rows()[0];
    const label = A.KIND_LABEL ? A.KIND_LABEL[r.kind] : null;
    if (!label) return "skip";
    return A.matches(r, label.slice(0, 5).toLowerCase(), label, null) === true;
  });
  check("P04447", "sumAmount ignores non-numeric amounts instead of producing NaN", () => {
    if (!A) return "module not loaded";
    const t = A.sumAmount([{ amount: "100" }, { amount: "not a number" }, { amount: 50 }]);
    return Number.isFinite(t) && t === 150 ? true : `got ${t}`;
  });
  check("P04448", "sumAmount of an empty list is 0, not NaN", () => {
    if (!A) return "module not loaded";
    return A.sumAmount([]) === 0;
  });
  check("P04449", "view() applies filter then sort, and never mutates its input array", () => {
    if (!A) return "module not loaded";
    const input = rows();
    const before = JSON.stringify(input);
    A.view(input, { sort: "old", q: "" });
    return JSON.stringify(input) === before ? true : "view() mutated the array it was given";
  });
  check("P04450", "activityGroupOf maps every action the panels emit to a group", () => {
    if (!A) return "module not loaded";
    const sample = ["order_place", "bill_paid", "login", "kot_print", "menu_item_update",
      "table_open", "inv_count_submit", "staff_set_permissions", "restaurant_create", "some_error"];
    const ungrouped = sample.filter((a) => !A.activityGroupOf(a));
    return ungrouped.length ? `no group for: ${ungrouped.join(", ")}` : true;
  });
  check("P04451", "an unknown action lands in a catch-all group rather than disappearing", () => {
    if (!A) return "module not loaded";
    const g = A.activityGroupOf("a_totally_invented_action_name");
    return g ? true : "an unknown action has no group, so it would vanish from the log";
  });
  check("P04452", "activityCounts totals match activityView's unfiltered length", () => {
    if (!A) return "module not loaded";
    const acts = rows().map((r, i) => ({ ...r, action: ["order_place", "login", "bill_paid", "kot_print", "menu_item_update"][i] }));
    const total = A.activityCounts(acts).reduce((t, x) => t + x.count, 0);
    const seen = A.activityView(acts, { sort: "new", q: "" }).length;
    return total === seen ? true : `counts say ${total}, the view shows ${seen}`;
  });
  check("P04453", "activityMatches is case-insensitive and searches the readable text", () => {
    if (!A) return "module not loaded";
    const r = { action: "order_place", actor: "Asha", at: "2026-01-01T00:00:00Z" };
    return A.activityMatches(r, "asha") === A.activityMatches(r, "ASHA");
  });
  check("P04454", "activityView never mutates its input", () => {
    if (!A) return "module not loaded";
    const input = rows().map((r) => ({ ...r, action: "order_place" }));
    const before = JSON.stringify(input);
    A.activityView(input, { sort: "old", q: "" });
    return JSON.stringify(input) === before;
  });

  // NEW - auditsort
  check("P66161", "the module really loads outside a browser", () => !!A || `it does not: ${loadErr}`);
  check("P66162", "sortRows does not mutate its input either", () => {
    if (!A) return "module not loaded";
    const input = rows();
    const before = JSON.stringify(input);
    A.sortRows(input, "amount");
    return JSON.stringify(input) === before ? true : "sortRows sorted the caller's own array in place";
  });
  check("P66163", "'Biggest amount' really orders by amount, descending", () => {
    if (!A) return "module not loaded";
    const out = A.sortRows(rows(), "amount").map((r) => Number(r.amount));
    return JSON.stringify(out) === JSON.stringify([...out].sort((a, b) => b - a));
  });
  check("P66164", "'Newest first' and 'Oldest first' are exact mirrors", () => {
    if (!A) return "module not loaded";
    const a = A.sortRows(rows(), "new").map((r) => r.id);
    const b = A.sortRows(rows(), "old").map((r) => r.id);
    return JSON.stringify(a) === JSON.stringify([...b].reverse());
  });
  check("P66165", "a row with an unparseable date sorts to the end rather than throwing", () => {
    if (!A) return "module not loaded";
    const withBad = [...rows(3), { id: 99, at: "not a date", kind: "x" }];
    const out = A.sortRows(withBad, "new");
    return out.length === 4;
  });
  check("P66166", "an empty list is handled by every sort", () => {
    if (!A) return "module not loaded";
    return A.SORTS.every((s) => A.sortRows([], s.id).length === 0);
  });
  check("P66167", "a null list does not throw", () => {
    if (!A) return "module not loaded";
    try { A.sortRows(null, "new"); A.kindCounts(null); A.sumAmount(null); A.activityCounts(null); return true; }
    catch (e) { return `it threw: ${e.message}`; }
  });
  check("P66168", "every sort in SORTS has an id, a label and a comparator", () => {
    if (!A) return "module not loaded";
    const bad = A.SORTS.filter((s) => !s.id || !s.label || typeof s.cmp !== "function");
    return bad.length ? `malformed: ${JSON.stringify(bad)}` : true;
  });
  check("P66169", "the default sort id is one that really exists", () => {
    if (!A) return "module not loaded";
    return A.SORTS.some((s) => s.id === A.DEFAULT_SORT);
  });
  check("P66170", "the activity default sort id is one that really exists", () => {
    if (!A) return "module not loaded";
    return A.ACTIVITY_SORTS.some((s) => s.id === A.ACTIVITY_DEFAULT_SORT);
  });
  check("P66171", "every activity group has a label and an icon, so no row renders bare", () => {
    if (!A) return "module not loaded";
    const bad = A.ACTIVITY_GROUPS.filter((g) => !g.label || !g.icon || typeof g.test !== "function");
    return bad.length ? `malformed group(s): ${bad.map((g) => g.id).join(", ")}` : true;
  });
  check("P66172", "the catch-all group is LAST, or it would swallow every action before it", () => {
    if (!A) return "module not loaded";
    const last = A.ACTIVITY_GROUPS[A.ACTIVITY_GROUPS.length - 1];
    return last && last.id === "other" ? true : `the last group is ${last && last.id}, not the catch-all`;
  });
  check("P66173", "a blank search matches everything rather than nothing", () => {
    if (!A) return "module not loaded";
    return rows().every((r) => A.matches(r, "") !== false);
  });
  check("P66174", "tagLabel and tagIcon fall back rather than printing undefined", () => {
    if (!A) return "module not loaded";
    return A.tagLabel("no-such-tag") === "no-such-tag" && typeof A.tagIcon("no-such-tag") === "string"
      && A.tagIcon("no-such-tag").length > 0;
  });
  check("P66175", "activityGroupLabel falls back to the id rather than undefined", () => {
    if (!A) return "module not loaded";
    return A.activityGroupLabel("no-such-group") === "no-such-group";
  });
  check("P66176", "sumAmount tolerates a null amount without turning the total into NaN", () => {
    if (!A) return "module not loaded";
    const t = A.sumAmount([{ amount: null }, { amount: 10 }, {}]);
    return t === 10 ? true : `got ${t}`;
  });
  check("P66177", "kindCounts is ordered biggest-first so the common thing reads first", () => {
    if (!A) return "module not loaded";
    const many = [...rows(4), ...rows(4)].map((r, i) => ({ ...r, kind: i < 6 ? "order_delete" : "bill_delete" }));
    const cs = A.kindCounts(many);
    return cs.length < 2 || cs[0].count >= cs[1].count;
  });
  check("P66178", "the panel loads auditsort.js, and only the manager panel does", () =>
    /auditsort\.js/.test(c.editorHtml || "") && !/auditsort\.js/.test(c.kitchenHtml || "") &&
    !/auditsort\.js/.test(c.tabletHtml || ""));
  check("P02016", "auditsort.js is loaded with a content hash", () =>
    /auditsort\.js\?v=[a-f0-9]{6,}/.test(c.editorHtml || ""));

  // ── vendor/** - the self-hosted third-party assets (P04483-P04488) ──────────────────────
  {
    const vendorDir = P("public/panels/vendor");
    let files = [];
    try { files = fs.readdirSync(vendorDir, { recursive: true }).map(String); } catch { /* none */ }

    check("P04483", "the third-party assets are self-hosted, not pulled from a public CDN", () => {
      const cdn = ["editorHtml", "kitchenHtml", "tabletHtml"]
        .filter((k) => /jsdelivr|unpkg|cdnjs|googleapis\.com\/(ajax|css)/.test(c[k] || ""));
      return cdn.length ? `these still reach a CDN: ${cdn.join(", ")}` : true;
    });
    check("P04484", "Chart.js is present as a single minified vendor file", () =>
      files.some((f) => /chart\.umd\.min\.js$/.test(f)));
    check("P04485", "Font Awesome ships its own webfonts rather than fetching them", () =>
      files.filter((f) => /webfonts\/.*\.woff2$/.test(f)).length >= 3);
    check("P04486", "both a woff2 and a ttf exist for each face, so an old tablet still renders icons", () => {
      const woff = files.filter((f) => /webfonts\/(fa-[\w-]+)\.woff2$/.test(f)).map((f) => f.replace(/\.woff2$/, ""));
      const ttf = files.filter((f) => /webfonts\/(fa-[\w-]+)\.ttf$/.test(f)).map((f) => f.replace(/\.ttf$/, ""));
      const missing = woff.filter((w) => !ttf.includes(w));
      return missing.length ? `no .ttf twin for: ${missing.join(", ")}` : true;
    });
    check("P04487", "the Font Awesome stylesheet is vendored beside its fonts", () =>
      files.some((f) => /fa\/css\/all\.min\.css$/.test(f)));
    check("P04488", "the vendored CSS points at the local webfonts folder, not a CDN", () => {
      let css = "";
      try { css = fs.readFileSync(path.join(vendorDir, "fa/css/all.min.css"), "utf8"); } catch { return "skip"; }
      return /jsdelivr|unpkg|cdnjs|use\.fontawesome\.com/.test(css)
        ? "the vendored stylesheet still reaches a CDN for its fonts" : /\.\.\/webfonts\//.test(css);
    });
    check("P66179", "the kitchen and tablet do NOT load Font Awesome (their icons are emoji)", () =>
      !/fa\/css\/all\.min\.css/.test(c.kitchenHtml || "") && !/fa\/css\/all\.min\.css/.test(c.tabletHtml || ""));
    check("P66180", "no vendored asset is an unbounded map file shipped to a phone", () =>
      !files.some((f) => /\.js\.map$/.test(f)));
  }

  // ── cross-file and cross-panel (P04489-P04500, plus the other ledgers' load-order rows) ──
  {
    const PANELS = ["editorHtml", "kitchenHtml", "tabletHtml"];
    const srcsOf = (k) => [...(c[k] || "").matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    const orderCheck = (id, what, first, second, panels = PANELS) => check(id, what, () => {
      for (const k of panels) {
        const s = srcsOf(k);
        const a = s.findIndex((x) => x.includes(first));
        const b = s.findIndex((x) => x.includes(second));
        if (a < 0) return `${k}: ${first} is not loaded`;
        if (b < 0) return `${k}: ${second} is not loaded`;
        if (a > b) return `${k}: ${first} must load before ${second}`;
      }
      return true;
    });

    orderCheck("P04489", "realtime.js loads before connbadge.js, which reads it", "/realtime.js", "/connbadge.js");
    orderCheck("P02516", "connbadge.js loads after BOTH realtime.js and outbox.js", "/outbox.js", "/connbadge.js");
    orderCheck("P02013", "outbox.js loads before offline.js", "/outbox.js", "/offline.js");
    orderCheck("P02515", "outbox.js loads before app.js, or a write would miss the queue", "/outbox.js", "app.js");
    orderCheck("P02517", "offline.js loads after outbox.js and before app.js", "/offline.js", "app.js");
    orderCheck("P02012", "backstack.js loads before app.js", "/backstack.js", "app.js");
    orderCheck("P17742", "swreg.js loads before offline.js", "/swreg.js", "/offline.js");
    orderCheck("P64557", "offline.js is loaded AFTER the outbox it reads", "/outbox.js", "/offline.js");
    orderCheck("P62214", "outbox.js loads before offline.js (T8's own row)", "/outbox.js", "/offline.js");
    orderCheck("P62215", "swreg.js loads before offline.js (T8's own row)", "/swreg.js", "/offline.js");

    check("P02514", "theme.js runs in <head>, before paint", () => {
      for (const k of PANELS) {
        const head = (c[k] || "").slice(0, (c[k] || "").indexOf("</head>"));
        if (!/theme\.js/.test(head)) return `${k}: theme.js is not in <head>`;
      }
      return true;
    });
    check("P02519", "undobar.js is present so the mis-tap take-back can render", () =>
      PANELS.every((k) => /undobar\.js/.test(c[k] || "")));
    check("P02520", "fitnums.js is scoped to .kot on the kitchen", () =>
      /fitnums\.js\?v=[a-f0-9]+" data-fit="\.kot"/.test(c.kitchenHtml || ""));
    check("P02014", "guestbell.js is loaded where the bell belongs", () => /guestbell\.js/.test(c.editorHtml || ""));
    check("P02751", "the kitchen's two no-profile flags are set at the very top of its app.js", () => {
      /* The flags are set in the PANEL'S OWN app.js, not in its index.html — this check looked in
         the markup on its first run and reported the kitchen had stopped declaring them. What
         matters is that they are top-level and near the top, so they are already set by the time
         maint.js's init() runs on DOMContentLoaded. */
      const app = c.kitchenApp || "";
      if (!app) return "the kitchen app.js is not in this tree";
      const lines = app.split("\n");
      const at = (needle) => lines.findIndex((l) => l.includes(needle));
      const noProfile = at("window.LFH_NO_PROFILE_AT_ALL");
      const suppress = at("window.LFH_SUPPRESS_SETTINGS_BTN");
      if (noProfile < 0) return "the kitchen no longer declares LFH_NO_PROFILE_AT_ALL";
      if (suppress < 0) return "the kitchen no longer declares LFH_SUPPRESS_SETTINGS_BTN";
      return noProfile < 60 && suppress < 60
        ? true : `the flags have drifted down the file (lines ${suppress + 1} and ${noProfile + 1})`;
    });
    check("P02778", "every panel has both skins and dark is not forced", () =>
      PANELS.every((k) => /theme\.js/.test(c[k] || "")));

    // the shared header spellings, both ends (T4's band E)
    check("P01926", "X-LFH-From-Cache is set by sw.js and read by offline.js under the same spelling", () =>
      /X-LFH-From-Cache/.test(c.sw || "") && /X-LFH-From-Cache/.test(c.offline));
    check("P01928", "X-LFH-Offline is set by sw.js and read by offline.js", () =>
      /X-LFH-Offline/.test(c.sw || "") && /X-LFH-Offline/.test(c.offline));
    check("P66181", "X-LFH-Cached-At is set by sw.js and read by offline.js", () =>
      /X-LFH-Cached-At/.test(c.sw || "") && /X-LFH-Cached-At/.test(c.offline));
    check("P01937", "--offbar-h is published by offline.js and consumed by a panel stylesheet", () => {
      if (!/--offbar-h/.test(c.offline)) return "offline.js no longer publishes it";
      const users = ["editorCss", "kitchenCss", "tabletCss"].filter((k) => /--offbar-h/.test(c[k] || ""));
      return users.length ? true : "no panel stylesheet consumes --offbar-h, so the bar would cover content";
    });
    check("P01940", "lfh:stale-refresh is dispatched by offline.js and handled by the panels", () => {
      if (!/lfh:stale-refresh/.test(c.offline)) return "offline.js no longer dispatches it";
      const handlers = ["editorApp", "kitchenApp", "tabletApp"].filter((k) => /lfh:stale-refresh/.test(c[k] || ""));
      return handlers.length >= 1 ? true : "no panel listens for lfh:stale-refresh";
    });
    check("P01943", "LFH_OUTBOX.onChange is provided by outbox.js and consumed by offline.js", () =>
      /onChange:/.test(c.outbox) && /LFH_OUTBOX\.onChange/.test(c.offline));
    check("P66182", "lfh:outbox-flushed is dispatched by outbox.js and heard by at least one panel", () => {
      if (!/lfh:outbox-flushed/.test(c.outbox)) return "outbox.js no longer dispatches it";
      const heard = ["editorApp", "kitchenApp", "tabletApp"].filter((k) => /lfh:outbox-flushed/.test(c[k] || ""));
      return heard.length >= 1 ? true : "nothing listens, so a finished sync never refetches true state";
    });
    check("P02438", "the queue's refusal wording lives in outbox.js and is read back out of it", () =>
      /const REASONS = \{/.test(c.outbox) &&
      ["editorApp", "kitchenApp", "tabletApp"].some((k) => /LFH_OUTBOX\.REASONS|LFH_OUTBOX && window\.LFH_OUTBOX\.REASONS/.test(c[k] || "")));
    check("P01595", "the offline bar's settle still reasons from the worker's own 6s stall guard", () => {
      const sw = c.sw || "";
      const nav = Number((sw.match(/NAV_TIMEOUT_MS\s*=\s*(\d+)/) || [])[1]);
      const read = Number((sw.match(/READ_TIMEOUT_MS\s*=\s*(\d+)/) || [])[1]);
      if (!nav || !read) return "could not read the worker's two timeouts";
      return nav >= 6000 && read >= 6000
        ? true : `the worker now answers from the device sooner (${nav}/${read}ms) than the bar's settle assumes`;
    });
    check("P01710", "no panel helper fabricates a bill, KOT or invoice number while offline", () => {
      const mine = ["offline", "outbox", "connbadge", "guestbell"];
      const bad = mine.filter((k) => /bill_no *=|kot_no *=|invoice_no *=/.test(c[k] || ""));
      return bad.length ? `these assign a document number: ${bad.join(", ")}` : true;
    });
    check("P14589", "a breadcrumb with NO table is treated as 'reload the whole floor', never dropped", () =>
      /const spans = !tn \|\| \(row && row\.kind === "platform"\)/.test(c.realtime) &&
      /if \(spans\) a\.full = true;/.test(c.realtime));

    // P04490-P04500 + T27's English rows, judged across the whole territory
    const MINE = {
      outbox: "outbox.js", realtime: "realtime.js", connbadge: "connbadge.js", offline: "offline.js",
      errlog: "errlog.js", theme: "theme.js", fitnums: "fitnums.js", backstack: "backstack.js",
      undobar: "undobar.js", guestbell: "guestbell.js", myprofile: "myprofile.js", maint: "maint.js",
      issueRaise: "issue-raise.js", swipehint: "swipehint.js", auditsort: "auditsort.js",
      swreg: "swreg.js", floorLayouts: "floor-layouts.js",
    };
    check("P04490", "every helper is wrapped so it cannot leak a global by accident", () => {
      const bad = Object.entries(MINE).filter(([k]) => {
        const src = (c[k] || "").trim();
        if (!src) return false;
        if (k === "floorLayouts") return false;   // DATA, deliberately a bare assignment
        return !/\(function \(\)/.test(src) && !/\(function\(\)/.test(src);
      }).map(([, f]) => f);
      return bad.length ? `not wrapped in an IIFE: ${bad.join(", ")}` : true;
    });
    check("P04491", "every global this territory publishes is on the LFH_ prefix", () => {
      const globals = new Set();
      for (const k of Object.keys(MINE)) {
        for (const m of (c[k] || "").matchAll(/window\.(\w+)\s*=/g)) globals.add(m[1]);
        for (const m of (c[k] || "").matchAll(/globalThis\.(\w+)\s*=/g)) globals.add(m[1]);
      }
      const stray = [...globals].filter((g) => !/^LFH_/.test(g) && g !== "__lfh_rt");
      return stray.length ? `these are not LFH_-prefixed: ${stray.join(", ")}` : true;
    });
    check("P04492", "only ONE file owns the staff queue's storage", () => {
      const owners = Object.entries(MINE).filter(([k]) => /indexedDB\.open/.test(c[k] || "")).map(([, f]) => f);
      return owners.length === 1 && owners[0] === "outbox.js" ? true : `IndexedDB is opened by: ${owners.join(", ") || "nobody"}`;
    });
    check("P04493", "no helper POLLS THE SERVER faster than the 60s backstop", () => {
      /* The rule is about READS, not repaints. issue-raise.js redraws the recording button every
         250ms to move the elapsed-seconds counter, and the undo bar and offline bar tick to keep
         their own wording honest — all pure DOM, no request, no database. Flagging those was this
         check's own bug: it counted every interval rather than every interval that costs egress.
         So: a sub-second interval is only a fault when its callback actually goes to the server. */
      const bad = [];
      for (const [k, f] of Object.entries(MINE)) {
        const src = c[k] || "";
        for (const m of src.matchAll(/setInterval\(([\s\S]{0,400}?),\s*(\d+)\)/g)) {
          const body = m[1], ms = Number(m[2]);
          if (ms >= 1000) continue;
          if (/fetch\(|LFH_OUTBOX\.flush|api\(|sendBeacon/.test(body)) bad.push(`${f} @ ${ms}ms goes to the server`);
        }
      }
      return bad.length ? bad.join(", ") : true;
    });
    check("P04494", "no helper in this territory reads the database directly", () => {
      const bad = Object.entries(MINE).filter(([k]) => /supabase\.from\(|createClient\(/.test(c[k] || "") && k !== "realtime").map(([, f]) => f);
      return bad.length ? `these talk to the database: ${bad.join(", ")}` : true;
    });
    check("P04495", "every helper that opens an overlay registers it with the back manager", () => {
      const overlays = { connbadge: "the connection popover", offline: "the needs-you sheet",
        guestbell: "the bell sheet", myprofile: "the profile overlay", maint: "the settings drawer",
        issueRaise: "the report-an-issue modal" };
      const bad = Object.entries(overlays).filter(([k]) => !/LFH_BACK/.test(c[k] || "")).map(([, w]) => w);
      return bad.length ? `no back layer: ${bad.join(", ")}` : true;
    });
    check("P04496", "no helper uses the browser's own alert/confirm/prompt", () => {
      const bad = [];
      for (const [k, f] of Object.entries(MINE)) {
        const src = c[k] || "";
        // myprofile keeps alert() as the LAST-RESORT fallback behind LFH_ASK, and says so
        if (k === "myprofile") continue;
        if (/(^|[^.\w])(alert|confirm|prompt)\s*\(/.test(src)) bad.push(f);
      }
      return bad.length ? `these still use a native dialog: ${bad.join(", ")}` : true;
    });
    check("P04497", "every panel-visible string in this territory is English", () => {
      const bad = Object.entries(MINE).filter(([k]) => /lib\/i18n|i18n\.t\(/.test(c[k] || "")).map(([, f]) => f);
      return bad.length ? `these route panel text through i18n: ${bad.join(", ")}` : true;
    });
    check("P04498", "no helper writes a document number or a money total of its own", () => {
      const bad = Object.entries(MINE)
        .filter(([k]) => k !== "auditsort" && /toFixed\(2\)\s*\+\s*"/.test(c[k] || ""))
        .map(([, f]) => f);
      return bad.length ? `these format money themselves: ${bad.join(", ")}` : true;
    });
    check("P04499", "every helper is served with a content hash so no device runs a stale copy", () => {
      const bad = [];
      for (const k of PANELS) {
        for (const src of srcsOf(k)) {
          if (!/^\/panels\/[\w-]+\.js/.test(src)) continue;
          if (!/\?v=[a-f0-9]{6,}/.test(src)) bad.push(`${k}: ${src}`);
        }
      }
      return bad.length ? `no content hash: ${bad.join(", ")}` : true;
    });
    check("P04500", "no two helpers define the same global", () => {
      const owner = {};
      const clashes = [];
      for (const [k, f] of Object.entries(MINE)) {
        for (const m of (c[k] || "").matchAll(/window\.(LFH_\w+)\s*=\s*(?!window\.)/g)) {
          const g = m[1];
          if (owner[g] && owner[g] !== f) clashes.push(`${g}: ${owner[g]} and ${f}`);
          else owner[g] = f;
        }
      }
      return clashes.length ? clashes.join("; ") : true;
    });

    // T27's "reads as English" rows, re-run as one judgement per file
    const ENGLISH = {
      P13402: "auditsort", P13403: "backstack", P13406: "connbadge", P13409: "errlog",
      P13410: "fitnums", P13411: "floorLayouts", P13412: "guestbell", P13413: "issueRaise",
      P13417: "offline",
    };
    for (const [id, key] of Object.entries(ENGLISH)) {
      check(id, `public/panels/${MINE[key]} — its visible text reads as English`, () => {
        const src = c[key] || "";
        if (!src) return `${MINE[key]} is not in this tree`;
        // no raw status codes, no template leftovers, no developer shorthand in a user string
        const strings = [...src.matchAll(/"([^"\\]{8,120})"/g)].map((m) => m[1])
          .filter((s) => / /.test(s) && !/^[\w./-]+$/.test(s) && !/^[a-z-]+:[a-z-]/.test(s));
        const junk = strings.filter((s) => /\$\{|\[object |undefined|NaN|-->/.test(s));
        return junk.length ? `these read as code, not English: ${junk.slice(0, 3).join(" | ")}` : true;
      });
    }

    // NEW - cross-panel
    check("P66183", "the three panels load the SAME shared helpers, so none drifts", () => {
      const shared = ["outbox.js", "realtime.js", "connbadge.js", "offline.js", "errlog.js",
        "theme.js", "swreg.js", "backstack.js", "undobar.js", "issue-raise.js", "maint.js", "fitnums.js"];
      const missing = [];
      for (const k of PANELS) for (const f of shared) if (!new RegExp(f.replace(".", "\\.")).test(c[k] || "")) missing.push(`${k} is missing ${f}`);
      return missing.length ? missing.join("; ") : true;
    });
    check("P66184", "every shared helper carries the SAME content hash in all three panels", () => {
      const bad = [];
      const seen = {};
      for (const k of PANELS) {
        for (const src of srcsOf(k)) {
          const m = src.match(/^\/panels\/([\w-]+\.js)\?v=([a-f0-9]+)/);
          if (!m) continue;
          if (seen[m[1]] && seen[m[1]] !== m[2]) bad.push(`${m[1]}: ${seen[m[1]]} vs ${m[2]}`);
          else seen[m[1]] = m[2];
        }
      }
      return bad.length ? `a panel is serving a different build: ${bad.join(", ")}` : true;
    });
    check("P66185", "no helper is loaded twice in the same panel", () => {
      for (const k of PANELS) {
        const names = srcsOf(k).map((s) => (s.match(/\/panels\/([\w-]+\.js)/) || [])[1]).filter(Boolean);
        const dupes = names.filter((n, i) => names.indexOf(n) !== i);
        if (dupes.length) return `${k} loads ${[...new Set(dupes)].join(", ")} twice`;
      }
      return true;
    });
    check("P66186", "the kitchen declares it has NO profile, which is the owner's ruling three times over", () =>
      /window\.LFH_NO_PROFILE_AT_ALL\s*=\s*true/.test(c.kitchenApp || "") &&
      !/myprofile\.js/.test(c.kitchenHtml || ""));
    check("P66187", "the waiter tablet suppresses only the everyday settings button, because it HAS a profile", () =>
      /window\.LFH_SUPPRESS_SETTINGS_BTN\s*=\s*true/.test(c.tabletApp || "") &&
      !/window\.LFH_NO_PROFILE_AT_ALL/.test(c.tabletApp || "") &&
      /myprofile\.js/.test(c.tabletHtml || ""));
  }
}
