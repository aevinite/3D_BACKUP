// Runs in the browser so it can pop open, take taps, and save to the cart.
"use client";

import { useEffect, useState } from "react";
import { formatMoney, prettyUsd, getCurrency, type CurrencyMeta } from "@/lib/format";
import type { OptionGroup } from "@/lib/menu";
import { allergenIcon, allergenLabel } from "@/lib/allergens";

// The minimal info we keep about the dish being customized.
interface OrderItem {
  id: string;
  title: string;
  price: string;
  image: string;
}

// The bundle of data passed in when this popup is asked to open. It carries the
// dish, its option groups, its allergens, and (if editing) what was chosen before.
interface ConfirmDetail {
  item: OrderItem;
  options?: OptionGroup[];
  allergens?: string[];
  // When re-opening from the bill to edit an existing line:
  editSig?: string;
  preselect?: { options?: { group: string; label: string; price: number }[]; removed?: string[]; note?: string; qty?: number };
}

// OrderConfirmModal: the "customize your dish" popup. The guest picks options
// (size, extras), taps allergens to remove, adds a note and a quantity, then
// adds it to the cart. It can also re-open to EDIT an existing cart line.
export default function OrderConfirmModal() {
  // Each useState is a memory box the popup keeps while it's open:
  const [open, setOpen] = useState(false); // is the popup showing?
  const [item, setItem] = useState<OrderItem | null>(null); // the dish being customized
  const [groups, setGroups] = useState<OptionGroup[]>([]); // its option groups (e.g. "Size")
  const [selected, setSelected] = useState<Record<number, string[]>>({}); // which choices are picked, per group
  const [allergens, setAllergens] = useState<string[]>([]); // allergens this dish contains
  const [removed, setRemoved] = useState<string[]>([]); // allergens the guest tapped to remove
  const [otherOn, setOtherOn] = useState(false); // is the free-text "other allergy" box showing?
  const [otherText, setOtherText] = useState(""); // what they typed in that box
  const [note, setNote] = useState(""); // free-text note for the kitchen
  const [applyAll, setApplyAll] = useState(false); // "avoid these allergens in ALL my dishes" checkbox
  const [qty, setQty] = useState(1); // how many of this dish
  const [editSig, setEditSig] = useState<string | null>(null); // set when editing an existing line
  const [currency, setCurrencyState] = useState<CurrencyMeta | null>(null); // which currency to show
  const [submitting, setSubmitting] = useState(false); // true briefly while saving, to block double-taps
  // After a successful add, the dialog flips to a success step ("Added to your
  // bill — View bill / Keep browsing") instead of vanishing silently.
  const [added, setAdded] = useState<{ qty: number; title: string } | null>(null);

  // This useEffect runs once on mount: load the currency and start listening
  // for the "please open me" message (and the messages to close/refresh).
  useEffect(() => {
    setCurrencyState(getCurrency());
    // onOpen: fires when another part of the app asks this popup to open. The
    // dish + its options ride along in the event's "detail".
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<ConfirmDetail>).detail;
      if (!detail?.item) return; // nothing to show without a dish
      const gs = Array.isArray(detail.options) ? detail.options : [];
      const pre = detail.preselect; // previous choices, only present when editing
      setItem(detail.item);
      setGroups(gs);
      // Pre-fill from an existing line when editing; else single groups default to first.
      const init: Record<number, string[]> = {};
      gs.forEach((g, i) => {
        if (pre?.options) init[i] = pre.options.filter((o) => o.group === g.name).map((o) => o.label);
        else init[i] = g.type === "single" && g.choices[0] ? [g.choices[0].label] : [];
      });
      setSelected(init);
      const listed = Array.isArray(detail.allergens) ? detail.allergens : [];
      setAllergens(listed);
      // Split a saved line's "removed" back into listed allergens vs a free-text
      // "other" allergy the guest typed (anything not in the dish's own list).
      const preRemoved = pre?.removed || [];
      const otherEntries = preRemoved.filter((r) => !listed.includes(r));
      setRemoved(preRemoved.filter((r) => listed.includes(r)));
      setOtherOn(otherEntries.length > 0);
      setOtherText(otherEntries.join(", "));
      setApplyAll(false);
      setNote(pre?.note || "");
      setQty(pre?.qty && pre.qty > 0 ? pre.qty : 1); // default to 1 when adding fresh
      setEditSig(detail.editSig || null); // non-null means "we're editing, not adding"
      setAdded(null); // a fresh open always starts at the form, not the success step
      setOpen(true); // finally, show the popup
    };
    const onClose = () => setOpen(false); // a global "close everything" message
    const onCurrency = () => setCurrencyState(getCurrency()); // currency switched -> refresh prices

    // Listen for those three messages from the rest of the app.
    window.addEventListener("lfh:open-order-confirm", onOpen);
    window.addEventListener("lfh:close-all", onClose);
    window.addEventListener("lfh:currency-changed", onCurrency);
    // Stop listening when the popup is removed.
    return () => {
      window.removeEventListener("lfh:open-order-confirm", onOpen);
      window.removeEventListener("lfh:close-all", onClose);
      window.removeEventListener("lfh:currency-changed", onCurrency);
    };
  }, []);

  // While the popup is open, let the Escape key close it. We only attach this
  // listener while open, and remove it when the popup closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // The success step auto-dismisses after 4 seconds (same as tapping
  // "Keep browsing") so a guest who walks away isn't left with a stuck dialog.
  useEffect(() => {
    if (!added) return;
    const tm = setTimeout(() => { setAdded(null); setOpen(false); }, 4000);
    return () => clearTimeout(tm);
  }, [added]);

  // If we're not open (or there's no dish), draw nothing at all.
  if (!open || !item) return null;

  // STEP 2 of 2: the success confirmation after a fresh add.
  if (added) {
    const closeDone = () => { setAdded(null); setOpen(false); };
    return (
      <>
        <div className="overlay active" onClick={closeDone} />
        <div role="dialog" aria-modal="true" aria-label="Added to your bill" className="order-confirm order-confirm-done">
          <div className="done-check" aria-hidden="true">✓</div>
          <h3 className="done-title">Added to your bill</h3>
          <p className="done-line">{added.qty} × {added.title}</p>
          <div className="order-confirm-actions done-actions">
            {/* Reuses the modal's own button styles so the two steps match. */}
            <button type="button" className="order-confirm-cancel" onClick={closeDone}>
              Keep browsing
            </button>
            <button
              type="button"
              className="order-confirm-add"
              onClick={() => { closeDone(); window.dispatchEvent(new Event("lfh:open-cart")); }}
            >
              View bill
            </button>
          </div>
        </div>
      </>
    );
  }

  // fmt(): turn a number into a nicely formatted price string in the chosen currency.
  const fmt = (n: number) => (currency ? formatMoney(n, currency) : `$${n.toFixed(2)}`);

  // Chosen options as a flat list + the per-unit price (base + add-ons).
  // We walk every group and collect the choices the guest actually selected.
  const chosen: { group: string; label: string; price: number }[] = [];
  groups.forEach((g, i) => {
    (selected[i] || []).forEach((label) => {
      const c = g.choices.find((x) => x.label === label);
      if (c) chosen.push({ group: g.name, label, price: c.price || 0 });
    });
  });
  // Price math: one unit = the dish's base price plus every add-on's price.
  // The base goes through prettyUsd so this popup's number matches the menu
  // card / dish page exactly (raw parseFloat was the ₹546-vs-₹545 bug).
  const unit = prettyUsd(item.price) + chosen.reduce((s, c) => s + c.price, 0);
  // The popup's total = price of one unit times the quantity.
  const total = unit * qty;

  // toggle(): tap a choice on/off. "single" groups (like Size) keep only one
  // selection; "multi" groups (like Extras) can have several at once.
  const toggle = (groupIdx: number, label: string, type: "single" | "multi") => {
    setSelected((prev) => {
      const cur = prev[groupIdx] || [];
      if (type === "single") return { ...prev, [groupIdx]: [label] };
      // For multi: if it's already picked, unpick it; otherwise add it.
      return { ...prev, [groupIdx]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] };
    });
  };

  // toggleRemove(): tap an allergen to mark it "removed" (and tap again to undo).
  const toggleRemove = (a: string) =>
    setRemoved((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));

  // The dish's own avoided allergens PLUS any free-text "other" allergy the guest
  // typed. This is the single list that flows to the cart line and the kitchen.
  const otherTrimmed = otherOn ? otherText.trim() : "";
  const finalRemoved = otherTrimmed ? [...removed, otherTrimmed] : removed;

  // confirm(): the "Add to Order" / "Update Order" button. It saves this dish
  // (with all its choices) into the cart in the browser's storage.
  const confirm = () => {
    if (submitting) return; // ignore a second tap while the first is saving
    setSubmitting(true);
    try {
      // Fingerprint of this line's spec. An EMPTY spec (no options, no removed
      // allergens, no note) yields "[]" — the same as a quick "+" add — so the
      // plain/non-allergic version always merges regardless of how it was added,
      // while any removed allergen (e.g. "no:milk") makes it a separate line.
      const sig = JSON.stringify([
        ...chosen.map((c) => `${c.group}:${c.label}`),
        ...finalRemoved.map((r) => `no:${r}`),
        ...(note.trim() ? [`note:${note.trim()}`] : []),
      ]);
      let cart: { id: string; title: string; price: string; image: string; qty: number; options?: typeof chosen; removed?: string[]; note?: string; sig?: string }[] = [];
      // Read the existing cart out of the browser's notepad (localStorage).
      const saved = localStorage.getItem("lfh_cart");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) cart = parsed;
      }
      // Editing from the bill: drop the line being edited first.
      if (editSig) cart = cart.filter((it) => (it.sig || "[]") !== editSig);
      // Same dish + same options/allergy/note = one line; otherwise a new line.
      const existing = cart.find((it) => it.id === item.id && (it.sig || "[]") === sig);
      if (existing) existing.qty += qty; // already there -> just bump the quantity
      else cart.push({ // otherwise add a brand-new line
        id: item.id, title: item.title, price: unit.toFixed(2), image: item.image, qty,
        options: chosen.length ? chosen : undefined,
        removed: finalRemoved.length ? finalRemoved : undefined,
        note: note.trim() || undefined,
        sig,
      });

      // Save the updated cart back to storage, then announce the change so the
      // mini-cart, header badge, and bill all refresh.
      localStorage.setItem("lfh_cart", JSON.stringify(cart));
      window.dispatchEvent(new Event("lfh:cart-updated"));
      // "Apply to all" — push the avoided allergens into the order-wide avoid list.
      if (applyAll && finalRemoved.length) {
        window.dispatchEvent(new CustomEvent("lfh:avoid-all", { detail: { allergens: finalRemoved } }));
      }
      if (editSig) {
        // Editing from the bill: the bill is already open behind us, so a
        // quick toast is enough feedback — close straight away.
        window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: `${item.title} updated`, kicker: "your order" } }));
        setOpen(false);
      } else {
        // Fresh add: flip this dialog to its success step (step 2 of 2) so the
        // guest gets unmistakable confirmation + a shortcut to the bill.
        setAdded({ qty, title: item.title });
      }
    } catch (e) {
      console.error("Failed to add to cart", e);
    } finally {
      setSubmitting(false); // re-enable the button no matter what happened
    }
  };

  return (
    <>
      {/* The dark backdrop behind the popup. Tapping it closes the popup. */}
      <div className="overlay active" onClick={() => setOpen(false)} />
      {/* The popup box itself. role/aria attributes help screen readers. */}
      <div role="dialog" aria-modal="true" aria-label="Confirm order" className="order-confirm">
        {/* The little X close button in the corner. */}
        <button type="button" className="order-confirm-close" aria-label="Close" onClick={() => setOpen(false)}>
          <i className="fas fa-times"></i>
        </button>

        {/* The scrollable middle: picture, name, base price, then the choices. */}
        <div className="order-confirm-scroll">
        <img src={item.image} alt={item.title} className="order-confirm-img" />
        <h3 className="order-confirm-title">{item.title}</h3>
        <div className="order-confirm-unit">{fmt(parseFloat(item.price))} base</div>

        {/* One block per option group (e.g. "Size", "Extras"). */}
        {groups.map((g, i) => (
          <div key={i} className="oc-group">
            <div className="oc-group-name">{g.name}{g.type === "multi" ? " (any)" : ""}</div>
            <div className="oc-choices">
              {g.choices.map((c) => {
                const on = (selected[i] || []).includes(c.label);
                return (
                  <button
                    key={c.label}
                    type="button"
                    className={`oc-choice ${on ? "on" : ""}`}
                    onClick={() => toggle(i, c.label, g.type)}
                  >
                    <span>{c.label}</span>
                    {c.price > 0 && <span className="oc-price">+{fmt(c.price)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Allergen section: only shown if the dish lists any. Tapping one marks
            it "removed" (e.g. "no milk"). */}
        {allergens.length > 0 && (
          <div className="oc-group">
            <div className="oc-group-name">Contains — tap to remove</div>
            <div className="oc-choices">
              {allergens.map((a) => {
                const off = removed.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    className={`oc-allergen ${off ? "removed" : ""}`}
                    onClick={() => toggleRemove(a)}
                  >
                    {allergenIcon(a)} {allergenLabel(a)}{off ? " — removed" : ""}
                  </button>
                );
              })}
              <button
                type="button"
                className={`oc-allergen oc-other ${otherOn ? "on" : ""}`}
                onClick={() => setOtherOn((v) => !v)}
              >
                ➕ Other allergy
              </button>
            </div>
            {/* The free-text "other allergy" box, shown only when toggled on. */}
            {otherOn && (
              <input
                type="text"
                className="oc-other-input"
                placeholder="Describe it (e.g. peanuts, shellfish)"
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
              />
            )}
            {/* "Avoid these in ALL my dishes" — shown only when something is being removed. */}
            {finalRemoved.length > 0 && (
              <label className="oc-applyall">
                <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />
                Avoid {finalRemoved.map((r) => allergenLabel(r).toLowerCase()).join(", ")} in all my dishes
              </label>
            )}
          </div>
        )}

        {/* A free-text note that goes to the kitchen with this dish. */}
        <div className="oc-note-wrap">
          <input
            type="text"
            className="oc-note"
            placeholder="Anything else? (e.g. less ice, no sugar)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {/* Quantity stepper: minus / number / plus. Clamped between 1 and 99. */}
        <div className="order-confirm-qty">
          <button type="button" aria-label="Decrease quantity" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1}>−</button>
          <span aria-live="polite">{qty}</span>
          <button type="button" aria-label="Increase quantity" onClick={() => setQty((q) => Math.min(99, q + 1))}>+</button>
        </div>
        </div>

        {/* The footer that stays pinned at the bottom: total price + action buttons. */}
        <div className="order-confirm-foot">
          <div className="order-confirm-total">
            <span>Total</span>
            <span className="order-confirm-total-val">{fmt(total)}</span>
          </div>

          <div className="order-confirm-actions">
            {/* Cancel just closes the popup without saving. */}
            <button type="button" className="order-confirm-cancel" onClick={() => setOpen(false)}>Cancel</button>
            {/* The main button: runs confirm() to save. Its label depends on add-vs-edit. */}
            <button type="button" className="order-confirm-add" onClick={confirm} disabled={submitting}>
              {submitting ? "Saving…" : editSig ? "Update Order" : "Add to Order"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
