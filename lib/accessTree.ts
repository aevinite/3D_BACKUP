// lib/accessTree.ts — THE access & permission model (owner rebuild, 2026-07-31).
//
// Replaces the old 4-rung "ladder" idea from lib/accessModel.ts, where 33 permissions ×
// 3 sides produced 54 sub-checkboxes of which only 9 were read by any server code. The
// owner's rule now:
//
//   A TOGGLE EXISTS ONLY WHERE IT IS LISTED HERE. Everything else in the app is
//   permanently ON for whoever's panel owns it — no switch, no greyed-out ghost.
//
// Four sections, admin-only (owners and managers configure no permissions at all):
//   A  main      — MAIN FEATURES         what this restaurant HAS
//   B  mgrMenu   — MANAGER'S MENU        which tabs the manager panel shows
//   C  ownMenu   — OWNER'S MENU          which pages the owner panel shows
//   D  defaults  — DEFAULT SET FOR USER  what a manager / owner / waiter starts with
//
// WHY THE BINDINGS LOOK LIKE THIS (read before adding a node): every leaf binds to
// storage the app ALREADY enforces, so a save takes effect immediately with no new
// server gate. That is what makes a rebuild this large safe:
//   • settings.features[k]        → guest app, useFeatures()
//   • settings.<col>              → plain per-restaurant setting
//   • settings.<x>_allowed        → moduleLadder() in lib/tableTags.ts
//   • settings.tablet_<x>         → tabletPerm()  (the WAITER default)
//   • restaurants.manager_permissions[f] → managerCan()  (the MANAGER default)
//   • restaurants.owner_entitlements[s]  → owner-panel nav + APIs
//   • settings.enabled_panels[p]  → panel login gate
// Only two things are genuinely new and need their own gate (both marked `fresh: true`):
// the guest-menu master switch and the manager's tab list.
//
// Docs: docs/ACCESS-MODEL.md. Do NOT add to lib/accessModel.ts — it survives only as the
// enforcement-wiring lists (MANAGER_POWER_FLAGS etc.) that older routes import.

export type Choice = { value: string; label: string; what?: string };

export type Bind =
  // ── booleans ──────────────────────────────────────────────────────────────
  | { t: "feature"; key: string }        // settings.features[key]        (guest)
  | { t: "setting"; key: string }        // settings.<key>                (boolean column)
  | { t: "module"; key: string }         // settings.<key>_allowed        (+ _enabled forced true)
  | { t: "panel"; key: string }          // settings.enabled_panels[key]
  | { t: "channel"; key: string }        // settings.platform_channels[key].on
  | { t: "grant"; flag: string }         // restaurants.manager_permissions[flag]  → MANAGER default
  | { t: "section"; key: string }        // restaurants.owner_entitlements[key]    → OWNER pages
  | { t: "tab"; panel: string; key: string } // access_config.menus[panel][key]    (NEW gate)
  // ONE MENU = ONE SWITCH. A manager menu was two separate controls — the panel's tab list
  // (access_config.menus) and the manager power that its endpoints check (manager_permissions) —
  // sitting in two different sections of this screen. Two switches for one thing is how a screen
  // starts disagreeing with itself, so they move together: off means the tab is gone AND the
  // endpoints behind it refuse. On means both. (owner, 2026-08-01)
  | { t: "menu"; panel: string; key: string; grant: string }
  // ── other shapes ─────────────────────────────────────────────────────────
  | { t: "tablet"; key: string }         // settings.tablet_<x>   "off" | "on" | "pin"  → WAITER default
  | { t: "capTablet"; id: string }       // access_config[id].tablet  (waiter cap with no column yet)
  | { t: "choice"; key: string }         // settings.<key>  string, one of node.choices
  | { t: "list"; key: string }           // settings.<key>  text[]  (multi-select)
  | { t: "text"; key: string }           // settings.<key>  text
  // settings.platform_channels[key].api_key — a third party's API key for one delivery channel.
  // WRITE-ONLY BY DESIGN: the browser sends a key and only ever gets a masked hint back
  // ("••••1234"), so a stored credential can't be read off the Access screen or out of a response.
  // Saving an empty value changes nothing; clearing is a deliberate separate action.
  | { t: "creds"; key: string }
  // access_config[id].<side>_opts[key] — the EXACT shape menuSubAllowed() in the editor
  // API already reads for the nine Edit-menu parts. Do not "tidy" this path: those nine
  // are the only sub-options the old model ever really enforced, and they enforce through
  // manager_opts. Holds any JSON value, so a string choice (dashboard range) fits too.
  | { t: "opt"; id: string; side: string; key: string }
  | { t: "limit"; id: string; side: string } // access_config[id].limit[side] — a numeric ceiling
  // The WHOLE rating area on or off. It spans TWO stored values because the guest app already
  // reads two: settings.features.ratings decides whether in-menu stars exist at all, and
  // google_review_mode decides where a rating is sent. Off means BOTH are off, so nothing about
  // rating shows a guest — which is what the owner asked for when he noticed the master switch
  // had gone missing in the rebuild (2026-08-01). Deriving it here rather than adding a third
  // column keeps ONE source of truth for the guest: no new gate, no new default, no drift.
  | { t: "ratingsMaster" }
  // access_config[id].on — DOES THIS RESTAURANT HAVE IT AT ALL, as opposed to what a person of a
  // role starts with. The owner's two-switch row needs both and only the second existed: a
  // manager grant said "what a manager gets", with nothing above it saying whether the thing is
  // on the premises. Stored in access_config (already JSONB, so no migration) and ABSENT MEANS
  // ON, so no restaurant changes until someone deliberately switches one off.
  | { t: "has"; id: string; def?: boolean }
  | { t: "none" };                       // nothing stored (left-to-build placeholder)

export type Node = {
  id: string;
  name: string;
  what: string;                 // plain-language help, shown in the (i) popover
  bind: Bind;
  def?: boolean | string | string[] | number;
  children?: Node[];
  choices?: Choice[];           // for bind.t === "choice" / "list"
  pin?: boolean;                // money action → the waiter row offers "On + manager PIN"
  leftToBuild?: boolean;        // shown, labelled, saves nothing yet
  // (`info?: boolean` lived here — a row that existed ONLY for its words, storing nothing and
  //  rendering no control. It had exactly one user, "If BOTH of the two above are off", and the
  //  owner deleted that row on 2026-08-03: an explanation is not a setting and does not get a
  //  box on this screen. Nothing ever read the flag anyway. Explanations belong in a node's
  //  `what`, which is what the ⓘ button opens — put them there, not in a row of their own.)
  fresh?: boolean;              // its gate is NEW in this rebuild (not legacy-enforced)
  placeholder?: string;         // for text nodes
  unit?: string;                // for cap nodes
  options?: number[];           // for cap nodes
  // A "list" node that is really a SINGLE-or-MANY question. The count already IS the answer —
  // one language means the guest menu shows no switcher, two or more means it does — so the mode
  // is read off the stored list rather than kept in a second column that could disagree with it
  // (owner, 2026-08-01: "there should be two options, single and multiple; in single there
  // shouldn't be the option on top, in multiple you can toggle through them").
  singleOrMany?: boolean;
  // The row carries TWO controls: this is the FEATURE half ("does the restaurant have it"),
  // while `bind` stays the DEFAULT half ("what a person of that role starts with"). Rendered as
  // the switch that slides left with the default chip growing open on its right.
  featureBind?: Bind;
  link?: { href: string; label: string }; // read-only row that points at the screen which OWNS this value
  // `configurableWhenOff` was RETIRED on 2026-08-02: the owner made its behaviour the rule for
  // EVERY row ("even if the feature is off, you can still go in the drop-down and check
  // everything — you will just not able to edit it… it will be grey out"), so the flag that
  // marked the exception says nothing any more. See Row() in components/admin/AccessTree.tsx.
  // This row owns a whole editor, shown inside its dropdown: the exact card that used to live on
  // the restaurant-detail page. `settings:<id>` renders one section of RestaurantSettings,
  // `branding` renders the branding & theme editor. Owner, 2026-08-01: "you have completely
  // removed setting and permission from restaurant detail — everything will be here".
  panel?: "settings:sessions" | "settings:kitchen" | "settings:banquet" | "settings:billing" | "settings:tables" | "settings:floor" | "settings:qr" | "branding";
  // A format screen that can SHOW its finished page: puts a "Preview / Print" button at the
  // top right of the embedded editor, opening the real bill drawn from this restaurant's
  // settings (owner, 2026-08-02). The value picks which document — and every one of them is
  // rendered by the SAME file the panels print from (/panels/billdoc.js), so what is approved
  // here is what a guest is handed.
  preview?: "bill" | "parcel" | "kot";
};

export type Section = { id: string; name: string; blurb: string; icon: string; children: Node[] };

