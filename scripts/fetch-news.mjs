// Runs inside GitHub Actions: for each "anything" season prediction that hasn't been decided,
// searches Google News (RSS, no key needed) and saves likely matches to data/news-<year>.json.
// The admin then confirms on the site whether the prediction came true.
//
// Predictions are read from Firestore's public REST endpoint (the rules allow anyone to read them).
// Runs at most once every NEWS_REFRESH_HOURS (default 20), so roughly once a day.

import { readFile, writeFile } from "node:fs/promises";
import { parseRss, headlineMatches } from "../js/bold.js";

const file = p => new URL(`../${p}`, import.meta.url);
const config = await readFile(file("js/config.js"), "utf8");
const pick = re => config.match(re)?.[1];
const year = parseInt(pick(/currentSeason:\s*(\d{4})/), 10);
const apiKey = pick(/apiKey:\s*"([^"]*)"/), projectId = pick(/projectId:\s*"([^"]*)"/);
if (!apiKey || !projectId) { console.log("Firebase not configured: skipping news."); process.exit(0); }
const refreshHours = Number(process.env.NEWS_REFRESH_HOURS) || 20;

let store = { year, fetchedAt: null, items: {} };
try { store = JSON.parse(await readFile(file(`data/news-${year}.json`), "utf8")); } catch {}
const now = Date.now();
if (store.fetchedAt && now - Date.parse(store.fetchedAt) < refreshHours * 3600e3 - 600e3) {
  console.log(`News fetched ${store.fetchedAt}; next search after ${refreshHours}h.`); process.exit(0);
}

// ── read predictions ──
const val = v => v == null ? null : "stringValue" in v ? v.stringValue : "integerValue" in v ? +v.integerValue
  : "arrayValue" in v ? (v.arrayValue.values || []).map(val) : "timestampValue" in v ? v.timestampValue : null;
const preds = [];
let pageToken = "";
do {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/seasons/${year}/predictions?pageSize=300&key=${apiKey}${pageToken ? `&pageToken=${pageToken}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) { console.error(`Firestore: HTTP ${res.status} ${await res.text()}`); process.exit(1); }
  const body = await res.json();
  for (const d of body.documents || []) {
    const f = Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, val(v)]));
    preds.push({ id: d.name.split("/").pop(), ...f });
  }
  pageToken = body.nextPageToken || "";
} while (pageToken);

const open = preds.filter(p => p.kind === "free" && (p.status || "pending") === "pending" && p.keywords?.length);
console.log(`${preds.length} predictions, ${open.length} to search`);

// ── search ──
const items = {};
for (const p of open) {
  const q = `${p.keywords.map(k => (k.includes(" ") ? `"${k}"` : k)).join(" ")} AFL`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-AU&gl=AU&ceid=AU:en`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; afl-predictions-comp)" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const found = parseRss(await res.text()).filter(i => headlineMatches(i.title, p.keywords));
    const merged = [...found, ...(store.items[p.id] || [])];
    const seen = new Set();
    items[p.id] = merged.filter(i => !seen.has(i.title) && seen.add(i.title))
      .sort((a, b) => Date.parse(b.published || 0) - Date.parse(a.published || 0))
      .slice(0, 8);
    console.log(`  ${p.id}: ${found.length} match(es) for ${q}`);
  } catch (e) {
    items[p.id] = store.items[p.id] || [];
    console.warn(`  ${p.id}: search failed (${e.message})`);
  }
  await new Promise(r => setTimeout(r, 1500)); // be gentle
}
// keep results for decided predictions so their evidence stays visible
for (const [id, list] of Object.entries(store.items || {})) if (!(id in items) && preds.some(p => p.id === id)) items[id] = list;

await writeFile(file(`data/news-${year}.json`), JSON.stringify({ year, fetchedAt: new Date(now).toISOString(), items }) + "\n");
console.log("Saved news matches.");
