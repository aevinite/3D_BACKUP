// GET /api/owner/printing — "where does my paper come out?", for the OWNER.
//
// Read-only on purpose. Printing is hardware: which computers may print, and what each of them
// prints, is the admin's to grant (docs/PRINT-HELPER.md → the four ticks). But an owner sitting at
// the counter — who at Aangan is also the manager — must be able to SEE it without asking us: is the
// computer awake, which printer gets the kitchen slips, is anything waiting.
//
// AUTH: ownerScope() like every other /api/owner/* route — an owner sees only their own restaurants,
// the admin sees all, everyone else gets 401.
//
// NOTHING RENDERS WHEN THE FLAG IS OFF (R36: the owner never sees what is withheld). With printing not
// allowed for a restaurant, this answers `allowed: false` and the panel draws nothing at all — no
// greyed-out card, no hint that a feature exists.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { ownerScopeOr503, ownerLogPanel, ownerActorName } from "@/lib/ownerScope";
import { agentsView, readRoutes, waitingCount, PRINT_KINDS, paperStatus, helperFor, queueJob, isRoutableKind } from "@/lib/printHelpers";
import { KIND_LABEL, PRINTER_STATE_WORDS } from "@/lib/printBoardWords";
import { printingRunning } from "@/lib/printHelpers";
import { logAction } from "@/lib/oplog";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await ownerScopeOr503(req);
  if (g.resp) return g.resp;
  const rid = new URL(req.url).searchParams.get("rid") || "";
  // The scope decides, never the query string: an owner asking about a restaurant that is not theirs
  // is simply told no, the same way every other owner route answers. `all: true` is the admin.
  const scope = g.scope;
  const ids = scope.all ? [] : scope.ids;
  // ── AND IF NOBODY NAMED ONE, PICK A RESTAURANT THAT ACTUALLY PRINTS (owner, 2026-09-14) ──────
  // It was `ids[0]` — the owner's FIRST restaurant, whichever that happens to be. If that one has
  // printing switched off, this route answers `allowed:false`, which the page treats as "the feature
  // is withheld" and draws nothing at all — for an owner whose OTHER restaurants print perfectly.
  //
  // Measured on his own account: seven restaurants, two of them printing, and the whole "where your
  // paper comes out right now" box was absent because restaurant number one was not one of the two.
  // The rows above it then had no answer to read and fell to the screen branch, which states in
  // amber that nothing has picked the tickets up. One wrong pick, two wrong screens.
  //
  // So: the `?rid=` when it is in scope, else the first restaurant in scope that printing is
  // actually switched on for, and only then the old fall-back. One extra indexed read, on ids the
  // scope has already resolved.
  let target = rid && (scope.all || ids.includes(rid)) ? rid : "";
  if (!target) {
    const printsQ = scope.all
      ? await sb.from("settings").select("restaurant_id").eq("auto_print_kot_allowed", true).limit(1)
      : ids.length
        ? await sb.from("settings").select("restaurant_id").in("restaurant_id", ids.slice(0, 50)).eq("auto_print_kot_allowed", true).limit(1)
        : { data: [] };
    target = ((printsQ.data || [])[0] as { restaurant_id?: string } | undefined)?.restaurant_id || ids[0] || "";
  }
  if (!target) return NextResponse.json({ allowed: false });

  // ── R36 SAYS HIDE WHAT IS WITHHELD — IT DOES NOT SAY HIDE WHAT WE FAILED TO READ (T20 sweep #7,
  //    2026-08-27) ─────────────────────────────────────────────────────────────────────────────────
  // `.error` was never inspected, so a blip answered `allowed: false` — which is the same answer as
  // "printing is not granted to this restaurant", and the panel draws NOTHING for that (deliberately:
  // the owner never sees what is withheld). So the whole Printing card vanished from the owner's screen
  // during a hiccup, with nothing anywhere saying why, and reappeared on the next load.
  //
  // A retryable 503 keeps both rules intact: still nothing is revealed about a feature the admin
  // withheld (a refused restaurant never reaches this read's answer differently), and a failure the
  // owner can act on says so. Same shape as ownerScopeOr503 at the top of this handler.
  const sq = await sb.from("settings").select("auto_print_kot, auto_print_kot_allowed")
    .eq("restaurant_id", target).maybeSingle();
  if (sq.error) {
    console.error("[owner/printing] could not read the printing switches:", sq.error.message);
    return NextResponse.json(
      { error: "Couldn't check your printing just now — please try again.", transient: true },
      { status: 503 },
    );
  }
  const s = sq.data as { auto_print_kot?: boolean; auto_print_kot_allowed?: boolean } | null;
  if (s?.auto_print_kot_allowed !== true) return NextResponse.json({ allowed: false });

  const [agents, routes, waiting, live] = await Promise.all([
    agentsView(target), readRoutes(target), waitingCount(target),
    // "IS IT WORKING RIGHT NOW" — the same three rows the manager panel draws, from the same
    // function (lib/printHelpers → paperStatus). Owner, 2026-09-14: *"on the manager panel and on
    // the owner panel… you could able to see that everything is connected and everything is live."*
    // Computed there and not here on purpose: this card and the manager's have to agree, and the
    // way they stopped agreeing the first time was each working it out from `routes` itself.
    paperStatus(target),
  ]);
  return NextResponse.json({
    // ── WHICH RESTAURANT THIS IS ABOUT (T20 round 2, 2026-08-31) ──────────────────────────────────
    // This route answers for ONE restaurant — `target` above, which is the `?rid=` when it is in
    // scope and otherwise `ids[0]`. It never said which, and the owner's Settings page renders a LIST
    // (one printing row per restaurant that has it on) while looking this answer up ONCE, outside the
    // loop. So the helper/computer named on row 2 came from whichever restaurant `target` resolved to
    // — another restaurant's hardware printed on this restaurant's line.
    //
    // Latent on this stack today, and only by luck: exactly one restaurant has printing switched on,
    // and for the two-restaurant diag owner it happens to be `ids[0]`, so the row and the answer are
    // the same restaurant. Measured, not assumed. The day a second restaurant turns printing on it
    // stops being latent, and it is the "nothing may show restaurant #1's details on another tenant"
    // class CLAUDE.md calls a recurring bug.
    //
    // So the answer names its subject and the page matches on it. One field; no extra read.
    restaurantId: target,
    allowed: true, on: s?.auto_print_kot === true, waiting,
    // Only what an owner needs to READ: the computer's name, whether it is awake, and what it prints.
    // No codes, no fingerprints — there is nothing on this screen worth stealing.
    // ── AND WHETHER EACH PRINTER IS GOING TO PRINT (owner, 2026-09-14) ──────────────────────
    // This sent a list of NAMES, which told the owner nothing he could act on: a computer can be
    // wide awake with every printer plugged into it switched off. The state rides along per printer,
    // and the four words it is said in come from PRINTER_STATE_WORDS like everywhere else — this
    // screen is read-only, so it may only ever SAY what is true, and it must say it in the same
    // words as the other two boards.
    printerStates: PRINTER_STATE_WORDS,
    computers: agents.map((a) => ({
      name: a.name, connected: a.connected, secondsAgo: a.secondsAgo,
      printers: a.printers.map((p) => ({ name: p.name, state: p.state || "unknown", paper: p.paper || null })),
    })),
    routes: PRINT_KINDS.map((k) => {
      const r = routes[k];
      const a = r.agent ? agents.find((x) => x.id === r.agent) : null;
      return { kind: k, printer: r.printer, computer: a?.name || null, connected: !!a?.connected };
    }).filter((r) => r.printer),
    live,
    // ── AND THE SAME ANSWER FOR *EVERY* RESTAURANT THE ROW LIST SHOWS (owner, 2026-09-14) ────────
    //
    // THIS IS THE THIRD TIME ONE RESTAURANT'S PRINTING ANSWER HAS APPEARED ON ANOTHER'S ROW. T20
    // fixed the first two by making this route SAY which restaurant it answered for, so the page
    // could stop applying it to all of them. That was right and it left a hole underneath: the page
    // renders one row per restaurant with printing on, and for every row that is NOT the answered
    // one it fell through to the screen branch — which does not say "we don't know", it says
    // "tickets print on the kitchen screen · no screen has taken it yet — tickets are waiting",
    // in amber, as a warning.
    //
    // Measured on the owner's own data, 2026-09-14: Pizza Palace's row said exactly that while a
    // computer was printing its slips perfectly. A confident wrong answer dressed as an alarm is
    // worse than the borrowed printer name T20 removed, because somebody acts on it.
    //
    // WHAT IT COSTS. Two indexed reads per restaurant (paperStatus), only for restaurants the admin
    // has actually switched printing ON for, capped at 12 — the page's own list is built from the
    // same set, so this is one answer per row it draws and never more. A one-restaurant owner (which
    // is nearly all of them) pays exactly what it paid before. The poll is 15s and already stops
    // when the tab is hidden.
    perRestaurant: await (async () => {
      const scoped = scope.all
        ? ((await sb.from("settings").select("restaurant_id")
            .eq("auto_print_kot_allowed", true).limit(12)).data || []).map((r) => (r as { restaurant_id: string }).restaurant_id)
        : ids.slice(0, 12);
      const on = scope.all ? scoped : ((await sb.from("settings").select("restaurant_id")
        .in("restaurant_id", scoped).eq("auto_print_kot_allowed", true).limit(12)).data || [])
        .map((r) => (r as { restaurant_id: string }).restaurant_id);
      return Object.fromEntries(await Promise.all(
        on.map(async (id) => [id, id === target ? live : await paperStatus(id)] as const),
      ));
    })(),
  });
}

