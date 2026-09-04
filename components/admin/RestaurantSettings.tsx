"use client";
// RestaurantSettings — the admin restaurant-detail "Settings" tab's four operational
// sections (owner 2026-07-26): Billing, KOT printing, Dining sessions, Tables & QR.
// Field-for-field the same as the manager panel's Settings sections (the design the
// owner approved), restyled with the admin's .adm-* look. The manager copies get
// removed once the owner approves this tab live; both write the same settings row.
//
// Data: GET/POST /api/admin/restaurants/settings (single scoped row + per-table QR
// codes, mig 210). The KOT switch reuses the quick-features endpoint so it stays the
// single source of truth with Main features + Access.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FLOOR_PER_ROW_MAX, FLOOR_PER_ROW_MIN, clampPerRow } from "@/lib/floorLayout";
import { BANQUET_FIELDS, BANQUET_LOCKED, BANQUET_PRESETS, banquetBillNo, banquetTaxOf, cleanBanquetFields } from "@/lib/banquetFields";
// THE bill and THE kitchen ticket, written down once — the same file the manager panel and the
// kitchen board print from. Both previews on this screen render it, so a format approved here
// cannot come out of the printer looking like something else (owner, 2026-08-02).
import BILLDOC from "@/public/panels/billdoc.js";
// The restaurant's REAL rate, by the one rule the whole app uses (named components if it has
// them, else its own flat rate, else 5%). The worked examples under the price-mode choice are
// only useful if they are this restaurant's arithmetic, not a made-up 5%.
import { effectiveTaxRate } from "@/lib/tax";
// THE sample bill — the same builder the Access screen's "Format of KOT bills" preview uses, so
// the two previews of one document cannot disagree.
import { billPreviewHtml } from "@/lib/billPreview";

type Rest = { id: string; slug: string; name: string };
type TaxComp = { label: string; rate: number | string };
type Draft = Record<string, unknown>;

// Every settings-row field this tab owns (used for the dirty-diff and the save patch).
const KEYS = [
  "tax_label", "restaurant_name", "restaurant_address", "restaurant_phone", "gstin",
  "invoice_prefix", "bill_footer", "tax_components", "tax_rate",
  // GST and prices (mig 270). These three save themselves the moment they are picked, but they
  // MUST still be listed here: the dirty-diff and the Save patch are both built from this array,
  // so a key missing from it looks editable and then quietly saves nothing.
  "price_tax_mode", "item_tax_modes_allowed", "mrp_tax_treatment",
  "bill_customer_required", "bill_customer_print",
  "sessions_enabled", "require_location", "require_otp", "geo_lat", "geo_lng", "geo_radius_m",
  "table_count", "table_seats", "table_names",
  // auto_table_action is NOT here any more (owner, 2026-08-01: "we don't even want that option,
  // remove that option completely, because that option is useless"). A table always clears itself
  // once the bill is paid and every dish is served; WHICH way it cleared was a choice nobody
  // should have had to make. The column and its default behaviour are untouched — there is simply
  // no field, so nothing on this screen can change it.
  // Banquet bill (migs 237/239). These MUST be listed here: the Save button builds its
  // patch from the keys in this array, so a field missing from it looks editable and then
  // silently saves nothing (which is exactly what happened when the card was first added).
  "banquet_fields", "banquet_bill_prefix", "banquet_bill_style", "banquet_bill_next",
  "banquet_tax_components", "banquet_paper", "banquet_paper_size", "banquet_paper_top",
  "banquet_paper_bot", "banquet_paper_side", "banquet_paper_foot", "banquet_paper_sign",
  "banquet_paper_fill", "floor_per_row", "floor_layout_mode",
  // `kot_print_target` LEFT THIS LIST on 2026-08-28 (mig 369). It was the coarse "which screen
  // prints the kitchen ticket" answer, it asked the same question as the Kitchen slips route and
  // could contradict it, and no control on any screen writes it any more. The column is retired,
  // not dropped, and nothing reads it — so a key here would let a stale screen write a value that
  // then misleads whoever reads the database next.
] as const;

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 11px", borderRadius: 8, border: "var(--border)",
  background: "var(--bg)", color: "var(--text)", fontSize: 13,
};
const labelStyle: React.CSSProperties = { fontSize: 12, display: "block" };
const hintStyle: React.CSSProperties = { fontSize: 11.5, marginTop: 3 };

/** Which cards to render. Omitted = all of them (how the restaurant-detail page used it).
 *  Access & permissions passes ONE key, because each of these sections now lives inside the
 *  dropdown of the feature it belongs to — "Dining sessions" opens the session rules, "Banquet
 *  billing" opens the banquet bill, and so on (owner, 2026-08-01). The component still loads and
 *  saves the whole settings row either way, so the same values are edited from either place. */
export type SettingsSection = "billing" | "banquet" | "kitchen" | "sessions" | "tables" | "floor" | "qr";

/**
 * ONE SAVE BAR FOR THE WHOLE PAGE.
 *
 * This component used to render its own fixed-position "Unsaved changes · Discard · Save" bar.
 * That was fine when it was mounted once on the restaurant-detail page. Access mounts it SEVEN
 * times — billing, banquet, kitchen, sessions, tables, floor, qr — so seven bars stacked on the
 * same spot, which is what the owner saw as "two buttons coming" and as flicker (they overlap,
 * so the hover highlight lands on whichever won the paint).
 *
 * Worse than the duplicate: every instance kept its OWN draft of the SAME settings row, so two
 * open panels could each save and silently undo the other. The registry fixes both — instances
 * publish their dirty state and their save/discard here, ONE bar renders, and pressing Save
 * saves every dirty panel.
 */
type SaveEntry = { dirty: boolean; busy: boolean; save: () => Promise<void>; discard: () => void };
const saveRegistry = new Map<string, SaveEntry>();
const saveListeners = new Set<() => void>();
const publish = () => { for (const fn of saveListeners) fn(); };
function registerSave(id: string, entry: SaveEntry) { saveRegistry.set(id, entry); publish(); }
function unregisterSave(id: string) { saveRegistry.delete(id); publish(); }

