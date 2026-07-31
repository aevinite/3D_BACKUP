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
  link?: { href: string; label: string }; // read-only row that points at the screen which OWNS this value
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
  { id: "take_orders", name: "Take a new order", flag: "take_orders", tablet: "tablet_take_orders", mgrDef: true, waiterDef: "on",
    what: "Punching in a dine-in order. A waiter's core job; a manager can be given it too." },
  { id: "table_tags", name: "Mark a table's type", flag: "table_tags", tablet: "tablet_table_tags", mgrDef: true, waiterDef: "on",
    what: "Putting the VIP / Family / Owner's-guest ribbon on a table so the floor shows who's sitting there." },
  { id: "give_discounts", name: "Give a discount", flag: "give_discounts", tablet: "tablet_discount", mgrDef: true, waiterDef: "off", pin: true, cap: true,
    what: "Taking money off a bill. The cap below is the most this role may take off in one go." },
  { id: "mark_paid", name: "Mark a bill paid (and undo)", flag: "mark_paid", tablet: "tablet_mark_paid", mgrDef: true, waiterDef: "off", pin: true,
    what: "Closing a table as paid — and the Undo that reopens a just-paid bill. Deliberately ONE permission, so undoing is never easier than paying." },
  { id: "print_invoice", name: "Generate bills", flag: "print_invoice", tablet: "tablet_invoice", mgrDef: true, waiterDef: "off", pin: true,
    what: "Producing the tax invoice. It carries a legal number that can never be reused, so an invoice can be issued but not un-issued." },
  { id: "void_bills", name: "Reopen or void a bill", flag: "void_bills", capTablet: "void_bills", mgrDef: true, waiterDef: "off", pin: true,
    what: "Reopening a settled bill, voiding a generated one, or closing a table unpaid after a walk-out. Every use is recorded with who did it and the reason they typed." },
  { id: "delete_bill", name: "Delete a bill", flag: "delete_bill", mgrDef: false, pin: true,
    what: "Takes a bill off the working list. A PAID bill can never be deleted; what is removed stays in the records for tax, is restorable, and stores who did it and why." },
  { id: "table_ops", name: "Move, merge and split tables", flag: "table_ops", tablet: "tablet_table_ops", mgrDef: true, waiterDef: "off", pin: true,
    what: "The KOT ▾ menu: move a party to another table, merge two tables, move a ticket or one dish, split a bill, reprint a kitchen ticket." },
  { id: "manage_staff", name: "Manage staff", flag: "manage_staff", mgrDef: false,
    what: "Adding people, changing a role, resetting a PIN. Off for managers unless you deliberately hand it over." },
  { id: "edit_settings", name: "Change restaurant settings", flag: "edit_settings", mgrDef: false,
    what: "The restaurant's own configuration — branding, opening hours, printers, tables. Tax rates are admin-only and stay that way." },
];

