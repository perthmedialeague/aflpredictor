# The Ladder Prophets: AFL ladder prediction comp

A static website for a season-long AFL ladder-prediction competition between friends.

- **Scoring:** for each club, the gap between your predicted position and its actual position. Add up all 18 gaps and the lowest total wins.
- **AFL ladder:** results come from the free [Squiggle API](https://api.squiggle.com.au), fetched every 15 minutes in season by a GitHub Action, so nobody has to enter scores.
- **Week by week:** pick any round to see the standings as at that point. The Season Race chart tracks everyone's totals.
- **Password-protected picks:** each player logs in with their own username and password and can change only their own ladder until Round 1 starts. The lock is enforced by the database, not just by the page.
- **Past seasons:** each season lives in its own `data/<year>.json` file.

```
index.html          page
css/styles.css      styling (light + dark mode)
js/config.js        ← the settings you edit
js/app.js           page logic
js/scoring.js       ladder + scoring maths
js/results.js       loads data/games-<year>.json
scripts/fetch-results.mjs   downloads results from Squiggle (run by GitHub Actions)
.github/workflows/  the scheduled results update + Pages deploy
js/backend.js       Firebase logins + stored picks
js/teams.js         club names, aliases, colours
data/2027.json      starting predictions for 2027
data/2026.json      2026 predictions (archive)
firestore.rules     database security rules
```

---

## 1. Put it on GitHub Pages (about 5 min)

1. Create a new **public** repository on GitHub, e.g. `ladder-prophets`.
2. Upload every file in this folder, keeping the folder structure, **including the hidden `.github` folder** (it holds the workflow that fetches results).
   - Drag and drop works via **Add file → Upload files**. On a Mac, press `Cmd+Shift+.` in Finder to show hidden folders so you can drag `.github` too.
   - If it doesn't go up, create the file by hand: **Add file → Create new file**, name it `.github/workflows/update-results.yml`, and paste in the contents.
3. Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions** (not "Deploy from a branch").
4. Go to the **Actions** tab, choose **Update results and publish site**, then click **Run workflow**. After about a minute the site is live at `https://<your-username>.github.io/ladder-prophets/`.

### How results get onto the site

Squiggle doesn't let browsers on other websites read its API directly, so the page can't fetch results itself. Instead, the GitHub Action (`.github/workflows/update-results.yml`) runs `scripts/fetch-results.mjs`:

- **When it runs:** on every push, every 15 minutes from March to September, and once a day in the off-season.
- **What it does:** downloads each season's games, saves them as `data/games-<year>.json` and republishes the site.
- **Delays:** ladders can be up to about 15–20 minutes behind live scores, and GitHub sometimes runs scheduled jobs a little late.
- **Running it by hand:** to force an update, go to **Actions → Update results and publish site → Run workflow**.
- **Off-season pause:** GitHub pauses scheduled workflows in repositories with no commits for 60 days, and emails you first. If that happens over summer, open the Actions tab and click **Enable workflow** before Round 1. Any commit, such as editing the config, also counts as activity.

At this point the site already works **read-only**. The steps below add logins.

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
  "finalLadder": ["optional: 18 clubs in finishing order, used only if data/games-<year>.json is missing"]
}
```

`picks` is 18 club names in predicted order (1st to 18th). Common nicknames such as "Eagles", "GWS" and "Freo" are recognised.

## Notes

- The final ladder used for scoring is the **home-and-away** ladder. Finals don't count.
- Opening Round games are counted as part of Round 1.
- Ladder order is points, then percentage.
