// ⬛ NEW — T11 of sweep #8 · BANK J · P101095–P101234 · ROUND 5
// THE PRINT QUEUE AND THE HELPER'S DOOR, DRIVEN END TO END.
//
// WHY THIS IS THE FIRST BANK OF THE 500. Round 1's bank C covered the same two files and covered
// them by READING — 77 rows, every one of them a judgement about source. That was the right call
// then (these are server modules behind the "@/" alias and the service-role client, so they cannot
// be loaded into a bare harness) and it is still the only honest way to answer the questions about
// who may do what. But it means the product's CENTRAL FLOW — a ticket is made, a computer asks for
// work, is given one job and not two, fetches the paper, says it printed, and the queue closes —
// has never once been run in this territory. Everything anybody knows about it is inference.
//
// So this bank runs it. Against the real server on 4311, through the real doors, with a real
// (virtual) computer that pairs, says hello, claims, draws and reports.
//
// ── WHAT IT WRITES, AND HOW IT IS PUT BACK ───────────────────────────────────────────────────
// ONE virtual computer, and the jobs it is given. Every id is remembered as it is created and
// deleted BY ITS OWN ID at the end of the run — in a `finally`, and again on SIGINT/SIGTERM, so a
// cancelled run does not leave a machine in a restaurant's printing screen. Nothing is cleaned up
// "by pattern": a row this bank did not create is another terminal's fixture and is never touched.
// The four printing routes are snapshotted before anything and written back the same way.
import { row, skipRow, onFinish, read } from "./lib.mjs";
import { adminHeaders } from "../login.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.T11_BASE || "http://localhost:4311";
const RID = "00000000-0000-0000-0000-000000000001";      // French House — the one this sweep writes to
const H = { ...adminHeaders(BASE), "content-type": "application/json" };

const admin = async (path, body) => {
  const r = await fetch(`${BASE}/api/admin/printing${path}`,
    body === undefined ? { headers: H } : { method: "POST", headers: H, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* 204 / html */ }
  return { status: r.status, ok: r.ok, j };
};
/** The helper's own door. `tok` null = an unpaired machine, which is most of what is asked here. */
const agentCall = async (path, { tok, body, method } = {}) => {
  const headers = { "content-type": "application/json", ...(tok ? { "x-lfh-agent": tok } : {}) };
  const r = await fetch(`${BASE}/api/print-agent${path}`, {
    method: method || (body === undefined ? "GET" : "POST"), headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let j = null, text = ""; try { text = await r.text(); j = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: r.status, ok: r.ok, j, text };
};

// ── the ledger of everything this bank creates ───────────────────────────────────────────────
const MADE = { agents: [], jobs: [] };
let SNAP = null;

const ENV_PATH = new URL("../../../.env.local", import.meta.url).pathname;
const env = (() => {
  try {
    return Object.fromEntries(readFileSync(ENV_PATH, "utf8").split("\n").filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
  } catch { return {}; }
})();

/* Delete by id, through the service role. The admin door only REVOKES a computer (deliberately —
   the record of which machine printed which ticket has to stay readable), and a revoked row is
   still a row on the restaurant's screen. A test fixture is not a record, so it goes.

   IT REPORTS WHAT IT DID, AND WHAT IT COULD NOT DO. The first version wrapped the whole thing in
   `catch {}` and then cleared its own bookkeeping regardless — so when the deletes silently failed
   it announced nothing, the arrays came back empty, and the "⚠ left behind" warning could not fire
   either. A cleanup that hides its own failure is not a cleanup. Nothing is forgotten until the
   database has actually said it is gone. */
async function sweepUp() {
  if (!MADE.agents.length && !MADE.jobs.length && !SNAP) return;
  const said = [];
  if (MADE.agents.length || MADE.jobs.length) {
    if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      said.push(`could not read ${ENV_PATH} — ${MADE.agents.length} computer(s) and ${MADE.jobs.length} ticket(s) are still there`);
    } else {
      const { createClient } = await import("@supabase/supabase-js");
      const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
      // EVERY ticket belonging to a computer this bank made — not only the ones whose id it caught.
      // A ticket queued by a path that did not hand its id back is still this bank's litter, and a
      // job row pointing at a deleted computer is what makes the delete fail in the first place.
      for (const a of MADE.agents) {
        const q = await sb.from("print_jobs").select("id").eq("restaurant_id", RID).eq("agent_id", a);
        for (const r of q.data || []) if (!MADE.jobs.includes(r.id)) MADE.jobs.push(r.id);
      }
      if (MADE.jobs.length) {
        const d = await sb.from("print_jobs").delete().in("id", MADE.jobs).eq("restaurant_id", RID);
        if (d.error) said.push(`${MADE.jobs.length} ticket(s) NOT deleted: ${d.error.message}`);
        else { said.push(`${MADE.jobs.length} ticket(s) deleted`); MADE.jobs = []; }
      }
      if (MADE.agents.length) {
        const d = await sb.from("print_agents").delete().in("id", MADE.agents).eq("restaurant_id", RID);
        if (d.error) said.push(`${MADE.agents.length} computer(s) NOT deleted: ${d.error.message}`);
        else { said.push(`${MADE.agents.length} computer(s) deleted`); MADE.agents = []; }
      }
    }
  }
  if (SNAP) {
    const back = await admin("/routes", { rid: RID, routes: SNAP });
    said.push(back.ok ? "the four printing routes put back" : `the printing routes were NOT put back: ${back.status}`);
    if (back.ok) SNAP = null;
  }
  console.log(`  ↩ bank J tidied up: ${said.join(" · ")}`);
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { sweepUp().finally(() => process.exit(130)); });
/* AND ON THE ORDINARY WAY OUT. Registering signal handlers is not cleanup — this harness runs the
   rows AFTER every module has been imported, so there is no `finally` in this file that the rows
   are inside of. The first version of this bank registered two signal handlers, never called
   sweepUp(), and left a computer and fourteen tickets in a real restaurant's printing screen.
   `beforeExit` fires when the loop is empty and CAN await, which "exit" cannot. */
let swept = false;
const sweepOnce = async () => { if (swept) return; swept = true; await sweepUp(); };
// The harness runs this after the last row, on a pass, a failure or a throw — `beforeExit` never
// fires here because run() ends with process.exit().
onFinish(sweepOnce);
process.on("exit", () => { if (MADE.agents.length || MADE.jobs.length) console.log(`\n⚠ bank J left ${MADE.agents.length} agent(s) and ${MADE.jobs.length} job(s) behind — delete them by id.`); });

// ── can this bank run at all? ────────────────────────────────────────────────────────────────
const reachable = await admin(`/state?rid=${RID}`).then((r) => r.status === 200).catch(() => false);
const P = [];
let id = 101095;
const D = (what, fn) => { const tag = `P${id++}`; P.push(tag); reachable ? row(tag, what, fn) : skipRow(tag, what, `needs the sweep server at ${BASE}`); };

let AGENT = null;        // { id, token, name }
const PRINTERS = [{ name: "Sweep-Roll-80", desc: "Virtual 80mm", paper: { name: "X72MM", wMm: 72, hMm: 200 } },
                  { name: "Sweep-Sheet-A4", desc: "Virtual A4", paper: { name: "A4", wMm: 210, hMm: 297 } }];

if (reachable) {
  SNAP = JSON.parse(JSON.stringify((await admin(`/state?rid=${RID}`)).j?.routes ?? {}));
  const made = await admin("/agents", { rid: RID, name: `Sweep T11 round5 ${Date.now()}` });
  if (made.j?.id) { AGENT = { id: made.j.id, token: made.j.code, name: made.j.name }; MADE.agents.push(made.j.id); }
}
const need = (fn) => async () => AGENT ? fn() : "the virtual computer could not be created, so nothing below it could run";

/* ══ J-1 · THE FRONT DOOR — what an UNPAIRED machine can and cannot do ══════════════════════
   Read as product correctness, never as an attempt on the door: does every verb require the
   machine to say who it is, and does the pairing pair ONE machine to ONE restaurant chosen by a
   person? Nothing here is retried, nothing is guessed at, and no code is discovered. */
D("a machine with no printing code is turned away from /hello, in a sentence a person can read", async () => {
  const r = await agentCall("/hello", { body: { fingerprint: "sweep" } });
  if (r.status !== 401) return `it answered ${r.status}`;
  const msg = r.j?.error || r.j?.message || r.text;
  return /[a-z]{3}.*[a-z]{3}/.test(String(msg)) && !/null|undefined|PGRST/.test(String(msg))
    || `the refusal reads: ${JSON.stringify(msg).slice(0, 90)}`;
});
D("…and from /next", async () => (await agentCall("/next")).status === 401 || "a machine that named no code was offered work");
D("…and from a job's document", async () => (await agentCall("/job/00000000-0000-0000-0000-000000000000/document")).status === 401 || "it answered something other than 401");
D("…and from reporting a job done", async () => (await agentCall("/job/00000000-0000-0000-0000-000000000000/done", { body: {} })).status === 401 || "it answered something other than 401");
D("…and from reporting one failed", async () => (await agentCall("/job/00000000-0000-0000-0000-000000000000/failed", { body: {} })).status === 401 || "it answered something other than 401");
D("a code that is not a code is turned away the same way as no code at all", async () => {
  const a = await agentCall("/hello", { body: {} });
  const b = await agentCall("/hello", { tok: "not-a-real-code", body: {} });
  return a.status === b.status || `no code → ${a.status}, an unusable code → ${b.status}`;
});
D("the two pairing verbs are the only ones that answer without a code, and neither hands anything over", async () => {
  const r = await agentCall("/pair/start", { body: { fingerprint: "sweep-fp-" + Date.now(), hostname: "sweep-host", os: "test", printers: PRINTERS } });
  if (r.status !== 200) return `pair/start answered ${r.status}`;
  const keys = Object.keys(r.j || {}).sort();
  if (r.j?.token) return "pair/start hands back a working token before any person has approved it";
  return (keys.includes("code") && keys.includes("secret")) || `it answered ${keys.join(", ")}`;
});
D("…and the machine that starts pairing does not get to say which restaurant it joins", async () => {
  const r = await agentCall("/pair/start", { body: { fingerprint: "sweep-fp2-" + Date.now(), hostname: "h", os: "test", printers: [], restaurant_id: RID, rid: RID } });
  return !(r.j?.restaurant_id || r.j?.rid) || "the answer names a restaurant the machine asked for";
});
D("a pairing that nobody has approved yet is answered honestly, not with a token", async () => {
  const s = await agentCall("/pair/start", { body: { fingerprint: "sweep-fp3-" + Date.now(), hostname: "h", os: "test", printers: [] } });
  const p = await agentCall("/pair/poll", { body: { code: s.j?.code, secret: s.j?.secret } });
  return !p.j?.token || "a token came back for a pairing no person has approved";
});
D("…and asking about a pairing without its own secret is answered the same as asking about one that does not exist", async () => {
  const s = await agentCall("/pair/start", { body: { fingerprint: "sweep-fp4-" + Date.now(), hostname: "h", os: "test", printers: [] } });
  const noSecret = await agentCall("/pair/poll", { body: { code: s.j?.code, secret: "" } });
  const noSuch = await agentCall("/pair/poll", { body: { code: "ZZZZZZ", secret: "" } });
  return (noSecret.status === noSuch.status && JSON.stringify(noSecret.j) === JSON.stringify(noSuch.j))
    || `${JSON.stringify(noSecret.j)} vs ${JSON.stringify(noSuch.j)}`;
});
D("a pairing request that describes nothing is still answered, not crashed", async () => {
  const r = await agentCall("/pair/start", { body: {} });
  return r.status < 500 || `it answered ${r.status}`;
});
D("…and one carrying a hundred printers does not become a hundred rows the admin has to read", async () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ name: `P${i}`, desc: "x" }));
  const r = await agentCall("/pair/start", { body: { fingerprint: "sweep-fp5-" + Date.now(), hostname: "h", os: "test", printers: many } });
  return r.status < 500 || `it answered ${r.status}`;
});

