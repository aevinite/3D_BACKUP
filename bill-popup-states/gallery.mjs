// Rebuild index.html from whatever is in shots/ + shots.json: `node bill-popup-states/gallery.mjs`
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
const OUT = new URL(".", import.meta.url).pathname;
const meta = JSON.parse(readFileSync(`${OUT}/shots.json`, "utf8"));
const files = readdirSync(`${OUT}/shots`).filter((f) => f.endsWith(".png")).sort();
const cap = Object.fromEntries(meta.shots.map((s) => [s.name, s.caption]));
const card = (f) => {
  const name = f.replace(/\.png$/, "");
  return `<figure class="c">
    <div class="shotwrap"><img src="shots/${f}" alt="${name}" loading="lazy"></div>
    <figcaption><b>${name.split("-")[0]} · ${name.replace(/^\d+-/, "").replace(/-/g, " ")}</b><span>${cap[name] || ""}</span></figcaption>
  </figure>`;
};
writeFileSync(`${OUT}/index.html`, readFileSync(`${OUT}/template.html`, "utf8")
  .replace("{{TABLE}}", meta.table)
  .replace("{{AT}}", new Date(meta.at).toLocaleString("en-IN"))
  .replace("{{CARDS}}", files.map(card).join("")));
console.log("index.html rebuilt with", files.length, "states");
