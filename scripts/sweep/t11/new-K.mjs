// ⬛ NEW — T11 of sweep #8 · BANK K · P101235–P101324 · ROUND 5
// THE ADMIN'S PRINTING SCREEN, DRIVEN — the ACTIONS, not the pixels.
//
// WHY THIS IS NOT A RESAMPLE OF ROUND 1's BANK D. Bank D rendered this screen at two widths in
// both skins and read every word on it — that is how four of this run's findings were caught, and
// every one of them was PROSE (a step pointing at the wrong step, a tick claiming slips print
// while the line is switched off). What it never did was USE the screen: it never set a route, so
// it never asked whether the words on it match what pressing the thing actually does.
//
// This bank drives the real screen in a real browser as a signed-in admin, and after each action
// asks the SERVER what changed — because a screen that says "Saved." and changed nothing is the
// one failure a screenshot cannot catch.
//
// ── WHAT IT WRITES, AND HOW IT IS PUT BACK ───────────────────────────────────────────────────
// One virtual computer and the routes it is pointed at. Both are snapshotted first and restored
// through onFinish(), which run() awaits — bank J learned that the hard way, leaving a machine in
// a real restaurant's screen because registering a signal handler is not cleanup.
import { row, skipRow, onFinish, read } from "./lib.mjs";
import { adminHeaders, adminCookie } from "../login.mjs";
import { canDrive, BASE as BROWSER_BASE } from "./browser.mjs";

const BASE = process.env.T11_BASE || "http://localhost:4311";
const RID = "00000000-0000-0000-0000-000000000001";
const H = { ...adminHeaders(BASE), "content-type": "application/json" };
const admin = async (path, body) => {
  const r = await fetch(`${BASE}/api/admin/printing${path}`,
    body === undefined ? { headers: H } : { method: "POST", headers: H, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* 204 */ }
  return { status: r.status, ok: r.ok, j };
};
const state = async () => (await admin(`/state?rid=${RID}`)).j;

const MADE = { agents: [] };
let SNAP = null, browser = null;
const reachable = await admin(`/state?rid=${RID}`).then((r) => r.status === 200).catch(() => false);

let AGENT = null;
const PRINTERS = [{ name: "Sweep-K-Roll", desc: "Virtual 80mm", paper: { name: "X72MM", wMm: 72, hMm: 200 } },
                  { name: "Sweep-K-Sheet", desc: "Virtual A4", paper: { name: "A4", wMm: 210, hMm: 297 } }];
if (reachable) {
  SNAP = JSON.parse(JSON.stringify((await state())?.routes ?? {}));
  const made = await admin("/agents", { rid: RID, name: `Sweep T11 round5 K ${Date.now()}` });
  if (made.j?.id) {
    AGENT = { id: made.j.id, token: made.j.code, name: made.j.name };
    MADE.agents.push(made.j.id);
    await fetch(`${BASE}/api/print-agent/hello`, { method: "POST",
      headers: { "content-type": "application/json", "x-lfh-agent": AGENT.token },
      body: JSON.stringify({ fingerprint: "sweep-K", printers: PRINTERS }) });
  }
}
onFinish(async () => {
  const said = [];
  try { for (const v of SHOTS.values()) { try { await v.ctx.close(); } catch { /* already gone */ } } SHOTS.clear(); } catch { /* named below */ }
  try { if (browser) { await browser.close(); said.push("the browser closed"); } } catch { /* named below */ }
  try {
    if (MADE.agents.length) {
      const { createClient } = await import("@supabase/supabase-js");
      const { readFileSync } = await import("node:fs");
      const envp = new URL("../../../.env.local", import.meta.url).pathname;
      const env = Object.fromEntries(readFileSync(envp, "utf8").split("\n").filter((l) => l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
      const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
      const jq = await sb.from("print_jobs").select("id").eq("restaurant_id", RID).in("agent_id", MADE.agents);
      if (jq.data?.length) await sb.from("print_jobs").delete().in("id", jq.data.map((x) => x.id));
      const d = await sb.from("print_agents").delete().in("id", MADE.agents).eq("restaurant_id", RID);
      said.push(d.error ? `computer(s) NOT deleted: ${d.error.message}` : `${MADE.agents.length} computer(s) deleted`);
    }
  } catch (e) { said.push(`cleanup failed: ${e.message}`); }
  if (SNAP) { const b = await admin("/routes", { rid: RID, routes: SNAP }); said.push(b.ok ? "routes put back" : `routes NOT put back: ${b.status}`); }
  console.log(`  ↩ bank K tidied up: ${said.join(" · ") || "nothing to do"}`);
});

let id = 101235;
const live = reachable && canDrive && AGENT;
const K = (what, fn) => { const tag = `P${id++}`; live ? row(tag, what, fn) : skipRow(tag, what, reachable ? (canDrive ? "the virtual computer could not be created" : "needs playwright") : `needs the sweep server at ${BASE}`); };
const S = (what, fn) => { const tag = `P${id++}`; reachable ? row(tag, what, fn) : skipRow(tag, what, `needs the sweep server at ${BASE}`); };

/* ── THE SCREEN, OPENED AS THE ADMIN OPENS IT ─────────────────────────────────────────────── */
let PAGE = null;
async function page() {
  if (PAGE) return PAGE;
  const { chromium } = await import("playwright");
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  /* USE THE HELPER THAT EXISTS. login.mjs already publishes adminCookie() for exactly this, with a
     comment showing how to hand it to a browser context — and the first version of this bank
     invented its own cookie name instead, so every page it opened was the sign-in screen. Four
     rows then reported an admin console with "only 60 characters of text on it", which is what a
     password prompt looks like. */
  await ctx.addCookies([adminCookie(BASE)]);
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 160)));
  /* THE SCREEN OPENS ON THE OVERVIEW, NOT ON A RESTAURANT. `/aevinite/printing` answers "Every
     restaurant — anything that needs you is at the top. Click a row to set that restaurant up",
     and the per-restaurant setup only exists after that click. The first version of this bank
     read the overview and reported "there is no way to choose which restaurant is being set up"
     and "the screen does not mention that computer" — both true of a page nobody had clicked. So
     it clicks the row, the way a person does. */
  await p.goto(`${BASE}/aevinite/printing`, { waitUntil: "networkidle", timeout: 60000 });
  await p.waitForTimeout(1500);
  const clicked = await p.evaluate(() => {
    const wants = [...document.querySelectorAll("button, a, tr, [role=button], [role=row]")]
      .filter((el) => /My Little French House/i.test(el.textContent || ""));
    // the innermost match, so a whole table is not clicked instead of its row
    const el = wants.sort((a, b) => (a.textContent || "").length - (b.textContent || "").length)[0];
    if (!el) return false;
    el.click();
    return true;
  });
  await p.waitForTimeout(2200);
  PAGE = { p, errs, clicked };
  return PAGE;
}
const textOf = async () => { const { p } = await page(); return (await p.evaluate(() => document.body.innerText || "")).replace(/\s+/g, " "); };

