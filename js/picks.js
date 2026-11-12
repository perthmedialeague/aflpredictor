// Weekly Picks page: five picks per round against the odds.
import * as W from "./weekly.js";
import { displayRound } from "./scoring.js";
import * as B from "./backend.js";

const cache = {};          // year → { odds, docs, locks, loadedAt }
const ui = { round: {}, draft: null, draftKey: null, msg: "" };

async function loadOdds(year) {
  try {
    const r = await fetch(`data/odds-${year}.json`, { cache: "no-cache" });
    return r.ok ? (await r.json()).games || {} : {};
  } catch { return {}; }
}

/**
 * ctx: { entry, user, isCurrent, h: { $, esc, dot, team, fmtDate }, openLogin, nameOf }
 */
export async function renderPicks(ctx, { reload = false } = {}) {
  const { entry, h } = ctx;
  const root = h.$("#view-picks");
  const year = entry.year;
  const games = entry.games;                      // home-and-away only
  const gamesById = Object.fromEntries(games.map(g => [g.id, g]));
  const rounds = [...new Set(games.map(g => displayRound(g.round)))].sort((a, b) => a - b);

  if (!rounds.length) {
    root.innerHTML = card(`<h2>Weekly Picks</h2><p class="card-sub">The ${year} fixture isn't available yet.</p>`);
    return;
  }

  // ── data ──
  let c = cache[year];
  if (!c || reload) {
    root.querySelector(".pk-loading") || (root.innerHTML = card(`<p class="muted pk-loading">Loading picks…</p>`));
    const users = ctx.users;
    const now = Date.now() / 1000;
    const startedRounds = rounds.filter(r => games.some(g => displayRound(g.round) === r && g.unixtime <= now));
    const me = B.usernameOf(ctx.user);
    const [odds, docs, locks, mine] = await Promise.all([
      loadOdds(year),
      B.enabled() ? B.getAllWeekly(year, users, startedRounds).catch(() => []) : [],
      B.enabled() ? B.getFixtureLocks(year).catch(() => null) : null,
      me ? B.getAllWeekly(year, [me], rounds.filter(r => !startedRounds.includes(r))).catch(() => []) : [],
    ]);
    c = cache[year] = { odds, docs: dedupe([...docs, ...mine]), locks };
    if (ctx.isCurrent && ctx.user && B.isAdmin(ctx.user)) await syncFixture(year, games, c);
  }

  const now = Date.now() / 1000;
  const round = rounds.includes(ui.round[year]) ? ui.round[year] : W.currentRound(games);
  ui.round[year] = round;
  const rGames = games.filter(g => displayRound(g.round) === round).sort((a, b) => a.unixtime - b.unixtime || a.id - b.id);
  const roundStart = Math.min(...rGames.map(g => g.unixtime || Infinity));
  const roundStarted = now >= roundStart;

  const board = W.seasonBoard(c.docs, gamesById, c.odds, ctx.users);
  const roundDocs = c.docs.filter(d => d.round === round);
  const roundScores = Object.fromEntries(W.scoreRound(roundDocs, gamesById, c.odds).map(s => [s.user, s]));

  const me = B.usernameOf(ctx.user);
  const myDoc = c.docs.find(d => d.round === round && d.user === me) || null;
  const draftKey = `${year}-${round}-${me}`;
  if (ui.draftKey !== draftKey) { ui.draft = draftFrom(myDoc, gamesById, round); ui.draftKey = draftKey; ui.msg = ""; }

  // ── markup ──
  const idx = rounds.indexOf(round);
  const roundBar = `
    <div class="roundbar pk-roundbar">
      <div class="rb-label">
        <span class="rb-kicker">${year} weekly picks</span>
        <strong id="pk-title">Round ${round}</strong>
      </div>
      <div class="pk-nav">
        <button type="button" class="rb-btn" data-nav="-1" ${idx <= 0 ? "disabled" : ""} aria-label="Previous round">◀</button>
        <span class="pk-status">${h.esc(roundStatus(rGames, now, h))}</span>
        <button type="button" class="rb-btn" data-nav="1" ${idx >= rounds.length - 1 ? "disabled" : ""} aria-label="Next round">▶</button>
      </div>
    </div>`;

  const leaderboard = card(`
    <header class="card-head"><h2>Season Leaderboard</h2>
      <p class="card-sub">Five picks a round. A winning pick scores its odds, a loss scores 0. Highest total wins.</p></header>
    <div class="table-scroll"><table class="predictors pk-board">
      <thead><tr><th class="num">#</th><th>Name</th><th class="num" title="Season points">Pts</th>
        <th class="num" title="Points this round">Rd ${round}</th><th class="num" title="Winning picks / settled picks">Won</th></tr></thead>
      <tbody>${board.map(r => `
        <tr class="${r.position === 1 && r.points > 0 ? "leader" : ""}">
          <td class="num pos">${r.points > 0 || board.some(x => x.points > 0) ? r.position : "–"}</td>
          <td><strong>${h.esc(ctx.nameOf(r.user))}</strong></td>
          <td class="num total">${fmtPts(r.points)}</td>
          <td class="num">${roundScores[r.user] ? fmtPts(roundScores[r.user].points) : '<span class="muted">–</span>'}</td>
          <td class="num">${r.settled ? `${r.won}/${r.settled}` : '<span class="muted">–</span>'}</td>
        </tr>`).join("")}</tbody>
    </table></div>`);

  const builder = pickBuilder({ ctx, rGames, c, now, round, myDoc, gamesById });
  const results = roundResults({ ctx, round, roundStarted, roundScores, gamesById, me, roundStart, h });

  root.innerHTML = roundBar + `<div class="layout pk-layout"><section class="col-main">${builder}${results}</section><aside class="col-side">${leaderboard}</aside></div>`;
  wire(ctx, { root, year, rounds, round, rGames, gamesById, c, myDoc });
}

