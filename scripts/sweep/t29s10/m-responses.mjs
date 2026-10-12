// Section M (round 2) — HOW EVERY ROUTE ANSWERS: the right kind of answer, a password-bearing answer
// never stored, and an error answer that carries a sentence and never our own code text.
const GETS = (FH, mgr) => [
  ["repair", `/api/admin/repair?restaurant_id=${FH}`, "json"],
  ["restaurants/access-tree", `/api/admin/restaurants/access-tree?restaurant_id=${FH}`, "json"],
  ["restaurants/bill-preview", `/api/admin/restaurants/bill-preview?rid=${FH}&mode=bill`, "html"],
  ["restaurants/branding", `/api/admin/restaurants/branding?restaurant_id=${FH}`, "json"],
  ["restaurants/create-defaults", "/api/admin/restaurants/create-defaults", "json"],
  ["restaurants/credentials", `/api/admin/restaurants/credentials?restaurant_id=${FH}`, "json", "secret"],
  ["restaurants/health", "/api/admin/restaurants/health", "json"],
  ["restaurants/quick-features", `/api/admin/restaurants/quick-features?restaurant_id=${FH}`, "json"],
  ["restaurants/report", `/api/admin/restaurants/report?restaurant_id=${FH}&range=7d`, "json"],
  ["restaurants", "/api/admin/restaurants", "json"],
  ["restaurants/settings", `/api/admin/restaurants/settings?restaurant_id=${FH}`, "json"],
  ["reveal", "/api/admin/reveal", "json", "secret"],
  ["revenue", "/api/admin/revenue", "json"],
  ["settings", "/api/admin/settings", "json"],
  ["staff-online", "/api/admin/staff-online", "json"],
  ["usage", "/api/admin/usage", "json"],
  ["users", "/api/admin/users", "json"],
  ["users (one person)", `/api/admin/users?id=${mgr}`, "json"],
];
// The same routes asked something they must refuse — a malformed id where they take one.
const BAD = {
  "repair": "/api/admin/repair?restaurant_id=nope", "restaurants/access-tree": "/api/admin/restaurants/access-tree?restaurant_id=nope",
  "restaurants/bill-preview": "/api/admin/restaurants/bill-preview?mode=bill", "restaurants/branding": "/api/admin/restaurants/branding?restaurant_id=nope",
  "restaurants/credentials": "/api/admin/restaurants/credentials?restaurant_id=nope", "restaurants/quick-features": "/api/admin/restaurants/quick-features?restaurant_id=nope",
  "restaurants/report": "/api/admin/restaurants/report?restaurant_id=nope", "restaurants/settings": "/api/admin/restaurants/settings?restaurant_id=nope",
  "restaurants": "/api/admin/restaurants?bin_detail=nope", "users (one person)": "/api/admin/users?id=nope", "usage": "/api/admin/usage?from=2026-02-31&to=2026-03-01",
};
const CODE_TEXT = /\bat [A-Za-z_$][\w$.]*\s*\(|\.tsx?:\d+|node_modules|TypeError|ReferenceError|PostgrestError|stack/;

export default function section(c) {
  let mgrId = null;
  const mgr = async () => (mgrId ||= (await c.sq(`staff_users?select=id&restaurant_id=eq.${c.FH}&role=eq.manager&deleted_at=is.null&limit=1`)).json[0].id);
  const get = async (k, url) => (c.cache[`m${k}`] ||= await c.req(url));
  const list = GETS(c.FH, "MGR");

  c.sec("M · every read answers in the right kind of document");
  for (const [k, , kind] of list) c.phase(`${k} — answers ${kind === "html" ? "a web page (it opens in its own window)" : "JSON"}, 200`,
    "GET it signed in; read the status and content-type", async () => {
      const url = list.find((x) => x[0] === k)[1].replace("MGR", await mgr());
      const r = await get(k, url);
      const ct = r.headers.get("content-type") || "";
      return r.status === 200 && (kind === "html" ? /text\/html/.test(ct) : /application\/json/.test(ct)) || `${r.status} ${ct}`;
    });

  c.sec("M · an answer that can carry a password is never stored (items 27 + 28)");
  for (const [k, , , secret] of list) c.phase(`${k} — ${secret ? "says Cache-Control: no-store" : "keeps the normal caching (the console still opens offline)"}`,
    "read the Cache-Control header", async () => {
      const url = list.find((x) => x[0] === k)[1].replace("MGR", await mgr());
      const cc = ((await get(k, url)).headers.get("cache-control") || "").toLowerCase();
      return secret ? /no-store/.test(cc) || `cache-control: ${cc || "(none)"}` : !/no-store/.test(cc) || k === "restaurants/bill-preview" || `unexpectedly no-store: ${cc}`;
    });

  c.sec("M · a refusal is a sentence, never our own code text");
  for (const [k] of list) c.phase(`${k} — ${BAD[k] ? "a malformed input is refused with a sentence and no code text" : "its answer carries no code text anywhere"}`,
    BAD[k] ? `GET ${BAD[k]}` : "scan the whole signed-in answer", async () => {
      if (!BAD[k]) { const url = list.find((x) => x[0] === k)[1].replace("MGR", await mgr()); const t = (await get(k, url)).text; return !CODE_TEXT.test(t) || "code text in the answer"; }
      const r = await c.req(BAD[k]);
      const sentence = /text\/html/.test(r.headers.get("content-type") || "") ? r.text.replace(/<[^>]+>/g, " ").trim() : r.json?.error;
      return r.status >= 400 && r.status < 500 && typeof sentence === "string" && sentence.length > 8 && !CODE_TEXT.test(r.text) || `${r.status} ${r.text.slice(0, 80)}`;
    });
}
