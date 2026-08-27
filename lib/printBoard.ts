// lib/printBoard.ts — ONE printing board, rendered in two places.
//
// WHY (owner, 2026-08-27): "the UI/UX is also not identical… right now it feels too much complicated,
// all the settings and every single bit of things." The admin console had a Printing menu and the
// manager panel had a Printing section, and they were two different products describing one machine:
// different headings, different words for the same thing, different order. A person who learned one
// learned nothing about the other.
//
// So the WORDS and the SHAPE live here, server-side, and both screens read them from this file:
// four steps, in the order a person actually asks them, with the same headings and the same
// sentences. The admin's copy can DO more (add any computer, route to any of them); the restaurant's
// copy is the same board narrowed to the machine in front of them. Neither is a different product.
//
// It holds no gate of its own. Every caller is already behind its own door — tokenIsValid for the
// admin route, requireRole + managerCan("print_setup") for the panel route.
import {
  agentsView, readRoutes, waitingCount, agentForDevice, ROUTABLE_KINDS,
  type AgentView, type PrintRoutes, type PaperSize, type RoutableKind,
} from "@/lib/printHelpers";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";

export {
  STEPS, KIND_LABEL, KIND_WHAT, KIND_OFF_LABEL, PAPER_PRESETS, paperLabel, WHO_CHOICES,
} from "@/lib/printBoardWords";
import { STEPS, KIND_LABEL, KIND_WHAT, KIND_OFF_LABEL, PAPER_PRESETS } from "@/lib/printBoardWords";

export type BoardJob = {
  id: string; kind: string; status: string; printer: string | null; printed_by: string | null;
  attempts: number; error: string | null; created_at: string; done_at: string | null;
};

export type BoardState = {
  steps: typeof STEPS;
  kinds: readonly RoutableKind[];
  labels: { kind: Record<string, string>; what: Record<string, string>; off: Record<string, string> };
  papers: typeof PAPER_PRESETS;
  agents: AgentView[];
  routes: PrintRoutes;
  waiting: number;
  recent: BoardJob[];
  /** Both rungs of the old mig-107 pair. `allowed` is Aevidine's; `on` is now shown as the Kitchen
   *  slips line's own answer, never as a second switch of its own (that duplicate is what made one
   *  board say ON while the other said OFF). */
  printing: { allowed: boolean; on: boolean };
  /** The helper this browser set up, when a restaurant set itself up (mig 367). Null on the admin's
   *  screen and on any device that has not registered itself. */
  thisComputer: AgentView | null;
};

const JOB_COLS = "id, kind, status, printer, printed_by, attempts, error, created_at, done_at";

/** Everything both boards draw, in ONE set of reads. Scoped by restaurant, column lists, hard
 *  limits — the egress rule, same as every other read in this app. */
export async function printBoardState(rid: string, opts?: { deviceId?: string | null; recent?: number }): Promise<BoardState> {
  const [agents, routes, waiting, setRow, jobs] = await Promise.all([
    agentsView(rid),
    readRoutes(rid),
    waitingCount(rid),
    sb.from("settings").select("auto_print_kot, auto_print_kot_allowed").eq("restaurant_id", rid).maybeSingle(),
    sb.from("print_jobs").select(JOB_COLS).eq("restaurant_id", rid)
      .order("created_at", { ascending: false }).limit(Math.min(30, Math.max(5, opts?.recent ?? 12))),
  ]);
  const s = (setRow.data || {}) as { auto_print_kot?: boolean; auto_print_kot_allowed?: boolean };
  const dv = String(opts?.deviceId || "").trim();
  return {
    steps: STEPS,
    kinds: ROUTABLE_KINDS,
    labels: { kind: KIND_LABEL, what: KIND_WHAT, off: KIND_OFF_LABEL },
    papers: PAPER_PRESETS,
    agents,
    routes,
    waiting,
    recent: (jobs.data || []) as BoardJob[],
    printing: { allowed: s.auto_print_kot_allowed === true, on: s.auto_print_kot === true },
    thisComputer: dv ? agents.find((a) => a.owner_device === dv) || null : null,
  };
}

/** The same "is this computer already set up?" answer on its own, for the cheap reads that do not
 *  need the whole board. */
export const thisComputerOf = agentForDevice;
