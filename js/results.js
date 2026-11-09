// Loads AFL fixture/results for a season.
//
// Squiggle (https://api.squiggle.com.au) doesn't let browsers on other websites read its API,
// so a GitHub Action (.github/workflows/update-results.yml) downloads the games every
// 15 minutes in season and publishes them as data/games-<year>.json alongside the site.

export async function fetchGames(year) {
  const res = await fetch(`data/games-${year}.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`No results file for ${year} yet`);
  const data = await res.json();
  return data.games || [];
}