// ─────────────────────────────────────────────────────────────────────────────
// The six guest menu languages the app already ships (lib/i18n.ts) and the
// currencies it can price in. A restaurant with ONE language + ONE currency shows
// no switcher at all on the guest menu — the switcher is removed, not disabled.
// These MUST mirror LANGUAGES / CURRENCIES in lib/format.ts exactly. Offering a code the
// app can't render would be a switch that saves and then shows English anyway — the class
// of dead control this rebuild exists to remove. Guarded by scripts/verify-access-model.mjs.
export const MENU_LANGUAGES: Choice[] = [
  { value: "en", label: "🇬🇧 English" }, { value: "de", label: "🇩🇪 Deutsch" }, { value: "fr", label: "🇫🇷 Français" },
  { value: "ar", label: "🇸🇦 العربية" }, { value: "hi", label: "🇮🇳 हिन्दी" }, { value: "ko", label: "🇰🇷 한국어" },
];
export const MENU_CURRENCIES: Choice[] = [
  { value: "INR", label: "₹ INR" }, { value: "USD", label: "$ USD" }, { value: "EUR", label: "€ EUR" },
  { value: "AED", label: "AED" }, { value: "SAR", label: "SAR" }, { value: "QAR", label: "QAR" },
];

// The nine things a person may be allowed to do inside "Edit the menu". These are the
// ONLY sub-options from the old model that were ever really enforced (MENU_SUB_KEYS /
// menuSubAllowed in the editor API), which is why they survive the cleanup.
const EDIT_MENU_PARTS: { id: string; name: string; what: string; def: boolean }[] = [
  { id: "edit_options", name: "Customisation", def: true, what: "A dish's choice groups — Size, Milk, Extras — and what each choice adds to the price." },
  { id: "add_dish", name: "Add a new dish", def: true, what: "The + Add dish button." },
  { id: "edit_dish", name: "Edit dish info", def: true, what: "Name, description, photo, tags, allergens." },
  { id: "edit_price", name: "Change a price", def: true, what: "The price field on its own — the field most worth protecting." },
  { id: "delete_dish", name: "Delete a dish", def: true, what: "Removes a dish from the menu." },
  { id: "mark_86", name: "Mark as sold out", def: true, what: "Flips a dish sold-out so guests can't order it." },
  { id: "manage_categories", name: "Manage categories", def: true, what: "Add, rename and hide menu categories." },
  { id: "manage_filters", name: "Manage filters", def: true, what: "The dietary/preference chips guests filter the menu by." },
  { id: "edit_3d", name: "Attach a 3D model", def: false, what: "Uploading and positioning a dish's 3D model. Stays OFF until you deliberately switch it on — it writes to shared storage every restaurant reads." },
];

// The views inside "Audit & logs" (owner, 2026-08-02: "there will be sub option like for the
// logs and audit — which can be visible and which can't"). One list feeds the manager's rows
// AND the owner's rows, so the two sides can never offer different views. Stored at
// access_config.view_logs.<side>_opts.<id>; ABSENT MEANS ON (def true), so no restaurant
// changes until an admin switches one off. The ADMIN's own panel is never gated by these —
// the admin always sees every log of every restaurant, combined.
const LOG_PARTS: { id: string; name: string; what: string; mgrOnly?: boolean }[] = [
  { id: "removals", name: "Removals record", what: "What was taken out and why — a cancelled KOT, a deleted bill, a dish off an order or off the menu — with the reason and the person." },
  { id: "activity", name: "Activity log", what: "The full record of who did what, action by action." },
  { id: "customers", name: "Customer log", mgrOnly: true, what: "The guests — who joined which table, what they did, and the blocklist. (The owner's own Customers page is separate and not affected.)" },
];

// Money & floor actions offered as a MANAGER default (restaurants.manager_permissions —
// already enforced by managerCan) and as a WAITER default (settings.tablet_* tri-state —
// already enforced by tabletPerm). `pin` marks the ones whose waiter row also offers
// "On, but ask a manager PIN"; everything else is a plain on/off.
type ActionDef = {
  id: string; name: string; what: string; flag: string; tablet?: string; capTablet?: string;
  mgrDef: boolean; waiterDef?: "off" | "on" | "pin"; pin?: boolean; cap?: boolean;
  // Reopen-a-bill's minutes window (owner default: 5 — his 2026-08-02 word for every
  // restaurant). Rendered as the "Only within" child of the manager row.
  mins?: number;
};
const ACTIONS: ActionDef[] = [
  // NOT FEATURES ANY MORE (owner, 2026-08-01). Taking an order, settling a bill, issuing the
  // invoice, marking a table's type and moving/merging/splitting are how the floor RUNS — a
  // restaurant that switched them off could not trade. They are permanently on for whoever's
  // panel owns them and have no row here. managerGrantValue() answers ON for a flag with no
  // row, so removing them from this list is the whole change: nothing to store, nothing to
  // migrate, and no screen that can take them away by accident.
  //   take_orders · mark_paid · print_invoice · table_tags · table_ops
  //
  // ORDER + DEFAULTS (owner, 2026-08-02): "Permission for manager: there will be delete bill,
  // reopen bill, and discount bill… for all restaurant, reopen the bill in five minute, and
  // discount bill percentage will be fifty percent." The minutes window lives INSIDE the
  // reopen row and the percentage cap INSIDE the discount row — his words: "there will be a
  // drop down for reopen bill how much minute is set… you could able to go inside and change".
  { id: "delete_bill", name: "Delete a bill", flag: "delete_bill", mgrDef: false, pin: true,
    what: "Takes a bill out of the reports. The number is NOT reused — the next bill still takes the next number — and nothing is erased: the bill stays in the records and in the audit, it simply stops counting towards sales." },
  // DEFAULT OFF (owner, 2026-08-02, superseding his earlier same-day word that it ships on):
  // "reopening the bill will be off only, by default — permission will be off for all the
  // restaurants." The 5-minute window below still applies wherever an admin switches it ON.
  { id: "void_bills", name: "Reopen a bill", flag: "void_bills", capTablet: "void_bills", mgrDef: false, waiterDef: "off", pin: true, mins: 5,
    what: "Reopening a bill that was already closed. The SAME bill comes back — and it is recorded that it was reopened, and what changed, so the audit always shows it." },
  { id: "give_discounts", name: "Discount a bill", flag: "give_discounts", tablet: "tablet_discount", mgrDef: true, waiterDef: "off", pin: true, cap: true,
    what: "Taking money off a bill. The cap below is the most this role may take off in one go." },
  // "Manage staff" LEFT this list (owner, 2026-08-01) — it is not one of the money actions, it is
  // its own thing, and one switch covering create/reset/delete was three very different amounts of
  // trust behind a single yes. It lives in "What a manager can manage", split up.
  //
  // "Change restaurant settings" is GONE entirely, not moved. There is no restaurant configuration
  // left for a manager to change: service mode and the bubble effect are decided on Access now,
  // the bill and the tables belong to the admin, and the floor is its own row below.
];

// One ACTIONS row rendered for a given side.
const mgrAction = (a: ActionDef): Node => {
  const kids: Node[] = [];
  // The discount ceiling — default 50% (owner, 2026-08-02: "discount bill percentage will be
  // fifty percent" for every restaurant; was 20 before that word).
  if (a.cap) kids.push({ id: `mgr_${a.id}_cap`, name: "Most they can take off", what: "The biggest discount this role may apply in one go.", bind: { t: "limit", id: a.id, side: "manager" }, def: 50, unit: "%", options: [5, 10, 20, 50, 100] });
  // Reopen-a-bill's window — the id stays "mgr_bill_reopen_mins" from when this row lived
  // under the Bill menu, so old deep links and the QA phases keep finding it.
  if (a.mins) kids.push({ id: "mgr_bill_reopen_mins", name: "Only within", def: a.mins, bind: { t: "limit", id: a.id, side: "minutes" },
    unit: " min", options: [5, 10, 15, 30, 60],
    what: "How long after a bill closes it can still be reopened. After that it is settled and a correction has to be a credit note, which is the legal way round." });
  return {
    id: `mgr_${a.id}`, name: a.name, what: a.what, bind: { t: "grant", flag: a.flag }, def: a.mgrDef, pin: a.pin,
    featureBind: { t: "has", id: a.id },
    children: kids.length ? kids : undefined,
  };
};
const waiterAction = (a: ActionDef): Node | null => {
  if (!a.tablet && !a.capTablet) return null;
  return {
    id: `wtr_${a.id}`, name: a.name, what: a.what, pin: a.pin, def: a.waiterDef || "off",
    featureBind: { t: "has", id: a.id },
    bind: a.tablet ? { t: "tablet", key: a.tablet } : { t: "capTablet", id: a.capTablet! },
    children: a.cap ? [{ id: `wtr_${a.id}_cap`, name: "Most they can take off", what: "The biggest discount a waiter may apply in one go.", bind: { t: "limit", id: a.id, side: "waiter" }, def: 5, unit: "%", options: [5, 10, 20, 50, 100] }] : undefined,
  };
};

