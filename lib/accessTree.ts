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
  // ── the two flags the 2026-08-01 rework added ────────────────────────────────
  // Its dropdown OPENS while the feature is off. Rule 1 (no greyed-out ghosts) is about
  // PERMISSIONS — a thing a role can never reach must be absent. These children are SET-UP
  // instead: you paste a Zomato key, set the café's coordinates or lay out the banquet bill
  // BEFORE the feature goes live, and demanding you switch it on first (so guests see it
  // half-configured) is backwards. Owner, 2026-08-01: "you should be able to still open the
  // dropdown without turning on the option for platforms".
  configurableWhenOff?: boolean;
  // This row owns a whole editor, shown inside its dropdown: the exact card that used to live on
  // the restaurant-detail page. `settings:<id>` renders one section of RestaurantSettings,
  // `branding` renders the branding & theme editor. Owner, 2026-08-01: "you have completely
  // removed setting and permission from restaurant detail — everything will be here".
  panel?: "settings:sessions" | "settings:kitchen" | "settings:banquet" | "settings:billing" | "settings:tables" | "settings:floor" | "settings:qr" | "branding";
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

// Money & floor actions offered as a MANAGER default (restaurants.manager_permissions —
// already enforced by managerCan) and as a WAITER default (settings.tablet_* tri-state —
// already enforced by tabletPerm). `pin` marks the ones whose waiter row also offers
// "On, but ask a manager PIN"; everything else is a plain on/off.
type ActionDef = {
  id: string; name: string; what: string; flag: string; tablet?: string; capTablet?: string;
  mgrDef: boolean; waiterDef?: "off" | "on" | "pin"; pin?: boolean; cap?: boolean;
};
const ACTIONS: ActionDef[] = [
  // NOT FEATURES ANY MORE (owner, 2026-08-01). Taking an order, settling a bill, issuing the
  // invoice, marking a table's type and moving/merging/splitting are how the floor RUNS — a
  // restaurant that switched them off could not trade. They are permanently on for whoever's
  // panel owns them and have no row here. managerGrantValue() answers ON for a flag with no
  // row, so removing them from this list is the whole change: nothing to store, nothing to
  // migrate, and no screen that can take them away by accident.
  //   take_orders · mark_paid · print_invoice · table_tags · table_ops
  { id: "give_discounts", name: "Give a discount", flag: "give_discounts", tablet: "tablet_discount", mgrDef: true, waiterDef: "off", pin: true, cap: true,
    what: "Taking money off a bill. The cap below is the most this role may take off in one go." },
  { id: "void_bills", name: "Reopen a bill", flag: "void_bills", capTablet: "void_bills", mgrDef: true, waiterDef: "off", pin: true,
    what: "Reopening a bill that was already closed. The SAME bill comes back — and it is recorded that it was reopened, and what changed, so the audit always shows it." },
  { id: "delete_bill", name: "Delete a bill", flag: "delete_bill", mgrDef: false, pin: true,
    what: "Takes a bill out of the reports. The number is NOT reused — the next bill still takes the next number — and nothing is erased: the bill stays in the records and in the audit, it simply stops counting towards sales." },
  // "Manage staff" LEFT this list (owner, 2026-08-01) — it is not one of the money actions, it is
  // its own thing, and one switch covering create/reset/delete was three very different amounts of
  // trust behind a single yes. It lives in "What a manager can manage", split up.
  //
  // "Change restaurant settings" is GONE entirely, not moved. There is no restaurant configuration
  // left for a manager to change: service mode and the bubble effect are decided on Access now,
  // the bill and the tables belong to the admin, and the floor is its own row below.
];

