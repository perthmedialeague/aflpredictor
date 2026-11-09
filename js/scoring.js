// Pure functions: build AFL ladders from game results and score predictions.
import { TEAM_NAMES, canonical } from "./teams.js";

// Opening Round (round 0) counts towards Round 1 for display purposes.
export const displayRound = r => Math.max(1, r);

/** Home-and-away games only, with canonical team names. */
export function homeAndAway(games) {
  return games
    .filter(g => !g.is_final && g.round != null)
    .map(g => ({ ...g, hteam: canonical(g.hteam) || g.hteam, ateam: canonical(g.ateam) || g.ateam }));
}

/** Ladder after all completed H&A games up to and including display round `upto` (Infinity = all). */
export function computeLadder(games, upto = Infinity) {
  const rows = Object.fromEntries(TEAM_NAMES.map(n => [n, { name: n, played: 0, wins: 0, losses: 0, draws: 0, for: 0, against: 0, pts: 0 }]));
  for (const g of games) {
    if (g.complete !== 100 || displayRound(g.round) > upto) continue;
    const h = rows[g.hteam], a = rows[g.ateam];
    if (!h || !a) continue;
    const hs = +g.hscore, as = +g.ascore;
    h.played++; a.played++;
    h.for += hs; h.against += as; a.for += as; a.against += hs;
    if (hs > as) { h.wins++; a.losses++; h.pts += 4; }
    else if (as > hs) { a.wins++; h.losses++; a.pts += 4; }
    else { h.draws++; a.draws++; h.pts += 2; a.pts += 2; }
  }
  const list = Object.values(rows).map(r => ({ ...r, pct: r.against ? (r.for / r.against) * 100 : (r.for ? Infinity : 0) }));
  const started = list.some(r => r.played > 0);
  list.sort((x, y) => started
    ? (y.pts - x.pts) || (y.pct - x.pct) || (y.for - x.for) || x.name.localeCompare(y.name)
    : x.name.localeCompare(y.name));
  list.forEach((r, i) => (r.rank = i + 1));
  return list;
}

/** Ladder from an explicit ordered list of team names (e.g. a stored final ladder). */
export function ladderFromOrder(order) {
  return order.map((n, i) => ({ name: canonical(n) || n, rank: i + 1 }));
}

/** Round info: which display rounds exist, which have started, which are complete. */
export function roundInfo(games) {
  const by = {};
  for (const g of games) (by[displayRound(g.round)] ??= []).push(g);
  const rounds = Object.keys(by).map(Number).sort((a, b) => a - b);
  const started = rounds.filter(r => by[r].some(g => g.complete === 100));
  const complete = rounds.filter(r => by[r].every(g => g.complete === 100));
  return {
    rounds,
    started,
    complete,
    latest: started.length ? started[started.length - 1] : 0,
    seasonOver: rounds.length > 0 && complete.length === rounds.length,
    firstBounce: games.reduce((m, g) => (g.unixtime && (!m || g.unixtime < m) ? g.unixtime : m), 0),
  };
}

/**
 * Score one predictor against a ladder.
 * picks: array of team names, index 0 = predicted 1st.
 * Best/worst ties: the team picked higher on their ladder is shown, with a count of the rest.
 */
export function scorePredictor(picks, ladder) {
  const actual = Object.fromEntries(ladder.map(r => [r.name, r.rank]));
  const rows = picks.map((t, i) => {
    const name = canonical(t) || t;
    const act = actual[name];
    return { team: name, predicted: i + 1, actual: act, diff: act ? Math.abs(act - (i + 1)) : null };
  });
  const valid = rows.filter(r => r.diff != null);
  const total = valid.reduce((s, r) => s + r.diff, 0);
  const min = Math.min(...valid.map(r => r.diff));
  const max = Math.max(...valid.map(r => r.diff));
  const bests = valid.filter(r => r.diff === min);
  const worsts = valid.filter(r => r.diff === max);
  return {
    total,
    rows,
    best: bests[0] ? { ...bests[0], more: bests.length - 1 } : null,
    worst: worsts[0] ? { ...worsts[0], more: worsts.length - 1 } : null,
  };
}

/** Rank predictors: lowest total first, equal totals share a position. */
export function rankPredictors(predictors, ladder) {
  const scored = predictors.map(p => ({ ...p, ...scorePredictor(p.picks, ladder) }));
  scored.sort((a, b) => a.total - b.total || a.name.localeCompare(b.name));
  scored.forEach((p, i) => (p.position = i > 0 && p.total === scored[i - 1].total ? scored[i - 1].position : i + 1));
  return scored;
}

/** Each predictor's total at the end of every started round (for the season chart). */
export function history(predictors, games, rounds) {
  return rounds.map(r => {
    const ladder = computeLadder(games, r);
    return { round: r, totals: Object.fromEntries(predictors.map(p => [p.name, scorePredictor(p.picks, ladder).total])) };
  });
}
