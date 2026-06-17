# Cross-Panel Live Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every state change in any panel (menu/admin/editor/kitchen/tablet) propagate live to every screen that displays it, while lowering total DB load.

**Architecture:** Extend the existing `realtime_events` breadcrumb push system. Add a second topic `menu` for slow-changing content (menu_items/categories/filters/settings) that both staff AND guests subscribe to; keep `ops` for operational churn (staff only) and add the missing `blocklist` + `auto_approve` coverage. Fix panel handlers to refetch the right slice per topic. Add a React `useRealtime` hook so the guest menu and admin join the push system instead of one-time-load / 1s-polling.

**Tech Stack:** Postgres triggers (Supabase), vanilla JS (`public/panels/realtime.js`), React 19 hooks, `@supabase/supabase-js` (already a dependency).

**Note on testing:** This repo has no unit-test runner; verification is SQL checks + multi-tab browser E2E (Chrome DevTools MCP / Playwright) + `npm run lint`. "Test" steps below are written accordingly.

**Branch:** create `feat/cross-panel-live-sync` before Task 1.

---

### Task 1: Migration 066 — content + blocklist triggers, auto_approve fix

**Files:**
- Create: `supabase/migrations/066_realtime_content_triggers.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 066_realtime_content_triggers.sql  (Realtime Stage 2 — Phase 3: content + gaps)
--
-- Closes the live-sync gaps found in the action audit:
--  * menu_items / categories / filters / settings → emit on a NEW 'menu' topic
--    (staff AND guests subscribe to 'menu'; guests do NOT get the 'ops' firehose).
--  * blocklist → emit on 'ops' (staff-only).
--  * sessions trigger: add auto_approve to the watched columns (was silently excluded).
-- Content/blocklist breadcrumbs carry entity_id = NULL on purpose: clients refetch
-- wholesale and never read entity_id, and categories/filters have no `id` column.

CREATE OR REPLACE FUNCTION lfh_rt_emit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  k text;
  eid text;
  tn text;
  topic_name text;
BEGIN
  r := COALESCE(NEW, OLD);
  topic_name := 'ops';  -- default for operational tables
  IF TG_TABLE_NAME = 'orders' THEN
    k := 'order'; eid := r.id::text; tn := r.table_number;
  ELSIF TG_TABLE_NAME = 'order_items' THEN
    k := 'order_item'; eid := r.order_id::text;
    SELECT o.table_number INTO tn FROM orders o WHERE o.id = r.order_id;
  ELSIF TG_TABLE_NAME = 'waiter_calls' THEN
    k := 'call'; eid := r.id::text; tn := r.table_number;
  ELSIF TG_TABLE_NAME = 'sessions' THEN
    k := 'session'; eid := r.id::text; tn := r.table_number;
  ELSIF TG_TABLE_NAME = 'requests' THEN
    k := 'request'; eid := r.id::text; tn := r.table_number;
  ELSIF TG_TABLE_NAME = 'session_members' THEN
    k := 'member'; eid := r.id::text;
    SELECT s.table_number INTO tn FROM sessions s WHERE s.id = r.session_id;
  ELSIF TG_TABLE_NAME = 'blocklist' THEN
    k := 'block'; eid := NULL; tn := NULL;             -- ops topic, staff-only
  ELSIF TG_TABLE_NAME = 'menu_items' THEN
    k := 'menu_item'; eid := NULL; tn := NULL; topic_name := 'menu';
  ELSIF TG_TABLE_NAME = 'categories' THEN
    k := 'category'; eid := NULL; tn := NULL; topic_name := 'menu';
  ELSIF TG_TABLE_NAME = 'filters' THEN
    k := 'filter'; eid := NULL; tn := NULL; topic_name := 'menu';
  ELSIF TG_TABLE_NAME = 'settings' THEN
    k := 'settings'; eid := NULL; tn := NULL; topic_name := 'menu';
  ELSE
    k := TG_TABLE_NAME; eid := r.id::text; tn := NULL;
  END IF;

  INSERT INTO realtime_events(topic, kind, entity_id, table_number)
    VALUES (topic_name, k, eid, tn);
  IF tn IS NOT NULL THEN
    INSERT INTO realtime_events(topic, kind, entity_id, table_number)
      VALUES ('table:' || tn, k, eid, tn);
  END IF;

  IF random() < 0.01 THEN PERFORM lfh_rt_prune(); END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION lfh_rt_emit() FROM PUBLIC, anon, authenticated;

-- Sessions: re-create trigger WITH auto_approve added to the watched columns.
DROP TRIGGER IF EXISTS rt_emit_sessions ON sessions;
CREATE TRIGGER rt_emit_sessions
  AFTER INSERT OR DELETE OR UPDATE OF status, cart, cart_updated_at, bill_no, invoice_no, auto_approve ON sessions
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();

-- New content triggers → 'menu' topic.
DROP TRIGGER IF EXISTS rt_emit_menu_items ON menu_items;
CREATE TRIGGER rt_emit_menu_items AFTER INSERT OR UPDATE OR DELETE ON menu_items
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();

DROP TRIGGER IF EXISTS rt_emit_categories ON categories;
CREATE TRIGGER rt_emit_categories AFTER INSERT OR UPDATE OR DELETE ON categories
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();

DROP TRIGGER IF EXISTS rt_emit_filters ON filters;
CREATE TRIGGER rt_emit_filters AFTER INSERT OR UPDATE OR DELETE ON filters
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();

DROP TRIGGER IF EXISTS rt_emit_settings ON settings;
CREATE TRIGGER rt_emit_settings AFTER INSERT OR UPDATE OR DELETE ON settings
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();

-- Blocklist → 'ops' topic (staff-only).
DROP TRIGGER IF EXISTS rt_emit_blocklist ON blocklist;
CREATE TRIGGER rt_emit_blocklist AFTER INSERT OR UPDATE OR DELETE ON blocklist
  FOR EACH ROW EXECUTE FUNCTION lfh_rt_emit();

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply via Management API**

Use the existing apply path (same the seed script uses). Run a one-off node snippet that reads `SUPABASE_ACCESS_TOKEN` + project ref from `.env.local` and POSTs the SQL of `066_realtime_content_triggers.sql` to the Management API `/v1/projects/{ref}/database/query`. (Mirror `scripts/seed-supabase.mjs`'s migration runner; do not run a full reseed.)
Expected: HTTP 200, no error.

- [ ] **Step 3: Verify triggers exist + breadcrumb fires (SQL)**

Run via Management API:
```sql
SELECT tgname FROM pg_trigger WHERE tgname LIKE 'rt_emit_%' ORDER BY tgname;
-- expect: rt_emit_blocklist, rt_emit_calls, rt_emit_categories, rt_emit_filters,
--         rt_emit_members, rt_emit_menu_items, rt_emit_order_items, rt_emit_orders,
--         rt_emit_requests, rt_emit_sessions, rt_emit_settings