// One ACTIONS row rendered for a given side.
const mgrAction = (a: ActionDef): Node => ({
  id: `mgr_${a.id}`, name: a.name, what: a.what, bind: { t: "grant", flag: a.flag }, def: a.mgrDef, pin: a.pin,
  children: a.cap ? [{ id: `mgr_${a.id}_cap`, name: "Most they can take off", what: "The biggest discount this role may apply in one go.", bind: { t: "limit", id: a.id, side: "manager" }, def: 20, unit: "%", options: [5, 10, 20, 50, 100] }] : undefined,
});
const waiterAction = (a: ActionDef): Node | null => {
  if (!a.tablet && !a.capTablet) return null;
  return {
    id: `wtr_${a.id}`, name: a.name, what: a.what, pin: a.pin, def: a.waiterDef || "off",
    bind: a.tablet ? { t: "tablet", key: a.tablet } : { t: "capTablet", id: a.capTablet! },
    children: a.cap ? [{ id: `wtr_${a.id}_cap`, name: "Most they can take off", what: "The biggest discount a waiter may apply in one go.", bind: { t: "limit", id: a.id, side: "waiter" }, def: 5, unit: "%", options: [5, 10, 20, 50, 100] }] : undefined,
  };
};

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
          { id: "dining_sessions", name: "Dining sessions", def: false, bind: { t: "setting", key: "sessions_enabled" },
            what: "The table-session system: a guest scans the table's QR, the table is opened, the party is tracked and joined. OFF means there is no “Open table” step at all — the floor switches to direct ordering, so staff punch an order straight in without opening a table first." },
          { id: "ratings", name: "Ratings", def: "off", bind: { t: "choice", key: "google_review_mode" },
            what: "How a guest rates you after eating. Pick one.",
            choices: [
              { value: "off", label: "Menu rating only", what: "Guests leave a 1–5 star rating inside your own menu. Nothing goes to Google." },
              { value: "google", label: "Google review only", what: "No in-menu stars — the guest is sent straight to your Google review page." },
              { value: "google_after_normal", label: "Both — Google after the menu one", what: "The guest rates in the menu first, then is invited to post it on Google." },
            ],
            children: [
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
          { id: "favourites", name: "Favourites", def: true, bind: { t: "feature", key: "favorites" },
            what: "The heart button on a dish and the Favourites tab. This is also what the loyalty feature will be built on later." },
          { id: "veg", name: "Veg / non-veg", def: true, bind: { t: "feature", key: "diet_filter" },
            what: "The veg / non-veg chips AND the little green-or-red veg mark on each dish. Switch it off for a pure-veg restaurant so nothing needs marking." },
          {
            id: "format", name: "Format", bind: { t: "none" },
            what: "How the menu looks when a guest opens it for the first time, and which languages and currencies it offers.",
            children: [
              { id: "menu_layout", name: "Default layout", def: "grid", bind: { t: "choice", key: "menu_default_layout" },
                what: "What a first-time guest sees before they change anything. They can still switch it themselves.",
                choices: [{ value: "grid", label: "Grid — photo cards" }, { value: "list", label: "List — compact rows" }] },
              { id: "menu_mode", name: "Default light / dark", def: "light", bind: { t: "choice", key: "menu_default_mode" },
                what: "Which colour mode the menu opens in for this restaurant. The guest can still flip it.",
                choices: [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }] },
              // Read-only on purpose: the theme is a colour palette (bg/card/text/accent per
              // mode) owned by the restaurant's Branding screen. A second editor here would
              // be a second source of truth for one value — so this row SHOWS what the menu
              // is wearing and links to the screen that owns it.
              { id: "menu_theme", name: "Menu theme", bind: { t: "none" },
                link: { href: "/aevinite/restaurants?section=branding", label: "Edit in Branding" },
                what: "The restaurant's own colours — background, cards, text and accent, for both light and dark. Set on the Branding screen so there is only ever one place that owns it." },
              { id: "menu_languages", name: "Languages", def: ["en"], bind: { t: "list", key: "menu_languages" }, choices: MENU_LANGUAGES,
                what: "Which languages the menu is offered in. Pick ONE and the language switcher is removed from the menu completely — pick two or more and it appears." },
              { id: "menu_currencies", name: "Currencies", def: ["INR"], bind: { t: "list", key: "menu_currencies" }, choices: MENU_CURRENCIES,
                what: "Which currencies prices can be shown in. Pick ONE and the currency switcher is removed from the menu completely." },
            ],
          },
        ],
      },
      { id: "khata", name: "Pay later (khata)", def: false, bind: { t: "module", key: "khata" },
        what: "Parking a bill on a named regular to collect later, and the book that tracks who owes what. OFF removes the khata screens from the manager AND owner panels entirely." },
      {
        // "Platforms" (owner, 2026-07-31). The stored key stays `takeaway`: that is the mig-235
        // column name, and renaming a LABEL must never rename a column.
        id: "takeaway", name: "Platforms", def: false, bind: { t: "module", key: "takeaway" },
        what: "Every way an order arrives that isn't someone sitting at a table: a counter takeaway, the restaurant's own website, and the delivery apps. OFF removes the Platform board and the 🥡 New Parcel button.",
        children: [
          { id: "ch_website", name: "Takeaway / own website", def: true, bind: { t: "channel", key: "website" },
            what: "A counter takeaway punched in by staff, and orders coming from the restaurant's own website. Needs no outside account.",
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
      { id: "auto_print_kot", name: "Auto-print kitchen tickets", def: false, bind: { t: "setting", key: "auto_print_kot_allowed" },
        what: "Kitchen tickets print themselves as orders come in, instead of someone tapping print. Needs a printer wired to the kitchen machine." },
      { id: "banquet", name: "Banquet billing", def: false, bind: { t: "module", key: "banquet" },
        what: "Per-plate event billing that runs without a table — a wedding, a party booking. OFF removes the Banquet tab." },
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
      {
        id: "bill", name: "Bill", bind: { t: "none" },
        what: "What prints on a bill. There is no on/off here — a restaurant can always issue a bill. These are the details that appear on it.",
        children: [
          { id: "bill_gstin", name: "GSTIN", def: "", bind: { t: "text", key: "gstin" }, placeholder: "e.g. 24ABCDE1234F1Z5",
            what: "The tax number printed on every bill. Leave it empty and bills print without one — never put a made-up number on a real bill." },
          { id: "bill_name", name: "Legal name on the bill", def: "", bind: { t: "text", key: "restaurant_name" }, placeholder: "Registered business name",
            what: "The business name as it should appear on a tax invoice, which is often not the same as the trading name." },
          { id: "bill_address", name: "Bill address", def: "", bind: { t: "text", key: "restaurant_address" }, placeholder: "Street, city, PIN",
            what: "The address printed on the bill." },
          { id: "bill_designer", name: "Bill design editor", leftToBuild: true, bind: { t: "none" },
            what: "Design the whole bill like a document — move the logo, change the wording, resize the totals. Not built yet; this is where it will live." },
        ],
      },
    ],
  },

  // ──────────────────────────── A2 · STAFF APPS ─────────────────────────────
  // NOT on the owner's list, kept deliberately: these are in real use (Aangan runs on the
  // waiter tablet only) and switching one off REFUSES that login at the door — a capability
  // with no substitute anywhere else. They moved here from the restaurant detail page, which
  // now carries no permissions at all. Flagged to the owner 2026-07-31.
  {
    id: "apps", name: "Staff apps", icon: "grid",
    blurb: "Which of the four staff apps this restaurant has. Switching one off refuses that login — nobody can open it.",
    children: [
      { id: "panel_manager", name: "Manager panel", def: true, bind: { t: "panel", key: "manager" },
        what: "The full control room: floor, bills, editor, reports. Off refuses a manager login." },
      { id: "panel_kitchen", name: "Kitchen display", def: true, bind: { t: "panel", key: "kitchen" },
        what: "The New → Cooking → Ready ticket board and the sold-out list. Off refuses a kitchen login." },
      { id: "panel_tablet", name: "Waiter tablet", def: true, bind: { t: "panel", key: "tablet" },
        what: "The floor tiles and take-order app the waiters carry. Off refuses a waiter login." },
      { id: "panel_owner", name: "Owner panel", def: true, bind: { t: "panel", key: "owner" },
        what: "The owner's own dashboard, reports and staff pages. Off refuses an owner login." },
    ],
  },

  // ────────────────────────── B · MANAGER'S MENU ────────────────────────────
  {
    id: "mgrMenu", name: "Manager's menu", icon: "users",
    blurb: "Which tabs exist in this restaurant's manager panel. Switch one off and the tab is gone for a real manager — and its endpoints refuse.",
    children: [
      { id: "mgr_tab_editor", name: "Edit menu", def: true, fresh: true, bind: { t: "tab", panel: "manager", key: "editor" },
        what: "The Editor tab — dishes, categories and filters. Off removes the tab; WHAT a person may change inside it is set in Default set for user." },
      { id: "mgr_tab_ratings", name: "Ratings", def: true, fresh: true, bind: { t: "tab", panel: "manager", key: "ratings" },
        what: "The Ratings tab, where the manager reads what guests said about the food and handles complaints." },
      { id: "mgr_tab_log", name: "Logs", def: true, fresh: true, bind: { t: "tab", panel: "manager", key: "log" },
        what: "The Log tab — the record of who did what in this restaurant. Admin-only actions never appear there." },
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
      { id: "own_logs", name: "Logs", def: true, fresh: true, bind: { t: "section", key: "logs" },
        what: "The owner's Log page — who did what across their restaurants." },
      { id: "own_manager_mode", name: "Manager mode", leftToBuild: true, bind: { t: "none" },
        what: "Lets the owner drop into their own manager panel and work the floor as a manager would. Not built yet; this is where its switch will live." },
    ],
  },

  // ──────────────────── D · DEFAULT SET FOR USER ────────────────────────────
  {
    id: "defaults", name: "Default set for user", icon: "user",
    blurb: "What a person of each type can do by default. A single person can still be given more or less than this on the Per-person tab — this is only the starting point everyone inherits.",
    children: [
      {
        id: "d_manager", name: "Manager", bind: { t: "none" },
        what: "Every manager in this restaurant starts with these. Changing one here changes it for all managers who have no setting of their own.",
        children: [
          {
            id: "d_mgr_edit_menu", name: "Edit menu", def: true, bind: { t: "grant", flag: "edit_menu" },
            what: "May change the menu at all. The parts underneath say which bits — a manager can be allowed to mark a dish sold out without being allowed to change its price.",
            children: EDIT_MENU_PARTS.map((p) => ({
              id: `d_mgr_${p.id}`, name: p.name, what: p.what, def: p.def,
              bind: { t: "opt", id: "edit_menu", side: "manager", key: p.id } as Bind,
            })),
          },
          { id: "d_mgr_ratings", name: "Ratings", def: true, bind: { t: "grant", flag: "view_ratings" },
            what: "May read guest ratings and mark a complaint handled." },
          { id: "d_mgr_logs", name: "Logs", def: true, bind: { t: "grant", flag: "view_logs" },
            what: "May read the activity log." },
          {
            id: "d_mgr_dashboard", name: "Dashboard", def: true, bind: { t: "grant", flag: "view_dashboard" },
            what: "The numbers screen and the day's report. A real manager's dashboard is clamped to TODAY by the server today; the two picks below are the settings that will change that once they are built.",
            children: [
              { id: "d_mgr_dash_range", name: "What the dashboard shows", leftToBuild: true, bind: { t: "none" },
                what: "How far back a manager's dashboard reaches.",
                choices: [{ value: "today", label: "Today only" }, { value: "today_yesterday", label: "Today + yesterday" }] },
              { id: "d_mgr_daily_report", name: "Generate the daily report", leftToBuild: true, bind: { t: "none" },
                what: "The button that produces the day's report. It is the SAME report, with the same design, as the owner's daily analysis — one report, two places." },
            ],
          },
          ...ACTIONS.map(mgrAction),
        ],
      },
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
export const GRANT_FLAGS = collect((b) => (b.t === "grant" ? b.flag : null));
export const SECTION_ENTITLEMENTS = collect((b) => (b.t === "section" ? b.key : null));
export const TABLET_COLS = collect((b) => (b.t === "tablet" ? b.key : null));
export const TAB_KEYS = ALL_NODES.map((n) => n.bind).filter((b): b is Extract<Bind, { t: "tab" }> => b.t === "tab");

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
    case "tablet":   return { settings: { [b.key]: String(v) } };
    case "capTablet":return { config: { [b.id]: { tablet: String(v) } } };
    case "choice":   return { settings: { [b.key]: String(v) } };
    case "text":     return { settings: { [b.key]: String(v ?? "") } };
    case "creds":    return { creds: { [b.key]: String(v ?? "") } };
    case "list":     return { settings: { [b.key]: (Array.isArray(v) ? v : []).map(String) } };
    case "opt":      return { config: { [b.id]: { [`${b.side}_opts`]: { [b.key]: v } } } };
    case "limit":    return { config: { [b.id]: { limit: { [b.side]: Number(v) } } } };
    default:         return {};
  }
}

/** The Ratings choice also has to move settings.features.ratings, because the guest app's
 *  star UI reads that key in a dozen places. "Google review only" = no in-menu stars.
 *  Written from the ONE control that owns the choice, so the two can't drift. */
export function extraPatch(n: Node, v: any): TreePatch {
  if (n.id !== "ratings") return {};
  return { features: { ratings: v !== "google" } };
}

// ── the MANAGER'S MENU rung (new in this rebuild) ───────────────────────────
// Which tabs exist in a restaurant's manager panel, read from
// restaurants.access_config.menus.manager. ABSENT MEANS ON, so no restaurant changes
// until the admin switches a tab off. Used by the editor API's whoami (to tell the panel
// what to hide) AND by its route guards (so a hidden tab's endpoints refuse too) — one
// helper, so the screen and the server can never disagree.
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