function roundStatus(rGames, now, h) {
  const first = Math.min(...rGames.map(g => g.unixtime || Infinity));
  const done = rGames.filter(g => g.complete === 100).length;
  if (done === rGames.length) return "Round complete";
  if (now < first) return `First bounce ${h.fmtDate(new Date(first * 1000))}`;
  return `In progress: ${done} of ${rGames.length} games done`;
}

function card(html, cls = "") { return `<article class="card ${cls}">${html}</article>`; }
const fmtPts = n => (Math.round(n * 100) / 100).toFixed(2);
const dedupe = docs => Object.values(Object.fromEntries(docs.map(d => [`${d.round}_${d.user}`, d])));

function draftFrom(doc, gamesById, round) {
  const d = {};
  for (const p of W.picksOf(doc, gamesById)) d[p.game] = { market: p.market, side: p.side };
  return d;
}

/* ── the pick builder ─────────────────────────────────────────────── */

function pickBuilder({ ctx, rGames, c, now, round, myDoc, gamesById }) {
  const { h } = ctx;
  if (!ctx.isCurrent) return "";
  if (!B.enabled()) return card(`<h2>Your Picks</h2><p class="card-sub">Logins aren't set up yet, so picks can't be made. See the README.</p>`);
  if (!ctx.user) return card(`<header class="card-head"><h2>Your Picks</h2><p class="card-sub">Log in to make your five picks for Round ${round}.</p></header>
    <button class="btn primary" data-act="login">Log in</button>`);
  if (!ctx.users.includes(B.usernameOf(ctx.user))) return card(`<h2>Your Picks</h2><p class="card-sub">You're not in the Weekly Picks comp this season.</p>`);

  const draft = ui.draft;
  const used = Object.keys(draft).length;
  const saved = draftFrom(myDoc, gamesById, round);
  const dirty = JSON.stringify(sortObj(draft)) !== JSON.stringify(sortObj(saved));
  const anyOdds = rGames.some(g => latest(c.odds[g.id]));
  const allStarted = rGames.every(g => now >= g.unixtime);

  const rows = rGames.map(g => {
    const snap = latest(c.odds[g.id]);
    const started = now >= g.unixtime;
    const pick = draft[g.id];
    const savedPick = W.picksOf(myDoc, gamesById).find(p => p.game === g.id);
    const res = savedPick && started ? W.settle(savedPick, g, c.odds[g.id]) : null;
    const home = h.team(g.hteam), away = h.team(g.ateam);
    const btn = (market, side, label) => {
      const q = W.quote(snap, market, side);
      if (!q) return `<button type="button" class="pk-opt" disabled>${label(null)}<b>–</b></button>`;
      const on = pick && pick.market === market && pick.side === side;
      return `<button type="button" class="pk-opt ${on ? "on" : ""}" data-g="${g.id}" data-m="${market}" data-s="${side}" ${started ? "disabled" : ""} aria-pressed="${on}">${label(q.point)}<b>${q.price.toFixed(2)}</b></button>`;
    };
    const fmt = p => (p > 0 ? `+${p}` : `${p}`);
    return `
      <div class="pk-game ${started ? "locked" : ""} ${pick ? "picked" : ""}">
        <div class="pk-head">
          <span class="pk-teams">${h.dot(g.hteam)}<strong>${h.esc(home.short)}</strong> <span class="muted">v</span> ${h.dot(g.ateam)}<strong>${h.esc(away.short)}</strong></span>
          <span class="pk-time">${started ? (g.complete === 100 ? `Final ${g.hscore}–${g.ascore}` : "Locked, in play") : h.esc(h.fmtDate(new Date(g.unixtime * 1000)))}</span>
        </div>
        ${started ? (savedPick ? `<div class="pk-mine">Your pick: <strong>${h.esc(W.pickLabel(savedPick.market, savedPick.side, res?.point, savedPick.market === "total" ? "" : h.team(savedPick.side === "home" ? g.hteam : g.ateam).short))}</strong>${res?.price ? ` @ ${res.price.toFixed(2)}` : ""}</div>` : "")
        : snap ? `<div class="pk-markets">
          <div class="pk-mkt"><span class="pk-ml">Head to head</span>${btn("h2h", "home", () => h.esc(home.abbr))}${btn("h2h", "away", () => h.esc(away.abbr))}</div>
          <div class="pk-mkt"><span class="pk-ml">Line</span>${btn("line", "home", p => `${h.esc(home.abbr)} ${p == null ? "" : fmt(p)}`)}${btn("line", "away", p => `${h.esc(away.abbr)} ${p == null ? "" : fmt(p)}`)}</div>
          <div class="pk-mkt"><span class="pk-ml">Total</span>${btn("total", "over", p => `Over ${p ?? ""}`)}${btn("total", "under", p => `Under ${p ?? ""}`)}</div>
        </div>` : `<p class="pk-noodds muted">Odds not available yet.</p>`}
        ${res ? `<div class="pk-res ${res.status}">${statusText(res)}</div>` : ""}
      </div>`;
  }).join("");

  return card(`
    <header class="card-head pk-builder-head">
      <div><h2>Your Picks</h2>
        <p class="card-sub">${allStarted ? `Round ${round} is locked.` : anyOdds ? "Pick up to five, at most one per game. Each pick locks when its game starts, and your odds are fixed when you save." : "Odds appear here about a week before the round. They update every few hours."}</p></div>
      <div class="pk-count" aria-live="polite"><strong>${used}</strong>/5</div>
    </header>
    <div class="pk-games">${rows}</div>
    <p class="form-error" id="pk-error" role="alert">${h.esc(ui.msg)}</p>
    <div class="actions" ${allStarted ? "hidden" : ""}>
      <span class="saved-note" id="pk-saved"></span>
      <span class="spacer"></span>
      ${dirty ? `<button type="button" class="btn ghost" data-act="reset">Undo changes</button>` : ""}
      <button type="button" class="btn primary" data-act="save" ${dirty ? "" : "disabled"}>Save picks</button>
    </div>`, "pk-builder");
}