// The manager panel's own Settings sections (public/panels/editor/app.js → SETTINGS_SECTIONS).
//
// ONLY the sections a real manager can genuinely use have a row (owner, 2026-08-02: "right now
// there are many options which are not even useful… the only option we required is table name
// and number of people, user creation…, and who serves which table"). The billing / kitchen /
// sessions rows were REMOVED: those sections are admin-only inside the panel (XRAY
// admin_only_setting hides them from every real manager), so their switches governed nothing a
// manager could ever see — the dead-switch shape the access rebuild exists to remove. A stored
// menus.mgrset.billing/kitchen/sessions=false is ignored from now on, like every retired key.
export const MANAGER_SETTINGS: { key: string; name: string; what: string }[] = [
  { key: "tables", name: "Tables — name & seats", what: "Renaming a table and how many people sit at it. Adding or removing tables — and how many tables sit on one row of the floor — stay admin-only, with no switch that can hand them over." },
  // The owner's rules for Users (2026-08-02), enforced by the editor API, not just worded here:
  // a manager can CREATE a login (its permissions start on Default automatically — a manager
  // never sets permissions), RESET its password, and DISABLE it (the person is told they've
  // been disabled when they try to sign in). A manager can NEVER DELETE a login — deleting
  // people is the admin's job, and the panels' user lists all read the same rows, so a person
  // the admin deletes disappears everywhere at once.
  { key: "users", name: "Users — staff logins", what: "Creating this restaurant's staff logins (new logins start on the restaurant's defaults), resetting a password, and disabling a login — a disabled person is told so when they try to sign in. Deleting a login stays admin-only. A manager can only ever touch roles below their own." },
  { key: "access", name: "Sections — who serves which table", what: "Giving each waiter their own part of the floor, so their tablet shows only those tables." },
];

