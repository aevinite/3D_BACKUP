// Family B — RANDOM INPUTS against the parts that compute (property testing). Every check draws
// hundreds of random cases from a seed and asserts a RULE that must hold for all of them — not one
// example. Runs in Node against the real files (auditsort.js is CommonJS-friendly; labelFor and
// netretry.js are evaluated from the shipped text). A failure names the seed and the case.
import vm from "node:vm";
import { createRequire } from "node:module";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { C, ok, rng, panelFile, ROOT } from "./lib.mjs";

// auditsort.js through require — from a temp copy, so a mutation run judges the broken copy too.
// (Unbroken, it is required from its real path, so a coverage run credits the real file.)
const req = createRequire(import.meta.url);
let A;
if (process.env.T16_MUT_REL === "public/panels/auditsort.js") { const tmp = mkdtempSync(join(tmpdir(), "t16r3b-")); writeFileSync(join(tmp, "auditsort.js"), panelFile("auditsort.js")); A = req(join(tmp, "auditsort.js")); }
else A = req(join(ROOT, "public/panels/auditsort.js"));

const NAMES = ["Asha", "asha", "Zed", "", null, "  ", "Ölga", "ravi kumar", "Émile", "12", undefined, "admin"];
const KINDS = ["invoice_voided", "bill_deleted", "order_cancelled", "discount", "comp", "price_change", "nonsense", "", null];
const ACTIONS = ["maintenance_on", "kot_printed", "password_change", "order_moved", "client_error", "login_failed", "made_up_thing", "", null];
const PANELS = ["manager", "kitchen", "tablet", "owner", "", null];
const t0 = Date.parse("2026-10-01T00:00:00Z");
function rows(R, n, activity) {
  return Array.from({ length: n }, (_, i) => {
    const r = { id: i + 1, actor: R.pick(NAMES), restaurant_name: R.pick(NAMES), table_number: R.bool(0.7) ? R.int(1, 40) : null };
    const when = new Date(t0 + R.int(0, 3) * 3600000 * (R.bool(0.4) ? 0 : 1) + R.int(0, 5) * 60000).toISOString();
    if (activity) Object.assign(r, { action: R.pick(ACTIONS), panel: R.pick(PANELS), created_at: when, detail: R.pick(["Moved KOT 4", "", null, "Table 7 closed"]) });
    else Object.assign(r, { kind: R.pick(KINDS), at: when, amount: R.pick([null, 0, 120, "450.50", 99.999, R.int(1, 9000)]), kot_no: R.bool() ? R.int(1, 99) : null, bill_no: R.bool() ? R.int(1, 99) : null, reason_code: R.pick(["mistake", "guest_left", null]), meta: R.bool() ? { made: R.pick([true, false, undefined]) } : undefined });
    return r;
  });
}
// (No negative amounts: every audit amount is a value REMOVED or the SIZE of a change — the reopened-bill
// row stores Math.abs(delta), app/api/editor route — so 'amount' sorting a blank as -1 is sound. The first
// run drew -20 and saw it sort under the blanks; recorded as harmless in the round-3 findings.)
const ids = (xs) => xs.map((x) => x.id).join(",");
const blank = (v) => String(v == null ? "" : v).trim() === "";
const low = (v) => String(v == null ? "" : v).trim().toLowerCase();
const time = (r) => Date.parse(r.at || r.created_at) || 0;
const CASES = 300;

function prop(name, fn) {
  C("B", name.split(" ")[0], name.slice(name.indexOf(" ") + 1), () => {
    for (let s = 1; s <= CASES; s++) { const R = rng(s); const why = fn(R, s); if (why) return ok(false, `seed ${s}: ${why}`); }
    return ok(true, `${CASES} random cases`);
  });
}

