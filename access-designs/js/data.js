/* =============================================================================
   data.js — the ONE information architecture, shared by all five layouts.
   =============================================================================
   The whole point of this redesign: today's permissions are 5 disjoint mechanisms
   (guest features / modules / manager powers / tablet caps / owner sections) and
   that is why the panel feels like a junk drawer. Here they are re-cut into
   GROUPS BY FUNCTIONAL AREA, and each permission declares which *kind* of control
   it needs. A layout never decides what a permission means — it only decides how
   the groups are arranged on screen.

   Three kinds of control, and only three:
     kind:'switch'   — admin flips it for the restaurant. Full stop. No delegation.
                       (guest menu features, which panels exist, owner sections)
     kind:'ladder'   — a staff power. ONE stepper: Off / Owner / Owner + Manager.
                       Stepping it on reveals [Owner can… | Manager can…] with each
                       side's own sub-option chips. Optional adminGate on top for
                       "special" features the admin must allow first.
     kind:'locked'   — a power that is permanently the manager's; only the admin
                       can remove it from the restaurant entirely (take_orders).

   Real keys from the codebase are used everywhere (FEATURE_DEFAULTS,
   MANAGER_POWER_FLAGS, OWNER_SECTION_KEYS, the module *_allowed columns) so that
   wiring this to the backend later is a mapping job, not a rewrite.
============================================================================= */

/* ---------------------------------------------------------------- groups ---
   Order matters: this is the reading order of the panel. Guest-facing first
   (what the diner sees), then the staff powers by the job they do, then the
   plumbing (panels, owner sections, defaults).                              */

export const GROUPS = [
  {
    id: "guest",
    name: "Guest experience",
    blurb: "What a diner sees on the menu. Admin switches these on for the restaurant — they are not passed down to staff.",
    icon: "utensils",
    hue: 32,
    family: "admin",
  },
  {
    id: "menu",
    name: "The menu",
    blurb: "Who may change dishes, prices and categories.",
    icon: "book",
    hue: 145,
    family: "staff",
  },
  {
    id: "money",
    name: "Bills & money",
    blurb: "Every action that can move money. These default to off for waiters.",
    icon: "receipt",
    hue: 8,
    family: "staff",
  },
  {
    id: "floor",
    name: "Tables & floor",
    blurb: "Taking orders and moving parties around the floor.",
    icon: "grid",
    hue: 200,
    family: "staff",
  },
  {
    id: "kitchen",
    name: "Kitchen",
    blurb: "The kitchen display and ticket printing.",
    icon: "flame",
    hue: 22,
    family: "staff",
  },
  {
    id: "banquet",
    name: "Banquet & events",
    blurb: "Per-plate event billing. A special feature the admin switches on.",
    icon: "sparkles",
    hue: 268,
    family: "staff",
  },
  {
    id: "reports",
    name: "Reports & insights",
    blurb: "Numbers, ratings and the activity log.",
    icon: "chart",
    hue: 178,
    family: "staff",
  },
  {
    id: "staff",
    name: "Staff & settings",
    blurb: "Managing people and the restaurant's own settings.",
    icon: "users",
    hue: 250,
    family: "staff",
  },
  {
    id: "panels",
    name: "Staff apps",
    blurb: "Which of the four staff apps this restaurant has at all. Off means the login is refused.",
    icon: "layout",
    hue: 210,
    family: "admin",
  },
  {
    id: "ownersections",
    name: "Owner panel sections",
    blurb: "Which pages exist inside the owner's own panel.",
    icon: "sidebar",
    hue: 288,
    family: "admin",
  },
];

/* ------------------------------------------------------------ permissions ---
   Every entry carries the plain-English name the owner will actually read,
   a `what` line for the (i) popover, and the shot it points at in the real app.
   `sub` = the checkboxes that live INSIDE the power (owner side and manager side
   each get their own copy of this list).                                     */

