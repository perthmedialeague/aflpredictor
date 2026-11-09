// Runs inside GitHub Actions (not in the browser): downloads each season's games from
// the Squiggle API and saves them as data/games-<year>.json next to the site.
// Squiggle doesn't allow browsers on other websites to read its API directly, so the
// site reads these saved files instead.
//
// Usage: node scripts/fetch-results.mjs

import { readFile, writeFile } from "node:fs/promises";

const config = await readFile(new URL("../js/config.js", import.meta.url), "utf8");
const seasons = (config.match(/seasons:\s*\[([^\]]*)\]/)?.[1] || "")
  .split(",").map(s => parseInt(s, 10)).filter(Boolean);
if (!seasons.length) throw new Error("No seasons found in js/config.js");

// Squiggle asks API users to identify themselves.
const repo = process.env.GITHUB_REPOSITORY || "local";
const UA = `ladder-predictor-comp (https://github.com/${repo})`;
const KEEP = ["id", "round", "roundname", "hteam", "ateam", "hscore", "ascore", "complete", "is_final", "unixtime"];

let failures = 0;
for (const year of seasons) {
  try {
    const res = await fetch(`https://api.squiggle.com.au/?q=games;year=${year}`, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const games = ((await res.json()).games || [])
      .map(g => Object.fromEntries(KEEP.map(k => [k, g[k]])))
      .sort((a, b) => (a.unixtime || 0) - (b.unixtime || 0) || a.id - b.id);
    const out = { year, fetchedAt: new Date().toISOString(), games };
    await writeFile(new URL(`../data/games-${year}.json`, import.meta.url), JSON.stringify(out) + "\n");
    const done = games.filter(g => g.complete === 100).length;
    console.log(`${year}: ${games.length} games, ${done} complete`);
  } catch (err) {
    failures++;
    console.error(`${year}: failed to fetch (${err.message})`);
  }
}
if (failures === seasons.length) process.exit(1);
