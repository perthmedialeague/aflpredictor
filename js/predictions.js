// Season Predictions hub: everyone's bold calls for the year, checked against results and the news.
import * as P from "./bold.js";
import * as S from "./scoring.js";
import * as B from "./backend.js";
import { TEAMS } from "./teams.js";

const cache = {};   // year → { preds, news }
const ui = { filter: "all", editing: null, kind: "free", msg: "", flash: "" };

async function loadNews(year) {
  try { const r = await fetch(`data/news-${year}.json`, { cache: "no-cache" }); return r.ok ? (await r.json()).items || {} : {}; }
  catch { return {}; }
}

/** ctx: { entry, user, users, nameOf, isCurrent, perPerson, openLogin, h: { $, esc, dot, team, fmtDate } } */
export async function renderPredictions(ctx, { reload = false } = {}) {
  const { entry, h } = ctx;
  const root = h.$("#view-predictions");
  const year = entry.year;
  let c = cache[year];
  if (!c || reload) {
    if (!c) root.innerHTML = `<div class="layout"><section class="col-main"><article class="card"><p class="muted">Loading predictions…</p></article></section></div>`;
    const [preds, news] = await Promise.all([B.enabled() ? B.listPredictions(year).catch(() => []) : [], loadNews(year)]);
    c = cache[year] = { preds, news };
  }

  const me = B.usernameOf(ctx.user);
  const admin = ctx.user && B.isAdmin(ctx.user);
  const lockAt = entry.season?.lockAt || null;
  const open = ctx.isCurrent && B.enabled() && lockAt && Date.now() < lockAt;
  const ladder = S.computeLadder(entry.games);
  const seasonOver = entry.info.seasonOver;

  // outcome of every prediction
  const rows = c.preds.map(p => ({ ...p, outcome: outcomeOf(p, ladder, entry.games, seasonOver) }));
  const users = [...new Set([...ctx.users, ...rows.map(r => r.user)])];
  const board = users.map(u => {
    const mine = rows.filter(r => r.user === u);
    return { user: u, total: mine.length, right: mine.filter(r => r.outcome.status === "true").length,
      wrong: mine.filter(r => r.outcome.status === "false").length };
  }).sort((a, b) => b.right - a.right || a.wrong - b.wrong || ctx.nameOf(a.user).localeCompare(ctx.nameOf(b.user)));
  board.forEach((r, i) => (r.position = i && r.right === board[i - 1].right && r.wrong === board[i - 1].wrong ? board[i - 1].position : i + 1));

  const scoreboard = `<article class="card">
    <header class="card-head"><h2>Scoreboard</h2><p class="card-sub">Most predictions that came true wins.</p></header>
    <table class="predictors pr-board"><thead><tr><th class="num">#</th><th>Name</th><th class="num" title="Came true">✓</th><th class="num" title="Didn't happen">✗</th><th class="num" title="Total predictions">Made</th></tr></thead>
    <tbody>${board.map(r => `<tr class="${r.position === 1 && r.right ? "leader" : ""}">
      <td class="num pos">${board.some(x => x.right || x.wrong) ? r.position : "–"}</td>
      <td><button class="pr-who" data-filter="${h.esc(r.user)}">${h.esc(ctx.nameOf(r.user))}</button></td>
      <td class="num total">${r.right}</td><td class="num">${r.wrong}</td><td class="num muted">${r.total}</td></tr>`).join("")}</tbody></table>
  </article>`;

  // ── add / edit form ──
  let form = "";
  if (ctx.isCurrent) {
    if (!B.enabled()) form = card(`<h2>Add a Prediction</h2><p class="card-sub">Logins aren't set up yet.</p>`);
    else if (!ctx.user) form = card(`<header class="card-head"><h2>Add a Prediction</h2><p class="card-sub">Log in to add your predictions for ${year}.</p></header><button class="btn primary" data-act="login">Log in</button>`);
    else if (!open && !admin) form = card(`<h2>Predictions are locked</h2><p class="card-sub">${lockAt ? `Predictions closed ${h.esc(h.fmtDate(lockAt))}.` : "Predictions open once John sets the season's lock time."}</p>`);
    else form = formCard(ctx, rows, me, admin, lockAt, open);
  }

  // ── list ──
  const filters = [["all", "Everyone"], ...users.map(u => [u, ctx.nameOf(u)]), ["true", "Came true"], ["pending", "Undecided"], ["false", "Didn't happen"]];
  const visible = rows.filter(r => ui.filter === "all" ? true
    : ["true", "false"].includes(ui.filter) ? r.outcome.status === ui.filter
    : ui.filter === "pending" ? !["true", "false"].includes(r.outcome.status)
    : r.user === ui.filter);
  const groups = users.map(u => [u, visible.filter(r => r.user === u)]).filter(([, l]) => l.length);

  const list = `<article class="card">
    <header class="card-head"><h2>${year} Predictions</h2>
      <p class="card-sub">Ladder and win predictions check themselves from the results. Everything else gets matched against the news daily, and John confirms it.</p></header>
    <div class="pr-filters" role="toolbar">${filters.map(([k, l]) => `<button class="pr-filter ${ui.filter === k ? "on" : ""}" data-filter="${h.esc(k)}">${h.esc(l)}</button>`).join("")}</div>
    ${groups.length ? groups.map(([u, l]) => `
      <section class="pr-group"><h3>${h.esc(ctx.nameOf(u))}</h3>
        ${l.map(r => item(ctx, r, c.news[r.id] || [], { me, admin, open })).join("")}
      </section>`).join("")
    : `<p class="muted">${rows.length ? "Nothing matches this filter." : "No predictions yet. Be the first!"}</p>`}
  </article>`;

  root.innerHTML = `<div class="layout"><section class="col-main">${form}${list}</section><aside class="col-side">${scoreboard}</aside></div>`;
  wire(ctx, root, year, c, rows);
}

