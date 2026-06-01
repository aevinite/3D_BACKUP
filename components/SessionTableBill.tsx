"use client";

// SessionTableBill — the guest's live view of their SHARED table bill when the
// v2 dining-session system is ON. It mirrors what the editor's session panel
// drives: every dish the table has ordered, each with its kitchen status
// (received -> preparing -> served), plus the merged subtotal/tax/total.
//
// It renders nothing unless sessions are on AND this device is in a session, so
// in normal (sessions-off) mode it's invisible. It's mounted inside the cart's
// "Previous orders" tab, so it only polls while the guest is looking at it.

import { useEffect, useRef, useState } from "react";
import { getStoredSession, getSessionState } from "@/lib/session";
import { getSettings } from "@/lib/menu";
import { formatMoney, getCurrency, type CurrencyMeta } from "@/lib/format";

interface SItem { id: string; title: string; qty: number; status: "received" | "preparing" | "served"; }
interface SBill { subtotal: number; tax: number; total: number; }

const STATUS_LABEL: Record<string, string> = { received: "Received", preparing: "Preparing", served: "Served" };

export default function SessionTableBill() {
  const [active, setActive] = useState(false); // sessions on + we hold a valid session token
  const [table, setTable] = useState("");
  const [items, setItems] = useState<SItem[]>([]);
  const [bill, setBill] = useState<SBill | null>(null);
  const [members, setMembers] = useState(0);
  const [currency, setCurrency] = useState<CurrencyMeta | null>(null);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    let iv: ReturnType<typeof setInterval> | null = null;
    setCurrency(getCurrency());
    (async () => {
      let enabled = false;
      try { enabled = (await getSettings()).sessionsEnabled; } catch {}
      const s = getStoredSession();
      if (!alive || !enabled || !s) return; // not in session mode → stay hidden
      tokenRef.current = s.token;
      setActive(true);
      const poll = async () => {
        const token = tokenRef.current; if (!token) return;
        const st = await getSessionState(token);
        if (!alive) return;
        if (!st.ok) { setActive(false); return; } // token gone / session ended
        const sess = st.session as { table_number?: string; status?: string } | undefined;
        if (sess?.status !== "open") { setActive(false); return; }
        setTable(sess?.table_number || "");
        setItems((st.items as SItem[]) || []);
        setBill((st.bill as SBill) || null);
        setMembers(Array.isArray(st.members) ? (st.members as unknown[]).length : 0);
      };
      poll();
      iv = setInterval(poll, 2000);
    })();
    return () => { alive = false; if (iv) clearInterval(iv); };
  }, []);

  if (!active) return null;
  const show = (n: number) => (currency ? formatMoney(n, currency) : `$${n.toFixed(2)}`);
  const served = items.filter((i) => i.status === "served").length;

  return (
    <div className="stb">
      <div className="stb-head">
        <span className="stb-dot" aria-hidden="true" />
        Your table{table ? ` · Table ${table}` : ""}
        {members > 1 && <span className="stb-members">{members} guests</span>}
      </div>
      {items.length === 0 ? (
        <div className="stb-empty">No dishes sent to the kitchen yet. When anyone at your table orders, it shows up here with its live status.</div>
      ) : (
        <>
          <div className="stb-progress">{served} of {items.length} served</div>
          <div className="stb-items">
            {items.map((it) => (
              <div key={it.id} className="stb-item">
                <span className="stb-item-name">{it.title} <span className="stb-qty">×{it.qty}</span></span>
                <span className={`stb-pill ${it.status}`}>{STATUS_LABEL[it.status] || it.status}</span>
              </div>
            ))}
          </div>
          {bill && (
            <div className="bill-rows stb-bill">
              <div className="bill-line"><span>Subtotal</span><span>{show(Number(bill.subtotal) || 0)}</span></div>
              <div className="bill-line"><span>Tax</span><span>{show(Number(bill.tax) || 0)}</span></div>
              <div className="bill-line grand"><span>Table total</span><span>{show(Number(bill.total) || 0)}</span></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
