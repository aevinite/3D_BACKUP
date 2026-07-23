/* icons.js — Lucide-style stroked SVG paths. No emoji anywhere in this panel. */

const P = {
  utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h1a2 2 0 0 0 2-2V2"/><path d="M6 11v11"/><path d="M17 2v20"/><path d="M17 12c2.2 0 4-1.8 4-4V2c-2.2 0-4 1.8-4 4"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  receipt: '<path d="M4 2v20l2.5-1.5L9 22l2.5-1.5L14 22l2.5-1.5L19 22V2l-2.5 1.5L14 2l-2.5 1.5L9 2 6.5 3.5z"/><path d="M8 8h8"/><path d="M8 12h6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  flame: '<path d="M12 2c1 4 4 5 4 9a4 4 0 0 1-8 0c0-1.5.5-2.5 1-3"/><path d="M12 22a6 6 0 0 0 6-6c0-2-1-4-2-5"/><path d="M12 22a6 6 0 0 1-6-6c0-1 .3-2 .8-2.8"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/><path d="M5 3l.6 1.4L7 5l-1.4.6L5 7l-.6-1.4L3 5l1.4-.6z"/>',
  chart: '<path d="M3 3v16.5A1.5 1.5 0 0 0 4.5 21H21"/><path d="M7 15l3.5-4 3 2.5L20 7"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M3 9h18"/><path d="M9 21V9"/>',
  sidebar: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M9 3v18"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-5"/><path d="M12 8h.01"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  chevronR: '<path d="M9 18l6-6-6-6"/>',
  alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  x: '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>',
  arrowL: '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
  arrowR: '<path d="M5 12h14"/><path d="M12 5l7 7-7 7"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2"/><path d="M17 6l3 3"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  crown: '<path d="M3 18h18"/><path d="M4 15L2 7l5.5 4L12 4l4.5 7L22 7l-2 8z"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0 5 5L21 20a2 2 0 0 1-3 3l-8.7-8.7a4 4 0 0 0-5-5L2 6l3-3z"/>',
  minus: '<path d="M5 12h14"/>',
  dot: '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
};

export function icon(name, cls = "ico") {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || P.dot}</svg>`;
}

/* Mock HD screenshot of a real panel with the relevant control ringed.
   The real captures land in public/admin-help/ at wiring time — this keeps the
   interaction (lazy load, ring, lightbox) honest while those are pending. */
const SHOTS = {
  "guest-menu": { t: [58, 22, 26, 9], l: "dish card" },
  "guest-dish": { t: [30, 55, 44, 12], l: "dish page" },
  "guest-3d": { t: [62, 62, 24, 10], l: "3D button" },
  "manager-menu": { t: [26, 20, 30, 8], l: "Dishes tab" },
  "manager-bill": { t: [55, 46, 32, 10], l: "bill actions" },
  "manager-khata": { t: [48, 58, 34, 10], l: "settle sheet" },
  "manager-kot": { t: [28, 18, 22, 8], l: "KOT menu" },
  "manager-floor": { t: [30, 36, 20, 14], l: "table tile" },
  "manager-takeorder": { t: [60, 30, 26, 10], l: "Take order" },
  "manager-banquet": { t: [24, 16, 24, 8], l: "Banquet tab" },
  "manager-dash": { t: [30, 26, 50, 22], l: "Dashboard" },
  "manager-ratings": { t: [30, 30, 46, 12], l: "Feedback" },
  "manager-log": { t: [28, 24, 52, 10], l: "Log tab" },
  "kitchen-print": { t: [34, 44, 40, 10], l: "Auto-print" },
  "kitchen-home": { t: [26, 20, 46, 30], l: "KDS board" },
  "tablet-bill": { t: [40, 62, 40, 12], l: "Mark paid" },
  "tablet-home": { t: [26, 26, 44, 26], l: "floor tiles" },
  "owner-staff": { t: [30, 34, 50, 12], l: "Staff & powers" },
  "owner-settings": { t: [30, 40, 48, 10], l: "Settings" },
  "owner-home": { t: [4, 30, 17, 8], l: "nav item" },
  "manager-home": { t: [26, 18, 50, 24], l: "manager panel" },
};

export function mockShot(key, note) {
  const s = SHOTS[key] || SHOTS["manager-home"];
  const [x, y, w, h] = s.t;
  const lines = [];
  for (let i = 0; i < 7; i++) {
    lines.push(`<i class="ln" style="left:${26 + (i % 2) * 4}%;top:${24 + i * 9}%;width:${28 + ((i * 13) % 34)}%"></i>`);
  }
  for (let i = 0; i < 5; i++) {
    lines.push(`<i class="ln" style="left:4%;top:${22 + i * 11}%;width:13%"></i>`);
  }
  return `<div class="mockshot" role="img" aria-label="Where this appears in the real panel: ${note || s.l}">
    <i class="bar"></i><i class="sidebar"></i>
    <i class="ln" style="left:3%;top:5%;width:11%;background:var(--gold);opacity:.7"></i>
    ${lines.join("")}
    <i class="target" style="left:${x}%;top:${y}%;width:${w}%;height:${h}%"></i>
    <i class="lbl" style="left:${x}%;top:calc(${y}% - 15px)">${note || s.l}</i>
  </div>`;
}
