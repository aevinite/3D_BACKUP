/* =============================================================================
   layouts.js — five arrangements of the same permission set, plus the shared
   Per-person tab.
============================================================================= */

import {
  state, GROUPS, GROUP_BY_ID, PERMISSIONS, PERM_BY_ID, permsOf, summary, lad,
  gateOn, getSwitch, groupStats, sortedPeople, ROLE_LABEL, ROLE_RELEVANCE, capsFor, resolvedFor,
  setOverride, holdersOf, allConflicts,
} from "./data.js";
import { icon } from "./icons.js";
import { pill, permCard, renderSwitch, switchRow, renderFull, openSet, openDrawer, infoBtn } from "./controls.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const openSections = new Set(["guest"]);
export const masonFilter = new Set();
export let activeGroup = "guest";
export const setActiveGroup = (g) => { activeGroup = g; };

const isSwitchGroup = (gid) => permsOf(gid).every((p) => p.kind === "switch");
/* Section headings in the staff list — "Kitchen", not "Kitchens". */
const ROLE_GROUP = { owner: "Owner", manager: "Manager", tablet: "Waiters", kitchen: "Kitchen" };

/* ═════════════════════════════════════════ 1 · RAIL + ACCORDION ══════════ */

export function layoutRail() {
  const rail = GROUPS.map((g, i) => {
    const st = groupStats(g.id);
    const prev = GROUPS[i - 1];
    const sep = prev && prev.family !== g.family ? `<div class="rsep"></div>` : "";
    return sep + `<button class="railitem" data-act="railjump" data-g="${g.id}" aria-current="${activeGroup === g.id}">
      <span class="gicon" style="--h:${g.hue}">${icon(g.icon)}</span>
      <span class="nm">${esc(g.name)}</span>
      <span class="ct">${st.on}/${st.total}</span>
    </button>`;
  }).join("");

  const sections = GROUPS.map((g) => {
    const open = openSections.has(g.id);
    const st = groupStats(g.id);
    const ps = permsOf(g.id);
    const body = open ? `<div class="sbody">${
      ps.map((p) => (p.kind === "switch"
        ? `<div class="swblock">${renderSwitch(p)}</div>`
        : permCard(p, { icon: false }))).join("")
    }</div>` : "";
    return `<section class="sect ${open ? "is-open" : ""}" id="sect-${g.id}" data-g="${g.id}">
      <button class="sh" data-act="sect" data-g="${g.id}" aria-expanded="${open}">
        <span class="gicon gicon-lg" style="--h:${g.hue}">${icon(g.icon, "ico ico-lg")}</span>
        <span class="body"><h2>${esc(g.name)}</h2><span class="bl">${esc(g.blurb)}</span></span>
        <span class="row" style="gap:12px;flex:none">
          <span class="pill ${st.on ? "pill--owner" : "pill--off"}"><i class="led"></i>${st.on} of ${st.total} on</span>
          ${icon("chevron", "ico chev")}
        </span>
      </button>${body}</section>`;
  }).join("");

  return `<div class="L-rail">
    <nav class="rail" aria-label="Sections">
      <div class="rh">Areas</div>${rail}
    </nav>
    <div class="railmain">${sections}</div>
  </div>`;
}

/* ═══════════════════════════════════════════════════ 2 · BENTO ═══════════ */

/* Deliberate bento composition: the two long lists pair off on the top row, the
   three mid-size areas fill the next, the small ones the next, plumbing last.
   6 columns, so 3+3 / 2+2+2 / 2+2+2 / 3+3 each close a row exactly. */
const BENTO_SPAN = {
  guest: 3, money: 3, menu: 2, floor: 2, reports: 2,
  kitchen: 2, banquet: 2, staff: 2, panels: 3, ownersections: 3,
};
const BENTO_ORDER = ["guest", "money", "menu", "floor", "reports", "kitchen", "banquet", "staff", "panels", "ownersections"];

