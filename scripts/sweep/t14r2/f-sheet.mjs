// Round 2 · bank F — "WHO IS THIS BILL FOR?" DRIVEN IN TWO BROWSER ENGINES (P214301–P214360).
// Chrome's engine (Android tablets, the manager's PC) and Safari's (WebKit — every iPad and iPhone). The
// sheet's own script + stylesheet + billdoc.js in a bare page; the network is a stand-in that records what
// was asked. Nothing is sent anywhere and nothing is written. (Firefox is not installed on this Mac.)
import { sec, read, root, onDone } from "../t14s10/lib.mjs";
import { join } from "node:path";

const F = "public/panels/billcustomer.js";
const f = sec(214300);
const PW = await import(join(root, "node_modules/playwright/index.mjs"));
const browsers = {};
async function page(engine, vp = { width: 390, height: 844 }) {
  if (!browsers[engine]) { browsers[engine] = await PW[engine].launch(); onDone(() => browsers[engine].close()); }
  const p = await browsers[engine].newPage({ viewport: vp });
  await p.setContent(`<!doctype html><html><head><style>:root{--scrim:rgba(0,0,0,.5);--panel:#fff;--panel-2:#f5f5f5;--line:#ddd;--gold:#c8a165;--muted:#555;--text:#111}</style><style>${read("public/panels/billcustomer.css")}</style></head><body></body></html>`);
  await p.evaluate(() => { window.__layers = []; window.LFH_BACK = { layer: (n, c) => { window.__layers.push({ n, c }); return () => { window.__layers = window.__layers.filter((l) => l.c !== c); }; } }; });
  await p.addScriptTag({ content: read("public/panels/billcustomer.js") });
  await p.addScriptTag({ content: read("public/panels/billdoc.js") });
  return p;
}
async function open(p, { reply = "() => ({ matches: [], whole: true })", opts = "{ api: window.__api, required: true }" } = {}) {
  await p.evaluate(`(() => { window.__asked = []; window.__reply = ${reply}; window.__api = async (m, path) => { window.__asked.push(path); await new Promise((r) => setTimeout(r, 25)); return window.__reply(path); }; window.__res = "pending"; LFH_BILLCUST.ask(${opts}).then((v) => { window.__res = v; }); })()`);
  await p.waitForTimeout(90);
}
const typeIn = async (p, sel, v) => p.evaluate(([s, val]) => { const el = document.querySelector(s); el.value = val; el.dispatchEvent(new Event("input", { bubbles: true })); }, [sel, v]);
const typeDigits = async (p, d) => { for (let i = 1; i <= d.length; i++) await typeIn(p, ".bc-phone", d.slice(0, i)); };
const val = (p, fn) => p.evaluate(fn);
const tap = (p, sel) => p.evaluate((s) => document.querySelector(s).click(), sel);   // a real click event, like a tap
const KNOWN = `() => ({ matches: [{ phone: "9825012345", name: "Riya Sharma", visits: 3 }, { phone: "9825012399", name: "Amit", visits: 1 }], whole: true })`;

