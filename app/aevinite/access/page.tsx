"use client";
/* /aevinite/access — Access & permissions (owner rebuild, 2026-07-31).
 *
 * A thin shell: pick a restaurant, pick a tab. Both tabs are their own components and both
 * read lib/accessTree.ts, so "what a role gets by default" and "what this one person gets"
 * can never offer different capabilities.
 *
 *   General     → <AccessTree/>       Main features · Staff apps · Manager's menu ·
 *                                     Owner's menu · Default set for user
 *   Per person  → <AccessPerPerson/>  the exception list for one member of staff
 *
 * This replaced a 1000-line screen of 54 sub-checkboxes, 45 of which no server code read.
 * The rule now: a toggle exists only where lib/accessTree.ts says so. Spec:
 * docs/ACCESS-MODEL.md. */
import { useEffect, useState } from "react";
import AccessTree from "@/components/admin/AccessTree";
import AccessPerPerson from "@/components/admin/AccessPerPerson";

type Rest = { id: string; name: string; slug: string; active: boolean };

const P: Record<string, string> = {
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 010 7.8",
  arrowL: "M19 12H5M12 19l-7-7 7-7",
};
const Icon = ({ n, s = 15 }: { n: string; s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.85}
    strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }} aria-hidden="true">
    {P[n]?.split("M").filter(Boolean).map((d, i) => <path key={i} d={"M" + d} />)}
  </svg>
);