// ═════════════════════════════════════════════════════════════════════════════
export const SECTIONS: Section[] = [
  // ─────────────────────────── A · MAIN FEATURES ────────────────────────────
  {
    id: "main", name: "Main features", icon: "sparkles",
    blurb: "What this restaurant has. Switch one off and it disappears from every panel that used it — no greyed-out leftovers.",
    children: [
      {
        id: "menu", name: "Menu", def: true, fresh: true, bind: { t: "setting", key: "menu_enabled" },
        what: "The whole guest menu. OFF means this restaurant has NO guest menu at all — no QR menu, no menu link, nothing for a diner to open. It runs on the staff panels only.",
        children: [
          { id: "dining_sessions", name: "Dining session and location", def: false,
            bind: { t: "setting", key: "sessions_enabled" }, panel: "settings:sessions",             what: "The table-session system: a guest scans the table's QR, the table is opened, the party is tracked and joined. OFF means there is no “Open table” step at all — the floor switches to direct ordering, so staff punch an order straight in without opening a table first. The rules and the café's coordinates are inside." },
          {
            // MASTER on/off — the rebuild lost it: only the three-way "where does the rating go"
            // picker survived, so there was no way to say "this restaurant has no rating at all"
            // (owner, 2026-08-01: "there is no toggle to on and off rating right now").
            id: "ratings", name: "Ratings", def: true, bind: { t: "ratingsMaster" },             what: "The whole rating & review part of the guest menu — the star row on a dish, the “Rate dish” box and the review invite. OFF removes all of it; a guest is never asked to rate anything.",
            children: [
              { id: "ratings_mode", name: "Where the rating goes", def: "off", bind: { t: "choice", key: "google_review_mode" },
                what: "Once a guest has eaten, where do you want the rating to land? Pick one.",
                choices: [
                  { value: "off", label: "Menu rating only", what: "Guests leave a 1–5 star rating inside your own menu. Nothing goes to Google." },
                  { value: "google", label: "Google review only", what: "No in-menu stars — the guest is sent straight to your Google review page." },
                  { value: "google_after_normal", label: "Both — Google after the menu one", what: "The guest rates in the menu first, then is invited to post it on Google." },
                ] },
              // The link the Google choices send guests to. It used to live in its own card on
              // the restaurant detail page; it belongs with the choice that uses it, and only
              // one screen may own it.
              { id: "google_review_url", name: "Google review link", def: "", bind: { t: "text", key: "google_review_url" },
                placeholder: "https://g.page/r/…/review",
                what: "Where the Google choices send a guest. Find it in your Google Business profile → Ask for reviews. Leave it empty and the Google invite stays hidden even when picked above." },
            ] },
          { id: "show_reviews", name: "Show reviews", def: true, bind: { t: "feature", key: "reviews" },
            what: "Written reviews, everywhere they appear: on the menu list, on a dish's own page, and in the “what other guests wrote” panel beside the rating box. OFF keeps the stars but shows no written words." },
          { id: "viewer3d", name: "3D dish viewer", def: true, bind: { t: "feature", key: "model3d" },
            what: "The rotating 3D model on dishes that have one. OFF shows “3D preview not available” instead." },
          { id: "allergy_notes", name: "Allergy & notes", def: true, bind: { t: "feature", key: "allergies" },
            what: "Allergen badges on dishes and the allergy/notes step when ordering. The two options underneath control only whether a guest may type FREE TEXT — your preset allergies and preset notes always stay.",
            children: [
              { id: "allergy_other", name: "Guest can add their own allergy", def: true, bind: { t: "feature", key: "allergy_other" },
                what: "The “Other…” box where a guest types an allergy that isn't on your list. OFF removes that box — they may still pick from your presets." },
              { id: "guest_note", name: "Guest can write their own note", def: true, bind: { t: "feature", key: "guest_note" },
                what: "The free-text “anything else?” note a guest sends to the kitchen. OFF removes it — they may still pick from your preset notes." },
            ] },
          {
            // TAKING THE MENU DOWN (owner, 2026-08-01). The capability already exists —
            // settings.service_mode, /api/maintenance, the red control in the panels. What was
            // missing is WHO may use it. Off for every restaurant until it is handed over, and
            // when it is off the control is not on their screen at all (the standing rule: a
            // feature that is off is absent, not greyed).
            // `def` belongs on the NODE, not only inside the bind (fixed 2026-08-02). Every tool
            // that answers "what is this restaurant's factory default?" — the defaults script and
            // the QA suite's per-restaurant default check — reads node.def, so a default hiding
            // in the bind reads as `undefined` and the row is reported as drifted on every
            // restaurant, for ever, with a fix command that cannot fix it. The bind keeps its own
            // def because nodeValue() reads THAT when the row has never been set.
            id: "maintenance", name: "Put menu on maintenance", def: false, bind: { t: "has", id: "maintenance", def: false },
            what: "Lets someone take the guest menu down — a red control in their own Settings that closes the menu to diners. Off for every restaurant unless you hand it over.",
            children: [
              { id: "maintenance_who", name: "Who may do it", def: "owner",
                bind: { t: "opt", id: "maintenance", side: "manager", key: "who" },
                what: "Taking the menu down stops every guest ordering, so it is handed to as few people as possible.",
                choices: [
                  { value: "owner", label: "Owner only", what: "Only the owner sees the control." },
                  { value: "owner_manager", label: "Owner and manager", what: "The manager gets it too — for a kitchen problem the owner isn't there for." },
                ] },
            ],
          },
          { id: "favourites", name: "Favourites", def: true, bind: { t: "feature", key: "favorites" },
            what: "The heart button on a dish and the Favourites tab. This is also what the loyalty feature will be built on later." },
          { id: "veg", name: "Veg / non-veg", def: true, bind: { t: "feature", key: "diet_filter" },
            what: "The veg / non-veg chips AND the little green-or-red veg mark on each dish. Switch it off for a pure-veg restaurant so nothing needs marking." },
          {
            id: "format", name: "Design and styling", bind: { t: "none" },
            what: "How the menu looks when a guest opens it for the first time — its theme, logo and wording — and which languages and currencies it offers.",
            children: [
              { id: "menu_layout", name: "Default layout", def: "grid", bind: { t: "choice", key: "menu_default_layout" },
                what: "What a first-time guest sees before they change anything. They can still switch it themselves.",
                choices: [{ value: "grid", label: "Grid — photo cards" }, { value: "list", label: "List — compact rows" }] },
              { id: "menu_mode", name: "Default light / dark", def: "light", bind: { t: "choice", key: "menu_default_mode" },
                what: "Which colour mode the menu opens in for this restaurant. The guest can still flip it.",
                choices: [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }] },
              // The theme USED to be a read-only row here that linked to the restaurant-detail
              // Branding screen. That screen no longer exists (owner, 2026-08-01: everything
              // lives on Access now), so the editor itself moved in — still the one and only
              // place the palette, logo and wording are owned.
              { id: "menu_theme", name: "Theme and logo", bind: { t: "none" }, panel: "branding",
                what: "The restaurant's own look: background, cards, text and accent for both light and dark, the logo image, the header wording and the greeting under it." },
              { id: "menu_languages", name: "Languages", def: ["en"], bind: { t: "list", key: "menu_languages" }, singleOrMany: true, choices: MENU_LANGUAGES,
                what: "Which languages the menu is offered in. Single means the menu is only ever in that one language and guests get no language button at all; Multiple puts the switcher on the menu so a guest can change it." },
              { id: "menu_currencies", name: "Currencies", def: ["INR"], bind: { t: "list", key: "menu_currencies" }, singleOrMany: true, choices: MENU_CURRENCIES,
                what: "Which currencies prices can be shown in. Single means prices are only ever in that one and guests get no currency button; Multiple puts the switcher on the menu." },
            ],
          },
          {
            // LAST sub-option of Menu (owner, 2026-08-01). It is the only guest-menu look setting
            // that was still nowhere on this screen — it lived on the old manager Settings page.
            // settings.bubbles_enabled, read by lib/menu.ts → bubblesEnabled; absent = ON, which is
            // how every restaurant already behaves, so adding the row changes nothing by itself.
            id: "bubbles", name: "Bubble effect", def: true, bind: { t: "setting", key: "bubbles_enabled" },
            what: "The rising bubble particles drifting up the guest menu's background. OFF gives a flat, calm background instead — some restaurants want the menu to sit still.",
          },
        ],
      },
      { id: "auto_print_kot", name: "Auto-print kitchen tickets", def: false,
        bind: { t: "setting", key: "auto_print_kot_allowed" }, panel: "settings:kitchen", preview: "kot",
        what: "Kitchen tickets print themselves as orders come in, instead of someone tapping print. Needs a printer wired to the kitchen machine. The printer check is inside, and Preview at the top right shows the ticket itself — the very same one the manager panel and the kitchen board print, not a mock-up of it." },
      // ⚡ QO/P — the floor's quick-order screen (owner, 2026-08-02). A main feature, not an
      // extra: it is how a whole order gets punched in at speed. Default ON (mig 257) because
      // it REPLACED the 🥡 New Parcel button every floor already had — shipping it off would
      // take that button away from every restaurant on upgrade.
      { id: "qop", name: "Quick order / Parcel (QO/P)", def: true, fresh: true,
        bind: { t: "setting", key: "qop_allowed" },
        what: "The QO/P button on the live floor: pick a category, tap a dish, and it drops straight back to the categories so a whole order goes in fast — then it asks where the order goes. The two places it can send to are the switches below. OFF here removes the button altogether; the KOT menu beside it stays.",
        children: [
          // The two DESTINATIONS, each its own switch (owner, 2026-08-02). Every combination
          // is spelled out, but in the ⓘ — not in a row of its own.
          //
          // THE "IF BOTH ARE OFF" CARD IS GONE (owner, 2026-08-03: "why here written for nothing
          // is off — it is not even permission or stuff like that, remove that shit, I already
          // know that, no need to tell. You can add that in the i button, but here nothing needs
          // to be there"). It was a `bind:{t:"none"}` row, so it took a whole box on the screen
          // and could not be switched — a paragraph pretending to be a setting. What it said is
          // true and worth keeping, so it moved into the ⓘ of BOTH switches it describes (he
          // named "quick order and parcel"). The rule for this screen: a row exists only where
          // there is something to change.
          { id: "qop_tables", name: "Quick order — send to a table", def: true,
            bind: { t: "setting", key: "qop_tables_allowed" },
            what: "The list of tables on the “where does it go?” step. ON with Parcel: the step shows the Parcel bar on top and every table under it. ON with Parcel off: tables only. OFF with Parcel on: no tables at all — anything built here leaves as a parcel. It cannot give more than the restaurant already has: without “Take a new order” no tables are offered whatever this says. With this AND Parcel both off there is nothing left for QO/P to do, so the button simply isn't on the floor — the header keeps only the KOT menu, nothing is greyed out and nothing errors." },
          { id: "qop_parcel", name: "Parcel — send it out", def: true,
            bind: { t: "setting", key: "qop_parcel_allowed" },
            what: "The big Parcel bar on the “where does it go?” step. ON with tables: both are offered. ON with tables off: parcel is the only destination. OFF: no Parcel bar, and QO/P sends to tables only. This switch is only about which destinations the QO/P screen offers — the Parcel feature itself is permanent and has no switch to turn off. With this AND “Quick order — send to a table” both off there is nothing left for QO/P to do, so the button simply isn't on the floor — the header keeps only the KOT menu, nothing is greyed out and nothing errors." },
        ] },
      // 🥡 PARCEL — its own MAIN feature again (owner, 2026-08-02: "takeaway his whole
      // separate thing, parcel his whole separate thing"). It sat inside "Platforms" from mig
      // 235 to 259, which meant a restaurant with no Zomato/Swiggy account — Platforms off,
      // quite correctly — silently lost the counter-parcel button, and only found out when
      // the finished order was refused. Main, not Extra: handing a parcel over the counter is
      // everyday running, not an add-on. Default ON for the same reason QO/P is (mig 259).
      { id: "parcel", name: "Parcel — counter takeaway", def: true, fresh: true,
        bind: { t: "module", key: "parcel" },
        what: "A parcel your own staff punch in at the counter: no table, nothing to connect, no outside account. It is the Parcel choice on ⚡ QO/P, ☰ → New parcel on the waiter tablet, the Parcel tiles that sit under the live floor until one is printed and paid, its own parcel bill, and the parcel half of the 🛵 board. This is NOT Zomato / Swiggy / the restaurant's own website — those arrive from outside and are “Platforms” in Extra features, a completely separate switch. OFF removes every parcel surface above; the delivery side is untouched." },
      {
        id: "bill", name: "Bill", bind: { t: "none" },
        what: "Everything that prints on a bill. There is no on/off — a restaurant can always issue one.",
        children: [
          // ONE form, not four boxes (owner, 2026-08-01: "here unnecessary sub-options are made,
          // it could be merged… and it should be as format of bill"). GSTIN, the legal name and
          // the address were three separate rows sitting on top of a fourth box holding the rest
          // of the very same document. They are all the bill's format, so they are one screen —
          // the same shape as Menu → Design and styling.
          // TWO formats, not one (owner, 2026-08-02): a dine-in bill and a parcel bill are
          // different pieces of paper — different width, different lines, and a parcel has no
          // table. The dine-in one is renamed so the pair reads as a pair.
          // THE PREVIEW IS THE PRINTER'S OWN PAGE (owner, 2026-08-02: "whatever the manager
          // panel prints, the preview should only be that — both should be sync"). It used to be
          // a look-alike drawn by separate code, which meant a format could be approved here and
          // come out of the printer differently. Both now render /panels/billdoc.js, the one file
          // the manager panel prints from.
          { id: "bill_format", name: "Format of KOT bills", bind: { t: "none" }, panel: "settings:billing", preview: "bill",
            what: "The bill for a table: GSTIN, the legal name and address, the phone, the invoice number's prefix, the tax rows that make up the total, the footer line, and whether a customer's name is asked for. Preview at the top right is the real page — exactly what the manager panel hands the printer." },
          { id: "parcel_bill_format", name: "Format of parcel bill", bind: { t: "none" }, panel: "settings:billing", preview: "parcel",
            what: "The bill handed over with a parcel. Same restaurant details as the table bill and no table on it — it says PARCEL instead. Preview at the top right is the real page the counter prints." },
          { id: "bill_designer", name: "Bill design editor", leftToBuild: true, bind: { t: "none" },
            what: "Design the whole bill like a document — move the logo, change the wording, resize the totals. Not built yet; this is where it will live." },
        ],
      },
      {
        // Moved off the restaurant-detail page with the rest of it (owner, 2026-08-01). It has no
        // on/off — a restaurant always has tables — so it is a pure group, like Bill.
        id: "tables", name: "Table", bind: { t: "none" },
        what: "How many tables this restaurant has, what each one is called, how many seats it has, its QR code, and how the floor is laid out on screen.",
        children: [
          // REAL sub-options, not one merged blob (owner, 2026-08-01: "all are sub options — QR
          // and link is a whole new sub option, only expandable, it should have dropdown").
          // Each opens just the part of the tables screen it owns.
          { id: "tables_list", name: "Table name & seats", bind: { t: "none" }, panel: "settings:tables",
            what: "How many tables the restaurant has, each table's name — optional, e.g. the last one as “Banquet” — and how many people can sit there." },
          { id: "tables_layout", name: "Number of tables per row", bind: { t: "none" }, panel: "settings:floor",
            // ADMIN-ONLY WITH NO SWITCH (owner, 2026-08-02): the manager panel's own copy of this
            // field was removed and nothing was put in its place — there is no permission that can
            // hand it back ("you cannot on it and off it"), which is why this row has no toggle.
            what: "How many table boxes sit on one line in the manager's floor view, and so how big each box ends up. Only you set it — the manager panel has no such field and no switch can give it one. Nothing else here: how many tables there are is set in Table name & seats." },
          { id: "tables_qr", name: "Guest QR link per table", bind: { t: "none" }, panel: "settings:qr",
            what: "The permanent QR code and link for every table — the ones printed and put on the tables. Print one, or the whole sheet." },
        ],
      },
    ],
  },

  // ───────────────────────── A2 · EXTRA FEATURES ────────────────────────────
  // Split out of Main features (owner, 2026-08-01: "so that main features doesn't look too full
  // and looks organised"). The line is what a restaurant runs on EVERY day versus what it takes
  // on as well: the menu, pay-later, kitchen tickets, the bill and the tables are the first;
  // delivery apps, events, stock and payroll are the second. Nothing about how any of them work
  // changed — each row keeps the same storage, the same defaults and the same dropdown.
  {
    id: "extra", name: "Extra features", icon: "grid",
    blurb: "The bigger modules a restaurant takes on as well as its day-to-day running. All off by default — switch one on and its screens appear.",
    children: [
      { id: "khata", name: "Pay later (khata)", def: false, bind: { t: "module", key: "khata" },
        what: "Parking a bill on a named regular to collect later, and the book that tracks who owes what. OFF removes the khata screens from the manager AND owner panels entirely." },
      {
        // "Platforms" (owner, 2026-07-31). The stored key stays `takeaway`: that is the mig-235
        // column name, and renaming a LABEL must never rename a column.
        // It covers the DELIVERY side ONLY. The counter parcel is its own Main feature again
        // (mig 259) — see the box at the top of lib/tableTags.ts. Do not fold them back
        // together: switching this off must never take the counter parcel away.
        id: "takeaway", name: "Platforms (Zomato, Swiggy, own website)", def: false, bind: { t: "module", key: "takeaway" },
                what: "Orders that arrive from OUTSIDE the restaurant: the delivery apps and the restaurant's own website. Each one is switched on separately below and needs that company's key. OFF removes the delivery side of the 🛵 board. It does NOT touch parcels punched in at the counter — that is “Parcel — counter takeaway” in Main features, its own switch, and it keeps its tiles and its half of the board either way.",
        children: [
          { id: "ch_website", name: "Own website", def: true, bind: { t: "channel", key: "website" },
            what: "Orders coming in from the restaurant's own website. This is not the counter parcel — a parcel staff punch in themselves needs nothing here and is switched on in Main features.",
            children: [
              { id: "ch_website_key", name: "Website connection key", bind: { t: "creds", key: "website" }, placeholder: "Paste the website key",
                what: "Only needed if the restaurant's own website sends orders in by itself. A counter takeaway punched in by staff needs nothing here." },
            ] },
          { id: "ch_zomato", name: "Zomato", def: false, bind: { t: "channel", key: "zomato" },
            what: "Zomato orders land on the Platform board. Needs Zomato's API key — until it is entered the channel shows as “not connected”.",
            children: [
              { id: "ch_zomato_key", name: "Zomato API key", bind: { t: "creds", key: "zomato" }, placeholder: "Paste the Zomato API key",
                what: "From the restaurant's own Zomato partner account. Once saved it is never shown again — only the last four characters, so you can tell which key is in place without the key being readable off the screen." },
            ] },
          { id: "ch_swiggy", name: "Swiggy", def: false, bind: { t: "channel", key: "swiggy" },
            what: "Swiggy orders land on the Platform board. Needs Swiggy's API key — until it is entered the channel shows as “not connected”.",
            children: [
              { id: "ch_swiggy_key", name: "Swiggy API key", bind: { t: "creds", key: "swiggy" }, placeholder: "Paste the Swiggy API key",
                what: "From the restaurant's own Swiggy partner account. Once saved it is never shown again — only the last four characters, so you can tell which key is in place without the key being readable off the screen." },
            ] },
        ],
      },
      { id: "banquet", name: "Banquet billing", def: false, bind: { t: "module", key: "banquet" },
                what: "Per-plate event billing that runs without a table — a wedding, a party booking. OFF removes the Banquet tab.",
        children: [
          { id: "banquet_setup", name: "What the banquet bill asks for and how it prints", bind: { t: "none" }, panel: "settings:banquet",
            what: "Which fields staff fill in for an event, the banquet bill's own number series, its tax rows, and the paper layout it prints on." },
        ] },
      {
        // Named to match the Main-features card exactly — the two admin screens write the same
        // settings columns, so they must not call the module two different things.
        id: "payroll", name: "Staff profiles & pay", def: false, bind: { t: "module", key: "payroll" },
        what: "Each person's profile (details, job, documents), a record of salary and advances paid, and the team performance report. Pay counts as an expense wherever money is shown: a “Staff pay out” line in the day book and “Staff pay out” + “After staff pay” on the owner dashboard. OFF removes all of it — pages, report and expense lines — from the owner, manager and waiter panels.",
      },
      {
        id: "inventory", name: "Inventory", def: false, bind: { t: "module", key: "inventory" },
        what: "Ingredients, purchases, stock counting, waste and the expense book.",
        children: [
          { id: "inventory_in_reports", name: "Show cost in the main reports", leftToBuild: true, bind: { t: "none" },
            what: "Adds stock and expense cost as a line inside the normal sales reports, so profit is shown after cost. OFF keeps it on the inventory pages only." },
        ],
      },
    ],
  },

  // ──────────────────────────── A2 · STAFF APPS ─────────────────────────────
  // REMOVED (owner, 2026-07-31: "remove it completely, all panels always on"). Every restaurant
  // now has all four staff apps; there is no per-restaurant switch and no screen that offers one.
  // The gate in lib/panelAccess.ts answers ON for all four regardless of what is stored, so no
  // restaurant can be left with a login refused by a switch nobody can reach any more.
  // Whether the MENU editor exists is decided by the Menu feature in Main features, not here.

  // ────────────────────────── B · MANAGER'S MENU ────────────────────────────
  //
  // ONE ROW PER MENU, and the defaults for that menu live INSIDE it (owner, 2026-08-01:
  // "Manager's menu — it will give access to the manager for that particular menu; if the access
  // is not given the manager will not have that menu… and inside, the default set for user, that
  // option will be removed if the access is not even given").
  //
  // Two things follow, and both are the point:
  //   1. The row's switch is the MENU. It moves the panel's tab list AND the manager power in one
  //      go (bind "menu"), because two switches for one menu is how a screen ends up disagreeing
  //      with itself. Off = no tab, and the endpoints behind it refuse.
  //   2. Its defaults are its CHILDREN, so switching the menu off removes them from the page
  //      rather than leaving settings on screen for a menu that isn't there.
  // What a manager may do that ISN'T a menu (the money and floor actions) is one list underneath.
  {
    id: "mgrMenu", name: "Manager", icon: "users",
    blurb: "The manager's panel: which menus they get, what they may do to money, and what they can manage in their own Settings.",
    // ⚠️ THE OWNER'S STRUCTURE FOR THIS SECTION (owner, 2026-08-02 — he asked for his words to
    // live here so no session ever rearranges it differently): "In the manager, there will be
    // three suboption: manager's menu, permission for manager, manager settings."
    //   1. MANAGER'S MENU — exactly FOUR options: Edit menu (Editor), Rating review, Audit,
    //      Dashboard. The other panel tabs — Tables, Platform, Bills, Settings — are FIXED
    //      ("four will be the fixed one"): every manager always has them, so they have NO row
    //      here at all (the model's rule: no row = permanently on). Their old switches are
    //      retired — see MANAGER_TAB_KEYS below.
    //   2. PERMISSION FOR MANAGER — Delete a bill, Reopen a bill (with its minutes window,
    //      default 5 min), Discount a bill (with its percentage cap, default 50%).
    //   3. MANAGER SETTINGS ("what manager can do") — only the sections a real manager can
    //      genuinely use: table name & seats, Users (create / reset / disable — never delete),
    //      and who serves which table. The billing / kitchen / sessions rows were removed:
    //      those sections are admin-only in the panel, so their switches governed nothing a
    //      manager could see ("many options which are not even useful").
    children: [
      {
        // 1 · MANAGER'S MENU (owner, 2026-08-02): "In the manager menu, there will be four
        // option: edit menu, rating review, audit and dashboard."
        //
        // Every row here follows the two-control pattern he chose (FEATURE switch + DEFAULT
        // chip) wherever a restaurant-level tab exists:
        //   • FEATURE  (access_config.menus.manager[key]) — does this restaurant's manager
        //     panel have the menu at all. OFF removes it from EVERY manager, whatever their
        //     per-person setting says: the tab is gone and tabGate refuses its endpoints.
        //   • DEFAULT  (manager_permissions[flag]) — what a manager whose per-person row says
        //     "Default" follows. "If a new manager is created for the particular restaurant,
        //     he will get the default" — true by construction, because every new person is
        //     created with permissions: {} (app/api/admin/users), which means Default on
        //     every row.
        id: "mgr_menu_group", name: "Manager's menu", bind: { t: "none" },
        what: "The four menus an admin decides about: Edit menu, Rating review, Audit and Dashboard. Tables, Platform, Bills and Settings are fixed — every manager always has them, so they are not listed. Each Feature switch removes its menu from all managers; each Default is what a new manager starts with.",
        children: [
        {
          // "There will be a edit menu, which is in bracket name as editor. It will have sub
          // menus, and whatever is set in sub menus will be the default one… and if edit menu
          // is on, then only they will get the permission" (owner, 2026-08-02).
          id: "mgr_tab_editor", name: "Edit menu (Editor)", def: true, fresh: true,
          featureBind: { t: "tab", panel: "manager", key: "editor" },
          bind: { t: "grant", flag: "edit_menu" },
          what: "The Editor tab — dishes, categories and filters. The Feature switch removes it from every manager of this restaurant; Default is what a manager starts on. The parts below say which bits of it a manager may change.",
          children: EDIT_MENU_PARTS.map((p) => ({
            id: `d_mgr_${p.id}`, name: p.name, what: p.what, def: p.def,
            bind: { t: "opt", id: "edit_menu", side: "manager", key: p.id } as Bind,
          })),
        },
        {
          // RENAMED from "Ratings" (owner, 2026-08-02: "it will be name as the rating review").
          // The LABEL changed, nothing else — the stored key stays "ratings" and the grant stays
          // view_ratings; renaming a label must never rename a key.
          id: "mgr_tab_ratings", name: "Rating review", def: true, fresh: true,
          featureBind: { t: "tab", panel: "manager", key: "ratings" },
          bind: { t: "grant", flag: "view_ratings" },
          what: "The tab where the manager reads what guests said about the food and marks a complaint handled. The Feature switch removes it from every manager; Default is what a manager starts on.",
        },
        {
          // RENAMED from "Audit" (owner, 2026-08-02: "name will be changed from audit to audit
          // and logs") and given the sub-options he asked for the same day ("inside the audit,
          // there are many options which will be created… sub option like for the logs and
          // audit — which can be visible and which can't"). The stored key stays "log" and the
          // grant stays view_logs — renaming a LABEL must never rename a key.
          id: "mgr_tab_log", name: "Audit & logs", def: true, fresh: true,
          featureBind: { t: "tab", panel: "manager", key: "log" },
          bind: { t: "grant", flag: "view_logs" },
          what: "The Audit & logs tab — what was removed and why, the activity log, and the customer log. Admin-only actions never appear there. The Feature switch removes it from every manager; Default is what a manager starts on. The parts below say which of its views a manager gets.",
          children: LOG_PARTS.map((p) => ({
            id: `d_mgr_log_${p.id}`, name: p.name, what: p.what, def: true,
            bind: { t: "opt", id: "view_logs", side: "manager", key: p.id } as Bind,
          })),
        },
        {
          // FOURTH menu. Its reach is a setting, not a separate permission: a real manager's
          // dashboard is clamped to TODAY by the server, and this is what widens it. (No
          // restaurant-level tab exists for the dashboard, so no Feature half here — its one
          // switch IS the manager default.)
          id: "mgr_tab_dash", name: "Dashboard", def: true, bind: { t: "grant", flag: "view_dashboard" },
          what: "The numbers screen and the day's report.",
          children: [
            { id: "mgr_dash_range", name: "How far back it reaches", def: "today", bind: { t: "opt", id: "view_dashboard", side: "manager", key: "range" },
              what: "Every restaurant starts on TODAY — a manager who can see yesterday can work out what a shift took, so it is handed over deliberately.",
              choices: [
                { value: "today", label: "Today only", what: "The shift they are standing in. Nothing before this morning." },
                { value: "today_yesterday", label: "Today + yesterday", what: "Lets them compare against the day before." },
              ] },
          ],
        },
        ],
      },
      {
        // 2 · PERMISSION FOR MANAGER (owner, 2026-08-02): "there will be delete bill, reopen
        // bill, and discount bill" — the three money actions, with their limits INSIDE them
        // ("there will be a drop down for reopen bill how much minute… the discount one also,
        // there will be the percentage"). His defaults for every restaurant: reopen within
        // 5 minutes, discount up to 50% — set as the model defaults (defOf), so a restaurant
        // that never stored a value reads exactly that.
        id: "mgr_may", name: "Permission for manager", bind: { t: "none" },
        what: "The money actions, for every manager in this restaurant: delete a bill, reopen a bill (and for how long), discount a bill (and up to how much). One person can still be given more or less on the Per-person tab — this is the starting point they all inherit.",
        children: [...ACTIONS.map(mgrAction)],
      },
      {
        // 3 · MANAGER SETTINGS (owner, 2026-08-02: "manager setting and in the bracket written,
        // what manager can do"). Each row = one section of the manager panel's Settings screen.
        // Off ⇒ the section is not in their sidebar, and the endpoints behind it refuse. The
        // same list also feeds the staff PROFILE screen, so one person's exceptions and the
        // restaurant's default can never offer different sections.
        //
        // Only the three sections a real manager can genuinely use are listed — see
        // MANAGER_SETTINGS for why billing / kitchen / sessions left (they are admin-only in
        // the panel; a switch over an invisible thing is a dead switch).
        id: "mgr_manage", name: "Manager settings (what manager can do)", bind: { t: "none" },
        what: "Which sections a manager gets inside their own Settings screen. Switch one off and it is gone from their sidebar — and its endpoints refuse, so it is not reachable by typing a URL either.",
        children: MANAGER_SETTINGS.map((x) => ({
          id: `mgrset_${x.key}`, name: x.name, what: x.what, def: true, fresh: true,
          bind: { t: "tab", panel: "mgrset", key: x.key } as Bind,
        })),
      },
    ],
  },

  // ─────────────────────────── C · OWNER ─────────────────────────────────────
  // Restructured 2026-08-02 (owner: "instead of owner's menu, there will be just written
  // Owner; inside that, owner's menu; inside that, five options"). The section is the
  // person; their MENU is the first group inside it — more owner settings join later.
  {
    id: "ownMenu", name: "Owner", icon: "crown",
    blurb: "Everything about this restaurant's owner. Their menu lives here; more owner settings will join it later.",
    children: [
      {
        id: "own_menu_group", name: "Owner's menu", bind: { t: "none" },
        what: "Which pages exist in this restaurant's owner panel.",
        children: [
          // ACCESS (owner, 2026-08-02): his word for the Staff & powers page — where the
          // owner creates staff logins and decides what each person may do. The "staff"
          // section key existed and was ENFORCED (nav + /api/owner/staff both read it)
          // but had no switch anywhere — the exact stored-but-unswitchable shape the
          // access rebuild removes. Now it has its one switch, here.
          { id: "own_access", name: "Access", def: true, bind: { t: "section", key: "staff" },
            what: "The owner's Staff & powers page — create staff logins and set what each person may do." },
          { id: "own_menu", name: "Edit menu", def: true, bind: { t: "section", key: "menu" },
            what: "The owner's own Menu page — the same dishes/categories editor, in the owner panel." },
          // Renamed from "Ratings" (owner, 2026-08-02: "rating review").
          { id: "own_ratings", name: "Rating review", def: true, bind: { t: "section", key: "ratings" },
            what: "The owner's Rating review page — guest stars and written feedback." },
          {
            // AUDIT & LOGS (owner, 2026-08-01; renamed + given sub-options 2026-08-02: "name will
            // be changed from audit to audit and logs… and if there is a log separately, you have
            // to remove it"). The old duplicate "Activity log" child bound the SAME
            // owner_entitlements.logs switch twice, so it is gone. TWO KINDS of children now,
            // merged from the two 2026-08-02 asks:
            //   • WHICH VIEWS the owner's page shows (LOG_PARTS → view_logs.owner_opts)
            //   • WHICH ROW KINDS the Activity view lists (logs_* section keys, read by
            //     /api/owner/oplog). Visibility only — nothing stops being RECORDED; the
            //     money/bill audit trail is never switchable (docs/COMPLIANCE-GUARDRAILS.md).
            // The stored section key stays "logs" — renaming a LABEL must never rename a key.
            id: "own_audit", name: "Audit & logs", def: true, fresh: true, bind: { t: "section", key: "logs" },
            what: "The owner's Audit & logs page — what was removed and why, plus the full activity log. The parts below say which of its views, and which kinds of activity rows, this restaurant's owners get.",
            children: [
              ...LOG_PARTS.filter((p) => !p.mgrOnly).map((p) => ({
                id: `d_own_log_${p.id}`, name: p.name, what: p.what, def: true,
                bind: { t: "opt", id: "view_logs", side: "owner", key: p.id } as Bind,
              })),
              { id: "own_logs_signins", name: "Sign-ins", def: true, fresh: true, bind: { t: "section", key: "logs_signins" },
                what: "Who signed in to the panels, and failed tries. Off = these rows leave the owner's Activity view (still recorded underneath)." },
              { id: "own_logs_service", name: "Service actions", def: true, fresh: true, bind: { t: "section", key: "logs_service" },
                what: "Everything staff did during service — orders, tables, bills, parcels. Off = hidden from the owner's Activity view (still recorded underneath)." },
              { id: "own_logs_staff_changes", name: "Staff changes", def: true, fresh: true, bind: { t: "section", key: "logs_staff_changes" },
                what: "Staff switched on or off and permission changes. Off = hidden from the owner's Activity view (still recorded underneath)." },
            ],
          },
          // BUILT 2026-08-02: the switch is live. It gates the owner panel's Manager mode page
          // (the full live manager panel embedded in the owner cockpit — floor, bills, ordering).
          { id: "own_manager_mode", name: "Manager mode", def: true, bind: { t: "section", key: "manager_mode" },
            what: "Lets the owner drop into their own manager panel and work the floor as a manager would — live tables, bills, taking orders. Settings, Rating review, Audit & logs and the Menu editor stay in their own owner pages." },
        ],
      },
    ],
  },

  // ──────────────────── D · DEFAULT SET FOR USER ────────────────────────────
  {
    // The MANAGER folder moved into Manager's menu (owner, 2026-08-01) so a menu and its defaults
    // are one thing. The owner and the waiter keep their lists here for now — his call: "only the
    // manager for now".
    // ─────────────────────────────── E · WAITER ───────────────────────────────
    // "DEFAULT SET FOR USER" WAS DELETED (owner, 2026-08-02: "we don't even need a default set
    // for user because we have merged all that inside — so delete that at the very bottom").
    // Its manager folder had already moved into Manager (2026-08-01/02) and its owner folder
    // was pure duplicates of Owner's menu, so those simply went. The WAITER rows were the one
    // thing living only there — they become their own role section, same shape as Manager, so
    // every role reads the same way and nothing loses its screen.
    id: "waiter", name: "Waiter", icon: "user",
    blurb: "What every waiter starts with on the tablet. Money actions offer a third choice — “On, but ask a manager PIN” — so a waiter can act with a manager standing there without holding the power all shift. One person can still be given more or less on the Per-person tab.",
    children: ACTIONS.map(waiterAction).filter(Boolean) as Node[],
  },
];

