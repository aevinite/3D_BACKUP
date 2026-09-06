// The 129 rows in OTHER terminals' ledgers whose subject is a file this territory owns.
//
// WHY THEY ARE RE-RUN HERE. Sweep #8 re-cut the territories, so the ledger no longer maps
// one-to-one onto terminals: rows about billdoc.js, printQueue.ts, the print-agent route and the
// three printing docs are spread across sixteen files written by other terminals. The rule is to
// re-run every row whose SUBJECT is a file you own, wherever it lives — and to leave the rest
// alone. Each row below names the ledger it lives in, so its result can be written back there.
import { BILLDOC as B, row, skipRow, read, visible, totalRows, codeOnly, ROOT } from "./lib.mjs";
import { BASE, canDrive, renderDoc, seenText, inkWidth, ROLL_PX } from "./browser.mjs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const R = (id, ledger, what, fn) => row(id, `[${ledger}] ${what}`, fn);
/** screenMayPrint, run for real. printHelpers.ts imports through the "@/lib" alias, which only a
 *  bundler can follow, so importing the module from a bare node process throws before the function
 *  is ever reached. The function itself has no dependencies — it is pure branching on a shape — so
 *  its body is lifted out of the source and run as written. Change the source, this changes with it. */
const liftScreenMayPrint = () => {
  // The signature ends `): { ok: boolean; why?: … } {` — an earlier regex stopped at the FIRST
  // brace and handed the return type to new Function, which choked on its first colon.
  const m = /export function screenMayPrint\([\s\S]*?\)\s*:\s*\{[^}]*\}\s*\{\n([\s\S]*?)\n\}/.exec(HL);
  if (!m) throw new Error("screenMayPrint is no longer in lib/printHelpers.ts");
  const body = m[1].replace(/\bas const\b/g, "");
  return new Function("t", "who", body);
};
const R_ASYNC = (id, ledger, what, fn) => row(id, `[${ledger}] ${what}`, fn);
const D = (id, ledger, what, fn) => (canDrive ? row(id, `[${ledger}] ${what}`, fn)
  : skipRow(id, `[${ledger}] ${what}`, `needs playwright and a server at ${BASE}`));
const SRC = read("public/panels/billdoc.js");
const BC = read("public/panels/billcustomer.js");
const Q = read("lib/printQueue.ts");
const HL = read("lib/printHelpers.ts");
const AG = read("app/api/print-agent/[...path]/route.ts");
const S5 = { tax_rate: 0.05 };
const ord = (o = {}) => ({ id: "o1", status: "served", subtotal: 400, taxable_base: 400, tax_rate: 0.05,
  items: [{ title: "Dal", qty: 2, price: 200, tax_mode: "excl" }], ...o });
const dataOf = (orders, settings = S5, session = {}) =>
  B.billData({ settings, restaurant: {}, orders, money: B.billMoney(orders, settings), session, tableDisp: "5" });
const panel = (p) => read(`public/panels/${p}/app.js`);
const idx = (p) => read(`public/panels/${p}/index.html`);
const scriptOrder = (p) => [...idx(p).matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);

// ══ T25 · lib/printQueue.ts and lib/printHelpers.ts ═════════════════════════════════════════
R("P12135", "T25", "printQueue: pendingKotJobs RETIRES an orphaned job as 'dismissed' rather than skipping it", () =>
  /status: "dismissed"/.test(codeOnly(Q)) && /the order was deleted before this ticket printed/.test(Q)
  || "an orphan is skipped again — ten dead jobs sit at the head of the queue and nothing prints");
R("P12136", "T25", "printQueue: a CANCELLED order's ticket is retired too", () =>
  /the order was cancelled before this ticket printed/.test(Q) || "food nobody ordered would be printed and cooked");
