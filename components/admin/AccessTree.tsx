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
  SECTIONS, ALL_NODES, NODE_BY_ID, SECTION_BY_ID, nodeValue, nodePatch, extraPatch, applyPatch,
  type Node, type Section, type TreeState, type TreePatch,
} from "@/lib/accessTree";
import AccessSearch from "./AccessSearch";

const ICON: Record<string, string> = {
  sparkles: "M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 010 7.8",
  crown: "M3 18h18M4 15L2 7l5.5 4L12 4l4.5 7L22 7l-2 8z",
  user: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8",
  // "Staff apps" asked for this and it did not exist, so that section wore an EMPTY chip while
  // every other section had its glyph (owner spotted it, 2026-07-31). Four panes, which is also
  // literally what the section counts — the four staff apps.
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  info: "M12 22a10 10 0 100-20 10 10 0 000 20M12 16v-5M12 8h.01",
  chevron: "M6 9l6 6 6-6", check: "M20 6L9 17l-5-5", link: "M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1",
  // Drawn when a name has no glyph. An unknown name used to render NOTHING, so a typo or a new
  // section shipped a blank square that looked deliberate — the failure was invisible, which is
  // the only reason it survived. A visible placeholder makes the gap obvious the first time.
  unknown: "M5 5h14v14H5z",
};
const Icon = ({ n, s = 16 }: { n: string; s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.85}
    strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }} aria-hidden="true">
    {(ICON[n] || ICON.unknown).split("M").filter(Boolean).map((d, i) => <path key={i} d={"M" + d} />)}
  </svg>
);

/**
 * Where does this row live? Returns its section and the chain of groups above it, so landing on a
 * row can open exactly that one path. Built by walking the model, which is the only thing that
 * actually knows — the alternative was opening every section and hoping, which is what the owner
 * saw as "every dropdown is open".
 */
const NODE_PATH: Record<string, { sectionId: string; ancestorIds: string[] }> = (() => {
  const out: Record<string, { sectionId: string; ancestorIds: string[] }> = {};
  const walk = (nodes: Node[], sectionId: string, trail: string[]) => {
    for (const n of nodes) {
      out[n.id] = { sectionId, ancestorIds: trail };
      if (n.children?.length) walk(n.children, sectionId, [...trail, n.id]);
    }
  };
  for (const s of SECTIONS) walk(s.children, s.id, []);
  return out;
})();
const locateNode = (id: string) => NODE_PATH[id] || null;

/** "Main features › Menu › Format" — so the sheet says WHERE the setting you're reading lives. */
function readablePath(nodeId: string): string {
  const p = NODE_PATH[nodeId];
  if (!p) return "";
  const names = [SECTION_BY_ID[p.sectionId]?.name, ...p.ancestorIds.map((a) => NODE_BY_ID[a]?.name)];
  return names.filter(Boolean).join(" › ");
}

/**
 * Which picture shows this setting? The help images are real screenshots of the panel with the
 * control ringed (scripts/shot-access-help.mjs, public/admin-help/<id>.png). Names were written by
 * hand over time, so try the row's id, its stored key, and the dash spellings, then fall back to
 * the picture of the AREA the setting lives in — a shot of the right screen beats no shot at all.
 * A name that has no file is simply skipped by the <img> onError, so a missing picture costs
 * nothing and never shows a broken image.
 */
function helpImages(node: Node, sectionId?: string): string[] {
  const b = node.bind as { key?: string; flag?: string };
  const raw = [node.id, b?.key, b?.flag].filter(Boolean) as string[];
  const spellings = raw.flatMap((r) => [r, r.replace(/_/g, "-"), r.replace(/-/g, "_")]);
  const area: Record<string, string> = {
    main: "guest-menu", apps: "manager-menu", mgrMenu: "manager-menu",
    ownMenu: "owner-home", defaults: "manager-menu",
  };
  const fallback = sectionId ? area[sectionId] : undefined;
  return [...new Set([...spellings, ...(fallback ? [fallback] : [])])].map((n) => `/admin-help/${n}.png`);
}