export function layoutBento() {
  const tiles = BENTO_ORDER.map((gid) => GROUP_BY_ID[gid]).map((g) => {
    const st = groupStats(g.id);
    const ps = permsOf(g.id);
    const pct = st.total ? Math.round((st.on / st.total) * 100) : 0;
    const items = ps.map((p) => {
      const s = summary(p);
      if (p.kind === "switch") {
        const on = getSwitch(p.id);
        return `<button class="bitem inline" data-act="switch" data-id="${p.id}" role="switch" aria-checked="${on}">
          <span class="nm">${esc(p.name)}</span>
          ${p.adminOnly ? `<span class="tag-admin">${icon("shield", "ico ico-sm")}</span>` : ""}
          <span class="sw" aria-hidden="true" ${on ? 'aria-checked="true"' : ""}></span>
        </button>`;
      }
      return `<button class="bitem" data-act="opendrawer" data-id="${p.id}">
        <i class="led ${s.tone}"></i>
        <span class="nm">${esc(p.name)}</span>
        <span class="st">${esc(s.label === "Owner + Manager" ? "OWN+MGR" : s.label === "Not allowed for this restaurant" ? "BLOCKED" : s.label === "Always on for the manager" ? "ALWAYS" : s.label.toUpperCase())}</span>
        ${icon("chevronR", "ico ico-sm")}
      </button>`;
    }).join("");

    return `<section class="bt bt-${BENTO_SPAN[g.id] || 2} ${ps.length > 6 ? "long" : ""}" style="--h:${g.hue}">
      <div class="bh">
        <span class="gicon" style="--h:${g.hue}">${icon(g.icon)}</span>
        <span class="body"><h2>${esc(g.name)}</h2><span class="bl">${esc(g.blurb)}</span></span>
        <span class="meter"><span class="bar"><i style="width:${pct}%"></i></span>${st.on}/${st.total}</span>
      </div>
      <div class="blist">${items}</div>
    </section>`;
  }).join("");
  return `<div class="L-bento">${tiles}</div>`;
}

/* ══════════════════════════════════════ 3 · NEWSPAPER / EDITORIAL ════════ */

export function layoutNews() {
  const r = state.r;
  const total = PERMISSIONS.length;
  const onCount = PERMISSIONS.filter((p) => ["on", "owner", "both", "locked"].includes(summary(p).tone)).length;

  const entry = (p) => {
    const s = summary(p);
    // gold = an owner rung is involved, green = a plain admin switch that is on.
    const cls = s.tone === "both" ? "both" : s.tone === "owner" ? "owner"
      : s.tone === "on" ? "on" : s.tone === "gated" ? "gated" : "";
    const short = s.label === "Owner + Manager" ? "Own+Mgr" : s.label === "Not allowed for this restaurant" ? "Blocked"
      : s.label === "Always on for the manager" ? "Always" : s.label;
    const act = p.kind === "switch" ? `data-act="switch" data-id="${p.id}"` : `data-act="opendrawer" data-id="${p.id}"`;
    return `<button class="entry" ${act}>
      <span class="nm">${esc(p.name)}<em>${esc(p.what.split(".")[0])}.</em></span>
      <span class="st ${cls}">${esc(short)}</span>
    </button>`;
  };

  const story = (g, n) => `<section class="story" id="sect-${g.id}">
      <div class="hd"><h3>${esc(g.name)}</h3><span class="no">${String(n).padStart(2, "0")}</span></div>
      <p class="lede">${esc(g.blurb)}</p>
      ${permsOf(g.id).map(entry).join("")}
    </section>`;

  const money = GROUP_BY_ID.money;
  const lead = `<section class="story lead" id="sect-money">
      <div class="hd"><h3>${esc(money.name)}</h3><span class="no">LEAD</span></div>
      <p class="lede">${esc(money.blurb)} Every one of these is written to the activity log with the reason the person typed.</p>
      <div class="cols">${permsOf("money").map(entry).join("")}</div>
    </section>`;

  const rest = GROUPS.filter((g) => g.id !== "money").map((g, i) => story(g, i + 1)).join("");

  return `<div class="L-news">
    <div class="masthead">
      <div class="kicker"><span>Access &amp; permissions</span><span>${esc(r.name)}</span><span>${onCount} of ${total} switched on</span></div>
      <h2>Who is allowed to do what</h2>
      <p class="dek">Every capability in the restaurant, the rung it sits on, and who currently holds it. Tap any line to change it.</p>
    </div>
    <div class="rulebar double"></div>
    ${lead}
    <div class="newscols">${rest}</div>
  </div>`;
}

/* ══════════════════════════════════════ 4 · MASONRY CARD-CLUSTER ═════════ */

