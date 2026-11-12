// Runs inside GitHub Actions after fetch-results.mjs: pulls AFL odds from The Odds API
// (https://the-odds-api.com) and appends a snapshot per game to data/odds-<year>.json.
//
// The history file is committed back to the repository by the workflow, so every pick can be
// priced at the odds that were showing when it was made.
//
// Credits: each call costs 3 (h2h + line + total, AU bookmakers). To stay inside a free plan
// it only calls when a game starts within the next 8 days, and at most once every
// ODDS_REFRESH_HOURS (default 6), i.e. about 360 credits a month in season.

import { readFile, writeFile } from "node:fs/promises";
import { canonical } from "../js/teams.js";

const key = (process.env.ODDS_API_KEY || "").trim();
if (!key) { console.log("ODDS_API_KEY not set: skipping odds."); process.exit(0); }
const refreshHours = Number(process.env.ODDS_REFRESH_HOURS) || 6;   // blank or 0 → 6

const file = p => new URL(`../${p}`, import.meta.url);
const config = await readFile(file("js/config.js"), "utf8");
const year = parseInt(config.match(/currentSeason:\s*(\d{4})/)[1], 10);

let games = [];
try {
  const d = JSON.parse(await readFile(file(`data/games-${year}.json`), "utf8"));
  games = d.rows ? d.rows.map(r => Object.fromEntries(d.cols.map((c, i) => [c, r[i]]))) : d.games;
} catch { console.log(`No data/games-${year}.json yet: skipping odds.`); process.exit(0); }

let store = { year, fetchedAt: null, games: {} };
try { store = JSON.parse(await readFile(file(`data/odds-${year}.json`), "utf8")); } catch {}

const now = Date.now() / 1000;
const upcoming = games.filter(g => g.complete !== 100 && g.unixtime > now && g.unixtime < now + 8 * 86400);
if (!upcoming.length) { console.log("No games in the next 8 days: skipping odds."); process.exit(0); }
if (store.fetchedAt && now - Date.parse(store.fetchedAt) / 1000 < refreshHours * 3600 - 300) {
  console.log(`Odds fetched ${store.fetchedAt}; next refresh after ${refreshHours}h.`); process.exit(0);
}

const url = `https://api.the-odds-api.com/v4/sports/aussierules_afl/odds?regions=au&markets=h2h,spreads,totals&oddsFormat=decimal&apiKey=${encodeURIComponent(key)}`;
const res = await fetch(url);
if (!res.ok) { console.error(`The Odds API: HTTP ${res.status} ${await res.text()}`); process.exit(1); }
const events = await res.json();
console.log(`The Odds API: ${events.length} events, credits remaining ${res.headers.get("x-requests-remaining")}`);

// "Greater Western Sydney Giants" → "Greater Western Sydney", "Geelong Cats" → "Geelong", ...
const teamOf = n => canonical(n) || canonical(n.split(" ").slice(0, -1).join(" ")) || canonical(n.split(" ").pop());
const median = xs => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return +(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(2); };
const mode = xs => { const c = {}; let best = null; for (const x of xs) { c[x] = (c[x] || 0) + 1; if (best === null || c[x] > c[best]) best = x; } return best === null ? null : +best; };

let added = 0;
for (const ev of events) {
  const eh = teamOf(ev.home_team), ea = teamOf(ev.away_team), t = Date.parse(ev.commence_time) / 1000;
  const g = games.find(x => !x.is_final && x.complete !== 100 && Math.abs(x.unixtime - t) < 2 * 86400 &&
    ((x.hteam === eh && x.ateam === ea) || (x.hteam === ea && x.ateam === eh)));
  if (!g) { console.log(`  unmatched: ${ev.home_team} v ${ev.away_team}`); continue; }
  const home = g.hteam, away = g.ateam; // always relative to Squiggle's home team

  const h2h = { home: [], away: [] }, spreads = [], totals = [];
  for (const bk of ev.bookmakers || []) for (const m of bk.markets || []) {
    if (m.key === "h2h") for (const o of m.outcomes) { const tm = teamOf(o.name); if (tm === home) h2h.home.push(o.price); if (tm === away) h2h.away.push(o.price); }
    if (m.key === "spreads") {
      const h = m.outcomes.find(o => teamOf(o.name) === home), a = m.outcomes.find(o => teamOf(o.name) === away);
      if (h && a) spreads.push({ point: h.point, home: h.price, away: a.price });
    }
    if (m.key === "totals") {
      const o = m.outcomes.find(x => x.name === "Over"), u = m.outcomes.find(x => x.name === "Under");
      if (o && u && o.point === u.point) totals.push({ point: o.point, over: o.price, under: u.price });
    }
  }
  const snap = { t: Math.round(now) };
  if (h2h.home.length && h2h.away.length) snap.h2h = { home: median(h2h.home), away: median(h2h.away) };
  const lp = mode(spreads.map(s => s.point));
  if (lp !== null) { const s = spreads.filter(x => x.point === lp); snap.line = { point: lp, home: median(s.map(x => x.home)), away: median(s.map(x => x.away)) }; }
  const tp = mode(totals.map(s => s.point));
  if (tp !== null) { const s = totals.filter(x => x.point === tp); snap.total = { point: tp, over: median(s.map(x => x.over)), under: median(s.map(x => x.under)) }; }
  if (!snap.h2h && !snap.line && !snap.total) continue;

  const hist = (store.games[g.id] ??= []);
  const last = hist[hist.length - 1];
  const same = last && JSON.stringify({ ...last, t: 0 }) === JSON.stringify({ ...snap, t: 0 });
  if (!same) { hist.push(snap); added++; }
}

store.year = year;
store.fetchedAt = new Date(now * 1000).toISOString();
await writeFile(file(`data/odds-${year}.json`), JSON.stringify(store) + "\n");
console.log(`Saved odds: ${added} new snapshot(s).`);
