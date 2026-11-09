import { CONFIG } from "./config.js";
import { TEAM_NAMES, team, canonical } from "./teams.js";
import * as S from "./scoring.js";
import { fetchGames } from "./results.js";
import * as B from "./backend.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const fmtDate = d => d ? d.toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
const fmtDay = d => d ? d.toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "";
const dot = name => { const t = team(name); return `<span class="club-dot" style="--c1:${t.c1};--c2:${t.c2}" aria-hidden="true"></span>`; };
const SERIES = n => (n < 8 ? `var(--s${n + 1})` : "var(--ink-3)");

const state = {
  year: CONFIG.currentSeason,
  cache: {},
  round: {},          // selected round per year
  open: new Set(),    // expanded predictor rows
  user: null,
};

/* ───────────────────────── Data ───────────────────────── */

async function loadSeason(year) {
  if (state.cache[year]) return state.cache[year];
  const res = await fetch(`data/${year}.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Couldn't load data/${year}.json`);
  const data = await res.json();
  const live = year === CONFIG.currentSeason;
  const predictors = (data.predictors || []).map(p => ({
    name: p.name,
    username: slug(p.username || p.name),
    picks: p.picks.map(t => canonical(t) || t),
  }));

  let gamesError = null;
  const [games, stored, season] = await Promise.all([
    fetchGames(year, { live }).catch(e => { gamesError = e; return []; }),
    live && B.enabled() ? B.getPicks(year).catch(() => ({})) : {},
    live && B.enabled() ? B.getSeason(year).catch(() => ({})) : {},
  ]);

  const entry = { year, data, live, predictors, season, gamesError };
  applyStored(entry, stored);
  entry.games = S.homeAndAway(games);
  entry.info = S.roundInfo(entry.games);
  state.cache[year] = entry;
  return entry;
}

function applyStored(entry, stored) {
  for (const [username, doc] of Object.entries(stored || {})) {
    if (!Array.isArray(doc.picks) || doc.picks.length !== 18) continue;
    let p = entry.predictors.find(x => x.username === username);
    if (!p) entry.predictors.push(p = { username, name: doc.name || username });
    p.picks = doc.picks.map(t => canonical(t) || t);
    if (doc.name) p.name = doc.name;
    p.updatedAt = doc.updatedAt;
  }
}

/** What the page is showing for this season: a ladder + labels, or pre-season. */
function view(entry) {
  const { info, data } = entry;
  const sel = state.round[entry.year];
  if (info.started.length) {
    const round = info.started.includes(sel) ? sel : info.latest;
    const ladder = S.computeLadder(entry.games, round);
    const roundGames = entry.games.filter(g => S.displayRound(g.round) === round);
    const done = roundGames.filter(g => g.complete === 100).length;
    const inProgress = done < roundGames.length;
    const isFinal = info.seasonOver && round === info.latest;
    const prevRound = info.started[info.started.indexOf(round) - 1];
    return {
      mode: "scored", round, ladder, isFinal, inProgress, done, of: roundGames.length,
      prevLadder: prevRound ? S.computeLadder(entry.games, prevRound) : null,
    };
  }
  if (data.finalLadder?.length === 18) {
    return { mode: "scored", round: "final", ladder: S.ladderFromOrder(data.finalLadder), isFinal: true, staticLadder: true };
  }
  return { mode: "preseason", ladder: S.computeLadder([], 0) };
}

/* ───────────────────────── Render ───────────────────────── */

async function render() {
  document.title = CONFIG.siteTitle;
  $("#site-title").textContent = CONFIG.siteTitle;
  renderTabs();
  renderAccount();
  let entry;
  try {
    entry = await loadSeason(state.year);
  } catch (e) {
    $("#banner-slot").innerHTML = `<div class="banner">${esc(e.message)}</div>`;
    return;
  }
  const v = view(entry);
  document.body.classList.toggle("preseason", v.mode === "preseason");
  renderRoundBar(entry, v);
  renderBanner(entry, v);
  renderPredictors(entry, v);
  renderRace(entry, v);
  renderMatrix(entry, v);
  renderLadder(entry, v);
  renderFooter(entry);
  renderAccount();
}

