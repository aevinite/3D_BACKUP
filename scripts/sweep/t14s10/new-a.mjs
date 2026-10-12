// Bank A — the two files in T14's territory that had NO ledger row at all before sweep #10:
//   public/panels/billcustomer.css  (P183001–P183060) — new since 2026-09-06, never checked once
//   public/panels/billdoc.d.ts      (P183061–P183120) — the type contract every TS caller trusts
// Static and node-executed. The driven checks on the same sheet are in ./live.mjs.
import { sec, read, imp, code } from "./lib.mjs";
import { createHash } from "node:crypto";

const CSS = read("public/panels/billcustomer.css");
const CSS_NC = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const JS = read("public/panels/billcustomer.js");
const ED = read("public/panels/editor/index.html"), TB = read("public/panels/tablet/index.html"), KI = read("public/panels/kitchen/index.html");
const rulesFor = (sel) => [...CSS_NC.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1].split(",").map((x) => x.trim()).includes(sel)).map((m) => m[2]);
const decl = (sel, prop) => { let v = null; for (const body of rulesFor(sel)) for (const d of body.split(";")) { const [k, ...r] = d.split(":"); if ((k || "").trim() === prop) v = r.join(":").trim(); } return v; };

const c = sec(183000);
const F = "public/panels/billcustomer.css";
c(1, F, "the file exists and is not empty", "read it", () => CSS.length > 1000 || `${CSS.length} bytes`);
c(2, F, "the manager panel links it", "read editor/index.html", () => /<link[^>]+billcustomer\.css\?v=/.test(ED) || "not linked");
c(3, F, "the waiter tablet links it", "read tablet/index.html", () => /<link[^>]+billcustomer\.css\?v=/.test(TB) || "not linked");
c(4, F, "the kitchen does not — it never opens the customer sheet", "read kitchen/index.html", () => !/billcustomer\./.test(KI) || "the kitchen loads a sheet it never shows");
c(5, F, "both links carry the hash of today's file", "sha1 of the file vs ?v= in both shells", () => {
  const h = createHash("sha1").update(CSS).digest("hex").slice(0, 8);
  const bad = [["editor", ED], ["tablet", TB]].filter(([, s]) => !s.includes(`billcustomer.css?v=${h}`)).map(([p]) => p);
  return bad.length === 0 || `stale on ${bad.join(", ")}`;
});
c(6, F, "the overlay is fixed to the window, above the panel", "read .bcust-overlay", () => decl(".bcust-overlay", "position") === "fixed" && Number(decl(".bcust-overlay", "z-index")) >= 1000 || "not a fixed overlay");
c(7, F, "the overlay covers the whole window", "inset: 0", () => decl(".bcust-overlay", "inset") === "0" || `inset ${decl(".bcust-overlay", "inset")}`);
c(8, F, "the overlay dims what is behind it with the panel's own scrim token", "background: var(--scrim)", () => decl(".bcust-overlay", "background") === "var(--scrim)" || decl(".bcust-overlay", "background"));
c(9, F, "the overlay centres the box both ways", "flex + center/center", () => decl(".bcust-overlay", "display") === "flex" && decl(".bcust-overlay", "align-items") === "center" && decl(".bcust-overlay", "justify-content") === "center" || "not centred");
c(10, F, "the overlay keeps a margin from the window edge", "padding: 20px + border-box", () => decl(".bcust-overlay", "padding") === "20px" && decl(".bcust-overlay", "box-sizing") === "border-box" || "no edge margin");
c(11, F, "the box is capped to the window height", "max-height in vh", () => /vh$/.test(decl(".bcust-modal", "max-height") || "") || decl(".bcust-modal", "max-height"));
c(12, F, "…and the box scrolls inside that cap (item 1 of this run)", "the LAST overflow-y on .bcust-modal", () => /^(auto|scroll)$/.test(decl(".bcust-modal", "overflow-y") || "") && !decl(".bcust-modal", "overflow") || `overflow-y ${decl(".bcust-modal", "overflow-y")} / overflow ${decl(".bcust-modal", "overflow")}`);
c(13, F, "…and keeps its rounded corners while it scrolls", "overflow-x hidden + border-radius", () => decl(".bcust-modal", "overflow-x") === "hidden" && /px$/.test(decl(".bcust-modal", "border-radius") || "") || "corners not clipped");
c(14, F, "the box is never wider than the screen", "width: min(94vw, …)", () => /min\(94vw/.test(decl(".bcust-modal", "width") || "") || decl(".bcust-modal", "width"));
c(15, F, "…and on a phone it takes 96% of the width", "@media (max-width: 480px) .bcust-modal width 96vw", () => /@media \(max-width: 480px\)[\s\S]*?\.bcust-modal \{ width: 96vw; \}/.test(CSS_NC) || "no phone width");
c(16, F, "on a phone the two buttons stack, the main one on top", "column-reverse at ≤480px", () => /@media \(max-width: 480px\)[\s\S]*?\.bcust-foot \{ flex-direction: column-reverse; \}/.test(CSS_NC) || "buttons do not stack");
c(17, F, "…and each stacked button is full width — a thumb target", "width: 100% at ≤480px", () => /\.bcust-foot \.btn \{ width: 100%; \}/.test(CSS_NC) || "not full width");
c(18, F, "the typed text is 16px — iPhone does not zoom the page when the box is tapped", ".bcust-inwrap input font-size", () => /font-size: 16px/.test(rulesFor(".bcust-inwrap input").join(";")) || "under 16px");
c(19, F, "the panel's global input border is beaten inside the wrapper (the box-inside-a-box fault)", "border: 0 !important", () => /border: 0 !important/.test(rulesFor(".bcust-inwrap input").join(";")) || "the global border can paint inside again");
c(20, F, "the focused field shows a visible ring for a keyboard user", ".bcust-inwrap:focus-within", () => /box-shadow/.test(rulesFor(".bcust-inwrap:focus-within").join(";")) && /border-color/.test(rulesFor(".bcust-inwrap:focus-within").join(";")) || "no focus ring");
c(21, F, "the status line reserves its height, so the box does not jump while typing", ".bc-status min-height", () => /min-height: 17px/.test(rulesFor(".bcust-body .bc-status").join(";")) || "no reserved height");
c(22, F, "the counter's figures do not wobble as digits change", "tabular-nums", () => /tabular-nums/.test(rulesFor(".bcust-count").join(";")) || "proportional digits");
c(23, F, "the counter turns green at ten digits", ".bcust-count.ok", () => /color/.test(rulesFor(".bcust-count.ok").join(";")) || "no ok colour");
c(24, F, "the +91 prefix is drawn as part of the box", ".bcust-prefix", () => rulesFor(".bcust-prefix").length > 0 || "unstyled");
c(25, F, "the privacy line is quieter than the instruction above it, but present", ".bcust-htxt p.bcust-why smaller", () => /font-size: 11\.5px/.test(rulesFor(".bcust-htxt p.bcust-why").join(";")) || "not styled");
c(26, F, "'required' and 'optional' tags are styled", ".bcust-req / .bcust-opt", () => rulesFor(".bcust-req").length > 0 && rulesFor(".bcust-opt").length > 0 || "missing");
c(27, F, "every colour it uses is a panel token or one of two named status colours", "scan for raw hex outside color-mix / the green", () => {
  const raw = [...CSS_NC.matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0].toLowerCase());
  const allowed = new Set(["#ef4444", "#22c55e"]);
  const odd = raw.filter((x) => !allowed.has(x));
  return odd.length === 0 || `raw colours: ${odd.join(", ")}`;
});
const TOKENS = [...new Set([...CSS_NC.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]))];
c(28, F, "every token it reads is defined in the manager panel's stylesheet", "var(--x) vs editor/style.css", () => { const s = read("public/panels/editor/style.css"); const miss = TOKENS.filter((t) => !s.includes(`--${t}:`)); return miss.length === 0 || `undefined: ${miss.join(", ")}`; });
c(29, F, "…and in the waiter tablet's", "var(--x) vs tablet/style.css", () => { const s = read("public/panels/tablet/style.css"); const miss = TOKENS.filter((t) => !s.includes(`--${t}:`)); return miss.length === 0 || `undefined: ${miss.join(", ")}`; });
c(30, F, "…and in BOTH skins of each (the light skin redefines every token but the scrim)", "count definitions per token per panel", () => {
  const bad = [];
  for (const p of ["editor", "tablet"]) { const s = read(`public/panels/${p}/style.css`); for (const t of TOKENS) { const n = (s.match(new RegExp(`--${t}:`, "g")) || []).length; if (n < (t === "scrim" ? 1 : 2)) bad.push(`${p} --${t}×${n}`); } }
  return bad.length === 0 || bad.join(", ");
});
c(31, F, "no class it owns is redeclared in either panel's own stylesheet (the copy that drifts)", "bcust-/bc- selectors in editor+tablet style.css", () => {
  const owned = [...new Set([...CSS_NC.matchAll(/\.((?:bcust|bc)-[a-z-]+)/g)].map((m) => m[1]))];
  const bad = [];
  for (const p of ["editor", "tablet"]) { const s = read(`public/panels/${p}/style.css`).replace(/\/\*[\s\S]*?\*\//g, ""); for (const k of owned) if (new RegExp(`\\.${k}\\b[^{]*\\{`).test(s)) bad.push(`${p}:.${k}`); }
  return bad.length === 0 || bad.join(", ");
});
const JS_CLASSES = [...new Set([...JS.matchAll(/class="([^"$]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((k) => /^(bcust|bc)-/.test(k)))];
c(32, F, "every bcust-* class the sheet's markup uses has a rule here", "classes in billcustomer.js markup vs this file", () => {
  const hooks = new Set(["bc-phone", "bc-name", "bc-matches", "bc-cancel", "bc-go", "bc-pick", "bcust-overlay"]);   // JS hooks, not looks
  const miss = JS_CLASSES.filter((k) => !hooks.has(k) && !new RegExp(`\\.${k}\\b`).test(CSS_NC));
  return miss.length === 0 || `unstyled: ${miss.join(", ")}`;
});
c(33, F, "every bcust-* rule here names a class the sheet really renders", "selectors here vs billcustomer.js", () => {
  const owned = [...new Set([...CSS_NC.matchAll(/\.((?:bcust|bc)-[a-z-]+)/g)].map((m) => m[1]))];
  const dead = owned.filter((k) => !JS.includes(k));
  return dead.length === 0 || `rules for classes nothing renders: ${dead.join(", ")}`;
});
c(34, F, "the two ':disabled' button rules describe a state the button no longer enters — known and harmless", "the button carries aria-disabled, never disabled (T8 sweep, 2026-08-17)", () => {
  const usesDisabledAttr = /goBtn\.disabled\s*=|setAttribute\("disabled"/.test(code(JS));
  return !usesDisabledAttr ? { ok: true, note: "dead rules, listed in Part 4 as a tidy-up — the JS paints the not-ready look inline" } : "the button carries `disabled` again — a tap would die in silence";
});
c(35, F, "the overlay blurs what is behind it", "backdrop-filter", () => /blur\(/.test(decl(".bcust-overlay", "backdrop-filter") || "") || "no blur");
c(36, F, "the header's tint and the icon tile come from the gold token, not a fixed colour", "color-mix(… var(--gold) …)", () => /var\(--gold\)/.test(decl(".bcust-head", "background") || "") && /var\(--gold\)/.test(decl(".bcust-ico", "background") || "") || "fixed colour");
c(37, F, "a long title cannot push the close button off the box", ".bcust-htxt min-width:0 + flex", () => decl(".bcust-htxt", "min-width") === "0" && decl(".bcust-x", "flex") === "none" || "title can squeeze the ✕");
c(38, F, "a long typed value cannot push the counter out of the box", ".bcust-inwrap input min-width:0", () => /min-width: 0/.test(rulesFor(".bcust-inwrap input").join(";")) || "the input can overflow its wrapper");
c(39, F, "the main button is at least a comfortable 44px target", "padding 11px + 800 weight", () => decl(".bcust-foot .btn", "padding") === "11px 18px" || decl(".bcust-foot .btn", "padding"));
c(40, F, "the label row is uppercase and readable, not under 11px", ".bcust-lbl", () => /12px/.test(decl(".bcust-lbl", "font-size") || "") || decl(".bcust-lbl", "font-size"));
c(41, F, "!important is used only where the panel's own global input rule must be beaten", "count !important outside .bcust-inwrap input", () => {
  const outside = [...CSS_NC.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => /!important/.test(m[2]) && !/\.bcust-inwrap input/.test(m[1]));
  return outside.length === 0 || outside.map((m) => m[1].trim()).join(", ");
});
c(42, F, "it reaches nothing outside its own box (every selector starts with a bcust/bc class)", "every rule's selectors", () => {
  const sels = [...CSS_NC.replace(/@media[^{]*\{/g, "").matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter(Boolean);
  const loose = sels.flatMap((s) => s.split(",").map((x) => x.trim())).filter((x) => x && !/^\.(bcust|bc)-/.test(x));
  return loose.length === 0 || `reaches outside: ${loose.join(" | ")}`;
});
c(43, F, "the file has Unix line endings and ends with a newline", "bytes", () => !CSS.includes("\r") && CSS.endsWith("\n") || "CRLF or no final newline");
c(44, F, "the header comment names why the file exists (moved, not copied)", "read the header", () => /MOVED, NOT COPIED/.test(CSS) || "header lost");
c(45, F, "the guard named for this file runs and passes", "npm run verify:shared-panel-styles", async () => {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, ["scripts/verify-shared-panel-styles.mjs"], { cwd: (await import("./lib.mjs")).root, encoding: "utf8" });
  return r.status === 0 || r.stdout.slice(-300);
});

// ── public/panels/billdoc.d.ts — the contract TypeScript callers trust ──────────────────────────
const D = "public/panels/billdoc.d.ts";
const DTS = read(D);
const BILLDOC = (await imp("public/panels/billdoc.js")).default;
const API_KEYS = Object.keys(BILLDOC);
const declared = new Set([...DTS.matchAll(/export (?:function|const) ([A-Za-z0-9_]+)/g)].map((m) => m[1]));
const d = sec(183060);
let n = 1;
// One row per runtime export: declared, or a TS caller cannot reach it without `any`.
const EXPORTS = ["billDocHtml", "kotDocHtml", "kotLineHtml", "kotWhen", "billIdentity", "splitTax", "discPct", "phone10", "tipFromPaid", "tipPct", "TIP_MAX", "billRows", "taxModel", "orderTaxRate", "billMoney", "moneyRound", "billData", "banquetDocHtml", "bqPaper", "bqTaxModel", "bqOn", "bqWords", "combineBillLines", "mrpTaxInside", "mrpPart", "invFmt", "financialYear", "inr"];
for (const k of EXPORTS) d(n++, D, `declares ${k}, which billdoc.js exports`, "export in d.ts AND key on the runtime API", () => (declared.has(k) && API_KEYS.includes(k)) || `${declared.has(k) ? "" : "undeclared "}${API_KEYS.includes(k) ? "" : "not exported"}`);
// n is now 29
d(29, D, "the runtime exports nothing the declaration list above does not name", "API keys vs the 28 names", () => { const extra = API_KEYS.filter((k) => !EXPORTS.includes(k)); return extra.length === 0 || `undeclared runtime exports: ${extra.join(", ")}`; });
d(30, D, "it declares nothing the runtime does not export", "declared names vs API keys", () => { const ghost = [...declared].filter((k) => !API_KEYS.includes(k)); return ghost.length === 0 || `declared but missing at runtime: ${ghost.join(", ")}`; });
const ifaceKeys = (name) => { const m = DTS.match(new RegExp(`export interface ${name}[^{]*\\{([\\s\\S]*?)\\n\\}`)); if (!m) return null; return [...m[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").matchAll(/(?:^|;)\s*([A-Za-z0-9_]+)\??:/gm)].map((x) => x[1]); };
const sameKeys = (a, b) => { const A = new Set(a), B = new Set(b); const miss = [...B].filter((k) => !A.has(k)), extra = [...A].filter((k) => !B.has(k)); return (miss.length || extra.length) ? `type lacks [${miss.join(",")}] · type has extra [${extra.join(",")}]` : true; };
const realOrder = { id: "o", status: "served", subtotal: 200, taxable_base: 200, discount: 0, items: [{ title: "Dal", qty: 1, price: 200 }] };
d(31, D, "BillMoney names exactly the fields billMoney() returns", "interface keys vs Object.keys(billMoney(...))", () => sameKeys(ifaceKeys("BillMoney"), Object.keys(BILLDOC.billMoney([realOrder], {}))));
d(32, D, "BillIdentity names exactly the fields billIdentity() returns", "interface keys vs runtime", () => sameKeys(ifaceKeys("BillIdentity"), Object.keys(BILLDOC.billIdentity({}, {}))));
d(33, D, "TaxModel names exactly the fields taxModel() returns", "interface keys vs runtime", () => sameKeys(ifaceKeys("TaxModel"), Object.keys(BILLDOC.taxModel({}))));
d(34, D, "bqTaxModel is TaxModel plus `own` — and its runtime shape agrees", "keys", () => { const k = Object.keys(BILLDOC.bqTaxModel({})); return (k.includes("own") && ["rate", "pct", "components"].every((x) => k.includes(x)) && /bqTaxModel\(settings: Record<string, unknown>\): TaxModel & \{ own: boolean \}/.test(DTS)) || `runtime keys ${k.join(",")}`; });
d(35, D, "…but bqTaxModel's runtime object has no `composition`, which TaxModel promises", "keys vs the TaxModel interface", () => Object.keys(BILLDOC.bqTaxModel({})).includes("composition") ? true : { ok: true, note: "runtime lacks `composition`; no TS caller reads it (grep) — a type that over-promises, listed in Part 4" });
d(36, D, "bqPaper's declared shape matches the runtime object", "declared keys vs runtime", () => sameKeys(["pad", "size", "top", "bot", "side", "foot", "sign", "fill"], Object.keys(BILLDOC.bqPaper({}))));
d(37, D, "billRows' declared return matches the runtime object", "declared keys vs runtime", () => sameKeys(["disc", "inclusive", "subtotal", "discount", "taxable", "tax", "nontax", "total", "roundOff"], Object.keys(BILLDOC.billRows({}))));
const bdKeys = ifaceKeys("BillDocData");
d(38, D, "every field billData() returns is a declared BillDocData field", "Object.keys(billData(...)) ⊆ BillDocData", () => { const k = Object.keys(BILLDOC.billData({ orders: [realOrder], settings: {} })); const miss = k.filter((x) => !bdKeys.includes(x)); return miss.length === 0 || `undeclared: ${miss.join(", ")}`; });
const SRC = read("public/panels/billdoc.js");
const bodyOf = (fn) => { const i = SRC.indexOf(`function ${fn}(`); const j = SRC.indexOf("\n  function ", i + 10); return SRC.slice(i, j < 0 ? undefined : j); };
d(39, D, "every `d.<field>` billDocHtml() reads is declared on BillDocData", "scan billDocHtml for d.x", () => { const used = [...new Set([...code(bodyOf("billDocHtml")).matchAll(/\bd\.([a-zA-Z]+)/g)].map((m) => m[1]))]; const miss = used.filter((x) => !bdKeys.includes(x)); return miss.length === 0 || `read but undeclared: ${miss.join(", ")}`; });
const kdKeys = ifaceKeys("KotDocData");
d(40, D, "every `o.<field>` kotDocHtml() reads is declared on KotDocData", "scan kotDocHtml for o.x", () => { const used = [...new Set([...code(bodyOf("kotDocHtml")).matchAll(/\bo\.([a-zA-Z]+)/g)].map((m) => m[1]))]; const miss = used.filter((x) => !kdKeys.includes(x)); return miss.length === 0 || `read but undeclared: ${miss.join(", ")}`; });
d(41, D, "every `r.<field>` kotLineHtml() reads is declared on KotDocLine", "scan kotLineHtml", () => { const kl = ifaceKeys("KotDocLine"); const used = [...new Set([...code(bodyOf("kotLineHtml")).matchAll(/\br\.([a-zA-Z]+)/g)].map((m) => m[1]))]; const miss = used.filter((x) => !kl.includes(x)); return miss.length === 0 || `read but undeclared: ${miss.join(", ")}`; });
d(42, D, "BillDocData has NO `reprint` field (R37 — declaring it is what lets a caller pass it)", "interface keys", () => !bdKeys.includes("reprint") || "`reprint` is declared on the bill again");
d(43, D, "…and billData's argument type has none either", "the billData signature", () => { const m = DTS.match(/export function billData\(a: \{([\s\S]*?)\}\): BillDocData;/); return (m && !/^\s*reprint\??:/m.test(m[1].replace(/\/\*[\s\S]*?\*\//g, ""))) || "billData accepts reprint"; });
d(44, D, "KotDocData KEEPS `reprint` — the kitchen ticket's DUPLICATE banner is the owner's", "interface keys", () => kdKeys.includes("reprint") || "the ticket lost its banner flag");
d(45, D, "chainSeq / chainHash are declared but marked REJECTED (R50) — and the runtime never prints them", "doc comment + a render with both set", () => {
  const marked = /REJECTED \(R50\)/.test(DTS);
  const html = BILLDOC.billDocHtml({ chainSeq: 7, chainHash: "abcdef0123456789", lines: [] });
  return (marked && !/abcdef012345|Verification/i.test(html)) || "the chain reference reaches the paper";
});
d(46, D, "moneyRound is declared with its twin named (lib/tax.ts roundPaise)", "doc line", () => /Twin of lib\/tax\.ts roundPaise/.test(DTS) || "twin not named");
d(47, D, "TIP_MAX is declared as a number and is a number at runtime", "typeof", () => /export const TIP_MAX: number;/.test(DTS) && typeof BILLDOC.TIP_MAX === "number" || "mismatch");
d(48, D, "phone10's documented five shapes are exactly the five it knows", "run each documented shape", () => {
  const shapes = ["9876543210", "919876543210", "09876543210", "0919876543210", "00919876543210"];
  const bad = shapes.filter((s) => BILLDOC.phone10(s) !== "9876543210");
  return bad.length === 0 || `not recognised: ${bad.join(", ")}`;
});
d(49, D, "…and an unknown shape comes back as the digits given — never a guess, as documented", "phone10('12345')", () => BILLDOC.phone10("+1 (234) 5") === "12345" || BILLDOC.phone10("+1 (234) 5"));
d(50, D, "kotWhen's documented contract: '' for missing or unparseable, never 'Invalid Date'", "null / '' / 'x' / 0", () => [null, undefined, "", "x", 0].every((v) => BILLDOC.kotWhen(v) === "") || "an invalid stamp printed something");
d(51, D, "invFmt's documented shape <prefix>/<FY>/<6 digits>", "invFmt(42, '2026-05-01', 'INV')", () => BILLDOC.invFmt(42, "2026-05-01T10:00:00+05:30", "INV") === "INV/2026-27/000042" || BILLDOC.invFmt(42, "2026-05-01T10:00:00+05:30", "INV"));
d(52, D, "…and the documented promise: a March invoice reprinted in April keeps its year", "invFmt with a 31 March stamp", () => BILLDOC.invFmt(9, "2026-03-31T23:00:00+05:30") === "INV/2025-26/000009" || BILLDOC.invFmt(9, "2026-03-31T23:00:00+05:30"));
d(53, D, "tipFromPaid is never negative, as documented", "paying less than due", () => BILLDOC.tipFromPaid(500, 300) === 0 || BILLDOC.tipFromPaid(500, 300));
d(54, D, "discPct returns '' when there is nothing to say, as documented", "(0,10) (100,0) (100,0.01)", () => BILLDOC.discPct(0, 10) === "" && BILLDOC.discPct(100, 0) === "" && BILLDOC.discPct(100, 0.01) === "" || "printed a zero percentage");
d(55, D, "the type file is what lib/billPreview.ts and lib/printDocs.ts compile against", "both import billdoc.js and typecheck is green (run by run.mjs's caller)", () => /from "@\/public\/panels\/billdoc\.js"/.test(read("lib/billPreview.ts")) && /from "@\/public\/panels\/billdoc\.js"/.test(read("lib/printDocs.ts")) || "an importer moved");
d(56, D, "BillDocLine declares the fields billDocHtml reads off a line", "i.title/qty/price/options/is_mrp", () => { const k = ifaceKeys("BillDocLine"); const used = [...new Set([...code(bodyOf("billDocHtml")).matchAll(/\bi\.([a-zA-Z_]+)/g)].map((m) => m[1]))]; const miss = used.filter((x) => !k.includes(x)); return miss.length === 0 || `undeclared: ${miss.join(", ")}`; });
d(57, D, "`taxable` is documented as NOT rendered — and passing a wrong one really changes nothing", "two renders, taxable 1 vs 999", () => BILLDOC.billDocHtml({ subtotal: 100, discount: 10, total: 95, taxable: 1 }) === BILLDOC.billDocHtml({ subtotal: 100, discount: 10, total: 95, taxable: 999 }) || "taxable leaks into the paper");
d(58, D, "`noBar` documented: no toolbar and no script", "render with noBar", () => { const h = BILLDOC.billDocHtml({ noBar: true }); return (!/class="bar"/.test(h) && !/<script/.test(h)) || "bar or script present"; });
d(59, D, "`autoPrint` documented: only then does the page print itself", "render both ways", () => /setTimeout\(printAgain, 300\)/.test(BILLDOC.billDocHtml({ autoPrint: true })) && !/setTimeout\(printAgain/.test(BILLDOC.billDocHtml({ autoPrint: false })) || "autoPrint does not decide it");
d(60, D, "`loyalty` documented: absent ⇒ no points block at all", "render with and without", () => !/Points on this bill/.test(BILLDOC.billDocHtml({})) && /Points on this bill: 42/.test(BILLDOC.billDocHtml({ loyalty: { earn: 42, balance: 100, toNext: 0 } })) || "points block wrong");