function outcomeOf(p, ladder, games, seasonOver) {
  if (p.status === "true" || p.status === "false") return { status: p.status, detail: "", manual: true };
  if (p.kind === "ladder") return P.evaluateLadder(p, ladder, games, seasonOver);
  return { status: "pending", detail: "" };
}

const card = html => `<article class="card">${html}</article>`;
const BADGE = {
  true: ["✓ Came true", "good"], false: ["✗ Didn't happen", "bad"], "on-track": ["On track", "track"],
  "off-track": ["Off track", "offtrack"], pending: ["Undecided", "pending"], waiting: ["Waiting for the season", "pending"],
};

function item(ctx, r, news, { me, admin, open }) {
  const { h } = ctx;
  const [label, cls] = BADGE[r.outcome.status] || BADGE.pending;
  const mine = r.user === me;
  const canEdit = (mine && open) || admin;
  const ev = r.evidence;
  const by = r.resolvedBy ? ` by ${h.esc(ctx.nameOf(r.resolvedBy))}` : "";
  return `<div class="pr-item ${cls}" data-id="${h.esc(r.id)}">
    <div class="pr-top">
      <p class="pr-text">${r.kind === "ladder" ? h.dot(r.team) : ""}${h.esc(r.text)}</p>
      <span class="pr-badge ${cls}">${label}</span>
    </div>
    <div class="pr-meta">
      ${r.kind === "ladder" ? `<span>Checked automatically${r.outcome.detail ? ` · ${h.esc(r.outcome.detail)}` : ""}</span>`
        : `<span>Searching: ${(r.keywords || []).map(k => `<span class="pr-kw">${h.esc(k)}</span>`).join(" ") || "<em>no keywords</em>"}</span>`}
      ${r.outcome.manual && r.resolvedAt ? `<span>Confirmed${by} ${h.esc(h.fmtDate(r.resolvedAt))}</span>` : ""}
    </div>
    ${ev?.link ? `<p class="pr-evidence">Evidence: <a href="${h.esc(ev.link)}" target="_blank" rel="noopener">${h.esc(ev.title || ev.link)}</a>${ev.source ? ` <span class="muted">· ${h.esc(ev.source)}</span>` : ""}</p>` : ""}
    ${r.note ? `<p class="pr-evidence">${h.esc(r.note)}</p>` : ""}
    ${r.kind === "free" && news.length ? `<details class="pr-news" ${r.outcome.status === "pending" && admin ? "open" : ""}>
      <summary>${news.length} possible news match${news.length === 1 ? "" : "es"}</summary>
      <ul>${news.map((n, i) => `<li><a href="${h.esc(n.link)}" target="_blank" rel="noopener">${h.esc(n.title)}</a>
        <span class="muted">${h.esc(n.source || "")}${n.published ? ` · ${h.esc(new Date(n.published).toLocaleDateString("en-AU", { day: "numeric", month: "short" }))}` : ""}</span>
        ${admin && r.outcome.status !== "true" ? `<button class="btn small" data-act="true-with" data-n="${i}">Came true: use this</button>` : ""}</li>`).join("")}</ul>
    </details>` : ""}
    ${(canEdit || admin) ? `<div class="pr-actions">
      ${canEdit && !r.outcome.manual ? `<button class="btn small ghost" data-act="edit">Edit</button><button class="btn small ghost" data-act="delete">Delete</button>` : ""}
      ${admin ? `<span class="spacer"></span>
        ${r.outcome.status !== "true" ? `<button class="btn small" data-act="true">✓ Came true</button>` : ""}
        ${r.outcome.status !== "false" ? `<button class="btn small" data-act="false">✗ Didn't happen</button>` : ""}
        ${r.outcome.manual ? `<button class="btn small ghost" data-act="reset">Reset</button>` : ""}` : ""}
    </div>` : ""}
  </div>`;
}

function formCard(ctx, rows, me, admin, lockAt, open) {
  const { h } = ctx;
  const ed = ui.editing ? rows.find(r => r.id === ui.editing) : null;
  const kind = ed ? ed.kind : ui.kind;
  const mineCount = rows.filter(r => r.user === me).length;
  const full = !ed && mineCount >= ctx.perPerson;
  const condOpts = Object.entries(P.CONDITIONS).map(([k, v]) => `<option value="${k}" ${ed?.cond === k ? "selected" : ""}>${h.esc(v.label)}</option>`).join("");
  const teamOpts = TEAMS.map(t => `<option value="${h.esc(t.name)}" ${ed?.team === t.name ? "selected" : ""}>${h.esc(t.name)}</option>`).join("");
  return `<article class="card pr-form-card">
    <header class="card-head"><h2>${ed ? "Edit Prediction" : "Add a Prediction"}</h2>
      <p class="card-sub">${open ? `You've made ${mineCount} of ${ctx.perPerson}. You can add, edit or delete until ${h.esc(h.fmtDate(lockAt))}.` : "Predictions are locked for players. As admin you can still edit."}</p></header>
    ${full ? `<p class="muted">You've made all ${ctx.perPerson} predictions. Delete one to add another.</p>` : `
    <form id="pr-form" class="pr-form">
      <div class="pr-kinds" role="radiogroup">
        <label><input type="radio" name="kind" value="free" ${kind === "free" ? "checked" : ""} ${ed ? "disabled" : ""}> Anything <span class="muted">· checked against the news</span></label>
        <label><input type="radio" name="kind" value="ladder" ${kind === "ladder" ? "checked" : ""} ${ed ? "disabled" : ""}> Ladder or wins <span class="muted">· checked automatically</span></label>
      </div>
      ${kind === "free" ? `
        <label>Prediction <textarea name="text" maxlength="200" rows="2" required placeholder="e.g. Harley Reid wins the Brownlow">${h.esc(ed?.text || "")}</textarea></label>
        <label>News search words <input name="keywords" value="${h.esc((ed?.keywords || []).join(", "))}" placeholder="filled in for you, separated by commas">
          <span class="hint">Headlines need at least two of these words to count as a match.</span></label>`
      : `<div class="pr-ladder-row">
          <select name="team" aria-label="Club">${teamOpts}</select>
          <select name="cond" aria-label="Condition">${condOpts}</select>
          <input name="n" type="number" min="0" max="24" value="${h.esc(ed?.n ?? 4)}" aria-label="Number">
        </div>
        <p class="pr-preview" id="pr-preview"></p>`}
      <p class="form-error" id="pr-error" role="alert">${h.esc(ui.msg)}</p>
      <div class="actions">
        <span class="saved-note">${h.esc(ui.flash)}</span><span class="spacer"></span>
        ${ed ? `<button type="button" class="btn ghost" data-act="cancel">Cancel</button>` : ""}
        <button type="submit" class="btn primary">${ed ? "Save changes" : "Add prediction"}</button>
      </div>
    </form>`}
  </article>`;
}

function wire(ctx, root, year, c, rows) {
  const rerender = (o) => renderPredictions(ctx, o);
  root.querySelector('[data-act="login"]')?.addEventListener("click", ctx.openLogin);
  root.querySelectorAll("[data-filter]").forEach(b => (b.onclick = () => { ui.filter = b.dataset.filter; rerender(); }));

  const form = root.querySelector("#pr-form");
  if (form) {
    form.querySelectorAll('input[name="kind"]').forEach(r => (r.onchange = () => { ui.kind = r.value; ui.msg = ""; rerender(); }));
    const preview = () => {
      const pv = root.querySelector("#pr-preview");
      if (pv) pv.textContent = `“${P.CONDITIONS[form.cond.value].text(form.team.value, +form.n.value)}”`;
    };
    if (form.team) { ["change", "input"].forEach(ev => form.addEventListener(ev, preview)); preview(); }
    if (form.text) form.text.addEventListener("blur", () => { if (!form.keywords.value.trim()) form.keywords.value = P.suggestKeywords(form.text.value).join(", "); });
    root.querySelector('[data-act="cancel"]')?.addEventListener("click", () => { ui.editing = null; ui.msg = ""; rerender(); });
    form.onsubmit = async e => {
      e.preventDefault();
      const ed = ui.editing ? rows.find(r => r.id === ui.editing) : null;
      const kind = ed ? ed.kind : ui.kind;
      let data;
      if (kind === "free") {
        const text = form.text.value.trim();
        let keywords = form.keywords.value.split(",").map(s => s.trim()).filter(Boolean);
        if (!keywords.length) keywords = P.suggestKeywords(text);
        if (text.length < 4) { ui.msg = "Write a little more."; return rerender(); }
        data = { kind, text, keywords: keywords.slice(0, 8) };
      } else {
        const n = parseInt(form.n.value, 10);
        if (!(n >= 0 && n <= 24)) { ui.msg = "Pick a number from 0 to 24."; return rerender(); }
        data = { kind, team: form.team.value, cond: form.cond.value, n, text: P.CONDITIONS[form.cond.value].text(form.team.value, n), keywords: [] };
      }
      const btn = form.querySelector("[type=submit]");
      btn.disabled = true;
      try {
        await B.savePrediction(year, ed?.id || null, data);
        ui.editing = null; ui.msg = ""; ui.flash = ed ? "Saved ✓" : "Added ✓";
        await rerender({ reload: true });
        ui.flash = "";
      } catch (err) {
        ui.msg = /permission/i.test(err.code || err.message) ? "Save was refused. Predictions may be locked." : (err.message || "Couldn't save.");
        btn.disabled = false; rerender();
      }
    };
  }

  root.querySelectorAll(".pr-item").forEach(el => {
    const id = el.dataset.id;
    const r = rows.find(x => x.id === id);
    const act = (name, fn) => el.querySelectorAll(`[data-act="${name}"]`).forEach(b => (b.onclick = async () => {
      b.disabled = true;
      try { await fn(b); await rerender({ reload: true }); }
      catch (err) { alertInline(el, /permission/i.test(err.code || err.message) ? "That was refused. Predictions may be locked." : err.message); b.disabled = false; }
    }));
    el.querySelector('[data-act="edit"]')?.addEventListener("click", () => {
      ui.editing = id; ui.msg = ""; rerender();
      root.querySelector(".pr-form-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    act("delete", async () => { if (!confirm(`Delete “${r.text}”?`)) throw new Error("Cancelled"); await B.deletePrediction(year, id); });
    act("true", () => B.resolvePrediction(year, id, "true", null));
    act("false", () => B.resolvePrediction(year, id, "false", null));
    act("reset", () => B.resolvePrediction(year, id, "pending"));
    act("true-with", b => { const n = (c.news[id] || [])[+b.dataset.n]; return B.resolvePrediction(year, id, "true", n ? { title: n.title, link: n.link, source: n.source || "" } : null); });
  });
}

function alertInline(el, msg) {
  if (msg === "Cancelled") return;
  let p = el.querySelector(".form-error");
  if (!p) { p = document.createElement("p"); p.className = "form-error"; el.appendChild(p); }
  p.textContent = msg;
}

export function invalidatePredictions(year) { delete cache[year]; }