export function layoutMason() {
  const active = masonFilter.size ? [...masonFilter] : null;
  const chips = `<button class="fchip all" data-act="mfilter" data-g="__all"
      aria-pressed="${!active}">${icon("grid", "ico ico-sm")} Everything <span class="n">${PERMISSIONS.length}</span></button>` +
    GROUPS.map((g) => {
      const st = groupStats(g.id);
      return `<button class="fchip" style="--h:${g.hue}" data-act="mfilter" data-g="${g.id}"
        aria-pressed="${active && masonFilter.has(g.id)}">${icon(g.icon, "ico ico-sm")} ${esc(g.name)}
        <span class="n">${st.on}/${st.total}</span></button>`;
    }).join("");

  const list = PERMISSIONS.filter((p) => !active || masonFilter.has(p.group));
  const cards = list.map((p) => {
    const g = GROUP_BY_ID[p.group];
    const open = openSet.has(p.id);
    if (p.kind === "switch") {
      const on = getSwitch(p.id);
      return `<article class="mcard" style="--h:${g.hue}">
        <button class="mh" data-act="switch" data-id="${p.id}" role="switch" aria-checked="${on}">
          <span class="body">
            <span class="gp">${esc(g.name)}</span>
            <span class="nm">${esc(p.name)} ${p.adminOnly ? `<span class="tag-admin">${icon("shield", "ico ico-sm")}Admin</span>` : ""}</span>
            <span class="ds">${esc(p.what)}</span>
          </span>
          <span class="sw" aria-hidden="true" ${on ? 'aria-checked="true"' : ""}></span>
        </button>
        ${on && p.sub ? `<div class="mbody" style="padding-top:10px">${
          p.sub.map((s) => switchRow(p.id, s.id, s.name, "", getSwitch(s.id))).join("")
        }</div>` : ""}
      </article>`;
    }
    return `<article class="mcard ${open ? "is-open" : ""}" style="--h:${g.hue}" id="card-${p.id}">
      <button class="mh" data-act="toggle" data-id="${p.id}" aria-expanded="${open}">
        <span class="body">
          <span class="gp">${esc(g.name)}</span>
          <span class="nm">${esc(p.name)}</span>
          <span class="ds">${esc(p.what)}</span>
        </span>
        ${icon("chevron", "ico chev")}
      </button>
      ${open ? `<div class="mbody">${renderFull(p)}</div>` : `<div class="mfoot">${pill(p)}${p.sub ? `<span class="muted" style="font-size:11.5px">${p.sub.length} options inside</span>` : ""}</div>`}
    </article>`;
  }).join("");

  return `<div class="L-mason">
    <div class="filters">${chips}</div>
    <div class="mason">${cards}</div>
  </div>`;
}

/* ═════════════════════════════════════ 5 · COMMAND-CENTRE MATRIX ═════════ */