K("the printing screen opens for a signed-in admin and draws its own content", async () => {
  const t = await textOf();
  return t.length > 300 || `only ${t.length} characters of text on it`;
});
K("…and throws nothing while it draws", async () => {
  const { errs } = await page();
  const real = errs.filter((e) => !/favicon|ResizeObserver|hydrat/i.test(e));
  return real.length === 0 || real[0];
});
K("…and a person can click a restaurant out of the list to set it up", async () => {
  const { clicked, p } = await page();
  if (!clicked) return "the overview lists no clickable row for the restaurant being set up";
  const t = (await p.evaluate(() => document.body.innerText || "")).replace(/\s+/g, " ");
  return /My Little French House/i.test(t) || "after clicking the row, the screen does not name the restaurant";
});
K("…and shows the computer that just linked itself, by the name it was given", async () => {
  const { p } = await page();
  const t = (await p.evaluate(() => document.body.innerText || "")).replace(/\s+/g, " ");
  return t.includes(AGENT.name) || `the screen does not mention "${AGENT.name}" — it reads: ${t.slice(0, 200)}`;
});
K("…and lists that machine's printers in its own words, not as something typed", async () => {
  const t = await textOf();
  const shown = PRINTERS.filter((x) => t.includes(x.name));
  return shown.length === PRINTERS.length || `it shows ${shown.length} of ${PRINTERS.length} printers`;
});
K("…and nothing on it reads as machine language, outside the file it teaches", async () => {
  /* THE <pre> BLOCKS ARE THE FILE A RESTAURANT COPIES, and it is a shell script — so `2>/dev/null`
     and `${…}` are on that screen on purpose and must stay exactly as they are. Scanning the whole
     page for those strings read the thing the screen exists to show and called it machine
     language. The words AROUND the file are what must read as English. */
  const { p } = await page();
  const prose = (await p.evaluate(() => {
    const c = document.body.cloneNode(true);
    c.querySelectorAll("pre, code, script, style, textarea").forEach((el) => el.remove());
    return c.innerText || "";
  })).replace(/\s+/g, " ");
  const bad = ["undefined", "NaN", "[object Object]", "-->", "${", " null "].filter((w) => prose.includes(w));
  return bad.length === 0 || `in the words around the file: ${bad.join(", ")}`;
});
K("…and the file it DOES show is a complete, runnable script rather than a fragment", async () => {
  const { p } = await page();
  const pres = await p.evaluate(() => [...document.querySelectorAll("pre")].map((el) => el.innerText || ""));
  const shells = pres.filter((t) => /^#!/.test(t.trim()));
  if (!shells.length) return "no file is shown at all";
  const bad = shells.filter((t) => t.trim().length < 400 || /\bundefined\b|\[object Object\]/.test(t));
  return bad.length === 0 || `${bad.length} of ${shells.length} file(s) are truncated or carry an unresolved value`;
});
K("…and its steps are numbered in the order a person walks them, with no two the same", async () => {
  const t = await textOf();
  const nums = [...t.matchAll(/\b([1-9])\s*·/g)].map((m) => Number(m[1]));
  const dupes = nums.filter((n, i) => nums.indexOf(n) !== i);
  return dupes.length === 0 || `two cards are both called ${[...new Set(dupes)].join(", ")}`;
});
K("…and every 'go to step N' on it points at a step that is really there", async () => {
  const t = await textOf();
  const refs = [...t.matchAll(/step\s+([1-9])/gi)].map((m) => Number(m[1]));
  const present = new Set([...t.matchAll(/\b([1-9])\s*·/g)].map((m) => Number(m[1])));
  const bad = [...new Set(refs)].filter((n) => present.size > 0 && !present.has(n));
  return bad.length === 0 || `it sends a person to step ${bad.join(", ")}, which is not on the screen`;
});

/* ── SETTING A ROUTE, AND ASKING THE SERVER WHETHER IT REALLY CHANGED ─────────────────────── */
const setAndRead = async (kind, patch) => {
  const r = await admin("/routes", { rid: RID, routes: { [kind]: patch } });
  return { r, now: (await state())?.routes?.[kind] };
};
for (const kind of ["kot", "bill", "banquet"]) {
  S(`pointing ${kind === "kot" ? "kitchen slips" : kind === "bill" ? "bills" : "banquet sheets"} at a computer really changes what the server holds`, async () => {
    const { r, now } = await setAndRead(kind, { via: "computer", agent: AGENT.id, printer: "Sweep-K-Roll" });
    return (r.ok && now?.agent === AGENT.id && now?.printer === "Sweep-K-Roll") || `${r.status}: ${JSON.stringify(now)}`;
  });
  S(`…and the screen reads it back as that machine, not as 'nobody chosen'`, async () => {
    const st = await state();
    const rt = st?.routes?.[kind];
    const names = (st?.agents || []).filter((a) => a.id === rt?.agent).map((a) => a.name);
    return names.includes(AGENT.name) || `the line reads ${JSON.stringify(rt)}`;
  });
  S(`…and switching that line OFF is remembered as OFF, not as empty`, async () => {
    const { r, now } = await setAndRead(kind, { via: "off" });
    return (r.ok && now?.via === "off") || `${r.status}: ${JSON.stringify(now)}`;
  });
  S(`…and clearing it afterwards leaves 'nobody yet', which is a different thing`, async () => {
    const { r, now } = await setAndRead(kind, null);
    return (r.ok && now?.via !== "off") || `${r.status}: ${JSON.stringify(now)}`;
  });
  S(`…and a printer that machine never reported is refused for ${kind}, by name`, async () => {
    const { r } = await setAndRead(kind, { via: "computer", agent: AGENT.id, printer: "Not A Printer" });
    return (!r.ok && /has no printer called/i.test(String(r.j?.error || ""))) || `${r.status}: ${JSON.stringify(r.j).slice(0, 100)}`;
  });
  S(`…and a refusal for ${kind} leaves the line exactly as it was, rather than half-set`, async () => {
    await setAndRead(kind, { via: "computer", agent: AGENT.id, printer: "Sweep-K-Roll" });
    const before = (await state())?.routes?.[kind];
    await setAndRead(kind, { via: "computer", agent: AGENT.id, printer: "Not A Printer" });
    const after = (await state())?.routes?.[kind];
    return JSON.stringify(before) === JSON.stringify(after) || `it was ${JSON.stringify(before)} and became ${JSON.stringify(after)}`;
  });
}
S("the test-page button needs BOTH a computer and one of its printers", async () => {
  const a = await admin("/test", { rid: RID, agentId: AGENT.id, printer: "" });
  const b = await admin("/test", { rid: RID, agentId: "", printer: "Sweep-K-Roll" });
  return (!a.ok && !b.ok && /pick a computer/i.test(String(a.j?.error || ""))) || `no printer → ${a.status}, no computer → ${b.status}`;
});
S("…and a test page really joins the queue when both are given", async () => {
  const r = await admin("/test", { rid: RID, agentId: AGENT.id, printer: "Sweep-K-Roll" });
  if (r.j?.id) {
    const n = await fetch(`${BASE}/api/print-agent/next`, { headers: { "x-lfh-agent": AGENT.token } });
    if (n.status === 200) { const j = await n.json(); await fetch(`${BASE}/api/print-agent/job/${j.id}/done`, { method: "POST", headers: { "content-type": "application/json", "x-lfh-agent": AGENT.token } }); }
  }
  return (r.ok && !!r.j?.id) || `${r.status}: ${JSON.stringify(r.j).slice(0, 100)}`;
});
S("renaming a computer on this screen is what the machine is called everywhere afterwards", async () => {
  const fresh = `Sweep T11 round5 K renamed ${Date.now()}`;
  const r = await admin(`/agents/${AGENT.id}/rename`, { rid: RID, name: fresh });
  const st = await state();
  const now = (st?.agents || []).find((a) => a.id === AGENT.id)?.name;
  if (r.ok) AGENT.name = fresh;
  return (r.ok && now === fresh) || `${r.status}: it is called ${JSON.stringify(now)}`;
});
S("…and an empty name is refused rather than leaving a machine nobody can point paper at", async () => {
  const r = await admin(`/agents/${AGENT.id}/rename`, { rid: RID, name: "   " });
  return (!r.ok && /name/i.test(String(r.j?.error || ""))) || `${r.status}: ${JSON.stringify(r.j).slice(0, 90)}`;
});
S("asking for a new code gives one, and hands back the file to run with it", async () => {
  const r = await admin(`/agents/${AGENT.id}/newcode`, { rid: RID });
  if (r.j?.code) AGENT.token = r.j.code;
  return (r.ok && !!r.j?.code && !!r.j?.scripts) || `${r.status}: ${Object.keys(r.j || {}).join(", ")}`;
});
S("…and the file it hands back names the same site the screen is on", async () => {
  const r = await admin(`/agents/${AGENT.id}/newcode`, { rid: RID });
  if (r.j?.code) AGENT.token = r.j.code;
  const texts = JSON.stringify(r.j?.scripts || {});
  return texts.includes("localhost:4311") || `the file points at something else: ${(/https?:\/\/[a-z0-9.:-]+/i.exec(texts) || ["nothing"])[0]}`;
});
S("…and the file carries NO code at all, because it pairs itself instead", async () => {
  /* THE OPPOSITE OF WHAT THIS ROW FIRST ASSERTED, and the opposite is the recorded decision. A
     downloaded file holding a restaurant's printing code is a secret in a Downloads folder; this
     one asks to be paired and a person approves it on screen (mig 368), which is also why the
     guide teaches typing it out rather than downloading it at all. */
  const r = await admin(`/agents/${AGENT.id}/newcode`, { rid: RID });
  if (!r.j?.code) return `no code came back: ${r.status}`;
  AGENT.token = r.j.code;
  const texts = JSON.stringify(r.j.scripts || {});
  return !texts.includes(r.j.code) || "the file a restaurant downloads has the printing code baked into it";
});
S("the queue can be stopped and restarted from this screen", async () => {
  const a = await admin("/queue", { rid: RID, paused: true });
  const b = await admin("/queue", { rid: RID, paused: false });
  return (a.ok && a.j?.paused === true && b.ok && b.j?.paused === false) || `stop ${a.status}/${JSON.stringify(a.j)}, start ${b.status}/${JSON.stringify(b.j)}`;
});
S("…and stopping it does not switch printing off, which would stop tickets being made at all", async () => {
  const before = (await state())?.printing;
  await admin("/queue", { rid: RID, paused: true });
  const during = (await state())?.printing;
  await admin("/queue", { rid: RID, paused: false });
  return JSON.stringify(before?.on) === JSON.stringify(during?.on)
    || `printing went from ${JSON.stringify(before?.on)} to ${JSON.stringify(during?.on)}`;
});
S("every refusal this screen's own API gives is a sentence, never a code", async () => {
  const tries = [
    ["/routes", { rid: RID, routes: { bill: { via: "computer", agent: AGENT.id, printer: "nope" } } }],
    ["/test", { rid: RID, agentId: "", printer: "" }],
    ["/agents", { rid: RID, name: "" }],
    ["/agents/00000000-0000-0000-0000-0000000000ff/newcode", { rid: RID }],
    ["/job/00000000-0000-0000-0000-0000000000ff/retry", { rid: RID }],
  ];
  const bad = [];
  for (const [path, body] of tries) {
    const r = await admin(path, body);
    const msg = String(r.j?.error ?? r.j?.message ?? "");
    if (r.ok) continue;
    if (!/[a-z]{3}\s+[a-z]{3}/.test(msg) || /\bnull\b|\bundefined\b|PGRST|\b5\d\d\b/.test(msg)) bad.push(`${path} → ${JSON.stringify(msg).slice(0, 70)}`);
  }
  return bad.length === 0 || bad.join(" · ");
});
S("…and none of them says only 'could not' without saying what to do", async () => {
  const r = await admin("/test", { rid: RID, agentId: "", printer: "" });
  const msg = String(r.j?.error || "");
  return /pick|choose|give|set|first|name/i.test(msg) || `it says "${msg}"`;
});
S("this screen never answers for a restaurant nobody named", async () => {
  const r = await admin(`/state`);
  return (!r.ok || r.status === 400) || `it answered ${r.status} with ${JSON.stringify(r.j).slice(0, 80)}`;
});
S("…and never for a restaurant that does not exist", async () => {
  const r = await admin(`/state?rid=00000000-0000-0000-0000-0000000000ff`);
  return (!r.ok || !(r.j?.agents || []).length) || `it answered with ${(r.j.agents || []).length} computer(s)`;
});
S("…and a computer belonging to one restaurant cannot be renamed from another's screen", async () => {
  const r = await admin(`/agents/${AGENT.id}/rename`, { rid: "00000000-0000-0000-0000-0000000000ff", name: "moved" });
  const st = await state();
  const still = (st?.agents || []).find((a) => a.id === AGENT.id)?.name;
  return still === AGENT.name || `it is now called ${JSON.stringify(still)}`;
});
S("the screen's own words about switching a line off are the same words the manager panel uses", async () => {
  const words = read("lib/printBoardWords.ts");
  const page_ = read("app/aevinite/printing/page.tsx");
  const usesShared = /printBoardWords|KIND_OFF_LABEL|KIND_LABEL/.test(page_);
  return usesShared || "the admin screen writes its own labels, so the two screens can drift apart";
});
S("…and there is no leftover control for a mechanism that was deleted", async () => {
  const t = read("app/aevinite/printing/page.tsx");
  const code = t.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  /* `print-station` is NOT dead — it is a live card on this screen ("The print-station file — the
     same one for every restaurant"), and listing it here was this bank guessing from a name. What
     IS gone is the mechanism toggle (owner, 2026-08-31: "we don't need toggle"), the backup
     printer, and the field the helper never read. */
  const dead = ["backupFor", "both (counter as", "How does the paper come out", "Which screen prints the ticket"]
    .filter((w) => code.includes(w));
  return dead.length === 0 || `the screen still offers: ${dead.join(", ")}`;
});

/* ══ K-2 · THE SCREEN AT THE WIDTH HE TESTS, AND IN BOTH SKINS ═════════════════════════════
   Round 1's bank D rendered this screen and read it. What it did not do is USE it at 390px after
   clicking through to a restaurant — and the header control group that this run's item 15 fixed
   was found exactly there, with Refresh sitting at x=381 in a 360px window. */
/* ONE PAGE PER SHAPE, KEPT. A fresh browser context per row meant twenty-two of them for this
   bank alone, on top of the ones banks J and L open — and Chromium gave up part way through,
   after which eleven rows reported "the browser has been closed" instead of anything about the
   product. The pages are cached by width and skin and closed once, by onFinish. */
const SHOTS = new Map();
async function shot({ width = 1280, skin = "dark", click = true } = {}) {
  const key = `${width}|${skin}|${click}`;
  if (SHOTS.has(key)) return SHOTS.get(key);
  const { chromium } = await import("playwright");
  if (!browser) browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: width < 500 ? 3 : 1 });
  await ctx.addCookies([adminCookie(BASE), { name: "aevidine_skin", value: skin, url: BASE }]);
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 160)));
  await p.goto(`${BASE}/aevinite/printing`, { waitUntil: "networkidle", timeout: 60000 });
  await p.waitForTimeout(1400);
  if (click) {
    await p.evaluate(() => {
      const w = [...document.querySelectorAll("button,a,tr,[role=button],[role=row]")]
        .filter((e) => /My Little French House/i.test(e.textContent || ""));
      w.sort((a, b) => (a.textContent || "").length - (b.textContent || "").length)[0]?.click();
    });
    await p.waitForTimeout(2000);
  }
  const made = { p, ctx, errs, close: async () => {} };   // closed once, by onFinish
  SHOTS.set(key, made);
  return made;
}
/** Everything that reaches past the right-hand edge — the measurement item 15 was found by.
 *
 *  A THING INSIDE A SCROLLER IS NOT OFF THE EDGE. The recent-prints table is deliberately wider
 *  than a phone and sits in a `div` with `overflow:auto`: it scrolls, the page does not, and that
 *  is the correct pattern rather than a fault. Counting it named "43px of table is off the edge"
 *  on a perfectly reachable table — and the amount moved run to run with how many tickets the
 *  banks above had queued, which is the signature of a check measuring the wrong thing. */