// ── auditsort.js — the Audit's sorts ──────────────────────────────────────────────────────────
for (const sid of A.SORTS.map((s) => s.id)) {
  prop(`auditsort.js Audit '${sid}': a sort is a permutation (nothing added, nothing lost) and never touches its input`, (R) => { const xs = rows(R, R.int(0, 30)); const before = JSON.stringify(xs); const out = A.sortRows(xs, sid); if (JSON.stringify(xs) !== before) return "mutated its input"; if (ids(out.slice().sort((a, b) => a.id - b.id)) !== ids(xs)) return "not a permutation"; });
  prop(`auditsort.js Audit '${sid}': the order is total — shuffling the input never changes the result`, (R) => { const xs = rows(R, R.int(2, 25)); const sh = xs.slice().sort(() => R.next() - 0.5); if (ids(A.sortRows(xs, sid)) !== ids(A.sortRows(sh, sid))) return "two orders for the same rows"; });
}
prop("auditsort.js Audit 'new' is newest first, 'old' its exact reverse on distinct times", (R) => { const xs = rows(R, R.int(2, 25)); const n = A.sortRows(xs, "new"); for (let i = 1; i < n.length; i++) if (time(n[i]) > time(n[i - 1])) return "newer after older"; const o = A.sortRows(xs, "old"); for (let i = 1; i < o.length; i++) if (time(o[i]) < time(o[i - 1])) return "older after newer"; });
prop("auditsort.js Audit 'amount': every row with an amount comes before any without, biggest first", (R) => { const out = A.sortRows(rows(R, R.int(2, 25)), "amount"); let seenNull = false, last = Infinity; for (const r of out) { if (r.amount == null) { seenNull = true; continue; } if (seenNull) return "an amount after a blank"; const v = Number(r.amount); if (v > last + 1e-9) return `${v} after ${last}`; last = v; } });
for (const [sid, key] of [["person", "actor"], ["restaurant", "restaurant_name"]]) {
  prop(`auditsort.js Audit '${sid}': names A–Z (case-blind), every blank after every name`, (R) => { const out = A.sortRows(rows(R, R.int(2, 25)), sid); let blanks = false; for (let i = 0; i < out.length; i++) { const b = blank(out[i][key]); if (b) { blanks = true; continue; } if (blanks) return "a name after a blank"; if (i && !blank(out[i - 1][key]) && low(out[i - 1][key]).localeCompare(low(out[i][key])) > 0) return `${out[i - 1][key]} before ${out[i][key]}`; } });
}
prop("auditsort.js view(): a type filter keeps exactly that type; an empty search keeps everything", (R) => { const xs = rows(R, R.int(0, 30)); const k = R.pick(KINDS.filter(Boolean)); const v = A.view(xs, { kind: k }); if (v.some((r) => String(r.kind) !== k)) return "a row of another type kept"; if (v.length !== xs.filter((r) => String(r.kind) === k).length) return "a row of that type dropped"; if (A.view(xs, { q: "   " }).length !== xs.length) return "a blank search dropped rows"; });
prop("auditsort.js view(): a search finds a row by its KOT, bill and table numbers, in any case", (R) => { const xs = rows(R, R.int(1, 20)); const r = R.pick(xs); if (r.kot_no != null && !A.view(xs, { q: "KOT " + r.kot_no }).includes(r)) return "kot search missed"; if (r.bill_no != null && !A.view(xs, { q: " bill " + r.bill_no + " " }).includes(r)) return "bill search missed"; if (r.table_number && !A.view(xs, { q: "Table " + r.table_number }).includes(r)) return "table search missed"; });
prop("auditsort.js view(): every row a search returns really matches it", (R) => { const xs = rows(R, R.int(1, 25)); const q = R.pick(["ash", "zed", "kot 1", "table 2", "mistake", "45", "é"]); for (const r of A.view(xs, { q })) if (!A.matches(r, q)) return `kept a row that does not match "${q}"`; });
prop("auditsort.js sumAmount(): the money total, to the paisa, blanks ignored, numbers-as-text counted", (R) => { const xs = rows(R, R.int(0, 30)); let t = 0; for (const r of xs) if (r.amount != null) t += Number(r.amount); const want = Math.round(t * 100) / 100; if (A.sumAmount(xs) !== want) return `${A.sumAmount(xs)} ≠ ${want}`; });
prop("auditsort.js kindCounts(): the counts add up to the rows that have a type, biggest first, ties A–Z", (R) => { const xs = rows(R, R.int(0, 30)); const c = A.kindCounts(xs, A.KIND_LABEL, A.KIND_ICON); const total = c.reduce((a, x) => a + x.count, 0); if (total !== xs.filter((r) => r.kind).length) return `${total} counted`; for (let i = 1; i < c.length; i++) { if (c[i].count > c[i - 1].count) return "smaller before bigger"; if (c[i].count === c[i - 1].count && c[i - 1].label.localeCompare(c[i].label) > 0) return "tie not A–Z"; } });
prop("auditsort.js tagsOf(): a cancelled order says loss / no-loss / unanswered exactly as 'made' says", (R) => { const made = R.pick([true, false, undefined]); const t = A.tagsOf({ kind: "order_cancelled", meta: { made } }); const want = made === true ? "loss" : made === false ? "no-loss" : "unanswered"; if (!t.includes(want)) return `${made} → ${t}`; });
prop("auditsort.js riskOf(): every type answers one of the known risk words, unknown types 'record'", (R) => { const k = R.pick(KINDS.concat(["zz" + R.int(1, 99)])); const r = A.riskOf(k); if (!(k in A.KIND_RISK) && r !== "record") return `${k} → ${r}`; if (typeof r !== "string" || !r) return "no answer"; });
// ── auditsort.js — the Activity log's half ────────────────────────────────────────────────────
for (const sid of A.ACTIVITY_SORTS.map((s) => s.id)) {
  prop(`auditsort.js Activity '${sid}': a permutation, total, input untouched`, (R) => { const xs = rows(R, R.int(0, 25), true); const before = JSON.stringify(xs); const out = A.activityView(xs, { sort: sid }); if (JSON.stringify(xs) !== before) return "mutated"; if (ids(out.slice().sort((a, b) => a.id - b.id)) !== ids(xs)) return "not a permutation"; const sh = xs.slice().sort(() => R.next() - 0.5); if (ids(A.activityView(sh, { sort: sid })) !== ids(out)) return "not total"; });
}
prop("auditsort.js activityGroupOf(): every action lands in a known group — never nowhere", (R) => { const a = R.pick(ACTIONS.concat(["x_" + R.int(1, 999)])); const g = A.activityGroupOf(a); if (!A.ACTIVITY_GROUPS.some((x) => x.id === g)) return `${a} → ${g}`; });
prop("auditsort.js activityView(): a group filter keeps exactly that group; counts per group add up", (R) => { const xs = rows(R, R.int(0, 30), true); const g = R.pick(A.ACTIVITY_GROUPS).id; const v = A.activityView(xs, { group: g }); if (v.some((r) => A.activityGroupOfRow(r) !== g)) return "another group kept"; const c = A.activityCounts(xs); if (c.reduce((a, x) => a + x.count, 0) !== xs.length) return "counts do not add up"; });

