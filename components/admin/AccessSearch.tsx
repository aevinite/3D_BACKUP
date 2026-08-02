"use client";
/* components/admin/AccessSearch.tsx — "find any setting" for Access & permissions
 * (owner, 2026-07-31: "a search bar at top of access which will take you to any setting
 * very fast, like it does on the phone").
 *
 * Works like a phone's Settings search: type a few letters, get a flat list of matching
 * settings each showing WHERE it lives (Section › Parent › Setting), pick one and land on
 * that exact row with the same amber ring the ?focus= deep links use.
 *
 * WHY IT IS FAST — and why that needed no cleverness:
 *
 *   The whole tree is a CONSTANT (lib/accessTree.ts), so the searchable index is built ONCE
 *   at module load — not per render, not per keystroke — and every entry's haystack is
 *   pre-lowercased at that moment. Searching is then a single pass over ~90 pre-baked strings
 *   with no allocation beyond the results array, which is far below one frame. So there is no
 *   debounce (a delay would only make it feel slower), no network call, and no request to the
 *   server at all: everything the search needs is already in the page.
 *
 *   Being honest about the trade-off: at this size the algorithm barely matters — a fuzzy
 *   matcher or a prebuilt trie would cost more code and more memory for no perceptible gain.
 *   What actually makes it feel instant is that it never waits on anything. If the tree ever
 *   grows past a few thousand rows, THAT is when an index structure earns its keep.
 *
 * The one non-obvious behaviour: a setting whose parent is switched off is REMOVED from the
 * page (rule 1 of this screen — no greyed-out ghosts), so it has no row to jump to. Rather
 * than a dead click, those results say what has to be on first and land on that parent. */
import { useEffect, useMemo, useRef, useState } from "react";
import { SECTIONS, type Node, type Section } from "@/lib/accessTree";

/** Extra words people actually type that don't appear in a row's own label. Kept small and
 *  deliberate — every entry here is a word the owner or a client has used for the thing. */
const SYNONYMS: Record<string, string> = {
  menu: "guest menu qr diner",
  own_manager_mode: "manager mode live floor tables take order owner panel work the floor",
  d_own_manager_mode: "manager mode live floor tables take order owner panel work the floor",
  dining_sessions: "open table seat party session",
  ratings: "google review stars feedback rating",
  google_review_url: "google link review url",
  show_reviews: "reviews comments",
  viewer3d: "3d model glb three dimensional",
  allergy_notes: "allergy allergen nuts note request",
  allergy_other: "allergy own custom",
  guest_note: "note comment instruction",
  favourites: "favourite favorite heart saved",
  veg: "veg nonveg vegetarian green red dot diet",
  menu_layout: "grid list layout tiles",
  menu_mode: "dark light theme mode",
  menu_theme: "theme colour color brand skin",
  menu_languages: "language translate hindi french arabic korean german",
  menu_currencies: "currency rupee dollar euro symbol money",
  khata: "khata pay later credit udhaar tab account",
  // Two SEPARATE features (mig 259), so two separate entries. "parcel" and "takeaway" are
  // both typed for the counter parcel, and "delivery"/"online"/the app names for Platforms;
  // each word is listed under the one it should actually jump to.
  takeaway: "platforms delivery zomato swiggy aggregator online website apps",
  parcel: "parcel takeaway counter pickup collection bag qop quick order",
  auto_print_kot: "printer print kot kitchen ticket thermal",
  banquet: "banquet event party hall per plate",
  payroll: "payroll salary wages pay advance staff profile",
  inventory: "inventory stock recipe expense wastage vendor purchase count cogs",
  bill: "bill invoice receipt gst tax legal",
  bill_gstin: "gstin gst number tax id",
  bill_name: "legal name business name",
  bill_address: "address bill address",
  mark_86: "sold out 86 unavailable finished",
  edit_price: "price cost rate amount",
  edit_options: "customisation customization choice group size extras addon",
  add_dish: "add new dish item create",
  delete_dish: "delete remove dish item",
  edit_dish: "edit dish name photo description",
  edit_3d: "3d model upload attach",
  manage_categories: "category categories section group",
  manage_filters: "filter filters chip tag dietary",
  give_discounts: "discount off reduce concession",
  mark_paid: "paid settle payment cash upi card",
  print_invoice: "bill generate invoice print receipt",
  void_bills: "void reopen cancel bill undo",
  delete_bill: "delete bill remove bill",
  table_ops: "move merge split shift transfer table",
  manage_staff: "staff team users waiter add person login",
  edit_settings: "settings configure restaurant setup",
  take_orders: "order take new order kot",
  table_tags: "table type vip family guest tag mark",
  logs: "log activity history audit trail",
  // The Audit & logs sub-views (access_config.view_logs.<side>_opts) — words people type
  // that aren't in the row labels. Keyed by NODE ID (that's what the index reads).
  d_mgr_log_removals: "audit removal deleted cancelled kot removed why reason trail",
  d_mgr_log_activity: "log activity history operations staff actions trail",
  d_mgr_log_customers: "customer guest log blocklist block visits",
  d_own_log_removals: "audit removal deleted cancelled bill removed why reason trail",
  d_own_log_activity: "log activity history operations staff actions trail",
  mgr_tab_log: "audit logs removals activity",
  own_audit: "audit logs removals activity",
};

