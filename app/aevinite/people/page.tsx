"use client";
// /aevinite/people — ONE screen for everybody who can sign in (owner, 2026-09-13).
//
//   "do one more thing merge 2 section name it user and owner and on the top there is 2 option
//    for if click on owner it will show right now owner menu if click on user it will show that"
//
// WHAT CHANGED, AND WHAT DELIBERATELY DID NOT. The console had two sibling entries in the sidebar —
// "Owners" and "Users" — that answered the same question ("who are the people?") from two different
// doors, so which one you needed depended on knowing in advance what role the person held. They are
// now one entry with a switch at the top. The two screens THEMSELVES are untouched: they moved to
// components/admin/OwnersView.tsx and UsersView.tsx exactly as they were. Rewriting two mature
// rosters into one generic list would have thrown away a great deal of behaviour that works — the
// owner's multi-restaurant chips and estate badges, the user's role filters and per-panel create
// form — to gain nothing the switch doesn't already give.
//
// ── A NEW WAY REPLACES THE OLD ONE (owner, 2026-08-29, STANDING) ────────────────────────────────
// So the two old sidebar entries are GONE, not hidden — one entry, "Users & owners". /aevinite/owners
// and /aevinite/users still resolve, but only as redirects into the right half of this page, because
// they are written down in other screens, in bookmarks, and in the admin's muscle memory. A redirect
// is not a second way of doing the job; it is the old address pointing at the only one.
//
// THE FOUR THINGS THE SWITCH ITSELF HAS TO GET RIGHT:
//   1. THE TAB IS IN THE URL (?tab=owners|users). Refreshing leaves you where you are — the standing
//      rule from 2026-08-02 ("I refresh, why do I go back to the main thing?") — and the address bar
//      is a link somebody can send. `replace`, not `push`, so Back leaves the page instead of
//      walking through every tab you tried.
//   2. IT IS A REAL TABLIST. role=tablist / role=tab / aria-selected, and ← → arrows move between
//      them, because a segmented control that only answers a mouse is a segmented control half the
//      console can't use.
//   3. BOTH HALVES STAY MOUNTED ONCE VISITED. Switching back to a roster you have already loaded is
//      instant and costs no second read — it is hidden, not destroyed, so its filters, its scroll and
//      its open person survive the round trip.
//   4. IT FITS A PHONE. The switch is two equal halves at 390px, each comfortably over the 44px
//      touch floor, and it never wraps.
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import OwnersView from "@/components/admin/OwnersView";
import UsersView from "@/components/admin/UsersView";
import { RevealChip } from "@/components/admin/useReveal";

type Tab = "owners" | "users";
const TABS: { id: Tab; label: string; icon: string; hint: string }[] = [
  { id: "owners", label: "Owners", icon: "fa-crown", hint: "The people who own a restaurant" },
  { id: "users", label: "Users", icon: "fa-users", hint: "Manager, kitchen and waiter logins" },
];

