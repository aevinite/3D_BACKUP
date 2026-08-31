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
import { ownerScopeOr503 } from "@/lib/ownerScope";
import { agentsView, readRoutes, waitingCount, PRINT_KINDS } from "@/lib/printHelpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await ownerScopeOr503(req);
  if (g.resp) return g.resp;
  const rid = new URL(req.url).searchParams.get("rid") || "";
  // The scope decides, never the query string: an owner asking about a restaurant that is not theirs
  // is simply told no, the same way every other owner route answers. `all: true` is the admin.
  const scope = g.scope;
  const ids = scope.all ? [] : scope.ids;
  const target = rid && (scope.all || ids.includes(rid)) ? rid : ids[0];
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

  const [agents, routes, waiting] = await Promise.all([agentsView(target), readRoutes(target), waitingCount(target)]);
  return NextResponse.json({
    allowed: true, on: s?.auto_print_kot === true, waiting,
    // Only what an owner needs to READ: the computer's name, whether it is awake, and what it prints.
    // No codes, no fingerprints — there is nothing on this screen worth stealing.
    computers: agents.map((a) => ({
      name: a.name, connected: a.connected, secondsAgo: a.secondsAgo,
      printers: a.printers.map((p) => p.name),
    })),
    routes: PRINT_KINDS.map((k) => {
      const r = routes[k];
      const a = r.agent ? agents.find((x) => x.id === r.agent) : null;
      return { kind: k, printer: r.printer, computer: a?.name || null, connected: !!a?.connected };
    }).filter((r) => r.printer),
  });
}
