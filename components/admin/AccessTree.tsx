"use client";
/* components/admin/AccessTree.tsx — the rebuilt Access & permissions screen
 * (owner, 2026-07-31; spec docs/ACCESS-MODEL.md).
 *
 * Renders lib/accessTree.ts as a real tree: four sections, each a card, each row able to
 * carry its own children. Two rules from the owner are structural here, not cosmetic:
 *
 *   1. NO GREYED-OUT GHOSTS. A child whose parent is off is REMOVED from the DOM, not
 *      disabled with a tooltip. If a role can never reach a thing, that thing is absent.
 *   2. ONLY LISTED TOGGLES EXIST. Every control on this screen comes from accessTree, so
 *      there is no way to render a switch that no server code reads.
 *
 * All state goes through /api/admin/restaurants/access-tree, and every write is built by
 * nodePatch() from the same model — the screen cannot disagree with the database about
 * where a switch lives. Styling reuses the panel's existing .acc2-* language plus a small
 * .at-* set for the tree indentation. */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  SECTIONS, nodeValue, nodePatch, extraPatch, applyPatch,
  type Node, type Section, type TreeState, type TreePatch,
} from "@/lib/accessTree";

const ICON: Record<string, string> = {
  sparkles: "M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 010 7.8",
  crown: "M3 18h18M4 15L2 7l5.5 4L12 4l4.5 7L22 7l-2 8z",
  user: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8",
  info: "M12 22a10 10 0 100-20 10 10 0 000 20M12 16v-5M12 8h.01",
  chevron: "M6 9l6 6 6-6", check: "M20 6L9 17l-5-5", link: "M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1",
};
const Icon = ({ n, s = 16 }: { n: string; s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.85}
    strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }} aria-hidden="true">
    {ICON[n]?.split("M").filter(Boolean).map((d, i) => <path key={i} d={"M" + d} />)}
  </svg>
);

const isBoolBind = (n: Node) =>
  ["feature", "setting", "module", "panel", "channel", "grant", "section", "tab"].includes(n.bind.t);

/** Does this row read as "on"? Used for the parent gate and the section counter. A row with
 *  no switch of its own (a pure group, e.g. Format / Bill) is always "on" so its children show. */
function isOn(n: Node, st: TreeState): boolean {
  if (n.bind.t === "none") return true;
  if (isBoolBind(n)) return nodeValue(n, st) === true;
  if (n.bind.t === "tablet" || n.bind.t === "capTablet") return nodeValue(n, st) !== "off";
  return true;
}

