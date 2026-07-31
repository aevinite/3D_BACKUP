// GET/POST /api/admin/restaurants/access-tree?restaurant_id=… — the ONE read/write
// endpoint for the rebuilt access & permission screen (owner, 2026-07-31).
//
// It knows nothing about individual features: every allow-list below is DERIVED from
// lib/accessTree.ts, so adding a node there wires this route automatically. The shapes it
// reads and writes are the storage the app already enforces (see accessTree's header), which
// is what lets a save take effect immediately with no new server gate.
//
// Admin-gated. Replaces /access2 (deleted with the old panel in the same rebuild).
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { cleanClonedSettings } from "@/lib/settingsClone";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import { menuTag } from "@/lib/menuDataServer";
import {
  SECTIONS, ALL_NODES, NODE_BY_ID, SETTINGS_COLUMNS, FEATURE_KEYS, SETTING_KEYS, CHOICE_KEYS,
  LIST_KEYS, TEXT_KEYS, MODULE_KEYS, PANEL_KEYS, CHANNEL_KEYS, GRANT_FLAGS, SECTION_ENTITLEMENTS,
  TABLET_COLS, TAB_KEYS, type TreeState,
} from "@/lib/accessTree";

export const dynamic = "force-dynamic";

// settings.features keys this route may write: the ones bound to a feature node, PLUS
// "ratings", which the Ratings CHOICE mirrors (see extraPatch in lib/accessTree.ts).
const WRITEABLE_FEATURES = new Set([...FEATURE_KEYS, "ratings"]);
const MODULE_COLS = new Set(MODULE_KEYS.flatMap((m) => [`${m}_allowed`, `${m}_enabled`]));
const TAB_ALLOWED: Record<string, Set<string>> = TAB_KEYS.reduce((acc, b) => {
  (acc[b.panel] ||= new Set()).add(b.key); return acc;
}, {} as Record<string, Set<string>>);

// access_config paths the tree may touch: { permId → { opts: Set<"side.key">, limits, tablet } }
const CONFIG_OPTS = new Set<string>();   // `${id}|${side}|${key}`
const CONFIG_LIMITS = new Set<string>(); // `${id}|${side}`
const CONFIG_TABLET = new Set<string>(); // id
for (const n of ALL_NODES) {
  const b = n.bind;
  if (b.t === "opt") CONFIG_OPTS.add(`${b.id}|${b.side}|${b.key}`);
  if (b.t === "limit") CONFIG_LIMITS.add(`${b.id}|${b.side}`);
  if (b.t === "capTablet") CONFIG_TABLET.add(b.id);
}
// The legal values of every choice / list node, so a hand-made request can't write a value
// the screen would then be unable to display.
const CHOICE_VALUES: Record<string, Set<string>> = {};
for (const n of ALL_NODES) {
  if ((n.bind.t === "choice" || n.bind.t === "list") && n.choices)
    CHOICE_VALUES[n.bind.key] = new Set(n.choices.map((c) => c.value));
}

const isTri = (v: unknown): v is "off" | "on" | "pin" => v === "off" || v === "on" || v === "pin";
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });
const uuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
async function gate(req: NextRequest) { return tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value); }

export async function GET(req: NextRequest) {
  if (!(await gate(req))) return bad("unauthorized", 401);
  const rid = req.nextUrl.searchParams.get("restaurant_id") || "";
  if (!uuid(rid)) return bad("Invalid restaurant_id.");

  const rq = await sb.from("restaurants")
    .select("manager_permissions, owner_entitlements, access_config").eq("id", rid).maybeSingle();
  if (rq.error) return bad(rq.error.message, 500);
  if (!rq.data) return bad("Restaurant not found.", 404);
  const r = rq.data as Record<string, any>;

  const cols = ["features", "enabled_panels", "platform_channels", ...SETTINGS_COLUMNS];
  const s = obj((await sb.from("settings").select(Array.from(new Set(cols)).join(", "))
    .eq("restaurant_id", rid).maybeSingle()).data);

  const featOverrides = obj(s.features);
  const features: Record<string, boolean> = {};
  for (const k of WRITEABLE_FEATURES) if (k in featOverrides) features[k] = featOverrides[k] === true;

  const settings: Record<string, unknown> = {};
  for (const c of SETTINGS_COLUMNS) if (c in s) settings[c] = s[c];

  const ep = obj(s.enabled_panels);
  const panels: Record<string, boolean> = {};
  for (const k of PANEL_KEYS) panels[k] = ep[k] !== false; // absent = on

  const pc = obj(s.platform_channels);
  const channels: Record<string, boolean> = {};
  for (const k of CHANNEL_KEYS) channels[k] = obj(pc[k]).on === true;

  const mp = obj(r.manager_permissions);
  const grants: Record<string, boolean> = {};
  for (const f of GRANT_FLAGS) if (f in mp) grants[f] = mp[f] === true;

  const oe = obj(r.owner_entitlements);
  const sections: Record<string, boolean> = {};
  for (const k of SECTION_ENTITLEMENTS) if (typeof oe[k] === "boolean") sections[k] = oe[k];

  const cfg = obj(r.access_config);
  const menus = obj(cfg.menus);
  const tabs: Record<string, Record<string, boolean>> = {};
  for (const panel of Object.keys(TAB_ALLOWED)) {
    tabs[panel] = {};
    const stored = obj(menus[panel]);
    for (const key of TAB_ALLOWED[panel]) if (typeof stored[key] === "boolean") tabs[panel][key] = stored[key];
  }

  const state: TreeState = { features, settings, panels, channels, grants, sections, tabs, config: cfg };
  return NextResponse.json({ sections: SECTIONS, state });
}