export function layoutMatrix() {
  const conf = allConflicts();
  const ladders = PERMISSIONS.filter((p) => p.kind !== "switch");
  const delegated = ladders.filter((p) => lad(p.id).level === 2).length;
  const ownerOnly = ladders.filter((p) => lad(p.id).level === 1).length;
  const blocked = PERMISSIONS.filter((p) => summary(p).tone === "gated").length;
  const waiterOn = ladders.filter((p) => p.waiter && lad(p.id).waiter && lad(p.id).waiter !== "off").length;

  const hud = `<div class="hud">
    <div class="hudbox gold"><div class="k">Owner + Manager</div><div class="v">${delegated}<small> / ${ladders.length}</small></div></div>
    <div class="hudbox"><div class="k">Owner only</div><div class="v">${ownerOnly}</div></div>
    <div class="hudbox good"><div class="k">Waiters hold</div><div class="v">${waiterOn}</div></div>
    <div class="hudbox"><div class="k">Admin blocked</div><div class="v">${blocked}</div></div>
    <div class="hudbox ${conf.length ? "warn" : "good"}"><div class="k">Conflicts</div><div class="v">${conf.length}</div></div>
  </div>`;

  const nav = GROUPS.map((g) => {
    const st = groupStats(g.id);
    return `<button data-act="railjump" data-g="${g.id}" aria-current="${activeGroup === g.id}">
      ${icon(g.icon, "ico ico-sm")} ${esc(g.name)} <span class="k">${st.on}/${st.total}</span></button>`;
  }).join("");

  const cell = (cls, txt, title) => `<span class="cell ${cls}"${title ? ` title="${esc(title)}"` : ""}>${txt}</span>`;

  const rows = GROUPS.map((g) => {
    const head = `<tr class="grouprow" id="sect-${g.id}" style="--h:${g.hue}"><td colspan="5">${esc(g.name)}</td></tr>`;
    const body = permsOf(g.id).map((p) => {
      const l = lad(p.id);
      const hasConf = conf.includes(p);
      let admin, owner, mgr, waiter;
      if (p.kind === "switch") {
        const on = getSwitch(p.id);
        admin = cell(on ? "y" : "n", on ? "ON" : "OFF");
        owner = mgr = waiter = cell("dash", "—", "Not delegated — this is an admin switch");
      } else if (p.kind === "locked") {
        admin = cell("y", "ON");
        owner = cell("g", "YES");
        mgr = cell("p", "ALWAYS", "Permanent — the owner cannot remove it");
        waiter = cell(l.waiter === "off" ? "n" : "y", (l.waiter || "off").toUpperCase());
      } else {
        admin = p.gate ? cell(gateOn(p) ? "y" : "x", gateOn(p) ? "ALLOW" : "BLOCK") : cell("dash", "—", "No admin gate — the owner inherently has this");
        if (p.gate && !gateOn(p)) {
          owner = mgr = waiter = cell("n", "—");
        } else {
          owner = cell(l.level >= 1 ? "g" : "n", l.level >= 1 ? "YES" : "NO");
          mgr = cell(l.level >= 2 ? "y" : "n", l.level >= 2 ? "YES" : "NO");
          waiter = p.waiter
            ? (l.level < 3 ? cell("n", "—")
                : cell(l.waiter === "pin" ? "p" : "y", l.waiter === "pin" ? "PIN" : "ON"))
            : cell("dash", "—", "Not a waiter capability");
        }
      }
      const nSub = p.sub ? ` · ${p.sub.filter((s) => l.owner && l.owner[s.id]).length}/${p.sub.length} options` : "";
      return `<tr class="${hasConf ? "has-conflict" : ""}" data-act="opendrawer" data-id="${p.id}" tabindex="0">
        <td class="nm">${esc(p.name)}${p.adminOnly ? ` <span class="tag-admin">${icon("shield", "ico ico-sm")}Admin</span>` : ""}
          <small>${esc(p.what.split(".")[0])}.${p.kind !== "switch" ? esc(nSub) : ""}</small></td>
        <td class="c">${admin}</td><td class="c">${owner}</td><td class="c">${mgr}</td><td class="c">${waiter}</td>
      </tr>`;
    }).join("");
    return head + body;
  }).join("");

  return `<div class="L-matrix">
    <nav class="mx-nav" aria-label="Jump to area">${nav}</nav>
    <div>${hud}
      <div class="mx"><div class="mx-wrap"><table class="mxgrid">
        <thead><tr>
          <th>Capability</th><th class="c">Admin</th><th class="c">Owner</th><th class="c">Manager</th><th class="c">Waiter</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="mxlegend">
        <span>${cell("y", "YES")} in force</span>
        <span>${cell("g", "YES")} owner rung</span>
        <span>${cell("p", "PIN")} needs a PIN</span>
        <span>${cell("x", "BLOCK")} admin has not allowed it</span>
        <span>${cell("dash", "—")} does not apply</span>
        <span style="margin-left:auto">Tap any row for the detail</span>
      </div></div>
    </div>
  </div>`;
}

/* ═════════════════════════════════════════════ shared · PER PERSON ═══════ */

