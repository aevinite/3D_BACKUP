// /api/pair — the ALLOW page's own door (mig 368).
//
// This is the one place a print helper is adopted, and it is the whole security boundary of the
// zero-typing handshake: the helper describes itself and gets a code, but ONLY a signed-in human
// here decides which restaurant that machine joins.
//
// TWO KINDS OF PERSON may press Allow, and each is checked its own way:
//   · the ADMIN — tokenIsValid. They may adopt a machine into any restaurant, and must say which.
//   · a MANAGER (or owner in manager mode) with "May set the printers up" — their own restaurant is
//     the only one on offer. Asked with managerCan, exactly as the panel routes ask it.
//
// A person with neither is told plainly to sign in. Nothing here leaks whether a code exists: an
// unknown code and an expired one give the same answer.
import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { USER_COOKIE, userFromCookie, AuthDbError } from "@/lib/userAuth";
import { managerCan } from "@/lib/managerCan";
import { pairingByCode, approvePairing } from "@/lib/printPair";
import { logAction, deviceIdFrom } from "@/lib/oplog";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const err = (m: string, status = 400) => NextResponse.json({ error: m }, { status });

type Who =
  | { kind: "admin" }
  | { kind: "staff"; userId: string; name: string; restaurantId: string }
  | { kind: "none" }
  | { kind: "busy" };

// ── "THE DATABASE DIDN'T ANSWER" IS NOT "YOU ARE NOT SIGNED IN" (T4 sweep #8, item 4) ─────────────
// `userFromCookie` THROWS AuthDbError when the staff_users lookup fails after its own retry, and
// this call was bare — so a database flap escaped as an unclassified 500. Seven other routes catch
// it; the neighbour this door is modelled on, app/api/rt-config, answers 503 with a CODE and says
// in its own comment why. Here it mattered more than most: this page is opened BY A PROGRAM on a
// machine at a printer, and the person standing there was being told their sign-in was the problem.
// `retryable` is the honest half — this one really does come back on its own.
const BUSY = () => NextResponse.json(
  {
    error: "The system is very busy right now — try again in a moment.",
    reason: "pair_busy",
    retryable: true,
    /** Nothing for the person at the printer to do, and nothing to call Aevidine about. */
    selfFixable: false,
  },
  { status: 503, headers: { "Cache-Control": "no-store" } },
);

async function whoIsPressing(req: NextRequest): Promise<Who> {
  if (await tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value)) return { kind: "admin" };
  let u;
  try {
    u = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  } catch (e) {
    if (!(e instanceof AuthDbError)) throw e;
    console.error("[pair] couldn't resolve who is pressing Allow:", e.message);
    return { kind: "busy" };
  }
  if (!u) return { kind: "none" };
  // The SAME permission the panel's own printing verbs ask for. A manager who may not set printers
  // up may not adopt a machine either — otherwise this page would be a way around that switch.
  const may = await managerCan({ user: u } as Parameters<typeof managerCan>[0], u.restaurant_id, "print_setup");
  if (!may) return { kind: "none" };
  return { kind: "staff", userId: u.id, name: String(u.name || u.username || ""), restaurantId: u.restaurant_id };
}

// GET /api/pair?c=CODE — what the Allow page shows: who is asking to be adopted, and by whom it
// could be. Never the pairing's secret, never a token.
export async function GET(req: NextRequest) {
  const code = new URL(req.url).searchParams.get("c") || "";
  const who = await whoIsPressing(req);
  const row = await pairingByCode(code);

  // The two are reported separately on purpose: "sign in" and "that code has expired" are different
  // problems with different fixes, and a person standing at a printer needs to know which they have.
  if (who.kind === "busy") return BUSY();
  if (who.kind === "none") return NextResponse.json({ signedIn: false });
  if (!row) return NextResponse.json({ signedIn: true, found: false });
  // `who` travels on THIS branch too, and it is load-bearing. The Allow page keeps `who` in state
  // and only sets it when an answer carries one (`if (d.who) setWho(d.who)`), so a machine that
  // was ALREADY linked when the page first opened never learns it — and the "Already linked"
  // screen picks its next step with `who === "admin"`. Without this, an Aevidine admin opening a
  // link for an already-linked machine was sent to /manager, a restaurant's own panel, instead of
  // the console. The success screen was unaffected: by then an earlier answer had carried it.
  if (row.approved_at) return NextResponse.json({ signedIn: true, found: true, already: true, who: who.kind });

  const rests = who.kind === "admin"
    ? (((await sb.from("restaurants").select("id, name").order("name")).data || []) as { id: string; name: string }[])
    : (((await sb.from("restaurants").select("id, name").eq("id", who.restaurantId)).data || []) as { id: string; name: string }[]);

  return NextResponse.json({
    signedIn: true, found: true, already: false,
    who: who.kind, person: who.kind === "staff" ? who.name : "Aevidine",
    machine: { hostname: row.hostname, os: row.os, printers: row.printers },
    restaurants: rests,
    expiresAt: row.expires_at,
  });
}

// POST /api/pair — Allow. This is the act that creates the print_agents row.
export async function POST(req: NextRequest) {
  const who = await whoIsPressing(req);
  if (who.kind === "busy") return BUSY();
  if (who.kind === "none") return err("Sign in on this computer first, then press Allow.", 401);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const code = String(body.code || "");
  const name = body.name ? String(body.name) : null;

  // A STAFF MEMBER CAN ONLY EVER ADOPT INTO THEIR OWN RESTAURANT. The body's rid is ignored for
  // them — trusting it would let any manager attach a machine to somebody else's shop.
  const rid = who.kind === "admin" ? String(body.rid || "") : who.restaurantId;
  if (!rid) return err("Which restaurant is this computer for?");
  if (who.kind === "admin") {
    const ok = (await sb.from("restaurants").select("id").eq("id", rid).maybeSingle()).data;
    if (!ok) return err("No such restaurant.", 404);
  }

  const done = await approvePairing(code, {
    restaurantId: rid,
    userId: who.kind === "staff" ? who.userId : null,
    // The browser that pressed Allow IS the machine at the printer, so it becomes the device that
    // manages this helper from its own Settings → Printing (mig 367).
    deviceId: deviceIdFrom(req),
    name,
  });
  if ("error" in done) return err(done.error);

  await logAction(who.kind === "admin" ? "admin" : "editor", "print_helper_added", {
    restaurant_id: rid,
    ...(who.kind === "staff" ? {} : { actor: "Aevidine admin" }),
    detail: `computer “${done.name}” linked itself and was allowed to print`,
  });
  return NextResponse.json({ ok: true, name: done.name, agentId: done.agentId });
}
