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
import { accessStateFor } from "@/lib/accessState";
import { logAction, deviceIdFrom } from "@/lib/oplog";
import { DEFAULT_RESTAURANT_ID } from "@/lib/tenant";
import { menuTag } from "@/lib/menuDataServer";
import {
  SECTIONS, ALL_NODES, NODE_BY_ID, FEATURE_KEYS, SETTING_KEYS, CHOICE_KEYS,
  LIST_KEYS, TEXT_KEYS, MODULE_KEYS, CHANNEL_KEYS, CREDS_KEYS, GRANT_FLAGS, SECTION_ENTITLEMENTS,
  TABLET_COLS, TAB_KEYS, HAS_IDS,
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
const CONFIG_LIMIT_MAX = new Map<string, number>(); // the biggest value that row's own dropdown offers
const CONFIG_TABLET = new Set<string>(); // id
for (const n of ALL_NODES) {
  const b = n.bind;
  if (b.t === "opt") CONFIG_OPTS.add(`${b.id}|${b.side}|${b.key}`);
  if (b.t === "limit") {
    CONFIG_LIMITS.add(`${b.id}|${b.side}`);
    if (n.options?.length) CONFIG_LIMIT_MAX.set(`${b.id}|${b.side}`, Math.max(...n.options));
  }
  if (b.t === "capTablet") CONFIG_TABLET.add(b.id);
}
// Every access_config top-level id this model can legitimately write — the union of the four
// shapes above plus the `has` feature halves. Derived, so a node added to the tree wires itself.
const KNOWN_CONFIG_IDS = new Set<string>([
  ...HAS_IDS,
  ...[...CONFIG_TABLET],
  ...[...CONFIG_OPTS].map((k) => k.split("|")[0]),
  ...[...CONFIG_LIMITS].map((k) => k.split("|")[0]),
]);
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

  // The state builder moved to lib/accessState.ts (2026-08-05) so the OWNER panel's person
  // profile can read the SAME answer instead of keeping its own hand-written permission list
  // (which had already drifted from this one). Identical output, one reader.
  const state = await accessStateFor(rid);
  if (!state) return bad("Restaurant not found.", 404);
  // JUST THE STATE. This used to ship `sections: SECTIONS` as well — 25 KB of constant JSON
  // (measured 2026-08-04) that no client has ever read: AccessTree, AccessPerPerson and
  // StaffProfile all import the model directly and use `state` only. It rode along on every load
  // of the Access screen, the Per-person tab AND every staff profile. (2026-08-04)
  return NextResponse.json({ state });
}

/** "Menu → 3D dish viewer: off · Manager → Delete a bill: on" — what the audit line says.
 *  Reads the MODEL for each key's real name, so a row renamed on screen is renamed here too. */
