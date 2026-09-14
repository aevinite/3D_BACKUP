// The PRINT HELPER's door — the only API a printing machine ever touches.
//
// A helper is a ~40-line script on a computer that has printers (docs/PRINT-HELPER.md). It knows
// nothing: it asks this route what to print, is handed the finished document, sends it to the named
// printer, and says whether paper came out. Every rule — which printer, what the paper says, what
// happens when it will not print — stays here, which is why the machine is set up once and never
// revisited. (It used to say "when a backup takes over". There is no backup: a sheet that gives up
// files a printer problem and pings the owner instead — owner, 2026-08-30.)
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
import { agentByToken, helloAgent, claimNext, claimSome, readRoutes, paperFor, touchAgent, printingRunning, PRINT_KINDS, type AgentRow } from "@/lib/printHelpers";
import { claimSetupCode } from "@/lib/printSetupCode";
import { rateAllowed, rateResetOnSuccess } from "@/lib/rateLimit";
import { finishKotJob, tellSomebodyItGaveUp } from "@/lib/printQueue";
import { kotHtmlForOrder, billHtmlForSession, banquetHtmlForBill, testHtml, sampleHtmlFor, kotHtmlForAggregator, withPaper } from "@/lib/printDocs";

export const dynamic = "force-dynamic";

const err = (m: string, status = 400) => NextResponse.json({ error: m }, { status });

// How often a helper should come back. 2s is the felt-instant end of the range and costs one tiny
// request per machine per 2s — the answer is normally a 204 with no body at all. A restaurant with
// two helpers is ~86k empty polls a day, which is nothing beside one panel's own board reads, and
// it is the price of paper appearing without anybody watching a screen.
const POLL_MS = 2000;