// ── POST — print a real sample of a real document ────────────────────────────────────────────
//
// Owner, 2026-09-14: *"they don't have to print a test KOT — they can also test from there that
// print a KOT, print a bill, or print a banquet bill."*
//
// THIS IS THE FIRST THING THE OWNER PANEL HAS EVER POSTED ABOUT PRINTING, and the comment at the
// top of this file says why it held none: printing is hardware, and which computer prints what is
// the admin's to grant. That rule is intact. A test print CHANGES NOTHING — no route, no switch, no
// setting, no row — it puts one clearly-marked sheet of paper through the setup that already
// exists. The owner is the person standing at the counter asking "is the printer working?", and
// until now the only way to find out was to ring up a real order.
//
// Everything that keeps it honest is in lib/printDocs → testBand: a band top and bottom, no bill
// number, no invoice number, nothing written anywhere. It cannot be mistaken for a sale and it
// cannot become one.
export async function POST(req: NextRequest) {
  const g = await ownerScopeOr503(req);
  if (g.resp) return g.resp;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const rid = String(body.rid || new URL(req.url).searchParams.get("rid") || "");
  const scope = g.scope;
  const ids = scope.all ? [] : scope.ids;
  // THE SCOPE DECIDES, NEVER THE BODY — the same rule the GET above follows. An owner asking about a
  // restaurant that is not theirs is simply told no.
  const target = rid && (scope.all || ids.includes(rid)) ? rid : ids[0];
  if (!target) return NextResponse.json({ error: "Not your restaurant." }, { status: 403 });

  const kind = String(body.sample || "");
  if (!isRoutableKind(kind)) return NextResponse.json({ error: "There is no such kind of paper." }, { status: 400 });

  // The same entitlement gate as the GET: with printing not allowed for this restaurant, this route
  // reveals nothing and does nothing (R36 — the owner never sees what is withheld).
  const sq = await sb.from("settings").select("auto_print_kot_allowed").eq("restaurant_id", target).maybeSingle();
  if (sq.error) {
    return NextResponse.json({ error: "Couldn't reach your printing setup just now — please try again.", transient: true }, { status: 503 });
  }
  if ((sq.data as { auto_print_kot_allowed?: boolean } | null)?.auto_print_kot_allowed !== true) {
    return NextResponse.json({ error: "Not your restaurant." }, { status: 403 });
  }

  const own = await helperFor(target, kind);
  if (!own.owned) {
    return NextResponse.json({ error: "No computer is set to print that yet — choose a printer for it first." }, { status: 409 });
  }
  // The owner's screen is read-only but this one verb writes, so it carries the same refusal as the
  // other two: while printing is off nothing fetches the sample and the note would promise paper
  // that never comes.
  const runO = await printingRunning(target);
  if (!runO.on) return NextResponse.json({ error: "The printing queue is stopped, so nothing would come out. Restart it and try again." }, { status: 400 });
  if (kind === "kot" && !runO.kot) return NextResponse.json({ error: "Automatic kitchen-slip printing is switched off, so no slip would come out." }, { status: 400 });
  const q = await queueJob(target, kind, { sample: true }, { requestedBy: "sample · owner" });
  if ("error" in q) return NextResponse.json({ error: "Could not send that sample to the printer." }, { status: 500 });
  // ── WHO SENT IT, AND WHOSE LOG IT BELONGS IN (T28 of sweep #9, 2026-09-15) ────────────────────
  // This was the newest write in the owner panel (2026-09-14) and the only one that named NOBODY:
  // no `actor` at all, so the row stored `actor: null` and the Activity log's Who column rendered
  // "—" for it. On a restaurant with two co-owners that makes "who put that through the printer?"
  // unanswerable, which is the whole job of that screen.
  //
  // And `panel` was the literal "owner", so an ADMIN's sample print — this route answers an admin
  // act-as session exactly as it answers a real owner — landed in the OWNER's feed: `/api/owner/oplog`
  // excludes `panel in (admin,db)` and nothing else. `ownerLogPanel()` and `ownerActorName()`
  // (lib/ownerScope) are the two helpers that decide both questions for every other write in these
  // routes; this one was written without them. Same pair, same answers, no new rule.
  await logAction(ownerLogPanel(scope), "print_test", {
    restaurant_id: target,
    actor: ownerActorName(scope),
    ...(!scope.all && !scope.admin && "ownerId" in scope ? { actor_id: scope.ownerId } : {}),
    detail: `sample ${KIND_LABEL[kind] || kind} to ${own.printer} on ${own.agent}`,
  });
  return NextResponse.json({
    queued: true, printer: own.printer, agent: own.agent, connected: !!own.connected,
    note: own.connected
      ? `Sample sent to ${own.printer}.`
      : `Saved — the sample prints at ${own.printer} as soon as ${own.agent} is back.`,
  });
}
