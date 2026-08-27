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
// PRUNED AND RE-HOMED 2026-08-04. Twenty-five of these keys named nodes that no longer exist —
// the nine Edit-menu parts became `d_mgr_*`, the money flags moved under `mgr_*`/`wtr_*`, and
// `takeaway` / `parcel` / `bill_gstin` / `logs` were renamed or merged — so `SYNONYMS[node.id]`
// missed and those extra words attached to nothing. Most still resolved by luck, because the same
// word appears in the row's own help text; "addon" did not. Every key below now matches a real
// node id, and the guard in scripts/verify-access-model.mjs fails the build if one stops doing so.
const SYNONYMS: Record<string, string> = {
  allergy_notes: "allergy allergen nuts note request",
  allergy_other: "allergy own custom",
  auto_print_kot: "printer print kot kitchen ticket thermal",
  banquet: "banquet event party hall per plate",
  banquet_setup: "banquet fields number series tax paper layout",
  bill: "bill invoice receipt gst tax legal",
  bill_format: "bill invoice receipt gstin gst legal name address footer prefix format",
  bubbles: "bubble particles background animation calm",
  d_mgr_add_dish: "add new dish item create",
  d_mgr_delete_dish: "delete remove dish item",
  d_mgr_edit_3d: "3d model upload attach",
  d_mgr_edit_dish: "edit dish name photo description",
  d_mgr_edit_options: "customisation customization choice group size extras addon",
  d_mgr_edit_price: "price cost rate amount",
  d_mgr_log_activity: "log activity history operations staff actions trail",
  d_mgr_log_customers: "customer guest log blocklist block visits",
  d_mgr_log_removals: "audit removal deleted cancelled kot removed why reason trail",
  d_mgr_manage_categories: "category categories section group",
  d_mgr_manage_filters: "filter filters chip tag dietary",
  d_mgr_mark_86: "sold out 86 unavailable finished",
  d_own_log_activity: "log activity history operations staff actions trail",
  d_own_log_removals: "audit removal deleted cancelled bill removed why reason trail",
  dining_sessions: "open table seat party session",
  favourites: "favourite favorite heart saved",
  google_review_url: "google link review url",
  guest_note: "note comment instruction",
  inventory: "inventory stock recipe expense wastage vendor purchase count cogs",
  item_tax_modes: "mrp water bottle packaged sealed per dish tax gst different item level override",
  khata: "khata pay later credit udhaar tab account",
  maintenance: "maintenance closed offline take menu down shut we'll be right back",
  maintenance_who: "who may take menu down owner manager maintenance",
  menu: "guest menu qr diner",
  menu_currencies: "currency rupee dollar euro symbol money",
  menu_languages: "language translate hindi french arabic korean german",
  menu_layout: "grid list layout tiles",
  menu_mode: "dark light theme mode",
  menu_theme: "theme colour color brand skin",
  mgr_bill_reopen_mins: "minutes window how long time limit reopen within",
  mgr_bills: "bills record previous today yesterday parcel",
  mgr_bills_range: "which bills previous yesterday today reach window history",
  mgr_dash_range: "yesterday how far back reach range day",
  mgr_give_discounts: "discount off reduce concession manager",
  mgr_give_discounts_cap: "discount cap ceiling percent limit most",
  mgr_tab_dash: "dashboard numbers report today",
  mgr_tab_editor: "edit menu editor dishes categories",
  mgr_tab_log: "audit logs removals activity",
  mgr_tab_ratings: "rating review feedback stars complaint",
  mgr_void_bills: "void reopen cancel bill undo manager",
  mgrset_access: "sections who serves which table waiter floor split",
  mgrset_tables: "table name seats rename manager settings",
  mgrset_users: "users staff logins create reset disable manager settings",
  mrp_tax_treatment: "mrp gst inside price water bottle packaged sealed no gst inclusive maximum retail price",
  own_access: "access staff powers team logins permissions staff and powers",
  own_audit: "audit logs removals activity",
  own_logs_service: "service log orders tables bills parcels staff actions",
  own_logs_signins: "sign in login log who signed in failed tries",
  own_logs_staff_changes: "staff change log permission enable disable",
  own_manager_mode: "manager mode live floor tables take order owner panel work the floor",
  own_menu: "owner edit menu editor",
  own_ratings: "owner rating review stars",
  parcel_bill_format: "parcel bill receipt narrow roll format",
  payroll: "payroll salary wages pay advance staff profile",
  price_tax_mode: "gst tax inclusive exclusive included price includes tax no gst composition scheme flat rate on top",
  qop: "quick order parcel qop fast punch in",
  qop_parcel: "parcel bar quick order send out",
  qop_tables: "quick order table destination where does it go",
  ratings: "google review stars feedback rating",
  ratings_mode: "google review where rating goes",
  show_reviews: "reviews comments",
  tables_layout: "tables per row floor layout box size",
  tables_list: "table name seats how many tables",
  tables_qr: "qr code link print table qr sheet",
  veg: "veg nonveg vegetarian green red dot diet",
  viewer3d: "3d model glb three dimensional",
  wtr_banquet: "banquet event party hall waiter",
  wtr_close_unpaid: "walk out walkout unpaid close table owes money write off",
  wtr_give_discounts: "discount off reduce waiter tablet",
  wtr_give_discounts_cap: "discount cap ceiling percent limit waiter",
  wtr_khata: "khata pay later credit udhaar waiter",
  wtr_mark_paid: "mark paid settle payment cash upi card waiter tablet take payment",
  wtr_parcel: "parcel takeaway counter waiter",
  wtr_table_ops: "move merge split shift transfer table kot waiter",
  wtr_table_tags: "table type vip family guest tag mark waiter",
  wtr_take_orders: "take order new order kot waiter tablet",
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
      {/* ── THE LAYER, SAID OUT LOUD (owner, 2026-08-27, with the screen in front of him: "in the
          admin, Access and permission, the UI is clashing and overlaying") ────────────────────────
          He was right, and I could reproduce it. The results panel is capped at 560px while the
          cards behind it run to ~1015px, so it covered the LEFT half of every card and left the
          right half fully lit — sentences chopped mid-word ("…no greyed-out leftovers", "…ult —
          switch one on") with the count pills still glowing beside them. Two layers of text in one
          place, and nothing said which was on top.
          A scrim is the fix, not a wider panel: it makes the page behind read as behind, and it
          gives the list somewhere to be dismissed FROM (clicking the dim area closes it, which is
          what every person tries first). */}
      {open && q.trim() ? <div className="as-scrim" onMouseDown={() => setOpen(false)} aria-hidden="true" /> : null}
    </div>
  );
}

