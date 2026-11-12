// Firebase: username/password logins and stored picks. Optional — if no config, the site is read-only.
import { CONFIG } from "./config.js";

const V = "10.12.2";
let fb = null; // { auth, db, mods }

export const enabled = () => !!CONFIG.firebase.apiKey;

async function init() {
  if (fb || !enabled()) return fb;
  const [app, auth, store] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);
  const a = app.initializeApp(CONFIG.firebase);
  fb = { auth: auth.getAuth(a), db: store.getFirestore(a), A: auth, S: store };
  return fb;
}

export const usernameOf = user => user?.email ? user.email.split("@")[0].toLowerCase() : null;
export const isAdmin = user => CONFIG.admins.map(s => s.toLowerCase()).includes(usernameOf(user));

export async function onUser(cb) {
  const f = await init();
  if (!f) return cb(null);
  f.A.onAuthStateChanged(f.auth, cb);
}

export async function login(username, password) {
  const f = await init();
  const email = `${username.trim().toLowerCase()}@${CONFIG.emailDomain}`;
  await f.A.setPersistence(f.auth, f.A.browserLocalPersistence);
  return (await f.A.signInWithEmailAndPassword(f.auth, email, password)).user;
}

export async function logout() {
  const f = await init();
  return f && f.A.signOut(f.auth);
}

export async function changePassword(currentPassword, newPassword) {
  const f = await init();
  const user = f.auth.currentUser;
  const cred = f.A.EmailAuthProvider.credential(user.email, currentPassword);
  await f.A.reauthenticateWithCredential(user, cred);
  await f.A.updatePassword(user, newPassword);
}

/** Season settings, e.g. { lockAt: Date }. */
export async function getSeason(year) {
  const f = await init();
  if (!f) return {};
  const snap = await f.S.getDoc(f.S.doc(f.db, "seasons", String(year)));
  const d = snap.exists() ? snap.data() : {};
  return { ...d, lockAt: d.lockAt?.toDate?.() ?? null };
}

export async function setLock(year, date) {
  const f = await init();
  await f.S.setDoc(f.S.doc(f.db, "seasons", String(year)), { lockAt: f.S.Timestamp.fromDate(date) }, { merge: true });
}

/** All stored picks for a season: { username: { picks, name, updatedAt } } */
export async function getPicks(year) {
  const f = await init();
  if (!f) return {};
  const snap = await f.S.getDocs(f.S.collection(f.db, "seasons", String(year), "picks"));
  const out = {};
  snap.forEach(d => (out[d.id] = { ...d.data(), updatedAt: d.data().updatedAt?.toDate?.() ?? null }));
  return out;
}

export async function savePicks(year, username, name, picks) {
  const f = await init();
  await f.S.setDoc(f.S.doc(f.db, "seasons", String(year), "picks", username), {
    name, picks, updatedAt: f.S.serverTimestamp(), updatedBy: usernameOf(f.auth.currentUser),
  });
}

/* ── Weekly five picks ─────────────────────────────────────────────── */

const toTs = (S, secs) => S.Timestamp.fromMillis(secs * 1000);

/** Kick-off times stored for the database lock: { starts: {id: secs}, roundStarts: {r: secs} } or null. */
export async function getFixtureLocks(year) {
  const f = await init();
  if (!f) return null;
  const snap = await f.S.getDoc(f.S.doc(f.db, "seasons", String(year), "meta", "fixture"));
  if (!snap.exists()) return null;
  const d = snap.data();
  const secs = m => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [k, v.seconds]));
  return { starts: secs(d.starts), roundStarts: secs(d.roundStarts) };
}

/** Admin only: store kick-off times so the database can lock each pick at its game's start. */
export async function setFixtureLocks(year, locks) {
  const f = await init();
  const ts = m => Object.fromEntries(Object.entries(m).map(([k, v]) => [String(k), toTs(f.S, v)]));
  await f.S.setDoc(f.S.doc(f.db, "seasons", String(year), "meta", "fixture"),
    { starts: ts(locks.starts), roundStarts: ts(locks.roundStarts), syncedAt: f.S.serverTimestamp() });
}