export const PERMISSIONS = [
  /* ============================ GUEST EXPERIENCE ========================== */
  {
    id: "ratings", group: "guest", kind: "switch", key: "features.ratings",
    name: "Star ratings",
    what: "Guests can leave a 1–5 star rating on a dish after they have eaten it. Off removes the stars from dish cards, the dish page and the past-bill screen.",
    shot: "guest-menu", shotNote: "The star row on a dish card",
  },
  {
    id: "reviews", group: "guest", kind: "switch", key: "features.reviews",
    name: "Written reviews",
    what: "Guests can type a short review alongside the rating. Needs star ratings to be on.",
    shot: "guest-dish", shotNote: "The review box under the rating",
    requires: "ratings",
  },
  {
    id: "model3d", group: "guest", kind: "switch", key: "features.model3d",
    name: "3D dish viewer",
    what: "The rotating 3D model on dishes that have one. A normal guest feature — it shows on the menu for everyone. (Attaching a model is a separate admin-only job inside Edit the menu.)",
    shot: "guest-3d", shotNote: "The “View in 3D” button",
  },
  {
    id: "allergies", group: "guest", kind: "switch", key: "features.allergies",
    name: "Allergy warnings",
    what: "Allergen badges on dishes, the allergy filter, and the allergy note carried onto the kitchen ticket.",
    shot: "guest-menu", shotNote: "The allergen chips under a dish name",
    sub: [
      { id: "allergies_other", name: "Let a guest add their own allergy", def: true,
        what: "Adds an “Other…” box so a guest can type an allergy that is not on the restaurant's list. Off means they can only pick from the allergies you defined." },
    ],
  },
  {
    id: "favorites", group: "guest", kind: "switch", key: "features.favorites",
    name: "Favourites",
    what: "The heart button on dishes and the Favourites tab.",
    shot: "guest-menu", shotNote: "The heart on the top-right of a dish card",
  },
  {
    id: "waiter_calls", group: "guest", kind: "switch", key: "features.waiter_calls",
    name: "Call waiter button",
    what: "The bell a guest taps to call a waiter. Off hides the bell and stops calls reaching the tablet.",
    shot: "guest-menu", shotNote: "The bell in the bottom bar",
  },
  {
    id: "diet_filter", group: "guest", kind: "switch", key: "features.diet_filter", adminOnly: true,
    name: "Veg / non-veg filter",
    what: "The Veg / Non-veg chips on the menu. Pure-veg restaurants switch this off so the menu is not pointlessly filtered.",
    shot: "guest-menu", shotNote: "The Veg / Non-veg chip row",
  },
  {
    id: "languages", group: "guest", kind: "switch", key: "features.languages",
    name: "Language picker",
    what: "Lets a guest read the menu in any of the six languages. Off means English only.",
    shot: "guest-menu", shotNote: "The globe in the top bar",
  },
  {
    id: "currency", group: "guest", kind: "switch", key: "features.currency",
    name: "Currency picker",
    what: "Lets a guest see prices converted. Off means rupees only.",
    shot: "guest-menu", shotNote: "The ₹ selector in the top bar",
  },
  /* (Sticky category bar removed — it is always on, never a toggle.) */

  /* ================================ THE MENU ============================== */
  {
    id: "edit_menu", group: "menu", kind: "ladder", key: "power_edit_menu",
    name: "Edit the menu",
    what: "The Dishes and Categories screens in the manager panel. Tick exactly which parts of menu editing each role gets — a manager who may mark a dish sold out does not have to be allowed to change its price.",
    shot: "manager-menu", shotNote: "The Dishes tab",
    sub: [
      { id: "add_dish", name: "Add a new dish", what: "The + Add dish button." },
      { id: "edit_dish", name: "Edit a dish", what: "Name, description, photo, tags, allergens." },
      { id: "edit_price", name: "Change a price", what: "The price field only. Kept separate because it is the field most worth protecting." },
      { id: "delete_dish", name: "Delete a dish", what: "Permanently removes a dish from the menu." },
      { id: "mark_86", name: "Mark sold out (86)", what: "Flips a dish to sold-out so guests cannot order it. Also reachable from the kitchen 86 board." },
      { id: "manage_categories", name: "Manage categories", what: "Add, rename, reorder and hide menu categories." },
      { id: "manage_filters", name: "Manage filters", what: "The dietary / preference chips guests filter by." },
      { id: "edit_3d", name: "Attach a 3D model", adminOnly: true,
        what: "Uploading and positioning a dish's 3D model. Admin-only — it writes to shared storage, so it is never handed to a manager." },
    ],
  },

  /* ============================= BILLS & MONEY ============================ */
  {
    id: "give_discounts", group: "money", kind: "ladder", key: "power_give_discounts", waiter: true,
    name: "Give a discount",
    what: "Taking money off a bill. The cap below is the most this role may take off in one go — set it low for waiters.",
    shot: "manager-bill", shotNote: "The Discount button on a bill",
    limit: { label: "Most they can take off", unit: "%", options: [5, 10, 20, 50, 100] },
    sub: [
      { id: "whole_bill", name: "Discount the whole bill", what: "A percentage or amount off the whole bill." },
      { id: "on_the_house", name: "Settle on the house", what: "Closes a bill at zero. The highest-risk one — keep it to the owner unless you trust the manager completely." },
    ],
  },
  {
    id: "void_bills", group: "money", kind: "ladder", key: "power_void_bills", waiter: true,
    name: "Void, delete or close a bill",
    what: "Cancelling a bill after it has been generated. Every use is written to the activity log with the reason typed by the person.",
    shot: "manager-bill", shotNote: "The Void button in the bill header",
    sub: [
      { id: "void_bill", name: "Void a bill", what: "Cancels a bill AFTER it was generated but KEEPS it in the records marked “voided” (nothing is collected, the number stays for the audit). Use this for a mistaken or abandoned bill." },
      { id: "delete_bill", name: "Delete a bill", what: "Removes the bill entirely. Kept apart from Void because it cannot be undone and leaves no record." },
      { id: "close_unpaid", name: "Close a table unpaid", what: "Frees the table while marking the money as never collected (a walk-out / write-off)." },
    ],
  },
  {
    id: "revert_payment", group: "money", kind: "ladder", key: "power_revert_payment", waiter: true,
    name: "Undo a payment",
    what: "Reversing a bill that was already marked paid — the refund path. There is a 30-minute grace window after which only the owner can do it.",
    shot: "manager-bill", shotNote: "The Undo bar after marking paid",
    sub: [
      { id: "undo_grace", name: "Undo within 30 minutes", what: "The normal “oops, wrong table” undo." },
      { id: "undo_any", name: "Undo any time", what: "Reverse a payment from any earlier point today. Owner-level by default." },
    ],
  },
  {
    id: "mark_paid", group: "money", kind: "ladder", key: "tablet.mark_paid", waiter: true,
    name: "Mark a bill paid",
    what: "The button that closes a table as paid. This is the single most common thing to hand to a trusted waiter and withhold from a new one — use Per person for that.",
    shot: "tablet-bill", shotNote: "The Mark paid button",
    sub: [
      { id: "pay_cash", name: "Cash", what: "Settle as cash." },
      { id: "pay_card", name: "Card / UPI", what: "Settle as a card or UPI payment." },
      { id: "pay_split", name: "Split across methods", what: "Part cash, part card." },
    ],
  },
  {
    id: "print_invoice", group: "money", kind: "ladder", key: "tablet.invoice", waiter: true,
    name: "Generate & print the invoice",
    what: "Producing the tax invoice. Separate from marking paid because an invoice carries a legal number that cannot be reused.",
    shot: "manager-bill", shotNote: "The Generate invoice button",
    sub: [
      { id: "inv_generate", name: "Generate the invoice", what: "Assigns the next invoice number." },
      { id: "inv_reprint", name: "Reprint an invoice", what: "Prints a copy of an already-issued invoice." },
    ],
  },
  {
    id: "khata", group: "money", kind: "ladder", key: "khata", waiter: true, gate: "khata",
    name: "Khata — put it on their tab",
    what: "Parking a bill against a named regular to collect later, and the book that tracks who owes what.",
    shot: "manager-khata", shotNote: "The Khata entry in the settle sheet",
    sub: [
      { id: "khata_add", name: "Park a bill on a person", what: "Closes the table and moves the amount to that person's tab." },
      { id: "khata_settle", name: "Settle a tab", what: "Takes the money and clears what a person owes." },
      { id: "khata_book", name: "See the whole book", what: "The list of every person and how much is outstanding." },
      { id: "khata_people", name: "Add or edit people", what: "Managing who is allowed a tab at all." },
    ],
  },

  /* ============================ TABLES & FLOOR ============================ */
  {
    id: "take_orders", group: "floor", kind: "ladder", key: "power_take_orders", waiter: true,
    name: "Take a new order",
    what: "Punching in a dine-in order. Waiters do this by default; you can hand it to the manager too, or pull it back — only the admin removes it from the restaurant entirely.",
    shot: "manager-takeorder", shotNote: "The Take order button on a table",
  },
  {
    id: "table_ops", group: "floor", kind: "ladder", key: "table_ops", waiter: true, gate: "table_ops",
    name: "Table & ticket operations",
    what: "The KOT ▾ menu: moving parties and tickets around after an order has already gone to the kitchen. When this is off the classic ⇄ Shift table button is shown instead.",
    shot: "manager-kot", shotNote: "The KOT ▾ menu in the table header",
    sub: [
      { id: "change_table", name: "Move a party to another table", what: "Shifts the whole party, bill and all." },
      { id: "merge_tables", name: "Merge two tables", what: "Joins two parties into one bill." },
      { id: "move_kot", name: "Move a whole ticket", what: "Sends one kitchen ticket to a different table." },
      { id: "move_dish", name: "Move a single dish", what: "Moves one line to another table's bill." },
      { id: "split_bill", name: "Split the bill", what: "Breaks one bill into several." },
      { id: "reprint_kot", name: "Reprint a kitchen ticket", what: "Prints the ticket again for the kitchen." },
    ],
  },
  {
    id: "table_tags", group: "floor", kind: "ladder", key: "table_tags", waiter: true, gate: "table_tags",
    name: "Table types (VIP / Family / Guest)",
    what: "Marking a table so the floor shows who is sitting there, and the on-the-house settle that goes with an owner's guest.",
    shot: "manager-floor", shotNote: "The ribbon on a table tile",
    sub: [
      { id: "tag_set", name: "Mark / remove a table's type", what: "Puts (or clears) the VIP / Family / Owner's-guest ribbon on a table." },
    ],
  },

  /* ================================ KITCHEN =============================== */
  {
    id: "auto_print_kot", group: "kitchen", kind: "switch", key: "auto_print_kot", adminOnly: true,
    name: "Auto-print kitchen tickets",
    what: "Tickets print themselves on the kitchen printer as orders come in, instead of someone tapping print. This is a main hardware setting — only the admin turns it on or off; it is not handed to the owner, manager or waiters.",
    shot: "kitchen-print", shotNote: "The Auto-print row in kitchen settings",
  },

  /* ============================ BANQUET & EVENTS ========================== */
  {
    id: "banquet", group: "banquet", kind: "ladder", key: "power_banquet", gate: "banquet",
    name: "Banquet & events",
    what: "Per-plate event billing that runs without a table. A special feature — the admin allows it, then the owner decides who runs it.",
    shot: "manager-banquet", shotNote: "The Banquet tab",
    sub: [
      { id: "bq_create", name: "Create an event", what: "Starting a new banquet booking." },
      { id: "bq_plates", name: "Set the per-plate price", what: "The rate charged per head." },
      { id: "bq_bill", name: "Bill an event", what: "Closing and settling the event." },
      { id: "bq_reports", name: "See banquet reports", what: "Event revenue separated from dine-in." },
    ],
  },

  /* =========================== REPORTS & INSIGHTS ========================= */
  {
    id: "view_dashboard", group: "reports", kind: "ladder", key: "power_view_dashboard",
    name: "Dashboard & reports",
    what: "The numbers screen. Tick exactly which reports each role may open — a manager can be given today's sales without being shown staff performance.",
    shot: "manager-dash", shotNote: "The Dashboard tab",
    sub: [
      { id: "rep_sales", name: "Sales summary", what: "Revenue, covers and average bill for a period." },
      { id: "rep_items", name: "Dish performance", what: "What sold, what did not." },
      { id: "rep_tables", name: "Table turnover", what: "How long parties sit and how often tables turn." },
      { id: "rep_staff", name: "Staff performance", what: "Per-waiter sales and speed. Sensitive — usually owner only." },
      { id: "rep_tax", name: "Tax report", what: "CGST / SGST breakdown for filing." },
      { id: "rep_zclose", name: "Day close (Z report)", what: "The end-of-day cash-up." },
    ],
  },
  {
    id: "view_ratings", group: "reports", kind: "ladder", key: "power_view_ratings",
    name: "Guest ratings & feedback",
    what: "Reading what guests said and handling complaints.",
    shot: "manager-ratings", shotNote: "The Feedback & issues page",
    sub: [
      { id: "rat_view", name: "Read ratings", what: "See the star ratings and comments." },
      { id: "rat_respond", name: "Mark a complaint handled", what: "Closing off an issue with a note." },
      { id: "rat_delete", name: "Delete a rating", what: "Removing a rating entirely. Owner-level by default." },
    ],
  },
  {
    id: "export_reports", group: "reports", kind: "ladder", key: "power_export_reports",
    name: "Download & export",
    what: "Taking the numbers out of the app as a file. Worth keeping tight — an export leaves the building.",
    shot: "manager-dash", shotNote: "The Export button on a report",
    sub: [
      { id: "exp_csv", name: "Export as a spreadsheet", what: "CSV download of the current report." },
      { id: "exp_pdf", name: "Export as PDF", what: "A printable copy of the report." },
      { id: "exp_raw", name: "Export raw order data", what: "Every order line for the period. The heaviest export — owner only by default." },
    ],
  },
  {
    id: "view_logs", group: "reports", kind: "ladder", key: "power_view_logs",
    name: "Activity log",
    what: "The record of who did what. Choose which logs each role may read.",
    shot: "manager-log", shotNote: "The Log tab",
    sub: [
      { id: "log_orders", name: "Order changes", what: "Dishes added, removed, moved." },
      { id: "log_bills", name: "Bill actions", what: "Discounts, voids, refunds — with the reason that was typed." },
      { id: "log_staff", name: "Staff actions", what: "Logins, shift changes, power grants." },
    ],
  },

  /* =========================== STAFF & SETTINGS =========================== */
  {
    id: "manage_staff", group: "staff", kind: "ladder", key: "power_manage_staff",
    name: "Manage staff",
    what: "Adding people, changing their role and resetting PINs.",
    shot: "owner-staff", shotNote: "The Staff & powers page",
    sub: [
      { id: "st_add", name: "Add a person", what: "Creating a new staff login." },
      { id: "st_edit", name: "Edit a person", what: "Name, username, role." },
      { id: "st_remove", name: "Remove a person", what: "Deactivating a staff login." },
      { id: "st_pin", name: "Reset a PIN", what: "Issuing a new PIN when someone is locked out." },
      { id: "st_grant", name: "Grant powers to others", what: "Handing capabilities onward. Owner-level by default — a manager who can grant powers can grant themselves anything." },
    ],
  },
  {
    id: "edit_settings", group: "staff", kind: "ladder", key: "power_edit_settings",
    name: "Restaurant settings",
    what: "The restaurant's own configuration screens.",
    shot: "owner-settings", shotNote: "The Settings page",
    sub: [
      { id: "set_brand", name: "Branding & appearance", what: "Logo, colours, the splash screen." },
      { id: "set_tax", name: "Tax rates", what: "The GST rate used on every bill. Money-sensitive." },
      { id: "set_hours", name: "Opening hours", what: "When the menu accepts orders." },
      { id: "set_printers", name: "Printers & stations", what: "Which printer serves which station." },
      { id: "set_tables", name: "Tables & floor plan", what: "Adding, renaming and removing tables." },
    ],
  },

  /* =============================== STAFF APPS ============================= */
  { id: "panel_manager", group: "panels", kind: "switch", key: "panels.manager", name: "Manager panel",
    what: "The full control room. Off means a manager login is refused at the door.", shot: "manager-home", shotNote: "The manager panel" },
  { id: "panel_kitchen", group: "panels", kind: "switch", key: "panels.kitchen", name: "Kitchen display",
    what: "The New → Cooking → Ready board and the 86 list.", shot: "kitchen-home", shotNote: "The kitchen board" },
  { id: "panel_tablet", group: "panels", kind: "switch", key: "panels.tablet", name: "Waiter tablet",
    what: "The floor tiles and take-order app the waiters carry.", shot: "tablet-home", shotNote: "The waiter floor view" },
  { id: "panel_owner", group: "panels", kind: "switch", key: "panels.owner", name: "Owner panel",
    what: "The owner's own dashboard, staff and reports.", shot: "owner-home", shotNote: "The owner panel" },

  /* ========================= OWNER PANEL SECTIONS ========================= */
  { id: "sec_reports", group: "ownersections", kind: "switch", key: "owner.reports", name: "Reports page",
    what: "The owner's revenue and performance pages.", shot: "owner-home", shotNote: "The Reports nav item" },
  { id: "sec_staff", group: "ownersections", kind: "switch", key: "owner.staff", name: "Staff & powers page",
    what: "Where the owner grants manager powers. Switching this off freezes delegation at whatever it is now.", shot: "owner-staff", shotNote: "The Staff nav item" },
  { id: "sec_issues", group: "ownersections", kind: "switch", key: "owner.issues", name: "Issues page",
    what: "Staff-raised tickets with photo and voice notes.", shot: "owner-home", shotNote: "The Issues nav item" },
  { id: "sec_ratings", group: "ownersections", kind: "switch", key: "owner.ratings", name: "Ratings page",
    what: "Guest feedback for the owner.", shot: "owner-home", shotNote: "The Ratings nav item" },
  { id: "sec_customers", group: "ownersections", kind: "switch", key: "owner.customers", name: "Customers page",
    what: "The guest list built from past orders.", shot: "owner-home", shotNote: "The Customers nav item" },
  { id: "sec_settings", group: "ownersections", kind: "switch", key: "owner.settings", name: "Settings page",
    what: "Appearance, password, and the features the admin handed the owner.", shot: "owner-settings", shotNote: "The Settings nav item" },
];