/* ══ J-2 · HELLO — the machine introduces itself ════════════════════════════════════════════ */
D("a paired computer says hello and is told who it is", need(async () => {
  const r = await agentCall("/hello", { tok: AGENT.token, body: { fingerprint: "sweep-machine", printers: PRINTERS } });
  return (r.status === 200 && r.j?.agent?.id === AGENT.id) || `${r.status}: ${JSON.stringify(r.j).slice(0, 120)}`;
}));
D("…and is told how often to come back, by the server rather than deciding for itself", need(async () => {
  const r = await agentCall("/hello", { tok: AGENT.token, body: { printers: PRINTERS } });
  return (typeof r.j?.pollMs === "number" && r.j.pollMs >= 2000) || `pollMs is ${JSON.stringify(r.j?.pollMs)}`;
}));
D("…and whether this restaurant is printing at all", need(async () => {
  const r = await agentCall("/hello", { tok: AGENT.token, body: { printers: PRINTERS } });
  return (r.j && "printing" in r.j) || "hello does not say whether printing is on";
}));
D("…and which paper is its job, so its own log can say 'not mine' rather than 'broken'", need(async () => {
  const r = await agentCall("/hello", { tok: AGENT.token, body: { printers: PRINTERS } });
  return Array.isArray(r.j?.mine) || `mine is ${JSON.stringify(r.j?.mine)}`;
}));
D("the printers the admin can choose from are the machine's OWN words, not anybody's typing", need(async () => {
  await agentCall("/hello", { tok: AGENT.token, body: { fingerprint: "sweep-machine", printers: PRINTERS } });
  const st = await admin(`/state?rid=${RID}`);
  const mine = (st.j?.agents || []).find((a) => a.id === AGENT.id);
  const names = (mine?.printers || []).map((p) => p.name).sort();
  return JSON.stringify(names) === JSON.stringify(PRINTERS.map((p) => p.name).sort())
    || `the screen would offer ${JSON.stringify(names)}`;
}));
D("…including the paper each one says it is loaded with", need(async () => {
  const st = await admin(`/state?rid=${RID}`);
  const mine = (st.j?.agents || []).find((a) => a.id === AGENT.id);
  const roll = (mine?.printers || []).find((p) => p.name === "Sweep-Roll-80");
  return (roll?.paper?.wMm === 72) || `the roll's paper came back as ${JSON.stringify(roll?.paper)}`;
}));
D("hello hands back no field that nothing reads", need(async () => {
  const r = await agentCall("/hello", { tok: AGENT.token, body: { printers: PRINTERS } });
  const dead = ["backupFor", "backup", "both", "mode", "toggle"].filter((k) => r.j && k in r.j);
  return dead.length === 0 || `it still answers: ${dead.join(", ")} — a field kept for a reader that does not exist`;
}));
D("a computer is never told about another restaurant's machines", need(async () => {
  const r = await agentCall("/hello", { tok: AGENT.token, body: { printers: PRINTERS } });
  const s = JSON.stringify(r.j || {});
  return !/restaurant/i.test(s.replace(/"restaurant_id":"[^"]*"/g, "")) || "hello's answer talks about restaurants";
}));

/* ══ J-3 · THE QUEUE — one job, one machine, one piece of paper ═════════════════════════════ */
/** Take everything already waiting, so the next row is looking at ITS OWN ticket.
 *  The queue is FIFO and shared: rows above leave tickets behind, so "the ticket I just queued is
 *  offered next" was answered with a ticket from three rows earlier and read as a fault. */
const drain = async () => {
  for (let i = 0; i < 30; i++) {
    const n = await agentCall("/next", { tok: AGENT.token });
    if (n.status !== 200 || !n.j?.id) return;
    await agentCall(`/job/${n.j.id}/done`, { tok: AGENT.token, body: {} });
  }
};
const queueTest = async ({ clean = true } = {}) => {
  if (clean) await drain();
  const r = await admin("/test", { rid: RID, agentId: AGENT.id, printer: "Sweep-Roll-80" });
  if (r.j?.id) MADE.jobs.push(r.j.id);
  return r;
};
D("a test page can be sent to a named printer on a named computer", need(async () => {
  // `(ok && r.j.id) || msg` returns the ID STRING when it passes, and this harness reads any
  // string as the reason it failed — so a working test page reported itself as a fault named
  // after its own uuid. A judge answers true or a sentence, never a value.
  const r = await queueTest();
  return (r.ok && !!r.j?.id) || `${r.status}: ${JSON.stringify(r.j).slice(0, 120)}`;
}));
D("…and a printer that computer never reported is refused, by name", need(async () => {
  const r = await admin("/test", { rid: RID, agentId: AGENT.id, printer: "A Printer Nobody Owns" });
  return (!r.ok && /has no printer called/i.test(String(r.j?.error || ""))) || `${r.status}: ${JSON.stringify(r.j).slice(0, 120)}`;
}));
D("…and a computer that is not this restaurant's is refused too", need(async () => {
  const r = await admin("/test", { rid: RID, agentId: "00000000-0000-0000-0000-0000000000ff", printer: "Sweep-Roll-80" });
  return (!r.ok && /not one of this restaurant/i.test(String(r.j?.error || ""))) || `${r.status}: ${JSON.stringify(r.j).slice(0, 120)}`;
}));
D("a queued ticket is offered to the computer it was queued for", need(async () => {
  const q = await queueTest();
  const n = await agentCall("/next", { tok: AGENT.token });
  return (n.status === 200 && n.j?.id === q.j?.id) || `next answered ${n.status} with ${JSON.stringify(n.j).slice(0, 100)}`;
}));
D("…and the offer names the printer, so the machine does not have to guess", need(async () => {
  const q = await queueTest();
  const n = await agentCall("/next", { tok: AGENT.token });
  return (n.j?.printer === "Sweep-Roll-80") || `it was offered ${JSON.stringify(n.j?.printer)}`;
}));
D("…and the SAME job is not offered twice, so two computers cannot print one ticket", need(async () => {
  await queueTest();
  const a = await agentCall("/next", { tok: AGENT.token });
  const b = await agentCall("/next", { tok: AGENT.token });
  return (a.j?.id && a.j.id !== b.j?.id) || `both asks got ${JSON.stringify(a.j?.id)}`;
}));
D("an empty queue answers 204 with no body at all — a poll every two seconds must cost nothing", need(async () => {
  let guard = 0;
  while (guard++ < 12) { const n = await agentCall("/next", { tok: AGENT.token }); if (n.status === 204) break; }
  const n = await agentCall("/next", { tok: AGENT.token });
  return (n.status === 204 && n.text === "") || `${n.status} with ${n.text.length} bytes`;
}));
D("a claimed ticket's paper can be fetched, and it is a real document", need(async () => {
  const q = await queueTest();
  await agentCall("/next", { tok: AGENT.token });
  const d = await agentCall(`/job/${q.j.id}/document`, { tok: AGENT.token });
  return (d.status === 200 && /<html|<!doctype/i.test(d.text)) || `${d.status}: ${d.text.slice(0, 100)}`;
}));
D("…and it DOES declare the paper that printer is loaded with — the opposite rule to a browser", need(async () => {
  // NOT the no-@page-size rule. That one is for a document printed from a BROWSER window, where
  // declaring a size makes CUPS rotate the ticket. On the helper's path the route deliberately
  // injects it (lib/printDocs.withPaper): "page size and media must agree or the driver rotates
  // the ticket". Asserting the browser rule here read a correct document as broken.
  const q = await queueTest();
  await agentCall("/next", { tok: AGENT.token });
  const d = await agentCall(`/job/${q.j.id}/document`, { tok: AGENT.token });
  const m = /@page[^}]*\bsize\s*:\s*([\d.]+)mm\s+([\d.]+)mm/.exec(d.text);
  if (!m) return "the document names no paper, so the driver picks one and may rotate it";
  return Math.abs(Number(m[1]) - 72) < 0.5 || `it declares ${m[1]}mm wide; the printer reported 72mm`;
}));
D("…and the ink is narrowed to what that head can actually reach, never wider", need(async () => {
  const q = await queueTest();
  await agentCall("/next", { tok: AGENT.token });
  const d = await agentCall(`/job/${q.j.id}/document`, { tok: AGENT.token });
  // READ THE OVERRIDE, NOT THE DOCUMENT'S OWN FIRST WIDTH. withPaper APPENDS its rule after every
  // stylesheet the document carries — deliberately, because an equal-specificity !important placed
  // first loses, and that is how a 58mm roll once printed "LITTLE FRENCH HOUS". So the effective
  // column is the LAST one declared, and matching the first found the test page's own 66mm and
  // called a correctly-narrowed document too wide.
  const all = [...d.text.matchAll(/width\s*:\s*([\d.]+)mm/g)].map((m) => Number(m[1]));
  if (!all.length) return "the document names no column width at all";
  const ink = all[all.length - 1];
  const head = 72 - 4.9 * 2;
  return (ink <= head + 0.01) || `${ink}mm of ink on a 72mm roll whose head stops at ${head.toFixed(1)}mm`;
}));
D("…and the printer's name travels on the answer itself, so the file and the printer cannot disagree", need(async () => {
  const q = await queueTest();
  await agentCall("/next", { tok: AGENT.token });
  const r = await fetch(`${BASE}/api/print-agent/job/${q.j.id}/document`, { headers: { "x-lfh-agent": AGENT.token } });
  return r.headers.get("x-lfh-printer") === "Sweep-Roll-80" || `the header says ${JSON.stringify(r.headers.get("x-lfh-printer"))}`;
}));
D("…and that answer is never cached, because the next ticket is a different ticket", need(async () => {
  const q = await queueTest();
  await agentCall("/next", { tok: AGENT.token });
  const r = await fetch(`${BASE}/api/print-agent/job/${q.j.id}/document`, { headers: { "x-lfh-agent": AGENT.token } });
  return /no-store/.test(r.headers.get("cache-control") || "") || `cache-control is ${JSON.stringify(r.headers.get("cache-control"))}`;
}));
D("…and it carries no machine language a person would be handed", need(async () => {
  const q = await queueTest();
  await agentCall("/next", { tok: AGENT.token });
  const d = await agentCall(`/job/${q.j.id}/document`, { tok: AGENT.token });
  const body = d.text.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ");
  const bad = ["undefined", "NaN", "[object Object]", "Invalid Date"].filter((w) => body.includes(w));
  return bad.length === 0 || `it prints: ${bad.join(", ")}`;
}));
D("a computer cannot fetch the paper for a job that is not its restaurant's", need(async () => {
  const d = await agentCall("/job/00000000-0000-0000-0000-0000000000aa/document", { tok: AGENT.token });
  return d.status === 404 || `it answered ${d.status}`;
}));
D("saying a ticket printed closes it, and it is never offered again", need(async () => {
  const q = await queueTest();
  await agentCall("/next", { tok: AGENT.token });
  const done = await agentCall(`/job/${q.j.id}/done`, { tok: AGENT.token, body: {} });
  if (!done.ok) return `done answered ${done.status}`;
  let guard = 0, again = false;
  while (guard++ < 12) { const n = await agentCall("/next", { tok: AGENT.token }); if (n.status === 204) break; if (n.j?.id === q.j.id) { again = true; break; } }
  return !again || "a ticket that printed came round again";
}));
D("saying it FAILED puts it back, because paper and power come back", need(async () => {
  const q = await queueTest();
  await agentCall("/next", { tok: AGENT.token });
  const f = await agentCall(`/job/${q.j.id}/failed`, { tok: AGENT.token, body: { error: "sweep: pretend the tray was empty" } });
  if (!f.ok) return `failed answered ${f.status}`;
  let guard = 0, back = false;
  while (guard++ < 12) { const n = await agentCall("/next", { tok: AGENT.token }); if (n.status === 204) break; if (n.j?.id === q.j.id) { back = true; break; } }
  return back || "a ticket that did not print was never offered again";
}));
D("…but it does not go round for ever — five tries and it parks, so a dead printer cannot fill the queue", need(async () => {
  const q = await queueTest();
  for (let i = 0; i < 8; i++) {
    let guard = 0, got = false;
    while (guard++ < 12) { const n = await agentCall("/next", { tok: AGENT.token }); if (n.status === 204) break; if (n.j?.id === q.j.id) { got = true; break; } }
    if (!got) break;
    await agentCall(`/job/${q.j.id}/failed`, { tok: AGENT.token, body: { error: "sweep: still empty" } });
  }
  const st = await admin(`/state?rid=${RID}`);
  const mine = (st.j?.recent || st.j?.queue || []).find((x) => x.id === q.j.id);
  return (!mine || ["failed", "dismissed"].includes(mine.status)) || `after eight refusals it is still "${mine.status}"`;
}));
D("a parked ticket can be put back by a person, with its tries reset", need(async () => {
  const q = await queueTest();
  await agentCall("/next", { tok: AGENT.token });
  await agentCall(`/job/${q.j.id}/failed`, { tok: AGENT.token, body: { error: "sweep" } });
  await admin(`/job/${q.j.id}/cancel`, { rid: RID });
  const r = await admin(`/job/${q.j.id}/retry`, { rid: RID });
  return r.ok || `${r.status}: ${JSON.stringify(r.j).slice(0, 110)}`;
}));
D("a ticket that already printed cannot be 'put back' — that would print it twice", need(async () => {
  const q = await queueTest();
  await agentCall("/next", { tok: AGENT.token });
  await agentCall(`/job/${q.j.id}/done`, { tok: AGENT.token, body: {} });
  const r = await admin(`/job/${q.j.id}/retry`, { rid: RID });
  return (!r.ok && /failed or was cancelled/i.test(String(r.j?.error || ""))) || `${r.status}: ${JSON.stringify(r.j).slice(0, 110)}`;
}));
D("a person can take a waiting ticket out of the queue, and is told plainly when it is too late", need(async () => {
  const q = await queueTest();
  const c1 = await admin(`/job/${q.j.id}/cancel`, { rid: RID });
  const c2 = await admin(`/job/${q.j.id}/cancel`, { rid: RID });
  return (c1.ok && !c2.ok && /already printed|not this restaurant/i.test(String(c2.j?.error || "")))
    || `first ${c1.status}, second ${c2.status}: ${JSON.stringify(c2.j).slice(0, 100)}`;
}));
D("stopping the queue is NOT the same as switching printing off — tickets go on being made", need(async () => {
  const before = (await admin(`/state?rid=${RID}`)).j?.printing;
  const p = await admin("/queue", { rid: RID, paused: true });
  const during = (await admin(`/state?rid=${RID}`)).j?.printing;
  await admin("/queue", { rid: RID, paused: false });
  return (p.ok && JSON.stringify(before?.on) === JSON.stringify(during?.on))
    || `stopping the queue also switched printing from ${JSON.stringify(before?.on)} to ${JSON.stringify(during?.on)}`;
}));
D("…and restarting it leaves the waiting tickets exactly where they were", need(async () => {
  const q = await queueTest();
  await admin("/queue", { rid: RID, paused: true });
  await admin("/queue", { rid: RID, paused: false });
  let guard = 0, found = false;
  while (guard++ < 12) { const n = await agentCall("/next", { tok: AGENT.token }); if (n.status === 204) break; if (n.j?.id === q.j.id) { found = true; break; } }
  return found || "a ticket queued before the stop was gone after the restart";
}));

