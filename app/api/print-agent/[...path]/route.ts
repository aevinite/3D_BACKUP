// The PRINT HELPER's door — the only API a printing machine ever touches.
//
// A helper is a ~40-line script on a computer that has printers (docs/PRINT-HELPER.md). It knows
// nothing: it asks this route what to print, is handed the finished document, sends it to the named
// printer, and says whether paper came out. Every rule — which printer, what the paper says, when a
// backup takes over — stays here, which is why the machine is set up once and never revisited.
//
// AUTHENTICATION: an `X-LFH-Agent` token, minted per machine, stored only as a sha-256 hash
// (mig 341). It is a printing-only credential scoped to ONE restaurant: the three verbs below and
// nothing else in the app will accept it. There is no cookie, no staff login and no admin password
// in this flow on purpose — a kitchen machine that must survive a power cut cannot depend on
// someone logging in afterwards.
//
// IT IS ALSO THE ONLY WAY IN. There is no "print anything you like" verb: a helper may only claim
// jobs its restaurant's address book actually routes to it, and may only fetch the document of a
// job it has itself claimed. So a leaked token can reprint that restaurant's own tickets — the
// blast radius is paper — and one press of Remove in the admin console ends it.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { agentByToken, helloAgent, claimNext, readRoutes, paperFor, PRINT_KINDS, type AgentRow } from "@/lib/printHelpers";
import { startPairing, pollPairing } from "@/lib/printPair";
import { finishKotJob, tellSomebodyItGaveUp } from "@/lib/printQueue";
import { kotHtmlForOrder, billHtmlForSession, banquetHtmlForBill, testHtml, withPaper } from "@/lib/printDocs";

export const dynamic = "force-dynamic";

const err = (m: string, status = 400) => NextResponse.json({ error: m }, { status });

// How often a helper should come back. 2s is the felt-instant end of the range and costs one tiny
// request per machine per 2s — the answer is normally a 204 with no body at all. A restaurant with
// two helpers is ~86k empty polls a day, which is nothing beside one panel's own board reads, and
// it is the price of paper appearing without anybody watching a screen.
const POLL_MS = 2000;

// The site the helper must talk to, taken from THIS request rather than a constant, so a pairing
// started on backup points at backup and one on the live site points at the live site.
const originOf = (req: NextRequest) => {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  return host ? `${proto}://${host}` : new URL(req.url).origin;
};

async function whoIsAsking(req: NextRequest): Promise<AgentRow | null> {
  const t = req.headers.get("x-lfh-agent") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  return t ? agentByToken(t) : null;
}

/** Ticks 1 and 2 of the four (docs/PRINT-HELPER.md): printing must exist for this restaurant, and
 *  auto-print must be on. When either is off the helper is told "nothing to print" and idles — it
 *  is not an error, and a restaurant that pauses printing must not fill a log with refusals. */