function renderTabs() {
  const box = $("#season-tabs");
  box.innerHTML = CONFIG.seasons.map(y => {
    const cur = y === CONFIG.currentSeason;
    return `<button class="tab" role="tab" data-year="${y}" aria-selected="${y === state.year}">${y}${cur ? '<span class="live-dot" title="Current season"></span>' : ""}</button>`;
  }).join("");
  box.querySelectorAll(".tab").forEach(b => (b.onclick = () => { stopPlay(); state.year = +b.dataset.year; state.open.clear(); render(); }));
}

let rbFrame = 0;
function renderRoundBar(entry, v) {
  const bar = $("#roundbar"), slider = $("#round-slider"), title = $("#rb-title"), kicker = $("#rb-kicker");
  const prev = $("#rb-prev"), next = $("#rb-next"), play = $("#rb-play"), ticks = $("#rb-ticks");
  const rounds = v.mode === "scored" && !v.staticLadder ? entry.info.started : [];
  const usable = rounds.length > 1;
  bar.classList.toggle("disabled", !usable);
  [slider, prev, next, play].forEach(e => (e.disabled = !usable));

  if (!rounds.length) {
    kicker.textContent = v.staticLadder ? `${entry.year} season` : `${entry.year} season`;
    title.textContent = v.staticLadder ? "Final ladder" : "Pre-season";
    slider.min = 0; slider.max = 0; slider.value = 0; ticks.innerHTML = "";
    stopPlay();
    return;
  }

  const idx = rounds.indexOf(v.round);
  slider.min = 0; slider.max = rounds.length - 1; slider.value = idx;
  const info = entry.info;
  kicker.textContent = v.isFinal ? `${entry.year} · season complete` : "Ladder as at";
  title.innerHTML = v.isFinal ? `Final ladder` :
    `End of Round ${v.round}${v.inProgress ? `<span class="live">LIVE</span>` : ""}`;
  slider.setAttribute("aria-valuetext", `Round ${v.round}`);
  prev.disabled = !usable || idx <= 0;
  next.disabled = !usable || idx >= rounds.length - 1;

  // tick labels: first, last, current, and evenly spaced in between
  const every = Math.max(1, Math.ceil(rounds.length / Math.max(2, Math.floor((ticks.clientWidth || 600) / 34))));
  ticks.innerHTML = rounds.map((r, i) => {
    if (!(i === 0 || i === rounds.length - 1 || i === idx || i % every === 0)) return "";
    if (i !== idx && Math.abs(i - idx) < every / 2 && i !== 0 && i !== rounds.length - 1) return "";
    const pct = rounds.length === 1 ? 50 : (i / (rounds.length - 1)) * 100;
    return `<span class="${i === idx ? "on" : ""}" style="left:${pct}%">R${r}</span>`;
  }).join("");

  const go = i => {
    i = Math.max(0, Math.min(rounds.length - 1, i));
    state.round[entry.year] = rounds[i];
    cancelAnimationFrame(rbFrame);
    rbFrame = requestAnimationFrame(render);
  };
  slider.oninput = () => { stopPlay(); go(+slider.value); };
  prev.onclick = () => { stopPlay(); go(idx - 1); };
  next.onclick = () => { stopPlay(); go(idx + 1); };
  play.onclick = () => {
    if (state.playing) return stopPlay();
    let i = idx >= rounds.length - 1 ? 0 : idx;
    state.playing = setInterval(() => {
      if (i >= rounds.length - 1) return stopPlay();
      go(++i);
    }, 850);
    if (idx >= rounds.length - 1) go(0);
    play.setAttribute("aria-pressed", "true"); play.textContent = "❚❚ Pause";
  };
}

function stopPlay() {
  clearInterval(state.playing); state.playing = null;
  const play = $("#rb-play");
  play.setAttribute("aria-pressed", "false"); play.textContent = "▶ Play";
}