function PeopleInner() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = raw === "users" ? "users" : "owners";

  // Rule 3: a half that has been opened stays mounted. `owners` is the landing tab, so it starts
  // true; `users` only after the first visit.
  const [seen, setSeen] = useState<Record<Tab, boolean>>({ owners: tab === "owners", users: tab === "users" });
  useEffect(() => { setSeen((p) => (p[tab] ? p : { ...p, [tab]: true })); }, [tab]);

  const go = useCallback((next: Tab) => {
    if (next === tab) return;
    const q = new URLSearchParams(params.toString());
    q.set("tab", next);
    // replace, not push — see rule 1.
    router.replace(`/aevinite/people?${q.toString()}`, { scroll: false });
  }, [tab, params, router]);

  // Rule 2: ← → walk the tabs, Home/End jump to the ends — the WAI-ARIA tabs pattern.
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const last = TABS.length - 1;
    let n = -1;
    if (e.key === "ArrowRight") n = i === last ? 0 : i + 1;
    else if (e.key === "ArrowLeft") n = i === 0 ? last : i - 1;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = last;
    if (n < 0) return;
    e.preventDefault();
    go(TABS[n].id);
    refs.current[n]?.focus();
  };

  return (
    <div className="ppl">
      <header className="ppl-head">
        <div className="ppl-title">
          <h1>Users &amp; owners</h1>
          <p className="hint">Everyone who can sign in to Aevidine — the owners of each restaurant, and the manager, kitchen and waiter logins that run the floor.</p>
        </div>
        {/* The uncover countdown lives up here, once, rather than on every card that can show a
            password — one window, one place that says how long is left of it. */}
        <RevealChip />
      </header>

      <div className="ppl-switch" role="tablist" aria-label="Owners or users">
        {TABS.map((t, i) => {
          const on = t.id === tab;
          return (
            <button
              key={t.id}
              ref={(el) => { refs.current[i] = el; }}
              role="tab"
              id={`ppl-tab-${t.id}`}
              aria-selected={on}
              aria-controls={`ppl-panel-${t.id}`}
              // Only the selected tab is in the tab order; the arrows move between them from there.
              tabIndex={on ? 0 : -1}
              className={`ppl-tab${on ? " on" : ""}`}
              onClick={() => go(t.id)}
              onKeyDown={(e) => onKey(e, i)}
              title={t.hint}
            >
              <i className={`fas ${t.icon}`} aria-hidden="true" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Both panels stay in the tree once seen (rule 3). `hidden` takes them out of the layout AND
          out of the accessibility tree, so a screen reader never walks the roster you can't see. */}
      {TABS.map((t) => (
        <div key={t.id} role="tabpanel" id={`ppl-panel-${t.id}`} aria-labelledby={`ppl-tab-${t.id}`} hidden={t.id !== tab}>
          {seen[t.id] ? (t.id === "owners" ? <OwnersView /> : <UsersView />) : null}
        </div>
      ))}

      <style jsx>{`
        .ppl-head {
          display: flex; align-items: flex-start; gap: 14px; flex-wrap: wrap;
          margin-bottom: 14px;
        }
        .ppl-title { flex: 1; min-width: 220px; }
        .ppl-title h1 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.2px; }
        .ppl-title :global(.hint) { margin: 4px 0 0; max-width: 68ch; }

        /* A segmented control, not a row of links: the two are mutually exclusive, and a filled
           track around them says so without needing a label to explain it. */
        .ppl-switch {
          display: grid; grid-auto-flow: column; grid-auto-columns: 1fr;
          gap: 4px; padding: 4px; margin-bottom: 18px;
          background: var(--muted2, rgba(127,127,127,0.10));
          border: var(--border); border-radius: 12px;
          width: 100%; max-width: 420px;
        }
        .ppl-tab {
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          min-height: 44px; padding: 9px 14px;          /* ≥44px: the touch floor, on the phone too */
          border: 0; border-radius: 9px; cursor: pointer;
          background: transparent; color: var(--muted);
          font-size: 14px; font-weight: 700; white-space: nowrap;
          transition: background 160ms ease, color 160ms ease;
        }
        .ppl-tab:hover { color: var(--text); }
        .ppl-tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .ppl-tab.on {
          background: var(--card); color: var(--text);
          box-shadow: 0 1px 2px rgba(0,0,0,0.16);
        }
        /* The active tab is not told apart by colour alone — it also carries the raised card
           surface and a weight change (a11y: colour-not-only). */
        .ppl-tab i { font-size: 13px; opacity: .9; }

        @media (prefers-reduced-motion: reduce) {
          .ppl-tab { transition: none; }
        }
        @media (max-width: 520px) {
          .ppl-switch { max-width: none; }
          .ppl-title h1 { font-size: 19px; }
        }
      `}</style>
    </div>
  );
}

// ── A "LOADING…" THAT CAN NEVER END IS A BROKEN SCREEN (verify:admin-access-people, 2026-09-13) ──
// This boundary normally resolves in a frame — it exists only because useSearchParams needs one, or
// the whole route opts out of static rendering. But "normally" is not "always": if the page's
// javascript never arrives (a stale chunk after a deploy — the fault PR #1314 was about), this
// fallback is the LAST thing drawn and it would sit there spinning for ever with nothing to press.
//
// So it gives up out loud. Eight seconds, then it says what happened and offers the one thing that
// actually cures a missing chunk — a reload. Same rule as every read in the app: there is no such
// thing as waiting for ever, and a person must never be left with nothing to do.
function PeopleFallback() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(t);
  }, []);
  if (!slow) return <div className="adm-empty">Loading people…</div>;
  return (
    <div className="adm-empty" role="alert">
      This screen didn&rsquo;t finish loading.
      <button className="adm-btn" style={{ marginLeft: 10 }} onClick={() => window.location.reload()}>
        <i className="fas fa-rotate-right" style={{ marginRight: 7 }} aria-hidden="true" />Try again
      </button>
    </div>
  );
}

export default function PeoplePage() {
  return (
    <Suspense fallback={<PeopleFallback />}>
      <PeopleInner />
    </Suspense>
  );
}