async function printingOn(rid: string): Promise<boolean> {
  const s = (await sb.from("settings").select("auto_print_kot, auto_print_kot_allowed, modules").eq("restaurant_id", rid).maybeSingle())
    .data as { auto_print_kot?: boolean; auto_print_kot_allowed?: boolean; modules?: Record<string, { paused?: boolean }> } | null;
  // …AND THE QUEUE MUST NOT BE STOPPED (owner, 2026-08-29: "you can stop the queue, restart the
  // queue"). Stopping is deliberately NOT the same as switching printing off: the tickets go on
  // being made and go on waiting, so the moment it restarts they all come out. Switching printing
  // off instead stops them being made at all, and that paper would never exist.
  if (s?.modules?.printing?.paused === true) return false;
  return s?.auto_print_kot === true && s?.auto_print_kot_allowed === true;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const seg = (path || []).map(String);

  // ── PAIRING COMES BEFORE THE GATE, because an unpaired helper has nothing to be gated by ──────
  //
  // These two verbs are the ONLY unauthenticated ones in this file, and neither grants anything:
  //   · pair/start — a machine describes itself and gets a code + a private secret. The row it
  //     creates can do exactly one thing: be shown to a signed-in human for approval (mig 368).
  //   · pair/poll  — asks "am I in yet?", and answers with the token exactly ONCE, and only to the
  //     process holding that private secret. A wrong secret is answered identically to a code that
  //     does not exist, so this cannot be used to discover codes.
  //
  // The restaurant is chosen by the APPROVER, never by the helper. Nothing here can join a
  // restaurant on its own.
  if (seg[0] === "pair" && seg[1] === "start") {
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    const r = await startPairing({
      fingerprint: b.fingerprint, hostname: b.hostname, printers: b.printers, os: b.os,
      origin: originOf(req),
    });
    if ("error" in r) return err(r.error, 500);
    return NextResponse.json(r);
  }
  if (seg[0] === "pair" && seg[1] === "poll") {
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    const r = await pollPairing(String(b.code || ""), String(b.secret || ""));
    return NextResponse.json(r);
  }

  const agent = await whoIsAsking(req);
  if (!agent) return err("This computer's printing code is not valid any more.", 401);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  // POST /hello — "here I am, and here is what I can print on."
  // Every poll may send it; the printer list is remembered so the admin's dropdowns are built from
  // machines' own words rather than anybody's typing.
  if (seg[0] === "hello") {
    const { clash } = await helloAgent(agent, { fingerprint: body.fingerprint as string, printers: body.printers });
    const routes = await readRoutes(agent.restaurant_id);
    return NextResponse.json({
      ok: true, agent: { id: agent.id, name: agent.name }, pollMs: POLL_MS,
      printing: await printingOn(agent.restaurant_id),
      // What this machine is expected to print, so a helper can say so in its own log and a person
      // reading that log can tell "not my job" from "something is broken".
      mine: PRINT_KINDS.filter((k) => routes[k].agent === agent.id),
      // `backupFor` is gone: a helper is never a second machine's fallback (owner, 2026-08-30).
      backupFor: [] as string[],
      // Two machines sharing one code: no paper is duplicated (the claim prevents it) but half the
      // tickets would come out in the wrong room, so the helper is told and the admin screen shows
      // it. Copying the file to a second computer is the way this happens.
      warning: clash ? "This printing code is in use on another computer too — each computer needs its own." : null,
    });
  }

  // POST /job/:id/done  ·  POST /job/:id/failed — the report that closes the loop.
  if (seg[0] === "job" && seg[1] && (seg[2] === "done" || seg[2] === "failed")) {
    const ok = seg[2] === "done";
    const job = (await sb.from("print_jobs").select("id, kind, agent_id, status, printer")
      .eq("id", seg[1]).eq("restaurant_id", agent.restaurant_id).maybeSingle()).data as
      { id: string; kind: string; agent_id: string | null; status: string; printer: string | null } | null;
    if (!job) return err("No such print job.", 404);
    // REJECTED (owner, 2026-08-22): offered "make this match the document fetch below and refuse a job
    // NO computer has claimed (drop the `job.agent_id &&` guard), so an unclaimed job can never be
    // marked printed with no paper" — he said **no**. Full row: docs/REJECTED-IDEAS.md R46. It is a
    // consistency tidy-up with no reachable path behind it: a helper only ever learns a job id BY
    // claiming it, and claiming sets agent_id. `ON DELETE SET NULL` (mig 341) can null it when the
    // admin removes that computer — but removing it also invalidates its token, so it can no longer
    // report anything. Leave the `job.agent_id &&` exactly as it is; do not re-suggest tightening it.
    //
    // Only the machine that claimed it may close it. Otherwise a second helper could mark a ticket
    // printed that never came out of ITS printer, and the queue's whole promise — a ticket stays
    // pending until paper exists — would be a lie.
    if (job.agent_id && job.agent_id !== agent.id) return err("That job belongs to another computer.", 409);

    if (job.kind === "kot") {
      // The kitchen ticket path already has a finisher that resolves open printer problems on a
      // success and parks a job after five failures; reusing it means the manager's floor strip
      // behaves identically whether a screen or a helper did the printing.
      const r = await finishKotJob(agent.restaurant_id, job.id, ok, String(body.error || "").slice(0, 300), job.printer);
      return NextResponse.json({ ok: true, parked: r.parked, attempts: r.attempts });
    }
    if (ok) {
      await sb.from("print_jobs").update({ status: "done", done_at: new Date().toISOString(), error: null })
        .eq("id", job.id).eq("restaurant_id", agent.restaurant_id);
      // Same narrowing as the kitchen path (mig 351): a printed BILL proves the bill printer works,
      // and says nothing about the kitchen printer somebody has just reported jammed.
      // Parameterised, for the reason written out in lib/printQueue.finishKotJob: a printer name is
      // reported by a helper about itself, so it must never be pasted into a filter string.
      {
        const resolved = { status: "resolved", resolved_at: new Date().toISOString() };
        const rid2 = agent.restaurant_id;
        if (job.printer) {
          await sb.from("printer_events").update(resolved).eq("restaurant_id", rid2).eq("status", "open").eq("printer", job.printer);
          await sb.from("printer_events").update(resolved).eq("restaurant_id", rid2).eq("status", "open").is("printer", null);
        } else {
          await sb.from("printer_events").update(resolved).eq("restaurant_id", rid2).eq("status", "open");
        }
      }
      return NextResponse.json({ ok: true });
    }
    // Scoped by restaurant like every other statement in this file. The id is a uuid primary key so
    // it resolves the same row either way, and `job` above was already read scoped — but this was
    // the one read here without it, and a file whose header says "every function is scoped by
    // restaurant_id" should not have an exception nobody can see the reason for.
    const attempts = ((await sb.from("print_jobs").select("attempts").eq("id", job.id).eq("restaurant_id", agent.restaurant_id).maybeSingle()).data as { attempts?: number } | null)?.attempts || 0;
    const parked = attempts + 1 >= 5;
    await sb.from("print_jobs").update({
      status: parked ? "failed" : "queued", attempts: attempts + 1, claimed_at: null,
      error: String(body.error || "print failed").slice(0, 300),
    }).eq("id", job.id).eq("restaurant_id", agent.restaurant_id);
    // ── AND SOMEBODY IS TOLD, for a bill and a banquet sheet too (T11 sweep #8, 2026-09-04) ─────
    // The kitchen-slip branch above goes through finishKotJob, which files a printer problem and
    // pings the owner on the fifth failure. This branch — bills and banquet sheets — did neither, so
    // a bill that could not print parked silently: nothing on the manager's floor strip, nothing in
    // the kitchen's 🖨 sheet, no ping, and a guest standing at the till. The owner's words that
    // deleted the backup printer were "if ANYTHING fails it should show me or the person, manager,
    // owner, everyone should get a notification" (2026-08-30). Same function, so the two cannot
    // drift; see lib/printQueue.tellSomebodyItGaveUp.
    if (parked) {
      await tellSomebodyItGaveUp(agent.restaurant_id, {
        what: job.kind === "banquet" ? "A banquet sheet" : job.kind === "bill" ? "A bill" : "A page",
        alsoCalled: job.kind === "banquet" ? "banquet sheet" : job.kind === "bill" ? "bill" : "page",
        printer: job.printer ?? null,
        attempts: attempts + 1,
      });
    }
    return NextResponse.json({ ok: true, parked, attempts: attempts + 1 });
  }

  return err("Unknown request.", 404);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const seg = (path || []).map(String);
  const agent = await whoIsAsking(req);
  if (!agent) return err("This computer's printing code is not valid any more.", 401);

  // GET /next — "anything for me?" The answer is normally 204: no body, no work, no cost.
  if (seg[0] === "next") {
    if (!(await printingOn(agent.restaurant_id))) return new NextResponse(null, { status: 204 });
    const job = await claimNext(agent.restaurant_id, agent);
    if (!job) return new NextResponse(null, { status: 204 });
    return NextResponse.json({
      id: job.id, kind: job.kind, printer: job.printer,
      // The paper is fetched separately so a claim is cheap and a document is only built when
      // something is really going to print it.
      document: `/api/print-agent/job/${job.id}/document`,
      reprint: job.reprint, attempts: job.attempts,
    });
  }

  // GET /job/:id/document — the finished paper, built now, from the same file every screen prints.
  if (seg[0] === "job" && seg[1] && seg[2] === "document") {
    const job = (await sb.from("print_jobs").select("id, kind, order_id, reprint, agent_id, printer, payload")
      .eq("id", seg[1]).eq("restaurant_id", agent.restaurant_id).maybeSingle()).data as
      { id: string; kind: string; order_id: string | null; reprint: boolean; agent_id: string | null; printer: string | null; payload?: Record<string, unknown> } | null;
    if (!job) return err("No such print job.", 404);
    if (job.agent_id !== agent.id) return err("That job belongs to another computer.", 409);
    const payload = (job.payload && typeof job.payload === "object" ? job.payload : {}) as Record<string, unknown>;

    let html: string | null = null;
    if (job.kind === "kot" && job.order_id) html = await kotHtmlForOrder(agent.restaurant_id, job.order_id, job.reprint !== false);
    else if (job.kind === "bill" && payload.sessionId) html = await billHtmlForSession(agent.restaurant_id, String(payload.sessionId), { parcel: !!payload.parcel });
    // THE BANQUET SHEET. Missing until 2026-08-29, and it failed in the worst way there is: the
    // admin screen offers a Banquet line and lets a restaurant point it at a computer and a printer,
    // the ticket was handed to the helper, and then this endpoint answered "no document" and marked
    // the ticket dismissed. No paper, no error, nothing on any screen — an event sheet that simply
    // never came out. The builder had existed the whole time (lib/printDocs.banquetHtmlForBill); the
    // helper was never told to call it. The panel queues these with `billId` (public/panels/editor/
    // app.js → /print/send), which is the key read here.
    else if (job.kind === "banquet" && payload.billId) html = await banquetHtmlForBill(agent.restaurant_id, String(payload.billId));
    else if (job.kind === "test") {
      const rest = (await sb.from("restaurants").select("name").eq("id", agent.restaurant_id).maybeSingle()).data as { name?: string } | null;
      html = testHtml({
        restaurant: rest?.name || "This restaurant", printer: job.printer || "—", agent: agent.name,
        when: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }),
      });
    }

    // Nothing to print — the order was deleted or cancelled between queueing and printing, or a
    // kind arrived that this build cannot draw yet. Either way the job is closed rather than left
    // to be retried forever, and the reason is written on it so it can be read later.
    if (!html) {
      await sb.from("print_jobs").update({
        status: "dismissed", done_at: new Date().toISOString(),
        error: "nothing to print — the order was removed, cancelled, or this kind has no document yet",
      }).eq("id", job.id).eq("restaurant_id", agent.restaurant_id);
      return new NextResponse(null, { status: 204 });
    }
    // The paper the target printer is actually loaded with — the route's answer if the admin pinned
    // one, else what this machine reported. Page size and media must agree or the driver rotates the
    // ticket; a document that already declares its own size (the banquet sheet) is left alone.
    const routes = await readRoutes(agent.restaurant_id);
    const paper = paperFor(routes[job.kind as keyof typeof routes], agent, job.printer);
    return new NextResponse(withPaper(html, paper), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        // The helper reads the printer off the header, so the file it prints and the printer it
        // prints on can never come from two different answers.
        "x-lfh-printer": job.printer || "",
        "x-lfh-paper": paper ? `${paper.wMm}x${paper.hMm}mm` : "",
        "cache-control": "no-store",
      },
    });
  }

  return err("Unknown request.", 404);
}