export const PERM_BY_ID = Object.fromEntries(PERMISSIONS.map((p) => [p.id, p]));
export const GROUP_BY_ID = Object.fromEntries(GROUPS.map((g) => [g.id, g]));
export const permsOf = (gid) => PERMISSIONS.filter((p) => p.group === gid);

/* Which roles a capability is even relevant to — drives "hide what a role
   cannot use" on the Per person tab. */
export const ROLE_RELEVANCE = {
  manager: ["edit_menu", "give_discounts", "void_bills", "revert_payment", "mark_paid", "print_invoice",
    "khata", "take_orders", "table_ops", "table_tags", "banquet",
    "view_dashboard", "view_ratings", "export_reports", "view_logs", "manage_staff", "edit_settings"],
  tablet: ["give_discounts", "revert_payment", "mark_paid", "print_invoice", "khata",
    "take_orders", "table_ops", "table_tags", "void_bills"],
  kitchen: ["edit_menu", "view_logs"],
  owner: PERMISSIONS.filter((p) => p.kind !== "switch").map((p) => p.id),
};

/* ------------------------------------------------------------ sample data ---
   Two restaurants that look nothing like each other, so the panel is judged on
   real variety rather than one happy path.                                   */

const ON = (ids) => Object.fromEntries(ids.map((i) => [i, true]));

