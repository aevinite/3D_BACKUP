// Family D — CAN A PERSON ACTUALLY USE IT? Every pop-up the shared helpers build, opened for real on a
// phone (Chromium and WebKit, touch on) and on a desktop, then judged on what a person meets:
//   1. every button and field has a NAME a screen reader can say (text, aria-label, title, label or
//      placeholder) with at least one letter in it — "✕" alone is not a name; an unnamed control is a
//      silent square to a blind waiter;
//   2. every tap target is at least 24×24 px (WCAG 2.2 AA, 2.5.8) — the ones under 40 px are listed in
//      the note for information, not failed: 40 is a comfort target, 24 is the standard;
//   3. nothing of it hangs off the side of the screen;
//   4. the phone's BACK button closes it (the app's own rule — never leave the panel by accident).
import { C, ok } from "./lib.mjs";
import { page, open, setApi, sleep } from "./server.mjs";

const VIEWS = [
  { tag: "phone (chromium)", engine: "chromium", viewport: { width: 390, height: 800 }, touch: true },
  { tag: "phone (webkit)", engine: "webkit", viewport: { width: 390, height: 800 }, touch: true },
  { tag: "desktop", engine: "chromium", viewport: { width: 1280, height: 860 } },
];
export const PROFILE = { staff: true, id: "u1", name: "Asha Rao", username: "asha", phone: "9800000000", role: "manager", hasPin: true, canSelfReset: true, canSelfSetPin: true,
  profileModule: true, canSeeOwnPay: true, job: "Floor manager", profile: {}, pay: { pay_type: "monthly", pay_amount: 21000, pay_extras: [] }, payments: [], paySummary: null, completeness: 100 };
setApi(() => ({ status: 200, body: {} }));
export const api = (r) => (r.path.startsWith("/api/panel-profile") ? { status: 200, body: PROFILE } : r.path.startsWith("/api/rt-config") ? { status: 404, body: {} } : { status: 200, body: { ok: true } });

export const TOP = '<div class="topbar"><b>Panel</b><div class="top-actions"></div></div><main style="padding:16px">Board</main>';
export const W = [
  { name: "the undo card", scripts: ["undobar.js"], back: false, sel: "#lfh-undobar",
    open: () => window.LFH_UNDO.show({ message: "Served Paneer Tikka", seconds: 5 }) },
  { name: "the offline details sheet", scripts: ["backstack.js", "offline.js"], sel: ".lfh-offsheet, [class*=lfh-off]:not(.lfh-offbar)",
    open: () => window.LFH_OFF.open() },
  { name: "the Connection panel", scripts: ["backstack.js", "connbadge.js"], sel: ".lfh-conn-pop",
    open: () => document.getElementById("lfhConnBadge").click() },
  { name: "the guest-requests sheet", scripts: ["backstack.js", "guestbell.js"], sel: "[class*=bell-sheet], [class*=lfhgb-sheet], [class*=gb-sheet]",
    open: () => { window.LFH_BELL.sync({ menuOn: true, rows: [{ id: "a", kind: "call", table: "4", at: Date.now(), label: "Table 4 calls a waiter" }] }); window.LFH_BELL.open(); } },
  { name: "Report an issue", scripts: ["backstack.js", "issue-raise.js"], sel: ".lfhir-ov",
    open: () => window.LFH_ISSUE.open({ api: async () => ({ ok: true }) }) },
  { name: "My profile & pay", scripts: ["backstack.js", "maint.js", "myprofile.js"], sel: ".me-wrap",
    open: () => window.LFH_ME.open() },
  { name: "the Settings drawer", scripts: ["backstack.js", "maint.js"], sel: ".lfh-ov",
    open: () => document.getElementById("staffSettingsBtn").click() },
];

for (const w of W) {
  const P = page("d-" + w.name.replace(/\W+/g, "-"), { body: TOP, scripts: w.scripts });
  for (const v of VIEWS) C("D", w.scripts[w.scripts.length - 1], `${v.tag}: ${w.name} — every control named, every target ≥ 24 px, nothing off-screen${w.back === false ? "" : ", Back closes it"}`, async () => {
    setApi(api);
    const h = await open(P, v); const p = h.page;
    await sleep(350);
    await p.evaluate(`(${w.open})()`);
    await sleep(700);
    const r = await p.evaluate((sel) => {
      const root = document.querySelector(sel.split(",").map((s) => s.trim()).find((s) => document.querySelector(s)) || "#__none");
      if (!root) return { missing: true };
      const vw = innerWidth, vis = (e) => { const b = e.getBoundingClientRect(), cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
      const nameOf = (e) => (e.getAttribute("aria-label") || e.getAttribute("title") || (e.labels && e.labels[0] && e.labels[0].textContent) || e.getAttribute("placeholder") || (e.getAttribute("aria-labelledby") && (document.getElementById(e.getAttribute("aria-labelledby")) || {}).textContent) || e.textContent || e.value || "").trim();
      const ctl = [...root.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button]")].filter(vis);
      // A name needs a LETTER: "✕" or "👤" alone is read aloud as a symbol name, or as nothing.
      const unnamed = ctl.filter((e) => !/\p{L}/u.test(nameOf(e)) && !(e.type === "file")).map((e) => e.outerHTML.slice(0, 90));
      const tiny = [], small = [];
      for (const e of ctl) { if (e.type === "file") continue; const b = e.getBoundingClientRect(); const t = `${(nameOf(e) || e.tagName).slice(0, 18)} ${Math.round(b.width)}×${Math.round(b.height)}`; if (b.width < 24 || b.height < 24) tiny.push(t); else if (b.width < 40 || b.height < 40) small.push(t); }
      const off = [...root.querySelectorAll("*")].concat([root]).filter(vis).filter((e) => { const b = e.getBoundingClientRect(); return b.right > vw + 1 || b.left < -1; }).filter((e) => { let a = e.parentElement; while (a && a !== root.parentElement) { const ox = getComputedStyle(a).overflowX; if (ox === "auto" || ox === "scroll" || ox === "hidden") return false; a = a.parentElement; } return true; }).map((e) => `${e.tagName}.${e.className}`.slice(0, 50));
      return { controls: ctl.length, unnamed, tiny, small, off: off.slice(0, 5) };
    }, w.sel);
    let closed = null;
    if (w.back !== false && !r.missing) {
      await p.evaluate(() => history.back()); await sleep(700);
      closed = await p.evaluate((sel) => { const e = sel.split(",").map((s) => document.querySelector(s.trim())).find(Boolean); if (!e) return true; const b = e.getBoundingClientRect(), cs = getComputedStyle(e); return cs.display === "none" || cs.visibility === "hidden" || b.height === 0 || e.hidden || !!e.closest("[hidden]") || cs.opacity === "0" || !e.isConnected; }, w.sel);
    }
    const errors = h.errors.slice();
    await h.close();
    if (r.missing) return ok(false, `${w.name} did not open (no ${w.sel})${errors.length ? " · page threw " + errors[0] : ""}`);
    const problems = [];
    if (r.unnamed.length) problems.push("unnamed: " + r.unnamed.join(" | "));
    if (r.tiny.length) problems.push("under 24px: " + r.tiny.join(", "));
    if (r.off.length) problems.push("off-screen: " + r.off.join(", "));
    if (closed === false) problems.push("Back did not close it");
    if (errors.length) problems.push("page threw: " + errors[0]);
    return ok(!problems.length, problems.join(" · ") || `${r.controls} controls${r.small.length ? ` · under 40px (information): ${r.small.join(", ")}` : ""}`);
  });
}