const latest = hist => (hist?.length ? hist[hist.length - 1] : null);
const sortObj = o => Object.fromEntries(Object.entries(o).sort());

function statusText(r) {
  if (r.status === "won") return `✓ Won · +${fmtPts(r.points)}`;
  if (r.status === "lost") return "✗ Lost · 0";
  if (r.status === "push") return "Push (draw or exact line) · +1.00";
  if (r.status === "pending") return `In play @ ${r.price.toFixed(2)}`;
  return "Void";
}

/* ── round results ────────────────────────────────────────────────── */

function roundResults({ ctx, round, roundStarted, roundScores, gamesById, me, roundStart, h }) {
  const rows = ctx.users.map(u => {
    const s = roundScores[u];
    const hidden = !roundStarted && u !== me;
    return { u, s, hidden, pts: s ? s.points : -1 };
  }).sort((a, b) => b.pts - a.pts || ctx.nameOf(a.u).localeCompare(ctx.nameOf(b.u)));

  const chip = p => {
    const g = gamesById[p.game];
    const tn = p.market === "total" ? "" : h.team(p.side === "home" ? g.hteam : g.ateam).short;
    const label = W.pickLabel(p.market, p.side, p.point, tn);
    const ctxLabel = p.market === "total" ? ` (${h.team(g.hteam).abbr} v ${h.team(g.ateam).abbr})` : "";
    return `<li class="pk-chip ${p.status}" title="${h.esc(label + ctxLabel)}">
      <span class="pk-chip-l">${p.market === "total" ? "" : h.dot(p.side === "home" ? g.hteam : g.ateam)}${h.esc(label)}<span class="muted">${h.esc(ctxLabel)}</span></span>
      <span class="pk-chip-r">${p.price ? `@${p.price.toFixed(2)}` : ""} ${p.status === "won" ? `<b>+${fmtPts(p.points)}</b>` : p.status === "lost" ? "<b>0</b>" : p.status === "push" ? "<b>+1.00</b>" : ""}</span>
    </li>`;
  };

  const body = rows.map(({ u, s, hidden }) => `
    <div class="pk-player">
      <div class="pk-player-head"><strong>${h.esc(ctx.nameOf(u))}</strong>
        <span class="pk-player-pts">${s ? fmtPts(s.points) : ""}</span></div>
      ${hidden ? `<p class="muted pk-hidden">Hidden until first bounce</p>`
        : s && s.picks.length ? `<ul class="pk-chips">${s.picks.map(chip).join("")}</ul>`
        : `<p class="muted pk-hidden">No picks</p>`}
    </div>`).join("");

  return card(`
    <header class="card-head"><h2>Round ${round} Picks</h2>
      <p class="card-sub">${roundStarted ? "Everyone's picks, with results as games finish." : `Everyone's picks are revealed at the first bounce (${h.esc(h.fmtDate(new Date(roundStart * 1000)))}).`}</p></header>
    <div class="pk-players">${body}</div>`);
}

/* ── events ───────────────────────────────────────────────────────── */

function wire(ctx, { root, year, rounds, round, rGames, gamesById, c, myDoc }) {
  const rerender = () => renderPicks(ctx);
  root.querySelectorAll("[data-nav]").forEach(b => (b.onclick = () => {
    const i = rounds.indexOf(round) + +b.dataset.nav;
    if (rounds[i] != null) { ui.round[year] = rounds[i]; rerender(); }
  }));
  root.querySelector('[data-act="login"]')?.addEventListener("click", ctx.openLogin);
  root.querySelectorAll(".pk-opt[data-g]").forEach(b => (b.onclick = () => {
    const g = +b.dataset.g, m = b.dataset.m, s = b.dataset.s;
    const cur = ui.draft[g];
    ui.msg = "";
    if (cur && cur.market === m && cur.side === s) delete ui.draft[g];               // tap again to remove
    else if (!cur && Object.keys(ui.draft).length >= W.PICKS_PER_ROUND) ui.msg = "You've used all five picks. Tap one of your picks to remove it first.";
    else ui.draft[g] = { market: m, side: s };
    rerender();
  }));
  root.querySelector('[data-act="reset"]')?.addEventListener("click", () => { ui.draftKey = null; rerender(); });
  root.querySelector('[data-act="save"]')?.addEventListener("click", async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const me = B.usernameOf(ctx.user);
    try {
      const slots = assignSlots(ui.draft, myDoc, gamesById);
      await B.saveWeekly(year, round, me, slots);
      const fresh = await B.getWeekly(year, round, me);
      c.docs = dedupe([...c.docs.filter(d => !(d.round === round && d.user === me)), ...(fresh ? [fresh] : [])]);
      ui.draftKey = null;
      await renderPicks(ctx);
      const note = document.querySelector("#pk-saved");
      if (note) note.textContent = "Saved ✓";
    } catch (err) {
      ui.msg = /permission/i.test(err.code || err.message)
        ? "Save was refused. A game may have started, or kick-off times haven't been synced yet (John needs to open this page once)."
        : (err.message || "Couldn't save.");
      btn.disabled = false;
      rerender();
    }
  });
}

/** Keep each unchanged pick in its existing slot (the database requires it); put new ones in free slots. */
function assignSlots(draft, doc, gamesById) {
  const slots = {};
  const remaining = { ...draft };
  for (const s of W.SLOTS) {
    const p = doc?.[s];
    if (p && remaining[p.game] && remaining[p.game].market === p.market && remaining[p.game].side === p.side) {
      slots[s] = { game: p.game, market: p.market, side: p.side };
      delete remaining[p.game];
    }
  }
  // started games can't change: keep them even if somehow missing from the draft
  const free = W.SLOTS.filter(s => !slots[s]);
  for (const [game, v] of Object.entries(remaining)) {
    const s = free.shift();
    if (!s) break;
    slots[s] = { game: +game, market: v.market, side: v.side };
  }
  return slots;
}

/* ── admin: keep the database's kick-off times in step with the fixture ── */

async function syncFixture(year, games, c) {
  const want = W.fixtureLocks(games);
  const have = c.locks;
  const same = have && JSON.stringify(sortObj(want.starts)) === JSON.stringify(sortObj(have.starts));
  if (same) return;
  try {
    await B.setFixtureLocks(year, want);
    c.locks = want;
    console.info("Weekly picks: kick-off times synced to the database.");
  } catch (e) { console.warn("Couldn't sync kick-off times:", e); }
}

export function invalidatePicks(year) { delete cache[year]; ui.draftKey = null; }