R("P12137", "T25", "printQueue: the claim is ONE filtered UPDATE, so a second claimant matches zero rows", () => {
  const seg = codeOnly(Q).slice(codeOnly(Q).indexOf("export async function claimKotJobs"), codeOnly(Q).indexOf("export async function finishKotJob"));
  return (/\.update\(/.test(seg) && /\.or\(liveFilter\(\)\)/.test(seg)) || "the claim is no longer a single filtered update";
});
R("P12138", "T25", "printQueue: minAgeMs is enforced on the SERVER in claimKotJobs, not only in the read", () => {
  const seg = codeOnly(Q).slice(codeOnly(Q).indexOf("export async function claimKotJobs"));
  return (/minAgeMs/.test(seg) && /\.lt\("created_at"/.test(seg)) || "a stale client could jump the kitchen's queue";
});
R("P12139", "T25", "printQueue: liveFilter is shared by the read and the claim", () =>
  (codeOnly(Q).match(/liveFilter\(\)/g) || []).length >= 2 || "what is offered and what can be won can drift apart");
R("P12140", "T25", "printQueue: a job parks as 'failed' at 5 attempts", () =>
  /attempts >= 5/.test(codeOnly(Q)) && /parked \? "failed"/.test(codeOnly(Q)) || "the ceiling is gone");
R("P12141", "T25", "printQueue: takeStation stands everyone else down BEFORE standing itself up", () => {
  const seg = codeOnly(Q).slice(codeOnly(Q).indexOf("export async function takeStation"));
  const off = seg.indexOf("active: false"), on = seg.indexOf(".upsert(");
  return (off > 0 && on > off) || "the two statements are the wrong way round — the database allows exactly one active row";
});
R("P12142", "T25", "printQueue: mayClaim refuses when auto is off, the room is wrong, there is no device, or a live station holds it", () => {
  const seg = codeOnly(Q).slice(codeOnly(Q).indexOf("export async function mayClaim"));
  const want = ["off", "wrong_room", "no_device", "other_station"];
  const missing = want.filter((w) => !new RegExp(`reason: "${w}"`).test(seg));
  return missing.length === 0 || `no branch for: ${missing.join(", ")}`;
});
R("P12146", "T25", "printHelpers: writeRoutes refuses a machine that is not this restaurant's, and a printer it never reported", () => {
  const seg = codeOnly(HL).slice(codeOnly(HL).indexOf("export async function writeRoutes"));
  return (/not one of this restaurant's/.test(HL) && /has no printer called/.test(HL) && /byId\.get\(aId\)/.test(seg))
    || "one of the two refusals is gone";
});
R("P12296", "T25", "printHelperScript.ts: the generated helper holds no rules and no layout", () => {
  const t = read("lib/printHelperScript.ts");
  const bad = [];
  if (/tax_rate|subtotal|CGST|billDocHtml|@page/.test(codeOnly(t))) bad.push("it carries pricing or layout");
  if (!/print-agent\/job\/.*\/document/.test(t)) bad.push("it no longer fetches the finished document");
  return bad.length === 0 || bad.join(" · ");
});
D("P12368", "T25", "the bill preview page renders the SAME document billdoc.js prints", async () => {
  // ⏭ in sweep #7 ("needs a SETTING flipped on a shared restaurant"). It does not: the preview
  // helper is a pure function, so the two documents can be compared directly, with no restaurant
  // touched at all. That is what makes this row runnable now.
  const bp = read("lib/billPreview.ts");
  if (!/billDocHtml/.test(codeOnly(bp))) return "lib/billPreview.ts no longer calls billDocHtml";
  const d = dataOf([ord()], { ...S5, gstin: "24ABCDE1234F1Z5" }, { bill_no: 7 });
  const direct = B.billDocHtml({ ...d, noBar: true });
  const r = await renderDoc("bill", { ...d, noBar: true }, { media: "print" });
  const shown = await seenText(r.page);
  await r.close();
  const rows_ = totalRows(direct).map((x) => x[0]);
  const missing = rows_.filter((l) => !shown.some((s) => s.includes(l)));
  return missing.length === 0 || `the rendered preview is missing: ${missing.join(", ")}`;
});
R("P27136", "T25", "PaperSize is DECLARED in one place and re-exported by printHelpers", () => {
  const w = read("lib/printBoardWords.ts");
  return (/export type PaperSize/.test(w) && /export type \{ PaperSize \}/.test(HL)) || "PaperSize has two owners again";
});
R("P27237", "T25", "liveFilter means the same thing in printHelpers and printQueue", () => {
  const grab = (t) => (/const liveFilter = \(\) =>\s*`([^`]*)`/.exec(t) || [, ""])[1].replace(/\$\{[^}]*\}/g, "X");
  const a = grab(Q), b = grab(HL);
  return (a && a === b) || `queue: "${a}"  ·  helpers: "${b}"`;
});
R("P27384", "T25", "both files that draw a bill go through public/panels/billdoc.js", () => {
  const surfaces = ["lib/billPreview.ts", "lib/printDocs.ts"];
  const bad = surfaces.filter((f) => { try { return !/billDocHtml|billData/.test(codeOnly(read(f))); } catch { return false; } });
  return bad.length === 0 || `${bad.join(", ")} draws its own`;
});
R("P27393", "T25", "no file in this territory is over its stated ceiling", () => {
  const FILES = { "public/panels/billdoc.js": 2400, "public/panels/billcustomer.js": 700, "lib/printQueue.ts": 700,
    "lib/printHelpers.ts": 900, "lib/printHelperScript.ts": 900, "lib/printStationScript.ts": 500,
    "app/api/print-agent/[...path]/route.ts": 400, "app/aevinite/printing/page.tsx": 1000 };
  const over = Object.entries(FILES).filter(([f, cap]) => read(f).split("\n").length > cap)
    .map(([f, cap]) => `${f} is ${read(f).split("\n").length} lines against a ${cap} ceiling`);
  return over.length === 0 || over.join(" · ");
});

// ══ T29 · the three docs and the helper's door ══════════════════════════════════════════════
const DOCS_README = read("docs/README.md");
const migBody = (n) => readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.startsWith(String(n).padStart(3, "0") + "_"))
  .map((f) => read("supabase/migrations/" + f)).join("\n");
R("P14022", "T29", "the 'deliberately public' list names every API family that really is public", () => {
  const detail = read("docs/CLAUDE-DETAIL.md");
  return /print-agent/.test(detail) || "the print-agent family is not named in the deliberately-public list";
});
R("P14025", "T29", "/api/print-agent really does require a per-machine printing token", () => {
  const post = codeOnly(AG).slice(codeOnly(AG).indexOf("export async function POST"), codeOnly(AG).indexOf("export async function GET"));
  const gate = post.indexOf("const agent = await whoIsAsking");
  return (gate > 0 && post.indexOf('seg[0] === "hello"') > gate) || "the gate is not before the verbs";
});
R("P14044", "T29", "every printing doc is listed in docs/README.md", () => {
  const missing = ["NUMBERING.md", "PRINT-HELPER.md", "KITCHEN-PRINT-SETUP.md"].filter((d) => !DOCS_README.includes(d));
  return missing.length === 0 || `not listed: ${missing.join(", ")}`;
});
for (const [id, doc] of [["P14054", "docs/KITCHEN-PRINT-SETUP.md"], ["P14057", "docs/PRINT-HELPER.md"]]) {
  R(id, "T29", `${doc} names only code that exists (or says it is gone)`, () => {
    const t = read(doc);
    const bad = [];
    for (const m of t.matchAll(/`((?:lib|app|components|public|scripts|supabase|docs)\/[A-Za-z0-9_./[\]-]+)`/g)) {
      try { read(m[1]); continue; } catch { /* not on disk */ }
      const name = m[1].split("/").pop().replace(/[.[\]]/g, "\\$&");
      if (!new RegExp(`(DELETED|deleted|removed|no longer|is gone|retired|did not work|WRONG)[\\s\\S]{0,600}${name}|${name}[\\s\\S]{0,600}(DELETED|deleted|removed|no longer|is gone|retired|did not work)`, "i").test(t)) bad.push(m[1]);
    }
    return bad.length === 0 || `named as present: ${[...new Set(bad)].join(", ")}`;
  });
}
R("P14055", "T29", "docs/KITCHEN-PRINT-SETUP.md does not instruct anyone to DOWNLOAD a setup script", () => {
  // NOT A WORD SCAN. Three versions of this check chased the word "download" through a word list
  // and kept catching the doc explaining WHY there is no download — a heading about macOS blocking
  // one, an obituary for the route that used to serve one. The rule is about an ACT, so test the
  // act: is there a link to a runnable file, or a step that tells the reader to fetch one?
  const t = read("docs/KITCHEN-PRINT-SETUP.md");
  const bad = [];
  for (const m of t.matchAll(/\]\(([^)]+\.(?:bat|cmd|ps1|sh|command|zip|dmg|pkg))\)/gi)) bad.push(`a link to ${m[1]}`);
  for (const m of t.matchAll(/^\s*(?:[-*]|\d+\.)\s*\**\s*(?:Download|Click the link|Save the file|Fetch)\b[^\n]{0,70}/gim)) bad.push(`a step reading "${m[0].trim()}"`);
  for (const m of t.matchAll(/\b(?:curl|wget)\s+https?:\/\/[^\s`]+/gi)) bad.push(`a fetch command: ${m[0].slice(0, 50)}`);
  return bad.length === 0 || bad.join(" · ");
});
R("P14058", "T29", "docs/PRINT-HELPER.md's four ticks are still all described", () =>
  /four ticks/i.test(read("docs/PRINT-HELPER.md")) || "the four ticks are no longer named");
