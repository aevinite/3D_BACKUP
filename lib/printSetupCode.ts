// lib/printSetupCode.ts — the ten-minute setup code (mig 380). It replaces mig 368's Allow page.
//
// Owner, 2026-09-13: *"instead of login make something else otherwise the waiter will also do that
// printing thing and make completely diff login not this"* — then, naming the shape himself:
// *"you can generate code for each restaurant from printing menu and like the helper ask for that
// code and that generated code only works for 10 min."*
//
// THE SHAPE, and it is the enrolment-token pattern (how a device joins a managed fleet):
//
//   the Printing screen — somebody is ALREADY signed in there      the computer at the printer
//   ───────────────────────────────────────────────────────       ───────────────────────────
//   presses "Show a setup code"  ──►  issueSetupCode()            the helper asks for a code
//        one code, ten minutes, shown once ──── read it out ────► the person types it
//                                                                  claimSetupCode()
//   the computer appears on the board  ◄─────────────────────────  token written to its own disk
//
// FOUR THINGS MAKE IT SAFE, and each is doing real work:
//
//  1. THE RESTAURANT IS DECIDED BEFORE THE CODE EXISTS. The machine has no say — it never did under
//     the old handshake either, and that is the one property worth keeping from it.
//  2. IT IS NOT A LOGIN. It signs nobody in, reads nothing, and the only act it can perform is
//     attaching ONE computer to ONE restaurant's printing. This is the owner's whole point: the
//     staff login is also the waiter's login, so it could never be the door to this.
//  3. TEN MINUTES, ONE USE. The first machine to redeem it spends it. A code left on a screen is
//     rubbish long before anybody walks past.
//  4. HASHED AT REST. For its ten minutes this code IS a credential — that is the honest trade
//     against "no login on the shop PC" — so the database never holds the plaintext. It is returned
//     exactly once, to the screen that asked.
//
// WHAT A LEAKED CODE COSTS, stated plainly because it is the cost of this design: inside its ten
// minutes it can attach one machine to that ONE restaurant's printing. That machine can then print
// and reprint that restaurant's own tickets — nothing else in the app accepts an agent token
// (app/api/print-agent). It appears on the Printing board by name the moment it is used, and one
// press of Unlink ends it. No other restaurant is reachable, ever.
import { createHash, randomInt } from "node:crypto";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { createAgent, type PaperSize } from "@/lib/printHelpers";

/** His number, 2026-09-13: *"that generated code only works for 10 min"*. Long enough to walk from
 *  the till to the kitchen computer; short enough that a code on a screen is rubbish by the time
 *  anybody else reads it. */
export const SETUP_CODE_TTL_MS = 10 * 60_000;

const hash = (s: string) => createHash("sha256").update(String(s)).digest("hex");

/** NO 0/O, NO 1/I/l. This code is read off a screen and typed on another machine — often read ALOUD
 *  down a phone — so every ambiguous character is a support call. 31 letters, 6 long: 887 million
 *  codes for a ten-minute window, which is the reason the length can stay short enough to type. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;
const newCode = () => Array.from({ length: CODE_LEN }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

/**
 * WHAT THE PERSON TYPED, MADE INTO WHAT WE STORED.
 *
 * The screen shows `K7M P2X` because a six-character run is hard to read back, so somebody WILL type
 * the space — and somebody else will type the dash they remember seeing, and somebody on a phone
 * keyboard will send lower case. All four are the same code. Anything else is refused rather than
 * silently stripped: a code is A–Z and 2–9, full stop.
 */
export const normaliseCode = (raw: unknown): string =>
  String(raw ?? "").toUpperCase().replace(/[\s\-_·]/g, "").slice(0, 12);

const looksLikeCode = (c: string) => c.length === CODE_LEN && [...c].every((ch) => ALPHABET.includes(ch));

/** How the screen shows it. Two groups of three — the same reason a card number is grouped. */
export const prettyCode = (c: string) => `${c.slice(0, 3)} ${c.slice(3)}`;

export type IssuedCode = { code: string; pretty: string; expiresAt: string; expiresInMs: number };

/** Sanitised the same way a helper's reported printer names are: these strings travel into HTML and
 *  log lines, and they are a machine's word about itself, not ours. */
