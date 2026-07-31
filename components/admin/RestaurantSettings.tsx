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
import FloorLayoutPreview from "./FloorLayoutPreview";

type Rest = { id: string; slug: string; name: string };
type TaxComp = { label: string; rate: number | string };
type Draft = Record<string, unknown>;

// Every settings-row field this tab owns (used for the dirty-diff and the save patch).
const KEYS = [
  "tax_label", "restaurant_name", "restaurant_address", "restaurant_phone", "gstin",
  "invoice_prefix", "bill_footer", "tax_components", "tax_rate",
  "bill_customer_required", "bill_customer_print",
  "sessions_enabled", "require_location", "require_otp", "geo_lat", "geo_lng", "geo_radius_m",
  "table_count", "table_seats", "table_names", "auto_table_action", "floor_per_row",
] as const;

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 11px", borderRadius: 8, border: "var(--border)",
  background: "var(--bg)", color: "var(--text)", fontSize: 13,
};
const labelStyle: React.CSSProperties = { fontSize: 12, display: "block" };
const hintStyle: React.CSSProperties = { fontSize: 11.5, marginTop: 3 };

export default function RestaurantSettings({ restaurant }: { restaurant: Rest }) {
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
  const [kotBusy, setKotBusy] = useState(false);
  const [qrBusy, setQrBusy] = useState<string | null>(null);
  const [showFloorPreview, setShowFloorPreview] = useState(false);

  // Success/error notes fade on their own (errors linger a little longer to be read).
  useEffect(() => {
    if (!msg && !err) return;
    const id = setTimeout(() => { setMsg(null); setErr(null); }, err ? 5000 : 2600);
    return () => clearTimeout(id);
  }, [msg, err]);

  const load = useCallback(async () => {
    setLoadErr(false);
    try {
      const j = await (await fetch(`/api/admin/restaurants/settings?restaurant_id=${encodeURIComponent(restaurant.id)}`, { cache: "no-store" })).json();
      if (j.error || !j.settings) { setLoadErr(true); return; }
      const s: Draft = { ...j.settings };
      // Open PRE-FILLED with what the bill prints right now (the manager form's rule):
      // brand-safe fields only — address/phone/GSTIN stay placeholders so a Save can
      // never persist a fake value on a not-yet-configured restaurant.
      if (!s.restaurant_name) s.restaurant_name = restaurant.name;
      if (!s.invoice_prefix) s.invoice_prefix = "INV";
      if (!s.bill_footer) s.bill_footer = "Thank you — please visit again";
      if (!s.tax_label) s.tax_label = "Tax";
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
      .then((j) => { if (typeof j.auto_print_kot === "boolean") setKot(j.auto_print_kot); })
      .catch(() => {});
  }, [restaurant.id]);

  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const dirtyKeys = useMemo(
    () => KEYS.filter((k) => JSON.stringify(draft[k] ?? null) !== JSON.stringify(base[k] ?? null)),
    [draft, base],
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
  const discard = () => { setDraft(JSON.parse(JSON.stringify(base))); setErr(null); setMsg(null); };

  // ── AUTO-SAVE, for discrete controls only (owner, 2026-07-30: "I change value to 8 and it
  // doesn't auto save"). Debounced so a drag or fast typing writes ONCE, not per keystroke.
  //
  // Deliberately NOT the whole form. A text field would save half-typed rubbish (a partial
  // GSTIN, an incomplete bill footer), and "Number of tables" is outright dangerous to
  // auto-save: typing 30 passes through "3", which would shrink the floor to three tables and
  // fire the section backfill. Those keep the explicit Save bar. Only bounded values with no
  // data consequence are auto-saved — the same "saves instantly per change" habit the Access
  // per-person selects already use.
  const autoTimer = useRef<number | null>(null);
  const [autoSaved, setAutoSaved] = useState<string | null>(null);
  useEffect(() => () => { if (autoTimer.current) window.clearTimeout(autoTimer.current); }, []);
  const autoSave = (k: string, v: unknown) => {
    if (autoTimer.current) window.clearTimeout(autoTimer.current);
    autoTimer.current = window.setTimeout(async () => {
      setErr(null);
      try {
        const r = await fetch("/api/admin/restaurants/settings", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ restaurant_id: restaurant.id, [k]: v }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Couldn't save.");
        // Trust the SERVER's value, not ours — it clamps (99 → 12), so the field must show
        // what was really stored rather than what was typed.
        const stored = d.settings && k in d.settings ? d.settings[k] : v;
        setDraft((x) => ({ ...x, [k]: stored }));
        setBase((b) => ({ ...b, [k]: stored })); // keeps the Save bar from lighting up for it
        setAutoSaved(k);
        window.setTimeout(() => setAutoSaved((cur) => (cur === k ? null : cur)), 1800);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    }, 600);
  };

  const toggleKot = async () => {
    if (kot === null || kotBusy) return;
    const next = !kot;
    setKotBusy(true); setKot(next); // optimistic
    try {
      const r = await fetch("/api/admin/restaurants/quick-features", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurant_id: restaurant.id, feature: "auto_print_kot", on: next }),
      });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't save.");
      setKot(!!d.auto_print_kot);
    } catch (e) { setKot(!next); setErr(e instanceof Error ? e.message : String(e)); }
    finally { setKotBusy(false); }
  };

  // Same sample ticket as the manager panel's "Preview a sample KOT" button.
  const previewKot = () => {
    const now = new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    const name = String(draft.restaurant_name || restaurant.name || "Restaurant");
    // Show the sample on a REAL table label, so a restaurant that renamed its tables
    // sees on the test print exactly what a live KOT will say ("A5", not "Table 5").
    const sampleNames = (draft.table_names || {}) as Record<string, string>;
    const sampleTable = (sampleNames["5"] || "").trim() || "Table 5";
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Sample KOT</title>
      <style>body{font-family:ui-monospace,monospace;max-width:280px;margin:0 auto;padding:12px;color:#000}
      h2{text-align:center;margin:2px 0 6px;font-size:16px} .r{display:flex;justify-content:space-between;font-size:13px;margin:3px 0}
      hr{border:0;border-top:1px dashed #000;margin:8px 0} .foot{text-align:center;font-size:12px;margin-top:10px}</style></head>
      <body onload="setTimeout(function(){window.print()},80)">
        <h2>KITCHEN TICKET</h2>
        <div class="r"><span>${name.replace(/</g, "&lt;")}</span><span>#SAMPLE</span></div>
        <div class="r"><span>${sampleTable.replace(/</g, "&lt;")}</span><span>${now}</span></div>
        <hr>
        <div class="r"><b>2×</b><span>Margherita Pizza</span></div>
        <div class="r"><b>1×</b><span>Garlic Bread</span></div>
        <div class="r"><b>1×</b><span>Coke — no ice</span></div>
        <hr>
        <div class="foot">— sample test print —</div>
      </body></html>`;
    const w = window.open("", "_blank", "width=340,height=560");
    if (!w) { setErr("Allow pop-ups to preview the KOT."); return; }
    w.document.write(html); w.document.close();
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
      for (let t = 1; t <= count; t++) {
        const code = codes[String(t)];
        if (!code) continue;
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
          if (Number.isFinite(fixed) && fixed !== Number(base[k])) autoSave(k, fixed);
        } : undefined}
        style={{ ...inputStyle, marginTop: 4 }}
      />
      {opts.hint && <span className="adm-muted" style={hintStyle}>{opts.hint}</span>}
      {opts.auto && (
        <span style={{ ...hintStyle, color: autoSaved === k ? "var(--adm-ok, #16a34a)" : "var(--muted)", fontWeight: autoSaved === k ? 700 : 400 }}>
          {autoSaved === k ? "✓ Saved" : "Saves on its own"}
        </span>
      )}
    </label>
  );
  const boolToggle = (label: string, k: string, on: boolean) => (
    <button type="button" className={`adm-toggle ${on ? "on" : "off"}`} disabled={!loadOk || busy}
      onClick={() => set(k, !on)} title={on ? "On — tap to turn off" : "Off — tap to turn on"}>
      <span>{label}</span><span className="pill">{on ? "ON" : "OFF"}</span>
    </button>
  );

  const comps = (Array.isArray(draft.tax_components) ? draft.tax_components : []) as TaxComp[];
  const compTotal = Math.round(comps.reduce((a, c) => a + (Number(c?.rate) || 0), 0) * 100) / 100;
  const taxWord = String(draft.tax_label || "Tax").trim() || "Tax";
  const setComp = (i: number, key: "label" | "rate", v: string) =>
    set("tax_components", comps.map((c, j) => (j === i ? { ...c, [key]: v } : c)));

  const perRow = clampPerRow(draft.floor_per_row);
  const draftCount = Math.min(Math.max(Math.round(Number(draft.table_count)) || 12, 1), 500);
  const savedCount = Math.min(Math.max(Math.round(Number(base.table_count)) || 12, 1), 500);
  const seats = (draft.table_seats || {}) as Record<string, number | string>;
  const names = (draft.table_names || {}) as Record<string, string>;
  const setSeat = (t: number, v: string) => set("table_seats", { ...seats, [String(t)]: v });
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
      {/* ═══ BILLING — same-to-same with the manager's Billing section ═══ */}
      <div id="det-billing" className="adm-card" style={{ marginBottom: 14 }}>
        <h2>🧾 Billing — manager bill, on screen</h2>
        <p className="hint">
          Bills the staff SEE in the manager panel show ONE merged tax line. Rename its word here — the
          amount and % always come from the tax rows in the printed-bill card below (their total: <b>{compTotal}%</b>).
        </p>
        <div style={{ maxWidth: 260 }}>
          {field("Tax word on screen", "tax_label", { hint: `Shows as “${taxWord} ${compTotal}%”. E.g. Tax, GST, VAT.` })}
        </div>
      </div>

      <div className="adm-card" style={{ marginBottom: 14 }}>
        <h2>🧾 Printed bill — what the customer gets</h2>
        <p className="hint">
          Everything below prints on the customer&apos;s bill exactly as typed, pre-filled with what it prints
          <b> right now</b>. <b>Invoice prefix</b> + financial year build the number (e.g. <code>INV/2025-26/000042</code>) —
          the running number itself is made by the server; nobody can edit the sequence.
        </p>
        {/* The legal name, address and GSTIN moved to Access & permissions → Main features →
            Bill (owner, 2026-07-31), so each of those values has exactly ONE editor. Two
            screens writing the same field is how the pair silently drift apart. What stays
            here is the rest of the printed bill, which is not a permission. */}
        <p className="hint" style={{ marginTop: 0 }}>
          <b>Legal name, address and GSTIN</b> are set in{" "}
          <a href={`/aevinite/access?rid=${restaurant.id}&from=rest`}>Access &amp; permissions → Bill</a>{" "}
          so there is only one place that owns them.
        </p>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
            {field("Phone", "restaurant_phone", { ph: "+91 …" })}
            {field("Invoice prefix", "invoice_prefix")}
          </div>
          {field("Bill footer message", "bill_footer", { hint: "Printed at the very bottom of the customer's bill, e.g. “Thank you — visit again!”." })}
        </div>

        {/* ── Customer on the bill (owner, 2026-07-30) ──────────────────────────
            Two separate decisions on purpose: ASK for the guest's mobile + name (which
            is what builds the repeat-guest list and makes the name auto-fill next time),
            and PRINT those two lines on the paper. A restaurant can do the first without
            the second. The (i) below spells that out for whoever flips these. */}
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
          {field("Fallback tax rate (0.05 = 5%)", "tax_rate", { type: "number", step: "any", min: 0, hint: "Used only if you remove every named tax above." })}
        </div>
      </div>

      {/* ═══ KOT PRINTING — same-to-same with the manager's Kitchen section ═══ */}
      <div id="det-kitchen" className="adm-card" style={{ marginBottom: 14 }}>
        <h2>🖨 KOT printing</h2>
        <p className="hint">
          This is for the <b>kitchen</b>, not the bill. When ON, the kitchen screen auto-prints a
          <b> KOT (kitchen order ticket)</b> — the dishes to make, no prices — the moment a new order arrives,
          so cooks never have to click. Set up the kitchen device&apos;s printer first (kiosk-printing Chrome for
          silent prints); leave OFF until the printer is ready. One admin switch — it grants and turns on
          auto-print in one go (the same value Main features &amp; Access show).
        </p>
        <button type="button" className={`adm-toggle ${kot ? "on" : "off"}`} disabled={kot === null || kotBusy} onClick={toggleKot}
          title={kot ? "On — tap to turn off" : "Off — tap to turn on"}>
          <span>Auto-print the KOT when a new order arrives</span><span className="pill">{kot === null ? "…" : kot ? "ON" : "OFF"}</span>
        </button>
        <div style={{ marginTop: 12 }}>
          <button className="adm-btn" onClick={previewKot}>🖨 Preview a sample KOT</button>
          <p className="hint" style={{ margin: "8px 0 0" }}>Opens a test ticket and the print dialog — use it to check the printer &amp; the ticket layout.</p>
        </div>
      </div>

      {/* ═══ DINING SESSIONS — same-to-same with the manager's section ═══ */}
      <div id="det-sessions" className="adm-card" style={{ marginBottom: 14 }}>
        <h2>⏱ Dining sessions</h2>
        {/* The dining-session MASTER switch moved to Access & permissions → Menu → Dining
            sessions (owner, 2026-07-31) — it decides whether the floor has an "Open table"
            step at all, which is a feature decision, not a setting. What stays here are the
            details that only matter once it is on. */}
        <p className="hint">
          The QR/session system is switched on in{" "}
          <a href={`/aevinite/access?rid=${restaurant.id}&from=rest`}>Access &amp; permissions → Menu → Dining sessions</a>.
          It is currently <b>{draft.sessions_enabled === true ? "ON" : "OFF"}</b>
          {draft.sessions_enabled === true
            ? " — guests join a table and staff open it before ordering."
            : " — the floor takes orders directly, with no “Open table” step."}
          {" "}The rules below apply only while it is on.
        </p>
        <div className="adm-togglegrid" style={{ marginBottom: 12 }}>
          {boolToggle("Require location (guest must be near the café)", "require_location", draft.require_location !== false)}
          {boolToggle("Require a phone code (OTP) to place an order", "require_otp", draft.require_otp !== false)}
        </div>
        <p className="hint">
          Café location — used only to confirm guests are physically there. In Google Maps, right-click the café
          and click the latitude, longitude numbers to copy them. Leave blank to skip the location check.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, maxWidth: 560 }}>
          {field("Latitude", "geo_lat", { type: "number", step: "any" })}
          {field("Longitude", "geo_lng", { type: "number", step: "any" })}
          {field("Radius (metres)", "geo_radius_m", { type: "number", min: 20, max: 5000, step: 10 })}
        </div>
      </div>

      {/* ═══ TABLES & QR — same-to-same with the manager's Tables section ═══ */}
      <div id="det-tables" className="adm-card" style={{ marginBottom: 14 }}>
        <h2>🪑 Tables / seating</h2>
        <p className="hint">
          How many tables the restaurant has — this drives its live floor map. Admin-only: the manager can
          rename tables and set seats, but only you can add or remove tables or hand out a table&apos;s QR.
        </p>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ width: 200 }}>
            {field("Number of tables", "table_count", { type: "number", min: 1, max: 500, step: 1 })}
          </div>
          <div style={{ width: 200 }}>
            {field("Tables per row", "floor_per_row", {
              type: "number", min: FLOOR_PER_ROW_MIN, max: FLOOR_PER_ROW_MAX, step: 1, auto: true,
              hint: `${FLOOR_PER_ROW_MIN}–${FLOOR_PER_ROW_MAX}. Fewer = bigger tiles.`,
            })}
          </div>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          <b>Tables per row</b>{" "}sets how many table boxes sit on one line in the manager&apos;s floor view — and so how big
          each box is. It&apos;s a target, not a hard rule: a narrow screen (a phone, or the side panel open) shows fewer
          per row rather than shrinking the boxes until nobody can read them.
        </p>
        {/* Two previews, cheapest first. The shape strip answers "how big is a box?" at a
            glance with zero loading; the button opens the REAL manager floor with a slider
            when the admin wants to be sure before saving. */}
        <div style={{ marginTop: 12, display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px", minWidth: 220, maxWidth: 420 }}>
            <div style={{ fontSize: 11.5, marginBottom: 5, opacity: 0.75 }}>Box shape at {perRow} per row</div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${perRow}, 1fr)`, gap: 6 }}>
              {Array.from({ length: perRow }, (_, i) => (
                <div key={i} style={{
                  aspectRatio: "1 / 1", borderRadius: 8, border: "var(--border)", background: "var(--bg)",
                  display: "grid", placeItems: "center", fontSize: Math.max(9, Math.min(15, Math.round(90 / perRow))),
                  fontWeight: 800, opacity: 0.85, overflow: "hidden",
                }}>{i + 1}</div>
              ))}
            </div>
          </div>
          <button className="adm-btn" disabled={!loadOk} onClick={() => setShowFloorPreview(true)}
            title="Open the real manager floor and slide through every option">
            👁 Preview on the real floor
          </button>
        </div>
      </div>

      {showFloorPreview && (
        <FloorLayoutPreview
          restaurant={restaurant}
          value={perRow}
          onPick={(nextPerRow) => { set("floor_per_row", nextPerRow); autoSave("floor_per_row", nextPerRow); }}
          onClose={() => setShowFloorPreview(false)}
        />
      )}

      <div className="adm-card" style={{ marginBottom: 14 }}>
        <h2>🪑 Table setting</h2>
        <p className="hint">
          Each table&apos;s <b>name</b> (optional — e.g. the last table as &ldquo;Banquet&rdquo;; tiles and table views show it,
          while bills &amp; QR codes keep the number) and how many people can sit there (nothing set = 4).
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8, maxHeight: 340, overflowY: "auto", paddingRight: 4 }}>
          {Array.from({ length: draftCount }, (_, i) => i + 1).map((t) => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderRadius: 8, background: "var(--bg)", border: "var(--border)" }}>
              <span style={{ fontWeight: 700, fontSize: 13, minWidth: 28 }}>T{t}</span>
              <input type="text" maxLength={24} value={names[String(t)] ?? ""} placeholder="Name" disabled={!loadOk || busy}
                title='A display name for this table (e.g. "Banquet") — bills and QR codes keep the number'
                onChange={(e) => setName(t, e.target.value)}
                style={{ ...inputStyle, flex: 1, minWidth: 0, padding: "5px 8px" }} />
              <input type="number" min={1} max={30} value={String(seats[String(t)] ?? 4)} title="Seats" disabled={!loadOk || busy}
                onChange={(e) => setSeat(t, e.target.value)}
                style={{ ...inputStyle, width: 58, padding: "5px 6px" }} />
            </div>
          ))}
        </div>
      </div>

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

      <div className="adm-card" style={{ marginBottom: 14 }}>
        <h2>🪑 Auto close / restart tables</h2>
        <p className="hint">
          When a table&apos;s bill is fully <b>paid</b> and every dish is <b>served</b>, free it automatically.
          <b> Off</b> = the staff close/restart by hand (the default). Also visible to the manager.
        </p>
        <label style={{ ...labelStyle, maxWidth: 300 }}>
          When a table is paid &amp; fully served
          <select value={String(draft.auto_table_action || "off")} disabled={!loadOk || busy}
            onChange={(e) => set("auto_table_action", e.target.value)} style={{ ...inputStyle, marginTop: 4 }}>
            <option value="off">Off — do nothing</option>
            <option value="close">Auto-close the table</option>
            <option value="restart">Auto-restart the table</option>
          </select>
        </label>
      </div>

      {(msg || err) && (
        <div role="status" style={{ position: "fixed", left: "50%", bottom: dirty ? 76 : 20, transform: "translateX(-50%)", zIndex: 1001, background: err ? "var(--adm-danger, #e5484d)" : "var(--adm-ok, #16a34a)", color: "#fff", padding: "9px 15px", borderRadius: 10, fontSize: 13, fontWeight: 700, boxShadow: "0 6px 24px rgba(0,0,0,0.25)", maxWidth: "90vw" }}>
          {err || msg}
        </div>
      )}

      {/* Floating save bar — appears the moment anything is edited, stays reachable however long the page is. */}
      {dirty && (
        <div style={{ position: "fixed", left: "50%", bottom: 18, transform: "translateX(-50%)", zIndex: 1002, display: "flex", gap: 10, alignItems: "center", background: "var(--card)", border: "var(--border)", borderRadius: 14, padding: "10px 16px", boxShadow: "0 10px 34px rgba(0,0,0,0.3)" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>Unsaved changes</span>
          <button className="adm-btn" disabled={busy} onClick={discard}>Discard</button>
          <button className="adm-btn primary" disabled={busy} onClick={save}>
            <i className="fas fa-check" style={{ marginRight: 7 }} aria-hidden="true" />{busy ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </>
  );
}
