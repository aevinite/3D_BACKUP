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
import { STALE_CLAIM_MS } from "@/lib/printQueue";

/** A helper that has not said hello inside this window is shown as not connected. It polls every
 *  ~2s, so 30s means "three quarters of a minute of silence" — long enough to survive a hiccup,
 *  short enough that a dead helper is never reported as alive while paper piles up in the basket. */
export const HELPER_STALE_MS = 30_000;

/** How long a job may sit unprinted before a BACKUP printer is allowed to take it. Deliberately
 *  generous: the primary printer must always get first refusal, or a slow-but-working kitchen
 *  printer would lose half its tickets to the counter. */
export const BACKUP_AFTER_MS_DEFAULT = 60_000;

export const PRINT_KINDS = ["kot", "bill", "banquet", "label", "test"] as const;
export type PrintKind = (typeof PRINT_KINDS)[number];
export const isPrintKind = (v: unknown): v is PrintKind =>
  typeof v === "string" && (PRINT_KINDS as readonly string[]).includes(v);

/** One line of the address book: "kitchen slips → this machine → this printer", plus an optional
 *  second choice for when the first prints nothing. Both halves are names the MACHINE reported,
 *  never typed by a person — which is why a printer nobody owns can never be routed to. */
export type PrintRoute = {
  agent: string | null;        // print_agents.id
  printer: string | null;      // the printer name as its own computer knows it
  backupAgent?: string | null;
  backupPrinter?: string | null;
  backupAfterMs?: number;
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
export type PaperSize = { name?: string; wMm: number; hMm: number };

export type AgentRow = {
  id: string;
  restaurant_id: string;
  name: string;
  fingerprint: string | null;
  printers: { name: string; desc?: string; paper?: PaperSize }[];
  last_seen_at: string | null;
  revoked_at: string | null;
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

const AGENT_COLS = "id, restaurant_id, name, fingerprint, seen_fingerprints, printers, last_seen_at, revoked_at";

const asPrinters = (v: unknown): { name: string; desc?: string; paper?: PaperSize }[] =>
  Array.isArray(v)
    ? v.map((p): Record<string, unknown> => (p && typeof p === "object" ? p as Record<string, unknown> : { name: p }))
        .map((p) => ({
          name: String(p.name ?? "").slice(0, 120),
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
export async function createAgent(rid: string, name: string): Promise<{ id: string; token: string } | { error: string }> {
  const label = String(name || "").trim().slice(0, 60) || "New computer";
  const { token, hash } = mintAgentToken();
  const ins = await sb.from("print_agents").insert({ restaurant_id: rid, name: label, token_hash: hash }).select("id").maybeSingle();
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
  await sb.from("print_agents").update(patch).eq("id", agent.id);
  return { clash: !!(fp && agent.fingerprint && fp !== agent.fingerprint) };
}

/** Every helper this restaurant has, with the one fact that matters on screen: is it alive. */
export async function agentsView(rid: string): Promise<AgentView[]> {
  const rows = (await sb.from("print_agents").select(AGENT_COLS)
    .eq("restaurant_id", rid).is("revoked_at", null).order("created_at", { ascending: true })).data as
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
      backupAgent: o.backupAgent ? String(o.backupAgent) : null,
      backupPrinter: o.backupPrinter ? String(o.backupPrinter).slice(0, 120) : null,
      backupAfterMs: typeof o.backupAfterMs === "number" && o.backupAfterMs >= 5000 ? o.backupAfterMs : BACKUP_AFTER_MS_DEFAULT,
      paper: asPaper(o.paper),
    };
  }
  return out;
}

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
    const backup = pick("backupAgent", "backupPrinter");
    if (typeof backup === "string") return { error: backup };
    const paper = asPaper(o.paper);
    next[kind] = {
      ...main,
      backupAgent: backup.agent, backupPrinter: backup.printer,
      backupAfterMs: typeof o.backupAfterMs === "number" && o.backupAfterMs >= 5000 ? o.backupAfterMs : BACKUP_AFTER_MS_DEFAULT,
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
 * already addressed it here. A job routed elsewhere becomes claimable as a BACKUP once it has sat
 * unprinted past the backup window, so a dead printer degrades into "it came out at the counter
 * instead" rather than into silence.
 *
 * The claim itself is the same single filtered UPDATE the kitchen and manager screens use, which is
 * what makes "two helpers", "a copied helper file", "two tabs" and "two printers with the same
 * name" all end in ONE piece of paper: everyone after the winner matches zero rows.
 */
export async function claimNext(rid: string, agent: AgentRow, routes?: PrintRoutes): Promise<ClaimedJob | null> {
  const R = routes || await readRoutes(rid);
  const mine = PRINT_KINDS.filter((k) => R[k].agent === agent.id);
  const backup = PRINT_KINDS.filter((k) => R[k].backupAgent === agent.id && R[k].agent !== agent.id);
  if (!mine.length && !backup.length) return null;

  // The candidate read: this restaurant's live jobs, oldest first, of the kinds this machine could
  // possibly print. Small by construction (a restaurant has a handful of unprinted tickets), and
  // indexed by print_jobs_kind_idx (mig 341).
  const kinds = [...new Set([...mine, ...backup])];
  const rows = (await sb.from("print_jobs")
    .select("id, kind, order_id, reprint, attempts, created_at, agent_id, printer, payload")
    .eq("restaurant_id", rid).in("kind", kinds).or(liveFilter())
    .order("created_at", { ascending: true }).limit(12)).data as {
      id: string; kind: string; order_id: string | null; reprint: boolean; attempts: number;
      created_at: string; agent_id: string | null; printer: string | null; payload?: unknown;
    }[] | null;

  const now = Date.now();
  for (const row of rows || []) {
    if (!isPrintKind(row.kind)) continue;
    const route = R[row.kind];
    let printer: string | null = null;
    if (route.agent === agent.id) printer = route.printer;
    // Somebody else's job: only after the backup window, and only if a backup printer is named.
    else if (route.backupAgent === agent.id && route.backupPrinter) {
      const age = now - new Date(row.created_at).getTime();
      if (age >= (route.backupAfterMs || BACKUP_AFTER_MS_DEFAULT)) printer = route.backupPrinter;
    }
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
  backup?: { agent: string; printer: string } | null;
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
  const b = r.backupAgent && r.backupPrinter ? agents.find((x) => x.id === r.backupAgent) : null;
  return {
    owned: true, agent: a.name, printer: r.printer, connected: a.connected, secondsAgo: a.secondsAgo,
    backup: b ? { agent: b.name, printer: r.backupPrinter as string } : null,
  };
}
