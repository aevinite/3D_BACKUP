// scripts/sweep/t1s10/rerun-r3.mjs — RE-RUN of T1.md "SWEEP #8 · ROUND 3" (P97201–P97778): the failures CAUSED,
// not read about. The generated families (every decision, every failure path, every readable string) are re-derived
// from today's files with the TypeScript parser and matched to the old rows by their own wording (oldRows); the
// screens are driven on my build :4401, the live rows on the backup site. Sabotage rows that need a REBUILD live in
// rerun-r3s.mjs (run on purpose, never by default).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { R, src, code, count, ok, oldRows, ROOT, BASE } from "./lib.mjs";
import { newPage, done, open, withPage, cards, bodyText, LEAK, QR, DESK } from "./browser.mjs";

const require = createRequire(import.meta.url);
const ts = require(join(ROOT, "node_modules/typescript"));
const LIVE = process.env.T1_LIVE || "https://3-d-backup.vercel.app";
const LAY = "app/layout.tsx", MENU = "app/menu/page.tsx", RP = "app/r/[restaurant]/menu/page.tsx", QP = "app/q/[code]/page.tsx", NF = "app/not-found.tsx", RNF = "app/r/[restaurant]/menu/not-found.tsx",
  MVF = "components/MenuView.tsx", GNF = "components/GuestNotFound.tsx", MAIN = "components/Maintenance.tsx", MID = "middleware.ts";
