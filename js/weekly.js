// Weekly five-picks competition: pure functions (no DOM, no network) so they can be tested.
//
// A pick is { game, market, side, at } where
//   game   = Squiggle game id
//   market = "h2h" (head to head) | "line" | "total"
//   side   = "home" | "away" (h2h, line) or "over" | "under" (total)
//   at     = when the pick was saved (seconds, from the server clock)
//
// Odds history (data/odds-<year>.json) holds snapshots per game:
//   { t, h2h: {home, away}, line: {point, home, away}, total: {point, over, under} }
// line.point is the HOME team's handicap (e.g. -12.5 = home giving 12.5 points).
//
// A pick is priced from the latest snapshot taken at or before it was saved, so prices can't be
// cherry-picked after the fact. Winning picks score their odds, a push (exact line/total) scores 1,
// a loss scores 0.

import { displayRound } from "./scoring.js";

export const PICKS_PER_ROUND = 5;
export const SLOTS = ["p1", "p2", "p3", "p4", "p5"];

/** The snapshot in force at time `at` (seconds). Falls back to the earliest snapshot. */
export function snapshotAt(history, at) {
  if (!history?.length) return null;
  let snap = history[0];
  for (const s of history) if (s.t <= at) snap = s;
  return snap;
}

/** Price + handicap of a pick in a given snapshot. */
export function quote(snap, market, side) {
  const m = snap?.[market];
  if (!m) return null;
  const price = m[side];
  if (!price) return null;
  let point = null;
  if (market === "line") point = side === "home" ? m.point : -m.point;
  if (market === "total") point = m.point;
  return { price, point };
}

/** Human label for a pick, e.g. "Sydney -6.5", "Over 165.5", "Geelong to win". */
export function pickLabel(market, side, point, teamName) {
  const fmt = p => (p > 0 ? `+${p}` : `${p}`);
  if (market === "h2h") return `${teamName} to win`;
  if (market === "line") return `${teamName} ${fmt(point)}`;
  return `${side === "over" ? "Over" : "Under"} ${point}`;
}

/**
 * Settle one pick.
 * Returns { status: "pending" | "won" | "lost" | "push" | "void", price, point, points }
 */
export function settle(pick, game, history) {
  if (!game) return { status: "void", points: 0 };
  const snap = snapshotAt(history, pick.at);
  const q = quote(snap, pick.market, pick.side);
  if (!q) return { status: "void", points: 0 };
  const base = { price: q.price, point: q.point };
  if (game.complete !== 100) return { ...base, status: "pending", points: 0 };

  const hs = +game.hscore, as = +game.ascore;
  let result;
  if (pick.market === "h2h") {
    const margin = pick.side === "home" ? hs - as : as - hs;
    result = margin > 0 ? "won" : margin < 0 ? "lost" : "push"; // a draw refunds
  } else if (pick.market === "line") {
    const margin = (pick.side === "home" ? hs - as : as - hs) + q.point;
    result = margin > 0 ? "won" : margin < 0 ? "lost" : "push";
  } else {
    const diff = hs + as - q.point;
    const over = pick.side === "over";
    result = diff === 0 ? "push" : (diff > 0) === over ? "won" : "lost";
  }
  const points = result === "won" ? q.price : result === "push" ? 1 : 0;
  return { ...base, status: result, points: Math.round(points * 100) / 100 };
}

/** Picks from a stored round doc, in slot order, ignoring games that aren't in that round. */
export function picksOf(doc, gamesById) {
  if (!doc) return [];
  const seen = new Set();
  const out = [];
  for (const s of SLOTS) {
    const p = doc[s];
    if (!p || seen.has(p.game)) continue;
    const g = gamesById[p.game];
    if (!g || displayRound(g.round) !== doc.round) continue;
    seen.add(p.game);
    out.push({ ...p, slot: s });
  }
  return out;
}

/** Score every player's round. docs: [{user, round, p1..p5}] */
export function scoreRound(docs, gamesById, odds) {
  return docs.map(doc => {
    const picks = picksOf(doc, gamesById).map(p => ({ ...p, ...settle(p, gamesById[p.game], odds[p.game]) }));
    const settled = picks.filter(p => ["won", "lost", "push"].includes(p.status));
    return {
      user: doc.user,
      picks,
      points: round2(picks.reduce((s, p) => s + p.points, 0)),
      won: picks.filter(p => p.status === "won").length,
      settled: settled.length,
    };
  });
}

/** Season leaderboard from all docs: [{user, points, won, settled, rounds: {r: points}}] sorted best first. */
export function seasonBoard(allDocs, gamesById, odds, users = []) {
  const by = Object.fromEntries(users.map(u => [u, { user: u, points: 0, won: 0, settled: 0, rounds: {} }]));
  for (const r of scoreRound(allDocs, gamesById, odds).map((s, i) => ({ ...s, round: allDocs[i].round }))) {
    const row = (by[r.user] ??= { user: r.user, points: 0, won: 0, settled: 0, rounds: {} });
    row.points = round2(row.points + r.points);
    row.won += r.won;
    row.settled += r.settled;
    row.rounds[r.round] = r.points;
  }
  const rows = Object.values(by).sort((a, b) => b.points - a.points || b.won - a.won || a.user.localeCompare(b.user));
  rows.forEach((r, i) => (r.position = i > 0 && r.points === rows[i - 1].points && r.won === rows[i - 1].won ? rows[i - 1].position : i + 1));
  return rows;
}

/** Kick-off times for the Firestore lock: { starts: {gameId: seconds}, roundStarts: {round: seconds} } */
export function fixtureLocks(games) {
  const starts = {}, roundStarts = {};
  for (const g of games) {
    if (!g.unixtime || g.is_final) continue;
    starts[g.id] = g.unixtime;
    const r = displayRound(g.round);
    roundStarts[r] = Math.min(roundStarts[r] ?? Infinity, g.unixtime);
  }
  return { starts, roundStarts };
}

/** The round to show by default: the first round that still has an unfinished game. */
export function currentRound(games) {
  const rounds = [...new Set(games.filter(g => !g.is_final).map(g => displayRound(g.round)))].sort((a, b) => a - b);
  for (const r of rounds) if (games.some(g => displayRound(g.round) === r && !g.is_final && g.complete !== 100)) return r;
  return rounds[rounds.length - 1] ?? 1;
}

const round2 = n => Math.round(n * 100) / 100;
