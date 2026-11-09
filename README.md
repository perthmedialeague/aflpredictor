# The Ladder Prophets: AFL ladder prediction comp

A static website for a season-long AFL ladder-prediction competition between friends.

- **Scoring:** for each club, the gap between your predicted position and its actual position. Add up all 18 gaps and the lowest total wins.
- **Live AFL ladder:** results come from the free [Squiggle API](https://api.squiggle.com.au), so nobody has to enter scores.
- **Week by week:** pick any round to see the standings as at that point. The Season Race chart tracks everyone's totals.
- **Password-protected picks:** each player logs in with their own username and password and can change only their own ladder until Round 1 starts. The lock is enforced by the database, not just by the page.
- **Past seasons:** each season lives in its own `data/<year>.json` file.

```
index.html          page
css/styles.css      styling (light + dark mode)
js/config.js        ← the settings you edit
js/app.js           page logic
js/scoring.js       ladder + scoring maths
js/squiggle.js      AFL results feed (cached)
js/backend.js       Firebase logins + stored picks
js/teams.js         club names, aliases, colours
data/2027.json      starting predictions for 2027
data/2026.json      2026 predictions (archive)
firestore.rules     database security rules
```

---

## 1. Put it on GitHub Pages (about 5 min)

1. Create a new **public** repository on GitHub, e.g. `ladder-prophets`.
2. Upload every file in this folder, keeping the folder structure (drag and drop works on the repo page via **Add file → Upload files**).
3. Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, then **Save**.
4. After a minute the site is live at `https://<your-username>.github.io/ladder-prophets/`.

At this point the site already works **read-only**: ladder, scores, history and picks all come from the JSON files. The steps below add logins.

## 2. Set up Firebase for logins (about 15 min, free)

1. Go to <https://console.firebase.google.com>, choose **Create a project** and give it any name. Google Analytics isn't needed.
2. **Add a web app:** on the project home page click the `</>` icon, give it a nickname and register it. Firebase shows a `firebaseConfig` block. Copy `apiKey`, `authDomain`, `projectId` and `appId` into `js/config.js` under `firebase:`.
   *These values are meant to be public. Security comes from the rules in step 5.*
3. **Turn on logins:** go to **Build → Authentication → Get started → Sign-in method → Email/Password → Enable**.
4. **Create each player's login:** go to **Authentication → Users → Add user**.
   - Email: `<username>@example.com`, e.g. `john@example.com`. The username must match the `username` in `data/2027.json`: brenden, john, marc, brett, marty, alex, paddy. No email is ever sent, so `example.com` is fine.
   - Password: anything at least 6 characters long. Send it to the player, who can change it on the site via **My picks → Change password**.
   - If someone forgets their password, open the user in the console and set a new one.
5. **Create the database:** go to **Build → Firestore Database → Create database**, choose a location (e.g. `australia-southeast1`) and start in **production mode**. Open the **Rules** tab, paste the whole of `firestore.rules`, then click **Publish**.
6. **Authorise your site:** go to **Authentication → Settings → Authorized domains → Add domain** and add `<your-username>.github.io`.
7. Commit the updated `js/config.js` to GitHub.

## 3. Open the season for picks

1. On the site, click **Log in to edit picks** and log in as an admin (`john`).
2. In the editor, the **Picks lock at** field is pre-filled with the first bounce of the season (once the AFL fixture is out). Click **Save lock time**.
   **Players can't save anything until a lock time is set.**
3. Send the link and passwords to the group. Each player logs in, drags clubs into order and clicks **Save picks**.
4. At the lock time the database starts refusing changes from players automatically. As admin you can still correct anyone's picks, add a late predictor with **+ Add a predictor…**, or move the lock time.

> Picks saved through the site are stored in Firebase and take priority over `data/2027.json`. The JSON file is just the starting point.

## Admins

Admins are listed in **two** places, and both must match:

- `js/config.js` → `admins: ["john"]`
- `firestore.rules` → `isAdmin()` → `['john']`

## Starting a new season (e.g. 2028)

1. **Archive the old season:** copy the final picks into `data/2027.json` so the archive no longer depends on Firebase. The admin can ask Claude to export them, or copy them from the Firestore console.
2. **Create the new file:** add `data/2028.json` (same shape; the `predictors` list can be empty).
3. **Update the config:** in `js/config.js`, set `currentSeason: 2028` and `seasons: [2028, 2027, 2026]`.
4. **Note for 2028:** Tasmania joins the AFL, making 19 teams. Add them to `js/teams.js` and `firestore.rules`, and change the `18`s in the scoring, editor and rules.

## Data file format

```json
{
  "year": 2027,
  "predictors": [
    { "name": "John", "username": "john", "picks": ["West Coast", "Fremantle", "..."] }
  ],
  "finalLadder": ["optional: 18 clubs in finishing order, used only if the results feed is unreachable"]
}
```

`picks` is 18 club names in predicted order (1st to 18th). Common nicknames such as "Eagles", "GWS" and "Freo" are recognised.

## Notes

- The final ladder used for scoring is the **home-and-away** ladder. Finals don't count.
- Opening Round games are counted as part of Round 1.
- Ladder order is points, then percentage.
- Results are cached in each browser for 5 minutes during the season.