export default function AccessPage() {
  const [rests, setRests] = useState<Rest[]>([]);
  const [rid, setRid] = useState("");
  const [tab, setTab] = useState<"general" | "person">("general");
  const [fromRest, setFromRest] = useState(false);

  useEffect(() => {
    // ?rid / ?from read straight off the URL (no useSearchParams → no Suspense boundary),
    // matching how the restaurants page reads ?focus.
    const q = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const urlRid = q.get("rid") || "";
    setFromRest(q.get("from") === "rest");
    fetch("/api/admin/restaurants")
      .then((r) => r.json())
      .then((d) => {
        const list: Rest[] = (Array.isArray(d) ? d : d.restaurants || []).filter((x: Rest) => x.active !== false);
        setRests(list);
        const pick = list.find((x) => x.id === urlRid) || list[0];
        if (pick) setRid(pick.id);
      })
      .catch(() => {});
  }, []);

  const rest = rests.find((r) => r.id === rid);

  return (
    <div className="acc2">
      <Style />
      <nav className="adm-crumbs" style={{ marginBottom: 4 }}>
        <a href="/aevinite">Dashboard</a><span className="sep">›</span>
        <a href="/aevinite/restaurants">Restaurants</a><span className="sep">›</span>
        <a href={rest ? `/aevinite/restaurants?focus=${rest.slug}` : "/aevinite/restaurants"}>{rest?.name || "Restaurant"}</a>
        <span className="sep">›</span>
        <span className="cur">Access</span>
      </nav>
      {fromRest && rest && (
        <a className="adm-btn" href={`/aevinite/restaurants?focus=${rest.slug}`} style={{ margin: "10px 0 2px", display: "inline-flex", alignItems: "center", gap: 7 }}>
          <Icon n="arrowL" s={14} /> Back to {rest.name}
        </a>
      )}

      <header className="acc2-head">
        <div>
          <h1 className="adm-page-title" style={{ margin: 0 }}>Access &amp; permissions</h1>
          <p className="adm-page-sub" style={{ margin: "4px 0 0" }}>
            {rest?.name ? `${rest.name} · ` : ""}the only screen that decides what anyone can do.
          </p>
        </div>
        <div className="acc2-head-r">
          <select className="acc2-rsel" value={rid} onChange={(e) => setRid(e.target.value)} aria-label="Restaurant">
            {rests.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <div className="acc2-tabs">
            <button className={tab === "general" ? "on" : ""} onClick={() => setTab("general")}><Icon n="shield" /> General</button>
            <button className={tab === "person" ? "on" : ""} onClick={() => setTab("person")}><Icon n="users" /> Per person</button>
          </div>
        </div>
      </header>

      {/* `rest` is what lets a row open a whole editor inside itself — the branding, billing,
          KOT, sessions, banquet and tables cards that used to live on the restaurant-detail
          page (owner, 2026-08-01). The picker above already knows the restaurant, so nothing
          extra is fetched for it. */}
      {rid ? (tab === "general" ? <AccessTree rid={rid} rest={rest ? { id: rest.id, slug: rest.slug, name: rest.name } : undefined} /> : <AccessPerPerson rid={rid} />) : null}
    </div>
  );
}

function Style() {
  return <style jsx global>{`
  .acc2 { max-width: 1180px; }
  .acc2-head { display:flex; align-items:flex-end; gap:16px; flex-wrap:wrap; margin:6px 0 18px; }
  .acc2-head-r { margin-left:auto; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .acc2-save { font-size:12px; font-weight:700; color:var(--muted); min-width:60px; text-align:right; }
  .acc2-save.saved { color:var(--adm-ok); } .acc2-save.err { color:var(--adm-danger); }
  .acc2-rsel { height:40px; border-radius:10px; border:var(--border); background:var(--card); color:var(--text); font-weight:700; font-size:13.5px; padding:0 10px; }
  .acc2-tabs { display:flex; gap:3px; background:var(--card); border:var(--border); border-radius:12px; padding:4px; }
  .acc2-tabs button { display:flex; align-items:center; gap:7px; min-height:40px; padding:0 16px; border-radius:9px; border:none; background:transparent; color:var(--muted); font-weight:700; font-size:13.5px; cursor:pointer; }
  .acc2-tabs button.on { background:var(--accent); color:#fff; }
  .acc2-warn { display:flex; gap:10px; align-items:flex-start; padding:12px 16px; margin:0 0 16px; border-radius:12px; background:color-mix(in srgb, var(--adm-danger) 12%, transparent); border:1px solid color-mix(in srgb, var(--adm-danger) 40%, transparent); color:var(--text); font-size:13.5px; }
  .acc2-main { display:flex; flex-direction:column; gap:14px; min-width:0; }
  .acc2-sect { padding:0; overflow:hidden; }
  .acc2-sh { display:flex; align-items:center; gap:13px; width:100%; padding:13px 16px; border:none; background:transparent; cursor:pointer; text-align:left; color:var(--text); }
  .acc2-sh-t { flex:1; min-width:0; }
  .acc2-sh h2 { margin:0; font-size:15.5px; font-weight:800; letter-spacing:-.02em; }
  .acc2-sh p { margin:2px 0 0; font-size:12px; color:var(--muted); line-height:1.35; }
  .acc2-gi { width:30px; height:30px; border-radius:9px; display:grid; place-items:center; flex:none; background:color-mix(in srgb, var(--accent) 11%, transparent); color:var(--accent); border:1px solid color-mix(in srgb, var(--accent) 20%, transparent); }
  .acc2-gi.lg { width:38px; height:38px; border-radius:11px; }
  .acc2-chev { color:var(--muted); transition:transform .2s; display:grid; place-items:center; background:none; border:none; cursor:pointer; }
  .acc2-chev.o { transform:rotate(180deg); color:var(--accent); }
  .acc2-body { border-top:var(--border); padding:8px; display:flex; flex-direction:column; gap:8px; }
  .acc2-sw { display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:11px; background:var(--bg); }
  .acc2-sw-b { flex:1; min-width:0; } .acc2-sw .nm { font-size:14px; font-weight:700; display:flex; align-items:center; gap:8px; }
  .acc2-sw .ds { font-size:12px; color:var(--muted); margin-top:2px; line-height:1.5; }
  .acc2-toggle { width:44px; height:26px; border-radius:99px; background:var(--muted2); border:var(--border); position:relative; cursor:pointer; flex:none; transition:background .2s; }
  .acc2-toggle span { position:absolute; top:2px; left:2px; width:20px; height:20px; border-radius:99px; background:var(--muted); transition:transform .2s, background .2s; }
  .acc2-toggle.on { background:var(--accent); border-color:var(--accent); } .acc2-toggle.on span { transform:translateX(18px); background:#fff; }
  @media (max-width:640px) { .acc2-head-r { width:100%; } .acc2-rsel { flex:1; } }
  `}</style>;
}
