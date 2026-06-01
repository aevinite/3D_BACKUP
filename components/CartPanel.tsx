"use client";

import { useEffect, useRef, useState } from "react";
import { formatPrice, getCurrency, type CurrencyMeta } from "@/lib/format";
import { getMenuItems, getSettings, createOrder, type MenuItem } from "@/lib/menu";
import { ALLERGENS, allergenIcon, allergenLabel } from "@/lib/allergens";
import { validateTable, flagTableInput } from "@/lib/table";
import {
  STEPS,
  STATUS_COPY,
  type ActiveOrder,
  readActiveOrders,
  liveActiveOrders,
  isFinalStatus,
} from "@/lib/orderStatus";

interface CartOption { group: string; label: string; price: number }
interface CartItem {
  id: string;
  title: string;
  price: string;
  image: string;
  qty: number;
  options?: CartOption[];
  removed?: string[];
  note?: string;
  sig?: string;
}

interface HistoryOrder {
  id: string;
  tableNumber: string;
  total: number;
  items: { title: string; qty: number; price: string }[];
  placedAt: number;
}

const TAX_RATE = 0.05; // 5% — shown as a line on the bill

const normalize = (raw: unknown): CartItem[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((it): it is { id: string; title: string; price: string; image: string; qty?: number; options?: CartOption[]; removed?: string[]; note?: string; sig?: string } =>
      !!it && typeof it === "object" && "id" in it
    )
    .map((it) => ({
      id: it.id,
      title: it.title,
      price: it.price,
      image: it.image,
      qty: typeof it.qty === "number" && it.qty > 0 ? it.qty : 1,
      options: Array.isArray(it.options) ? it.options : undefined,
      removed: Array.isArray(it.removed) ? it.removed : undefined,
      note: typeof it.note === "string" ? it.note : undefined,
      sig: it.sig,
    }));
};