function renderBanner(entry, v) {
  const parts = [];
  if (entry.gamesError && !v.staticLadder && !(entry.live && v.mode === "preseason")) {
    parts.push(`<div class="banner">AFL results for ${entry.year} haven't been published to the site yet. They update automatically every 15 minutes during the season.</div>`);
  }
  if (entry.live && v.mode === "preseason") {
    const lock = entry.season.lockAt;
    const first = entry.info.firstBounce ? new Date(entry.info.firstBounce * 1000) : null;
    const when = lock || first;
    const editable = B.enabled() && (!lock || Date.now() < lock);
    const status = !B.enabled() ? "are in" : editable ? "are open" : "are locked";
    parts.push(`<div class="banner info"><strong>${entry.year} predictions ${status}.</strong> ${
      when ? `${lock ? "Picks lock" : "The season starts"} ${esc(fmtDate(when))}. ` : ""}${
      editable ? "Log in to set or change your ladder." : ""} Scores appear once the first game is played.</div>`);
  }
  $("#banner-slot").innerHTML = parts.join("");
}

function renderPredictors(entry, v) {
  const tbody = $("#predictor-table tbody");
  const sub = $("#predictor-sub");
  if (!entry.predictors.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">No predictions yet.</td></tr>`;
    sub.textContent = "";
    return;
  }

  if (v.mode === "preseason") {
    sub.textContent = `${entry.predictors.length} predictors · scoring starts at the first bounce`;
    const rows = [...entry.predictors].sort((a, b) => a.name.localeCompare(b.name));
    tbody.innerHTML = rows.map(p => `
      <tr data-u="${esc(p.username)}" class="${state.open.has(p.username) ? "open" : ""}">
        <td class="num pos muted">–</td>
        <td><button class="name-btn"><span class="chev">▶</span>${esc(p.name)}</button>
          ${p.updatedAt ? `<span class="edited">· updated ${esc(fmtDay(p.updatedAt))}</span>` : ""}</td>
        <td class="num total muted">–</td>
        <td><span class="guess">${dot(p.picks[0])}<span>${esc(team(p.picks[0]).short)}</span><span class="muted">tipped 1st</span></span></td>
        <td><span class="guess">${dot(p.picks[17])}<span>${esc(team(p.picks[17]).short)}</span><span class="muted">tipped 18th</span></span></td>
      </tr>${state.open.has(p.username) ? detailRow(p.picks.map((t, i) => ({ team: t, predicted: i + 1 }))) : ""}`).join("");
  } else {
    const ranked = S.rankPredictors(entry.predictors, v.ladder);
    const prev = v.prevLadder ? Object.fromEntries(S.rankPredictors(entry.predictors, v.prevLadder).map(p => [p.username, p.position])) : null;
    const label = v.isFinal ? "Final standings" : `Standings after Round ${v.round}${v.inProgress ? ` (${v.done} of ${v.of} games played)` : ""}`;
    sub.textContent = v.isFinal ? label : `${label} · if the ladder finished like this`;
    tbody.innerHTML = ranked.map(p => {
      const was = prev?.[p.username];
      const mv = was ? was - p.position : 0;
      const move = mv ? `<span class="move ${mv > 0 ? "up" : "down"}" title="${mv > 0 ? "Up" : "Down"} ${Math.abs(mv)} since last round">${mv > 0 ? "▲" : "▼"}${Math.abs(mv)}</span>` : "";
      return `
      <tr data-u="${esc(p.username)}" class="${p.position === 1 ? "leader" : ""} ${state.open.has(p.username) ? "open" : ""}">
        <td class="num pos">${p.position}</td>
        <td><button class="name-btn"><span class="chev">▶</span>${esc(p.name)}</button>${move}</td>
        <td class="num total">${p.total}</td>
        <td>${guess(p.best, "best")}</td>
        <td>${guess(p.worst, "worst")}</td>
      </tr>${state.open.has(p.username) ? detailRow(p.rows) : ""}`;
    }).join("");
  }
  tbody.querySelectorAll(".name-btn").forEach(btn => (btn.onclick = () => {
    const u = btn.closest("tr").dataset.u;
    state.open.has(u) ? state.open.delete(u) : state.open.add(u);
    renderPredictors(entry, v);
  }));
  tbody.querySelectorAll(".more").forEach(attachTip);
}