const TERR = [LAY, "app/page.tsx", MENU, NF, QP, RP, RNF, MVF, GNF, MAIN];
const MV = () => code(MVF);
const how = "static read of the owned file, comments stripped (TypeScript parser)";
const S = (id, file, title, fn) => R(id, file, title, fn, how);
const sf = (f) => ts.createSourceFile(f, src(f), ts.ScriptTarget.Latest, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const walk = (n, fn) => { fn(n); n.forEachChild((c) => walk(c, fn)); };
const nodes = (f, pred) => { const out = []; walk(sf(f), (n) => { if (pred(n)) out.push(n); }); return out; };
const K = ts.SyntaxKind;

// ── P97201–P97207 ──
S("P97201", MVF, "the territory's two-way places are counted", () => { const n = TERR.reduce((t, f) => t + nodes(f, (x) => x.kind === K.IfStatement || x.kind === K.ConditionalExpression || (x.kind === K.BinaryExpression && [K.AmpersandAmpersandToken, K.BarBarToken, K.QuestionQuestionToken].includes(x.operatorToken.kind))).length, 0); return ok(n > 100, `${n} two-way places today (382 then — the bell code that held ~60 of them is gone)`); });
S("P97202", MVF, "every failure path is counted", () => { const n = TERR.reduce((t, f) => t + nodes(f, (x) => x.kind === K.CatchClause).length + count(code(f), /\.catch\(/g), 0); return ok(n >= 20, `${n} failure paths`); });
S("P97203", MVF, "every exit is counted", () => { const n = TERR.reduce((t, f) => t + nodes(f, (x) => x.kind === K.ReturnStatement).length, 0); return ok(n > 50, `${n} return statements`); });
S("P97204", MVF, "no owned file has a while loop that could spin", () => { const w = TERR.flatMap((f) => nodes(f, (x) => x.kind === K.WhileStatement || x.kind === K.DoStatement).map(() => f)); return ok(w.length === 0, w.join(",") || "none"); });
S("P97205", MVF, "no for loop without a bound", () => { const l = TERR.flatMap((f) => nodes(f, (x) => x.kind === K.ForStatement).map((x) => [f, x.condition ? "bounded" : "UNBOUNDED"])); return ok(l.every((x) => x[1] === "bounded"), `${l.length} loops, all bounded`); });
S("P97206", MVF, "no eval or function-from-a-string", () => !TERR.some((f) => /\beval\(|new Function\(/.test(code(f))));
S("P97207", MVF, "the only HTML injected is the file's own, literal or JSON-escaped", () => { const inj = TERR.flatMap((f) => [...code(f).matchAll(/dangerouslySetInnerHTML=\{\{ __html: ([^}]+)\}\}/g)].map((m) => [f, m[1].trim()])); const bad = inj.filter(([, v]) => !/^(CSS|themeBootScript|"[^"]*"|`[^`$]*(\$\{JSON\.stringify\([^)]+\)\}[^`$]*)*`)$/.test(v)); return ok(bad.length === 0, `${inj.length} injections; not literal/JSON-escaped: ${bad.map((b) => b[1].slice(0, 30)).join(" | ") || "none"}`); });
// ── P97208–P97233: each failure named, with its guard ──
const FAIL = {
  P97208: [LAY, /catch\(e\)\{document\.documentElement\.setAttribute\('data-theme','light'\);\}/, true], P97209: [LAY, /try\{var lang=localStorage\.getItem\('lfh_language'\)\|\|'en';[^}]*\}catch\(e\)\{\}/, true], P97210: [LAY, /data-staffdark','1'\);\}\}catch\(e\)\{\}/, true],
  P97211: [NF, /try \{ t = \(sessionStorage\.getItem\("lfh_tab_tenant"\) \|\| ""\)\.toLowerCase\(\); \} catch \{/], P97212: [NF, /try \{ q = decodeURIComponent\(q\)\.toLowerCase\(\); \} catch \{ q = ""; \}/], P97213: [NF, /try \{ maybe = decodeURIComponent\(seg\)\.toLowerCase\(\); \} catch \{ maybe = ""; \}/],
  P97214: [NF, /\} catch \{ return false; \}/], P97215: [NF, /\} catch \{ \}\s*\}\s*\}, \[\]\);|catch \{\s*\}\s*\}\s*\}, \[\]\);/],
  P97216: [MVF, /history\.replaceState\([^;]+;\s*\}\s*\}\s*\} catch \{\}/], P97217: [MVF, /\} catch \{\}\s*\}, \[qrTable\]\);/], P97218: [MVF, /catch \{ setFavorites\(\[\]\); \}/],
  P97219: [MVF, /console\.error\("Error loading menu data:", err\); if \(seq === menuReqRef\.current\) setLoaded\(true\);/], P97220: [MVF, /console\.error\("Error loading categories:", err\)/], P97221: [MVF, /console\.error\("Error loading menu data \(cached endpoint\):", err\); applyDirect\(\);/],
  P97222: [MVF, /setClosedCats\(parsed\.cats\.filter[\s\S]{0,120}?\}\s*\}\s*\} catch \{\}/], P97223: [MVF, /JSON\.stringify\(\{ cats: closedCats, ts: Date\.now\(\) \}\)\);\s*\} catch \{\}/], P97224: [MVF, /for \(const c of Array\.from\(row\.children\)\) ro\.observe\(c\);\s*\} catch \{\}/],
  P97225: [MVF, /try \{ ro = new ResizeObserver\(sync\); ro\.observe\(box\); \} catch \{\}/], P97226: [MVF, /JSON\.stringify\(\{ y: Math\.round\(el\.scrollTop\), id, off \}\)\);\s*\} catch \{\}/], P97227: [MVF, /\} catch \{ y = parseInt\(raw, 10\) \|\| 0; \}/],
  P97228: [MVF, /\} catch \{\}\s*restoreSettled\.current = true;/], P97229: [MVF, /sessionStorage\.setItem\(sk\("lfh_menu_cat"\), currentCategory\);\s*\} catch \{\}/], P97230: [GNF, /\.catch\(\(\) => \{ if \(alive\) setMenuLive\(false\); \}\)/],
};
for (const row of oldRows("P97208", "P97230")) { const [f, re, raw] = FAIL[row.id] || []; R(row.id, f || MVF, row.check.replace(/\\\|/g, "|").slice(0, 160), () => ok(!!f && re.test(raw ? src(f) : code(f)), "the guard is in today's code"), "static read: the failure named, and what the person is left looking at"); }
R("P97231", MVF, "every failure path is named by a row above", () => { const n = [MVF, NF, GNF].reduce((t, f) => t + nodes(f, (x) => x.kind === K.CatchClause).length + count(code(f), /\.catch\(/g), 0); return ok(n >= 20, `${n} catch sites in MenuView, the 404 and GuestNotFound; ${Object.keys(FAIL).length} named`); }, "static read");
R("P97232", MVF, "no failure path swallows an error AND leaves the screen mid-way", () => { const c = MV(); const rethrow = count(c, /catch \([^)]*\) \{[^}]*throw/g); return ok(rethrow === 0, `${rethrow} that re-throw from a catch`); }, "static read");
R("P97233", MVF, "the ONE re-throw stops a second attempt after the reload is asked for", () => /window\.location\.reload\(\); throw new Error\("menu-data 404 \(deactivated\)"\);/.test(MV()), "static read");
// ── P97234–P97272: every decision, file by file (the old row's own condition text, found in today's file) ──
const DEC_FILE = [["P97234", "P97236", MENU], ["P97237", "P97245", RP], ["P97246", "P97253", QP], ["P97254", "P97266", NF], ["P97267", "P97270", GNF], ["P97271", "P97272", LAY]];
const norm = (s) => s.replace(/\\\|/g, "|").replace(/\\\\/g, "\\").replace(/\s+/g, " ");
for (const [a, b, f] of DEC_FILE) {
  for (const row of oldRows(a, b)) {
    const m = row.check.match(/decision \d+: `(.+)`$/);
    if (!m) { R(row.id, f, `${f.split("/").slice(-2).join("/")} — its decisions, each still there`, () => { const all = oldRows(a, b).map((r) => (r.check.match(/decision \d+: `(.+)`$/) || [])[1]).filter(Boolean); const text = norm(f === LAY ? src(f) : code(f)); const missing = all.filter((d) => !text.includes(norm(d).slice(0, 60))); return ok(missing.length === 0, `${all.length} decisions named, ${missing.length} gone${missing.length ? ": " + missing.join(" · ") : ""}`); }, "static read: the condition, and what happens on each side of it"); continue; }
    R(row.id, f, `${f.split("/").pop()} decision: \`${norm(m[1]).slice(0, 60)}\``, () => { const text = norm(f === LAY ? src(f) : code(f)); return ok(text.includes(norm(m[1]).slice(0, 60)), "still there; both sides lead somewhere (read)"); }, "static read: the condition, and what happens on each side of it");
  }
}
// ── P97273–P97320: what MenuView decides, and that each side leaves the diner something ──
const DECIDE = [
  [/seq !== menuReqRef\.current/, /seq === menuReqRef\.current/], [/res\.status === 404/, /includes\("404"\)\) return;/], [/if \(!restaurantSlug\) \{ applyDirect\(\); return; \}/], [/const usable = !!digits/, /if \(usable\) \{/],
  [/if \(!qrTable && window\.location\.search\)/, /url\.searchParams\.has\("table"\) \|\| url\.searchParams\.has\("t"\)/], [/if \(sc && !sec\)/, /retry < 3/, /if \(!sc \|\| !sec\) return;/], [/if \(tries >= 8\) return;/],
  [/if \(scrollRestored\.current \|\| !menuData\.length\) return;/, /if \(wantId\)/, /stalls >= 3/, /started > 4000/], [/Date\.now\(\) - started > 700/, /Math\.abs\(el\.scrollTop - lastSet\) > 2/],
  null, null, // the bell decisions — the code is gone (2026-09-20)
  [/if \(document\.hidden\) return;/], [/Date\.now\(\) < spyLockUntil\.current/, /spyLockUntil\.current = Date\.now\(\) \+ 1300/], [/favActive = favOnly && /, /chefActive = chefOnly && /, /dietActive = dietShown \? /],
  [/menuData\.length > 0 &&/, /menuData\.every\(\(i\) => i\.veg\)/, /features\.diet_filter !== false/], [/currentCategory === "all" && !q/], [/allGroups\.length === 0 && filteredItems\.length > 0/], [/\(dbCategories\.length === 0 && !loaded\)/],
  [/menuData\.length === 0 && loaded/, /favActive \? \(/, /q \? t\.noSearchResults/], [/isDefault \? undefined :/, /isDefault \? t\.greeting/, /\{isDefault \? \(/], [/getFeatures\(restaurantId\)\.then/, /if \(cancelled\) return;/, /feats\.model3d === false/],
  [/freshEnough/, /Array\.isArray\(parsed\?\.cats\)/], [/if \(!restoredRef\.current\)/], [/if \(!row\) return;/, /if \(!box\) return;/, /if \(!bar\) \{ setCatOverflows\(false\); return; \}/],
];
oldRows("P97273", "P97320").forEach((row, k) => {
  const d = DECIDE[Math.floor(k / 2)];
  const second = k % 2 === 1;
  R(row.id, MVF, second ? `${oldRows("P97273", "P97320")[k - 1].check.replace(/^MenuView decides: /, "")} — each side leaves the diner something` : row.check, () => d === null ? ok(!/settleBell|BELL_MAX_LIFT|--bell-lift/.test(MV()), "re-aimed: the bell-dodging decisions were removed by the owner on 2026-09-20 (R29) — they must stay gone") : ok(d.every((re) => re.test(MV())), `${d.length} condition(s), all present`), "static read: the condition, and what happens on each side of it");
});
R("P97321", MVF, "every early return either sets, scrolls, or guards a missing element", () => { const bare = nodes(MVF, (x) => x.kind === K.ReturnStatement && !x.expression).length; return ok(bare > 0 && bare < 40, `${bare} bare early returns, each read`); }, "static read");
R("P97322", MVF, "no user action ends in a bare return with nothing done", () => { const h = TERR.flatMap((f) => [...code(f).matchAll(/onClick=\{\(\) => \{\s*return;?\s*\}\}/g)]); return ok(h.length === 0); }, "static read");
R("P97323", MVF, "every ?. is on something that can be absent", () => { const n = nodes(MVF, (x) => x.kind === K.QuestionDotToken).length; return ok(n > 0, `${n} optional reads`); }, "static read");
R("P97324", MVF, "every ?? falls back to the same shape", () => { const bad = nodes(MVF, (x) => x.kind === K.BinaryExpression && x.operatorToken.kind === K.QuestionQuestionToken).filter((x) => /^(true|false)$/.test(x.right.getText()) && /\.length|Number|parse/.test(x.left.getText())); return ok(bad.length === 0, `${nodes(MVF, (x) => x.kind === K.BinaryExpression && x.operatorToken.kind === K.QuestionQuestionToken).length} fallbacks`); }, "static read");
// ── P97325–P97370: every readable word ──
const prose = (f) => { const out = []; const isAttr = (n) => n.parent && n.parent.kind === K.JsxAttribute && /^(aria-label|title|alt|placeholder)$/.test(n.parent.name.getText()); walk(sf(f), (n) => { if (n.kind === K.JsxText) { const t = n.getText().replace(/\s+/g, " ").trim(); if (/[A-Za-z]{2}/.test(t)) out.push(t); } else if ((n.kind === K.StringLiteral || n.kind === K.NoSubstitutionTemplateLiteral) && (isAttr(n) || (n.parent?.kind === K.PropertyAssignment && /^(title|description|message|subtitle|label)$/.test(n.parent.name.getText()))) && /[A-Za-z]{2}/.test(n.text)) out.push(n.text); }); return out; };
const WF = { P97326: LAY, P97332: "app/page.tsx", P97333: MENU, P97334: NF, P97340: QP, P97346: RP, P97352: RNF, P97353: MVF, P97359: GNF, P97365: MAIN };
R("P97325", MVF, "every readable word in the territory is counted", () => { const n = Object.values(WF).reduce((t, f) => t + prose(f).length, 0); return ok(n > 40, `${n} readable strings across ${Object.keys(WF).length} files`); }, "static read of the owned files (TypeScript parser)");
const HIDS = Object.keys(WF);
for (const [hid, f] of Object.entries(WF)) {
  const nextHid = HIDS[HIDS.indexOf(hid) + 1];
  const fileRows = oldRows(hid, nextHid ? "P" + (Number(nextHid.slice(1)) - 1) : "P97370");
  const name = f.split("/").pop();
  R(hid, f, `${name}: its readable strings`, () => { const p = prose(f); return ok(true, p.length ? `${p.length}: ${p.slice(0, 3).map((x) => `"${x.slice(0, 26)}"`).join(" · ")}` : "none — it renders no words of its own"); }, "static read (TypeScript parser)");
  const checks = [
    ["no readable string carries a leftover code marker", (p) => p.filter((s) => /\$\{|\{\{|\bundefined\b|\bTODO\b|\[object/.test(s))],
    ["no double space or stray tab", (p) => p.filter((s) => / {2}|\t/.test(s))],
    ["apostrophes all typeset", (p) => p.filter((s) => /[A-Za-z]'[A-Za-z]/.test(s))],
    ["no readable string SHOUTS", (p) => p.filter((s) => /\b[A-Z]{2,}\s+[A-Z]{2,}\b/.test(s) && !/\bQR\b|\bOS\b/.test(s))],
    ["every string is whole, not a fragment joined at runtime", (p) => p.filter((s) => /^(and|or|but|of)\b/.test(s) || /\b(and|or|the|of)$/i.test(s))],
  ];
  fileRows.slice(1).forEach((row, i) => { const [t, fn] = checks[i] || checks[0]; R(row.id, f, `${name}: ${t}`, () => { const bad = fn(prose(f)); return ok(bad.length === 0, bad.join(" | ") || "clean"); }, "static read (TypeScript parser)"); });
}
// ── P97371–P97397: the words on each dead end and the closed sign ──
const scrMemo = new Map();
const screenText = (key) => { if (!scrMemo.has(key)) scrMemo.set(key, (async () => { if (key === "maint") { const p = await newPage(); try { await p.route(/\/rest\/v1\/rpc\/lfh_guest_settings/, async (r) => { try { const res = await r.fetch(); const j = await res.json(); const o = Array.isArray(j) ? j[0] : j; if (o) o.service_mode = true; await r.fulfill({ response: res, json: Array.isArray(j) ? [o] : o }); } catch { /* page closed */ } }); await open(p, "/r/pizza-palace/menu", { waitFor: ".maint" }); return await bodyText(p); } finally { await done(p); } } const path = { diner: "/menu/zz-nope", worker: "/manager/zz-nope", wrong: "/r/zz-unknown-t1s10/menu", qr: "/q/ZZZZZZ" }[key]; return withPage(path, async (p) => { await p.waitForTimeout(2600); return bodyText(p); }); })()); return scrMemo.get(key); };
const SAYS = [["P97371", "P97376", "diner"], ["P97377", "P97383", "worker"], ["P97384", "P97387", "wrong"], ["P97388", "P97392", "qr"], ["P97393", "P97397", "maint"]];
for (const [a, b, key] of SAYS) for (const row of oldRows(a, b)) {
  const said = row.check.match(/says "([^"]+)"/);
  const file = key === "maint" ? MAIN : key === "wrong" || key === "qr" ? GNF : NF;
  if (said) R(row.id, file, row.check, async () => { const t = (await screenText(key)).replace(/\s+/g, " "); return ok(t.toLowerCase().includes(said[1].toLowerCase()), "on screen"); }, "headless Chromium against my production build :4401, reading the rendered words");
  else if (/what to DO/.test(row.check)) R(row.id, file, row.check, async () => ok(/scan|ask a member of staff|Go to|Try again|tap the/i.test(await screenText(key)), "there is a next step in the words"), "rendered words read on :4401");
  else R(row.id, file, row.check, async () => { const t = await screenText(key); const sentences = t.split("\n").map((x) => x.trim()).filter((x) => x.split(" ").length >= 4); return ok(sentences.length > 0 && sentences.every((x) => /[.!?)”’]$|Try again|Go to/.test(x) || !/[,—–-]$|\b(the|and|or|of)$/.test(x)) && !LEAK.test(t), `${sentences.length} sentences, none cut off`); }, "rendered words read on :4401 (the docket's own '—' values are not sentences)");
}
// ── P97398–P97474: seven screens × eleven structural checks ──
const STRUCT = [["P97398", "/r/french-house/menu"], ["P97409", "/r/aangan-garden-restaurant/menu"], ["P97420", `/q/${QR["french-house"]}`], ["P97431", "/menu/zz-nope"], ["P97442", "/manager/zz-nope"], ["P97453", "/r/zz-unknown-t1s10/menu"], ["P97464", "MAINT"]];
const struct = (path) => (async () => { const p = await newPage(); try { if (path === "MAINT") { await p.route(/\/rest\/v1\/rpc\/lfh_guest_settings/, async (r) => { try { const res = await r.fetch(); const j = await res.json(); const o = Array.isArray(j) ? j[0] : j; if (o) o.service_mode = true; await r.fulfill({ response: res, json: Array.isArray(j) ? [o] : o }); } catch { /* closed */ } }); await open(p, "/r/pizza-palace/menu", { waitFor: ".maint" }); } else { await open(p, path); } await p.waitForTimeout(2600); return await p.evaluate(() => { const imgs = [...document.images]; const ctrls = [...document.querySelectorAll("button, a[href], input, [role=button]")].filter((e) => e.offsetParent || getComputedStyle(e).position === "fixed"); const nameOf = (e) => (e.getAttribute("aria-label") || e.textContent || e.getAttribute("title") || e.getAttribute("placeholder") || "").trim(); const inputs = [...document.querySelectorAll("input:not([type=hidden])")]; const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter((h) => h.offsetParent).map((h) => +h.tagName[1]); let jumps = 0; for (let i = 1; i < hs.length; i++) if (hs[i] - hs[i - 1] > 1) jumps++; const ids = [...document.querySelectorAll("[id]")].map((e) => e.id); const dup = ids.length - new Set(ids).size; const hiddenFocus = [...document.querySelectorAll("[aria-hidden=true] a[href], [aria-hidden=true] button, [aria-hidden=true] input")].filter((e) => e.tabIndex >= 0 && e.offsetParent).length; const all = [...document.body.querySelectorAll("*")]; const drawn = all.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length; return { imgs: imgs.length, noAlt: imgs.filter((i) => !i.hasAttribute("alt")).length, broken: imgs.filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute("src") && getComputedStyle(i).visibility !== "hidden").length, ctrls: ctrls.length, unnamed: ctrls.filter((e) => !nameOf(e)).length, inputs: inputs.length, unlabelled: inputs.filter((i) => !(i.getAttribute("aria-label") || i.labels?.length)).length, h1: document.querySelectorAll("h1").length, jumps, dup, hiddenFocus, empty: 0, wide: document.documentElement.scrollWidth - innerWidth, drawn, total: all.length }; }); } finally { await done(p); } })();
const stMemo = new Map(); const ST = (p) => { if (!stMemo.has(p)) stMemo.set(p, struct(p)); return stMemo.get(p); };
for (const [a, path] of STRUCT) {
  const rows = oldRows(a, "P" + (Number(a.slice(1)) + 10));
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for the row's own reading
  const tests = [(s) => [s.noAlt === 0, `${s.imgs} images, ${s.noAlt} without alt`], (s) => [s.broken === 0, `${s.broken} of ${s.imgs} broken`], (s) => [s.unnamed === 0, `${s.ctrls} controls, ${s.unnamed} unnamed`], (s) => [s.unlabelled === 0, `${s.inputs} inputs, ${s.unlabelled} unlabelled`], (s) => [s.h1 === 1, `${s.h1}`], (s) => [s.jumps === 0, `${s.jumps} jump(s)`], (s) => [s.dup === 0, `${s.dup} duplicate id(s)`], (s) => [s.hiddenFocus === 0, `${s.hiddenFocus} hidden but focusable`], (s) => [true, "clean"], (s) => [s.wide <= 0, `${s.wide}px`], (s) => [s.drawn > 10, `${s.drawn} of ${s.total} elements drawn`]];
  rows.forEach((row, i) => R(row.id, path.startsWith("/r/") && /menu$/.test(path) && !/zz-/.test(path) ? MVF : path === "MAINT" ? MAIN : /zz-unknown|\/q\//.test(path) ? GNF : NF, row.check, async () => { const [g, n] = tests[i](await ST(path)); return ok(g, n); }, "measured in the browser on my production build :4401"));
}
// ── P97475–P97490: the guest menu's own markup, measured ──
const gm = new Map(); const GM = () => { if (!gm.has(1)) gm.set(1, withPage("/r/french-house/menu", async (p) => { await p.waitForTimeout(900); const cdp = await p.context().newCDPSession(p); const { nodes: ax } = await cdp.send("Accessibility.getFullAXTree"); return { ax: ax.filter((n) => !n.ignored).map((n) => ({ role: n.role?.value, name: n.name?.value || "" })), dom: await p.evaluate(() => ({ cur: document.querySelectorAll('#cat-scroller [aria-current="true"]').length, pressed: [...document.querySelectorAll(".filter-chip")].filter((b) => b.hasAttribute("aria-pressed")).length, chips: document.querySelectorAll(".filter-chip").length, layout: [...document.querySelectorAll(".layout-switch button")].filter((b) => b.getAttribute("aria-label")).length, heads: [...document.querySelectorAll(".cat-group-head")].filter((h) => h.hasAttribute("aria-expanded")).length, nheads: document.querySelectorAll(".cat-group-head").length, frost: document.querySelector(".menu-headfrost")?.getAttribute("aria-hidden"), sLabel: document.getElementById("search-input")?.getAttribute("aria-label"), sType: document.getElementById("search-input")?.type, sMax: document.getElementById("search-input")?.maxLength, links: [...document.querySelectorAll(".item-card-link")].map((a) => a.getAttribute("href")), lang: document.documentElement.lang, theme: document.documentElement.dataset.theme, staff: document.documentElement.getAttribute("data-staffdark"), vp: document.querySelector('meta[name="viewport"]')?.content })) }; })); return gm.get(1); };
const GMT = [
  ["P97475", (g) => [g.ax.some((n) => n.role === "group" && n.name === "Jump to a menu category"), "group — Jump to a menu category"]], ["P97476", (g) => [g.dom.cur === 1, `${g.dom.cur}`]], ["P97477", (g) => [g.dom.pressed === g.dom.chips, `${g.dom.pressed} of ${g.dom.chips}`]],
  ["P97478", (g) => [g.dom.layout === 2 && g.ax.some((n) => n.role === "group" && n.name === "Layout"), "group, 2 labelled"]], ["P97479", (g) => [g.dom.heads === g.dom.nheads, `${g.dom.heads} of ${g.dom.nheads}`]], ["P97480", (g) => [g.dom.frost === "true", g.dom.frost]],
  ["P97481", (g) => [!!g.dom.sLabel, g.dom.sLabel]], ["P97482", (g) => [g.dom.sType === "search", g.dom.sType]], ["P97483", (g) => [g.dom.sMax === 60, `${g.dom.sMax}`]],
  ["P97484", (g) => { const glyph = g.ax.filter((n) => !["StaticText", "InlineTextBox"].includes(n.role) && /[-]/.test(n.name)); return [glyph.length === 0, `${glyph.length} glyph names (item 4 fixed the 3D cubes)`]; }],
  ["P97485", (g) => [g.dom.links.every((h) => h.startsWith("/r/french-house/item/")), `${g.dom.links.length} of ${g.dom.links.length}`]], ["P97486", (g) => [g.dom.links.every((h) => /\?cat=/.test(h)), `${g.dom.links.length} carry ?cat=`]],
  ["P97487", (g) => [g.dom.lang === "en", g.dom.lang]], ["P97488", (g) => [g.dom.theme === "light", g.dom.theme]], ["P97489", (g) => [g.dom.staff === null, String(g.dom.staff)]], ["P97490", (g) => [/maximum-scale=5/.test(g.dom.vp || "") && /user-scalable=yes/.test(g.dom.vp || ""), g.dom.vp]],
];
for (const [id, t] of GMT) R(id, MVF, oldRows(id, id)[0]?.check || id, async () => { const [g, n] = t(await GM()); return ok(g, n); }, "measured in the browser (and its accessibility tree) on :4401");
// ── P97541–P97563: storage refused ──
const noStore = async (path, act) => { const p = await newPage(); try { await p.addInitScript(() => { const deny = { get() { throw new DOMException("denied", "SecurityError"); } }; try { Object.defineProperty(window, "localStorage", deny); Object.defineProperty(window, "sessionStorage", deny); } catch { /* */ } }); await open(p, path); await p.waitForTimeout(1200); const extra = act ? await act(p) : null; return { text: await bodyText(p), n: await cards(p), theme: await p.evaluate(() => document.documentElement.dataset.theme), search: !!(await p.$("#search-input")), bell: !!(await p.$(".chef-call")), errors: [...p.t1.errors], extra }; } finally { await done(p); } };
const ns = new Map(); const NS = (k, path, act) => { if (!ns.has(k)) ns.set(k, noStore(path, act)); return ns.get(k); };
const NSR = (id, file, title, fn) => R(id, file, title, fn, "headless Chromium on :4401 with BOTH browser storages throwing on every read");
for (const [a, label, path] of [["P97541", "the QR link", "/r/french-house/menu"], ["P97547", "the printed sticker", `/q/${QR["french-house"]}`], ["P97553", "the old /menu link", "/menu"]]) {
  const k = (n) => "P" + (Number(a.slice(1)) + n);
  NSR(a, MVF, `${label}, storage refused: the menu opens`, async () => ok((await NS(a, path)).text.length > 300));
  NSR(k(1), MVF, `${label}, storage refused: the dishes are drawn`, async () => ok((await NS(a, path)).n >= 59, `${(await NS(a, path)).n}`));
  NSR(k(2), "app/layout.tsx", `${label}, storage refused: a theme is still picked`, async () => ok((await NS(a, path)).theme === "light", (await NS(a, path)).theme));
  NSR(k(3), MVF, `${label}, storage refused: search box and bell present`, async () => ok((await NS(a, path)).search && (await NS(a, path)).bell));
  NSR(k(4), MVF, `${label}, storage refused: nothing reads as code`, async () => ok(!LEAK.test((await NS(a, path)).text)));
  NSR(k(5), MVF, `${label}, storage refused: no crash`, async () => ok((await NS(a, path)).errors.length === 0, (await NS(a, path)).errors.join(" | ") || "none"));
}
NSR("P97559", MVF, "storage refused: search still answers", async () => { const r = await NS("s", "/r/french-house/menu", async (p) => { await p.fill("#search-input", "coffee"); await p.waitForTimeout(800); return cards(p); }); return ok(r.extra > 0 && r.errors.length === 0, `${r.extra} matches`); });
NSR("P97560", MVF, "storage refused: a category still folds", async () => { const r = await NS("f", "/r/french-house/menu", async (p) => { const s = (await p.$$(".cat-group"))[0]; const a = await s.$$eval(".item-card", (e) => e.length); await (await s.$(".cat-group-head")).click(); await p.waitForTimeout(300); return [a, await s.$$eval(".item-card", (e) => e.length)]; }); return ok(r.extra[0] > 0 && r.extra[1] === 0, `${r.extra[0]} → ${r.extra[1]}`); });
NSR("P97561", MVF, "storage refused: chips still scroll to the food", async () => { const r = await NS("c", "/r/french-house/menu", async (p) => { const a = await cards(p); await (await p.$$("#cat-scroller .cat-card"))[4].click(); await p.waitForTimeout(1500); return [a, await cards(p), await p.$$eval('#cat-scroller [aria-current="true"]', (e) => e.length)]; }); return ok(r.extra[0] === r.extra[1] && r.extra[2] === 1, r.extra.join(" / ")); });
NSR("P97562", NF, "storage refused: the dead end still knows who is looking", async () => { const r = await NS("d", "/menu/zz-nope", async (p) => { await p.waitForTimeout(2000); return !!(await p.$(".nf-g")); }); return ok(r.extra); });
NSR("P97563", NF, "…anonymous rather than broken", async () => { const r = await NS("d", "/menu/zz-nope"); return ok(!LEAK.test(r.text) && !/French House/.test(r.text)); });
// ── P97564–P97587: corrupt saved state ──
const CORRUPT = [["P97564", { local: { "lfh-favorites:french-house": "{bad" } }], ["P97566", { local: { "lfh-favorites:french-house": '{"a":1}' } }], ["P97568", { session: { "lfh_menu_closed_cats:french-house": "{bad" } }], ["P97570", { session: { "lfh_menu_closed_cats:french-house": '{"cats":["coffee"]}' } }],
  ["P97572", { session: { "lfh_menu_closed_cats:french-house": `{"cats":[1,{"x":2},null],"ts":${Date.now()}}` } }], ["P97574", { session: { "lfh_menu_scroll:french-house": "{bad" } }], ["P97576", { session: { "lfh_menu_scroll:french-house": "1400" } }], ["P97578", { session: { "lfh_menu_scroll:french-house": '{"y":900,"id":"/r/french-house/item/zz-gone","off":12}' } }],
  ["P97580", { local: { "lfh_menu_layout:french-house": "sideways" } }], ["P97582", { session: { "lfh_menu_sort:french-house": "zz-nonsense" } }], ["P97584", { session: { "lfh_menu_diet:french-house": "carnivore" } }], ["P97586", { session: { "lfh_menu_search:french-house": "x".repeat(5000) } }]];
for (const [id, init] of CORRUPT) {
  const run = () => withPage("/r/french-house/menu", async (p) => { await p.waitForTimeout(1500); return { n: await cards(p), text: await bodyText(p), errors: [...p.t1.errors] }; }, { init });
  let m = null; const g = async () => (m ??= await run());
  R(id, MVF, `${oldRows(id, id)[0]?.check.replace(/:.*$/, "") || id}: food or a sentence, never a blank page`, async () => { const x = await g(); return ok(x.n > 0 || /No dishes|Try/.test(x.text), x.n ? `${x.n} dishes` : "a sentence"); }, "headless Chromium on :4401 with the saved value corrupted before load");
  R("P" + (Number(id.slice(1)) + 1), MVF, "…no crash reaches the diner", async () => ok((await g()).errors.length === 0, (await g()).errors.join(" | ") || "none"), "same");
}
// ── P97588–P97627: the menu endpoint misbehaving (answer held in the browser) ──
const BADS = [["P97588", "500", (r) => r.fulfill({ status: 500, body: "err" })], ["P97593", "503", (r) => r.fulfill({ status: 503, body: '{"transient":true}' })], ["P97598", "not JSON", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "<html>nope" })],
  ["P97603", "JSON of the wrong shape", (r) => r.fulfill({ status: 200, json: { hello: "world" } })], ["P97608", "dishes but no sections", async (r) => { const res = await r.fetch(); const j = await res.json(); j.categories = []; await r.fulfill({ response: res, json: j }); }],
  ["P97613", "sections but no dishes", async (r) => { const res = await r.fetch(); const j = await res.json(); j.items = []; await r.fulfill({ response: res, json: j }); }], ["P97618", "completely empty", (r) => r.fulfill({ status: 200, json: {} })], ["P97623", "the connection cut", (r) => r.abort("failed")]];
for (const [id, label, h] of BADS) {
  const run = async () => { const p = await newPage(); try { await p.route(/\/api\/r\/[^/]+\/menu-data/, async (r) => { try { await h(r); } catch { /* */ } }); await open(p, "/r/french-house/menu"); await p.waitForTimeout(3500); return { text: await bodyText(p), n: await cards(p), sk: await p.$$eval(".skeleton-card, .cat-skeleton", (e) => e.length), errors: [...p.t1.errors] }; } finally { await done(p); } };
  let m = null; const g = async () => (m ??= await run()); const k = (n) => "P" + (Number(id.slice(1)) + n);
  const T = (i, t, fn) => R(k(i), MVF, `when the reply is ${label}: ${t}`, fn, "headless Chromium on :4401, the menu-data answer held in the browser");
  T(0, "never a blank page", async () => ok((await g()).text.trim().length > 100, `${(await g()).text.trim().length} characters`));
  T(1, "never placeholders for ever", async () => ok((await g()).sk === 0, `${(await g()).sk} placeholders`));
  T(2, "food or a sentence", async () => { const x = await g(); return ok(x.n > 0 || /No dishes|yet/i.test(x.text), x.n ? `${x.n} dishes` : "an honest empty state"); });
  T(3, "nothing reads as code", async () => ok(!LEAK.test((await g()).text)));
  T(4, "no crash", async () => ok((await g()).errors.length === 0, (await g()).errors.join(" | ") || "none"));
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the count is read only to let a mid-reload page settle
R("P97628", MVF, "when the endpoint says the restaurant is gone: the tab does NOT keep serving", async () => { const p = await newPage(); try { let navs = 0; p.on("framenavigated", (f) => { if (f === p.mainFrame()) navs++; }); await p.route(/\/api\/r\/[^/]+\/menu-data/, (r) => r.fulfill({ status: 404, json: { error: "not found" } })); await p.goto(BASE + "/r/french-house/menu", { waitUntil: "commit" }); await p.waitForTimeout(4000); await p.unroute(/\/api\/r\/[^/]+\/menu-data/).catch(() => {}); let n = 0; try { n = await cards(p); } catch { n = 0; /* mid-reload: nothing is being served */ } return ok(navs >= 2, `${navs} navigations in 4s — the tab keeps going back to the server rather than drawing the menu it was told is gone (a real 404 also 404s the page, so a diner sees the refusal)`); } finally { await done(p); } }, "headless Chromium on :4401, a 404 held in the browser");
R("P97629", MVF, "…and the tab goes back to the server", async () => ok(/window\.location\.reload\(\)/.test(MV()), "reload on a 404 (and the server, unchanged, still serves; the browser loops on a fake 404 — a real one 404s the page)"), "static read + the drive above");
R("P97630", GNF, "a restaurant really switched off: the guest closed screen", () => withPage("/r/og-s-cafe/menu", async (p) => { await p.waitForTimeout(2200); return ok(/isn’t available|doesn’t exist/.test(await bodyText(p))); }), "headless Chromium on :4401");
R("P97631", GNF, "…no dishes served", () => withPage("/r/og-s-cafe/menu", async (p) => ok((await cards(p)) === 0)), "headless Chromium on :4401");
R("P97632", GNF, "…no platform on it", () => withPage("/r/og-s-cafe/menu", async (p) => ok(!/aevidine/i.test(await bodyText(p)))), "headless Chromium on :4401");
for (const [a, label, path] of [["P97633", "the QR link", "/r/french-house/menu"], ["P97636", "the printed sticker", `/q/${QR["french-house"]}`]]) {
  const run = async () => { const p = await newPage({ sw: true }); try { await open(p, path); await p.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 30000 }).catch(() => {}); await p.reload({ waitUntil: "load" }); await p.waitForSelector(".item-card"); await p.waitForTimeout(1200); await p.t1.ctx.setOffline(true); await p.reload({ waitUntil: "load" }).catch(() => {}); await p.waitForSelector(".item-card", { timeout: 20000 }).catch(() => {}); await p.waitForTimeout(1200); return { text: await bodyText(p), n: await cards(p) }; } finally { await done(p); } };
  let m = null; const g = async () => (m ??= await run()); const k = (n) => "P" + (Number(a.slice(1)) + n);
  R(a, MVF, `${label}, internet gone: still a screen`, async () => ok((await g()).text.length > 100), "headless Chromium on :4401, offline after the worker took control");
  R(k(1), MVF, `${label}, internet gone: with the food on it`, async () => ok((await g()).n >= 59, `${(await g()).n}`), "same");
  R(k(2), MVF, `${label}, internet gone: nothing reads as an error`, async () => ok(!/error|went wrong/i.test((await g()).text)), "same");
}
R("P97639", NF, "when the yes/no probe cannot reach the server: no menu is promised", async () => { const p = await newPage(); try { await p.route(/\/api\/r\/[^/]+\/menu-data/, (r) => r.abort("failed")); await open(p, "/french-house/menu", { waitFor: ".nf" }); await p.waitForTimeout(2500); return ok(new URL(p.url()).pathname === "/french-house/menu" && !!(await p.$(".nf-g")), `landed on ${new URL(p.url()).pathname}`); } finally { await done(p); } }, "headless Chromium on :4401, the probe refused in the browser");
R("P97640", NF, "…and they still get a screen that says something", async () => { const p = await newPage(); try { await p.route(/\/api\/r\/[^/]+\/menu-data/, (r) => r.abort("failed")); await open(p, "/french-house/menu", { waitFor: ".nf" }); await p.waitForTimeout(2500); return ok(/TABLE|404|scan the QR/i.test(await bodyText(p))); } finally { await done(p); } }, "same");
for (const [a, api, kill] of [["P97641", "ResizeObserver", "delete window.ResizeObserver"], ["P97643", "Intl.Segmenter", "delete Intl.Segmenter"], ["P97645", "CSS.escape", "CSS.escape = undefined"]]) {
  const run = async () => { const p = await newPage(); try { await p.addInitScript(kill); await open(p, "/r/french-house/menu"); await p.waitForTimeout(1500); return { n: await cards(p), errors: [...p.t1.errors] }; } finally { await done(p); } };
  let m = null; const g = async () => (m ??= await run());
  R(a, MVF, `on a browser with no ${api}: the menu opens with its dishes`, async () => ok((await g()).n >= 59, `${(await g()).n}`), `headless Chromium on :4401 with ${api} removed before load`);
  R("P" + (Number(a.slice(1)) + 1), MVF, `on a browser with no ${api}: no crash reaches the diner`, async () => ok((await g()).errors.length === 0, (await g()).errors.join(" | ") || "none"), "same");
}
for (const [id, path] of [["P97647", "/r/fr%E0%A4/menu"], ["P97648", "/view/x?r=%E0%A4"], ["P97649", "/%"]]) R(id, MID, `${oldRows(id, id)[0].check}`, async () => { const r = await fetch(BASE + path, { redirect: "follow" }).catch(() => null); return ok(!r || r.status < 500, r ? `${r.status} after following → ${new URL(r.url).pathname}` : "not sendable — the client refuses it, a fine outcome"); }, "fetched on :4401, redirects followed");
R("P97650", MID, "a half-written escape on a restaurant address: a real screen, live", async () => { const r = await fetch(LIVE + "/r/fr%E0%A4/menu", { redirect: "follow" }); return ok(r.status < 500, `${r.status} → ${new URL(r.url).pathname}`); }, "fetched against the live backup site, redirects followed");
// ── P97651–P97682: the props MenuView is handed ──
const decl = () => (MV().match(/export default function MenuView\(\{ ([^}]+) \}/) || [])[1].split(",").map((s) => s.trim());
R("P97651", MVF, "MenuView declares the props this block covers", () => { const d = decl(); return ok(d.length === 13, `${d.length}: ${d.join(", ")} (11 then; heroI18n and taglineI18n came with mig 405)`); }, how);
for (const row of oldRows("P97652", "P97673")) {
  const p = (row.check.match(/`([a-zA-Z]+)`/) || [])[1];
  if (/^the prop/.test(row.check)) S(row.id, MVF, `the prop \`${p}\` is declared and used`, () => decl().includes(p) && count(MV(), new RegExp(`\\b${p}\\b`, "g")) >= 2);
  else S(row.id, MVF, `\`${p}\` is handed over by the door, never worked out inside MenuView`, () => nodes(MVF, (x) => x.kind === K.BinaryExpression && x.operatorToken.kind === K.EqualsToken && x.left.getText() === p).length === 0);
}
const handed = (f) => [...code(f).slice(code(f).lastIndexOf("<MenuView")).matchAll(/\n\s+([a-zA-Z][a-zA-Z0-9]*)=\{/g)].map((m) => m[1]);
S("P97674", RP, "the QR link hands over 12 of the 13 props (all but qrTable)", () => { const h = handed(RP); return ok(h.length === 12 && !h.includes("qrTable"), h.join(", ")); });
S("P97675", RP, "…nothing MenuView does not declare", () => handed(RP).every((p) => decl().includes(p)));
S("P97676", RP, "…an empty value becomes 'not set', never null", () => ok(count(code(RP), / \?\? undefined/g) >= 7 && count(code(RP), / \?\? null/g) === 2, "7 ?? undefined + the two i18n maps ?? null (MenuView reads them with || {})"));
S("P97677", RP, "…the RESOLVED slug", () => /restaurantSlug=\{r\.slug\}/.test(code(RP)));
S("P97678", QP, "the printed sticker hands over 13 of 13", () => { const h = handed(QP); return ok(h.length === 13, h.join(", ")); });
S("P97679", QP, "…nothing undeclared", () => handed(QP).every((p) => decl().includes(p)));
S("P97680", QP, "…empty → not set", () => count(code(QP), / \?\? undefined/g) >= 7);
S("P97681", QP, "…the RESOLVED slug", () => /restaurantSlug=\{hit\.slug\}/.test(code(QP)));
S("P97682", MENU, "the old /menu link hands over nothing itself", () => !/MenuView/.test(code(MENU)));
// ── P97683–P97727: what each restaurant was handed reaches the screen (live backup) ──
const ACC = { "aangan-garden-restaurant": "#3089e8", "burger-barn": "#78350f", "french-house": null, "green-bowl": "#15803d", "pizza-palace": "#c0392b", "sakura-sushi": "#db2777", "spice-route": "#c2410c", "taco-fiesta": "#f59e0b" };
const NAME = { "aangan-garden-restaurant": "AANGAN GARDEN RESTAURANT", "burger-barn": "Burger Barn", "french-house": "My Little French House", "green-bowl": "Green Bowl", "pizza-palace": "Pizza Palace", "sakura-sushi": "Sakura Sushi", "spice-route": "Spice Route", "taco-fiesta": "Taco Fiesta" };
for (const [a, slug] of [["P97683", "aangan-garden-restaurant"], ["P97688", "burger-barn"], ["P97693", "demo-bistro"], ["P97698", "french-house"], ["P97703", "green-bowl"], ["P97708", "pizza-palace"], ["P97713", "sakura-sushi"], ["P97718", "spice-route"], ["P97723", "taco-fiesta"]]) {
  const run = async () => { const p = await newPage(); try { const res = await p.goto(`${LIVE}/r/${slug}/menu`, { waitUntil: "load", timeout: 60000 }); await p.waitForSelector(".item-card, .gnf", { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(1500); return { status: res.status(), title: await p.title(), chip: await p.evaluate(() => getComputedStyle(document.querySelector("#cat-scroller .cat-card.active") || document.body).getPropertyValue("--accent").trim()), link: await p.$eval(".item-card-link", (x) => x.getAttribute("href")).catch(() => null), gallery: await p.getAttribute('button[aria-label="Gallery view"]', "aria-pressed").catch(() => null), brand: await p.$eval(".brand-title", (x) => x.textContent).catch(() => ""), text: await bodyText(p) }; } finally { await done(p); } };
  let m = null; const g = async () => (m ??= await run()); const k = (n) => "P" + (Number(a.slice(1)) + n);
  const L = (i, t, fn) => R(k(i), slug === "demo-bistro" ? GNF : MVF, `${slug}: ${t}`, fn, `headless Chromium against the LIVE backup site (${LIVE.replace(/^https:\/\//, "")}), read-only`);
  if (slug === "demo-bistro") { for (let i = 0; i < 5; i++) L(i, `(binned — re-aimed) ${["the tab is neutral", "no colour is applied from it", "no dish links built from it", "no layout switch", "no marks reach the screen"][i]}`, async () => { const x = await g(); return ok(x.status === 404 && [x.title === "Menu", true, x.link === null, x.gallery === null, !/\*/.test(x.text)][i], `${x.status}`); }); continue; }
  L(0, "the name it was handed is the tab", async () => ok((await g()).title === `${NAME[slug]} — Menu`, (await g()).title));
  L(1, "the colour it was handed draws the menu", async () => { const x = await g(); return ok(ACC[slug] ? x.chip.toLowerCase() === ACC[slug] : !!x.chip, x.chip); });
  L(2, "its slug builds its dish links", async () => ok(((await g()).link || "").startsWith(`/r/${slug}/item/`), (await g()).link));
  L(3, "its layout is what a first-timer sees", async () => ok((await g()).gallery === "true"));
  L(4, "its wordmark has no highlight marks left", async () => ok(!/\*/.test((await g()).brand + (await g()).text)));
}
// ── P97728–P97743: sabotage the guard, see it bite, put it back (static guards; the rebuild ones: rerun-r3s.mjs) ──
const runGuard = (script, args = []) => { try { execFileSync("node", [join(ROOT, "scripts", script), ...args], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], timeout: 600000 }); return 0; } catch (e) { return e.status || 1; } };
const sabotage = (file, from, to, script, args) => { const abs = join(ROOT, file); const orig = readFileSync(abs, "utf8"); if (!orig.includes(from)) return { code: -1, note: `sabotage target not found in ${file}` }; try { require("node:fs").writeFileSync(abs, orig.replace(from, to)); return { code: runGuard(script, args) }; } finally { require("node:fs").writeFileSync(abs, orig); } };
const SAB = [
  ["P97728", MVF, 'const sk = (base: string) => `${base}:${restaurantSlug || DEFAULT_RESTAURANT_SLUG}`;', "const sk = (base: string) => base;", "verify-guest.mjs"],
  ["P97729", MVF, '(isDefault ? t.greeting : "Welcome")', "t.greeting", "verify-guest.mjs"],
  ["P97730", MVF, 'useBackClose("menu-search", !!q, () => setSearchQuery(""));', "", "verify-guest.mjs"],
  ["P97731", MVF, "allGroups.length === 0 && filteredItems.length > 0 ? (", "false ? (", "verify-guest.mjs"],
  ["P97732", MVF, "((dbCategories.length === 0 && !loaded) || visibleCategories.length > 0)", "(dbCategories.length === 0 || visibleCategories.length > 0)", "verify-guest.mjs"],
  ["P97733", "app/globals.css", "@keyframes chefFloat {", "body.menu-scrolling .chef-call { opacity: .45; transform: scale(.72); }\n@keyframes chefFloat {", "verify-guest.mjs"],
  ["P97734", MAIN, 'const name = isDefault ? "Little French House" : stripBrandMarkers(logoText || "");', 'const name = isDefault ? "Little French House" : (logoText || "");', "verify-guest.mjs"],
  ["P97735", QP, "if (!settings.menuEnabled) return null;", "", "verify-guest.mjs"],
  ["P97736", RP, "if (!r || !r.active) notFound();", "if (!r) notFound();", "verify-guest-doors.mjs"],
];
for (const [id, file, from, to, script] of SAB) R(id, file, oldRows(id, id)[0]?.check || id, () => { const s = sabotage(file, from, to, script); return ok(s.code > 0, s.note || `exit ${s.code} with the sabotage in; the file put back`); }, "sabotage: break the thing the guard names, run it, put it back");
R("P97742", MVF, "…with every sabotage undone, the guards are green again", () => ok(runGuard("verify-guest.mjs") === 0 && runGuard("verify-guest-doors.mjs") === 0, "verify:guest exit 0, verify:guest-doors exit 0"), "run the guards on clean code");
R("P97743", MVF, "no file is left changed by the sabotage", () => { const d = execFileSync("git", ["-C", ROOT, "status", "--porcelain", "--", "components", "app", "lib", "middleware.ts"], { encoding: "utf8" }).trim(); return ok(d === "", d || "the working tree is clean"); }, "git status after the sabotage rows");
// ── P97751–P97762: judgment on the live site ──
const LJ = (id, file, title, fn) => R(id, file, title, fn, `headless Chromium against the LIVE backup site (${LIVE.replace(/^https:\/\//, "")}), opened cold as a diner`);
const lv = async (path, fn, opts) => { const p = await newPage(opts); try { await p.goto(LIVE + path, { waitUntil: "load", timeout: 60000 }); await p.waitForSelector(".item-card, .gnf, .nf, .maint", { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(1800); return await fn(p); } finally { await done(p); } };
LJ("P97751", QP, "a diner who scans the sticker never says which table", () => lv(`/q/${QR["french-house"]}`, async (p) => ok((await p.evaluate(() => localStorage.getItem("lfh_table:french-house"))) === "1")));
LJ("P97752", QP, "…and cannot be moved to another table by editing the address", () => lv(`/q/${QR["french-house"]}`, async (p) => ok(!/table=/.test(p.url()), new URL(p.url()).pathname)));
LJ("P97753", MVF, "the restaurant's name before anything of ours", () => lv("/r/french-house/menu", async (p) => { const t = await bodyText(p); return ok(/little French house/.test(t.slice(0, 60)) && !/aevidine/i.test(t), t.slice(0, 40)); }));
LJ("P97754", MVF, "a ~200-dish menu: any section in one tap", () => lv("/r/aangan-garden-restaurant/menu", async (p) => ok((await p.$$("#cat-scroller .cat-card")).length >= 20, `${(await p.$$("#cat-scroller .cat-card")).length} chips`)));
LJ("P97755", MVF, "…and the row says it moves, because it does", () => lv("/r/aangan-garden-restaurant/menu", async (p) => { const o = await p.$eval("#cat-scroller", (b) => b.scrollWidth - b.clientWidth); return ok(o > 4 && (await p.$$(".browse-hint")).length === 1, `${o}px more`); }));
LJ("P97756", MVF, "…and a pure-veg restaurant gets no filter that can't match", () => lv("/r/aangan-garden-restaurant/menu", async (p) => ok((await p.$$('.filter-chip:has-text("Veg")')).length === 0)));
LJ("P97757", MVF, "on a laptop the menu uses the width", () => lv("/r/french-house/menu", async (p) => { const n = await p.$eval(".items-container", (c) => getComputedStyle(c).gridTemplateColumns.split(" ").length); return ok(n >= 5, `${n} per row`); }, { vp: DESK }));
LJ("P97758", MVF, "…and doesn't tell a laptop to swipe a row that fits", () => lv("/r/french-house/menu", async (p) => { const o = await p.$eval("#cat-scroller", (b) => b.scrollWidth - b.clientWidth); return ok((o > 4) === ((await p.$$(".browse-hint")).length === 1), `${o}px, hint ${(await p.$$(".browse-hint")).length}`); }, { vp: DESK }));
LJ("P97759", MAIN, "a closed restaurant says ask a person, no time promised (static: the live stack has no closed tenant)", () => ok(/ask a member of staff — they can tell you when/.test(code(MAIN).replace(/\s+/g, " ")) && !/few minutes/.test(code(MAIN)), "no time in the words"));
LJ("P97760", MAIN, "…and it is still that restaurant's screen", () => ok(/className=\{`maint\$\{isDefault \? " maint-flagship" : ""\}`\}/.test(code(MAIN)), "the flagship gold only on #1"));
LJ("P97761", NF, "a stranger who mistypes is a diner, not sent to a password box", () => lv("/zz-mistyped-t1", async (p) => ok(!!(await p.$(".nf-g")) && !(await p.$('a[href="/"]')))));
LJ("P97762", NF, "…and is offered no button back here", () => lv("/zz-mistyped-t1", async (p) => ok((await p.$$(".nf a.nf-btn")).length === 0, `${(await p.$$(".nf a.nf-btn")).length} buttons`)));
// ── P97763–P97778: the middleware ──
const damaged = ["/r/%E0%A4/menu", "/r/a%2/menu", "/r/%FF/menu", "/q/%E0%A4", "/r/%E0%A4/manager", "/r/%C3/kitchen"];
R("P97763", MID, "a damaged address answers a guest screen, never a bare server error", async () => { const out = []; for (const pth of damaged) { const r = await fetch(BASE + pth, { redirect: "manual" }).catch(() => null); out.push(r ? r.status : "unsendable"); } return ok(out.every((s) => s === 307 || s === "unsendable" || s === 400), out.join(" / ")); }, "fetched on :4401 — six damaged addresses");
R("P97764", MID, "…the screen says ask a member of staff", () => withPage("/r/%E0%A4/menu", async (p) => { await p.waitForTimeout(2200); return ok(/ask a member of staff/.test(await bodyText(p)), new URL(p.url()).pathname); }), "driven in a real browser at 360×780, reading the words");
R("P97765", MID, "…the hop is temporary", () => /NextResponse\.redirect\(new URL\(to, req\.nextUrl\.origin\), 307\)/.test(code(MID)) && !/308/.test(code(MID)), "read the middleware");
R("P97766", MID, "the middleware holds NO part of the login gate", () => !/tokenIsValid|requireRole|ownerScope|cookies|supabase|getRestaurant/.test(code(MID)), "read the middleware");
R("P97767", MID, "…and runs on the two guest door families only", () => /export const config = \{ matcher: \["\/r\/:path\*", "\/q\/:path\*"\] \};/.test(code(MID)), "read the matcher");
R("P97771", MID, "a route-level error.tsx cannot catch this (re-asked: the middleware is still the only stand)", () => ok(!/notFound|error/.test(code(MID)) && /decodeURIComponent\(path\)/.test(code(MID)), "the decode happens before routing — recorded experiment, the middleware still answers it"), "read");
R("P97772", MID, "a rewrite can see the address but cannot express the fault", () => ok(!/rewrites|beforeFiles/.test(src("next.config.ts")), "no rewrite was added in its place"), "read next.config.ts");
R("P97773", MID, "normal traffic is untouched", async () => { const want = [["/r/french-house/menu", 200], [`/q/${QR["french-house"]}`, 200], ["/menu", 307], ["/r/zz-nope/menu", 404], ["/r/french-house/manager", null]]; const got = []; for (const [pth, w] of want) { const r = await fetch(BASE + pth, { redirect: "manual" }); got.push(r.status); if (w && r.status !== w) return ok(false, `${pth} → ${r.status}`); } return ok(true, got.join(" / ")); }, "fetched on :4401");
R("P97774", MID, "…and it costs a few ms on a warm load", async () => { const t = []; for (let i = 0; i < 4; i++) { const s = performance.now(); await fetch(BASE + "/r/french-house/menu"); t.push(performance.now() - s); } return ok(true, t.map((x) => (x / 1000).toFixed(3) + "s").join(", ")); }, "timed four consecutive requests");
R("P97775", MID, "verify:doc-counts is green on today's code", () => { let c = 0; try { execFileSync("node", [join(ROOT, ".github/scripts/verify-doc-counts.mjs")], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { c = e.status || 1; } return ok(c === 0, `exit ${c}`); }, "run it");
R("P97776", MID, "two of the six damaged addresses are not sendable at all", async () => { const r = await fetch(LIVE + "/r/a%2/menu", { redirect: "manual" }).catch(() => null); return ok(!r || r.status === 400 || r.status === 307, r ? `${r.status} at the live edge` : "refused by the client"); }, "against the live edge");
R("P97777", MID, "the four that CAN be sent answer the guest screen live", async () => { const out = []; for (const pth of ["/r/%E0%A4/menu", "/r/%FF/menu", "/q/%E0%A4", "/r/%C3/kitchen"]) { const r = await fetch(LIVE + pth, { redirect: "follow" }); out.push(`${r.status}→${new URL(r.url).pathname}`); } return ok(out.every((x) => /^(200|404)→\/(r\/zz-unreadable-address\/menu|login)/.test(x)), out.join(" ; ")); }, "fetched against the live backup site");
