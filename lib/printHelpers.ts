// lib/printHelpers.ts — the HELPERS that actually put paper in a printer, and the address book
// that decides which printer that is.
//
// WHY THIS EXISTS AT ALL (owner, 2026-08-20). A web page cannot choose a printer: silent printing
// under Chrome's --kiosk-printing always goes to the machine's DEFAULT printer, and there is no web
// API to pick one — so one browser profile can only ever serve one printer, for ever. Aangan has
// THREE on one machine (kitchen slips, bills, a small-paper A4 for banquet sheets) and one man who
// is both owner and manager, whose screen the printing window kept stealing. Every POS that routes
// paper per document does it from installed software, never from a tab.
//
// So a tiny program — a HELPER — runs on each machine that has printers. It polls print_jobs over
// plain outbound HTTPS, prints the job on the printer named in the job, and confirms. It holds NO
// rules and NO layout: everything below stays server-side, which is why their machine is installed
// once and never revisited.
//
// WHAT IS DELIBERATELY REUSED: print_jobs (mig 269) already IS the queue, mig 335 already fills it
// from the order trigger, and its single filtered UPDATE claim is already what makes double
// printing impossible. This file adds WHO (print_agents, mig 341) and WHERE (the address book) —
// it does not build a second queue, and it does not touch the claim's shape.
//
// Server-only: it imports the service-role client and every function is scoped by restaurant_id.
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { STALE_CLAIM_MS, wrote } from "@/lib/printQueue";
import type { PaperSize, PrinterState } from "@/lib/printBoardWords";
import { KIND_LABEL, KIND_OFF_LABEL, isPrinterState } from "@/lib/printBoardWords";
// Which modules this restaurant actually has — ONE settings select for all of them (mig 320).
import { allModuleLadders } from "@/lib/tableTags";

/** A helper that has not said hello inside this window is shown as not connected. It polls every
 *  ~2s, so 30s means "three quarters of a minute of silence" — long enough to survive a hiccup,
 *  short enough that a dead helper is never reported as alive while paper piles up in the basket. */
export const HELPER_STALE_MS = 30_000;

/**
 * ── A POLL IS A SIGN OF LIFE, NOT JUST A HELLO (2026-09-14) ──────────────────────────────────
 *
 * `last_seen_at` used to be written by `hello` and by nothing else, and that was safe only while
 * hello was asked on every single poll. It is not any more: hello costs ~379ms and is now asked on
 * every FIFTH round, because paying it 43,000 times a day per computer to learn nothing was the
 * biggest single cost in an idle helper.
 *
 * Those two changes together made a fault nobody would have predicted from either one. A round does
 * not return until the backlog is EMPTY — that is what makes a rush drain without waiting out a poll
 * interval — so a helper printing eight slips stays inside one round for the best part of a minute.
 * Five of those in a row without a hello is minutes of silence, and everything that reads
 * HELPER_STALE_MS then says the computer is NOT CONNECTED: the manager's status rows, the owner's,
 * the admin board, and `canTest`. The machine that is printing hardest is the one reported as
 * asleep, which is exactly backwards, and exactly what the owner asked those rows to tell him
 * ("you could able to see that everything is connected and everything is live").
 *
 * So ANY authenticated ask from a helper now counts as a sign of life — asking for work is at least
 * as good evidence as saying hello. It is written at most once every ten seconds, which is what
 * keeps it cheap: a helper polling every two seconds pays one small indexed update per five polls,
 * not one per poll, and a helper that has stopped still goes quiet and still turns cold after 30s.
 */
export const SEEN_REFRESH_MS = 10_000;
// ── IT TAKES THE ROW, NOT A BARE ID (T28 of sweep #9, 2026-09-15) ────────────────────────────────
// It used to be `touchAgent(id: string, lastSeenAt: string | null)`, and the write below was
// `.eq("id", id)` with no restaurant in it — the one statement in this file that `verify:scoped-reads`
// could not excuse, and it was RED on `main`.
//
// It was SAFE, and that is exactly why it is worth fixing rather than exempting. Both callers pass
// `agent.id` from a row `agentByToken()` resolved out of the helper's own bearer token, so the id was
// never caller-chosen. But it crossed a function boundary as a bare string, so nothing in this
// signature said so: a future caller could hand it any id at all, and inside `lib/` the WHERE clause
// is the only fence there is — the service-role client has no row-level rules applied to it.
//
// The sibling `helloAgent()` never had this problem because it takes the whole row, which is why the
// guard excuses its identical `.eq("id", agent.id)`. So this one takes the row too: the restaurant is
// then in hand by construction, the write says which restaurant it is stamping, and the shape needs
// no exemption at all. The guard got stricter, not more permissive.
export async function touchAgent(agent: Pick<AgentRow, "id" | "restaurant_id" | "last_seen_at">): Promise<void> {
  if (agent.last_seen_at && Date.now() - new Date(agent.last_seen_at).getTime() < SEEN_REFRESH_MS) return;
  // Through `wrote`, like every other write in this area — and for the exact fault this function
  // exists to fix: if the stamp silently fails, the boards say NOT CONNECTED about a computer whose
  // helper is polling perfectly, somebody is sent to troubleshoot a machine that is fine, and
  // nothing anywhere says the write never landed. Not a throw: a print path that crashes leaves the
  // ticket in a worse state than one that carries on.
  await wrote("touchAgent seen-stamp", sb.from("print_agents")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("restaurant_id", agent.restaurant_id).eq("id", agent.id));
}

// ── THERE IS NO BACKUP PRINTER (owner, 2026-08-30) ───────────────────────────────────────────
// "What is this backup printer? We don't even need the backup printer — if there is a backup
// printer, remove it. If anything fails it should show me or the person: manager, owner, everyone
// should get a notification that this has failed, and if you want to reprint it."
//
// It was two waits for one idea — 60 seconds before a backup PRINTER took a ticket, 30 before a
// backup SCREEN did — and neither screen mentioned the other. Worse than the mismatched numbers: a
// silent second attempt somewhere else is paper appearing in a room nobody is standing in, and a
// restaurant that never learns its printer is broken.
//
// What replaces it is not a shorter wait. It is TELLING SOMEBODY: a ticket that cannot print is
// parked, a printer problem is filed against that printer so it shows on the floor, and an alert
// goes to the owner. Reprinting is then a decision a person makes, which is the only kind of
// decision that ends with somebody checking the paper came out.

// "label" (parcel stickers) LEFT this list on 2026-08-27. It was never a real kind: nothing in the
// app ever queued one, lib/printDocs.ts has no builder for it, and it existed only as a fifth empty
// line in the address book that nobody could ever fill usefully. The owner asked for exactly this —
// "those minor things which were built before and which are not in use, remove that also".
export const PRINT_KINDS = ["kot", "bill", "banquet", "test"] as const;
export type PrintKind = (typeof PRINT_KINDS)[number];
export const isPrintKind = (v: unknown): v is PrintKind =>
  typeof v === "string" && (PRINT_KINDS as readonly string[]).includes(v);

/** The kinds a person is ever asked to ROUTE — the three real documents this app prints.
 *
 *  Owner, 2026-08-27: "which printer gets which paper, so why there are only three options — one is
 *  bill, one is KOT and one is banquet?" That IS the honest answer, and this constant is where it is
 *  written down: three documents exist, so three lines exist. "test" is a kind of JOB but never a
 *  line in the address book — a test page is addressed straight at the printer whose button was
 *  pressed, so a route for it could only ever contradict the button. */
export const ROUTABLE_KINDS = ["kot", "bill", "banquet"] as const;
export type RoutableKind = (typeof ROUTABLE_KINDS)[number];
export const isRoutableKind = (v: unknown): v is RoutableKind =>
  typeof v === "string" && (ROUTABLE_KINDS as readonly string[]).includes(v);

/** One line of the address book: "kitchen slips → this machine → this printer", plus an optional
 *  second choice for when the first prints nothing. Both halves are names the MACHINE reported,
 *  never typed by a person — which is why a printer nobody owns can never be routed to. */
/** WHO does the printing for one kind of paper. Two shapes, and the owner picks per line (2026-08-26:
 *  "if I want to print from kitchen panel or maybe I want to print from manager panel and which
 *  particular manager… which owner panel… which PC will be open and from that same PC the print is
 *  going to happen — all will be decided by me").
 *
 *  · "computer" — a helper program on a machine prints it on a named printer. No window, no login.
 *  · "screen"   — a PANEL prints it, the old way, but now NARROWED: which panel, optionally WHICH
 *                 PERSON (a named manager, a named owner), and optionally which exact device.
 *
 *  A screen route is not a step backwards: it is the honest answer for a restaurant that will not
 *  install anything, and it is now precise instead of "whichever screen volunteered first". */
/** …and the third answer, added 2026-08-27 because the owner kept asking for it and it was never
 *  there: "I WANT A PROPER OPTION TO ON AND OFF IT — for example, if I ON it here, YES, PRINT HERE."
 *  An EMPTY line and an OFF line look the same to a machine but mean opposite things to a person:
 *  empty is "nobody has set this up yet", off is "we have decided this does not print". Screens say
 *  each of them in its own words instead of both going quiet. */