// ── flat helpers ────────────────────────────────────────────────────────────
export const SECTION_BY_ID = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));

export function walk(nodes: Node[], fn: (n: Node, depth: number, parent?: Node) => void, depth = 0, parent?: Node) {
  for (const n of nodes) { fn(n, depth, parent); if (n.children) walk(n.children, fn, depth + 1, n); }
}
export const ALL_NODES: Node[] = (() => {
  const out: Node[] = [];
  for (const s of SECTIONS) walk(s.children, (n) => out.push(n));
  return out;
})();
export const NODE_BY_ID: Record<string, Node> = Object.fromEntries(ALL_NODES.map((n) => [n.id, n]));

// Every storage key this model may write, per kind — the read/write route builds its
// select list and its allow-list from THESE, so a node added above wires itself.
const collect = <T,>(pick: (b: Bind) => T | null): T[] =>
  Array.from(new Set(ALL_NODES.map((n) => pick(n.bind)).filter((v): v is T => v !== null && v !== undefined) as T[]));

export const FEATURE_KEYS = collect((b) => (b.t === "feature" ? b.key : null));
export const SETTING_KEYS = collect((b) => (b.t === "setting" ? b.key : null));
export const CHOICE_KEYS = collect((b) => (b.t === "choice" ? b.key : null));
export const LIST_KEYS = collect((b) => (b.t === "list" ? b.key : null));
export const TEXT_KEYS = collect((b) => (b.t === "text" ? b.key : null));
export const MODULE_KEYS = collect((b) => (b.t === "module" ? b.key : null));
export const PANEL_KEYS = collect((b) => (b.t === "panel" ? b.key : null));
export const CHANNEL_KEYS = collect((b) => (b.t === "channel" ? b.key : null));
export const CREDS_KEYS = collect((b) => (b.t === "creds" ? b.key : null));
// A "menu" row writes a grant too, so it MUST be in this list — the read/write route builds its
// allow-list from here, and a flag missing from it is silently dropped on save (the switch would
// move on screen and change nothing).
// BOTH places a "has" bind can live, not just featureBind (fixed 2026-08-02). A row can carry
// its has-bind as its MAIN bind — "Put menu on maintenance" does — and that id was missing from
// this list, so the write route dropped `config.maintenance.on` on the floor: the switch moved on
// screen, saved nothing, and read back off for every restaurant, forever. That is precisely the
// dead switch the access rebuild existed to abolish, hiding inside the list that is supposed to
// prevent it. Derive from every node, whichever slot the bind sits in.
export const HAS_IDS = Array.from(new Set(ALL_NODES.flatMap((n) =>
  [n.featureBind?.t === "has" ? n.featureBind.id : null, n.bind?.t === "has" ? n.bind.id : null],
).filter(Boolean) as string[]));
export const GRANT_FLAGS = collect((b) => (b.t === "grant" ? b.flag : b.t === "menu" ? b.grant : null));
export const SECTION_ENTITLEMENTS = collect((b) => (b.t === "section" ? b.key : null));
export const TABLET_COLS = collect((b) => (b.t === "tablet" ? b.key : null));
// Same for the tab half of a "menu" row — and for a tab carried as a row's featureBind:
// "Edit menu" is grant-bound with its tab as the FEATURE switch (owner two-control row,
// 2026-08-02). Collecting only n.bind would drop that tab from the route's allow-list,
// and the Feature switch would move on screen and save nothing.
export const TAB_KEYS: { panel: string; key: string }[] = ALL_NODES
  .flatMap((n) => (n.featureBind ? [n.bind, n.featureBind] : [n.bind]))
  .filter((b): b is Extract<Bind, { t: "tab" } | { t: "menu" }> => b.t === "tab" || b.t === "menu")
  .map((b) => ({ panel: b.panel, key: b.key }));

