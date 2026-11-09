// ─────────────────────────────────────────────────────────────
//  Site configuration — edit this file when setting up.
// ─────────────────────────────────────────────────────────────

export const CONFIG = {
  siteTitle: "The Ladder Prophets",

  // The season currently being played / predicted. Its picks can be edited until lock.
  currentSeason: 2027,

  // Every season with a data/<year>.json file, newest first.
  seasons: [2027, 2026],

  // Usernames that can edit anyone's picks and set the lock time.
  // Must also be listed in firestore.rules (isAdmin).
  admins: ["john"],

  // Logins are "username" + this domain behind the scenes (no emails are ever sent).
  // Create each Firebase user as e.g. john@example.com.
  emailDomain: "example.com",

  // Paste your Firebase web-app config here (Firebase console → Project settings → Your apps).
  // Leave apiKey empty and the site still works read-only from the JSON files.
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    appId: "",
  },
};