const fromDoc = d => {
  if (!d) return null;
  const out = { user: d.user, round: d.round };
  for (const s of ["p1", "p2", "p3", "p4", "p5"]) if (d[s]) out[s] = { ...d[s], at: d[s].at?.seconds ?? null };
  return out;
};

/** One player's picks for a round, or null (also null if hidden from you until the round starts). */
export async function getWeekly(year, round, username) {
  const f = await init();
  if (!f) return null;
  try {
    const snap = await f.S.getDoc(f.S.doc(f.db, "seasons", String(year), "weekly", `${round}_${username}`));
    return snap.exists() ? fromDoc(snap.data()) : null;
  } catch (e) {
    if (/permission/i.test(e.code || e.message)) return null;
    throw e;
  }
}

/** Every visible weekly doc for the season (others' picks appear once each round starts). */
export async function getAllWeekly(year, usernames, rounds) {
  const jobs = [];
  for (const r of rounds) for (const u of usernames) jobs.push(getWeekly(year, r, u));
  return (await Promise.all(jobs)).filter(Boolean);
}

/**
 * Save my picks for a round. `slots` = { p1: {game, market, side}, ... }.
 * Unchanged slots are written back exactly as stored (the database checks this);
 * new or changed slots get the server's clock as their pick time.
 */
export async function saveWeekly(year, round, username, slots, previous) {
  const f = await init();
  const ref = f.S.doc(f.db, "seasons", String(year), "weekly", `${round}_${username}`);
  const current = (await f.S.getDoc(ref)).data() || {};
  const doc = { user: username, round };
  for (const s of ["p1", "p2", "p3", "p4", "p5"]) {
    const want = slots[s];
    if (!want) continue;
    const old = current[s];
    const same = old && old.game === want.game && old.market === want.market && old.side === want.side;
    doc[s] = same ? old : { game: want.game, market: want.market, side: want.side, at: f.S.serverTimestamp() };
  }
  await f.S.setDoc(ref, doc);
}

/* ── Season predictions ────────────────────────────────────────────── */

const predCol = (f, year) => f.S.collection(f.db, "seasons", String(year), "predictions");

export async function listPredictions(year) {
  const f = await init();
  if (!f) return [];
  const snap = await f.S.getDocs(predCol(f, year));
  const out = [];
  snap.forEach(d => {
    const x = d.data();
    out.push({ ...x, id: d.id, createdAt: x.createdAt?.toDate?.() ?? null, resolvedAt: x.resolvedAt?.toDate?.() ?? null });
  });
  return out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

/** Create (no id) or edit (id) one of my predictions. data: { kind, text, keywords, team?, cond?, n? } */
export async function savePrediction(year, id, data) {
  const f = await init();
  const user = usernameOf(f.auth.currentUser);
  const clean = { user, kind: data.kind, text: data.text, keywords: data.keywords || [], status: "pending" };
  if (data.kind === "ladder") Object.assign(clean, { team: data.team, cond: data.cond, n: data.n });
  if (!id) {
    const ref = f.S.doc(predCol(f, year));
    await f.S.setDoc(ref, { ...clean, createdAt: f.S.serverTimestamp() });
    return ref.id;
  }
  const ref = f.S.doc(predCol(f, year), id);
  const existing = (await f.S.getDoc(ref)).data();
  await f.S.setDoc(ref, { ...clean, user: existing.user, createdAt: existing.createdAt });
  return id;
}

export async function deletePrediction(year, id) {
  const f = await init();
  await f.S.deleteDoc(f.S.doc(predCol(f, year), id));
}

/** Admin: record the outcome. status: "true" | "false" | "pending"; evidence: {title, link, source} | null */
export async function resolvePrediction(year, id, status, evidence = null, note = "") {
  const f = await init();
  const ref = f.S.doc(predCol(f, year), id);
  const patch = status === "pending"
    ? { status, evidence: null, note: "", resolvedAt: null, resolvedBy: null }
    : { status, evidence, note, resolvedAt: f.S.serverTimestamp(), resolvedBy: usernameOf(f.auth.currentUser) };
  await f.S.setDoc(ref, patch, { merge: true });
}