// WHICH MACHINE IS TYPING, for the guessing wall below. There is no login here and no cookie, so
// the address the request came from is the only subject there is. Behind Vercel the first entry of
// x-forwarded-for is the client; a missing header falls back to one shared bucket, which is the
// safe direction — it can only ever count MORE attempts together, never fewer.
const askerOf = (req: NextRequest) =>
  (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
  || req.headers.get("x-real-ip")
  || "unknown";

async function whoIsAsking(req: NextRequest): Promise<AgentRow | null> {
  const t = req.headers.get("x-lfh-agent") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  return t ? agentByToken(t) : null;
}

/** Ticks 1 and 2 of the four (docs/PRINT-HELPER.md): printing must exist for this restaurant, and
 *  auto-print must be on. When either is off the helper is told "nothing to print" and idles — it
 *  is not an error, and a restaurant that pauses printing must not fill a log with refusals. */
// ── THIS MOVED TO lib/printHelpers → printingRunning() ON 2026-09-14 ─────────────────────────
// It was private to this file, so only the helper's own door could read it — and that is exactly how
// all three boards came to say LIVE, with working-looking Test buttons, about a restaurant whose
// printing was switched off. The poll answers 204 for EVERY kind in that state, so the one place
// that knew could not tell the screens. One copy now, read by the door and by the status rows.
// (A new way replaces the old one: this function is deleted, not left beside its replacement.)
// The two reasons it can be off — switched off vs queue stopped — are kept apart there, for the
// reason recorded there: the tickets are never made in one case and are waiting in the other.
const printingOn = async (rid: string): Promise<boolean> => (await printingRunning(rid)).on;

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const seg = (path || []).map(String);

  // ── THE SETUP CODE COMES BEFORE THE GATE, because an unlinked helper has nothing to be gated by ─
  //
  // `pair/claim` is the ONLY unauthenticated verb in this file. The person at the printer types the
  // six-character code the Printing screen showed them, and the helper trades it for its token.
  //
  // IT REPLACED A LOGIN ON THE SHOP'S PC (owner, 2026-09-13: *"instead of login make something else
  // otherwise the waiter will also do that printing thing"*). The old handshake — pair/start,
  // pair/poll and the /pair Allow page (mig 368) — is deleted, not disabled: it asked for a STAFF
  // login on the restaurant's own counter machine, and the staff login is the waiter's login too.
  //
  // The restaurant was chosen when the code was made, by somebody already signed in on the Printing
  // screen. Nothing here can join a restaurant on its own; that boundary is unchanged.
  if (seg[0] === "pair" && seg[1] === "claim") {
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    // A WALL, AND IT IS ALSO THE ALARM. Twenty tries in ten minutes from one address is somebody
    // guessing, and the owner hears about it through the ordinary limits channel. Fail-OPEN like
    // every other caller of this helper: a limiter blip must never stop a restaurant setting up its
    // own printer.
    if (!await rateAllowed("print_setup_code", askerOf(req), { label: "Printer setup code" })) {
      return NextResponse.json({
        ok: false,
        error: "Too many tries. Wait ten minutes, then press “Show a setup code” again on the Printing screen.",
      }, { status: 429, headers: { "Cache-Control": "no-store" } });
    }
    const r = await claimSetupCode(String(b.code || ""), {
      fingerprint: b.fingerprint, hostname: b.hostname, printers: b.printers, os: b.os,
      // The stamp the file carries. Absent = a copy from before 2026-09-13 (mig 381).
      helper: b.helper,
    });
    // ── A CODE THAT WORKED CLEARS THE COUNTER ──────────────────────────────────────────────
    // The same rule, for the same recorded reason, as a staff login (lib/rateLimit.ts, owner
    // 2026-07-29): a wall like this exists to stop repeated WRONG tries, so proving you hold a real
    // code must reset it. Without this the count is of ATTEMPTS, and setting up eight machines in
    // one sitting — which is exactly what Aevidine does for a new client, from one address — walls
    // the ninth. Wrong-code bursts never reach this line, so they still count and still wall.
    if (r.ok) await rateResetOnSuccess("print_setup_code", askerOf(req));
    // 200 EITHER WAY, with `ok` carrying the answer. The helper is four lines of shell on three
    // operating systems reading this with `sed` and `findstr`; a status code it has to branch on is
    // a fourth thing to get wrong on Windows. `ok:false` is unambiguous in all three.
    return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
  }

  const agent = await whoIsAsking(req);
  if (!agent) return err("This computer's printing code is not valid any more.", 401);
  // ── ASKING FOR WORK IS A SIGN OF LIFE (2026-09-14) ─────────────────────────────────────────
  // Written here rather than only in `hello`, and the whole reason is spelled out over
  // SEEN_REFRESH_MS in lib/printHelpers: a round does not return until the backlog is empty, hello
  // is only asked every fifth round, and the two together made a helper printing a rush report
  // itself ASLEEP on all three boards. It writes at most once every ten seconds.
  await touchAgent(agent.id, agent.last_seen_at);
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
      // NOT EVEN AN EMPTY `backupFor` (T11 sweep #8, 2026-09-04). It was left answering a constant
      // [] after the backup was deleted on 2026-08-30, and the guard that exempted it said a helper
      // already installed on a restaurant's PC reads it. NO HELPER EVER HAS — the string appears in
      // no version of lib/printHelperScript.ts in the whole history of that file. A field kept for a
      // reader that does not exist is a promise waiting to be believed, so it is gone.
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
    // ── A PAGE SOMEBODY TOOK OUT DOES NOT COME BACK (2026-09-13) ──────────────────────────────
    // `.in("status", …)` is the whole point of this line, and it is the same rule the kitchen-slip
    // path keeps in lib/printQueue.finishKotJob: a bill or banquet sheet that was taken out of the
    // queue — one ticket at a time, or a whole backlog through "Clear the N waiting tickets" — must
    // not be put back by a failure reported a second later by the machine that had already claimed
    // it. Without it, clearing the queue could still be followed by a page nobody asked for. The
    // row keeps the reason it was taken out, and nobody is told: a page deliberately taken out has
    // not gone wrong. (A SUCCESS above still marks it printed — if paper came out, the log says so.)
    const back = await sb.from("print_jobs").update({
      status: parked ? "failed" : "queued", attempts: attempts + 1, claimed_at: null,
      error: String(body.error || "print failed").slice(0, 300),
    }).eq("id", job.id).eq("restaurant_id", agent.restaurant_id)
      .in("status", ["queued", "printing", "failed"]).select("id").maybeSingle();
    if (!back.data) {
      await sb.from("print_jobs").update({ claimed_at: null }).eq("id", job.id).eq("restaurant_id", agent.restaurant_id);
      return NextResponse.json({ ok: true, parked: false, attempts, takenOut: true });
    }
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
  // ── AND HERE MOST OF ALL: THE POLL IS A GET ────────────────────────────────────────────────
  // This is the ask a working helper makes constantly and `hello` is the one it now skips four
  // times out of five, so a sign of life written only in the POST handler would have fixed nothing
  // for a computer that is busy printing. The reasoning in full: SEEN_REFRESH_MS, lib/printHelpers.
  await touchAgent(agent.id, agent.last_seen_at);

  // GET /next — "anything for me?" The answer is normally 204: no body, no work, no cost.
  if (seg[0] === "next") {
    if (!(await printingOn(agent.restaurant_id))) return new NextResponse(null, { status: 204 });
    // ── ONE LANE PER PRINTER (owner, 2026-09-14) ──────────────────────────────────────────────
    // *"You can send kitchen and print bill simultaneously in parallel."* `?max=` asks for a BATCH:
    // at most one job per distinct printer, so the helper can run one worker per lane and a bill
    // never queues behind a kitchen slip on a different printer.
    //
    // ⚠️ THE OLD SHAPE IS STILL THE DEFAULT, AND THAT IS NOT TIDINESS — a helper is a text file
    // somebody pasted into Notepad, there is no way to push a new one, and his Windows PC is running
    // an older copy right now. Without `?max=` this answers exactly what it always answered: one
    // job, one object. With it, `{ jobs: [...] }`. An old file cannot send the parameter, so an old
    // file cannot be handed a shape it does not understand.
    const want = Number(new URL(req.url).searchParams.get("max") || 0);
    if (want > 1) {
      const jobs = await claimSome(agent.restaurant_id, agent, { max: want });
      if (!jobs.length) return new NextResponse(null, { status: 204 });
      return NextResponse.json({
        jobs: jobs.map((job) => ({
          id: job.id, kind: job.kind, printer: job.printer,
          document: `/api/print-agent/job/${job.id}/document`,
          reprint: job.reprint, attempts: job.attempts,
        })),
      });
    }
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
    // ── A SAMPLE OF THIS EXACT PIECE OF PAPER (owner, 2026-09-14) ──────────────────────────────
    // *"They can also test also from there that print a KOT, print a bill, or print a banquet
    // bill."* The job is a REAL job of the real kind on the real route — that is deliberate, and
    // the same reasoning as the plain test page: a test that takes a different path can pass while
    // the path that matters is broken. So the only thing that differs is which builder draws it,
    // and the paper size below is the route's own, which is the half of the test that matters most
    // on the banquet sheet.
    //
    // Checked FIRST, above every other branch: a sample bill carries no sessionId and a sample KOT
    // no order_id, so falling through would build nothing and the job would be closed as "nothing
    // to print" — a Test button that silently does nothing.
    if (payload.sample === true && (job.kind === "kot" || job.kind === "bill" || job.kind === "banquet")) {
      html = await sampleHtmlFor(agent.restaurant_id, job.kind);
    }
    else if (job.kind === "kot" && job.order_id) html = await kotHtmlForOrder(agent.restaurant_id, job.order_id, job.reprint !== false);
    // A DELIVERY / PARCEL ticket (mig 209). It is a kitchen slip in every way that matters and has no
    // `orders` row at all, so it is addressed by `payload.aggId` — added 2026-09-14 with the kitchen
    // board's delivery 🖨, which until then was the last button on that screen printing locally
    // whatever the address book said.
    else if (job.kind === "kot" && payload.aggId) html = await kotHtmlForAggregator(agent.restaurant_id, String(payload.aggId), job.reprint !== false);
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