function frenchHouse() {
  return {
    id: "r1", name: "My Little French House", slug: "french-house",
    kind: "Fine dining · 24 tables", accent: "#D9A441", initials: "FH",
    switches: {
      ratings: true, reviews: true, model3d: true, allergies: true, allergies_other: true,
      favorites: true, waiter_calls: true, diet_filter: true, languages: true, currency: true, scrollspy: true,
      auto_print_kot: true,
      panel_manager: true, panel_kitchen: true, panel_tablet: true, panel_owner: true,
      sec_reports: true, sec_staff: true, sec_issues: true, sec_ratings: true, sec_customers: true, sec_settings: true,
    },
    gates: { table_ops: true, table_tags: true, khata: true, banquet: true, auto_print_kot: true },
    ladder: {
      edit_menu: { level: 2, owner: ON(["add_dish", "edit_dish", "edit_price", "delete_dish", "mark_86", "manage_categories", "manage_filters", "reorder_menu"]), manager: ON(["edit_dish", "mark_86", "reorder_menu"]) },
      give_discounts: { level: 3, owner: ON(["whole_bill", "on_the_house"]), manager: ON(["whole_bill"]), waiter: "pin", limit: { owner: 100, manager: 20, waiter: 5 } },
      void_bills: { level: 2, owner: ON(["void_bill", "delete_bill", "close_unpaid"]), manager: ON(["void_bill"]) },
      revert_payment: { level: 2, owner: ON(["undo_grace", "undo_any"]), manager: ON(["undo_grace"]) },
      mark_paid: { level: 3, owner: ON(["pay_cash", "pay_card", "pay_split"]), manager: ON(["pay_cash", "pay_card", "pay_split"]), waiter: "pin" },
      print_invoice: { level: 3, owner: ON(["inv_generate", "inv_reprint"]), manager: ON(["inv_generate", "inv_reprint"]), waiter: "on" },
      khata: { level: 2, owner: ON(["khata_add", "khata_settle", "khata_book", "khata_people"]), manager: ON(["khata_add", "khata_book"]) },
      take_orders: { level: 3, waiter: "on" },
      table_ops: { level: 3, owner: ON(["change_table", "merge_tables", "move_kot", "move_dish", "split_bill", "reprint_kot"]), manager: ON(["change_table", "merge_tables", "move_dish", "reprint_kot"]), waiter: "pin" },
      table_tags: { level: 2, owner: ON(["tag_set"]), manager: ON(["tag_set"]) },
      banquet: { level: 1, owner: ON(["bq_create", "bq_plates", "bq_bill", "bq_reports"]), manager: {} },
      view_dashboard: { level: 2, owner: ON(["rep_sales", "rep_items", "rep_tables", "rep_staff", "rep_tax", "rep_zclose"]), manager: ON(["rep_sales", "rep_items", "rep_zclose"]) },
      view_ratings: { level: 2, owner: ON(["rat_view", "rat_respond", "rat_delete"]), manager: ON(["rat_view", "rat_respond"]) },
      export_reports: { level: 1, owner: ON(["exp_csv", "exp_pdf", "exp_raw"]), manager: {} },
      view_logs: { level: 2, owner: ON(["log_orders", "log_bills", "log_staff"]), manager: ON(["log_orders", "log_bills"]) },
      manage_staff: { level: 2, owner: ON(["st_add", "st_edit", "st_remove", "st_pin", "st_grant"]), manager: ON(["st_pin"]) },
      edit_settings: { level: 1, owner: ON(["set_brand", "set_tax", "set_hours", "set_printers", "set_tables"]), manager: {} },
    },
    people: [
      { id: "p1", name: "Rishi Nakrani", role: "owner", since: "Owner since 2024", overrides: {} },
      { id: "p2", name: "Anaïs Fontaine", role: "manager", since: "Manager · 2 yr", overrides: { view_dashboard: "on", export_reports: "on" } },
      { id: "p3", name: "Devraj Solanki", role: "tablet", since: "Waiter · 3 yr · head waiter", overrides: { mark_paid: "on", give_discounts: "on", table_ops: "on" } },
      { id: "p4", name: "Meera Joshi", role: "tablet", since: "Waiter · 8 months", overrides: {} },
      { id: "p5", name: "Tomás Reyes", role: "tablet", since: "Waiter · 3 weeks · on trial", overrides: { mark_paid: "off", give_discounts: "off", revert_payment: "off" } },
      { id: "p6", name: "Kiran Patel", role: "kitchen", since: "Head chef · 4 yr", overrides: { edit_menu: "on" } },
      { id: "p7", name: "Sunil Rao", role: "kitchen", since: "Commis · 1 yr", overrides: {} },
    ],
  };
}