-- Prove a content edit emits on 'menu':
UPDATE settings SET updated_at = now() WHERE id = 'site';
SELECT topic, kind FROM realtime_events ORDER BY id DESC LIMIT 1;
-- expect: topic='menu', kind='settings'
```
Expected: 11 triggers; last breadcrumb is `menu`/`settings`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/066_realtime_content_triggers.sql
git commit -m "feat(realtime): emit breadcrumbs for menu content, blocklist, auto_approve"
```

---

### Task 2: `realtime.js` — per-topic handlers (backward compatible)

**Files:**
- Modify: `public/panels/realtime.js`

- [ ] **Step 1: Replace the `start` function to support a `handlers` map**

Keep the old `{ topics, onEvent }` shape working. Add `{ handlers: { topic: fn } }`. Each topic gets its OWN debounced fire (so a cheap `ops` refresh never triggers an expensive `menu` refetch). Wake/reconnect/initial fire ALL handlers once.

```javascript
  async function start(opts) {
    opts = opts || {};
    // Normalise to a { topic: handler } map. Back-compat: {topics, onEvent}.
    let handlers = opts.handlers;
    if (!handlers) {
      const onEvent = opts.onEvent || function () {};
      const topics = opts.topics || ["ops"];
      handlers = {};
      topics.forEach((t) => { handlers[t] = onEvent; });
    }
    const topicList = Object.keys(handlers);
    metrics.topics = topicList;

    // One debounced refetch PER topic (counts + never throws).
    const firePerTopic = {};
    topicList.forEach((topic) => {
      const run = async () => {
        metrics.refetch_count++;
        try { await handlers[topic](); } catch (e) { metrics.sync_failures++; }
      };
      firePerTopic[topic] = debounce(run, 300);
    });
    const fireAll = () => topicList.forEach((t) => firePerTopic[t]());

    let everSubscribed = false;
    try {
      const sb = await getClient();
      topicList.forEach((topic) => {
        sb.channel("rt:" + topic)
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "realtime_events", filter: "topic=eq." + topic },
            (payload) => {
              metrics.events++; metrics.lastEventAt = Date.now();
              const ts = payload && payload.new && payload.new.created_at;
              if (ts) { const lat = Date.now() - Date.parse(ts); if (lat >= 0 && lat < 60000) { metrics._latSum += lat; metrics._latN++; metrics.avgLatencyMs = Math.round(metrics._latSum / metrics._latN); } }
              firePerTopic[topic]();
            })
          .subscribe((status) => {
            if (status === "SUBSCRIBED") { metrics.subscribed++; if (everSubscribed) { metrics.reconnects++; fireAll(); } everSubscribed = true; }
            else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { metrics.errors++; }
          });
      });
    } catch (e) {
      metrics.errors++;
    }

    const wake = () => { if (!document.hidden) fireAll(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("pageshow", wake);
    window.addEventListener("online", () => { metrics.reconnects++; fireAll(); });

    fireAll(); // initial load
  }
```