function SearchStyle() {
  return (
    <style>{`
  /* z-index 41 — ABOVE the scrim (39) and the list (40), so the field you are typing in is never
     dimmed by the very thing your typing opened. */
  .as-wrap { position: relative; flex: 1 1 320px; min-width: 0; max-width: 560px; z-index: 41; }
  /* Dims the whole page while results are showing. Deliberately gentle: this is a typeahead, not a
     modal — enough that the cards stop competing with the list, not so much that it feels like a
     dialog you have to deal with. */
  /* A DIM IS NOT ENOUGH ON A NEAR-BLACK SKIN — measured, not assumed. At 0.42 alpha the pixel
     behind the panel went from rgb(16,20,27) to rgb(10,15,23): a real change, and invisible to a
     human. Darkening something that is already almost black cannot say "this is behind".
     So the scrim also BLURS. Blur is the honest signal here for two reasons: it works on a black
     skin and a cream one alike, and in this app blur already means "the thing behind is
     dismissable" — which is exactly true, clicking it closes the list.
     ONE unprefixed backdrop-filter line. Hand-adding -webkit- makes the build DROP the blur
     entirely (see app/globals.css → what "blur" means). */
  .as-scrim { position: fixed; inset: 0; z-index: 39; background: rgba(3, 7, 16, 0.5);
    backdrop-filter: blur(2.5px);
    animation: as-scrim-in .13s ease-out; }
  @keyframes as-scrim-in { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .as-scrim { animation: none; } }
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

  /* WIDER THAN THE FIELD, on purpose. A result is a name AND the path it lives at ("Manager ›
     Permission for manager"), and at 560px both were being cut with an ellipsis — so the one thing
     the list is for, telling you WHERE a setting is, was the first thing to go. It grows to the
     right, never past the viewport. The heavier shadow is the other half of the layer: with the
     scrim behind it, the panel now reads as one sheet lying on top instead of a patch. */
  .as-list { position: absolute; z-index: 40; top: calc(100% + 6px); left: 0; right: auto;
    width: max(100%, min(690px, calc(100vw - 60px)));
    max-height: min(58vh, 420px); overflow-y: auto; padding: 5px;
    background: var(--adm-pop, #171a20); border: 1px solid var(--adm-line, rgba(255,255,255,.14));
    border-radius: 13px; box-shadow: 0 24px 60px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.3); }
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
    .as-list { width: 100%; }
    .as-item { padding: 11px 10px; }
    .as-nm { white-space: normal; }
  }
`}</style>
  );
}
