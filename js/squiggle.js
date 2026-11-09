// Fetches AFL fixture/results from the free Squiggle API (https://api.squiggle.com.au).
// Responses are cached in localStorage so we stay polite to the service.

const API = "https://api.squiggle.com.au/";
const LIVE_TTL = 5 * 60 * 1000;            // current season: refresh every 5 minutes
const PAST_TTL = 7 * 24 * 60 * 60 * 1000;  // finished seasons: weekly is plenty

function cacheGet(key, ttl) {
  try {
    const hit = JSON.parse(localStorage.getItem(key));
    if (hit && Date.now() - hit.t < ttl) return hit.v;
  } catch {}
  return null;
}
function cacheSet(key, v) {
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch {}
}
function cacheStale(key) {
  try { return JSON.parse(localStorage.getItem(key))?.v ?? null; } catch { return null; }
}

/** All games (fixture + results) for a season. */
export async function fetchGames(year, { live = false } = {}) {
  const key = `sq-games-${year}`;
  const cached = cacheGet(key, live ? LIVE_TTL : PAST_TTL);
  if (cached) return cached;
  try {
    const res = await fetch(`${API}?q=games;year=${year}`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Squiggle ${res.status}`);
    const games = (await res.json()).games || [];
    cacheSet(key, games);
    return games;
  } catch (err) {
    const stale = cacheStale(key);
    if (stale) return stale;
    throw err;
  }
}
