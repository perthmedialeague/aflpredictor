# The Ladder Prophets: AFL ladder prediction comp

A static website for a season-long AFL ladder-prediction competition between friends.

- **Scoring:** for each club, the gap between your predicted position and its actual position. Add up all 18 gaps and the lowest total wins.
- **AFL ladder:** results come from the free [Squiggle API](https://api.squiggle.com.au), fetched every 15 minutes in season by a GitHub Action, so nobody has to enter scores.
- **Week by week:** pick any round to see the standings as at that point. The Season Race chart tracks everyone's totals.
- **Password-protected picks:** each player logs in with their own username and password and can change only their own ladder until Round 1 starts. The lock is enforced by the database, not just by the page.
- **Past seasons:** each season lives in its own `data/<year>.json` file.
- **Season Predictions:** a third page (**Predictions**) where everyone adds up to 10 bold calls for the year, until the Round 1 lock. Ladder and wins predictions ("Freo finish top 4", "West Coast win 8+ games") check themselves from the results. Anything else ("Clarko gets sacked") is searched in the news daily, and an admin confirms it with one click, optionally attaching the article as evidence. Most predictions that came true wins.
- **Weekly Picks:** a second competition on its own page (**Weekly picks** at the top right). Each round, everyone makes five picks against real bookmaker odds: head to head, line or total points, at most one per game. A winning pick scores its odds (e.g. 2.40), a loss scores 0, and a push (a draw, or a result exactly on the line) scores 1. Highest season total wins.

```
index.html          page
css/styles.css      styling (light + dark mode)
js/config.js        ← the settings you edit
js/app.js           page logic
js/scoring.js       ladder + scoring maths
js/results.js       loads data/games-<year>.json
js/weekly.js        weekly picks scoring (pure functions)
js/picks.js         Weekly Picks page
scripts/fetch-odds.mjs      downloads odds from The Odds API (run by GitHub Actions)
scripts/fetch-news.mjs      searches Google News for season predictions (run by GitHub Actions)
js/bold.js          season predictions: auto-checking, keywords, news matching
js/predictions.js   Predictions page
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
4. **Add a contact email for Squiggle (required):** go to **Settings → Secrets and variables → Actions → Variables tab → New repository variable**. Set the name to `SQUIGGLE_CONTACT` and the value to an email address Squiggle can reach you at. Squiggle silently blocks automated requests without one. The address stays in your GitHub settings, not in the public code.
5. Go to the **Actions** tab, choose **Update results and publish site**, then click **Run workflow**. After about a minute the site is live at `https://<your-username>.github.io/ladder-prophets/`.

### How results get onto the site

Squiggle doesn't let browsers on other websites read its API directly, so the page can't fetch results itself. Instead, the GitHub Action (`.github/workflows/update-results.yml`) runs `scripts/fetch-results.mjs`:

- **When it runs:** on every push, every 15 minutes from March to September, and once a day in the off-season.
- **What it does:** downloads the current season's games, saves them as `data/games-<year>.json` and republishes the site. Finished seasons already saved in `data/` (such as 2026) aren't downloaded again.
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

## 4. Turn on Weekly Picks (about 5 min)

1. **Get a free odds key:** sign up at <https://the-odds-api.com> and copy your API key from the email.
2. **Add the key to GitHub:** go to **Settings → Secrets and variables → Actions → Secrets tab → New repository secret**, set the name to `ODDS_API_KEY` and paste the key as the value. Secrets are hidden, even from people who can see the repository.
3. **Let the job save odds:** go to **Settings → Actions → General → Workflow permissions**, choose **Read and write permissions** and click **Save**. The job needs this to save the odds history.
4. **Update the database rules:** paste the updated `firestore.rules` into Firebase (**Firestore → Rules → Publish**).
5. **Choose the players:** Weekly Picks is set to Brenden, John, Marc, Brett and Marty. To change the list, edit `weeklyPlayers` in `js/config.js` **and** `weeklyPlayers()` in `firestore.rules`, then republish the rules.
6. **Sync the kick-off times:** log in as `john` and open **Weekly picks** once. The site copies the fixture's kick-off times into the database, which is what locks each pick when its game starts. It re-checks every time an admin opens the page, so if the AFL moves a game, opening the page once afterwards keeps the locks right.

### How it works

- **Odds:** the GitHub job fetches odds when a game starts within the next 8 days, at most every 6 hours. That's about 360 credits a month in season, so check your plan's monthly allowance. To change the interval, add a repository **variable** `ODDS_REFRESH_HOURS`. Odds are the median across Australian bookmakers. Each update is saved to `data/odds-<year>.json`, which the job commits back to the repository so the history is kept.
- **Your price:** each pick is priced at the odds showing when you saved it. The price comes from the saved history and the server's clock, so nobody can claim a better price later.
- **Locks:** each pick locks when its game starts, and the database refuses changes after that, not just the page. You can change unstarted picks as often as you like. Changing one pick doesn't affect the price of the others.
- **Seeing other people's picks:** they're hidden until the round's first bounce, then everyone's picks for the round are shown. This is enforced by the database for direct reads.
- **Results:** picks are settled automatically from the final scores.
- **Player props:** not included. The odds feed doesn't provide the player stats needed to settle them.

### Checking the database rules

The weekly picks rules couldn't be run against Firebase's emulator before release. To check them, open **Firestore → Rules → Rules Playground** and simulate the following, with authentication set to a user whose email is `marc@example.com`:

| Simulate | Path | Data | Expected |
|---|---|---|---|
| **set** | `seasons/2027/weekly/2_marc` | `{"user":"marc","round":2,"p1":{"game":<an upcoming game id>,"market":"h2h","side":"home","at":<request.time>}}` | allowed |
| **set** | the same path | the user changed to `"john"` | denied |
| **get** | `seasons/2027/weekly/2_brenden` | (before Round 2 starts) | denied |

## 5. Season Predictions

There's nothing extra to set up beyond publishing the updated `firestore.rules`.

- **Adding predictions:** players log in on the **Predictions** page and add, edit or delete their own until the season lock time (the same one as the ladder comp). Each person can make 10, which you can change with `predictionsPerPerson` in `js/config.js`.
- **Two kinds:**
  - **Ladder or wins:** pick a club and a condition (top N, miss the top N, bottom N, exactly Nth, at least or at most N wins). These are marked automatically. During the season they show *On track* or *Off track*. Positions are decided when the home-and-away season ends. Win targets are decided as soon as they're reached or become impossible.
  - **Anything:** free text plus a few search words, which are filled in for you. Once a day the GitHub job searches Google News for each undecided prediction. It keeps headlines containing at least two of the search words and saves them to `data/news-<year>.json`. No API key is needed.
- **Confirming:** admins see **✓ Came true / ✗ Didn't happen** buttons on every prediction, plus **Came true: use this** next to each news match to attach it as evidence. **Reset** undoes a decision. Admins can also override automatic results if needed.
- **News search frequency:** the job searches about once a day. To change it, set a repository variable `NEWS_REFRESH_HOURS`.

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
