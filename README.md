# Aevidine — a multi-tenant restaurant OS

One Next.js app that runs a whole restaurant: the diner's menu (with a 3D dish viewer), the
manager's floor, the kitchen screen, the waiter's tablet, the owner's reports and the admin console
— for many restaurants at once, out of one codebase and one database.

> **If you are an AI assistant working in this repo, read `CLAUDE.md` first.** It is the rulebook,
> it is short on purpose, and every rule's full text is in `docs/CLAUDE-DETAIL.md` under the same
> heading. This README is the human's five-minute orientation.

---

## Run it

```bash
npm install
npm run dev            # http://localhost:4000   ← 4000, not 3000
```

You need `.env.local` in the repo root (it is gitignored — ask the owner for it). Without it the
app boots but every read fails, and the scripts that talk to the database refuse to start.

`npm run build` runs a production build. `npm start` serves it, also on 4000.

## The six surfaces, and where each one's code is

It is **one app on one port**. Every "panel" is a route, not a separate server.

| What | URL | Who uses it | Its code |
|---|---|---|---|
| Guest menu | `/menu`, `/r/<slug>/menu`, `/q/<code>` | the diner, on their phone | `app/menu`, `app/r/[restaurant]`, `app/q/[code]`, `components/*` |
| Manager panel | `/manager` (and `/editor`) | the manager: floor, bills, menu editing | `public/panels/editor/app.js`, loaded in an iframe |
| Kitchen panel | `/kitchen` | the cooks | `public/panels/kitchen/*` |
| Tablet panel | `/tablet` | the waiter, walking the floor | `public/panels/tablet/*` |
| Owner panel | `/owner/…` (16 pages) | the owner: reports, staff, settings | `app/owner/*`, `components/owner/*` |
| Admin console | `/aevinite/…` (23 pages) | us: every restaurant, every switch | `app/aevinite/*` |
| Printed paper | — | the bill and the kitchen ticket | `public/panels/billdoc.js` — one file for both |

**Three of those panels are plain HTML+JS in `public/panels/`, not React.** That surprises people.
A "manager panel bug" almost always means editing `public/panels/editor/app.js`. Those files are
served as static assets and cache-busted by a content hash (`app.js?v=<hash>`), which
`npm run verify:panel-cache` keeps honest — a stale hash is how staff once ran a weeks-old panel.

Panel APIs live at `app/api/<panel>/[...path]/route.ts`. The owner's at `app/api/owner/*`, the
admin's at `app/api/admin/*`.

## There is no `middleware.ts`, and that is deliberate

The login check moved to each route: the admin console's layout and all 50 `/api/admin/*` handlers
check `tokenIsValid`, the panel APIs use `requireRole()`, the owner's use `ownerScope()`. Looking
for a middleware file finds nothing and makes it look like the gate is missing — it isn't.
The complete list of the few deliberately login-free routes is in `docs/CLAUDE-DETAIL.md`
under "Security gate".

## Two stacks — get this right before you touch anything

| | **AV LIVE** (paying restaurants) | **this folder — DEV/TEST** |
|---|---|---|
| Folder | `~/Documents/LIVE_PROJECTS/3D_Menu_Av` | `~/Documents/Projects/backup_Menu` |
| Deploys to | aevinite.shop | `3-d-backup.vercel.app` |
| Database | its own | its own (`.env.local`) |

**Build and break things freely here — that is what this stack is for.** AV live is read-only by
default and every single change to it needs the owner to ask for it in his own words. The full rule,
including what does and does not count as permission, is the first thing in `CLAUDE.md`.

## Before you push

```bash
npm run verify:push
```

That runs type-check, lint, the unit tests, the static guards and the access model — about 90
seconds, no database, no login. CI (`.github/workflows/checks.yml`) runs all of those **plus two
more**, so a green run here is necessary but not sufficient:

- `npm run verify:deps` — the only check that needs the network (it asks npm for the current
  advisory list), which is why it is not in the offline `verify:static` set. It fails only on a
  **new** high or critical advisory.
- `node .github/scripts/verify-doc-counts.mjs` — the counts in `CLAUDE.md`, `README.md`,
  `docs/CLAUDE-DETAIL.md`, `docs/GUARD-MAP.md` and `docs/SECURITY-CHECKLIST.md` must match the code
  they describe.

Run those two as well before you push and the local answer really is the CI answer.

There are 148 `verify:*` scripts in all, one per bug that once reached somebody's screen.
**`docs/GUARD-MAP.md` tells you which ones your change needs** — look up the file you touched.

Do **not** run `npm run verify:everything` casually: it is the 500-phase suite, it writes to the
shared database, it takes ~40 minutes and only one run is allowed at a time.

## Where to read next

| You want to… | Read |
|---|---|
| know the rules before changing code | `CLAUDE.md`, then `docs/CLAUDE-DETAIL.md` |
| know which check covers your change | `docs/GUARD-MAP.md` |
| find any document at all | `docs/README.md` |
| know what the owner has already refused | `docs/REJECTED-IDEAS.md` — read it *before* suggesting |
| see what is still owed | `.claude/REQUESTS.md` |
| understand how a feature must be built | `CLAUDE.md` → the 11-point module checklist |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind 4 · GSAP · Supabase (Postgres +
Storage + realtime) · `<model-viewer>` for the 3D dishes · deployed on Vercel.

One shared database, one row per tenant carrying `restaurant_id`, isolation enforced at the database
level. Migrations live in `supabase/migrations/` and that folder is the source of truth for **both**
stacks.