// ── outbox.js — the name every queued change is given ─────────────────────────────────────────
const OB = panelFile("outbox.js"), i0 = OB.indexOf("  function labelFor("), i1 = OB.indexOf("\n  }\n", i0) + 4;
const labelFor = vm.runInNewContext("(function(){" + OB.slice(i0, i1) + "; return labelFor; })()");
const SEG = ["orders", "items", "tables", "sessions", "members", "calls", "print-jobs", "platform", "banquet", "khata", "loyalty", "new-thing", "x_y", "counts", "expenses", "waste", "purchases", "vendors", "recipes", "production"];
const uuid = (R) => "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => "0123456789abcdef"[R.int(0, 15)]);
prop("outbox.js labelFor(): ANY address gets a name that starts with a capital and carries no id, slash or underscore", (R) => {
  const parts = Array.from({ length: R.int(1, 4) }, () => R.pick([R.pick(SEG), uuid(R), String(R.int(1, 500)), R.pick(SEG)]));
  const path = "/" + parts.join("/") + (R.bool(0.2) ? "?rid=" + uuid(R) : "");
  const l = labelFor(R.pick(["POST", "PATCH", "DELETE", "PUT"]), path, R.pick(["/api/editor", "/api/tablet", "/api/kitchen", "/api/inventory"]));
  if (!/^[A-Z]/.test(l) || /[0-9a-f]{8}-[0-9a-f]{4}/i.test(l) || /[/_]/.test(l) || /\b\d{3,}\b/.test(l.replace(/Table \d+/, ""))) return `${path} → "${l}"`;
});
prop("outbox.js labelFor(): a table number in the address is named in words ('· Table N') where the action has one", (R) => { const n = R.int(1, 99); const l = labelFor("POST", `/tables/${n}/` + R.pick(["pay", "close", "open", "shift", "unmerge", "tag", "khata", "on-the-house"]), "/api/editor"); if (!l.endsWith("· Table " + n) && !/Shift table/.test(l)) return `"${l}"`; });