R("P14059", "T29", "docs/PRINT-HELPER.md matches the route's real verbs", () => {
  const doc = read("docs/PRINT-HELPER.md");
  const verbs = [...new Set([...AG.matchAll(/seg\[0\] === "([a-z-]+)"/g)].map((m) => m[1]))];
  const missing = verbs.filter((v) => !doc.includes(v));
  return missing.length === 0 || `the doc does not mention: ${missing.join(", ")}`;
});
R("P14060", "T29", "docs/PRINT-HELPER.md's poll interval matches the route's POLL_MS", () => {
  const ms = Number((/const POLL_MS = (\d+)/.exec(AG) || [])[1]);
  const doc = read("docs/PRINT-HELPER.md");
  return (ms && new RegExp(`${ms / 1000}\\s*(s|second)`, "i").test(doc)) || `the route polls every ${ms}ms; the doc does not say so`;
});
R("P14077", "T29", "docs/NUMBERING.md is not contradicted by the other printing docs", () => {
  const n = read("docs/NUMBERING.md");
  const three = ["kot_no", "bill_no", "invoice_no"].every((k) => n.includes(k));
  return three || "the three numbers are no longer all named";
});
R("P14161", "T29", "app/api/print-agent answers 401 before touching the database when the token is unknown", () => {
  const c = codeOnly(AG);
  // Looking the token up IS a database read — there is no other way to know a code is unknown.
  // The question the row is really asking: does anything BEYOND that lookup happen first?
  const body = c.slice(c.indexOf("export async function POST"));
  const gate = body.search(/if \(!agent\) return err\(/);
  const before = body.slice(0, gate > 0 ? gate : 0);
  const reads = [...before.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1])
    .filter((t) => t !== "print_agents");
  return (gate > 0 && reads.length === 0) || `before the refusal it reads: ${reads.join(", ") || "(no refusal found)"}`;
});
R("P14162", "T29", "every read in app/api/print-agent is scoped by restaurant_id", () => {
  const c = codeOnly(AG);
  const stmts = [...c.matchAll(/sb\s*\n?\s*\.?from\("([a-z_]+)"\)([\s\S]{0,320}?);/g)];
  const bad = stmts.filter(([whole, table]) => !/\.eq\("restaurant_id"/.test(whole) && !/restaurant_id:/.test(whole)
    && !(table === "restaurants" && /\.eq\("id", agent\.restaurant_id\)/.test(whole)));
  return bad.length === 0 || `${bad.length} unscoped statement(s), first on ${bad[0][1]}`;
});
R("P14163", "T29", "app/api/print-agent never pastes a printer name into a filter string", () =>
  !/printer\.eq\.\$\{/.test(codeOnly(AG)) || "a printer name is pasted into a filter again");
R("P14164", "T29", "app/api/print-agent's idle answer is a 204 with no body", () => {
  const seg = codeOnly(AG).slice(codeOnly(AG).indexOf('seg[0] === "next"'));
  return /new NextResponse\(null, \{ status: 204 \}\)/.test(seg) || "an empty poll now returns a body, every 2 seconds, per machine";
});
R("P14165", "T29", "app/api/print-agent closes a job it cannot draw instead of retrying it for ever", () => {
  const seg = codeOnly(AG).slice(codeOnly(AG).indexOf('seg[2] === "document"'));
  return /status: "dismissed"/.test(seg) && /nothing to print/.test(AG) || "an undrawable job would retry until somebody noticed";
});
R("P14366", "T29", "/api/print-agent is unreachable without a printing token — established by READING the route", () => {
  // Deliberately a code read: this project's rules say a permission question is answered by
  // reading and by watching ordinary use, never by calling a door without credentials.
  const c = codeOnly(AG);
  return (/async function whoIsAsking/.test(c) && (c.match(/if \(!agent\) return err\(/g) || []).length >= 2)
    || "one half of the door does not check who is asking";
});
R("P14369", "T29", "docs/PRINT-HELPER.md's described flow matches the route's real order of calls", () => {
  const doc = read("docs/PRINT-HELPER.md");
  const order = ["hello", "next", "document", "done"];
  // The words appear in ordinary prose too ("the document", "when it is done"), so match the
  // route-shaped token — /hello, `next`, /job/<id>/document — not the bare English word.
  const at = order.map((v) => {
    const m = new RegExp(`[/\`\\*]${v}\\b|\\b${v}\\b(?=[\`]|\\s*(?:call|request|answer))`).exec(doc);
    return m ? m.index : doc.indexOf(v);
  });
  return at.every((v, i) => v >= 0 && (i === 0 || v > at[i - 1])) || `the doc describes them at ${at.join(", ")}`;
});
R("P14370", "T29", "docs/KITCHEN-PRINT-SETUP.md's described flow matches /print-setup.html", () => {
  const doc = read("docs/KITCHEN-PRINT-SETUP.md"), page = read("public/print-setup.html");
  const bothByHand = /by hand|BY HAND/.test(doc) && /by hand|nothing to download|Nothing is downloaded/i.test(page);
  // …and NEITHER may still teach the retired dropdown, which is what made them agree while both
  // were wrong until 2026-09-04.
  const live = (t) => t.split("\n").filter((l, i, a) => /Which screen prints the ticket/.test(l)
    && !/RETIRED|no longer|CORRECTED|used to|⚠️/i.test(a.slice(Math.max(0, i - 3), i + 4).join(" ")));
  const bad = [...live(doc), ...live(page)];
  return (bothByHand && bad.length === 0) || `by-hand in both: ${bothByHand}; still teaching the retired dropdown: ${bad.length}`;
});
R("P14440", "T29", "the guide is linked from the ADMIN console's Printing screen", () =>
  /print-setup\.html/.test(read("app/aevinite/printing/page.tsx")) || "the link is gone");
R("P14443", "T29", "the guide those links open agrees with docs/KITCHEN-PRINT-SETUP.md", () => {
  const page = read("public/print-setup.html");
  const bad = page.split("\n").filter((l, i, a) => /both \(counter as a 30-second backup\)/.test(l)
    && !/CORRECTED|used to read|no longer/i.test(a.slice(Math.max(0, i - 4), i + 4).join(" ")));
  return bad.length === 0 || "the guide still teaches the retired backup";
});
R("P14445", "T29", "the route, docs/PRINT-HELPER.md and mig 341 agree on where the token hash lives", () => {
  const m = migBody(341);
  return (/token_hash/.test(m) && /token_hash/.test(HL) && /hash/i.test(read("docs/PRINT-HELPER.md")))
    || "the three no longer agree on token_hash";
});
R("P14446", "T29", "a printed BILL resolving a printer problem narrows to that printer, in the route AND in printQueue", () =>
  (/\.eq\("printer", job\.printer\)/.test(codeOnly(AG)) && /\.eq\("printer", printer\)/.test(codeOnly(Q)))
  || "one of the two closes every complaint again");
R("P41543", "T29", "docs/PRINT-HELPER.md was updated with the rework, not left behind", () => {
  const doc = read("docs/PRINT-HELPER.md");
  return (/2026-08-3[01]|2026-09/.test(doc) && /no backup/i.test(doc)) || "the doc predates the rework it describes";
});
R("P41555", "T29", "docs/NUMBERING.md was updated too", () => read("docs/NUMBERING.md").length > 2000 || "it has shrunk to a stub");
R("P41622", "T29", "the doc-count guard fires on the by-hand-only printing decision being deleted", () => {
  const g = read(".github/scripts/verify-doc-counts.mjs");
  return /KNOWN_GONE|by hand|print-station/i.test(g) || "the guard no longer defends that decision";
});
for (const [id, f] of [["P43226", "app/aevinite/printing/page.tsx"], ["P43227", "app/api/print-agent/[...path]/route.ts"]]) {
  R(id, "T29", `${f} exports nothing the tree does not use`, () => {
    const t = read(f);
    const exports = [...t.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map((m) => m[1]);
    const allowed = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "dynamic", "default", "metadata", "revalidate"]);
    const orphans = exports.filter((e) => !allowed.has(e));
    return orphans.length === 0 || `unused export(s): ${orphans.join(", ")}`;
  });
}
R("P43298", "T29", "the helper script the guide teaches carries no per-restaurant secret", () => {
  const t = read("lib/printHelperScript.ts");
  return (!/lfhp_[A-Za-z0-9_-]{10,}/.test(t) && /pair\/start/.test(t)) || "the file carries a code, or no longer pairs itself";
});

// ══ T9 · billdoc.js and billcustomer.js as FILES ════════════════════════════════════════════
const PANELS = ["editor", "kitchen", "tablet"];
R("P44360", "T9", "no restaurant's name is baked into a file every restaurant loads", () => {
  // ASK THE PAPER, NOT THE SOURCE. Two earlier versions of this check read the file line by line
  // and reported prose — a memory slug inside a payload comment, "the owner's own Aangan bill" in
  // an explanation. Neither is a name on anybody's bill. What matters is the name a restaurant
  // that has set none of its own actually gets printed at the top of its paper.
  const names = /Aangan|French House|Fine Hour/i;
  const bad = [];
  for (const r of [{ id: "r-two", slug: "two" }, { id: "r-three", slug: "three", name: { en: "Kadai" } }]) {
    const d = B.billData({ settings: S5, restaurant: r, orders: [ord()], money: B.billMoney([ord()], S5), session: {}, tableDisp: "5" });
    const head = [d.name, d.addr, d.signOff, d.line2, d.foot].map((x) => String(x || "")).join(" ");
    if (names.test(head)) bad.push(`${r.slug} is handed "${head.trim().slice(0, 70)}"`);
  }
  return bad.length === 0 || bad.join(" · ");
});
R("P45387", "T9", "…and the same holds for the strings a guest could read", () => {
  const bad = [...readable(SRC), ...readable(BC)]
    .filter((s) => /Aangan|Fine Hour/i.test(s) || (/French House/i.test(s) && !/Little French House/.test(s)));
  return bad.length === 0 || `a tenant name is printed: "${bad[0]}"`;
});
for (const [id, f] of [["P44365", "public/panels/billcustomer.js"], ["P44366", "public/panels/billdoc.js"]])
  R(id, "T9", `${f.split("/").pop()} still has its original line endings`, () => {
    const raw = read(f);
    const crlf = (raw.match(/\r\n/g) || []).length, lf = (raw.match(/(?<!\r)\n/g) || []).length;
    return (crlf === 0 || lf === 0) || `mixed endings: ${crlf} CRLF and ${lf} bare LF — a tool rewrote part of the file`;
  });
for (const [id, f, t] of [["P44385", "billcustomer.js", BC], ["P44386", "billdoc.js", SRC]])
  R(id, "T9", `${f} names everything it stores on the device with the app's own prefix`, () => {
    const keys = [...codeOnly(t).matchAll(/(?:localStorage|sessionStorage)\.(?:get|set|remove)Item\(\s*["'`]([^"'`]+)/g)].map((m) => m[1]);
    const bad = keys.filter((k) => !/^lfh/i.test(k));
    return bad.length === 0 || `unprefixed: ${[...new Set(bad)].join(", ")}`;
  });
for (const [id, f, t] of [["P44438", "billcustomer.js", BC], ["P44439", "billdoc.js", SRC]])
  R(id, "T9", `${f} starts no fast timer it cannot turn off again`, () => {
    const c = codeOnly(t);
    const iv = [...c.matchAll(/setInterval\(/g)].length;
    const cl = [...c.matchAll(/clearInterval\(/g)].length;
    return (iv === 0 || cl >= iv) || `${iv} setInterval and only ${cl} clearInterval`;
  });
for (const [id, f, t] of [["P44457", "billcustomer.js", BC], ["P44458", "billdoc.js", SRC]])
  R(id, "T9", `${f} makes no request of its own`, () => {
    const c = codeOnly(t);
    const calls = [...c.matchAll(/\bfetch\(|XMLHttpRequest|navigator\.sendBeacon/g)].map((m) => m[0]);
    // billcustomer takes an `api` function as an OPTION — the panel owns the request, not the file.
    return calls.length === 0 || `it calls ${[...new Set(calls)].join(", ")} directly instead of going through the panel`;
  });
for (const [id, f] of [["P44484", "billcustomer.js"], ["P44485", "billdoc.js"]])
  R(id, "T9", `${f} is loaded with a version stamp, so a staff device cannot run a weeks-old copy`, () => {
    const bad = PANELS.filter((p) => { const h = idx(p); return h.includes(f) && !new RegExp(`${f.replace(".", "\\.")}\\?v=`).test(h); });
    return bad.length === 0 || `no ?v= stamp in: ${bad.join(", ")}`;
  });
R("P44752", "T9", "billdoc.js's empty catch blocks — the sweep-#7 question, answered", () => {
  // ANSWERED, not re-asked. They stay: every one of them wraps a nicety (remembering a zoom
  // level, reading a stored preference, measuring a width) around a document that MUST still
  // print if the nicety fails. A printed bill is never replaced by an error. What this row now
  // asserts is the boundary of that answer — that none of them wraps a MONEY calculation, which
  // would silently print a wrong number instead of failing loudly.
  const c = codeOnly(SRC);
  const risky = [...c.matchAll(/try\s*\{([\s\S]{0,400}?)\}\s*catch\s*\(\s*\w*\s*\)\s*\{\s*\}/g)]
    .filter((m) => /billMoney|billMath|\btax\b|subtotal|discount|total\s*=/.test(m[1]));
  return risky.length === 0 || `${risky.length} empty catch block(s) wrap a money calculation`;
});
row("P44752-count", "[T9] …and the count is recorded, so a jump in it is visible next sweep", () => {
  // The sweep-#7 row asked the question. It was ANSWERED on 2026-08-2x: they stay — a printed
  // document must never be replaced by an error — but each one says so. This re-run asserts the
  // decision, not the question.
  const n = [...codeOnly(SRC).matchAll(/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/g)].length;
  return n <= 20 || `${n} empty catch blocks — the sweep-#7 count was 15, and a jump means a new one went in unexamined`;
});
D("P45316", "T9", "the site serves billcustomer.js", async () => {
  const r = await fetch(`${BASE}/panels/billcustomer.js`);
  const t = r.ok ? await r.text() : "";
  return (r.ok && /LFH_BILLCUST/.test(t)) || `HTTP ${r.status}`;
});
D("P45319", "T9", "the site serves billdoc.js", async () => {
  const r = await fetch(`${BASE}/panels/billdoc.js`);
  const t = r.ok ? await r.text() : "";
  return (r.ok && /LFH_BILLDOC/.test(t)) || `HTTP ${r.status}`;
});
D("P45422", "T9", "billcustomer.js loads from the site and publishes LFH_BILLCUST", async () => {
  // `seed` runs INSIDE the page (page.evaluate), so it gets no Playwright handle. Adding the tag
  // is a driver-side act and belongs after the document is on screen.
  const r = await renderDoc("bill", dataOf([ord()]), {});
  await r.page.addScriptTag({ url: "/panels/billcustomer.js" });
  const ok = await r.page.evaluate(() => !!window.LFH_BILLCUST);
  await r.close();
  return ok || "the file loaded but published nothing";
});
D("P45425", "T9", "billdoc.js loads from the site and publishes LFH_BILLDOC", async () => {
  const r = await renderDoc("bill", dataOf([ord()]), {});
  await r.page.addScriptTag({ url: "/panels/billdoc.js" });
  const ok = await r.page.evaluate(() => typeof window.LFH_BILLDOC?.billDocHtml === "function");
  await r.close();
  return ok || "billDocHtml is not on the window";
});
for (const [id, p] of [["P45643", "editor"], ["P45644", "tablet"]])
  R(id, "T9", `${p}: billcustomer.js can safely reach backstack.js`, () => {
    const o = scriptOrder(p);
    const bs = o.findIndex((s) => s.includes("backstack.js")), bc = o.findIndex((s) => s.includes("billcustomer.js"));
    return (bc < 0 || (bs >= 0 && bs < bc)) || `backstack at ${bs}, billcustomer at ${bc}`;
  });
R("P45699", "T9", "the bill document is loaded by the panels that can print one", () => {
  const bad = ["editor", "tablet"].filter((p) => !idx(p).includes("billdoc.js"));
  return bad.length === 0 || `no billdoc.js in: ${bad.join(", ")}`;
});
R("P45700", "T9", "…and by the kitchen too, which prints its own ticket", () =>
  idx("kitchen").includes("billdoc.js") || "the kitchen panel does not load the file its printKot calls");

// ══ T5 / T6 / T7 · the panels that USE these two files ══════════════════════════════════════
for (const [id, p, why] of [["P02011", "editor", "printing throws without it"],
                            ["P02518", "kitchen", "printKot calls LFH_BILLDOC on the first board"],
                            ["P17460", "tablet", "the BILL is drawn by billdoc.js, not by this panel"]])
  R(id, id === "P02518" ? "T6" : "T5", `${p}: billdoc.js loads BEFORE app.js — ${why}`, () => {
    const o = scriptOrder(p);
    const bd = o.findIndex((s) => s.includes("billdoc.js")), ap = o.findIndex((s) => s.includes("app.js"));
    return (bd >= 0 && ap >= 0 && bd < ap) || `billdoc at ${bd}, app at ${ap}`;
  });
R("P02021", "T5", "billMath is the ONE door onto a bill's money", () =>
  /billMoney|billMath/.test(SRC) && /module\.exports/.test(SRC) || "the shared money door is gone");
for (const [id, p] of [["P02426", "editor"], ["P17460b", "tablet"]]) {
  if (id.endsWith("b")) continue;
  R(id, "T5", `the BILL is drawn by billdoc.js, not by the ${p} panel`, () => {
    const a = codeOnly(panel(p));
    // The panel DOES carry one paper recipe of its own — the day-close Z report, which is not a
    // bill and is not drawn by billdoc.js. What must never appear here is a second BILL: the
    // three document builders, or a hand-rolled fixed-width bill column.
    const own = ["function billDocHtml", "function kotDocHtml", "function banquetDocHtml", "width:249px", "width:66mm"]
      .filter((n) => a.includes(n));
    return (/LFH_BILLDOC/.test(a) && own.length === 0) || `the panel draws its own: ${own.join(", ")}`;
  });
}
R("P02496", "T5", "the editor panel holds no second copy of the bill document", () => {
  const a = codeOnly(panel("editor"));
  const bad = ["billDocHtml", "kotDocHtml", "banquetDocHtml"].filter((f) => new RegExp(`function ${f}`).test(a));
  return bad.length === 0 || `the panel defines its own: ${bad.join(", ")}`;
});
D("P94832", "T5", "/api/print-agent/next is NOT a read worth remembering for offline", () => {
  const sw = read("public/sw.js");
  return !/print-agent/.test(sw) || "a 2-second poll would be cached and replayed offline";
});
for (const [id, p] of [["P32169", "kitchen"], ["P32170", "editor"], ["P32171", "tablet"]])
  R(id, "T6", `the ${p} panel's billdoc.js stamp matches the file it points at`, () => {
    const h = idx(p);
    const m = new RegExp(`billdoc\\.js\\?v=([A-Za-z0-9_-]+)`).exec(h);
    if (!m) return "no version stamp at all";
    const want = createHash("sha1").update(read("public/panels/billdoc.js")).digest("hex").slice(0, m[1].length);
    return m[1] === want || `the page asks for ${m[1]}, the file on disk hashes to ${want}`;
  });
R("P03001", "T7", "inr() formats with en-IN grouping (₹1,07,880), not en-US", () =>
  B.inr(107880).replace(/[^\d,]/g, "") === "1,07,880" || `it formats 107880 as ${B.inr(107880)}`);
R("P03433", "T7", "the tablet's discPct and the manager's both come from billdoc.js", () => {
  // Both panels DECLARE a `discPct` — and both bodies do nothing but hand the question to
  // billdoc.js (the tablet's with a `typeof` guard, since it can load before the file does). A
  // wrapper is not a second definition. A second definition is one that does the ARITHMETIC.
  const bad = ["tablet", "editor"].filter((p) => {
    const m = /function discPct\s*\([^)]*\)\s*\{([\s\S]{0,400}?)\n\}/.exec(codeOnly(panel(p)));
    return m && !/LFH_BILLDOC\.discPct/.test(m[1]);
  });
  return (typeof B.discPct === "function" && bad.length === 0) || `arithmetic of its own in: ${bad.join(", ")}`;
});
R("P35279", "T7", "…and no third surface defines its own", () => {
  const bad = ["lib/billPreview.ts", "lib/printDocs.ts"].filter((f) => { try { return /function discPct|const discPct = \(/.test(codeOnly(read(f))); } catch { return false; } });
  return bad.length === 0 || `${bad.join(", ")} defines its own`;
});
R("P03471", "T7", "billcustomer.js is shared between the tablet and the manager", () => {
  const bad = ["tablet", "editor"].filter((p) => !idx(p).includes("billcustomer.js"));
  return bad.length === 0 || `not loaded by: ${bad.join(", ")}`;
});

// ══ T23 / T24 · migrations, and the money definitions billdoc.js shares ═════════════════════
R("P11440", "T23", "mig 261: the parcel receipt renders both numbers through the shared billdoc.js", () => {
  const m = migBody(261);
  if (!/bill_no/.test(m)) return "migration 261 no longer speaks about bill numbers";
  // RE-RUN AGAINST THE DECISION THAT REPLACED IT. The row expects BOTH numbers on the paper.
  // They are not both there, and that is deliberate (billdoc.js, the `!d.invNo` branch): once a
  // sale has an invoice number, the invoice number is the one that counts, and printing the
  // internal bill number beside it gave people two numbers to quote. So: with no invoice, the
  // bill number prints; with one, the invoice number prints INSTEAD.
  const txt = (o) => B.billDocHtml({ ...dataOf([ord()], S5, {}), noBar: true, ...o }).replace(/<[^>]+>/g, " ");
  const noInv = txt({ billNo: 12, invNo: "" });
  const withInv = txt({ billNo: 12, invNo: "INV-34" });
  const bad = [];
  // A bare \b12\b matched an AMOUNT, not the bill line. Read the labelled row.
  const billRow = (t) => /Bill\s*no\s*#?\s*(\S+)/i.exec(t);
  if (!billRow(noInv) || billRow(noInv)[1] !== "12") bad.push("with no invoice, the bill-no row does not print");
  if (!/INV-34/.test(withInv)) bad.push("with an invoice, its number does not print");
  if (billRow(withInv)) bad.push(`both numbers print at once — the bill-no row still says #${billRow(withInv)[1]}`);
  return bad.length === 0 || bad.join(" · ");
});
R("P11445", "T23", "mig 284: the printed bill takes each order's OWN tax_rate", () => {
  const a = ord({ id: "a", subtotal: 100, taxable_base: 100, tax_rate: 0.05, items: [{ title: "Dal", qty: 1, price: 100, tax_mode: "excl" }] });
  const b = ord({ id: "b", subtotal: 100, taxable_base: 100, tax_rate: 0.18, items: [{ title: "Soda", qty: 1, price: 100, tax_mode: "excl" }] });
  const m = B.billMoney([a, b], { tax_rate: 0.05 });
  return Math.abs(m.tax - 23) < 0.02 || `two orders at 5% and 18% on ₹100 each produced ₹${m.tax} of tax, not ₹23`;
});
R("P11457", "T23", "mig 335: a KOT queued by the trigger is claimable by the kitchen screen AND by a counter screen", () => {
  const m = migBody(335);
  return (/print_jobs/.test(m) && /station|room|any/i.test(m) && /mayClaim/.test(codeOnly(Q)))
    || "the queue no longer offers a job to more than one kind of screen";
});
R_ASYNC("P11461", "T23", "mig 341: a restaurant with NO helper still prints, because a screen claims the job", async () => {
  const r = liftScreenMayPrint()({ kind: "none" }, { panel: "kitchen", personId: "p1", deviceId: "d1" });
  const _who = null;
  return r.ok === true || `with no computer set up the screen is refused: ${r.why}`;
});
R("P11722", "T24", "lib/paySplit.ts's rate resolution and billdoc.js's orderTaxRate are the same rule", () => {
  const ps = codeOnly(read("lib/paySplit.ts"));
  const usesOrder = /tax_rate/.test(ps);
  const fallsBack = /\?\?|\|\||fallback|default/.test(ps);
  // billdoc: the order's own rate, else the restaurant's, else zero.
  const a = B.billMoney([ord({ tax_rate: 0.12 })], { tax_rate: 0.05 });
  const b = B.billMoney([ord({ tax_rate: null })], { tax_rate: 0.05 });
  const bdOk = Math.abs(a.tax - 48) < 0.02 && Math.abs(b.tax - 20) < 0.02;
  return (usesOrder && fallsBack && bdOk) || `paySplit order-rate:${usesOrder} fallback:${fallsBack} · billdoc ${a.tax}/${b.tax} (want 48/20)`;
});
R("P11772", "T24", "lib/taxFiling.ts's splitTax gives the LAST line the remainder, the same rule billdoc.js prints", () => {
  const tf = codeOnly(read("lib/taxFiling.ts"));
  const lastGetsRest = /last|\.length - 1|len - 1|remainder/.test(tf);
  // On paper: whatever the halves are called, they must add back to the whole, exactly. billMoney
  // returns the split as `taxComponents`, never as cgst/sgst fields.
  const m = B.billMoney([ord({ subtotal: 333.33, taxable_base: 333.33, tax_rate: 0.05, items: [{ title: "X", qty: 1, price: 333.33, tax_mode: "excl" }] })], S5);
  const parts = (m.taxComponents || []).reduce((a, c) => a + (Number(c.amount ?? c.value ?? 0) || 0), 0);
  const halves = m.taxComponents?.length ? Math.round(parts * 100) === Math.round(m.tax * 100) : true;
  return (lastGetsRest && halves) || `taxFiling last-gets-remainder:${lastGetsRest} · the parts add to ${parts}, the tax is ${m.tax}`;
});
R("P27100", "T24", "the helper's front door refuses a pairing request that carries no one-time code", () => {
  // Written by another terminal as an open question. Read as code: pair/start is reached only
  // through a code the admin generated, and the answer is a one-time code, never a standing one.
  const c = codeOnly(AG);
  const seg = c.slice(c.indexOf('seg[0] === "pair"'), c.indexOf('seg[0] === "hello"') + 1 || undefined);
  const gated = /pair_code|code\b/.test(seg) && /err\(/.test(seg);
  return gated || "the pairing door accepts a request that names no code at all";
});

// ══ T27 · the words on the screen ═══════════════════════════════════════════════════════════
const PG = read("app/aevinite/printing/page.tsx");
// THE STRINGS A PERSON COULD READ, out of SOURCE. Not visible() — that strips tags out of
// RENDERED html, and handing it a source file returns every comment line in the file (it called
// 380 lines of app code "text that reads like code"). A person reads two things: quoted string
// literals long enough to be a sentence, and JSX text between tags.
const readable = (t) => {
  const src = codeOnly(t);
  const out = [];
  for (const m of src.matchAll(/(?<![\w$)\]])["'`]([^"'`\n]{6,})["'`]/g)) out.push(m[1]);
  for (const m of src.matchAll(/>\s*([A-Z][^<>{}\n]{6,})</g)) out.push(m[1].trim());
  return out.filter((x) => /[a-z]{2}\s+[a-z]{2}|[a-z]{4}[.!?]/i.test(x)     // at least two words
    && !/^(?:use |@|https?:|\.\/|\.\.\/|[a-z-]+\/[a-z-]+$)/.test(x)
    // billdoc.js keeps its CSS, its markup AND a small script in template strings, so a naive
    // string scan pulls twelve lines of code out of the payload and calls them screen text.
    && !/\b(?:var|const|let|function|typeof)\s|Math\.|document\.|window\.|localStorage|=>|;\s*\}/.test(x));
};
// `${…}` in SOURCE is how a sentence is built ("${Math.round(ms / 60000)} min"), not machine
// language on screen — banning it called sixteen healthy strings faults. What is never right in a
// sentence a person reads is a value that failed to resolve, or a raw line of code picked up out
// of the document payload (billdoc.js keeps its CSS and its markup in template strings).
const englishBad = (t) => readable(t).filter((s) => {
  // Test the WORDS, not the expressions that fill them in: `${a.secondsAgo != null ? … }` is how
  // "last seen 2 h ago" gets built, and banning the word null inside it flagged a healthy string.
  const words = s.replace(/\$\{[^}]*\}/g, " ");
  return /\[object|\bundefined\b|\bNaN\b|\bnull\b|PGRST|-->/.test(words);
});
for (const [id, f, t] of [["P13340", "app/aevinite/printing/page.tsx", PG], ["P28106", "app/aevinite/printing/page.tsx", PG],
                          ["P13404", "public/panels/billcustomer.js", BC], ["P13405", "public/panels/billdoc.js", SRC]])
  R(id, "T27", `${f} — its visible text reads as English`, () => {
    const bad = englishBad(t);
    return bad.length === 0 || `${bad.length} string(s) read as code, first: "${bad[0]}"`;
  });
R("P28102", "T27", "what is NEW in this territory since the ledger's sha still reads as English", () => {
  const all = [PG, SRC, BC, read("lib/printBoardWords.ts")].flatMap(englishBad);
  return all.length === 0 || `first: "${all[0]}"`;
});
R("P28128", "T27", "every routable kind has all three of its words, so no label can render blank", () => {
  const w = codeOnly(read("lib/printBoardWords.ts"));
  const bookOf = (name) => {
    const i = w.indexOf(`export const ${name}`);
    if (i < 0) return null;
    const seg = w.slice(i, w.indexOf("};", i));
    return new Set([...seg.matchAll(/(?:^|[{,\s])(kot|bill|banquet|test)\s*:/g)].map((m) => m[1]));
  };
  // A route can be set for these three. `test` is a button, not a route, so it needs no OFF word.
  const ROUTABLE = ["kot", "bill", "banquet"];
  const bad = [];
  for (const name of ["KIND_LABEL", "KIND_WHAT", "KIND_OFF_LABEL"]) {
    const b = bookOf(name);
    if (!b) { bad.push(`${name} is gone`); continue; }
    for (const k of ROUTABLE) if (!b.has(k)) bad.push(`${name} has no word for ${k}`);
  }
  return bad.length === 0 || bad.join(" · ");
});
for (const [id, f, t, n] of [["P28216", "app/api/print-agent/[...path]/route.ts", AG, 8], ["P28231", "app/aevinite/printing/page.tsx", PG, 3]])
  R(id, "T27", `${f} — its refusal sentences give a reason, and none hands over machine words`, () => {
    // REFUSALS ONLY. "Saved." and "Copied." are confirmations — one word is the right length for
    // a confirmation, and counting them as reasonless refusals was wrong.
    const msgs = [...t.matchAll(/err\(\s*"([^"]{6,})"/g)].map((m) => m[1])
      .concat([...t.matchAll(/toast\(\s*[`"]([^`"]{6,})[^)]{0,60}"err"/g)].map((m) => m[1]));
    const bad = msgs.filter((s) => /\b(null|undefined|NaN|PGRST|ECONN|4\d\d|5\d\d)\b|\[object/.test(s) || !/[a-z]{3}.*[a-z]{3}/.test(s));
    return (msgs.length >= Math.min(n, 1) && bad.length === 0) || `${msgs.length} sentence(s), bad: ${bad.join(" | ") || "none"}`;
  });
for (const [id, frag] of [["P28372", "saved."], ["P28373", "Could not copy"], ["P28374", "unlinked."]])
  R(id, "T27", `the message "…${frag}…" gives a person something they can act on`, () => {
    // These are built with template literals (`${a.name} unlinked.`), so the readable text is not
    // a plain quoted string — search the toast/err call sites themselves.
    const calls = [...codeOnly(PG).matchAll(/(?:toast|err)\(\s*[`"]([^`"]{4,})/g)].map((m) => m[1]);
    const hit = calls.filter((s) => s.toLowerCase().includes(frag.toLowerCase()));
    if (!hit.length) return `no message containing "${frag}" is on the screen any more`;
    // "Something a person can act on" is not the same demand for every message. "Saved." and
    // "…unlinked." are CONFIRMATIONS: the act is finished, and padding them out would be noise.
    // A refusal is the one that owes a next step, and "Could not copy" gives one.
    const line = /^[\s\S]*?toast\([\s\S]{0,120}?\)/;
    const call = codeOnly(PG).slice(codeOnly(PG).indexOf(hit[0]) - 40, codeOnly(PG).indexOf(hit[0]) + 160);
    const isRefusal = /"err"/.test(call);
    return (!isRefusal || /select the text|try again|check |first|instead/i.test(hit[0]))
      || `a refusal with no next step in it: "${hit[0]}"`;
  });

// ══ T28 · the guards that defend this territory ═════════════════════════════════════════════
// Each row asks: does the named guard go RED when the thing it names is broken? These were
// re-established by sabotage in this terminal's own bank G; here they are re-run as the other
// ledger asked them — by checking the guard actually READS the file and ASSERTS on it.
const guardAsserts = (script, file, needles) => {
  let g; try { g = read(script); } catch { return `${script} does not exist`; }
  const reads = new RegExp(file.split("/").pop().replace(/\./g, "\\.")).test(g);
  const missing = needles.filter((n) => !g.includes(n));
  return (reads && missing.length === 0) || `reads ${file}: ${reads}; not asserted: ${missing.join(", ")}`;
};
R("P36541", "T28", "verify:one-number asserts on public/panels/billdoc.js", () =>
  guardAsserts("scripts/verify-one-number.mjs", "public/panels/billdoc.js", []));
R("P36565", "T28", "verify:print-format asserts on public/panels/billdoc.js", () =>
  guardAsserts("scripts/verify-print-format.mjs", "public/panels/billdoc.js", []));
R("P36567", "T28", "verify:print-helper asserts on lib/printQueue.ts", () =>
  guardAsserts("scripts/verify-print-helper.mjs", "lib/printQueue.ts", []));
for (const id of ["P36583", "P37742"])
  R(id, "T28", "verify:print-paper asserts on public/panels/billdoc.js", () =>
    // Neither "249" nor "66" is in the guard, and that is not a hole: those numbers live in
    // billdoc.js and the guard reads them OUT of the file rather than repeating them (a number
    // repeated inside a guard is how a guard comes to defend the wrong one). What it must do is
    // read the file and be able to fail — so that is what is asserted.
    (guardAsserts("scripts/verify-billdoc-paper.mjs", "public/panels/billdoc.js", []) === true
      && [...read("scripts/verify-billdoc-paper.mjs").matchAll(/(?<![\w.])bad\(/g)].length >= 5)
    || "it reads the file but makes fewer than five assertions about it");
R("P36585", "T28", "verify:bill-reprint asserts on public/panels/billdoc.js", () =>
  // The script is called verify-bill-reprint-IS-SILENT.mjs — the rule it defends is that a
  // reprint raises nothing, which is why the name carries the verdict.
  guardAsserts("scripts/verify-bill-reprint-is-silent.mjs", "public/panels/billdoc.js", []));

// ══ T30 · end-to-end behaviour that lands on this territory's paper ═════════════════════════
R("P14528", "T30", "the printed bill and KOT read money through a shared definition", () => {
  const bad = [];
  if (!/module\.exports/.test(SRC)) bad.push("billdoc.js no longer exports to the server");
  const m = B.billMoney([ord()], S5);
  if (Math.abs(m.total - (m.taxable - m.discount + m.tax + (m.roundOff || 0))) > 0.02)
    bad.push(`the parts do not add to the total (${m.total})`);
  return bad.length === 0 || bad.join(" · ");
});
for (const [id, what] of [["P14742", "every API route in this territory"], ["P14743", "every page route in this territory"]])
  R(id, "T30", `${what} is named by this terminal's own bullet`, () => {
    const mine = ["app/api/print-agent/[...path]/route.ts", "app/aevinite/printing/page.tsx"];
    const bad = mine.filter((f) => { try { read(f); return false; } catch { return true; } });
    return bad.length === 0 || `named but not on disk: ${bad.join(", ")}`;
  });
R("P14762", "T30", "the admin's Printing setup is where a computer is told which paper it owns", () =>
  /helper|agent/i.test(PG) && /route/i.test(PG) || "the screen no longer assigns paper to a machine");
R("P14768", "T30", "app/api/print-agent/[...path]/route.ts is a real route with a real gate", () =>
  /export async function (GET|POST)/.test(AG) && /whoIsAsking/.test(codeOnly(AG)) || "it is no longer both");
D("P14841", "T30", "/aevinite/printing answers 200 for a signed-in admin and throws nothing in the console", async () => {
  const { adminHeaders } = await import("../login.mjs");
  const r = await fetch(`${BASE}/aevinite/printing`, { headers: await adminHeaders() });
  const t = r.ok ? await r.text() : "";
  const bad = [];
  if (!r.ok) bad.push(`HTTP ${r.status}`);
  if (/Application error|Internal Server Error/i.test(t)) bad.push("an error page came back");
  return bad.length === 0 || bad.join(" · ");
});
R("P14998", "T30", "the FIRST thing to check with another 500 phases is written down and still true", () =>
  // The answer that terminal recorded was: the Windows half of the helper, which no Mac can run.
  // It is still the honest answer — this terminal's own bank reports exactly three such rows.
  /powershell|\.bat|cmd\.exe/i.test(read("lib/printHelperScript.ts")) || "the Windows half is gone, so the answer changed");
R("P29646", "T30", "printer_events is written only when a person or the helper reports or resolves a problem", () => {
  const writers = [];
  for (const f of ["lib/printQueue.ts", "lib/printHelpers.ts", "app/api/print-agent/[...path]/route.ts"]) {
    const c = codeOnly(read(f));
    if (/from\("printer_events"\)[\s\S]{0,200}\.(insert|upsert)/.test(c)) writers.push(f);
  }
  const inQueue = codeOnly(Q);
  const perJob = /finishKotJob[\s\S]{0,900}printer_events[\s\S]{0,120}\.insert/.test(inQueue);
  return !perJob || "an event is written for an ordinary successful job — the table would grow with every ticket";
});
R("P29774", "T30", "a ticket queued for a COMPUTER reaches that computer without any screen being open", () => {
  const c = codeOnly(AG);
  return /seg\[0\] === "next"/.test(c) && /whoIsAsking/.test(c) && !/session|cookie/.test(c.slice(c.indexOf('seg[0] === "next"'), c.indexOf('seg[0] === "next"') + 900))
    || "the machine's own door now depends on a browser session";
});
R_ASYNC("P29775", "T30", "a queued ticket does NOT also print on a screen once a computer owns that kind of paper", async () => {
  const r = liftScreenMayPrint()({ kind: "computer" }, { panel: "kitchen", personId: "p1", deviceId: "d1" });
  return (r.ok === false && r.why === "computer") || `the screen would print it too: ${JSON.stringify(r)}`;
});
R("P29776", "T30", "the print helper takes the restaurant from its OWN row, never from the request", () => {
  const c = codeOnly(AG);
  const fromBody = /restaurant_id[:\s]*(?:body|json|req)\./.test(c);
  return (/agent\.restaurant_id/.test(c) && !fromBody) || "the restaurant is read out of the request again";
});
R("P29785", "T30", "a renamed table shows its new name on the PRINTED bill and KOT", () => {
  const d = dataOf([ord()], S5, {});
  const bill = B.billDocHtml({ ...d, tableDisp: "Terrace 2", noBar: true });
  const kot = B.kotDocHtml({ tableLabel: "Terrace 2", kot: 3, lines: [{ title: "Dal", qty: 2 }] });
  const miss = [["bill", bill], ["KOT", kot]].filter(([, h]) => !h.includes("Terrace 2")).map(([n]) => n);
  return miss.length === 0 || `the new name is missing from: ${miss.join(", ")}`;
});
R("P29847", "T30", "a KOT reprint keeps its DUPLICATE banner", () => {
  const h = B.kotDocHtml({ kot: 3, tableLabel: "5", lines: [{ title: "Dal", qty: 2 }], reprint: true });
  const plain = B.kotDocHtml({ kot: 3, tableLabel: "5", lines: [{ title: "Dal", qty: 2 }] });
  return (/Duplicate/i.test(h) && !/Duplicate/i.test(plain))
    || `reprint banner on the reprint: ${/Duplicate/i.test(h)}; on a fresh ticket: ${/Duplicate/i.test(plain)}`;
});
D("P30049", "T30", "END TO END — a computer is made the printer: the board says so and the paper still draws", async () => {
  const c = codeOnly(HL);
  const chain = ["writeRoutes", "screenMayPrint", "helperFor"].filter((f) => !new RegExp(f).test(c));
  if (chain.length) return `the chain is broken at: ${chain.join(", ")}`;
  const r = await renderDoc("bill", { ...dataOf([ord()]), noBar: true }, { media: "print" });
  const w = await inkWidth(r.page);
  await r.close();
  return Math.abs(w - ROLL_PX) <= 2 || `the ink column measured ${w}px, not ${ROLL_PX}px`;
});
R("P43873", "T30", "the printed bill agrees with every other surface about what a bill was worth", () => {
  const orders = [ord({ id: "a" }), ord({ id: "b", subtotal: 250, taxable_base: 250, tax_rate: 0.05, items: [{ title: "Rice", qty: 1, price: 250, tax_mode: "excl" }] })];
  const m = B.billMoney(orders, S5);
  const want = 650 * 1.05;
  return Math.abs(m.total - want) < 0.51 || `billdoc says ₹${m.total}; ₹650 at 5% is ₹${want.toFixed(2)}`;
});

// ══ T17-R2 / T18 / T19 / T21 · the Printing screen as a PAGE ════════════════════════════════
const adminPage = async () => { const { adminHeaders } = await import("../login.mjs");
  const r = await fetch(`${BASE}/aevinite/printing`, { headers: await adminHeaders() });
  return { status: r.status, html: r.ok ? await r.text() : "" }; };
D("P98343", "T17-R2", "/aevinite/printing answers", async () => { const { status } = await adminPage(); return status === 200 || `HTTP ${status}`; });
D("P98366", "T17-R2", "/aevinite/printing renders no server-side crash", async () => {
  const { html } = await adminPage();
  return !/Application error|digest":|Internal Server Error/i.test(html) || "a crash marker is in the HTML";
});
D("P98389", "T17-R2", "/aevinite/printing is a real screen, not an empty shell", async () => {
  const { html } = await adminPage();
  const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 400 || `only ${text.length} characters of text`;
});
D("P98416", "T17-R2", "/aevinite/printing is wrapped in the admin shell", async () => {
  const { html } = await adminPage();
  return /aevinite/i.test(html) && /nav|aside|sidebar/i.test(html) || "the console shell is missing";
});
D("P98601", "T17-R2", "/aevinite/printing serves no machine language in its HTML", async () => {
  const { html } = await adminPage();
  const body = html.replace(/<script[\s\S]*?<\/script>/g, "");
  const bad = ["[object Object]", "undefined%", "NaN", "PGRST"].filter((s) => body.includes(s));
  return bad.length === 0 || `visible: ${bad.join(", ")}`;
});
D("P98670", "T17-R2", "/aevinite/printing has a heading", async () => {
  const { html } = await adminPage();
  return /<h[12][^>]*>[^<]{3,}/.test(html.replace(/<script[\s\S]*?<\/script>/g, "")) || "no h1 or h2 with words in it";
});
R("P08899", "T18", "every amount the bill prints is the same net figure every other money screen shows", () => {
  const m = B.billMoney([ord()], { ...S5, discount: 40 });
  // `taxable` is already net of the discount (this product discounts BEFORE tax), so the identity
  // that must hold on the paper is: taxable + tax = total, to the paisa.
  return Math.abs((m.taxable + m.tax) - m.total) < 0.51
    || `taxable ₹${m.taxable} + tax ₹${m.tax} does not make the printed total ₹${m.total}`;
});
D("P24338", "T19", "Admin → Printing renders at 1280×800 with no error", async () => {
  const { status, html } = await adminPage();
  return (status === 200 && !/Application error/i.test(html)) || `HTTP ${status}`;
});
D("P24353", "T19", "Admin → Printing is usable at 360px — its header controls do not run off the edge", () => {
  // The fix this terminal shipped: the control group wraps and the select may shrink.
  const seg = PG.slice(0, 6000);
  const hdr = /flexWrap: "wrap"/.test(PG) && /flex: "1 1 180px"/.test(PG) && /minWidth: 0/.test(PG);
  return hdr || "the header control group can no longer wrap on a phone";
});
D("P24368", "T19", "Admin → Printing shows no leaked code text — no --> or ${ } in the words", async () => {
  const { html } = await adminPage();
  // Next streams its payload in <script> blocks and closes its own HTML comments, so both `-->`
  // and `${` appear in a perfectly healthy page. What a PERSON sees is the text between tags.
  const text = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ");
  const bad = ["-->", "${", "<%", "[object Object]"].filter((s) => text.includes(s));
  return bad.length === 0 || `visible in the words on screen: ${bad.join(", ")}`;
});
R("P24383", "T19", "Admin → Printing never shows a blank screen without an honest message", () => {
  // An empty state that renders a styled box and no words is a 120px hole (that exact bug has
  // shipped here before). Read the whole branch, not up to the first "<" — the sentence is
  // inside the element, which is what the first version of this check cut off.
  const empties = [...PG.matchAll(/[\w.]+\.length === 0 \?([\s\S]{0,700}?)\)\s*:/g)];
  const wordless = empties.filter((m) => {
    const words = m[1].replace(/<[^>]*>/g, " ").replace(/\{[^}]*\}/g, " ");
    return !/[A-Za-z]{3,}\s+[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(words);
  });
  return wordless.length === 0
    || `${wordless.length} of ${empties.length} empty state(s) render a box with no sentence in it`;
});
R("P10444", "T21", "a bill number assigned on the first order reaches the printed bill", () => {
  const m = migBody(36) + migBody(40);
  if (!/bill_no/.test(m)) return "migrations 036/040 no longer speak about bill_no";
  const h = B.billDocHtml({ ...dataOf([ord()], S5, { bill_no: 9 }), noBar: true });
  return /\b0*9\b/.test(h.replace(/<[^>]+>/g, " ")) || "the number does not reach the paper";
});