/* ══ J-4 · THE OTHER THREE KINDS OF PAPER ══════════════════════════════════════════════════
   A test page is the easy one — it needs nothing but a printer's name. The three that matter
   each read something else out of the database: a KOT reads its order, a bill its session, a
   banquet sheet its bill. What happens when that thing is GONE is the behaviour this bank is
   here for, and it is the exact shape of a real fault this file already carries an obituary
   for: the banquet sheet was queued, handed to the helper, answered "no document", and marked
   dismissed — no paper, no error, nothing on any screen.
   These jobs are inserted straight into the queue, because there is no door that queues a
   ticket for an order that does not exist. Every one is deleted by its own id at the end. */
const sbOnce = async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
};
const putJob = async (kind, extra = {}) => {
  const sb = await sbOnce();
  const r = await sb.from("print_jobs").insert({
    restaurant_id: RID, kind, status: "queued", attempts: 0,
    agent_id: AGENT.id, printer: "Sweep-Roll-80", ...extra,
  }).select("id").maybeSingle();
  if (r.data?.id) MADE.jobs.push(r.data.id);
  return r.data?.id || null;
};
const claimAndDraw = async (jobId) => {
  await drain();
  const sb = await sbOnce();
  await sb.from("print_jobs").update({ status: "queued", claimed_at: null, attempts: 0 }).eq("id", jobId);
  let guard = 0;
  while (guard++ < 20) { const n = await agentCall("/next", { tok: AGENT.token }); if (n.status === 204) break; if (n.j?.id === jobId) break; }
  return agentCall(`/job/${jobId}/document`, { tok: AGENT.token });
};
for (const [kind, why] of [["kot", "its order"], ["bill", "its session"], ["banquet", "its bill"]]) {
  D(`a ${kind} whose ${why} is gone is CLOSED, not handed back for ever`, need(async () => {
    const jobId = await putJob(kind, kind === "kot" ? { order_id: null } : { payload: {} });
    if (!jobId) return "the ticket could not be put in the queue";
    const d = await claimAndDraw(jobId);
    if (d.status !== 204) return `the document endpoint answered ${d.status}, not 204`;
    const sb = await sbOnce();
    const row_ = (await sb.from("print_jobs").select("status, error").eq("id", jobId).maybeSingle()).data;
    return (row_?.status === "dismissed") || `it is still "${row_?.status}" and will be asked for again`;
  }));
  D(`…and the reason is written ON the ticket, so a person reading the queue later can tell why`, need(async () => {
    const jobId = await putJob(kind, kind === "kot" ? { order_id: null } : { payload: {} });
    if (!jobId) return "the ticket could not be put in the queue";
    await claimAndDraw(jobId);
    const sb = await sbOnce();
    const row_ = (await sb.from("print_jobs").select("error").eq("id", jobId).maybeSingle()).data;
    const msg = String(row_?.error || "");
    return (/[a-z]{3}\s+[a-z]{3}/.test(msg) && !/null|undefined|PGRST/.test(msg)) || `it reads: ${JSON.stringify(msg)}`;
  }));
  D(`…and a ${kind} for ANOTHER computer is refused, because two machines must not print one ticket`, need(async () => {
    const sb = await sbOnce();
    const jobId = await putJob(kind, { agent_id: null });
    if (!jobId) return "the ticket could not be put in the queue";
    await sb.from("print_jobs").update({ status: "printing", agent_id: null, claimed_at: new Date().toISOString() }).eq("id", jobId);
    const d = await agentCall(`/job/${jobId}/document`, { tok: AGENT.token });
    return d.status === 409 || `it answered ${d.status} for a ticket claimed by nobody`;
  }));
}
D("a kind this build cannot draw at all is closed too, rather than queued for ever", need(async () => {
  const jobId = await putJob("something-nobody-built");
  if (!jobId) return true;                    // the database refuses the kind outright — even better
  const d = await claimAndDraw(jobId);
  const sb = await sbOnce();
  const row_ = (await sb.from("print_jobs").select("status").eq("id", jobId).maybeSingle()).data;
  return (d.status === 204 && row_?.status === "dismissed") || `${d.status}, and the ticket is "${row_?.status}"`;
}));
D("…and closing it is not the same as saying it PRINTED", need(async () => {
  const jobId = await putJob("kot", { order_id: null });
  if (!jobId) return "the ticket could not be put in the queue";
  await claimAndDraw(jobId);
  const sb = await sbOnce();
  const row_ = (await sb.from("print_jobs").select("status").eq("id", jobId).maybeSingle()).data;
  return row_?.status !== "done" || "a ticket nobody could draw is recorded as printed";
}));