export function layoutPerson() {
  const people = sortedPeople();
  if (!state.personId) state.personId = people[0].id;
  const person = people.find((p) => p.id === state.personId) || people[0];

  let lastRole = null;
  const list = people.map((p) => {
    const n = Object.keys(p.overrides).length;
    const hd = p.role !== lastRole ? `<div class="prole">${ROLE_GROUP[p.role]}</div>` : "";
    lastRole = p.role;
    return hd + `<button class="prow" data-act="person" data-id="${p.id}" aria-current="${p.id === person.id}">
      <span class="av">${esc(p.name.split(" ").map((w) => w[0]).join("").slice(0, 2))}</span>
      <span style="flex:1;min-width:0"><span class="nm">${esc(p.name)}</span><span class="mt">${esc(p.since)}</span></span>
      ${n ? `<span class="ovr">${n}</span>` : ""}
    </button>`;
  }).join("");

  // Per-person override control (Default / On / Off, + On-with-PIN for a tablet
  // person on a tablet-capable power).
  const triFor = (subject, perm) => {
    const { base, override } = resolvedFor(subject, perm.id);
    const pinnable = subject.role === "tablet" && perm.waiter;
    const opts = [
      ["default", `Follows restaurant`, base ? "ON" : "OFF"],
      ["on", "On", ""],
      ...(pinnable ? [["pin", "On, PIN", ""]] : []),
      ["off", "Off", ""],
    ];
    return `<div class="tri3" role="radiogroup" aria-label="${esc(perm.name)} for ${esc(subject.name)}">
      ${opts.map(([v, lbl, res]) => `<button data-act="ov" data-p="${subject.id}" data-id="${perm.id}" data-v="${v}"
        role="radio" aria-checked="${override === v || (v === "on" && override === "pin" && !pinnable)}" data-v="${v}">${
        v === "on" ? icon("check", "ico ico-sm") : v === "off" ? icon("minus", "ico ico-sm") : v === "pin" ? icon("key", "ico ico-sm") : ""
      }${lbl}${res ? ` <span class="res">${res}</span>` : ""}</button>`).join("")}
    </div>`;
  };

  /* ---- "Who has this?" mode: EVERY relevant person listed for ONE capability --- */
  if (state.personFilter) {
    const perm = PERM_BY_ID[state.personFilter];
    const relevant = people.filter((p) => (ROLE_RELEVANCE[p.role] || []).includes(perm.id));
    const holders = relevant.filter((p) => resolvedFor(p, perm.id).effective);
    const rows = relevant.map((p) => {
      const { effective, override } = resolvedFor(p, perm.id);
      return `<div class="caprow ${effective ? "is-hi" : ""}">
        <span class="av" style="width:34px;height:34px;border-radius:10px;display:grid;place-items:center;font:700 12px/1 var(--font);flex:none;background:var(--s3);border:1px solid var(--line2)">${esc(p.name.split(" ").map((w) => w[0]).join("").slice(0, 2))}</span>
        <span class="body">
          <span class="nm">${esc(p.name)} <span class="pill ${effective ? "pill--on" : "pill--off"}" style="height:20px"><i class="led"></i>${effective ? "Has it" : "Does not"}</span></span>
          <span class="ds">${ROLE_LABEL[p.role]} · ${override === "default" ? "follows the restaurant setting" : `<b style="color:var(--gold-hi)">overridden to ${override.toUpperCase()}</b>`}</span>
        </span>
        ${triFor(p, perm)}
      </div>`;
    }).join("");
    return `<div class="pp">
      <nav class="plist" aria-label="Staff">
        <div class="ph">${people.length} people · owner first</div>${list}
      </nav>
      <div class="pdetail">
        <div class="filterbar">${icon("users", "ico ico-sm")}
          Who has <b>${esc(perm.name)}</b> right now — <b>${holders.length}</b> of ${relevant.length} people
          <button data-act="clearfilter">Back to a single person</button></div>
        <div class="hint" style="padding:12px 20px;margin:0">${icon("info")}<span>This is the live list of everyone who can use this. Change the restaurant-wide default in <b>General</b>; use the buttons here to force it on or off for one person.</span></div>
        ${rows || `<div class="emptyp">${icon("shield", "ico")}<p>Nobody can use this yet.</p></div>`}
      </div>
    </div>`;
  }

  /* ---- normal mode: one person, all their capabilities --- */
  const caps = capsFor(person);
  let lastGroup = null;
  const rows = caps.length ? caps.map((p) => {
    const { base, override } = resolvedFor(person, p.id);
    const hd = p.group !== lastGroup ? `<div class="capgrp">${esc(GROUP_BY_ID[p.group].name)}</div>` : "";
    lastGroup = p.group;
    return hd + `<div class="caprow">
      <span class="body">
        <span class="nm">${esc(p.name)} ${infoBtn(p.id)}</span>
        <span class="ds">${override === "default"
          ? `Follows the restaurant setting — currently <b style="color:${base ? "var(--ok)" : "var(--tx2)"}">${base ? "on" : "off"}</b> for a ${ROLE_LABEL[person.role].toLowerCase()}. <button class="lnk" data-act="whofromperson" data-id="${p.id}">change the default →</button></span>`
          : `Overridden for ${esc(person.name.split(" ")[0])} — the restaurant setting says ${base ? "on" : "off"}.`}</span>
      </span>
      ${triFor(person, p)}
    </div>`;
  }).join("") : `<div class="emptyp">${icon("shield", "ico")}<p>Nothing here applies to a ${ROLE_LABEL[person.role].toLowerCase()}.</p></div>`;

  const nOv = Object.keys(person.overrides).length;

  return `<div class="pp">
    <nav class="plist" aria-label="Staff">
      <div class="ph">${people.length} people · owner first</div>${list}
    </nav>
    <div class="pdetail">
      <div class="pdhead">
        <span class="av">${esc(person.name.split(" ").map((w) => w[0]).join("").slice(0, 2))}</span>
        <span style="flex:1;min-width:0"><h3>${esc(person.name)}</h3><span class="mt">${ROLE_LABEL[person.role]} · ${esc(person.since)}</span></span>
        ${nOv ? `<button class="reset" data-act="resetov" data-p="${person.id}">${icon("reset", "ico ico-sm")} Clear ${nOv} override${nOv > 1 ? "s" : ""}</button>` : `<span class="pill pill--off"><i class="led"></i>No overrides — follows the restaurant</span>`}
      </div>
      ${rows}
    </div>
  </div>`;
}
