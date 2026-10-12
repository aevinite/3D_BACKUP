// Bank F · app/api/print-agent/[...path]/route.ts — the helper's door, DRIVEN on my own port.
//
// One real computer is made the only way there is: the admin board hands out a setup code (French
// House — the restaurant sweeps write to), and a claim redeems it, exactly as a helper does. Every
// job it prints is a TEST page addressed to that computer alone, so nothing can reach another
// machine — not even the owner's own PC, which is linked to French House too. Everything made is
// deleted by its own id at the end, on a pass, a failure or a Ctrl-C.
//
// NOT DRIVEN, ON PURPOSE (S10-RULES §7): no call without a credential, no other restaurant's job id
// sent, no fifth failure (it would page the owner). Those are proved by reading the code — rows below.
import { chk, skip, assert, eq, src, codeOnly, onFinish } from "./lib.mjs";
import { sb as service, BASE } from "./env.mjs";
import { adminHeaders } from "../login.mjs";

const F = "app/api/print-agent/[...path]/route.ts";
const R = "read today's code (comments stripped)";
const D = `driven on ${BASE} (my port) through the real doors`;
const code = codeOnly(src(F));
const ADMIN = adminHeaders(BASE);
const db = await service();
const FH = (await db.from("restaurants").select("id").eq("slug", "french-house").maybeSingle()).data?.id;
const up = await fetch(BASE + "/print-setup.html").then((r) => r.ok).catch(() => false);
const MADE = { agents: [], jobs: [] };
onFinish(async () => {
  if (MADE.jobs.length) await db.from("print_jobs").delete().in("id", MADE.jobs).eq("restaurant_id", FH);
  // every ticket queued for one of OUR computers, including any the admin test verb made
  for (const a of MADE.agents) {
    await db.from("print_jobs").delete().eq("agent_id", a).eq("restaurant_id", FH);
    await db.from("print_setup_codes").delete().eq("agent_id", a).eq("restaurant_id", FH);
    await db.from("print_agents").delete().eq("id", a).eq("restaurant_id", FH);
  }
});

const admin = (path, body) => fetch(`${BASE}/api/admin/printing/${path}`, { method: "POST", headers: { ...ADMIN, "content-type": "application/json" }, body: JSON.stringify({ rid: FH, ...body }) })
  .then(async (r) => ({ status: r.status, j: await r.json().catch(() => null) }));