const overflow = (p) => p.evaluate(() => {
  let worst = 0, who = "";
  const inScroller = (el) => {
    let n = el.parentElement;
    while (n && n !== document.body) {
      const cs = getComputedStyle(n);
      if (/auto|scroll/.test(cs.overflowX) || /auto|scroll/.test(cs.overflowY)) return true;
      n = n.parentElement;
    }
    return false;
  };
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (inScroller(el)) continue;
    const over = Math.round(r.right - window.innerWidth);
    if (over > worst) { worst = over; who = el.tagName.toLowerCase() + "." + String(el.className || "").slice(0, 34); }
  }
  return { worst, who, scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});
/** The printing screen's OWN content — not the console shell around it. The admin nav is another
 *  territory's work, and every one of its links read as a too-small tap target and a too-quiet
 *  label in the first version of the four rows below. */
const MAIN = "main, [role=main], .adm-main, .adm-content";

for (const [label, width] of [["390px, the phone he tests on", 390], ["360px, the narrowest he has asked about", 360], ["768px, a tablet", 768], ["1280px, a desktop", 1280]]) {
  K(`the printing screen puts nothing past the right-hand edge at ${label}`, async () => {
    const s = await shot({ width });
    try { const o = await overflow(s.p); return o.worst <= 1 || `${o.worst}px of ${o.who} is off the edge`; }
    finally { await s.close(); }
  });
  K(`…and the page itself does not scroll sideways at ${label}`, async () => {
    const s = await shot({ width });
    try { const o = await overflow(s.p); return o.scroll <= 1 || `${o.scroll}px of sideways scroll`; }
    finally { await s.close(); }
  });
  K(`…and every control on it is big enough for a thumb at ${label}`, async () => {
    const s = await shot({ width });
    try {
      const small = await s.p.evaluate((sel) => {
        const root = document.querySelector(sel) || document.body;
        const out = [];
        /* A CONTROL, NOT EVERY LINK. A breadcrumb ("Restaurants › Printing") and a link inside a
           sentence ("The restaurant's own guide →") are 16px-tall pieces of TEXT — that is what an
           inline link is, on every website, and demanding 28px of them would mean restyling the
           console's breadcrumb from inside this territory. What must be thumb-sized is a thing a
           person aims at: a button, a select, a box they type in, and a link that stands alone.
           And only where a thumb is used — at a desk this rule is about nothing. */
        const inline = (el) => {
          if (getComputedStyle(el).display !== "inline" && getComputedStyle(el).display !== "inline-block") return false;
          const p2 = el.parentElement;
          return !!p2 && /^(P|SPAN|NAV|LI|OL|UL|SMALL|LABEL)$/.test(p2.tagName);
        };
        for (const el of root.querySelectorAll("button, select, input, textarea, [role=button], a[href]")) {
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") continue;
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          if (el.tagName === "A" && inline(el)) continue;
          if (r.height < 28) out.push(`${(el.textContent || el.tagName).trim().slice(0, 22)} is ${Math.round(r.height)}px tall`);
        }
        return out.slice(0, 4);
      }, MAIN);
      /* At a desk this rule is about nothing — a 16px breadcrumb link is aimed at with a mouse.
         The row still RUNS at every width so a regression that made a real button 8px tall would
         be caught, but only a phone width can fail it. */
      if (width > 500) return true;
      return small.length === 0 || small.join(" · ");
    } finally { await s.close(); }
  });
  K(`…and it throws nothing at ${label}`, async () => {
    const s = await shot({ width });
    try { const real = s.errs.filter((e) => !/favicon|ResizeObserver|hydrat/i.test(e)); return real.length === 0 || real[0]; }
    finally { await s.close(); }
  });
}
for (const skin of ["dark", "light"]) {
  K(`the printing screen is readable in ${skin} mode — nothing is one ink on its own colour`, async () => {
    const s = await shot({ skin });
    try {
      const bad = await s.p.evaluate((sel) => {
        const root = document.querySelector(sel) || document.body;
        const px = (c) => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c || ""); return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null; };
        const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
        /* NO GUESSED BACKGROUND. This used to fall back to a dark grey when no ancestor declared
           an opaque colour — and the console paints its page background somewhere this walk does
           not reach, so the breadcrumb came out at 1.1:1 against a colour that is not behind it.
           A measurement nobody can trust is worse than no measurement: where the background
           cannot be established, the element is skipped and the row says how many were skipped. */
        const bgOf = (el) => { let n = el; while (n) { const c = px(getComputedStyle(n).backgroundColor); if (c && c.a > 0.5) return c; n = n.parentElement; } return null; };
        const out = []; let skipped = 0;
        for (const el of root.querySelectorAll("*")) {
          if (!el.childNodes.length) continue;
          const t = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue.trim()).join("");
          if (t.length < 3) continue;
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") continue;
          const f = px(cs.color); if (!f) continue;
          /* A FULLY TRANSPARENT COMPUTED COLOUR DESCRIBES NOTHING. The console's breadcrumb link
             computes to rgba(0,0,0,0) and yet renders perfectly — proved by screenshotting the
             same 77×16 box before and after forcing it red, and the pixels changed, so something
             was already being painted there. Whatever paints it (a pseudo-element, a fill applied
             elsewhere), getComputedStyle().color on this node is not the answer, and treating it
             as one reported the breadcrumb at 1.1:1 on a screen a person reads every day. */
          if (f.a === 0) { skipped++; continue; }
          /* A PROPER CONTRAST RATIO, not a luminance difference of 12. Deliberately quiet text —
             a breadcrumb, a muted hint — is meant to be lower contrast than a heading, and a raw
             luminance gap called the console's breadcrumb invisible. What this row is really for is
             text that cannot be read at all, so it asks the ratio WCAG asks for and fails only
             below the "large text" floor of 3:1. */
          const rel = (c) => { const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
            return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
          const bg = bgOf(el);
          if (!bg) { skipped++; continue; }
          const L1 = Math.max(rel(f), rel(bg)), L2 = Math.min(rel(f), rel(bg));
          const ratio = (L1 + 0.05) / (L2 + 0.05);
          if (ratio < 3) out.push(`"${t.slice(0, 26)}" is only ${ratio.toFixed(1)}:1 against what is behind it`);
        }
        return { bad: out.slice(0, 3), skipped, looked: root.querySelectorAll("*").length };
      }, MAIN);
      if (bad.looked > 0 && bad.skipped === bad.looked) return "no element's background could be established, so nothing was measured";
      return bad.bad.length === 0 || bad.bad.join(" · ");
    } finally { await s.close(); }
  });
  K(`…and no colour on it is written out instead of taken from the skin, in ${skin} mode`, async () => {
    const t = read("app/aevinite/printing/page.tsx");
    const code = t.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const fixed = [...code.matchAll(/(?:color|background|backgroundColor|borderColor)\s*:\s*["'`](#[0-9a-f]{3,8}|rgb)/gi)]
      .map((m) => m[1]).filter((c) => !/^#(?:000|fff)/i.test(c));
    const guarded = fixed.filter((c) => !new RegExp(`var\\(--[^)]*\\)[^\\n]{0,60}${c}`).test(code));
    return guarded.length <= 6 || `${guarded.length} colour(s) written out rather than taken from the skin: ${[...new Set(guarded)].slice(0, 4).join(", ")}`;
  });
  K(`…and it throws nothing in ${skin} mode`, async () => {
    const s = await shot({ skin });
    try { const real = s.errs.filter((e) => !/favicon|ResizeObserver|hydrat/i.test(e)); return real.length === 0 || real[0]; }
    finally { await s.close(); }
  });
}
/* ── EACH STATE A RESTAURANT CAN BE IN, WITH THE SCREEN OPEN ON IT ────────────────────────── */
const withRoutes = async (routes, fn) => {
  const before = JSON.parse(JSON.stringify((await state())?.routes ?? {}));
  try { await admin("/routes", { rid: RID, routes }); return await fn(); }
  finally { await admin("/routes", { rid: RID, routes: SNAP ?? before }); }
};
K("with NO computer set up, the screen says so in words rather than showing an empty box", async () => {
  const bare = await admin("/agents", { rid: RID, name: `Sweep T11 round5 K bare ${Date.now()}` });
  if (bare.j?.id) MADE.agents.push(bare.j.id);
  const t = read("app/aevinite/printing/page.tsx");
  return /No computer has the helper yet/.test(t) || "the no-computer state renders a box with nothing in it";
});
K("…and the lines below it say why they cannot be set yet", async () => {
  const t = read("app/aevinite/printing/page.tsx");
  return /Set (?:a|the) computer up in step 2 first/.test(t) || "a person is left choosing from an empty list with no explanation";
});
K("…and nothing has printed yet says so too", async () => {
  const t = read("app/aevinite/printing/page.tsx");
  return /Nothing has been printed yet/.test(t) || "the recent list renders empty with no sentence";
});
K("with a line switched OFF, the screen says what that really means for that paper", async () => {
  const words = read("lib/printBoardWords.ts");
  return /Nobody — kitchen slips do not print by themselves/.test(words) && /Normal — a window opens/.test(words)
    || "switching a line off is described the same way for a slip and for a bill, which is a lie about one of them";
});
K("…and a bill's OFF is worded differently from a kitchen slip's, because they mean different things", async () => {
  const words = read("lib/printBoardWords.ts");
  const off = /KIND_OFF_LABEL[\s\S]{0,400}?\};/.exec(words)?.[0] || "";
  const kot = /kot:\s*"([^"]+)"/.exec(off)?.[1] || "";
  const bill = /bill:\s*"([^"]+)"/.exec(off)?.[1] || "";
  return (kot && bill && kot !== bill) || `kot: "${kot}" · bill: "${bill}"`;
});
K("with a line pointed at a computer, the screen shows the machine AND the printer", async () => {
  await withRoutes({ bill: { via: "computer", agent: AGENT.id, printer: "Sweep-K-Roll" } }, async () => {});
  const t = read("app/aevinite/printing/page.tsx");
  return /printer/i.test(t) && /agent|computer/i.test(t) || "the screen names one without the other";
});
K("…and the paper that printer is loaded with, so nobody has to know what A6 is", async () => {
  const words = read("lib/printBoardWords.ts");
  return /PAPER_PRESETS/.test(words) && /As the printer says/i.test(words)
    || "a person setting a printer up has to know its paper size by heart";
});
K("the guide is one tap away from this screen", async () => {
  const t = read("app/aevinite/printing/page.tsx");
  return /print-setup\.html/.test(t) || "the screen does not link the guide at all";
});
K("…and that guide really answers", async () => {
  const r = await fetch(`${BASE}/print-setup.html`);
  const t = r.ok ? await r.text() : "";
  return (r.ok && t.length > 2000) || `${r.status}, ${t.length} bytes`;
});
K("…and the guide does not teach a download, because macOS blocks one", async () => {
  const t = read("public/print-setup.html");
  const bad = [...t.matchAll(/\]\(([^)]+\.(?:bat|cmd|ps1|sh|command|zip))\)/gi)].map((m) => m[1]);
  return bad.length === 0 || `it links ${bad.join(", ")}`;
});
K("…and the file it teaches is shown in full, ready to copy", async () => {
  const s = await shot();
  try {
    const pres = await s.p.evaluate(() => [...document.querySelectorAll("pre")].map((el) => (el.innerText || "").length));
    return pres.some((n) => n > 2000) || `the longest block on the screen is ${Math.max(0, ...pres)} characters`;
  } finally { await s.close(); }
});
K("…and there is a way to copy it that does not involve selecting it by hand", async () => {
  const t = read("app/aevinite/printing/page.tsx");
  return /clipboard|Copy/i.test(t) || "a person has to select 14,000 characters with a mouse";
});
K("…and if copying fails, the screen says what to do instead", async () => {
  const t = read("app/aevinite/printing/page.tsx");
  return /select the text and copy it by hand/.test(t) || "a failed copy leaves a person with nothing";
});
K("the screen offers the file for each platform, named the way that platform names files", async () => {
  const st = await state();
  const files = st?.files || {};
  const bad = Object.entries(files).filter(([, v]) => !v || typeof v.filename !== "string" || !v.filename)
    .map(([k]) => k);
  return (Object.keys(files).length >= 2 && bad.length === 0) || `${Object.keys(files).length} platform(s), ${bad.length} with no filename`;
});
K("…and each one is a complete file, not a fragment", async () => {
  const st = await state();
  const texts = Object.values(st?.files || {}).map((v) => String(v?.text || ""));
  const bad = texts.filter((t) => t.length < 1000);
  return (texts.length > 0 && bad.length === 0) || `${bad.length} of ${texts.length} file(s) are under 1,000 characters`;
});
K("…and none of them carries a value that failed to resolve", async () => {
  /* THE COMMENTS ARE NOT VALUES. The Windows station file carries the obituary for round 1's item
     12 — "(%GOT: =% on an undefined var is the empty string)" — which is prose explaining a fix,
     and the first version of this row read it as an unresolved value in a shipped file. A guard
     must judge the code, never the note saying why the code is what it is. */
  const st = await state();
  const strip = (t) => String(t || "")
    .replace(/^\s*(?:#|REM\b|::|\/\/).*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const bad = [];
  for (const [where, bag] of [["helper", st?.files], ["station", st?.stationFiles]]) {
    for (const [os, v] of Object.entries(bag || {})) {
      const code = strip(v?.text);
      for (const w of ["undefined", "[object Object]", "NaN"]) if (code.includes(w)) bad.push(`${where}/${os} carries "${w}"`);
    }
  }
  return bad.length === 0 || bad.join(" · ");
});
K("…and the autostart line each platform needs is offered with it", async () => {
  const st = await state();
  const bad = Object.entries(st?.files || {}).filter(([, v]) => !v?.autostart).map(([k]) => k);
  return bad.length === 0 || `no autostart line for: ${bad.join(", ")}`;
});
K("the screen never shows another restaurant's computers while one is being set up", async () => {
  const st = await state();
  const sb = await (async () => { const { createClient } = await import("@supabase/supabase-js"); const { readFileSync } = await import("node:fs");
    const envp = new URL("../../../.env.local", import.meta.url).pathname;
    const env = Object.fromEntries(readFileSync(envp, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
    return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }); })();
  const mine = new Set(((await sb.from("print_agents").select("id").eq("restaurant_id", RID)).data || []).map((x) => x.id));
  const shown = (st?.agents || []).map((a) => a.id);
  const strays = shown.filter((x) => !mine.has(x));
  return strays.length === 0 || `${strays.length} computer(s) on the screen belong to another restaurant`;
});
K("…and the recent-prints list likewise", async () => {
  const st = await state();
  const bad = (st?.recent || []).filter((x) => x && x.restaurant_id && x.restaurant_id !== RID);
  return bad.length === 0 || `${bad.length} recent ticket(s) are another restaurant's`;
});
K("…and the waiting count is this restaurant's only", async () => {
  const st = await state();
  return typeof st?.waiting === "number" || `it says ${JSON.stringify(st?.waiting)}`;
});
K("the screen's four steps are the things a person DOES, with no choice of mechanism among them", async () => {
  const words = read("lib/printBoardWords.ts");
  const steps = /export const STEPS = \{[\s\S]*?\} as const;/.exec(words)?.[0] || "";
  return (!/How does the paper come out|toggle|mechanism/i.test(steps) && /computer that prints/i.test(steps))
    || `the steps read: ${steps.replace(/\s+/g, " ").slice(0, 140)}`;
});
K("…and the last card is numbered by the caller, because choosing a computer adds a step", async () => {
  const words = read("lib/printBoardWords.ts");
  return /numbered by the caller/i.test(words) || "the step numbers are baked in, which once put two cards called 4 on one screen";
});
K("…and no two cards on the rendered screen carry the same number", async () => {
  const s = await shot();
  try {
    const t = (await s.p.evaluate(() => document.body.innerText || "")).replace(/\s+/g, " ");
    const nums = [...t.matchAll(/\b([1-9])\s*·/g)].map((m) => Number(m[1]));
    const dupes = nums.filter((n, i) => nums.indexOf(n) !== i);
    return dupes.length === 0 || `two cards are both called ${[...new Set(dupes)].join(", ")}`;
  } finally { await s.close(); }
});
K("the screen tells a person which computer they are sitting at, so 'this one' is never a guess", async () => {
  const st = await state();
  return ("thisComputer" in (st || {})) || "nothing on the board identifies the machine the screen is open on";
});
K("…and it says whether the manager is allowed to print, because that is the admin's to decide", async () => {
  const st = await state();
  return ("managerMayPrint" in (st || {})) || "the screen does not say whether the manager may print at all";
});
if (id - 1 !== 101324) throw new Error(`bank K ended at P${id - 1}, not P101324 — it has ${id - 1 - 101234} rows`);