export type RouteVia = "computer" | "screen" | "off";
export const ROUTE_PANELS = ["kitchen", "manager", "owner", "tablet"] as const;
export type RoutePanel = (typeof ROUTE_PANELS)[number];
export const isRoutePanel = (v: unknown): v is RoutePanel =>
  typeof v === "string" && (ROUTE_PANELS as readonly string[]).includes(v);

export type PrintRoute = {
  via?: RouteVia;              // absent = "computer" when an agent is named, else nothing is routed; "off" = decided not to print
  agent: string | null;        // print_agents.id
  printer: string | null;      // the printer name as its own computer knows it
  /** via:"screen" — WHICH panel prints it. */
  panel?: RoutePanel | null;
  /** …and optionally WHICH PERSON, by staff_users.id. Null = anybody on that panel who is allowed to
   *  print. Named = only that person's screen, which is the "which particular manager" answer. */
  person?: string | null;
  personName?: string | null;  // remembered for the screens, so a name never needs a second read
  /** …and optionally which DEVICE (the per-browser id print_stations already uses). Null = any device
   *  that person signs in on; named = that one PC, which is the "from that same PC" answer. */
  device?: string | null;
  /** Overrides what the machine reported. This is the line the owner needs for his banquet machine:
   *  an A4 printer that is loaded with sheets "almost half or smaller than half of it" — so the
   *  paper is a per-route answer (A4 · A5 · A6 · or two typed numbers), never a guess from the
   *  printer's model name. */
  paper?: PaperSize;
};
export type PrintRoutes = Record<PrintKind, PrintRoute>;

const EMPTY_ROUTE: PrintRoute = { agent: null, printer: null };
const emptyRoutes = (): PrintRoutes =>
  PRINT_KINDS.reduce((a, k) => { a[k] = { ...EMPTY_ROUTE }; return a; }, {} as PrintRoutes);

/** The paper a printer is set to, in millimetres. Reported by the machine when it can work it out
 *  (macOS/Linux read it straight out of the queue's own PPD), and otherwise chosen by the admin per
 *  route. It matters more than it looks: a PDF page that is a DIFFERENT SIZE from the paper in the
 *  printer is what makes a driver rotate the ticket or shrink it to half size — the exact fault the
 *  owner photographed on 2026-08-19. Page size and media are made to agree, always. */
export type { PaperSize, PrinterState } from "@/lib/printBoardWords";

export type AgentRow = {
  id: string;
  restaurant_id: string;
  name: string;
  fingerprint: string | null;
  printers: { name: string; desc?: string; paper?: PaperSize; state?: PrinterState }[];
  last_seen_at: string | null;
  revoked_at: string | null;
  /** The browser that set this helper up from its OWN panel (mig 367), if a restaurant did rather
   *  than the admin. It is how Settings → Printing knows "this computer is already set up". */
  owner_device?: string | null;
  owner_user?: string | null;
};
export type AgentView = AgentRow & { connected: boolean; secondsAgo: number | null; fingerprintClash: boolean };

const asPaper = (v: unknown): PaperSize | undefined => {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const w = Number(o.wMm), h = Number(o.hMm);
  // Sanity, not trust: a receipt roll is 58-80mm and the longest sheet anyone prints is a 3.2m
  // continuous roll. Anything outside that is a parse gone wrong on the machine's side, and a wrong
  // page size is worse than none — it is the rotation fault.
  if (!(w >= 20 && w <= 500 && h >= 20 && h <= 3600)) return undefined;
  return { name: o.name ? String(o.name).slice(0, 60) : undefined, wMm: Math.round(w * 10) / 10, hMm: Math.round(h * 10) / 10 };
};

const AGENT_COLS = "id, restaurant_id, name, fingerprint, seen_fingerprints, printers, last_seen_at, revoked_at, owner_device, owner_user";