function pizzaPalace() {
  return {
    id: "r2", name: "Pizza Palace", slug: "pizza-palace",
    kind: "Pure veg · counter service · 12 tables", accent: "#7FB069", initials: "PP",
    switches: {
      ratings: true, reviews: false, model3d: false, allergies: true, allergies_other: false,
      favorites: true, waiter_calls: true, diet_filter: false, languages: false, currency: true, scrollspy: true,
      auto_print_kot: false,
      panel_manager: true, panel_kitchen: true, panel_tablet: true, panel_owner: false,
      sec_reports: true, sec_staff: true, sec_issues: false, sec_ratings: true, sec_customers: false, sec_settings: true,
    },
    gates: { table_ops: false, table_tags: true, khata: false, banquet: false, auto_print_kot: false },
    ladder: {
      edit_menu: { level: 1, owner: ON(["add_dish", "edit_dish", "edit_price", "mark_86", "manage_categories"]), manager: {} },
      give_discounts: { level: 2, owner: ON(["whole_bill"]), manager: ON(["on_the_house"]), limit: { owner: 50, manager: 10 } },
      void_bills: { level: 1, owner: ON(["void_bill", "close_unpaid"]), manager: {} },
      revert_payment: { level: 0, owner: {}, manager: {} },
      mark_paid: { level: 3, owner: ON(["pay_cash", "pay_card"]), manager: ON(["pay_cash", "pay_card"]), waiter: "on" },
      print_invoice: { level: 3, owner: ON(["inv_generate"]), manager: ON(["inv_generate"]), waiter: "on" },
      khata: { level: 0, owner: {}, manager: {} },
      take_orders: { level: 3, waiter: "on" },
      table_ops: { level: 0, owner: {}, manager: {} },
      table_tags: { level: 1, owner: ON(["tag_set"]), manager: {} },
      banquet: { level: 0, owner: {}, manager: {} },
      view_dashboard: { level: 1, owner: ON(["rep_sales", "rep_items", "rep_zclose"]), manager: {} },
      view_ratings: { level: 2, owner: ON(["rat_view", "rat_respond"]), manager: ON(["rat_view"]) },
      export_reports: { level: 0, owner: {}, manager: {} },
      view_logs: { level: 1, owner: ON(["log_orders", "log_bills", "log_staff"]), manager: {} },
      manage_staff: { level: 1, owner: ON(["st_add", "st_edit", "st_pin"]), manager: {} },
      edit_settings: { level: 1, owner: ON(["set_brand", "set_hours", "set_tables"]), manager: {} },
    },
    people: [
      { id: "q1", name: "Harsh Mehta", role: "owner", since: "Owner since 2025", overrides: {} },
      { id: "q2", name: "Farida Sheikh", role: "manager", since: "Manager · 1 yr", overrides: { mark_paid: "on" } },
      { id: "q3", name: "Ajay Kumar", role: "tablet", since: "Counter · 2 yr", overrides: { print_invoice: "on" } },
      { id: "q4", name: "Nisha Bose", role: "tablet", since: "Counter · 5 months", overrides: {} },
      { id: "q5", name: "Ramesh Iyer", role: "kitchen", since: "Pizzaiolo · 3 yr", overrides: {} },
    ],
  };
}