type Entry = {
  node: Node;
  section: Section;
  ancestors: Node[];       // outermost first — the rows that must be ON and expanded
  path: string;            // "Main features › Menu › Format"
  hay: string;             // everything searchable, pre-lowercased
  nameLc: string;
  words: string[];         // pre-split lowercased words of the name
};

/** Built ONCE at module load. SECTIONS is a constant, so there is nothing to invalidate. */
const INDEX: Entry[] = (() => {
  const out: Entry[] = [];
  for (const section of SECTIONS) {
    const walk = (nodes: Node[], ancestors: Node[]) => {
      for (const node of nodes) {
        const b: any = node.bind;
        const key = [b.key, b.flag, b.id, b.t === "module" ? `${b.key}_allowed` : ""].filter(Boolean).join(" ");
        const path = [section.name, ...ancestors.map((a) => a.name)].join(" › ");
        const nameLc = node.name.toLowerCase();
        out.push({
          node, section, ancestors: [...ancestors], path, nameLc,
          words: nameLc.split(/[^a-z0-9]+/).filter(Boolean),
          hay: [node.name, node.what || "", path, key, SYNONYMS[node.id] || ""].join(" ").toLowerCase(),
        });
        if (node.children?.length) walk(node.children, [...ancestors, node]);
      }
    };
    walk(section.children, []);
  }
  return out;
})();

/** How well does this entry answer this one token? 0 = not at all. */
function tokenScore(e: Entry, t: string): number {
  if (e.nameLc.startsWith(t)) return 100;                       // "lang" → Languages
  if (e.words.some((w) => w.startsWith(t))) return 80;          // "print" → Auto-print kitchen tickets
  if (e.nameLc.includes(t)) return 55;
  if (!e.hay.includes(t)) return 0;
  if (e.path.toLowerCase().includes(t)) return 34;              // "waiter" → everything under Waiter
  return 20;                                                    // matched the help text, a key or a synonym
}

/** Every token must match something; the score is their sum, so more specific wins. */
function search(q: string, limit = 14): Entry[] {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const hits: { e: Entry; s: number }[] = [];
  for (const e of INDEX) {
    let total = 0;
    for (const t of tokens) {
      const s = tokenScore(e, t);
      if (!s) { total = 0; break; }
      total += s;
    }
    if (total) hits.push({ e, s: total });
  }
  // Stable-ish: better score first, then the shorter name (the more exact thing).
  hits.sort((a, b) => b.s - a.s || a.e.nameLc.length - b.e.nameLc.length);
  return hits.slice(0, limit).map((h) => h.e);
}