const asPrinters = (v: unknown): { name: string; desc?: string; paper?: PaperSize; state?: PrinterState }[] =>
  Array.isArray(v)
    ? v.map((p): Record<string, unknown> => (p && typeof p === "object" ? p as Record<string, unknown> : { name: p }))
        .map((p) => ({
          // A PRINTER NAME IS A QUEUE NAME, not free text — and it is reported by the machine about
          // ITSELF, so it is untrusted input that later travels into database filters, log lines and
          // HTML. CUPS forbids space and / # already; Windows allows spaces and brackets. So: keep
          // what a real queue name can hold, drop control characters and the punctuation that means
          // something in a filter (comma, quotes, backslash), and cap the length. Belt AND braces —
          // the filters themselves stopped being built from strings in the same commit.
          name: String(p.name ?? "").replace(/[\u0000-\u001f,"'\\]/g, "").trim().slice(0, 120),
          desc: p.desc ? String(p.desc).slice(0, 160) : undefined,
          paper: asPaper(p.paper),
          // ── AND WHETHER IT IS GOING TO PRINT (owner, 2026-09-14) ─────────────────────────────
          // Narrowed to the four words the type allows, for the same reason the name is scrubbed
          // two lines up: this is a machine reporting about itself, so it is untrusted input that
          // ends up in HTML. Anything else — including an OLD helper file, which sends no state at
          // all — becomes `undefined`, and every board reads that as "not reported" rather than
          // guessing. Guessing here would send somebody to a printer that is working.
          state: isPrinterState(p.state) ? p.state : undefined,
        }))
        .filter((p) => p.name)
        .slice(0, 40)
    : [];

// ── THE CODE A HELPER LOGS IN WITH ───────────────────────────────────────────────────────────
// A printing-only credential. It is generated here, shown to the person ONCE while they make the
// helper file, and stored only as a sha-256 hash — so a database read can never hand anyone a
// working code, and a lost code is replaced rather than recovered. It grants exactly three verbs
// (hello · next · done) inside one restaurant, and nothing else in the app will accept it.
export const hashAgentToken = (token: string) => createHash("sha256").update(String(token)).digest("hex");
export const mintAgentToken = () => {
  const token = "lfhp_" + randomBytes(24).toString("base64url");
  return { token, hash: hashAgentToken(token) };
};

/** Who owns this code — the first thing every poll does. One indexed read on the hash. */
export async function agentByToken(token: string): Promise<AgentRow | null> {
  const t = String(token || "").trim();
  if (t.length < 20) return null;
  const row = (await sb.from("print_agents").select(AGENT_COLS).eq("token_hash", hashAgentToken(t)).maybeSingle())
    .data as (Omit<AgentRow, "printers"> & { printers?: unknown }) | null;
  if (!row || row.revoked_at) return null;
  return { ...row, printers: asPrinters(row.printers) };
}

/** Add a machine and hand back its one-time code. The NAME is what every dropdown shows, so it is
 *  the person's own words ("Shop's computer"), unique per restaurant, and renameable later. */
export async function createAgent(
  rid: string,
  name: string,
  by?: { deviceId?: string | null; userId?: string | null },
): Promise<{ id: string; token: string } | { error: string }> {
  const label = String(name || "").trim().slice(0, 60) || "New computer";
  const { token, hash } = mintAgentToken();
  const ins = await sb.from("print_agents").insert({
    restaurant_id: rid, name: label, token_hash: hash,
    // Set only when the RESTAURANT set itself up from its own panel (mig 367). An admin-made helper
    // leaves both null, which is exactly what "the admin made this one" looks like on screen.
    ...(by?.deviceId ? { owner_device: String(by.deviceId).slice(0, 120) } : {}),
    ...(by?.userId ? { owner_user: by.userId } : {}),
  }).select("id").maybeSingle();
  if (ins.error || !ins.data) {
    // 23505 = the UNIQUE(restaurant_id, name) — a second "Shop's computer" is a mistake, not a
    // second machine, and telling them so is kinder than silently making two identical rows.
    return { error: ins.error?.code === "23505" ? "There is already a computer with that name." : "Could not add that computer." };
  }
  return { id: (ins.data as { id: string }).id, token };
}

/** The poll's own bookkeeping: remember the printer list, stamp "seen just now", and notice when
 *  ONE code turns up on TWO machines — the "somebody copied the helper file" case. No paper is
 *  duplicated even then (the claim prevents it), but half the tickets would come out in the wrong
 *  room, so it is reported rather than absorbed. */
export async function helloAgent(
  agent: AgentRow,
  info: { fingerprint?: string | null; printers?: unknown },
): Promise<{ clash: boolean }> {
  const fp = String(info.fingerprint || "").trim().slice(0, 120) || null;
  const printers = asPrinters(info.printers);
  const seen = new Set<string>();
  if (agent.fingerprint) seen.add(agent.fingerprint);
  if (fp) seen.add(fp);
  const patch: Record<string, unknown> = { last_seen_at: new Date().toISOString() };
  if (printers.length) patch.printers = printers;
  if (fp && !agent.fingerprint) patch.fingerprint = fp;          // first machine to use the code
  if (seen.size > 1) patch.seen_fingerprints = [...seen].slice(0, 6);
  // A WRITE NOBODY LOOKED AT IS NOT A WRITE. This one was the exception in an area where the other
  // eleven were all given the check in August (lib/printQueue → wrote). If it fails, the board says
  // "not heard from" about a computer whose helper is polling perfectly, the admin is sent to
  // troubleshoot a machine that is fine, and nothing anywhere says the stamp never landed.
  // NOT a throw, deliberately, for the same reason as every other write here: a print path that
  // crashes leaves the ticket in a worse state than one that carries on. It says so in the log,
  // where the Fix-NOW board and `vercel logs` both look.
  await wrote("helloAgent seen-stamp", sb.from("print_agents").update(patch).eq("id", agent.id));
  return { clash: !!(fp && agent.fingerprint && fp !== agent.fingerprint) };
}

/** "Is THIS computer already set up?" — the first question Settings → Printing asks of itself.
 *
 *  Answered from the panel's own per-device id, the same value print_stations keys on, so a person
 *  who sets a printer up on the counter machine and then opens the same panel on their phone is
 *  correctly told the phone is not that computer. One indexed read (mig 367). */
export async function agentForDevice(rid: string, deviceId: string | null | undefined): Promise<AgentView | null> {
  const dv = String(deviceId || "").trim();
  if (!dv) return null;
  const all = await agentsView(rid);
  return all.find((a) => a.owner_device === dv) || null;
}

/** Every helper this restaurant has, with the one fact that matters on screen: is it alive. */
export async function agentsView(rid: string): Promise<AgentView[]> {
  const rows = (await sb.from("print_agents").select(AGENT_COLS)
    .eq("restaurant_id", rid).is("revoked_at", null).order("created_at", { ascending: true })
    .limit(200)).data as
    (Omit<AgentRow, "printers"> & { printers?: unknown; seen_fingerprints?: unknown })[] | null;
  const now = Date.now();
  return (rows || []).map((r) => {
    const ms = r.last_seen_at ? now - new Date(r.last_seen_at).getTime() : null;
    const fps = Array.isArray(r.seen_fingerprints) ? r.seen_fingerprints : [];
    return {
      ...r, printers: asPrinters(r.printers),
      connected: ms != null && ms < HELPER_STALE_MS,
      secondsAgo: ms == null ? null : Math.round(ms / 1000),
      fingerprintClash: fps.length > 1,
    };
  });
}

// ── THE ADDRESS BOOK ─────────────────────────────────────────────────────────────────────────
// It lives in settings.modules.printing — the module BAG (mig 326), because a new module adds no
// column to settings (there are already 110). The ladder keys the bag readers care about
// (allowed / owner_control / enabled) sit in the same entry and are left alone here; `routes` is
// simply another key beside them.
const bagOf = (s: unknown): Record<string, Record<string, unknown>> =>
  (s && typeof s === "object" ? s as Record<string, Record<string, unknown>> : {});

/**
 * ── A FAILED READ IS NOT "NO ROUTES" (T26 sweep #9 reported the sibling; this is ours) ────────
 *
 * `readRoutes` took `.data` and ignored `.error`, so a transient failure came back as an EMPTY
 * address book — and empty is a perfectly valid answer meaning "nothing is set up". Every caller
 * then acted on it: the boards said no printer was set up, the doors offered a browser window
 * instead of queueing, and `claimSome` handed the helper nothing.
 *
 * Worse, and this is why it matters more here than anywhere else: **writeRoutes builds on it.** It
 * reads the current routes, merges the one line being changed onto them, and writes the result — so
 * one blip meant saving the bill line SILENTLY WIPED the kitchen-slip and banquet lines.
 *
 * So the read is checked. `readRoutes` still returns a plain `PrintRoutes`, because a dozen callers
 * want exactly that and a throw inside the helper's poll path would leave a ticket in a worse state
 * than empty routes would (the rule this whole file keeps). The caller that must NOT guess —
 * writeRoutes — asks `readRoutesChecked` instead and refuses to save on a failed read.
 */
export async function readRoutesChecked(rid: string): Promise<{ routes: PrintRoutes; failed: boolean }> {
  const q = await sb.from("settings").select("modules").eq("restaurant_id", rid).maybeSingle();
  if (q.error) {
    // Said out loud rather than absorbed: a silent empty address book is indistinguishable from a
    // restaurant that has never set a printer up, and that is the whole fault.
    console.error("[printHelpers] the printing routes could not be read:", q.error.message);
    return { routes: emptyRoutes(), failed: true };
  }
  return { routes: routesFromBag((q.data as { modules?: unknown } | null)?.modules), failed: false };
}

export async function readRoutes(rid: string): Promise<PrintRoutes> {
  return (await readRoutesChecked(rid)).routes;
}

function routesFromBag(modules: unknown): PrintRoutes {
  const raw = bagOf(modules)["printing"];
  const stored = raw && typeof raw.routes === "object" && raw.routes ? raw.routes as Record<string, unknown> : {};
  const out = emptyRoutes();
  for (const k of PRINT_KINDS) {
    const r = stored[k];
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    out[k] = {
      agent: o.agent ? String(o.agent) : null,
      printer: o.printer ? String(o.printer).slice(0, 120) : null,
      paper: asPaper(o.paper),
      via: o.via === "screen" ? "screen" : o.via === "off" ? "off" : o.agent ? "computer" : undefined,
      panel: isRoutePanel(o.panel) ? o.panel : null,
      person: o.person ? String(o.person) : null,
      personName: o.personName ? String(o.personName).slice(0, 80) : null,
      device: o.device ? String(o.device).slice(0, 120) : null,
    };
  }
  return out;
}

// ── THERE IS NO MODE ANY MORE (owner, 2026-08-31) ────────────────────────────────────────────
//
// *"in admin panel also we don't need toggle"* … *"with toggle gone, it on and off will decide that
// the helper will be on and off, and kitchen panel will always be on."*
//
// WHAT WENT. `PrintMode`, `isPrintMode`, `readMode` and `writeMode` — a stored "computer" | "screen"
// in the module bag, a pair of big buttons, a confirmation strip, and a function that rewrote all
// three paper lines whenever the buttons moved.
//
// WHY IT WENT, in his terms and in the code's. His: one less thing to answer. The code's: the mode
// was a SECOND answer to a question the routes already answered — `resolveTarget` reads "a route
// naming an agent means a computer, a route naming a panel means a screen" straight off the data.
// The stored copy existed only so the board could show ONE setup before anything was answered, and
// it could disagree with the routes, which is why `writeMode` had to drag them along behind it.
//
// WHAT DECIDES NOW, and it is one sentence: **a computer prints if one is set up and named; if none
// is, the kitchen screen does.** The on/off switch turns the whole feature off. Nothing to choose,
// nothing to keep in step, and no state that can contradict the paper.
//
// AND IT CANNOT DOUBLE-PRINT, which is the thing to check before believing any of this: a ticket is
// a ROW (mig 335) and `claimKotJobs` only wins rows still 'queued'. Two claimers racing means the
// second matches zero rows. The queue is what guarantees one copy — never the mode, which is part of
// why removing it costs nothing.
/**
 * Which panel a person actually stands at.
 *
 * The screen that prints is THEIR screen, so the panel FOLLOWS the person — it is never a second
 * thing to choose. Hard-coding "manager" here is what kept every kitchen user out of the picker
 * (owner, 2026-08-29: "choosing a person, there is not kitchen panel available"), because
 * writeRoutes then refused a cook for not being a manager and the screen simply offered nobody.
 */
export function panelForRole(role: string | null | undefined): RoutePanel {
  const r = String(role || "");
  if (r === "kitchen") return "kitchen";
  if (r === "waiter" || r === "tablet") return "tablet";
  return "manager";                       // a manager, and an owner working the manager panel
}

/** Is this line pointing at a SCREEN (a panel/person/device) rather than a helper on a computer? */
export const isScreenRoute = (r: PrintRoute | undefined): boolean => !!(r && r.via === "screen" && r.panel);

/**
 * The page size a document must be built at for THIS printer: the route's own answer if the admin
 * pinned one, else what the machine said the printer is loaded with, else nothing at all.
 *
 * "Nothing at all" is a real answer and not a failure: it means the document is served exactly as a
 * browser would print it, which is how every thermal ticket already works today. A GUESSED size is
 * the one thing that must never happen here — a page that disagrees with the paper is what rotates
 * a ticket or halves it.
 */
export function paperFor(route: PrintRoute | undefined, agent: AgentRow | null, printer: string | null): PaperSize | null {
  if (route?.paper) return route.paper;
  const p = (agent?.printers || []).find((x) => x.name === printer);
  return p?.paper || null;
}

/**
 * Save one or more lines of the address book.
 *
 * REFUSES anything that is not real: an unknown kind, a machine that is not this restaurant's, or
 * a printer that machine never said it had. A route that cannot print is worse than an empty one —
 * an empty line SAYS "no printer chosen" on screen, while a wrong one just goes quiet.
 */
/**
 * ── FIRST SAVE WINS ON THE ADDRESS BOOK TOO (owner, 2026-09-16 — T26 sweep #9, item 13) ─────────
 *
 * `was` is what the board showed for each line when it was tapped. If the stored line has moved
 * since, this refuses instead of overwriting: two tabs on the same restaurant used to mean the
 * second Save silently won, and "kitchen slips print at the bar" is not a change anyone should
 * make by accident.
 *
 * WHY THIS IS NOT lib/clash.ts, which every other value edit on the platform uses. That gate
 * compares COLUMNS on a row, and a printing line is not a column: it lives four levels down inside
 * `settings.modules.printing.routes.<kind>`, and the shape the board holds is `readRoutes`'
 * NORMALISED eight-key object while the shape stored in the jsonb is whatever was last written —
 * often three keys. Comparing those two directly fires on saves that are not clashes, which is the
 * false-positive machine lib/clash's own header warns about ("a guard that invents a failure is
 * worse than no guard"). So the comparison happens HERE, where `current` is already normalised by
 * the same function that normalised what the board was given, and both sides are the same shape by
 * construction.
 *
 * Only the kinds being WRITTEN are compared, so a save of the bill line is never refused because
 * somebody changed the kitchen line.
 */
export type RouteWas = Partial<Record<string, unknown>>;

/** The parts of a line that decide where paper comes out. Compared as a set, so a stored line that
 *  is missing an optional key reads the same as a normalised one that has it as null. */
const routeSignature = (r: unknown): string => {
  const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
  const pick = (k: string) => (o[k] == null || o[k] === "" ? "" : String(o[k]));
  return [pick("via"), pick("agent"), pick("printer"), pick("panel"), pick("person"), pick("device"), pick("paper")].join("|");
};

export async function writeRoutes(rid: string, patch: Record<string, unknown>, was?: RouteWas): Promise<{ routes: PrintRoutes } | { error: string; clash?: true }> {
  const agents = await agentsView(rid);
  const byId = new Map(agents.map((a) => [a.id, a]));
  // ── REFUSE, RATHER THAN SAVE ON TOP OF A GUESS ─────────────────────────────────────────────
  // The patch is merged onto `current`, so if this read failed and came back empty, saving ONE
  // paper line would clear the other two — the kitchen slips and the banquet sheet silently
  // un-routed by somebody choosing a printer for the bills. One press costs nothing to repeat; a
  // wiped address book costs a restaurant its printing.
  //
  // IT IS ALSO WHAT MAKES THE CLASH GATE BELOW HONEST (merged with T26's work, 2026-09-16). That
  // gate compares what the caller last saw against `current`; on a failed read `current` is empty,
  // so it would either cry "somebody else changed this" about nobody, or wave through a genuine
  // clash. Checking the read first is the only order in which both are true.
  const cur0 = await readRoutesChecked(rid);
  if (cur0.failed) return { error: "Could not read this restaurant's printing set-up just now, so nothing was changed. Try again." };
  const current = cur0.routes;
  // The gate. Skipped entirely when the caller sends no `was` — a script, an older tab and the
  // owner panel's own writes are all unaffected.
  if (was) {
    for (const kind of Object.keys(patch)) {
      if (!(kind in was)) continue;
      if (routeSignature(was[kind]) === routeSignature((current as Record<string, unknown>)[kind])) continue;
      return { error: "Somebody else changed this line while you had it open — the board has been refreshed with what it says now. Have a look and set it again if you still want to.", clash: true };
    }
  }
  const next: PrintRoutes = { ...current };

  for (const [kind, val] of Object.entries(patch || {})) {
    if (!isPrintKind(kind)) return { error: `There is no such kind of paper as "${kind}".` };
    if (val === null) { next[kind] = { ...EMPTY_ROUTE }; continue; }
    if (!val || typeof val !== "object") return { error: `The route for ${kind} is not readable.` };
    const o = val as Record<string, unknown>;
    // ── "NO, DO NOT PRINT THIS" ───────────────────────────────────────────────────────────────
    // The switch the owner asked for, and it is saved as a DECISION, not as an empty line: every
    // screen can then say "your restaurant has this switched off" instead of the far more alarming
    // "no printer has been chosen". Nothing else on the line survives — an off line that quietly
    // kept a printer name would come back on with a printer nobody remembers choosing.
    if (o.via === "off") { next[kind] = { via: "off", agent: null, printer: null }; continue; }
    const pick = (aKey: string, pKey: string): { agent: string | null; printer: string | null } | string => {
      const aId = o[aKey] ? String(o[aKey]) : null;
      const pName = o[pKey] ? String(o[pKey]) : null;
      if (!aId && !pName) return { agent: null, printer: null };
      if (!aId || !pName) return "Pick both a computer and one of its printers.";
      const a = byId.get(aId);
      if (!a) return "That computer is not one of this restaurant's.";
      if (!a.printers.some((p) => p.name === pName)) return `${a.name} has no printer called "${pName}".`;
      return { agent: aId, printer: pName };
    };
    const main = pick("agent", "printer");
    if (typeof main === "string") return { error: main };
    // ── A SCREEN ROUTE (via:"screen") ─────────────────────────────────────────────────────────
    // It names a PANEL, and may narrow to one PERSON and one DEVICE. Everything is checked against
    // real rows: a person must be this restaurant's staff, and their role must be able to stand at
    // that panel — a waiter cannot be the owner panel's printer, and a route that names an impossible
    // pair would print nowhere while looking set.
    if (o.via === "screen") {
      const panel = o.panel;
      if (!isRoutePanel(panel)) return { error: "Pick which screen prints it — kitchen, manager, owner or tablet." };
      let personId: string | null = null, personName: string | null = null;
      if (o.person) {
        const u = (await sb.from("staff_users").select("id, name, username, role, active")
          .eq("id", String(o.person)).eq("restaurant_id", rid).maybeSingle()).data as
          { id: string; name?: string | null; username?: string | null; role?: string | null; active?: boolean | null } | null;
        if (!u) return { error: "That person is not one of this restaurant's staff." };
        if (u.active === false) return { error: `${u.name || u.username} is switched off, so their screen cannot be the printer.` };
        const role = String(u.role || "");
        const fits = panel === "kitchen" ? role === "kitchen"
          : panel === "tablet" ? role === "tablet" || role === "waiter"
          : panel === "owner" ? role === "owner"
          : role === "manager" || role === "owner";          // the manager panel: a manager, or the owner in manager mode
        if (!fits) return { error: `${u.name || u.username} is a ${role || "person"}, so their screen is not the ${panel} panel.` };
        personId = u.id; personName = String(u.name || u.username || "").slice(0, 80) || null;
      }
        next[kind] = {
        via: "screen", agent: null, printer: null,
        panel, person: personId, personName,
        device: o.device ? String(o.device).slice(0, 120) : null,
        ...(asPaper(o.paper) ? { paper: asPaper(o.paper) } : {}),
      };
      continue;
    }

    const paper = asPaper(o.paper);
    next[kind] = {
      via: main.agent ? "computer" : undefined,
      ...main,
      ...(paper ? { paper } : {}),
    };
  }

  // Read-modify-write of ONE jsonb column. The bag holds other modules' ladders, so the entry is
  // merged, never replaced — overwriting `modules` wholesale would silently switch other features
  // off, which is exactly the kind of quiet damage mig 326's bag was designed to avoid.
  //
  // ── AND THE READ THAT FILLS THE BAG IS CHECKED (T26 sweep #9, owner picked it 2026-09-16) ─────
  // The paragraph above names the damage exactly, and the line under it took `.data` and ignored
  // `.error` — so the one failure that CAUSES that damage was the one nobody answered. A transient
  // read failure made `s` null, `bag` an EMPTY object, and the update below then replaced the whole
  // column with `{ printing: { routes } }`: every other module's allowed/owner_control/enabled
  // flags gone, from a press of Save on the printing board. The twin of this line in
  // app/api/admin/printing was fixed on 2026-09-15; this is the other copy, and it is the one the
  // owner actually presses most.
  //
  // Refusing costs one press. The alternative costs a restaurant's feature switches, silently.
  const sQ = await sb.from("settings").select("modules").eq("restaurant_id", rid).maybeSingle();
  if (sQ.error) return { error: "Could not read this restaurant's settings, so nothing was saved. Please try again." };
  const s = sQ.data as { modules?: unknown } | null;
  const bag = { ...bagOf(s?.modules) };
  bag["printing"] = { ...(bag["printing"] || {}), routes: next };
  const up = await sb.from("settings").update({ modules: bag }).eq("restaurant_id", rid).select("restaurant_id").maybeSingle();
  if (up.error) return { error: "Could not save the printing routes." };
  // A SAVE THAT MATCHED NO ROW IS NOT A SAVE — the same rule its three siblings on the admin
  // printing route were given on 2026-09-15. Without this a restaurant with no settings row was
  // told its address book had been saved, and the board read the old one back on the next refresh.
  if (!up.data) return { error: "This restaurant has no settings yet, so there was nowhere to save the printing routes." };
  return { routes: next };
}

// ── THE POLL ─────────────────────────────────────────────────────────────────────────────────
export type ClaimedJob = {
  id: string; kind: PrintKind; printer: string; orderId: string | null;
  reprint: boolean; attempts: number; payload: Record<string, unknown>;
};

const liveFilter = () =>
  `status.eq.queued,and(status.eq.printing,claimed_at.lt.${new Date(Date.now() - STALE_CLAIM_MS).toISOString()})`;

/**
 * "Anything for me?" — the one question a helper asks, answered without a scan.
 *
 * A job is this helper's when the route for its KIND names this machine, or when a previous claim
 * already addressed it here. A job routed ELSEWHERE is never claimable here — the backup printer was
 * deleted on 2026-08-30 (owner: "we don't even need the backup printer"), because paper appearing in
 * a room nobody is standing in is worse than paper not appearing: the restaurant never learns its
 * printer is broken. A ticket that gives up after five tries files a printer problem instead, which
 * is what puts it in front of somebody.
 *
 * The claim itself is the same single filtered UPDATE the kitchen and manager screens use, which is
 * what makes "two helpers", "a copied helper file", "two tabs" and "two printers with the same
 * name" all end in ONE piece of paper: everyone after the winner matches zero rows.
 */
/**
 * ── ONE LANE PER PRINTER (owner, 2026-09-14) ─────────────────────────────────────────────────
 *
 * *"Whenever there are more prints in the queue, it is working slowly. If possible make a queue of
 * — if there are three different printers connected to the PC and set up for different prints — so
 * all that we have different queue. For example, you can send kitchen and print bill simultaneously
 * in parallel."*
 *
 * He is describing the real shape of the fault. The helper printed STRICTLY one job at a time,
 * whatever printer it was for, and each one costs a Chrome render (~2-3s) plus up to 15 seconds
 * waiting for CUPS to say the paper actually came out. So a bill for a customer standing at the
 * counter queued behind every kitchen slip in front of it — on a DIFFERENT printer that was sitting
 * idle the whole time.
 *
 * `claimSome` hands back **at most one job per distinct printer**, which is exactly what makes the
 * lanes independent: the helper starts one worker per job, and by construction no two workers ever
 * touch the same printer. A round is then as slow as its slowest printer instead of the sum of all
 * of them.
 *
 * NOTHING ABOUT THE SAFETY CHANGES. Each job is still won by the same single filtered UPDATE, so
 * two claimers racing still means the second one matches nothing — the guarantee that a ticket comes
 * out exactly once is the claim, and the claim is untouched.
 */
export async function claimSome(
  rid: string,
  agent: AgentRow,
  opts?: { max?: number; routes?: PrintRoutes },
): Promise<ClaimedJob[]> {
  const R = opts?.routes || await readRoutes(rid);
  // Four is a ceiling, not a target: a restaurant has three papers, and a helper that forked one
  // headless Chrome per waiting ticket would fall over on a backlog. It is also the cap on how many
  // rows a single poll can claim, so a burst can never strand a dozen tickets in "printing".
  const max = Math.max(1, Math.min(4, opts?.max ?? 1));
  // ── AND AT MOST TWO FROM ANY ONE PRINTER (owner, 2026-09-14) ────────────────────────────────
  // *"Instead of sending one by one you can send all in a queue… let the printer handle the queue,
  // the printer's queue will be faster than the helper's."*
  //
  // He is right, and this is the half of it that lives here. The helper no longer waits for paper
  // (see the note on the round in lib/printHelperScript), so a round can carry several tickets for
  // one printer and CUPS keeps them in order — the helper submits them in the order they were handed
  // out, which is the order the app made them.
  //
  // TWO, not four, and the reason is starvation: eight kitchen slips would otherwise fill every slot
  // in the round and a bill for the customer standing at the counter would wait for a whole round it
  // has no part in. Capping each printer's share leaves room for the other papers ALWAYS — which is
  // the thing he actually asked for ("if there is a queue in KOT, the bill is still printing
  // instantly"). Measured: with this, a bill behind eight slips comes out in the first round.
  const perPrinter = 2;
  const mine = PRINT_KINDS.filter((k) => R[k].agent === agent.id);
  // NO EARLY RETURN when nothing is routed here. There was one, and it was the other half of the same
  // fault: a machine with no routes at all could never be handed a job addressed to it by name — which
  // is exactly what the admin's test page is, and what a restaurant does FIRST, before any route
  // exists. The read below is two indexed queries; asking them is cheap enough to always ask.

  // The candidate read, in TWO parts — and the second part is not optional.
  //
  //   a) jobs of the kinds this machine is the route for, and
  //   b) jobs ALREADY ADDRESSED to this machine, whatever their kind.
  //
  // (b) was missing, and my own security test found it: the admin's "Send a test page" queues a
  // kind='test' job with the computer and printer written on it directly — and it sat in the basket
  // for ever, because the candidate read only ever looked at kinds the ROUTES named. A page addressed
  // to a machine by name must reach that machine even when nothing routes its kind. A reclaimed job
  // (its first claim went stale) is the same shape and had the same hole.
  //
  // Two parameterised reads rather than one built `.or(...)` string: the same rule the printer_events
  // fix landed under — server-side values still do not belong in a filter I paste together by hand.
  const cols = "id, kind, order_id, reprint, attempts, created_at, agent_id, printer, payload";
  type JobRow = {
    id: string; kind: string; order_id: string | null; reprint: boolean; attempts: number;
    created_at: string; agent_id: string | null; printer: string | null; payload?: unknown;
  };
  const kinds = [...mine];   // only what is addressed to THIS machine — there is no backup machine
  const [byKind, byName] = await Promise.all([
    kinds.length
      ? sb.from("print_jobs").select(cols).eq("restaurant_id", rid).in("kind", kinds).or(liveFilter())
          .order("created_at", { ascending: true }).limit(12)
      : Promise.resolve({ data: [] as JobRow[] }),
    sb.from("print_jobs").select(cols).eq("restaurant_id", rid).eq("agent_id", agent.id).or(liveFilter())
      .order("created_at", { ascending: true }).limit(12),
  ]);
  const seen = new Set<string>();
  const rows = [...((byName.data || []) as JobRow[]), ...((byKind.data || []) as JobRow[])]
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

  const out: ClaimedJob[] = [];
  // How many this round already carries for each printer — see `perPrinter` above.
  const lanes = new Map<string, number>();
  // ── A SLIP LEFT OVER FROM BEFORE THE SWITCH WAS TURNED OFF ─────────────────────────────────
  // The kitchen-slip switch suppresses kitchen slips and nothing else (see printingRunning, and the
  // fault it records: treating it as a master switch stopped a restaurant's BILLS). mig 335's
  // trigger already refuses to queue a slip while it is off, so this only catches one left in the
  // basket from before — which must not come out an hour later when nobody expects it.
  const slipsOn = (await printingRunning(rid)).kot;
  for (const row of rows || []) {
    if (out.length >= max) break;
    if (!isPrintKind(row.kind)) continue;
    if (row.kind === "kot" && !slipsOn) continue;
    const route = R[row.kind];
    let printer: string | null = null;
    // ONLY THE MACHINE THIS PAPER IS ADDRESSED TO. There used to be a second branch here that let
    // ANOTHER computer take the ticket once it had sat for a minute. That is the backup printer, and
    // it is gone: a ticket quietly coming out in a different room is worse than one that has not
    // come out, because nobody is standing there and nobody learns the printer is broken.
    if (route.agent === agent.id) printer = route.printer;
    // A job already addressed HERE by an earlier claim keeps its printer even if the address book
    // changed underneath it — the paper it was meant for is already half out of the door.
    if (!printer && row.agent_id === agent.id && row.printer) printer = row.printer;
    if (!printer) continue;
    if ((lanes.get(printer) || 0) >= perPrinter) continue;  // leave room for the other papers

    const won = (await sb.from("print_jobs")
      .update({ status: "printing", claimed_at: new Date().toISOString(), agent_id: agent.id, printer, printed_by: agent.name })
      .eq("id", row.id).eq("restaurant_id", rid).or(liveFilter())
      .select("id").maybeSingle()).data as { id: string } | null;
    if (!won) continue;                                   // someone else got there first — next row

    lanes.set(printer, (lanes.get(printer) || 0) + 1);
    out.push({
      id: row.id, kind: row.kind, printer, orderId: row.order_id ?? null,
      reprint: row.reprint !== false, attempts: row.attempts || 0,
      payload: (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown>,
    });
  }
  return out;
}

/**
 * The single-job door, unchanged for every helper that has ever existed.
 *
 * IT STAYS BECAUSE HIS WINDOWS PC IS STILL RUNNING AN OLDER COPY. A helper is a text file somebody
 * pasted into Notepad; there is no way to push a new one, so the server must go on answering the old
 * shape for as long as an old file is out there. `claimSome` is the same code path with max:1.
 */
export async function claimNext(rid: string, agent: AgentRow, routes?: PrintRoutes): Promise<ClaimedJob | null> {
  const [one] = await claimSome(rid, agent, { max: 1, routes });
  return one || null;
}

/**
 * Put something in the basket that did NOT come from the order trigger — a bill, a banquet sheet,
 * the admin's test page.
 *
 * It carries IDS, not a rendered document: the paper is built from public/panels/billdoc.js when
 * the helper asks for it, so a job can never hold a stale copy of a bill and there is never a
 * second layout to drift. Returns null when nothing would print it, so the caller can fall back to
 * the browser window instead of leaving a person waiting at a silent printer.
 */
export async function queueJob(
  rid: string,
  kind: PrintKind,
  payload: Record<string, unknown>,
  opts?: { requestedBy?: string; printer?: string; agentId?: string; routes?: PrintRoutes },
): Promise<{ id: string } | { error: string }> {
  const R = opts?.routes || await readRoutes(rid);
  const route = R[kind];
  // SWITCHED OFF IS NOT THE SAME AS UNSET. A test page addressed straight at a printer (opts.agentId)
  // still goes — that button is how a person checks the printer they just switched back on.
  if (route.via === "off" && !opts?.agentId) return { error: "switched-off" };
  const agentId = opts?.agentId || route.agent;
  const printer = opts?.printer || route.printer;
  if (!agentId || !printer) return { error: "no-route" };
  const ins = await sb.from("print_jobs").insert({
    restaurant_id: rid, kind, status: "queued", reprint: false,
    agent_id: agentId, printer, payload,
    requested_by: String(opts?.requestedBy || "").slice(0, 80) || null,
  }).select("id").maybeSingle();
  if (ins.error || !ins.data) return { error: "Could not queue that for printing." };
  return { id: (ins.data as { id: string }).id };
}

/**
 * The kitchen-slip line and `settings.auto_print_kot` are the SAME decision, so they are the same
 * control (owner, 2026-08-27: "board should be sync… right now it's not", and separately "I want a
 * proper option to on and off it").
 *
 * Kitchen slips are the one kind a database trigger queues by itself (mig 335), and that trigger
 * reads `auto_print_kot`. If the address book alone said "do not print" the trigger would go on
 * filling the basket with tickets nobody could ever claim — a queue that grows for ever behind a
 * switch that says off. So setting the kitchen-slip line to "do not print" switches auto-print off
 * at the source, and setting it to anything else switches it back on.
 *
 * It is NOT allowed to switch on what Aevidine has not allowed: `auto_print_kot_allowed` is the
 * admin's entitlement and is never written here.
 */
export async function syncKotSwitch(rid: string, on: boolean): Promise<void> {
  const st = (await sb.from("settings").select("auto_print_kot, auto_print_kot_allowed")
    .eq("restaurant_id", rid).maybeSingle()).data as
    { auto_print_kot?: boolean; auto_print_kot_allowed?: boolean } | null;
  if (!st) return;
  if (on && st.auto_print_kot_allowed !== true) return;   // not ours to grant
  if (st.auto_print_kot === on) return;                   // already right — no write, no audit noise
  // THE TWELFTH-AND-A-HALF WRITE (2026-09-04). helloAgent's stamp was fixed the same day; this one
  // was missed in the same pass and matters more. It is the write that keeps the kitchen-slip LINE
  // and the auto_print_kot COLUMN in step — one decision, two places. If it fails silently the
  // Printing board says slips print while mig 335's trigger queues nothing, or the reverse, and both
  // boards' own comments warn about exactly that drift. Not a throw, same as every write here.
  await wrote("syncKotSwitch auto_print_kot", sb.from("settings").update({ auto_print_kot: on }).eq("restaurant_id", rid));
}

/** How many notes are still waiting — the "Waiting to print: 0" line, and the honest answer to
 *  "did my bill go anywhere?". Counted, not listed: nothing needs the rows. */
/**
 * How many tickets are waiting — or NULL when we could not find out (T26 sweep #9, owner picked it
 * 2026-09-16).
 *
 * This returned `r.count || 0`, so a failed count was indistinguishable from an empty queue. The
 * caller that matters is "Clear what is waiting": it asks this first and returns early on zero, so
 * a blip answered `{ ok: true, cleared: 0 }` — the button reporting success for doing nothing, in
 * front of somebody staring at a printer three days behind. Nothing was lost and no data moved;
 * they simply had to guess whether to press it again.
 *
 * `null` is the honest third answer, and every caller now decides what to do with it rather than
 * inheriting a zero nobody chose.
 */
export async function waitingCount(rid: string): Promise<number | null> {
  const r = await sb.from("print_jobs").select("id", { count: "exact", head: true })
    .eq("restaurant_id", rid).in("status", ["queued", "printing"]);
  if (r.error) {
    console.error("[printHelpers] could not count what is waiting to print:", r.error.message);
    return null;
  }
  return r.count ?? 0;
}

/**
 * ── THE QUEUE, BROKEN DOWN BY PRINTER (owner, 2026-09-14) ────────────────────────────────────
 *
 * *"The UI of the queue will also kind of change, according to the number of papers that have been
 * set up for different printers."*
 *
 * "Waiting: 7" was the honest answer while one machine printed everything. It stopped being one the
 * day the papers went to different printers: seven waiting is a crisis if they are all stacked
 * behind ONE dead bill printer, and completely normal if they are two here, two there and three on
 * a machine that is simply asleep. The count on its own cannot tell those apart, and it is the
 * sentence somebody decides whether to walk to the printer on.
 *
 * A QUEUED KITCHEN SLIP HAS NO PRINTER ON IT, and that is deliberate — the address book is applied
 * at claim time so a ticket follows the line if it is re-pointed (lib/printHelpers → claimSome). So
 * the printer is resolved the same way the claim will resolve it: through the routes. A ticket that
 * resolves to nothing is counted under "not addressed yet", which is its own honest answer.
 */
export type PrinterQueue = { printer: string; n: number; oldestMs: number | null };
export async function waitingByPrinter(rid: string, routes?: PrintRoutes): Promise<PrinterQueue[]> {
  const R = routes || await readRoutes(rid);
  const rows = (await sb.from("print_jobs").select("kind, printer, created_at")
    .eq("restaurant_id", rid).in("status", ["queued", "printing"])
    .order("created_at", { ascending: true }).limit(500)).data as
    { kind: string; printer: string | null; created_at: string }[] | null;
  const now = Date.now();
  const by = new Map<string, PrinterQueue>();
  for (const r of rows || []) {
    const named = r.printer
      || (isPrintKind(r.kind) ? R[r.kind]?.printer : null)
      || "not addressed yet";
    const age = now - new Date(r.created_at).getTime();
    const cur = by.get(named) || { printer: named, n: 0, oldestMs: null };
    cur.n += 1;
    if (cur.oldestMs == null || age > cur.oldestMs) cur.oldestMs = age;
    by.set(named, cur);
  }
  // Worst first — the printer somebody needs to walk to is the one at the top.
  return [...by.values()].sort((a, b) => (b.oldestMs || 0) - (a.oldestMs || 0));
}

// ── DOES A HELPER OWN THIS PAPER? ────────────────────────────────────────────────────────────
export type HelperOwner = {
  owned: boolean;                 // a helper is named for this kind of paper
  agent?: string;                 // and this is what that computer is called
  printer?: string;
  connected?: boolean;
  secondsAgo?: number | null;
  // NO `backup` (T11 sweep #8, 2026-09-04). It was declared here and SET BY NOTHING — neither
  // helperFor() nor helpersFor() ever wrote it — for four days after the backup printer itself was
  // deleted (owner, 2026-08-30: "if there is a backup printer, remove it"). A field nobody assigns
  // is not harmless: the kitchen screen read it and drew a sentence off it ("If it prints nothing
  // for a minute, X takes over"), so a dead branch about a removed feature sat in the one sheet a
  // cook reads when the paper stops. Do not re-add it — there is no second machine.
};

/**
 * Whether a computer, rather than a screen, is responsible for this kind of paper.
 *
 * IT DOES NOT DEPEND ON THE HELPER BEING AWAKE, and that is deliberate. A kitchen slip routed to the
 * kitchen printer belongs there: if the machine is asleep the ticket WAITS, because coming out of
 * whatever printer the manager's laptop happens to default to is not "better than nothing" — it is a
 * ticket the kitchen never sees, printed somewhere nobody is looking. A restaurant that wants
 * "anywhere rather than nowhere" says so by naming a BACKUP printer, which is exactly what that line
 * is for.
 *
 * So a screen stops printing the moment a route names a helper, and starts again the moment the
 * route is cleared. One rule, readable on the screen either way.
 */
export async function helperFor(rid: string, kind: PrintKind): Promise<HelperOwner> {
  const [routes, agents] = await Promise.all([readRoutes(rid), agentsView(rid)]);
  const r = routes[kind];
  if (!r?.agent || !r.printer) return { owned: false };
  const a = agents.find((x) => x.id === r.agent);
  if (!a) return { owned: false };                       // removed machine — the screen may print again
  return {
    owned: true, agent: a.name, printer: r.printer, connected: a.connected, secondsAgo: a.secondsAgo,
  };
}

/** Every kind's owner in ONE pair of reads, for the panels: asking helperFor() three times on a poll
 *  is three times the same two queries. Same answers, a third of the cost. */
export async function helpersFor(rid: string, kinds: PrintKind[]): Promise<Record<string, HelperOwner>> {
  const [routes, agents] = await Promise.all([readRoutes(rid), agentsView(rid)]);
  const out: Record<string, HelperOwner> = {};
  for (const kind of kinds) {
    const r = routes[kind];
    const a = r?.agent ? agents.find((x) => x.id === r.agent) : undefined;
    if (!r?.agent || !r.printer || !a) { out[kind] = { owned: false }; continue; }
    out[kind] = {
      owned: true, agent: a.name, printer: r.printer, connected: a.connected, secondsAgo: a.secondsAgo,
    };
  }
  return out;
}

// ── WHO PRINTS THIS KIND OF PAPER — the single answer every screen and every route obeys ───────
export type PrintTarget =
  | { kind: "none" }
  /** Somebody switched this piece of paper off on purpose. Different from "none" on every screen. */
  | { kind: "off" }
  | { kind: "computer"; agent: string; printer: string; connected: boolean; secondsAgo: number | null;
    }
  // (No second screen, and no wait before one takes over: the backup was deleted on 2026-08-30. A
  //  doc comment describing that field survived here with no field under it until 2026-09-04.)
  | { kind: "screen"; panel: RoutePanel; person: string | null; personName: string | null; device: string | null };

export async function targetFor(rid: string, kind: PrintKind): Promise<PrintTarget> {
  const [routes, agents] = await Promise.all([readRoutes(rid), agentsView(rid)]);
  return resolveTarget(routes[kind], agents, kind);
}

/** Same answer for several kinds in ONE pair of reads (the panels need three at a time). */
export async function targetsFor(rid: string, kinds: PrintKind[]): Promise<Record<string, PrintTarget>> {
  const [routes, agents] = await Promise.all([readRoutes(rid), agentsView(rid)]);
  return kinds.reduce<Record<string, PrintTarget>>((a, k) => { a[k] = resolveTarget(routes[k], agents, k as PrintKind); return a; }, {});
}

function resolveTarget(r: PrintRoute | undefined, agents: AgentView[], kind?: PrintKind): PrintTarget {
  if (r?.via === "off") return { kind: "off" };
  if (isScreenRoute(r)) {
    return { kind: "screen", panel: r!.panel as RoutePanel, person: r!.person ?? null,
             personName: r!.personName ?? null, device: r!.device ?? null,
           };
  }
  // ── NOBODY HAS ANSWERED THIS LINE ──────────────────────────────────────────────────────────
  // "kitchen panel will always be on" (owner, 2026-08-31). For KITCHEN SLIPS specifically, an
  // unanswered line is not "nobody in particular" any more — it is the KITCHEN SCREEN, with no
  // setup, no toggle and nobody named. A restaurant that plugs a printer into the kitchen PC and
  // opens the panel gets its tickets, which is what he expects to happen by default.
  //
  // `person: null` matters: it means ANYONE on the kitchen panel, not one named cook. Naming a
  // person is still possible and still wins — this is only what happens when nothing was chosen.
  //
  // The other papers keep the old answer ("none" → whoever presses Print), because a bill printing
  // itself on a screen nobody is watching is not a default anyone asked for.
  if (!r?.agent || !r.printer) return kind === "kot" ? { kind: "screen", panel: "kitchen", person: null, personName: null, device: null } : { kind: "none" };
  const a = agents.find((x) => x.id === r.agent);
  // THE MACHINE WAS REMOVED. Same rule as never having been answered: the kitchen screen picks the
  // slips back up, rather than the restaurant going quiet because a PC was thrown away.
  if (!a) return kind === "kot" ? { kind: "screen", panel: "kitchen", person: null, personName: null, device: null } : { kind: "none" };
  return { kind: "computer", agent: a.name, printer: r.printer, connected: a.connected, secondsAgo: a.secondsAgo, };
}

/**
 * May THIS screen print that paper?
 *
 * Asked on the server, with the person and device taken from the request — never from the panel's
 * word for itself. Three ways to answer yes, and they are deliberately in this order:
 *   · the line is switched OFF → no, and the screen says so in those words
 *   · nothing is routed        → yes, whoever is entitled may print (the behaviour before any of this)
 *   · a COMPUTER is routed     → no. A screen must never race a helper: two printers, one ticket.
 *   · a SCREEN is routed       → only the named panel, and only the named person, and only the named
 *                                device. Any part left blank means "anyone on that side".
 *
 * THERE IS NO FIFTH ANSWER (T11 sweep #8, 2026-09-04). A fifth bullet used to promise one — "a
 * BACKUP screen is named → yes, but only for tickets older than `afterMs`; the caller gets
 * `backup: true`" — and the return type carried `backup` and `afterMs` to match. Neither was ever
 * SET by any path in this function, because the backup screen was deleted on 2026-08-30 (owner:
 * "we don't even need the backup printer"). So the promise outlived the feature, and a caller in the
 * manager panel's route was still reading it: `backup: !!may.backup`, which could only ever be
 * false. Both fields are gone rather than left declared-and-never-written — a field that silently
 * does nothing is how the next person wires it back up.
 */
export function screenMayPrint(
  t: PrintTarget,
  who: { panel: RoutePanel; personId?: string | null; deviceId?: string | null },
): { ok: boolean; why?: "off" | "computer" | "other_panel" | "other_person" | "other_device" } {
  if (t.kind === "none") return { ok: true };
  if (t.kind === "off") return { ok: false, why: "off" };
  if (t.kind === "computer") return { ok: false, why: "computer" };
  if (t.panel !== who.panel) return { ok: false, why: "other_panel" };
  if (t.person && t.person !== (who.personId || "")) return { ok: false, why: "other_person" };
  if (t.device && t.device !== (who.deviceId || "")) return { ok: false, why: "other_device" };
  return { ok: true };
}

// ── "IS IT WORKING RIGHT NOW" — one answer, three papers, two panels ─────────────────────────
//
// Owner, 2026-09-14: *"on the manager panel and on the owner panel, when the helper is on, in the
// settings of both panels you could able to see there is a printing thing and you could able to see
// that everything is connected and everything is live. And if not connected, you could able to
// see."*
//
// WHY IT IS HERE AND NOT ON EITHER SCREEN. Both boards already drew their own version of this
// sentence out of `routes` + `agents`, and the two boards have drifted apart twice before (the
// comment on the manager panel's formPrinting says so in as many words). Three papers × two panels
// × "green or red" is six chances to disagree about whether a restaurant is printing. So the
// sentence is written ONCE, here, beside `resolveTarget` — which is the function that actually
// decides — and both panels render what they are handed.
//
// It answers for a SCREEN route and for OFF as well, not only for a computer. A board that lights up
// green only when a helper exists would tell the commonest restaurant of all — the one whose kitchen
// screen prints its slips and whose bills open a window — that nothing is working.
export type PaperStatus = {
  kind: RoutableKind;
  /** "Kitchen slips" · "Bills" · "Banquet sheets" — KIND_LABEL, so one wording everywhere. */
  label: string;
  /** Green or red on the screen. TRUE means "this paper has somewhere to go and that somewhere is
   *  answering"; a computer that has gone quiet is the one red that matters, because the tickets are
   *  piling up behind it while everything else looks fine. A deliberate "Nobody" is not red — it is
   *  a decision somebody made, and colouring a decision as a fault is crying wolf. */
  ok: boolean;
  via: "computer" | "screen" | "off" | "none";
  agent: string | null;
  printer: string | null;
  connected: boolean;
  secondsAgo: number | null;
  /** The whole sentence, in the words a restaurant uses. */
  words: string;
  /** The ONE-WORD state, beside the coloured dot. It is here and not on each screen for the same
   *  reason `words` is: three screens inventing their own word is three screens that can disagree.
   *  And the word matters as much as the colour — about one man in twelve cannot tell this red from
   *  this green (WCAG 1.4.1), and a dot on its own is not read by a screen reader at all.
   *
   *  "—" was the first version for a paper with nothing routed, and it was wrong on the screen: a
   *  dash beside a green dot reads as "we don't know", when the truth is the ordinary, correct
   *  behaviour for most restaurants — somebody presses Print and a window opens. It says WINDOW. */
  /** ── AND "STOPPED", ADDED 2026-09-14 ─────────────────────────────────────────────────────
   *  Nothing at all reaches a helper while printing is switched off or the queue is stopped: the
   *  poll answers 204 for EVERY kind, bills and banquet sheets included, whatever the column is
   *  called. Until this existed the rows read LIVE in that state — three green lines and three
   *  working-looking Test buttons on a restaurant where no paper can come out, and a Test that
   *  answered "paper should appear in a moment" and then never did.
   *  That is the exact opposite of what these rows were asked for ("you could able to see that
   *  everything is connected and everything is live"), so it gets its own word. */
  state: "LIVE" | "ASLEEP" | "OFF" | "SCREEN" | "WINDOW" | "STOPPED";
  /** May a REAL sample of this document be printed from the panel? Only when a computer owns it: a
   *  screen route has no printer this server can name, and printing a sample into whatever the
   *  browser defaults to proves nothing about the paper the restaurant actually uses. */
  canTest: boolean;
};

/**
 * WHICH PAPERS THIS RESTAURANT ACTUALLY HAS (owner, 2026-09-14).
 *
 * *"If we have not provided the feature of banquet, it should not even show the banquet also in the
 * printing section."*
 *
 * The three papers were a constant, so a restaurant with the banquet module switched OFF was still
 * offered a "Banquet sheets" line with a printer dropdown — a control for a feature it does not
 * have. Measured on Pizza Palace, which has `banquet_allowed: false` and was showing the row.
 *
 * It is his standing rule (R36) applied to paper: what is withheld is not mentioned at all — not
 * greyed, not explained, absent. He confirmed it again when offered the greyed alternative.
 *
 * ONLY BANQUET IS GATED, and that is not an oversight: kitchen slips and bills are core — there is
 * no entitlement anywhere that switches them off (the module list is banquet · inventory · khata ·
 * payroll · table_ops · table_tags · take_orders). A restaurant that prints nothing at all is
 * already handled one level up, by `auto_print_kot_allowed`, which hides the whole section.
 */
export async function papersForRestaurant(rid: string): Promise<RoutableKind[]> {
  const ladders = await allModuleLadders(rid);
  return ROUTABLE_KINDS.filter((k) => k !== "banquet" || ladders.banquet?.effective === true);
}

/**
 * IS ANY PAPER GOING TO COME OUT AT ALL — the question above every per-paper question.
 *
 * It lived in app/api/print-agent as a private helper, where only the helper's own door could read
 * it, and that is exactly how the boards came to say LIVE about a restaurant whose printing was
 * switched off. One copy, here, read by the door AND by the status rows (a new way replaces the old
 * one — the route's private copy was deleted in the same commit).
 *
 * The two reasons are kept apart because the fix differs: SWITCHED OFF means the tickets are never
 * even made, STOPPED means they are made and waiting and will all come out at once when it restarts.
 */
export type PrintingRunning = {
  /** Is ANY paper going to come out — the master answer. Only a stopped queue turns this off. */
  on: boolean;
  why: null | "off" | "paused";
  /** ── AND WHETHER KITCHEN SLIPS IN PARTICULAR ARE ON ─────────────────────────────────────────
   *  `auto_print_kot` is NOT a master switch, however much the door used to treat it as one: it is
   *  the kitchen-slip LINE, stored twice (syncKotSwitch keeps the line and the column in step — its
   *  own comment says "one decision, two places"). Answering "Nobody" for the slips writes `false`
   *  here, and nothing else about the restaurant changes. */
  kot: boolean;
};

/**
 * ── "NOBODY PRINTS THE SLIPS" MUST NOT STOP THE BILLS (2026-09-16) ───────────────────────────
 *
 * The door used to answer 204 for EVERY kind unless `auto_print_kot` was true. So a restaurant set
 * up exactly the way the owner described — *"slips on the kitchen screen, bills on a computer"* —
 * was handed nothing at all, and its bills never printed. The bill route sat there naming a live
 * computer and a real printer; the helper was simply never given the job.
 *
 * Measured on 2026-09-16 before the fix: slips → Nobody, bills → a computer, a bill sample queued,
 * and `/next` answered **204**. It was silent before the STOPPED rows existed — the board said LIVE
 * and the Test button promised paper.
 *
 * Only a STOPPED QUEUE is a master stop now. The kitchen-slip switch suppresses kitchen slips and
 * nothing else — which is safe twice over: mig 335's trigger already refuses to queue a slip while
 * that column is false, and `claimSome` already only hands over a kind whose route names the asking
 * machine, so a slip set to "Nobody" is not routed anywhere to begin with. `kot` is carried so the
 * claim can skip any slip left in the basket from before the switch was turned off.
 */
export async function printingRunning(rid: string): Promise<PrintingRunning> {
  const q = await sb.from("settings").select("auto_print_kot, auto_print_kot_allowed, modules").eq("restaurant_id", rid).maybeSingle();
  if (q.error) {
    // A read that failed is not "printing is off" — that would stop a whole restaurant's paper over
    // a blip. Reported, and treated as running, because the claim below can only ever hand over a
    // job whose route names the asking machine anyway.
    console.error("[printHelpers] whether printing is running could not be read:", q.error.message);
    return { on: true, why: null, kot: true };
  }
  const s = q.data as { auto_print_kot?: boolean; auto_print_kot_allowed?: boolean; modules?: Record<string, { paused?: boolean }> } | null;
  const kot = s?.auto_print_kot === true && s?.auto_print_kot_allowed === true;
  if (s?.modules?.printing?.paused === true) return { on: false, why: "paused", kot };
  return { on: true, why: null, kot };
}

export async function paperStatus(rid: string): Promise<PaperStatus[]> {
  // ONE pair of reads for the papers — the same reason targetsFor() exists. Asking per kind would be
  // six reads on a screen that repaints every fifteen seconds.
  const [routes, agents, kinds, running] = await Promise.all([readRoutes(rid), agentsView(rid), papersForRestaurant(rid), printingRunning(rid)]);
  // ── NOTHING IS LIVE WHILE NOTHING IS RUNNING (2026-09-14) ──────────────────────────────────
  // Said once, above the per-paper answers, because it is true of every paper at once: the poll
  // answers 204 for all three kinds while this is off. `canTest` goes with it — a Test button that
  // queues a page nothing will ever fetch is worse than no button, because it reports success.
  // ── ONLY WHERE IT CHANGES THE ANSWER, AND NEVER RED ────────────────────────────────────────
  // Two corrections to the first cut of this, both from guards that were already right:
  //
  //  1. NEVER RED. `ok: false` broke a standing rule this file's own type states: *"A deliberate
  //     'Nobody' is not red — it is a decision somebody made, and colouring a decision as a fault is
  //     crying wolf."* Switching printing off is a decision, and so is stopping the queue. Red stays
  //     reserved for the one involuntary failure: a computer that owns paper and is not answering.
  //
  //  2. ONLY WHERE IT CHANGES THE ANSWER. If no paper is routed at a computer at all, the per-paper
  //     answers below are already true AND more specific — "Nobody prints the slips", "a window
  //     opens when somebody presses Print". Replacing those with "printing is switched off for this
  //     restaurant" told a menu-only restaurant its whole printing was off when it had simply never
  //     set a printer up. STOPPED is worth saying exactly when a computer IS set up and would
  //     otherwise read LIVE — which is the fault this whole block was added for.
  const anyComputer = kinds.some((k) => resolveTarget(routes[k], agents, k).kind === "computer");
  // A STOPPED QUEUE is the only thing that holds every paper back at once.
  if (!running.on && anyComputer) {
    return kinds.map((kind) => {
      const t = resolveTarget(routes[kind], agents, kind);
      const mine = t.kind === "computer";
      return {
        kind, label: KIND_LABEL[kind] || kind, ok: true, via: "off" as const,
        agent: mine ? t.agent : null, printer: mine ? t.printer : null,
        connected: false, secondsAgo: null,
        state: "STOPPED" as const, canTest: false,
        words: running.why === "paused"
          ? `The printing queue is stopped${mine ? ` — ${t.printer} is set up and waiting` : ""}. Tickets are still being made and are waiting; they all come out the moment it is restarted.`
          : `Printing is switched off for this restaurant, so no ticket is being made at all${mine ? ` — ${t.printer} would print this otherwise` : ""}. Nothing comes out until it is switched back on.`,
      };
    });
  }
  return kinds.map((kind) => {
    const t = resolveTarget(routes[kind], agents, kind);
    const base = { kind, label: KIND_LABEL[kind] || kind };
    // ── AND THE SLIP ROW ALONE, WHEN THE SLIP SWITCH IS OFF ──────────────────────────────────
    // Reachable without contradiction: `syncKotSwitch` refuses to switch slips ON while Aevidine
    // has not granted auto-printing ("not ours to grant"), so the slips can be pointed at a real
    // computer while the column stays false. That row used to read LIVE with a working Test button,
    // about paper that cannot come out — the same fault as the stopped queue, one row wide.
    if (kind === "kot" && !running.kot && t.kind === "computer") {
      return {
        ...base, via: "off" as const, ok: true, state: "STOPPED" as const,
        agent: t.agent, printer: t.printer, connected: false, secondsAgo: null, canTest: false,
        words: `${t.printer} is set up for the kitchen slips, but automatic slip printing is switched off, so no slip is being made. Bills and banquet sheets are unaffected.`,
      };
    }
    if (t.kind === "computer") {
      const mins = t.secondsAgo == null ? null : Math.round(t.secondsAgo / 60);
      return {
        ...base, via: "computer" as const, ok: t.connected,
        state: (t.connected ? "LIVE" : "ASLEEP") as PaperStatus["state"],
        agent: t.agent, printer: t.printer, connected: t.connected, secondsAgo: t.secondsAgo,
        canTest: true,
        words: t.connected
          ? `${t.printer} — on ${t.agent}, answering now`
          : `${t.printer} — ${t.agent} is not answering${mins == null ? "" : ` (last heard from ${mins < 60 ? mins + " min" : Math.round(mins / 60) + "h"} ago)`}. Anything for this printer is waiting, and prints the moment it is back.`,
      };
    }
    if (t.kind === "off") {
      return {
        ...base, via: "off" as const, ok: true, state: "OFF" as const, agent: null, printer: null,
        connected: false, secondsAgo: null, canTest: false,
        words: KIND_OFF_LABEL[kind] || "Switched off on purpose.",
      };
    }
    if (t.kind === "screen") {
      const where = t.panel === "kitchen" ? "the kitchen screen"
        : t.panel === "manager" ? "the manager screen"
        : t.panel === "owner" ? "the owner screen" : "the waiter tablet";
      return {
        ...base, via: "screen" as const, ok: true, state: "SCREEN" as const, agent: null, printer: null,
        connected: false, secondsAgo: null, canTest: false,
        words: t.personName ? `${where} — ${t.personName}'s, and nobody else's` : `${where}, on whatever printer it is set to`,
      };
    }
    // NOTHING IS ROUTED. For bills and banquet sheets that is the ordinary, correct answer for most
    // restaurants — a window opens when somebody presses Print — so it is not a fault and not red.
    return {
      ...base, via: "none" as const, ok: true, state: "WINDOW" as const, agent: null, printer: null,
      connected: false, secondsAgo: null, canTest: false,
      words: "Whoever presses Print gets the window — no printer is set up for this one.",
    };
  });
}