export default function CartPanel() {
  const [open, setOpen] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [tableNumber, setTableNumber] = useState("");
  const [tableCount, setTableCount] = useState(0); // how many tables exist; 0 = no limit known
  const [currency, setCurrencyState] = useState<CurrencyMeta | null>(null);
  const [allergenMap, setAllergenMap] = useState<Record<string, string[]>>({});
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [history, setHistory] = useState<HistoryOrder[]>([]);
  const [liveOrders, setLiveOrders] = useState<ActiveOrder[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [declared, setDeclared] = useState<string[]>([]); // allergens the diner avoids
  const [otherAllergy, setOtherAllergy] = useState(""); // free-text allergy not in the list
  const [otherOpen, setOtherOpen] = useState(false); // reveal the free-text field
  const [placing, setPlacing] = useState(false);
  const declaredHydrated = useRef(false); // skip the first persist so restore can't be clobbered

  const loadCart = () => {
    try {
      const saved = localStorage.getItem("lfh_cart");
      setCart(saved ? normalize(JSON.parse(saved)) : []);
    } catch {
      setCart([]);
    }
  };
  const saveCart = (newCart: CartItem[]) => {
    try {
      localStorage.setItem("lfh_cart", JSON.stringify(newCart));
    } catch {}
  };
  const commit = (next: CartItem[]) => {
    setCart(next);
    saveCart(next);
    window.dispatchEvent(new Event("lfh:cart-updated"));
  };
  const decrement = (idx: number) => {
    const next = [...cart];
    if (next[idx].qty > 1) next[idx] = { ...next[idx], qty: next[idx].qty - 1 };
    else next.splice(idx, 1);
    commit(next);
  };
  const increment = (idx: number) => {
    const next = [...cart];
    next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
    commit(next);
  };
  const removeFromCart = (idx: number) => {
    const next = [...cart];
    next.splice(idx, 1);
    commit(next);
  };

  useEffect(() => {
    loadCart();
    setCurrencyState(getCurrency());
    // allergen lookup by dish id (so the bill can warn)
    getMenuItems()
      .then((items) => {
        const m: Record<string, string[]> = {};
        items.forEach((i) => (m[i.id] = i.allergens || []));
        setAllergenMap(m);
        setMenuItems(items);
      })
      .catch(() => {});
    // How many tables exist, so we can reject an out-of-range table number.
    getSettings()
      .then((s) => setTableCount(s.tableCount))
      .catch(() => {});

    const loadHistory = () => {
      try {
        const r = localStorage.getItem("lfh_order_history");
        const p = r ? JSON.parse(r) : [];
        setHistory(Array.isArray(p) ? p : []);
      } catch { setHistory([]); }
    };
    // Live orders are written/polled by OrderTracker; we just read them here.
    const loadLive = () => setLiveOrders(liveActiveOrders(readActiveOrders()));
    loadHistory();
    loadLive();
    // restore order-wide allergy avoidances (set via "apply to all" or the bill section)
    try {
      const d = JSON.parse(localStorage.getItem("lfh_declared") || "[]");
      if (Array.isArray(d) && d.length) setDeclared(d);
    } catch {}
    const handleOpen = () => { setOpen(true); loadCart(); loadHistory(); loadLive(); setShowHistory(false); };
    const handleClose = () => setOpen(false);
    const handleCartUpdated = loadCart;
    const handleCurrency = () => setCurrencyState(getCurrency());
    // Re-read live orders whenever one is placed or its status changes.
    const handleOrdersChanged = () => { loadLive(); loadHistory(); };
    const handleAvoidAll = (e: Event) => {
      const list = (e as CustomEvent<{ allergens: string[] }>).detail?.allergens || [];
      setDeclared((d) => Array.from(new Set([...d, ...list])));
    };
    window.addEventListener("lfh:open-cart", handleOpen);
    window.addEventListener("lfh:close-all", handleClose);
    window.addEventListener("lfh:cart-updated", handleCartUpdated);
    window.addEventListener("lfh:currency-changed", handleCurrency);
    window.addEventListener("lfh:avoid-all", handleAvoidAll);
    window.addEventListener("lfh:order-placed", handleOrdersChanged);
    window.addEventListener("lfh:orders-updated", handleOrdersChanged);
    window.addEventListener("storage", handleOrdersChanged);
    return () => {
      window.removeEventListener("lfh:avoid-all", handleAvoidAll);
      window.removeEventListener("lfh:open-cart", handleOpen);
      window.removeEventListener("lfh:close-all", handleClose);
      window.removeEventListener("lfh:cart-updated", handleCartUpdated);
      window.removeEventListener("lfh:currency-changed", handleCurrency);
      window.removeEventListener("lfh:order-placed", handleOrdersChanged);
      window.removeEventListener("lfh:orders-updated", handleOrdersChanged);
      window.removeEventListener("storage", handleOrdersChanged);
    };
  }, []);

  // Persist the order-wide allergy avoidances. Skip the very first run: on mount
  // `declared` is still the empty default while the restore (above) is being
  // applied, so writing here would overwrite the saved list with [].
  useEffect(() => {
    if (!declaredHydrated.current) { declaredHydrated.current = true; return; }
    try { localStorage.setItem("lfh_declared", JSON.stringify(declared)); } catch {}
  }, [declared]);

  // While the cart is open, re-evaluate live orders every few seconds so a
  // "Served!" card drops off after its one-minute linger — that expiry is
  // time-based, so no event fires for it.
  useEffect(() => {
    if (!open) return;
    const refreshLive = () => setLiveOrders(liveActiveOrders(readActiveOrders()));
    refreshLive();
    const iv = setInterval(refreshLive, 5000);
    return () => clearInterval(iv);
  }, [open]);

  const showPrice = (n: number) => (currency ? formatPrice(n, currency) : `$${n.toFixed(2)}`);
  // Orders shown live up top are hidden from the history list below, so the
  // same order never appears twice in the same tab.
  const liveIds = new Set(liveOrders.map((o) => o.id));
  const pastOrders = history.filter((h) => !liveIds.has(h.id));
  // Red dot on the Previous-orders tab: a live order whose floating strip was hidden.
  const hiddenLive = liveOrders.some((o) => o.stripHidden && !isFinalStatus(o.status));
  const subtotal = cart.reduce((sum, it) => sum + parseFloat(it.price) * it.qty, 0);
  const itemCount = cart.reduce((sum, it) => sum + it.qty, 0);
  const tax = subtotal * TAX_RATE;
  const total = subtotal + tax;

  const itemAllergens = (id: string) => allergenMap[id] || [];
  const conflicts = (id: string) => itemAllergens(id).filter((a) => declared.includes(a));
  const orderDeclaredHits = [...new Set(cart.flatMap((it) => conflicts(it.id)))];
  const toggleDeclared = (slug: string) =>
    setDeclared((d) => (d.includes(slug) ? d.filter((x) => x !== slug) : [...d, slug]));

  // Re-open the customize popup for an existing line, pre-filled, to edit it.
  const editLine = (it: CartItem) => {
    const dish = menuItems.find((m) => m.id === it.id);
    if (!dish) return;
    window.dispatchEvent(new CustomEvent("lfh:open-order-confirm", {
      detail: {
        item: { id: dish.id, title: dish.title, price: dish.price, image: dish.image },
        options: dish.options,
        allergens: dish.allergens,
        editSig: it.sig || "[]",
        preselect: { options: it.options, removed: it.removed, note: it.note, qty: it.qty },
      },
    }));
  };
  const isCustomizable = (id: string) => {
    const d = menuItems.find((m) => m.id === id);
    return !!d && (((d.options || []).length > 0) || ((d.allergens || []).length > 0));
  };

  // Gentle pairing upsell: the top-rated drink/dessert not already on the bill.
  const cartIds = new Set(cart.map((c) => c.id));
  const PAIR_CATS = ["coffee", "beverages", "desserts"];
  const pairing =
    cart.length > 0
      ? menuItems
          .filter((i) => !cartIds.has(i.id) && PAIR_CATS.includes(i.category))
          .sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0))[0] || null
      : null;
  const addPairing = (it: MenuItem) => {
    const next = [...cart];
    const idx = next.findIndex((c) => c.id === it.id);
    if (idx >= 0) next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
    else next.push({ id: it.id, title: it.title, price: it.price, image: it.image, qty: 1 });
    commit(next);
    window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: `${it.title} added`, kicker: "your order" } }));
  };

  const placeOrder = async () => {
    if (cart.length === 0 || placing) return;
    // Table number is required AND must be a real table (see lib/table.ts).
    const check = validateTable(tableNumber, tableCount);
    if (!check.ok) {
      flagTableInput("cart-table", check.message!);
      return;
    }
    const tableTrim = check.value;
    setPlacing(true);
    try {
      const allergies = [...declared, ...(otherAllergy.trim() ? [otherAllergy.trim()] : [])];
      const orderId = await createOrder({
        tableNumber: tableTrim,
        items: cart.map((it) => ({ id: it.id, title: it.title, price: it.price, qty: it.qty, options: it.options, removed: it.removed, note: it.note })),
        subtotal,
        tax,
        total,
        allergies,
      });
      // Remember this order on THIS device so the guest can follow its status.
      try {
        const raw = localStorage.getItem("lfh_active_orders");
        const list = raw ? JSON.parse(raw) : [];
        const active = Array.isArray(list) ? list : [];
        active.push({
          id: orderId,
          tableNumber: tableTrim,
          total,
          itemCount,
          items: cart.map((it) => ({ title: it.title, qty: it.qty })),
          status: "received",
          placedAt: Date.now(),
        });
        localStorage.setItem("lfh_active_orders", JSON.stringify(active));
        window.dispatchEvent(new Event("lfh:order-placed"));
      } catch {}
      // Also keep a permanent history this device can browse later.
      try {
        const rawH = localStorage.getItem("lfh_order_history");
        const hist = (() => { const p = rawH ? JSON.parse(rawH) : []; return Array.isArray(p) ? p : []; })();
        hist.unshift({
          id: orderId,
          tableNumber: tableTrim,
          total,
          items: cart.map((it) => ({ title: it.title, qty: it.qty, price: it.price })),
          placedAt: Date.now(),
        });
        // Kept only in the guest's own browser (never Supabase); persists across visits.
        localStorage.setItem("lfh_order_history", JSON.stringify(hist.slice(0, 50)));
        setHistory(hist.slice(0, 50));
      } catch {}
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: {
        message: "Order placed",
        subtitle: tableTrim ? `table ${tableTrim} · sent to kitchen` : "sent to kitchen",
        kicker: "to the kitchen",
        icon: "🧾",
        variant: "success",
      } }));
      setCart([]); saveCart([]); setTableNumber(""); setDeclared([]); setOtherAllergy(""); setOtherOpen(false);
      window.dispatchEvent(new Event("lfh:cart-updated"));
      window.dispatchEvent(new Event("lfh:close-all"));
    } catch {
      window.dispatchEvent(new CustomEvent("lfh:toast", { detail: { message: "Order didn't go through", subtitle: "please try again", kicker: "order", variant: "error" } }));
    } finally {
      setPlacing(false);
    }
  };

  if (!open) return null;

  const qtyBtn = {
    width: "28px", height: "28px", borderRadius: "50%",
    border: "1px solid rgba(212,165,116,0.4)", background: "transparent",
    color: "var(--text)", cursor: "pointer", fontSize: "16px", lineHeight: 1, fontWeight: 700,
  } as const;

  return (
    <>
      <div className="overlay active" onClick={() => window.dispatchEvent(new Event("lfh:close-all"))}></div>
      <div id="cart-panel" className="cart-panel panel open">
        <div className="cart-topbar">
          <button
            type="button"
            className="cart-back"
            onClick={() => window.dispatchEvent(new Event("lfh:close-all"))}
          >
            <i className="fas fa-arrow-left"></i> Back
          </button>
          <button className="nav-btn" title="Close" aria-label="Close cart" onClick={() => window.dispatchEvent(new Event("lfh:close-all"))}>
            <i className="fas fa-times"></i>
          </button>
        </div>
        <h3 className="panel-title" style={{ margin: "0 0 20px", textAlign: "left" }}>
          <i className="fas fa-receipt"></i> Your Bill
          {cart.length > 0 && (
            <span style={{ color: "var(--muted)", fontSize: "13px", fontWeight: 500 }}>
              {" "}· {itemCount} item{itemCount !== 1 ? "s" : ""}
            </span>
          )}
        </h3>

        <div className="cart-tabs">
          <button type="button" className={!showHistory ? "active" : ""} onClick={() => setShowHistory(false)}>Current bill</button>
          <button type="button" className={showHistory ? "active" : ""} onClick={() => setShowHistory(true)}>
            Previous orders{liveOrders.length + pastOrders.length ? ` (${liveOrders.length + pastOrders.length})` : ""}
            {hiddenLive && <span className="tab-live-dot" aria-label="Live order in progress" />}
          </button>
        </div>

        {showHistory ? (
          <div className="order-history">
            {liveOrders.length > 0 && (
              <div className="live-orders">
                <div className="live-orders-head">
                  <span className="live-dot" aria-hidden="true"></span>
                  Live now
                  <span className="live-count">{liveOrders.length}</span>
                </div>
                {liveOrders.map((o) => {
                  const cp = STATUS_COPY[o.status];
                  const stepIndex = STEPS.indexOf(o.status);
                  return (
                    <div key={o.id} className={`live-order status-${o.status}`}>
                      <div className="live-order-top">
                        <div className="ot-icon" aria-hidden="true">
                          <i className={`fas ${cp.icon}`}></i>
                        </div>
                        <div className="live-order-info">
                          <div className="live-order-label">{cp.label}</div>
                          <div className="live-order-sub">{cp.sub}</div>
                        </div>
                        {o.tableNumber && <span className="live-order-table">Table {o.tableNumber}</span>}
                      </div>
                      {stepIndex >= 0 && (
                        <div className="ot-steps" aria-hidden="true">
                          {STEPS.map((s, i) => (
                            <span key={s} className={`ot-step ${i <= stepIndex ? "done" : ""} ${i === stepIndex ? "active" : ""}`} />
                          ))}
                        </div>
                      )}
                      {o.items && o.items.length > 0 && (
                        <div className="live-order-items">
                          {o.items.map((it) => `${it.title} ×${it.qty}`).join(", ")}
                        </div>
                      )}
                      <div className="live-order-total"><span>Total</span><span>{showPrice(o.total)}</span></div>
                    </div>
                  );
                })}
              </div>
            )}

            {pastOrders.length === 0 && liveOrders.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--muted)", padding: "44px 16px", fontSize: 15 }}>
                <div style={{ fontSize: 30, marginBottom: 10 }}>🧾</div>
                No previous orders yet.<br />Your past orders will show up here.
              </div>
            )}

            {pastOrders.length > 0 && (
              <>
                {liveOrders.length > 0 && <div className="hist-earlier-head">Earlier orders</div>}
                {pastOrders.map((h) => (
                  <div key={h.id} className="hist-order">
                    <div className="hist-top">
                      <span className="hist-table">{h.tableNumber ? `Table ${h.tableNumber}` : "Order"}</span>
                      <span className="hist-when">{new Date(h.placedAt).toLocaleString()}</span>
                    </div>
                    <div className="hist-items">
                      {h.items.map((it, i) => (
                        <span key={i}>{it.title} ×{it.qty}{i < h.items.length - 1 ? ", " : ""}</span>
                      ))}
                    </div>
                    <div className="hist-total"><span>Total</span><span>{showPrice(h.total)}</span></div>
                  </div>
                ))}
              </>
            )}
          </div>
        ) : (
        <>
        <div id="cart-list" className="cart-list">
          {cart.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--muted)", padding: "50px 0", fontSize: "15px" }}>
              Your cart is empty
            </div>
          ) : (
            cart.map((item, idx) => {
              const c = conflicts(item.id);
              return (
                <div key={`${item.id}-${item.sig || ""}-${idx}`} className="cart-item">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="cart-item-name">{item.title}</div>
                    {item.options && item.options.length > 0 && (
                      <div className="cart-item-opts">
                        {item.options.map((o) => o.label).join(", ")}
                      </div>
                    )}
                    {item.removed && item.removed.length > 0 && (
                      <div className="cart-item-opts" style={{ color: "#fca5a5" }}>
                        No {item.removed.map((r) => allergenLabel(r).toLowerCase()).join(", ")}
                      </div>
                    )}
                    {item.note && <div className="cart-item-opts">“{item.note}”</div>}
                    {itemAllergens(item.id).length > 0 && (
                      <div className="cart-item-allergens">
                        {itemAllergens(item.id).map((a) => (
                          <span
                            key={a}
                            className={`allergen-dot ${declared.includes(a) ? "flag" : ""}`}
                            title={`Contains ${allergenLabel(a).toLowerCase()}`}
                          >
                            {allergenIcon(a)}
                          </span>
                        ))}
                      </div>
                    )}
                    {c.length > 0 && (
                      <div className="cart-item-warn">
                        <i className="fas fa-triangle-exclamation"></i> contains {c.map(allergenLabel).join(", ").toLowerCase()}
                      </div>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" }}>
                      <button type="button" aria-label={`Decrease ${item.title}`} onClick={() => decrement(idx)} style={qtyBtn}>−</button>
                      <span style={{ minWidth: "32px", textAlign: "center", fontSize: "13px", fontWeight: 700, color: "var(--text)" }}>{item.qty}x</span>
                      <button type="button" aria-label={`Increase ${item.title}`} onClick={() => increment(idx)} style={qtyBtn}>+</button>
                      {isCustomizable(item.id) && (
                        <button type="button" className="cart-edit-btn" onClick={() => editLine(item)}>
                          <i className="fas fa-pen"></i> Edit
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <div className="cart-item-price">{showPrice(parseFloat(item.price) * item.qty)}</div>
                    <button type="button" className="remove-item" aria-label={`Remove ${item.title}`} onClick={() => removeFromCart(idx)} style={{ background: "transparent", border: "none", padding: "8px" }}>
                      <i className="fas fa-trash" style={{ fontSize: "18px" }}></i>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {cart.length > 0 && (
          <>
            {pairing && (
              <div className="pairing">
                <div className="pairing-label">✨ Goes well with</div>
                <div className="pairing-card">
                  {pairing.image && <img src={pairing.image} alt="" className="pairing-img" />}
                  <div className="pairing-info">
                    <div className="pairing-name">{pairing.title}</div>
                    <div className="pairing-price">{showPrice(parseFloat(pairing.price))}</div>
                  </div>
                  <button type="button" className="pairing-add" onClick={() => addPairing(pairing)}>
                    + Add
                  </button>
                </div>
              </div>
            )}

            <div className="allergy-section">
              <h4><i className="fas fa-shield-heart"></i> Any allergies? Tap what you avoid</h4>
              <div className="allergy-chips">
                {ALLERGENS.map((a) => (
                  <button
                    key={a.slug}
                    type="button"
                    className={`allergy-toggle ${declared.includes(a.slug) ? "on" : ""}`}
                    aria-pressed={declared.includes(a.slug)}
                    onClick={() => toggleDeclared(a.slug)}
                  >
                    {a.icon} {a.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={`allergy-toggle ${otherOpen ? "on" : ""}`}
                  aria-pressed={otherOpen}
                  onClick={() => setOtherOpen((o) => !o)}
                >
                  ✏️ Other
                </button>
              </div>
              {otherOpen && (
                <input
                  type="text"
                  className="table-input"
                  style={{ marginTop: "10px", marginBottom: 0 }}
                  placeholder="Type your allergy…"
                  aria-label="Other allergy"
                  value={otherAllergy}
                  onChange={(e) => setOtherAllergy(e.target.value)}
                  autoFocus
                />
              )}
              {orderDeclaredHits.length > 0 && (
                <div className="allergy-warning">
                  <i className="fas fa-triangle-exclamation"></i> Heads up — your order contains{" "}
                  <b>{orderDeclaredHits.map(allergenLabel).join(", ").toLowerCase()}</b>. Flagged dishes are marked above.
                </div>
              )}
            </div>

            <input
              type="text" inputMode="numeric" pattern="[0-9]*"
              id="cart-table" className="table-input" placeholder="Enter Table Number (required)"
              aria-label="Table number" value={tableNumber}
              maxLength={4}
              // Keep only digits so letters/symbols can never reach the field.
              onChange={(e) => setTableNumber(e.target.value.replace(/\D/g, ""))}
            />

            <div className="bill-rows">
              <div className="bill-line"><span>Subtotal</span><span>{showPrice(subtotal)}</span></div>
              <div className="bill-line"><span>Tax (5%)</span><span>{showPrice(tax)}</span></div>
              <div className="bill-line grand"><span>Total</span><span>{showPrice(total)}</span></div>
            </div>

            <button className="btn btn-gold" onClick={placeOrder} disabled={placing}>
              <i className="fas fa-circle-check"></i> {placing ? "Placing…" : "Place Order"}
            </button>
          </>
        )}
        </>
        )}
      </div>
    </>
  );
}
