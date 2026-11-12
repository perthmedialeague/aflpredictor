// Season predictions ("bold predictions"): pure helpers, shared by the page and the news script.
import { TEAMS, canonical } from "./teams.js";

export const CONDITIONS = {
  top:         { label: "finish in the top …",     needsN: true,  text: (t, n) => `${t} finish in the top ${n}` },
  missTop:     { label: "miss the top …",           needsN: true,  text: (t, n) => `${t} miss the top ${n}` },
  bottom:      { label: "finish in the bottom …",  needsN: true,  text: (t, n) => `${t} finish in the bottom ${n}` },
  exact:       { label: "finish exactly …",         needsN: true,  text: (t, n) => `${t} finish ${ordinal(n)}` },
  winsAtLeast: { label: "win at least … games",     needsN: true,  text: (t, n) => `${t} win ${n} or more games` },
  winsAtMost:  { label: "win at most … games",      needsN: true,  text: (t, n) => `${t} win ${n} or fewer games` },
};

export const ordinal = n => n + (["th", "st", "nd", "rd"][((n % 100) - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");

/**
 * Evaluate a ladder-type prediction.
 * ladder: rows from computeLadder(); games: H&A games; seasonOver: boolean.
 * Returns { status: "true" | "false" | "on-track" | "off-track" | "waiting", detail }
 */
export function evaluateLadder(pred, ladder, games, seasonOver) {
  const row = ladder.find(r => r.name === pred.team);
  if (!row) return { status: "waiting", detail: "" };
  const started = ladder.some(r => r.played > 0);
  if (!started) return { status: "waiting", detail: "Season not started" };
  const n = +pred.n;
  const remaining = games.filter(g => g.complete !== 100 && (g.hteam === pred.team || g.ateam === pred.team)).length;
  const pos = row.rank, wins = row.wins;
  const detail = pred.cond.startsWith("wins")
    ? `${wins} win${wins === 1 ? "" : "s"}, ${remaining} game${remaining === 1 ? "" : "s"} left`
    : `Currently ${ordinal(pos)}`;

  let ok;
  switch (pred.cond) {
    case "top": ok = pos <= n; break;
    case "missTop": ok = pos > n; break;
    case "bottom": ok = pos > ladder.length - n; break;
    case "exact": ok = pos === n; break;
    case "winsAtLeast":
      if (wins >= n) return { status: "true", detail };
      if (wins + remaining < n) return { status: "false", detail };
      ok = pace(row, remaining) >= n; break;   // on track if their current win rate gets there
    case "winsAtMost":
      if (wins > n) return { status: "false", detail };
      if (seasonOver || remaining === 0) return { status: "true", detail };
      ok = pace(row, remaining) <= n; break;
    default: return { status: "waiting", detail: "" };
  }
  if (seasonOver) return { status: ok ? "true" : "false", detail };
  return { status: ok ? "on-track" : "off-track", detail };
}

// Projected season wins at the current win rate (draws count as half).
const pace = (row, remaining) => row.played ? (row.wins + row.draws / 2) + ((row.wins + row.draws / 2) / row.played) * remaining : 0;

const STOP = new Set(("a an and are as at be been by can do for from get gets go goes going has have he her his in into is it its "
  + "make makes more most next not of off on or our out over season she so than that the their them then there they this to too "
  + "up was we were will win wins with won't would year afl footy game games finish finishes before after during round rounds "
  + "both bottom top first last end ladder week weeks").split(" "));

/** Suggested search keywords for a free-text prediction: club names plus the meaningful words. */
export function suggestKeywords(text) {
  const out = [];
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ")} `;
  for (const t of TEAMS) {
    const names = [t.name, t.short, ...Object.keys(ALIAS_HINTS).filter(k => ALIAS_HINTS[k] === t.name)];
    if (names.some(nm => lower.includes(` ${nm.toLowerCase()} `))) out.push(t.short === "GWS" ? "GWS" : t.name);
  }
  for (const w of text.replace(/[^A-Za-z0-9' ]+/g, " ").split(/\s+/)) {
    const lw = w.toLowerCase();
    if (lw.length < 3 || STOP.has(lw) || canonical(w)) continue;
    if (out.some(o => o.toLowerCase().split(" ").includes(lw))) continue;
    out.push(w);
  }
  return [...new Set(out)].slice(0, 6);
}
const ALIAS_HINTS = { freo: "Fremantle", dockers: "Fremantle", eagles: "West Coast", pies: "Collingwood", magpies: "Collingwood",
  dees: "Melbourne", demons: "Melbourne", swans: "Sydney", lions: "Brisbane Lions", cats: "Geelong", hawks: "Hawthorn",
  tigers: "Richmond", bombers: "Essendon", blues: "Carlton", saints: "St Kilda", suns: "Gold Coast", giants: "Greater Western Sydney",
  crows: "Adelaide", power: "Port Adelaide", roos: "North Melbourne", kangaroos: "North Melbourne", bulldogs: "Western Bulldogs", dogs: "Western Bulldogs" };

/** A news headline counts as a match if it contains enough of the keywords. */
export function headlineMatches(title, keywords) {
  if (!keywords?.length) return false;
  const t = ` ${title.toLowerCase().replace(/[^a-z0-9' ]+/g, " ")} `;
  const hits = keywords.filter(k => t.includes(` ${k.toLowerCase()} `) || t.includes(` ${k.toLowerCase()}`)).length;
  return hits >= Math.min(2, keywords.length);
}

/** Parse a Google News RSS feed into [{title, link, source, published}] (no XML library needed). */
export function parseRss(xml) {
  const dec = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c)).trim();
  const tag = (blk, name) => { const m = blk.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? dec(m[1]) : ""; };
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const b = m[1];
    const source = tag(b, "source");
    let title = tag(b, "title");
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    return { title, link: tag(b, "link"), source, published: tag(b, "pubDate") };
  }).filter(i => i.title && /^https?:\/\//.test(i.link));
}