/** The single bar. Mounted once by the page; renders nothing while everything is saved. */
export function SettingsSaveBar() {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    saveListeners.add(fn);
    return () => { saveListeners.delete(fn); };
  }, []);
  const dirty = [...saveRegistry.values()].filter((e) => e.dirty);
  const busy = dirty.some((e) => e.busy);
  if (!dirty.length) return null;
  return (
    <div className="adm-savebar" role="status">
      <span className="adm-savebar-t">
        {dirty.length > 1 ? `Unsaved changes in ${dirty.length} sections` : "Unsaved changes"}
      </span>
      <button className="adm-savebar-x" disabled={busy} onClick={() => dirty.forEach((e) => e.discard())}>Discard</button>
      <button className="adm-savebar-go" disabled={busy}
        onClick={async () => { for (const e of dirty) await e.save(); }}>
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

export default function RestaurantSettings({ restaurant, only }: { restaurant: Rest; only?: SettingsSection[] }) {
  const show = (k: SettingsSection) => !only || only.includes(k);
  const [draft, setDraft] = useState<Draft>({});
  const [base, setBase] = useState<Draft>({});
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [loadOk, setLoadOk] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // KOT auto-print (effective state, via the quick-features single source of truth).
  const [kot, setKot] = useState<boolean | null>(null);
  // The grant, on its own. `kot` is the EFFECTIVE answer (granted AND switched on); this is the first
  // half, so the card can say which of the two is missing instead of showing one number that seems to
  // contradict the switch above it.
  const [kotAllowed, setKotAllowed] = useState<boolean | null>(null);
  const [kotBusy, setKotBusy] = useState(false);
  const [qrBusy, setQrBusy] = useState<string | null>(null);
  // The bill's logo is the restaurant's own uploaded image (Design and styling → Theme and
  // wording). Read here so the preview shows the REAL header — including the empty case, which
  // is the whole point of the rule: no image ⇒ the bill starts with the name.
  const [logoUrl, setLogoUrl] = useState<string>("");
  useEffect(() => {
    fetch(`/api/admin/restaurants/branding?restaurant_id=${encodeURIComponent(restaurant.id)}`, { cache: "no-store" })
      .then((r) => r.json()).then((j) => setLogoUrl(String(j?.logo_url || ""))).catch(() => {});
  }, [restaurant.id]);

  // The two previews below hand the shared document the same two things the panels hand it:
  // the restaurant row (which decides the flagship's identity, the per-cuisine sign-off and the
  // logo) and the settings — here the UNSAVED draft, so what is on screen is what is previewed.
  const restForDoc = () => ({ id: restaurant.id, slug: restaurant.slug, name: { en: restaurant.name }, logo_url: logoUrl });
  // A restaurant that renamed its tables should see the name a live document will carry ("A5").
  const sampleTableLabel = (fallback: string) =>
    (((draft.table_names || {}) as Record<string, string>)["5"] || "").trim() || fallback;

  // Success/error notes fade on their own (errors linger a little longer to be read).
  useEffect(() => {
    if (!msg && !err) return;
    const id = setTimeout(() => { setMsg(null); setErr(null); }, err ? 5000 : 2600);
    return () => clearTimeout(id);
  }, [msg, err]);

  const load = useCallback(async () => {
    setLoadErr(false);
    // ── ONE RETRY BEFORE LOCKING THE FORM (T16 sweep, 2026-08-19) ──────────────────────────
    // A BRAND-NEW restaurant has no table QR codes yet, and this load is what mints them. The
    // admin route reads the existing codes, works out which are missing and INSERTS them — so two
    // of these cards loading at the same moment (the Access screen mounts one per open row, and it
    // remembers which rows were open) both try to insert tables 1..N, the loser hits the unique
    // index and the route answers 500 "couldn't mint unique codes — try again". Reproduced on a
    // freshly created restaurant: one load 200, the other 500, and the very next load 200.
    //
    // That 500 landed here as `loadErr`, which locks the whole card behind "Couldn't load this
    // restaurant's settings" with a Retry button — on the screen an admin opens seconds after
    // creating a restaurant. Retrying once, quietly, is what the situation actually needs: the
    // codes exist by then. If the second attempt fails too the card still locks and still says so,
    // so a real outage is not hidden. The route's own half of this SHIPPED (checked 2026-08-27):
    // app/api/admin/restaurants/settings/route.ts now upserts the missing rows with
    // `ignoreDuplicates: true` on (restaurant_id, table_number), so the loser of the race is no
    // longer a 500 at all — handoff H3 is closed. This retry stays as the belt to that braces.
    const fetchOnce = async () => (await fetch(`/api/admin/restaurants/settings?restaurant_id=${encodeURIComponent(restaurant.id)}`, { cache: "no-store" })).json();
    try {
      let j = await fetchOnce();
      if (j?.error) {
        await new Promise((r) => setTimeout(r, 700));
        j = await fetchOnce();
      }
      if (j.error || !j.settings) { setLoadErr(true); return; }
      const s: Draft = { ...j.settings };
      // Open PRE-FILLED with what the bill prints right now (the manager form's rule):
      // brand-safe fields only — address/phone/GSTIN stay placeholders so a Save can
      // never persist a fake value on a not-yet-configured restaurant.
      if (!s.restaurant_name) s.restaurant_name = restaurant.name;
      if (!s.invoice_prefix) s.invoice_prefix = "INV";
      if (!s.bill_footer) s.bill_footer = "Thank you — please visit again";
      // NOT PREFILLED (owner, 2026-08-28) — `tax_label` drives the PRINTED bill as well as the
      // screen, and they have different right defaults ("GST" on paper, "Tax" on screen). Writing
      // either one in here made the paper print the screen's word. The field shows it as a hint.
      if (!Array.isArray(s.tax_components) || !(s.tax_components as TaxComp[]).length) {
        const rate = Number(s.tax_rate);
        const pct = (Number.isFinite(rate) && rate > 0 && rate <= 1 ? rate : 0.05) * 100;
        const half = Math.round((pct / 2) * 100) / 100;
        s.tax_components = [{ label: "CGST", rate: half }, { label: "SGST", rate: half }];
      }
      setDraft(s); setBase(JSON.parse(JSON.stringify(s)));
      setCodes(j.codes || {});
      setLoadOk(true);
    } catch { setLoadErr(true); }
  }, [restaurant.id, restaurant.name]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch(`/api/admin/restaurants/quick-features?restaurant_id=${encodeURIComponent(restaurant.id)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        // Both halves, so the card can name the missing one. The effective value is kept for the
        // places that only care whether paper is coming out at all.
        if (typeof j.auto_print_kot_on === "boolean") setKot(j.auto_print_kot_on);
        else if (typeof j.auto_print_kot === "boolean") setKot(j.auto_print_kot);
        if (typeof j.auto_print_kot_allowed === "boolean") setKotAllowed(j.auto_print_kot_allowed);
      })
      .catch(() => {});
  }, [restaurant.id]);

  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const [autoSaved, setAutoSaved] = useState<string | null>(null);
  // KEYS THIS CARD SAVES BY ITSELF — "busy" while a write is out, "done" once it has landed (or
  // been refused and put back). Two jobs, one record:
  //   • the line under the control reads Saving… / ✓ Saved / Saves on its own from it, and
  //   • dirtyKeys IGNORES every key in it, so the shared Save bar can never appear for a control
  //     that saves itself. That is the whole point of "there shouldn't be a button" (owner,
  //     2026-08-20): while the write was in flight the draft differed from the stored value, the
  //     bar counted it as unsaved, and a Save button flashed up next to a control that needed no
  //     pressing. A refusal reverts the draft, so nothing is lost by leaving them out for good.
  const [selfSaving, setSelfSaving] = useState<Record<string, "busy" | "done">>({});
  // The three-state line that sits under every self-saving control. ONE place, so a select, a
  // switch and a radio row can never end up telling the admin three different stories.
  const savedHint = (k: string) => {
    const saving = selfSaving[k] === "busy";
    const done = autoSaved === k;
    return (
      <span aria-live="polite" style={{ ...hintStyle, display: "block", fontWeight: done || saving ? 700 : 400,
        color: done ? "var(--adm-ok, #16a34a)" : saving ? "var(--muted)" : "var(--muted)" }}>
        {done ? "✓ Saved" : saving ? "Saving…" : "Saves on its own"}
      </span>
    );
  };
  const dirtyKeys = useMemo(
    // …minus anything a self-saving control owns (see selfSaving): those never want a button.
    () => KEYS.filter((k) => !selfSaving[k] && JSON.stringify(draft[k] ?? null) !== JSON.stringify(base[k] ?? null)),
    [draft, base, selfSaving],
  );
  const dirty = loadOk && dirtyKeys.length > 0;

  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const patch: Draft = { restaurant_id: restaurant.id };
      for (const k of dirtyKeys) patch[k] = draft[k];
      const r = await fetch("/api/admin/restaurants/settings", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't save.");
      setMsg("Saved.");
      await load(); // re-read so table-count changes mint the new tables' QR codes too
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const discard = () => {
    // Cancel anything the auto-save still owes the server. Without this, Discard reverted the
    // screen and a pending debounce then wrote the discarded value a moment later — so pressing
    // Discard could put a rejected GST mode back on a real restaurant (T16 sweep, 2026-08-19).
    cancelPending();
    setDraft(JSON.parse(JSON.stringify(base))); setErr(null); setMsg(null);
  };

  // Publish this panel's state to the ONE bar. Keyed by the sections it owns, so mounting the
  // same section twice can't register twice.
  const regId = (only || ["all"]).join(",");
  useEffect(() => {
    registerSave(regId, { dirty, busy, save, discard });
    return () => unregisterSave(regId);
  });

  // ── AUTO-SAVE, for discrete controls only (owner, 2026-07-30: "I change value to 8 and it
  // doesn't auto save").
  //
  // Deliberately NOT the whole form. A text field would save half-typed rubbish (a partial
  // GSTIN, an incomplete bill footer), and "Number of tables" is outright dangerous to
  // auto-save: typing 30 passes through "3", which would shrink the floor to three tables and
  // fire the section backfill. Those keep the explicit Save bar. Only bounded values with no
  // data consequence are auto-saved — the same "saves instantly per change" habit the Access
  // per-person selects already use.
  //
  // ── THREE WAYS "SAVES ON ITS OWN" USED TO BE A LIE (T16 sweep, 2026-08-19) ─────────────────
  // Every one of these controls is a select, a radio or a switch, so it fires ONCE per decision —
  // yet all of them went through a single 600 ms debounce built for a slider that no longer
  // exists. That cost three real losses:
  //
  //   1. LEAVING THE ROW THREW THE VALUE AWAY. This component is mounted by the Access screen
  //      inside a dropdown row, and collapsing that row (or opening another) UNMOUNTS it. The old
  //      unmount cleanup cleared the pending timer, and unregisterSave removed the panel from the
  //      save bar in the same breath — so picking "Tables per row: 6" and closing the row left no
  //      write, no Save bar and no message. The pick vanished in silence.
  //   2. TWO PICKS INSIDE 600 ms LOST THE FIRST. One shared timer meant the second decision
  //      cancelled the first one's write.
  //   3. DISCARD WAS OVERTAKEN. Pressing Discard reverted the screen and the pending timer then
  //      wrote the discarded value anyway.
  //
  // So: a discrete pick POSTS IMMEDIATELY (autoSaveNow), the debounce survives per KEY for the
  // typed-number path that genuinely needs it, and a pending write is FLUSHED on unmount rather
  // than dropped. `keepalive` lets that last flush outlive the component.
  const alive = useRef(true);
  const pending = useRef(new Map<string, { v: unknown; timer: number }>());
  const cancelPending = () => {
    for (const { timer } of pending.current.values()) window.clearTimeout(timer);
    pending.current.clear();
  };
  const postSetting = useCallback((k: string, v: unknown, keepalive = false) => fetch("/api/admin/restaurants/settings", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ restaurant_id: restaurant.id, [k]: v }), keepalive,
  }), [restaurant.id]);
  useEffect(() => {
    // SET IT BACK TO TRUE ON EVERY MOUNT, not just false on unmount (T16 round 2, 2026-08-20).
    //
    // `alive` is a ref, so it SURVIVES a remount — and React mounts, unmounts and remounts every
    // component in development. The first mount's cleanup therefore left it false for good, and
    // from then on every guarded state update was skipped: the write still went to the server, but
    // "Saving…", "✓ Saved" and the put-it-back-on-a-refusal all did nothing, and the Save bar had
    // nothing to clear it. Measured: `selfSaving` stayed {} through every render. A ref used as a
    // liveness flag has to be re-armed here or it is a one-shot.
    alive.current = true;
    return () => {
      alive.current = false;
      // FLUSH, don't drop: whatever the debounce still owes goes to the server now.
      for (const [k, { v, timer }] of pending.current) { window.clearTimeout(timer); void postSetting(k, v, true).catch(() => {}); }
      pending.current.clear();
    };
  }, [postSetting]);
  // ── THE WORD UNDER THE CONTROL IS THE ONLY REPORT, SO IT MUST BE TRUE (owner, 2026-08-20:
  // "there shouldn't be a button also… it should be written that this has been saved, and that
  // return will only come when it is actually been saved").
  //
  // So there are exactly three states and no Save button anywhere near these controls:
  //   • "Saves on its own"  — nothing in flight
  //   • "Saving…"           — the request is out; nothing is claimed yet
  //   • "✓ Saved"           — the SERVER answered ok, and the value shown is the value it stored
  //
  // And a REFUSAL puts the control back to what is really stored, rather than leaving the new
  // value on screen for a Save bar to offer later. That is what makes "no button" honest: the
  // screen can never sit there showing a number the restaurant is not on.
  const commitSetting = async (k: string, v: unknown) => {
    pending.current.delete(k);
    if (alive.current) { setErr(null); setSelfSaving((s) => ({ ...s, [k]: "busy" })); }
    try {
      const r = await postSetting(k, v);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't save.");
      // Trust the SERVER's value, not ours — it clamps (99 → 12), so the field must show
      // what was really stored rather than what was typed.
      const stored = d.settings && k in d.settings ? d.settings[k] : v;
      if (!alive.current) return;
      setDraft((x) => ({ ...x, [k]: stored }));
      setBase((b) => ({ ...b, [k]: stored })); // keeps the Save bar from lighting up for it
      setAutoSaved(k);
      window.setTimeout(() => setAutoSaved((cur) => (cur === k ? null : cur)), 1800);
    } catch (e) {
      if (!alive.current) return;
      // Put the control back on the stored value — no half-saved screen, and nothing for a
      // button to pick up later.
      setDraft((x) => ({ ...x, [k]: base[k] }));
      setErr((e instanceof Error ? e.message : String(e)) + " — the setting was put back.");
    } finally {
      if (alive.current) setSelfSaving((s) => ({ ...s, [k]: "done" }));
    }
  };
  // A select / radio / switch: one decision, one write, no waiting.
  const autoSaveNow = (k: string, v: unknown) => {
    const p = pending.current.get(k);
    if (p) { window.clearTimeout(p.timer); pending.current.delete(k); }
    void commitSetting(k, v);
  };
  // A key claimed here is out of the Save bar's hands from now on, in BOTH paths — the debounced
  // one has to claim it up front too, or the bar appears for the 600 ms it is waiting.
  // A typed number: debounced PER KEY so a second field can't cancel the first one's write.
  const autoSave = (k: string, v: unknown) => {
    const p = pending.current.get(k);
    if (p) window.clearTimeout(p.timer);
    setSelfSaving((s) => ({ ...s, [k]: "busy" }));
    const timer = window.setTimeout(() => { void commitSetting(k, v); }, 600);
    pending.current.set(k, { v, timer });
  };

  const toggleKot = async () => {
    if (kot === null || kotBusy) return;
    const next = !kot;
    setKotBusy(true); setKot(next); if (next) setKotAllowed(true); // optimistic — ON grants as well
    try {
      const r = await fetch("/api/admin/restaurants/quick-features", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurant_id: restaurant.id, feature: "auto_print_kot", on: next }),
      });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't save.");
      setKot(!!d.auto_print_kot_on);
      setKotAllowed(!!d.auto_print_kot_allowed);
    } catch (e) { setKot(!next); setErr(e instanceof Error ? e.message : String(e)); }
    finally { setKotBusy(false); }
  };

  // THE SAMPLE IS THE REAL TICKET (owner, 2026-08-02: "both should be sync"). This button used
  // to draw its own little ticket — a different heading, different rows, and no @page rule, so
  // it came out on two pieces of paper and told you nothing about the real one. It now renders
  // /panels/billdoc.js, the same file the manager panel and the kitchen board print from, and
  // it does so from the values on THIS form so unsaved edits show up too.
  const previewKot = () => {
    const html = BILLDOC.kotDocHtml({
      title: "Sample kitchen ticket",
      rname: BILLDOC.billIdentity(draft, restForDoc()).name,
      head: "KITCHEN TICKET · SAMPLE",
      kot: "SAMPLE",
      // A restaurant that renamed its tables sees the name a live ticket will carry ("A5").
      tableLabel: sampleTableLabel("Table 5"),
      when: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      lines: [
        { qty: 2, title: "Margherita Pizza" },
        { qty: 1, title: "Garlic Bread", options: ["Extra cheese"] },
        { qty: 1, title: "Coke", note: "no ice" },
      ],
      allergies: ["dairy", "nuts"],
      note: "A sample ticket — the exact one the kitchen board prints, drawn from what is on this form right now.",
    });
    const w = window.open("", "lfh_kot_preview", "width=360,height=620");
    if (!w) { setErr("Allow pop-ups to preview the KOT."); return; }
    try { w.document.open(); } catch { /* reused window: start blank */ }
    w.document.write(html); w.document.close();
    try { w.focus(); } catch { /* already in front */ }
  };

  // ── SEE THE BILL BEFORE ANYONE GETS ONE (owner, 2026-08-01, corrected 2026-08-02) ─────────
  // A made-up bill — invented customer, three invented lines — using THIS form's header, taxes
  // and footer, so a layout can be judged without settling a real table.
  //
  // It used to draw its own page, which is how a bill approved here could come out of the
  // printer looking different ("both should be sync"). It now renders /panels/billdoc.js — the
  // one file the manager panel prints from — fed by the fields on this form, so unsaved edits
  // still show and what is previewed is genuinely what prints.
  //
  // …and as of mig 270 it does not even build its own FIGURES. It used to compute the tax from
  // this component's own copy of the rows, which meant it knew nothing about the price modes
  // added on the very screen it sits on: a restaurant switched to the composition scheme would
  // have been shown a bill with CGST/SGST rows it may not legally print. billPreviewHtml is the
  // one place those sums live, it takes a settings object, and the UNSAVED DRAFT is a settings
  // object — so unsaved edits still show and there is no second copy left to drift.
  const previewBill = () => {
    const html = billPreviewHtml(draft, "bill", restForDoc());
    // Tall by default: the document fits itself to the window, so height buys readability.
    const w = window.open("", "lfh_bill_preview", "width=440,height=" + Math.min(960, Math.max(620, (screen.availHeight || 900) - 80)));
    if (!w) { setErr("Allow pop-ups to preview the bill."); return; }
    try { w.document.open(); } catch { /* reused window: start blank */ }
    w.document.write(html); w.document.close();
    try { w.focus(); } catch { /* already in front */ }
  };

  // ── SEE THE BANQUET BILL (owner, 2026-08-01: "if possible show preview also") ──────────────
  // Uses exactly what this card is set to: the ticked fields, the number series, the banquet tax
  // rows (or the menu's rate when none are set), and the restaurant's own header. An event is
  // invented so the layout can be judged without booking one.
  // ── SEE THE BANQUET BILL — the REAL document, not a drawing of one ──────────────────────────
  // This used to build its own page from scratch, and the two had already parted company: the
  // printer re-uses the bill's FROZEN tax_lines (mig 239) while this recomputed them live, and the
  // printer honours the A4/A5 paper setup which this did not model at all. So an admin could set the
  // banquet card up, approve what they saw, and the paper came out different — the exact fault that
  // created /panels/billdoc.js for the bill and the KOT, still alive in the one document nobody had
  // got to (T7 sweep, F27).
  //
  // It now invents an EVENT and hands it to the very function the manager panel prints from, fed by
  // the fields on this form — so unsaved edits still show, and what is previewed is what prints.
  const previewBanquet = () => {
    const plates = 120, rate = 850;
    const sub = plates * rate;
    const rows = banquetTaxOf(draft);
    const live = (rows.length ? rows : comps.filter((c) => String(c?.label || "").trim() && Number(c?.rate) > 0)
      .map((c) => ({ label: String(c.label), rate: Number(c.rate) })));
    const rateSum = live.reduce((a, l) => a + Number(l.rate || 0), 0);
    const taxTotal = Math.round(((sub * rateSum) / 100) * 100) / 100;
    // The split the SHEET will carry, frozen the way a real issued bill freezes it, so the preview
    // cannot drift from the paper the way it just did.
    let run = 0;
    const taxLines = live.map((l, i) => {
      const amt = i === live.length - 1 ? Math.round((taxTotal - run) * 100) / 100
        : Math.round(((sub * Number(l.rate || 0)) / 100) * 100) / 100;
      run = Math.round((run + amt) * 100) / 100;
      return { label: l.label, rate: Number(l.rate || 0), amt };
    });
    const html = BILLDOC.banquetDocHtml({
      bill: {
        bill_no: bqSample, issued_at: new Date().toISOString(),
        subtotal: sub, discount: 0, tax: taxTotal, total: Math.round((sub + taxTotal) * 100) / 100,
        received: 25000, tax_lines: taxLines,
        // The invented event — only the fields this restaurant actually ticked reach the sheet,
        // because that is the whole point of the tick list above.
        cust_name: "Mehta family", cust_phone: "98250 12345", func: "Wedding reception",
        fn_date: "2026-08-14", pax: plates, rate, hall: "Banquet hall 1",
        cust_gstin: "24ABCDE1234F1Z5", cust_addr: "12 Ring Road, Ahmedabad 380015",
        remark: "Jain menu for 20", prepared_by: "Aevidine",
      },
      lines: [{ title: "Event catering — set menu", qty: plates, price: rate }],
      settings: draft, restaurant: restForDoc(), logo: logoUrl,
      // A PREVIEW MEASURES, IT DOES NOT FIRE THE PRINT DIALOG (2026-08-05) — the same rule the bill
      // preview has always followed. This sheet used to auto-print unconditionally, so tapping
      // "see the banquet bill" threw a print dialog at the admin, and with no toolbar the window
      // could then only be closed with the browser's own controls.
      autoPrint: false,
      note: "A sample banquet bill from this restaurant's own settings — the exact sheet the manager panel prints. It carries an advance, a remark, a receiver GSTIN and a function line so the busiest version of the layout is visible.",
    });
    const w = window.open("", "lfh_banquet_preview", "width=820,height=980");
    if (!w) { setErr("Allow pop-ups to preview the banquet bill."); return; }
    try { w.document.open(); } catch { /* reused window: start blank */ }
    w.document.write(html); w.document.close();
    try { w.focus(); } catch { /* already in front */ }
  };

  // ── QR helpers ────────────────────────────────────────────────────────────
  const qrUrl = (code: string) => `${window.location.origin}/q/${code}`;
  const tableLabel = (t: number) => {
    const names = (draft.table_names || {}) as Record<string, string>;
    const nm = (names[String(t)] || "").trim();
    return nm ? `${nm} (T${t})` : `Table ${t}`;
  };
  const copyLink = async (code: string, t: number) => {
    try { await navigator.clipboard.writeText(qrUrl(code)); setMsg(`Copied ${tableLabel(t)}'s link.`); }
    catch { setErr("Couldn't copy — select and copy the link by hand."); }
  };
  const downloadQr = async (code: string, t: number) => {
    setQrBusy(`dl:${t}`);
    try {
      const QR = (await import("qrcode")).default;
      const dataUrl = await QR.toDataURL(qrUrl(code), { width: 640, margin: 2 });
      const a = document.createElement("a");
      a.href = dataUrl; a.download = `${restaurant.slug}-table-${t}-qr.png`; a.click();
    } catch { setErr("Couldn't build the QR image."); }
    finally { setQrBusy(null); }
  };
  const regenCode = async (t: number) => {
    if (!window.confirm(`Give ${tableLabel(t)} a NEW code?\n\nThe QR already printed for this table stops working immediately — you'll need to print the new one.`)) return;
    setQrBusy(`rg:${t}`); setErr(null);
    try {
      const r = await fetch("/api/admin/restaurants/settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurant_id: restaurant.id, action: "regen_code", table: t }),
      });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't make a new code.");
      setCodes((c) => ({ ...c, [String(t)]: d.code }));
      setMsg(`${tableLabel(t)} has a new code — print its new QR.`);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setQrBusy(null); }
  };
  const printSheet = async () => {
    setQrBusy("sheet");
    try {
      const QR = (await import("qrcode")).default;
      const count = savedCount;
      const cells: string[] = [];
      // A TABLE WITH NO CODE MUST NOT VANISH FROM THE SHEET IN SILENCE (T16 sweep #7, 2026-08-27).
      // The loop skipped it and printed a sheet one QR short, which is only noticed at the table
      // when a diner cannot scan. Codes are minted on load, so this is rare — but "rare and silent"
      // is exactly the shape that costs a service. Named below.
      const missing: number[] = [];
      for (let t = 1; t <= count; t++) {
        const code = codes[String(t)];
        if (!code) { missing.push(t); continue; }
        const dataUrl = await QR.toDataURL(qrUrl(code), { width: 480, margin: 2 });
        cells.push(`<div class="cell"><img src="${dataUrl}" alt=""><div class="lbl">${tableLabel(t).replace(/</g, "&lt;")}</div><div class="code">/q/${code}</div></div>`);
      }
      const w = window.open("", "_blank");
      if (!w) { setErr("Allow pop-ups to open the print sheet."); return; }
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${restaurant.name.replace(/</g, "&lt;")} — table QR codes</title>
        <style>body{font-family:system-ui,sans-serif;margin:20px;color:#000}
        .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:26px}
        .cell{text-align:center;page-break-inside:avoid;border:1px dashed #bbb;border-radius:12px;padding:14px}
        img{width:100%;max-width:300px} .lbl{font-size:19px;font-weight:800;margin-top:6px}
        .code{font-family:ui-monospace,monospace;font-size:12px;color:#555;margin-top:2px}
        @media print{.cell{border-color:#ddd}}</style></head>
        <body onload="setTimeout(function(){window.print()},150)"><div class="grid">${cells.join("")}</div></body></html>`);
      w.document.close();
      if (missing.length) {
        setErr(`${missing.length} table${missing.length === 1 ? "" : "s"} had no code yet and ${missing.length === 1 ? "is" : "are"} not on the sheet: ${missing.map((t) => tableLabel(t)).join(", ")}. Reopen this card to mint them, then print again.`);
      }
    } catch { setErr("Couldn't build the print sheet."); }
    finally { setQrBusy(null); }
  };

  // ── small render helpers ──────────────────────────────────────────────────
  // Both default ON when the column is missing (a fresh restaurant), matching mig 227.
  const custRequired = draft.bill_customer_required !== false;
  const custPrint = draft.bill_customer_print !== false;
  const field = (label: string, k: string, opts: { type?: string; ph?: string; hint?: string; min?: number; max?: number; step?: string | number; maxWidth?: number; auto?: boolean } = {}) => (
    <label style={{ ...labelStyle, ...(opts.maxWidth ? { maxWidth: opts.maxWidth } : {}) }}>
      {label}
      <input
        type={opts.type || "text"} value={String(draft[k] ?? "")} placeholder={opts.ph}
        min={opts.min} max={opts.max} step={opts.step} disabled={!loadOk || busy}
        onChange={(e) => {
          set(k, e.target.value);
          // opts.auto: this field saves itself (debounced) — see autoSave. Only fires once the
          // typed value is a real number in range, so a momentarily empty box saves nothing.
          if (opts.auto) {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= (opts.min ?? -Infinity) && n <= (opts.max ?? Infinity)) autoSave(k, n);
          }
        }}
        onBlur={opts.auto ? (e) => {
          // Leaving the box settles it. Typing 40 in a 2-12 field is skipped by the onChange
          // guard above (we must not write nonsense), which would otherwise leave the field
          // SHOWING 40 while the floor is still on 8 — a control lying about the saved value.
          // On blur we clamp and save, so what you see is always what is stored.
          const raw = e.target.value.trim();
          const lo = opts.min ?? -Infinity, hi = opts.max ?? Infinity;
          const n = Number(raw);
          const fixed = raw === "" || !Number.isFinite(n) ? Number(base[k]) : Math.min(Math.max(n, lo), hi);
          if (Number.isFinite(fixed) && String(fixed) !== raw) set(k, fixed);
          // Blur means the value is settled, so it goes now rather than on the keystroke debounce.
          if (Number.isFinite(fixed) && fixed !== Number(base[k])) autoSaveNow(k, fixed);
        } : undefined}
        style={{ ...inputStyle, marginTop: 4 }}
      />
      {/* Both of these are inline <span>s, so with a hint AND the auto-save note the two ran
          together as one sentence — "Fewer = bigger tiles.Saves on its own" (spotted on the
          moved Tables card, 2026-08-01). display:block puts each on its own line. */}
      {opts.hint && <span className="adm-muted" style={{ ...hintStyle, display: "block" }}>{opts.hint}</span>}
      {opts.auto && savedHint(k)}
    </label>
  );
  // pickNumber: choose a whole number from a list instead of typing one (owner, 2026-08-02:
  // "don't keep a number where I can add anything"). It saves itself the moment you pick, and
  // it deletes a whole class of problem the typing box needed code to survive — no clamping, no
  // correcting the field on blur, and no way to send the database a number it refuses.
  const pickNumber = (label: string, k: string, lo: number, hi: number) => {
    // Until this restaurant's settings have arrived there is no value to show, and a drop-down
    // that falls back to the lowest option DISPLAYS A REAL NUMBER THAT ISN'T THE SAVED ONE for
    // as long as the load takes (caught in verification: it read "2" while the floor was on 5).
    // An empty placeholder is the honest state — same as the typing box it replaced, which sat
    // blank rather than inventing a number.
    const raw = Math.round(Number(draft[k]));
    const known = Number.isFinite(raw);
    const cur = known ? Math.min(Math.max(raw, lo), hi) : NaN;
    return (
      <label style={labelStyle}>
        {label}
        <select
          value={known ? String(cur) : ""} disabled={!loadOk || busy || !known}
          onChange={(e) => { const n = Number(e.target.value); if (!Number.isFinite(n)) return; set(k, n); autoSaveNow(k, n); }}
          style={{ ...inputStyle, marginTop: 4 }}
        >
          {!known && <option value="">—</option>}
          {Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        {savedHint(k)}
      </label>
    );
  };
  // `auto` = this switch is a discrete control, so it saves itself the moment it is tapped. Left
  // off, it behaves exactly as before (the Save bar owns it) — the seven other switches on this
  // card keep that behaviour, so no existing call site changes.
  //
  // ── AND AN AUTO SWITCH REPORTS ITSELF, LIKE EVERY OTHER SELF-SAVING CONTROL (T19 sweep #8,
  //    2026-09-04) ──────────────────────────────────────────────────────────────────────────────
  // This was the ONE self-saving control with no line under it. `field`, `pickNumber` and
  // `choiceCards` all print savedHint(); this printed nothing, and a self-saving key is also kept
  // out of `dirtyKeys`, so no Save bar could speak for it either. Measured on French House: tapping
  // "Let individual dishes differ from this" wrote item_tax_modes_allowed = true to the database
  // and the screen said nothing at all — while the radio group two centimetres above it said
  // "Saves on its own". That is the exact rule the owner set on 2026-08-20: "it should be written
  // that this has been saved, and that return will only come when it is actually been saved."
  //
  // A fragment, not a wrapper div: every `auto` call site sits in a `display:grid` column, so the
  // hint takes the next row on its own instead of being squeezed beside the pill.
  const boolToggle = (label: string, k: string, on: boolean, opts: { auto?: boolean } = {}) => (
    <>
      <button type="button" className={`adm-toggle ${on ? "on" : "off"}`} disabled={!loadOk || busy}
        onClick={() => { set(k, !on); if (opts.auto) autoSaveNow(k, !on); }}
        title={on ? "On — tap to turn off" : "Off — tap to turn on"}>
        <span>{label}</span><span className="pill">{on ? "ON" : "OFF"}</span>
      </button>
      {opts.auto ? savedHint(k) : null}
    </>
  );
  // A pick-one question where each answer needs a WORKED EXAMPLE under it. A <select> can't
  // carry that — and these three answers change what every bill means, so the explanation has
  // to be visible while choosing, not hidden behind an opened drop-down. Same visual grammar as
  // the banquet tick list further down (bordered row, bold answer, muted line beneath), and it
  // saves itself on pick like the other discrete controls.
  const choiceCards = (k: string, cur: string, opts: { value: string; label: string; ex: string }[]) => (
    <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
      {opts.map((o) => (
        <label key={o.value} style={{
          display: "flex", gap: 10, alignItems: "flex-start", cursor: loadOk && !busy ? "pointer" : "default",
          border: "var(--border)", borderRadius: 9, padding: "9px 11px", opacity: loadOk ? 1 : 0.6,
          background: cur === o.value ? "color-mix(in srgb, var(--accent) 9%, transparent)" : "transparent",
        }}>
          <input type="radio" name={`${k}-${restaurant.id}`} checked={cur === o.value} disabled={!loadOk || busy}
            style={{ marginTop: 3 }}
            onChange={() => { set(k, o.value); autoSaveNow(k, o.value); }} />
          <span>
            <b style={{ fontSize: 13 }}>{o.label}</b>
            <span className="adm-muted" style={{ display: "block", fontSize: 11.5, lineHeight: 1.45 }}>{o.ex}</span>
          </span>
        </label>
      ))}
      {savedHint(k)}
    </div>
  );

  const comps = (Array.isArray(draft.tax_components) ? draft.tax_components : []) as TaxComp[];
  const compTotal = Math.round(comps.reduce((a, c) => a + (Number(c?.rate) || 0), 0) * 100) / 100;
  const taxWord = String(draft.tax_label || "Tax").trim() || "Tax";
  const setComp = (i: number, key: "label" | "rate", v: string) =>
    set("tax_components", comps.map((c, j) => (j === i ? { ...c, [key]: v } : c)));

  // ── GST and prices (mig 270) ──────────────────────────────────────────────
  // The examples underneath each answer use THIS restaurant's configured rate, worked out by
  // the same helper the bill uses. A generic "5%" example on a 12% restaurant is a worked
  // example that teaches the wrong number.
  const gstRate = effectiveTaxRate(draft);
  const rup = (n: number) => {
    const v = Math.round(n * 100) / 100;
    return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
  };
  const EG = 280;                                   // one ordinary dish, so the sum is easy to follow
  const egNet = Math.round((EG / (1 + gstRate)) * 100) / 100;
  const priceMode = ["excl", "incl", "composition"].includes(String(draft.price_tax_mode))
    ? String(draft.price_tax_mode) : "excl";
  const itemModes = draft.item_tax_modes_allowed === true;
  const mrpMode = String(draft.mrp_tax_treatment) === "inclusive" ? "inclusive" : "none";

  // Banquet bill (mig 237): the field list this restaurant is asked to fill, and a
  // live preview of the next bill number in the chosen style.
  const bqFields = cleanBanquetFields(draft.banquet_fields);
  // THE "+ ADD TAX" BUTTON DID NOTHING, and this is why (owner, 2026-08-01). The editor was
  // driven by banquetTaxOf(), which is the PRINTING reader: it drops any row with a blank label
  // or a zero rate, quite rightly, so a made-up tax never reaches a bill. Adding a row appends
  // exactly that — a blank label and a blank rate — so the reader threw it away on the very next
  // render and nothing appeared. Editing was broken the same way: the map ran over the FILTERED
  // list, so once any row was incomplete the indexes no longer matched what was stored.
  //
  // The editor works on the RAW stored list; banquetTaxOf stays the reader for what actually
  // prints. Same shape as the menu tax rows just above, which never had this problem.
  const bqTaxRaw = (Array.isArray(draft.banquet_tax_components) ? draft.banquet_tax_components : []) as TaxComp[];
  const bqTax = bqTaxRaw;
  const bqTaxTotal = Math.round(banquetTaxOf(draft).reduce((a, c) => a + c.rate, 0) * 100) / 100;
  const setBqTax = (i: number, key: "label" | "rate", v: string) =>
    set("banquet_tax_components", bqTaxRaw.map((c, j) => (j === i ? { ...c, [key]: v } : c)));
  const bqSample = banquetBillNo(
    String(draft.banquet_bill_prefix || "BQB"),
    String(draft.banquet_bill_style || "fy"),
    Math.max(1, Math.round(Number(draft.banquet_bill_next)) || 1),
  );

  const perRow = clampPerRow(draft.floor_per_row);
  const draftCount = Math.min(Math.max(Math.round(Number(draft.table_count)) || 12, 1), 500);
  const savedCount = Math.min(Math.max(Math.round(Number(base.table_count)) || 12, 1), 500);
  const seats = (draft.table_seats || {}) as Record<string, number | string>;
  const names = (draft.table_names || {}) as Record<string, string>;
  const setSeat = (t: number, v: string) => set("table_seats", { ...seats, [String(t)]: v });
  // ── AN EMPTY SEATS BOX MEANS "USE THE DEFAULT", NOT "ONE SEAT" (T16 sweep #7, 2026-08-27) ─────
  // The card promises "how many people can sit there (nothing set = 4)". Clearing the box left an
  // empty STRING in table_seats, and the save route does `Math.round(Number(v))` → Number("") is
  // 0 → clamped into 1..30 → the table was stored with ONE seat. The floor and the tablet then
  // drew "1" beside the chair, on a table the admin had just tried to reset. Dropping the key on
  // blur is what makes the promise true: no key ⇒ the readers fall back to their own default.
  // On blur, not on change, so the box can be emptied and retyped without it refilling under the
  // cursor — the same rule the number fields above follow.
  const settleSeat = (t: number, v: string) => {
    if (v.trim() !== "") return;
    const next = { ...seats };
    delete next[String(t)];
    set("table_seats", next);
  };
  const setName = (t: number, v: string) => set("table_names", { ...names, [String(t)]: v });

  if (loadErr) {
    return (
      <div className="adm-card" style={{ marginBottom: 14 }}>
        <h2>Billing · KOT · Sessions · Tables</h2>
        <p className="hint">Couldn&rsquo;t load this restaurant&apos;s settings — editing is locked so you don&rsquo;t overwrite them by mistake.</p>
        <button className="adm-btn" onClick={load}>Retry</button>
      </div>
    );
  }

  return (
    <>
      {/* The "Tax word on screen" card used to sit here. REMOVED 2026-08-01 (owner: "there is no
          need for this option — it will never be changed, it will be written as Tax for all
          times"). The column still exists and every restaurant stores NULL, which already renders
          "Tax", so nothing on any bill moves; there is simply no longer a field to change it. */}
      {show("billing") && (
      <div id="det-billing" className="adm-card" style={{ marginBottom: 14 }}>
        <h2>🧾 The bill, as it prints</h2>
        <p className="hint">
          Everything here prints on the customer&apos;s bill exactly as typed, pre-filled with what it
          prints <b>right now</b>. <b>Invoice prefix</b> + financial year build the number
          (e.g. <code>INV/2025-26/000042</code>) — the running number itself is made by the server;
          nobody can edit the sequence.
        </p>
        {/* GSTIN, the legal name and the address used to be three separate rows on the Access
            screen sitting above this card — four boxes describing one document (owner,
            2026-08-01: "unnecessary sub-options… it should be as format of bill"). They are
            fields on this form now, so the bill has exactly one place that owns it. */}
        <div className="adm-grid2" style={{ gap: 12 }}>
          {field("Legal name on the bill", "restaurant_name", { hint: "As it should appear on a tax invoice — often not the trading name." })}
          {field("GSTIN", "gstin", { ph: "e.g. 24ABCDE1234F1Z5", hint: "Leave it empty and bills print without one. Never put a made-up number on a real bill." })}
        </div>
        <div style={{ marginTop: 12 }}>
          {field("Address on the bill", "restaurant_address", { ph: "Street, city, PIN" })}
        </div>
        <div className="adm-grid2" style={{ gap: 12, marginTop: 12 }}>
          {field("Phone", "restaurant_phone", { ph: "+91 …" })}
          {field("Invoice prefix", "invoice_prefix")}
        </div>
        <div style={{ marginTop: 12 }}>
          {field("Bill footer message", "bill_footer", { hint: "Printed at the very bottom of the customer's bill, e.g. “Thank you — visit again!”." })}
        </div>

        {/* ── Customer on the bill (owner, 2026-07-30) ──────────────────────────
            Two separate decisions on purpose: ASK for the guest's mobile + name (which
            is what builds the repeat-guest list and makes the name auto-fill next time),
            and PRINT those two lines on the paper. A restaurant can do the first without
            the second. The (i) below spells that out for whoever flips these. */}
        {/* SEE IT BEFORE A GUEST DOES. Opens a made-up bill using this restaurant's real header,
            taxes and footer — and its logo if one is uploaded, which is how the "image on top,
            otherwise start with the name" rule is checked without settling a real table. */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
          <button className="adm-btn" onClick={previewBill}>🧾 Preview the bill</button>
          <span className="adm-muted" style={{ fontSize: 11.5 }}>
            {logoUrl ? "Your logo prints at the top." : "No logo uploaded — the bill starts with the name. Add one in Design and styling → Theme and logo."}
          </span>
        </div>

        <h3 style={{ margin: "18px 0 4px", fontSize: 13.5 }}>Customer on the bill</h3>
        <div style={{ display: "grid", gap: 8, maxWidth: 480 }}>
          {boolToggle("Ask for mobile + name before a bill", "bill_customer_required", custRequired)}
          {boolToggle("Print customer name & mobile on the bill", "bill_customer_print", custPrint)}
          <details className="adm-muted" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
            <summary style={{ cursor: "pointer", userSelect: "none" }}
              title="Asking and printing are separate: the details are always saved, the switch only decides whether they appear on the paper.">
              ⓘ How these two work together
            </summary>
            <div style={{ marginTop: 7, display: "grid", gap: 7 }}>
              <p style={{ margin: 0 }}>
                <b>Ask for mobile + name</b>{" "}— with this on, the waiter is asked for the guest&apos;s
                mobile number first, then the name, and <b>no bill can be generated without both</b>.
                Typing the number searches this restaurant&apos;s own customer list: a number that has
                been here before fills its name in by itself, a new one shows a small green
                “New customer”. The pair is saved to the bill and to the customer list either way —
                that is what makes the name come back on the next visit.
              </p>
              <p style={{ margin: 0 }}>
                <b>Print customer name &amp; mobile</b>{" "}— controls the <b>paper only</b>. On: the bill
                shows a Customer and a Mobile line above the items. Off: the bill prints without them
                and the details are still collected and saved exactly the same. Bills already printed
                never change.
              </p>
              <p style={{ margin: 0 }}>
                Turning <b>asking</b> off also means nothing new is collected, so no name or number can
                appear on new bills.
              </p>
            </div>
          </details>
        </div>

        {/* ── GST AND PRICES (mig 270, owner 2026-08-04) ─────────────────────────
            "The price I type for a dish — does GST get added on top of it, or is it already
            inside?" Everything on a bill follows this one answer, so it sits ABOVE the tax rows
            it governs. All three are admin-only: no owner and no manager screen offers them. */}
        <h3 style={{ margin: "18px 0 4px", fontSize: 13.5 }}>GST and prices</h3>
        <p className="hint">
          What the prices typed into this restaurant&apos;s menu <b>mean</b>. The bill, the guest&apos;s cart
          and the reports all follow this one answer, so they can never show different totals.
          Examples use this restaurant&apos;s own rate ({Math.round(gstRate * 10000) / 100}%).
        </p>
        {choiceCards("price_tax_mode", priceMode, [
          { value: "excl", label: "GST is added on top", ex: `A ${rup(EG)} dish becomes ${rup(EG * (1 + gstRate))} on the bill. This is how it works today.` },
          { value: "incl", label: "The price already includes GST", ex: `A ${rup(EG)} dish stays ${rup(EG)} (${rup(egNet)} + ${rup(EG - egNet)} GST). The guest pays the price on the menu.` },
          { value: "composition", label: "Composition scheme — no GST shown", ex: "No GST line is shown to the diner at all. Nothing is added to any price." },
        ])}
        {priceMode === "composition" && (
          <p className="hint" style={{ marginTop: 8, borderLeft: "3px solid var(--adm-danger, #dc2626)", paddingLeft: 10 }}>
            <b>Every bill loses its tax line.</b> A composition-scheme restaurant pays a flat rate itself and may
            not charge GST to a diner, so no tax row prints on any bill and nothing is added to a price. Only pick
            this if the restaurant really is registered under the composition scheme.
          </p>
        )}

        <div style={{ display: "grid", gap: 8, maxWidth: 560, marginTop: 14 }}>
          {boolToggle("Let individual dishes differ from this", "item_tax_modes_allowed", itemModes, { auto: true })}
          <span className="adm-muted" style={{ fontSize: 11.5, lineHeight: 1.45 }}>
            Needed for MRP items like sealed water bottles, whose printed price is final. <b>Off</b> — where every
            restaurant starts — means every dish follows the setting above and a dish&apos;s own tax choice is ignored
            completely, not just hidden.
          </span>
        </div>

        {itemModes && (
          <div style={{ marginTop: 14 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 13.5 }}>MRP items</h3>
            <p className="hint">
              How an MRP line is treated underneath. <b>The guest pays the same either way</b> — never a rupee above
              the printed MRP. This only decides what the restaurant declares.
            </p>
            {choiceCards("mrp_tax_treatment", mrpMode, [
              { value: "none", label: "No GST on MRP items", ex: "The line carries no GST at all — nothing is added to the printed price and nothing is declared on it." },
              { value: "inclusive", label: "GST is inside the MRP price", ex: "The GST is taken out of the MRP and declared. The guest still pays exactly the MRP; this is the cleaner one for the books." },
            ])}
          </div>
        )}

        <h3 style={{ margin: "18px 0 4px", fontSize: 13.5 }}>Tax lines on the print</h3>
        <p className="hint">
          The taxes that make up your total (e.g. <b>CGST 2.5%</b> + <b>SGST 2.5%</b>). Each prints as its own
          line; on screen they show merged as one “{taxWord} <b>{compTotal}%</b>” line — the split and the total can never disagree.
        </p>
        <div style={{ display: "grid", gap: 8, maxWidth: 480 }}>
          {comps.map((c, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 92px 22px 36px", gap: 8, alignItems: "center" }}>
              <input value={String(c?.label ?? "")} placeholder="e.g. CGST" maxLength={24} disabled={!loadOk || busy}
                onChange={(e) => setComp(i, "label", e.target.value)} style={inputStyle} />
              <input type="number" step="any" min={0} max={100} value={String(c?.rate ?? "")} placeholder="%" disabled={!loadOk || busy}
                onChange={(e) => setComp(i, "rate", e.target.value)} style={inputStyle} />
              <span className="adm-muted" style={{ fontWeight: 700 }}>%</span>
              <button className="adm-btn" title="Remove this tax" disabled={!loadOk || busy}
                onClick={() => set("tax_components", comps.filter((_, j) => j !== i))} style={{ padding: "6px 9px" }}>
                <i className="fas fa-trash" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 700, margin: "8px 0" }}>Total tax: <b>{compTotal}%</b></div>
        <button className="adm-btn" disabled={!loadOk || busy || comps.length >= 6}
          onClick={() => set("tax_components", [...comps, { label: "", rate: "" }])}>+ Add tax</button>
        <div style={{ maxWidth: 240, marginTop: 14 }}>
          {/* "Fallback tax rate" was here. REMOVED 2026-08-01 (owner: "remove the fallback tax rate
              from the format of bill — it is confusing, I don't get it"). It only ever applied if
              every named tax row was deleted, which is a state no real bill wants. The column is
              untouched, so nothing a restaurant already stores changes. */}
        </div>
      </div>
      )}

      {/* ═══ BANQUET BILL (mig 237) — what this restaurant is ASKED for ═══════
          Owner, 2026-07-31: "only ask for what's necessary … the restaurant will only
          get to choose what they fill." Unticking a box removes it from the manager's
          bill screen AND from the printed paper. The tax-sensitive parts are not on
          this list at all — they are filled by the server (BANQUET_LOCKED). */}
      {show("banquet") && (
      <div id="det-banquet" className="adm-card" style={{ marginBottom: 14 }}>
        <h2>🎪 Banquet bill — what this restaurant fills in</h2>
        {/* This card now sits inside the Banquet-billing row itself, so the old "…switched on in
            Access & permissions" pointed at the switch directly above it (2026-08-01). */}
        <p className="hint">
          Tick a box and the manager is asked for it when they start an event; untick it and it disappears from
          their screen and from the bill — no empty boxes to guess at.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 12px" }}>
          {(["simple", "company", "full"] as const).map((k) => {
            const same = [...bqFields].sort().join(",") === [...BANQUET_PRESETS[k]].sort().join(",");
            return (
              <button key={k} type="button" className={`adm-toggle ${same ? "on" : "off"}`} disabled={!loadOk || busy}
                style={{ width: "auto", padding: "7px 12px" }}
                onClick={() => set("banquet_fields", [...BANQUET_PRESETS[k]])}>
                <span>{k === "simple" ? "Simple (default)" : k === "company" ? "Company / GST bills" : "Everything"}</span>
              </button>
            );
          })}
        </div>
        {/* Two columns — the tick list was one long single-file scroll of eleven rows, which is
            most of why this card felt endless (owner, 2026-08-01: "the UI is really short… make it
            as user-friendly as possible"). */}
        <div className="bq-fields">
          {BANQUET_FIELDS.map((f) => {
            const on = bqFields.includes(f.key);
            return (
              <label key={f.key} style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer",
                border: "var(--border)", borderRadius: 9, padding: "9px 11px", opacity: loadOk ? 1 : 0.6 }}>
                <input type="checkbox" checked={on} disabled={!loadOk || busy} style={{ marginTop: 3 }}
                  onChange={(e) => set("banquet_fields", e.target.checked
                    ? [...bqFields, f.key]
                    : bqFields.filter((k) => k !== f.key))} />
                <span>
                  <b style={{ fontSize: 13 }}>{f.label}</b>
                  <span className="adm-muted" style={{ display: "block", fontSize: 11.5, lineHeight: 1.45 }}>{f.what}</span>
                </span>
              </label>
            );
          })}
        </div>
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700 }}>🔒 Filled by the app — nobody can type over these</summary>
          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
            {BANQUET_LOCKED.map(([t, d]) => (
              <div key={t} style={{ fontSize: 12 }}>
                <b>{t}</b> <span className="adm-muted">— {d}</span>
              </div>
            ))}
          </div>
        </details>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
          <button className="adm-btn" onClick={previewBanquet}>🎪 Preview the banquet bill</button>
          <span className="adm-muted" style={{ fontSize: 11.5 }}>An invented event, with your fields, numbering and tax.</span>
        </div>

        <h3 className="bq-h">Its own bill numbers</h3>
        <p className="hint">
          A banquet bill never shares a number with a table bill. Set the series to continue from whatever this
          restaurant&apos;s accountant already files — <b>the starting number locks itself</b> once the first banquet bill
          is issued, and from then on the app fills every number (nobody can type, skip or reuse one).
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 130px", gap: 10, maxWidth: 560, alignItems: "end" }}>
          {field("Prefix", "banquet_bill_prefix", { ph: "BQB" })}
          <label style={labelStyle}>Style
            <select value={String(draft.banquet_bill_style || "fy")} disabled={!loadOk || busy}
              onChange={(e) => set("banquet_bill_style", e.target.value)} style={{ ...inputStyle, marginTop: 4 }}>
              <option value="fy">BQB/2026-27/000006 — running year series</option>
              <option value="date">BQB-140826-6 — date + counter</option>
              <option value="plain">BQB-000006 — plain running number</option>
            </select>
          </label>
          {field("Start from", "banquet_bill_next", { type: "number", min: 1, step: 1 })}
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          Next bill prints as <b>{bqSample}</b>.
        </p>

        <h3 className="bq-h">Tax on a banquet bill</h3>
        <p className="hint">
          A banquet is usually taxed differently from a table: restaurant service is <b>5%</b> (CGST 2.5 + SGST 2.5)
          while a banquet / catering with food is <b>18%</b> (CGST 9 + SGST 9). Set the banquet lines here and dine-in
          keeps its own rate. <b>Leave this empty</b> and a banquet is taxed exactly like the rest of the menu
          ({compTotal}%).
        </p>
        <div style={{ display: "grid", gap: 8, maxWidth: 480 }}>
          {bqTax.map((c, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 92px 22px 36px", gap: 8, alignItems: "center" }}>
              <input value={String(c?.label ?? "")} placeholder="e.g. CGST" maxLength={24} disabled={!loadOk || busy}
                onChange={(e) => setBqTax(i, "label", e.target.value)} style={inputStyle} />
              <input type="number" step="any" min={0} max={100} value={String(c?.rate ?? "")} placeholder="%" disabled={!loadOk || busy}
                onChange={(e) => setBqTax(i, "rate", e.target.value)} style={inputStyle} />
              <span className="adm-muted" style={{ fontWeight: 700 }}>%</span>
              <button className="adm-btn" title="Remove this tax" disabled={!loadOk || busy}
                onClick={() => set("banquet_tax_components", bqTax.filter((_, j) => j !== i))} style={{ padding: "6px 9px" }}>
                <i className="fas fa-trash" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "8px 0" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>
            Banquet tax: <b>{bqTaxTotal > 0 ? `${bqTaxTotal}%` : `${compTotal}% (same as the menu)`}</b>
            {bqTaxRaw.length && bqTaxTotal === 0 ? <span className="adm-muted" style={{ fontWeight: 600 }}> · fill the name and % to make it count</span> : null}
          </div>
          <button className="adm-btn" disabled={!loadOk || busy || bqTax.length >= 6}
            onClick={() => set("banquet_tax_components", [...bqTax, { label: "", rate: "" }])}>+ Add tax</button>
          {!bqTax.length && (
            <button className="adm-btn" disabled={!loadOk || busy}
              onClick={() => set("banquet_tax_components", [{ label: "CGST", rate: 9 }, { label: "SGST", rate: 9 }])}>
              Use 18% (CGST 9 + SGST 9)
            </button>
          )}
        </div>

        <h3 style={{ margin: "18px 0 4px", fontSize: 13.5 }}>Paper</h3>
        <p className="hint">
          <b>Plain paper</b> (the default) prints the restaurant&apos;s name, address and GSTIN at the top itself.
          <b> Pre-printed pad</b> leaves the top blank for stationery that already carries the letterhead —
          set how much room to leave.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 560 }}>
          <label style={labelStyle}>Prints on
            <select value={String(draft.banquet_paper || "plain")} disabled={!loadOk || busy}
              onChange={(e) => set("banquet_paper", e.target.value)} style={{ ...inputStyle, marginTop: 4 }}>
              <option value="plain">Plain paper — the app prints the header</option>
              <option value="pad">Pre-printed pad — leave the letterhead blank</option>
            </select>
          </label>
          <label style={labelStyle}>Page size
            <select value={String(draft.banquet_paper_size || "a5")} disabled={!loadOk || busy}
              onChange={(e) => set("banquet_paper_size", e.target.value)} style={{ ...inputStyle, marginTop: 4 }}>
              <option value="a5">A5 — 148 × 210 mm</option>
              <option value="a4">A4 — 210 × 297 mm</option>
            </select>
          </label>
          {field("Top space for the letterhead (mm)", "banquet_paper_top", { type: "number", min: 0, max: 80, step: 1, hint: "Only used on a pre-printed pad." })}
          {field("Bottom space kept (mm)", "banquet_paper_bot", { type: "number", min: 0, max: 50, step: 1 })}
          {field("Side margins (mm)", "banquet_paper_side", { type: "number", min: 2, max: 25, step: 1 })}
        </div>
        <div style={{ display: "grid", gap: 8, maxWidth: 560, marginTop: 12 }}>
          {boolToggle("Print the footer line + our GST no.", "banquet_paper_foot", draft.banquet_paper_foot === true)}
          {boolToggle("Print “For <restaurant> / Authorised Signatory”", "banquet_paper_sign", draft.banquet_paper_sign !== false)}
          {boolToggle("Keep the item box ruled to the bottom", "banquet_paper_fill", draft.banquet_paper_fill !== false)}
        </div>
      </div>
      )}

      {/* ═══ KOT PRINTING — same-to-same with the manager's Kitchen section ═══ */}
      {show("kitchen") && (
      <div id="det-kitchen" className="adm-card" style={{ marginBottom: 14 }}>
        <h2><i className="fas fa-print" aria-hidden="true" style={{ marginRight: 8, opacity: .8 }} />Kitchen ticket printing</h2>
        {/* ═══ TWO FACTS, NOT TWO SWITCHES (owner, 2026-08-26, with a screenshot: "why this ui looks
            very shit… make both the option looks on the both mode are clearly visible") ═══
            This card used to carry a SECOND toggle identical to the one on the Access row above it —
            and the two write different things: the row above grants it (auto_print_kot_allowed), this
            one grants AND switches on (both columns) while DISPLAYING the AND of the two. So granting
            it upstairs showed ON above and OFF here, which reads as one switch arguing with itself,
            and nothing printed. Both facts are now shown as facts, with the single action that fixes a
            mismatch — and the switch itself stays in ONE place, upstairs. */}
        <p className="hint" style={{ marginBottom: 12 }}>
          When both of these are yes, a kitchen ticket prints itself the moment an order arrives — the
          dishes to make, no prices — so nobody has to tap print.
        </p>
        <div className="adm-state">
          <div className={`adm-state-row ${kotAllowed ? "yes" : "no"}`}>
            <span className="adm-state-dot" aria-hidden="true" />
            <span className="who"><b>Aevidine allows it</b> — the switch at the top of this row</span>
            <span className="adm-state-val">{kotAllowed === null ? "…" : kotAllowed ? "YES" : "NO"}</span>
          </div>
          <div className={`adm-state-row ${kot ? "yes" : "no"}`}>
            <span className="adm-state-dot" aria-hidden="true" />
            <span className="who"><b>The restaurant has it switched on</b> — their own pause button</span>
            <span className="adm-state-val">{kot === null ? "…" : kot ? "YES" : "NO"}</span>
            {kot === false ? (
              <button type="button" className="adm-btn primary" style={{ fontSize: 12 }} disabled={kotBusy} onClick={toggleKot}>
                Switch it on
              </button>
            ) : null}
          </div>
        </div>
        {kotAllowed && kot === false ? (
          <p className="hint" style={{ margin: "0 0 12px", color: "var(--adm-warn, #f5a524)" }}>
            <i className="fas fa-triangle-exclamation" aria-hidden="true" style={{ marginRight: 6 }} />
            Allowed, but switched off — <b>nothing is printing by itself right now.</b>
          </p>
        ) : null}
        <details className="adm-more">
          <summary>What a kitchen ticket is, and what to set up first</summary>
          <div>
            A KOT is the kitchen&apos;s own slip: the dishes to make, no prices. Set the printer up on the
            machine that will print before switching this on — a printer that is not ready simply means
            tickets wait in the queue, which is safe but invisible to the kitchen. Where the paper comes
            out is the Printing board, not here.
          </div>
        </details>
        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="adm-btn" onClick={previewKot}>
            <i className="fas fa-eye" aria-hidden="true" style={{ marginRight: 6 }} />See a sample ticket
          </button>
          <a className="adm-btn" href={`/aevinite/printing?rid=${encodeURIComponent(restaurant.id)}`}>
            <i className="fas fa-print" aria-hidden="true" style={{ marginRight: 6 }} />Choose the printer
          </a>
        </div>

        {/* ═══ WHERE THE PAPER COMES OUT — ONE BOARD, NOT TWO (2026-08-26) ═══
            This block used to be three radio cards ("kitchen screen / counter screen / both", mig 336).
            Since mig 341 the Printing board answers the same question far better — a computer running
            the helper, or a named panel/person/PC, per kind of paper — and two screens answering one
            question differently is exactly what the owner asked to end. The radios are gone, and so is
            the setting they wrote.
            ── CORRECTED (T19 sweep #8, 2026-09-04): this note used to end "the coarse setting still
            exists underneath for restaurants with no route, and the route now wins when there is one".
            That was true for the two days between this block landing and migration 369, and it has been
            wrong ever since — `kot_print_target` is RETIRED. `KEYS` above says so, the admin save route
            refuses to write it, and a grep of app/, lib/, components/ and public/ finds seven mentions,
            every one of them an obituary comment. There is no fallback underneath. The Printing board is
            the only thing that decides where a kitchen ticket comes out, and a restaurant with no route
            set falls back inside that board (docs/PRINT-HELPER.md), not to a column here. Two comments in
            ONE file disagreeing about whether a retired setting still decides something is how a dead
            path gets revived by the next person to read the friendlier sentence.
            What is left here is the one line worth knowing, and the door to the board that owns it. */}
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "var(--border)" }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Where the paper comes out</h3>
          <div className="adm-elsewhere">
            <span className="lbl">Decided on the</span> <b>Printing</b>
            <span className="lbl">board: which computer or which person&apos;s screen prints each kind of paper.</span>
            <a href={`/aevinite/printing?rid=${encodeURIComponent(restaurant.id)}`}>Open Printing →</a>
          </div>
        </div>

        {/* ═══ THE SETUP GUIDE, IN THE APP (owner, 2026-08-18) ═══
            "Where is this setup in the app? Make it downloadable… link every single key and step…
            or you can make HTML, it will open a whole page." It is a page the app serves, so it is
            always the version that matches the running code. The starter DOWNLOADS are gone (owner,
            2026-08-19: the Mac one showed "Apple could not verify… Move to Bin") — the guide now teaches
            the file by hand in three per-OS menus, which no security layer can block. */}
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "var(--border)" }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>
            <i className="fas fa-book-open" aria-hidden="true" style={{ marginRight: 7, opacity: .8 }} />How to set the printer up
          </h3>
          <p className="hint" style={{ margin: "0 0 10px" }}>
            One menu per computer — <b>Windows</b>, <b>Mac</b>, <b>Linux / Raspberry Pi</b> — every step by
            hand, with a Copy button on the code. Nothing is downloaded, because a downloaded script is
            blocked by macOS and warned about by Windows. Opens as its own page and saves as a PDF.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a className="adm-btn" href="/print-setup.html" target="_blank" rel="noopener">
              <i className="fas fa-book-open" aria-hidden="true" style={{ marginRight: 6 }} />Open the guide
            </a>
            <a className="adm-btn" href="/print-setup.html#windows" target="_blank" rel="noopener">Windows</a>
            <a className="adm-btn" href="/print-setup.html#mac" target="_blank" rel="noopener">Mac</a>
            <a className="adm-btn" href="/print-setup.html#linux" target="_blank" rel="noopener">Linux / Pi</a>
          </div>
        </div>
      </div>
      )}

      {/* ═══ DINING SESSIONS — same-to-same with the manager's section ═══ */}
      {show("sessions") && (
      <div id="det-sessions" className="adm-card" style={{ marginBottom: 14 }}>
        <h2>⏱ Dining sessions</h2>
        {/* The dining-session MASTER switch moved to Access & permissions → Menu → Dining
            sessions (owner, 2026-07-31) — it decides whether the floor has an "Open table"
            step at all, which is a feature decision, not a setting. What stays here are the
            details that only matter once it is on. */}
        {/* This card now sits INSIDE the Dining-sessions row on Access, directly under the switch
            it talks about, so the old "go to Access → Menu → Dining sessions to turn it on" line
            pointed at itself. It just states where things stand (owner, 2026-08-01). */}
        <p className="hint">
          Dining sessions are currently <b>{draft.sessions_enabled === true ? "ON" : "OFF"}</b>
          {draft.sessions_enabled === true
            ? " — guests join a table and staff open it before ordering."
            : " — the floor takes orders directly, with no “Open table” step."}
          {" "}The rules below apply only while it is on.
        </p>
        <div className="adm-togglegrid" style={{ marginBottom: 12 }}>
          {boolToggle("Require location (guest must be near the restaurant)", "require_location", draft.require_location !== false)}
          {boolToggle("Require a phone code (OTP) to place an order", "require_otp", draft.require_otp !== false)}
        </div>
        {/* ── THE PHONE-CODE SWITCH HAS NO SCREEN BEHIND IT YET (T19 sweep #8, 2026-09-04) ─────────
            Turning `require_otp` on is not a stricter version of ordering — it is a full stop.
            `lfh_place_order` (last written in migration 357) refuses EVERY guest order with
            `otp_required` unless that diner's membership carries `phone_verified`, and the only
            thing that can set that flag is `lfh_verify_otp`. Nothing in `app/`, `components/` or
            `public/panels/` calls it: `lib/session.ts` exports `sendOtp`/`verifyOtp` and they have
            no caller, so a guest has no way to enter a code. What the diner is shown instead is
            lib/guestOutbox.ts's translation — "Please confirm your phone number first." — an
            instruction there is no screen to follow.
            The switch is NOT removed: the manager panel carries the same one (public/panels/editor
            /app.js), and phone verification is planned, so deleting one half would leave the other
            half lying. What it gets is the sentence it never had, so nobody switches a restaurant's
            ordering off by mistake. */}
        {draft.require_otp === true ? (
          <p className="hint" role="alert" style={{ margin: "0 0 12px", color: "var(--adm-danger, #dc2626)", borderLeft: "3px solid var(--adm-danger, #dc2626)", paddingLeft: 10 }}>
            <b>Nobody can order here while this is on.</b> The phone-code screen is not built yet, so every
            guest order is refused and the diner is told to confirm a number with nothing to confirm it in.
            Switch it off unless you are testing.
          </p>
        ) : (
          <p className="hint" style={{ margin: "0 0 12px" }}>
            <b>Leave the phone code off.</b> The screen that asks a guest for the code has not been built yet,
            so turning it on stops this restaurant taking any guest orders at all.
          </p>
        )}
        <p className="hint">
          Restaurant location — used only to confirm guests are physically there. In Google Maps, right-click the restaurant
          and click the latitude, longitude numbers to copy them. Leave blank to skip the location check.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, maxWidth: 560 }}>
          {field("Latitude", "geo_lat", { type: "number", step: "any" })}
          {field("Longitude", "geo_lng", { type: "number", step: "any" })}
          {field("Radius (metres)", "geo_radius_m", { type: "number", min: 20, max: 5000, step: 10 })}
        </div>
      </div>
      )}

      {/* ═══ NUMBER OF TABLES PER ROW — ONE box, nothing else ═══════════════════════
          Owner, 2026-08-02: "we don't require this whole thing… you just only need this",
          with a screenshot of a card holding the tables-per-row field and its explanation
          and NOTHING else. What was here and is now gone:
            • Number of tables — moved into Table setting below, where tables are actually
              named and seated (adding a table belongs with the list of tables).
            • Floor layout (Classic / Custom) — the Custom half was never built and was only
              ever shown "for show"; a select with one selectable option is not a choice.
              floor_layout_mode still exists as a column and the editor route still refuses it
              from a manager, so nothing is loosened — there is simply no control.
              WHEN CUSTOM IS BUILT: a per-restaurant plan in public/panels/floor-layouts.js,
              then bring a real selector back here.
            • The box-shape strip and "Preview on the real floor" — previews of a number that
              takes effect the moment it saves. ═══════════════════════════════════════════ */}
      {show("floor") && (
      <div id="det-tables" className="adm-card" style={{ marginBottom: 14 }}>
        <h2>🪑 Floor layout</h2>
        <p className="hint">How your live floor is drawn in the <b>Tables</b> tab.</p>
        <div style={{ width: 200 }}>
          {pickNumber("Tables per row", "floor_per_row", FLOOR_PER_ROW_MIN, FLOOR_PER_ROW_MAX)}
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          <b>Tables per row</b> is exactly that — pick {perRow} and every row has {perRow} boxes on a computer and on a
          bigger tablet. The boxes shrink to fit your number and drop detail as they go (the served count, then the seat
          number, then the wording) while the table number and its colour always stay. Choose any number from{" "}
          {FLOOR_PER_ROW_MIN} to {FLOOR_PER_ROW_MAX}{" "}
          {/* {" "} above is not decoration: JSX drops the leading space of a multi-line text node,
              so "…to 12 — there…" shipped as "…to 12— there…" on the live Access screen. */}
          &mdash; there is nothing to type, so the floor can never be set to a number it won&rsquo;t accept.
        </p>
        {/* Said out loud on the screen that sets the number, because otherwise the first question is
            "I set 12, why does my phone show 2?" (owner's rule, 2026-08-15). */}
        <p className="hint" style={{ marginTop: 8 }}>
          <b>Touchscreens ignore this number, on purpose.</b> A phone held upright always shows <b>2</b> tables a row
          and a phone turned sideways always shows <b>4</b>. A tablet uses your number but never more than <b>6</b> a row,
          so a finger always has a box big enough to hit. Only a <b>computer</b> draws your number in full — and it does
          so at any size, <b>even with the window made small</b>. The floor never slides sideways; it only scrolls down.
        </p>
        <p className="hint" style={{ marginTop: 8 }}>
          How many people fit at each table is set per table in <b>Table setting</b> below — that is the number beside
          the chair on every tile.
        </p>
      </div>
      )}

      {show("tables") && (
      <div className="adm-card" style={{ marginBottom: 14 }}>
        <h2>🪑 Table setting</h2>
        {/* WHAT A RENAME REALLY DOES (T16 sweep, 2026-08-19). This said "bills & QR codes keep the
            number", which is the opposite of the owner's own rule of 2026-07-29 — Aangan renamed
            its ten tables to A1–B2 and asked for the prints to follow, and since PRs #547/#548 the
            NAME wins outright on paper ("A1", no "(T1)" tail). Checked on this page's own bill
            preview: with table 5 named, the bill printed "Table zzt16 Banquet", not "Table 5". So
            the card was telling the admin the reverse of what the printer does. The QR half WAS
            right — a rename never touches a table's code — so only the bill half changes. */}
        <p className="hint">
          How many tables the restaurant has, each table&apos;s <b>name</b> (optional — e.g. the last table as
          &ldquo;Banquet&rdquo;) and how many people can sit there (nothing set = 4). A name shows on the floor tiles
          and table views, and it is <b>what the bill and the kitchen ticket print</b> — so a waiter carries paper that
          matches the floor. Its <b>QR code keeps the number</b> and never changes. Admin-only: the manager can rename
          tables and set seats, but only you can add or remove tables.
        </p>
        <div style={{ width: 200, marginBottom: 12 }}>
          {field("Number of tables", "table_count", { type: "number", min: 1, max: 500, step: 1 })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8, maxHeight: 340, overflowY: "auto", paddingRight: 4 }}>
          {Array.from({ length: draftCount }, (_, i) => i + 1).map((t) => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderRadius: 8, background: "var(--bg)", border: "var(--border)" }}>
              <span style={{ fontWeight: 700, fontSize: 13, minWidth: 28 }}>T{t}</span>
              <input type="text" maxLength={24} value={names[String(t)] ?? ""} placeholder="Name" disabled={!loadOk || busy}
                title='A display name for this table (e.g. "Banquet") — it prints on the bill and the kitchen ticket; the QR code keeps the number'
                onChange={(e) => setName(t, e.target.value)}
                style={{ ...inputStyle, flex: 1, minWidth: 0, padding: "5px 8px" }} />
              <input type="number" min={1} max={30} value={String(seats[String(t)] ?? 4)}
                title="Seats — clear it to go back to the default of 4" disabled={!loadOk || busy}
                onChange={(e) => setSeat(t, e.target.value)}
                onBlur={(e) => settleSeat(t, e.target.value)}
                style={{ ...inputStyle, width: 58, padding: "5px 6px" }} />
            </div>
          ))}
        </div>
      </div>
      )}

      {show("qr") && (
      <div className="adm-card" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>🔗 Guest QR links · one per table</h2>
          <span className="adm-chip" style={{ background: "color-mix(in srgb, var(--accent) 18%, transparent)", color: "var(--accent)" }}>permanent codes</span>
          <button className="adm-btn" style={{ marginLeft: "auto" }} disabled={qrBusy !== null} onClick={printSheet}>
            <i className="fas fa-print" style={{ marginRight: 7 }} aria-hidden="true" />{qrBusy === "sheet" ? "Building…" : "Print sheet — all QRs"}
          </button>
        </div>
        <p className="hint" style={{ marginTop: 6 }}>
          A <b>permanent</b> link for each table, using a private random code — it always opens the guest menu
          for <b>that table only</b>. Because the table number isn&apos;t in the link, typing a different value in the
          address bar shows an error page, never another table. Print a QR once and it works forever; if a
          sticker is damaged or misused, give just that table a <b>new code</b> (the old QR goes dead).
          <br /><b>Admin only:</b> the manager panel doesn&apos;t show table QR links at all — this is the one
          place they live, so a printed code can only be renewed by you.
        </p>
        {draftCount !== savedCount && (
          <p className="hint" style={{ color: "var(--adm-warn, #d97706)" }}>You changed the number of tables — Save first, then the new tables get their codes here.</p>
        )}
        <div style={{ display: "grid", gap: 6, maxHeight: 380, overflowY: "auto", paddingRight: 4 }}>
          {Array.from({ length: savedCount }, (_, i) => i + 1).map((t) => {
            const code = codes[String(t)];
            if (!code) return null;
            return (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: "var(--bg)", border: "var(--border)", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 700, fontSize: 13, minWidth: 86 }}>{tableLabel(t)}</span>
                <span className="adm-muted" style={{ fontSize: 12, minWidth: 52 }}>{String(seats[String(t)] ?? 4)} seats</span>
                <code style={{ flex: 1, minWidth: 120, fontSize: 11.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace" }}>/q/{code}</code>
                <span style={{ display: "flex", gap: 6 }}>
                  <button className="adm-btn" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => copyLink(code, t)} title="Copy this table's full link">⧉ Copy</button>
                  <button className="adm-btn" style={{ padding: "5px 10px", fontSize: 12 }} disabled={qrBusy === `dl:${t}`} onClick={() => downloadQr(code, t)} title="Download this table's QR image">⬇ QR</button>
                  <button className="adm-btn" style={{ padding: "5px 10px", fontSize: 12 }} disabled={qrBusy === `rg:${t}`} onClick={() => regenCode(t)} title="Give this table a NEW code — the old printed QR stops working">↻ New code</button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* The "Auto close / restart tables" card was here. REMOVED 2026-08-01 (owner: "this
          option is also useless, we don't need it — it will be auto set by the session"), and
          on 2026-08-02 the BEHAVIOUR went too (owner: "all served and all marked paid, the table
          restarts — I don't want that"). Nothing ends a table on its own now: the manager's floor
          tile and table detail show ✓ Close once everything is served and the bill is paid, and a
          person decides. lib/autoSettle.ts is deleted and nothing reads auto_table_action. */}

      {(msg || err) && (
        <div role="status" style={{ position: "fixed", left: "50%", bottom: dirty ? 76 : 20, transform: "translateX(-50%)", zIndex: 1001, background: err ? "var(--adm-danger, #e5484d)" : "var(--adm-ok, #16a34a)", color: "#fff", padding: "9px 15px", borderRadius: 10, fontSize: 13, fontWeight: 700, boxShadow: "0 6px 24px rgba(0,0,0,0.25)", maxWidth: "90vw" }}>
          {err || msg}
        </div>
      )}

      {/* The save bar is NOT drawn here any more — see SettingsSaveBar above. */}
    </>
  );
}