- [ ] **Step 2: Verify back-compat (browser console)**

Open `/kitchen`, console: `__lfh_rt.topics` should still report `["ops"]` until Task 4 lands. No JS errors on load.
Expected: panel loads, `__lfh_rt` present, no console errors.

- [ ] **Step 3: Commit**

```bash
git add public/panels/realtime.js
git commit -m "feat(realtime): per-topic handlers in LFH_RT (backward compatible)"
```

---

### Task 3: Editor — split handlers (ops→pollOrders, menu→loadAll)

**Files:**
- Modify: `public/panels/editor/app.js:3438`

- [ ] **Step 1: Replace the start call**

```javascript
    LFH_RT.start({ handlers: {
      ops:  () => pollOrders(),
      menu: () => loadAll(),
    }});
```

- [ ] **Step 2: Verify (browser)**

Open `/editor`, console: `__lfh_rt.topics` → `["ops","menu"]`. In a second tab open `/editor`, edit a dish title and save; the first tab's dish list updates within ~1s without manual refresh.
Expected: both topics subscribed; menu edit reflects live.

- [ ] **Step 3: Commit**

```bash
git add public/panels/editor/app.js
git commit -m "feat(editor): refresh dishes live on menu-topic breadcrumbs"
```

---

### Task 4: Kitchen + Tablet — add the `menu` topic

**Files:**
- Modify: `public/panels/kitchen/app.js:206`
- Modify: `public/panels/tablet/app.js:793`

- [ ] **Step 1: Kitchen — add menu topic**

```javascript
  LFH_RT.start({ topics: ["ops", "menu"], onEvent: () => load() }); // realtime.js counts failures
```

- [ ] **Step 2: Tablet — add menu topic**

```javascript
  LFH_RT.start({ topics: ["ops", "menu"], onEvent: () => load() }); // realtime.js counts failures
```

- [ ] **Step 3: Verify (browser, multi-tab)**

Open `/kitchen` and `/editor`. In editor mark a dish sold-out (or edit price); kitchen's board/86 list reflects within ~1s. Repeat for `/tablet`: edit a dish in editor → tablet's take-order menu updates live.
Expected: both panels reflect menu edits without manual refresh.

