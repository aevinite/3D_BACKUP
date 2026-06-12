# Waiter tablet (captain app)

The waiter's screen for the dining floor:

- **live floor** — one tile per table with its state (free / seated / new order /
  cooking / served) and badges for waiter calls 🔔 and join requests 🙋;
- tap a table → attend calls, approve joiners, open the table, see its orders;
- **📝 TAKE ORDER** — when a guest wants to order through the waiter: category
  chips → tap dishes → quantities → optional kitchen note → are-you-sure →
  sent to the kitchen with its KOT number. Prices are computed by the SERVER
  (same rules as guest orders: sold-out rejected, DB prices only).

## Run it

```
cd tablet
npm install
npm start       # → http://localhost:4003
```

Secrets come from real env vars or `../.env.local`. Set `TABLET_PASSWORD` to lock
it behind a login page before hosting it. `TABLET_PORT` changes the port.