// Every settings COLUMN the route selects/writes (features + enabled_panels handled apart).
export const SETTINGS_COLUMNS: string[] = Array.from(new Set([
  ...SETTING_KEYS, ...CHOICE_KEYS, ...LIST_KEYS, ...TEXT_KEYS, ...TABLET_COLS,
  ...MODULE_KEYS.flatMap((m) => [`${m}_allowed`, `${m}_enabled`]),
  ...(CHANNEL_KEYS.length ? ["platform_channels"] : []),
]));

// The default value a node falls back to when nothing is stored.
export const defOf = (n: Node): boolean | string | string[] | number =>
  n.def !== undefined ? n.def : (n.bind.t === "tablet" || n.bind.t === "capTablet" ? "off" : false);

// ── the live server state, and the ONE pair of functions that reads/writes it ──
// Both the admin page and /api/admin/restaurants/access-tree import these, so the
// screen and the database can never disagree about where a switch lives.
export type TreeState = {
  features: Record<string, boolean>;          // settings.features
  settings: Record<string, unknown>;          // plain settings columns (+ tablet_*, module cols)
  panels: Record<string, boolean>;            // settings.enabled_panels
  channels: Record<string, boolean>;          // settings.platform_channels[k].on
  grants: Record<string, boolean>;            // restaurants.manager_permissions
  sections: Record<string, boolean>;          // restaurants.owner_entitlements
  tabs: Record<string, Record<string, boolean>>; // access_config.menus[panel][key]
  config: Record<string, any>;                // restaurants.access_config
  // MASKED hints only — "" when no key is stored, else "••••1234". Never the key itself: the
  // server builds this and the real value has no path back to the browser.
  creds: Record<string, string>;
};