function guess(g, kind) {
  if (!g) return `<span class="muted">–</span>`;
  const t = team(g.team);
  const more = g.more > 0 ? `<span class="more" data-tip="${esc(kind)}">+${g.more} more</span>` : "";
  return `<span class="guess ${kind}">${dot(g.team)}<span>${esc(t.short)}</span><span class="d">(${g.diff})</span></span>${more}`;
}

function detailRow(rows) {
  const band = d => (d == null ? "" : d === 0 ? "0" : d <= 2 ? "1" : d <= 4 ? "2" : d <= 7 ? "3" : "4");
  return `<tr class="detail-row"><td colspan="5"><div class="detail-grid">${rows.map(r => `
    <div class="detail-item" title="Tipped ${r.predicted}${r.actual ? `, currently ${r.actual}` : ""}">
      <span class="p">${r.predicted}</span>
      <span class="t">${dot(r.team)}${esc(team(r.team).short)}</span>
      <span class="a">${r.actual ? `now ${r.actual}` : ""}</span>
      <span class="diff" data-band="${band(r.diff)}">${r.diff ?? ""}</span>
    </div>`).join("")}</div></td></tr>`;
}

// "+N more" tooltip: list the tied teams.
function attachTip(elm) {
  const tr = elm.closest("tr");
  const u = tr.dataset.u;
  const entry = state.cache[state.year];
  const v = view(entry);
  const p = entry.predictors.find(x => x.username === u);
  const s = S.scorePredictor(p.picks, v.ladder);
  const target = elm.dataset.tip === "best" ? s.best.diff : s.worst.diff;
  const teams = s.rows.filter(r => r.diff === target);
  const html = `<h4>${elm.dataset.tip === "best" ? "Best" : "Worst"} guesses (${target} off)</h4>` +
    teams.map(r => `<div class="row"><span>${dot(r.team)}${esc(team(r.team).short)}</span><span class="muted">tipped ${r.predicted}, now ${r.actual}</span></div>`).join("");
  elm.onmouseenter = e => showTip(html, e);
  elm.onmousemove = e => moveTip(e);
  elm.onmouseleave = hideTip;
  elm.tabIndex = 0;
  elm.onfocus = () => { const r = elm.getBoundingClientRect(); showTip(html, { clientX: r.right, clientY: r.bottom }); };
  elm.onblur = hideTip;
}

function renderLadder(entry, v) {
  const sub = $("#ladder-sub");
  const tbody = $("#afl-ladder tbody");
  if (v.mode === "preseason") sub.textContent = `${entry.year} season hasn't started`;
  else if (v.staticLadder) sub.textContent = `${entry.year} final home-and-away ladder`;
  else sub.textContent = v.isFinal ? `${entry.year} final home-and-away ladder` : `After Round ${v.round}${v.inProgress ? " (in progress)" : ""}`;
  const was = v.prevLadder ? Object.fromEntries(v.prevLadder.map(r => [r.name, r.rank])) : null;
  tbody.innerHTML = v.ladder.map(r => {
    const t = team(r.name);
    const mv = was ? was[r.name] - r.rank : 0;
    const mvCell = mv ? `<span class="${mv > 0 ? "up" : "down"}" title="${mv > 0 ? "Up" : "Down"} ${Math.abs(mv)} since last round">${mv > 0 ? "▲" : "▼"}${Math.abs(mv)}</span>` : "";
    const pct = r.pct == null || !r.played ? "–" : !isFinite(r.pct) ? "–" : r.pct.toFixed(1);
    return `<tr class="${r.rank === 8 ? "cut" : ""}" data-team="${esc(r.name)}">
      <td class="num rk">${r.rank}</td>
      <td class="mv ${mv > 0 ? "up" : mv < 0 ? "down" : ""}">${mvCell}</td>
      <td><span class="club">${dot(r.name)}${esc(t.short)}</span></td>
      <td class="num">${r.played ?? ""}</td>
      <td class="num pts">${r.pts ?? ""}</td>
      <td class="num pct">${v.staticLadder ? "" : pct}</td>
    </tr>`;
  }).join("");
}