function describeAccessPatch(patch: Record<string, any>): string {
  const bits: string[] = [];
  const nameOfBind = (test: (b: any) => boolean) => ALL_NODES.find((n) => test(n.bind) || (n.featureBind && test(n.featureBind)))?.name;
  const say = (label: string | undefined, key: string, v: unknown) =>
    bits.push(`${label || key}: ${v === true ? "on" : v === false ? "off" : v === null ? "cleared" : String(v)}`);
  for (const [k, v] of Object.entries(obj(patch.features))) say(nameOfBind((b) => b.t === "feature" && b.key === k), k, v);
  for (const [k, v] of Object.entries(obj(patch.grants))) say(nameOfBind((b) => b.t === "grant" && b.flag === k), k, v);
  for (const [k, v] of Object.entries(obj(patch.sections))) say(nameOfBind((b) => b.t === "section" && b.key === k), k, v);
  for (const [k, v] of Object.entries(obj(patch.channels))) say(nameOfBind((b) => b.t === "channel" && b.key === k), k, v);
  for (const [k, v] of Object.entries(obj(patch.settings))) {
    const label = nameOfBind((b) => (b.t === "setting" || b.t === "tablet" || b.t === "choice" || b.t === "list" || b.t === "text") && b.key === k)
      || nameOfBind((b) => b.t === "module" && `${b.key}_allowed` === k);
    say(label, k, Array.isArray(v) ? v.join("/") : v);
  }
  for (const [panel, keys] of Object.entries(obj(patch.tabs)))
    for (const [k, v] of Object.entries(obj(keys))) say(nameOfBind((b) => b.t === "tab" && b.panel === panel && b.key === k), `${panel}.${k}`, v);
  // ── access_config, IN ENGLISH ────────────────────────────────────────────────────────────
  // Everything except the `on` half used to fall through to `${id}.${side}: ${JSON.stringify(v)}`,
  // so the Activity log recorded lines like `view_dashboard.manager_opts: {"range":"today"}`. That
  // was survivable while nothing showed the log back; the Access screen's "Recent changes here"
  // strip (2026-08-06) puts it in front of the admin, and the owner's standing rule is that the
  // log reads as English. Each shape now names the ROW from the model and the value from that
  // row's own choices, so a renamed row is renamed here too. (2026-08-06)
  const nodeFor = (test: (b: any) => boolean) => ALL_NODES.find((n) => test(n.bind));
  const labelOf = (node: { choices?: { value: string; label: string }[] } | undefined, v: unknown) =>
    node?.choices?.find((c) => c.value === String(v))?.label ?? (v === true ? "on" : v === false ? "off" : String(v));
  for (const [id, raw] of Object.entries(obj(patch.config))) {
    for (const [side, v] of Object.entries(obj(raw))) {
      if (side === "on") {
        bits.push(`${nameOfBind((b) => b.t === "has" && b.id === id) || id} (whole feature): ${v === true ? "on" : "off"}`);
        continue;
      }
      if (side === "tablet") {
        const n = nodeFor((b) => b.t === "capTablet" && b.id === id);
        bits.push(`${n?.name || id} (waiter): ${v === "pin" ? "on, with a manager PIN" : String(v)}`);
        continue;
      }
      if (side === "limit") {
        for (const [sd, num] of Object.entries(obj(v))) {
          const n = nodeFor((b) => b.t === "limit" && b.id === id && b.side === sd);
          bits.push(`${n?.name || `${id} limit (${sd})`}: ${num}${n?.unit || ""}`);
        }
        continue;
      }
      const m = side.match(/^(owner|manager|waiter)_opts$/);
      if (!m) { bits.push(`${id}.${side}: ${JSON.stringify(v)}`); continue; }
      for (const [k, val] of Object.entries(obj(v))) {
        const n = nodeFor((b) => b.t === "opt" && b.id === id && b.side === m[1] && b.key === k);
        bits.push(`${n?.name || `${id}.${k}`}: ${labelOf(n, val)}`);
      }
    }
  }
  // A credential's VALUE never reaches the log — only that one was set or cleared.
  for (const [k, v] of Object.entries(obj(patch.creds))) bits.push(`${k} key: ${v === null ? "removed" : "saved"}`);
  return bits.slice(0, 12).join(" · ") + (bits.length > 12 ? ` · +${bits.length - 12} more` : "");
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

  // ONLY WRITE THE COLUMN IF A KEY SURVIVED THE ALLOW-LIST. Assigning it regardless meant a patch
  // naming nothing but unknown flags still produced a column update, so "did anything land?"
  // could not be answered at the end of this handler — and the caller was told "Saved".
  if (patch.grants) {
    const next = { ...obj(cur.manager_permissions) };
    let took = 0;
    for (const [k, v] of Object.entries(obj(patch.grants))) if (GRANT_FLAGS.includes(k)) { next[k] = v === true; took++; }
    if (took) restUpdate.manager_permissions = next;
  }
  if (patch.sections) {
    const next = { ...obj(cur.owner_entitlements) };
    let took = 0;
    for (const [k, v] of Object.entries(obj(patch.sections))) if (SECTION_ENTITLEMENTS.includes(k)) { next[k] = v === true; took++; }
    if (took) restUpdate.owner_entitlements = next;
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
        // config[id].on — "does this restaurant have it at all", the feature half of a row.
        if (side === "on") {
          if (HAS_IDS.includes(permId)) entry.on = vals === true;
          continue;
        }
        if (side === "tablet") {
          if (CONFIG_TABLET.has(permId) && isTri(vals)) entry.tablet = vals;
          continue;
        }
        if (side === "limit") {
          const dest = { ...obj(entry.limit) };
          for (const [sd, num] of Object.entries(obj(vals))) {
            if (!CONFIG_LIMITS.has(`${permId}|${sd}`)) continue;
            const n = Number(num);
            if (!Number.isFinite(n)) continue;
            // CLAMPED to what the row itself offers (2026-08-04). Any finite number used to be
            // accepted, so a hand-made request could store a 100000% discount ceiling that no
            // dropdown could ever show or undo — and lib/discountCap.ts would honour it.
            const ceiling = CONFIG_LIMIT_MAX.get(`${permId}|${sd}`);
            dest[sd] = ceiling === undefined ? n : Math.max(0, Math.min(n, ceiling));
          }
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
      // ONLY WRITE BACK A KEY THE MODEL KNOWS (fixed 2026-08-05). Every branch above already
      // refuses an id it doesn't recognise — but the write itself sat outside them, so a patch
      // naming any id at all stored an entry for it, and an unknown one stored `{}` for ever.
      // access_config is the restaurant's permanent permission record and is read on hot paths;
      // it should not collect keys nothing will ever look at. (The retired ids already sitting in
      // there are left alone on purpose — that is how every retired switch in this model is
      // handled, and deleting stored history is not this endpoint's job.)
      if (KNOWN_CONFIG_IDS.has(permId)) root[permId] = entry;
    }
  }
  if (cfg) restUpdate.access_config = cfg;

  // ── settings columns ──────────────────────────────────────────────────────
  // BUILT BEFORE ANYTHING IS WRITTEN (2026-08-04). The `restaurants` update used to run here,
  // ABOVE this block — and the list branch below can still `return bad(...)` ("pick at least one
  // language"). A patch carrying both a grant and an empty list therefore landed the grant, then
  // refused, and the screen reloaded showing half the change applied. Validate first, write after.
  const setPatch: Record<string, any> = {};

  if (patch.features) {
    const curFeat = obj((await sb.from("settings").select("features").eq("restaurant_id", rid).maybeSingle()).data?.features);
    const next = { ...curFeat };
    for (const [k, v] of Object.entries(obj(patch.features))) if (WRITEABLE_FEATURES.has(k)) next[k] = v === true;
    setPatch.features = next;
  }
  // Channels and their API keys live in the SAME column, so they are merged into ONE object here.
  // Doing them in two independent branches would have let a patch carrying both write the column
  // twice, the second overwriting the first — a saved key silently lost, or a channel switched
  // back on by the write that stored its key.
  if (patch.channels || patch.creds) {
    const curPc = obj((await sb.from("settings").select("platform_channels").eq("restaurant_id", rid).maybeSingle()).data?.platform_channels);
    const next = { ...curPc };
    for (const [k, v] of Object.entries(obj(patch.channels))) {
      if (!CHANNEL_KEYS.includes(k)) continue;
      next[k] = { ...obj(next[k]), on: v === true }; // keep any stored API credentials
    }
    for (const [k, v] of Object.entries(obj(patch.creds))) {
      if (!CREDS_KEYS.includes(k)) continue;
      const cur = obj(next[k]);
      // "" = the form was saved without retyping the key, so leave the stored one alone. null =
      // remove it deliberately. Anything else replaces it. Trimmed because a pasted key almost
      // always arrives with a newline, and a key with a stray newline fails with no clue why.
      if (v === null) { const { api_key: _drop, ...rest } = cur; next[k] = rest; continue; }
      const key = String(v ?? "").trim();
      if (!key) continue;
      next[k] = { ...cur, api_key: key.slice(0, 400) };
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

  // Everything is validated by here, so the writes can go out together.
  if (Object.keys(restUpdate).length) {
    const up = await sb.from("restaurants").update(restUpdate).eq("id", rid);
    if (up.error) return bad(up.error.message, 500);
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
    // `{ expire: 0 }` for the same measured reason as the other two call sites: "max" serves one
    // more stale read, so a guest-facing switch appeared to need saving twice. (T13, 2026-08-05)
    try { revalidateTag(menuTag(rid), { expire: 0 }); } catch { /* the revalidate window is the backstop */ }
  }

  // WHO CHANGED THIS RESTAURANT'S PERMISSIONS (found twice on 2026-08-04 — by the API sweep and by
  // the admin sweep, independently, which is a fair sign of how visible the gap was). Every sibling
  // write records itself — `restaurant_settings`, `manager_permissions`, `user_set_permissions` —
  // and this one, the single endpoint behind the WHOLE Access & permissions screen, logged nothing.
  // So a manager losing a capability overnight, or a restaurant's guest menu going dark, had no
  // who-and-when anywhere in the product.
  //
  // BOTH sweeps' versions are kept here on purpose:
  //   · the detail names the ROWS that moved and what they moved TO, read from the model, so the
  //     Activity log's "What" column reads as English and not as a wall of nested JSON (the same
  //     lesson as the invoice row that printed a session uuid). It falls back to naming the GROUPS
  //     when nothing describable came out, so the line is never empty.
  //   · the device id rides along, and the whole thing is `.catch()`ed — a logging failure must
  //     never fail a save that already succeeded.
  // A credential's VALUE never reaches the log; only that one was saved or removed.
  const changed = describeAccessPatch(patch);
  const groups = Object.keys(patch).filter((k) => (patch[k] && typeof patch[k] === "object" ? Object.keys(patch[k]).length : patch[k] !== undefined));

  // A SAVE THAT LANDED NOWHERE MUST NOT SAY "Saved" (sweep 2026-08-05). Every allow-list above
  // `continue`s past a key it doesn't recognise, and then this answered {ok:true} regardless — so
  // a patch the route silently dropped in full read back as a success, the screen showed "Saved",
  // and the value returned to its old state on the next load. That is the dead-switch shape this
  // whole model exists to remove, wearing a green tick.
  //
  // "Nothing landed" is specifically: the caller named at least one group with at least one key,
  // and not one of them survived. Re-saving a value that was ALREADY what you asked for still
  // lands (the column is written), so an ordinary no-op tap is unaffected.
  if (groups.length && !Object.keys(restUpdate).length && !Object.keys(setPatch).length)
    return bad(`Nothing in that change could be saved — this screen does not own ${groups.join(", ")}.`);
  await logAction("admin", "access_change", {
    actor: "admin", restaurant_id: rid, device_id: deviceIdFrom(req),
    detail: changed || `access & permissions saved — ${groups.length ? groups.join(", ") : "no group named"}`,
  }).catch(() => { /* the save stands either way */ });

  return NextResponse.json({ ok: true });
}
