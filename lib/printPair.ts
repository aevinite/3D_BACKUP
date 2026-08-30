// lib/printPair.ts — the handshake that means nobody types anything (mig 368).
//
// Owner, 2026-08-27, choosing between "type 6 digits" and "click Allow": *"zero typing one, yeah"*.
//
// THE SHAPE, and it is the one a smart TV uses to pair with Netflix (OAuth's "device flow"):
//
//   helper (holds NO secret)                     the person's browser, already signed in
//   ─────────────────────────                    ────────────────────────────────────────
//   start()  ──► code + private secret
//        opens /pair?c=<code> on ITS OWN machine ──►  sees the hostname + printers it reported
//                                                     presses ALLOW  ──►  approve()
//   poll(code, secret) ◄── the token, ONCE
//   writes the token to its own disk, forever
//
// THREE THINGS MAKE IT SAFE, and each is doing real work:
//
//  1. THE BROWSER OPENS ON THE MACHINE AT THE PRINTER. That is the proof of "this is that computer" —
//     nobody on the other side of the internet can be the machine standing next to the roll.
//  2. THE CODE IS NOT A CREDENTIAL. On its own it can do exactly one thing: be shown to a logged-in
//     human for approval. Seeing it over a shoulder gains nothing.
//  3. THE TOKEN IS COLLECTED WITH A SECRET ONLY THE HELPER HOLDS, and exactly once. So even a person
//     who approved the pairing cannot read the token afterwards, and a second poll gets nothing.
//
// And the restaurant is chosen by the APPROVER, never by the helper. A helper cannot ask to join a
// restaurant; it can only ask to be adopted, and a human with the permission decides by whom.
import { createHash, randomBytes, randomInt } from "node:crypto";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { createAgent, type PaperSize } from "@/lib/printHelpers";

/** A pairing nobody approves is rubbish. Ten minutes is long enough to walk to the counter and
 *  short enough that an abandoned one is never lying around. */
export const PAIR_TTL_MS = 10 * 60_000;

const hash = (s: string) => createHash("sha256").update(String(s)).digest("hex");

/** The public half: what the URL carries. Deliberately human-readable in groups, because the ONE
 *  time a person has to look at it is when the browser failed to open and they are reading it off a
 *  screen onto a phone. Ambiguous characters (0/O, 1/I/l) are left out for the same reason. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

export type PairStart = { code: string; secret: string; pairUrl: string; expiresInMs: number };

export type PairRow = {
  id: string; code: string; fingerprint: string | null; hostname: string | null;
  printers: { name: string; desc?: string; paper?: PaperSize }[]; os: string | null;
  restaurant_id: string | null; agent_id: string | null;
  approved_at: string | null; collected_at: string | null; expires_at: string;
};

const ROW_COLS = "id, code, fingerprint, hostname, printers, os, restaurant_id, agent_id, approved_at, collected_at, expires_at";

/** Sanitised the same way a helper's reported printer names are: these strings travel into HTML and
 *  log lines, and they are a machine's word about itself, not ours. */