/** "On by default" / "Off by default" / the default value, in words. */
function defaultLine(node: Node): string {
  const d = node.def;
  if (d === undefined) return "";
  if (d === true) return "On by default.";
  if (d === false) return "Off by default.";
  if (Array.isArray(d)) return d.length ? `By default: ${d.join(", ")}.` : "Nothing chosen by default.";
  if (d === "off") return "Off by default.";
  return `By default: ${String(d)}.`;
}

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
  // CLOSED by default (owner, 2026-07-31: "by default dropdown should be close"). Each header
  // carries a counter, so you can see what a section holds without opening it.
  const [openSec, setOpenSec] = useState<Record<string, boolean>>({});
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

  /**
   * Save an API key. Deliberately NOT `save()`: that merges the patch into local state for an
   * instant repaint, which for a credential would put the real key into the page and show it back.
   * This posts it and then RELOADS, so the only thing on screen is the masked hint the server
   * computed — the key goes one way.
   */
  const setCreds = useCallback((key: string, value: string | null) => {
    setSaving("saving");
    fetch("/api/admin/restaurants/access-tree", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurant_id: rid, patch: { creds: { [key]: value } } }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setErr(j.error || "That key didn't save."); setSaving("err"); return;
        }
        setErr(""); setSaving("saved");
        load(rid);
        setTimeout(() => setSaving(""), 1400);
      })
      .catch(() => { setSaving("err"); setErr("That key didn't save — the connection dropped."); });
  }, [rid, load]);

  // Every control calls this. A credential is routed to the write-only path above, so the control
  // itself stays an ordinary input and there is exactly ONE place that knows keys are different.
  const set = useCallback((n: Node, v: any) => {
    if (n.bind.t === "creds") return setCreds(n.bind.key, v as string | null);
    save(applyTwo(nodePatch(n, v), extraPatch(n, v)));
  }, [save, setCreds]);

  // DEEP LINK — ?focus=<key>. The staff panels' "zones off for staff" popovers send a
  // "⚙ change" link carrying a manager-power flag, a tablet_* column, an owner section or a
  // guest feature slug; it must land on the EXACT row, not just the page. Rebuilding this
  // screen dropped it, so every one of those links became "here's the page, find it yourself"
  // (found by the whole-app sweep). Matched against each node's storage key, opened, scrolled
  // to and ringed for ~2s. Consumed once per load.
  const [flashId, setFlashId] = useState("");
  const [hint, setHint] = useState("");

  // ONE way to land on a row, shared by the ?focus= deep link and the search bar. Opens the
  // section (and any collapsed group above the row), waits for it to exist, scrolls it to the
  // middle and rings it. Written once so the two entry points can't drift apart.
  const jumpTo = useCallback((nodeId: string, sectionId?: string, ancestorIds: string[] = []) => {
    // Open ONLY the section holding the row. This used to fall back to opening EVERY section when
    // no section was named ("the row may be anywhere"), so following a "change this" link from
    // anywhere else in the admin flung all six open at once and you had to close them by hand
    // (owner, 2026-07-31: "every dropdown is open — make sure every dropdown is closed"). The
    // section never had to be guessed: the model knows where every row lives, so look it up.
    const found = sectionId && ancestorIds.length ? { sectionId, ancestorIds } : locateNode(nodeId);
    const sec = found?.sectionId ?? sectionId;
    const anc = found?.ancestorIds ?? ancestorIds;
    if (sec) setOpenSec((s) => ({ ...s, [sec]: true }));
    ancestorIds = anc;
    if (ancestorIds.length) {
      setOpenNode((s) => { const n = { ...s }; for (const id of ancestorIds) n[id] = true; return n; });
    }
    let tries = 0;
    const locate = () => {
      const el = document.querySelector<HTMLElement>(`[data-node="${CSS.escape(nodeId)}"]`);
      if (!el && tries++ < 14) return void setTimeout(locate, 120);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashId(nodeId);
      setTimeout(() => setFlashId(""), 2200);
    };
    setTimeout(locate, 150);
  }, []);

  const focusDone = useRef(false);
  useEffect(() => {
    if (!st || focusDone.current) return;
    const key = new URLSearchParams(window.location.search).get("focus");
    if (!key) { focusDone.current = true; return; }
    focusDone.current = true;
    const hit = ALL_NODES.find((n) => {
      const b: any = n.bind;
      return n.id === key || b.key === key || b.flag === key || (b.t === "module" && `${b.key}_allowed` === key);
    });
    if (hit) jumpTo(hit.id);          // jumpTo looks the section up itself — see locateNode
  }, [st, jumpTo]);

  if (err && !st) return <div className="acc2-warn"><Icon n="info" s={17} /><div>{err}</div></div>;
  if (!st) return <div className="adm-muted" style={{ padding: 28, textAlign: "center" }}>Loading…</div>;

  return (
    <>
      <TreeStyle />
      <div className="at-head">
        <AccessSearch
          isOn={(n) => isOn(n, st)}
          onPick={(nodeId, sectionId, ancestorIds, blockedBy) => {
            // A row whose parent is off is REMOVED from the page (rule 1), so there is nothing
            // to scroll to. Say what has to come on first and land on THAT switch instead of
            // pretending to navigate somewhere.
            if (blockedBy) {
              setHint(`“${blockedBy.name}” is switched off, so that setting isn’t on the page yet — turn it on here first.`);
              const upto = ancestorIds.indexOf(blockedBy.id);
              jumpTo(blockedBy.id, sectionId, upto > 0 ? ancestorIds.slice(0, upto) : []);
              return;
            }
            setHint("");
            jumpTo(nodeId, sectionId, ancestorIds);
          }}
        />
        <span className={`acc2-save ${saving}`}>
          {saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : saving === "err" ? "Not saved" : ""}
        </span>
      </div>
      {err ? <div className="acc2-warn"><Icon n="info" s={17} /><div>{err}</div></div> : null}
      {hint ? (
        <div className="acc2-warn"><Icon n="info" s={17} /><div>{hint}</div>
          <button className="at-hint-x" onClick={() => setHint("")} aria-label="Dismiss">×</button>
        </div>
      ) : null}

      <div className="acc2-main">
        {SECTIONS.map((sec) => (
          <SectionCard
            key={sec.id} sec={sec} st={st} open={!!openSec[sec.id]}
            onToggle={() => setOpenSec((s) => ({ ...s, [sec.id]: !s[sec.id] }))}
            openNode={openNode} setOpenNode={setOpenNode} set={set} onInfo={setInfo} flashId={flashId}
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

function SectionCard({ sec, st, open, onToggle, openNode, setOpenNode, set, onInfo, flashId }: {
  sec: Section; st: TreeState; open: boolean; onToggle: () => void;
  openNode: Record<string, boolean>; setOpenNode: (f: (s: Record<string, boolean>) => Record<string, boolean>) => void;
  set: (n: Node, v: any) => void; onInfo: (n: Node) => void; flashId?: string;
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
        {switchable.length ? (
          <span className={`at-count ${on === switchable.length ? "all" : ""}`}>
            {on === switchable.length ? "All" : `${on}/${switchable.length}`}
          </span>
        ) : null}
        <span className={`acc2-chev ${open ? "o" : ""}`}><Icon n="chevron" s={18} /></span>
      </button>
      {open ? (
        <div className="acc2-body">
          {sec.children.map((n) => (
            <Row key={n.id} node={n} st={st} depth={0} openNode={openNode} setOpenNode={setOpenNode} set={set} onInfo={onInfo} flashId={flashId} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Row({ node, st, depth, openNode, setOpenNode, set, onInfo, flashId }: {
  node: Node; st: TreeState; depth: number;
  openNode: Record<string, boolean>; setOpenNode: (f: (s: Record<string, boolean>) => Record<string, boolean>) => void;
  set: (n: Node, v: any) => void; onInfo: (n: Node) => void; flashId?: string;
}) {
  const v = nodeValue(node, st);
  const kids = node.children || [];
  // RULE 1: children of an OFF row are removed, never greyed. A pure group (bind "none")
  // has nothing to switch, so its children always show.
  const showKids = kids.length > 0 && isOn(node, st);
  // Groups with a lot inside collapse; a row with 1-2 children just shows them.
  const collapsible = showKids && kids.length > 2;
  const expanded = collapsible ? openNode[node.id] !== false : true;
  // Pick-one settings that carry a description per choice read far better stacked.
  const stacked = (node.bind.t === "choice" || (node.bind.t === "opt" && !!node.choices)) && (node.choices || []).length > 0;

  return (
    <div className={`at-box d${Math.min(depth, 3)} ${flashId === node.id ? "at-flash" : ""}`} data-node={node.id}>
      <div className="at-box-h">
        <div className="at-box-t">
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
        {stacked ? null : <Control node={node} value={v} set={set} />}
      </div>

      {/* A pick-one setting gets its choices as full-width ROWS, not a segmented control squeezed
          into the corner (owner, 2026-07-31, pointing at the Google-review picker: "see this one
          rating, how aesthetic it looks"). Three long labels — "Both — Google after the menu one" —
          never fit on the right, and the description of each choice had nowhere to go but a
          tooltip. Now each option is a row: radio, its name, and what it actually does. */}
      {stacked ? <ChoiceRows node={node} value={v} set={set} /> : null}

      {showKids && expanded ? (
        <div className="at-box-k">
          <Kids nodes={kids} st={st} depth={depth + 1} openNode={openNode} setOpenNode={setOpenNode} set={set} onInfo={onInfo} flashId={flashId} />
        </div>
      ) : null}
    </div>
  );
}

/** Should this row be one of the compact boxes in a grid, or a full-width block?
 *
 *  DEPTH decides, not whether it happens to have children (owner, 2026-07-31: "dining sessions
 *  is a whole big feature — why is there a box which is just an on/off? It should be like the
 *  whole thing, even though it doesn't have sub options"). Dining sessions sits at the same
 *  level as Ratings and Allergy & notes; those two got a full-width block only because they
 *  own sub-options, which made a major feature look like a minor tick-box next to them.
 *
 *  So: a feature directly under a master feature (depth 0-1) is ALWAYS a full-width block. Only
 *  the deep leaf options — "Add a new dish", "Guest can write their own note" — become the
 *  compact grid boxes, which is exactly where they read well. */
const chipable = (n: Node, depth: number) =>
  depth >= 2 && !(n.children || []).length && !n.leftToBuild
  && (isBoolBind(n) || (n.bind.t === "opt" && !n.choices));

/** Lay a row's children out the way the owner asked for: the simple on/off ones as a GRID OF
 *  BOXES ("see the blue box inside the box for sub edit — make sure all have box like that"),
 *  everything else full width underneath. Consecutive chipable children are grouped into one
 *  grid so the ORDER the owner specified is preserved — a chip never jumps above a row that
 *  was listed before it. */
function Kids({ nodes, st, depth, openNode, setOpenNode, set, onInfo, flashId }: {
  nodes: Node[]; st: TreeState; depth: number;
  openNode: Record<string, boolean>; setOpenNode: (f: (s: Record<string, boolean>) => Record<string, boolean>) => void;
  set: (n: Node, v: any) => void; onInfo: (n: Node) => void; flashId?: string;
}) {
  const out: React.ReactNode[] = [];
  let run: Node[] = [];
  const flush = () => {
    if (!run.length) return;
    out.push(
      <div className="at-grid" key={`grid-${out.length}`}>
        {run.map((n) => <Chip key={n.id} node={n} st={st} depth={depth} set={set} onInfo={onInfo} flashId={flashId} />)}
      </div>,
    );
    run = [];
  };
  for (const n of nodes) {
    if (chipable(n, depth)) { run.push(n); continue; }
    flush();
    out.push(<Row key={n.id} node={n} st={st} depth={depth} openNode={openNode} setOpenNode={setOpenNode} set={set} onInfo={onInfo} flashId={flashId} />);
  }
  flush();
  return <>{out}</>;
}

/** One compact setting box. The WHOLE box is the switch — a much bigger target than a 34px
 *  toggle, which matters on the phone the owner tests on. The (i) sits outside that target so
 *  reading about a setting can never flip it by accident. */
function Chip({ node, st, depth, set, onInfo, flashId }: {
  node: Node; st: TreeState; depth: number; set: (n: Node, v: any) => void; onInfo: (n: Node) => void; flashId?: string;
}) {
  const on = nodeValue(node, st) === true;
  return (
    <div className={`at-chip d${Math.min(depth, 3)} ${on ? "on" : ""} ${flashId === node.id ? "at-flash" : ""}`} data-node={node.id}>
      <button className="at-chip-hit" role="switch" aria-checked={on} aria-label={node.name}
        onClick={() => set(node, !on)}>
        <span className="at-cbox">{on ? <Icon n="check" s={12} /> : null}</span>
        <span className="at-cnm">{node.name}</span>
      </button>
      <button className="at-i" onClick={() => onInfo(node)} aria-label={`What is ${node.name}?`}><Icon n="info" s={13} /></button>
    </div>
  );
}

/** A pick-one setting as full-width rows: radio, name, and what that choice does. The chosen
 *  row is outlined and tinted in the level's colour so the answer is readable at a glance. */
function ChoiceRows({ node, value, set }: { node: Node; value: any; set: (n: Node, v: any) => void }) {
  return (
    <div className="at-opts" role="radiogroup" aria-label={node.name}>
      {(node.choices || []).map((c) => {
        const on = value === c.value;
        return (
          <button key={c.value} role="radio" aria-checked={on} className={`at-opt ${on ? "on" : ""}`}
            onClick={() => set(node, c.value)}>
            <span className="at-radio" aria-hidden="true" />
            <span className="at-opt-t">
              <span className="at-opt-n">{c.label}</span>
              {c.what ? <span className="at-opt-d">{c.what}</span> : null}
            </span>
          </button>
        );
      })}
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
  if (b.t === "creds") return <CredsControl node={node} hint={String(value ?? "")} set={set} />;
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

/**
 * One delivery channel's API key (Zomato, Swiggy, the restaurant's own website).
 *
 * `hint` is all the server will ever say about a stored key — "" or "••••1234". The box starts
 * EMPTY even when a key is stored, because the stored one is not available to prefill and pretending
 * otherwise (showing dots in the input) would make "save" look like it re-saved something. Leaving
 * it empty and pressing nothing changes nothing; that is why a key can't be lost by editing a
 * neighbouring setting.
 */
function CredsControl({ node, hint, set }: { node: Node; hint: string; set: (n: Node, v: any) => void }) {
  const [draft, setDraft] = useState("");
  const [show, setShow] = useState(false);
  const stored = !!hint;
  return (
    <div className="at-creds">
      <div className="at-creds-row">
        <input className="at-text" type={show ? "text" : "password"} value={draft} autoComplete="off"
          placeholder={node.placeholder || (stored ? "Enter a new key to replace it" : "Paste the key")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { set(node, draft.trim()); setDraft(""); } }} />
        {draft ? (
          <button className="at-creds-eye" type="button" onClick={() => setShow((v) => !v)}
            title={show ? "Hide what you typed" : "Show what you typed"}>{show ? "Hide" : "Show"}</button>
        ) : null}
        <button className="adm-btn primary at-creds-save" type="button" disabled={!draft.trim()}
          onClick={() => { set(node, draft.trim()); setDraft(""); }}>Save</button>
      </div>
      <div className="at-creds-state">
        {stored ? (
          <>
            <span className="at-creds-ok">Connected · key ending {hint.replace(/[^0-9a-z]/gi, "").slice(-4)}</span>
            <button className="at-creds-rm" type="button"
              onClick={() => { if (confirm(`Remove the ${node.name}? Orders from that channel stop arriving until a new key is saved.`)) set(node, null); }}>
              Remove
            </button>
          </>
        ) : <span className="at-creds-no">Not connected — no key saved yet</span>}
      </div>
    </div>
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
  // The picture. Candidates are tried in order and a name with no file is skipped by onError, so a
  // setting with no screenshot yet shows the sheet without one instead of a broken image.
  const [shot, setShot] = useState(0);
  const [more, setMore] = useState(false);
  const path = readablePath(node.id);
  const imgs = helpImages(node, NODE_PATH[node.id]?.sectionId);
  const src = imgs[shot];
  const kids = node.children || [];
  const def = defaultLine(node);
  return (
    <div className="at-sheet" role="dialog" aria-label={node.name} onClick={onClose}>
      <div className="at-sheet-b" onClick={(e) => e.stopPropagation()}>
        <h3>{node.name}</h3>
        {path ? <div className="at-sheet-path">{path}</div> : null}
        {/* A real screenshot of the screen this setting controls, with the control ringed. The
            owner asked for it back: "an (i) button should work like it used to — full screenshot,
            highlight the feature". lazy + a static /public file, so an unopened sheet costs
            nothing. See scripts/shot-access-help.mjs to re-capture. */}
        {src ? (
          <img className="at-sheet-shot" src={src} alt={`Where ${node.name} appears`} loading="lazy"
            onError={() => setShot((i) => i + 1)} />
        ) : null}
        <p>{node.what}</p>
        {def ? <p className="at-sheet-def">{def}</p> : null}
        {node.choices?.length ? (
          <ul>{node.choices.map((c) => <li key={c.value}><b>{c.label}</b>{c.what ? ` — ${c.what}` : ""}</li>)}</ul>
        ) : null}
        {/* SHOW MORE — the owner wanted the short version first and "in detail for all option sub
            option" behind one press. Everything below is read from the model itself (each
            sub-option's own explanation, its default, its own sub-options), so this can never
            describe a setting the app doesn't have. */}
        {kids.length ? (
          <>
            <button className="at-sheet-more" onClick={() => setMore((v) => !v)} aria-expanded={more}>
              {more ? "Show less" : `Show more — what each of the ${kids.length} option${kids.length > 1 ? "s" : ""} does`}
            </button>
            {more ? <div className="at-sheet-deep">{kids.map((k) => <DeepHelp key={k.id} node={k} depth={0} />)}</div> : null}
          </>
        ) : null}
        {node.leftToBuild ? <p className="at-sheet-note">This one isn&apos;t built yet. The switch appears here the moment it is.</p> : null}
        <button className="adm-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

/** One sub-option inside "Show more", and its own sub-options under it, as deep as the model goes. */
function DeepHelp({ node, depth }: { node: Node; depth: number }) {
  const def = defaultLine(node);
  const kids = node.children || [];
  return (
    <div className="at-dh" style={{ marginLeft: depth * 14 }}>
      <div className="at-dh-n">{node.name}{node.leftToBuild ? <span className="at-dh-tbd">not built yet</span> : null}</div>
      {node.what ? <div className="at-dh-w">{node.what}</div> : null}
      {def ? <div className="at-dh-d">{def}</div> : null}
      {node.choices?.length ? (
        <ul className="at-dh-c">{node.choices.map((c) => <li key={c.value}><b>{c.label}</b>{c.what ? ` — ${c.what}` : ""}</li>)}</ul>
      ) : null}
      {kids.map((k) => <DeepHelp key={k.id} node={k} depth={depth + 1} />)}
    </div>
  );
}

function TreeStyle() {
  return <style jsx global>{`
  /* HOVER FOLLOWS THE BOX'S OWN COLOUR. The owner's "make it red" (2026-07-31) was about the
     PRIMARY FEATURE BOX's border — the outline round "Main features" — not about hover, and he
     corrected this the same day: "there was not a hover colour, the colour was for the primary
     feature box". A red hover on top of the level colours also put three colours in play on one
     row. Hover now just brightens the colour the box already wears, so it says "your pointer is
     here" without inventing a second meaning. --lvl is set per level below; the fallback covers
     the section header, which has no level of its own. */
  .at-box, .at-chip, .at-opt, .at-tw { --hov: var(--lvl, var(--accent)); }
  .acc2-main, .at-head { --hov: var(--accent); }
  .at-head { display:flex; align-items:center; gap:12px; flex-wrap:wrap; min-height:38px; margin:0 0 10px; }
  .at-head .acc2-save { margin-left:auto; }
  .at-hint-x { margin-left:auto; background:none; border:0; color:inherit; opacity:.6; cursor:pointer; font-size:19px; line-height:1; }
  .at-hint-x:hover { opacity:1; }
  /* LANDING BLINK — the owner asked for the phone-Settings behaviour: arriving at a setting
     should "light that setting once, kinda blink thing". Two quick pulses of the accent, then
     it settles, so your eye is pulled to the row without a colour that stays and confuses. */
  .at-flash { animation: atBlink 1.6s ease-out 1; }
  @keyframes atBlink {
    0%, 100% { background:transparent; box-shadow:0 0 0 0 transparent; }
    10%, 40%  { background:color-mix(in srgb, var(--accent) 20%, transparent); box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 62%, transparent); }
    25%, 55%  { background:transparent; box-shadow:0 0 0 3px transparent; }
  }
  .at-count { font-size:11.5px; font-weight:800; color:var(--muted); background:var(--bg); border:var(--border); padding:5px 9px; border-radius:8px; white-space:nowrap; flex:none; font-variant-numeric:tabular-nums; }
  .at-count.all { color:#34d399; border-color:color-mix(in srgb,#34d399 42%,transparent); background:color-mix(in srgb,#34d399 12%,transparent); }

  /* ── BOXES (owner, 2026-07-31: "make sure all have box like that, well structured") ────────
     Every setting is a box, and a setting's sub-settings are boxes INSIDE its box, so the
     nesting is visible as containment instead of an indent guide you have to trace. */
  /* ── LEVEL COLOURS (owner, 2026-07-31: "blue, green, blue, green … according to theme") ────
     Nesting is shown by COLOUR as well as containment, so at a glance you can tell a feature
     from its sub-option from ITS sub-option. One variable per level and everything inherits it:
       depth 0  master feature (Menu, Takeaway, Payroll…)      ROSE
       depth 1  a feature inside it (Dining sessions, Ratings) GREEN
       depth 2  its options (Add a dish, Guest's own note)     BLUE
       depth 3  deeper still                                   GREEN

     The PRIMARY box is rose, not blue (owner, 2026-07-31: change the primary feature box's colour
     to "not the actual red — like pink type, it should match the theme"). Rose-400 and not a true
     red because true red means DANGER everywhere else in this panel (--adm-danger), and a master
     feature being switched on is not a warning. It also stops the primary box sharing the blue of
     its own depth-2 grandchildren, which was the thing that made the nesting hard to read. */
  .at-box.d0, .at-chip.d0 { --lvl: #fb7185; }
  .at-box.d1, .at-chip.d1 { --lvl: #34d399; }
  .at-box.d2, .at-chip.d2 { --lvl: var(--accent); }
  .at-box.d3, .at-chip.d3 { --lvl: #34d399; }

  .at-box { border:1.5px solid color-mix(in srgb, var(--lvl) 30%, transparent); border-radius:14px;
    background:color-mix(in srgb, var(--lvl) 5%, color-mix(in srgb, var(--card) 78%, var(--bg))); padding:13px 14px; }
  .at-box + .at-box, .at-box + .at-grid, .at-grid + .at-box { margin-top:9px; }
  .at-box:hover { border-color:color-mix(in srgb, var(--hov) 42%, transparent); }
  .at-box-h { display:flex; align-items:flex-start; gap:14px; }
  .at-box-t { flex:1; min-width:0; }
  .at-box-t .nm { display:flex; align-items:center; gap:7px; flex-wrap:wrap; font-size:14.5px; font-weight:750; }
  .at-box-t .ds { margin-top:4px; font-size:12.5px; line-height:1.55; color:var(--muted); max-width:74ch; }
  /* The divider that separates a feature from the things inside it, tinted to its own level. */
  .at-box-k { margin-top:12px; padding-top:12px; border-top:1px solid color-mix(in srgb, var(--lvl) 22%, transparent); }

  /* Pick-one rows (the Google-review picker's shape, which the owner called aesthetic). */
  .at-opts { display:flex; flex-direction:column; gap:7px; margin-top:11px; }
  .at-opt { display:flex; align-items:flex-start; gap:11px; width:100%; text-align:left; cursor:pointer;
    padding:11px 13px; border-radius:12px; border:1.5px solid color-mix(in srgb, var(--lvl) 20%, transparent);
    background:color-mix(in srgb, var(--card) 55%, var(--bg)); color:inherit; font:inherit;
    transition:border-color .15s, background .15s; }
  .at-opt.on { border-color:color-mix(in srgb, var(--lvl) 66%, transparent); background:color-mix(in srgb, var(--lvl) 12%, transparent); }
  .at-opt:hover { border-color:color-mix(in srgb, var(--hov) 66%, transparent); background:color-mix(in srgb, var(--hov) 12%, transparent); }
  .at-opt:focus-visible { outline:2px solid var(--lvl); outline-offset:2px; }
  .at-radio { flex:none; width:16px; height:16px; margin-top:2px; border-radius:50%;
    border:1.7px solid var(--muted); display:grid; place-items:center; transition:border-color .15s; }
  .at-opt.on .at-radio { border-color:var(--lvl); box-shadow:inset 0 0 0 4px var(--lvl); }
  .at-opt-t { display:flex; flex-direction:column; gap:3px; min-width:0; }
  .at-opt-n { font-size:13.5px; font-weight:700; }
  .at-opt-d { font-size:12px; line-height:1.5; color:var(--muted); }

  /* The grid of compact option boxes — 1 per row on a phone, filling out on wider screens. */
  .at-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(212px, 1fr)); gap:8px; }
  .at-chip { display:flex; align-items:center; gap:2px; border:1.5px solid color-mix(in srgb, var(--lvl) 26%, transparent);
    border-radius:12px; background:color-mix(in srgb, var(--card) 60%, var(--bg)); padding-right:4px; transition:border-color .15s, background .15s; }
  .at-chip.on { border-color:color-mix(in srgb, var(--lvl) 62%, transparent); background:color-mix(in srgb, var(--lvl) 14%, transparent); }
  .at-chip.on .at-cbox { background:var(--lvl); border-color:var(--lvl); }
  .at-chip:hover { border-color:color-mix(in srgb, var(--hov) 70%, transparent); background:color-mix(in srgb, var(--hov) 13%, transparent); }
  .at-chip:hover .at-cnm { color:var(--text); }
  /* The whole box is the switch: a far bigger target than a 34px toggle, which is what makes
     this reliable with a thumb on the 360px phone the owner actually uses. */
  .at-chip-hit { flex:1; min-width:0; display:flex; align-items:center; gap:9px; background:none; border:0;
    color:inherit; font:inherit; cursor:pointer; padding:11px 4px 11px 11px; text-align:left; border-radius:10px; }
  .at-cbox { flex:none; width:17px; height:17px; border-radius:5px; border:1.7px solid var(--muted);
    display:grid; place-items:center; color:transparent; transition:background .15s, border-color .15s; }
  .at-chip.on .at-cbox { color:#fff; }
  .at-cnm { font-size:13px; font-weight:650; line-height:1.35; }
  /* Keyboard users must be able to SEE which box they are on before they press space — without
     this the whole grid is invisible to a tab-through, which is a silent tap in a different form. */
  .at-chip-hit:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .at-chip:has(.at-chip-hit:focus-visible) { border-color:var(--accent); }
  .at-chip.on .at-cnm { color:var(--text); }
  .at-tw { display:grid; place-items:center; width:20px; height:20px; margin-right:-2px; border:none; background:none; color:var(--muted); cursor:pointer; transition:transform .18s; flex:none; }
  .at-tw.o { transform:rotate(180deg); color:var(--accent); }
  .at-tw:hover { color:var(--hov); }
  .at-i { display:grid; place-items:center; width:20px; height:20px; border:none; background:none; color:var(--muted); cursor:pointer; flex:none; }
  .at-i:hover { color:var(--hov); }
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
  /* (i) SHEET: path line, screenshot, and the "show more" detail (owner, 2026-07-31 — he wanted the
     screenshot back, a short plain line first, and every sub-option explained behind one press). */
  .at-sheet-path { font-size:11.5px; font-weight:700; letter-spacing:.02em; color:var(--muted); opacity:.85; margin:-2px 0 11px; }
  .at-sheet-shot { display:block; width:100%; height:auto; border-radius:11px; border:1px solid color-mix(in srgb, var(--accent) 26%, transparent);
    margin:0 0 13px; background:var(--bg); }
  .at-sheet-def { font-size:12.5px !important; font-weight:600; color:var(--text) !important; opacity:.72; margin:-6px 0 12px !important; }
  .at-sheet-more { display:block; width:100%; text-align:left; background:color-mix(in srgb, var(--accent) 9%, transparent);
    border:1px solid color-mix(in srgb, var(--accent) 30%, transparent); color:var(--text); font-size:12.5px; font-weight:700;
    padding:9px 12px; border-radius:10px; cursor:pointer; margin:0 0 12px; }
  .at-sheet-more:hover { background:color-mix(in srgb, var(--accent) 16%, transparent); }
  .at-sheet-deep { margin:0 0 14px; }
  .at-dh { padding:9px 0 2px; border-top:1px solid color-mix(in srgb, var(--muted) 16%, transparent); }
  .at-dh-n { font-size:13px; font-weight:800; margin-bottom:3px; display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
  .at-dh-tbd { font-size:10.5px; font-weight:700; color:var(--adm-warn); border:1px solid color-mix(in srgb, var(--adm-warn) 45%, transparent);
    padding:1px 6px; border-radius:6px; }
  .at-dh-w { font-size:12.5px; line-height:1.6; color:var(--muted); }
  .at-dh-d { font-size:11.5px; font-weight:600; color:var(--muted); opacity:.8; margin-top:3px; }
  .at-dh-c { margin:5px 0 0 !important; padding-left:16px !important; font-size:12px !important; }
  /* API KEY per channel (owner, 2026-07-31: Zomato / Swiggy / takeaway need "a link option to add
     an API key"). The key goes one way — the box is empty even when a key is stored, because the
     stored one is never sent back; only "connected · ending 1234" is. */
  .at-creds { display:flex; flex-direction:column; gap:6px; min-width:0; width:100%; }
  .at-creds-row { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
  .at-creds-row .at-text { flex:1; min-width:150px; }
  .at-creds-save { font-size:12px; padding:7px 13px; }
  .at-creds-save:disabled { opacity:.45; cursor:not-allowed; }
  .at-creds-eye { background:none; border:0; color:var(--muted); font-size:11.5px; font-weight:700; cursor:pointer; padding:2px 4px; }
  .at-creds-eye:hover { color:var(--text); }
  .at-creds-state { display:flex; align-items:center; gap:10px; font-size:11.5px; font-weight:600; flex-wrap:wrap; }
  .at-creds-ok { color:var(--adm-ok, #34d399); }
  .at-creds-no { color:var(--muted); opacity:.85; }
  .at-creds-rm { background:none; border:0; color:var(--adm-danger, #f87171); font-size:11.5px; font-weight:700; cursor:pointer; padding:0; text-decoration:underline; }
  @media (max-width:640px) {
    .at-box { padding:11px; border-radius:12px; }
    .at-box-h { flex-direction:column; gap:10px; }
    .at-segs.wide, .at-chips { max-width:100%; justify-content:flex-start; }
    .at-chips-note { text-align:left; }
    .at-text { min-width:0; width:100%; }
    /* One box per row on a phone — two 160px boxes side by side truncate every label. */
    .at-grid { grid-template-columns:1fr; }
    .at-box-k { margin-top:10px; padding-top:10px; }
  }
  `}</style>;
}