- [ ] **Step 4: Commit**

```bash
git add public/panels/kitchen/app.js public/panels/tablet/app.js
git commit -m "feat(kitchen,tablet): subscribe to menu-topic for live dish/86 updates"
```

---

### Task 5: React `useRealtime` hook

**Files:**
- Create: `lib/useRealtime.ts`

- [ ] **Step 1: Write the hook**

```typescript
"use client";
// useRealtime — React mirror of public/panels/realtime.js for the guest menu and
// admin. Opens ONE websocket, runs a per-topic callback (debounced ~300ms) on a
// breadcrumb, on tab wake/focus/online, and once on mount. 60s fallback poll.
import { useEffect, useRef } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Handlers = Partial<Record<"ops" | "menu", () => void | Promise<void>>>;

let clientPromise: Promise<SupabaseClient> | null = null;
async function getClient(): Promise<SupabaseClient> {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const cfg = await (await fetch("/api/rt-config", { cache: "no-store" })).json();
    return createClient(cfg.url, cfg.anonKey, { realtime: { params: { eventsPerSecond: 10 } } });
  })();
  return clientPromise;
}

export function useRealtime(handlers: Handlers) {
  // Keep latest handlers in a ref so the effect runs once (no resubscribe churn).
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    let disposed = false;
    const timers: Record<string, ReturnType<typeof setTimeout> | undefined> = {};
    const topics = Object.keys(ref.current) as Array<keyof Handlers>;

    const fire = (topic: keyof Handlers) => {
      clearTimeout(timers[topic as string]);
      timers[topic as string] = setTimeout(() => {
        const fn = ref.current[topic];
        if (fn) Promise.resolve(fn()).catch(() => {});
      }, 300);
    };
    const fireAll = () => topics.forEach((t) => fire(t));

    let channels: ReturnType<SupabaseClient["channel"]>[] = [];
    getClient().then((sb) => {
      if (disposed) return;
      channels = topics.map((topic) =>
        sb.channel("rt:" + topic)
          .on("postgres_changes" as never, { event: "INSERT", schema: "public", table: "realtime_events", filter: "topic=eq." + topic } as never,
            () => fire(topic))
          .subscribe()
      );
    }).catch(() => {});

    const wake = () => { if (!document.hidden) fireAll(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    const poll = setInterval(fireAll, 60000); // safety net if the socket drops

    fireAll(); // initial

    return () => {
      disposed = true;
      clearInterval(poll);
      Object.values(timers).forEach((t) => t && clearTimeout(t));
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      getClient().then((sb) => channels.forEach((c) => sb.removeChannel(c))).catch(() => {});
    };
  }, []);
}
```

- [ ] **Step 2: Type-check**

Run: `npm run lint`
Expected: no TypeScript errors in `lib/useRealtime.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/useRealtime.ts
git commit -m "feat(realtime): React useRealtime hook for menu + admin"
```

---

### Task 6: Guest menu — live features + gentle menu reconcile

**Files:**
- Modify: `lib/features.ts` (add `refreshFeatures`)
- Modify: `app/menu/page.tsx` (wire `useRealtime`, gentle refetch)

- [ ] **Step 1: Add `refreshFeatures()` to `lib/features.ts`**

The hook already uses a module-level `cached` + `inflight`. Add a subscriber set so live `useFeatures()` instances update when settings change, and a `refreshFeatures()` that re-fetches and notifies.

```typescript
// --- live refresh support (called by useRealtime on a settings breadcrumb) ---
const subscribers = new Set<(f: FeatureMap) => void>();

export async function refreshFeatures(): Promise<void> {
  inflight = null;            // bust the per-load cache
  const fresh = await getFeatures();
  cached = fresh;
  subscribers.forEach((cb) => cb(fresh));
}
```