function renderMatrix(entry, v) {
  const table = $("#matrix");
  const preds = v.mode === "scored" ? S.rankPredictors(entry.predictors, v.ladder) : [...entry.predictors].sort((a, b) => a.name.localeCompare(b.name));
  if (!preds.length) { table.innerHTML = ""; return; }
  const showActual = v.mode === "scored";
  $("#matrix-sub").textContent = `Each column is one predictor's ladder.${showActual ? " Hover a club to find it in every column." : ""}`;
  let html = `<thead><tr><th class="num">#</th>${preds.map(p => `<th class="pn">${esc(p.name)}</th>`).join("")}${showActual ? `<th class="pn">Actual</th>` : ""}</tr></thead><tbody>`;
  for (let i = 0; i < 18; i++) {
    html += `<tr><td class="rk">${i + 1}</td>`;
    for (const p of preds) html += `<td data-team="${esc(p.picks[i])}"><span class="cell">${dot(p.picks[i])}${esc(team(p.picks[i]).short)}</span></td>`;
    if (showActual) html += `<td data-team="${esc(v.ladder[i].name)}"><span class="cell">${dot(v.ladder[i].name)}<strong>${esc(team(v.ladder[i].name).short)}</strong></span></td>`;
    html += `</tr>`;
  }
  table.innerHTML = html + "</tbody>";
  const cells = [...table.querySelectorAll("td[data-team]")];
  cells.forEach(c => {
    c.onmouseenter = () => cells.forEach(o => { o.classList.toggle("dim", o.dataset.team !== c.dataset.team); o.querySelector(".cell").classList.toggle("hl", o.dataset.team === c.dataset.team); });
  });
  table.onmouseleave = () => cells.forEach(o => { o.classList.remove("dim"); o.querySelector(".cell").classList.remove("hl"); });
}

/* ───────────────────────── Season race chart ───────────────────────── */