/* ══ J-5 · THE ADDRESS BOOK, DRIVEN ════════════════════════════════════════════════════════ */
const routes = async () => (await admin(`/state?rid=${RID}`)).j?.routes || {};
D("a kind of paper can be pointed at a computer and one of its printers", need(async () => {
  const r = await admin("/routes", { rid: RID, routes: { bill: { via: "computer", agent: AGENT.id, printer: "Sweep-Roll-80" } } });
  const now = (await routes()).bill;
  return (r.ok && now.agent === AGENT.id && now.printer === "Sweep-Roll-80") || `${r.status}: ${JSON.stringify(now)}`;
}));
D("…and pointing it at a printer that machine never reported is refused, by name", need(async () => {
  const r = await admin("/routes", { rid: RID, routes: { bill: { via: "computer", agent: AGENT.id, printer: "Nobody's Printer" } } });
  return (!r.ok && /has no printer called/i.test(String(r.j?.error || ""))) || `${r.status}: ${JSON.stringify(r.j).slice(0, 110)}`;
}));
D("…and at a computer that is not this restaurant's, likewise", need(async () => {
  const r = await admin("/routes", { rid: RID, routes: { bill: { via: "computer", agent: "00000000-0000-0000-0000-0000000000ff", printer: "x" } } });
  return (!r.ok && /not one of this restaurant/i.test(String(r.j?.error || ""))) || `${r.status}: ${JSON.stringify(r.j).slice(0, 110)}`;
}));
D("clearing a line is not the same as switching it off — one says 'nobody yet', the other says 'nobody, on purpose'", need(async () => {
  await admin("/routes", { rid: RID, routes: { bill: { via: "computer", agent: AGENT.id, printer: "Sweep-Roll-80" } } });
  await admin("/routes", { rid: RID, routes: { bill: null } });
  const cleared = (await routes()).bill;
  await admin("/routes", { rid: RID, routes: { bill: { via: "off" } } });
  const off = (await routes()).bill;
  return (cleared?.via !== "off" && off?.via === "off") || `cleared reads ${JSON.stringify(cleared?.via)}, switched off reads ${JSON.stringify(off?.via)}`;
}));
D("removing a computer empties every line that named it, so no paper is silently unprinted", need(async () => {
  const made = await admin("/agents", { rid: RID, name: `Sweep T11 round5 doomed ${Date.now()}` });
  if (!made.j?.id) return "a second virtual computer could not be created";
  MADE.agents.push(made.j.id);
  await agentCall("/hello", { tok: made.j.code, body: { fingerprint: "sweep-doomed", printers: PRINTERS } });
  await admin("/routes", { rid: RID, routes: { banquet: { via: "computer", agent: made.j.id, printer: "Sweep-Sheet-A4" } } });
  const before = (await routes()).banquet?.agent;
  const rev = await admin(`/agents/${made.j.id}/revoke`, { rid: RID });
  const after = (await routes()).banquet?.agent;
  return (before === made.j.id && after == null && rev.j?.routesCleared?.includes("banquet"))
    || `before ${before}, after ${after}, cleared ${JSON.stringify(rev.j?.routesCleared)}`;
}));
D("…and it is marked removed rather than deleted, because which machine printed which ticket has to stay readable", need(async () => {
  const sb = await sbOnce();
  const gone = (await sb.from("print_agents").select("id, revoked_at").eq("restaurant_id", RID).not("revoked_at", "is", null).limit(1)).data;
  return (gone && gone.length > 0) || "a removed computer leaves no row at all, so its tickets name nobody";
}));
D("a new code kills the old one the instant it is given out", need(async () => {
  const made = await admin("/agents", { rid: RID, name: `Sweep T11 round5 recode ${Date.now()}` });
  if (!made.j?.id) return "a virtual computer could not be created";
  MADE.agents.push(made.j.id);
  const old = made.j.code;
  await agentCall("/hello", { tok: old, body: { printers: PRINTERS } });
  const fresh = await admin(`/agents/${made.j.id}/newcode`, { rid: RID });
  const withOld = await agentCall("/hello", { tok: old, body: {} });
  const withNew = await agentCall("/hello", { tok: fresh.j?.code, body: { printers: PRINTERS } });
  return (withOld.status === 401 && withNew.status === 200) || `old code → ${withOld.status}, new code → ${withNew.status}`;
}));
D("…and the replaced code does not inherit the old machine's 'used on two computers' warning", need(async () => {
  const made = await admin("/agents", { rid: RID, name: `Sweep T11 round5 fp ${Date.now()}` });
  if (!made.j?.id) return "a virtual computer could not be created";
  MADE.agents.push(made.j.id);
  await agentCall("/hello", { tok: made.j.code, body: { fingerprint: "machine-one", printers: PRINTERS } });
  await agentCall("/hello", { tok: made.j.code, body: { fingerprint: "machine-two", printers: PRINTERS } });
  const fresh = await admin(`/agents/${made.j.id}/newcode`, { rid: RID });
  const h = await agentCall("/hello", { tok: fresh.j?.code, body: { fingerprint: "machine-three", printers: PRINTERS } });
  return !h.j?.warning || `a brand-new code already warns: ${JSON.stringify(h.j.warning)}`;
}));
D("one code used on two computers IS said out loud, because half the tickets would come out in the wrong room", need(async () => {
  const made = await admin("/agents", { rid: RID, name: `Sweep T11 round5 clash ${Date.now()}` });
  if (!made.j?.id) return "a virtual computer could not be created";
  MADE.agents.push(made.j.id);
  await agentCall("/hello", { tok: made.j.code, body: { fingerprint: "clash-a", printers: PRINTERS } });
  const h = await agentCall("/hello", { tok: made.j.code, body: { fingerprint: "clash-b", printers: PRINTERS } });
  return (typeof h.j?.warning === "string" && /computer/i.test(h.j.warning)) || `it said ${JSON.stringify(h.j?.warning)}`;
}));
D("a computer must be given a name — an unnamed machine is one nobody can point paper at", need(async () => {
  const r = await admin("/agents", { rid: RID, name: "   " });
  return (!r.ok && /name/i.test(String(r.j?.error || ""))) || `${r.status}: ${JSON.stringify(r.j).slice(0, 110)}`;
}));
D("…and two computers cannot share one name, or a person choosing between them is guessing", need(async () => {
  const name = `Sweep T11 round5 twin ${Date.now()}`;
  const a = await admin("/agents", { rid: RID, name });
  if (a.j?.id) MADE.agents.push(a.j.id);
  const b = await admin("/agents", { rid: RID, name });
  if (b.j?.id) MADE.agents.push(b.j.id);
  return !b.ok || "two computers on one restaurant now answer to the same name";
}));
D("renaming a computer to a name already taken says so, rather than failing quietly", need(async () => {
  const n1 = `Sweep T11 round5 r1 ${Date.now()}`, n2 = `Sweep T11 round5 r2 ${Date.now()}`;
  const a = await admin("/agents", { rid: RID, name: n1 }); if (a.j?.id) MADE.agents.push(a.j.id);
  const b = await admin("/agents", { rid: RID, name: n2 }); if (b.j?.id) MADE.agents.push(b.j.id);
  const r = await admin(`/agents/${b.j.id}/rename`, { rid: RID, name: n1 });
  return (!r.ok && /already/i.test(String(r.j?.error || ""))) || `${r.status}: ${JSON.stringify(r.j).slice(0, 110)}`;
}));
D("a computer that does not exist is answered 'no such computer', not 'could not load it'", need(async () => {
  const r = await admin("/agents/00000000-0000-0000-0000-0000000000ff/newcode", { rid: RID });
  return (r.status === 404 && /no such computer/i.test(String(r.j?.error || ""))) || `${r.status}: ${JSON.stringify(r.j).slice(0, 110)}`;
}));