In `useFeatures()`, register/unregister the setter with `subscribers` inside its `useEffect` (alongside the existing initial fetch), so a `refreshFeatures()` updates every mounted component. (Add `subscribers.add(setF); return () => { subscribers.delete(setF); };` to the effect.)

- [ ] **Step 2: Wire `useRealtime` into the guest menu**

In `app/menu/page.tsx`, factor the existing on-mount loaders (`getMenuItems`/`getCategories`/`getFilters`) into a `refreshMenu()` callback that re-runs them and sets state. State is keyed by dish `id` in the existing render, so React preserves scroll/position; a dish flipping to sold-out updates its badge instead of unmounting. Then:

```typescript
import { useRealtime } from "@/lib/useRealtime";
import { refreshFeatures } from "@/lib/features";
// ...inside the component:
useRealtime({ menu: () => { refreshMenu(); refreshFeatures(); } });
```

- [ ] **Step 3: Verify (browser, multi-tab)**

Open `/menu` (guest) + `/editor`. In editor: mark a dish sold-out → guest card shows "Sold out" within ~1s, scroll position unchanged. Change a price → guest price updates. In `/aevinite` toggle a feature (e.g. search) off → guest menu hides it live.
Expected: all three reflect within ~1s, no full reload, no scroll jump.

- [ ] **Step 4: Commit**

```bash
git add lib/features.ts app/menu/page.tsx
git commit -m "feat(menu): live gentle updates for dishes + feature flags"
```

---

### Task 7: Admin — replace 1s polling with `useRealtime`

**Files:**
- Modify: `app/aevinite/page.tsx:136-138` (remove intervals, add hook)

- [ ] **Step 1: Remove the polling intervals and wire the hook**

Delete the `setInterval(... 1000)` and `setInterval(loadActivity, 3000)`. Keep the initial loads. Add:

```typescript
import { useRealtime } from "@/lib/useRealtime";
// ...inside the component (after loaders are defined):
useRealtime({
  ops:  () => { loadFloor(); loadOverview(); loadActivity(); },
  menu: () => { loadOverview(); },
});
```

- [ ] **Step 2: Verify (browser, network panel)**

Open `/aevinite`, DevTools Network. Confirm `/api/admin/floor` is NOT called every second at idle (only on a breadcrumb). Place an order in `/tablet` → admin floor + activity update within ~1s.
Expected: no per-second polling; live updates on real changes.

- [ ] **Step 3: Commit**

```bash
git add app/aevinite/page.tsx
git commit -m "perf(admin): replace 1s polling with realtime push"
```

---

### Task 8: Full multi-tab E2E + load verification

**Files:** none (verification only)

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 2: Scripted multi-tab E2E (Chrome DevTools MCP)**

Drive these flows across two tabs each and confirm sub-second propagation with no manual refresh:
1. Editor edits dish title/price → kitchen, tablet, guest reflect.
2. Kitchen marks dish sold-out → guest shows "Sold out"; editor + tablet reflect.
3. Editor toggles a category active/sort → guest category bar reflects.
4. Admin toggles a feature flag → guest hides/shows it.
5. Toggle `auto_approve` (guest head settings or editor) → the other side updates.
6. Guest requests to join a session → editor request queue updates live.
7. Approve member (editor) → guest + tablet update.
8. Place order (tablet) → kitchen + admin pop.
9. Block a device (editor) → second editor tab's blocklist updates.
Record latency from `window.__lfh_rt.avgLatencyMs` on each staff panel (expect < ~1500ms).

- [ ] **Step 3: Load check**

In admin Network panel confirm idle request rate ~0 (was ~3/s). Inspect a guest tab's websocket frames — only tiny breadcrumb rows, no PII.

- [ ] **Step 4: 3D regression**

Run: `node scripts/verify-cache.mjs`
Expected: PASS (3D untouched).

- [ ] **Step 5: Independent verifier**

Dispatch the `work-checker` agent on the full diff. Address any NEEDS-WORK items.

- [ ] **Step 6: Final commit (if verifier required fixes)**

```bash
git add -A && git commit -m "fix(realtime): address verification findings"
```