export const RESTAURANTS = [frenchHouse(), pizzaPalace()];

/* ----------------------------------------------------------------- state ---
   One mutable store, so every layout is looking at the same truth: flip a
   switch in the bento view, switch to the matrix view, it is still flipped.  */

export const state = {
  restaurantIndex: 0,
  tab: "general",          // 'general' | 'person'
  personId: null,
  personFilter: null,      // set by "Who has this →"
  layout: "rail",
  get r() { return RESTAURANTS[this.restaurantIndex]; },
};

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const emit = () => listeners.forEach((fn) => fn());

/* --------------------------------------------------------- read/write API ---
   Everything the controls do goes through here, so the rules (cascade, admin
   gate, manager-cannot-exceed-owner) live in exactly one place.              */

export const LEVELS = ["Off", "Owner", "Owner + Manager", "Owner + Manager + Tablet"];
/* How far a power may reach. Money / floor actions can go all the way to the
   tablet; everything else stops at the manager. Drives the reach control's steps
   and clamps setLevel so you can never delegate deeper than allowed. */
export const maxReach = (perm) => (perm && perm.waiter ? 3 : 2);

export function gateOn(perm) {
  if (!perm.gate) return true;
  return !!state.r.gates[perm.gate];
}

export function lad(permId) {
  const r = state.r;
  if (!r.ladder[permId]) r.ladder[permId] = { level: 0, owner: {}, manager: {}, waiter: "off" };
  const l = r.ladder[permId];
  if (!l.owner) l.owner = {};
  if (!l.manager) l.manager = {};
  return l;
}