const FLOWS = [
  ["opens one sheet with one back-button layer", async (p) => { await open(p); return val(p, () => document.querySelectorAll(".bcust-overlay").length === 1 && window.__layers.length === 1); }],
  ["Generate on an empty sheet refuses, names the number box and focuses it", async (p) => { await open(p); await tap(p, ".bc-go"); return val(p, () => document.querySelector(".bc-status").textContent === "Enter the full 10-digit mobile number" && document.activeElement === document.querySelector(".bc-phone") && window.__res === "pending"); }],
  ["no request below six digits", async (p) => { await open(p); await typeDigits(p, "98250"); await p.waitForTimeout(300); return val(p, () => window.__asked.length === 0); }],
  ["one request at six digits", async (p) => { await open(p, { reply: KNOWN }); await typeDigits(p, "982501"); await p.waitForTimeout(400); return val(p, () => window.__asked.length === 1); }],
  ["digits seven to ten cost no request (narrowed on the device)", async (p) => { await open(p, { reply: KNOWN }); await typeDigits(p, "9825012345"); await p.waitForTimeout(500); return val(p, () => window.__asked.length === 1); }],
  ["a known number fills the name and says Returning customer · 3 visits", async (p) => { await open(p, { reply: KNOWN }); await typeDigits(p, "9825012345"); await p.waitForTimeout(500); return val(p, () => document.querySelector(".bc-name").value === "Riya Sharma" && /Returning customer · 3 visits/.test(document.querySelector(".bc-status").textContent)); }],
  ["an unknown number says New customer", async (p) => { await open(p); await typeDigits(p, "9000000011"); await p.waitForTimeout(400); return val(p, () => document.querySelector(".bc-status").textContent === "New customer"); }],
  ["the counter reads 10/10 and turns green on a full number", async (p) => { await open(p); await typeDigits(p, "9000000012"); return val(p, () => document.querySelector(".bcust-count").textContent === "10/10" && document.querySelector(".bcust-count").classList.contains("ok")); }],
  ["the box formats as 98250 12345", async (p) => { await open(p); await typeIn(p, ".bc-phone", "9825012345"); return val(p, () => document.querySelector(".bc-phone").value === "98250 12345"); }],
  ["the international form 0091… fits whole and counts 10/10", async (p) => { await open(p); await typeIn(p, ".bc-phone", "00919825012345"); return val(p, () => document.querySelector(".bc-phone").value.replace(/\D/g, "").length === 14 && document.querySelector(".bcust-count").textContent === "10/10"); }],
  ["a 15th digit is refused", async (p) => { await open(p); await typeIn(p, ".bc-phone", "009198250123456"); return val(p, () => document.querySelector(".bc-phone").value.replace(/\D/g, "").length === 14); }],
  ["a number with no name: Generate names the name box", async (p) => { await open(p); await typeDigits(p, "9000000013"); await p.waitForTimeout(300); await tap(p, ".bc-go"); return val(p, () => document.querySelector(".bc-status").textContent === "Enter the customer's name" && document.activeElement === document.querySelector(".bc-name")); }],
  ["a late lookup never paints over that refusal", async (p) => { await open(p, { reply: "async () => { await new Promise((r) => setTimeout(r, 250)); return { matches: [], whole: true }; }" }); await typeDigits(p, "9000000014"); await tap(p, ".bc-go"); await p.waitForTimeout(600); return val(p, () => document.querySelector(".bc-status").textContent === "Enter the customer's name"); }],
  ["Generate hands back the ten digits and the trimmed name, and the sheet is gone", async (p) => { await open(p); await typeDigits(p, "919000000015"); await typeIn(p, ".bc-name", "  Meera  "); await tap(p, ".bc-go"); await p.waitForTimeout(40); return val(p, () => window.__res && window.__res.phone === "9000000015" && window.__res.name === "Meera" && !document.querySelector(".bcust-overlay") && window.__layers.length === 0); }],
  ["Cancel closes with no answer", async (p) => { await open(p); await tap(p, ".bc-cancel"); await p.waitForTimeout(30); return val(p, () => window.__res === null && !document.querySelector(".bcust-overlay")); }],
  ["the ✕ closes with no answer", async (p) => { await open(p); await tap(p, ".bcust-x"); await p.waitForTimeout(30); return val(p, () => window.__res === null); }],
  ["a tap on the dimmed backdrop closes with no answer", async (p) => { await open(p); await p.evaluate(() => { const w = document.querySelector(".bcust-overlay"); w.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await p.waitForTimeout(30); return val(p, () => window.__res === null); }],
  ["the back button closes with no answer", async (p) => { await open(p); await p.evaluate(() => window.__layers[0].c()); await p.waitForTimeout(30); return val(p, () => window.__res === null && window.__layers.length === 0); }],
  ["Esc closes with no answer, and the page beneath never sees it (item 8)", async (p) => { await open(p); await p.evaluate(() => { window.__outer = 0; document.addEventListener("keydown", (e) => { if (e.key === "Escape") window.__outer++; }); }); await p.focus(".bc-phone"); await p.keyboard.press("Escape"); await p.waitForTimeout(30); return val(p, () => window.__res === null && window.__outer === 0); }],
  ["keyboard only: Enter moves to the name, Enter again generates", async (p) => { await open(p); await p.focus(".bc-phone"); await p.keyboard.type("9000000016"); await p.keyboard.press("Enter"); const onName = await val(p, () => document.activeElement === document.querySelector(".bc-name")); await p.keyboard.type("Kbd"); await p.keyboard.press("Enter"); await p.waitForTimeout(30); return onName && val(p, () => window.__res && window.__res.name === "Kbd"); }],
  ["no network: the waiter still types the name and generates", async (p) => { await open(p, { reply: "() => { throw new Error('offline'); }" }); await typeDigits(p, "9000000017"); await p.waitForTimeout(300); await typeIn(p, ".bc-name", "Walk-in"); await tap(p, ".bc-go"); await p.waitForTimeout(30); return val(p, () => window.__res && window.__res.name === "Walk-in"); }],
  ["a reopened bill opens filled in, green, with the cursor in the name", async (p) => { await open(p, { opts: `{ api: window.__api, required: true, prefill: { phone: "919825012345", name: "Riya" } }` }); await p.waitForTimeout(120); return val(p, () => document.querySelector(".bc-phone").value === "98250 12345" && document.querySelector(".bc-name").value === "Riya" && document.querySelector(".bcust-count").textContent === "10/10" && document.activeElement === document.querySelector(".bc-name")); }],
  ["a suggestion is a 44px target and fills both boxes when tapped", async (p) => { await open(p, { reply: KNOWN }); await typeDigits(p, "982501"); await p.waitForTimeout(450); const ok = await val(p, () => [...document.querySelectorAll(".bc-pick")].every((b) => b.getBoundingClientRect().height >= 44)); await p.evaluate(() => document.querySelector(".bc-pick").click()); await p.waitForTimeout(60); return ok && val(p, () => document.querySelector(".bc-phone").value.replace(/\D/g, "").length === 10 && document.querySelector(".bc-name").value.length > 0); }],
  ["with Loyalty off the sheet says nothing about rewards; on, it does (item 6)", async (p) => { await open(p); const off = await val(p, () => !/rewarded/.test(document.querySelector(".bcust-why").textContent)); await tap(p, ".bc-cancel"); await open(p, { opts: "{ api: window.__api, required: true, loyalty: true }" }); return off && val(p, () => /rewarded later/.test(document.querySelector(".bcust-why").textContent)); }],
  ["a name holding markup shows as text in the suggestions", async (p) => { await open(p, { reply: `() => ({ matches: [{ phone: "9825012300", name: "<img src=x>" }], whole: true })` }); await typeDigits(p, "982501"); await p.waitForTimeout(450); return val(p, () => { const b = document.querySelector(".bc-pick"); return !!b && b.textContent.includes("<img src=x>") && !b.querySelector("img"); }); }],
];
let n = 1;
for (const engine of ["chromium", "webkit"]) for (const [what, fn] of FLOWS) {
  const id = n++;
  f(id, F, `${engine === "webkit" ? "Safari's engine" : "Chrome's engine"}: ${what}`, `driven in ${engine}, a fresh page`, async () => { const p = await page(engine); try { return (await fn(p)) === true || "did not hold"; } finally { await p.close(); } });
}
// n = 51 — the sheet's size in Safari's engine on the screens a restaurant uses
for (const [label, w, h] of [["iPhone 390×844", 390, 844], ["iPhone sideways 844×390", 844, 390], ["iPad 820×1180", 820, 1180], ["iPad sideways 1180×820", 1180, 820], ["small phone 320×568", 320, 568]]) {
  const id = n++;
  f(id, "public/panels/billcustomer.css", `Safari's engine at ${label}: the sheet fits the screen and Cancel + Generate bill can be scrolled to`, "four suggestions showing, scrolled to the end, measured", async () => {
    const p = await page("webkit", { width: w, height: h });
    try {
      await open(p, { reply: `() => ({ matches: [1,2,3,4].map((i) => ({ phone: "982501111" + i, name: "Guest " + i })), whole: true })` });
      await typeDigits(p, "982501"); await p.waitForTimeout(450);
      return (await p.evaluate(() => { const m = document.querySelector(".bcust-modal"); m.scrollTop = 1e5; const r = m.getBoundingClientRect(), g = document.querySelector(".bc-go").getBoundingClientRect(), c = document.querySelector(".bc-cancel").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5 && g.bottom <= r.bottom + 1 && c.bottom <= r.bottom + 1; })) || "cut off";
    } finally { await p.close(); }
  });
}
