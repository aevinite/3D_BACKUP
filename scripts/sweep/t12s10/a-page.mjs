// scripts/sweep/t12s10/a-page.mjs — BLOCK A · P181001–P181160 · the REAL app.js, called in the real page.
//
// Every check here runs inside the live waiter panel on :4412 (signed in as French House's diag
// waiter), calling the panel's OWN top-level functions — app.js is a classic script, so its
// declarations are page globals. State is swapped in for one synchronous evaluate and put back in a
// finally, so nothing a check sets can leak into the next one or onto the screen.
//   node scripts/sweep/t12s10/a-page.mjs [--base http://localhost:4412] [--only P181001,…] [--quiet]
import { makeRunner, ok, F_APP, waiterContext, openPanel, closeBrowser } from "./lib.mjs";

export async function blockA(R = makeRunner("T12 · block A · the real functions in the page")) {
  const { check } = R;
  const ctx = await waiterContext({ width: 1194, height: 834, touch: true });
  const { page, errors } = await openPanel(ctx);
  // Run fn(state-snapshot-free) with a temporary summary/data patch; always restore.
  await page.evaluate(() => {
    window.__t12with = (patch, fn) => {
      const keep = { summary: state.summary, data: state.data, table: state.table, floorFilter: state.floorFilter, cart: state.cart, allergies: state.allergies, dishSearch: state.dishSearch };
      const keepWho = typeof TABLET_WHO === "undefined" ? undefined : TABLET_WHO;
      try {
        if (patch.summary) state.summary = Object.assign({ tiles: {}, calls: [], requests: [], joiners: [], blocklist: [], merges: [] }, patch.summary);
        if (patch.data) state.data = Object.assign({}, state.data, { sessions: [], members: [], orders: [], items: [], calls: [], requests: [] }, patch.data);
        if (patch.settings) state.data = Object.assign({}, state.data, { settings: Object.assign({}, state.data.settings, patch.settings) });
        if ("table" in patch) state.table = patch.table;
        if ("floorFilter" in patch) state.floorFilter = patch.floorFilter;
        if ("cart" in patch) state.cart = patch.cart;
        if ("allergies" in patch) state.allergies = patch.allergies;
        if ("dishSearch" in patch) state.dishSearch = patch.dishSearch;
        if ("who" in patch) TABLET_WHO = patch.who;
        return fn();
      } finally {
        state.summary = keep.summary; state.data = keep.data; state.table = keep.table; state.floorFilter = keep.floorFilter;
        state.cart = keep.cart; state.allergies = keep.allergies; state.dishSearch = keep.dishSearch;
        if (keepWho !== undefined || "who" in patch) TABLET_WHO = keepWho === undefined ? null : keepWho;
      }
    };
  });
  const inPanel = (fn, arg) => page.evaluate(fn, arg);
  const P = "PAGE — real app.js on :4412";

  // ── A1 · text and money helpers ──────────────────────────────────────────────────────────────
  await check("P181001", F_APP, "esc() turns all five HTML specials into entities", P, async () => {
    const r = await inPanel(() => esc(`<a href="x" title='y'>&</a>`));
    return ok(r === "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;", r);
  });
  await check("P181002", F_APP, "esc() of null/undefined is an empty string, never the word", P, async () => {
    const r = await inPanel(() => [esc(null), esc(undefined), esc(0)]);
    return ok(r[0] === "" && r[1] === "" && r[2] === "0", JSON.stringify(r));
  });
  await check("P181003", F_APP, "foldAccents() lets 'caffe' find 'Caffè' and is case-blind", P, async () => {
    const r = await inPanel(() => [foldAccents("Caffè Crème"), foldAccents(null)]);
    return ok(r[0] === "caffe creme" && r[1] === "", JSON.stringify(r));
  });
  await check("P181004", F_APP, "inr() writes Indian grouping (₹1,07,880), never ₹107,880", P, async () => {
    const r = await inPanel(() => inr(107880));
    return ok(r === "₹1,07,880", r);
  });
  await check("P181005", F_APP, "inr() of a non-number is ₹0, never NaN", P, async () => {
    const r = await inPanel(() => [inr("abc"), inr(undefined), inr(null)]);
    return ok(r.every((x) => x === "₹0"), JSON.stringify(r));
  });
  await check("P181006", F_APP, "inrExact() keeps the paise a person must match (₹1,065.75)", P, async () => {
    const r = await inPanel(() => [inrExact(1065.75), inrExact(1066), inrExact("40.4")]);
    return ok(r[0] === "₹1,065.75" && r[1] === "₹1,066" && r[2] === "₹40.40", JSON.stringify(r));
  });
  await check("P181007", F_APP, "inrExact() treats a sub-half-paisa float residue as a whole rupee", P, async () => {
    const r = await inPanel(() => inrExact(0.1 + 0.2 + 99.7));
    return ok(r === "₹100", r);
  });
  await check("P181008", F_APP, "normAlg() strips a leading 'no', commas and extra spaces, caps at 24", P, async () => {
    const r = await inPanel(() => [normAlg("No  Garlic"), normAlg("no-garlic"), normAlg("nuts, peanuts"), normAlg("x".repeat(40)).length]);
    return ok(r[0] === "garlic" && r[1] === "garlic" && r[2] === "nuts peanuts" && r[3] === 24, JSON.stringify(r));
  });
  await check("P181009", F_APP, "algLabel() gives a standard allergen its emoji and a typed one 🚫", P, async () => {
    const r = await inPanel(() => [algLabel("nuts"), algLabel("coriander")]);
    return ok(r[0] === "🥜 Nuts" && r[1] === "🚫 coriander", JSON.stringify(r));
  });
  await check("P181010", F_APP, "rangeText() folds a run of tables into '1–6' and keeps gaps", P, async () => {
    const r = await inPanel(() => [rangeText(["1", "2", "3", "4", "5", "6"]), rangeText([1, 2, 4, 9, 10]), rangeText([]), rangeText(["7"])]);
    return ok(r[0] === "1–6" && r[1] === "1–2, 4, 9–10" && r[2] === "" && r[3] === "7", JSON.stringify(r));
  });
  await check("P181011", F_APP, "rangeText() sorts numerically, not as text (2 before 10)", P, async () => {
    const r = await inPanel(() => rangeText(["10", "2", "3"]));
    return ok(r === "2–3, 10", r);
  });
  await check("P181012", F_APP, "callIcon() names what was called — water, cutlery, napkin, clean, bill, help", P, async () => {
    const r = await inPanel(() => ["Water please", "CUTLERY", "napkins", "clean table", "the bill", "call waiter", "?"].map(callIcon).join(""));
    return ok(r === "💧🍴🧻🧹🧾🙋🔔", r);
  });
  await check("P181013", F_APP, "callIcon() reads 'check' as the bill only as a whole word (not 'checkout')", P, async () => {
    const r = await inPanel(() => [callIcon("check please"), callIcon("checkout help")]);
    return ok(r[0] === "🧾" && r[1] === "🙋", JSON.stringify(r));
  });
  await check("P181014", F_APP, "a dish only moves FORWARD: new → cooking → served; served goes nowhere", P, async () => {
    const r = await inPanel(() => [NEXT_STATUS.received, NEXT_STATUS.preparing, NEXT_STATUS.ready, NEXT_STATUS.served]);
    return ok(r[0] === "preparing" && r[1] === "served" && r[2] === "served" && r[3] === undefined, JSON.stringify(r));
  });
  await check("P181015", F_APP, "the status words a waiter reads are new / cooking / ready / served", P, async () => {
    const r = await inPanel(() => Object.values(STATUS_WORD).join("/"));
    return ok(r === "new/cooking/ready/served", r);
  });
  await check("P181016", F_APP, "the six common allergens are listed, each with a slug and a label", P, async () => {
    const r = await inPanel(() => ALLERGENS.map((a) => a.slug).join(","));
    return ok(r === "gluten,dairy,eggs,nuts,soy,fish", r);
  });

  // ── A2 · reading the server's answer ─────────────────────────────────────────────────────────
  await check("P181017", F_APP, "wantsPin() reads the needPin FLAG, not the sentence", P, async () => {
    const r = await inPanel(() => [wantsPin({ data: { needPin: true }, message: "anything at all" }), wantsPin({ data: {}, message: "nope" }), wantsPin(null)]);
    return ok(r[0] === true && r[1] === false && r[2] === false, JSON.stringify(r));
  });
  await check("P181018", F_APP, "wantsPin() keeps the old wording only as a fallback for an old server", P, async () => {
    const r = await inPanel(() => wantsPin({ message: "A manager PIN is required for this." }));
    return ok(r === true, String(r));
  });
  await check("P181019", F_APP, "errText() of a clash says BOTH what happened and what to do", P, async () => {
    const r = await inPanel(() => errText({ message: "clash_changed_elsewhere", data: { clash: { plain: "Someone changed this.", todo: "Redo yours." } } }));
    return ok(r === "Someone changed this. Redo yours.", r);
  });
  await check("P181020", F_APP, "errText() never shows a bare code for a clash, and has a fallback for nothing", P, async () => {
    const r = await inPanel(() => [errText({ message: "boom" }), errText(null)]);
    return ok(r[0] === "boom" && r[1] === "unknown error", JSON.stringify(r));
  });
  await check("P181021", F_APP, "savedMsg() says a different true sentence for busy / slow / behind / offline", P, async () => {
    const r = await inPanel(() => ["busy", "slow", "behind", "offline", "weird"].map((w) => savedMsg({ why: w })));
    const distinct = new Set(r.slice(0, 4)).size === 4;
    return ok(distinct && r[3] === r[4] && /busy/.test(r[0]) && /earlier change/.test(r[2]), r.join(" | "));
  });
  await check("P181022", F_APP, "no saved-offline message uses the code word 'syncing'", P, async () => {
    const r = await inPanel(() => ["busy", "slow", "behind", "offline"].map((w) => savedMsg({ why: w })).join(" "));
    return ok(!/sync/i.test(r), r);
  });
  await check("P181023", F_APP, "isQueued() is true only for the queue's own {queued:true}", P, async () => {
    const r = await inPanel(() => [isQueued({ queued: true }), isQueued({ queued: "yes" }), isQueued({}), isQueued(null)]);
    return ok(r.join() === "true,false,false,false", JSON.stringify(r));
  });
  await check("P181024", F_APP, "ridQ() leaves a real waiter's paths untouched (no ?rid on a staff login)", P, async () => {
    const r = await inPanel(() => [PANEL_RID, ridQ("/summary"), ridQ("/state?table=4")]);
    return ok(r[0] === "" && r[1] === "/summary" && r[2] === "/state?table=4", JSON.stringify(r));
  });
  await check("P181025", F_APP, "the ?skel paint hint is never sent on a request (ridQ ignores it)", P, async () => {
    const r = await inPanel(() => /skel/.test(ridQ("/summary")));
    return ok(r === false);
  });

  // ── A3 · the floor's model ───────────────────────────────────────────────────────────────────
  await check("P181026", F_APP, "summaryTile() of an unknown table is a plain Free tile with zero counts", P, async () => {
    const r = await inPanel(() => __t12with({ summary: { tiles: {} } }, () => summaryTile(999)));
    return ok(r.state === "free" && r.label === "Free" && r.meta === "" && r.counts.nw === 0, JSON.stringify(r).slice(0, 120));
  });
  await check("P181027", F_APP, "summaryTile() re-presents 'waiting' (party, nothing ordered) as Free", P, async () => {
    const r = await inPanel(() => __t12with({ summary: { tiles: { 4: { state: "waiting", label: "Open", meta: "waiting for guests" } } } }, () => summaryTile(4)));
    return ok(r.state === "free" && r.label === "Free" && r.meta === "", JSON.stringify(r));
  });
  await check("P181028", F_APP, "summaryTile() drops the dead 'tap to open' wording from a free tile", P, async () => {
    const r = await inPanel(() => __t12with({ summary: { tiles: { 4: { state: "free", label: "Free", meta: "tap to open" } } } }, () => summaryTile(4).meta));
    return ok(r === "", JSON.stringify(r));
  });
  await check("P181029", F_APP, "a merged CHILD is not free: tileIsOpen() reads its party's tile", P, async () => {
    const r = await inPanel(() => __t12with({ summary: { tiles: { 6: { state: "prep" }, 7: { state: "free" } }, merges: [{ parent_table: 6, child_table: 7 }] } }, () => [tileIsOpen(7), tileIsOpen(8)]));
    return ok(r[0] === true && r[1] === false, JSON.stringify(r));
  });
  await check("P181030", F_APP, "mergeParentOf / mergeChildrenOf / partyTablesOf agree on a three-table party", P, async () => {
    const r = await inPanel(() => __t12with({ summary: { merges: [{ parent_table: 6, child_table: 9 }, { parent_table: 6, child_table: 7 }] } },
      () => [mergeParentOf(7), mergeChildrenOf(6).join(","), partyTablesOf(9).join(","), partyTablesOf(3).join(",")]));
    return ok(r[0] === "6" && r[1] === "7,9" && r[2] === "6,7,9" && r[3] === "3", JSON.stringify(r));
  });
  await check("P181031", F_APP, "mergeGroupLabel() names the party 'T6 + T7', and null for a solo table", P, async () => {
    const r = await inPanel(() => __t12with({ summary: { merges: [{ parent_table: 6, child_table: 7 }] } }, () => [mergeGroupLabel(7), mergeGroupLabel(3)]));
    return ok(r[0] === "T6 + T7" && r[1] === null, JSON.stringify(r));
  });
  await check("P181032", F_APP, "canHostAParty() refuses a merged child even though it reads open", P, async () => {
    const r = await inPanel(() => __t12with({ summary: { tiles: { 6: { state: "prep" } }, merges: [{ parent_table: 6, child_table: 7 }] } }, () => [canHostAParty(6), canHostAParty(7)]));
    return ok(r[0] === true && r[1] === false, JSON.stringify(r));
  });
  await check("P181033", F_APP, "tableHasAnyParty() reads the RAW tile — a 'waiting' table counts as taken", P, async () => {
    const r = await inPanel(() => __t12with({ summary: { tiles: { 4: { state: "waiting" }, 5: { state: "free" }, 8: { state: "req" } } } }, () => [tableHasAnyParty(4), tableHasAnyParty(5), tableHasAnyParty(8)]));
    return ok(r.join() === "true,false,false", JSON.stringify(r));
  });
  await check("P181034", F_APP, "canTakeAParty() refuses joined, taken and wants-in tables; accepts a truly free one", P, async () => {
    const r = await inPanel(() => __t12with({ summary: { tiles: { 4: { state: "waiting" }, 8: { state: "free", hasReq: true }, 10: { state: "free" } }, merges: [{ parent_table: 6, child_table: 7 }], requests: [{ table_number: 9 }] } },
      () => [7, 6, 4, 8, 9, 10].map(canTakeAParty)));
    return ok(r.join() === "false,false,false,false,false,true", JSON.stringify(r));
  });
  await check("P181035", F_APP, "shiftBlockedWhy() gives each of the five reasons in its own word", P, async () => {
    const r = await inPanel(() => __t12with({ summary: { tiles: { 4: { state: "prep" } }, merges: [{ parent_table: 6, child_table: 7 }], requests: [{ table_number: 9 }] } },
      () => [shiftBlockedWhy(3, 3), shiftBlockedWhy(7, 3), shiftBlockedWhy(4, 3), shiftBlockedWhy(9, 3), shiftBlockedWhy(10, 3)]));
    return ok(r.join("|") === "this one|joined|taken|wants in|", JSON.stringify(r));
  });
  await check("P181036", F_APP, "shiftBlockedWhy() says 'not yours' for a table outside the waiter's section", P, async () => {
    const r = await inPanel(() => __t12with({ summary: { tiles: {}, my_tables: [1, 2, 3] } }, () => shiftBlockedWhy(5, 1)));
    return ok(r === "not yours", r);
  });
  await check("P181037", F_APP, "ordersOf(): a NEW party never inherits an older party's leftover orders", P, async () => {
    const r = await inPanel(() => __t12with({
      data: {
        sessions: [{ id: "s2", table_number: "4", status: "open", opened_at: "2026-10-12T10:00:00Z" }],
        orders: [
          { id: "old", table_number: "4", status: "served", session_id: "s1", created_at: "2026-10-03T10:00:00Z" },
          { id: "loose-old", table_number: "4", status: "served", session_id: null, created_at: "2026-07-07T10:00:00Z" },
          { id: "mine", table_number: "4", status: "preparing", session_id: "s2", created_at: "2026-10-12T10:05:00Z" },
          { id: "loose-new", table_number: "4", status: "preparing", session_id: null, created_at: "2026-10-12T09:59:30Z" },
        ],
      },
    }, () => ordersOf(4).map((o) => o.id).sort().join(",")));
    return ok(r === "loose-new,mine", r);
  });
  await check("P181038", F_APP, "ordersOf() leaves out cancelled and archived rows", P, async () => {
    const r = await inPanel(() => __t12with({ data: { orders: [{ id: "a", table_number: "4", status: "cancelled" }, { id: "b", table_number: "4", status: "served", archived: true }, { id: "c", table_number: "4", status: "served" }] } },
      () => ordersOf(4).map((o) => o.id).join(",")));
    return ok(r === "c", r);
  });
  await check("P181039", F_APP, "a merged child answers with its PARENT's session (sessionOf)", P, async () => {
    const r = await inPanel(() => __t12with({ summary: { merges: [{ parent_table: 6, child_table: 7 }] }, data: { sessions: [{ id: "S6", table_number: "6", status: "open" }] } },
      () => [sessionOf(7) && sessionOf(7).id, sessionOf(8) === undefined]));
    return ok(r[0] === "S6" && r[1] === true, JSON.stringify(r));
  });
  await check("P181040", F_APP, "partyOrders() de-duplicates an order that two member slices both carry", P, async () => {
    const r = await inPanel(() => __t12with({ summary: { merges: [{ parent_table: 6, child_table: 7 }] },
      data: { sessions: [{ id: "S6", table_number: "6", status: "open" }], orders: [{ id: "o1", table_number: "6", session_id: "S6", status: "served" }, { id: "o1", table_number: "6", session_id: "S6", status: "served" }, { id: "o2", table_number: "7", session_id: "S6", status: "served" }] } },
      () => partyOrders(7).map((o) => o.id).join(",")));
    return ok(r === "o1,o2", r);
  });
  await check("P181041", F_APP, "floorTableList() draws an OCCUPIED off-plan table and drops a free one", P, async () => {
    const r = await inPanel(() => __t12with({ settings: { table_count: 5 }, summary: { tiles: { 48: { state: "bill" }, 49: { state: "free" }, 50: { state: "waiting" } } } },
      () => floorTableList().join(",")));
    return ok(r === "1,2,3,4,5,48", r);
  });
  await check("P181042", F_APP, "floorTableList() keeps an off-plan MERGED member even though its own row reads free", P, async () => {
    const r = await inPanel(() => __t12with({ settings: { table_count: 5 }, summary: { tiles: { 47: { state: "free" }, 48: { state: "bill" } }, merges: [{ parent_table: 48, child_table: 47 }] } },
      () => floorTableList().join(",")));
    return ok(r === "1,2,3,4,5,47,48", r);
  });
  await check("P181043", F_APP, "floorTableList() never invents the gap between table_count and an off-plan table", P, async () => {
    const r = await inPanel(() => __t12with({ settings: { table_count: 3 }, summary: { tiles: { 300: { state: "prep" } } } }, () => floorTableList().length));
    return ok(r === 4, String(r));
  });
  await check("P181044", F_APP, "stepTables() walks only tables with something on them", P, async () => {
    const r = await inPanel(() => __t12with({ settings: { table_count: 6 }, summary: { tiles: { 2: { state: "prep" }, 5: { state: "bill" } } }, floorFilter: "all" }, () => stepTables().join(",")));
    return ok(r === "2,5", r);
  });
  await check("P181045", F_APP, "stepTables() falls back to the whole floor when nothing is busy", P, async () => {
    const r = await inPanel(() => __t12with({ settings: { table_count: 3 }, summary: { tiles: {} }, floorFilter: "all" }, () => stepTables().join(",")));
    return ok(r === "1,2,3", r);
  });
  await check("P181046", F_APP, "inMySection(): no section = the whole floor", P, async () => {
    const r = await inPanel(() => __t12with({ summary: { tiles: {} } }, () => [inMySection(1), inMySection(30), sectioned()]));
    return ok(r.join() === "true,true,false", JSON.stringify(r));
  });
  await check("P181047", F_APP, "inMySection(): a section narrows the floor to its tables", P, async () => {
    const r = await inPanel(() => __t12with({ settings: { table_count: 30 }, summary: { tiles: {}, my_tables: [1, 2, 3] } }, () => [inMySection(2), inMySection(4), sectioned()]));
    return ok(r.join() === "true,false,true", JSON.stringify(r));
  });
  await check("P181048", F_APP, "inMySection(): a table ABOVE the floor plan stays reachable (its bill is nobody's)", P, async () => {
    const r = await inPanel(() => __t12with({ settings: { table_count: 30 }, summary: { tiles: {}, my_tables: [1] } }, () => inMySection(48)));
    return ok(r === true, String(r));
  });
  await check("P181049", F_APP, "passesFilter() puts the section rule FIRST, whatever the chip says", P, async () => {
    const r = await inPanel(() => __t12with({ settings: { table_count: 30 }, summary: { tiles: { 5: { state: "new", hasNew: true } }, my_tables: [1] }, floorFilter: "needs" }, () => passesFilter(5)));
    return ok(r === false, String(r));
  });
  await check("P181050", F_APP, "passesFilter(): Active and Free split the floor with no overlap", P, async () => {
    const r = await inPanel(() => __t12with({ settings: { table_count: 4 }, summary: { tiles: { 2: { state: "prep" } } } }, () => {
      state.floorFilter = "open"; const a = floorTableList().filter(passesFilter);
      state.floorFilter = "free"; const f = floorTableList().filter(passesFilter);
      return [a.join(","), f.join(",")];
    }));
    return ok(r[0] === "2" && r[1] === "1,3,4", JSON.stringify(r));
  });
  await check("P181051", F_APP, "needsAttention(): a bell rung AT a merged child counts for that child", P, async () => {
    const r = await inPanel(() => __t12with({ summary: { tiles: { 6: { state: "prep" }, 7: { state: "free", hasCall: true } }, merges: [{ parent_table: 6, child_table: 7 }] } }, () => [needsAttention(7), needsAttention(6)]));
    return ok(r[0] === true && r[1] === false, JSON.stringify(r));
  });
  await check("P181052", F_APP, "needsAttention(): food READY for the party flags every member tile", P, async () => {
    const r = await inPanel(() => __t12with({ summary: { tiles: { 6: { state: "ready", counts: { nw: 0, ck: 0, rd: 2, sv: 0 } }, 7: { state: "free" } }, merges: [{ parent_table: 6, child_table: 7 }] } }, () => [needsAttention(7), needsAttention(6)]));
    return ok(r.join() === "true,true", JSON.stringify(r));
  });
  await check("P181053", F_APP, "floorFilterCounts(): All = Active + Free, and Needs is a subset", P, async () => {
    const r = await inPanel(() => __t12with({ settings: { table_count: 6 }, summary: { tiles: { 1: { state: "new", hasNew: true }, 2: { state: "prep" }, 3: { state: "free", hasReq: true } } } }, () => floorFilterCounts()));
    const m = Object.fromEntries(r.map(([k, , c]) => [k, c]));
    return ok(m.all === 6 && m.open + m.free === m.all && m.needs <= m.all && m.needs === 2, JSON.stringify(m));
  });
  await check("P181054", F_APP, "floorFilterCounts() counts only MY tables when sectioned", P, async () => {
    const r = await inPanel(() => __t12with({ settings: { table_count: 30 }, summary: { tiles: {}, my_tables: [1, 2, 3, 4] } }, () => floorFilterCounts()[0][2]));
    return ok(r === 4, String(r));
  });
  await check("P181055", F_APP, "floorPerRow() clamps a stored number to 2…12", P, async () => {
    const r = await inPanel(() => {
      const mm = window.matchMedia; window.matchMedia = (q) => ({ matches: false, media: q, addListener() {}, removeListener() {} });
      try { return [__t12with({ settings: { floor_per_row: 40 } }, () => floorPerRow()), __t12with({ settings: { floor_per_row: 1 } }, () => floorPerRow())]; }
      finally { window.matchMedia = mm; }
    });
    return ok(r[0] === 12 && r[1] === 2, JSON.stringify(r));
  });
  await check("P181056", F_APP, "floorPerRow() caps a TOUCH device at 6 but keeps a smaller chosen number", P, async () => {
    const r = await inPanel(() => {
      const mm = window.matchMedia; window.matchMedia = (q) => ({ matches: /coarse/.test(q), media: q, addListener() {}, removeListener() {} });
      try { return [__t12with({ settings: { floor_per_row: 12 } }, () => floorPerRow()), __t12with({ settings: { floor_per_row: 4 } }, () => floorPerRow())]; }
      finally { window.matchMedia = mm; }
    });
    return ok(r[0] === 6 && r[1] === 4, JSON.stringify(r));
  });
  await check("P181057", F_APP, "floorPerRow() remembers the restaurant's number UNCAPPED, per restaurant", P, async () => {
    const r = await inPanel(() => {
      const mm = window.matchMedia; window.matchMedia = (q) => ({ matches: /coarse/.test(q), media: q, addListener() {}, removeListener() {} });
      const k = perRowKey(); const before = localStorage.getItem(k);
      try { __t12with({ settings: { floor_per_row: 12 } }, () => floorPerRow()); return [k, localStorage.getItem(k)]; }
      finally { window.matchMedia = mm; if (before == null) localStorage.removeItem(k); else localStorage.setItem(k, before); }
    });
    return ok(/^lfh_tablet_per_row:/.test(r[0]) && r[1] === "12", JSON.stringify(r));
  });
  await check("P181058", F_APP, "tableCount() uses the real count and caches it per restaurant", P, async () => {
    const r = await inPanel(() => { const k = tableCountKey(); const b = localStorage.getItem(k); try { const n = __t12with({ settings: { table_count: 17 } }, () => tableCount()); return [n, localStorage.getItem(k)]; } finally { if (b == null) localStorage.removeItem(k); else localStorage.setItem(k, b); } });
    return ok(r[0] === 17 && r[1] === "17", JSON.stringify(r));
  });
  await check("P181059", F_APP, "the per-device caches are keyed by restaurant id, never shared across tenants", P, async () => {
    const r = await inPanel(() => [perRowKey(), tableCountKey(), panelRid()]);
    return ok(r[0].endsWith(r[2]) && r[1].endsWith(r[2]) && r[2].length > 10, JSON.stringify(r));
  });

  // ── A4 · money on the screen ─────────────────────────────────────────────────────────────────
  await check("P181060", F_APP, "effRate() sums named tax components", P, async () => {
    const r = await inPanel(() => __t12with({ settings: { tax_components: [{ label: "CGST", rate: 2.5 }, { label: "SGST", rate: 2.5 }], price_tax_mode: "excl" } }, () => effRate()));
    return ok(Math.abs(r - 0.05) < 1e-9, String(r));
  });
  await check("P181061", F_APP, "effRate() is 0 on the composition scheme (no GST may be charged)", P, async () => {
    const r = await inPanel(() => __t12with({ settings: { price_tax_mode: "composition", tax_rate: 0.05 } }, () => effRate()));
    return ok(r === 0, String(r));
  });
  await check("P181062", F_APP, "effRate() agrees with the shared bill file's taxModel for this restaurant", P, async () => {
    const r = await inPanel(() => [effRate(), LFH_BILLDOC.taxModel(state.data.settings).rate]);
    return ok(r[0] === r[1], JSON.stringify(r));
  });
  await check("P181063", F_APP, "banquetRate() uses the banquet components when set, else the dine-in rate", P, async () => {
    const r = await inPanel(() => [
      __t12with({ settings: { banquet_tax_components: [{ label: "GST", rate: 18 }] } }, () => banquetRate()),
      __t12with({ settings: { banquet_tax_components: [] } }, () => banquetRate() === effRate()),
    ]);
    return ok(Math.abs(r[0] - 0.18) < 1e-9 && r[1] === true, JSON.stringify(r));
  });
  await check("P181064", F_APP, "orderTaxSplit(): a 'excl' line is fully taxable, an 'exempt' (MRP) line is not", P, async () => {
    const r = await inPanel(() => __t12with({ settings: { tax_rate: 0.05, tax_components: [], price_tax_mode: "excl" } }, () => orderTaxSplit({ total: 0, items: [{ price: 200, qty: 2, tax_mode: "excl" }, { price: 20, qty: 1, tax_mode: "exempt" }] })));
    return ok(r.base === 400 && r.nontax === 20, JSON.stringify(r));
  });
  await check("P181065", F_APP, "orderTaxSplit(): an 'incl' line's base is its price worked back through the rate", P, async () => {
    const r = await inPanel(() => __t12with({ settings: { tax_rate: 0.05, tax_components: [], price_tax_mode: "excl" } }, () => orderTaxSplit({ items: [{ price: 105, qty: 1, tax_mode: "incl" }] })));
    return ok(r.base === 100 && r.nontax === 0, JSON.stringify(r));
  });
  await check("P181066", F_APP, "orderTaxSplit(): an old ticket with no modes is all taxable (the gross worked back)", P, async () => {
    const r = await inPanel(() => __t12with({ settings: { tax_rate: 0.05, tax_components: [], price_tax_mode: "excl" } }, () => orderTaxSplit({ total: 210, items: [{ price: 100, qty: 2 }] })));
    return ok(r.base === 200 && r.nontax === 0, JSON.stringify(r));
  });
  await check("P181067", F_APP, "orderTaxSplit() never reports a phantom ₹0.01 of MRP on an ordinary bill", P, async () => {
    const r = await inPanel(() => __t12with({ settings: { tax_rate: 0.05, tax_components: [], price_tax_mode: "excl" } }, () => orderTaxSplit({ total: 1155.37, items: [{ price: 366.67, qty: 3, tax_mode: "excl" }] }).nontax));
    return ok(r === 0, String(r));
  });
  await check("P181068", F_APP, "dishIsMrp() stamps MRP only when the restaurant allows per-dish tax modes", P, async () => {
    const r = await inPanel(() => [
      __t12with({ settings: { item_tax_modes_allowed: true } }, () => dishIsMrp({ tax_mode: "mrp" })),
      __t12with({ settings: { item_tax_modes_allowed: false } }, () => dishIsMrp({ tax_mode: "mrp" })),
      __t12with({ settings: { item_tax_modes_allowed: true } }, () => dishIsMrp({ tax_mode: "excl" })),
    ]);
    return ok(r.join() === "true,false,false", JSON.stringify(r));
  });
  await check("P181069", F_APP, "dishRowsOf() prefers the real per-dish rows (each with an id) over the JSON copy", P, async () => {
    const r = await inPanel(() => __t12with({ data: { items: [{ id: "i1", order_id: "o1", title: "Tea", qty: 2, status: "preparing", unit_price: 30 }] } },
      () => dishRowsOf({ id: "o1", items: [{ title: "Tea", qty: 2, price: 30 }] })));
    return ok(r.length === 1 && r[0].id === "i1" && r[0].fromDb === true && r[0].price === 30, JSON.stringify(r));
  });
  await check("P181070", F_APP, "dishRowsOf() falls back to the order's JSON lines (no id, never tappable)", P, async () => {
    const r = await inPanel(() => __t12with({ data: { items: [] } }, () => dishRowsOf({ id: "o9", status: "served", items: [{ name: "Old dish", qty: 1, price: "50" }] })));
    return ok(r.length === 1 && r[0].id === null && r[0].fromDb === false && r[0].title === "Old dish" && r[0].status === "served", JSON.stringify(r));
  });
  await check("P181071", F_APP, "dishRowsOf() marks a line MRP from the order's frozen ticket", P, async () => {
    const r = await inPanel(() => __t12with({ data: { items: [{ id: "i1", order_id: "o1", title: "Water", qty: 1, status: "served" }] } },
      () => dishRowsOf({ id: "o1", items: [{ title: "Water", is_mrp: true }] })[0].is_mrp));
    return ok(r === true, String(r));
  });
  await check("P181072", F_APP, "tableAgg(): the due takes the discount off BEFORE tax (total − disc×(1+rate))", P, async () => {
    const r = await inPanel(() => __t12with({ settings: { tax_rate: 0.05, tax_components: [], price_tax_mode: "excl" }, table: "4",
      data: { sessions: [{ id: "S", table_number: "4", status: "open" }], orders: [{ id: "o", table_number: "4", session_id: "S", status: "served", total: 1050, discount: 100, payment_status: "unpaid" }] } },
      () => tableAgg("4").due));
    return ok(Math.abs(r - 945) < 1e-9, String(r));
  });
  await check("P181073", F_APP, "tableAgg(): a brand-new (received) order owes nothing yet and rings nothing", P, async () => {
    const r = await inPanel(() => __t12with({ table: "4", data: { sessions: [{ id: "S", table_number: "4", status: "open" }], orders: [{ id: "o", table_number: "4", session_id: "S", status: "received", total: 500, payment_status: "unpaid" }] } },
      () => { const a = tableAgg("4"); return [a.due, a.unpaid, a.paid]; }));
    return ok(r[0] === 0 && r[1] === false && r[2] === false, JSON.stringify(r));
  });
  await check("P181074", F_APP, "tableAgg(): the due never goes below zero", P, async () => {
    const r = await inPanel(() => __t12with({ table: "4", data: { sessions: [{ id: "S", table_number: "4", status: "open" }], orders: [{ id: "o", table_number: "4", session_id: "S", status: "served", total: 100, discount: 500, payment_status: "unpaid" }] } },
      () => tableAgg("4").due));
    return ok(r === 0, String(r));
  });
  await check("P181075", F_APP, "tileState() precedence: new beats ready beats cooking beats served", P, async () => {
    const r = await inPanel(() => {
      const mk = (statuses) => __t12with({ table: "4", data: { sessions: [{ id: "S", table_number: "4", status: "open" }], orders: [{ id: "o", table_number: "4", session_id: "S", status: "preparing", total: 1, payment_status: "unpaid" }], items: statuses.map((s, i) => ({ id: "i" + i, order_id: "o", status: s, qty: 1 })) } }, () => tileState("4").cls);
      return [mk(["received", "ready", "preparing"]), mk(["ready", "preparing", "served"]), mk(["preparing", "served"]), mk(["served"])];
    });
    return ok(r.join() === "new,ready,prep,bill", JSON.stringify(r));
  });
  await check("P181076", F_APP, "tileState(): served AND paid reads Cleared, the same word as the server", P, async () => {
    const r = await inPanel(() => __t12with({ table: "4", data: { sessions: [{ id: "S", table_number: "4", status: "open" }], orders: [{ id: "o", table_number: "4", session_id: "S", status: "served", total: 1, payment_status: "paid" }], items: [{ id: "i", order_id: "o", status: "served", qty: 1 }] } },
      () => tileState("4")));
    return ok(r.cls === "done" && r.label === "Cleared", JSON.stringify(r));
  });
  await check("P181077", F_APP, "patchTileFromSlice() writes the SAME state and due tableAgg computes", P, async () => {
    const r = await inPanel(() => __t12with({ summary: { tiles: {} }, table: "4", data: { sessions: [{ id: "S", table_number: "4", status: "open" }], orders: [{ id: "o", table_number: "4", session_id: "S", status: "served", total: 525, discount: 0, payment_status: "unpaid" }], items: [{ id: "i", order_id: "o", status: "served", qty: 2 }] } },
      () => { const a = tableAgg("4"); patchTileFromSlice("4"); const t = state.summary.tiles["4"]; return [t.state, t.due === a.due, t.pay, t.meta]; }));
    return ok(r[0] === "bill" && r[1] === true && r[2] === "red" && /2\/2 served · ₹525 due/.test(r[3]), JSON.stringify(r));
  });
  await check("P181078", F_APP, "patchTileFromSlice() on a merged child patches the PARENT's tile", P, async () => {
    const r = await inPanel(() => __t12with({ summary: { tiles: {}, merges: [{ parent_table: 6, child_table: 7 }] }, data: { sessions: [{ id: "S6", table_number: "6", status: "open" }], orders: [{ id: "o", table_number: "7", session_id: "S6", status: "preparing", total: 1, payment_status: "unpaid" }], items: [{ id: "i", order_id: "o", status: "preparing", qty: 1 }] } },
      () => { patchTileFromSlice("7"); return Object.keys(state.summary.tiles).join(","); }));
    return ok(r === "6", r);
  });

  // ── A5 · what a waiter is allowed to see ─────────────────────────────────────────────────────
  await check("P181079", F_APP, "tperm() of an unset key is 'off'", P, async () => {
    const r = await inPanel(() => __t12with({ settings: { tablet_zzz: undefined } }, () => tperm("tablet_zzz")));
    return ok(r === "off", r);
  });
  await check("P181080", F_APP, "tshow(): a real waiter sees a control only when it is on or PIN", P, async () => {
    const r = await inPanel(() => __t12with({ who: { higherView: false }, settings: { tablet_discount: "off", tablet_mark_paid: "pin", tablet_take_orders: "on" } }, () => [tshow("tablet_discount"), tshow("tablet_mark_paid"), tshow("tablet_take_orders")]));
    return ok(r.join() === "false,true,true", JSON.stringify(r));
  });
  await check("P181081", F_APP, "txray() never tints anything for a real waiter (R67 — absent, never greyed)", P, async () => {
    const r = await inPanel(() => __t12with({ who: { higherView: false }, settings: { tablet_discount: "off" } }, () => txray("tablet_discount")));
    return ok(r === "", JSON.stringify(r));
  });
  await check("P181082", F_APP, "txray() tints an off control ONLY in the admin's view", P, async () => {
    const r = await inPanel(() => __t12with({ who: { higherView: true }, settings: { tablet_discount: "off" } }, () => [tshow("tablet_discount"), txray("tablet_discount")]));
    return ok(r[0] === true && r[1] === " xray-off", JSON.stringify(r));
  });
  await check("P181083", F_APP, "the signed-in diag waiter is NOT the admin view (no ribbon, no tint)", P, async () => {
    const r = await inPanel(() => [tHigher(), tSim(), !!document.getElementById("xrayRibbon")]);
    return ok(r.join() === "false,false,false", JSON.stringify(r));
  });
  await check("P181084", F_APP, "tabletTagsOn() follows the module ladder (allowed AND owner toggle)", P, async () => {
    const r = await inPanel(() => [
      __t12with({ who: { higherView: false }, settings: { table_tags_allowed: true, table_tags_owner_control: false } }, () => tabletTagsOn()),
      __t12with({ who: { higherView: false }, settings: { table_tags_allowed: true, table_tags_owner_control: true, table_tags_enabled: false } }, () => tabletTagsOn()),
      __t12with({ who: { higherView: false }, settings: { table_tags_allowed: false } }, () => tabletTagsOn()),
    ]);
    return ok(r.join() === "true,false,false", JSON.stringify(r));
  });
  await check("P181085", F_APP, "tabletKhataOn() reads its OWN ladder, not the table-tags one (mig 235)", P, async () => {
    const r = await inPanel(() => __t12with({ who: { higherView: false }, settings: { table_tags_allowed: true, khata_allowed: false } }, () => tabletKhataOn()));
    return ok(r === false, String(r));
  });
  await check("P181086", F_APP, "kotOpsOn() needs the module AND the waiter's switch", P, async () => {
    const r = await inPanel(() => [
      __t12with({ who: { higherView: false }, settings: { table_ops_tablet_allowed: true, tablet_table_ops: "on" } }, () => kotOpsOn()),
      __t12with({ who: { higherView: false }, settings: { table_ops_tablet_allowed: false, tablet_table_ops: "on" } }, () => kotOpsOn()),
      __t12with({ who: { higherView: false }, settings: { table_ops_tablet_allowed: true, tablet_table_ops: "off" } }, () => kotOpsOn()),
    ]);
    return ok(r.join() === "true,false,false", JSON.stringify(r));
  });
  await check("P181087", F_APP, "splitBillOn() follows the per-restaurant split switch", P, async () => {
    const r = await inPanel(() => [__t12with({ settings: { split_bill_enabled: true } }, () => splitBillOn()), __t12with({ settings: { split_bill_enabled: false } }, () => splitBillOn())]);
    return ok(r.join() === "true,false", JSON.stringify(r));
  });
  await check("P181088", F_APP, "ttagOf() shows no mark when the table-types module is off for a waiter", P, async () => {
    const r = await inPanel(() => __t12with({ who: { higherView: false }, settings: { table_tags_allowed: false }, summary: { tiles: { 4: { tag: "vip" } } } }, () => ttagOf(4)));
    return ok(r === "", JSON.stringify(r));
  });
  await check("P181089", F_APP, "tFeatureOn(): an unset guest feature is ON, an explicit false is off", P, async () => {
    const r = await inPanel(() => __t12with({ settings: { features: { waiter_calls: false } } }, () => [tFeatureOn("waiter_calls"), tFeatureOn("ratings")]));
    return ok(r.join() === "false,true", JSON.stringify(r));
  });
  await check("P181090", F_APP, "sessionsOn() mirrors this restaurant's dining-sessions switch (French House: off)", P, async () => {
    const r = await inPanel(() => [sessionsOn(), !!state.data.settings.sessions_enabled]);
    return ok(r[0] === r[1], JSON.stringify(r));
  });

  // ── A6 · what the floor draws ────────────────────────────────────────────────────────────────
  await check("P181091", F_APP, "the legend explains only Free / Preparing / Served (R25 — not the other colours)", P, async () => {
    const r = await inPanel(() => __t12with({ summary: { merges: [] }, settings: { sessions_enabled: false } }, () => floorLegendHtml()));
    return ok(/Free/.test(r) && /Preparing/.test(r) && /Served/.test(r) && !/New order|Ready to serve/.test(r) && !/Merged/.test(r), r.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  });
  await check("P181092", F_APP, "the legend adds Merged only while something IS merged", P, async () => {
    const r = await inPanel(() => __t12with({ summary: { merges: [{ parent_table: 1, child_table: 2 }] } }, () => /Merged/.test(floorLegendHtml())));
    return ok(r === true, String(r));
  });
  await check("P181093", F_APP, "the legend's 🔔 needs BOTH dining sessions and the guest bell", P, async () => {
    const r = await inPanel(() => [
      __t12with({ settings: { sessions_enabled: true, features: {} } }, () => /called/.test(floorLegendHtml())),
      __t12with({ settings: { sessions_enabled: false, features: {} } }, () => /called/.test(floorLegendHtml())),
      __t12with({ settings: { sessions_enabled: true, features: { waiter_calls: false } } }, () => /called/.test(floorLegendHtml())),
    ]);
    return ok(r.join() === "true,false,false", JSON.stringify(r));
  });
  await check("P181094", F_APP, "floorNavHtml() marks exactly one chip as the active filter", P, async () => {
    const r = await inPanel(() => __t12with({ floorFilter: "free" }, () => { const h = floorNavHtml(); return [(h.match(/class="fnav on"/g) || []).length, /data-filter="free"/.test(h.split('class="fnav on"')[1] || "")]; }));
    return ok(r[0] === 1 && r[1] === true, JSON.stringify(r));
  });
  const tile = (patch, i) => inPanel(({ patch, i }) => __t12with(patch, () => tileHtml(i)), { patch, i });
  await check("P181095", F_APP, "a FREE tile is a number, its seats and the word Free — no actions (R1)", P, async () => {
    const h = await tile({ summary: { tiles: {} }, settings: { table_seats: { default: 4 } } }, 3);
    return ok(/>3</.test(h) && /🪑4/.test(h) && /Free/.test(h) && !/t-act/.test(h), h.replace(/\s+/g, " ").slice(0, 160));
  });
  await check("P181096", F_APP, "a tile's seat count comes from the table → the floor default → 4", P, async () => {
    const r = await inPanel(() => [
      __t12with({ settings: { table_seats: { 3: 6, default: 2 } } }, () => /🪑6/.test(tileHtml(3))),
      __t12with({ settings: { table_seats: { default: 2 } } }, () => /🪑2/.test(tileHtml(3))),
      __t12with({ settings: { table_seats: {} } }, () => /🪑4/.test(tileHtml(3))),
    ]);
    return ok(r.join() === "true,true,true", JSON.stringify(r));
  });
  await check("P181097", F_APP, "an occupied tile shows '＋ Take order' only when the waiter may take orders", P, async () => {
    const t1 = await tile({ who: { higherView: false }, summary: { tiles: { 3: { state: "prep", counts: { nw: 0, ck: 1, rd: 0, sv: 0 } } } }, settings: { tablet_take_orders: "on" } }, 3);
    const t2 = await tile({ who: { higherView: false }, summary: { tiles: { 3: { state: "prep", counts: { nw: 0, ck: 1, rd: 0, sv: 0 } } } }, settings: { tablet_take_orders: "off" } }, 3);
    return ok(/data-quick="order"/.test(t1) && !/data-quick="order"/.test(t2));
  });
  await check("P181098", F_APP, "the ✓ accept appears only while a NEW order waits", P, async () => {
    const a = await tile({ summary: { tiles: { 3: { state: "new", counts: { nw: 2, ck: 0, rd: 0, sv: 0 } } } } }, 3);
    const b = await tile({ summary: { tiles: { 3: { state: "prep", counts: { nw: 0, ck: 2, rd: 0, sv: 0 } } } } }, 3);
    return ok(/data-quick="accept"/.test(a) && !/data-quick="accept"/.test(b));
  });
  await check("P181099", F_APP, "the 💳 appears only on a served-unpaid tile AND only with the pay permission", P, async () => {
    const a = await tile({ who: { higherView: false }, settings: { tablet_mark_paid: "on" }, summary: { tiles: { 3: { state: "bill", pay: "red", counts: { nw: 0, ck: 0, rd: 0, sv: 2 } } } } }, 3);
    const b = await tile({ who: { higherView: false }, settings: { tablet_mark_paid: "off" }, summary: { tiles: { 3: { state: "bill", pay: "red", counts: { nw: 0, ck: 0, rd: 0, sv: 2 } } } } }, 3);
    const c = await tile({ who: { higherView: false }, settings: { tablet_mark_paid: "on" }, summary: { tiles: { 3: { state: "prep", pay: "red", counts: { nw: 0, ck: 2, rd: 0, sv: 0 } } } } }, 3);
    return ok(/data-quick="pay"/.test(a) && !/data-quick="pay"/.test(b) && !/data-quick="pay"/.test(c));
  });
  await check("P181100", F_APP, "the ⏻ close appears only on a finished tile (all served AND paid)", P, async () => {
    const a = await tile({ summary: { tiles: { 3: { state: "done", pay: "green", counts: { nw: 0, ck: 0, rd: 0, sv: 2 } } } } }, 3);
    const b = await tile({ summary: { tiles: { 3: { state: "bill", pay: "red", counts: { nw: 0, ck: 0, rd: 0, sv: 2 } } } } }, 3);
    return ok(/data-quick="close"/.test(a) && !/data-quick="close"/.test(b));
  });
  await check("P181101", F_APP, "a red ring for accepted-unpaid, green for paid, none for a brand-new order", P, async () => {
    const r = await inPanel(() => ["red", "green", ""].map((pay) => __t12with({ summary: { tiles: { 3: { state: pay ? "bill" : "new", pay, counts: { nw: pay ? 0 : 1, ck: 0, rd: 0, sv: pay ? 1 : 0 } } } } }, () => /pay-unpaid/.test(tileHtml(3)) ? "R" : /pay-paid/.test(tileHtml(3)) ? "G" : "-")));
    return ok(r.join("") === "RG-", r.join(""));
  });
  await check("P181102", F_APP, "a merged member wears the PARTY's state and a '⇄ T…' chip naming the others", P, async () => {
    const h = await tile({ summary: { tiles: { 6: { state: "prep", counts: { nw: 0, ck: 1, rd: 0, sv: 0 } }, 7: { state: "free" } }, merges: [{ parent_table: 6, child_table: 7 }] } }, 7);
    return ok(/t-prep/.test(h) && /t-merged/.test(h) && /tmerge/.test(h) && /T6/.test(h), h.replace(/\s+/g, " ").slice(0, 200));
  });
  await check("P181103", F_APP, "a merged member's 💳 settles the PARTY head (data-qt is the parent)", P, async () => {
    const h = await tile({ who: { higherView: false }, settings: { tablet_mark_paid: "on" }, summary: { tiles: { 6: { state: "bill", pay: "red", counts: { nw: 0, ck: 0, rd: 0, sv: 1 } }, 7: { state: "free" } }, merges: [{ parent_table: 6, child_table: 7 }] } }, 7);
    return ok(/data-quick="pay" data-qt="6"/.test(h), (h.match(/data-quick="pay"[^>]*/) || [""])[0]);
  });
  await check("P181104", F_APP, "a bell rung at a merged child stays on THAT child's tile", P, async () => {
    const r = await inPanel(() => __t12with({ summary: { tiles: { 6: { state: "prep" }, 7: { state: "free" } }, merges: [{ parent_table: 6, child_table: 7 }], calls: [{ table_number: "7", note: "water" }] } }, () => [/b-call/.test(tileHtml(7)), /b-call/.test(tileHtml(6))]));
    return ok(r.join() === "true,false", JSON.stringify(r));
  });
  await check("P181105", F_APP, "a named table shows its NAME on the tile, with the number kept in a tooltip", P, async () => {
    const h = await tile({ settings: { table_names: { 3: "Patio" } }, summary: { tiles: {} } }, 3);
    return ok(/>Patio</.test(h) && /title="T3"/.test(h), h.replace(/\s+/g, " ").slice(0, 160));
  });
  await check("P181106", F_APP, "a long name shrinks its font class rather than overflowing", P, async () => {
    const r = await inPanel(() => [__t12with({ settings: { table_names: { 3: "Garden" } } }, () => /tnum-xs/.test(tileHtml(3))), __t12with({ settings: { table_names: {} } }, () => /tnum-sm|tnum-xs/.test(tileHtml(3)))]);
    return ok(r.join() === "true,false", JSON.stringify(r));
  });
  await check("P181107", F_APP, "a typed table name cannot become markup on a tile", P, async () => {
    const h = await tile({ settings: { table_names: { 3: "<b>x</b>" } }, summary: { tiles: {} } }, 3);
    return ok(!/<b>x<\/b>/.test(h) && /&lt;b&gt;/.test(h));
  });
  await check("P181108", F_APP, "tableLabel() says 'T7' for a plain table and 'Name (T7)' for a named one", P, async () => {
    const r = await inPanel(() => __t12with({ settings: { table_names: { 7: "Patio" } } }, () => [tableLabel(7), tableLabel(8)]));
    return ok(r[0] === "Patio (T7)" && r[1] === "T8", JSON.stringify(r));
  });
  await check("P181109", F_APP, "a VIP tile carries its ribbon and badge, and none when the module is off", P, async () => {
    const r = await inPanel(() => [
      __t12with({ who: { higherView: false }, settings: { table_tags_allowed: true, table_tags_owner_control: false }, summary: { tiles: { 3: { state: "prep", tag: "vip", counts: { nw: 0, ck: 1, rd: 0, sv: 0 } } } } }, () => /t-ribbon/.test(tileHtml(3)) && /tag-vip/.test(tileHtml(3))),
      __t12with({ who: { higherView: false }, settings: { table_tags_allowed: false }, summary: { tiles: { 3: { state: "prep", tag: "vip", counts: { nw: 0, ck: 1, rd: 0, sv: 0 } } } } }, () => /t-ribbon/.test(tileHtml(3))),
    ]);
    return ok(r.join() === "true,false", JSON.stringify(r));
  });
  await check("P181110", F_APP, "the progress line's parts add up to 100% of the dishes", P, async () => {
    const h = await tile({ summary: { tiles: { 3: { state: "prep", counts: { nw: 1, ck: 1, rd: 1, sv: 1 } } } } }, 3);
    const w = [...h.matchAll(/width:([\d.]+)%/g)].map((m) => Number(m[1]));
    return ok(w.length === 4 && Math.abs(w.reduce((a, b) => a + b, 0) - 100) < 0.01, JSON.stringify(w));
  });
  await check("P181111", F_APP, "no tile built from the live summary carries undefined / NaN / [object Object]", P, async () => {
    const r = await inPanel(() => floorTableList().map((i) => tileHtml(i)).join(""));
    return ok(!/undefined|NaN|\[object Object\]/.test(r), (r.match(/undefined|NaN|\[object Object\]/) || [""])[0]);
  });

  // ── A7 · taking an order ─────────────────────────────────────────────────────────────────────
  await check("P181112", F_APP, "orderSections(): a search folds accents on both sides", P, async () => {
    const r = await inPanel(() => __t12with({ dishSearch: "caffe", data: { dishes: [{ id: "a", title: "Caffè Latte", category: "x" }, { id: "b", title: "Tea", category: "x" }] } }, () => orderSections().map((s) => s.dishes.map((d) => d.id).join(",")).join("|")));
    return ok(r === "a", r);
  });
  await check("P181113", F_APP, "orderSections() hides an inactive category and puts orphans under 'Other'", P, async () => {
    const r = await inPanel(() => __t12with({ dishSearch: "", data: { categories: [{ slug: "a", name: { en: "Mains" } }, { slug: "b", name: { en: "Old" }, active: false }], dishes: [{ id: 1, title: "x", category: "a" }, { id: 2, title: "y", category: "b" }, { id: 3, title: "z", category: "zz" }] } },
      () => orderSections().map((s) => s.label + ":" + s.dishes.length).join(",")));
    return ok(r === "Mains:1,Other:2", r);
  });
  await check("P181114", F_APP, "a sold-out dish tile is disabled and says SOLD OUT", P, async () => {
    const r = await inPanel(() => __t12with({ cart: [] }, () => dishBtnHtml({ id: "d", title: "Soup", price: 100, tags: ["sold-out"] })));
    return ok(/disabled/.test(r) && /SOLD OUT/.test(r) && !/data-dishedit/.test(r));
  });
  await check("P181115", F_APP, "an OFF-MENU (hidden) dish is labelled so the waiter knows why the guest can't see it", P, async () => {
    const r = await inPanel(() => __t12with({ cart: [] }, () => dishBtnHtml({ id: "d", title: "Staff meal", price: 0, tags: ["hidden"] })));
    return ok(/OFF MENU/.test(r) && /offmenu/.test(r));
  });
  await check("P181116", F_APP, "an open-price dish says 'Set price', never ₹0", P, async () => {
    const r = await inPanel(() => __t12with({ cart: [] }, () => dishBtnHtml({ id: "d", title: "Can", price: 0, open_price: true, tags: [] })));
    return ok(/Set price/.test(r) && !/₹0/.test(r));
  });
  await check("P181117", F_APP, "a dish tile's badge counts the dish across ALL its cart lines", P, async () => {
    const r = await inPanel(() => __t12with({ cart: [{ id: "d", qty: 2 }, { id: "d", qty: 1, note: "x" }] }, () => /×3/.test(dishBtnHtml({ id: "d", title: "Tea", price: 30, tags: [] }))));
    return ok(r === true);
  });
  await check("P181118", F_APP, "removeOneDish() takes from the PLAIN line before a customised one", P, async () => {
    const r = await inPanel(() => __t12with({ cart: [{ id: "d", qty: 1, note: "no ice" }, { id: "d", qty: 2 }] }, () => { removeOneDish("d"); return state.cart.map((l) => l.qty + (l.note ? "n" : "")).join(","); }));
    return ok(r === "1n,1", r);
  });
  await check("P181119", F_APP, "removeOneDish() drops a line that reaches zero", P, async () => {
    const r = await inPanel(() => __t12with({ cart: [{ id: "d", qty: 1 }] }, () => { removeOneDish("d"); return state.cart.length; }));
    return ok(r === 0, String(r));
  });
  await check("P181120", F_APP, "the whole-order avoid list normalises: 'No Nuts, nuts' is one allergy", P, async () => {
    const r = await inPanel(() => __t12with({ allergies: "No Nuts, nuts,  dairy" }, () => [...orderAlgSet()].join(",")));
    return ok(r === "nuts,dairy", r);
  });
  await check("P181121", F_APP, "the cart's send button says CHOOSE TABLE only on a quick order", P, async () => {
    const r = await inPanel(() => { const q = state.quick; try { state.quick = true; const a = orderCartHtml(); state.quick = false; const b = orderCartHtml(); return [/CHOOSE TABLE/.test(a), /SEND TO KITCHEN/.test(b)]; } finally { state.quick = q; } });
    return ok(r.join() === "true,true", JSON.stringify(r));
  });
  await check("P181122", F_APP, "an empty cart's SEND is disabled and the cart says how to start", P, async () => {
    const r = await inPanel(() => __t12with({ cart: [] }, () => orderCartHtml()));
    return ok(/id="sendOrder" disabled/.test(r) && /Tap dishes to add them/.test(r));
  });
  await check("P181123", F_APP, "a typed dish note cannot become markup in the cart", P, async () => {
    const r = await inPanel(() => __t12with({ cart: [{ id: "d", title: "<i>Tea</i>", price: 1, qty: 1, note: "<script>" }] }, () => orderCartHtml()));
    return ok(!/<i>Tea<\/i>/.test(r) && !/<script>/.test(r));
  });

  // ── A8 · names, signatures, slices ───────────────────────────────────────────────────────────
  await check("P181124", F_APP, "restDisplayName() prefers the short brand label, then the English name", P, async () => {
    const r = await inPanel(() => [restDisplayName({ logo_text: "LFH", name: { en: "Long" } }), restDisplayName({ name: { en: "  Long  " } }), restDisplayName({ name: { hi: "हिंदी" } }), restDisplayName({}), restDisplayName(null)]);
    return ok(r[0] === "LFH" && r[1] === "Long" && r[2] === "हिंदी" && r[3] === "Restaurant" && r[4] === "", JSON.stringify(r));
  });
  await check("P181125", F_APP, "the header strips the guest hero's *accent* markers", P, async () => {
    const r = await inPanel(() => { const el = document.getElementById("restName"); const keep = el.textContent; try { setRestName({ logo_text: "Aangan *Garden*" }); return el.textContent; } finally { el.textContent = keep; } });
    return ok(r === "Aangan Garden", r);
  });
  await check("P181126", F_APP, "the header names THIS restaurant (French House), never another tenant's", P, async () => {
    const r = await inPanel(() => document.getElementById("restName").textContent);
    return ok(/French House/i.test(r), r);
  });
  await check("P181127", F_APP, "boardSig() ignores heartbeat columns (last_activity_at) so idle polls don't repaint", P, async () => {
    const r = await inPanel(() => {
      const d = { table: "4", summary: { a: 1 }, data: { settings: {}, sessions: [{ table_number: "4", id: "s", last_activity_at: "1" }] } };
      const a = boardSig(d); d.data.sessions[0].last_activity_at = "2"; const b = boardSig(d);
      d.data.sessions[0].discount = 5; const c = boardSig(d);
      return [a === b, a !== c];
    });
    return ok(r.join() === "true,true", JSON.stringify(r));
  });
  await check("P181128", F_APP, "boardSig() flips on ANY summary change (the grid repaints)", P, async () => {
    const r = await inPanel(() => boardSig({ table: null, summary: { tiles: { 1: { state: "free" } } }, data: {} }) !== boardSig({ table: null, summary: { tiles: { 1: { state: "prep" } } }, data: {} }));
    return ok(r === true);
  });
  await check("P181129", F_APP, "mergeSelectedSlice() replaces one table's rows and leaves the others alone", P, async () => {
    const r = await inPanel(() => __t12with({ data: { sessions: [{ id: "a", table_number: "4" }, { id: "b", table_number: "5" }], orders: [{ id: "o4", table_number: "4" }, { id: "o5", table_number: "5" }], items: [{ id: "i4", order_id: "o4" }, { id: "i5", order_id: "o5" }] } },
      () => { mergeSelectedSlice("4", { sessions: [{ id: "a2", table_number: "4" }], orders: [{ id: "o4b", table_number: "4" }], items: [{ id: "i4b", order_id: "o4b" }] });
        return [state.data.sessions.map((s) => s.id).sort().join(","), state.data.orders.map((o) => o.id).sort().join(","), state.data.items.map((i) => i.id).sort().join(",")]; }));
    return ok(r[0] === "a2,b" && r[1] === "o4b,o5" && r[2] === "i4b,i5", JSON.stringify(r));
  });
  await check("P181130", F_APP, "mergeSelectedSlice() drops a member row that belonged to the table's old session", P, async () => {
    const r = await inPanel(() => __t12with({ data: { sessions: [{ id: "old", table_number: "4" }], members: [{ id: "m1", session_id: "old" }, { id: "m2", session_id: "other" }] } },
      () => { mergeSelectedSlice("4", { sessions: [], members: [] }); return state.data.members.map((m) => m.id).join(","); }));
    return ok(r === "m2", r);
  });
  await check("P181131", F_APP, "sliceLoaded() is false for an occupied table until its detail arrives", P, async () => {
    const r = await inPanel(() => __t12with({ data: { sessions: [], orders: [] } }, () => [sliceLoaded(4), (state.data.orders.push({ id: "x", table_number: "4", status: "preparing" }), sliceLoaded(4))]));
    return ok(r.join() === "false,true", JSON.stringify(r));
  });

  // ── A9 · the dialogs and their refusals ──────────────────────────────────────────────────────
  await check("P181132", F_APP, "a second confirm while one is open is answered 'no' and the first one shakes", P, async () => {
    const r = await inPanel(async () => {
      const p1 = confirmDialog("first?");
      const second = await confirmDialog("second?");
      const nudged = document.getElementById("confirmOverlay").classList.contains("cf-nudge");
      const text = document.getElementById("confirmText").textContent;
      document.getElementById("confirmNo").click();
      const first = await p1;
      return [second, nudged, text, first, document.getElementById("confirmOverlay").hidden];
    });
    return ok(r[0] === false && r[1] === true && r[2] === "first?" && r[3] === false && r[4] === true, JSON.stringify(r));
  });
  await check("P181133", F_APP, "confirmDialog() sets both button labels on every call (none lingers)", P, async () => {
    const r = await inPanel(async () => {
      const p = confirmDialog("x", "Cancel order", "Keep order");
      const a = [document.getElementById("confirmYes").textContent, document.getElementById("confirmNo").textContent];
      document.getElementById("confirmNo").click(); await p;
      const p2 = confirmDialog("y");
      const b = [document.getElementById("confirmYes").textContent, document.getElementById("confirmNo").textContent];
      document.getElementById("confirmNo").click(); await p2;
      return [a, b];
    });
    return ok(r[0].join() === "Cancel order,Keep order" && r[1].join() === "Yes, send it,Cancel", JSON.stringify(r));
  });
  await check("P181134", F_APP, "the confirm box registers a back-button layer and drops it when answered", P, async () => {
    const r = await inPanel(async () => {
      const before = (window.LFH_BACK && LFH_BACK.depth) ? LFH_BACK.depth() : history.length;
      const p = confirmDialog("x");
      const during = (window.LFH_BACK && LFH_BACK.depth) ? LFH_BACK.depth() : history.length;
      document.getElementById("confirmYes").click(); const v = await p;
      return [typeof LFH_BACK, during > before || during >= before, v];
    });
    return ok(r[0] === "object" && r[2] === true, JSON.stringify(r));
  });
  const overlay = async (open, typeSel, value, okSel) => inPanel(async ({ open, typeSel, value, okSel }) => {
    const p = (new Function("return " + open))();
    await new Promise((r) => setTimeout(r, 80));
    const inp = document.querySelector(typeSel);
    if (inp) { inp.value = value; inp.dispatchEvent(new Event("input")); }
    document.querySelector(okSel).click();
    await new Promise((r) => setTimeout(r, 30));
    const err = [...document.querySelectorAll(".pp-err,.rp-err,.pr-err,.alg-err,.alg-why-err")].map((e) => e.textContent).filter(Boolean).join(" ");
    const still = !!document.querySelector(typeSel);
    if (still) { const c = document.querySelector(".pp-cancel,.rp-cancel,.pr-cancel,.alg-cancel,.alg-why-cancel"); if (c) c.click(); }
    const res = await p;
    return { err, still, res };
  }, { open, typeSel, value, okSel });
  await check("P181135", F_APP, "the manager-PIN box refuses 3 digits out loud and stays open", P, async () => {
    const r = await overlay("pinPrompt('x')", ".pp-in", "123", ".pp-ok");
    return ok(r.still && /4–8 digit/.test(r.err) && r.res === null, JSON.stringify(r));
  });
  await check("P181136", F_APP, "the manager-PIN box refuses letters, accepts 4–8 digits", P, async () => {
    const a = await overlay("pinPrompt('x')", ".pp-in", "12ab", ".pp-ok");
    const b = await overlay("pinPrompt('x')", ".pp-in", "123456", ".pp-ok");
    return ok(a.still && b.res === "123456" && !b.still, JSON.stringify([a, b]));
  });
  await check("P181137", F_APP, "the reason box refuses a blank reason out loud", P, async () => {
    const r = await overlay("reasonPrompt('why?')", ".rp-in", "   ", ".rp-ok");
    return ok(r.still && /reason is required/.test(r.err), JSON.stringify(r));
  });
  await check("P181138", F_APP, "the reason box hands back the trimmed reason", P, async () => {
    const r = await overlay("reasonPrompt('why?')", ".rp-in", "  refund  ", ".rp-ok");
    return ok(r.res === "refund", JSON.stringify(r));
  });
  await check("P181139", F_APP, "the price box refuses ₹0 and an absurd price, each with its own sentence", P, async () => {
    const a = await overlay("pricePrompt('Can')", ".pr-in", "0", ".pr-ok");
    const b = await overlay("pricePrompt('Can')", ".pr-in", "200000", ".pr-ok");
    return ok(a.still && /greater than 0/.test(a.err) && b.still && /too high/.test(b.err), JSON.stringify([a.err, b.err]));
  });
  await check("P181140", F_APP, "the price box keeps paise to two places (20.555 → 20.56)", P, async () => {
    const r = await overlay("pricePrompt('Can')", ".pr-in", "20.555", ".pr-ok");
    return ok(r.res === 20.56, JSON.stringify(r));
  });
  await check("P181141", F_APP, "the add-an-allergy box refuses a blank word out loud", P, async () => {
    const r = await overlay("allergyPrompt(new Set())", ".alg-in", "  ", ".alg-ok");
    return ok(r.still && /leave out/.test(r.err), JSON.stringify(r));
  });
  await check("P181142", F_APP, "the add-an-allergy box refuses one already on the list, naming it", P, async () => {
    const r = await overlay("allergyPrompt(new Set(['garlic']))", ".alg-in", "No Garlic", ".alg-ok");
    return ok(r.still && /garlic/.test(r.err) && /already/.test(r.err), JSON.stringify(r));
  });
  await check("P181143", F_APP, "the allergy-change reason box refuses a blank reason", P, async () => {
    const r = await overlay("askAllergyReason('x')", ".alg-why-in", "", ".alg-why-ok");
    return ok(r.still && /Pick one above/.test(r.err), JSON.stringify(r));
  });
  await check("P181144", F_APP, "the allergy-change reason box offers five ready reasons as one-tap chips", P, async () => {
    const r = await inPanel(async () => { const p = askAllergyReason("x"); await new Promise((s) => setTimeout(s, 60)); const n = document.querySelectorAll(".alg-why-chips button").length; document.querySelector(".alg-why-chips button").click(); return [n, await p]; });
    return ok(r[0] === 5 && r[1] && r[1].reason === "The guest told us", JSON.stringify(r));
  });
  await check("P181145", F_APP, "a second payment sheet while one is open is answered 'cancelled', and only one is built", P, async () => {
    const r = await inPanel(async () => {
      const p1 = openPaymentMethodModal(100, "x", { crm: false, noTip: true });
      const p2 = await openPaymentMethodModal(100, "y", { crm: false, noTip: true });
      const n = document.querySelectorAll(".pay-overlay").length;
      document.querySelector(".pay-cancel-btn").click();
      return [p2, n, await p1, payModalOpen];
    });
    return ok(r[0] === null && r[1] === 1 && r[2] === null && r[3] === false, JSON.stringify(r));
  });
  await check("P181146", F_APP, "the payment sheet resolves the picked method, and 'Other' asks what kind first", P, async () => {
    const r = await inPanel(async () => {
      const p = openPaymentMethodModal(100, "x", { crm: false, noTip: true });
      document.querySelector('[data-method="Other"]').click();
      const asked = getComputedStyle(document.querySelector(".pay-other-write")).display !== "none";
      document.querySelector(".pay-other-input").value = "wallet";
      document.querySelector(".pay-other-confirm").click();
      return [asked, await p];
    });
    return ok(r[0] === true && r[1].method === "Other" && r[1].note === "wallet", JSON.stringify(r));
  });
  await check("P181147", F_APP, "the payment sheet's 'They paid' box works the tip out backwards", P, async () => {
    const r = await inPanel(async () => {
      const p = openPaymentMethodModal(500, "x", { crm: false });
      const paid = document.querySelector(".pay-tip-paid");
      paid.value = "550"; paid.dispatchEvent(new Event("input"));
      const amt = document.querySelector(".pay-tip-amt").value;
      document.querySelector('[data-method="Cash"]').click();
      return [amt, (await p).tip];
    });
    return ok(r[0] === "50" && r[1] === 50, JSON.stringify(r));
  });
  await check("P181148", F_APP, "the payment sheet warns (not refuses) a tip bigger than the bill", P, async () => {
    const r = await inPanel(async () => {
      const p = openPaymentMethodModal(100, "x", { crm: false });
      const a = document.querySelector(".pay-tip-amt"); a.value = "150"; a.dispatchEvent(new Event("input"));
      const msg = document.querySelector(".pay-tip-msg").textContent;
      document.querySelector(".pay-cancel-btn").click(); await p;
      return msg;
    });
    return ok(/bigger than the bill/.test(r), r);
  });
  await check("P181149", F_APP, "the payment sheet caps a tip at the shared ceiling and says so", P, async () => {
    const r = await inPanel(async () => {
      const p = openPaymentMethodModal(100, "x", { crm: false });
      const a = document.querySelector(".pay-tip-amt"); a.value = "9999999"; a.dispatchEvent(new Event("input"));
      const msg = document.querySelector(".pay-tip-msg").textContent;
      document.querySelector('[data-method="UPI"]').click();
      return [msg, (await p).tip, Number(LFH_BILLDOC.TIP_MAX) || 100000];
    });
    return ok(/most a tip can be/.test(r[0]) && r[1] === r[2], JSON.stringify(r));
  });
  await check("P181150", F_APP, "a blank 'They paid' box is 'about to type', never 'paid ₹0'", P, async () => {
    const r = await inPanel(async () => {
      const p = openPaymentMethodModal(100, "x", { crm: false });
      const a = document.querySelector(".pay-tip-amt"); a.value = "20"; a.dispatchEvent(new Event("input"));
      const paid = document.querySelector(".pay-tip-paid"); paid.value = ""; paid.dispatchEvent(new Event("input"));
      document.querySelector('[data-method="Card"]').click();
      return (await p).tip;
    });
    return ok(r === 20, String(r));
  });
  await check("P181151", F_APP, "the split line on the pay sheet shows only when splitting is switched on", P, async () => {
    const r = await inPanel(async () => {
      const out = [];
      for (const split of [true, false]) {
        const p = openPaymentMethodModal(100, "x", { crm: false, noTip: true, split });
        out.push(!!document.querySelector(".pay-split-open"));
        document.querySelector(".pay-cancel-btn").click(); await p;
      }
      return out;
    });
    return ok(r.join() === "true,false", JSON.stringify(r));
  });
  await check("P181152", F_APP, "'On the house' and 'Pay Later' appear only when the caller allows them", P, async () => {
    const r = await inPanel(async () => {
      const a = openPaymentMethodModal(100, "x", { crm: false, noTip: true });
      const none = [!!document.querySelector('[data-special="onhouse"]'), !!document.querySelector('[data-special="khata"]')];
      document.querySelector(".pay-cancel-btn").click(); await a;
      const b = openPaymentMethodModal(100, "x", { crm: false, noTip: true, onHouse: true, khata: true });
      const both = [!!document.querySelector('[data-special="onhouse"]'), !!document.querySelector('[data-special="khata"]')];
      document.querySelector('[data-special="khata"]').click();
      return [none, both, await b];
    });
    return ok(r[0].join() === "false,false" && r[1].join() === "true,true" && r[2].special === "khata", JSON.stringify(r));
  });
  await check("P181153", F_APP, "the customer box sends a number ONLY when the guest's consent is ticked", P, async () => {
    const r = await inPanel(async () => {
      const p = openPaymentMethodModal(100, "x", { noTip: true });
      document.querySelector(".pay-cust-phone").value = "9000000001";
      document.querySelector('[data-method="Cash"]').click();
      const a = (await p).cust;
      const p2 = openPaymentMethodModal(100, "x", { noTip: true });
      document.querySelector(".pay-cust-phone").value = "9000000001";
      document.querySelector(".pay-cust-consent").checked = true;
      document.querySelector('[data-method="Cash"]').click();
      const b = (await p2).cust;
      return [a, b];
    });
    return ok(r[0] === null && r[1] && r[1].consent === true && r[1].phone === "9000000001", JSON.stringify(r));
  });
  await check("P181154", F_APP, "a customer already saved for the table is shown, not asked again", P, async () => {
    const r = await inPanel(async () => {
      const p = openPaymentMethodModal(100, "x", { noTip: true, knownCust: { phone: "9000000002", name: "Asha" } });
      const shown = document.querySelector(".pay-cust-have") && document.querySelector(".pay-cust-have").textContent;
      const askBox = !!document.querySelector(".pay-cust-phone");
      document.querySelector(".pay-cust-change").click();
      const prefilled = document.querySelector(".pay-cust-phone").value;
      document.querySelector(".pay-cancel-btn").click(); await p;
      return [shown, askBox, prefilled];
    });
    return ok(/Asha · 9000000002/.test(r[0]) && r[1] === false && r[2] === "9000000002", JSON.stringify(r));
  });
  await check("P181155", F_APP, "the five one-field boxes each register a back-button layer and release it on cancel", P, async () => {
    const r = await inPanel(async () => {
      const seen = [], released = [];
      const real = LFH_BACK.layer;
      LFH_BACK.layer = (id, fn) => { seen.push(id); const off = real.call(LFH_BACK, id, fn); return () => { released.push(id); off(); }; };
      try {
        const opens = [() => pinPrompt("x"), () => reasonPrompt("x"), () => pricePrompt("x"), () => allergyPrompt(new Set()), () => askAllergyReason("x")];
        for (const o of opens) {
          const p = o(); await new Promise((s) => setTimeout(s, 450));
          document.querySelector(".pp-cancel,.rp-cancel,.pr-cancel,.alg-cancel,.alg-why-cancel").click();
          await p; await new Promise((s) => setTimeout(s, 450));
        }
      } finally { LFH_BACK.layer = real; }
      return [seen.join(","), released.join(",")];
    });
    return ok(r[0] === "tablet-pin,tablet-reason,tablet-price,tablet-allergy,tablet-allergy-why" && r[1] === r[0], JSON.stringify(r));
  });
  await check("P181156", F_APP, "toast() always carries a ✕ to dismiss it at once", P, async () => {
    const r = await inPanel(() => { toast("probe-t12"); const t = [...document.querySelectorAll("#toasts .toast")].pop(); const x = t.querySelector(".toast-x"); const has = !!x && x.getAttribute("aria-label") === "Dismiss"; x.click(); return [has, !document.body.contains(t)]; });
    return ok(r.join() === "true,true", JSON.stringify(r));
  });
  await check("P181157", F_APP, "a failure toast is styled as a failure (the 'bad' class)", P, async () => {
    const r = await inPanel(() => { toast("probe-bad", false); const t = [...document.querySelectorAll("#toasts .toast")].pop(); const c = t.className; t.remove(); return c; });
    return ok(/\bbad\b/.test(r), r);
  });
  await check("P181158", F_APP, "the page raised no uncaught error while all of block A ran", P, async () => ok(errors.length === 0, errors.slice(0, 2).join(" · ")));
  await check("P181159", F_APP, "the floor is back to the live state after block A (no test data left on screen)", P, async () => {
    const r = await inPanel(() => { renderFloor(); return [document.querySelectorAll("#tiles .tile").length, floorTableList().filter(passesFilter).length, /Patio|9000000001|probe-t12/.test(document.body.innerText)]; });
    return ok(r[0] === r[1] && r[2] === false, JSON.stringify(r));
  });
  await check("P181160", F_APP, "the panel's perf counters exist and a full render was counted", P, async () => {
    const r = await inPanel(() => window.__lfhPerf);
    return ok(r && r.fullRenders > 0 && typeof r.longTasks === "number", JSON.stringify(r));
  });

  await ctx.close();
  return R;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const R = await blockA();
  R.done();
  await closeBrowser();
}