// ── netretry.js — the read helper, against random answer sequences ────────────────────────────
const NR = panelFile("netretry.js");
function loadNR(answers, o = {}) {
  const calls = [];
  const ctx = { navigator: { onLine: o.offline ? false : true }, Promise, Object, Math, Error, setTimeout: (f) => f(), clearTimeout() {},
    AbortSignal: { timeout: () => ({ aborted: false, __ours: true }) },
    fetch: async (u, opts) => { calls.push(opts || {}); const a = answers[Math.min(calls.length - 1, answers.length - 1)]; if (a.throw) { const e = new Error(a.throw); e.name = a.name || "TypeError"; throw e; } return { status: a.status, ok: a.status < 400 }; } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(NR, ctx);
  return { f: ctx.window.LFH_NET.fetch, calls };
}
const ANSWERS = [{ status: 200 }, { status: 404 }, { status: 500 }, { status: 502 }, { status: 503 }, { status: 504 }, { throw: "Failed to fetch" }];
async function aprop(name, fn) { C("B", name.split(" ")[0], name.slice(name.indexOf(" ") + 1), async () => { for (let s = 1; s <= CASES; s++) { const why = await fn(rng(s)); if (why) return ok(false, `seed ${s}: ${why}`); } return ok(true, `${CASES} random cases`); }); }
aprop("netretry.js a WRITE (POST/PUT/PATCH/DELETE) is sent exactly once, whatever comes back", async (R) => { const seq = Array.from({ length: 3 }, () => R.pick(ANSWERS)); const t = loadNR(seq); try { await t.f("/a", { method: R.pick(["POST", "PUT", "PATCH", "DELETE"]) }); } catch {} if (t.calls.length !== 1) return `${t.calls.length} sends`; });
aprop("netretry.js a READ tries at most three times and returns the FIRST real answer (4xx included)", async (R) => { const seq = Array.from({ length: 3 }, () => R.pick(ANSWERS)); const t = loadNR(seq); let got = null; try { got = await t.f("/a"); } catch (e) { got = { threw: e.message }; } if (t.calls.length > 3) return `${t.calls.length} tries`; const firstReal = seq.findIndex((a) => !a.throw && ![502, 503, 504].includes(a.status)); if (firstReal >= 0 && firstReal < 3) { if (got.status !== seq[firstReal].status) return `returned ${JSON.stringify(got)} not the first real answer ${seq[firstReal].status}`; if (t.calls.length !== firstReal + 1) return "kept asking after a real answer"; } });
aprop("netretry.js a READ where every try was busy hands back the last busy answer, never invents one", async (R) => { const seq = Array.from({ length: 3 }, () => R.pick([{ status: 502 }, { status: 503 }, { status: 504 }])); const t = loadNR(seq); const r = await t.f("/a"); if (r.status !== seq[2].status || t.calls.length !== 3) return `${r.status} after ${t.calls.length}`; });
aprop("netretry.js on a device that is OFFLINE a failed read is not retried", async (R) => { const t = loadNR([{ throw: "Failed to fetch" }, { status: 200 }], { offline: true }); let threw = false; try { await t.f("/a"); } catch { threw = true; } if (!threw || t.calls.length !== 1) return `threw=${threw} tries=${t.calls.length}`; });
aprop("netretry.js a read the caller already gave a deadline keeps THAT deadline; one with none gets its own", async (R) => { const t = loadNR([{ status: 200 }]); const sig = { aborted: false, mine: true }; await t.f("/a", { signal: sig }); const u = loadNR([{ status: 200 }]); await u.f("/a"); if (t.calls[0].signal !== sig) return "replaced the caller's deadline"; if (!u.calls[0].signal || !u.calls[0].signal.__ours) return "no deadline of its own"; });

// ── pure helpers inside the browser files, lifted out of the SHIPPED text (so a mutation counts) ──
function lift(file, names, pre = "") {
  const src = panelFile(file);
  const parts = names.map((n) => { const i = src.indexOf(n); if (i < 0) throw new Error(`${file}: ${n} is gone`); const end = src.indexOf(n.startsWith("var ") ? "];\n" : "\n  }\n", i); return src.slice(i, end + (n.startsWith("var ") ? 3 : 4)); });
  return vm.runInNewContext(`(function(){${pre}${parts.join("\n")}; return {${names.map((n) => n.replace(/^(var|function) /, "").replace(/[ (=].*/, "")).join(",")}};})()`);
}
const FN = lift("fitnums.js", ["function shortIndian("]);
const inr = (n) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
prop("fitnums.js shortIndian(): under 1,000 it never shortens; above, the short form is shorter, keeps ₹ and the tail, and is within 5% of the real figure", (R) => {
  const n = R.bool(0.2) ? R.int(0, 999) : Math.round(R.next() ** 3 * 5e9 * 100) / 100;
  const pre = R.pick(["₹", "₹ ", "", "Rs "]), post = R.pick(["", " today", "/day"]);
  const full = pre + inr(n) + post, s = FN.shortIndian(full);
  if (n < 1000) return s === null ? null : `${full} → ${s}`;
  if (!s) return `${full} not shortened`;
  const m = s.match(/^(\D*?)([\d.]+)( Cr| L|K)(.*)$/); if (!m) return `${full} → "${s}" has no K/L/Cr`;
  if (m[1] !== pre || m[4] !== post) return `${full} → ${s} lost its ₹ or tail`;
  const back = Number(m[2]) * { " Cr": 1e7, " L": 1e5, K: 1e3 }[m[3]];
  if (Math.abs(back - n) / n > 0.05) return `${full} → ${s} (${back} vs ${n})`;
  if (s.length > full.length + 3) return `${full} → ${s} got longer`;
});
const EL = lift("errlog.js", ["var NETWORK_NOISE", "function isBenign(", "function assetTag(", "function frames("]);
prop("errlog.js isBenign(): the browser's own offline wording is dropped in any case and with any 'TypeError:' prefix or full stop", (R) => {
  const w = R.pick(EL.NETWORK_NOISE); const t = R.pick(["", "TypeError: ", "Error: "]) /* every engine rejects a fetch with a TypeError; no DOMException carries these words */ + (R.bool() ? w.toUpperCase() : w) + R.pick(["", ".", " .", "  "]);
  if (!EL.isBenign(t)) return `"${t}" was reported`;
});
prop("errlog.js isBenign(): a real error of OURS that merely contains those words is ALWAYS reported", (R) => {
  const w = R.pick(EL.NETWORK_NOISE); const t = R.pick(["Menu ", "Saving the bill: ", "x"]) + w + R.pick([" while parsing", " in app.js", ""]);
  if (EL.isBenign(t)) return `"${t}" was dropped`;
});
prop("errlog.js frames(): at most two frames, never errlog.js itself, never a repeat, each carrying its build hash when it has one", (R) => {
  const files = ["app.js", "realtime.js", "errlog.js", "outbox.js", "chart.umd.min.js"];
  const lines = Array.from({ length: R.int(0, 8) }, () => { const f = R.pick(files), v = R.bool(0.6) ? "?v=" + Math.random().toString(16).slice(2, 10) : "", u = `https://x.app/panels/editor/${f}${v}:${R.int(1, 9999)}:${R.int(1, 80)}`; return R.pick([`    at fn (${u})`, `fn@${u}`, `@${u}`]); });
  const out = EL.frames({ stack: "Error: x\n" + lines.join("\n") });
  const fr = out ? out.split(" <- ") : [];
  if (fr.length > 2) return "more than two";
  if (fr.some((f) => f.startsWith("errlog.js"))) return "named errlog.js";
  if (new Set(fr).size !== fr.length) return "a repeat";
  for (const f of fr) { const src = lines.find((l) => l.includes(f.split("@")[0].split(":")[0]) && l.includes(":" + f.split(":").pop() + ":")); if (src && /\?v=/.test(src) && !f.includes("@") && fr.length === 1) return `${f} lost its hash`; }
});
prop("errlog.js frames(): a stack-less error never throws and gives an empty place", (R) => { const e = R.pick([null, undefined, {}, { stack: "" }, { stack: 12 }, "boom"]); let out; try { out = EL.frames(e); } catch (x) { return "threw " + x.message; } if (out !== "") return JSON.stringify(out); });

// ── in a real browser: fitting figures into random boxes, and shrinking random photos ──────────
const { page: mkPage, open } = await import("./server.mjs");
const FITP = mkPage("fit", { body: '<div id="host"></div>', scripts: ["fitnums.js"] });
C("B", "fitnums.js", "200 random figures in random boxes: an exact (bill) figure is NEVER rewritten; a tile figure either fits or is shortened with the full value kept on hover; no font under 11px; widening the box gives the full figure back", async () => {
  const h = await open(FITP);
  const bad = await h.page.evaluate((cases) => {
    const fmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }), host = document.getElementById("host"), out = [];
    for (const [w, n, exact, fs] of cases) {
      host.innerHTML = `<div style="width:${w}px;overflow:hidden"><span class="fit-num${exact ? " bill-amt" : ""}" style="font-size:${fs}px;display:block">₹${fmt.format(n)}</span></div>`;
      const el = host.querySelector("span"), full = el.textContent;
      window.LFH_FITNUM.fit(el);
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (px < 11 - 0.01) out.push(`${full} in ${w}px → ${px}px`);
      if (exact && el.textContent !== full) out.push(`EXACT ${full} rewritten as ${el.textContent}`);
      if (!exact && el.textContent !== full && el.title !== full) out.push(`${full} shortened to ${el.textContent} with no hover`);
      if (exact && el.scrollWidth - el.clientWidth > 1 && el.title !== full) out.push(`clipped exact ${full} has no hover`);
      el.parentNode.style.width = "3000px"; window.LFH_FITNUM.fit(el);
      if (el.textContent !== full) out.push(`${full} did not come back when widened (${el.textContent})`);
      if (el.title && !el.dataset.lfhTitle && !exact) out.push(`${full} kept a stale hover`);
      if (Math.abs(parseFloat(getComputedStyle(el).fontSize) - fs) > 0.01) out.push(`${full} font did not grow back`);
    }
    return out;
  }, Array.from({ length: 200 }, (_, i) => { const R = rng(i + 1); return [R.int(24, 420), Math.round(R.next() ** 3 * 9e9) / 100, R.bool(0.35), R.int(14, 40)]; }));
  await h.close();
  return ok(!bad.length, bad.slice(0, 3).join(" · ") || "200 figures");
});
const IMGP = mkPage("img", { scripts: ["shrinkimg.js"] });
// Run in BOTH engines: WebKit (every iPhone) cannot write WebP and silently hands back a PNG — item 26
// was that PNG being shipped NAMED and LABELLED as WebP. So the label is judged against the file's own
// first bytes, never against what we hoped it would be.
for (const engine of ["chromium", "webkit"]) C("B", "shrinkimg.js", `${engine}: 60 random photos (sizes 1–3200px, JPEG/PNG/WebP/GIF, flat or noisy): always hands back something to upload; a changed one is labelled and named as what its bytes really are (WebP where the browser can write it), no side over 1280, never bigger, same shape; a GIF or a small photo is left exactly as it was`, async () => {
  const h = await open(IMGP, { engine });
  const bad = await h.page.evaluate(async ([cases, engine]) => {
    const out = [];
    for (const [w, hgt, type, noisy, seed] of cases) {
      const c = document.createElement("canvas"); c.width = w; c.height = hgt; const x = c.getContext("2d");
      if (noisy) { const d = x.createImageData(w, hgt); let s = seed; for (let i = 0; i < d.data.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d.data[i] = i % 4 === 3 ? 255 : s & 255; } x.putImageData(d, 0, 0); } else { x.fillStyle = "#c33"; x.fillRect(0, 0, w, hgt); }
      const blob = await new Promise((r) => c.toBlob(r, type === "image/gif" ? "image/png" : type, 0.95));
      const f = new File([blob], "dish photo.final.jpg", { type });
      const r = await window.LFH_IMG.shrink(f);
      const tag = `${w}x${hgt} ${type} ${noisy ? "noisy" : "flat"} ${f.size}B`;
      if (!r || !r.file) { out.push(tag + ": nothing to upload"); continue; }
      if (!r.changed) { if (r.file !== f) out.push(tag + ": unchanged but not the original"); continue; }
      if (type === "image/gif") out.push(tag + ": a GIF was converted");
      if (Math.max(w, hgt) <= 1280 && f.size <= 180 * 1024) out.push(tag + ": a small photo was touched");
      const head = new Uint8Array(await r.file.slice(0, 12).arrayBuffer());
      const real = head[0] === 0xff && head[1] === 0xd8 ? "image/jpeg" : head[0] === 0x89 && head[1] === 0x50 ? "image/png" : String.fromCharCode(...head.slice(8, 12)) === "WEBP" ? "image/webp" : "?";
      const ext = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" }[real];
      if (r.file.type !== real || r.file.name !== "dish photo.final." + ext) out.push(`${tag}: bytes are ${real} but named ${r.file.name} / labelled ${r.file.type}`);
      if (engine === "chromium" && real !== "image/webp") out.push(`${tag}: Chrome can write WebP but made ${real}`);
      if (type === "image/png" && real === "image/jpeg") out.push(`${tag}: a PNG (maybe see-through) became a JPEG`);
      if (r.to >= r.from) out.push(tag + ": got bigger");
      const b = await createImageBitmap(r.file);
      if (Math.max(b.width, b.height) > 1280) out.push(`${tag}: came out ${b.width}x${b.height}`);
      const k = Math.min(1, 1280 / Math.max(w, hgt)); if (Math.abs(b.width - w * k) > 1 || Math.abs(b.height - hgt * k) > 1) out.push(`${tag}: shape changed to ${b.width}x${b.height}`);
      if (!/^\d+(\.\d)? (KB|MB) → \d+(\.\d)? (KB|MB)$/.test(r.note)) out.push(`${tag}: note "${r.note}"`);
    }
    return out;
  }, [Array.from({ length: 60 }, (_, i) => { const R = rng(i + 101); return [R.int(1, 3200), R.int(1, 3200), R.pick(["image/jpeg", "image/png", "image/webp", "image/gif"]), R.bool(0.5), R.int(1, 1e6)]; }), engine]);
  await h.close();
  return ok(!bad.length, bad.slice(0, 3).join(" · ") || "60 photos");
});
C("B", "shrinkimg.js", "a file that is not a picture, an empty file, or a broken picture is handed back untouched — the upload goes ahead", async () => {
  const h = await open(IMGP);
  const res = await h.page.evaluate(async () => {
    const tries = [new File(["hello"], "menu.pdf", { type: "application/pdf" }), new File([], "e.jpg", { type: "image/jpeg" }), new File([new Uint8Array(300000).fill(7)], "broken.jpg", { type: "image/jpeg" }), null];
    const out = []; for (const f of tries) { const r = await window.LFH_IMG.shrink(f); out.push(r.file === f && r.changed === false && r.note === ""); } return out;
  });
  await h.close();
  return ok(res.every(Boolean), JSON.stringify(res));
});