export const emptyState = (): TreeState => ({
  features: {}, settings: {}, panels: {}, channels: {}, grants: {}, sections: {}, tabs: {}, config: {}, creds: {},
});

export type TreePatch = Partial<{
  features: Record<string, boolean>;
  settings: Record<string, unknown>;
  panels: Record<string, boolean>;
  channels: Record<string, boolean>;
  grants: Record<string, boolean>;
  sections: Record<string, boolean>;
  tabs: Record<string, Record<string, boolean>>;
  config: Record<string, any>;
  // The REAL key on the way IN. "" means "leave whatever is stored alone" (so saving the form
  // without retyping a key can't silently disconnect a channel); null means "remove it".
  creds: Record<string, string | null>;
}>;

const present = <T,>(v: T | undefined | null, def: T): T => (v === undefined || v === null ? def : v);

/** What a node currently reads as. Never throws on a half-loaded state. */
export function nodeValue(n: Node, s: TreeState): any {
  const b = n.bind, d = defOf(n);
  switch (b.t) {
    case "feature":  return present(s.features?.[b.key] as boolean, d as boolean);
    case "setting":  return present(s.settings?.[b.key] as boolean, d as boolean) === true;
    case "module":   return present(s.settings?.[`${b.key}_allowed`] as boolean, d as boolean) === true;
    case "panel":    return present(s.panels?.[b.key], d as boolean);
    case "channel":  return present(s.channels?.[b.key], d as boolean);
    case "grant":    return present(s.grants?.[b.flag], d as boolean);
    case "section":  return present(s.sections?.[b.key], d as boolean);
    case "tab":      return present(s.tabs?.[b.panel]?.[b.key], d as boolean);
    // Both halves have to be on. They can disagree only on a restaurant configured before the two
    // were joined; showing OFF there is the honest answer, because the manager IS being refused.
    case "menu":
      return present(s.tabs?.[b.panel]?.[b.key], d as boolean) === true
        && managerGrantValue(b.grant, s.grants?.[b.grant]) === true;
    case "tablet":   return present(s.settings?.[b.key] as string, d as string) || "off";
    case "capTablet":return present(s.config?.[b.id]?.tablet as string, d as string) || "off";
    case "choice":   return present(s.settings?.[b.key] as string, d as string);
    case "text":     return present(s.settings?.[b.key] as string, (d as string) || "");
    // The masked hint the server sent, never a key. "" reads as "nothing stored yet".
    case "creds":    return present(s.creds?.[b.key] as string, "");
    case "list": {
      const v = s.settings?.[b.key];
      return Array.isArray(v) && v.length ? (v as string[]) : ((d as string[]) || []);
    }
    case "opt":      return present(s.config?.[b.id]?.[`${b.side}_opts`]?.[b.key], d);
    case "limit":    return present(s.config?.[b.id]?.limit?.[b.side], d as number);
    // ON unless BOTH halves are off. "Google review only" deliberately stores features.ratings
    // = false (no in-menu stars) while the rating area very much still exists, so reading the
    // features flag alone would show this master as OFF on a restaurant that asks every guest
    // for a Google review. Off is the one combination that shows a guest nothing.
    // Absent means ON for the money/floor rows (nothing changes until it is switched off), but a
    // row can say otherwise — "Put menu on maintenance" ships OFF for every restaurant.
    case "has":      return present(s.config?.[b.id]?.on as boolean, b.def !== false) !== false;
    case "ratingsMaster": {
      const stars = s.features?.ratings;
      const mode = present(s.settings?.google_review_mode as string, "off");
      return (stars === undefined ? true : stars === true) || mode === "google";
    }
    default:         return null;
  }
}

