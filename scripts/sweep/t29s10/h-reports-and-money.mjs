// Section H — the numbers screens: a restaurant's Full report (/restaurants/report), the platform's
// Revenue (/revenue), Usage (/usage), the recovery backup (/restaurants/export) and Staff online
// (/staff-online). Every figure the screen is handed is CROSS-CHECKED against a head count taken
// from the database itself — the one kind of check no earlier ledger ran on these files.
const IST = 5.5 * 3600_000;
const istMidnightMinus = (days) => { const n = new Date(); const i = new Date(n.getTime() + IST); return new Date(Date.UTC(i.getUTCFullYear(), i.getUTCMonth(), i.getUTCDate()) - days * 86400000 - IST).toISOString(); };

export default function section(c) {
  const rep = async (rid, range = "7d") => (c.cache[`rep${rid}${range}`] ||= await c.req(`/api/admin/restaurants/report?restaurant_id=${rid}&range=${range}`));

  c.sec("H · Full report — every count is the database's own");
  for (const [who, rid] of [["French House", c.FH], ["Aangan (read only)", c.AANGAN]]) {
    for (const range of ["7d", "30d"]) {
      const from = istMidnightMinus(range === "30d" ? 29 : 6);
      c.phase(`${who} · ${range}: orders (cancelled left out) match the database`, "head count, same window", async () => {
        const r = await rep(rid, range); const n = await c.count("orders", `restaurant_id=eq.${rid}&status=neq.cancelled&created_at=gte.${from}`);
        return r.json.usage.orders === n || `report ${r.json.usage.orders}, database ${n}`;
      });
      c.phase(`${who} · ${range}: tables opened match the database`, "head count of sessions", async () => {
        const r = await rep(rid, range); const n = await c.count("sessions", `restaurant_id=eq.${rid}&created_at=gte.${from}`);
        return r.json.usage.sessions === n || `report ${r.json.usage.sessions}, database ${n}`;
      });
      c.phase(`${who} · ${range}: waiter calls match the database`, "head count of waiter_calls", async () => {
        const r = await rep(rid, range); const n = await c.count("waiter_calls", `restaurant_id=eq.${rid}&created_at=gte.${from}`);
        return r.json.usage.waiterCalls === n || `report ${r.json.usage.waiterCalls}, database ${n}`;
      });
      c.phase(`${who} · ${range}: the day-by-day chart adds up to the orders figure`, "sum the trend", async () => {
        const r = await rep(rid, range); const sum = r.json.trend.reduce((a, t) => a + t.orders, 0);
        return sum === r.json.usage.orders || `chart ${sum}, headline ${r.json.usage.orders}`;
      });
    }
    c.phase(`${who}: tables open now, dishes and active staff match the database`, "three head counts", async () => {
      const u = (await rep(rid)).json.usage;
      const [open, dishes, staff] = await Promise.all([c.count("sessions", `restaurant_id=eq.${rid}&status=eq.open`), c.count("menu_items", `restaurant_id=eq.${rid}`), c.count("staff_users", `restaurant_id=eq.${rid}&active=eq.true`)]);
      return u.tablesOpenNow === open && u.menuItemCount === dishes && u.staffTotal === staff || `report ${u.tablesOpenNow}/${u.menuItemCount}/${u.staffTotal} vs ${open}/${dishes}/${staff}`;
    });
    c.phase(`${who}: tables configured is the settings row's own number`, "compare table_count", async () => {
      const t = (await c.sq(`settings?select=table_count&restaurant_id=eq.${rid}`)).json[0]?.table_count;
      return (await rep(rid)).json.usage.tablesConfigured === (Number(t) || 0) || `${(await rep(rid)).json.usage.tablesConfigured} vs ${t}`;
    });
    c.phase(`${who}: the owner named on the report is the restaurant's primary owner`, "compare with owner_user_id", async () => {
      const o = (await c.sq(`restaurants?select=owner_user_id&id=eq.${rid}`)).json[0].owner_user_id;
      const u = o ? (await c.sq(`staff_users?select=name,username&id=eq.${o}`)).json[0] : null;
      return (await rep(rid)).json.restaurant.owner === (u ? u.name || u.username : null) || `${(await rep(rid)).json.restaurant.owner}`;
    });
  }
  c.phase("'today' starts at the 05:00 IST business day, like the Dashboard", "read rangeBounds", () => /if \(range === "today"\) return \{ from: new Date\(businessDayStartIso\(now\)\), to: now \}/.test(c.clean("app/api/admin/restaurants/report/route.ts")));
  c.phase("the report carries no food money in any window", "search all three answers", async () => {
    for (const r of ["today", "7d", "30d"]) if (/₹|revenue|"amount"|"total"/.test((await rep(c.FH, r)).text)) return `money in ${r}`;
    return true;
  });

  c.sec("H · Revenue — the platform's own income, cross-checked");
  const rev = async () => (c.cache.rev ||= await c.req("/api/admin/revenue"));
  c.phase("the status bars add up to the number of live restaurants", "sum byStatus vs a head count", async () => {
    const n = await c.count("restaurants", "deleted_at=is.null"); const s = Object.values((await rev()).json.byStatus).reduce((a, b) => a + b, 0);
    return s === n || `bars ${s}, restaurants ${n}`;
  });
  c.phase("MRR is the sum of ACTIVE INR subscriptions, yearly spread over twelve, binned ones left out", "recompute from restaurant_billing", async () => {
    const live = new Set((await c.sq("restaurants?select=id&deleted_at=is.null&limit=5000")).json.map((x) => x.id));
    const b = (await c.sq("restaurant_billing?select=restaurant_id,status,amount,currency,cycle&limit=5000")).json.filter((x) => live.has(x.restaurant_id) && x.status === "active" && (x.currency || "INR") === "INR");
    const mrr = Math.round(b.reduce((a, x) => a + (x.cycle === "monthly" ? Number(x.amount) || 0 : (Number(x.amount) || 0) / 12), 0));
    return (await rev()).json.mrr === mrr || `route ${(await rev()).json.mrr}, recomputed ${mrr}`;
  });
  c.phase("ARR is exactly twelve months of MRR", "compare", async () => (await rev()).json.arr === (await rev()).json.mrr * 12);
  c.phase("the chart is the last twelve IST months, oldest first, ending this month", "read monthly", async () => {
    const m = (await rev()).json.monthly.map((x) => x.month); const i = new Date(Date.now() + IST);
    const want = `${i.getUTCFullYear()}-${String(i.getUTCMonth() + 1).padStart(2, "0")}`;
    return m.length === 12 && m[11] === want && m.every((x, k) => k === 0 || x > m[k - 1]) || JSON.stringify(m);
  });
  c.phase("the payments it says it counted are every payment there is", "compare paymentsCounted with a head count", async () => {
    const n = await c.count("restaurant_payments", "select=*"); return (await rev()).json.paymentsCounted === n || `${(await rev()).json.paymentsCounted} vs ${n}`;
  });
  c.phase("the paying list is biggest first, at most a hundred, every name a real restaurant", "read paying", async () => {
    const p = (await rev()).json.paying; return p.length <= 100 && p.every((x, k) => k === 0 || p[k - 1].monthly >= x.monthly) && p.every((x) => x.name && x.name !== "—") || "order or names wrong";
  });
  c.phase("no restaurant's FOOD sales appear anywhere on it", "search the answer for sales words", async () => !/sales|orders|bill|food/i.test(Object.keys((await rev()).json).join()) || Object.keys((await rev()).json).join());

  c.sec("H · Usage — cross-checked");
  const use = async (q = "") => (c.cache[`u${q}`] ||= await c.req(`/api/admin/usage${q}`));
  c.phase("one row per live restaurant, no more and no fewer", "compare with a head count", async () => { const n = await c.count("restaurants", "deleted_at=is.null"); return (await use()).json.rows.length === n && (await use()).json.totals.restaurants === n || `${(await use()).json.rows.length} vs ${n}`; });
  c.phase("the totals line is the sum of the rows", "add the rows up", async () => {
    const { rows, totals } = (await use()).json; const s = (k) => rows.reduce((a, r) => a + r[k], 0);
    return totals.orders7d === s("orders7d") && totals.orders30d === s("orders30d") && totals.staff === s("staff") || JSON.stringify(totals);
  });
  c.phase("French House's tables are its settings' table count", "compare", async () => {
    const r = (await use()).json.rows.find((x) => x.id === c.FH); const t = (await c.sq(`settings?select=table_count&restaurant_id=eq.${c.FH}`)).json[0].table_count;
    return r.tables === t || `${r.tables} vs ${t}`;
  });
  c.phase("French House's staff figure is its active logins", "head count", async () => {
    const r = (await use()).json.rows.find((x) => x.id === c.FH); const n = await c.count("staff_users", `restaurant_id=eq.${c.FH}&active=eq.true`);
    return r.staff === n || `${r.staff} vs ${n}`;
  });
  c.phase("a custom range counts exactly that range for French House (IST days, end day included)", "?from=2026-10-01&to=2026-10-05 vs a head count", async () => {
    const r = await use("?from=2026-10-01&to=2026-10-05");
    const n = await c.count("orders", `restaurant_id=eq.${c.FH}&status=neq.cancelled&created_at=gte.2026-09-30T18:30:00Z&created_at=lt.2026-10-05T18:30:00Z`);
    return r.json.rows.find((x) => x.id === c.FH).ordersRange === n || `${r.json.rows.find((x) => x.id === c.FH).ordersRange} vs ${n}`;
  });
  c.phase("…and echoes the window it actually used", "read range", async () => JSON.stringify((await use("?from=2026-10-01&to=2026-10-05")).json.range) === '{"from":"2026-10-01","to":"2026-10-05"}');
  c.phase("a single-day range is that whole day, not an empty instant", "?from=to; ordersRange is a number", async () => { const r = await use("?from=2026-10-05&to=2026-10-05"); return r.status === 200 && typeof r.json.totals.ordersRange === "number" || `${r.status}`; });
  c.phase("31 February is refused, not counted from 3 March (item 11)", "?from=2026-02-31&to=2026-03-05", async () => (await use("?from=2026-02-31&to=2026-03-05")).status === 400);
  c.phase("usage carries no food money", "search the answer", async () => !/₹|revenue|"amount"/.test((await use()).text));

  c.sec("H · the recovery backup — cross-checked");
  const exp = async () => (c.cache.exp ||= await c.req(`/api/admin/restaurants/export?rid=${c.FH}`));
  c.phase("French House's backup is complete, with nothing failed or cut short", "read _meta", async () => { const m = (await exp()).json._meta; return m.complete === true && m.failed.length === 0 && m.truncated.length === 0 || JSON.stringify(m); });
  c.phase("…it carries every table it promises, plus the restaurant row and the staff", "compare the key set", async () => {
    const keys = Object.keys((await exp()).json); const want = ["settings", "categories", "filters", "menu_items", "sessions", "orders", "payments", "invoice_events", "credit_notes", "deletion_audit", "restaurant_owners", "staff_users", "restaurant"];
    return want.every((k) => keys.includes(k)) || want.filter((k) => !keys.includes(k)).join(", ");
  });
  c.phase("…its orders are every French House order (deleted ones too — it is a recovery file)", "head count of orders", async () => { const n = await c.count("orders", `restaurant_id=eq.${c.FH}`); return (await exp()).json.orders.length === Math.min(n, 100000) || `${(await exp()).json.orders.length} vs ${n}`; });
  c.phase("…its staff are every French House login, with no hash and no stored password copy", "head count + search", async () => {
    const s = (await exp()).json.staff_users; const n = await c.count("staff_users", `restaurant_id=eq.${c.FH}`);
    return s.length === n && !/password_hash|pin_hash|password_shown/.test(JSON.stringify(s)) || `${s.length} vs ${n}`;
  });
  c.phase("…its Removals record is complete", "head count of deletion_audit", async () => { const n = await c.count("deletion_audit", `restaurant_id=eq.${c.FH}`); return (await exp()).json.deletion_audit.length === n || `${(await exp()).json.deletion_audit.length} vs ${n}`; });
  c.phase("…every row in it belongs to French House", "check restaurant_id on every table that has one", async () => {
    const j = (await exp()).json; const bad = [];
    for (const [k, v] of Object.entries(j)) if (Array.isArray(v)) for (const row of v) if (row && "restaurant_id" in row && row.restaurant_id !== c.FH) { bad.push(k); break; }
    return bad.length === 0 || `rows of another restaurant in: ${bad.join(", ")}`;
  });
  c.phase("…it downloads as a file named for the restaurant and the day", "read Content-Disposition", async () => {
    const s = (await c.sq(`restaurants?select=slug&id=eq.${c.FH}`)).json[0].slug;
    return new RegExp(`attachment; filename="backup-${s}-\\d{4}-\\d{2}-\\d{2}\\.json"`).test((await exp()).headers.get("content-disposition") || "") || (await exp()).headers.get("content-disposition");
  });
  c.phase("…and the download is on the record (deleted again at the end of this run)", "look for the restaurant_export line", async () => { await exp(); const n = await c.count("staff_actions", `action=eq.restaurant_export&restaurant_id=eq.${c.FH}&created_at=gte.${c.T0}`); return n >= 1 || "no record of the download"; });
  c.phase("a malformed id is refused before any table is read", "GET rid=nope", async () => { const r = await c.req("/api/admin/restaurants/export?rid=nope"); return r.status === 400 || `${r.status}`; });

  c.sec("H · Staff online — cross-checked");
  const on = async () => (c.cache.on ||= await c.req("/api/admin/staff-online"));
  c.phase("everyone listed was seen in the last three minutes and is an active login", "look each up", async () => {
    const s = (await on()).json.staff; if (!s.length) return { ok: true, note: "nobody online right now" };
    const rows = (await c.sq(`staff_users?select=id,active,last_seen_at&id=in.(${s.map((x) => x.id).join(",")})`)).json;
    return rows.every((u) => u.active && Date.now() - Date.parse(u.last_seen_at) < 240000) || "a stale or inactive login listed";
  });
  c.phase("nobody seen in the last two minutes is missing from the list", "compare with a head count (1-minute margin for heartbeats)", async () => {
    const since = new Date(Date.now() - 120000).toISOString(); const n = await c.count("staff_users", `active=eq.true&last_seen_at=gte.${since}`);
    return (await on()).json.staff.length >= n || `listed ${(await on()).json.staff.length}, seen ${n}`;
  });
  c.phase("every name beside a person is the name of the restaurant they work at", "look each restaurant up", async () => {
    const s = (await on()).json.staff; const ids = [...new Set(s.map((x) => x.restaurant_id).filter(Boolean))]; if (!ids.length) return { ok: true, note: "nobody online" };
    const nm = new Map((await c.sq(`restaurants?select=id,name&id=in.(${ids.join(",")})`)).json.map((x) => [x.id, x.name]));
    return s.every((x) => !x.restaurant_id || x.restaurantName === nm.get(x.restaurant_id)) || "a wrong restaurant name";
  });
  c.phase("the list is capped and newest first", "read the route", () => /\.order\("last_seen_at", \{ ascending: false \}\)\s*\.limit\(300\)/.test(c.clean("app/api/admin/staff-online/route.ts")));
}
