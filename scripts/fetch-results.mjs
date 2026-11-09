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

// Squiggle requires a User-Agent that names the bot AND includes a contact email, otherwise
// requests from servers like GitHub's are silently blocked. Set the email as a repository
// variable: Settings → Secrets and variables → Actions → Variables → SQUIGGLE_CONTACT.
const contact = (process.env.SQUIGGLE_CONTACT || "").trim();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) {
  console.error("SQUIGGLE_CONTACT is not set to an email address. Add it under Settings → Secrets and variables → Actions → Variables.");
  process.exit(1);
}
const repo = process.env.GITHUB_REPOSITORY || "local";
const UA = `AFL ladder prediction comp (github.com/${repo}) - ${contact}`;
const current = parseInt(config.match(/currentSeason:\s*(\d{4})/)?.[1], 10);
const KEEP = ["id", "round", "roundname", "hteam", "ateam", "hscore", "ascore", "complete", "is_final", "unixtime"];

let failures = 0;
for (const year of seasons) {
  // Finished past seasons never change: reuse the saved file instead of asking Squiggle again.
  if (year < current) {
    try {
      const saved = JSON.parse(await readFile(new URL(`../data/games-${year}.json`, import.meta.url), "utf8"));
      const ci = saved.cols?.indexOf("complete");
      if (saved.rows?.length && saved.rows.every(r => r[ci] === 100)) { console.log(`${year}: complete, using saved file`); continue; }
    } catch {}
  }
  try {
    const res = await fetch(`https://api.squiggle.com.au/?q=games;year=${year}`, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}${res.status === 403 ? " (blocked: check SQUIGGLE_CONTACT)" : ""}`);
    const games = ((await res.json()).games || [])
      .sort((a, b) => (a.unixtime || 0) - (b.unixtime || 0) || a.id - b.id);
    if (!games.length) throw new Error("no games returned");
    const out = { year, fetchedAt: new Date().toISOString(), cols: KEEP, rows: games.map(g => KEEP.map(k => g[k])) };
    await writeFile(new URL(`../data/games-${year}.json`, import.meta.url), JSON.stringify(out) + "\n");
    const done = games.filter(g => g.complete === 100).length;
    console.log(`${year}: ${games.length} games, ${done} complete`);
  } catch (err) {
    failures++;
    console.error(`${year}: failed to fetch (${err.message})`);
  }
}
if (failures) process.exit(1);   // marks the step with a warning; the site still publishes