// One ACTIONS row rendered for a given side.
const mgrAction = (a: ActionDef): Node => ({
  id: `mgr_${a.id}`, name: a.name, what: a.what, bind: { t: "grant", flag: a.flag }, def: a.mgrDef, pin: a.pin,
  featureBind: { t: "has", id: a.id },
  children: a.cap ? [{ id: `mgr_${a.id}_cap`, name: "Most they can take off", what: "The biggest discount this role may apply in one go.", bind: { t: "limit", id: a.id, side: "manager" }, def: 20, unit: "%", options: [5, 10, 20, 50, 100] }] : undefined,
});
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
// This list and that one must stay the same set: a row here with no section there is a switch
// that does nothing, and a section there with no row here is a screen nobody can take away.
export const MANAGER_SETTINGS: { key: string; name: string; what: string }[] = [
  { key: "tables", name: "Tables — floor & seats", what: "Renaming a table, how many people sit at it, and how the tables lie on the floor screen. Adding or removing tables stays admin-only." },
  { key: "users", name: "Users — staff logins", what: "Seeing and managing this restaurant's staff logins — waiter tablets and the kitchen screen. A manager can only ever touch roles below their own." },
  { key: "access", name: "Sections — who serves which table", what: "Giving each waiter their own part of the floor, so their tablet shows only those tables." },
  { key: "billing", name: "Billing — invoice & tax", what: "The bill's own details. Most of this is admin-owned now; the section is here so it can be taken away entirely." },
  { key: "kitchen", name: "Kitchen — KOT printing", what: "The kitchen ticket printer and its test print." },
  { key: "sessions", name: "Dining sessions — QR & location", what: "The session rules a manager may see: whether a guest has to be at the café, the phone code, the café's coordinates." },
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
            bind: { t: "setting", key: "sessions_enabled" }, panel: "settings:sessions", configurableWhenOff: true,
            what: "The table-session system: a guest scans the table's QR, the table is opened, the party is tracked and joined. OFF means there is no “Open table” step at all — the floor switches to direct ordering, so staff punch an order straight in without opening a table first. The rules and the café's coordinates are inside." },
          {
            // MASTER on/off — the rebuild lost it: only the three-way "where does the rating go"
            // picker survived, so there was no way to say "this restaurant has no rating at all"
            // (owner, 2026-08-01: "there is no toggle to on and off rating right now").
            id: "ratings", name: "Ratings", def: true, bind: { t: "ratingsMaster" }, configurableWhenOff: true,
            what: "The whole rating & review part of the guest menu — the star row on a dish, the “Rate dish” box and the review invite. OFF removes all of it; a guest is never asked to rate anything.",
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
            id: "maintenance", name: "Put menu on maintenance", bind: { t: "has", id: "maintenance", def: false },
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
        bind: { t: "setting", key: "auto_print_kot_allowed" }, panel: "settings:kitchen", configurableWhenOff: true,
        what: "Kitchen tickets print themselves as orders come in, instead of someone tapping print. Needs a printer wired to the kitchen machine. The printer check and the sample ticket are inside." },
      {
        id: "bill", name: "Bill", bind: { t: "none" },
        what: "Everything that prints on a bill. There is no on/off — a restaurant can always issue one.",
        children: [
          // ONE form, not four boxes (owner, 2026-08-01: "here unnecessary sub-options are made,
          // it could be merged… and it should be as format of bill"). GSTIN, the legal name and
          // the address were three separate rows sitting on top of a fourth box holding the rest
          // of the very same document. They are all the bill's format, so they are one screen —
          // the same shape as Menu → Design and styling.
          { id: "bill_format", name: "Format of bill", bind: { t: "none" }, panel: "settings:billing",
            what: "The whole bill as one form: GSTIN, the legal name and address, the phone, the invoice number's prefix, the tax rows that make up the total, the footer line, and whether a customer's name is asked for." },
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
            what: "Each table's name — optional, e.g. the last one as “Banquet” — and how many people can sit there." },
          { id: "tables_layout", name: "Number of tables per row", bind: { t: "none" }, panel: "settings:floor",
            what: "How many table boxes sit on one line in the manager's floor view, and so how big each box ends up." },
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
        id: "takeaway", name: "Platforms (Zomato, Swiggy, own website)", def: false, bind: { t: "module", key: "takeaway" },
        configurableWhenOff: true,
        what: "Every way an order arrives that isn't someone sitting at a table: a counter takeaway, the restaurant's own website, and the delivery apps. OFF removes the Platform board and the 🥡 New Parcel button.",
        children: [
          { id: "ch_website", name: "Takeaway / own website", def: true, configurableWhenOff: true, bind: { t: "channel", key: "website" },
            what: "A counter takeaway punched in by staff, and orders coming from the restaurant's own website. Needs no outside account.",
            children: [
              { id: "ch_website_key", name: "Website connection key", bind: { t: "creds", key: "website" }, placeholder: "Paste the website key",
                what: "Only needed if the restaurant's own website sends orders in by itself. A counter takeaway punched in by staff needs nothing here." },
            ] },
          { id: "ch_zomato", name: "Zomato", def: false, configurableWhenOff: true, bind: { t: "channel", key: "zomato" },
            what: "Zomato orders land on the Platform board. Needs Zomato's API key — until it is entered the channel shows as “not connected”.",
            children: [
              { id: "ch_zomato_key", name: "Zomato API key", bind: { t: "creds", key: "zomato" }, placeholder: "Paste the Zomato API key",
                what: "From the restaurant's own Zomato partner account. Once saved it is never shown again — only the last four characters, so you can tell which key is in place without the key being readable off the screen." },
            ] },
          { id: "ch_swiggy", name: "Swiggy", def: false, configurableWhenOff: true, bind: { t: "channel", key: "swiggy" },
            what: "Swiggy orders land on the Platform board. Needs Swiggy's API key — until it is entered the channel shows as “not connected”.",
            children: [
              { id: "ch_swiggy_key", name: "Swiggy API key", bind: { t: "creds", key: "swiggy" }, placeholder: "Paste the Swiggy API key",
                what: "From the restaurant's own Swiggy partner account. Once saved it is never shown again — only the last four characters, so you can tell which key is in place without the key being readable off the screen." },
            ] },
        ],
      },
      { id: "banquet", name: "Banquet billing", def: false, bind: { t: "module", key: "banquet" },
        configurableWhenOff: true,
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
    blurb: "Which menus a manager gets, and what they may do inside each one. Switch a menu off and it is gone for a real manager — its settings go with it, and its endpoints refuse.",
    children: [
      {
        // "Inside Manager, there will be Manager menu. Inside Manager menu, there will be Edit
        // menu…" (owner, 2026-08-01). The menus are a named group of their own so the section
        // reads as the manager's PANEL — its menus, then what they may do inside it.
        id: "mgr_menu_group", name: "Manager menu", bind: { t: "none" },
        what: "The tabs a manager gets. Switch one off and it is gone for a real manager — its settings go with it, and its endpoints refuse.",
        children: [
        {
          id: "mgr_tab_editor", name: "Edit menu", def: true, fresh: true,
          bind: { t: "menu", panel: "manager", key: "editor", grant: "edit_menu" },
          what: "The Editor tab — dishes, categories and filters. Off removes the tab completely; the parts below say which bits of it a manager may change.",
          children: EDIT_MENU_PARTS.map((p) => ({
            id: `d_mgr_${p.id}`, name: p.name, what: p.what, def: p.def,
            bind: { t: "opt", id: "edit_menu", side: "manager", key: p.id } as Bind,
          })),
        },
        { id: "mgr_tab_ratings", name: "Ratings", def: true, fresh: true,
          bind: { t: "menu", panel: "manager", key: "ratings", grant: "view_ratings" },
          what: "The Ratings tab, where the manager reads what guests said about the food and marks a complaint handled." },
        { id: "mgr_tab_log", name: "Audit", def: true, fresh: true,
          bind: { t: "menu", panel: "manager", key: "log", grant: "view_logs" },
          what: "The Audit tab — what was removed and why, with the full activity log inside it. Admin-only actions never appear there. The stored key stays “log”, which is what the other session deliberately built against; renaming a LABEL must never rename a key." },
        {
          // FOURTH menu. Its reach is a setting, not a separate permission: a real manager's
          // dashboard is clamped to TODAY by the server, and this is what widens it.
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
        {
          // FIFTH menu (owner, 2026-08-01). The two things that can be done to a bill AFTER it is
          // closed. Both are recorded in the audit — that is the point of putting them together.
          id: "mgr_tab_bill", name: "Bill", def: true, fresh: true,
          bind: { t: "menu", panel: "manager", key: "bills", grant: "view_bills" },
          what: "The Bills tab. What a manager may do to a bill that is already closed lives inside it — every one of these writes to the audit.",
          children: [
            { id: "mgr_bill_delete", name: "Delete a bill", def: false, bind: { t: "grant", flag: "delete_bill" }, featureBind: { t: "has", id: "delete_bill" },
              what: "Takes a bill out of the reports. The number is NOT reused — the next bill still takes the next one — and nothing is erased: it stays in the records and in the audit, it just stops counting towards sales." },
            { id: "mgr_bill_reopen", name: "Reopen a bill", def: true, bind: { t: "grant", flag: "void_bills" }, featureBind: { t: "has", id: "void_bills" },
              what: "Brings a closed bill back so it can be corrected. The SAME bill reopens, and the audit records that it was reopened and what changed.",
              children: [
                { id: "mgr_bill_reopen_mins", name: "Only within", def: 10, bind: { t: "limit", id: "void_bills", side: "minutes" },
                  unit: " min", options: [5, 10, 15, 30, 60],
                  what: "How long after a bill closes it can still be reopened. After that it is settled and a correction has to be a credit note, which is the legal way round." },
              ] },
          ],
        },
        ],
      },
      {
        // Not menus, so they can't be rows above: these are things a manager DOES, wherever they
        // stand. Kept as one list rather than scattered into the tabs they happen to appear on
        // (owner's pick, 2026-08-01).
        id: "mgr_may", name: "What a manager may do", bind: { t: "none" },
        what: "The money actions, for every manager in this restaurant. One person can still be given more or less on the Per-person tab — this is the starting point they all inherit.",
        children: [...ACTIONS.map(mgrAction)],
      },
      {
        // WHAT A MANAGER CAN MANAGE = the SETTINGS SECTIONS of their own panel (owner,
        // 2026-08-01: "what manager will manage is the options that he gets in the settings").
        //
        // "Staff logins" was here as a permission and has been REMOVED — it is not one. Whether a
        // manager can work with staff logins is simply whether the Users section exists for them,
        // which is a row below like every other section. One idea, one place.
        //
        // Each row = one section of the manager panel's Settings screen. Off ⇒ the section is not
        // in their sidebar, and the endpoints behind it refuse. The same list also feeds the staff
        // PROFILE screen another session is building — its "Access & permissions → What a manager
        // can manage" reads exactly these keys, so one person's exceptions and the restaurant's
        // default can never offer different sections.
        id: "mgr_manage", name: "What a manager can manage (Settings · manager panel)", bind: { t: "none" },
        what: "Which sections a manager gets inside their own Settings screen. Switch one off and it is gone from their sidebar — and its endpoints refuse, so it is not reachable by typing a URL either.",
        children: MANAGER_SETTINGS.map((x) => ({
          id: `mgrset_${x.key}`, name: x.name, what: x.what, def: true, fresh: true,
          bind: { t: "tab", panel: "mgrset", key: x.key } as Bind,
        })),
      },
    ],
  },

  // ─────────────────────────── C · OWNER'S MENU ─────────────────────────────
  {
    id: "ownMenu", name: "Owner's menu", icon: "crown",
    blurb: "Which pages exist in this restaurant's owner panel.",
    children: [
      { id: "own_menu", name: "Edit menu", def: true, bind: { t: "section", key: "menu" },
        what: "The owner's own Menu page — the same dishes/categories editor, in the owner panel." },
      { id: "own_ratings", name: "Ratings", def: true, bind: { t: "section", key: "ratings" },
        what: "The owner's Ratings page — guest stars and written feedback." },
      // The expense book got its OWN page (mig 252) so a restaurant can write down a broken
      // lamp without running full stock management. The entries it holds are what the daily
      // report subtracts, so switching this off hides the page, not the money.
      { id: "own_expenses", name: "Expenses", def: true, bind: { t: "section", key: "expenses" },
        what: "The owner's Expenses page — breakages, repairs, utilities, rent and anything else paid out, with a photo and who recorded it. These entries are what the daily report's \u201cExpenses\u201d line adds up. OFF hides the page; the entries and the report line stay." },
      {
        // AUDIT (owner, 2026-08-01). Not "everything that happened" — that is the log — but
        // everything that WAS NOT MEANT TO HAPPEN and did: a bill reopened after closing, a bill
        // taken out of the reports, a correction made after the fact. The plain log lives INSIDE
        // it, because you go looking for the log when you are already asking "what happened here".
        id: "own_audit", name: "Audit", def: true, fresh: true, bind: { t: "section", key: "logs" },
        what: "Everything that was not meant to happen but did — bills reopened, bills taken out of the reports, anything corrected after the event — with who did it and why.",
        children: [
          { id: "own_logs", name: "Activity log", def: true, bind: { t: "section", key: "logs" },
            what: "The full record of who did what, inside Audit — the detail behind an entry." },
        ],
      },
      { id: "own_manager_mode", name: "Manager mode", leftToBuild: true, bind: { t: "none" },
        what: "Lets the owner drop into their own manager panel and work the floor as a manager would. Not built yet; this is where its switch will live." },
    ],
  },

  // ──────────────────── D · DEFAULT SET FOR USER ────────────────────────────
  {
    // The MANAGER folder moved into Manager's menu (owner, 2026-08-01) so a menu and its defaults
    // are one thing. The owner and the waiter keep their lists here for now — his call: "only the
    // manager for now".
    id: "defaults", name: "Default set for user", icon: "user",
    blurb: "What an owner and a waiter start with. A single person can still be given more or less on the Per-person tab — this is only the starting point they inherit. (A manager's set now lives inside Manager's menu.)",
    children: [
      {
        id: "d_owner", name: "Owner", bind: { t: "none" },
        what: "What an owner of this restaurant starts with. An owner is the top of their own restaurant, so only their pages are listed — money actions are always theirs.",
        children: [
          { id: "d_own_edit_menu", name: "Edit menu", def: true, bind: { t: "section", key: "menu" },
            what: "Same switch as Owner's menu → Edit menu; shown here too because this is where you'd look for it." },
          { id: "d_own_ratings", name: "Ratings", def: true, bind: { t: "section", key: "ratings" }, what: "Guest ratings and feedback." },
          { id: "d_own_logs", name: "Logs", def: true, fresh: true, bind: { t: "section", key: "logs" }, what: "The activity log." },
          { id: "d_own_manager_mode", name: "Manager mode", leftToBuild: true, bind: { t: "none" },
            what: "Not built yet — see Owner's menu → Manager mode." },
        ],
      },
      {
        id: "d_waiter", name: "Waiter (tablet)", bind: { t: "none" },
        what: "What every waiter starts with on the tablet. Money actions offer a third choice — “On, but ask a manager PIN” — so a waiter can act with a manager standing there without holding the power all shift.",
        children: ACTIONS.map(waiterAction).filter(Boolean) as Node[],
      },
    ],
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
export const HAS_IDS = Array.from(new Set(ALL_NODES.map((n) => (n.featureBind?.t === "has" ? n.featureBind.id : null)).filter(Boolean) as string[]));
export const GRANT_FLAGS = collect((b) => (b.t === "grant" ? b.flag : b.t === "menu" ? b.grant : null));
export const SECTION_ENTITLEMENTS = collect((b) => (b.t === "section" ? b.key : null));
export const TABLET_COLS = collect((b) => (b.t === "tablet" ? b.key : null));
// Same for the tab half of a "menu" row.
export const TAB_KEYS: { panel: string; key: string }[] = ALL_NODES
  .map((n) => n.bind)
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

export const MANAGER_TAB_KEYS = ["editor", "ratings", "log", "bills"] as const;
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