/** The patch that sets this node to `v`. Shaped exactly like TreeState, so the client
 *  can merge it locally for an instant repaint and POST the identical object. */
export function nodePatch(n: Node, v: any): TreePatch {
  const b = n.bind;
  switch (b.t) {
    case "feature":  return { features: { [b.key]: v === true } };
    case "setting":  return { settings: { [b.key]: v === true } };
    // A module's on/off is the _allowed column. _enabled is forced TRUE and stays there:
    // it only ever existed for the old "hand the toggle to the owner" rung, and owners no
    // longer control any feature — leaving it false would silently keep the module off.
    case "module":   return { settings: { [`${b.key}_allowed`]: v === true, [`${b.key}_enabled`]: true } };
    case "panel":    return { panels: { [b.key]: v === true } };
    case "channel":  return { channels: { [b.key]: v === true } };
    case "grant":    return { grants: { [b.flag]: v === true } };
    case "section":  return { sections: { [b.key]: v === true } };
    case "tab":      return { tabs: { [b.panel]: { [b.key]: v === true } } };
    case "menu":     return { tabs: { [b.panel]: { [b.key]: v === true } }, grants: { [b.grant]: v === true } };
    case "tablet":   return { settings: { [b.key]: String(v) } };
    case "capTablet":return { config: { [b.id]: { tablet: String(v) } } };
    case "choice":   return { settings: { [b.key]: String(v) } };
    case "text":     return { settings: { [b.key]: String(v ?? "") } };
    case "creds":    return { creds: { [b.key]: String(v ?? "") } };
    case "list":     return { settings: { [b.key]: (Array.isArray(v) ? v : []).map(String) } };
    case "opt":      return { config: { [b.id]: { [`${b.side}_opts`]: { [b.key]: v } } } };
    case "limit":    return { config: { [b.id]: { limit: { [b.side]: Number(v) } } } };
    // Both halves move together. Switching it back ON lands on "Menu rating only" — the plain
    // default — rather than restoring whatever Google mode was set months ago, so turning a
    // feature on can never quietly start sending guests to a third-party page.
    case "has":      return { config: { [b.id]: { on: v === true } } };
    case "ratingsMaster":
      return v === true
        ? { features: { ratings: true }, settings: { google_review_mode: "off" } }
        : { features: { ratings: false }, settings: { google_review_mode: "off" } };
    default:         return {};
  }
}

/** The Ratings choice also has to move settings.features.ratings, because the guest app's
 *  star UI reads that key in a dozen places. "Google review only" = no in-menu stars.
 *  Written from the ONE control that owns the choice, so the two can't drift. */
export function extraPatch(n: Node, v: any): TreePatch {
  if (n.id !== "ratings_mode") return {};
  return { features: { ratings: v !== "google" } };
}

// ── the MANAGER'S MENU rung (new in this rebuild) ───────────────────────────
// Which tabs exist in a restaurant's manager panel, read from
// restaurants.access_config.menus.manager. ABSENT MEANS ON, so no restaurant changes
// until the admin switches a tab off. Used by the editor API's whoami (to tell the panel
// what to hide) AND by its route guards (so a hidden tab's endpoints refuse too) — one
// helper, so the screen and the server can never disagree.
// ── WHAT A MISSING MANAGER PERMISSION MEANS — one answer, used by the screen AND the server ──
//
// THE BUG THIS EXISTS TO KILL (found 2026-08-01). managerCan() read an absent
// manager_permissions key as NO, while this screen showed the row's `def` — usually YES. So on
// every restaurant that was never hand-fixed, and on EVERY newly created one, the admin read
// "Mark a table's type: ON" and a real manager was refused. Worse: the rebuild dropped ~14 powers
// off the screen entirely (khata, banquet, parcel, platform, table_assign, the two inventory
// ones). The model says an unlisted capability is PERMANENTLY ON for whoever's panel owns it —
// the code said permanently OFF, and no screen could grant them. Switching "Pay later" on in Main
// features left the manager staring at "your owner hasn't given managers permission".
//
// So there is now exactly one rule, and both sides read it here:
//   · a flag WITH a row on this screen  → that row's default
//   · a flag with NO row (retired)      → ON, because its module toggle is the switch now
// A value that IS stored always wins for a flag that has a row; a retired flag ignores whatever
// an old screen left behind, since nothing can ever change it again.
export const MANAGER_GRANT_DEFAULTS: Record<string, boolean> = (() => {
  const out: Record<string, boolean> = {};
  for (const n of ALL_NODES) {
    if (n.bind.t === "grant") out[n.bind.flag] = defOf(n) === true;
    // A "menu" row owns a power too — miss these and edit_menu / view_ratings / view_logs would
    // look RETIRED (= always on), which would quietly ignore an admin switching a menu off.
    if (n.bind.t === "menu") out[n.bind.grant] = defOf(n) === true;
  }
  return out;
})();

export const isConfigurableGrant = (flag: string) => flag in MANAGER_GRANT_DEFAULTS;

/** What `manager_permissions[flag]` means for this restaurant, given what is (or isn't) stored. */
export function managerGrantValue(flag: string, stored: unknown): boolean {
  if (!isConfigurableGrant(flag)) return true;              // retired → the module is the switch
  if (typeof stored === "boolean") return stored;           // the admin set it → honour it
  return MANAGER_GRANT_DEFAULTS[flag];                      // nothing stored → what the screen shows
}

/** Which SETTINGS sections this restaurant's manager panel shows. Absent = ON, so no restaurant
 *  changes until the admin switches one off. Used by the panel (to draw its sidebar) AND by the
 *  server (so a hidden section's endpoints refuse) — one helper, so they cannot disagree. */
export function managerSettingsOff(accessConfig: unknown): string[] {
  const m = (accessConfig as any)?.menus?.mgrset;
  if (!m || typeof m !== "object") return [];
  return MANAGER_SETTINGS.map((x) => x.key).filter((k) => m[k] === false);
}

// "bills" LEFT this list (owner, 2026-08-02): the Bill menu is FIXED — every manager has it —
// so a stored menus.manager.bills=false is IGNORED from now on, the same way the retired
// panel switches are. Do not re-add it: the Access screen's Bill row is the fixed one with
// no switch, and re-listing the key here would re-hide the tab on any restaurant that
// switched it off before 2026-08-02.
export const MANAGER_TAB_KEYS = ["editor", "ratings", "log"] as const;
export type ManagerTabKey = (typeof MANAGER_TAB_KEYS)[number];

export function managerTabsOff(accessConfig: unknown): ManagerTabKey[] {
  const menus = (accessConfig as any)?.menus?.manager;
  if (!menus || typeof menus !== "object") return [];
  return MANAGER_TAB_KEYS.filter((k) => menus[k] === false);
}
export function managerTabOn(accessConfig: unknown, key: ManagerTabKey): boolean {
  return !managerTabsOff(accessConfig).includes(key);
}

/** Deep-merge a TreePatch into a TreeState (2 levels is all the shapes need). */
export function applyPatch(s: TreeState, p: TreePatch): TreeState {
  const out: TreeState = { ...s };
  for (const k of Object.keys(p) as (keyof TreePatch)[]) {
    const src = p[k] as Record<string, any>, cur = (out[k] || {}) as Record<string, any>;
    const next: Record<string, any> = { ...cur };
    for (const kk of Object.keys(src)) {
      const val = src[kk];
      next[kk] = val && typeof val === "object" && !Array.isArray(val)
        ? deepMerge(cur[kk] || {}, val)
        : val;
    }
    (out as any)[k] = next;
  }
  return out;
}
function deepMerge(a: Record<string, any>, b: Record<string, any>): Record<string, any> {
  const out = { ...a };
  for (const k of Object.keys(b)) {
    const v = b[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? deepMerge(a?.[k] || {}, v) : v;
  }
  return out;
}

// A node is only meaningful while every ancestor that HAS a switch is on.
export function ancestorsOn(id: string, isOn: (n: Node) => boolean): boolean {
  for (const s of SECTIONS) {
    let found = false;
    const stack: Node[] = [];
    const rec = (nodes: Node[]): boolean => {
      for (const n of nodes) {
        stack.push(n);
        if (n.id === id) { found = true; return true; }
        if (n.children && rec(n.children)) return true;
        stack.pop();
      }
      return false;
    };
    rec(s.children);
    if (found) return stack.slice(0, -1).every((a) => a.bind.t === "none" || isOn(a));
  }
  return true;
}
