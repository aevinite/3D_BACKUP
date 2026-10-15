// scripts/sweep/t4s10/lab/entry.tsx — THE SCREEN LAB (sweep #10 T4 round 2, 2026-10-15).
//
// Mounts my territory's screens the way the app does — inside the one RestaurantProvider
// (app/layout.tsx), the five GuestChrome mounts side by side (components/GuestChrome.tsx), the table
// bill where the basket shows it, and BotTrap inside a form (the login doors). Nothing is re-written:
// these are the real files, bundled for a browser (./build.mjs) and driven by ./page.mjs, with the
// database's answers held at the network edge. window.__LAB.mount picks which to mount (default: all).
import { createRoot } from "react-dom/client";
import { RestaurantProvider, useRestaurantId, useRestaurantMeta } from "@/lib/restaurant-context";
import SessionGate from "@/components/SessionGate";
import SessionOwner from "@/components/SessionOwner";
import SessionCartSync from "@/components/SessionCartSync";
import SessionStatusWidget from "@/components/SessionStatusWidget";
import BanGate from "@/components/BanGate";
import SessionTableBill from "@/components/SessionTableBill";
import BotTrap, { botFields } from "@/components/BotTrap";
// Not this territory's file, but part of how the app is put together: it turns "a session changed"
// into the `lfh:rt-tick` nudge every table widget re-reads on (components/RealtimeProvider.tsx). Without
// it the lab would show a table card that waits a minute after a join — which no real phone does.
import RealtimeProvider from "@/components/RealtimeProvider";
import { getTableConnection, gateAddToCart } from "@/lib/tableConnection";

type Lab = { mount?: string[] };
const L: Lab = (window as unknown as { __LAB?: Lab }).__LAB || {};
const want = (k: string) => !L.mount || L.mount.includes(k);

function CtxProbe() {
  const id = useRestaurantId();
  const meta = useRestaurantMeta();
  return <pre id="lab-ctx">{JSON.stringify({ hookId: id, ...meta })}</pre>;
}

function App() {
  return (
    <RestaurantProvider>
      {want("rt") && <RealtimeProvider />}
      {want("ctx") && <CtxProbe />}
      {want("gate") && <SessionGate />}
      {want("owner") && <SessionOwner />}
      {want("cartSync") && <SessionCartSync />}
      {want("card") && <SessionStatusWidget />}
      {want("ban") && <BanGate />}
      {want("tbill") && <div id="lab-cart"><SessionTableBill /></div>}
      {want("trap") && <form id="lab-form" onSubmit={(e) => e.preventDefault()}><BotTrap /></form>}
    </RestaurantProvider>
  );
}

(window as unknown as { __labBotFields: typeof botFields }).__labBotFields = botFields;
// the add-to-cart gate's shared state, read the way MenuView/CartPanel read it
(window as unknown as { __labLib: Record<string, unknown> }).__labLib = { getTableConnection, gateAddToCart: (n: string) => gateAddToCart(() => { (window as unknown as { __added: string[] }).__added = [...((window as unknown as { __added?: string[] }).__added || []), n]; }) };
const root = createRoot(document.getElementById("root")!);
root.render(<App />);
// unmount on demand, so a check can see that a screen stops listening when it goes away
(window as unknown as { __labUnmount: () => void }).__labUnmount = () => root.unmount();
(window as unknown as { __labReady: boolean }).__labReady = true;