const agentCall = (path, { tok, body, method } = {}) => fetch(`${BASE}/api/print-agent${path}`, {
  method: method || (body ? "POST" : "GET"), headers: { ...(tok ? { "x-lfh-agent": tok } : {}), ...(body ? { "content-type": "application/json" } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, headers: r.headers, text: await r.text() })).then((r) => ({ ...r, j: (() => { try { return JSON.parse(r.text); } catch { return null; } })() }));
const PRINTERS = [{ name: "ZZ-T15-Roll", desc: "sweep #10 T15 — not a real printer", paper: { wMm: 80, hMm: 297 }, state: "ready" }, { name: "ZZ-T15-Wide", state: "ready" }];

// ── code-reading rows ───────────────────────────────────────────────────────────────────────
await chk("P184309", F, "every verb but pair/claim looks the caller's token up BEFORE any other work, on both GET and POST", R, () => {
  for (const verb of ["export async function POST", "export async function GET"]) {
    const body = code.slice(code.indexOf(verb)); const gate = body.indexOf("if (!agent) return err("); const firstSb = body.search(/\bsb\.from\(|readRoutes\(|claimSome\(|claimNext\(|helloAgent\(/);
    assert(gate > 0 && gate < firstSb, `${verb}: work happens before the token check`);
  }
});
await chk("P184310", F, "the restaurant is ALWAYS the computer's own (agent.restaurant_id), never a field of the request", R, () => {
  assert(!/body\.(rid|restaurant_id|restaurantId)|searchParams\.get\("(rid|restaurant)/.test(code), "the request names a restaurant");
  assert((code.match(/agent\.restaurant_id/g) || []).length >= 10, "too few statements use the agent's restaurant");
});
await chk("P184311", F, "pair/claim is the ONLY verb answered before the token check", R, () => {
  const post = code.slice(code.indexOf("export async function POST")); const pre = post.slice(0, post.indexOf("const agent = await whoIsAsking"));
  eq([...pre.matchAll(/seg\[0\] === "([a-z]+)"/g)].map((x) => x[1]), ["pair"]);
});
await chk("P184312", F, "…and it is behind a 20-in-ten-minutes wall per address before the code is even looked at", R, () => {
  const i = code.indexOf('seg[0] === "pair"'); const blk = code.slice(i, i + 1500); assert(blk.indexOf("rateAllowed(") > 0 && blk.indexOf("rateAllowed(") < blk.indexOf("claimSetupCode("));
});
await chk("P184313", F, "…a code that worked clears that wall, so setting up eight machines in one sitting is never walled", R, () => assert(/if \(r\.ok\) await rateResetOnSuccess\("print_setup_code"/.test(code)));
await chk("P184314", F, "every database statement in the file names this computer's restaurant", R, () => {
  const stmts = code.split(/(?=sb\.from\()/).slice(1).map((s) => s.slice(0, s.search(/;\s*\n|\)\s*\n\s*\n/) > 0 ? s.search(/;\s*\n/) : 400));
  assert(stmts.length >= 8, String(stmts.length)); for (const s of stmts) assert(/restaurant_id|\.eq\("id", agent\.restaurant_id\)/.test(s), s.slice(0, 120));
});
await chk("P184315", F, "only the computer that claimed a job may fetch its document (409 otherwise)", R, () => assert(/if \(job\.agent_id !== agent\.id\) return err\("That job belongs to another computer\.", 409\)/.test(code)));
await chk("P184316", F, "…or report it done/failed (the claim is the safety)", R, () => assert(/if \(job\.agent_id && job\.agent_id !== agent\.id\) return err\("That job belongs to another computer\.", 409\)/.test(code)));
await chk("P184317", F, "a bill/banquet failure report can never put back a page somebody took out", R, () => assert(/\.in\("status", \["queued", "printing", "failed"\]\)\.select\("id"\)\.maybeSingle\(\)/.test(code)));
await chk("P184318", F, "a bill/banquet that gives up after five tries tells somebody (the same function as kitchen slips)", R, () => assert(/if \(parked\) \{\s*await tellSomebodyItGaveUp\(agent\.restaurant_id/.test(code)));
await chk("P184319", F, "a job it cannot draw is CLOSED as dismissed with the reason, not retried for ever", R, () => assert(/if \(!html\) \{\s*await sb\.from\("print_jobs"\)\.update\(\{\s*status: "dismissed"/.test(code)));
await chk("P184320", F, "the document's paper size comes from the route or the machine's own report, and travels as a header", R, () => assert(/paperFor\(routes\[job\.kind/.test(code) && /"x-lfh-paper"/.test(code) && /"x-lfh-printer": job\.printer/.test(code)));
await chk("P184321", F, "the idle answer is a 204 with no body, every time (a 2-second poll must cost nothing)", R, () => assert((code.match(/new NextResponse\(null, \{ status: 204 \}\)/g) || []).length >= 4));
await chk("P184322", F, "no answer echoes a database error message to the helper", R, () => assert(!/\.error\.message|error\?\.message/.test(code)));
await chk("P184323", F, "the claim answer is 200 either way, with ok carrying it (the helpers branch on ok, not on status)", R, () => assert(/return NextResponse\.json\(r, \{ headers: \{ "Cache-Control": "no-store" \} \}\)/.test(code)));
await chk("P184324", F, "the setup-code answer is never cached anywhere (no-store on the claim and the wall)", R, () => assert((code.match(/"Cache-Control": "no-store"/g) || []).length >= 2));

// ── driven ──────────────────────────────────────────────────────────────────────────────────
const SKIP = !up || !FH ? `needs the app on ${BASE} and French House in the dev database` : null;
let A = null, B = null;
if (SKIP) {
  for (let n = 325; n <= 362; n++) skip(`P184${n}`, F, "driven row", D, SKIP);
} else {
  const join = async (host) => {
    const c = await admin("setup-code", {}); if (!c.j?.code) throw new Error(`no setup code: ${c.status} ${JSON.stringify(c.j)}`);
    const r = await agentCall("/pair/claim", { body: { code: c.j.code, helper: "t15s10", hostname: host, os: "test", printers: PRINTERS } });
    if (r.j?.agentId) MADE.agents.push(r.j.agentId);
    return { c, r };
  };
  let first = null;
  await chk("P184325", F, "a setup code from the admin board, typed into the claim, links a computer to French House", D, async () => {
    first = await join(`ZZ T15 sweep ${Date.now()}`); eq(first.r.j?.ok, true); A = { id: first.r.j.agentId, tok: first.r.j.token, name: first.r.j.name };
    const row = (await db.from("print_agents").select("restaurant_id, name").eq("id", A.id).maybeSingle()).data; eq(row.restaurant_id, FH);
  });
  await chk("P184326", F, "…the reply names the restaurant and the computer, for the helper's 'Linked to' line", D, () => { assert(first?.r.j.restaurant && /ZZ T15 sweep/.test(first.r.j.name), JSON.stringify(first?.r.j)); });
  await chk("P184327", F, "…the claim answer is marked no-store", D, () => eq(first?.r.headers.get("cache-control"), "no-store"));
  await chk("P184328", F, "…the same code a second time is the wrong-code sentence, and makes no second computer", D, async () => {
    const r = await agentCall("/pair/claim", { body: { code: first.c.j.code, helper: "t15s10", hostname: "again", printers: [] } });
    eq(r.j?.ok, false); assert(/not right, or it has run out/.test(r.j.error)); eq((await db.from("print_agents").select("id").eq("restaurant_id", FH).eq("name", "again").limit(1)).data.length, 0);
  });
  await chk("P184329", F, "hello answers ok, this computer's name, a poll interval and nothing it does not own", D, async () => {
    const r = await agentCall("/hello", { tok: A.tok, body: { fingerprint: "t15s10-fp", printers: PRINTERS } });
    eq(r.status, 200); eq([r.j.ok, r.j.agent.id, r.j.pollMs], [true, A.id, 2000]); eq(r.j.mine, []); assert(!("backupFor" in r.j), "the retired backupFor field is back");
  });
  await chk("P184330", F, "…the printers it reported are on its row at once", D, async () => {
    const row = (await db.from("print_agents").select("printers").eq("id", A.id).maybeSingle()).data; eq(row.printers.map((p) => p.name), ["ZZ-T15-Roll", "ZZ-T15-Wide"]);
  });
  await chk("P184331", F, "…a hello from a SECOND machine with the same code is warned about, by the server", D, async () => {
    const r = await agentCall("/hello", { tok: A.tok, body: { fingerprint: "t15s10-other-machine", printers: PRINTERS } });
    assert(/in use on another computer too/.test(r.j.warning || ""), JSON.stringify(r.j)); await agentCall("/hello", { tok: A.tok, body: { fingerprint: "t15s10-fp", printers: PRINTERS } });
  });
  await chk("P184332", F, "with nothing to print, /next answers 204 with an empty body", D, async () => { const r = await agentCall("/next", { tok: A.tok }); eq([r.status, r.text], [204, ""]); });
  await chk("P184333", F, "…the batch form (?max=4) answers 204 too when there is nothing", D, async () => { const r = await agentCall("/next?max=4", { tok: A.tok }); eq(r.status, 204); });
  let t1 = null;
  await chk("P184334", F, "the admin's 'Print a test page' queues a job for THIS computer and printer", D, async () => {
    const r = await admin("test", { agentId: A.id, printer: "ZZ-T15-Roll" }); eq(r.status, 200); t1 = r.j.id; MADE.jobs.push(t1);
    const row = (await db.from("print_jobs").select("kind, agent_id, printer, status").eq("id", t1).maybeSingle()).data; eq([row.kind, row.agent_id, row.printer, row.status], ["test", A.id, "ZZ-T15-Roll", "queued"]);
  });
  await chk("P184335", F, "…/next hands it over, naming the printer and where the document is", D, async () => {
    const r = await agentCall("/next", { tok: A.tok }); eq(r.status, 200); eq([r.j.id, r.j.printer, r.j.document], [t1, "ZZ-T15-Roll", `/api/print-agent/job/${t1}/document`]);
  });
  await chk("P184336", F, "…and the job is now 'printing', claimed by this computer, printed_by its name", D, async () => {
    const row = (await db.from("print_jobs").select("status, agent_id, printed_by, claimed_at").eq("id", t1).maybeSingle()).data; eq([row.status, row.agent_id, row.printed_by], ["printing", A.id, A.name]); assert(row.claimed_at);
  });
  await chk("P184337", F, "…a second /next does not hand the same job out again", D, async () => { eq((await agentCall("/next", { tok: A.tok })).status, 204); });
  let doc = null;
  await chk("P184338", F, "the document is real HTML, not cached, and names the printer in a header", D, async () => {
    doc = await agentCall(`/job/${t1}/document`, { tok: A.tok }); eq(doc.status, 200); assert(/text\/html/.test(doc.headers.get("content-type")));
    eq(doc.headers.get("x-lfh-printer"), "ZZ-T15-Roll"); eq(doc.headers.get("cache-control"), "no-store");
  });
  await chk("P184339", F, "…the paper the machine reported (80 × 297 mm) travels as x-lfh-paper", D, () => eq(doc?.headers.get("x-lfh-paper"), "80x297mm"));
  await chk("P184340", F, "…the test page names this restaurant and this computer, and shows no code text", D, () => {
    assert(/French House/i.test(doc.text) && doc.text.includes(A.name), "the page does not say whose it is"); assert(!/undefined|NaN|\[object Object\]|\$\{/.test(doc.text.replace(/<script[\s\S]*?<\/script>/g, "")), "leaked code text");
  });
  await chk("P184341", F, "reporting it done closes it as done", D, async () => {
    const r = await agentCall(`/job/${t1}/done`, { tok: A.tok, body: {} }); eq(r.j?.ok, true); eq((await db.from("print_jobs").select("status, done_at").eq("id", t1).maybeSingle()).data.status, "done");
  });
  await chk("P184342", F, "a job id that is not one of this restaurant's jobs is 'No such print job.' (404)", D, async () => {
    const r = await agentCall("/job/00000000-0000-4000-8000-000000000000/done", { tok: A.tok, body: {} }); eq([r.status, r.j?.error], [404, "No such print job."]);
  });
  await chk("P184343", F, "an unknown verb is a plain 404, never a crash", D, async () => {
    const g = await agentCall("/nothing-here", { tok: A.tok }); const p = await agentCall("/nothing-here", { tok: A.tok, body: {} }); eq([g.status, p.status, g.j?.error], [404, 404, "Unknown request."]);
  });
  await chk("P184344", F, "a broken JSON body is answered, not crashed", D, async () => {
    const r = await fetch(`${BASE}/api/print-agent/hello`, { method: "POST", headers: { "x-lfh-agent": A.tok, "content-type": "application/json" }, body: "{not json" }); assert(r.status < 500, String(r.status));
  });
  await chk("P184345", F, "the token is accepted as Authorization: Bearer too", D, async () => {
    const r = await fetch(`${BASE}/api/print-agent/next`, { headers: { authorization: `Bearer ${A.tok}` } }); eq(r.status, 204);
  });
  let t2 = null;
  await chk("P184346", F, "a failed print goes back in the queue with its reason and one attempt counted", D, async () => {
    const q = await admin("test", { agentId: A.id, printer: "ZZ-T15-Roll" }); t2 = q.j.id; MADE.jobs.push(t2);
    await agentCall("/next", { tok: A.tok }); const r = await agentCall(`/job/${t2}/failed`, { tok: A.tok, body: { error: "T15 sweep: no paper" } });
    eq([r.j.ok, r.j.parked, r.j.attempts], [true, false, 1]); const row = (await db.from("print_jobs").select("status, attempts, error, claimed_at").eq("id", t2).maybeSingle()).data;
    eq([row.status, row.attempts, row.error, row.claimed_at], ["queued", 1, "T15 sweep: no paper", null]);
  });
  await chk("P184347", F, "…a failure reported for a page that was TAKEN OUT meanwhile stays taken out", D, async () => {
    await agentCall("/next", { tok: A.tok }); const c = await admin(`job/${t2}/cancel`, {}); eq(c.status, 200);
    const r = await agentCall(`/job/${t2}/failed`, { tok: A.tok, body: { error: "late" } }); eq(r.j.takenOut, true);
    const row = (await db.from("print_jobs").select("status, error").eq("id", t2).maybeSingle()).data; eq(row.status, "dismissed"); assert(!/late/.test(row.error), row.error);
  });
  await chk("P184348", F, "…and the admin's 'Print it again' puts it back with its count reset", D, async () => {
    eq((await admin(`job/${t2}/retry`, {})).status, 200); const row = (await db.from("print_jobs").select("status, attempts").eq("id", t2).maybeSingle()).data; eq([row.status, row.attempts], ["queued", 0]);
  });
  await chk("P184349", F, "the batch form hands back {jobs:[…]}, at most two per printer, oldest first", D, async () => {
    for (const p of ["ZZ-T15-Roll", "ZZ-T15-Roll", "ZZ-T15-Wide"]) { const q = await admin("test", { agentId: A.id, printer: p }); MADE.jobs.push(q.j.id); }
    const r = await agentCall("/next?max=4", { tok: A.tok }); eq(r.status, 200); assert(Array.isArray(r.j.jobs), JSON.stringify(r.j));
    const roll = r.j.jobs.filter((x) => x.printer === "ZZ-T15-Roll").length; assert(roll <= 2 && r.j.jobs.some((x) => x.printer === "ZZ-T15-Wide"), JSON.stringify(r.j.jobs.map((x) => x.printer)));
    for (const x of r.j.jobs) await agentCall(`/job/${x.id}/done`, { tok: A.tok, body: {} });
  });
  await chk("P184350", F, "…every job in a batch carries the same fields the single answer does", D, async () => {
    const q = await admin("test", { agentId: A.id, printer: "ZZ-T15-Wide" }); MADE.jobs.push(q.j.id); const r = await agentCall("/next?max=2", { tok: A.tok });
    const keys = Object.keys(r.j.jobs[0]).sort(); eq(keys, ["attempts", "document", "id", "kind", "printer", "reprint"]); await agentCall(`/job/${r.j.jobs[0].id}/done`, { tok: A.tok, body: {} });
  });
  let tB = null;
  await chk("P184351", F, "a SECOND computer joins with its own code; the first code is already spent", D, async () => {
    const { r } = await join(`ZZ T15 second ${Date.now()}`); eq(r.j.ok, true); B = { id: r.j.agentId, tok: r.j.token };
  });
  await chk("P184352", F, "…a job queued for computer A is never handed to computer B", D, async () => {
    const q = await admin("test", { agentId: A.id, printer: "ZZ-T15-Roll" }); tB = q.j.id; MADE.jobs.push(tB); eq((await agentCall("/next?max=4", { tok: B.tok })).status, 204);
  });
  await chk("P184353", F, "…B cannot fetch A's document (409)", D, async () => { await agentCall("/next", { tok: A.tok }); eq((await agentCall(`/job/${tB}/document`, { tok: B.tok })).status, 409); });
  await chk("P184354", F, "…nor mark A's job printed (409), and the job stays exactly as it was", D, async () => {
    eq((await agentCall(`/job/${tB}/done`, { tok: B.tok, body: {} })).status, 409); eq((await db.from("print_jobs").select("status, agent_id").eq("id", tB).maybeSingle()).data.status, "printing");
    await agentCall(`/job/${tB}/done`, { tok: A.tok, body: {} });
  });
  await chk("P184355", F, "unlinking a computer on the admin board ends its token at once — the next hello is 401 with a plain sentence", D, async () => {
    eq((await admin(`agents/${B.id}/revoke`, {})).status, 200); const r = await agentCall("/hello", { tok: B.tok, body: {} });
    eq([r.status, r.j?.error], [401, "This computer's printing code is not valid any more."]);
  });
  await chk("P184356", F, "…and /next as well (the helpers read a 401 as 'unlinked', anything else as a blip)", D, async () => { eq((await agentCall("/next", { tok: B.tok })).status, 401); });
  await chk("P184357", F, "…while the OTHER computer keeps printing", D, async () => { eq((await agentCall("/hello", { tok: A.tok, body: { fingerprint: "t15s10-fp" } })).j?.ok, true); });
  await chk("P184358", F, "a claim with a made-up code is the same 200 + ok:false sentence (one wrong try, by design)", D, async () => {
    const r = await agentCall("/pair/claim", { body: { code: "ZZZZZZ", helper: "t15s10", hostname: "t15", os: "test" } }); eq(r.status, 200); eq(r.j.ok, false); assert(!r.j.token);
  });
  await chk("P184359", F, "an out-of-date helper (no stamp) with a GOOD code is told so, and the code survives for the right file", D, async () => {
    const c = await admin("setup-code", {}); const r = await agentCall("/pair/claim", { body: { code: c.j.code, hostname: "old-file", os: "test" } });
    eq(r.j.reason, "oldfile"); const st = await fetch(`${BASE}/api/admin/printing/state?rid=${FH}`, { headers: ADMIN }).then((x) => x.json());
    eq(st.setupCode.live, true); assert(st.setupCode.oldFileAt, "the board was not told");
    const ok = await agentCall("/pair/claim", { body: { code: c.j.code, helper: "t15s10", hostname: `ZZ T15 third ${Date.now()}`, os: "test", printers: [] } }); eq(ok.j.ok, true); MADE.agents.push(ok.j.agentId);
  });
  await chk("P184360", F, "every computer this bank made is on French House and nowhere else", D, async () => {
    const rows = (await db.from("print_agents").select("restaurant_id").in("id", MADE.agents)).data; assert(rows.length === MADE.agents.length && rows.every((r) => r.restaurant_id === FH));
  });
  await chk("P184361", F, "every job this bank made was addressed to one of its own computers (nothing reached the owner's PC)", D, async () => {
    const rows = (await db.from("print_jobs").select("agent_id").in("id", MADE.jobs)).data; assert(rows.every((r) => MADE.agents.includes(r.agent_id)), JSON.stringify(rows));
  });
  await chk("P184362", F, "the admin board lists the computer by the name its machine reported, with its printers", D, async () => {
    const st = await fetch(`${BASE}/api/admin/printing/state?rid=${FH}`, { headers: ADMIN }).then((x) => x.json()); const me = st.agents.find((x) => x.id === A.id);
    eq(me.name, A.name); eq(me.printers.map((p) => p.name), ["ZZ-T15-Roll", "ZZ-T15-Wide"]); eq(me.connected, true);
  });
}
