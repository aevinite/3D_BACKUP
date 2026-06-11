// tableConnection — the single source of truth for "is this guest allowed to add
// to the cart right now?" plus the gate that every Add button calls.
//
// THE RULE (owner, 2026-06-11): when the dining-session system is ON, you can only
// add items to your cart if you're CONNECTED to a table — i.e. an APPROVED member
// (head, or a partner the head let in) of an OPEN session. A partner still waiting
// for approval, or someone who never joined, can't add yet. When sessions are OFF
// the menu behaves like a normal browse-and-order menu (no table needed).
//
// How the pieces fit:
//   • SessionStatusWidget already polls the live session every 3s. It calls
//     setTableConnection() each poll, so the answer is cached and readable
//     SYNCHRONOUSLY here — no per-tap network call, no second poller.
//   • gateAddToCart() reads that cache. Allowed -> run the add now. Not allowed ->
//     open the EXISTING SessionGate join flow (via the `connect` action) and run
//     the add only once the guest is connected + approved (auto-resume).

import { getStoredSession } from "./session";
import { getScannedTable } from "./table";

// Live answer, refreshed by SessionStatusWidget. Defaults to "sessions off" so that
// before the first poll (or when sessions are off) adds are never blocked.
let state: { sessionsEnabled: boolean; connected: boolean } = { sessionsEnabled: false, connected: false };

// Called by SessionStatusWidget on every poll with the current truth.
export function setTableConnection(next: { sessionsEnabled: boolean; connected: boolean }) {
  state = next;
}
export function getTableConnection() {
  return state;
}

// Which table a not-yet-connected guest would join: their saved session's table if
// they have one, otherwise the table from the QR code they scanned. Null = unknown.
export function intendedTable(): string | null {
  return getStoredSession()?.table || getScannedTable() || null;
}

// Adds that were blocked because the guest wasn't connected yet. They run, in order,
// the moment the guest becomes connected (SessionGate fires `lfh:session-done`).
let queue: Array<() => void> = [];
let wired = false;
function wireResume() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("lfh:session-done", (e) => {
    const d = (e as CustomEvent).detail as { ok?: boolean; action?: string } | undefined;
    if (d?.action !== "connect") return; // only OUR gate's completions; ignore order/call
    const pendingAdds = queue;
    queue = [];
    if (d.ok) pendingAdds.forEach((fn) => fn()); // connected -> carry out the held adds
    // (cancelled / failed connect -> queue already cleared above, so the abandoned
    //  adds are dropped instead of resurfacing on a later successful connect)
    // cancelled / failed -> drop them (nothing gets added)
  });
}

// THE GATE every Add button calls. `run` is the actual "put it in the cart" work.
export function gateAddToCart(run: () => void): void {
  // Sessions off, or already connected + approved -> add immediately.
  if (!state.sessionsEnabled || state.connected) { run(); return; }
  // Sessions on but not connected: hold this add and open the join flow. We pass
  // the table we already know (stored session, or a scanned QR); if none is known
  // the gate asks the guest to type their table number. The add runs once they're
  // connected + approved.
  wireResume();
  queue.push(run);
  window.dispatchEvent(new CustomEvent("lfh:session-do", { detail: { action: "connect", table: intendedTable() || "", payload: {} } }));
}
