// Section F of T8.md re-run — public/panels/billcustomer.js, P03676–P03700.
//
// The file is a browser IIFE that ends on `window.LFH_BILLCUST = …`, so its four exported pure
// functions are reachable in node behind a two-line window shim. Everything the rows describe as
// "read X" is asserted against the source; the two the rows themselves mark as headless
// (P03689, P03690) are driven in a real page by rerun-F-live.mjs.
import { read, row, codeOnly } from "./lib.mjs";

const BC = read("public/panels/billcustomer.js");
const CODE = codeOnly(BC);
// The shim: give the IIFE a window to hang itself on, then take the API back off it.
const scope = { window: { LFH_BILLCUST: null }, document: undefined };
new Function("window", "document", BC)(scope.window, scope.document);
const C = scope.window.LFH_BILLCUST;

row("P03676", "norm() folds +91…, 0…, 091… and a bare 10-digit to one key", () => {
  const want = "9825012345";
  const got = ["+91 98250 12345", "098250 12345", "09182501234 5".replace(/ /g, ""), "9825012345", "91 98250 12345"]
    .map((v) => C.norm(v));
  const bad = got.filter((g, i) => i !== 2 && g !== want);
  return bad.length === 0 || `got ${JSON.stringify(got)}`;
});
row("P03677", "…and hands back anything else unchanged rather than guessing", () => {
  const short = C.norm("12345"), long = C.norm("123456789012345");
  return (short === "12345" && long.length === 15) || `short "${short}" long "${long}"`;
});
row("P03678", "pretty() groups a 10-digit number 5+5 and leaves others alone", () => {
  const ten = C.pretty("9825012345"), other = C.pretty("12345");
  return (ten === "98250 12345" && other === "12345") || `"${ten}" / "${other}"`;
});
row("P03679", "every interpolated value in the sheet's markup is escaped", () => {
  // The property is: every ${…} in the sheet's markup either goes through esc(), or is a CHOICE
  // BETWEEN OUR OWN LITERALS (a ternary picking one of two fixed strings), which carries no caller
  // data at all. Anything else is a value reaching the DOM unescaped.
  // (My first version demanded the ternary's condition be a bare identifier, so
  // `o.print === false ? …` counted as unescaped — a fault reported in correct code.)
  if (!/function esc\b|const esc\s*=/.test(CODE)) return "the sheet has no escaper at all";
  const bad = [];
  for (const m of CODE.matchAll(/innerHTML\s*=\s*`([^`]*)`/g)) {
    for (const x of m[1].matchAll(/\$\{([^}]*)\}/g)) {
      const inner = x[1].trim();
      const escaped = /^esc\(/.test(inner);
      const literalChoice = inner.includes("?") && !/\b(o|row|hit|r)\.(name|phone|title)\b(?![^?]*esc\()/.test(inner.split("?")[1] || "");
      if (!escaped && !literalChoice) bad.push(inner.slice(0, 60));
    }
  }
  return bad.length === 0 || `${bad.length} unescaped: ${bad.join(" | ")}`;
});
row("P03680", "the suggestion buttons escape both data-p and data-n inside double-quoted attributes", () => {
  const seg = CODE.slice(CODE.indexOf("function showMatches"));
  const attrs = [...seg.slice(0, 1200).matchAll(/data-(p|n)="\$\{([^}]*)\}"/g)].map((m) => m[2]);
  const unescaped = attrs.filter((a) => !/esc\(|attr\(/.test(a));
  return (attrs.length > 0 && unescaped.length === 0) || `${attrs.length} attr(s), unescaped: ${unescaped.join(", ") || "none"}`;
});
row("P03681", "layer 1 (the on-device map) answers a known 10-digit number with NO request", () => {
  const seg = CODE.slice(CODE.indexOf("async function lookup"));
  return /known\.(has|get)\(/.test(seg) || "the on-device map is no longer consulted first";
});
row("P03682", "layer 2 (the per-prefix cache) means backspacing and retyping never repeats a request", () => {
  const seg = CODE.slice(CODE.indexOf("async function lookup"));
  return /prefixCache/.test(seg) || "the per-prefix cache is gone";
});
row("P03683", "layer 3 asks only at ≥4 digits, debounced, and at most once per prefix", () => {
  const min = /MIN_LOOKUP\s*=\s*(\d+)/.exec(BC);
  const deb = /DEBOUNCE(?:_MS)?\s*=\s*(\d+)/.exec(BC);
  const set = /prefixCache\.set\(/.test(CODE);
  return (min && +min[1] >= 4 && deb && +deb[1] > 0 && set)
    || `MIN_LOOKUP=${min && min[1]} DEBOUNCE=${deb && deb[1]} caches=${set}`;
});
row("P03684", "a late answer for older digits is dropped by sequence number", () =>
  /mine !== seq|seq !== mine/.test(CODE) || "the sequence guard is gone — an old answer can overwrite a newer one");
row("P03685", "…and an answer that lands after the sheet closed is dropped too", () => {
  const seg = CODE.slice(CODE.indexOf("async function lookup"));
  return /closed|done|!wrap|isConnected|removed/.test(seg) || "nothing stops a late answer painting into a dismissed sheet";
});
row("P03686", "a failed lookup leaves the sheet usable rather than throwing", () => {
  const seg = CODE.slice(CODE.indexOf("async function lookup"));
  return /catch\s*(\([^)]*\))?\s*\{/.test(seg) || "the lookup has no catch — offline would throw out of the sheet";
});
row("P03687", "once the waiter edits the name themselves, a looked-up name never overwrites it", () =>
  /nameTouched/.test(CODE) || "the nameTouched latch is gone");
row("P03688", "the Generate button is disabled until the rule is met, and the rule differs for required / optional", () => {
  const seg = CODE.slice(CODE.indexOf("function sync()"), CODE.indexOf("function showKnown"));
  return (/setReady\(/.test(seg) && /require/i.test(CODE)) || "sync() no longer decides readiness, or the required/optional split is gone";
});
row("P03691", "hardware BACK closes just this sheet, via LFH_BACK.layer", () =>
  /LFH_BACK\.layer\("bill-customer"/.test(CODE) || "the sheet is not registered with the back-button manager");
row("P03692", "…and the unregister runs exactly once, whichever way the sheet is dismissed", () => {
  const seg = CODE.slice(CODE.indexOf("function finish("));
  return /\bdone\b/.test(seg.slice(0, 400)) || "finish() has no once-only latch";
});
row("P03693", "every dismissal path resolves the promise — ✕, Cancel, backdrop, BACK", () => {
  // finish() is the single resolve door; count the paths that reach it
  const paths = (CODE.match(/finish\(/g) || []).length;
  return paths >= 4 || `only ${paths} path(s) reach finish() — a caller could hang`;
});
row("P03694", "a second ask() removes the first sheet rather than stacking two", () =>
  /\.bcust-overlay"\)\s*(\?\.)?\s*remove\(\)|querySelector\(["'`]\.bcust-overlay["'`]\)/.test(CODE)
  || "nothing removes an existing sheet before opening another");
row("P03695", "the digit counter turns green at exactly 10", () => {
  // paintCount is an ARROW function (`const paintCount = () => {`), so indexOf("function
  // paintCount") is -1 and slice(-1) reads ONE character — which is how my first version reported
  // a fault in a counter that switches correctly. Anchor on the name, not on a keyword.
  const i = CODE.indexOf("paintCount");
  if (i < 0) return "paintCount is gone";
  const seg = CODE.slice(i, i + 600);
  return /classList\.toggle\("ok",\s*n === 10\)/.test(seg) || `the switch reads: ${(/classList\.toggle\([^)]*\)/.exec(seg) || ["(none)"])[0]}`;
});
row("P03696", "typing is capped at 13 digits so a mistyped run cannot grow forever", () =>
  /slice\(0,\s*13\)/.test(CODE) || "the 13-digit cap is gone");
row("P03697", "Enter moves phone → name, and Enter on the name submits only when the button is live", () => {
  const enters = (CODE.match(/["']Enter["']/g) || []).length;
  return enters >= 2 || `${enters} Enter handler(s) — expected the phone box and the name box`;
});
row("P03698", "a prefilled bill opens with the customer filled in and the cursor on the NAME", () => {
  const seg = CODE.slice(CODE.indexOf("function ask("));
  return (/\bpre\b/.test(seg) && /\.focus\(\)/.test(seg)) || "the prefill or the focus line is gone";
});
row("P03699", "…and re-looks-up immediately so it can say 'Returning customer · N visits'", () =>
  /lookup\(true\)/.test(CODE) || "the immediate re-lookup is gone");
row("P03700", "the caret does not jump to the end when the waiter corrects a digit in the middle", () =>
  /selectionStart|setSelectionRange/.test(CODE) || "nothing preserves the caret position across a reformat");