export default function AccessTree({ rid }: { rid: string }) {
  const [st, setSt] = useState<TreeState | null>(null);
  const [saving, setSaving] = useState<"" | "saving" | "saved" | "err">("");
  const [err, setErr] = useState("");
  const [openSec, setOpenSec] = useState<Record<string, boolean>>({ main: true });
  const [openNode, setOpenNode] = useState<Record<string, boolean>>({});
  const [info, setInfo] = useState<Node | null>(null);
  const flash = useRef<number>(0);

  const load = useCallback((id: string) => {
    if (!id) return;
    fetch(`/api/admin/restaurants/access-tree?restaurant_id=${id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (d.error) setErr(d.error); else { setErr(""); setSt(d.state as TreeState); } })
      .catch(() => setErr("Couldn't load this restaurant's settings."));
  }, []);
  useEffect(() => { setSt(null); load(rid); }, [rid, load]);

  // Optimistic: merge locally for an instant repaint, then POST the identical patch. On a
  // refusal we reload from the server rather than leave the screen showing a value that
  // never landed (a switch that looks saved and isn't is the exact thing being removed).
  const save = useCallback((patch: TreePatch) => {
    setSt((prev) => (prev ? applyPatch(prev, patch) : prev));
    setSaving("saving");
    const stamp = ++flash.current;
    fetch("/api/admin/restaurants/access-tree", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurant_id: rid, patch }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setErr(j.error || "That change didn't save.");
          setSaving("err"); load(rid); return;
        }
        setErr("");
        if (stamp === flash.current) { setSaving("saved"); setTimeout(() => { if (stamp === flash.current) setSaving(""); }, 1400); }
      })
      .catch(() => { setSaving("err"); setErr("That change didn't save — the connection dropped."); load(rid); });
  }, [rid, load]);

  const set = useCallback((n: Node, v: any) => {
    save(applyTwo(nodePatch(n, v), extraPatch(n, v)));
  }, [save]);

  if (err && !st) return <div className="acc2-warn"><Icon n="info" s={17} /><div>{err}</div></div>;
  if (!st) return <div className="adm-muted" style={{ padding: 28, textAlign: "center" }}>Loading…</div>;

  return (
    <>
      <TreeStyle />
      <div className="at-head">
        <span className={`acc2-save ${saving}`}>
          {saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : saving === "err" ? "Not saved" : ""}
        </span>
      </div>
      {err ? <div className="acc2-warn"><Icon n="info" s={17} /><div>{err}</div></div> : null}

      <div className="acc2-main">
        {SECTIONS.map((sec) => (
          <SectionCard
            key={sec.id} sec={sec} st={st} open={!!openSec[sec.id]}
            onToggle={() => setOpenSec((s) => ({ ...s, [sec.id]: !s[sec.id] }))}
            openNode={openNode} setOpenNode={setOpenNode} set={set} onInfo={setInfo}
          />
        ))}
      </div>

      {info ? <InfoSheet node={info} onClose={() => setInfo(null)} /> : null}
    </>
  );
}

/** Merge two patches (the node's own + the Ratings mirror) without losing either branch. */
function applyTwo(a: TreePatch, b: TreePatch): TreePatch {
  if (!Object.keys(b).length) return a;
  const out: any = { ...a };
  for (const k of Object.keys(b) as (keyof TreePatch)[]) out[k] = { ...(out[k] || {}), ...(b[k] as object) };
  return out;
}

function SectionCard({ sec, st, open, onToggle, openNode, setOpenNode, set, onInfo }: {
  sec: Section; st: TreeState; open: boolean; onToggle: () => void;
  openNode: Record<string, boolean>; setOpenNode: (f: (s: Record<string, boolean>) => Record<string, boolean>) => void;
  set: (n: Node, v: any) => void; onInfo: (n: Node) => void;
}) {
  // The counter counts only rows that HAVE a switch at this level — a group header
  // (Format, Bill, the three role folders) isn't a thing you can turn on.
  const switchable = sec.children.filter((n) => n.bind.t !== "none" && !n.leftToBuild);
  const on = switchable.filter((n) => isOn(n, st)).length;
  return (
    <section className="adm-card acc2-sect" id={`sec-${sec.id}`}>
      <button className="acc2-sh" onClick={onToggle} aria-expanded={open}>
        <span className="acc2-gi lg"><Icon n={sec.icon} s={18} /></span>
        <span className="acc2-sh-t"><h2>{sec.name}</h2><p>{sec.blurb}</p></span>
        {switchable.length ? <span className="at-count">{on}/{switchable.length}</span> : null}
        <span className={`acc2-chev ${open ? "o" : ""}`}><Icon n="chevron" s={18} /></span>
      </button>
      {open ? (
        <div className="acc2-body">
          {sec.children.map((n) => (
            <Row key={n.id} node={n} st={st} depth={0} openNode={openNode} setOpenNode={setOpenNode} set={set} onInfo={onInfo} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Row({ node, st, depth, openNode, setOpenNode, set, onInfo }: {
  node: Node; st: TreeState; depth: number;
  openNode: Record<string, boolean>; setOpenNode: (f: (s: Record<string, boolean>) => Record<string, boolean>) => void;
  set: (n: Node, v: any) => void; onInfo: (n: Node) => void;
}) {
  const v = nodeValue(node, st);
  const kids = node.children || [];
  // RULE 1: children of an OFF row are removed, never greyed. A pure group (bind "none")
  // has nothing to switch, so its children always show.
  const showKids = kids.length > 0 && isOn(node, st);
  // Groups with a lot inside collapse; a row with 1-2 children just shows them.
  const collapsible = showKids && kids.length > 2;
  const expanded = collapsible ? openNode[node.id] !== false : true;

  return (
    <div className={`at-row d${Math.min(depth, 3)}`}>
      <div className="acc2-sw">
        <div className="acc2-sw-b">
          <div className="nm">
            {collapsible ? (
              <button className={`at-tw ${expanded ? "o" : ""}`} aria-label={expanded ? "Collapse" : "Expand"}
                onClick={() => setOpenNode((s) => ({ ...s, [node.id]: !expanded }))}><Icon n="chevron" s={14} /></button>
            ) : null}
            {node.name}
            {node.leftToBuild ? <span className="at-tag build">Left to build</span> : null}
            {node.fresh && !node.leftToBuild ? <span className="at-tag new">New</span> : null}
            <button className="at-i" onClick={() => onInfo(node)} aria-label={`What is ${node.name}?`}><Icon n="info" s={14} /></button>
          </div>
          <div className="ds">{node.what}</div>
          {node.link ? (
            <a className="at-link" href={node.link.href}><Icon n="link" s={13} /> {node.link.label}</a>
          ) : null}
        </div>
        <Control node={node} value={v} set={set} />
      </div>

      {showKids && expanded ? (
        <div className="at-kids">
          {kids.map((k) => (
            <Row key={k.id} node={k} st={st} depth={depth + 1} openNode={openNode} setOpenNode={setOpenNode} set={set} onInfo={onInfo} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Control({ node, value, set }: { node: Node; value: any; set: (n: Node, v: any) => void }) {
  const b = node.bind;
  if (node.leftToBuild || b.t === "none") return null;

  if (isBoolBind(node)) {
    return (
      <button className={`acc2-toggle ${value ? "on" : ""}`} role="switch" aria-checked={!!value}
        aria-label={node.name} onClick={() => set(node, !value)}><span /></button>
    );
  }

  if (b.t === "tablet" || b.t === "capTablet") {
    // The manager-PIN middle state exists ONLY on money actions (owner, 2026-07-31): a waiter
    // can act with a manager standing there without holding the power all shift.
    const opts = node.pin
      ? [["off", "Off"], ["on", "On"], ["pin", "On + PIN"]]
      : [["off", "Off"], ["on", "On"]];
    return (
      <div className="at-segs" role="radiogroup" aria-label={node.name}>
        {opts.map(([val, label]) => (
          <button key={val} role="radio" aria-checked={value === val}
            className={value === val ? "on" : ""} onClick={() => set(node, val)}>{label}</button>
        ))}
      </div>
    );
  }

  if (b.t === "choice") {
    return (
      <div className="at-segs wide" role="radiogroup" aria-label={node.name}>
        {(node.choices || []).map((c) => (
          <button key={c.value} role="radio" aria-checked={value === c.value} title={c.what}
            className={value === c.value ? "on" : ""} onClick={() => set(node, c.value)}>{c.label}</button>
        ))}
      </div>
    );
  }

  if (b.t === "limit") {
    return (
      <div className="at-segs" role="radiogroup" aria-label={node.name}>
        {(node.options || []).map((o) => (
          <button key={o} role="radio" aria-checked={Number(value) === o}
            className={Number(value) === o ? "on" : ""} onClick={() => set(node, o)}>{o}{node.unit}</button>
        ))}
      </div>
    );
  }

  if (b.t === "list") return <ListControl node={node} value={Array.isArray(value) ? value : []} set={set} />;
  if (b.t === "text") return <TextControl node={node} value={String(value ?? "")} set={set} />;
  if (b.t === "opt") {
    if (node.choices) {
      return (
        <div className="at-segs wide" role="radiogroup" aria-label={node.name}>
          {node.choices.map((c) => (
            <button key={c.value} role="radio" aria-checked={value === c.value}
              className={value === c.value ? "on" : ""} onClick={() => set(node, c.value)}>{c.label}</button>
          ))}
        </div>
      );
    }
    return (
      <button className={`acc2-toggle ${value ? "on" : ""}`} role="switch" aria-checked={!!value}
        aria-label={node.name} onClick={() => set(node, !value)}><span /></button>
    );
  }
  return null;
}

/** Multi-select chips. Refuses to empty the list in the UI too, so the user gets an
 *  immediate nudge instead of a server error they'd have to read. */
function ListControl({ node, value, set }: { node: Node; value: string[]; set: (n: Node, v: any) => void }) {
  const [nudge, setNudge] = useState("");
  const toggle = (val: string) => {
    const has = value.includes(val);
    const next = has ? value.filter((x) => x !== val) : [...value, val];
    if (!next.length) { setNudge(val); setTimeout(() => setNudge(""), 600); return; }
    set(node, next);
  };
  return (
    <div className="at-chips">
      {(node.choices || []).map((c) => {
        const on = value.includes(c.value);
        return (
          <button key={c.value} className={`${on ? "on" : ""} ${nudge === c.value ? "nudge" : ""}`}
            aria-pressed={on} onClick={() => toggle(c.value)}>
            <span className="box">{on ? <Icon n="check" s={11} /> : null}</span>{c.label}
          </button>
        );
      })}
      <span className="at-chips-note">{value.length === 1 ? "One only — the switcher is hidden on the menu" : `${value.length} — a switcher shows on the menu`}</span>
    </div>
  );
}

/** Text field that commits on blur / Enter, so we don't POST once per keystroke. */
function TextControl({ node, value, set }: { node: Node; value: string; set: (n: Node, v: any) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = () => { if (draft !== value) set(node, draft); };
  return (
    <input className="at-text" value={draft} placeholder={node.placeholder || ""} onChange={(e) => setDraft(e.target.value)}
      onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
}

function InfoSheet({ node, onClose }: { node: Node; onClose: () => void }) {
  // Registered with nothing to peel: this is a plain admin-desktop popover, and the admin
  // console is not one of the panels the back-button manager governs.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="at-sheet" role="dialog" aria-label={node.name} onClick={onClose}>
      <div className="at-sheet-b" onClick={(e) => e.stopPropagation()}>
        <h3>{node.name}</h3>
        <p>{node.what}</p>
        {node.choices?.length ? (
          <ul>{node.choices.map((c) => <li key={c.value}><b>{c.label}</b>{c.what ? ` — ${c.what}` : ""}</li>)}</ul>
        ) : null}
        {node.leftToBuild ? <p className="at-sheet-note">This one isn&apos;t built yet. The switch appears here the moment it is.</p> : null}
        <button className="adm-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function TreeStyle() {
  return <style jsx global>{`
  .at-head { display:flex; justify-content:flex-end; min-height:18px; margin:0 0 8px; }
  .at-count { font-size:11.5px; font-weight:800; color:var(--muted); background:var(--bg); border:var(--border); padding:5px 9px; border-radius:8px; white-space:nowrap; flex:none; font-variant-numeric:tabular-nums; }
  /* Tree indentation: a hairline guide per level, so a deep sub-option still reads as
     belonging to its parent instead of floating in a flat list. */
  .at-row { display:flex; flex-direction:column; gap:6px; }
  .at-row > .acc2-sw { align-items:flex-start; gap:14px; }
  .at-kids { display:flex; flex-direction:column; gap:6px; margin-left:14px; padding-left:12px; border-left:2px solid color-mix(in srgb, var(--accent) 22%, transparent); }
  .at-row.d1 > .acc2-sw { background:color-mix(in srgb, var(--card) 65%, var(--bg)); }
  .at-row.d2 > .acc2-sw, .at-row.d3 > .acc2-sw { background:transparent; border:var(--border); }
  .at-row .acc2-sw-b .nm { flex-wrap:wrap; }
  .at-tw { display:grid; place-items:center; width:20px; height:20px; margin-right:-2px; border:none; background:none; color:var(--muted); cursor:pointer; transition:transform .18s; flex:none; }
  .at-tw.o { transform:rotate(180deg); color:var(--accent); }
  .at-i { display:grid; place-items:center; width:20px; height:20px; border:none; background:none; color:var(--muted); cursor:pointer; flex:none; }
  .at-i:hover { color:var(--accent); }
  .at-tag { font-size:9px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; padding:2px 6px; border-radius:5px; }
  .at-tag.build { background:color-mix(in srgb,var(--adm-warn) 18%,transparent); color:var(--adm-warn); border:1px solid color-mix(in srgb,var(--adm-warn) 34%,transparent); }
  .at-tag.new { background:color-mix(in srgb,var(--accent) 16%,transparent); color:var(--accent); border:1px solid color-mix(in srgb,var(--accent) 32%,transparent); }
  .at-link { display:inline-flex; align-items:center; gap:6px; margin-top:6px; font-size:12px; font-weight:700; color:var(--accent); text-decoration:none; }
  .at-link:hover { text-decoration:underline; }
  .at-segs { display:flex; gap:3px; background:var(--card); border:var(--border); border-radius:9px; padding:3px; flex:none; }
  .at-segs button { min-height:32px; padding:0 11px; border:none; border-radius:7px; background:transparent; color:var(--muted); font-weight:700; font-size:12px; cursor:pointer; white-space:nowrap; }
  .at-segs button.on { background:var(--accent); color:#fff; }
  .at-segs.wide { flex-wrap:wrap; max-width:340px; justify-content:flex-end; }
  .at-chips { display:flex; flex-wrap:wrap; gap:6px; justify-content:flex-end; max-width:360px; flex:none; }
  .at-chips button { display:flex; align-items:center; gap:7px; min-height:32px; padding:0 10px; border-radius:9px; border:var(--border); background:var(--card); color:var(--muted); font-weight:650; font-size:12px; cursor:pointer; }
  .at-chips button .box { width:15px; height:15px; border-radius:4px; border:1.5px solid var(--muted); display:grid; place-items:center; color:transparent; flex:none; }
  .at-chips button.on { border-color:var(--accent); background:color-mix(in srgb,var(--accent) 12%,transparent); color:var(--text); }
  .at-chips button.on .box { background:var(--accent); border-color:var(--accent); color:#fff; }
  /* A tap that can't be honoured still SAYS so — never a silent no-op (owner rule). */
  .at-chips button.nudge { animation:atNudge .5s ease; border-color:var(--adm-danger); }
  @keyframes atNudge { 0%,100% { transform:translateX(0); } 20% { transform:translateX(-4px); } 60% { transform:translateX(4px); } }
  .at-chips-note { width:100%; text-align:right; font-size:11px; color:var(--muted); }
  .at-text { height:34px; min-width:210px; border-radius:9px; border:var(--border); background:var(--card); color:var(--text); font-size:13px; font-weight:600; padding:0 10px; flex:none; }
  .at-sheet { position:fixed; inset:0; z-index:120; background:rgba(0,0,0,.5); display:grid; place-items:center; padding:20px; }
  .at-sheet-b { background:var(--card); border:var(--border); border-radius:16px; padding:22px; max-width:520px; width:100%; max-height:80dvh; overflow-y:auto; }
  .at-sheet-b h3 { margin:0 0 8px; font-size:17px; font-weight:800; }
  .at-sheet-b p { margin:0 0 12px; font-size:13.5px; line-height:1.6; color:var(--muted); }
  .at-sheet-b ul { margin:0 0 14px; padding-left:18px; font-size:13px; line-height:1.7; color:var(--muted); }
  .at-sheet-b ul b { color:var(--text); }
  .at-sheet-note { color:var(--adm-warn) !important; font-weight:600; }
  @media (max-width:640px) {
    .at-row > .acc2-sw { flex-direction:column; }
    .at-segs.wide, .at-chips { max-width:100%; justify-content:flex-start; }
    .at-chips-note { text-align:left; }
    .at-text { min-width:0; width:100%; }
    .at-kids { margin-left:6px; padding-left:9px; }
  }
  `}</style>;
}
