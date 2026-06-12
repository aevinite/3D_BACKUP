# Kitchen panel (KDS)

The kitchen's own screen: live orders as **KOT tickets** (each with its shoutable
daily number) in three columns — **New → Cooking → Ready** — plus:

- one-tap **ACCEPT** per ticket, a **✓** per dish, **ALL READY** per ticket;
- allergies shouted in red on the ticket;
- the **86 board**: mark any dish sold-out / available without leaving the kitchen
  (with an UNDO toast instead of a popup — kitchens move fast);
- a chime on every brand-new order (mutable, remembered per device).

## Run it

```
cd kitchen
npm install
npm start       # → http://localhost:4002
```

Secrets come from real env vars or `../.env.local` (`NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`). Set `KITCHEN_PASSWORD` to lock it behind a login
page (do this before hosting it anywhere public). `KITCHEN_PORT` changes the port.