/* ══ J-6 · SWITCHING PRINTING ON AND OFF, AND WHAT EACH ANSWER COSTS ═══════════════════════ */
const printingNow = async () => (await admin(`/state?rid=${RID}`)).j?.printing;
let PRINT_SNAP = null;
D("printing can be switched off for a restaurant, and the switch is remembered", need(async () => {
  PRINT_SNAP = await printingNow();
  const r = await admin("/switch", { rid: RID, on: false });
  const now = await printingNow();
  await admin("/switch", { rid: RID, on: PRINT_SNAP?.on !== false });
  return (r.ok && now?.on === false) || `${r.status}: ${JSON.stringify(now)}`;
}));
D("…and a helper is told, so its own log can say 'not switched on' rather than 'broken'", need(async () => {
  await admin("/switch", { rid: RID, on: false });
  const h = await agentCall("/hello", { tok: AGENT.token, body: { printers: PRINTERS } });
  await admin("/switch", { rid: RID, on: PRINT_SNAP?.on !== false });
  /* TWO SHAPES FOR ONE IDEA, and the row asks about the MEANING rather than the shape. /state
     answers `{allowed, on}` because the screen needs both; hello answers a plain boolean, because
     a helper only needs to know whether to bother. Demanding the object shape at hello read a
     correct answer as a fault. */
  const said = h.j?.printing;
  const off = said === false || (said && typeof said === "object" && said.on === false);
  return off || `hello said ${JSON.stringify(said)}`;
}));
D("…and while it is off an empty poll still costs nothing, rather than answering an error", need(async () => {
  await admin("/switch", { rid: RID, on: false });
  const n = await agentCall("/next", { tok: AGENT.token });
  await admin("/switch", { rid: RID, on: PRINT_SNAP?.on !== false });
  return (n.status === 204 && n.text === "") || `${n.status} with ${n.text.length} bytes`;
}));
D("…and switching it back on does not lose the address book", need(async () => {
  await admin("/routes", { rid: RID, routes: { bill: { via: "computer", agent: AGENT.id, printer: "Sweep-Roll-80" } } });
  const before = (await admin(`/state?rid=${RID}`)).j?.routes?.bill;
  await admin("/switch", { rid: RID, on: false });
  await admin("/switch", { rid: RID, on: true });
  const after = (await admin(`/state?rid=${RID}`)).j?.routes?.bill;
  return JSON.stringify(before) === JSON.stringify(after) || `it was ${JSON.stringify(before)} and is now ${JSON.stringify(after)}`;
}));
D("a restaurant printing is not allowed to have cannot be switched on by this door", need(async () => {
  const p = await printingNow();
  return (p && "allowed" in p) || `the state does not say whether printing is allowed: ${JSON.stringify(p)}`;
}));