export function setLevel(permId, level) {
  const l = lad(permId);
  const perm = PERM_BY_ID[permId];
  level = Math.max(0, Math.min(level, maxReach(perm)));
  l.level = level;
  // Cascade down: a rung can never survive its parent being switched off.
  // Tablet lives at level 3; below that it is simply off (no separate flag).
  if (level < 2) { l.manager = {}; }
  if (level < 1) { l.owner = {}; }
  // Reaching the tablet rung with no default yet → default to plain On (never
  // "off" — off is expressed by lowering the reach, per the owner's model).
  if (level >= 3 && perm.waiter && (!l.waiter || l.waiter === "off")) l.waiter = "on";
  emit();
}

/* The master toggle in the header: on → Owner (level 1), off → nothing. */
export function setMaster(permId, on) { setLevel(permId, on ? Math.max(1, lad(permId).level) : 0); }

export function setSub(permId, side, subId, on) {
  const l = lad(permId);
  l[side][subId] = on;
  if (!on) delete l[side][subId];
  // Turning an owner option OFF cannot leave the manager holding it.
  if (side === "owner" && !on && l.manager[subId]) delete l.manager[subId];
  emit();
}

export function setGate(gateKey, on) {
  state.r.gates[gateKey] = on;
  if (!on) {
    // Admin took the feature away: everything below it collapses.
    PERMISSIONS.filter((p) => p.gate === gateKey).forEach((p) => {
      const l = lad(p.id); l.level = 0; l.owner = {}; l.manager = {}; l.waiter = "off";
    });
  }
  emit();
}