export async function POST(req: NextRequest) {
  if (!(await gate(req))) return bad("unauthorized", 401);
  let body: Record<string, any> = {}; try { body = await req.json(); } catch {}
  const rid = String(body.restaurant_id || "");
  if (!uuid(rid)) return bad("Invalid restaurant_id.");
  const cur = (await sb.from("restaurants")
    .select("manager_permissions, owner_entitlements, access_config").eq("id", rid).maybeSingle()).data as Record<string, any> | null;
  if (!cur) return bad("Restaurant not found.", 404);

  const patch = obj(body.patch ?? body);

  // ── restaurants columns ───────────────────────────────────────────────────
  const restUpdate: Record<string, any> = {};

  if (patch.grants) {
    const next = { ...obj(cur.manager_permissions) };
    for (const [k, v] of Object.entries(obj(patch.grants))) if (GRANT_FLAGS.includes(k)) next[k] = v === true;
    restUpdate.manager_permissions = next;
  }
  if (patch.sections) {
    const next = { ...obj(cur.owner_entitlements) };
    for (const [k, v] of Object.entries(obj(patch.sections))) if (SECTION_ENTITLEMENTS.includes(k)) next[k] = v === true;
    restUpdate.owner_entitlements = next;
  }

  // access_config carries the tab lists, the per-side menu parts, the dashboard picks,
  // the discount caps and the waiter caps that have no settings column.
  let cfg: Record<string, any> | null = null;
  const cfgRoot = () => (cfg ||= { ...obj(cur.access_config) });
  if (patch.tabs) {
    const root = cfgRoot();
    const menus = { ...obj(root.menus) };
    for (const [panel, keys] of Object.entries(obj(patch.tabs))) {
      if (!TAB_ALLOWED[panel]) continue;
      const dest = { ...obj(menus[panel]) };
      for (const [k, v] of Object.entries(obj(keys))) if (TAB_ALLOWED[panel].has(k)) dest[k] = v === true;
      menus[panel] = dest;
    }
    root.menus = menus;
  }
  if (patch.config) {
    const root = cfgRoot();
    for (const [permId, raw] of Object.entries(obj(patch.config))) {
      const entry = { ...obj(root[permId]) };
      const incoming = obj(raw);

      for (const [side, vals] of Object.entries(incoming)) {
        if (side === "tablet") {
          if (CONFIG_TABLET.has(permId) && isTri(vals)) entry.tablet = vals;
          continue;
        }
        if (side === "limit") {
          const dest = { ...obj(entry.limit) };
          for (const [sd, num] of Object.entries(obj(vals)))
            if (CONFIG_LIMITS.has(`${permId}|${sd}`) && Number.isFinite(Number(num))) dest[sd] = Number(num);
          entry.limit = dest;
          continue;
        }
        const m = side.match(/^(owner|manager|waiter)_opts$/);
        if (!m) continue;
        const dest = { ...obj(entry[side]) };
        for (const [k, v] of Object.entries(obj(vals)))
          if (CONFIG_OPTS.has(`${permId}|${m[1]}|${k}`)) dest[k] = typeof v === "boolean" ? v : String(v);
        entry[side] = dest;
      }
      root[permId] = entry;
    }
  }
  if (cfg) restUpdate.access_config = cfg;

  if (Object.keys(restUpdate).length) {
    const up = await sb.from("restaurants").update(restUpdate).eq("id", rid);
    if (up.error) return bad(up.error.message, 500);
  }

  // ── settings columns ──────────────────────────────────────────────────────
  const setPatch: Record<string, any> = {};

  if (patch.features) {
    const curFeat = obj((await sb.from("settings").select("features").eq("restaurant_id", rid).maybeSingle()).data?.features);
    const next = { ...curFeat };
    for (const [k, v] of Object.entries(obj(patch.features))) if (WRITEABLE_FEATURES.has(k)) next[k] = v === true;
    setPatch.features = next;
  }
  if (patch.panels) {
    const curEp = obj((await sb.from("settings").select("enabled_panels").eq("restaurant_id", rid).maybeSingle()).data?.enabled_panels);
    const next = { ...curEp };
    for (const [k, v] of Object.entries(obj(patch.panels))) if (PANEL_KEYS.includes(k)) next[k] = v === true;
    setPatch.enabled_panels = next;
  }
  if (patch.channels) {
    const curPc = obj((await sb.from("settings").select("platform_channels").eq("restaurant_id", rid).maybeSingle()).data?.platform_channels);
    const next = { ...curPc };
    for (const [k, v] of Object.entries(obj(patch.channels))) {
      if (!CHANNEL_KEYS.includes(k)) continue;
      next[k] = { ...obj(next[k]), on: v === true }; // keep any stored API credentials
    }
    setPatch.platform_channels = next;
  }
  if (patch.settings) {
    for (const [k, v] of Object.entries(obj(patch.settings))) {
      if (SETTING_KEYS.includes(k) || MODULE_COLS.has(k)) { if (typeof v === "boolean") setPatch[k] = v; continue; }
      if (TABLET_COLS.includes(k)) { if (isTri(v)) setPatch[k] = v; continue; }
      if (CHOICE_KEYS.includes(k)) { if (CHOICE_VALUES[k]?.has(String(v))) setPatch[k] = String(v); continue; }
      if (TEXT_KEYS.includes(k)) { setPatch[k] = String(v ?? "").slice(0, 400); continue; }
      if (LIST_KEYS.includes(k)) {
        const legal = CHOICE_VALUES[k];
        const list = (Array.isArray(v) ? v : []).map(String).filter((x) => !legal || legal.has(x));
        // A menu with no language or no currency has nothing to render — refuse rather than
        // save an empty list and leave the guest menu blank.
        if (!list.length) return bad(`${NODE_BY_ID[ALL_NODES.find((n) => n.bind.t === "list" && n.bind.key === k)?.id || ""]?.name || k}: pick at least one.`);
        setPatch[k] = Array.from(new Set(list));
      }
    }
  }

  if (Object.keys(setPatch).length) {
    const existing = (await sb.from("settings").select("id").eq("restaurant_id", rid).maybeSingle()).data;
    if (existing) {
      const up = await sb.from("settings").update(setPatch).eq("restaurant_id", rid);
      if (up.error) return bad(up.error.message, 500);
    } else {
      const template = await sb.from("settings").select("*").eq("restaurant_id", DEFAULT_RESTAURANT_ID).maybeSingle();
      const row = { ...cleanClonedSettings(template.data), id: rid.slice(0, 40), restaurant_id: rid, ...setPatch };
      const up = await sb.from("settings").upsert(row, { onConflict: "restaurant_id" });
      if (up.error) return bad(up.error.message, 500);
    }
  }

  // A GUEST-FACING switch has to reach guests NOW, not whenever a cache feels like it.
  //
  // The guest menu bundle is cached per restaurant with `revalidate: 86400` and the tag
  // menuTag(rid) (lib/menuDataServer.ts), and the ONLY thing that purged that tag was the
  // manager panel's own save (bustMenuCache in app/api/editor/[...path]/route.ts). This admin
  // endpoint replaced the old access screen and never purged it — so switching a guest feature
  // (favourites, the 3D dish viewer, the veg mark…) off here left guests seeing it for up to a
  // DAY, and the admin had no way to tell. That is the same "the switch did nothing" family as
  // the retired-column bug in #592. Found by the whole-app suite, phases 92/94. (2026-07-31)
  //
  // Best-effort and last: a purge failure must never fail a save that already succeeded — the
  // 24h revalidate is still the backstop underneath.
  if (Object.keys(setPatch).length) {
    try { revalidateTag(menuTag(rid), "max"); } catch { /* the revalidate window is the backstop */ }
  }

  return NextResponse.json({ ok: true });
}