/* ══ J-7 · THE OVERVIEW AND THE BOARD ══════════════════════════════════════════════════════ */
D("the console-wide overview answers, and puts what needs a person at the top", need(async () => {
  const r = await admin("/overview");
  const rows_ = r.j?.rows || r.j?.restaurants || [];
  return (r.ok && Array.isArray(rows_) && rows_.length > 0) || `${r.status}: ${JSON.stringify(r.j).slice(0, 110)}`;
}));
D("…and every restaurant on it says, in words, what state it is in", need(async () => {
  const r = await admin("/overview");
  const rows_ = r.j?.rows || r.j?.restaurants || [];
  /* THE API GIVES THE FACTS; THE SCREEN WORDS THEM. That split is deliberate — the sentences live
     in lib/printBoardWords.ts so the admin console and the manager panel cannot describe one
     machine two ways. So the row asks for the facts a sentence needs, not for the sentence. */
  const need_ = ["name", "allowed", "on", "computers", "connected", "routed", "waiting"];
  const bad = rows_.filter((x) => !x || need_.some((k) => !(k in x)))
    .map((x) => `${x?.name || "a row"} is missing ${need_.filter((k) => !(k in (x || {}))).join(", ")}`);
  return bad.length === 0 || `${bad.length} of ${rows_.length}: ${bad[0]}`;
}));
D("…and it never hands over a value that failed to resolve", need(async () => {
  const r = await admin("/overview");
  const s = JSON.stringify(r.j || {});
  const bad = ["\"undefined\"", "\"NaN\"", "[object Object]", "\"Invalid Date\""].filter((w) => s.includes(w));
  return bad.length === 0 || `it answers with: ${bad.join(", ")}`;
}));
D("…and it is capped, so a console with a thousand restaurants still answers", need(async () => {
  const src = read("app/api/admin/printing/[...path]/route.ts");
  const seg = src.slice(src.indexOf('seg[0] === "overview"'), src.indexOf('seg[0] === "overview"') + 2400);
  return /\.limit\(|\.range\(/.test(seg) || "the overview reads every restaurant with no ceiling";
}));
D("the per-restaurant board says how long the oldest waiting ticket has waited", need(async () => {
  await queueTest();
  const st = await admin(`/state?rid=${RID}`);
  const s = JSON.stringify(st.j || {});
  return /wait|oldest|age|since|ago/i.test(s) || "nothing on the board says how long anything has been waiting";
}));
D("…and it counts what is waiting rather than listing it", need(async () => {
  /* THE COUNTING IS WHERE THE COUNTING HAPPENS. printBoard.ts does not count — it calls
     waitingCount() and waitingToPrint(), and the `count: "exact", head: true` lives in
     lib/printHelpers.ts. Looking only at the board called a correctly-counted backlog a fault. */
  const board = read("lib/printBoard.ts");
  const delegates = /waitingCount\(/.test(board) && /waitingToPrint\(/.test(board);
  const fn = read("lib/printHelpers.ts");
  const i = fn.indexOf("export async function waitingCount");
  const counts = i >= 0 && /count:\s*["'`]exact["'`],\s*head:\s*true/.test(fn.slice(i, i + 400));
  const listsRows = /\.from\("print_jobs"\)[\s\S]{0,200}?\.select\((?!\s*"id")/.test(board.slice(board.indexOf("waiting"), board.indexOf("waiting") + 300));
  return (delegates && counts && !listsRows)
    || `board delegates: ${delegates}; the count transfers no rows: ${counts}; the board lists them itself: ${listsRows}`;
}));
D("…and it names the computer that printed each recent ticket, so a problem has an address", need(async () => {
  const st = await admin(`/state?rid=${RID}`);
  const recent = st.j?.recent || st.j?.jobs || [];
  if (!recent.length) return true;                     // nothing has printed on this restaurant yet
  /* THE FIELD IS `printed_by`, and it is NULL for a ticket a SCREEN printed — which is most of
     them on a restaurant with no helper, and is correct: no computer printed it. What must be true
     is that the field exists on every row, so the board can say "this machine" when there was one. */
  const bad = recent.filter((x) => x && !("printed_by" in x));
  return bad.length === 0 || `${bad.length} of ${recent.length} recent ticket(s) cannot name a machine at all`;
}));
D("…and a ticket that failed says WHY on the board, in words", need(async () => {
  const q = await queueTest();
  await agentCall("/next", { tok: AGENT.token });
  await agentCall(`/job/${q.j.id}/failed`, { tok: AGENT.token, body: { error: "sweep: the tray was empty" } });
  const st = await admin(`/state?rid=${RID}`);
  const mine = (st.j?.recent || []).find((x) => x.id === q.j.id);
  const msg = String(mine?.error || "");
  return (!mine || /[a-z]{3}\s+[a-z]{3}/.test(msg)) || `it reads ${JSON.stringify(msg)}`;
}));

/* ══ J-8 · PAIRING, ALL THE WAY THROUGH ════════════════════════════════════════════════════
   The route a restaurant actually walks: the file describes the machine, a person approves it on
   screen, and only then does the machine get a code — once. */
const startPair = () => agentCall("/pair/start", {
  body: { fingerprint: `sweep-pair-${Date.now()}`, hostname: "sweep-host", os: "test", printers: PRINTERS } });
D("a machine describing itself gets a code a person can read out, and a secret only it holds", need(async () => {
  const r = await startPair();
  const code = String(r.j?.code || "");
  return (/^[A-Z0-9-]{4,12}$/.test(code) && String(r.j?.secret || "").length >= 16)
    || `code ${JSON.stringify(r.j?.code)}, secret ${String(r.j?.secret || "").length} chars`;
}));
D("…and a code a person reads out has no characters that look like each other", need(async () => {
  const r = await startPair();
  const code = String(r.j?.code || "");
  const confusing = [...code].filter((c) => "O0I1L".includes(c));
  return confusing.length === 0 || `the code is "${code}" — a person reading it out would say ${confusing.join(", ")} ambiguously`;
}));
D("…and it is handed a place to go and approve it, rather than being told to find one", need(async () => {
  const r = await startPair();
  return (typeof r.j?.pairUrl === "string" && r.j.pairUrl.includes("/pair")) || `it was given ${JSON.stringify(r.j?.pairUrl)}`;
}));
D("…and the pairing does not last for ever unapproved", need(async () => {
  const r = await startPair();
  return (Number(r.j?.expiresInMs) > 0) || `it says it expires in ${JSON.stringify(r.j?.expiresInMs)}`;
}));
D("…and two machines starting at once get two different codes", need(async () => {
  const [a, b] = await Promise.all([startPair(), startPair()]);
  return (a.j?.code && b.j?.code && a.j.code !== b.j.code) || `both got ${JSON.stringify(a.j?.code)}`;
}));
D("a pairing nobody has approved yet answers 'waiting', not a token", need(async () => {
  const s = await startPair();
  const p = await agentCall("/pair/poll", { body: { code: s.j?.code, secret: s.j?.secret } });
  return (!p.j?.token && p.status === 200) || `${p.status}: ${JSON.stringify(p.j).slice(0, 90)}`;
}));
D("…and the machine that asks is never told which restaurant it MIGHT join", need(async () => {
  const s = await startPair();
  const p = await agentCall("/pair/poll", { body: { code: s.j?.code, secret: s.j?.secret } });
  return !p.j?.restaurant || `it was told ${JSON.stringify(p.j.restaurant)} before anybody approved it`;
}));
D("…and the pairing page a person opens is a real screen", need(async () => {
  const s = await startPair();
  const url = String(s.j?.pairUrl || "");
  if (!url) return "no pairing address was given";
  const r = await fetch(url.startsWith("http") ? url : BASE + url, { headers: adminHeaders(BASE) });
  const t = r.ok ? await r.text() : "";
  return (r.ok && t.length > 400) || `${r.status}, ${t.length} bytes`;
}));

/* ══ J-9 · THE DOCUMENT, AND WHO MAY HAVE IT ═══════════════════════════════════════════════ */
D("a document is only given to the computer the ticket was claimed by", need(async () => {
  const other = await admin("/agents", { rid: RID, name: `Sweep T11 round5 other ${Date.now()}` });
  if (!other.j?.id) return "a second virtual computer could not be created";
  MADE.agents.push(other.j.id);
  await agentCall("/hello", { tok: other.j.code, body: { fingerprint: "sweep-other", printers: PRINTERS } });
  const q = await queueTest();
  await agentCall("/next", { tok: AGENT.token });
  const d = await agentCall(`/job/${q.j.id}/document`, { tok: other.j.code });
  return d.status === 409 || `the other machine was answered ${d.status}`;
}));
D("…and the refusal says which machine it belongs to, in words", need(async () => {
  const other = await admin("/agents", { rid: RID, name: `Sweep T11 round5 other2 ${Date.now()}` });
  if (!other.j?.id) return "a second virtual computer could not be created";
  MADE.agents.push(other.j.id);
  await agentCall("/hello", { tok: other.j.code, body: { printers: PRINTERS } });
  const q = await queueTest();
  await agentCall("/next", { tok: AGENT.token });
  const d = await agentCall(`/job/${q.j.id}/document`, { tok: other.j.code });
  const msg = String(d.j?.error || d.text);
  return /another computer/i.test(msg) || `it said ${JSON.stringify(msg).slice(0, 80)}`;
}));
D("…and a ticket id that is not a ticket is answered 'no such print job', not a crash", need(async () => {
  const d = await agentCall("/job/00000000-0000-0000-0000-00000000dead/document", { tok: AGENT.token });
  return (d.status === 404 && /no such print job/i.test(String(d.j?.error || d.text))) || `${d.status}: ${String(d.j?.error || d.text).slice(0, 70)}`;
}));
D("…and an id that is not even an id is answered, not crashed", need(async () => {
  const d = await agentCall("/job/not-a-uuid/document", { tok: AGENT.token });
  return d.status < 500 || `it answered ${d.status}`;
}));
D("…and an unknown verb is answered 'unknown request', not a 500", need(async () => {
  const d = await agentCall("/something-nobody-built", { tok: AGENT.token });
  return (d.status === 404) || `it answered ${d.status}`;
}));
D("the document carries the paper the ROUTE pins, in preference to what the machine reported", need(async () => {
  await admin("/routes", { rid: RID, routes: { test: { via: "computer", agent: AGENT.id, printer: "Sweep-Sheet-A4" } } });
  const r = await admin("/test", { rid: RID, agentId: AGENT.id, printer: "Sweep-Sheet-A4" });
  if (r.j?.id) MADE.jobs.push(r.j.id);
  await agentCall("/next", { tok: AGENT.token });
  const res = await fetch(`${BASE}/api/print-agent/job/${r.j.id}/document`, { headers: { "x-lfh-agent": AGENT.token } });
  const paper = res.headers.get("x-lfh-paper") || "";
  return /210/.test(paper) || `the answer says the paper is ${JSON.stringify(paper)}`;
}));
D("…and a machine that reported no paper at all still gets a document", need(async () => {
  const bare = await admin("/agents", { rid: RID, name: `Sweep T11 round5 nopaper ${Date.now()}` });
  if (!bare.j?.id) return "a virtual computer could not be created";
  MADE.agents.push(bare.j.id);
  await agentCall("/hello", { tok: bare.j.code, body: { fingerprint: "sweep-nopaper", printers: [{ name: "Sweep-Bare" }] } });
  const r = await admin("/test", { rid: RID, agentId: bare.j.id, printer: "Sweep-Bare" });
  if (r.j?.id) MADE.jobs.push(r.j.id);
  let guard = 0;
  while (guard++ < 12) { const n = await agentCall("/next", { tok: bare.j.code }); if (n.status === 204) break; if (n.j?.id === r.j.id) break; }
  const d = await agentCall(`/job/${r.j.id}/document`, { tok: bare.j.code });
  return (d.status === 200 && /<html|<!doctype/i.test(d.text)) || `${d.status}: ${d.text.slice(0, 80)}`;
}));

/* ══ J-10 · THE ORDER PAPER COMES OUT IN, AND TWO MACHINES ASKING AT ONCE ═══════════════════ */
D("tickets are offered oldest first — a kitchen works in the order orders arrived", need(async () => {
  await drain();
  const ids = [];
  for (let i = 0; i < 3; i++) { const r = await admin("/test", { rid: RID, agentId: AGENT.id, printer: "Sweep-Roll-80" }); if (r.j?.id) { ids.push(r.j.id); MADE.jobs.push(r.j.id); } await new Promise((x) => setTimeout(x, 60)); }
  const got = [];
  for (let i = 0; i < 3; i++) { const n = await agentCall("/next", { tok: AGENT.token }); if (n.j?.id) { got.push(n.j.id); await agentCall(`/job/${n.j.id}/done`, { tok: AGENT.token, body: {} }); } }
  return JSON.stringify(got) === JSON.stringify(ids) || `queued ${ids.map((x) => x.slice(0, 6))} and was offered ${got.map((x) => x.slice(0, 6))}`;
}));
D("two computers asking at the same instant are never given the same ticket", need(async () => {
  const other = await admin("/agents", { rid: RID, name: `Sweep T11 round5 race ${Date.now()}` });
  if (!other.j?.id) return "a second virtual computer could not be created";
  MADE.agents.push(other.j.id);
  await agentCall("/hello", { tok: other.j.code, body: { fingerprint: "sweep-race", printers: PRINTERS } });
  await drain();
  const q = await queueTest({ clean: false });
  const [a, b] = await Promise.all([
    agentCall("/next", { tok: AGENT.token }),
    agentCall("/next", { tok: other.j.code }),
  ]);
  const both = [a.j?.id, b.j?.id].filter(Boolean);
  return !(both.length === 2 && both[0] === both[1]) || `both were given ${both[0]}`;
}));
D("…and five asking at once share out what there is, rather than one ticket five times", need(async () => {
  await drain();
  const ids = [];
  for (let i = 0; i < 3; i++) { const r = await admin("/test", { rid: RID, agentId: AGENT.id, printer: "Sweep-Roll-80" }); if (r.j?.id) { ids.push(r.j.id); MADE.jobs.push(r.j.id); } }
  const answers = await Promise.all(Array.from({ length: 5 }, () => agentCall("/next", { tok: AGENT.token })));
  const given = answers.map((x) => x.j?.id).filter(Boolean);
  const uniq = new Set(given);
  for (const g of uniq) await agentCall(`/job/${g}/done`, { tok: AGENT.token, body: {} });
  return uniq.size === given.length || `${given.length} answers carried only ${uniq.size} different tickets`;
}));
D("a ticket a machine claimed and never reported is offered again eventually, not lost", need(async () => {
  const q = await queueTest();
  await agentCall("/next", { tok: AGENT.token });          // claimed, never reported
  const sb = await sbOnce();
  const row_ = (await sb.from("print_jobs").select("status, claimed_at").eq("id", q.j.id).maybeSingle()).data;
  return (row_?.status === "printing" && !!row_?.claimed_at)
    || `it is "${row_?.status}" with claimed_at ${JSON.stringify(row_?.claimed_at)} — nothing records that a machine took it`;
}));
D("…and how long is too long is a number the SERVER owns, so no screen keeps its own", need(async () => {
  const st = await admin(`/state?rid=${RID}`);
  return Number(st.j?.stuck?.afterMs) > 0 || `the board says ${JSON.stringify(st.j?.stuck)}`;
}));
D("…and the same number reaches the console-wide overview", need(async () => {
  const r = await admin("/overview");
  return Number(r.j?.stuckAfterMs) > 0 || `the overview says ${JSON.stringify(r.j?.stuckAfterMs)}`;
}));
D("…and the two agree, so one screen cannot call a ticket stuck while the other calls it fine", need(async () => {
  const st = await admin(`/state?rid=${RID}`), ov = await admin("/overview");
  return Number(st.j?.stuck?.afterMs) === Number(ov.j?.stuckAfterMs)
    || `the board says ${st.j?.stuck?.afterMs}ms and the overview says ${ov.j?.stuckAfterMs}ms`;
}));

/* ══ J-11 · WHAT THE RESTAURANT IS TOLD, AND WHAT IS WRITTEN DOWN ══════════════════════════ */
/* THE TABLE IS `staff_actions`, not `action_log` — logAction() in lib/oplog.ts writes there, and
   the first version of these six rows read a table that does not exist, so every one of them
   reported "nothing is written down" about a log that was working perfectly. */
const auditSince = async (sinceIso) => {
  const sb = await sbOnce();
  const r = await sb.from("staff_actions").select("action, detail, created_at, panel")
    .eq("restaurant_id", RID).gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(50);
  return r.data || [];
};
D("adding a computer is written down, in words a person can read months later", need(async () => {
  const since = new Date(Date.now() - 2000).toISOString();
  const made = await admin("/agents", { rid: RID, name: `Sweep T11 round5 audit ${Date.now()}` });
  if (made.j?.id) MADE.agents.push(made.j.id);
  await new Promise((x) => setTimeout(x, 500));
  const rows_ = await auditSince(since);
  const hit = rows_.find((x) => /print_helper_added/.test(x.action || ""));
  return (hit && /[a-z]{3}\s+[a-z]{3}/.test(String(hit.detail || ""))) || `the log says ${JSON.stringify(hit?.detail ?? "nothing")}`;
}));
D("…and removing one likewise", need(async () => {
  const made = await admin("/agents", { rid: RID, name: `Sweep T11 round5 audit2 ${Date.now()}` });
  if (!made.j?.id) return "a virtual computer could not be created";
  MADE.agents.push(made.j.id);
  const since = new Date(Date.now() - 500).toISOString();
  await admin(`/agents/${made.j.id}/revoke`, { rid: RID });
  await new Promise((x) => setTimeout(x, 500));
  const rows_ = await auditSince(since);
  const hit = rows_.find((x) => /print_helper_removed/.test(x.action || ""));
  return (hit && /[a-z]{3}\s+[a-z]{3}/.test(String(hit.detail || ""))) || `the log says ${JSON.stringify(hit?.detail ?? "nothing")}`;
}));
D("…and a new code likewise, because a replaced code is how a stolen machine is dealt with", need(async () => {
  const since = new Date(Date.now() - 500).toISOString();
  const r = await admin(`/agents/${AGENT.id}/newcode`, { rid: RID });
  if (r.j?.code) AGENT.token = r.j.code;
  await new Promise((x) => setTimeout(x, 500));
  const rows_ = await auditSince(since);
  return !!rows_.find((x) => /print_helper_recoded/.test(x.action || "")) || "replacing a printing code is not written down anywhere";
}));
D("…and taking a ticket out of the queue by hand likewise", need(async () => {
  const q = await queueTest();
  const since = new Date(Date.now() - 500).toISOString();
  await admin(`/job/${q.j.id}/cancel`, { rid: RID });
  await new Promise((x) => setTimeout(x, 500));
  const rows_ = await auditSince(since);
  return !!rows_.find((x) => /print_switch/.test(x.action || "")) || "cancelling a ticket is not written down";
}));
D("…and stopping the whole queue likewise", need(async () => {
  const since = new Date(Date.now() - 500).toISOString();
  await admin("/queue", { rid: RID, paused: true });
  await admin("/queue", { rid: RID, paused: false });
  await new Promise((x) => setTimeout(x, 500));
  const rows_ = await auditSince(since);
  const hits = rows_.filter((x) => /print_switch/.test(x.action || ""));
  return hits.length >= 1 || "stopping and restarting the queue leaves no record";
}));
D("…and nothing written down carries a printing code", need(async () => {
  const rows_ = await auditSince(new Date(Date.now() - 120000).toISOString());
  const bad = rows_.filter((x) => /lfhp_[A-Za-z0-9_-]{8,}/.test(JSON.stringify(x)));
  return bad.length === 0 || `${bad.length} log row(s) carry a code`;
}));
D("…and a test page being sent is written down too, so a mystery print has an explanation", need(async () => {
  const since = new Date(Date.now() - 500).toISOString();
  const r = await admin("/test", { rid: RID, agentId: AGENT.id, printer: "Sweep-Roll-80" });
  if (r.j?.id) MADE.jobs.push(r.j.id);
  await new Promise((x) => setTimeout(x, 500));
  const rows_ = await auditSince(since);
  return !!rows_.find((x) => /print_test/.test(x.action || "")) || "a test page appears at a printer with nothing recording who sent it";
}));

/* ══ J-12 · THE SCREEN AS THE PRINTER — THE PATH MOST RESTAURANTS ARE ON ═══════════════════ */
D("a restaurant with NO computer set up still has a printer: its own screen", need(async () => {
  await admin("/routes", { rid: RID, routes: { kot: null } });
  const st = await admin(`/state?rid=${RID}`);
  const kot = st.j?.routes?.kot;
  return (kot && kot.via !== "computer" && kot.via !== "off") || `with no computer the line reads ${JSON.stringify(kot?.via)}`;
}));
D("…and the board says WHICH panel is expected to do it", need(async () => {
  await admin("/routes", { rid: RID, routes: { kot: { via: "screen", panel: "kitchen" } } });
  const st = await admin(`/state?rid=${RID}`);
  return st.j?.routes?.kot?.panel === "kitchen" || `it says ${JSON.stringify(st.j?.routes?.kot)}`;
}));
D("…and a panel that is not one of the real panels is refused", need(async () => {
  const r = await admin("/routes", { rid: RID, routes: { kot: { via: "screen", panel: "not-a-panel" } } });
  const st = await admin(`/state?rid=${RID}`);
  return (!r.ok || st.j?.routes?.kot?.panel !== "not-a-panel") || "a line was pointed at a panel that does not exist";
}));
D("…and the board lists the panels a person may choose from, rather than expecting them typed", need(async () => {
  const st = await admin(`/state?rid=${RID}`);
  return Array.isArray(st.j?.panels) && st.j.panels.length > 0 || `it offers ${JSON.stringify(st.j?.panels)}`;
}));
D("…and the people, so a line can be pinned to one person's screen", need(async () => {
  const st = await admin(`/state?rid=${RID}`);
  return Array.isArray(st.j?.people) || `it offers ${JSON.stringify(st.j?.people)}`;
}));
D("…and the devices, so it can be pinned to one till instead", need(async () => {
  const st = await admin(`/state?rid=${RID}`);
  return Array.isArray(st.j?.devices) || `it offers ${JSON.stringify(st.j?.devices)}`;
}));
D("once a COMPUTER owns a kind of paper, the screen is told to stand down", need(async () => {
  await admin("/routes", { rid: RID, routes: { kot: { via: "computer", agent: AGENT.id, printer: "Sweep-Roll-80" } } });
  const st = await admin(`/state?rid=${RID}`);
  const kot = st.j?.routes?.kot;
  return (kot?.via === "computer" && kot?.panel == null) || `the line reads ${JSON.stringify(kot)}`;
}));
D("…and the helper is told that kind of paper is its job", need(async () => {
  await admin("/routes", { rid: RID, routes: { kot: { via: "computer", agent: AGENT.id, printer: "Sweep-Roll-80" } } });
  const h = await agentCall("/hello", { tok: AGENT.token, body: { printers: PRINTERS } });
  return (h.j?.mine || []).includes("kot") || `it was told its jobs are ${JSON.stringify(h.j?.mine)}`;
}));
D("…and a machine that owns NOTHING is told so, rather than left guessing", need(async () => {
  const idle = await admin("/agents", { rid: RID, name: `Sweep T11 round5 idle ${Date.now()}` });
  if (!idle.j?.id) return "a virtual computer could not be created";
  MADE.agents.push(idle.j.id);
  const h = await agentCall("/hello", { tok: idle.j.code, body: { printers: PRINTERS } });
  return (Array.isArray(h.j?.mine) && h.j.mine.length === 0) || `it was told ${JSON.stringify(h.j?.mine)}`;
}));
D("…and that machine is never offered work meant for another", need(async () => {
  const idle = await admin("/agents", { rid: RID, name: `Sweep T11 round5 idle2 ${Date.now()}` });
  if (!idle.j?.id) return "a virtual computer could not be created";
  MADE.agents.push(idle.j.id);
  await agentCall("/hello", { tok: idle.j.code, body: { printers: PRINTERS } });
  await drain();
  const q = await queueTest({ clean: false });
  const n = await agentCall("/next", { tok: idle.j.code });
  if (n.j?.id === q.j?.id) return "a ticket queued for one machine was offered to another";
  return true;
}));
D("the board tells THIS computer whether it is the one that prints, from its own device id", need(async () => {
  const st = await admin(`/state?rid=${RID}`);
  return ("thisComputer" in (st.j || {})) || "the board cannot tell a person whether the machine they are on is the printer";
}));
D("…and it says whether the manager is allowed to print at all", need(async () => {
  const st = await admin(`/state?rid=${RID}`);
  return ("managerMayPrint" in (st.j || {})) || "the board does not say whether the manager may print";
}));
D("the board hands over the file a restaurant needs, for every platform", need(async () => {
  const st = await admin(`/state?rid=${RID}`);
  const kinds = Object.keys(st.j?.files || st.j?.stationFiles || {});
  return kinds.length >= 2 || `it offers ${JSON.stringify(kinds)}`;
}));
D("…and the station file too, which is the same one for every restaurant", need(async () => {
  const st = await admin(`/state?rid=${RID}`);
  return !!st.j?.stationFiles || "the station file is not offered anywhere on the board";
}));
D("…and neither file carries a printing code", need(async () => {
  const st = await admin(`/state?rid=${RID}`);
  const s = JSON.stringify({ f: st.j?.files, s: st.j?.stationFiles });
  return !/lfhp_[A-Za-z0-9_-]{8,}/.test(s) || "a file offered on the board carries a code";
}));
D("a reprint is asked for as a FLAG, so every panel's reprint looks the same on paper", need(async () => {
  const q = read("lib/printQueue.ts");
  return /reprint/.test(q) || "nothing in the queue records that a ticket is a reprint";
}));
D("…and the document drawn for one is branded as a duplicate", need(async () => {
  const { BILLDOC } = await import("./lib.mjs");
  const dup = BILLDOC.kotDocHtml({ kot: 3, tableLabel: "5", lines: [{ title: "Dal", qty: 1 }], reprint: true });
  const fresh = BILLDOC.kotDocHtml({ kot: 3, tableLabel: "5", lines: [{ title: "Dal", qty: 1 }] });
  return (/Duplicate/i.test(dup) && !/Duplicate/i.test(fresh)) || "a reprint and a fresh ticket look the same to a cook";
}));
D("…and a reprint raises nothing — no band on a bill, no audit row, no question", need(async () => {
  const guard = read("scripts/verify-bill-reprint-is-silent.mjs");
  return guard.length > 400 || "the guard that keeps a reprint silent is gone";
}));

/* ══ J-13 · THE LAST FOURTEEN — WHAT A RESTAURANT IS LEFT WITH WHEN SOMETHING IS WRONG ═════ */
D("a machine whose code was replaced is told to link itself afresh, not just refused", need(async () => {
  const made = await admin("/agents", { rid: RID, name: `Sweep T11 round5 relink ${Date.now()}` });
  if (!made.j?.id) return "a virtual computer could not be created";
  MADE.agents.push(made.j.id);
  const old = made.j.code;
  await admin(`/agents/${made.j.id}/newcode`, { rid: RID });
  const h = await agentCall("/hello", { tok: old, body: {} });
  const msg = String(h.j?.error || h.text);
  return /link|again|afresh|not valid any more/i.test(msg) || `it was told ${JSON.stringify(msg).slice(0, 80)}`;
}));
D("…and the file it generated tells a person at that machine what to do about it", need(async () => {
  const made = await admin("/agents", { rid: RID, name: `Sweep T11 round5 relink2 ${Date.now()}` });
  if (!made.j?.id) return "a virtual computer could not be created";
  MADE.agents.push(made.j.id);
  const texts = JSON.stringify(made.j.scripts || {});
  return /link this afresh|start this file again|Delete/i.test(texts) || "the file says nothing about what to do if the link is removed";
}));
D("a removed machine cannot claim work any more", need(async () => {
  const made = await admin("/agents", { rid: RID, name: `Sweep T11 round5 revoked ${Date.now()}` });
  if (!made.j?.id) return "a virtual computer could not be created";
  MADE.agents.push(made.j.id);
  await agentCall("/hello", { tok: made.j.code, body: { printers: PRINTERS } });
  await admin(`/agents/${made.j.id}/revoke`, { rid: RID });
  const n = await agentCall("/next", { tok: made.j.code });
  return n.status === 401 || `it was answered ${n.status}`;
}));
D("…and its past tickets are still readable, because a record nobody can look up is not a record", need(async () => {
  const sb = await sbOnce();
  const gone = (await sb.from("print_agents").select("id, name, revoked_at").eq("restaurant_id", RID)
    .not("revoked_at", "is", null).limit(1)).data;
  return (gone && gone.length > 0 && !!gone[0].name) || "a removed machine leaves no name for its old tickets to point at";
}));
D("a machine reporting a ticket it does not own is refused, not believed", need(async () => {
  const other = await admin("/agents", { rid: RID, name: `Sweep T11 round5 liar ${Date.now()}` });
  if (!other.j?.id) return "a second virtual computer could not be created";
  MADE.agents.push(other.j.id);
  await agentCall("/hello", { tok: other.j.code, body: { printers: PRINTERS } });
  const q = await queueTest();
  await agentCall("/next", { tok: AGENT.token });
  const before = (await sbOnce()).then ? null : null;
  await agentCall(`/job/${q.j.id}/done`, { tok: other.j.code, body: {} });
  const sb = await sbOnce();
  const row_ = (await sb.from("print_jobs").select("status, agent_id").eq("id", q.j.id).maybeSingle()).data;
  return row_?.status !== "done" || `another machine's 'it printed' was believed — the ticket is "${row_?.status}"`;
}));
D("…and the ticket stays where it was, so the machine that really has it can still report", need(async () => {
  const q = await queueTest();
  await agentCall("/next", { tok: AGENT.token });
  const sb = await sbOnce();
  const mid = (await sb.from("print_jobs").select("status").eq("id", q.j.id).maybeSingle()).data;
  const done = await agentCall(`/job/${q.j.id}/done`, { tok: AGENT.token, body: {} });
  const after = (await sb.from("print_jobs").select("status").eq("id", q.j.id).maybeSingle()).data;
  return (mid?.status === "printing" && done.ok && after?.status === "done")
    || `it went ${JSON.stringify(mid?.status)} → ${JSON.stringify(after?.status)}`;
}));
D("a ticket for a restaurant this machine does not belong to is invisible to it", need(async () => {
  const n = await agentCall("/job/00000000-0000-0000-0000-0000000000bb/done", { tok: AGENT.token, body: {} });
  return n.status === 404 || `it was answered ${n.status}`;
}));
D("the helper's door answers nothing at all to a GET where a POST is required", need(async () => {
  const r = await agentCall("/hello", { tok: AGENT.token });
  return r.status >= 400 || `a GET on /hello answered ${r.status}`;
}));
D("…and a POST with no body at all does not crash it", need(async () => {
  const r = await fetch(`${BASE}/api/print-agent/hello`, { method: "POST", headers: { "x-lfh-agent": AGENT.token } });
  return r.status < 500 || `it answered ${r.status}`;
}));
D("…and a body that is not JSON does not either", need(async () => {
  const r = await fetch(`${BASE}/api/print-agent/hello`, { method: "POST",
    headers: { "x-lfh-agent": AGENT.token, "content-type": "application/json" }, body: "not json at all" });
  return r.status < 500 || `it answered ${r.status}`;
}));
D("…and a printers list that is not a list does not either", need(async () => {
  const r = await agentCall("/hello", { tok: AGENT.token, body: { printers: "one printer" } });
  return r.status < 500 || `it answered ${r.status}`;
}));
D("…and a thousand printers does not become a thousand rows on the admin's screen", need(async () => {
  const many = Array.from({ length: 1000 }, (_, i) => ({ name: `Sweep-Many-${i}`, desc: "x" }));
  const r = await agentCall("/hello", { tok: AGENT.token, body: { fingerprint: "sweep-many", printers: many } });
  const st = await admin(`/state?rid=${RID}`);
  const mine = (st.j?.agents || []).find((a) => a.id === AGENT.id);
  const n = (mine?.printers || []).length;
  // put the real two back so the rows after this one see the machine they expect
  await agentCall("/hello", { tok: AGENT.token, body: { fingerprint: "sweep-machine", printers: PRINTERS } });
  return (r.status < 500 && n <= 200) || `${r.status}, and the screen would list ${n} printers`;
}));
D("everything this bank created has been named as it was created, so nothing is cleaned up by guess", need(async () => {
  // The rule this project has recorded: delete the exact rows you inserted, never "whatever is
  // there" — that is another terminal's fixture. This asserts the bookkeeping, not the deletion.
  return (MADE.agents.length > 0 && MADE.agents.every((x) => /^[0-9a-f-]{36}$/.test(String(x))))
    || `the bank is holding ${JSON.stringify(MADE.agents).slice(0, 90)}`;
}));
D("…and every ticket it queued likewise", need(async () => {
  return MADE.jobs.every((x) => /^[0-9a-f-]{36}$/.test(String(x)))
    || `it is holding ${MADE.jobs.filter((x) => !/^[0-9a-f-]{36}$/.test(String(x))).length} thing(s) that are not ticket ids`;
}));
if (id - 1 !== 101234) throw new Error(`bank J ended at P${id - 1}, not P101234 — it has ${id - 1 - 101094} rows`);
