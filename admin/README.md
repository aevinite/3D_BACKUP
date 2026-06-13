# Admin control room

The owner's master panel — one place that holds every key and every power. Runs
**locally on :4004**. Single restaurant, no login for now (it's `ADMIN_PASSWORD`-
lockable for the day it's hosted).

## What it does

- **Top switcher** — flip between all four panels embedded in one window:
  Admin (home) · Menu · Editor · Kitchen · Tablet. Tap a panel to open it; tap
  its tab again (or "Admin") to come back to the control room. Each tab shows a
  green/red dot for whether that panel's server is up.
- **Cockpit (home)** — live numbers (open tables, active orders, unpaid bills,
  revenue today), the restaurant's settings at a glance, and quick-launch cards.
- **Maintenance switch** — one toggle (with an are-you-sure) flips
  `settings.service_mode`, which instantly swaps the guest menu for the
  "we'll be right back" screen. Staff panels keep working. Turn it off to reopen.
- Deep management (dishes, orders, floor, dashboard, customers, feature
  switches) lives in the **Editor**, opened right here in the switcher.

## Run it

```
cd admin
npm install
npm start        # → http://localhost:4004
```

Needs the four panels running (menu :4000, editor :4001, kitchen :4002,
tablet :4003) to embed them. Secrets come from real env vars or `../.env.local`.
`ADMIN_PORT` changes the port; panel URLs can be overridden with `MENU_URL`,
`EDITOR_URL`, `KITCHEN_URL`, `TABLET_URL` (useful once they're hosted).
