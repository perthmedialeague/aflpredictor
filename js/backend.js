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