export default function AccessSearch({ isOn, onPick }: {
  /** Asked of a node so this component never needs its own copy of the on/off rule. */
  isOn: (n: Node) => boolean;
  /** Land on this node. `blockedBy` is the ancestor that must be switched on first. */
  onPick: (nodeId: string, sectionId: string, ancestorIds: string[], blockedBy: Node | null) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => search(q), [q]);
  useEffect(() => { setCursor(0); }, [q]);

  // ⌘K / Ctrl-K / "/" focuses the box from anywhere on the page — the shortcut people try.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement | null)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if ((ev.key === "k" && (ev.metaKey || ev.ctrlKey)) || (ev.key === "/" && !typing)) {
        ev.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click outside closes the list (Esc does too, below).
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (!boxRef.current?.contains(ev.target as globalThis.Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  /** The nearest ancestor that is switched off — that row has to come on before this one exists. */
  const blockerOf = (e: Entry): Node | null => {
    for (const a of e.ancestors) if (!isOn(a)) return a;
    return null;
  };

  // Picking a result KEEPS what you typed (owner: "after search that written thing should stay
  // there until you click the cross at the very end, just like phone"). Only the × clears it.
  // That also makes the common case cheap: land on one match, glance at it, reopen the same
  // list and take the next one — instead of retyping "discount" four times.
  const choose = (e: Entry) => {
    const blocked = blockerOf(e);
    setOpen(false);
    onPick(e.node.id, e.section.id, e.ancestors.map((a) => a.id), blocked);
  };

  const onKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    // Escape closes the list but LEAVES the text, for the same reason. The × empties it.
    if (ev.key === "Escape") { setOpen(false); return; }
    if (!results.length) return;
    if (ev.key === "ArrowDown") { ev.preventDefault(); setOpen(true); setCursor((c) => (c + 1) % results.length); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setOpen(true); setCursor((c) => (c - 1 + results.length) % results.length); }
    else if (ev.key === "Enter") { ev.preventDefault(); choose(results[Math.min(cursor, results.length - 1)]); }
  };

  const show = open && q.trim().length > 0;

  return (
    <div className="as-wrap" ref={boxRef}>
      <SearchStyle />
      <div className="as-field">
        <svg className="as-mag" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></svg>
        <input
          ref={inputRef} className="as-input" type="search" value={q} autoComplete="off" spellCheck={false}
          placeholder="Find a setting — try “language”, “discount”, “zomato”…"
          aria-label="Find a setting"
          aria-expanded={show} aria-controls="as-list" role="combobox"
          onChange={(ev) => { setQ(ev.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {q ? (
          <button className="as-clear" onClick={() => { setQ(""); inputRef.current?.focus(); }} aria-label="Clear">×</button>
        ) : <kbd className="as-kbd">/</kbd>}
      </div>

      {show ? (
        <div className="as-list" id="as-list" role="listbox">
          {results.length === 0 ? (
            <div className="as-none">Nothing matches “{q.trim()}”.</div>
          ) : results.map((e, i) => {
            const blocked = blockerOf(e);
            return (
              <button
                key={e.node.id} role="option" aria-selected={i === cursor}
                className={`as-item ${i === cursor ? "on" : ""}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(e)}
              >
                <span className="as-txt">
                  <span className="as-nm">{e.node.name}</span>
                  <span className="as-pth">{e.path}</span>
                </span>
                {e.node.leftToBuild ? <span className="as-badge build">Left to build</span>
                  : blocked ? <span className="as-badge need">needs {blocked.name}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SearchStyle() {
  return (
    <style>{`
  .as-wrap { position: relative; flex: 1 1 320px; min-width: 0; max-width: 560px; }
  .as-field { display: flex; align-items: center; gap: 8px; padding: 0 10px;
    background: var(--adm-field, rgba(255,255,255,.04)); border: 1px solid var(--adm-line, rgba(255,255,255,.14));
    border-radius: 11px; height: 38px; transition: border-color .14s, box-shadow .14s; }
  .as-field:focus-within { border-color: rgba(99,179,255,.55); box-shadow: 0 0 0 3px rgba(99,179,255,.14); }
  .as-mag { flex: none; opacity: .58; }
  .as-input { flex: 1; min-width: 0; height: 100%; background: none; border: 0; outline: none;
    color: inherit; font: inherit; font-size: 14px; }
  .as-input::placeholder { opacity: .5; }
  .as-input::-webkit-search-cancel-button { display: none; }
  .as-kbd { flex: none; font-size: 11px; opacity: .4; border: 1px solid currentColor; border-radius: 5px;
    padding: 0 5px; line-height: 16px; }
  .as-clear { flex: none; background: none; border: 0; color: inherit; opacity: .55; cursor: pointer;
    font-size: 19px; line-height: 1; padding: 0 3px; }
  .as-clear:hover { opacity: 1; }

  .as-list { position: absolute; z-index: 40; top: calc(100% + 6px); left: 0; right: 0;
    max-height: min(58vh, 420px); overflow-y: auto; padding: 5px;
    background: var(--adm-pop, #171a20); border: 1px solid var(--adm-line, rgba(255,255,255,.14));
    border-radius: 13px; box-shadow: 0 18px 44px rgba(0,0,0,.42); }
  .as-item { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
    background: none; border: 0; color: inherit; cursor: pointer; padding: 8px 10px; border-radius: 9px; }
  /* The highlighted result — hover AND the keyboard cursor land on the same class, so both read
     as "where you are" in the owner's red rather than the old blue. */
  .as-item.on { background: color-mix(in srgb, #f87171 15%, transparent); box-shadow: inset 2px 0 0 #f87171; }
  .as-txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  .as-nm { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .as-pth { font-size: 11.5px; opacity: .58; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .as-badge { flex: none; font-size: 10.5px; font-weight: 700; padding: 2px 7px; border-radius: 999px; }
  .as-badge.need { background: rgba(255,183,77,.16); color: #ffb74d; }
  .as-badge.build { background: rgba(255,255,255,.09); opacity: .75; }
  .as-none { padding: 12px 11px; font-size: 13px; opacity: .6; }

  /* On a phone the list is the whole width of the card and the rows are finger-sized. */
  @media (max-width: 640px) {
    .as-wrap { flex: 1 1 100%; max-width: none; }
    .as-item { padding: 11px 10px; }
    .as-nm { white-space: normal; }
  }
`}</style>
  );
}