const clean = (v: unknown, max = 120) =>
  String(v ?? "").replace(/[\u0000-\u001f,"'\\]/g, "").trim().slice(0, max) || null;

/**
 * The helper says "here I am". No authentication — there is nothing to authenticate yet, and that is
 * the point: this row grants nothing until a human approves it.
 *
 * Every expired row is dropped in the same breath, so the table stays small with no cron. It is one
 * indexed delete on a table that holds minutes of history.
 */
export async function startPairing(info: {
  fingerprint?: unknown; hostname?: unknown; printers?: unknown; os?: unknown; origin: string;
}): Promise<PairStart | { error: string }> {
  await sb.from("print_pairings").delete().lt("expires_at", new Date().toISOString());

  const code = newCode();
  const secret = randomBytes(24).toString("base64url");
  const printers = Array.isArray(info.printers)
    ? info.printers.slice(0, 40).map((p) => {
        const o = (p && typeof p === "object" ? p : { name: p }) as Record<string, unknown>;
        const pp = o.paper as Record<string, unknown> | undefined;
        const w = Number(pp?.wMm), h = Number(pp?.hMm);
        return {
          name: clean(o.name) || "",
          ...(clean(o.desc, 160) ? { desc: clean(o.desc, 160) as string } : {}),
          ...(w >= 20 && w <= 500 && h >= 20 && h <= 3600 ? { paper: { wMm: w, hMm: h } } : {}),
        };
      }).filter((p) => p.name)
    : [];

  const ins = await sb.from("print_pairings").insert({
    code, secret_hash: hash(secret),
    fingerprint: clean(info.fingerprint), hostname: clean(info.hostname, 80),
    printers, os: clean(info.os, 20),
    expires_at: new Date(Date.now() + PAIR_TTL_MS).toISOString(),
  }).select("id").maybeSingle();
  if (ins.error || !ins.data) return { error: "Could not start pairing." };

  return { code, secret, pairUrl: `${info.origin}/pair?c=${code}`, expiresInMs: PAIR_TTL_MS };
}

/** What the Allow page shows. It reads by CODE and returns only what a person needs to recognise the
 *  machine — never the secret, never a token. */
export async function pairingByCode(code: string): Promise<PairRow | null> {
  const c = String(code || "").trim().toUpperCase();
  if (c.length < 6 || c.length > 16) return null;
  const r = (await sb.from("print_pairings").select(ROW_COLS).eq("code", c).maybeSingle()).data as PairRow | null;
  if (!r) return null;
  if (new Date(r.expires_at).getTime() < Date.now()) return null;
  return { ...r, printers: Array.isArray(r.printers) ? r.printers : [] };
}

/**
 * A signed-in human says yes. THIS is where the restaurant is decided and the agent row is born —
 * the helper had no say in either.
 *
 * The name comes from the machine (`hostname`), which is the whole answer to the owner's complaint
 * ("what the fuck is a computer name"): the machine already knows, so nobody is asked. A name that
 * collides with an existing one for that restaurant is suffixed rather than refused, because a
 * person pressing Allow should never be shown a database error about uniqueness.
 */
export async function approvePairing(
  code: string,
  by: { restaurantId: string; userId?: string | null; deviceId?: string | null; name?: string | null },
): Promise<{ ok: true; agentId: string; name: string } | { error: string }> {
  const row = await pairingByCode(code);
  if (!row) return { error: "That pairing has expired. Start the helper again and it will make a new one." };
  if (row.approved_at) return { error: "That computer has already been linked." };

  const wanted = clean(by.name, 60) || row.hostname || "This computer";
  let name = wanted;
  // BOUNDED below (T25 round 2, item 31): the names already in use at ONE restaurant.
  const taken = ((await sb.from("print_agents").select("name")
    .eq("restaurant_id", by.restaurantId).is("revoked_at", null).limit(200)).data || []) as { name: string }[];
  const names = new Set(taken.map((t) => t.name));
  for (let n = 2; names.has(name) && n < 20; n++) name = `${wanted} (${n})`;

  const made = await createAgent(by.restaurantId, name, { deviceId: by.deviceId, userId: by.userId });
  if ("error" in made) return { error: made.error };

  // The printers the machine already reported travel onto the agent row, so the routing dropdowns
  // are full the instant the page reloads — a person should not have to wait for the helper's first
  // hello to be able to say which printer prints the bills.
  const patch: Record<string, unknown> = {};
  if (row.printers.length) patch.printers = row.printers;
  if (row.fingerprint) patch.fingerprint = row.fingerprint;
  if (Object.keys(patch).length) await sb.from("print_agents").update(patch).eq("id", made.id);

  const up = await sb.from("print_pairings").update({
    restaurant_id: by.restaurantId, agent_id: made.id,
    approved_at: new Date().toISOString(), approved_by: by.userId || null,
    token_once: made.token,
  }).eq("id", row.id).is("approved_at", null).select("id").maybeSingle();
  // The filtered update is the race guard: two people pressing Allow at once, and the second
  // matches zero rows. Its agent row is retired rather than left live, so nothing prints twice.
  if (up.error || !up.data) {
    await sb.from("print_agents").update({ revoked_at: new Date().toISOString() }).eq("id", made.id);
    return { error: "Somebody else linked that computer a moment ago." };
  }
  return { ok: true, agentId: made.id, name };
}

/**
 * The helper asks "am I in yet?". Answers `waiting`, `expired`, or the token — ONCE.
 *
 * The token is handed over and blanked in a single filtered update, so a replayed poll (a helper
 * restarted mid-pairing, a retried request) can never be given a second copy of it.
 */
export async function pollPairing(code: string, secret: string): Promise<
  { state: "waiting" } | { state: "expired" } | { state: "linked"; token: string; name: string; restaurant: string }
> {
  const c = String(code || "").trim().toUpperCase();
  const row = (await sb.from("print_pairings")
    .select("id, secret_hash, approved_at, token_once, collected_at, expires_at, agent_id, restaurant_id")
    .eq("code", c).maybeSingle()).data as {
      id: string; secret_hash: string; approved_at: string | null; token_once: string | null;
      collected_at: string | null; expires_at: string; agent_id: string | null; restaurant_id: string | null;
    } | null;
  // A WRONG SECRET AND A MISSING ROW ANSWER THE SAME WAY. Telling them apart would turn this
  // endpoint into a way to find out which codes exist.
  if (!row || row.secret_hash !== hash(secret)) return { state: "expired" };
  if (new Date(row.expires_at).getTime() < Date.now()) return { state: "expired" };
  // A SPENT PAIRING IS SPENT, and it must SAY so (found by verify:printing-sweep, phase 104). Without
  // this line a replayed poll fell through to "waiting" — the token had already been collected and
  // blanked, so `!row.token_once` was true — and a helper restarted a moment after collecting would
  // sit there being told "waiting for approval" until it timed out, with a perfectly good token
  // already on its disk. The state has to be readable, not just safe.
  if (row.collected_at) return { state: "expired" };
  if (!row.approved_at || !row.token_once) return { state: "waiting" };

  const claim = await sb.from("print_pairings")
    .update({ token_once: null, collected_at: new Date().toISOString() })
    .eq("id", row.id).not("token_once", "is", null)
    .select("id").maybeSingle();
  if (claim.error || !claim.data) return { state: "expired" };   // somebody already collected it

  const [ag, rest] = await Promise.all([
    sb.from("print_agents").select("name").eq("id", row.agent_id as string).maybeSingle(),
    sb.from("restaurants").select("name").eq("id", row.restaurant_id as string).maybeSingle(),
  ]);
  return {
    state: "linked", token: row.token_once,
    name: String((ag.data as { name?: string } | null)?.name || "This computer"),
    restaurant: String((rest.data as { name?: string } | null)?.name || "your restaurant"),
  };
}
