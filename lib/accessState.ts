// lib/accessState.ts — READ one restaurant's access & permission STATE, once, for everybody.
//
// `TreeState` is the answer to "what does this restaurant currently give each role?" — the
// features, settings, grants, section entitlements, panel tabs and access_config that
// lib/accessTree's `nodeValue()` reads. It was built inline inside
// app/api/admin/restaurants/access-tree/route.ts, which meant only the ADMIN screens could
// ask the question.
//
// The owner panel needs the same answer for one honest reason: a person's profile shows
// "Default (On)" next to every permission row, and the "(On)" IS this state. Without it the
// owner's profile had to keep its own hand-written list of waiter rows — which had already
// drifted (three rows missing, and one gated on the wrong module) while the admin's profile,
// reading the real tree, showed the truth. One reader, one answer, no drift.
//
// Nothing here decides anything: it READS. Every allow-list is derived from lib/accessTree, so
// a node added there is picked up automatically.
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import {
  SETTINGS_COLUMNS, FEATURE_KEYS, CHANNEL_KEYS, CREDS_KEYS, GRANT_FLAGS,
  SECTION_ENTITLEMENTS, TAB_ALLOWED, KNOWN_CONFIG_IDS, type TreeState,
} from "@/lib/accessTree";

// settings.features keys the model knows about, PLUS "ratings", which the Ratings CHOICE
// mirrors (see extraPatch in lib/accessTree.ts).
const KNOWN_FEATURES = new Set([...FEATURE_KEYS, "ratings"]);
// TAB_ALLOWED comes from lib/accessTree now — this file and the access-tree route each kept an
// identical copy of the same reduce, which is where the next drift starts. (sweep T6, 2026-08-10)

const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});

/**
 * The whole permission state of ONE restaurant, or null when there is no such restaurant.
 * Two scoped reads (`restaurants` + `settings`), both with explicit column lists.
 *
 * CALLERS MUST HAVE CHECKED THE CALLER'S RIGHT TO THIS RESTAURANT FIRST — this helper takes an
 * id and answers; it is not a gate. (`access-tree` is admin-gated; the owner staff route only
 * ever passes a restaurant already resolved through `scope()`.)
 */
export async function accessStateFor(rid: string): Promise<TreeState | null> {
  const rq = await sb.from("restaurants")
    .select("manager_permissions, owner_entitlements, access_config").eq("id", rid).maybeSingle();
  if (rq.error || !rq.data) return null;
  const r = rq.data as Record<string, any>;

  const cols = ["features", "platform_channels", ...SETTINGS_COLUMNS];
  const s = obj((await sb.from("settings").select(Array.from(new Set(cols)).join(", "))
    .eq("restaurant_id", rid).maybeSingle()).data);

  const featOverrides = obj(s.features);
  const features: Record<string, boolean> = {};
  for (const k of KNOWN_FEATURES) if (k in featOverrides) features[k] = featOverrides[k] === true;

  const settings: Record<string, unknown> = {};
  for (const c of SETTINGS_COLUMNS) if (c in s) settings[c] = s[c];

  const pc = obj(s.platform_channels);
  const channels: Record<string, boolean> = {};
  for (const k of CHANNEL_KEYS) channels[k] = obj(pc[k]).on === true;

  // A channel's API key belongs to the restaurant's own Zomato/Swiggy account. It goes out ONLY
  // as a hint that says WHICH key is stored without being the key: "••••1234". The value itself
  // has no path back to any browser — not here, not anywhere.
  // ONE FIELD NAME FOR ONE KEY (T17 sweep, 2026-08-13, finding F4). This screen used to read and
  // write `api_key` while the restaurant detail's Platform-channels panel read and wrote `key` — the
  // SAME column, two names. So an admin pasted the Zomato key here, saw "••••1234", opened the other
  // screen and was told no key was saved; pasting it again left the row holding two copies, and
  // clearing it on one screen left the other's behind. `key` wins because it is the shape migration
  // 209 documents. The legacy name is still READ so a key saved before this change still shows, and
  // the access-tree write drops it, so every restaurant converges on one field as it is next saved.
  const creds: Record<string, string> = {};
  for (const k of CREDS_KEYS) {
    const cell = obj(pc[k]);
    const raw = typeof cell.key === "string" && cell.key ? cell.key : cell.api_key;
    creds[k] = typeof raw === "string" && raw.length ? `••••${raw.slice(-4)}` : "";
  }

  const mp = obj(r.manager_permissions);
  const grants: Record<string, boolean> = {};
  for (const f of GRANT_FLAGS) if (f in mp) grants[f] = mp[f] === true;

  const oe = obj(r.owner_entitlements);
  const sections: Record<string, boolean> = {};
  for (const k of SECTION_ENTITLEMENTS) if (typeof oe[k] === "boolean") sections[k] = oe[k];

  // ── ONLY THE KEYS THIS MODEL OWNS (sweep T6, 2026-08-10) ────────────────────────────────────
  // `config` used to be the raw `access_config` column, retired ids and all. Measured on backup:
  // 5,122 of French House's 6,770-byte reply, and 5,088 of Aangan's — ~26 permission names that
  // were retired months ago and that nothing on this screen can show or change. The same reply is
  // fetched by the Access screen, again by the Per-person tab, and again by every staff profile
  // opened. The route already dropped 25 KB of constant JSON for exactly this reason; this is the
  // rest of the same fat. Narrowed to KNOWN_CONFIG_IDS — the ids the model can legitimately write,
  // derived from the tree, so a node added there is carried automatically — plus `menus`, which is
  // the tab lists the screen reads. The stored history is untouched; it just stops riding along.
  const rawCfg = obj(r.access_config);
  const cfg: Record<string, any> = {};
  for (const id of KNOWN_CONFIG_IDS) if (id in rawCfg) cfg[id] = rawCfg[id];
  if ("menus" in rawCfg) cfg.menus = rawCfg.menus;
  const menus = obj(cfg.menus);
  const tabs: Record<string, Record<string, boolean>> = {};
  for (const panel of Object.keys(TAB_ALLOWED)) {
    tabs[panel] = {};
    const stored = obj(menus[panel]);
    for (const key of TAB_ALLOWED[panel]) if (typeof stored[key] === "boolean") tabs[panel][key] = stored[key];
  }

  return { features, settings, channels, grants, sections, tabs, config: cfg, creds };
}