const clean = (v: unknown, max = 120) =>
  String(v ?? "").replace(/[\u0000-\u001f,"'\\]/g, "").trim().slice(0, max) || null;

/** Dead rows are dropped on every issue, so the table stays small with no cron. One indexed delete
 *  on a table that holds minutes of history. */
async function prune(): Promise<void> {
  await sb.from("print_setup_codes").delete().lt("expires_at", new Date(Date.now() - 60_000).toISOString());
}

/**
 * A signed-in person on the Printing screen presses "Show a setup code".
 *
 * ONE LIVE CODE PER RESTAURANT. Pressing it again kills the previous one in the same breath, so a
 * screen left open in an office cannot leave a second working code behind it, and "the code on my
 * screen" is never ambiguous. It also means the recovery for "I lost it" is simply to press again.
 */
export async function issueSetupCode(
  restaurantId: string,
  by: { kind: "admin" | "staff"; userId?: string | null; deviceId?: string | null },
): Promise<IssuedCode | { error: string }> {
  await prune();
  // The previous live one dies HERE, not when the new one is used: between the two there must never
  // be a moment where two codes both work.
  await sb.from("print_setup_codes").delete()
    .eq("restaurant_id", restaurantId).is("claimed_at", null).gte("expires_at", new Date().toISOString());

  const expires = new Date(Date.now() + SETUP_CODE_TTL_MS);
  // A collision is a 1-in-887-million draw against the handful of codes alive at once, but `code_hash`
  // is UNIQUE and a 23505 would surface as "could not make a code" for no reason a person could act
  // on. Three tries costs nothing and removes the case.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = newCode();
    const ins = await sb.from("print_setup_codes").insert({
      restaurant_id: restaurantId,
      code_hash: hash(code),
      issued_by_kind: by.kind,
      issued_by: by.userId || null,
      issued_device: by.deviceId ? String(by.deviceId).slice(0, 120) : null,
      expires_at: expires.toISOString(),
    }).select("id").maybeSingle();
    if (!ins.error && ins.data) {
      return { code, pretty: prettyCode(code), expiresAt: expires.toISOString(), expiresInMs: SETUP_CODE_TTL_MS };
    }
    if (ins.error?.code !== "23505") break;
  }
  return { error: "Could not make a setup code just now — try again." };
}

/**
 * What the BOARD may know about the live code: that there is one, and when it dies. Never the code.
 *
 * This is the half that makes hashing bearable. A person who refreshed the page has not lost their
 * setup — the board still says a code is live and how long it has — they have only lost the digits,
 * and the honest answer to that is a fresh code, not a second copy of a secret.
 */
export async function liveCodeState(restaurantId: string): Promise<{
  live: boolean; expiresAt: string | null; oldFileAt: string | null;
}> {
  const row = (await sb.from("print_setup_codes")
    .select("expires_at, refused_old_file_at")
    .eq("restaurant_id", restaurantId).is("claimed_at", null)
    .gte("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false }).limit(1).maybeSingle()).data as
      { expires_at: string; refused_old_file_at: string | null } | null;
  return {
    live: !!row,
    expiresAt: row?.expires_at || null,
    // The ONE thing an old helper cannot tell the person itself (mig 381).
    oldFileAt: row?.refused_old_file_at || null,
  };
}

export type ClaimMachine = {
  fingerprint?: unknown; hostname?: unknown; printers?: unknown; os?: unknown;
  /** The stamp the helper file carries, derived from its own text (printHelperScript.helperVersion).
   *  A claim with NO stamp can only come from a file made before 2026-09-13 — see the refusal in
   *  claimSetupCode, and mig 381 for the whole story. */
  helper?: unknown;
};

export type ClaimResult =
  | { ok: true; token: string; name: string; restaurant: string; agentId: string }
  | { ok: false; reason: "bad" | "used" | "expired" | "failed" | "oldfile"; error: string };

/**
 * The helper redeems the code the person typed.
 *
 * EVERY WRONG ANSWER IS THE SAME ANSWER — "that code is not right, or it has run out" — because
 * telling `no such code` apart from `that one has been used` turns this endpoint into a way to find
 * out which codes exist. The person standing at the printer has the same next step either way:
 * press the button again on the Printing screen.
 *
 * THE SPEND IS A FILTERED UPDATE, and that is the whole race guard: two helpers typing the same code
 * at once, and the second matches zero rows. The agent row is created only after the row is won, so
 * a loser never leaves a half-made computer on somebody's board.
 */
export async function claimSetupCode(rawCode: string, machine: ClaimMachine): Promise<ClaimResult> {
  const code = normaliseCode(rawCode);
  const wrong: ClaimResult = {
    ok: false, reason: "bad",
    error: "That setup code is not right, or it has run out. Press “Show a setup code” again on the Printing screen.",
  };
  if (!looksLikeCode(code)) return wrong;

  const row = (await sb.from("print_setup_codes")
    .select("id, restaurant_id, claimed_at, expires_at, issued_device, issued_by")
    .eq("code_hash", hash(code)).maybeSingle()).data as
      { id: string; restaurant_id: string; claimed_at: string | null; expires_at: string;
        issued_device: string | null; issued_by: string | null } | null;
  if (!row) return wrong;
  if (row.claimed_at) return { ...wrong, reason: "used" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ...wrong, reason: "expired" };

  // ── AN OUT-OF-DATE FILE IS ITS OWN ANSWER, AND IT COSTS NOTHING (mig 381) ──────────────────
  // Checked AFTER the code is known good, deliberately: an unstamped claim with a WRONG code must
  // still read exactly like any other wrong code, or this becomes a way to tell real codes apart.
  //
  // Refused WITHOUT spending it. That is the whole point. When this was silent, an old helper
  // burned the code, left a dead computer row behind and said nothing — so the next try did the
  // same thing, and the owner photographed the identical error twice. Now the code on his screen
  // survives with its clock still running, nothing is created, and the BOARD can say why: an old
  // helper cannot show our message, because reading it is the thing that is broken in it.
  if (!String(machine.helper || "").trim()) {
    await sb.from("print_setup_codes")
      .update({ refused_old_file_at: new Date().toISOString() }).eq("id", row.id);
    return {
      ok: false, reason: "oldfile",
      error: "This helper file is out of date. On the Printing screen, press Copy under the helper file, paste it over the file on this computer, save it, and run it again — your setup code is still good.",
    };
  }

  const hostname = clean(machine.hostname, 80);
  // WIN THE ROW FIRST. Nothing is created until this update matches — see the note above.
  const won = await sb.from("print_setup_codes")
    .update({ claimed_at: new Date().toISOString(), claimed_host: hostname })
    .eq("id", row.id).is("claimed_at", null)
    .select("id").maybeSingle();
  if (won.error || !won.data) return { ...wrong, reason: "used" };

  // THE MACHINE NAMES ITSELF (owner, 2026-08-27: *"what the fuck is a computer name"*). The hostname
  // the machine reported is the name; nobody is asked for one. A collision inside one restaurant is
  // suffixed rather than refused — a person at a printer must never be shown a uniqueness error.
  const wanted = hostname || "This computer";
  // ── THE NAME CHECK MUST MATCH THE INDEX, INCLUDING REVOKED ROWS ────────────────────────────
  // Found by running the real helper (2026-09-13): unlink a computer, run the file again, type a
  // fresh code — and it was refused with *"There is already a computer with that name."* The person
  // is standing at a printer and there is nothing they can do about that sentence.
  //
  // WHY: `print_agents` is UNIQUE (restaurant_id, name) across ALL rows (mig 341), and rows are
  // REVOKED rather than deleted on purpose, so the record of what printed where stays readable. This
  // check filtered revoked rows out, so the name it chose looked free and the database disagreed.
  // Re-linking the SAME machine is the commonest path there is — its hostname has not changed — so
  // this was the most likely thing to happen, not the least.
  //
  // (Inherited from mig 368's approvePairing, which had the identical filter. It mattered less then:
  // re-linking meant pressing Allow in a browser, and the error landed on a page rather than on a
  // person at a till.)
  // ── A SETUP THAT NEVER FINISHED MUST NOT KEEP THE MACHINE'S NAME (2026-09-13) ──────────────
  // Seen on the owner's own PC. His helper redeemed a code, a row called INFINITE was created, and
  // the old file could not read the token back — so that row sat there having NEVER said hello, and
  // the next attempt came back as "INFINITE (2)". Left alone, every failed setup permanently eats
  // the real name of the machine, and the board fills with (2), (3), (4).
  //
  // A GHOST IS NARROWLY DEFINED, because getting this wrong would rename a working computer: it has
  // never said hello AT ALL, and it is older than the ten minutes any setup code can live. A machine
  // that genuinely joined says hello seconds later — the helper's own next act — so nothing real
  // can sit in that window.
  //
  // It is RENAMED AND RETIRED, never deleted: print_agents rows are kept so the record of what
  // printed where stays readable (mig 341), and a revoked row still holds its name against the
  // UNIQUE index. The new name says plainly what it was.
  const ghostCut = new Date(Date.now() - SETUP_CODE_TTL_MS).toISOString();
  const ghosts = ((await sb.from("print_agents").select("id, name")
    .eq("restaurant_id", row.restaurant_id).eq("name", wanted)
    .is("last_seen_at", null).is("revoked_at", null)
    .lt("created_at", ghostCut).limit(20)).data || []) as { id: string; name: string }[];
  for (const g of ghosts) {
    // SCOPED IN THE STATEMENT, not one statement earlier (T28 of sweep #9, 2026-09-15). The `ghosts`
    // read above is already `.eq("restaurant_id", row.restaurant_id)`, so `g.id` is provably this
    // restaurant's — and `verify:scoped-reads` was still RED on this write, correctly: inside `lib/`
    // the WHERE clause is the only fence, and a scope that lives in a DIFFERENT statement is one
    // refactor away from not being there at all. This renames and RETIRES a computer, which is the
    // last write that should ever be reachable from the wrong restaurant. One clause, no exemption.
    await sb.from("print_agents").update({
      name: `${g.name} (never started, ${new Date().toISOString().slice(0, 10)})`,
      revoked_at: new Date().toISOString(),
    }).eq("restaurant_id", row.restaurant_id).eq("id", g.id);
  }

  const taken = ((await sb.from("print_agents").select("name")
    .eq("restaurant_id", row.restaurant_id).limit(500)).data || []) as { name: string }[];
  const names = new Set(taken.map((t) => t.name));
  let name = wanted;
  for (let n = 2; names.has(name) && n < 200; n++) name = `${wanted} (${n})`;

  // ── THE SCREEN THAT HANDED OUT THE CODE IS THE SCREEN THAT MANAGES THE MACHINE ─────────────
  // (Caught by the printing sweep, phases 88–97, 2026-09-13.) mig 367 is the owner's own design:
  // *"that device is connected to the printer, so it will be easy for THAT device to set up the
  // printer… and that device will only get the option in settings."* The panel finds its computer
  // by `owner_device`, and the machine redeeming a code is a HELPER — a shell script with no
  // browser and no device id — so a row created from a claim had none, and the panel on the very
  // machine that had just been set up still said "this computer is not set up yet".
  //
  // The device that ISSUED the code is the honest answer: somebody pressed the button on that
  // screen, on that machine, moments ago. An admin-issued code carries no device, and the row
  // correctly gets none — which is exactly what "Aevidine set this one up" looks like on screen.
  let made = await createAgent(row.restaurant_id, name, {
    deviceId: row.issued_device, userId: row.issued_by,
  });
  // AND A BELT AS WELL AS BRACES. Two machines redeeming two codes at the same moment can both read
  // the same "free" name and race for it, and the loser must not be handed a database word either.
  for (let n = 2; "error" in made && /already a computer with that name/i.test(made.error) && n < 200; n++) {
    name = `${wanted} (${n})`;
    made = await createAgent(row.restaurant_id, name);
  }
  if ("error" in made) {
    // The code was spent to win the race and the computer could not be made. Hand the code BACK
    // rather than burning the person's ten minutes on our own failure — the row is still theirs.
    await sb.from("print_setup_codes").update({ claimed_at: null, claimed_host: null }).eq("id", row.id);
    return { ok: false, reason: "failed", error: made.error };
  }

  // The printers the machine already reported travel onto the agent row, so the routing dropdowns
  // are full the instant the board reloads — nobody should have to wait for a first hello to be able
  // to say which printer prints the bills.
  const printers = asReportedPrinters(machine.printers);
  const patch: Record<string, unknown> = {};
  if (printers.length) patch.printers = printers;
  const fp = clean(machine.fingerprint);
  if (fp) patch.fingerprint = fp;
  if (Object.keys(patch).length) await sb.from("print_agents").update(patch).eq("id", made.id);
  await sb.from("print_setup_codes").update({ agent_id: made.id }).eq("id", row.id);

  const rest = (await sb.from("restaurants").select("name").eq("id", row.restaurant_id).maybeSingle()).data as
    { name?: string } | null;
  return {
    ok: true, token: made.token, name, agentId: made.id,
    restaurant: String(rest?.name || "your restaurant"),
  };
}

/** The machine's word about its own printers, bounded and cleaned before it is believed. Unchanged
 *  from the shape mig 368 used — a printer list is a printer list however the machine got here. */
function asReportedPrinters(v: unknown): { name: string; desc?: string; paper?: PaperSize }[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 40).map((p) => {
    const o = (p && typeof p === "object" ? p : { name: p }) as Record<string, unknown>;
    const pp = o.paper as Record<string, unknown> | undefined;
    const w = Number(pp?.wMm), h = Number(pp?.hMm);
    return {
      name: clean(o.name) || "",
      ...(clean(o.desc, 160) ? { desc: clean(o.desc, 160) as string } : {}),
      ...(w >= 20 && w <= 500 && h >= 20 && h <= 3600 ? { paper: { wMm: w, hMm: h } } : {}),
    };
  }).filter((p) => p.name);
}