export function setSwitch(id, on) { state.r.switches[id] = on; emit(); }
export function getSwitch(id) { return !!state.r.switches[id]; }

export function setWaiter(permId, v) { lad(permId).waiter = v; emit(); }
export function setLimit(permId, side, v) {
  const l = lad(permId); l.limit = l.limit || {}; l.limit[side] = v; emit();
}

/* A manager option ticked while the owner's identical option is not — the red
   warning. Returns the list of offending sub-option names. */
export function conflicts(perm) {
  if (perm.kind !== "ladder" || !perm.sub) return [];
  const l = lad(perm.id);
  if (l.level < 2) return [];
  return perm.sub.filter((s) => l.manager[s.id] && !l.owner[s.id]).map((s) => s.name);
}

export function allConflicts() {
  return PERMISSIONS.filter((p) => p.kind === "ladder" && conflicts(p).length);
}

/* What a person actually ends up with, after their override is applied on top
   of the restaurant-wide setting. This is the "Follows restaurant (→ On)" text. */
export function resolvedFor(person, permId) {
  const perm = PERM_BY_ID[permId];
  const l = lad(permId);
  let base;
  if (perm.kind === "locked") base = person.role !== "kitchen";
  else if (person.role === "owner") base = l.level >= 1;
  else if (person.role === "manager") base = l.level >= 2;
  else if (person.role === "tablet") base = l.level >= 3 && perm.waiter;
  else base = false;
  if (perm.gate && !gateOn(perm)) base = false;
  const ov = person.overrides[permId] || "default";
  const effective = ov === "on" || ov === "pin" ? true : ov === "off" ? false : base;
  return { base, effective, override: ov };
}

export function setOverride(person, permId, v) {
  if (v === "default") delete person.overrides[permId];
  else person.overrides[permId] = v;
  emit();
}

/* Sorted Owner → Manager → waiters → kitchen, as agreed. */
const ROLE_ORDER = { owner: 0, manager: 1, tablet: 2, kitchen: 3 };
export const sortedPeople = () =>
  [...state.r.people].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));

export const ROLE_LABEL = { owner: "Owner", manager: "Manager", tablet: "Waiter", kitchen: "Kitchen" };

/* Capabilities that make sense for this person's role. */
export function capsFor(person) {
  const ids = ROLE_RELEVANCE[person.role] || [];
  return ids.map((id) => PERM_BY_ID[id]).filter(Boolean).filter((p) => gateOn(p));
}

/* Who currently ends up with a capability — powers the "Who has this →" jump. */
export function holdersOf(permId) {
  return sortedPeople().filter((p) => (ROLE_RELEVANCE[p.role] || []).includes(permId) && resolvedFor(p, permId).effective);
}

/* ------------------------------------------------------------- summaries ---
   Used by every layout's browse view, so the at-a-glance state reads the same
   everywhere.                                                                */

export function summary(perm) {
  if (perm.kind === "switch") {
    return { tone: getSwitch(perm.id) ? "on" : "off", label: getSwitch(perm.id) ? "On" : "Off" };
  }
  if (perm.kind === "locked") {
    return { tone: "locked", label: "Always on for the manager" };
  }
  if (perm.gate && !gateOn(perm)) return { tone: "gated", label: "Not allowed for this restaurant" };
  const l = lad(perm.id);
  if (l.level === 0) return { tone: "off", label: "Off" };
  const nOwner = perm.sub ? perm.sub.filter((s) => l.owner[s.id]).length : 0;
  const nMgr = perm.sub ? perm.sub.filter((s) => l.manager[s.id]).length : 0;
  if (l.level === 1) return { tone: "owner", label: "Owner only", detail: perm.sub ? `${nOwner}/${perm.sub.length}` : "" };
  if (l.level === 2) return { tone: "both", label: "Owner + Manager", detail: perm.sub ? `${nOwner} · ${nMgr}` : "" };
  return { tone: "both", label: "Owner + Mgr + Tablet", detail: perm.sub ? `${nOwner} · ${nMgr}` : "" };
}

export function groupStats(gid) {
  const ps = permsOf(gid);
  const on = ps.filter((p) => {
    const s = summary(p);
    return s.tone === "on" || s.tone === "owner" || s.tone === "both" || s.tone === "locked";
  }).length;
  return { on, total: ps.length };
}
