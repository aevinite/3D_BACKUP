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
import type { PaperSize } from "@/lib/printBoardWords";

/** A helper that has not said hello inside this window is shown as not connected. It polls every
 *  ~2s, so 30s means "three quarters of a minute of silence" — long enough to survive a hiccup,
 *  short enough that a dead helper is never reported as alive while paper piles up in the basket. */
export const HELPER_STALE_MS = 30_000;

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
export type { PaperSize } from "@/lib/printBoardWords";

export type AgentRow = {
  id: string;
  restaurant_id: string;
  name: string;
  fingerprint: string | null;
  printers: { name: string; desc?: string; paper?: PaperSize }[];
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

const asPrinters = (v: unknown): { name: string; desc?: string; paper?: PaperSize }[] =>
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

export async function readRoutes(rid: string): Promise<PrintRoutes> {
  const s = (await sb.from("settings").select("modules").eq("restaurant_id", rid).maybeSingle()).data as
    { modules?: unknown } | null;
  const raw = bagOf(s?.modules)["printing"];
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
export async function writeRoutes(rid: string, patch: Record<string, unknown>): Promise<{ routes: PrintRoutes } | { error: string }> {
  const agents = await agentsView(rid);
  const byId = new Map(agents.map((a) => [a.id, a]));
  const current = await readRoutes(rid);
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
  const s = (await sb.from("settings").select("modules").eq("restaurant_id", rid).maybeSingle()).data as { modules?: unknown } | null;
  const bag = { ...bagOf(s?.modules) };
  bag["printing"] = { ...(bag["printing"] || {}), routes: next };
  const up = await sb.from("settings").update({ modules: bag }).eq("restaurant_id", rid).select("restaurant_id").maybeSingle();
  if (up.error) return { error: "Could not save the printing routes." };
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
export async function claimNext(rid: string, agent: AgentRow, routes?: PrintRoutes): Promise<ClaimedJob | null> {
  const R = routes || await readRoutes(rid);
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

  const now = Date.now();
  for (const row of rows || []) {
    if (!isPrintKind(row.kind)) continue;
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

    const won = (await sb.from("print_jobs")
      .update({ status: "printing", claimed_at: new Date().toISOString(), agent_id: agent.id, printer, printed_by: agent.name })
      .eq("id", row.id).eq("restaurant_id", rid).or(liveFilter())
      .select("id").maybeSingle()).data as { id: string } | null;
    if (!won) continue;                                   // someone else got there first — next row

    return {
      id: row.id, kind: row.kind, printer, orderId: row.order_id ?? null,
      reprint: row.reprint !== false, attempts: row.attempts || 0,
      payload: (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown>,
    };
  }
  return null;
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
  await sb.from("settings").update({ auto_print_kot: on }).eq("restaurant_id", rid);
}

/** How many notes are still waiting — the "Waiting to print: 0" line, and the honest answer to
 *  "did my bill go anywhere?". Counted, not listed: nothing needs the rows. */
export async function waitingCount(rid: string): Promise<number> {
  const r = await sb.from("print_jobs").select("id", { count: "exact", head: true })
    .eq("restaurant_id", rid).in("status", ["queued", "printing"]);
  return r.count || 0;
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