function renderRace(entry, v) {
  const card = $("#race-card");
  const rounds = v.mode === "scored" && !v.staticLadder ? entry.info.started.filter(r => r <= v.round) : [];
  if (!rounds.length || !entry.predictors.length) { card.hidden = true; return; }
  card.hidden = false;

  const people = [...entry.predictors].sort((a, b) => a.name.localeCompare(b.name)); // colour follows the person
  const colour = Object.fromEntries(people.map((p, i) => [p.name, SERIES(i)]));
  const hist = S.history(people, entry.games, rounds);

  const box = $("#race-chart");
  const W = Math.max(320, box.clientWidth || 700), H = 280;
  const m = { l: 36, r: people.length <= 8 ? 92 : 16, t: 12, b: 28 };
  const all = hist.flatMap(h => Object.values(h.totals));
  let lo = Math.min(...all), hi = Math.max(...all);
  if (lo === hi) { lo -= 5; hi += 5; }
  const pad = (hi - lo) * 0.08; lo = Math.max(0, Math.floor(lo - pad)); hi = Math.ceil(hi + pad);
  const x = r => rounds.length === 1 ? m.l + (W - m.l - m.r) / 2 : m.l + ((r - rounds[0]) / (rounds[rounds.length - 1] - rounds[0])) * (W - m.l - m.r);
  const y = val => m.t + (1 - (val - lo) / (hi - lo)) * (H - m.t - m.b);
  const step = niceStep((hi - lo) / 5);
  const ticks = []; for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  const xEvery = Math.ceil(rounds.length / Math.max(2, Math.floor((W - m.l - m.r) / 44)));

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Total points per predictor after each round">`;
  svg += `<g class="grid">${ticks.map(t => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>`).join("")}</g>`;
  svg += `<g class="axis">${ticks.map(t => `<text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join("")}`;
  svg += rounds.map((r, i) => (i % xEvery === 0 || i === rounds.length - 1) ? `<text x="${x(r)}" y="${H - 8}" text-anchor="middle">R${r}</text>` : "").join("") + `</g>`;
  for (const p of people) {
    const pts = hist.map(h => [x(h.round), y(h.totals[p.name])]);
    const d = pts.map((q, i) => `${i ? "L" : "M"}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join("");
    svg += `<g class="series" data-name="${esc(p.name)}"><path d="${d}" stroke="${colour[p.name]}"/>`;
    const last = pts[pts.length - 1];
    svg += `<circle cx="${last[0]}" cy="${last[1]}" r="4.5" fill="${colour[p.name]}"/></g>`;
  }
  // direct end labels, nudged apart
  if (people.length <= 8) {
    const lastT = hist[hist.length - 1].totals;
    const labels = people.map(p => ({ name: p.name, y: y(lastT[p.name]) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
    svg += labels.map(l => `<text class="endlabel" x="${W - m.r + 10}" y="${l.y + 4}">${esc(l.name)}</text>`).join("");
  }
  svg += `<line class="crosshair" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>`;
  svg += `<rect class="hit" x="${m.l - 10}" y="0" width="${W - m.l - m.r + 20}" height="${H}" fill="transparent"/></svg>`;
  box.innerHTML = svg;

  const legend = $("#race-legend");
  legend.innerHTML = people.map(p => `<button data-name="${esc(p.name)}"><span class="sw" style="background:${colour[p.name]}"></span>${esc(p.name)}</button>`).join("");
  const focus = name => box.querySelectorAll(".series").forEach(g => g.classList.toggle("dim", !!name && g.dataset.name !== name));
  legend.querySelectorAll("button").forEach(b => { b.onmouseenter = () => focus(b.dataset.name); b.onmouseleave = () => focus(null); b.onfocus = () => focus(b.dataset.name); b.onblur = () => focus(null); });

  const svgEl = box.querySelector("svg"), hit = box.querySelector(".hit"), cross = box.querySelector(".crosshair");
  hit.onmousemove = e => {
    const r = svgEl.getBoundingClientRect();
    const px = (e.clientX - r.left) * (W / r.width);
    let best = hist[0]; for (const h of hist) if (Math.abs(x(h.round) - px) < Math.abs(x(best.round) - px)) best = h;
    cross.setAttribute("x1", x(best.round)); cross.setAttribute("x2", x(best.round)); cross.setAttribute("visibility", "visible");
    const rows = Object.entries(best.totals).sort((a, b) => a[1] - b[1]);
    showTip(`<h4>After Round ${best.round}</h4>` + rows.map(([n, t]) => `<div class="row"><span><span class="sw" style="background:${colour[n]}"></span>${esc(n)}</span><strong>${t}</strong></div>`).join(""), e);
  };
  hit.onmouseleave = () => { cross.setAttribute("visibility", "hidden"); hideTip(); };
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

const tip = () => $("#tooltip");
function showTip(html, e) { tip().innerHTML = html; tip().hidden = false; moveTip(e); }
function moveTip(e) {
  const t = tip(), w = t.offsetWidth, h = t.offsetHeight;
  let left = e.clientX + 14, top = e.clientY + 14;
  if (left + w > innerWidth - 8) left = e.clientX - w - 14;
  if (top + h > innerHeight - 8) top = e.clientY - h - 14;
  t.style.left = `${left}px`; t.style.top = `${top}px`;
}
function hideTip() { tip().hidden = true; }

function renderFooter(entry) {
  const bits = [`Scoring: for each club, the gap between where you tipped it and where it sits on the ladder. Add them up, lowest wins.`];
  if (entry.live && entry.season.lockAt) bits.push(`${entry.year} picks lock ${fmtDate(entry.season.lockAt)}.`);
  $("#foot").textContent = bits.join(" ");
}

/* ───────────────────────── Accounts & editing ───────────────────────── */

function renderAccount() {
  const box = $("#account");
  if (!B.enabled()) { box.innerHTML = ""; return; }
  if (state.user) {
    box.innerHTML = `<span>Logged in as <span class="who">${esc(B.usernameOf(state.user))}</span></span>
      <button class="btn primary small" id="my-picks">${B.isAdmin(state.user) ? "Edit picks" : "My picks"}</button>
      <button class="btn small" id="logout">Log out</button>`;
    $("#my-picks").onclick = openEditor;
    $("#logout").onclick = async () => { await B.logout(); };
  } else {
    box.innerHTML = `<button class="btn primary small" id="login-btn">Log in to edit picks</button>`;
    $("#login-btn").onclick = () => { $("#login-error").textContent = ""; $("#login-dialog").showModal(); };
  }
}

function setupDialogs() {
  document.querySelectorAll("dialog [data-close]").forEach(b => (b.onclick = () => b.closest("dialog").close()));
  $("#login-form").onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector("[type=submit]");
    btn.disabled = true; $("#login-error").textContent = "";
    try {
      await B.login(f.username.value, f.password.value);
      f.reset();
      $("#login-dialog").close();
      openEditor();
    } catch (err) {
      $("#login-error").textContent = /invalid|wrong|not-found|credential/i.test(err.code || err.message) ? "Username or password is incorrect." : (err.message || "Couldn't log in.");
    } finally { btn.disabled = false; }
  };
  $("#pw-toggle").onclick = () => { $("#pw-form").hidden = !$("#pw-form").hidden; };
  $("#pw-form").onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    $("#pw-error").textContent = "";
    try {
      await B.changePassword(f.current.value, f.next.value);
      f.reset(); f.hidden = true;
      $("#saved-note").textContent = "Password updated ✓";
    } catch (err) {
      $("#pw-error").textContent = /credential|wrong/i.test(err.code || "") ? "Current password is incorrect." : (err.message || "Couldn't change password.");
    }
  };
}

const editor = { who: null };

async function openEditor() {
  if (!state.user) return;
  const entry = await loadSeason(CONFIG.currentSeason);
  if (state.year !== CONFIG.currentSeason) { state.year = CONFIG.currentSeason; render(); }
  const admin = B.isAdmin(state.user);
  const me = B.usernameOf(state.user);
  const whoSel = $("#editor-who");
  $("#admin-tools").hidden = !admin;
  if (admin) {
    const list = [...entry.predictors].sort((a, b) => a.name.localeCompare(b.name));
    if (!list.some(p => p.username === me)) list.unshift({ username: me, name: me });
    whoSel.innerHTML = list.map(p => `<option value="${esc(p.username)}">${esc(p.name)}</option>`).join("") + `<option value="__new">+ Add a predictor…</option>`;
    whoSel.value = me;
    whoSel.onchange = () => {
      if (whoSel.value === "__new") {
        const name = prompt("New predictor's display name (their login username must match, without spaces):");
        if (!name) { whoSel.value = editor.who; return; }
        const u = slug(name);
        whoSel.insertAdjacentHTML("afterbegin", `<option value="${esc(u)}">${esc(name)}</option>`);
        whoSel.value = u;
        loadEditorFor(entry, u, name);
      } else loadEditorFor(entry, whoSel.value);
    };
    const lock = entry.season.lockAt || (entry.info.firstBounce ? new Date(entry.info.firstBounce * 1000) : null);
    $("#lock-input").value = lock ? toLocalInput(lock) : "";
    $("#lock-save").onclick = async () => {
      const val = $("#lock-input").value;
      if (!val) return;
      try {
        const d = new Date(val);
        await B.setLock(entry.year, d);
        entry.season.lockAt = d;
        $("#saved-note").textContent = "Lock time saved ✓";
        loadEditorFor(entry, editor.who);
        render();
      } catch (err) { $("#editor-error").textContent = err.message; }
    };
  }
  loadEditorFor(entry, me);
  $("#pw-form").hidden = true;
  $("#editor-dialog").showModal();
}

function loadEditorFor(entry, username, newName) {
  editor.who = username;
  const admin = B.isAdmin(state.user);
  const p = entry.predictors.find(x => x.username === username);
  const name = p?.name || newName || username.charAt(0).toUpperCase() + username.slice(1);
  const picks = p?.picks?.length === 18 ? [...p.picks] : [...TEAM_NAMES];
  const lock = entry.season.lockAt;
  const locked = !lock || Date.now() >= lock;
  const canEdit = admin || !locked;

  $("#editor-title").textContent = admin && username !== B.usernameOf(state.user) ? `${name}'s picks` : `${entry.year} picks`;
  $("#editor-name").value = name;
  $("#editor-lock").textContent = !lock
    ? (admin ? "Set a lock time below so players can save their picks." : "Picks open once the lock time has been set. Check back soon.")
    : Date.now() < lock ? `You can change these until ${fmtDate(lock)}.` : `Picks locked ${fmtDate(lock)}.${admin ? " As admin you can still make corrections." : ""}`;
  $("#editor-error").textContent = "";
  $("#saved-note").textContent = "";
  $(".editor").classList.toggle("locked", !canEdit);
  $("#picks-save").disabled = !canEdit;

  const list = $("#pick-list");
  const draw = order => {
    list.innerHTML = order.map((t, i) => `<li data-team="${esc(t)}">
      <span class="p">${i + 1}</span>${dot(t)}<span>${esc(team(t).name)}</span>
      ${canEdit ? `<span class="arrows"><button type="button" data-dir="-1" aria-label="Move ${esc(team(t).short)} up" ${i === 0 ? "disabled" : ""}>▲</button><button type="button" data-dir="1" aria-label="Move ${esc(team(t).short)} down" ${i === 17 ? "disabled" : ""}>▼</button></span>` : ""}
    </li>`).join("");
    list.querySelectorAll("[data-dir]").forEach(b => (b.onclick = () => {
      const cur = currentOrder(), i = cur.indexOf(b.closest("li").dataset.team), j = i + +b.dataset.dir;
      [cur[i], cur[j]] = [cur[j], cur[i]];
      draw(cur);
      list.querySelector(`li[data-team="${CSS.escape(cur[j])}"] [data-dir="${b.dataset.dir}"]`)?.focus();
    }));
  };
  draw(picks);
  editor.sortable?.destroy();
  if (canEdit && window.Sortable) {
    editor.sortable = window.Sortable.create(list, { animation: 140, ghostClass: "ghost", chosenClass: "chosen", filter: "button", preventOnFilter: false, onEnd: () => draw(currentOrder()) });
  }

  $("#picks-save").onclick = async () => {
    const order = currentOrder();
    if (new Set(order).size !== 18) { $("#editor-error").textContent = "Each club must appear exactly once."; return; }
    const displayName = (admin ? $("#editor-name").value.trim() : name) || name;
    const btn = $("#picks-save");
    btn.disabled = true; $("#editor-error").textContent = "";
    try {
      await B.savePicks(entry.year, username, displayName, order);
      let target = entry.predictors.find(x => x.username === username);
      if (!target) entry.predictors.push(target = { username });
      Object.assign(target, { name: displayName, picks: order, updatedAt: new Date() });
      $("#saved-note").textContent = "Saved ✓";
      render();
    } catch (err) {
      $("#editor-error").textContent = /permission/i.test(err.code || err.message)
        ? "Save was refused. Picks may be locked, or your login doesn't match this predictor."
        : (err.message || "Couldn't save.");
    } finally { btn.disabled = false; }
  };
}

const currentOrder = () => [...$("#pick-list").children].map(li => li.dataset.team);
const toLocalInput = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/* ───────────────────────── Boot ───────────────────────── */

setupDialogs();
render();
B.onUser(user => { state.user = user; renderAccount(); });
let resizeT;
addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => { const e = state.cache[state.year]; if (e) { renderRace(e, view(e)); renderRoundBar(e, view(e)); } }, 150); });
